const AsteriskManager = require('asterisk-manager');
const config = require('../config');
const dbService = require('./dbService');
const issabelDbService = require('./issabelDbService');

class AmiService {
    constructor() {
        this.ami = null;
        this.isConnected = false;
        
        // Asosiy ma'lumotlar ombori
        this.activeChannels = new Map();     // channelId -> channelInfo
        this.activeConversations = new Map(); // conversationKey -> { callerId, operator, state, startTime, duration, channel }
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

        // Bazadagi bugungi statistikani yuklash
        try {
            const dbSummary = dbService.getTodaySummary();
            if (dbSummary && dbSummary.totalCalls > 0) {
                this.stats.totalCalls = dbSummary.totalCalls || 0;
                this.stats.inboundCalls = dbSummary.inboundCalls || 0;
                this.stats.outboundCalls = dbSummary.outboundCalls || 0;
                this.stats.answeredCalls = dbSummary.answeredCalls || 0;
                this.stats.clientHangupCalls = dbSummary.clientHangupCalls || 0;
                this.stats.operatorHangupCalls = dbSummary.operatorHangupCalls || 0;
                this.stats.deniedCalls = dbSummary.deniedCalls || 0;
                this.stats.totalDurationSec = dbSummary.totalDurationSec || 0;
            }
        } catch (e) {}

        // Issabel MariaDB bilan sinxronizatsiyani ishga tushirish
        setTimeout(() => this.syncIssabelData(), 1000);
        setInterval(() => this.syncIssabelData(), 30000);
    }

    async syncIssabelData() {
        try {
            await issabelDbService.fetchOperatorNames();
            const [stats, hourly, summary] = await Promise.all([
                issabelDbService.fetchTodayOperatorStats(),
                issabelDbService.fetchTodayHourlyStats(),
                issabelDbService.fetchTodaySummary()
            ]);
            
            const todayRejects = dbService.getTodayOperatorRejects();
            const todayMissed = dbService.getTodayOperatorMissed();
            for (const st of stats) {
                this.ensureOperatorExists(st.id);
                const op = this.operators.get(st.id);
                op.name = st.name;
                op.realName = st.realName;
                op.answered = st.answered;
                const dbDenied = todayRejects[st.id] !== undefined ? todayRejects[st.id] : (st.denied || 0);
                op.denied = Math.max(op.denied || 0, dbDenied);
                op.missed = todayMissed[st.id] || op.missed || 0;
                op.totalCalls = op.answered + op.denied;
                op.totalDurationSec = st.totalDurationSec;
                op.avgDurationSec = st.avgDurationSec;
                this.operators.set(st.id, op);
            }

            if (hourly) {
                this.hourlyChartData = hourly;
            }

            if (summary) {
                this.stats.totalCalls = summary.totalCalls;
                this.stats.inboundCalls = summary.inboundCalls;
                this.stats.answeredCalls = summary.answeredCalls;
                this.stats.abandonedCalls = summary.abandonedCalls;
                this.stats.deniedCalls = summary.deniedCalls;
                this.stats.totalDurationSec = summary.totalDurationSec;
            }

            this.broadcast('operators_update', this.getOperatorList());
            this.broadcast('stats_update', this.getSummaryStats());
        } catch (err) {
            console.error('syncIssabelData xatolik:', err.message);
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
    extractCallerNumber(num, name, channel) {
        const candidates = [num, name, channel];
        for (const c of candidates) {
            if (!c) continue;
            const str = String(c);
            // 7 dan 13 tagacha raqam bo'lsa - bu tashqi mijoz raqami
            const m = str.match(/(?:998)?(\d{7,12})/);
            if (m && m[1].length >= 7 && !m[1].startsWith('000')) {
                return m[0];
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
                if (isOnline) {
                    if (op.presence !== 'talking') {
                        op.presence = 'ready'; // On-hook, qo'ng'iroq kutmoqda
                    }
                } else {
                    op.presence = 'offline'; // 3CX yoki softphone ulanmagan
                }
                op.ip = ip;
                op.latency = latency;
                this.operators.set(opId, op);
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
                if (status === 'registered' || status === 'reachable') {
                    if (op.presence !== 'talking') op.presence = 'ready';
                } else if (status === 'unregistered' || status === 'unreachable') {
                    op.presence = 'offline';
                }
                this.operators.set(opId, op);
                this.broadcast('operators_update', this.getOperatorList());
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
                const memberStatus = parseInt(evt.status || '0', 10);
                const paused = parseInt(evt.paused || '0', 10);

                if (paused === 1) {
                    op.presence = 'paused'; // Tanaffusda
                } else if (memberStatus === 1) {
                    op.presence = 'ready';  // On-hook / Bo'sh / Qo'ng'iroq kutmoqda
                } else if (memberStatus === 2 || memberStatus === 3) {
                    op.presence = 'talking'; // Suhbatda / In use
                } else if (memberStatus === 4 || memberStatus === 5) {
                    op.presence = 'offline'; // Ulanmagan / Offline
                } else if (memberStatus === 6) {
                    op.presence = 'ringing'; // Telefon chalinmoqda
                }
                this.operators.set(opId, op);

                if (this.queues.has(qName)) {
                    const q = this.queues.get(qName);
                    if (!q.agents.includes(opId)) q.agents.push(opId);
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
                const status = parseInt(evt.status || '0', 10);
                if (status === 0) op.presence = 'ready'; // Idle / On-hook
                else if (status === 1) op.presence = 'talking'; // In use
                else if (status === 8) op.presence = 'ringing';
                else if (status === 4 || status === -1) op.presence = 'offline';
                this.operators.set(opId, op);
                this.broadcast('operators_update', this.getOperatorList());
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
            const qName = evt.queue;
            const callerId = evt.calleridnum || 'Mijoz';
            if (this.queues.has(qName)) {
                const q = this.queues.get(qName);
                q.callersWaiting.push({
                    callerId,
                    position: evt.position || (q.callersWaiting.length + 1),
                    waitSec: 0,
                    channel: evt.channel,
                    joinTime: now
                });
                this.broadcast('queue_update', this.getQueueSummaryList());
            }
        }

        // Navbatdan mijoz chiqib ketdi / bog'landi
        if (evt.event === 'QueueCallerLeave') {
            const qName = evt.queue;
            if (this.queues.has(qName)) {
                const q = this.queues.get(qName);
                q.callersWaiting = q.callersWaiting.filter(c => c.channel !== evt.channel);
                this.broadcast('queue_update', this.getQueueSummaryList());
            }
        }

        // Navbatda kutolmay qo'yib yubordi (Abandon)
        if (evt.event === 'QueueCallerAbandon') {
            this.stats.queueAbandonedCalls++;
            // deniedCalls bu yerda oshirilmaydi - abandoned != denied
            this.broadcast('stats_update', this.getSummaryStats());
        }

        // DialBegin / DialState / DialEnd - Operatorga qo'ng'iroq ulanganda
        if (evt.event === 'DialBegin' || evt.event === 'DialState' || evt.event === 'DialEnd') {
            const opId = this.extractOperatorExten(evt.destchannel, evt.connectedlinenum, evt.destcalleridnum, evt.dialstring);
            if (opId) {
                if (evt.channel) this.channelToOperator.set(evt.channel, opId);
                if (evt.destchannel) this.channelToOperator.set(evt.destchannel, opId);
                if (evt.uniqueid) this.channelToOperator.set(evt.uniqueid, opId);
                if (evt.destuniqueid) this.channelToOperator.set(evt.destuniqueid, opId);
            }
        }

        // ⛔ AMI orqali BUSY ni rad etish (Reject) yoki QueueMemberRingNoAnswer ni o'tkazib yuborilgan (Missed) deb hisoblash xato:
        // Navbat (Queue) boshqa operatorlarga navbat bilan qo'ng'iroq uzatayotganda (rrmemory),
        // liniya band bo'lsa yoki navbat aylanayotganda Asterisk avtomatik BUSY va RingNoAnswer hodisalarini hosil qiladi
        // (operatorlar umuman ko'rmagan bo'lsa ham yoki 3CX ulanmagan bo'lsa ham).
        // Shuning uchun Rad etish (Reject) va O'tkazib yuborish (Missed) faqat va faqat operator kompyuteridagi 3CX Desktop Agent orqali olinadi!

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
                if (evt.channel) this.channelToOperator.set(evt.channel, opId);
                if (evt.destchannel) this.channelToOperator.set(evt.destchannel, opId);
                this.ensureOperatorExists(opId);
                const op = this.operators.get(opId);
                op.presence = 'talking';
                op.totalCalls++;
                op.answered++;
                this.operators.set(opId, op);
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

            let hangupParty = 'Mijoz';
            if (reason === 'agent') {
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
                op.presence = 'ready';
                op.totalDurationSec += talkTime;
                op.avgDurationSec = op.answered > 0 ? Math.round(op.totalDurationSec / op.answered) : 0;
                if (hangupParty === 'Operator') {
                    op.operatorHangup++;
                } else {
                    op.clientHangup++;
                }
                this.operators.set(opId, op);
            }

            // Conversationdan o'chirish
            const key = callerId !== 'Noma\'lum' ? callerId : (opId ? `OP_${opId}` : evt.channel);
            this.activeConversations.delete(key);

            // Tarixga yozish
            const localTimeStr = now.toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
            const historyRecord = {
                id: Date.now() + Math.random().toString(36).substr(2, 4),
                channel: evt.channel,
                callerId: callerId,
                operator: opId ? `Operator ${opId}` : 'Navbat / Operator',
                operatorExten: opId || '',
                direction: 'inbound',
                status: 'ANSWERED',
                hangupParty: `${hangupParty} tugatdi`,
                duration: talkTime,
                cause: 'AgentComplete (' + (evt.reason || 'Normal') + ')',
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

        // 6. DialBegin (Navbat mijozni qaysi operatorga yo'naltirayotgani / Jiringlayotgani)
        if (evt.event === 'DialBegin') {
            const destChan = evt.destchannel || '';
            const opId = this.extractOperatorExten(destChan) || this.extractOperatorExten(evt.dialstring);
            const callerId = this.extractCallerNumber(evt.calleridnum, evt.calleridname, evt.channel);

            if (opId) {
                this.ensureOperatorExists(opId);
                this.channelToOperator.set(destChan, opId);
                if (evt.channel) this.channelToOperator.set(evt.channel, opId);

                // Ushbu operator hozir jiringlamoqda
                const op = this.operators.get(opId);
                op.ringingCaller = callerId;
                this.operators.set(opId, op);
                this.broadcast('operators_update', this.getOperatorList());
            }
        }

        // 7. DialEnd (Jiringlash tugaganda holatni tozalash)
        if (evt.event === 'DialEnd') {
            const destChan = evt.destchannel || evt.channel || '';
            const opId = this.extractOperatorExten(destChan) || this.channelToOperator.get(destChan) || this.extractOperatorExten(evt.dialstring);

            if (opId && this.operators.has(opId)) {
                const op = this.operators.get(opId);
                op.ringingCaller = null;
                this.operators.set(opId, op);
                this.broadcast('operators_update', this.getOperatorList());
            }
        }

        // 8. QueueCallerAbandon (Mijoz navbatda kutishdan bosh tortib qo'yganda)
        if (evt.event === 'QueueCallerAbandon') {
            this.stats.abandonedCalls++;
            this.broadcast('stats_update', this.getSummaryStats());
        }

        // 7. CoreShowChannel - Faol kanallarni qabul qilish
        if (evt.event === 'CoreShowChannel') {
            const channelId = evt.channel;
            const callerId = evt.calleridnum || '';
            const callerName = evt.calleridname || '';
            const exten = evt.extension || evt.context || '';
            const state = evt.channelstatedesc || evt.channelstate || 'Active';

            this.activeChannels.set(channelId, {
                channel: channelId,
                callerId: callerId,
                callerName: callerName,
                extension: exten,
                state: state,
                duration: evt.duration || '00:00:00'
            });

            const possibleOp = this.extractOperatorExten(callerId) || this.extractOperatorExten(exten) || this.extractOperatorExten(channelId);
            if (possibleOp) {
                this.ensureOperatorExists(possibleOp);
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
            const isOutbound = (evt.context && evt.context.includes('out')) || (channelId.toLowerCase().includes('out'));

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
                extension: evt.exten || evt.context || 'Linya',
                state: 'Ring',
                direction: isOutbound ? 'outbound' : 'inbound',
                startTime: now,
                answeredTime: null,
                operator: null
            });

            this.recalculateConversations();
            this.broadcast('stats_update', this.getSummaryStats());
        }

        // 9. BridgeEnter (Oddiy to'g'ridan-to'g'ri qo'ng'iroq ulanganda)
        if (evt.event === 'BridgeEnter') {
            const channelId = evt.channel;
            const rawOp = evt.connectedlinenum || evt.calleridnum || '';
            const operator = this.extractOperatorExten(rawOp) || this.extractOperatorExten(channelId);
            
            if (this.activeChannels.has(channelId)) {
                const chan = this.activeChannels.get(channelId);
                chan.state = 'Talking';
                chan.answeredTime = now;
                if (operator) chan.operator = operator;
                this.activeChannels.set(channelId, chan);
            }

            if (operator) {
                this.ensureOperatorExists(operator);
                const op = this.operators.get(operator);
                op.presence = 'talking';
                this.operators.set(operator, op);
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
            }

            this.recalculateConversations();
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
            if (chanId.startsWith('Local/') && (chanId.includes('@from-queue') || chanId.includes(';2'))) {
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

            const realOpName = issabelDbService.getOperatorName(opId);
            const opDisplay = realOpName && realOpName !== `Operator ${opId}` ? `${realOpName} (${opId})` : `Operator ${opId}`;

            talkingConversations.push({
                key: `TALK_${opId}`,
                callerId: callerNum,
                operator: opDisplay,
                operatorExten: opId,
                state: 'Suhbatda',
                stateType: 'talking',
                direction: 'inbound',
                channel: channelToUse,
                duration: duration
            });
        }

        // 3. Qolgan (hali operatorga ulanmagan) barcha tashqi kanallar -> NAVBATDA KUTAYOTGANLAR!
        for (const ec of externalChannels) {
            if (usedExtChannels.has(ec.chanId)) continue;
            
            const caller = this.extractCallerNumber(ec.chan.callerId, ec.chan.callerName, ec.chanId);
            queueCallers.push({
                callerId: caller !== 'Yashirin raqam (Hidden)' ? caller : (ec.chan.callerId || 'Navbatdagi mijoz'),
                position: queueCallers.length + 1,
                channel: ec.chanId,
                waitSec: 0,
                queueName: 'Asosiy Navbat'
            });
        }

        // 1. Faol suhbatlar
        this.activeConversations = new Map(talkingConversations.map(c => [c.key, c]));
        this.broadcast('active_conversations_update', talkingConversations);

        // 2. Navbatda kutayotganlar
        this.queueWaitingList = queueCallers;
        this.broadcast('queue_update', this.getQueueSummaryList());
        this.broadcast('stats_update', this.getSummaryStats());
        this.broadcast('operators_update', this.getOperatorList());
    }

    ensureOperatorExists(operatorId) {
        if (!operatorId) return;
        const id = String(operatorId);
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
                clientHangup: 0,
                operatorHangup: 0,
                denied: initDenied,
                missed: initMissed,
                totalDurationSec: 0,
                avgDurationSec: 0,
                ringingCaller: null
            });
        }
    }

    getOperatorList() {
        // Hozirgi faol suhbatlarni tekshirib, gaplashayotgan operatorlarni 'talking' deb belgilash
        const activeOpIds = new Set();
        for (const [chanId, chan] of this.activeChannels.entries()) {
            const op = this.extractOperatorExten(chan.operator) || this.extractOperatorExten(chan.extension) || this.extractOperatorExten(chan.callerId);
            if (op && (chan.state.toLowerCase().includes('up') || chan.state.toLowerCase().includes('talk'))) {
                activeOpIds.add(op);
            }
        }

        const excluded = issabelDbService.getExcludedOperators();
        const weight = { 'ready': 1, 'talking': 2, 'paused': 3, 'offline': 4 };
        return Array.from(this.operators.values())
            .filter(op => !excluded.has(String(op.id)))
            .map(op => {
                const copy = { ...op };
                const realName = op.id === '114' ? 'Maxmudbek' : (issabelDbService.getOperatorName(op.id) || op.realName || `Operator ${op.id}`);
                copy.realName = realName;
                copy.name = realName && realName !== `Operator ${op.id}` ? `${realName} (${op.id})` : `Operator ${op.id}`;
                
                // 3CX Desktop Agent holati (oxirgi 60 soniyada ping kelganmi)
                const isAgentActive = !!(op.lastAgentPing && (Date.now() - op.lastAgentPing < 60000));
                copy.agentConnected = isAgentActive;
                copy.agentHostname  = op.agentHostname || '';
                copy.lastAgentPing  = op.lastAgentPing || null;

                if (activeOpIds.has(op.id)) {
                    copy.presence = 'talking';
                } else if (copy.presence === 'talking') {
                    copy.presence = 'ready';
                }
                return copy;
            }).sort((a, b) => {
                const wA = weight[a.presence] || 5;
                const wB = weight[b.presence] || 5;
                if (wA !== wB) return wA - wB;
                return Number(a.id) - Number(b.id);
            });
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
            deniedCalls: denied,
            missedCalls: missed,
            clientHangupCalls: this.stats.clientHangupCalls,
            operatorHangupCalls: this.stats.operatorHangupCalls,
            answerRate: total > 0 ? Math.round((answered / total) * 100) : 0,
            abandonedRate: inbound > 0 ? Math.round((abandoned / inbound) * 100) : 0,
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
}

module.exports = new AmiService();
