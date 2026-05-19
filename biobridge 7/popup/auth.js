// ===== BioBridge Auth Page — Biometric + Email Recovery =====

var $ = function(s) { return document.querySelector(s); };
var $$ = function(s) { return document.querySelectorAll(s); };

// --- Read URL params (site and tabId for per-login autofill) ---
var urlParams = new URLSearchParams(window.location.search);
var authSite = urlParams.get('site') || '';
var authTabId = urlParams.get('tabId') || '';
var isPerLoginAuth = !!(authSite && authTabId);

// --- Handle successful auth (both biometric and OTP recovery) ---
async function handleAuthSuccess() {
  if (isPerLoginAuth) {
    // Per-login: tell background to decrypt and send credentials to the tab
    await send({ type: 'AUTOFILL_AFTER_AUTH', site: authSite, tabId: authTabId });
    // Close this window immediately
    window.close();
  } else {
    // Regular auth from popup: show success screen
    showScreen('success');
    setTimeout(function() { window.close(); }, 3000);
  }
}

// --- Encoding ---
function buf2b64(buf) {
  var b = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  var s = ''; for (var i = 0; i < b.byteLength; i++) s += String.fromCharCode(b[i]); return btoa(s);
}
function b642buf(s) {
  var d = atob(s); var u = new Uint8Array(d.length);
  for (var i = 0; i < d.length; i++) u[i] = d.charCodeAt(i); return u;
}

// --- Screen management ---
function showScreen(name) {
  $$('.screen').forEach(function(s) { s.classList.remove('active'); });
  var el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
}

// --- Message helper ---
function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

// ================================
// BIOMETRIC AUTHENTICATION
// ================================

async function bioRegister() {
  var cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'BioBridge' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'biobridge-user', displayName: 'BioBridge User' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 120000
    }
  });
  return buf2b64(cred.rawId);
}

async function bioAuth(credIdB64) {
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: b642buf(credIdB64), type: 'public-key', transports: ['internal'] }],
      userVerification: 'required',
      timeout: 120000
    }
  });
  return true;
}

function showBioStatus(msg, ok) {
  var el = $('#bio-status');
  el.classList.remove('hidden', 'status-ok', 'status-err');
  el.classList.add(ok ? 'status-ok' : 'status-err');
  el.textContent = msg;
}

// Main biometric auth handler
async function doAuth() {
  var btn = $('#btn-auth');
  var origHTML = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Waiting for biometric...';
  btn.disabled = true;
  $('#bio-status').classList.add('hidden');

  try {
    if (!window.PublicKeyCredential) {
      showBioStatus('WebAuthn not supported in this browser', false);
      $('#recovery-option').classList.remove('hidden');
      btn.innerHTML = origHTML; btn.disabled = false;
      return;
    }

    var available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      showBioStatus('No biometric sensor found on this device', false);
      $('#recovery-option').classList.remove('hidden');
      btn.innerHTML = origHTML; btn.disabled = false;
      return;
    }

    var settings = await send({ type: 'GET_SETTINGS' });
    var credId = settings && settings.data ? settings.data.credentialId : null;

    if (!credId) {
      // FIRST TIME
      btn.innerHTML = '<span class="spinner"></span> Place finger on sensor...';
      var newId = await bioRegister();
      var result = await send({ type: 'FIRST_TIME_SETUP', credentialId: newId });
      if (result && result.success) {
        handleAuthSuccess();
      } else {
        showBioStatus('Setup failed: ' + (result ? result.error : 'Unknown'), false);
        $('#recovery-option').classList.remove('hidden');
        btn.innerHTML = origHTML; btn.disabled = false;
      }
    } else {
      // RETURNING USER
      btn.innerHTML = '<span class="spinner"></span> Verifying identity...';
      await bioAuth(credId);
      var result = await send({ type: 'UNLOCK_VAULT' });
      if (result && result.success) {
        handleAuthSuccess();
      } else {
        showBioStatus('Vault unlock failed', false);
        $('#recovery-option').classList.remove('hidden');
        btn.innerHTML = origHTML; btn.disabled = false;
      }
    }

  } catch (err) {
    console.error('Auth error:', err);
    var msg = 'Authentication failed';
    if (err.name === 'NotAllowedError') msg = 'Biometric was cancelled or denied';
    else if (err.name === 'InvalidStateError') msg = 'Credential conflict — try clearing extension data';

    showBioStatus(msg, false);
    $('#shield-icon').className = 'shield fail';
    $('#recovery-option').classList.remove('hidden');

    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg> Try Again';
    btn.disabled = false;
  }
}

// ================================
// EMAIL RECOVERY
// ================================

var otpInterval = null;

function showRecoveryStatus(msg, ok) {
  var el = $('#recovery-status');
  el.classList.remove('hidden', 'status-ok', 'status-err');
  el.classList.add(ok ? 'status-ok' : 'status-err');
  el.textContent = msg;
}

// Send OTP
async function sendOTP() {
  var btn = $('#btn-send-otp');
  btn.innerHTML = '<span class="spinner"></span> Sending code...';
  btn.disabled = true;
  $('#recovery-status').classList.add('hidden');

  try {
    var result = await send({ type: 'START_RECOVERY' });

    if (result && result.success) {
      $('#masked-email').textContent = result.maskedEmail;
      $('#recovery-step1').classList.add('hidden');
      $('#recovery-step2').classList.remove('hidden');
      startOtpTimer(300);
      // Focus first OTP box
      var firstBox = document.querySelector('.otp-box[data-index="0"]');
      if (firstBox) firstBox.focus();
    } else {
      showRecoveryStatus(result ? result.error : 'Failed to send code', false);
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> Send Recovery Code';
      btn.disabled = false;
    }
  } catch (err) {
    showRecoveryStatus('Error: ' + err.message, false);
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> Send Recovery Code';
    btn.disabled = false;
  }
}

// Verify OTP
async function verifyOTP() {
  var otp = getOtp();
  if (otp.length !== 6) {
    showRecoveryStatus('Please enter all 6 digits', false);
    return;
  }

  var btn = $('#btn-verify-otp');
  btn.innerHTML = '<span class="spinner"></span> Verifying...';
  btn.disabled = true;

  try {
    var result = await send({ type: 'VERIFY_OTP', otp: otp });

    if (result && result.success) {
      clearInterval(otpInterval);
      handleAuthSuccess();
    } else {
      $('#otp-attempts').textContent = result ? (result.attempts || '?') : '?';
      showRecoveryStatus(result ? result.error : 'Invalid code', false);
      clearOtp();
      btn.innerHTML = 'Verify Code';
      btn.disabled = false;

      if (result && result.locked) {
        clearInterval(otpInterval);
        showRecoveryStatus('Too many failed attempts. Please try again later.', false);
        btn.classList.add('hidden');
      }
    }
  } catch (err) {
    showRecoveryStatus('Error: ' + err.message, false);
    btn.innerHTML = 'Verify Code';
    btn.disabled = false;
  }
}

// OTP Timer
function startOtpTimer(seconds) {
  clearInterval(otpInterval);
  var el = $('#otp-timer');
  var remaining = seconds;
  otpInterval = setInterval(function() {
    remaining--;
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    if (remaining <= 0) {
      clearInterval(otpInterval);
      el.textContent = 'Expired';
      showRecoveryStatus('Code expired. Click back and try again.', false);
    }
  }, 1000);
}

// OTP input handling
var otpBoxes = $$('.otp-box');
otpBoxes.forEach(function(box, i) {
  box.addEventListener('input', function(e) {
    e.target.value = e.target.value.replace(/\D/g, '');
    if (e.target.value && i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
  });
  box.addEventListener('keydown', function(e) {
    if (e.key === 'Backspace' && !box.value && i > 0) otpBoxes[i - 1].focus();
  });
  box.addEventListener('paste', function(e) {
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
    text.split('').forEach(function(ch, j) { if (otpBoxes[j]) otpBoxes[j].value = ch; });
    if (text.length > 0) otpBoxes[Math.min(text.length, 5)].focus();
  });
});

function getOtp() {
  var otp = '';
  otpBoxes.forEach(function(b) { otp += b.value; });
  return otp;
}

function clearOtp() {
  otpBoxes.forEach(function(b) { b.value = ''; });
  otpBoxes[0].focus();
}

// ================================
// EVENT LISTENERS
// ================================

$('#btn-auth').addEventListener('click', doAuth);

$('#btn-show-recovery').addEventListener('click', function() {
  showScreen('recovery');
});

$('#btn-back-to-bio').addEventListener('click', function() {
  clearInterval(otpInterval);
  // Reset recovery screen
  $('#recovery-step1').classList.remove('hidden');
  $('#recovery-step2').classList.add('hidden');
  $('#recovery-status').classList.add('hidden');
  var sendBtn = $('#btn-send-otp');
  sendBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> Send Recovery Code';
  sendBtn.disabled = false;
  showScreen('bio');
});

$('#btn-send-otp').addEventListener('click', sendOTP);
$('#btn-verify-otp').addEventListener('click', verifyOTP);
$('#btn-close').addEventListener('click', function() { window.close(); });

// --- Per-login mode: show which site is requesting auth ---
if (isPerLoginAuth) {
  $('#bio-subtitle').textContent = 'Verify your identity to log in to ' + authSite;
}
