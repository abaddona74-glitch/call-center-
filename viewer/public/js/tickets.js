/**
 * ============================================================================
 * TICKETS & KDS KITCHEN-STYLE MONITOR CLIENT (VIEWER PORT 3005)
 * Handles: Drag & Drop, Ctrl+V Clipboard Paste, WebSocket Real-time Sync,
 * Unpack Box Modal, Status Lifecycle (Pending -> In Progress -> Completed),
 * and Audio Chimes.
 * ============================================================================
 */

(function () {
    const state = {
        tickets: [],
        currentFilter: 'all',
        stats: { total: 0, mine: 0, pending: 0, in_progress: 0, completed: 0, rejected: 0 },
        attachedFiles: [],       // For new ticket form: [{ name, base64 }]
        replyAttachedFiles: [],  // For comment form
        activeTicket: null,
        myOperatorId: null,
        myOperatorName: null,
        ws: null,
        soundEnabled: localStorage.getItem('ticket_sound_enabled') !== 'false',
        newlyArrivedIds: new Set()
    };

    // Iconsax SVG Helper
    const ICONS = {
        clipboard: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M8 12.5H16"/><path d="M8 16.5H13"/><path d="M10 6H14C16 6 16 5 16 4C16 2 15 2 14 2H10C9 2 8 2 8 4C8 5 8 6 10 6Z"/><path d="M16 4.02C19.33 4.2 21 5.43 21 10V16C21 20 20 22 15 22H9C4 22 3 20 3 16V10C3 5.44 4.67 4.2 8 4.02"/></svg>`,
        timer: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        tick: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z"/><path d="M7.75 12L10.58 14.83L16.25 9.17"/></svg>`,
        user: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z"/><path d="M20.59 22C20.59 18.13 16.74 15 12 15C7.26 15 3.41 18.13 3.41 22"/></svg>`,
        image: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
        close: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M18 6L6 18"/><path d="M6 6L18 18"/></svg>`,
        reject: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M12 22C17.5 22 22 17.5 22 12C22 6.5 17.5 2 12 2C6.5 2 2 6.5 2 12C2 17.5 6.5 22 12 22Z"/><path d="M9.17 14.83L14.83 9.17"/><path d="M14.83 14.83L9.17 9.17"/></svg>`,
        flash: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M9.32 21.68C8.98 21.68 8.65 21.51 8.46 21.21C8.13 20.69 8.28 20 8.8 19.67L14.77 15.89H10.13C9.44 15.89 8.88 15.33 8.88 14.64C8.88 14.28 9.04 13.94 9.32 13.72L15.2 9.07L9.54 4.33C9.07 3.94 9.01 3.24 9.4 2.77C9.79 2.3 10.49 2.24 10.96 2.63L18.25 8.74C18.63 9.06 18.78 9.58 18.62 10.05C18.46 10.52 18.03 10.84 17.53 10.84H12.82L15.65 12.63C16.14 12.94 16.32 13.59 16.05 14.11L10.05 21.32C9.87 21.56 9.6 21.68 9.32 21.68Z"/></svg>`,
        plus: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
        trash: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M21 5.98C17.67 5.65 14.32 5.48 10.98 5.48C9 5.48 7.02 5.58 5.04 5.78L3 5.98"/><path d="M8.5 4.97L8.72 3.66C8.88 2.71 9 2 10.69 2H13.31C15 2 15.13 2.75 15.28 3.67L15.5 4.97"/><path d="M18.85 9.14L18.2 19.21C18.09 20.78 18 22 15.21 22H8.79C6 22 5.91 20.78 5.8 19.21L5.15 9.14"/></svg>`,
        external: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M13 11L21.2 2.8"/><path d="M22 6.8V2H17.2"/><path d="M11 2H9C4 2 2 4 2 9V15C2 20 4 22 9 22H15C20 22 22 20 22 15V13"/></svg>`,
        edit: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M11 4H4C2.9 4 2 4.9 2 6V20C2 21.1 2.9 22 4 22H18C19.1 22 20 21.1 20 20V13"/><path d="M18.5 2.5C19.33 1.67 20.67 1.67 21.5 2.5C22.33 3.33 22.33 4.67 21.5 5.5L12 15L8 16L9 12L18.5 2.5Z"/></svg>`,
        lock: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
        volumeHigh: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M2 10V14C2 16 3 17 5 17H6.43C6.8 17 7.17 17.11 7.49 17.3L10.41 19.13C12.93 20.71 15 19.56 15 16.59V7.41C15 4.43 12.93 3.29 10.41 4.87L7.49 6.7C7.17 6.89 6.8 7 6.43 7H5C3 7 2 8 2 10Z"/><path d="M18 8C19.83 9.83 19.83 14.17 18 16"/><path d="M20.5 5.5C23.5 8.5 23.5 15.5 20.5 18.5"/></svg>`,
        volumeCross: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M2 10V14C2 16 3 17 5 17H6.43C6.8 17 7.17 17.11 7.49 17.3L10.41 19.13C12.93 20.71 15 19.56 15 16.59V7.41C15 4.43 12.93 3.29 10.41 4.87L7.49 6.7C7.17 6.89 6.8 7 6.43 7H5C3 7 2 8 2 10Z"/><path d="M18 10L22 14"/><path d="M22 10L18 14"/></svg>`,
        document: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M22 10V15C22 20 20 22 15 22H9C4 22 2 20 2 15V9C2 4 4 2 9 2H14"/><path d="M22 10H18C15 10 14 9 14 6V2L22 10Z"/><path d="M7 13H13"/><path d="M7 17H11"/></svg>`,
        pdf: `<svg class="isax isax-pdf" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15V12H10.5C11.3 12 11.5 12.7 11.5 13.5C11.5 14.3 11.3 15 10.5 15H9Z"/><line x1="14" y1="12" x2="14" y2="17"/></svg>`,
        word: `<svg class="isax isax-word" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z"/><polyline points="14 2 14 8 20 8"/><path d="M7 13L8.5 17L10 13L11.5 17L13 13"/></svg>`,
        download: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><path d="M9 11V17L11 15"/><path d="M9 17L7 15"/><path d="M22 10V15C22 20 20 22 15 22H9C4 22 2 20 2 15V9C2 4 4 2 9 2H14"/><path d="M22 10H18C15 10 14 9 14 6V2L22 10Z"/></svg>`,
        eye: `<svg class="isax" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><path d="M15.58 12C15.58 13.98 13.98 15.58 12 15.58C10.02 15.58 8.42 13.98 8.42 12C8.42 10.02 10.02 8.42 12 8.42C13.98 8.42 15.58 10.02 15.58 12Z"/><path d="M12 20.27C15.53 20.27 18.82 18.19 21.11 14.59C22.01 13.18 22.01 10.81 21.11 9.4C18.82 5.8 15.53 3.72 12 3.72C8.47 3.72 5.18 5.8 2.89 9.4C1.99 10.81 1.99 13.18 2.89 14.59C5.18 18.19 8.47 20.27 12 20.27Z"/></svg>`
    };

    // Shared AudioContext with unlock on user gesture
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) audioCtx = new AudioCtx();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    // Modern messenger notification sound (pleasant harmonic triad + urgent dual chime)
    function playNotificationSound(isUrgent = false) {
        if (!state.soundEnabled) return;
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            if (ctx.state === 'suspended') {
                ctx.resume();
            }

            function playChimeNote(freq, startTime, duration = 0.25, volume = 0.5) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, startTime);

                // Quick attack and warm exponential decay
                gain.gain.setValueAtTime(0.0001, startTime);
                gain.gain.linearRampToValueAtTime(volume, startTime + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start(startTime);
                osc.stop(startTime + duration + 0.05);
            }

            const t = ctx.currentTime;
            if (isUrgent) {
                // Urgent: Double alert burst (energetic high-priority chime)
                playChimeNote(587.33, t + 0.00, 0.18, 0.6);  // D5
                playChimeNote(880.00, t + 0.08, 0.22, 0.7);  // A5
                playChimeNote(1174.66, t + 0.16, 0.30, 0.75); // D6

                playChimeNote(659.25, t + 0.32, 0.18, 0.65); // E5
                playChimeNote(987.77, t + 0.40, 0.24, 0.75); // B5
                playChimeNote(1318.51, t + 0.48, 0.40, 0.8);  // E6
            } else {
                // Classic crisp messenger chime (Telegram / Slack marimba pop chord)
                playChimeNote(523.25, t + 0.00, 0.18, 0.5); // C5
                playChimeNote(783.99, t + 0.09, 0.22, 0.6); // G5
                playChimeNote(1046.50, t + 0.18, 0.35, 0.65); // C6
            }
        } catch (e) {
            console.warn('Audio notification error:', e);
        }
    }

    // Toggle Sound On / Off
    function toggleSound() {
        state.soundEnabled = !state.soundEnabled;
        localStorage.setItem('ticket_sound_enabled', String(state.soundEnabled));
        updateSoundToggleButtons();
        if (state.soundEnabled) {
            playNotificationSound(false);
        }
    }

    function updateSoundToggleButtons() {
        document.querySelectorAll('.tk-sound-toggle-btn').forEach(btn => {
            btn.classList.toggle('muted', !state.soundEnabled);
            btn.innerHTML = state.soundEnabled ? ICONS.volumeHigh : ICONS.volumeCross;
            btn.title = state.soundEnabled ? "Bildirishnoma ovozi YOQILGAN (O'chirish uchun bosing)" : "Bildirishnoma ovozi O'CHIRILGAN (Yoqish uchun bosing)";
        });
    }

    // Browser Tab Flashing Indicator
    let titleFlashTimer = null;
    let originalDocTitle = document.title;
    function startTitleFlash(text) {
        if (titleFlashTimer) return;
        originalDocTitle = document.title;
        let toggle = false;
        titleFlashTimer = setInterval(() => {
            document.title = toggle ? `(🔔 ${text}) ${originalDocTitle}` : originalDocTitle;
            toggle = !toggle;
        }, 900);
    }

    function stopTitleFlash() {
        if (titleFlashTimer) {
            clearInterval(titleFlashTimer);
            titleFlashTimer = null;
            document.title = originalDocTitle;
        }
    }
    window.addEventListener('focus', stopTitleFlash);
    window.addEventListener('click', stopTitleFlash);

    // Floating Toast Notification
    function showTicketToast(ticket, isAssignedToMe = false) {
        if (!ticket) return;
        let container = document.getElementById('ticketToastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'ticketToastContainer';
            document.body.appendChild(container);
        }

        const isUrgent = Boolean(ticket.isUrgent);
        const toast = document.createElement('div');
        toast.className = `tk-toast ${isUrgent ? 'urgent' : ''} ${isAssignedToMe ? 'assigned-to-me' : ''}`;

        const targetName = ticket.targetOperatorId && ticket.targetOperatorId !== 'all'
            ? (ticket.targetOperatorName || ticket.targetOperatorId)
            : 'Barcha operatorlarga';

        const snippet = ticket.comment || ticket.title || "Yangi topshiriq biriktirildi";

        let badgeTitle = isUrgent ? `${ICONS.flash} SHOSHILINCH` : `${ICONS.clipboard} YANGI TICKET`;
        if (isAssignedToMe) {
            badgeTitle = isUrgent ? `${ICONS.flash} SIZGA SHOSHILINCH VAZIFA` : `🎯 SIZGA BIRIKTIRILGAN VAZIFA`;
        }

        toast.innerHTML = `
            <div class="tk-toast-header">
                <span class="tk-toast-badge ${isUrgent ? 'urgent' : 'normal'}">
                    ${badgeTitle}
                </span>
                <button type="button" class="tk-toast-close" title="Yopish">&times;</button>
            </div>
            <div class="tk-toast-title">
                <span>#${ticket.id}</span>
                <span style="color: #94a3b8; font-size: 11px; font-weight: normal;">• Kimdan: ${escapeHtml(ticket.creatorName || ticket.operator || 'Operator')}</span>
            </div>
            <div class="tk-toast-body">${escapeHtml(snippet)}</div>
            <div class="tk-toast-footer">
                <span>🎯 Kimga: <b style="color: #38bdf8;">${escapeHtml(targetName)}</b></span>
                <button type="button" class="tk-toast-btn">
                    <span>Ochish</span>
                    ${ICONS.external}
                </button>
            </div>
        `;

        const openHandler = (e) => {
            e.stopPropagation();
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 350);
            openTicketBox(ticket.id);
            stopTitleFlash();
        };

        toast.querySelector('.tk-toast-btn').addEventListener('click', openHandler);
        toast.addEventListener('click', openHandler);
        toast.querySelector('.tk-toast-close').addEventListener('click', (e) => {
            e.stopPropagation();
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 350);
        });

        container.appendChild(toast);
        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto remove
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 350);
            }
        }, isUrgent ? 18000 : 9000);
    }

    // Time ago formatter (Uzbek)
    function formatTimeAgo(ts) {
        if (!ts) return '';
        const diffMs = Date.now() - ts;
        const diffSec = Math.floor(diffMs / 1000);
        if (diffSec < 60) return `${Math.max(1, diffSec)} soniya oldin`;
        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin} daqiqa oldin`;
        const diffHour = Math.floor(diffMin / 60);
        if (diffHour < 24) return `${diffHour} soat oldin`;
        const d = new Date(ts);
        return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    // Status label & badge class
    function getStatusInfo(status) {
        switch (status) {
            case 'pending':
                return { label: 'Kutilmoqda', cls: 'pending' };
            case 'in_progress':
                return { label: 'Jarayonda', cls: 'in_progress' };
            case 'completed':
                return { label: 'Bajarildi', cls: 'completed' };
            case 'rejected':
                return { label: 'Rad etilgan', cls: 'rejected' };
            default:
                return { label: status, cls: 'pending' };
        }
    }

    // =========================================================================
    // API CALLS
    // =========================================================================
    async function loadTickets() {
        try {
            const myOpId = String(state.myOperatorId || localStorage.getItem('viewer_my_operator_id') || '').trim();
            const opParam = myOpId ? `&operatorId=${encodeURIComponent(myOpId)}` : '';
            const resp = await fetch(`/api/tickets?filter=${state.currentFilter}${opParam}`);
            const json = await resp.json();
            if (json.success && Array.isArray(json.data)) {
                state.tickets = json.data;
                if (json.stats) {
                    state.stats = json.stats;
                } else {
                    state.stats = {
                        total: state.tickets.length,
                        mine: state.tickets.filter(t => (String(t.targetOperatorId).trim() === myOpId || String(t.creatorId).trim() === myOpId)).length,
                        pending: state.tickets.filter(t => t.status === 'pending').length,
                        in_progress: state.tickets.filter(t => t.status === 'in_progress').length,
                        completed: state.tickets.filter(t => t.status === 'completed').length,
                        rejected: state.tickets.filter(t => t.status === 'rejected').length
                    };
                }
                renderTicketsUI();
            }
        } catch (err) {
            console.warn('Tickets yuklashda xatolik:', err);
        }
    }

    async function createTicketApi(payload) {
        const resp = await fetch('/api/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await resp.json();
        if (!json.success) throw new Error(json.error || 'Xatolik');
        return json.data;
    }

    async function updateTicketApi(id, payload) {
        const resp = await fetch(`/api/tickets/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await resp.json();
        if (!json.success) throw new Error(json.error || 'Xatolik');
        return json.data;
    }

    async function acceptTicketApi(id, operatorInfo) {
        const resp = await fetch(`/api/tickets/${id}/accept`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operatorInfo)
        });
        const json = await resp.json();
        if (!json.success) throw new Error(json.error || 'Xatolik');
        return json.data;
    }

    async function completeTicketApi(id, operatorInfo) {
        const resp = await fetch(`/api/tickets/${id}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operatorInfo)
        });
        const json = await resp.json();
        if (!json.success) throw new Error(json.error || 'Xatolik');
        return json.data;
    }

    async function rejectTicketApi(id, operatorInfo) {
        const resp = await fetch(`/api/tickets/${id}/reject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operatorInfo)
        });
        const json = await resp.json();
        if (!json.success) throw new Error(json.error || 'Xatolik');
        return json.data;
    }

    async function addCommentApi(id, payload) {
        const resp = await fetch(`/api/tickets/${id}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await resp.json();
        if (!json.success) throw new Error(json.error || 'Xatolik');
        return json.data;
    }

    async function deleteTicketApi(id) {
        const resp = await fetch(`/api/tickets/${id}`, { method: 'DELETE' });
        const json = await resp.json();
        if (!json.success) throw new Error(json.error || 'Xatolik');
        return true;
    }

    // =========================================================================
    // RENDERING
    // =========================================================================
    function renderTicketsUI() {
        // Update counts
        const totalCount = state.stats && state.stats.total !== undefined ? state.stats.total : state.tickets.length;
        const mineCount = state.stats && state.stats.mine !== undefined ? state.stats.mine : 0;
        const pendingCount = state.stats && state.stats.pending !== undefined ? state.stats.pending : state.tickets.filter(t => t.status === 'pending').length;
        const inProgressCount = state.stats && state.stats.in_progress !== undefined ? state.stats.in_progress : state.tickets.filter(t => t.status === 'in_progress').length;
        const completedCount = state.stats && state.stats.completed !== undefined ? state.stats.completed : state.tickets.filter(t => t.status === 'completed').length;
        const rejectedCount = state.stats && state.stats.rejected !== undefined ? state.stats.rejected : state.tickets.filter(t => t.status === 'rejected').length;
        const activeCount = pendingCount + inProgressCount;

        // Header toggle badge (on main page)
        const badgeEl = document.getElementById('ticketHeaderBadge');
        if (badgeEl) {
            badgeEl.textContent = activeCount;
            if (activeCount > 0) {
                badgeEl.style.display = 'inline-flex';
                badgeEl.classList.add('has-tickets');
            } else {
                badgeEl.style.display = 'none';
                badgeEl.classList.remove('has-tickets');
            }
        }

        // Floating button badge (Bright Red notification pill)
        const floatBadges = [
            document.getElementById('ticketFloatingBadge'),
            document.getElementById('ticketFloatBadge')
        ];
        floatBadges.forEach(fb => {
            if (fb) {
                fb.textContent = activeCount;
                fb.style.display = activeCount > 0 ? 'inline-flex' : 'none';
            }
        });

        // Sidebar total count in header
        const sbCount = document.getElementById('ticketSidebarCount');
        if (sbCount) {
            sbCount.textContent = `${totalCount} ta`;
        }

        // Update stats on sidebar tabs (index.html)
        const sbTotal = document.getElementById('sbStatTotal');
        const sbMine = document.getElementById('sbStatMine');
        const sbPending = document.getElementById('sbStatPending');
        const sbInProgress = document.getElementById('sbStatInProgress');
        const sbCompleted = document.getElementById('sbStatCompleted');
        const sbRejected = document.getElementById('sbStatRejected');
        if (sbTotal) sbTotal.textContent = totalCount;
        if (sbMine) sbMine.textContent = mineCount;
        if (sbPending) sbPending.textContent = pendingCount;
        if (sbInProgress) sbInProgress.textContent = inProgressCount;
        if (sbCompleted) sbCompleted.textContent = completedCount;
        if (sbRejected) sbRejected.textContent = rejectedCount;

        // Render Sidebar List (if present)
        const sidebarList = document.getElementById('ticketSidebarList');
        if (sidebarList) {
            renderTicketCards(sidebarList, state.tickets, true);
        }

        // Render Full Page Grid (if on tickets.html)
        const pageGrid = document.getElementById('ticketPageGrid');
        if (pageGrid) {
            renderTicketCards(pageGrid, state.tickets, false);

            // Update stats tabs on full page
            const elTotal = document.getElementById('statTotalCount');
            const elMine = document.getElementById('statMineCount');
            const elPending = document.getElementById('statPendingCount');
            const elInProgress = document.getElementById('statInProgressCount');
            const elCompleted = document.getElementById('statCompletedCount');
            const elRejected = document.getElementById('statRejectedCount');
            if (elTotal) elTotal.textContent = totalCount;
            if (elMine) elMine.textContent = mineCount;
            if (elPending) elPending.textContent = pendingCount;
            if (elInProgress) elInProgress.textContent = inProgressCount;
            if (elCompleted) elCompleted.textContent = completedCount;
            if (elRejected) elRejected.textContent = rejectedCount;
        }

        // If a ticket box is currently open, re-render its details
        if (state.activeTicket) {
            const updated = state.tickets.find(t => t.id === state.activeTicket.id);
            if (updated) {
                state.activeTicket = updated;
                renderBoxDetails(updated);
            }
        }
    }

    function renderTicketCards(container, list, isMini = false) {
        if (!list || list.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: #64748b; padding: 40px 20px; font-size: 13px;">
                    ${ICONS.clipboard}
                    <div style="margin-top: 8px; font-weight: 600;">Hozircha ticketlar yo'q</div>
                    <div style="font-size: 11.5px; color: #475569; margin-top: 4px;">Yangi ticket ochish uchun tugmani bosing</div>
                </div>
            `;
            return;
        }

        container.innerHTML = list.map(t => {
            const st = getStatusInfo(t.status);
            const hasFiles = t.files && t.files.length > 0;
            const commentsCount = t.comments ? t.comments.length : 0;
            const isUrgent = Boolean(t.isUrgent);
            const isNewlyArrived = state.newlyArrivedIds && state.newlyArrivedIds.has(String(t.id));
            const pulseCls = isNewlyArrived ? (isUrgent ? 'pulse-urgent' : 'pulse-new') : '';
            const isTargetSpecific = t.targetOperatorId && t.targetOperatorId !== 'all';
            const currentOpId = String(state.myOperatorId || localStorage.getItem('viewer_my_operator_id') || '').trim();
            const isAssignedToMe = isTargetSpecific && currentOpId && String(t.targetOperatorId).trim() === currentOpId;

            const targetBadge = isTargetSpecific
                ? (isAssignedToMe
                    ? `<span class="tk-target-badge for-me" title="Sizga biriktirilgan vazifa">🎯 Menga (${escapeHtml(t.targetOperatorName || t.targetOperatorId)})</span>`
                    : `<span class="tk-target-badge specific" title="Mas'ul operator: ${escapeHtml(t.targetOperatorName || t.targetOperatorId)}">🎯 ${escapeHtml(t.targetOperatorName || t.targetOperatorId)}</span>`)
                : `<span class="tk-target-badge all" title="Barcha operatorlarga">👥 Barchaga</span>`;

            const assignedText = t.acceptedBy ? `Qabul qildi: ${t.acceptedBy.name}` :
                (t.status === 'completed' ? `Bajarildi: ${t.completedBy?.name || ''}` :
                (t.status === 'rejected' ? `Rad etildi: ${t.rejectedBy?.name || ''}` : ''));

            return `
                <div class="tk-mini-card status-${t.status} ${isUrgent ? 'is-urgent' : ''} ${isAssignedToMe ? 'is-assigned-to-me' : ''} ${pulseCls}" onclick="window.TicketsApp.openBox('${t.id}')">
                    <div class="tk-mini-header">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span class="tk-mini-id">${t.id}</span>
                            ${targetBadge}
                            ${isUrgent ? `<span class="tk-urgent-badge">${ICONS.flash} Shoshilinch</span>` : ''}
                        </div>
                        <span class="tk-status-badge ${st.cls}">${st.label}</span>
                    </div>
                    <div class="tk-mini-creator">
                        ${ICONS.user}
                        <span>${escapeHtml(t.creatorName)}</span>
                    </div>
                    <div class="tk-mini-snippet">
                        ${escapeHtml(t.comment || t.title)}
                    </div>
                    <div class="tk-mini-footer">
                        <span>${formatTimeAgo(t.createdAt)}</span>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            ${hasFiles ? `<span class="tk-mini-attachments" title="${t.files.length} ta rasm">${ICONS.image} ${t.files.length}</span>` : ''}
                            ${commentsCount > 0 ? `<span style="color:#94a3b8;font-weight:600;display:inline-flex;align-items:center;gap:3px;" title="${commentsCount} ta javob">${ICONS.clipboard} ${commentsCount}</span>` : ''}
                            ${assignedText ? `<span class="tk-mini-assigned" title="${assignedText}">${assignedText}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // =========================================================================
    // MODAL: QUTINI OCHISH (UNPACK BOX EFFECT)
    // =========================================================================
    function openTicketBox(ticketId) {
        const ticket = state.tickets.find(t => t.id === ticketId);
        if (!ticket) return;

        if (state.newlyArrivedIds) {
            state.newlyArrivedIds.delete(String(ticketId));
        }
        stopTitleFlash();

        state.activeTicket = ticket;
        state.replyAttachedFiles = [];
        renderBoxDetails(ticket);

        const overlay = document.getElementById('ticketBoxOverlay');
        if (overlay) {
            overlay.classList.add('active');
        }

        // Remove pulse from the clicked card immediately
        document.querySelectorAll(`.tk-mini-card[onclick*="'${ticketId}'"]`).forEach(el => {
            el.classList.remove('pulse-urgent', 'pulse-new');
        });
    }

    function smoothCloseTicketModal(modalOrId, callback) {
        const el = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
        if (!el) {
            if (typeof callback === 'function') callback();
            return;
        }
        el.classList.add('modal-closing');
        setTimeout(() => {
            el.classList.remove('modal-closing');
            el.classList.remove('active');
            if (typeof callback === 'function') callback();
        }, 180);
    }

    function closeTicketBox() {
        state.activeTicket = null;
        state.replyAttachedFiles = [];
        const overlay = document.getElementById('ticketBoxOverlay');
        if (overlay) {
            smoothCloseTicketModal(overlay);
        }
    }

    function renderBoxDetails(t) {
        const st = getStatusInfo(t.status);

        // Header info
        const elId = document.getElementById('boxTicketId');
        const elStatus = document.getElementById('boxStatusBadge');
        if (elId) {
            elId.innerHTML = `${t.id} ${t.isUrgent ? `<span class="tk-urgent-badge" style="font-size:11px;padding:3px 8px;margin-left:6px;">${ICONS.flash} SHOSHILINCH</span>` : ''}`;
        }
        if (elStatus) {
            elStatus.textContent = st.label;
            elStatus.className = `tk-status-badge ${st.cls}`;
        }

        // Meta
        const elCreator = document.getElementById('boxCreator');
        const elTime = document.getElementById('boxCreatedAt');
        const elAssigned = document.getElementById('boxAssigned');
        const elCustomer = document.getElementById('boxCustomerPhone');

        if (elCreator) elCreator.textContent = `${t.creatorName} (${t.creatorId})`;
        if (elTime) elTime.textContent = formatTimeAgo(t.createdAt);
        if (elAssigned) {
            if (t.status === 'completed') {
                elAssigned.textContent = t.completedBy ? `${t.completedBy.name} (Bajarildi)` : 'Bajarilgan';
            } else if (t.status === 'rejected') {
                elAssigned.textContent = t.rejectedBy ? `${t.rejectedBy.name} (Rad etildi)` : 'Rad etilgan';
            } else if (t.acceptedBy) {
                elAssigned.textContent = `${t.acceptedBy.name} (${formatTimeAgo(t.acceptedBy.at)})`;
            } else {
                elAssigned.textContent = 'Hali qabul qilinmagan';
            }
        }
        if (elCustomer) {
            elCustomer.textContent = t.customerPhone || 'Mavjud emas';
        }

        const elTarget = document.getElementById('boxTargetOperator');
        if (elTarget) {
            const isSpecific = t.targetOperatorId && t.targetOperatorId !== 'all';
            elTarget.textContent = isSpecific ? `🎯 ${t.targetOperatorName || t.targetOperatorId}` : '👥 Barcha operatorlar';
            elTarget.style.color = isSpecific ? '#38bdf8' : '#94a3b8';
        }

        // Comment body
        const elComment = document.getElementById('boxCommentText');
        if (elComment) elComment.textContent = t.comment || 'Izoh qoldirilmagan';

        // Gallery & Documents Section
        const galleryWrap = document.getElementById('boxGallerySection');
        const galleryGrid = document.getElementById('boxGalleryGrid');
        if (galleryWrap && galleryGrid) {
            if (t.files && t.files.length > 0) {
                galleryWrap.style.display = 'block';

                const imageFiles = t.files.filter(f => getFileType(f) === 'image');
                const docFiles = t.files.filter(f => getFileType(f) !== 'image');

                let html = '';

                // 1. Rasmlar gridi
                if (imageFiles.length > 0) {
                    html += `<div class="tk-gallery-grid">` + imageFiles.map(f => {
                        const safeJson = JSON.stringify({ url: f.url, name: f.name || 'Screenshot' }).replace(/"/g, '&quot;');
                        return `
                            <div class="tk-gallery-thumb" onclick="window.TicketsApp.openFileViewer(${safeJson})">
                                <img src="${f.url}" alt="${escapeHtml(f.name)}" loading="lazy">
                                <div class="tk-thumb-overlay">${ICONS.external}</div>
                            </div>
                        `;
                    }).join('') + `</div>`;
                }

                // 2. Hujjatlar (PDF, Word DOCX/DOC) kartalari
                if (docFiles.length > 0) {
                    html += `<div class="tk-docs-container" style="${imageFiles.length > 0 ? 'margin-top: 12px;' : ''}">` + docFiles.map(f => {
                        const ftype = getFileType(f);
                        const isPdf = ftype === 'pdf';
                        const isWord = ftype === 'docx' || ftype === 'doc';
                        const icon = isPdf ? ICONS.pdf : (isWord ? ICONS.word : ICONS.document);
                        const badgeCls = isPdf ? 'pdf' : (isWord ? 'word' : 'generic');
                        const badgeLabel = isPdf ? 'PDF' : (isWord ? (ftype === 'doc' ? 'DOC' : 'DOCX') : 'FAYL');
                        const sizeStr = f.size ? formatFileSize(f.size) : '';
                        const safeJson = JSON.stringify({ url: f.url, name: f.name || f.fileName, fileName: f.fileName, size: f.size }).replace(/"/g, '&quot;');

                        return `
                            <div class="tk-doc-card">
                                <div class="tk-doc-icon-badge ${badgeCls}">
                                    ${icon}
                                    <span>${badgeLabel}</span>
                                </div>
                                <div class="tk-doc-info" onclick="window.TicketsApp.openFileViewer(${safeJson})" title="Ko'rish uchun bosing">
                                    <div class="tk-doc-title" title="${escapeHtml(f.name || f.fileName)}">${escapeHtml(f.name || f.fileName)}</div>
                                    <div class="tk-doc-meta">
                                        <span>${badgeLabel} hujjat</span>
                                        ${sizeStr ? `<span>• ${sizeStr}</span>` : ''}
                                    </div>
                                </div>
                                <div class="tk-doc-actions">
                                    <button type="button" class="tk-doc-btn view-btn" onclick="window.TicketsApp.openFileViewer(${safeJson})" title="In-place ko'rish">
                                        ${ICONS.eye}
                                        <span>Ko'rish</span>
                                    </button>
                                    <a class="tk-doc-btn" href="${f.url}" download="${escapeHtml(f.name || f.fileName)}" title="Yuklab olish">
                                        ${ICONS.download}
                                    </a>
                                </div>
                            </div>
                        `;
                    }).join('') + `</div>`;
                }

                galleryGrid.innerHTML = html;
            } else {
                galleryWrap.style.display = 'none';
                galleryGrid.innerHTML = '';
            }
        }

        // Action Buttons
        const actionsContainer = document.getElementById('boxActionsBar');
        if (actionsContainer) {
            let btnsHtml = '';

            const currentOpId = state.myOperatorId || localStorage.getItem('viewer_my_operator_id');
            const isAssignedToAll = !t.targetOperatorId || t.targetOperatorId === 'all';
            const isAssignedToMe = currentOpId && String(t.targetOperatorId).trim() === String(currentOpId).trim();
            const isCreator = currentOpId && String(t.creatorId).trim() === String(currentOpId).trim();
            const canExecute = isAssignedToAll || isAssignedToMe || isCreator || !currentOpId;
            const canEdit = !currentOpId || isCreator;

            if (!canExecute) {
                btnsHtml += `
                    <div class="tk-lock-notice">
                        ${ICONS.lock}
                        <span>🔒 Ushbu vazifa faqat <b>${escapeHtml(t.targetOperatorName || t.targetOperatorId)}</b> ga biriktirilgan.</span>
                    </div>
                `;
            } else {
                if (t.status === 'pending') {
                    btnsHtml += `
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button type="button" class="tk-action-btn accept" onclick="window.TicketsApp.acceptCurrentTicket()">
                                ${ICONS.timer}
                                <span>Qabul qilish (Jarayonga olish)</span>
                            </button>
                            <button type="button" class="tk-action-btn reject" onclick="window.TicketsApp.rejectCurrentTicket()" title="Ticketni rad etish">
                                ${ICONS.reject}
                                <span>Rad etish</span>
                            </button>
                        </div>
                    `;
                } else if (t.status === 'in_progress') {
                    btnsHtml += `
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <button type="button" class="tk-action-btn complete" onclick="window.TicketsApp.completeCurrentTicket()">
                                ${ICONS.tick}
                                <span>Bajarildi deb belgilash</span>
                            </button>
                            <button type="button" class="tk-action-btn reject" onclick="window.TicketsApp.rejectCurrentTicket()" title="Ticketni rad etish">
                                ${ICONS.reject}
                                <span>Rad etish</span>
                            </button>
                        </div>
                    `;
                } else if (t.status === 'completed') {
                    btnsHtml += `
                        <span style="color:#10b981;font-weight:700;display:inline-flex;align-items:center;gap:6px;font-size:13px;">
                            ${ICONS.tick} Ticket muvaffaqiyatli bajarilgan
                        </span>
                    `;
                } else if (t.status === 'rejected') {
                    btnsHtml += `
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="color:#ef4444;font-weight:700;display:inline-flex;align-items:center;gap:6px;font-size:13px;">
                                ${ICONS.reject} Ticket rad etilgan
                            </span>
                            <button type="button" class="tk-action-btn accept" onclick="window.TicketsApp.acceptCurrentTicket()" style="padding: 6px 12px; font-size: 11.5px;">
                                ${ICONS.timer}
                                <span>Qayta ko'rib chiqish</span>
                            </button>
                        </div>
                    `;
                }
            }

            // Right side buttons: Edit (for creator) + Delete
            btnsHtml += `<div style="display: flex; align-items: center; gap: 8px; margin-left: auto;">`;
            if (canEdit && t.status !== 'completed') {
                btnsHtml += `
                    <button type="button" class="tk-action-btn edit" onclick="window.TicketsApp.openEditModal('${t.id}')" title="Ticketni tahrirlash">
                        ${ICONS.edit}
                        <span>Tahrirlash</span>
                    </button>
                `;
            }
            btnsHtml += `
                    <button type="button" class="tk-action-btn delete" onclick="window.TicketsApp.deleteCurrentTicket()" title="Ticketni o'chirish">
                        ${ICONS.trash}
                        <span>O'chirish</span>
                    </button>
                </div>
            `;

            actionsContainer.innerHTML = btnsHtml;
        }

        // Discussion / Replies List
        const repliesList = document.getElementById('boxRepliesList');
        if (repliesList) {
            if (t.comments && t.comments.length > 0) {
                repliesList.innerHTML = t.comments.map(c => `
                    <div class="tk-reply-card">
                        <div class="tk-reply-header">
                            <span class="tk-reply-author">${escapeHtml(c.operatorName)}</span>
                            <span class="tk-reply-time">${formatTimeAgo(c.createdAt)}</span>
                        </div>
                        <div class="tk-reply-text">${escapeHtml(c.text)}</div>
                        ${c.files && c.files.length > 0 ? `
                            <div style="margin-top: 8px;">
                                ${c.files.some(cf => getFileType(cf) === 'image') ? `
                                    <div class="tk-gallery-grid">
                                        ${c.files.filter(cf => getFileType(cf) === 'image').map(cf => {
                                            const safeJson = JSON.stringify({ url: cf.url, name: cf.name || 'Screenshot' }).replace(/"/g, '&quot;');
                                            return `
                                                <div class="tk-gallery-thumb" style="aspect-ratio: 16/9; max-width: 140px;" onclick="window.TicketsApp.openFileViewer(${safeJson})">
                                                    <img src="${cf.url}" alt="${escapeHtml(cf.name)}">
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                ` : ''}
                                ${c.files.some(cf => getFileType(cf) !== 'image') ? `
                                    <div class="tk-docs-container" style="margin-top: 6px;">
                                        ${c.files.filter(cf => getFileType(cf) !== 'image').map(cf => {
                                            const ctype = getFileType(cf);
                                            const isPdf = ctype === 'pdf';
                                            const isWord = ctype === 'docx' || ctype === 'doc';
                                            const icon = isPdf ? ICONS.pdf : (isWord ? ICONS.word : ICONS.document);
                                            const badgeCls = isPdf ? 'pdf' : (isWord ? 'word' : 'generic');
                                            const badgeLabel = isPdf ? 'PDF' : (isWord ? (ctype === 'doc' ? 'DOC' : 'DOCX') : 'FAYL');
                                            const safeJson = JSON.stringify({ url: cf.url, name: cf.name || cf.fileName, fileName: cf.fileName }).replace(/"/g, '&quot;');
                                            return `
                                                <div class="tk-doc-card" style="padding: 8px 10px;">
                                                    <div class="tk-doc-icon-badge ${badgeCls}" style="width:34px;height:34px;min-width:34px;">
                                                        ${icon}
                                                        <span style="font-size:8px;">${badgeLabel}</span>
                                                    </div>
                                                    <div class="tk-doc-info" onclick="window.TicketsApp.openFileViewer(${safeJson})">
                                                        <div class="tk-doc-title" style="font-size:12px;" title="${escapeHtml(cf.name || cf.fileName)}">${escapeHtml(cf.name || cf.fileName)}</div>
                                                        <div class="tk-doc-meta" style="font-size:10px;"><span>${badgeLabel} hujjat</span></div>
                                                    </div>
                                                    <div class="tk-doc-actions">
                                                        <button type="button" class="tk-doc-btn view-btn" style="padding:0 8px;height:26px;font-size:11px;" onclick="window.TicketsApp.openFileViewer(${safeJson})" title="Ko'rish">
                                                            ${ICONS.eye}
                                                            <span>Ko'rish</span>
                                                        </button>
                                                        <a class="tk-doc-btn" style="width:26px;height:26px;" href="${cf.url}" download="${escapeHtml(cf.name || cf.fileName)}" title="Yuklab olish">
                                                            ${ICONS.download}
                                                        </a>
                                                    </div>
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        ` : ''}
                    </div>
                `).join('');
            } else {
                repliesList.innerHTML = `<div style="color:#64748b;font-size:12px;font-style:italic;">Hozircha qo'shimcha izohlar yo'q</div>`;
            }
        }
    }

    // =========================================================================
    // TICKET CREATION FORM
    // =========================================================================
    function openCreateModal() {
        // Pre-fill operator if detected
        const opInput = document.getElementById('newTicketOperator');
        if (opInput && !opInput.value) {
            opInput.value = state.myOperatorName || (state.myOperatorId ? `Operator ${state.myOperatorId}` : '101 (Oybek)');
        }

        state.attachedFiles = [];
        renderAttachedFilesPreview('newTicketPreviewStrip', state.attachedFiles);

        const urgentInput = document.getElementById('newTicketUrgent');
        if (urgentInput) urgentInput.checked = false;

        const modal = document.getElementById('createTicketModal');
        if (modal) modal.classList.add('active');
    }

    function closeCreateModal() {
        const modal = document.getElementById('createTicketModal');
        if (modal) {
            smoothCloseTicketModal(modal, () => {
                state.attachedFiles = [];
                const urgentInput = document.getElementById('newTicketUrgent');
                if (urgentInput) urgentInput.checked = false;
            });
        } else {
            state.attachedFiles = [];
            const urgentInput = document.getElementById('newTicketUrgent');
            if (urgentInput) urgentInput.checked = false;
        }
    }

    function renderAttachedFilesPreview(containerId, filesArray) {
        const strip = document.getElementById(containerId);
        if (!strip) return;

        strip.innerHTML = filesArray.map((f, idx) => {
            const ftype = getFileType(f);
            let innerContent = '';
            if (ftype === 'image') {
                innerContent = `<img src="${f.base64}" alt="${escapeHtml(f.name)}" onclick="window.TicketsApp.previewAttachedFileAtIndex('${containerId}', ${idx})" title="Ko'rish uchun bosing">`;
            } else if (ftype === 'pdf') {
                innerContent = `
                    <div class="tk-doc-badge-preview pdf" onclick="window.TicketsApp.previewAttachedFileAtIndex('${containerId}', ${idx})" title="Ko'rish uchun bosing">
                        ${ICONS.pdf}
                        <span class="badge-ext">PDF</span>
                        <span class="badge-name">${escapeHtml(f.name)}</span>
                    </div>
                `;
            } else if (ftype === 'docx' || ftype === 'doc') {
                innerContent = `
                    <div class="tk-doc-badge-preview word" onclick="window.TicketsApp.previewAttachedFileAtIndex('${containerId}', ${idx})" title="Ko'rish uchun bosing">
                        ${ICONS.word}
                        <span class="badge-ext">${ftype.toUpperCase()}</span>
                        <span class="badge-name">${escapeHtml(f.name)}</span>
                    </div>
                `;
            } else {
                innerContent = `
                    <div class="tk-doc-badge-preview generic" onclick="window.TicketsApp.previewAttachedFileAtIndex('${containerId}', ${idx})" title="Ko'rish uchun bosing">
                        ${ICONS.document}
                        <span class="badge-ext">FAYL</span>
                        <span class="badge-name">${escapeHtml(f.name)}</span>
                    </div>
                `;
            }

            return `
                <div class="tk-preview-item">
                    ${innerContent}
                    <button type="button" class="tk-preview-remove" onclick="window.TicketsApp.removeAttachedFile('${containerId}', ${idx})" title="O'chirish">&times;</button>
                </div>
            `;
        }).join('');
    }

    function previewAttachedFileAtIndex(containerId, idx) {
        const arr = (containerId === 'newTicketPreviewStrip') ? state.attachedFiles : state.replyAttachedFiles;
        if (arr && arr[idx]) {
            openDocViewer(arr[idx]);
        }
    }

    function removeAttachedFile(containerId, idx) {
        if (containerId === 'newTicketPreviewStrip') {
            state.attachedFiles.splice(idx, 1);
            renderAttachedFilesPreview(containerId, state.attachedFiles);
        } else if (containerId === 'replyTicketPreviewStrip') {
            state.replyAttachedFiles.splice(idx, 1);
            renderAttachedFilesPreview(containerId, state.replyAttachedFiles);
        }
    }

    async function handleCreateSubmit(e) {
        if (e) e.preventDefault();

        const opInput = document.getElementById('newTicketOperator');
        const phoneInput = document.getElementById('newTicketCustomerPhone');
        const commentInput = document.getElementById('newTicketComment');
        const btnSubmit = document.getElementById('btnSubmitNewTicket');

        const commentVal = commentInput ? commentInput.value.trim() : '';
        const operatorVal = opInput ? opInput.value.trim() : 'Operator';
        const phoneVal = phoneInput ? phoneInput.value.trim() : '';

        if (!commentVal && state.attachedFiles.length === 0) {
            alert("Iltimos, izoh yozing yoki rasm/screenshot biriktiring!");
            return;
        }

        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `Yuborilmoqda...`;
        }

        try {
            const urgentInput = document.getElementById('newTicketUrgent');
            const isUrgent = urgentInput ? urgentInput.checked : false;

            const targetSelect = document.getElementById('newTicketTargetOperator');
            let targetOperatorId = 'all';
            let targetOperatorName = 'Barcha operatorlar';
            if (targetSelect) {
                targetOperatorId = targetSelect.value || 'all';
                const selectedOpt = targetSelect.options[targetSelect.selectedIndex];
                targetOperatorName = selectedOpt ? (selectedOpt.getAttribute('data-name') || selectedOpt.text) : 'Barcha operatorlar';
            }

            await createTicketApi({
                creatorId: state.myOperatorId || '101',
                creatorName: operatorVal || state.myOperatorName || 'Operator',
                customerPhone: phoneVal,
                comment: commentVal,
                files: state.attachedFiles,
                isUrgent: isUrgent,
                targetOperatorId: targetOperatorId,
                targetOperatorName: targetOperatorName
            });

            closeCreateModal();
            if (commentInput) commentInput.value = '';
            if (phoneInput) phoneInput.value = '';
            if (urgentInput) urgentInput.checked = false;
            if (targetSelect) targetSelect.value = 'all';
            state.attachedFiles = [];
        } catch (err) {
            alert('Xatolik: ' + err.message);
        } finally {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = `Yaratish va yuborish`;
            }
        }
    }

    // =========================================================================
    // TICKET EDITING FORM (FOR CREATOR)
    // =========================================================================
    function openEditModal(ticketId) {
        const ticket = state.tickets.find(t => t.id === ticketId) || state.activeTicket;
        if (!ticket) return;

        const idInput = document.getElementById('editTicketId');
        const badge = document.getElementById('editTicketIdBadge');
        const phoneInput = document.getElementById('editTicketCustomerPhone');
        const commentInput = document.getElementById('editTicketComment');
        const urgentInput = document.getElementById('editTicketUrgent');
        const targetSelect = document.getElementById('editTicketTargetOperator');

        if (idInput) idInput.value = ticket.id;
        if (badge) badge.textContent = `${ticket.id} TAHRIRLASH`;
        if (phoneInput) phoneInput.value = ticket.customerPhone || '';
        if (commentInput) commentInput.value = ticket.comment || '';
        if (urgentInput) urgentInput.checked = Boolean(ticket.isUrgent);
        if (targetSelect) {
            targetSelect.value = ticket.targetOperatorId || 'all';
        }

        const modal = document.getElementById('editTicketModal');
        if (modal) modal.classList.add('active');
    }

    function closeEditModal() {
        const modal = document.getElementById('editTicketModal');
        if (modal) {
            smoothCloseTicketModal(modal);
        }
    }

    async function handleEditSubmit(e) {
        if (e) e.preventDefault();

        const idInput = document.getElementById('editTicketId');
        const ticketId = idInput ? idInput.value : null;
        if (!ticketId) return;

        const phoneInput = document.getElementById('editTicketCustomerPhone');
        const commentInput = document.getElementById('editTicketComment');
        const urgentInput = document.getElementById('editTicketUrgent');
        const targetSelect = document.getElementById('editTicketTargetOperator');
        const btnSubmit = document.getElementById('btnSubmitEditTicket');

        const commentVal = commentInput ? commentInput.value.trim() : '';
        if (!commentVal) {
            alert("Izoh bo'sh bo'lishi mumkin emas!");
            return;
        }

        let targetOperatorId = 'all';
        let targetOperatorName = 'Barcha operatorlar';
        if (targetSelect) {
            targetOperatorId = targetSelect.value || 'all';
            const selectedOpt = targetSelect.options[targetSelect.selectedIndex];
            targetOperatorName = selectedOpt ? (selectedOpt.getAttribute('data-name') || selectedOpt.text) : 'Barcha operatorlar';
        }

        if (btnSubmit) {
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `Saqlanmoqda...`;
        }

        try {
            const updated = await updateTicketApi(ticketId, {
                editorId: state.myOperatorId || '101',
                editorName: state.myOperatorName || 'Operator',
                customerPhone: phoneInput ? phoneInput.value.trim() : '',
                comment: commentVal,
                isUrgent: urgentInput ? urgentInput.checked : false,
                targetOperatorId,
                targetOperatorName
            });

            closeEditModal();
            loadTickets();
            if (state.activeTicket && state.activeTicket.id === ticketId) {
                state.activeTicket = updated;
                renderBoxDetails(updated);
            }
        } catch (err) {
            alert('Xatolik: ' + err.message);
        } finally {
            if (btnSubmit) {
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = `O'zgarishlarni saqlash`;
            }
        }
    }

    // =========================================================================
    // ACTIONS ON ACTIVE TICKET
    // =========================================================================
    async function acceptCurrentTicket() {
        if (!state.activeTicket) return;
        const opName = state.myOperatorName || (state.myOperatorId ? `Operator ${state.myOperatorId}` : prompt("Operator ismingizni kiriting:", "Operator 101") || 'Operator 101');

        try {
            const updated = await acceptTicketApi(state.activeTicket.id, {
                operatorId: state.myOperatorId || '101',
                operatorName: opName
            });
            state.activeTicket = updated;
            renderBoxDetails(updated);
        } catch (e) {
            alert('Xatolik: ' + e.message);
        }
    }

    async function completeCurrentTicket() {
        if (!state.activeTicket) return;
        const opName = state.myOperatorName || (state.myOperatorId ? `Operator ${state.myOperatorId}` : 'Operator');

        try {
            const updated = await completeTicketApi(state.activeTicket.id, {
                operatorId: state.myOperatorId || '101',
                operatorName: opName
            });
            state.activeTicket = updated;
            renderBoxDetails(updated);
        } catch (e) {
            alert('Xatolik: ' + e.message);
        }
    }

    async function rejectCurrentTicket() {
        if (!state.activeTicket) return;
        if (!confirm(`${state.activeTicket.id} raqamli ticketni rad etishni tasdiqlaysizmi?`)) return;
        const opName = state.myOperatorName || (state.myOperatorId ? `Operator ${state.myOperatorId}` : 'Operator');

        try {
            const updated = await rejectTicketApi(state.activeTicket.id, {
                operatorId: state.myOperatorId || '101',
                operatorName: opName
            });
            state.activeTicket = updated;
            renderBoxDetails(updated);
        } catch (e) {
            alert('Xatolik: ' + e.message);
        }
    }

    async function deleteCurrentTicket() {
        if (!state.activeTicket) return;
        if (!confirm(`${state.activeTicket.id} raqamli ticketni o'chirishni tasdiqlaysizmi?`)) return;

        try {
            await deleteTicketApi(state.activeTicket.id);
            closeTicketBox();
        } catch (e) {
            alert('Xatolik: ' + e.message);
        }
    }

    async function submitReply() {
        if (!state.activeTicket) return;
        const replyInput = document.getElementById('boxReplyText');
        const textVal = replyInput ? replyInput.value.trim() : '';

        if (!textVal && state.replyAttachedFiles.length === 0) {
            alert("Izoh yozing yoki rasm biriktiring");
            return;
        }

        try {
            const result = await addCommentApi(state.activeTicket.id, {
                operatorId: state.myOperatorId || '101',
                operatorName: state.myOperatorName || 'Operator',
                text: textVal,
                files: state.replyAttachedFiles
            });

            if (replyInput) replyInput.value = '';
            state.replyAttachedFiles = [];
            renderAttachedFilesPreview('replyTicketPreviewStrip', state.replyAttachedFiles);
        } catch (e) {
            alert('Xatolik: ' + e.message);
        }
    }

    // =========================================================================
    // FILE HELPERS & IN-PLACE DOCUMENT VIEWER (PDF, WORD DOCX, IMAGES)
    // =========================================================================
    function getFileType(file) {
        if (!file) return 'other';
        const name = (file.name || file.fileName || file.url || '') + '';
        const base64 = (file.base64 || '') + '';
        const mime = (file.mimeType || '') + '';
        const ext = (name.split('.').pop() || '').toLowerCase().split('?')[0];

        if (ext === 'pdf' || mime.includes('pdf') || base64.startsWith('data:application/pdf')) {
            return 'pdf';
        }
        if (ext === 'docx' || mime.includes('wordprocessingml') || ext === 'doc' || mime.includes('msword')) {
            return ext === 'doc' ? 'doc' : 'docx';
        }
        if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'].includes(ext) || mime.startsWith('image/') || base64.startsWith('data:image/')) {
            return 'image';
        }
        return 'other';
    }

    function formatFileSize(bytes) {
        if (!bytes || isNaN(bytes)) return '';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function readFileAsBase64(file, nameHint = 'screenshot.png') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({
                name: file.name || nameHint,
                base64: reader.result,
                size: file.size || 0,
                mimeType: file.type || ''
            });
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function setupDragAndDrop(dropzoneId, previewStripId, targetArrayName) {
        const dropzone = document.getElementById(dropzoneId);
        if (!dropzone) return;

        ['dragenter', 'dragover'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropzone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropzone.classList.remove('drag-over');
            }, false);
        });

        dropzone.addEventListener('drop', async (e) => {
            const dt = e.dataTransfer;
            if (!dt || !dt.files || dt.files.length === 0) return;

            for (const file of Array.from(dt.files)) {
                const ftype = getFileType({ name: file.name, mimeType: file.type });
                if (ftype === 'image' || ftype === 'pdf' || ftype === 'docx' || ftype === 'doc') {
                    const item = await readFileAsBase64(file);
                    state[targetArrayName].push(item);
                }
            }
            renderAttachedFilesPreview(previewStripId, state[targetArrayName]);
        });
    }

    // Clipboard Paste (Ctrl+V) anywhere on the window
    function setupGlobalClipboardPaste() {
        window.addEventListener('paste', async (e) => {
            const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
            if (!items) return;

            let foundImage = false;
            for (const item of Array.from(items)) {
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    if (!file) continue;
                    foundImage = true;

                    const parsed = await readFileAsBase64(file, `screenshot_${Date.now()}.png`);

                    // Agar biron quti ochilgan bo'lsa -> reply qismiga
                    if (state.activeTicket && document.getElementById('ticketBoxOverlay')?.classList.contains('active')) {
                        state.replyAttachedFiles.push(parsed);
                        renderAttachedFilesPreview('replyTicketPreviewStrip', state.replyAttachedFiles);
                    } else {
                        // Aks holda Yangi Ticket ochish oynasiga
                        if (!document.getElementById('createTicketModal')?.classList.contains('active')) {
                            openCreateModal();
                        }
                        state.attachedFiles.push(parsed);
                        renderAttachedFilesPreview('newTicketPreviewStrip', state.attachedFiles);
                    }
                }
            }

            if (foundImage) {
                console.log('📸 Screenshot clipboarddan muvaffaqiyatli qabul qilindi');
            }
        });
    }

    // File input trigger
    function handleFileInputChange(e, previewStripId, targetArrayName) {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        Promise.all(Array.from(files).map(f => readFileAsBase64(f))).then(items => {
            state[targetArrayName].push(...items);
            renderAttachedFilesPreview(previewStripId, state[targetArrayName]);
            e.target.value = ''; // reset
        });
    }

    // Fullscreen In-Place Document & Image Viewer (PDF, Word DOCX/DOC, Images)
    async function openDocViewer(file) {
        if (!file) return;

        // Agar shunchaki string URL uzatilgan bo'lsa
        if (typeof file === 'string') {
            file = { url: file, name: 'Hujjat' };
        }

        const modal = document.getElementById('tkDocViewerModal');
        const modalBody = document.getElementById('tkDocModalBody');
        const titleEl = document.getElementById('tkDocModalTitle');
        const subEl = document.getElementById('tkDocModalSub');
        const iconEl = document.getElementById('tkDocModalIcon');
        const dlBtn = document.getElementById('tkDocDownloadBtn');
        const newTabBtn = document.getElementById('tkDocOpenNewTabBtn');

        // Agar yangi modal topilmasa, fallback lightbox
        if (!modal || !modalBody) {
            if (file.url) openLightbox(file.url);
            return;
        }

        const ftype = getFileType(file);
        const fileName = file.name || file.fileName || 'Hujjat';
        const fileUrl = file.url || file.base64 || '#';

        if (titleEl) titleEl.textContent = fileName;
        if (dlBtn) {
            dlBtn.href = fileUrl;
            dlBtn.download = fileName;
        }
        if (newTabBtn) {
            newTabBtn.href = fileUrl;
            newTabBtn.style.display = (fileUrl.startsWith('data:') && fileUrl.length > 500000) ? 'none' : 'inline-flex';
        }

        modal.classList.add('active');

        if (ftype === 'image') {
            if (iconEl) {
                iconEl.className = 'tk-doc-modal-icon image';
                iconEl.innerHTML = ICONS.image;
            }
            if (subEl) subEl.textContent = 'Rasm / Screenshot ko\'rinishi';
            modalBody.innerHTML = `
                <div class="tk-doc-img-view">
                    <img src="${fileUrl}" alt="${escapeHtml(fileName)}">
                </div>
            `;
        } else if (ftype === 'pdf') {
            if (iconEl) {
                iconEl.className = 'tk-doc-modal-icon pdf';
                iconEl.innerHTML = ICONS.pdf;
            }
            if (subEl) subEl.textContent = 'PDF Hujjat ko\'rinishi (Ichki o\'quvchi)';

            let srcUrl = fileUrl;
            if (file.base64 && file.base64.startsWith('data:')) {
                try {
                    const byteCharacters = atob(file.base64.split(',')[1]);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: 'application/pdf' });
                    srcUrl = URL.createObjectURL(blob);
                } catch (e) {
                    console.warn('PDF blob yaratishda xatolik:', e);
                }
            }

            modalBody.innerHTML = `
                <iframe class="tk-doc-viewer-iframe" src="${srcUrl}#toolbar=1&navpanes=1" title="${escapeHtml(fileName)}"></iframe>
            `;
        } else if (ftype === 'docx' || ftype === 'doc') {
            if (iconEl) {
                iconEl.className = 'tk-doc-modal-icon word';
                iconEl.innerHTML = ICONS.word;
            }
            if (subEl) subEl.textContent = `Microsoft Word (${ftype.toUpperCase()}) ko'rinishi`;

            modalBody.innerHTML = `
                <div class="tk-doc-loading">
                    <div class="tk-doc-spinner"></div>
                    <div>Word hujjat o'qilmoqda va formatlanmoqda...</div>
                </div>
            `;

            try {
                let renderedHtml = '';

                // 1-urinish: Client-side mammoth orqali tezkor render
                if (window.mammoth) {
                    try {
                        if (file.base64) {
                            const byteCharacters = atob(file.base64.split(',')[1]);
                            const arrayBuffer = new ArrayBuffer(byteCharacters.length);
                            const uint8Array = new Uint8Array(arrayBuffer);
                            for (let i = 0; i < byteCharacters.length; i++) {
                                uint8Array[i] = byteCharacters.charCodeAt(i);
                            }
                            const res = await window.mammoth.convertToHtml({ arrayBuffer });
                            renderedHtml = res.value;
                        } else if (file.url) {
                            const resp = await fetch(file.url);
                            if (resp.ok) {
                                const arrayBuffer = await resp.arrayBuffer();
                                const res = await window.mammoth.convertToHtml({ arrayBuffer });
                                renderedHtml = res.value;
                            }
                        }
                    } catch (mErr) {
                        console.warn('Client mammoth bilan o\'qishda xatolik, serverga murojaat qilinadi:', mErr.message);
                    }
                }

                // 2-urinish: Server-side mammoth endpointi (/api/tickets/preview-doc)
                if (!renderedHtml) {
                    const apiRes = await fetch('/api/tickets/preview-doc', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            base64: file.base64 || null,
                            url: file.url || null,
                            filename: fileName
                        })
                    });
                    const apiData = await apiRes.json();
                    if (apiData && apiData.success) {
                        renderedHtml = apiData.html;
                    } else {
                        throw new Error((apiData && apiData.error) || 'Hujjatni o\'qib bo\'lmadi');
                    }
                }

                modalBody.innerHTML = `
                    <div class="tk-doc-paper-wrap">
                        <div class="tk-docx-paper">
                            <div style="border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                                <div>
                                    <h2 style="margin: 0; font-size: 20px; color: #1e293b;">${escapeHtml(fileName)}</h2>
                                    <span style="font-size: 12px; color: #64748b;">Word formati konvertatsiyasi</span>
                                </div>
                                <a href="${fileUrl}" download="${escapeHtml(fileName)}" class="tk-doc-btn view-btn" style="text-decoration: none;">
                                    ${ICONS.download}
                                    <span>Aslini yuklab olish</span>
                                </a>
                            </div>
                            ${renderedHtml || '<p style="color: #64748b; font-style: italic;">Hujjatda matn topilmadi.</p>'}
                        </div>
                    </div>
                `;
            } catch (err) {
                console.error('Docx ko\'rish xatosi:', err);
                modalBody.innerHTML = `
                    <div class="doc-legacy-notice">
                        <div class="notice-icon">
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        </div>
                        <h3>Hujjatni ochishda cheklov</h3>
                        <p>${escapeHtml(err.message || 'Ushbu format to\'g\'ridan-to\'g\'ri render qilinmadi.')} Faylni to'liq ko'rish uchun quyidagi tugma orqali yuklab olishingiz mumkin.</p>
                        <a href="${fileUrl}" download="${escapeHtml(fileName)}" class="tk-doc-action-btn" style="margin: 0 auto; display: inline-flex;">
                            ${ICONS.download}
                            <span>Faylni yuklab olish (${escapeHtml(fileName)})</span>
                        </a>
                    </div>
                `;
            }
        } else {
            // Generic / other file
            if (iconEl) {
                iconEl.className = 'tk-doc-modal-icon';
                iconEl.innerHTML = ICONS.document;
            }
            if (subEl) subEl.textContent = 'Biriktirilgan fayl';
            modalBody.innerHTML = `
                <div class="doc-legacy-notice">
                    <div class="notice-icon">${ICONS.document}</div>
                    <h3>${escapeHtml(fileName)}</h3>
                    <p>Ushbu fayl turini brauzerda to'g'ridan-to'g'ri ko'rish cheklangan. Faylni qurilmangizga yuklab olib ochishingiz mumkin.</p>
                    <a href="${fileUrl}" download="${escapeHtml(fileName)}" class="tk-doc-action-btn" style="margin: 0 auto; display: inline-flex;">
                        ${ICONS.download}
                        <span>Faylni yuklab olish</span>
                    </a>
                </div>
            `;
        }
    }

    function closeDocViewer() {
        const modal = document.getElementById('tkDocViewerModal');
        const modalBody = document.getElementById('tkDocModalBody');
        if (modal) {
            smoothCloseTicketModal(modal, () => {
                if (modalBody) modalBody.innerHTML = '';
            });
        } else if (modalBody) {
            modalBody.innerHTML = '';
        }
    }

    // Lightbox Fullscreen Image View (Bridge to openDocViewer)
    function openLightbox(url) {
        openDocViewer({ url, name: 'Screenshot' });
    }

    function closeLightbox() {
        closeDocViewer();
        const overlay = document.getElementById('tkLightboxOverlay');
        if (overlay) {
            smoothCloseTicketModal(overlay);
        }
    }

    // =========================================================================
    // WEBSOCKET EVENTS
    // =========================================================================
    function handleWsEvent(msg) {
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'client_identity':
                if (msg.data) {
                    if (msg.data.role) state.myUserRole = msg.data.role;
                    if (msg.data.operatorId) state.myOperatorId = String(msg.data.operatorId);
                    if (msg.data.operatorName) state.myOperatorName = String(msg.data.operatorName);
                    updateTicketsHeaderProfile(msg.data.operatorName, msg.data.operatorId, msg.data.username, msg.data.role);
                }
                break;

            case 'ticket_created':
                if (msg.data) {
                    const ticket = msg.data;
                    const isUrgent = Boolean(ticket.isUrgent);
                    const myOpId = String(state.myOperatorId || localStorage.getItem('viewer_my_operator_id') || '').trim();
                    const creatorId = String(ticket.creatorId || '').trim();
                    const targetId = ticket.targetOperatorId ? String(ticket.targetOperatorId).trim() : 'all';

                    const isCreator = myOpId && creatorId && myOpId === creatorId;
                    const isTargetSpecific = targetId && targetId !== 'all';
                    const isAssignedToMe = isTargetSpecific ? (myOpId && targetId === myOpId) : true;
                    const isSuper = (state.myUserRole === 'superuser');

                    // Faqat biriktirilgan operator va superuser ga ovoz va toast chiqadi. Yaratgan odamga qaytib ovoz bermaydi!
                    const shouldNotify = !isCreator && (isAssignedToMe || isSuper);

                    if (shouldNotify) {
                        if (state.newlyArrivedIds) {
                            state.newlyArrivedIds.add(String(ticket.id));
                        }
                        playNotificationSound(isUrgent);
                        showTicketToast(ticket, isAssignedToMe && isTargetSpecific);
                        if (document.hidden || !document.hasFocus()) {
                            const flashText = (isAssignedToMe && isTargetSpecific) 
                                ? '🎯 SIZGA VAZIFA KELDI' 
                                : (isUrgent ? 'SHOSHILINCH TICKET' : 'YANGI TICKET');
                            startTitleFlash(flashText);
                        }
                    }
                    loadTickets();
                }
                break;

            case 'ticket_accepted':
            case 'ticket_completed':
            case 'ticket_rejected':
            case 'ticket_updated':
                if (msg.data) {
                    loadTickets();
                    if (state.activeTicket && state.activeTicket.id === msg.data.id) {
                        state.activeTicket = msg.data;
                        renderBoxDetails(msg.data);
                    }
                }
                break;

            case 'ticket_comment_added':
                if (msg.data && msg.data.ticket) {
                    loadTickets();
                    if (state.activeTicket && state.activeTicket.id === msg.data.ticket.id) {
                        state.activeTicket = msg.data.ticket;
                        renderBoxDetails(msg.data.ticket);
                    }
                    playNotificationSound(false);
                }
                break;

            case 'ticket_deleted':
                loadTickets();
                break;

            case 'tickets_cleaned':
                loadTickets();
                break;
        }
    }

    // Set filter (all, pending, in_progress, completed)
    function setFilter(filter, clickedBtn) {
        state.currentFilter = filter;

        // Update active class on filter buttons across sidebar and page
        document.querySelectorAll('.tk-tab-btn, .tk-filter-pill, .kds-tab-btn, .cb-tab-btn').forEach(btn => {
            if (btn.dataset && btn.dataset.filter === filter) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        if (clickedBtn && clickedBtn.classList) {
            clickedBtn.classList.add('active');
        }

        loadTickets();
    }

    // Sidebar Toggle
    function toggleSidebar(forceOpen) {
        const sb = document.getElementById('ticketSidebar');
        const backdrop = document.getElementById('ticketSidebarBackdrop');
        if (!sb) return;
        if (typeof forceOpen === 'boolean') {
            sb.classList.toggle('open', forceOpen);
            if (backdrop) backdrop.classList.toggle('active', forceOpen);
        } else {
            const isOpen = sb.classList.toggle('open');
            if (backdrop) backdrop.classList.toggle('active', isOpen);
        }
    }

    function closeSidebar() {
        toggleSidebar(false);
    }

    // HTML escape helper
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    const KNOWN_OPERATOR_NAMES = {
        '101': 'Oybek',
        '102': 'Dilnoza',
        '103': 'Feruza',
        '104': 'Zuhra',
        '105': 'Shaxnoza',
        '106': 'Gulchehra',
        '107': 'Madina',
        '108': 'Xurshida',
        '109': 'Sitora',
        '111': 'Nozima',
        '112': 'Nargiza',
        '113': 'Malika',
        '114': 'Maxmudbek',
        '115': 'Nilufar',
        '117': 'Zarnigor',
        '119': 'Muattar',
        '120': 'Navruzoy'
    };

    function updateTicketsHeaderProfile(opName, opId, username, role) {
        const badge = document.getElementById('headerUserProfileBadge');
        const nameEl = document.getElementById('headerUserNameText');
        if (!badge || !nameEl) return;

        let displayName = '';
        const cleanOpId = String(opId || state.myOperatorId || '').trim();

        if (opName && !/^operator\s*\d+$/i.test(String(opName).trim())) {
            displayName = String(opName).replace(/\s*\(\d+\)\s*/g, '').replace('Ubaydullayeva ', '').trim();
        }
        if (!displayName && cleanOpId && KNOWN_OPERATOR_NAMES[cleanOpId]) {
            displayName = KNOWN_OPERATOR_NAMES[cleanOpId];
        }
        if (!displayName) {
            if (cleanOpId) {
                displayName = `Operator ${cleanOpId}`;
            } else if (role === 'superuser' || username === 'superuser') {
                displayName = 'Superuser';
            } else if (username) {
                displayName = username;
            } else {
                displayName = 'Operator';
            }
        }

        nameEl.textContent = displayName;
        const titleText = cleanOpId ? `Joriy profil: ${displayName} (${cleanOpId})` : `Joriy profil: ${displayName}`;
        badge.setAttribute('title', titleText);
        badge.style.display = 'inline-flex';
    }

    async function initTicketsProfileIdentity() {
        if (state.myOperatorId || state.myOperatorName) {
            updateTicketsHeaderProfile(state.myOperatorName, state.myOperatorId);
        }
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                if (data && data.user) {
                    state.currentUser = data.user;
                    state.myUserRole = data.user.role || '';
                    if (data.user.operatorId) {
                        state.myOperatorId = String(data.user.operatorId);
                        state.myOperatorName = String(data.user.operatorName || '');
                    }
                    updateTicketsHeaderProfile(data.user.operatorName, data.user.operatorId, data.user.username, data.user.role);
                    const gmailDot = document.getElementById('headerUserGmailDot');
                    if (gmailDot) {
                        gmailDot.style.display = data.user.email ? 'inline-block' : 'none';
                    }
                }
            }
        } catch (_) {}
    }

    let viewerProfileTimerInterval = null;
    let viewerProfilePendingEmail = '';

    function updateViewerProfileEmailBadge(inputEmail) {
        const statusBadge = document.getElementById('viewerProfileEmailStatusBadge');
        if (!statusBadge) return;
        const currentEmail = (state.currentUser && state.currentUser.email) || (window.currentViewerUser && window.currentViewerUser.email) || '';
        const cleanInput = String(inputEmail || '').trim().toLowerCase();
        const cleanCurrent = String(currentEmail || '').trim().toLowerCase();

        if (cleanCurrent && cleanInput === cleanCurrent) {
            statusBadge.textContent = 'Ulangan';
            statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
            statusBadge.style.color = '#34d399';
            statusBadge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        } else if (cleanInput) {
            statusBadge.textContent = 'Tasdiqlanmagan';
            statusBadge.style.background = 'rgba(245, 158, 11, 0.15)';
            statusBadge.style.color = '#fbbf24';
            statusBadge.style.border = '1px solid rgba(245, 158, 11, 0.3)';
        } else {
            statusBadge.textContent = 'Ulanmagan';
            statusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
            statusBadge.style.color = '#f87171';
            statusBadge.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        }
    }

    function startViewerProfileTimer(seconds = 120) {
        if (viewerProfileTimerInterval) {
            clearInterval(viewerProfileTimerInterval);
            viewerProfileTimerInterval = null;
        }
        let remaining = seconds;
        const timerEl = document.getElementById('viewerProfileTimer');
        const resendBtn = document.getElementById('btnResendViewerProfileCode');

        if (resendBtn) {
            resendBtn.disabled = true;
            resendBtn.style.color = '#64748b';
            resendBtn.style.cursor = 'not-allowed';
        }

        const render = () => {
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            const text = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            if (timerEl) timerEl.textContent = text;
        };
        render();

        viewerProfileTimerInterval = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(viewerProfileTimerInterval);
                viewerProfileTimerInterval = null;
                if (timerEl) timerEl.textContent = '00:00';
                if (resendBtn) {
                    resendBtn.disabled = false;
                    resendBtn.style.color = '#38bdf8';
                    resendBtn.style.cursor = 'pointer';
                }
            } else {
                render();
            }
        }, 1000);
    }

    function resetViewerProfileEmailEdit() {
        if (viewerProfileTimerInterval) {
            clearInterval(viewerProfileTimerInterval);
            viewerProfileTimerInterval = null;
        }
        const verifySection = document.getElementById('viewerProfileVerifySection');
        const emailInput = document.getElementById('viewerProfileEmailInput');
        const btnSend = document.getElementById('btnSendViewerProfileCode');
        const btnVerify = document.getElementById('btnVerifyViewerProfileCode');
        const msgEl = document.getElementById('viewerProfileEmailMsg');

        if (verifySection) verifySection.style.display = 'none';
        if (emailInput) {
            emailInput.readOnly = false;
            emailInput.focus();
        }
        if (btnSend) {
            btnSend.style.display = 'inline-flex';
            btnSend.disabled = false;
        }
        if (btnVerify) {
            btnVerify.style.display = 'none';
        }
        if (msgEl) msgEl.textContent = '';
    }
    window.resetViewerProfileEmailEdit = resetViewerProfileEmailEdit;

    function openViewerProfileModal() {
        const modal = document.getElementById('modalViewerProfile');
        if (!modal) return;

        const u = state.currentUser || window.currentViewerUser || {};
        const unameEl = document.getElementById('viewerProfileModalUsername');
        const roleBadge = document.getElementById('viewerProfileModalRoleBadge');
        const opNameEl = document.getElementById('viewerProfileModalOpName');
        const emailInput = document.getElementById('viewerProfileEmailInput');
        const msgEl = document.getElementById('viewerProfileEmailMsg');
        const codeInput = document.getElementById('viewerProfileCodeInput');

        if (unameEl) unameEl.textContent = u.username || 'operator';
        if (roleBadge) {
            const isSuper = (u.role === 'superuser' || state.myUserRole === 'superuser');
            roleBadge.textContent = isSuper ? 'Superuser' : 'Operator';
            roleBadge.style.color = isSuper ? '#60a5fa' : '#34d399';
            roleBadge.style.background = isSuper ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)';
        }
        if (opNameEl) {
            const nameText = state.myOperatorName || u.operatorName || (state.myOperatorId ? `Operator ${state.myOperatorId}` : '');
            opNameEl.textContent = nameText;
        }
        if (emailInput) {
            emailInput.value = u.email || '';
            emailInput.readOnly = false;
            if (!emailInput._hasInputListener) {
                emailInput.addEventListener('input', () => updateViewerProfileEmailBadge(emailInput.value));
                emailInput._hasInputListener = true;
            }
        }
        if (codeInput) {
            codeInput.value = '';
            if (!codeInput._hasAutoSubmit) {
                codeInput.addEventListener('input', () => {
                    const val = codeInput.value.replace(/\D/g, '').slice(0, 6);
                    codeInput.value = val;
                    if (val.length === 6) {
                        verifyViewerProfileCode();
                    }
                });
                codeInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        verifyViewerProfileCode();
                    }
                });
                codeInput._hasAutoSubmit = true;
            }
        }

        updateViewerProfileEmailBadge(u.email);
        resetViewerProfileEmailEdit();
        if (msgEl) msgEl.textContent = '';

        modal.style.display = 'flex';
        setTimeout(() => {
            if (emailInput) emailInput.focus();
        }, 100);
    }
    window.openViewerProfileModal = openViewerProfileModal;

    function closeViewerProfileModal() {
        if (viewerProfileTimerInterval) {
            clearInterval(viewerProfileTimerInterval);
            viewerProfileTimerInterval = null;
        }
        const modal = document.getElementById('modalViewerProfile');
        if (modal) modal.style.display = 'none';
    }
    window.closeViewerProfileModal = closeViewerProfileModal;

    async function sendViewerProfileCode(event) {
        if (event) event.preventDefault();
        const emailInput = document.getElementById('viewerProfileEmailInput');
        const btnSend = document.getElementById('btnSendViewerProfileCode');
        const btnSendText = document.getElementById('btnSendViewerProfileCodeText');
        const btnVerify = document.getElementById('btnVerifyViewerProfileCode');
        const msgEl = document.getElementById('viewerProfileEmailMsg');
        const verifySection = document.getElementById('viewerProfileVerifySection');
        const codeInput = document.getElementById('viewerProfileCodeInput');

        const email = emailInput?.value?.trim().toLowerCase() || '';
        if (!email) {
            if (msgEl) {
                msgEl.textContent = 'Iltimos, Gmail manzilingizni kiriting';
                msgEl.style.color = '#f87171';
            }
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            if (msgEl) {
                msgEl.textContent = "Email formati noto'g'ri (masalan: ism@gmail.com)";
                msgEl.style.color = '#f87171';
            }
            return;
        }

        if (btnSend) btnSend.disabled = true;
        if (btnSendText) btnSendText.textContent = 'Kod yuborilmoqda...';
        if (msgEl) {
            msgEl.textContent = '';
            msgEl.style.color = '#94a3b8';
        }

        try {
            const res = await fetch('/api/auth/profile/email/send-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (data && data.success) {
                viewerProfilePendingEmail = email;
                if (emailInput) emailInput.readOnly = true;
                if (verifySection) verifySection.style.display = 'block';
                if (btnSend) btnSend.style.display = 'none';
                if (btnVerify) {
                    btnVerify.style.display = 'inline-flex';
                    btnVerify.disabled = false;
                }
                if (msgEl) {
                    msgEl.textContent = data.message || `6 xonali tasdiqlash kodi ${email} manziliga yuborildi`;
                    msgEl.style.color = '#38bdf8';
                }
                startViewerProfileTimer(data.expiresInSeconds || 120);
                if (codeInput) {
                    codeInput.value = '';
                    setTimeout(() => codeInput.focus(), 150);
                }
            } else {
                if (msgEl) {
                    msgEl.textContent = data.error || 'Tasdiqlash kodini yuborishda xatolik yuz berdi';
                    msgEl.style.color = '#f87171';
                }
            }
        } catch (e) {
            if (msgEl) {
                msgEl.textContent = 'Server bilan aloqa xatosi: ' + e.message;
                msgEl.style.color = '#f87171';
            }
        } finally {
            if (btnSend) btnSend.disabled = false;
            if (btnSendText) btnSendText.textContent = 'Tasdiqlash kodini olish';
        }
    }
    window.sendViewerProfileCode = sendViewerProfileCode;

    async function resendViewerProfileCode() {
        const resendBtn = document.getElementById('btnResendViewerProfileCode');
        if (resendBtn && resendBtn.disabled) return;
        await sendViewerProfileCode();
    }
    window.resendViewerProfileCode = resendViewerProfileCode;

    async function verifyViewerProfileCode(event) {
        if (event) event.preventDefault();
        const codeInput = document.getElementById('viewerProfileCodeInput');
        const btnVerify = document.getElementById('btnVerifyViewerProfileCode');
        const btnVerifyText = document.getElementById('btnVerifyViewerProfileCodeText');
        const msgEl = document.getElementById('viewerProfileEmailMsg');
        const statusBadge = document.getElementById('viewerProfileEmailStatusBadge');
        const gmailDot = document.getElementById('headerUserGmailDot');
        const emailInput = document.getElementById('viewerProfileEmailInput');

        const email = viewerProfilePendingEmail || emailInput?.value?.trim().toLowerCase() || '';
        const code = codeInput?.value?.trim().replace(/\D/g, '') || '';

        if (!code || code.length !== 6) {
            if (msgEl) {
                msgEl.textContent = "Iltimos, 6 xonali tasdiqlash kodini to'liq kiriting";
                msgEl.style.color = '#f87171';
            }
            if (codeInput) codeInput.focus();
            return;
        }

        if (btnVerify) btnVerify.disabled = true;
        if (btnVerifyText) btnVerifyText.textContent = 'Tasdiqlanmoqda...';
        if (msgEl) msgEl.textContent = '';

        try {
            const res = await fetch('/api/auth/profile/email/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code })
            });
            const data = await res.json();
            if (data && data.success) {
                if (viewerProfileTimerInterval) {
                    clearInterval(viewerProfileTimerInterval);
                    viewerProfileTimerInterval = null;
                }
                if (state.currentUser) {
                    state.currentUser.email = data.email;
                }
                if (window.currentViewerUser) {
                    window.currentViewerUser.email = data.email;
                }
                if (statusBadge) {
                    statusBadge.textContent = 'Ulangan';
                    statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                    statusBadge.style.color = '#34d399';
                    statusBadge.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                }
                if (gmailDot) {
                    gmailDot.style.display = 'inline-block';
                }
                if (emailInput) {
                    emailInput.value = data.email;
                    emailInput.readOnly = false;
                }
                const verifySection = document.getElementById('viewerProfileVerifySection');
                if (verifySection) verifySection.style.display = 'none';

                const btnSend = document.getElementById('btnSendViewerProfileCode');
                if (btnSend) btnSend.style.display = 'inline-flex';
                if (btnVerify) btnVerify.style.display = 'none';

                if (msgEl) {
                    msgEl.textContent = data.message || "Gmail manzilingiz muvaffaqiyatli tasdiqlandi va bog'landi!";
                    msgEl.style.color = '#34d399';
                }
                setTimeout(() => {
                    closeViewerProfileModal();
                }, 1400);
            } else {
                if (msgEl) {
                    msgEl.textContent = data.error || "Tasdiqlash kodi noto'g'ri";
                    msgEl.style.color = '#f87171';
                }
                if (codeInput) {
                    codeInput.focus();
                    codeInput.select();
                }
            }
        } catch (e) {
            if (msgEl) {
                msgEl.textContent = 'Server bilan aloqa xatosi: ' + e.message;
                msgEl.style.color = '#f87171';
            }
        } finally {
            if (btnVerify) btnVerify.disabled = false;
            if (btnVerifyText) btnVerifyText.textContent = 'Tasdiqlash va Bog\'lash';
        }
    }
    window.verifyViewerProfileCode = verifyViewerProfileCode;
    window.saveViewerProfileEmail = sendViewerProfileCode;

    // Init
    function init() {
        initTicketsProfileIdentity();
        loadTickets();
        setupGlobalClipboardPaste();

        // Unlock audio context on first user interaction
        ['click', 'keydown', 'touchstart'].forEach(evt => {
            window.addEventListener(evt, () => {
                getAudioContext();
            }, { once: true, passive: true });
        });

        setupDragAndDrop('newTicketDropzone', 'newTicketPreviewStrip', 'attachedFiles');
        setupDragAndDrop('replyTicketDropzone', 'replyTicketPreviewStrip', 'replyAttachedFiles');

        // File inputs
        const newFileInput = document.getElementById('newTicketFileInput');
        if (newFileInput) {
            newFileInput.addEventListener('change', (e) => handleFileInputChange(e, 'newTicketPreviewStrip', 'attachedFiles'));
        }
        const replyFileInput = document.getElementById('replyTicketFileInput');
        if (replyFileInput) {
            replyFileInput.addEventListener('change', (e) => handleFileInputChange(e, 'replyTicketPreviewStrip', 'replyAttachedFiles'));
        }

        updateSoundToggleButtons();

        // Horizontal mouse wheel scroll on filter tabs
        document.querySelectorAll('.tk-sb-tabs, .ticket-sidebar-filter, .kds-stats-tabs').forEach(el => {
            el.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    el.scrollLeft += (e.deltaY * 0.8);
                }
            }, { passive: false });
        });

        // Attach click handlers to close on Escape and Ctrl + ; to open impersonate modal
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && (e.key === ';' || e.code === 'Semicolon' || e.keyCode === 186 || e.keyCode === 59)) {
                e.preventDefault();
                openImpersonateModal();
            }
            if (e.key === 'Escape') {
                closeDocViewer();
                closeLightbox();
                closeTicketBox();
                closeCreateModal();
                closeSidebar();
                closeImpersonateModal();
            }
        });
    }

    // =========================================================================
    // QUICK IMPERSONATION (CTRL + ;)
    // =========================================================================
    function openImpersonateModal() {
        const modal = document.getElementById('impersonateModal');
        if (!modal) return;
        modal.classList.add('open');
        loadQuickImpersonateList();
    }

    function closeImpersonateModal() {
        const modal = document.getElementById('impersonateModal');
        if (modal) modal.classList.remove('open');
    }

    async function loadQuickImpersonateList() {
        const container = document.getElementById('impersonateOpGrid');
        if (!container) return;
        container.innerHTML = '<div style="color: #94a3b8; font-size: 12px; grid-column: 1/-1;">Faol operatorlar va tokenlar yuklanmoqda...</div>';

        try {
            const res = await fetch('/api/viewer/sessions');
            const data = await res.json();
            const sessions = (data && data.success) ? (data.sessions || []) : [];

            const presets = [
                { id: '101', name: 'Oybek', ip: '192.168.0.17' },
                { id: '103', name: 'Feruza', ip: '192.168.0.100' },
                { id: '106', name: 'Gulchehra', ip: '192.168.0.106' },
                { id: '111', name: 'Nozima', ip: '192.168.0.19' },
                { id: '114', name: 'Maxmudbek', ip: '192.168.0.114' },
                { id: '119', name: 'Muattar', ip: '192.168.0.15' },
                { id: '120', name: 'Navruzoy', ip: '192.168.0.18' }
            ];

            let html = '';
            presets.forEach(p => {
                const foundSession = sessions.find(s => s.ip === p.ip || (s.operator && String(s.operator.id) === String(p.id)));
                const hasLiveToken = Boolean(foundSession);
                html += `
                    <div class="impersonate-op-card" onclick="window.TicketsApp.applyOperatorImpersonation('${foundSession ? foundSession.token : ''}', '${p.id}', '${p.name}')">
                        <div>
                            <div style="font-weight: 700; color: #f1f5f9; font-size: 13px;">${p.id} - ${p.name}</div>
                            <div style="font-size: 11px; color: #94a3b8;">IP: ${p.ip}</div>
                            <div style="font-size: 10.5px; margin-top: 3px; color: ${hasLiveToken ? '#34d399' : '#64748b'}; font-weight: 600;">
                                ${hasLiveToken ? '● Faol token mavjud' : '○ Standart hisob'}
                            </div>
                        </div>
                        <button type="button" class="btn-session-switch" style="padding: 6px 12px; font-size: 11.5px;">
                            O'tish
                        </button>
                    </div>
                `;
            });

            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<div style="color:#f87171;font-size:12px;">Yuklashda xatolik: ${escapeHtml(e.message)}</div>`;
        }
    }

    function applyOperatorImpersonation(token, opId, opName) {
        if (token) {
            document.cookie = `cc_session=${token}; path=/; max-age=${7 * 24 * 3600}; SameSite=Lax`;
            localStorage.setItem('cc_session', token);
        }
        localStorage.setItem('viewer_my_operator_id', opId);
        localStorage.setItem('viewer_my_operator_name', opName);
        alert(`${opName} (${opId}) nomiga o'tildi!`);
        setTimeout(() => {
            window.location.reload();
        }, 300);
    }

    function applyManualTokenSwitch() {
        const input = document.getElementById('manualImpersonateTokenInput');
        const token = input ? input.value.trim() : '';
        if (!token) {
            alert("Iltimos, tokenni kiriting!");
            return;
        }
        document.cookie = `cc_session=${token}; path=/; max-age=${7 * 24 * 3600}; SameSite=Lax`;
        localStorage.setItem('cc_session', token);
        alert("Yangi token bilan qayta yuklanmoqda...");
        setTimeout(() => {
            window.location.reload();
        }, 300);
    }

    window.openImpersonateModal = openImpersonateModal;
    window.closeImpersonateModal = closeImpersonateModal;
    window.applyOperatorImpersonation = applyOperatorImpersonation;
    window.applyManualTokenSwitch = applyManualTokenSwitch;

// Expose global controller
window.TicketsApp = {
    init,
    openCreateModal,
    closeCreateModal,
    openEditModal,
    closeEditModal,
    handleEditSubmit,
    openBox: openTicketBox,
    closeBox: closeTicketBox,
    acceptCurrentTicket,
    completeCurrentTicket,
    rejectCurrentTicket,
    deleteCurrentTicket,
    submitReply,
    handleCreateSubmit,
    removeAttachedFile,
    previewAttachedFileAtIndex,
    openDocViewer,
    closeDocViewer,
    openFileViewer: openDocViewer,
    openLightbox,
    closeLightbox,
    handleWsEvent,
    setFilter,
    toggleSidebar,
    closeSidebar,
    toggleSound,
    testSound: () => playNotificationSound(true),
    openImpersonateModal,
    closeImpersonateModal,
    loadQuickImpersonateList,
    applyOperatorImpersonation,
    applyManualTokenSwitch,
    setOperatorIdentity: (id, name, role) => {
        state.myOperatorId = id;
        state.myOperatorName = name;
        if (role) state.myUserRole = role;
        updateTicketsHeaderProfile(name, id, null, role);
        loadTickets();
    }
};

    // Auto-init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
