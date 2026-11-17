'use strict';

/**
 * services/webauthnService.js
 *
 * WebAuthn / Passkey xizmati (Node.js 24, node:sqlite, @simplewebauthn/server v10+).
 *
 * Ishlatilishi (app.js yoki viewer/app.js):
 *
 *   const { DatabaseSync } = require('node:sqlite');
 *   const db = new DatabaseSync('./data.db');
 *   const webauthn = require('./services/webauthnService').createWebAuthnService({
 *     db,
 *     cookieName: 'cc_viewer_session',          // Dashboard uchun 'cc_session'
 *     verifyPassword: (userRow, password) => myCheckPassword(userRow, password),
 *     getUserLabels: (u) => ({ userName: ..., displayName: ... }), // ixtiyoriy
 *     isUserAllowed: (u) => true,                                   // ixtiyoriy
 *   });
 *   webauthn.mount(app, { requireAuth });       // requireAuth req.user.username ni o'rnatishi kerak
 *
 * Talab: express.json() (yoki shunga o'xshash) body parser oldindan ulangan bo'lsin.
 */

const crypto = require('node:crypto');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { isoUint8Array } = require('@simplewebauthn/server/helpers');

// ---------------------------------------------------------------------------
// Konfiguratsiya (.env)
// ---------------------------------------------------------------------------
function loadConfig(env = process.env) {
  const rpID = (env.WEBAUTHN_RP_ID || '').trim();
  const rpName = (env.WEBAUTHN_RP_NAME || 'Call Center AI').trim();
  const expectedOrigins = (env.WEBAUTHN_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!rpID) throw new Error('WEBAUTHN_RP_ID .env da ko\'rsatilmagan');
  if (expectedOrigins.length === 0) throw new Error('WEBAUTHN_ORIGINS .env da ko\'rsatilmagan');

  return { rpID, rpName, expectedOrigins };
}

// ---------------------------------------------------------------------------
// Kichik yordamchilar
// ---------------------------------------------------------------------------
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const MAX_CHALLENGES = 5000;
const MAX_PASSKEYS_PER_USER = 10;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Oddiy oyna asosidagi limiter: true = ruxsat. */
function createLimiter(max, windowMs) {
  const buckets = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, 60_000);
  timer.unref?.();

  return function allow(key) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    return b.count <= max;
  };
}

/** Muvaffaqiyatsiz urinishlar hisoblagichi. */
function createFailTracker(max, windowMs) {
  const map = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of map) if (b.resetAt <= now) map.delete(k);
  }, 60_000);
  timer.unref?.();

  return {
    isBlocked(key) {
      const b = map.get(key);
      return !!b && b.resetAt > Date.now() && b.count >= max;
    },
    fail(key) {
      const now = Date.now();
      let b = map.get(key);
      if (!b || b.resetAt <= now) {
        b = { count: 0, resetAt: now + windowMs };
        map.set(key, b);
      }
      b.count += 1;
    },
    reset(key) {
      map.delete(key);
    },
  };
}

function readClientChallenge(body) {
  try {
    const raw = body?.response?.clientDataJSON;
    if (typeof raw !== 'string') return null;
    const data = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return typeof data.challenge === 'string' ? data.challenge : null;
  } catch {
    return null;
  }
}

function parseTransports(text) {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Asosiy factory
// ---------------------------------------------------------------------------
function createWebAuthnService(options) {
  const {
    db,
    cookieName,
    verifyPassword,
    getUserLabels,
    isUserAllowed = () => true,
    sessionDays = 30,
    config = loadConfig(),
  } = options;

  if (!db) throw new Error('db (node:sqlite DatabaseSync) berilmadi');
  if (!cookieName) throw new Error('cookieName berilmadi');
  if (typeof verifyPassword !== 'function') throw new Error('verifyPassword(userRow, password) funksiyasi kerak');

  // ---- Migratsiya ---------------------------------------------------------
  function migrate() {
    db.exec('PRAGMA foreign_keys = ON;');

    const userCols = db.prepare('PRAGMA table_info(auth_users);').all();
    if (!userCols.some((c) => c.name === 'webauthn_user_id')) {
      db.exec('ALTER TABLE auth_users ADD COLUMN webauthn_user_id TEXT;');
    }
    // SQLite ADD COLUMN ichida UNIQUE bo'lmaydi, shuning uchun unique index:
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_webauthn_uid ON auth_users(webauthn_user_id);');

    const sessCols = db.prepare('PRAGMA table_info(auth_sessions);').all();
    if (!sessCols.some((c) => c.name === 'passkey_id')) {
      db.exec('ALTER TABLE auth_sessions ADD COLUMN passkey_id TEXT;');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_passkey ON auth_sessions(passkey_id);');

    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_passkeys (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        webauthn_user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        operator_id TEXT,
        public_key BLOB NOT NULL,
        counter INTEGER DEFAULT 0,
        device_type TEXT,
        backed_up INTEGER DEFAULT 0,
        transports TEXT,
        device_name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        last_used_at TEXT,
        FOREIGN KEY(user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_passkeys_uid ON auth_passkeys(user_id);
      CREATE INDEX IF NOT EXISTS idx_passkeys_wuid ON auth_passkeys(webauthn_user_id);
    `);

    // Backfill: mavjud foydalanuvchilarga doimiy UUID
    const missing = db
      .prepare("SELECT id FROM auth_users WHERE webauthn_user_id IS NULL OR webauthn_user_id = ''")
      .all();
    const upd = db.prepare('UPDATE auth_users SET webauthn_user_id = ? WHERE id = ?');
    for (const u of missing) upd.run(crypto.randomUUID(), u.id);
  }
  migrate();

  // ---- DB funksiyalari ----------------------------------------------------
  const q = {
    userByUsername: db.prepare('SELECT * FROM auth_users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM auth_users WHERE id = ?'),
    passkeyById: db.prepare('SELECT * FROM auth_passkeys WHERE id = ?'),
    passkeysByUser: db.prepare('SELECT * FROM auth_passkeys WHERE user_id = ? ORDER BY created_at'),
    insertPasskey: db.prepare(`
      INSERT INTO auth_passkeys
        (id, user_id, webauthn_user_id, username, operator_id, public_key, counter,
         device_type, backed_up, transports, device_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    touchPasskey: db.prepare(
      "UPDATE auth_passkeys SET counter = ?, last_used_at = datetime('now', 'localtime') WHERE id = ?"
    ),
    deletePasskey: db.prepare('DELETE FROM auth_passkeys WHERE id = ?'),
    deleteSessionsByPasskey: db.prepare('DELETE FROM auth_sessions WHERE passkey_id = ?'),
    insertSession: db.prepare(
      'INSERT INTO auth_sessions (token, username, ip, user_agent, expires_at, passkey_id) VALUES (?, ?, ?, ?, ?, ?)'
    ),
  };

  function ensureWebAuthnUserId(user) {
    if (user.webauthn_user_id) return user.webauthn_user_id;
    const id = crypto.randomUUID();
    db.prepare('UPDATE auth_users SET webauthn_user_id = ? WHERE id = ? AND (webauthn_user_id IS NULL OR webauthn_user_id = \'\')').run(id, user.id);
    return q.userById.get(user.id).webauthn_user_id;
  }

  function labelsFor(user) {
    if (typeof getUserLabels === 'function') {
      const l = getUserLabels(user);
      if (l?.userName && l?.displayName) return l;
    }
    // Standart: operator bo'lsa "200 · username", aks holda username.
    if (user.operator_id) {
      return {
        userName: `${user.operator_id} · ${user.username}`,
        displayName: `Operator ${user.operator_id} (${user.username})`,
      };
    }
    return { userName: user.username, displayName: user.username };
  }

  // ---- Challenge keshi ----------------------------------------------------
  const challenges = new Map(); // challenge -> { type, userId?, deviceName?, expiresAt }

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of challenges) if (v.expiresAt <= now) challenges.delete(k);
  }, 60_000);
  sweeper.unref?.();

  function storeChallenge(challenge, data) {
    if (challenges.size >= MAX_CHALLENGES) {
      const oldest = challenges.keys().next().value;
      if (oldest !== undefined) challenges.delete(oldest);
    }
    challenges.set(challenge, { ...data, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  }

  /** Bir martalik: topadi va darhol o'chiradi. Turi mos bo'lmasa ham o'chiradi. */
  function takeChallenge(challenge, type) {
    if (!challenge) return null;
    const entry = challenges.get(challenge);
    if (!entry) return null;
    challenges.delete(challenge);
    if (entry.type !== type || entry.expiresAt <= Date.now()) return null;
    return entry;
  }

  // ---- Limiterlar ---------------------------------------------------------
  const ipLimiter = createLimiter(60, 60_000); // login-options / login-verify uchun IP bo'yicha
  const ipFails = createFailTracker(30, 60_000); // noma'lum credential urinishlari (IP)
  const passkeyFails = createFailTracker(5, 60_000); // credential bo'yicha
  const reauthFails = createFailTracker(5, 5 * 60_000); // parol re-auth (foydalanuvchi bo'yicha)

  // ---- Sessiya ------------------------------------------------------------
  function createSession(user, passkeyId, req, res) {
    const token = crypto.randomBytes(32).toString('hex');
    const maxAge = sessionDays * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
    const ua = String(req.headers['user-agent'] || '').slice(0, 255);

    q.insertSession.run(token, user.username, clientIp(req), ua, expiresAt, passkeyId);

    res.setHeader(
      'Set-Cookie',
      `${cookieName}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
    );
    return token;
  }

  function currentUser(req) {
    const username = req.user?.username;
    return username ? q.userByUsername.get(username) : null;
  }

  function isAdminRole(role) {
    return role === 'superuser' || role === 'admin';
  }

  // ---- Handlerlar ---------------------------------------------------------

  // 1) POST /register-options  (autentifikatsiya + parol re-auth)
  async function registerOptions(req, res) {
    try {
      const user = currentUser(req);
      if (!user) return json(res, 401, { ok: false, error: 'Avtorizatsiya talab qilinadi' });

      const { password, deviceName } = req.body || {};
      const name = String(deviceName || '').trim().slice(0, 60);
      if (!name) return json(res, 400, { ok: false, error: 'Qurilma nomini kiriting' });

      const reKey = `u:${user.id}`;
      if (reauthFails.isBlocked(reKey)) {
        return json(res, 429, { ok: false, error: 'Juda ko\'p urinish. Birozdan keyin qayta urining' });
      }
      if (typeof password !== 'string' || !(await verifyPassword(user, password))) {
        reauthFails.fail(reKey);
        return json(res, 403, { ok: false, error: 'Parol noto\'g\'ri' });
      }
      reauthFails.reset(reKey);

      const existing = q.passkeysByUser.all(user.id);
      if (existing.length >= MAX_PASSKEYS_PER_USER) {
        return json(res, 400, { ok: false, error: `Eng ko'pi bilan ${MAX_PASSKEYS_PER_USER} ta qurilma ulash mumkin` });
      }

      const webauthnUserId = ensureWebAuthnUserId(user);
      const { userName, displayName } = labelsFor(user);

      const opts = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpID,
        userID: isoUint8Array.fromUTF8String(webauthnUserId),
        userName,
        userDisplayName: displayName,
        attestationType: 'none',
        excludeCredentials: existing.map((pk) => ({
          id: pk.id,
          transports: parseTransports(pk.transports),
        })),
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
      });

      storeChallenge(opts.challenge, { type: 'registration', userId: user.id, deviceName: name });
      return json(res, 200, opts);
    } catch (err) {
      console.error('[webauthn] register-options:', err);
      return json(res, 500, { ok: false, error: 'Ichki xatolik' });
    }
  }

  // 2) POST /register-verify
  async function registerVerify(req, res) {
    try {
      const user = currentUser(req);
      if (!user) return json(res, 401, { ok: false, error: 'Avtorizatsiya talab qilinadi' });

      const body = req.body;
      const challenge = readClientChallenge(body);
      const cached = takeChallenge(challenge, 'registration');
      if (!cached || cached.userId !== user.id) {
        return json(res, 400, { ok: false, error: 'Challenge yaroqsiz yoki muddati o\'tgan' });
      }

      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: config.expectedOrigins,
        expectedRPID: config.rpID,
        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return json(res, 400, { ok: false, error: 'Tasdiqlanmadi' });
      }

      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

      if (q.passkeyById.get(credential.id)) {
        return json(res, 409, { ok: false, error: 'Bu kalit allaqachon ulangan' });
      }

      const webauthnUserId = ensureWebAuthnUserId(user);
      q.insertPasskey.run(
        credential.id,
        user.id,
        webauthnUserId,
        user.username,
        user.operator_id ?? null,
        credential.publicKey, // Uint8Array
        credential.counter ?? 0,
        credentialDeviceType ?? null,
        credentialBackedUp ? 1 : 0,
        credential.transports ? JSON.stringify(credential.transports) : null,
        cached.deviceName
      );

      return json(res, 200, { ok: true, message: 'Passkey muvaffaqiyatli saqlandi' });
    } catch (err) {
      console.error('[webauthn] register-verify:', err);
      return json(res, 400, { ok: false, error: 'Ro\'yxatdan o\'tkazishda xatolik' });
    }
  }

  // 3) POST /login-options  (anonim, IP bo'yicha limit)
  async function loginOptions(req, res) {
    try {
      if (!ipLimiter(`opt:${clientIp(req)}`)) {
        return json(res, 429, { ok: false, error: 'Juda ko\'p so\'rov' });
      }
      const opts = await generateAuthenticationOptions({
        rpID: config.rpID,
        userVerification: 'required',
        allowCredentials: [], // discoverable credential: qurilma o'zi akkaunt tanlash oynasini chiqaradi
      });
      storeChallenge(opts.challenge, { type: 'authentication' });
      return json(res, 200, opts);
    } catch (err) {
      console.error('[webauthn] login-options:', err);
      return json(res, 500, { ok: false, error: 'Ichki xatolik' });
    }
  }

  // 4) POST /login-verify
  async function loginVerify(req, res) {
    const ip = clientIp(req);
    const reject = (status = 401) => json(res, status, { ok: false, error: 'Kirish rad etildi' });

    try {
      if (!ipLimiter(`ver:${ip}`) || ipFails.isBlocked(ip)) {
        return json(res, 429, { ok: false, error: 'Juda ko\'p urinish. Birozdan keyin qayta urining' });
      }

      const body = req.body;
      const challenge = readClientChallenge(body);
      const cached = takeChallenge(challenge, 'authentication');
      if (!cached) {
        ipFails.fail(ip);
        return reject(400);
      }

      const passkey = typeof body?.id === 'string' ? q.passkeyById.get(body.id) : null;
      if (!passkey) {
        ipFails.fail(ip);
        return reject();
      }
      if (passkeyFails.isBlocked(passkey.id)) {
        return json(res, 429, { ok: false, error: 'Juda ko\'p urinish. Birozdan keyin qayta urining' });
      }

      // userHandle discoverable loginda majburiy
      const handleB64 = body?.response?.userHandle;
      if (typeof handleB64 !== 'string' || !handleB64) {
        passkeyFails.fail(passkey.id);
        return reject();
      }
      const decodedHandle = Buffer.from(handleB64, 'base64url').toString('utf8');
      if (decodedHandle !== passkey.webauthn_user_id) {
        passkeyFails.fail(passkey.id);
        return reject();
      }

      const user = q.userById.get(passkey.user_id);
      if (!user || user.webauthn_user_id !== passkey.webauthn_user_id || !isUserAllowed(user)) {
        passkeyFails.fail(passkey.id);
        return reject();
      }

      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: config.expectedOrigins,
        expectedRPID: config.rpID,
        credential: {
          id: passkey.id,
          publicKey: new Uint8Array(passkey.public_key),
          counter: passkey.counter ?? 0,
          transports: parseTransports(passkey.transports),
        },
        requireUserVerification: true,
      });

      if (!verification.verified) {
        passkeyFails.fail(passkey.id);
        return reject();
      }

      passkeyFails.reset(passkey.id);
      q.touchPasskey.run(verification.authenticationInfo.newCounter ?? 0, passkey.id);
      const sessionToken = createSession(user, passkey.id, req, res);

      return json(res, 200, {
        ok: true,
        token: sessionToken,
        user: { username: user.username, role: user.role ?? null, operator_id: user.operator_id ?? null },
      });
    } catch (err) {
      console.error('[webauthn] login-verify:', err.message);
      ipFails.fail(ip);
      return reject();
    }
  }

  // 5) POST /passkeys/list  (o'z qurilmalari)
  function listPasskeys(req, res) {
    const user = currentUser(req);
    if (!user) return json(res, 401, { ok: false, error: 'Avtorizatsiya talab qilinadi' });

    // Admin boshqa foydalanuvchining ro'yxatini ko'rishi mumkin: body.username
    let target = user;
    const wanted = req.body?.username;
    if (wanted && wanted !== user.username) {
      if (!isAdminRole(user.role)) return json(res, 403, { ok: false, error: 'Ruxsat yo\'q' });
      target = q.userByUsername.get(String(wanted));
      if (!target) return json(res, 404, { ok: false, error: 'Foydalanuvchi topilmadi' });
    }

    const items = q.passkeysByUser.all(target.id).map((pk) => ({
      id: pk.id,
      device_name: pk.device_name,
      device_type: pk.device_type,
      backed_up: !!pk.backed_up,
      created_at: pk.created_at,
      last_used_at: pk.last_used_at,
    }));
    return json(res, 200, { ok: true, passkeys: items });
  }

  // 6) POST /passkeys/delete  (o'ziniki yoki admin/superuser)
  function deletePasskey(req, res) {
    const user = currentUser(req);
    if (!user) return json(res, 401, { ok: false, error: 'Avtorizatsiya talab qilinadi' });

    const id = String(req.body?.id || '');
    const pk = id ? q.passkeyById.get(id) : null;
    if (!pk) return json(res, 404, { ok: false, error: 'Kalit topilmadi' });
    if (pk.user_id !== user.id && !isAdminRole(user.role)) {
      return json(res, 403, { ok: false, error: 'Ruxsat yo\'q' });
    }

    db.exec('BEGIN');
    try {
      q.deleteSessionsByPasskey.run(pk.id); // shu passkey bilan ochilgan sessiyalar tugatiladi
      q.deletePasskey.run(pk.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error('[webauthn] delete:', err);
      return json(res, 500, { ok: false, error: 'Ichki xatolik' });
    }
    return json(res, 200, { ok: true });
  }

  // ---- Routerga ulash -----------------------------------------------------
  function mount(router, { requireAuth, basePath = '/api/auth/webauthn' } = {}) {
    if (typeof requireAuth !== 'function') throw new Error('requireAuth middleware kerak');
    router.post(`${basePath}/register-options`, requireAuth, registerOptions);
    router.post(`${basePath}/register-verify`, requireAuth, registerVerify);
    router.post(`${basePath}/login-options`, loginOptions);
    router.post(`${basePath}/login-verify`, loginVerify);
    router.post(`${basePath}/passkeys/list`, requireAuth, listPasskeys);
    router.post(`${basePath}/passkeys/delete`, requireAuth, deletePasskey);
  }

  return {
    mount,
    handlers: { registerOptions, registerVerify, loginOptions, loginVerify, listPasskeys, deletePasskey },
  };
}

module.exports = { createWebAuthnService, loadConfig };

