// ===== BioBridge Service Worker =====
// Uses chrome.storage.session for VEK persistence across SW restarts

// --- Crypto Helpers ---
function genIV() { return crypto.getRandomValues(new Uint8Array(12)); }
function genSalt() { return crypto.getRandomValues(new Uint8Array(16)); }

async function importKey(raw) { return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }

async function encrypt(text, rawKey) {
  const iv = genIV(), salt = genSalt(), key = await importKey(rawKey);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { ciphertext: b2b64(ct), iv: b2b64(iv), salt: b2b64(salt) };
}

async function decrypt(ctB64, ivB64, rawKey) {
  const key = await importKey(rawKey);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b642b(ivB64) }, key, b642b(ctB64));
  return new TextDecoder().decode(pt);
}

async function sha256(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deriveStorageKey(credId) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(credId + '-biobridge-storage-key'), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('biobridge-salt-v1'), iterations: 100000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

function splitKey(key) {
  const mask = crypto.getRandomValues(new Uint8Array(key.length));
  const halfB = new Uint8Array(key.length);
  for (let i = 0; i < key.length; i++) halfB[i] = key[i] ^ mask[i];
  return { halfA: mask, halfB };
}

function combineKey(a, b) {
  const k = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) k[i] = a[i] ^ b[i];
  return k;
}

function b2b64(buf) {
  const b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = ''; for (let i = 0; i < b.byteLength; i++) s += String.fromCharCode(b[i]); return btoa(s);
}

function b642b(s) {
  const d = atob(s); const u = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) u[i] = d.charCodeAt(i); return u;
}

// --- Storage ---
const K = { VAULT: 'bb_vault', SETTINGS: 'bb_settings', RECOVERY: 'bb_recovery', VEK_ENC: 'bb_vek_enc', S_VEK: 'bb_session_vek' };

async function sGet(k) { return (await chrome.storage.local.get(k))[k] || null; }
async function sSet(k, v) { await chrome.storage.local.set({ [k]: v }); }

// Session VEK — survives SW restarts, clears on browser close
async function setVEK(vekB64) { await chrome.storage.session.set({ [K.S_VEK]: vekB64 }); }
async function getVEK() { const r = (await chrome.storage.session.get(K.S_VEK))[K.S_VEK]; return r ? b642b(r) : null; }
async function clearVEK() { await chrome.storage.session.remove(K.S_VEK); }

// --- EmailJS ---
const EJS = { sid: 'service_pyijmhs', tid: 'template_vwyv759', pk: 'KXU5716X6hQPgkBD8' };

// --- Notify all tabs ---
async function notifyTabs(msg) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (t.id && t.url && !t.url.startsWith('chrome://')) {
        try { await chrome.tabs.sendMessage(t.id, msg); } catch {}
      }
    }
  } catch {}
}

// --- Message Router ---
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  handle(msg, sender).then(respond).catch(e => { console.error('SW:', e); respond({ success: false, error: e.message }); });
  return true;
});

async function handle(m, sender) {
  const h = {
    FIRST_TIME_SETUP: firstTimeSetup,
    UNLOCK_VAULT: unlockVault,
    LOCK_VAULT: lockVault,
    IS_UNLOCKED: isUnlocked,
    SAVE_CREDENTIAL: saveCred,
    GET_CREDENTIAL: getCred,
    UPDATE_CREDENTIAL: saveCred,
    DELETE_CREDENTIAL: delCred,
    GET_ALL_SITES: getAllSites,
    GET_SETTINGS: getSettings,
    SET_RECOVERY_EMAIL: setRecoveryEmail,
    START_RECOVERY: startRecovery,
    VERIFY_OTP: verifyOTP,
    EXPORT_BACKUP: exportBackup,
    IMPORT_BACKUP: importBackup,
    CHECK_SITE: checkSite,
    AUTOFILL_REQUEST: autofillReq,
    SAVE_FROM_CONTENT: saveCred,
    OPEN_AUTH_POPUP: openAuthPopup,
    AUTOFILL_AFTER_AUTH: autofillAfterAuth,
  };
  const fn = h[m.type];
  if (!fn) return { success: false, error: 'Unknown: ' + m.type };
  // Pass sender for handlers that need tab info
  m._sender = sender;
  return fn(m);
}

// --- Open small popup window for per-login auth ---
async function openAuthPopup(m) {
  try {
    var tabId = m._sender && m._sender.tab ? m._sender.tab.id : 0;
    var site = m.site || '';
    var url = chrome.runtime.getURL('popup/auth.html') + '?site=' + encodeURIComponent(site) + '&tabId=' + tabId;

    // Create a small centered popup window
    var screenW = 500, screenH = 620;
    await chrome.windows.create({
      url: url,
      type: 'popup',
      width: screenW,
      height: screenH,
      focused: true,
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Called by auth window after successful biometric ---
async function autofillAfterAuth(m) {
  var vek = await getVEK();
  if (!vek) return { success: false, error: 'Vault not unlocked' };

  try {
    var vault = (await sGet(K.VAULT)) || {};
    var cred = vault[m.site];
    if (!cred) return { success: false, error: 'No credential for ' + m.site };

    var password = await decrypt(cred.encPassword, cred.iv, vek);

    // Send credentials to the content script on the target tab
    if (m.tabId) {
      try {
        await chrome.tabs.sendMessage(parseInt(m.tabId), {
          type: 'DO_FILL',
          username: cred.username,
          password: password,
        });
      } catch (e) {
        console.error('Failed to send to tab:', e);
      }
    }

    // LOCK VAULT immediately after filling (per-login auth)
    await clearVEK();
    await notifyTabs({ type: 'VAULT_STATE_CHANGED', unlocked: false });

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- Handlers ---
async function isUnlocked() { return { success: true, unlocked: !!(await getVEK()) }; }

async function firstTimeSetup(m) {
  try {
    const { credentialId } = m;
    const vek = crypto.getRandomValues(new Uint8Array(32));
    const sk = await deriveStorageKey(credentialId);
    const iv = genIV();
    const encVEK = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sk, vek);
    await sSet(K.VEK_ENC, { ciphertext: b2b64(encVEK), iv: b2b64(iv) });
    await sSet(K.SETTINGS, { credentialId, biometricRegistered: true, setupDate: Date.now() });
    const { halfA, halfB } = splitKey(vek);
    const rec = (await sGet(K.RECOVERY)) || {};
    rec.keyHalfA = b2b64(halfA); rec.keyHalfB = b2b64(halfB);
    await sSet(K.RECOVERY, rec);
    await setVEK(b2b64(vek));
    await notifyTabs({ type: 'VAULT_STATE_CHANGED', unlocked: true });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

async function unlockVault() {
  try {
    const settings = (await sGet(K.SETTINGS)) || {};
    if (!settings.credentialId) return { success: false, error: 'No biometric registered' };
    const enc = await sGet(K.VEK_ENC);
    if (!enc) return { success: false, error: 'No key found' };
    const sk = await deriveStorageKey(settings.credentialId);
    const dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b642b(enc.iv) }, sk, b642b(enc.ciphertext));
    await setVEK(b2b64(new Uint8Array(dec)));
    await notifyTabs({ type: 'VAULT_STATE_CHANGED', unlocked: true });
    return { success: true };
  } catch (e) { console.error('Unlock:', e); return { success: false, error: 'Unlock failed' }; }
}

async function lockVault() {
  await clearVEK();
  await notifyTabs({ type: 'VAULT_STATE_CHANGED', unlocked: false });
  return { success: true };
}

async function saveCred(m) {
  const vek = await getVEK(); if (!vek) return { success: false, error: 'Vault is locked' };
  try {
    const enc = await encrypt(m.password, vek);
    const vault = (await sGet(K.VAULT)) || {};
    vault[m.site] = { username: m.username, encPassword: enc.ciphertext, iv: enc.iv, salt: enc.salt, createdAt: vault[m.site]?.createdAt || Date.now(), updatedAt: Date.now() };
    await sSet(K.VAULT, vault);
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getCred(m) {
  const vek = await getVEK(); if (!vek) return { success: false, error: 'Vault is locked' };
  try {
    const vault = (await sGet(K.VAULT)) || {};
    const c = vault[m.site]; if (!c) return { success: false, error: 'Not found' };
    const pw = await decrypt(c.encPassword, c.iv, vek);
    return { success: true, data: { username: c.username, password: pw } };
  } catch (e) { return { success: false, error: e.message }; }
}

async function delCred(m) {
  try { const v = (await sGet(K.VAULT)) || {}; delete v[m.site]; await sSet(K.VAULT, v); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
}

async function getAllSites() {
  try {
    const v = (await sGet(K.VAULT)) || {};
    const out = {};
    for (const [s, d] of Object.entries(v)) out[s] = { username: d.username || '—', createdAt: d.createdAt, updatedAt: d.updatedAt };
    return { success: true, data: out };
  } catch (e) { return { success: false, error: e.message }; }
}

async function getSettings() {
  try {
    const s = (await sGet(K.SETTINGS)) || {};
    const r = (await sGet(K.RECOVERY)) || {};
    return { success: true, data: { ...s, recoveryEmail: r.email || '' } };
  } catch (e) { return { success: false, error: e.message }; }
}

async function setRecoveryEmail(m) {
  try { const r = (await sGet(K.RECOVERY)) || {}; r.email = m.email; await sSet(K.RECOVERY, r); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
}

// --- OTP Recovery ---
function genOTP() {
  const a = crypto.getRandomValues(new Uint8Array(4));
  return (((a[0] << 24 | a[1] << 16 | a[2] << 8 | a[3]) >>> 0) % 900000 + 100000).toString();
}
function maskEmail(e) { const [l, d] = e.split('@'); return l[0] + '***' + (l.length > 1 ? l[l.length - 1] : '') + '@' + d; }

async function startRecovery() {
  try {
    const rec = (await sGet(K.RECOVERY)) || {};
    if (!rec.email) return { success: false, error: 'No recovery email set. Configure one in Settings.' };

    const otp = genOTP();
    rec.otpHash = await sha256(otp);
    rec.otpExpiry = Date.now() + 300000;
    rec.otpAttempts = 0;
    await sSet(K.RECOVERY, rec);

    console.log('BioBridge: Sending OTP to', maskEmail(rec.email));
    const resp = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EJS.sid, template_id: EJS.tid, user_id: EJS.pk,
        template_params: { to_email: rec.email, otp_code: otp, expiry_minutes: '5' },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => 'Unknown');
      console.error('EmailJS error:', resp.status, err);
      return { success: false, error: 'Email failed (' + resp.status + '): ' + err };
    }

    console.log('BioBridge: OTP sent successfully');
    return { success: true, maskedEmail: maskEmail(rec.email) };
  } catch (e) {
    console.error('Recovery error:', e);
    return { success: false, error: 'Email service error: ' + e.message };
  }
}

async function verifyOTP(m) {
  try {
    const rec = (await sGet(K.RECOVERY)) || {};
    if (!rec.otpHash) return { success: false, error: 'No recovery in progress' };
    if (Date.now() > rec.otpExpiry) { rec.otpHash = null; await sSet(K.RECOVERY, rec); return { success: false, error: 'Code expired' }; }
    if (rec.otpAttempts >= 3) { rec.otpHash = null; await sSet(K.RECOVERY, rec); return { success: false, error: 'Too many attempts', locked: true }; }

    rec.otpAttempts = (rec.otpAttempts || 0) + 1;
    await sSet(K.RECOVERY, rec);

    if (await sha256(m.otp) !== rec.otpHash) {
      if (rec.otpAttempts >= 3) { rec.otpHash = null; await sSet(K.RECOVERY, rec); return { success: false, error: 'Too many attempts', attempts: rec.otpAttempts, locked: true }; }
      return { success: false, error: 'Wrong code', attempts: rec.otpAttempts };
    }

    rec.otpHash = null; rec.otpExpiry = null; rec.otpAttempts = 0;
    await sSet(K.RECOVERY, rec);

    if (rec.keyHalfA && rec.keyHalfB) {
      const vek = combineKey(b642b(rec.keyHalfA), b642b(rec.keyHalfB));
      await setVEK(b2b64(vek));
      await notifyTabs({ type: 'VAULT_STATE_CHANGED', unlocked: true });
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

// --- Backup ---
async function exportBackup() {
  try {
    const [vault, settings, recovery, encVEK] = await Promise.all([sGet(K.VAULT), sGet(K.SETTINGS), sGet(K.RECOVERY), sGet(K.VEK_ENC)]);
    return { success: true, data: JSON.stringify({ version: '1.0.0', exportedAt: new Date().toISOString(), vault: vault || {}, encVEK, settings: { credentialId: settings?.credentialId }, recovery: { email: recovery?.email, keyHalfA: recovery?.keyHalfA, keyHalfB: recovery?.keyHalfB } }, null, 2) };
  } catch (e) { return { success: false, error: e.message }; }
}

async function importBackup(m) {
  try {
    const b = JSON.parse(m.data);
    if (!b.version || !b.vault) return { success: false, error: 'Invalid backup' };
    await sSet(K.VAULT, b.vault);
    if (b.encVEK) await sSet(K.VEK_ENC, b.encVEK);
    if (b.settings?.credentialId) { const s = (await sGet(K.SETTINGS)) || {}; s.credentialId = b.settings.credentialId; await sSet(K.SETTINGS, s); }
    if (b.recovery) { const r = (await sGet(K.RECOVERY)) || {}; Object.assign(r, b.recovery); await sSet(K.RECOVERY, r); }
    return { success: true };
  } catch { return { success: false, error: 'Invalid backup format' }; }
}

// --- Content script ---
async function checkSite(m) {
  try {
    const v = (await sGet(K.VAULT)) || {};
    return { success: true, hasCredential: !!v[m.site], isUnlocked: !!(await getVEK()) };
  } catch (e) { return { success: false, error: e.message }; }
}

async function autofillReq(m) {
  const vek = await getVEK();
  if (!vek) return { success: false, error: 'Vault is locked — open BioBridge popup and authenticate first' };
  try {
    const v = (await sGet(K.VAULT)) || {};
    const c = v[m.site]; if (!c) return { success: false, error: 'No saved credential for ' + m.site };
    const pw = await decrypt(c.encPassword, c.iv, vek);
    return { success: true, data: { username: c.username, password: pw } };
  } catch (e) { return { success: false, error: e.message }; }
}

// --- Auto-lock on screen lock ---
chrome.idle.onStateChanged.addListener(async s => {
  if (s === 'locked') { await clearVEK(); await notifyTabs({ type: 'VAULT_STATE_CHANGED', unlocked: false }); }
});
