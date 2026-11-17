/**
 * passkey-client.js (vanilla JS, framework talab qilmaydi)
 *
 * Oldindan yuklanishi kerak:
 *   <script src="/vendor/simplewebauthn-browser.js"></script>
 * Bu global `SimpleWebAuthnBrowser` obyektini beradi.
 *
 * Keyin:
 *   <script src="/js/passkey-client.js"></script>
 *   Passkey.mountLoginButton(document.getElementById('passkey-login'), { onSuccess: () => location.reload() });
 *   Passkey.mountManager(document.getElementById('passkey-manager')); // profil modali ichida
 *   Passkey.offerAfterPasswordLogin(); // parol bilan kirgandan keyin
 */
(function () {
  'use strict';

  const BASE = '/api/auth/webauthn';
  const DISMISS_KEY = 'passkey_offer_dismissed_v1';

  // ---------- Yordamchilar ----------
  async function post(path, body) {
    const res = await fetch(BASE + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    let data = null;
    try { data = await res.json(); } catch (_) { /* bo'sh javob */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'So\'rov xatosi (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function isSupported() {
    return !!(window.PublicKeyCredential && 
      (!window.SimpleWebAuthnBrowser || window.SimpleWebAuthnBrowser.browserSupportsWebAuthn()));
  }

  function friendlyError(err) {
    const name = err && (err.name || err.code);
    if (name === 'NotAllowedError') return 'Bekor qilindi yoki vaqt tugadi';
    if (name === 'InvalidStateError' || name === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
      return 'Bu qurilma allaqachon ulangan';
    }
    if (name === 'SecurityError') return 'Xavfsizlik xatosi: sahifa HTTPS va to\'g\'ri domen orqali ochilishi kerak';
    return (err && err.message) || 'Noma\'lum xatolik';
  }

  function guessDeviceName() {
    const ua = navigator.userAgent || '';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android telefon';
    if (/Windows/i.test(ua)) return 'Windows kompyuter';
    if (/Mac/i.test(ua)) return 'Mac';
    return 'Mening qurilmam';
  }

  function safeStorage() {
    try { return window.localStorage; } catch (_) { return null; }
  }

  function el(tag, props, children) {
    const n = document.createElement(tag);
    Object.assign(n, props || {});
    (children || []).forEach((c) => n.append(c));
    return n;
  }

  // ---------- Uslublar (bir marta qo'shiladi) ----------
  function injectStyles() {
    if (document.getElementById('passkey-styles')) return;
    const css = `
      .pk-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:11px 16px;
        border-radius:10px;border:1px solid #3b82f6;background:rgba(59,130,246,.12);color:inherit;font:inherit;
        font-weight:600;cursor:pointer;transition:background .15s,box-shadow .15s}
      .pk-btn:hover{background:rgba(59,130,246,.22);box-shadow:0 0 12px rgba(59,130,246,.35)}
      .pk-btn[disabled]{opacity:.6;cursor:wait}
      .pk-btn.secondary{border-color:rgba(128,128,128,.5);background:transparent}
      .pk-msg{margin-top:8px;font-size:.9em;min-height:1.2em}
      .pk-msg.err{color:#dc2626}.pk-msg.ok{color:#16a34a}
      .pk-list{list-style:none;margin:8px 0;padding:0}
      .pk-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;
        border:1px solid rgba(128,128,128,.3);border-radius:8px;margin-bottom:6px}
      .pk-item small{opacity:.7;display:block}
      .pk-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;
        justify-content:center;z-index:99999}
      .pk-dialog{background:#0f172a;color:#f8fafc;border:1px solid rgba(148,163,184,0.25);border-radius:14px;padding:22px;width:min(92vw,390px);
        box-shadow:0 12px 48px rgba(0,0,0,.6);font-family:inherit}
      .pk-dialog h3{margin:0 0 8px;font-size:1.15rem;font-weight:700}
      .pk-dialog p{margin:0 0 14px;font-size:.92em;opacity:.85;line-height:1.45}
      .pk-dialog input{width:100%;box-sizing:border-box;padding:10px 12px;margin-bottom:12px;border-radius:8px;
        border:1px solid rgba(148,163,184,.3);background:rgba(15,23,42,.6);color:#f8fafc;font:inherit}
      .pk-dialog input:focus{outline:none;border-color:#38bdf8;box-shadow:0 0 10px rgba(56,189,248,0.3)}
      .pk-row{display:flex;gap:10px}
    `;
    document.head.appendChild(el('style', { id: 'passkey-styles', textContent: css }));
  }

  // ---------- Asosiy amallar ----------
  async function login() {
    const optionsJSON = await post('/login-options');
    const assertion = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
    return post('/login-verify', assertion);
  }

  async function register(password, deviceName) {
    const optionsJSON = await post('/register-options', { password, deviceName });
    const attestation = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON });
    return post('/register-verify', attestation);
  }

  const listPasskeys = () => post('/passkeys/list').then((d) => d.passkeys || []);
  const removePasskey = (id) => post('/passkeys/delete', { id });

  // ---------- Parol + qurilma nomi oynasi ----------
  function askPasswordDialog() {
    injectStyles();
    return new Promise((resolve) => {
      const pass = el('input', { type: 'password', placeholder: 'Joriy parol', autocomplete: 'current-password' });
      const name = el('input', { type: 'text', placeholder: 'Qurilma nomi', value: guessDeviceName(), maxLength: 60 });
      const msg = el('div', { className: 'pk-msg err' });
      const ok = el('button', { className: 'pk-btn', textContent: 'Ulash' });
      const cancel = el('button', { className: 'pk-btn secondary', textContent: 'Bekor qilish' });
      const dialog = el('div', { className: 'pk-dialog' }, [
        el('h3', { textContent: '👆 Barmoq izini ulash' }),
        el('p', { textContent: 'Xavfsizlik uchun joriy parolingizni kiriting va qurilmaga nom bering.' }),
        pass, name, msg, el('div', { className: 'pk-row' }, [cancel, ok]),
      ]);
      const overlay = el('div', { className: 'pk-overlay' }, [dialog]);
      const close = (v) => { overlay.remove(); resolve(v); };

      ok.onclick = () => {
        if (!pass.value) { msg.textContent = 'Parolni kiriting'; return; }
        if (!name.value.trim()) { msg.textContent = 'Qurilma nomini kiriting'; return; }
        close({ password: pass.value, deviceName: name.value.trim() });
      };
      cancel.onclick = () => close(null);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      document.body.appendChild(overlay);
      pass.focus();
    });
  }

  /** Dialog -> register. Muvaffaqiyatli bo'lsa true. */
  async function startAddFlow(setMsg) {
    const input = await askPasswordDialog();
    if (!input) return false;
    try {
      await register(input.password, input.deviceName);
      setMsg && setMsg('Qurilma muvaffaqiyatli ulandi', 'ok');
      return true;
    } catch (err) {
      setMsg && setMsg(friendlyError(err), 'err');
      return false;
    }
  }

  // ---------- Login tugmasi ----------
  function mountLoginButton(container, opts) {
    if (!container) return;
    injectStyles();
    container.textContent = '';
    const onSuccess = (opts && opts.onSuccess) || (() => location.reload());
    const btn = el('button', { type: 'button', className: 'pk-btn', textContent: '👆 Barmoq izi / Face ID orqali kirish' });
    const msg = el('div', { className: 'pk-msg err' });
    btn.onclick = async () => {
      if (!isSupported()) {
        if (!window.isSecureContext || location.protocol !== 'https:') {
          msg.textContent = 'Biometrik kirish faqat xavfsiz HTTPS (https://uniconsoft.ddns.net) orqali ishlaydi!';
        } else {
          msg.textContent = 'Ushbu brauzerda biometrik tizim qo\'llab-quvvatlanmaydi';
        }
        return;
      }
      btn.disabled = true;
      msg.textContent = '';
      try {
        const data = await login();
        onSuccess(data);
      } catch (err) {
        msg.textContent = friendlyError(err);
      } finally {
        btn.disabled = false;
      }
    };
    container.append(btn, msg);
  }

  // ---------- Profil modalidagi boshqaruv ----------
  function mountManager(container) {
    if (!container) return;
    injectStyles();
    container.textContent = '';
    if (!isSupported()) {
      container.append(el('p', { textContent: 'Bu brauzer biometrik kirishni qo\'llab-quvvatlamaydi.' }));
      return;
    }
    const list = el('ul', { className: 'pk-list' });
    const msg = el('div', { className: 'pk-msg' });
    const setMsg = (t, kind) => { msg.textContent = t || ''; msg.className = 'pk-msg ' + (kind || ''); };
    const addBtn = el('button', { type: 'button', className: 'pk-btn', textContent: '+ Ushbu qurilma barmoq izini ulash' });

    async function refresh() {
      list.textContent = '';
      try {
        const items = await listPasskeys();
        if (!items.length) {
          list.append(el('li', { className: 'pk-item', textContent: 'Hali qurilma ulanmagan' }));
          return;
        }
        items.forEach((pk) => {
          const info = el('div', {}, [
            el('span', { textContent: '🔑 ' + pk.device_name }), // textContent: XSS xavfsiz
            el('small', { textContent: 'Ulangan: ' + (pk.created_at || '-') +
              (pk.last_used_at ? ' · Oxirgi kirish: ' + pk.last_used_at : '') }),
          ]);
          const del = el('button', { type: 'button', className: 'pk-btn secondary', textContent: 'O\'chirish' });
          del.style.width = 'auto';
          del.onclick = async () => {
            if (!confirm('"' + pk.device_name + '" qurilmasini o\'chirasizmi?')) return;
            try { await removePasskey(pk.id); setMsg('O\'chirildi', 'ok'); refresh(); }
            catch (err) { setMsg(friendlyError(err), 'err'); }
          };
          list.append(el('li', { className: 'pk-item' }, [info, del]));
        });
      } catch (err) {
        setMsg(friendlyError(err), 'err');
      }
    }

    addBtn.onclick = async () => {
      addBtn.disabled = true;
      setMsg('');
      if (await startAddFlow(setMsg)) refresh();
      addBtn.disabled = false;
    };

    container.append(el('h4', { textContent: 'Biometrik kirish (Passkey)', style: 'margin: 0 0 10px 0; font-size: 1rem; color: #38bdf8;' }), list, addBtn, msg);
    refresh();
  }

  // ---------- Parol bilan kirgandan keyin aqlli taklif ----------
  async function offerAfterPasswordLogin() {
    if (!isSupported()) return;
    const store = safeStorage();
    if (store && store.getItem(DISMISS_KEY) === '1') return;

    try {
      const existing = await listPasskeys();
      if (existing.length > 0) return;
    } catch (_) { return; }

    injectStyles();
    const yes = el('button', { className: 'pk-btn', textContent: 'Ha, ulash' });
    const later = el('button', { className: 'pk-btn secondary', textContent: 'Keyinroq' });
    const never = el('button', { className: 'pk-btn secondary', textContent: 'Boshqa so\'ramang' });
    const dialog = el('div', { className: 'pk-dialog' }, [
      el('h3', { textContent: '👆 Tezroq kirishni xohlaysizmi?' }),
      el('p', { textContent: 'Keyingi safar barmoq izi yoki Face ID bilan bir teginishda kirishingiz mumkin. Parol ham saqlanib qoladi.' }),
      el('div', { className: 'pk-row' }, [later, yes]),
      el('div', { style: 'margin-top:8px' }, [never]),
    ]);
    const overlay = el('div', { className: 'pk-overlay' }, [dialog]);
    document.body.appendChild(overlay);

    later.onclick = () => overlay.remove();
    never.onclick = () => { if (store) { try { store.setItem(DISMISS_KEY, '1'); } catch (_) {} } overlay.remove(); };
    yes.onclick = async () => {
      overlay.remove();
      const ok = await startAddFlow((t, kind) => {
        if (kind === 'err') alert(t);
        else if (kind === 'ok') alert('🎉 Barmoq izingiz muvaffaqiyatli ulandi! Endi login sahifasida bir teginishda kira olasiz.');
      });
      if (ok) {
        document.querySelectorAll('.pk-overlay').forEach(o => o.remove());
      }
    };
  }

  window.Passkey = {
    isSupported, login, register, listPasskeys, removePasskey,
    mountLoginButton, mountManager, offerAfterPasswordLogin,
  };
})();

