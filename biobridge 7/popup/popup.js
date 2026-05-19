// ===== BioBridge Popup — Production Quality =====

// --- Screens ---
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const screens = {};
$$('.screen').forEach(s => screens[s.id.replace('screen-', '')] = s);

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name]?.classList.add('active');
}

// --- Toast ---
function toast(msg, type = 'success') {
  const c = $('#toast-container');
  c.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'toast-item ' + type;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// --- Messaging ---
async function send(msg) {
  try { return await chrome.runtime.sendMessage(msg); }
  catch (e) { console.error('Message error:', e); return { success: false, error: e.message }; }
}

// ===========================
// AUTHENTICATE — Opens auth.html in a new tab
// WebAuthn must run in a full tab, not a popup
// (popups close when system dialogs appear)
// ===========================

$('#btn-authenticate').addEventListener('click', () => {
  // Open auth page in a new tab — biometric runs there
  chrome.tabs.create({ url: chrome.runtime.getURL('popup/auth.html') });
  // Popup will close naturally — that's fine
});

// ===========================
// CREDENTIAL LIST
// ===========================

let editingSite = null;

function renderCredentials(sites) {
  const list = $('#credentials-list');
  const empty = $('#empty-state');
  list.querySelectorAll('.cred-item').forEach(el => el.remove());

  if (!sites || Object.keys(sites).length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  Object.entries(sites).forEach(([site, data]) => {
    const initial = site.charAt(0).toUpperCase();
    const el = document.createElement('div');
    el.className = 'cred-item';
    el.innerHTML = `
      <div class="cred-favicon">
        <img src="https://www.google.com/s2/favicons?domain=${site}&sz=40" alt="" onerror="this.outerHTML='<span class=\\'fallback\\'>${initial}</span>'">
      </div>
      <div class="cred-info">
        <div class="cred-site">${site}</div>
        <div class="cred-user">${data.username || '—'}</div>
      </div>
      <div class="cred-actions">
        <button class="cred-action-btn" data-action="edit" data-site="${site}" title="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="cred-action-btn delete" data-action="delete" data-site="${site}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    `;
    list.insertBefore(el, empty);
  });
}

$('#credentials-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.cred-action-btn');
  if (!btn) return;
  const { action, site } = btn.dataset;

  if (action === 'edit') {
    editingSite = site;
    $('#edit-site-name').textContent = site;
    const r = await send({ type: 'GET_CREDENTIAL', site });
    if (r?.success) {
      $('#edit-username').value = r.data.username || '';
      $('#edit-password').value = r.data.password || '';
      showScreen('edit');
    } else toast('Could not load credential', 'error');
  }
  if (action === 'delete') {
    if (!confirm('Delete credentials for ' + site + '?')) return;
    const r = await send({ type: 'DELETE_CREDENTIAL', site });
    if (r?.success) { toast('Deleted ' + site); loadCredentials(); }
    else toast('Delete failed', 'error');
  }
});

async function loadCredentials() {
  const r = await send({ type: 'GET_ALL_SITES' });
  if (r?.success) renderCredentials(r.data);
}

// ===========================
// OTP INPUT
// ===========================

const otpBoxes = $$('.otp-box');
otpBoxes.forEach((box, i) => {
  box.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '');
    if (e.target.value && i < otpBoxes.length - 1) otpBoxes[i + 1].focus();
  });
  box.addEventListener('keydown', e => {
    if (e.key === 'Backspace' && !box.value && i > 0) otpBoxes[i - 1].focus();
  });
  box.addEventListener('paste', e => {
    e.preventDefault();
    const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
    paste.split('').forEach((ch, j) => { if (otpBoxes[j]) otpBoxes[j].value = ch; });
    if (paste.length > 0) otpBoxes[Math.min(paste.length, 5)].focus();
  });
});
function getOtp() { return Array.from(otpBoxes).map(b => b.value).join(''); }
function clearOtp() { otpBoxes.forEach(b => b.value = ''); otpBoxes[0]?.focus(); }

let otpInterval;
function startTimer(sec = 300) {
  clearInterval(otpInterval);
  const el = $('#otp-timer');
  let r = sec;
  otpInterval = setInterval(() => {
    r--;
    el.textContent = Math.floor(r / 60) + ':' + (r % 60).toString().padStart(2, '0');
    if (r <= 0) { clearInterval(otpInterval); el.textContent = 'Expired'; toast('Code expired', 'error'); setTimeout(() => showScreen('failed'), 1500); }
  }, 1000);
}

// ===========================
// ALL BUTTON HANDLERS
// ===========================

$('#btn-retry').addEventListener('click', () => showScreen('locked'));

$('#btn-goto-recovery').addEventListener('click', async () => {
  const r = await send({ type: 'START_RECOVERY' });
  if (r?.success) {
    $('#recovery-email-masked').textContent = r.maskedEmail;
    $('#otp-attempts').textContent = '0';
    $('#otp-error').classList.add('hidden');
    clearOtp();
    startTimer(300);
    showScreen('recovery');
  } else toast(r?.error || 'Set up a recovery email first in Settings', 'error');
});

$('#btn-verify-otp').addEventListener('click', async () => {
  const otp = getOtp();
  if (otp.length !== 6) { $('#otp-error').textContent = 'Enter all 6 digits'; $('#otp-error').classList.remove('hidden'); return; }
  const r = await send({ type: 'VERIFY_OTP', otp });
  if (r?.success) { clearInterval(otpInterval); toast('Recovery successful!'); await loadCredentials(); showScreen('unlocked'); }
  else {
    $('#otp-attempts').textContent = r?.attempts || '?';
    $('#otp-error').textContent = r?.error || 'Invalid code'; $('#otp-error').classList.remove('hidden');
    clearOtp();
    if (r?.locked) { clearInterval(otpInterval); toast('Too many attempts', 'error'); setTimeout(() => showScreen('locked'), 2000); }
  }
});

$('#btn-recovery-back').addEventListener('click', () => { clearInterval(otpInterval); showScreen('failed'); });

$('#btn-lock').addEventListener('click', async () => { await send({ type: 'LOCK_VAULT' }); toast('Vault locked'); showScreen('locked'); });
$('#btn-settings').addEventListener('click', async () => {
  const r = await send({ type: 'GET_SETTINGS' });
  if (r?.data?.recoveryEmail) $('#input-recovery-email').value = r.data.recoveryEmail;
  showScreen('settings');
});
$('#btn-add-new').addEventListener('click', () => { $('#add-site').value = ''; $('#add-username').value = ''; $('#add-password').value = ''; showScreen('add'); });
$('#btn-goto-setup').addEventListener('click', () => showScreen('settings'));
$('#btn-settings-back').addEventListener('click', () => showScreen('unlocked'));

$('#btn-save-email').addEventListener('click', async () => {
  const email = $('#input-recovery-email').value.trim();
  if (!email || !email.includes('@')) { toast('Enter a valid email address', 'error'); return; }
  const r = await send({ type: 'SET_RECOVERY_EMAIL', email });
  toast(r?.success ? 'Recovery email saved' : 'Failed to save', r?.success ? 'success' : 'error');
});

$('#btn-export').addEventListener('click', async () => {
  const r = await send({ type: 'EXPORT_BACKUP' });
  if (r?.success) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.data], { type: 'application/json' }));
    a.download = 'biobridge-backup-' + Date.now() + '.json';
    a.click(); URL.revokeObjectURL(a.href); toast('Backup exported');
  } else toast('Export failed', 'error');
});

$('#btn-import').addEventListener('click', () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
  inp.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const r = await send({ type: 'IMPORT_BACKUP', data: await f.text() });
    if (r?.success) { toast('Backup imported'); await loadCredentials(); } else toast(r?.error || 'Import failed', 'error');
  };
  inp.click();
});

$('#btn-toggle-password').addEventListener('click', () => { const i = $('#edit-password'); i.type = i.type === 'password' ? 'text' : 'password'; });

$('#btn-save-edit').addEventListener('click', async () => {
  const u = $('#edit-username').value.trim(), p = $('#edit-password').value;
  if (!u || !p) { toast('Both fields are required', 'error'); return; }
  const r = await send({ type: 'UPDATE_CREDENTIAL', site: editingSite, username: u, password: p });
  if (r?.success) { toast('Credential updated'); await loadCredentials(); showScreen('unlocked'); } else toast('Update failed', 'error');
});
$('#btn-cancel-edit').addEventListener('click', () => showScreen('unlocked'));

$('#btn-save-add').addEventListener('click', async () => {
  const s = $('#add-site').value.trim(), u = $('#add-username').value.trim(), p = $('#add-password').value;
  if (!s || !u || !p) { toast('All fields are required', 'error'); return; }
  const r = await send({ type: 'SAVE_CREDENTIAL', site: s, username: u, password: p });
  if (r?.success) { toast('Credential saved'); await loadCredentials(); showScreen('unlocked'); } else toast(r?.error || 'Save failed', 'error');
});
$('#btn-cancel-add').addEventListener('click', () => showScreen('unlocked'));

// ===========================
// AUTO-DETECT UNLOCK STATE
// ===========================

(async () => {
  const r = await send({ type: 'IS_UNLOCKED' });
  if (r?.success && r.unlocked) { await loadCredentials(); showScreen('unlocked'); }
  else showScreen('locked');
})();
