const AsteriskManager = require('asterisk-manager');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const dbService = require('./dbService');
const issabelDbService = require('./issabelDbService');

function parseDurationSec(durStr) {
    if (!durStr) return 0;
    if (typeof durStr === 'number') return durStr;
    const parts = String(durStr).trim().split(':').map(Number);
    if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
    const n = parseInt(durStr, 10);
    return isNaN(n) ? 0 : n;
}

class AmiService {
    constructor() {
        this.ami = null;
        this.isConnected = false;
        
        // Asosiy ma'lumotlar ombori
        this.activeChannels = new Map();     // channelId -> channelInfo
        this.activeConversations = new Map(); // conversationKey -> { callerId, operator, state, startTime, duration, channel }
        this.operatorOutboundCalls = new Map(); // opId -> { dialedNumber, targetPhone, channel, destChannel, startTime }
        this.queues = new Map();             // queueName -> { name, callersWaiting: [], agents: [] }
        this.operators = new Map();          // exten -> { id, name, status, totalCalls, answered, clientHangup, operatorHangup, denied, totalDurationSec, avgDurationSec }
        this.callHistory = [];               // finished calls buffer

        this.wsBroadcastCallback = null;
        this.hourlyInbound = new Array(24).fill(0);
        this.hourlyOutbound = new Array(24).fill(0);
        
        this.stats = {
            totalCalls: 0,
            inboundCalls: 0,
            outboundCalls: 0,
            answeredCalls: 0,
            clientHangupCalls: 0,
            operatorHangupCalls: 0,
            deniedCalls: 0,
            queueAbandonedCalls: 0,
            totalDurationSec: 0
        };

        this.channelToOperator = new Map(); // channel / uniqueid -> operator extension (e.g. '103')
        this.pollingInterval = null;
        this.onAgentStateChange = null;
        this.isInitialSyncDone = false;
        this.agentActiveCalls = new Map(); // opId -> { callerId, eventType, timestamp }

        // Qo'lda belgilangan callsTaken ofsetlari (Asterisk xom qiymati USTIDAN farq).
        // Faylda saqlanadi — server qayta ishga tushsa ham yo'qolmaydi va 5 soniyalik
        // QueueStatus poll natijasi bu qiymatni hech qachon "yutib yubormaydi".
        this.manualCallsTakenOverrides = this.loadCallsTakenOverrides();

        // Asterisk RAM navbat hisobini (callsTaken) DB dagi bugungi JAMI qo'ng'iroqlar bilan avto-sinxronlash
        this.queueDbSyncSettingsFile = path.join(__dirname, '..', 'data', 'queue-sync-settings.json');
        this.queueDbSyncEnabled = this.loadQueueDbSyncSettings();
        this.currentTrackingDate = this.getTashkentTodayDate();

        // Issabel MariaDB bilan darhol sinxronizatsiyani ishga tushirish (MariaDB - asosiy CDR manbai)
        this.initialSyncPromise = this.syncIssabelData();
        setInterval(() => this.syncIssabelData(), 15000);

        // 3CX Desktop Agent ping vaqtlarini har 3 soniyada tekshirib turish (Tezkor Timeout Watchdog)
        setInterval(() => this.checkAgentTimeouts(), 3000);

        // Har 10 soniyada soat 00:00 (yangi kun) bo'lganini tekshirib, navbat hisoblagichlarini nollash
        setInterval(() => this.checkMidnightRollover(), 10000);
    }

    recordAgentCallEvent(operatorId, eventType, callerId) {
        if (!operatorId) return;
        const opId = String(operatorId);
        if (eventType === 'ANSWERED' || eventType === 'RINGING') {
            this.agentActiveCalls.set(opId, {
                callerId: callerId || '',
                eventType: eventType,
                timestamp: Date.now()
            });
        } else if (eventType === 'ENDED' || eventType === 'MISSED') {
            this.agentActiveCalls.delete(opId);
        }
    }

    getMatchablePhone9(phone) {
        if (!phone) return null;
        const digits = String(phone).replace(/\D/g, '');
        return digits.length >= 9 ? digits.slice(-9) : null;
    }

    getActiveCallByPhone(phone) {
        const target9 = this.getMatchablePhone9(phone);
        if (!target9) return null;

        // 1. Faol suhbatlar (talking)
        if (this.activeConversations) {
            for (const conv of this.activeConversations.values()) {
                const c9 = this.getMatchablePhone9(conv.callerId);
                if (c9 && c9 === target9) {
                    const opExten = conv.operatorExten || '';
                    const rawName = conv.operator || '';
                    const cleanName = String(rawName).replace(/\s*\(\d+\)\s*/g, '').trim() || (opExten ? `Operator ${opExten}` : 'Operator');
                    return {
                        operator: cleanName,
                        operatorExten: opExten,
                        state: 'talking',
                        stateLabel: 'gaplashmoqda',
                        direction: conv.direction || 'outbound',
                        duration: conv.duration || '00:00:00'
                    };
                }
            }
        }

        // 2. Chiquvchi yoki kiruvchi qo'ng'iroq jiringlayotgan (ringing)
        if (this.operators) {
            for (const [opId, op] of this.operators.entries()) {
                if (op.presence === 'ringing' && op.ringingCaller) {
                    const r9 = this.getMatchablePhone9(op.ringingCaller);
                    if (r9 && r9 === target9) {
                        const cleanName = op.realName || op.name || `Operator ${opId}`;
                        return {
                            operator: cleanName,
                            operatorExten: opId,
                            state: 'ringing',
                            stateLabel: 'qo\'ng\'iroq qilinmoqda',
                            direction: (op.ringingCaller && op.ringingCaller.startsWith('📤')) ? 'outbound' : 'inbound',
                            duration: '00:00:00'
                        };
                    }
                }
            }
        }

        // 3. Faol kanallar (activeChannels) ichidan tekshirish
        if (this.activeChannels) {
            for (const chan of this.activeChannels.values()) {
                const ch9 = this.getMatchablePhone9(chan.callerId) || this.getMatchablePhone9(chan.extension);
                if (ch9 && ch9 === target9 && chan.operator) {
                    const op = this.operators ? this.operators.get(chan.operator) : null;
                    const cleanName = op ? (op.realName || op.name || `Operator ${chan.operator}`) : `Operator ${chan.operator}`;
                    const isTalking = (chan.state || '').toLowerCase().includes('talk') || (chan.state || '').toLowerCase().includes('up') || chan.state === '6';
                    return {
                        operator: cleanName,
                        operatorExten: chan.operator,
                        state: isTalking ? 'talking' : 'ringing',
                        stateLabel: isTalking ? 'gaplashmoqda' : 'qo\'ng\'iroq qilinmoqda',
                        direction: chan.direction || 'outbound',
                        duration: chan.duration || '00:00:00'
                    };
                }
            }
        }

        // 4. 3CX Desktop Agent real-time faol qo'ng'iroqlari
        if (this.agentActiveCalls) {
            for (const [opId, callInfo] of this.agentActiveCalls.entries()) {
                const a9 = this.getMatchablePhone9(callInfo.callerId);
                if (a9 && a9 === target9) {
                    const op = this.operators ? this.operators.get(opId) : null;
                    const cleanName = op ? (op.realName || op.name || `Operator ${opId}`) : `Operator ${opId}`;
                    const isTalking = callInfo.eventType === 'ANSWERED';
                    return {
                        operator: cleanName,
                        operatorExten: opId,
                        state: isTalking ? 'talking' : 'ringing',
                        stateLabel: isTalking ? 'gaplashmoqda' : 'qo\'ng\'iroq qilinmoqda',
                        direction: 'outbound',
                        duration: '00:00:00'
                    };
                }
            }
        }

        return null;
    }

    getCallbacksWithActiveCalls(filter = 'all') {
        const list = (typeof dbService.getCallbacks === 'function') 
            ? dbService.getCallbacks(filter, true) 
            : dbService.getPendingCallbacks(filter);
        if (!Array.isArray(list)) return [];
        return list.map(item => {
            const activeCall = this.getActiveCallByPhone(item.phone);
            return {
                ...item,
                activeCall: activeCall || null
            };
        });
    }

    async ensureInitialSync() {
        if (!this.isInitialSyncDone && this.initialSyncPromise) {
            try {
                await this.initialSyncPromise;
            } catch (e) {
                console.warn('ensureInitialSync xatolik:', e.message);
            }
        }
    }

    async syncIssabelData() {
        try {
            await issabelDbService.fetchOperatorNames();
            const [stats, hourly, summary] = await Promise.all([
                issabelDbService.fetchTodayOperatorStats(),
                issabelDbService.fetchTodayHourlyStats(),
                issabelDbService.fetchTodaySummary()
            ]);
            
            const todayStr = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' }).slice(0, 10);
            if (this.currentDate && this.currentDate !== todayStr) {
                console.log(`🌅 Yangi kun boshlandi (${todayStr}). Operatorlar statistikasi qayta nollanmoqda...`);
                for (const op of this.operators.values()) {
                    op.totalCalls = 0;
                    op.answered = 0;
                    op.clientHangup = 0;
                    op.operatorHangup = 0;
                    op.denied = 0;
                    op.missed = 0;
                    op.transferredOut = 0;
                    op.transferredIn = 0;
                    op.transferResolved = 0;
                    op.totalDurationSec = 0;
                    op.avgDurationSec = 0;
                }
                this.stats.clientHangupCalls = 0;
                this.stats.operatorHangupCalls = 0;
            }
            this.currentDate = todayStr;

            const todayRejects = dbService.getTodayOperatorRejects();
            const todayMissed = dbService.getTodayOperatorMissed();
            const todayAgentStats = dbService.getTodayAgentOperatorStats();
            const statsMap = new Map(stats.map(s => [String(s.id), s]));

            // Barcha mavjud operatorlarni bugungi sana bo'yicha tozalash va yangilash
            for (const [id, op] of this.operators.entries()) {
                const st = statsMap.get(id);
                const agentOp = todayAgentStats[id];
                const agentOutbound = agentOp ? (agentOp.outbound || 0) : 0;
                const cdrOutbound = st ? (st.outbound || 0) : 0;
                const finalOutbound = Math.max(cdrOutbound, agentOutbound);

                if (st) {
                    op.name = st.name;
                    op.realName = st.realName;
                    op.answered = st.answered || 0;
                    op.outbound = finalOutbound;
                    op.transferredOut = st.transferredOut || 0;
                    op.transferredIn = st.transferredIn || 0;
                    op.transferResolved = st.transferResolved || Math.max(0, (st.transferredIn || 0) - (st.transferredOut || 0));
                    op.totalDurationSec = Math.max(st.totalDurationSec || 0, (agentOp && agentOp.totalDurationSec) || 0);
                    op.avgDurationSec = st.avgDurationSec || 0;
                } else {
                    op.answered = 0;
                    op.outbound = finalOutbound;
                    op.transferredOut = 0;
                    op.transferredIn = 0;
                    op.transferResolved = 0;
                    op.totalDurationSec = 0;
                    op.avgDurationSec = 0;
                }
                op.denied = todayRejects[id] || 0;
                op.missed = todayMissed[id] || 0;
                // Jami = qabul + chiquvchi + rad + transfer oxirida hal qilgan (+1)
                op.totalCalls = op.answered + (op.outbound || 0) + op.denied + (op.transferResolved || 0);
                this.operators.set(id, op);
            }

            // Stats dagi yangi operatorlar bo'lsa qo'shish
            for (const st of stats) {
                const id = String(st.id);
                if (!this.operators.has(id)) {
                    this.ensureOperatorExists(id);
                    const op = this.operators.get(id);
                    if (op) {
                        const agentOp = todayAgentStats[id];
                        const agentOutbound = agentOp ? (agentOp.outbound || 0) : 0;
                        op.name = st.name;
                        op.realName = st.realName;
                        op.answered = st.answered || 0;
                        op.outbound = Math.max(st.outbound || 0, agentOutbound);
                        op.transferredOut = st.transferredOut || 0;
                        op.transferredIn = st.transferredIn || 0;
                        op.transferResolved = st.transferResolved || 0;
                        op.denied = todayRejects[id] || 0;
                        op.missed = todayMissed[id] || 0;
                        op.totalCalls = op.answered + (op.outbound || 0) + op.denied + (op.transferResolved || 0);
                        op.totalDurationSec = st.totalDurationSec || 0;
                        op.avgDurationSec = st.avgDurationSec || 0;
                        this.operators.set(id, op);
                    }
                }
            }

            if (hourly) {
                this.hourlyChartData = hourly;
            }

            if (summary) {
                this.stats.totalCalls = summary.totalCalls;
                this.stats.inboundCalls = summary.inboundCalls;
                this.stats.outboundCalls = summary.outboundCalls || 0;
                this.stats.answeredCalls = summary.answeredCalls;
                this.stats.abandonedCalls = summary.abandonedCalls;
                this.stats.deniedCalls = summary.deniedCalls;
                this.stats.totalDurationSec = summary.totalDurationSec;
            }

            // Real-time oqimi uchun so'nggi qo'ng'iroqlarni doimiy ravishda CDR bilan sinxronlashtirish
            try {
                const paginated = await issabelDbService.fetchCallsPaginated(1, 30);
                if (paginated && paginated.data && paginated.data.length > 0) {
                    const cdrCalls = paginated.data.map(c => ({
                        id: c.id,
                        channel: '',
                        callerId: c.callerId,
                        operator: c.operator,
                        operatorExten: c.operatorExten,
                        direction: c.direction,
                        status: c.status,
                        hangupParty: c.hangupParty || 'Mijoz tugatdi',
                        duration: c.duration,
                        waitSec: c.waitSec || 0,
                        cause: 'CDR',
                        time: c.time,
                        recording: c.recording || ''
                    }));

                    if (this.callHistory.length === 0) {
                        this.callHistory = cdrCalls;
                    } else {
                        // Mavjud qo'ng'iroqlar bilan birlashtirish va boyitish (CDR ma'lumotlari eng ustuvor)
                        let hasChanges = false;
                        for (let i = cdrCalls.length - 1; i >= 0; i--) {
                            const cdrItem = cdrCalls[i];
                            const cdrPhone9 = this.getMatchablePhone9(cdrItem.callerId);

                            // 1. callHistory da aynan shu qo'ng'iroq bormi tekshiramiz:
                            //    - id bo'yicha
                            //    - yoki telefon raqami (oxirgi 9 raqami) va operatori bir xil, vaqti esa suhbat oralig'ida
                            const matchIdx = this.callHistory.findIndex(h => {
                                if (h.id === cdrItem.id) return true;
                                const hPhone9 = this.getMatchablePhone9(h.callerId);
                                if (!hPhone9 || !cdrPhone9 || hPhone9 !== cdrPhone9) return false;

                                const hTime = new Date(h.time).getTime();
                                const cdrTime = new Date(cdrItem.time).getTime();
                                const diffSec = Math.abs(hTime - cdrTime) / 1000;
                                const maxAllowedSec = Math.max(120, (cdrItem.duration || 0) + 120);

                                const opMatch = !h.operatorExten || !cdrItem.operatorExten || h.operatorExten === cdrItem.operatorExten;
                                return opMatch && diffSec <= maxAllowedSec;
                            });

                            if (matchIdx !== -1) {
                                const old = this.callHistory[matchIdx];
                                const needsUpdate = old.direction !== cdrItem.direction || 
                                                    old.duration !== cdrItem.duration || 
                                                    old.status !== cdrItem.status ||
                                                    (!old.recording && cdrItem.recording) ||
                                                    old.id !== cdrItem.id ||
                                                    old.time !== cdrItem.time;
                                if (needsUpdate) {
                                    this.callHistory[matchIdx] = {
                                        ...old,
                                        ...cdrItem,
                                        id: cdrItem.id,
                                        time: cdrItem.time,
                                        callerId: cdrItem.callerId,
                                        operator: cdrItem.operator || old.operator,
                                        operatorExten: cdrItem.operatorExten || old.operatorExten,
                                        direction: cdrItem.direction || old.direction,
                                        status: cdrItem.status || old.status,
                                        duration: cdrItem.duration !== undefined ? cdrItem.duration : old.duration,
                                        hangupParty: cdrItem.hangupParty || old.hangupParty,
                                        recording: cdrItem.recording || old.recording
                                    };
                                    hasChanges = true;
                                }
                            } else {
                                this.callHistory.unshift(cdrItem);
                                hasChanges = true;
                            }
                        }

                        if (this.callHistory.length > 500) {
                            this.callHistory = this.callHistory.slice(0, 500);
                        }

                        if (hasChanges) {
                            this.callHistory.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
                            this.broadcast('call_history_sync', this.getCallHistory(50));
                        }
                    }
                }
            } catch (e) {}

            this.broadcast('operators_update', this.getOperatorList());
            this.broadcast('stats_update', this.getSummaryStats());

            // Bog'lanishi kerak bo'lgan mijozlarni (Callbacks) Asterisk CDR dan sinxronlash
            try {
                const now = Date.now();
                const needFullSync = !this._lastFullCbSync || (now - this._lastFullCbSync > 30 * 60 * 1000);
                if (needFullSync) {
                    this._lastFullCbSync = now;
                    await issabelDbService.syncPendingCallbacks(30);
                } else {
                    await issabelDbService.syncPendingCallbacks(2);
                }
                this.broadcast('callbacks_update', this.getCallbacksWithActiveCalls());
            } catch (cbErr) {
                // Background quiet
            }
        } catch (err) {
            console.error('syncIssabelData xatolik:', err.message);
        } finally {
            this.isInitialSyncDone = true;
        }
    }

    init(wsBroadcast) {
        this.wsBroadcastCallback = wsBroadcast;

        try {
            this.ami = new AsteriskManager(
                config.AMI.port,
                config.AMI.host,
                config.AMI.user,
                config.AMI.password,
                config.AMI.events
            );

            this.ami.keepConnected();
            this.setupListeners();

            // Har 5 soniyada kanallar va queue holatini avtomatik yangilash
            if (this.pollingInterval) clearInterval(this.pollingInterval);
            this.pollingInterval = setInterval(() => {
                if (this.isConnected) {
                    this.pollQueueAndChannels();
                }
            }, 5000);

        } catch (err) {
            console.error('❌ AMI Boshlashda xatolik:', err.message);
        }
    }

    setupListeners() {
        this.ami.on('connect', () => {
            this.isConnected = true;
            console.log('✅ AMI ga muvaffaqiyatli ulandi! (Issabel PBX)');
            this.broadcast('ami_status', { connected: true, host: config.AMI.host });
            
            // Dastlabki ma'lumotlarni so'rash
            this.pollQueueAndChannels();
            this.querySipPeers();
        });

        this.ami.on('disconnect', () => {
            this.isConnected = false;
            console.warn('⚠️ AMI ulanishi uzildi, qayta ulanmoqda...');
            this.broadcast('ami_status', { connected: false });
        });

        this.ami.on('error', (err) => {
            console.error('❌ AMI Xatosi:', err.message || err);
            this.broadcast('ami_status', { connected: false, error: err.message });
        });

        this.ami.on('managerevent', (evt) => {
            this.handleManagerEvent(evt);
        });
    }

    /**
     * Asteriskdan Queue, Channel va SIP Peerlarni avtomatik so'rash
     */
    pollQueueAndChannels() {
        if (!this.ami || !this.isConnected) return;

        // Asterisk faol kanallarini sinxronlash uchun yangi to'plam
        this.pollChannelsBatch = new Set();

        // 1. Faol kanallarni olish
        this.ami.action({ action: 'CoreShowChannels' }, () => {});

        // 2. Navbatlar holatini olish (QueueStatus)
        this.ami.action({ action: 'QueueStatus' }, () => {});

        // 3. SIP peerlar holati (Online / Offline / 3CX ulanishi)
        this.ami.action({ action: 'SIPpeers' }, () => {});
    }

    querySipPeers() {
        if (!this.ami || !this.isConnected) return;
        this.ami.action({ action: 'SIPpeers' }, () => {});
    }

    setChannelOperator(key, opId) {
        if (!key || !opId) return;
        if (this.channelToOperator.size > 2000) {
            const oldKeys = Array.from(this.channelToOperator.keys()).slice(0, 500);
            oldKeys.forEach(k => this.channelToOperator.delete(k));
        }
        this.channelToOperator.set(key, opId);
    }

    /**
     * Operator raqamini tozalab ajratib olish (e.g. 'SIP/114-0000a', 'Local/103@from-queue', 'Operator 106' -> '103')
     */
    extractOperatorExten(...vals) {
        for (let val of vals) {
            if (!val) continue;
            val = String(val).trim();

            // Agar texnik so'zlar bo'lsa o'tkazib yuboramiz
            if (['ext-queues', 'macro-dial-one', 'from-queue', 'from-internal', 'default', 'app-queue', 'unknown', 'none'].includes(val.toLowerCase())) {
                continue;
            }

            // Agar bu shahar/mobil raqam (71..., 78..., 90..., 93... yoki 5+ xonali) bo'lsa - bu tashqi telefon raqami, operator emas!
            if (val.match(/^(?:998)?(?:71|78|90|91|93|94|95|97|98|99|33|88)\d{4,}/) || val.match(/^\d{5,}$/)) {
                continue;
            }

            // Local/103@from-queue
            const localMatch = val.match(/Local\/(\d{2,4})@/i);
            if (localMatch && !localMatch[1].startsWith('71')) return localMatch[1];

            // SIP/114 yoki PJSIP/114 yoki Local/114 yoki Agent/114
            const channelMatch = val.match(/(?:SIP|PJSIP|Local|IAX2|Agent|DAHDI)\/(\d{2,4})/i);
            if (channelMatch && !channelMatch[1].startsWith('71')) return channelMatch[1];

            // "Operator 103"
            const opPrefixMatch = val.match(/Operator\s*(\d{2,4})/i);
            if (opPrefixMatch && !opPrefixMatch[1].startsWith('71')) return opPrefixMatch[1];

            // 2 dan 4 xonagacha toza ichki raqam (101-199, 201-299, 401-499 va h.k.), 71 bilan boshlanmagan
            const pureExtenMatch = val.match(/^(\d{2,4})$/);
            if (pureExtenMatch && !pureExtenMatch[1].startsWith('71') && !pureExtenMatch[1].startsWith('90')) {
                return pureExtenMatch[1];
            }
        }
        return null;
    }

    /**
     * Tashqi mijoz raqamini ajratish (e.g. 901268181, 998901234567, 712055757)
     * Agar operator raqami (103, 106) yoki bo'sh bo'lsa -> "Yashirin raqam (Hidden)" deb qaytaradi
     */
    extractCallerNumber(...candidates) {
        for (const c of candidates) {
            if (!c) continue;
            const str = String(c);
            // Agar channel oddiy trank nomi bo'lsa (SIP/712020159-...), undan trank raqamini mijoz deb olmaslik kerak
            if (candidates.length <= 3 && c === candidates[2] && str.includes('2020159') && !str.includes('/')) continue;

            // 7 dan 12 tagacha raqam bo'lsa - bu tashqi mijoz raqami (barcha mosliklarni tekshiramiz)
            const allMatches = str.matchAll(/(?:998)?(\d{7,12})/g);
            for (const match of allMatches) {
                const found = match[0];
                if (found !== '712020159' && !found.endsWith('2020159') && !match[1].startsWith('000')) {
                    return found;
                }
            }
        }
        return 'Yashirin raqam (Hidden)';
    }

    handleManagerEvent(evt) {
        const now = new Date();

        // 1. SIP Peerdan barcha operatorlarni kashf qilish va ularning Statusini (Online/Offline) olish
        if (evt.event === 'PeerEntry') {
            const exten = evt.objectname || evt.channel;
            const opId = this.extractOperatorExten(exten);
            if (opId) {
                const rawStatus = (evt.status || '').toUpperCase();
                const isOnline = rawStatus.includes('OK') || rawStatus.includes('REACHABLE');
                const latency = evt.status || '';
                const ip = evt.ipaddress || '';
                
                this.ensureOperatorExists(opId);
                const op = this.operators.get(opId);
                if (op) {
                    if (isOnline) {
                        // 'talking' va 'ringing' holatlarni PeerEntry poll bosib yubormasin
                        if (op.presence !== 'talking' && op.presence !== 'ringing') {
                            op.presence = op.paused ? 'paused' : 'ready'; // On-hook yoki Pauzada
                        }
                    } else {
                        op.presence = 'offline'; // 3CX yoki softphone ulanmagan
                    }
                    op.ip = ip;
                    op.latency = latency;
                    this.operators.set(opId, op);
                }
            }
        }

        // SIP peerlar ro'yxati to'liq olinganda broadcast qilish
        if (evt.event === 'PeerlistComplete') {
            this.broadcast('operators_update', this.getOperatorList());
        }

        // 2. PeerStatus - Registratsiya yoki uzilish real-time hodisasi
        if (evt.event === 'PeerStatus') {
            const peer = evt.peer || '';
            const opId = this.extractOperatorExten(peer);
            if (opId) {
                const status = (evt.peerstatus || '').toLowerCase();
                this.ensureOperatorExists(opId);
                const op = this.operators.get(opId);
                if (op) {
                    if (status === 'registered' || status === 'reachable') {
                        if (op.presence !== 'talking') op.presence = op.paused ? 'paused' : 'ready';
                    } else if (status === 'unregistered' || status === 'unreachable') {
                        op.presence = 'offline';
                    }
                    this.operators.set(opId, op);
                    this.broadcast('operators_update', this.getOperatorList());
                }
            }
        }

        // 3. QueueStatus - Navbat va uning a'zolari (Operatorlar)
        if (evt.event === 'QueueParams') {
            const qName = evt.queue;
            if (!this.queues.has(qName)) {
                this.queues.set(qName, {
                    name: qName,
                    strategy: evt.strategy || 'ringall',
                    callsWaitingCount: parseInt(evt.calls || '0', 10),
                    completedCalls: parseInt(evt.completed || '0', 10),
                    abandonedCalls: parseInt(evt.abandoned || '0', 10),
                    callersWaiting: [],
                    agents: []
                });
            } else {
                const q = this.queues.get(qName);
                q.callsWaitingCount = parseInt(evt.calls || '0', 10);
                q.completedCalls = parseInt(evt.completed || '0', 10);
                q.abandonedCalls = parseInt(evt.abandoned || '0', 10);
                // Har 5 soniyalik QueueStatus so'rovi shu navbat uchun QueueParams bilan
                // boshlanadi — bu ro'yxatni bu yerda tozalab, keyin keladigan QueueEntry
                // hodisalaridan qayta to'ldiramiz. Aks holda, agar biror mijoz uchun
                // QueueCallerLeave hodisasi (masalan kanal nomi mos kelmay) o'tkazib
                // yuborilsa, u "Navbatda kutayotganlar"da abadiy osilib qolar edi —
                // hatto operatorga allaqachon ulangan bo'lsa ham.
                q.callersWaiting = [];
                this.queues.set(qName, q);
            }
        }

        // Navbat a'zosi (QueueMember statusi)
        if (evt.event === 'QueueMember') {
            const qName = evt.queue;
            const memberName = evt.membername || evt.location;
            const opId = this.extractOperatorExten(memberName) || this.extractOperatorExten(evt.location);
            if (opId) {
                this.ensureOperatorExists(opId);
                const op = this.operators.get(opId);
                if (op) {
                    // Asteriskning XOM (haqiqiy) callsTaken qiymati — har doim shu yerda yangilanadi.
                    // Qo'lda belgilangan ofset esa xom qiymat USTIGA getOperatorList() da qo'shiladi,
                    // shuning uchun bu 5 soniyalik poll qo'lda belgilangan sonni bosib yubormaydi.
                    if (evt.callstaken !== undefined) op.callsTaken = parseInt(evt.callstaken || '0', 10);
                    if (evt.lastcall !== undefined) op.lastCall = parseInt(evt.lastcall || '0', 10);
                }
                // Asterisk'ning "device state" (QueueMember statusi) ba'zan real vaqtda kechikadi —
                // operator haqiqatda suhbatda bo'lsa ham (AgentConnect orqali aniq bilamiz),
                // shu 5 soniyalik poll uni "bo'sh" deb ko'rsatib, holatni noto'g'ri bosib yuborishi
                // mumkin edi. Shuning uchun aniq kuzatilayotgan faol suhbat bo'lsa, bu pollga
                // presence'ni pastga tushirishga (ready/paused/offline) ruxsat bermaymiz.
                const hasActiveConversation = op && Array.from(this.activeConversations.values())
                    .some(c => c.operatorExten === opId);
                if (op && !hasActiveConversation) {
                    const memberStatus = parseInt(evt.status || '0', 10);
                    const paused = parseInt(evt.paused || '0', 10);
                    op.paused = (paused === 1);

                    if (op.paused) {
                        op.presence = 'paused'; // Tanaffusda / Pauzada
                        op.talkingSince = null;
                    } else if (memberStatus === 1) {
                        op.presence = 'ready';  // On-hook / Bo'sh / Qo'ng'iroq kutmoqda
                        op.talkingSince = null;
                    } else if (memberStatus === 2 || memberStatus === 3) {
                        if (op.presence !== 'talking' || !op.talkingSince) op.talkingSince = Date.now();
                        op.presence = 'talking'; // Suhbatda / In use
                    } else if (memberStatus === 4 || memberStatus === 5) {
                        op.presence = 'offline'; // Ulanmagan / Offline
                        op.talkingSince = null;
                    } else if (memberStatus === 6) {
                        if (op.presence !== 'ringing') op.ringingSince = Date.now();
                        op.presence = 'ringing'; // Telefon chalinmoqda
                        op.talkingSince = null;
                    }
                    this.operators.set(opId, op);
                }

                if (this.queues.has(qName)) {
                    const q = this.queues.get(qName);
                    if (!q.agents.includes(opId)) q.agents.push(opId);
                }
            }
        }

        // Navbat a'zosining pauza yoki statusi real vaqtda o'zgarganda (masalan *46 terilganda)
        if (evt.event === 'QueueMemberPaused' || evt.event === 'QueueMemberStatus') {
            const memberName = evt.membername || evt.location;
            const opId = this.extractOperatorExten(memberName) || this.extractOperatorExten(evt.location);
            if (opId) {
                this.ensureOperatorExists(opId);
                const op = this.operators.get(opId);
                if (op) {
                    if (evt.paused !== undefined) {
                        const paused = parseInt(evt.paused || '0', 10);
                        op.paused = (paused === 1);
                        if (op.paused) {
                            if (op.presence !== 'talking') {
                                op.presence = 'paused';
                                op.talkingSince = null;
                            }
                        } else {
                            if (op.presence === 'paused') {
                                op.presence = 'ready';
                            }
                        }
                    }
                    this.operators.set(opId, op);
                    this.broadcast('operators_update', this.getOperatorList());
                }
            }
        }

        // Navbat statuslari to'liq olinganda broadcast qilish
        if (evt.event === 'QueueStatusComplete') {
            this.broadcast('queue_update', this.getQueueSummaryList());
            this.broadcast('operators_update', this.getOperatorList());
        }

        // 4. ExtensionStatus hodisasi
        if (evt.event === 'ExtensionStatus') {
            const exten = evt.exten;
            const opId = this.extractOperatorExten(exten);
            if (opId) {
                this.ensureOperatorExists(opId);
                const op = this.operators.get(opId);
                if (op) {
                    const status = parseInt(evt.status || '0', 10);
                    if (status === 0) {
                        op.presence = op.paused ? 'paused' : 'ready'; // Idle / On-hook yoki Pauzada
                        op.talkingSince = null;
                    } else if (status === 1) {
                        if (op.presence !== 'talking' || !op.talkingSince) op.talkingSince = Date.now();
                        op.presence = 'talking'; // In use
                    } else if (status === 8) {
                        if (op.presence !== 'ringing') op.ringingSince = Date.now();
                        op.presence = 'ringing';
                        op.talkingSince = null;
                    } else if (status === 4 || status === -1) {
                        op.presence = 'offline';
                        op.talkingSince = null;
                    }
                    this.operators.set(opId, op);
                    this.broadcast('operators_update', this.getOperatorList());
                }
            }
        }

        // Navbatda turgan odam (QueueEntry)
        if (evt.event === 'QueueEntry') {
            const qName = evt.queue;
            const callerId = evt.calleridnum || evt.calleridname || 'Mijoz';
            if (this.queues.has(qName)) {
                const q = this.queues.get(qName);
                const exists = q.callersWaiting.some(c => c.callerId === callerId);
                if (!exists) {
                    q.callersWaiting.push({
                        callerId,
                        position: evt.position || '1',
                        waitSec: parseInt(evt.wait || '0', 10),
                        channel: evt.channel
                    });
                }
            }
        }

        // Navbatga yangi mijoz kirdi
        if (evt.event === 'QueueCallerJoin') {
            const qName = evt.queue || '2020159';
            const callerId = evt.calleridnum || 'Mijoz';
            if (!this.queues.has(qName)) {
                this.queues.set(qName, {
                    name: qName,
                    strategy: 'fewestcalls',
                    callsWaitingCount: 0,
                    completedCalls: 0,
                    abandonedCalls: 0,
                    callersWaiting: [],
                    agents: []
                });
            }
            const q = this.queues.get(qName);
            q.callersWaiting.push({
                callerId,
                position: evt.position || (q.callersWaiting.length + 1),
                waitSec: 0,
                channel: evt.channel,
                joinTime: now
            });
            q.callsWaitingCount = q.callersWaiting.length;
            this.recalculateConversations();
        }

        // Navbatdan mijoz chiqib ketdi / bog'landi
        if (evt.event === 'QueueCallerLeave') {
            const qName = evt.queue || '2020159';
            if (this.queues.has(qName)) {
                const q = this.queues.get(qName);
                q.callersWaiting = q.callersWaiting.filter(c => c.channel !== evt.channel);
                q.callsWaitingCount = q.callersWaiting.length;
            }
            this.recalculateConversations();
        }

        // Navbatda kutolmay qo'yib yubordi (Abandon)
        if (evt.event === 'QueueCallerAbandon') {
            this.stats.queueAbandonedCalls++;
            // deniedCalls bu yerda oshirilmaydi - abandoned != denied
            this.broadcast('stats_update', this.getSummaryStats());

            // Mijoz operatorga ulanmasdan (jiringlash paytida) tark etsa, ba'zida
            // AgentRingNoAnswer/DialEnd kabi "tozalovchi" hodisa kelmay qoladi va operator
            // kartasi haqiqatda hech narsa jiringlamayotgan bo'lsa ham "Jiringlamoqda"
            // holatida qolib ketadi. Shu mijoz raqamiga mos "ringing" operatorlarni tozalaymiz.
            const abandonedCallerId = this.extractCallerNumber(evt.calleridnum, evt.calleridname, evt.channel);
            if (abandonedCallerId) {
                let cleared = false;
                for (const [opId, op] of this.operators.entries()) {
                    if (op.presence === 'ringing' && op.ringingCaller === abandonedCallerId) {
                        op.presence = 'ready';
                        op.ringingCaller = null;
                        op.ringingSince = null;
                        this.operators.set(opId, op);
                        cleared = true;
                    }
                }
                if (cleared) this.broadcast('operators_update', this.getOperatorList());
            }
        }

        // DialBegin / DialState / DialEnd - Operatorga qo'ng'iroq ulanganda yoki operator tashqariga chiqqanda
        if (evt.event === 'DialBegin' || evt.event === 'DialState' || evt.event === 'DialEnd') {
            const destOpId = this.extractOperatorExten(evt.destchannel, evt.connectedlinenum, evt.destcalleridnum, evt.dialstring);
            const srcOpId = this.extractOperatorExten(evt.channel, evt.calleridnum) || this.channelToOperator.get(evt.channel);
            const opId = destOpId || srcOpId;

            if (opId) {
                // Agar operator tashqariga qo'ng'iroq qilayotgan bo'lsa (chiquvchi)
                if (srcOpId && !destOpId) {
                    if (evt.channel) this.setChannelOperator(evt.channel, srcOpId);
                    if (evt.destchannel) this.setChannelOperator(evt.destchannel, srcOpId);
                    if (evt.uniqueid) this.setChannelOperator(evt.uniqueid, srcOpId);
                    if (evt.destuniqueid) this.setChannelOperator(evt.destuniqueid, srcOpId);

                    const dialedCandidate = this.extractCallerNumber(evt.dialstring, evt.destcalleridnum, evt.connectedlinenum, evt.destchannel);
                    const targetPhone = (dialedCandidate && dialedCandidate !== 'Yashirin raqam (Hidden)')
                        ? ((typeof dbService.normalizePhone === 'function' ? dbService.normalizePhone(dialedCandidate) : String(dialedCandidate).replace(/\D/g, '')) || dialedCandidate)
                        : '';

                    this.operatorOutboundCalls.set(srcOpId, {
                        dialedNumber: (dialedCandidate && dialedCandidate !== 'Yashirin raqam (Hidden)') ? dialedCandidate : targetPhone,
                        targetPhone: targetPhone,
                        channel: evt.channel,
                        destChannel: evt.destchannel || '',
                        startTime: Date.now()
                    });

                    if (this.activeChannels.has(evt.channel)) {
                        const c = this.activeChannels.get(evt.channel);
                        c.direction = 'outbound';
                        c.operator = srcOpId;
                        if (targetPhone) c.dialedPhone = targetPhone;
                        this.activeChannels.set(evt.channel, c);
                    }
                    if (evt.destchannel && this.activeChannels.has(evt.destchannel)) {
                        const dc = this.activeChannels.get(evt.destchannel);
                        dc.direction = 'outbound';
                        dc.operator = srcOpId;
                        if (targetPhone) dc.dialedPhone = targetPhone;
                        this.activeChannels.set(evt.destchannel, dc);
                    }
                } else if (destOpId) {
                    // Kiruvchi: Operatorga navbat yoki tashqi mijoz qo'ng'iroq qilmoqda (faqat destchannel operatorga tegishli)
                    // Kiruvchi mijoz kanali (evt.channel) operator go'shakni ko'tarmaguncha (AgentConnect) operatorga biriktirilmaydi!
                    if (evt.destchannel) this.setChannelOperator(evt.destchannel, destOpId);
                    if (evt.destuniqueid) this.setChannelOperator(evt.destuniqueid, destOpId);

                    if (this.activeChannels.has(evt.channel)) {
                        const c = this.activeChannels.get(evt.channel);
                        c.direction = 'inbound';
                        this.activeChannels.set(evt.channel, c);
                    }
                    if (evt.destchannel && this.activeChannels.has(evt.destchannel)) {
                        const dc = this.activeChannels.get(evt.destchannel);
                        dc.direction = 'inbound';
                        dc.operator = destOpId;
                        this.activeChannels.set(evt.destchannel, dc);
                    }
                }
            }
        }

        // ⛔ AMI orqali BUSY ni rad etish (Reject) yoki QueueMemberRingNoAnswer ni o'tkazib yuborilgan (Missed) deb hisoblash xato:
        // Navbat (Queue) boshqa operatorlarga navbat bilan qo'ng'iroq uzatayotganda (rrmemory),
        // liniya band bo'lsa yoki navbat aylanayotganda Asterisk avtomatik BUSY va RingNoAnswer hodisalarini hosil qiladi
        // (operatorlar umuman ko'rmagan bo'lsa ham yoki 3CX ulanmagan bo'lsa ham).
        // Shuning uchun Rad etish (Reject) va O'tkazib yuborish (Missed) faqat va faqat operator kompyuteridagi 3CX Desktop Agent orqali olinadi!

        // Navbat operatorga qo'ng'iroqni uzatganda (Operator telefoni chalinmoqda / Ringing)
        if (evt.event === 'AgentCalled') {
            const opId = this.extractOperatorExten(
                evt.agentcalled,
                evt.agentname,
                evt.interface,
                evt.member,
                evt.destchannel,
                evt.channelcalling
            );
            const callerId = this.extractCallerNumber(evt.calleridnum, evt.calleridname, evt.channelcalling);
            if (opId) {
                this.ensureOperatorExists(opId);
                const op = this.operators.get(opId);
                if (op) {
                    if (op.presence !== 'talking') {
                        if (op.presence !== 'ringing') op.ringingSince = Date.now();
                        op.presence = 'ringing';
                    }
                    op.ringingCaller = callerId;
                    this.operators.set(opId, op);
                    this.broadcast('operators_update', this.getOperatorList());
                }
            }
        }

        // Operator javob bermasdan navbat keyingisiga o'tganda (AgentRingNoAnswer)
        if (evt.event === 'AgentRingNoAnswer') {
            const opId = this.extractOperatorExten(
                evt.agentcalled,
                evt.agentname,
                evt.interface,
                evt.member,
                evt.destchannel
            );
            if (opId && this.operators.has(opId)) {
                const op = this.operators.get(opId);
                if (op.presence === 'ringing') {
                    op.presence = 'ready';
                }
                op.ringingCaller = null; op.ringingSince = null;
                this.operators.set(opId, op);
                this.broadcast('operators_update', this.getOperatorList());
            }
        }

        // 4. Queue real hodisalari: AgentConnect (Operator javob berdi)
        if (evt.event === 'AgentConnect') {
            const opId = this.extractOperatorExten(
                evt.member, 
                evt.membername, 
                evt.interface, 
                evt.destchannel, 
                evt.connectedlinenum, 
                evt.agent
            ) || this.channelToOperator.get(evt.channel) || this.channelToOperator.get(evt.uniqueid);

            const callerId = this.extractCallerNumber(evt.calleridnum, evt.calleridname, evt.channel);
            const holdTime = parseInt(evt.holdtime || '0', 10);

            if (opId) {
                if (evt.channel) this.setChannelOperator(evt.channel, opId);
                if (evt.destchannel) this.setChannelOperator(evt.destchannel, opId);
                this.ensureOperatorExists(opId);
                const op = this.operators.get(opId);
                if (op) {
                    op.presence = 'talking';
                    op.talkingSince = op.talkingSince || Date.now();
                    op.ringingCaller = null; op.ringingSince = null;
                    op.totalCalls++;
                    op.answered++;
                    this.operators.set(opId, op);
                }
            }

            if (evt.channel && this.activeChannels.has(evt.channel)) {
                const ac = this.activeChannels.get(evt.channel);
                ac.direction = 'inbound';
                if (opId) ac.operator = opId;
                this.activeChannels.set(evt.channel, ac);
            }
            if (evt.destchannel && this.activeChannels.has(evt.destchannel)) {
                const adc = this.activeChannels.get(evt.destchannel);
                adc.direction = 'inbound';
                if (opId) adc.operator = opId;
                this.activeChannels.set(evt.destchannel, adc);
            }

            this.stats.answeredCalls++;

            const realOpName = issabelDbService.getOperatorName(opId);
            const opDisplay = opId ? (realOpName && realOpName !== `Operator ${opId}` ? `${realOpName} (${opId})` : `Operator ${opId}`) : (evt.queue ? `Navbat (${evt.queue})` : 'Operator');

            // Active conversationni yangilash
            const key = callerId !== 'Noma\'lum' ? callerId : (opId ? `OP_${opId}` : evt.channel);
            this.activeConversations.set(key, {
                key: key,
                callerId: callerId,
                operator: opDisplay,
                operatorExten: opId || '',
                state: 'Suhbatda',
                stateType: 'talking',
                direction: 'inbound',
                channel: evt.channel,
                startTime: now,
                duration: '00:00:00'
            });

            this.broadcast('active_conversations_update', Array.from(this.activeConversations.values()));
            this.broadcast('stats_update', this.getSummaryStats());
            this.broadcast('operators_update', this.getOperatorList());
        }

        // 5. AgentComplete (Suhbat yakunlandi - Kim qo'ygani va gaplashgan vaqti)
        if (evt.event === 'AgentComplete') {
            const opId = this.extractOperatorExten(
                evt.member, 
                evt.membername, 
                evt.interface, 
                evt.agent
            ) || this.channelToOperator.get(evt.channel) || this.channelToOperator.get(evt.uniqueid);

            const callerId = this.extractCallerNumber(evt.calleridnum, evt.calleridname, evt.channel);
            const talkTime = parseInt(evt.talktime || '0', 10);
            const reason = (evt.reason || '').toLowerCase(); // 'caller' | 'agent' | 'transfer'
            const isTransfer = reason === 'transfer';

            let hangupParty = 'Mijoz';
            if (isTransfer) {
                hangupParty = 'Transfer (Operatorga)';
            } else if (reason === 'agent') {
                hangupParty = 'Operator';
                this.stats.operatorHangupCalls++;
            } else {
                hangupParty = 'Mijoz';
                this.stats.clientHangupCalls++;
            }

            this.stats.totalDurationSec += talkTime;

            if (opId) {
                this.ensureOperatorExists(opId);
                const op = this.operators.get(opId);
                if (op) {
                    op.presence = 'ready';
                    op.talkingSince = null;
                    op.totalDurationSec += talkTime;
                    op.avgDurationSec = op.answered > 0 ? Math.round(op.totalDurationSec / op.answered) : 0;
                    if (hangupParty === 'Operator') {
                        op.operatorHangup++;
                    } else if (!isTransfer) {
                        op.clientHangup++;
                    }
                    // Eslatma: transfer bilan tugagan qo'ng'iroq bu operatorning Jami siga bu yerda qo'shilmaydi -
                    // +1 faqat transfer zanjirini OXIRGI bo'lib tugatgan operatorga beriladi (CDR TRANSFERS_OUT/IN orqali 15s sinxron bilan).
                    this.operators.set(opId, op);
                }
            }

            // Conversationdan o'chirish
            const key = callerId !== 'Noma\'lum' ? callerId : (opId ? `OP_${opId}` : evt.channel);
            this.activeConversations.delete(key);

            // Tarixga yozish - Qo'ng'iroq boshlangan aniq vaqtni hisoblash (Start Time / calldate)
            let callStartTime = null;
            if (evt.uniqueid && !isNaN(parseFloat(evt.uniqueid))) {
                const epochSec = parseFloat(evt.uniqueid);
                if (epochSec > 1500000000) {
                    callStartTime = new Date(epochSec * 1000);
                }
            }
            if (!callStartTime) {
                const holdTime = parseInt(evt.holdtime || '0', 10);
                const totalSec = (talkTime || 0) + holdTime;
                callStartTime = new Date(now.getTime() - (totalSec * 1000));
            }

            const localTimeStr = callStartTime.toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
            const realOpName = issabelDbService.getOperatorName(opId);
            const opDisplay = opId ? (realOpName && realOpName !== `Operator ${opId}` ? `${realOpName} (${opId})` : `Operator ${opId}`) : 'Navbat / Operator';

            const historyRecord = {
                id: Date.now() + Math.random().toString(36).substr(2, 4),
                channel: evt.channel,
                callerId: callerId,
                operator: opDisplay,
                operatorExten: opId || '',
                direction: isTransfer ? 'transfer' : 'inbound',
                status: 'ANSWERED',
                hangupParty: isTransfer ? 'Transfer (Operatorga)' : `${hangupParty} tugatdi`,
                duration: talkTime,
                waitSec: parseInt(evt.holdtime || '0', 10),
                cause: isTransfer ? 'Transfer' : ('AgentComplete (' + (evt.reason || 'Normal') + ')'),
                time: localTimeStr
            };

            this.callHistory.unshift(historyRecord);
            if (this.callHistory.length > 500) this.callHistory.pop();

            // SQLite bazasiga doimiy saqlash
            dbService.saveCall(historyRecord);

            this.broadcast('call_hangup', historyRecord);
            this.broadcast('active_conversations_update', Array.from(this.activeConversations.values()));
            this.broadcast('stats_update', this.getSummaryStats());
            this.broadcast('operators_update', this.getOperatorList());
        }

        // 6. DialBegin (Navbat mijozni qaysi operatorga yo'naltirayotgani yoki operator tashqariga chiqqani)
        if (evt.event === 'DialBegin') {
            const destChan = evt.destchannel || '';
            const srcChan = evt.channel || '';
            const destOpId = this.extractOperatorExten(destChan) || this.extractOperatorExten(evt.dialstring);
            const srcOpId = this.extractOperatorExten(srcChan) || this.channelToOperator.get(srcChan);

            if (destOpId) {
                // KIRUVCHI: Navbat operatorga yo'naltirmoqda
                this.ensureOperatorExists(destOpId);
                this.setChannelOperator(destChan, destOpId);
                if (this.activeChannels.has(destChan)) {
                    this.activeChannels.get(destChan).direction = 'inbound';
                }
                if (srcChan && this.activeChannels.has(srcChan)) {
                    this.activeChannels.get(srcChan).direction = 'inbound';
                }
                const callerId = this.extractCallerNumber(evt.calleridnum, evt.calleridname, srcChan);

                const op = this.operators.get(destOpId);
                if (op) {
                    if (op.presence !== 'talking') {
                        if (op.presence !== 'ringing') op.ringingSince = Date.now();
                        op.presence = 'ringing';
                    }
                    op.ringingCaller = callerId;
                    this.operators.set(destOpId, op);
                    this.broadcast('operators_update', this.getOperatorList());
                }
            } else if (srcOpId) {
                // CHIQUVCHI: Operator tashqi raqamga telefon qilmoqda (Oybek hodisasi)
                this.ensureOperatorExists(srcOpId);
                this.setChannelOperator(srcChan, srcOpId);
                if (destChan) this.setChannelOperator(destChan, srcOpId);
                // Terilgan raqamni aniqlash
                const dialedNumber = this.extractCallerNumber(evt.connectedlinenum, evt.dialstring, evt.destcalleridnum);
                const displayNum = (dialedNumber && dialedNumber !== 'Yashirin raqam (Hidden)') ? dialedNumber : (evt.dialstring || 'Tashqi raqam');
                const rawTarget = dialedNumber || evt.dialstring || evt.destcalleridnum;
                const targetPhone = (typeof dbService.normalizePhone === 'function' ? dbService.normalizePhone(rawTarget) : String(rawTarget || '').replace(/\D/g, '')) || displayNum;

                this.operatorOutboundCalls.set(srcOpId, {
                    dialedNumber: displayNum,
                    targetPhone: targetPhone || displayNum,
                    channel: srcChan,
                    destChannel: destChan,
                    startTime: Date.now()
                });

                if (this.activeChannels.has(srcChan)) {
                    const sc = this.activeChannels.get(srcChan);
                    sc.direction = 'outbound';
                    if (targetPhone) sc.dialedPhone = targetPhone;
                    if (destChan) sc.pairedChannel = destChan;
                }
                if (destChan && this.activeChannels.has(destChan)) {
                    const dc = this.activeChannels.get(destChan);
                    dc.direction = 'outbound';
                    if (targetPhone) dc.dialedPhone = targetPhone;
                    if (srcChan) dc.pairedChannel = srcChan;
                }

                const op = this.operators.get(srcOpId);
                if (op) {
                    if (op.presence !== 'talking') {
                        if (op.presence !== 'ringing') op.ringingSince = Date.now();
                        op.presence = 'ringing';
                    }
                    op.ringingCaller = `📤 ${displayNum}`;
                    this.operators.set(srcOpId, op);
                    this.broadcast('operators_update', this.getOperatorList());
                }
            }
        }

        // 7. DialEnd (Jiringlash tugaganda holatni tozalash yoki javob berilganda suhbatni boshlash)
        if (evt.event === 'DialEnd') {
            const destChan = evt.destchannel || '';
            const srcChan = evt.channel || '';
            const opId = this.extractOperatorExten(destChan) || 
                         this.extractOperatorExten(srcChan) || 
                         this.channelToOperator.get(destChan) || 
                         this.channelToOperator.get(srcChan) || 
                         this.extractOperatorExten(evt.dialstring);

            const dialStatus = (evt.dialstatus || '').toUpperCase();
            if (dialStatus === 'ANSWER') {
                // MIJOZ JAVOB BERDI! Suhbat boshlandi:
                if (srcChan && this.activeChannels.has(srcChan)) {
                    const sc = this.activeChannels.get(srcChan);
                    sc.state = 'Talking';
                    sc.answeredTime = now;
                    this.activeChannels.set(srcChan, sc);
                }
                if (destChan && this.activeChannels.has(destChan)) {
                    const dc = this.activeChannels.get(destChan);
                    dc.state = 'Talking';
                    dc.answeredTime = now;
                    this.activeChannels.set(destChan, dc);
                }
                if (opId && this.operatorOutboundCalls.has(opId)) {
                    const oCall = this.operatorOutboundCalls.get(opId);
                    oCall.answeredTime = now;
                    this.operatorOutboundCalls.set(opId, oCall);
                }
                if (opId && this.operators.has(opId)) {
                    const op = this.operators.get(opId);
                    op.presence = 'talking';
                    if (!op.talkingSince) op.talkingSince = now.getTime();
                    op.ringingCaller = null;
                    op.ringingSince = null;
                    this.operators.set(opId, op);
                    this.broadcast('operators_update', this.getOperatorList());
                }
            } else {
                // Javob berilmaganda (BUSY, NOANSWER, CANCEL, CONGESTION, CHANUNAVAIL)
                // DIQQAT: Faqat aynan shu chiquvchi qo'ng'iroq kanali bo'lsa o'chiramiz!
                // Agar operator suhbat chog'ida navbatdan kelgan boshqa qo'ng'iroq BUSY bo'lgan bo'lsa, mavjud chiquvchi qo'ng'iroq o'chirilmasin!
                if (opId && this.operatorOutboundCalls.has(opId)) {
                    const ob = this.operatorOutboundCalls.get(opId);
                    const isForThisOutbound = (srcChan && (ob.channel === srcChan || ob.destChannel === srcChan)) ||
                                              (destChan && (ob.destChannel === destChan || ob.channel === destChan));
                    if (isForThisOutbound) {
                        this.operatorOutboundCalls.delete(opId);
                    }
                }
                if (opId && this.operators.has(opId)) {
                    const op = this.operators.get(opId);
                    if (op.presence === 'ringing') {
                        const hasValidIp = op.ip && op.ip !== '-none-' && op.ip !== '' && op.ip !== '(null)';
                        op.presence = hasValidIp ? 'ready' : 'offline';
                        op.ringingCaller = null; 
                        op.ringingSince = null;
                        this.operators.set(opId, op);
                        this.broadcast('operators_update', this.getOperatorList());
                    }
                }
            }
        }

        // 7.1. AgentConnect (Operator navbatdagi mijoz bilan ulanganda)
        if (evt.event === 'AgentConnect') {
            const rawCaller = this.extractCallerNumber(evt.calleridnum, evt.calleridname, evt.channel);
            const opExt = this.extractOperatorExten(evt.destchannel, evt.membername, evt.interface);

            // Channel holatini 'Talking' va 'answeredTime' ga o'tkazish
            if (evt.channel && this.activeChannels.has(evt.channel)) {
                const chan = this.activeChannels.get(evt.channel);
                chan.state = 'Talking';
                chan.answeredTime = now;
                if (opExt) chan.operator = opExt;
                this.activeChannels.set(evt.channel, chan);
            }
            if (evt.destchannel && this.activeChannels.has(evt.destchannel)) {
                const dChan = this.activeChannels.get(evt.destchannel);
                dChan.state = 'Talking';
                dChan.answeredTime = now;
                if (opExt) dChan.operator = opExt;
                this.activeChannels.set(evt.destchannel, dChan);
            }

            if (rawCaller && rawCaller !== 'Yashirin raqam (Hidden)') {
                const resolved = dbService.resolveCallback(rawCaller, opExt ? `operator_${opExt}_inbound` : 'realtime_agent_connect', opExt, 'client_inbound');
                if (resolved) {
                    this.broadcast('callbacks_update', this.getCallbacksWithActiveCalls());
                }
            }
        }

        // 8. QueueCallerAbandon (Mijoz navbatda kutishdan bosh tortib qo'yganda)
        if (evt.event === 'QueueCallerAbandon') {
            this.stats.abandonedCalls++;
            const callerId = this.extractCallerNumber(evt.calleridnum, evt.calleridname, evt.channel);
            const holdTime = parseInt(evt.holdtime || '0', 10);
            let callStartTime = null;
            if (evt.uniqueid && !isNaN(parseFloat(evt.uniqueid))) {
                const epochSec = parseFloat(evt.uniqueid);
                if (epochSec > 1500000000) {
                    callStartTime = new Date(epochSec * 1000);
                }
            }
            if (!callStartTime) {
                callStartTime = new Date(now.getTime() - (holdTime * 1000));
            }
            const localTimeStr = callStartTime.toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
            const historyRecord = {
                id: Date.now() + Math.random().toString(36).substr(2, 4),
                channel: evt.channel || '',
                callerId: callerId,
                operator: 'Navbat (Kutishda uzildi)',
                operatorExten: '',
                direction: 'inbound',
                status: 'ABANDONED',
                hangupParty: 'Mijoz tugatdi',
                duration: 0,
                waitSec: holdTime,
                cause: 'QueueCallerAbandon',
                time: localTimeStr
            };
            this.callHistory.unshift(historyRecord);
            if (this.callHistory.length > 500) this.callHistory.pop();
            dbService.saveCall(historyRecord);
            this.broadcast('call_hangup', historyRecord);
            this.broadcast('stats_update', this.getSummaryStats());

            // Bog'lanishi kerak bo'lgan mijozlar ro'yxatiga qo'shish
            if (callerId && callerId !== 'Yashirin raqam (Hidden)') {
                const cleanPhone = dbService.normalizePhone(callerId);
                if (cleanPhone) {
                    dbService.upsertCallback({
                        phone: cleanPhone,
                        source: 'abandoned',
                        callTime: localTimeStr
                    });
                    this.broadcast('callbacks_update', this.getCallbacksWithActiveCalls());
                }
            }
        }

        // 7. CoreShowChannel - Faol kanallarni qabul qilish
        if (evt.event === 'CoreShowChannel') {
            const channelId = evt.channel;
            if (this.pollChannelsBatch) {
                this.pollChannelsBatch.add(channelId);
            }

            const callerId = evt.calleridnum || '';
            const callerName = evt.calleridname || '';
            const exten = evt.extension || evt.context || '';
            const state = evt.channelstatedesc || evt.channelstate || 'Active';
            const context = evt.context || '';
            const application = evt.application || '';

            const existing = this.activeChannels.get(channelId);
            const possibleOp = this.extractOperatorExten(callerId) || this.extractOperatorExten(exten) || this.extractOperatorExten(channelId) || this.channelToOperator.get(channelId);

            const ctxLower = context.toLowerCase();
            const isDialoutCtx = ctxLower.includes('dialout') || ctxLower.includes('outbound');
            const isOpOutboundTracked = Boolean(possibleOp && this.operatorOutboundCalls.has(possibleOp));
            const isKnownOutboundChan = Array.from(this.operatorOutboundCalls.values()).some(o => o.channel === channelId || o.destChannel === channelId);

            let isOutbound = false;
            if (isOpOutboundTracked || isKnownOutboundChan || (existing && existing.direction === 'outbound')) {
                isOutbound = true;
            } else {
                // Yangi kanal: Faqat operator o'zi tashqi mijoz raqamiga tergan bo'lsa chiquvchi
                const isOpCaller = callerId && callerId.length <= 4 && this.extractOperatorExten(callerId);
                const isExternalDialed = exten && exten.length >= 7 && exten !== '2020159' && exten !== '712020159';
                const isQueueOrInbound = ctxLower.includes('queue') || ctxLower.includes('from-trunk') || ctxLower.includes('from-pstn') || ctxLower.includes('ivr') || ctxLower.includes('ext-queues') || application.toLowerCase().includes('queue');
                if (isOpCaller && isExternalDialed && !isQueueOrInbound) {
                    isOutbound = true;
                }
            }

            // Operatorga biriktirilgan chiquvchi kanal bo'lsa uni bog'lash
            let trackedDialedPhone = (existing && existing.dialedPhone) || null;
            if (possibleOp && this.operatorOutboundCalls.has(possibleOp)) {
                const ob = this.operatorOutboundCalls.get(possibleOp);
                if (!ob.channel && channelId.includes(possibleOp)) ob.channel = channelId;
                if (!ob.destChannel && !channelId.includes(possibleOp)) ob.destChannel = channelId;
                if (ob.dialedNumber) trackedDialedPhone = ob.dialedNumber;
                this.setChannelOperator(channelId, possibleOp);
            }

            const isStateUp = state.toLowerCase().includes('up') || state.toLowerCase().includes('talk') || state === '6';
            const finalStartTime = (existing && existing.startTime) || now;
            let finalAnsweredTime = (existing && existing.answeredTime) || null;
            if (!finalAnsweredTime && isStateUp) {
                finalAnsweredTime = now;
            }

            this.activeChannels.set(channelId, {
                channel: channelId,
                callerId: callerId,
                callerName: callerName,
                extension: exten,
                context: context,
                application: application,
                state: state,
                direction: isOutbound ? 'outbound' : 'inbound',
                duration: evt.duration || (existing && existing.duration) || '00:00:00',
                startTime: finalStartTime,
                answeredTime: finalAnsweredTime,
                dialedPhone: trackedDialedPhone,
                operator: possibleOp || (existing && existing.operator) || null
            });

            if (possibleOp) {
                this.ensureOperatorExists(possibleOp);
            }
        }

        // 7.1. CoreShowChannelsComplete - Asterisk kanallarni to'liq jo'natib bo'lganda (Zombi kanallarni tozalash)
        if (evt.event === 'CoreShowChannelsComplete') {
            if (this.pollChannelsBatch) {
                let pruned = false;
                for (const chanId of Array.from(this.activeChannels.keys())) {
                    if (!this.pollChannelsBatch.has(chanId)) {
                        this.activeChannels.delete(chanId);
                        this.channelToOperator.delete(chanId);
                        pruned = true;
                    }
                }
                this.pollChannelsBatch = null;
            }
            this.recalculateConversations();
        }

        // 8. Newchannel - Faqat haqiqiy tashqi qo'ng'iroq kelganda
        if (evt.event === 'Newchannel') {
            const channelId = evt.channel;
            
            // Ichki texnik local kanallarni hisobga olmaslik (bitta qo'ng'iroq 10 ta bo'lib ko'paymasligi uchun)
            if (channelId.startsWith('Local/') && (channelId.includes('@from-queue') || channelId.includes(';2'))) {
                return;
            }

            const callerId = evt.calleridnum || 'Yashirin';
            const exten = evt.exten || evt.extension || evt.context || '';
            const context = evt.context || '';
            const opId = this.extractOperatorExten(channelId) || this.extractOperatorExten(callerId);
            const isExternalNumber = (exten.length >= 7 || /^(?:998|0)?(?:71|78|90|91|93|94|95|97|98|99|33|88)\d{5,}/.test(exten)) && exten !== '2020159' && exten !== '712020159';
            const isQueueOrTrunk = context.includes('queue') || context.includes('from-trunk') || context.includes('from-pstn') || context.includes('ivr');

            const isOutbound = Boolean(opId && isExternalNumber && !isQueueOrTrunk);

            if (opId && isOutbound) {
                this.setChannelOperator(channelId, opId);
            }

            this.stats.totalCalls++;
            const currentHour = now.getHours();
            if (isOutbound) {
                this.stats.outboundCalls++;
                this.hourlyOutbound[currentHour] = (this.hourlyOutbound[currentHour] || 0) + 1;
            } else {
                this.stats.inboundCalls++;
                this.hourlyInbound[currentHour] = (this.hourlyInbound[currentHour] || 0) + 1;
            }

            this.activeChannels.set(channelId, {
                channel: channelId,
                callerId: callerId,
                callerName: evt.calleridname || '',
                extension: exten || 'Linya',
                context: context,
                application: '',
                state: 'Ring',
                direction: isOutbound ? 'outbound' : 'inbound',
                startTime: now,
                answeredTime: null,
                operator: opId || null
            });

            this.recalculateConversations();
            this.broadcast('stats_update', this.getSummaryStats());
        }

        // 9. Bridge / BridgeEnter (Oddiy to'g'ridan-to'g'ri yoki tashqi qo'ng'iroq ulanganda)
        if (evt.event === 'BridgeEnter' || (evt.event === 'Bridge' && (evt.bridgestate || '').toLowerCase() === 'link')) {
            const channelsToUpdate = [];
            if (evt.channel) channelsToUpdate.push(evt.channel);
            if (evt.channel1) channelsToUpdate.push(evt.channel1);
            if (evt.channel2) channelsToUpdate.push(evt.channel2);

            let detectedOp = null;

            for (const channelId of channelsToUpdate) {
                const rawOp = evt.connectedlinenum || evt.calleridnum || evt.callerid1 || evt.callerid2 || '';
                const operator = this.extractOperatorExten(rawOp) || this.extractOperatorExten(channelId) || this.channelToOperator.get(channelId);
                if (operator && !detectedOp) detectedOp = operator;

                if (this.activeChannels.has(channelId)) {
                    const chan = this.activeChannels.get(channelId);
                    chan.state = 'Talking';
                    chan.answeredTime = now;
                    if (operator) chan.operator = operator;
                    this.activeChannels.set(channelId, chan);

                    // Agar operator tashqi mijoz bilan gaplashishni boshlasa (outbound) -> ro'yxatdan yechish
                    const dialed = chan.dialedPhone || (chan.pairedChannel && this.activeChannels.get(chan.pairedChannel) && this.activeChannels.get(chan.pairedChannel).dialedPhone);
                    if (chan.direction === 'outbound' && dialed) {
                        const resolved = dbService.resolveCallback(dialed, operator ? `operator_${operator}_outbound` : 'realtime_outbound_bridge', operator, 'operator_outbound');
                        if (resolved) {
                            this.broadcast('callbacks_update', this.getCallbacksWithActiveCalls());
                        }
                    }
                }
            }

            if (detectedOp) {
                this.ensureOperatorExists(detectedOp);
                const op = this.operators.get(detectedOp);
                if (op) {
                    if (op.presence !== 'talking' || !op.talkingSince) op.talkingSince = Date.now();
                    op.presence = 'talking';
                    op.ringingCaller = null;
                    op.ringingSince = null;
                    this.operators.set(detectedOp, op);
                }
                if (this.operatorOutboundCalls.has(detectedOp)) {
                    const oCall = this.operatorOutboundCalls.get(detectedOp);
                    oCall.answeredTime = now;
                    this.operatorOutboundCalls.set(detectedOp, oCall);
                }
            }

            this.recalculateConversations();
            this.broadcast('stats_update', this.getSummaryStats());
            this.broadcast('operators_update', this.getOperatorList());
        }

        // 10. Hangup - Kanal uzilganda
        if (evt.event === 'Hangup') {
            const channelId = evt.channel;
            const cause = evt.cause || evt.cause_txt || 'Normal Clearing';
            
            // Agar bu ichki local navbat kanali bo'lsa
            if (channelId.startsWith('Local/') && (channelId.includes('@from-queue') || channelId.includes(';2'))) {
                this.activeChannels.delete(channelId);
                return;
            }

            let callData = this.activeChannels.get(channelId);
            if (callData) {
                this.activeChannels.delete(channelId);

                // Agar bu tashqi mijoz kanali bo'lsa va u hali callHistory ga kirmagan bo'lsa
                // (masalan, navbatda kutib uzilgan yoki operatorga yetmasdan uzilgan qo'ng'iroq)
                const opId = callData.operator || this.channelToOperator.get(channelId) || this.extractOperatorExten(channelId);
                const oCall = (opId ? this.operatorOutboundCalls.get(opId) : null) ||
                              Array.from(this.operatorOutboundCalls.values()).find(o => o.channel === channelId || o.destChannel === channelId);
                const isInternalOperatorChannel = Boolean(channelId.match(/^SIP\/[0-9]{2,4}-/));
                const isTrunkChannel = channelId.startsWith('SIP/712020159');

                // Chiquvchi qo'ng'iroq ekanligini qat'iy aniqlash
                const isOutboundCall = (callData.direction === 'outbound') || 
                                       Boolean(callData.dialedPhone) || 
                                       Boolean(oCall) || 
                                       (isInternalOperatorChannel && callData.extension && callData.extension.length >= 7 && !callData.context.includes('queue'));
                if (isOutboundCall) {
                    callData.direction = 'outbound';
                }

                let dialedNumber = callData.dialedPhone || (oCall && oCall.dialedNumber) || (oCall && oCall.targetPhone) || '';
                if (!dialedNumber && isOutboundCall) {
                    const extracted = this.extractCallerNumber(callData.extension, callData.callerName, callData.callerId);
                    if (extracted && extracted !== 'Yashirin raqam (Hidden)') {
                        dialedNumber = extracted;
                    }
                }

                // Outbound trunk kanali: agar dialedPhone bo'lmasa yoki trunk raqami bo'lsa, bu alohida qo'ng'iroq emas, PBX tranki
                if (isTrunkChannel && isOutboundCall && !dialedNumber) {
                    return;
                }

                const isOutboundWithDialed = isOutboundCall && Boolean(dialedNumber) && !dialedNumber.endsWith('2020159');
                const isExternal = isTrunkChannel || (callData.direction === 'inbound') || (callData.callerId && callData.callerId.length >= 7) || isOutboundWithDialed;

                let rawNum = isOutboundCall ? dialedNumber : this.extractCallerNumber(callData.callerId, callData.callerName, channelId);
                if (isOutboundCall && (!rawNum || rawNum === 'Yashirin raqam (Hidden)') && dialedNumber) {
                    rawNum = dialedNumber;
                }

                const isAlreadyInHistory = this.callHistory.some(c => 
                    c.channel === channelId || 
                    (evt.uniqueid && c.uniqueid === evt.uniqueid) ||
                    (isOutboundCall && c.direction === 'outbound' && (c.callerId === rawNum || (opId && c.operatorExten === opId)) && (Math.abs(Date.now() - new Date(c.time).getTime()) < 60000))
                );

                if (isExternal && !isAlreadyInHistory && !channelId.startsWith('Local/')) {
                    // 712020159 yoki trunk raqamlari hech qachon alohida mijoz qo'ng'irog'i sifatida saqlanmasin
                    if (!rawNum || rawNum === '712020159' || rawNum.endsWith('2020159') || rawNum.length < 7 || rawNum === 'Yashirin raqam (Hidden)') {
                        return;
                    }

                    const callStartTime = callData.startTime || (oCall && oCall.startTime ? new Date(oCall.startTime) : null) || now;
                    const localTimeStr = callStartTime.toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });

                    const evtBillSec = parseInt(evt.billsec || evt.billable_seconds || '0', 10);
                    const evtDuration = parseInt(evt.duration || '0', 10);

                    const isAnswered = Boolean(
                        evtBillSec > 0 ||
                        callData.answeredTime || 
                        (oCall && oCall.answeredTime) ||
                        callData.state === 'Talking' || 
                        (callData.operator && callData.operator !== 'Operatorga ulanmadi') || 
                        this.channelToOperator.has(channelId)
                    );

                    let durationSec = 0;
                    if (isAnswered) {
                        if (evtBillSec > 0) {
                            durationSec = evtBillSec;
                        } else if (callData.answeredTime) {
                            durationSec = Math.max(0, Math.round((now.getTime() - new Date(callData.answeredTime).getTime()) / 1000));
                        } else if (oCall && oCall.answeredTime) {
                            durationSec = Math.max(0, Math.round((now.getTime() - new Date(oCall.answeredTime).getTime()) / 1000));
                        } else if (oCall && oCall.startTime) {
                            durationSec = Math.max(0, Math.round((now.getTime() - new Date(oCall.startTime).getTime()) / 1000));
                        } else if (callData.startTime) {
                            durationSec = Math.max(0, Math.round((now.getTime() - new Date(callData.startTime).getTime()) / 1000));
                        } else if (evtDuration > 0) {
                            durationSec = evtDuration;
                        }
                    }

                    const waitSec = isOutboundCall ? 0 : Math.max(0, Math.round((now.getTime() - callStartTime.getTime()) / 1000) - durationSec);

                    const realOpName = opId ? issabelDbService.getOperatorName(opId) : null;
                    const opDisplay = opId ? (realOpName && realOpName !== `Operator ${opId}` ? `${realOpName} (${opId})` : `Operator ${opId}`) : 'Operatorga ulanmadi';

                    const historyRecord = {
                        id: Date.now() + Math.random().toString(36).substr(2, 4),
                        channel: channelId,
                        uniqueid: evt.uniqueid || '',
                        callerId: rawNum,
                        operator: opDisplay,
                        operatorExten: opId || '',
                        direction: isOutboundCall ? 'outbound' : 'inbound',
                        status: isAnswered ? 'ANSWERED' : (isOutboundCall ? 'NO ANSWER' : 'ABANDONED'),
                        hangupParty: isAnswered ? (isOutboundCall ? 'Operator' : 'Mijoz tugatdi') : (isOutboundCall ? 'Javobsiz' : 'Ko\'tarilmadi'),
                        duration: durationSec,
                        waitSec: waitSec,
                        cause: 'Hangup (' + cause + ')',
                        time: localTimeStr
                    };

                    this.callHistory.unshift(historyRecord);
                    if (this.callHistory.length > 500) this.callHistory.pop();
                    dbService.saveCall(historyRecord);
                    this.broadcast('call_hangup', historyRecord);

                    // Callback ro'yxatini yangilash:
                    // Agar suhbat muvaffaqiyatli bo'lsa -> yechiladi (mijoz bilan gaplashildi)
                    // Agar javobsiz/uzilgan FAQAT KIRUVCHI qo'ng'iroq bo'lsa -> ro'yxatga qo'shiladi/yangilanadi
                    const cleanPhone = dbService.normalizePhone(rawNum);
                    if (cleanPhone && cleanPhone !== '712020159' && !cleanPhone.endsWith('2020159')) {
                        if (isAnswered) {
                            const resType = (callData.direction === 'outbound') ? 'operator_outbound' : 'client_inbound';
                            const resolved = dbService.resolveCallback(cleanPhone, opId ? `operator_${opId}_${resType}` : `hangup_${resType}`, opId, resType);
                            if (resolved) {
                                this.broadcast('callbacks_update', this.getCallbacksWithActiveCalls());
                            }
                        } else if (callData.direction === 'inbound') {
                            // Ichki operator kanali (SIP/114) go'shakni ko'tarmasa, bu mijoz navbatdan chiqdi degani EMAS.
                            // FAQAT tashqi trank kanali (isTrunkChannel) uzilsa va mijoz hozir hech kim bilan gaplashmayotgan bo'lsa:
                            const isCallerStillActive = Boolean(this.getActiveCallByPhone(cleanPhone));
                            const hadRecentAnsweredCall = Boolean(
                                Array.isArray(this.callHistory) && this.callHistory.slice(0, 30).find(h => 
                                    h.direction === 'inbound' && 
                                    h.status === 'ANSWERED' && 
                                    dbService.normalizePhone(h.callerId) === cleanPhone &&
                                    (Date.now() - new Date(h.time).getTime() < 90000)
                                )
                            );
                            if (isTrunkChannel && !isInternalOperatorChannel && !isCallerStillActive && !callData.isAnswered && !hadRecentAnsweredCall) {
                                const isWork = dbService.isWorkingHours(callStartTime);
                                const source = isWork ? 'abandoned' : 'ivr_non_working';
                                dbService.upsertCallback({
                                    phone: cleanPhone,
                                    source: source,
                                    callTime: localTimeStr
                                });
                                this.broadcast('callbacks_update', this.getCallbacksWithActiveCalls());
                            }
                        } else if (callData.direction === 'outbound') {
                            if (!isTrunkChannel) {
                                const updated = dbService.recordFailedOutboundAttempt({
                                    phone: cleanPhone,
                                    operator: opDisplay,
                                    cause: cause,
                                    time: localTimeStr
                                });
                                if (updated) {
                                    this.broadcast('callbacks_update', this.getCallbacksWithActiveCalls());
                                }
                            }
                        }
                    }
                }
            }

            if (channelId) {
                this.channelToOperator.delete(channelId);
            }
            if (evt.uniqueid) {
                this.channelToOperator.delete(evt.uniqueid);
            }

            // Operator SIP kanali yoki unga bog'langan kanal yopilganda (suhbat yoki chaqiruv tugaganda)
            const hangupOpId = this.extractOperatorExten(channelId) || (callData && callData.operator) || this.channelToOperator.get(channelId);
            if (hangupOpId && this.operatorOutboundCalls.has(hangupOpId)) {
                const ob = this.operatorOutboundCalls.get(hangupOpId);
                const isForThisOutbound = (channelId === ob.channel || channelId === ob.destChannel);
                if (isForThisOutbound) {
                    setTimeout(() => {
                        this.operatorOutboundCalls.delete(hangupOpId);
                    }, 5000);
                }
            }
            if (channelId) {
                for (const [opKey, outCall] of this.operatorOutboundCalls.entries()) {
                    if (outCall.channel === channelId || outCall.destChannel === channelId) {
                        setTimeout(() => {
                            this.operatorOutboundCalls.delete(opKey);
                        }, 5000);
                    }
                }
            }

            if (hangupOpId && !channelId.startsWith('Local/') && this.operators.has(hangupOpId)) {
                const op = this.operators.get(hangupOpId);
                const hasValidIp = op.ip && op.ip !== '-none-' && op.ip !== '' && op.ip !== '(null)';
                op.presence = hasValidIp ? 'ready' : 'offline';
                op.ringingCaller = null;
                op.ringingSince = null;
                op.talkingSince = null;
                this.operators.set(hangupOpId, op);
            }

            this.recalculateConversations();
            this.broadcast('active_conversations_update', Array.from(this.activeConversations.values()));
            this.broadcast('operators_update', this.getOperatorList());
        }

        // 11. AttendedTransfer / BlindTransfer (Qo'ng'iroq boshqa operatorga o'tkazilganda)
        if (evt.event === 'AttendedTransfer' || evt.event === 'BlindTransfer') {
            const transfererChan = evt.origtransfererchannel || evt.transfererchannel || '';
            const fromOp = this.extractOperatorExten(transfererChan);
            const targetChan = evt.targetchannel || '';
            const targetExt = evt.extension || this.extractOperatorExten(targetChan);

            if (fromOp && this.operators.has(fromOp)) {
                const op = this.operators.get(fromOp);
                const hasValidIp = op.ip && op.ip !== '-none-' && op.ip !== '' && op.ip !== '(null)';
                op.presence = hasValidIp ? 'ready' : 'offline';
                this.operators.set(fromOp, op);
            }
            if (targetExt && this.operators.has(targetExt)) {
                const op = this.operators.get(targetExt);
                op.presence = 'talking';
                this.operators.set(targetExt, op);
            }

            this.recalculateConversations();
            this.broadcast('operators_update', this.getOperatorList());
            this.broadcast('active_conversations_update', Array.from(this.activeConversations.values()));
        }
    }

    /**
     * Takroriy kanallarni birlashtirib haqiqiy Suhbatlar va Navbatda kutayotganlarni qat'iy ajratish
     */
    recalculateConversations() {
        const queueCallers = [];
        const talkingConversations = [];

        // 1. Faol gaplashayotgan operatorlarni aniqlash
        const activeOperators = new Map(); // opId -> { chanId, chan }
        const externalChannels = [];

        for (const [chanId, chan] of this.activeChannels.entries()) {
            if (chanId.startsWith('Local/')) {
                continue;
            }

            const op = this.extractOperatorExten(chan.operator, chan.extension, chan.callerId, chanId) || this.channelToOperator.get(chanId);
            const isOpChannel = (chanId.startsWith('SIP/1') || chanId.startsWith('PJSIP/1') || chanId.startsWith('SIP/2') || chanId.startsWith('PJSIP/2') || chanId.startsWith('SIP/4')) && op;
            const isStateUp = chan.state.toLowerCase().includes('up') || chan.state.toLowerCase().includes('talk') || chan.state === '6';

            if (isOpChannel && op) {
                if (isStateUp) {
                    activeOperators.set(op, { chanId, chan });
                    this.ensureOperatorExists(op);
                    const operatorObj = this.operators.get(op);
                    if (operatorObj) {
                        operatorObj.presence = 'talking';
                        if (!operatorObj.talkingSince) {
                            if (chan.answeredTime) {
                                operatorObj.talkingSince = new Date(chan.answeredTime).getTime();
                            } else if (chan.duration) {
                                const durSec = parseDurationSec(chan.duration);
                                operatorObj.talkingSince = durSec > 0 ? (Date.now() - durSec * 1000) : Date.now();
                            } else {
                                operatorObj.talkingSince = Date.now();
                            }
                        }
                        this.operators.set(op, operatorObj);
                    }
                }
            } else {
                externalChannels.push({ chanId, chan, op });
            }
        }

        // 2. Har bir gaplashayotgan operatorni mijoz kanali bilan juftlash
        const usedExtChannels = new Set();

        for (const [opId, opData] of activeOperators.entries()) {
            let pairedChan = externalChannels.find(ec => !usedExtChannels.has(ec.chanId) && (ec.op === opId || this.channelToOperator.get(ec.chanId) === opId));
            
            if (!pairedChan) {
                pairedChan = externalChannels.find(ec => !usedExtChannels.has(ec.chanId) && (ec.chan.state.toLowerCase().includes('up') || ec.chan.state === '6'));
            }

            let callerNum = 'Mijoz (Ulangan)';
            let channelToUse = opData.chanId;
            let duration = opData.chan.duration || '00:00:00';

            if (pairedChan) {
                usedExtChannels.add(pairedChan.chanId);
                const num = this.extractCallerNumber(pairedChan.chan.callerId, pairedChan.chan.callerName, pairedChan.chanId);
                if (num && num !== 'Yashirin raqam (Hidden)') {
                    callerNum = num;
                }
                channelToUse = pairedChan.chanId;
                duration = pairedChan.chan.duration || duration;
            }

            // Yo'nalishni aniqlash (faqat haqiqiy operator tashqariga chiqqan bo'lsa outbound)
            const opObj = this.operators.get(opId);
            const savedOutbound = this.operatorOutboundCalls.get(opId);
            const isDialedOutbound = Boolean((opObj && opObj.ringingCaller && opObj.ringingCaller.startsWith('📤')) || savedOutbound);
            const isChanOutbound = (opData.chan.direction === 'outbound') || (pairedChan && pairedChan.chan.direction === 'outbound');

            const pairedCtx = (pairedChan && pairedChan.chan.context) ? pairedChan.chan.context.toLowerCase() : '';
            const opCtx = (opData.chan && opData.chan.context) ? opData.chan.context.toLowerCase() : '';

            // DIALOUT kontekstlari (FAQAT tashqi chiquvchi tranklar / dialout yo'llari; from-internal ichki kontekst, chiquvchi emas!)
            const isDialoutContext = pairedCtx.includes('dialout') || pairedCtx.includes('outbound') || opCtx.includes('dialout') || opCtx.includes('outbound');

            const isInboundTrunkOrQueue = (
                pairedCtx.includes('from-trunk') || 
                pairedCtx.includes('from-pstn') || 
                pairedCtx.includes('ext-queues') || 
                (pairedCtx.includes('queue') && !pairedCtx.includes('dialout')) ||
                opData.chan.direction === 'inbound' ||
                (pairedChan && pairedChan.chan.direction === 'inbound')
            );

            // Qat'iy va barqaror yo'nalish:
            // 1. Agar operator o'zi tergan bo'lsa (savedOutbound) -> outbound
            // 2. Agar trank/navbat/inbound bo'lsa -> inbound (hech qachon chiquvchiga aylanmaydi!)
            // 3. Aks holda faqat dialout kontekst yoki aniq belgilangan holatda -> outbound
            let isOutbound = false;
            if (savedOutbound) {
                isOutbound = true;
            } else if (isInboundTrunkOrQueue) {
                isOutbound = false;
            } else if (isDialoutContext || isDialedOutbound || isChanOutbound) {
                isOutbound = true;
            }

            if (isOutbound) {
                // Chiquvchi qo'ng'iroqda terilgan mijoz raqamini chiqarish (bizning trunk raqami o'rniga)
                const dialedFromSaved = savedOutbound ? savedOutbound.dialedNumber : null;
                const dialedFromRinging = opObj && opObj.ringingCaller ? opObj.ringingCaller.replace(/^📤\s*/, '') : null;
                const dialedCandidate = this.extractCallerNumber(
                    dialedFromSaved,
                    dialedFromRinging,
                    (pairedChan && pairedChan.chan.extension),
                    opData.chan.extension,
                    (pairedChan && pairedChan.chan.callerName)
                );
                if (dialedCandidate && dialedCandidate !== 'Yashirin raqam (Hidden)') {
                    callerNum = dialedCandidate;
                } else if (dialedFromSaved) {
                    callerNum = dialedFromSaved;
                } else if (dialedFromRinging && dialedFromRinging !== 'Tashqi raqam' && dialedFromRinging !== 'Chiquvchi qo\'ng\'iroq') {
                    callerNum = dialedFromRinging;
                }
            }

            const realOpName = issabelDbService.getOperatorName(opId);
            const opDisplay = realOpName && realOpName !== `Operator ${opId}` ? `${realOpName} (${opId})` : `Operator ${opId}`;

            const isClientAnswered = !isOutbound || (pairedChan && (pairedChan.chan.state.toLowerCase().includes('up') || pairedChan.chan.state === '6' || !!pairedChan.chan.answeredTime));
            const convState = isOutbound ? (isClientAnswered ? 'Chiquvchi suhbat' : 'Chiquvchi chaqiruv...') : 'Suhbatda';
            const stateType = isClientAnswered ? 'talking' : 'ringing';

            if (isOutbound) {
                const operatorObj = this.operators.get(opId);
                if (operatorObj) {
                    if (!isClientAnswered) {
                        operatorObj.presence = 'ringing';
                        operatorObj.ringingCaller = `📤 ${callerNum}`;
                        operatorObj.talkingSince = null;
                    } else {
                        operatorObj.presence = 'talking';
                        operatorObj.ringingCaller = null;
                        operatorObj.ringingSince = null;
                    }
                    this.operators.set(opId, operatorObj);
                }
            }

            const durSec = parseDurationSec(duration);
            let convStartTime = (pairedChan && (pairedChan.chan.answeredTime || pairedChan.chan.startTime)) || opData.chan.answeredTime || opData.chan.startTime;
            if (!convStartTime) {
                if (durSec > 0) {
                    convStartTime = new Date(Date.now() - durSec * 1000);
                } else if (opObj && opObj.talkingSince) {
                    convStartTime = new Date(opObj.talkingSince);
                } else {
                    convStartTime = new Date();
                }
            }

            talkingConversations.push({
                key: `TALK_${opId}`,
                callerId: callerNum,
                operator: opDisplay,
                operatorExten: opId,
                state: convState,
                stateType: stateType,
                direction: isOutbound ? 'outbound' : 'inbound',
                channel: channelToUse,
                startTime: convStartTime,
                duration: duration
            });
        }

        // 3. NAVBATDA KUTAYOTGANLAR (Queue Waiting List)
        // Faqat haqiqiy Asterisk Queue (this.queues) navbatidagi mijozlar:
        const seenWaitingCallers = new Set();

        for (const [qName, qData] of this.queues.entries()) {
            if (qData && qData.callersWaiting && qData.callersWaiting.length > 0) {
                for (const waiter of qData.callersWaiting) {
                    const cNum = waiter.callerId || 'Navbatdagi mijoz';
                    const key = waiter.channel || cNum;
                    if (!seenWaitingCallers.has(key)) {
                        seenWaitingCallers.add(key);
                        if (waiter.channel) usedExtChannels.add(waiter.channel);
                        queueCallers.push({
                            callerId: cNum,
                            position: waiter.position || (queueCallers.length + 1),
                            channel: waiter.channel || '',
                            waitSec: waiter.waitSec || 0,
                            queueName: qName || 'Asosiy Navbat'
                        });
                    }
                }
            }
        }

        // Qo'shimcha: Faqat haqiqiy kiruvchi navbatda turgan kanallarni olish
        for (const ec of externalChannels) {
            if (usedExtChannels.has(ec.chanId)) continue;

            // QAT'IY QOIDA: Chiquvchi (outbound) qo'ng'iroqlar, operator tergan raqamlar yoki operatorga
            // bog'langan kanallar HECH QACHON NAVBATGA KIRMAYDI!
            if (ec.chan.direction === 'outbound') continue;
            if (ec.op || this.channelToOperator.has(ec.chanId)) continue;
            if (Array.from(this.operatorOutboundCalls.values()).some(o => o.channel === ec.chanId || o.destChannel === ec.chanId)) continue;

            const ctx = (ec.chan.context || '').toLowerCase();
            if (ctx.includes('from-internal') || ctx.includes('out') || ctx.includes('dialout')) continue;

            // Faqat va faqat navbat dasturidagi (Queue / ext-queues / from-trunk) kanallar:
            const app = (ec.chan.application || '').toLowerCase();
            const ext = String(ec.chan.extension || '');
            const isQueueCall = ctx.includes('queue') || ctx.includes('from-trunk') || ctx.includes('ivr') || app.includes('queue') || ext === '2020159';
            if (!isQueueCall) continue;

            const caller = this.extractCallerNumber(ec.chan.callerId, ec.chan.callerName, ec.chanId);
            const key = ec.chanId || caller;
            if (!seenWaitingCallers.has(key)) {
                seenWaitingCallers.add(key);
                queueCallers.push({
                    callerId: caller !== 'Yashirin raqam (Hidden)' ? caller : (ec.chan.callerId || 'Navbatdagi mijoz'),
                    position: queueCallers.length + 1,
                    channel: ec.chanId,
                    waitSec: 0,
                    queueName: 'Asosiy Navbat'
                });
            }
        }

        // 1. Faol suhbatlar
        this.activeConversations = new Map(talkingConversations.map(c => [c.key, c]));
        this.broadcast('active_conversations_update', talkingConversations);

        // 2. Navbatda kutayotganlar
        this.queueWaitingList = queueCallers;
        this.broadcast('queue_update', this.getQueueSummaryList());
        this.broadcast('stats_update', this.getSummaryStats());
        this.broadcast('operators_update', this.getOperatorList());
        this.broadcast('callbacks_update', this.getCallbacksWithActiveCalls());
    }

    ensureOperatorExists(operatorId) {
        if (!operatorId) return;
        const id = String(operatorId);
        const excluded = issabelDbService.getExcludedOperators();
        if (excluded && excluded.has(id)) return;

        const realName = issabelDbService.getOperatorName(id);
        const displayName = realName && realName !== `Operator ${id}` ? `${realName} (${id})` : `Operator ${id}`;

        if (!this.operators.has(id)) {
            const todayRejects = dbService.getTodayOperatorRejects();
            const todayMissed = dbService.getTodayOperatorMissed();
            const initDenied = todayRejects[id] || 0;
            const initMissed = todayMissed[id] || 0;
            this.operators.set(id, {
                id: id,
                name: displayName,
                realName: realName,
                presence: 'offline', // Default to offline until Asterisk PeerEntry or QueueMember confirms status
                ip: '',
                latency: '',
                totalCalls: initDenied,
                answered: 0,
                callsTaken: 0,
                lastCall: 0,
                clientHangup: 0,
                operatorHangup: 0,
                denied: initDenied,
                missed: initMissed,
                transferredOut: 0,
                transferredIn: 0,
                transferResolved: 0,
                totalDurationSec: 0,
                avgDurationSec: 0,
                ringingCaller: null,
                ringingSince: null,
                talkingSince: null,
                paused: false
            });
        }
    }

    getOperatorList() {
        // Hozirgi faol suhbatlarni tekshirib, gaplashayotgan operatorlarni 'talking' deb belgilash
        // MUHIM: Local/ kanallar (masalan: Local/103@from-queue...;1) Asterisk navbatining ichki kanallari bo'lib,
        // qo'ng'iroq boshqa operatorga (masalan 101 ga) transfer qilinganda ham Asteriskda eski operator
        // nomidagi Local/ kanali saqlanib turadi. Haqiqiy jismoniy suhbat faqat operatorning SIP/PJSIP kanalida bo'ladi!
        const activeOpIds = new Set();
        // 1. Faol suhbatdagi operatorlarni to'g'ridan-to'g'ri activeConversations dan olamiz
        if (this.activeConversations) {
            for (const conv of this.activeConversations.values()) {
                if (conv.operatorExten && conv.stateType === 'talking') {
                    activeOpIds.add(String(conv.operatorExten));
                }
            }
        }
        // 2. Faqat operatorning bevosita o'z SIP telefoni kanali Up bo'lganlarni qo'shamiz (trunk/local/tashqi kanallar operator hisoblanmaydi)
        for (const [chanId, chan] of this.activeChannels.entries()) {
            if (chanId.startsWith('Local/')) continue;
            const isDirectOpPhone = /^P?J?SIP\/(1\d\d|2\d\d|4\d\d)[-_]/i.test(chanId);
            if (!isDirectOpPhone) continue;

            const op = this.extractOperatorExten(chanId);
            if (op && (chan.state.toLowerCase().includes('up') || chan.state.toLowerCase().includes('talk'))) {
                activeOpIds.add(String(op));
            }
        }

        const excluded = issabelDbService.getExcludedOperators();
        const weight = { 'ringing': 1, 'ready': 2, 'talking': 3, 'paused': 4, 'offline': 5 };
        const todayRejects = dbService.getTodayOperatorRejects();
        const todayMissed = dbService.getTodayOperatorMissed();
        const todayAgentStats = dbService.getTodayAgentOperatorStats();

        return Array.from(this.operators.values())
            .filter(op => !excluded.has(String(op.id)))
            .map(op => {
                const copy = { ...op };
                const agentOp = todayAgentStats[op.id];
                const agentOutbound = agentOp ? (agentOp.outbound || 0) : 0;
                copy.outbound = Math.max(op.outbound || 0, agentOutbound);
                copy.transferredOut = op.transferredOut || 0;
                copy.transferredIn = op.transferredIn || 0;
                copy.transferResolved = op.transferResolved || 0;
                // Jami = kiruvchi hal qilingan (answered) + chiquvchi + transfer oxirida hal qilgan (+1)
                copy.grandTotal = (copy.answered || 0) + (copy.outbound || 0) + (copy.transferResolved || 0);
                copy.denied = todayRejects[op.id] || 0;
                copy.missed = todayMissed[op.id] || 0;
                copy.totalCalls = (copy.answered || 0) + copy.outbound + copy.denied;

                const agentDur = agentOp ? (agentOp.totalDurationSec || 0) : 0;
                copy.totalDurationSec = Math.max(op.totalDurationSec || 0, agentDur);
                const spoken = (copy.answered || 0) + copy.outbound + (copy.transferResolved || 0);
                copy.avgDurationSec = spoken > 0 ? Math.round(copy.totalDurationSec / spoken) : 0;

                const realName = op.id === '114' ? 'Maxmudbek' : (issabelDbService.getOperatorName(op.id) || op.realName || `Operator ${op.id}`);
                copy.realName = realName;
                copy.name = realName && realName !== `Operator ${op.id}` ? `${realName} (${op.id})` : `Operator ${op.id}`;
                
                // 3CX Desktop Agent holati (oxirgi 38 soniyada ping kelganmi - 30s interval + 8s bufer)
                const isAgentActive = !!(op.lastAgentPing && (Date.now() - op.lastAgentPing < 38000));
                copy.agentConnected = isAgentActive;
                copy.agentHostname  = op.agentHostname || '';
                copy.lastAgentPing  = op.lastAgentPing || null;

                const hasValidIp = copy.ip && copy.ip !== '-none-' && copy.ip !== '' && copy.ip !== '(null)' && !String(copy.latency || '').toUpperCase().includes('UNREACHABLE');

                if (!hasValidIp) {
                    // Agar Asteriskda SIP IP registratsiya bo'lmagan bo'lsa (3CX o'chiq) - operator mutlaqo offline!
                    copy.presence = 'offline';
                    copy.ringingCaller = null;
                    copy.talkingSince = null;
                    op.talkingSince = null;
                } else if (activeOpIds.has(String(op.id))) {
                    copy.presence = 'talking';
                    copy.ringingCaller = null;
                    if (!op.talkingSince) {
                        const activeConv = Array.from(this.activeConversations.values()).find(c => String(c.operatorExten) === String(op.id));
                        if (activeConv && activeConv.startTime) {
                            op.talkingSince = new Date(activeConv.startTime).getTime();
                        } else {
                            op.talkingSince = Date.now();
                        }
                    }
                    copy.talkingSince = op.talkingSince;
                } else if (op.paused || copy.presence === 'paused') {
                    copy.presence = 'paused';
                    copy.ringingCaller = null;
                    copy.ringingSince = null;
                    op.ringingCaller = null;
                    op.ringingSince = null;
                    copy.talkingSince = null;
                    op.talkingSince = null;
                } else {
                    // Agar faol suhbatda bo'lmasa va pauzada bo'lmasa:
                    let isReallyRinging = false;
                    const ringExpired = op.ringingSince && (Date.now() - op.ringingSince > 60000);

                    if (copy.presence === 'ringing' && !ringExpired) {
                        for (const [chanId, ch] of this.activeChannels.entries()) {
                            if (chanId.startsWith('Local/')) continue;
                            const chOp = this.extractOperatorExten(ch.operator, ch.extension, ch.callerId, chanId) || this.channelToOperator.get(chanId);
                            if (String(chOp) === String(op.id)) {
                                const isUp = ch.state.toLowerCase().includes('up') || ch.state.toLowerCase().includes('talk') || ch.state === '6';
                                if (!isUp) {
                                    isReallyRinging = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (isReallyRinging) {
                        copy.presence = 'ringing';
                    } else {
                        copy.presence = 'ready';
                        copy.ringingCaller = null;
                        copy.ringingSince = null;
                        op.ringingCaller = null;
                        op.ringingSince = null;
                    }
                    copy.talkingSince = null;
                    op.talkingSince = null;
                }
                copy.paused = !!op.paused;
                copy.callsTaken = this.getEffectiveCallsTaken(copy);
                copy.callsTakenOverride = this.manualCallsTakenOverrides[String(op.id)] || 0;
                copy.queueDbSync = this.queueDbSyncEnabled;
                copy.lastCall = (op.lastCall !== undefined && op.lastCall !== null) ? Number(op.lastCall) : 0;
                return copy;
            }).sort((a, b) => {
                const wA = weight[a.presence] || 5;
                const wB = weight[b.presence] || 5;
                if (wA !== wB) return wA - wB;
                return Number(a.id) - Number(b.id);
            });
    }

    /**
     * DB sinxronizatsiya sozlamalarini fayldan o'qish
     */
    loadQueueDbSyncSettings() {
        try {
            const p = path.join(__dirname, '..', 'data', 'queue-sync-settings.json');
            if (fs.existsSync(p)) {
                const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (raw && raw.enabled !== undefined) {
                    return Boolean(raw.enabled);
                }
            }
        } catch (e) {
            console.error('⚠️ [AMI RAM] queue-sync-settings.json o\'qishda xato:', e.message);
        }
        return true; // Standart holatda YOQILGAN bo'lsin
    }

    /**
     * DB sinxronizatsiya sozlamalarini faylga yozish
     */
    saveQueueDbSyncSettings() {
        try {
            const dir = path.join(__dirname, '..', 'data');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'queue-sync-settings.json'), JSON.stringify({
                enabled: this.queueDbSyncEnabled,
                mode: 'grandTotal',
                updatedAt: new Date().toISOString()
            }, null, 2));
        } catch (e) {
            console.error('⚠️ [AMI RAM] queue-sync-settings.json saqlashda xato:', e.message);
        }
    }

    setQueueDbSyncEnabled(enabled) {
        this.queueDbSyncEnabled = Boolean(enabled);
        this.saveQueueDbSyncSettings();
        console.log(`📊 [AMI RAM] DB sinxronizatsiyasi: ${this.queueDbSyncEnabled ? 'YOQILDI (ON)' : 'O\'CHIRILDI (OFF)'}`);
        this.broadcast('operators_update', this.getOperatorList());
        return this.queueDbSyncEnabled;
    }

    /**
     * Toshkent vaqti bilan joriy sanani olish (YYYY-MM-DD)
     */
    getTashkentTodayDate() {
        try {
            return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tashkent' });
        } catch (e) {
            return new Date().toISOString().slice(0, 10);
        }
    }

    /**
     * Soat 00:00 da (yangi kun boshlanganda) navbat hisoblagichlarini nollash
     */
    checkMidnightRollover() {
        const today = this.getTashkentTodayDate();
        if (this.currentTrackingDate && this.currentTrackingDate !== today) {
            console.log(`🌙 [MIDNIGHT ROLLOVER] Yangi kun boshlandi (${this.currentTrackingDate} ➔ ${today})! Navbat hisoblagichlari 0 ga nollanmoqda...`);
            this.currentTrackingDate = today;

            // 1. Kechagi qo'lda belgilangan ofsetlarni tozalash
            this.manualCallsTakenOverrides = {};
            this.saveCallsTakenOverrides();

            // 2. Operatorlarning xotiradagi sonlarini nollash
            for (const op of this.operators.values()) {
                op.answered = 0;
                op.outbound = 0;
                op.transferredOut = 0;
                op.transferredIn = 0;
                op.transferResolved = 0;
                op.totalCalls = 0;
                op.callsTaken = 0;
                op.totalDurationSec = 0;
            }

            // 3. Asterisk navbat statistikasini ham nollash (queue reset stats)
            this.resetAsteriskQueueStats();

            // 4. Ekranga nollangan holatni tarqatish
            this.broadcast('operators_update', this.getOperatorList());
        }
    }

    /**
     * Asterisk navbatidagi xom statistikani nollash (CLI / AMI orqali)
     */
    resetAsteriskQueueStats() {
        try {
            if (this.ami && typeof this.ami.action === 'function') {
                this.ami.action({
                    Action: 'Command',
                    Command: 'queue reset stats'
                }, (err, res) => {
                    if (err) console.warn('⚠️ [AMI] queue reset stats xatolik:', err.message);
                    else console.log('✅ [AMI] Asterisk navbat statistikasi 0 ga nollendi');
                });
            }
        } catch (e) {
            console.warn('⚠️ [AMI] resetAsteriskQueueStats xatolik:', e.message);
        }
    }

    /**
     * Hozirning o'zida barcha operatorlarni DB dagi Jami sonlar bilan sinxronlash
     */
    syncAllFromDbNow() {
        const todayAgentStats = dbService.getTodayAgentOperatorStats();
        for (const [id, op] of this.operators.entries()) {
            const agentOp = todayAgentStats[id];
            const outbound = Math.max(op.outbound || 0, agentOp ? (agentOp.outbound || 0) : 0);
            const transferResolved = op.transferResolved || 0;
            const dbTotal = (Number(op.answered) || 0) + outbound + transferResolved;
            const base = (op.callsTaken !== undefined && op.callsTaken !== null) ? Number(op.callsTaken) : 0;
            this.manualCallsTakenOverrides[id] = dbTotal - base;
        }
        this.saveCallsTakenOverrides();
        console.log(`📊 [AMI RAM] Barcha operatorlar DB dagi Jami sonlar bilan bir martalik sinxronlandi.`);
        this.broadcast('operators_update', this.getOperatorList());
        return this.getOperatorList();
    }

    /**
     * Qo'lda belgilangan callsTaken ofsetlarini fayldan o'qish (server qayta ishga tushganda saqlanib qolishi uchun)
     */
    loadCallsTakenOverrides() {
        try {
            const p = path.join(__dirname, '..', 'data', 'calls-taken-overrides.json');
            if (fs.existsSync(p)) {
                const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
                const out = {};
                for (const [id, v] of Object.entries(raw || {})) {
                    const n = parseInt(v, 10);
                    if (!isNaN(n)) out[String(id)] = n;
                }
                if (Object.keys(out).length > 0) {
                    console.log(`📊 [AMI RAM] ${Object.keys(out).length} ta operator uchun qo'lda belgilangan callsTaken ofsetlari tiklandi:`, out);
                }
                return out;
            }
        } catch (e) {
            console.error('⚠️ [AMI RAM] callsTaken ofsetlarini o\'qishda xato:', e.message);
        }
        return {};
    }

    saveCallsTakenOverrides() {
        try {
            const dir = path.join(__dirname, '..', 'data');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'calls-taken-overrides.json'), JSON.stringify(this.manualCallsTakenOverrides, null, 2));
        } catch (e) {
            console.error('⚠️ [AMI RAM] callsTaken ofsetlarini saqlashda xato:', e.message);
        }
    }

    /**
     * Ko'rsatiladigan (samarali) callsTaken:
     * - Agar DB sinxronizatsiyasi YOQILGAN bo'lsa: bugungi bazadagi JAMI (answered + outbound + transfer) + ofset
     * - Agar DB sinxronizatsiyasi O'CHIQLIGI bo'lsa: Asterisk xom qiymati + ofset
     */
    getEffectiveCallsTaken(op) {
        if (!op) return 0;
        const id = String(op.id);
        const manualOffset = this.manualCallsTakenOverrides[id] || 0;

        if (this.queueDbSyncEnabled) {
            // DB dagi bugungi JAMI qo'ng'iroqlar:
            // Qabul qilingan (answered) + Chiquvchi (outbound) + Transfer oxirida hal qilgan (transferResolved)
            const dbTotal = (op.grandTotal !== undefined && op.grandTotal !== null)
                ? Number(op.grandTotal)
                : ((Number(op.answered) || 0) + (Number(op.outbound) || 0) + (Number(op.transferResolved) || 0));
            return Math.max(0, dbTotal + manualOffset);
        }

        const base = (op.callsTaken !== undefined && op.callsTaken !== null) ? Number(op.callsTaken) : 0;
        return (this.manualCallsTakenOverrides[id] !== undefined)
            ? Math.max(0, base + manualOffset)
            : base;
    }

    /**
     * Operator uchun qo'lda belgilangan ofsetni to'liq bekor qilish — bazaviy hisobga qaytish
     */
    clearCallsTakenOverride(operatorId) {
        if (!operatorId) return null;
        const id = String(operatorId);
        this.ensureOperatorExists(id);
        const op = this.operators.get(id);
        if (!op) return null;
        const had = this.manualCallsTakenOverrides[id];
        delete this.manualCallsTakenOverrides[id];
        if (had !== undefined) this.saveCallsTakenOverrides();
        console.log(`📊 [AMI RAM] Operator ${op.name} (${id}) qo'lda belgilangan callsTaken ofseti bekor qilindi (avvalgi: ${had || 0})`);
        this.broadcast('operators_update', this.getOperatorList());
        return {
            id: op.id,
            name: op.name,
            callsTaken: this.getEffectiveCallsTaken(op),
            callsTakenOverride: 0,
            presence: op.presence
        };
    }

    /**
     * Asterisk navbatidagi (fewestcalls) operator callsTaken sonini qo'lda o'zgartirish (+1, -1 yoki aniq qiymat).
     */
    adjustOperatorCallsTaken(operatorId, delta = 1, absoluteValue = null) {
        if (!operatorId) return null;
        const id = String(operatorId);
        this.ensureOperatorExists(id);
        const op = this.operators.get(id);
        if (!op) return null;

        // Baza sifatida: agar DB sinxron bo'lsa DB jami, aks holda Asterisk callsTaken
        let base;
        if (this.queueDbSyncEnabled) {
            const todayAgentStats = dbService.getTodayAgentOperatorStats();
            const agentOp = todayAgentStats[id];
            const outbound = Math.max(op.outbound || 0, agentOp ? (agentOp.outbound || 0) : 0);
            const transferResolved = op.transferResolved || 0;
            base = (Number(op.answered) || 0) + outbound + transferResolved;
        } else {
            base = (op.callsTaken !== undefined && op.callsTaken !== null) ? Number(op.callsTaken) : 0;
        }

        let target;
        if (absoluteValue !== null && !isNaN(Number(absoluteValue))) {
            target = Math.max(0, parseInt(absoluteValue, 10));
        } else {
            const current = this.getEffectiveCallsTaken({ ...op, grandTotal: base });
            target = Math.max(0, current + Number(delta));
        }

        const offset = target - base;
        if (offset === 0) {
            delete this.manualCallsTakenOverrides[id];
        } else {
            this.manualCallsTakenOverrides[id] = offset;
        }
        this.saveCallsTakenOverrides();

        console.log(`📊 [AMI RAM] Operator ${op.name} (${id}) callsTaken: ${base} → ${target} (baza: ${base}, ofset: ${this.manualCallsTakenOverrides[id] || 0}, sync: ${this.queueDbSyncEnabled ? 'DB' : 'Asterisk'})`);
        this.broadcast('operators_update', this.getOperatorList());
        return {
            id: op.id,
            name: op.name,
            callsTaken: this.getEffectiveCallsTaken({ ...op, grandTotal: base }),
            callsTakenOverride: this.manualCallsTakenOverrides[id] || 0,
            presence: op.presence
        };
    }

    registerOperatorCall(operatorId, answered, durationSec, hangupParty = 'Mijoz') {
        if (!operatorId) return;
        const id = String(operatorId);
        this.ensureOperatorExists(id);

        const op = this.operators.get(id);
        op.totalCalls++;
        if (answered) {
            op.answered++;
            op.totalDurationSec += durationSec;
            op.avgDurationSec = Math.round(op.totalDurationSec / op.answered);
            if (hangupParty === 'Operator') {
                op.operatorHangup++;
            } else {
                op.clientHangup++;
            }
        } else {
            op.denied++;
        }
        this.operators.set(id, op);
    }

    transferCall(channel, targetExten, callback) {
        if (!this.ami || !this.isConnected) {
            return callback(new Error('AMI server bilan aloqa yo\'q'));
        }

        console.log(`🔀 Qo'ng'iroq yo'naltirilmoqda: Kanal [${channel}] -> Operator [${targetExten}]`);
        this.ami.action({
            action: 'Redirect',
            channel: channel,
            exten: String(targetExten),
            context: 'from-internal',
            priority: 1
        }, callback);
    }

    broadcast(type, data) {
        if (this.wsBroadcastCallback) {
            this.wsBroadcastCallback({ type, data, timestamp: new Date().toISOString() });
        }
    }

    getSummaryStats() {
        const defaultLabels = [];
        for (let h = 8; h <= 21; h++) {
            defaultLabels.push(`${String(h).padStart(2, '0')}:00`);
        }

        const dbSummary = issabelDbService.cache && issabelDbService.cache.summary;
        const total = dbSummary ? dbSummary.totalCalls : (this.stats.totalCalls || 0);
        const inbound = dbSummary ? dbSummary.inboundCalls : (this.stats.inboundCalls || Math.round(total / 2));
        const outbound = dbSummary ? dbSummary.outboundCalls : (this.stats.outboundCalls || 0);
        const answered = dbSummary ? dbSummary.answeredCalls : (this.stats.answeredCalls || 0);
        const abandoned = dbSummary ? dbSummary.abandonedCalls : (this.stats.abandonedCalls || 0);

        const { pendingCount, resolvedCount } = dbService.getAbandonedBreakdown('today');
        const totalCb = pendingCount + resolvedCount;
        let abandonedPending = 0;
        let abandonedResolved = 0;
        if (totalCb > 0 && abandoned > 0) {
            abandonedPending = Math.round(abandoned * (pendingCount / totalCb));
            abandonedResolved = abandoned - abandonedPending;
        } else {
            abandonedPending = abandoned;
            abandonedResolved = 0;
        }

        const todayRejects = dbService.getTodayOperatorRejects();
        const totalOpRejects = Object.values(todayRejects).reduce((sum, v) => sum + v, 0);
        const denied = totalOpRejects;

        const todayMissed = dbService.getTodayOperatorMissed();
        const totalOpMissed = Object.values(todayMissed).reduce((sum, v) => sum + v, 0);
        const missed = totalOpMissed;

        return {
            totalCalls: total,
            inboundCalls: inbound,
            outboundCalls: outbound,
            answeredCalls: answered,
            abandonedCalls: abandoned,
            abandonedPendingCalls: abandonedPending,
            abandonedResolvedCalls: abandonedResolved,
            callbacksPendingCount: pendingCount,
            callbacksResolvedCount: resolvedCount,
            deniedCalls: denied,
            missedCalls: missed,
            clientHangupCalls: this.stats.clientHangupCalls,
            operatorHangupCalls: this.stats.operatorHangupCalls,
            answerRate: total > 0 ? Math.round((answered / total) * 100) : 0,
            abandonedRate: inbound > 0 ? Math.round((abandoned / inbound) * 100) : 0,
            outboundRate: total > 0 ? Math.round((outbound / total) * 100) : 0,
            denyRate: total > 0 ? Math.round((denied / total) * 100) : 0,
            missedRate: total > 0 ? Math.round((missed / total) * 100) : 0,
            totalDurationSec: dbSummary ? dbSummary.totalDurationSec : this.stats.totalDurationSec,
            activeCount: this.activeChannels.size,
            operatorCount: this.operators.size,
            queueWaitingTotal: (this.queueWaitingList && this.queueWaitingList.length) || 0,
            hourlyChart: (issabelDbService.cache && issabelDbService.cache.hourly) || this.hourlyChartData || {
                labels: defaultLabels,
                inbound: new Array(14).fill(0),
                answered: new Array(14).fill(0)
            }
        };
    }

    getQueueSummaryList() {
        if (this.queueWaitingList && this.queueWaitingList.length > 0) {
            return [{
                name: 'Asosiy Navbat',
                callsWaitingCount: this.queueWaitingList.length,
                callersWaiting: this.queueWaitingList
            }];
        }
        return Array.from(this.queues.values());
    }

    getActiveChannelsList() {
        return Array.from(this.activeChannels.values());
    }

    getActiveConversationsList() {
        if (!this.activeConversations) return [];
        return Array.from(this.activeConversations.values());
    }

    getCallHistory(limit = 100) {
        return this.callHistory.slice(0, limit);
    }

    getCallHistoryPaginated(page = 1, limit = 20, search = '') {
        return dbService.getCallsPaginated(page, limit, search);
    }

    /**
     * 3CX Desktop Agent ping vaqtlarini har 3 soniyada tekshirish (Timeout Watchdog).
     * Agar operator 38 soniya davomida ping yubormagan bo'lsa, darhol O'chiq (Offline) qiladi
     * va brauzerlarga jonli yangilanishni (WebSocket broadcast) tarqatadi.
     */
    checkAgentTimeouts() {
        let stateChanged = false;
        const now = Date.now();
        const TIMEOUT_MS = 38000; // Agent har 30s da ping jo'natadi, 38s - eng optimal tezkor chegara
        const STALE_RINGING_MS = 45000; // Haqiqiy jiringlash odatda bundan uzoq davom etmaydi

        for (const [opId, op] of this.operators.entries()) {
            const isPingActive = !!(op.lastAgentPing && (now - op.lastAgentPing < TIMEOUT_MS));
            if (op.agentConnected && !isPingActive) {
                op.agentConnected = false;
                stateChanged = true;
                const secAgo = Math.round((now - (op.lastAgentPing || now)) / 1000);
                console.log(`🔴 [3CX Desktop Agent] Operator ${opId} (${op.realName || ''}) ping to'xtadi (${secAgo}s oldin) -> O'chiq (Offline)`);
            } else if (!op.agentConnected && isPingActive) {
                op.agentConnected = true;
                stateChanged = true;
            }

            // Xavfsizlik tarmog'i: agar biror sabab bilan "Jiringlamoqda" holatini
            // tozalovchi AMI hodisasi (AgentRingNoAnswer/DialEnd/QueueCallerAbandon...)
            // kelmay qolsa, karta cheksiz "jiringlab" qolib ketmasligi uchun 45 soniyadan
            // keyin avtomatik tozalanadi.
            if (op.presence === 'ringing' && op.ringingSince && (now - op.ringingSince > STALE_RINGING_MS)) {
                op.presence = 'ready';
                op.ringingCaller = null;
                op.ringingSince = null;
                stateChanged = true;
                console.log(`⚠️ Operator ${opId} (${op.realName || ''}) "Jiringlamoqda" holati ${Math.round(STALE_RINGING_MS/1000)}s dan beri yangilanmadi -> avtomatik tozalandi`);
            }
        }

        if (stateChanged) {
            this.broadcast('operators_update', this.getOperatorList());
            if (typeof this.onAgentStateChange === 'function') {
                this.onAgentStateChange();
            }
        }
    }
}

module.exports = new AmiService();
