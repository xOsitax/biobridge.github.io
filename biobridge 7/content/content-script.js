// ===== BioBridge Content Script — Production =====
(function () {
  'use strict';
  const SITE = window.location.hostname;
  let banner = null, initialized = false;

  chrome.runtime.onMessage.addListener((msg, _s, respond) => {
    if (msg.type === 'VAULT_STATE_CHANGED') { initialized = false; removeBanner(); setTimeout(init, 200); }
    if (msg.type === 'DO_FILL') { doFillFromAuth(msg); }
    respond({ ok: true }); return true;
  });

  function findPwFields() { return [...document.querySelectorAll('input[type="password"]')].filter(isVis); }

  function findUserField(pw) {
    const scope = pw.closest('form') || pw.closest('[class*="login" i],[class*="form" i],[class*="auth" i],[class*="sign" i],section,main') || document.body;
    const sels = ['input[autocomplete="username"]','input[autocomplete="email"]','input[type="email"]',
      'input[name*="email" i]','input[name*="user" i]','input[name*="login" i]','input[name*="identifier" i]',
      'input[id*="email" i]','input[id*="user" i]','input[id*="login" i]',
      'input[placeholder*="email" i]','input[placeholder*="user" i]','input[placeholder*="phone" i]',
      'input[aria-label*="email" i]','input[aria-label*="user" i]','input[type="text"]','input:not([type])'];
    for (const s of sels) for (const f of scope.querySelectorAll(s)) if (f !== pw && isVis(f) && f.type !== 'hidden') return f;
    const all = [...scope.querySelectorAll('input')]; const idx = all.indexOf(pw);
    for (let i = idx - 1; i >= 0; i--) if (['text','email',''].includes(all[i].type) && isVis(all[i])) return all[i];
    return null;
  }

  function findSubmitBtn(pw) {
    const scope = pw.closest('form') || pw.closest('[class*="login" i],[class*="form" i],[class*="auth" i],section') || document.body;
    for (const s of ['button[type="submit"]','input[type="submit"]','button[name*="login" i]','button[name*="signin" i]',
      'button[id*="login" i]','button[id*="signin" i]','button[id*="submit" i]',
      'button[class*="login" i]','button[class*="signin" i]','button[class*="submit" i]',
      'button[data-testid*="login" i]','button[data-testid*="signin" i]']) {
      const b = scope.querySelector(s); if (b && isVis(b)) return b;
    }
    for (const b of scope.querySelectorAll('button,input[type="submit"],[role="button"]')) {
      const t = (b.textContent||b.value||b.getAttribute('aria-label')||'').toLowerCase().trim();
      if (['log in','login','sign in','signin','submit','continue','next'].some(w => t.includes(w)) && isVis(b)) return b;
    }
    const form = pw.closest('form'); if (form) { const b = form.querySelector('button'); if (b && isVis(b)) return b; }
    return null;
  }

  function isVis(el) { if (!el) return false; const s = getComputedStyle(el); return s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0' && el.offsetWidth>0; }

  function fillInput(input, value) {
    input.focus(); input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) { setter.call(input, ''); setter.call(input, value); } else input.value = value;
    for (const e of ['input','change']) input.dispatchEvent(new Event(e, { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  function clickSubmit(btn, pw) {
    if (btn) { btn.focus(); btn.click(); btn.dispatchEvent(new MouseEvent('click', { bubbles: true, view: window })); }
    else {
      pw.focus();
      for (const t of ['keydown','keypress','keyup']) pw.dispatchEvent(new KeyboardEvent(t, { key:'Enter', code:'Enter', keyCode:13, which:13, bubbles:true }));
      const form = pw.closest('form'); if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  }

  function showBanner(pw, hasCred, isUnlocked) {
    removeBanner();
    banner = document.createElement('div'); banner.id = 'bb-bar';
    let html;
    if (hasCred) {
      // Always show Fill & Login — auth popup will handle biometric each time
      html = `<div class="bb-i"><div class="bb-dot bb-dot-on"></div><span class="bb-m">BioBridge — <strong>${SITE}</strong></span><button id="bb-fill" class="bb-b bb-b-go">Fill & Login</button><button id="bb-x" class="bb-b bb-b-x">✕</button></div>`;
    } else if (isUnlocked) {
      html = `<div class="bb-i"><div class="bb-dot bb-dot-on"></div><span class="bb-m">Save login to BioBridge?</span><button id="bb-save" class="bb-b bb-b-save">Save</button><button id="bb-x" class="bb-b bb-b-x">✕</button></div>`;
    } else {
      html = `<div class="bb-i"><div class="bb-dot bb-dot-off"></div><span class="bb-m bb-dim">BioBridge — authenticate in popup to save credentials</span><button id="bb-x" class="bb-b bb-b-x">✕</button></div>`;
    }
    banner.innerHTML = html;
    document.body.appendChild(banner);
    document.body.style.paddingTop = '40px';
    document.getElementById('bb-x')?.addEventListener('click', removeBanner);
    document.getElementById('bb-fill')?.addEventListener('click', () => doAutofill(pw));
    document.getElementById('bb-save')?.addEventListener('click', () => doSave(pw));
  }

  function removeBanner() { if (banner) { banner.remove(); banner = null; document.body.style.paddingTop = ''; } }

  function bannerMsg(text, ok) {
    if (!banner) return;
    const i = banner.querySelector('.bb-i');
    if (i) i.innerHTML = `<div class="bb-dot ${ok ? 'bb-dot-on' : 'bb-dot-err'}"></div><span class="bb-m">${text}</span><button id="bb-x" class="bb-b bb-b-x">✕</button>`;
    document.getElementById('bb-x')?.addEventListener('click', removeBanner);
  }

  async function doAutofill(pw) {
    const b = document.getElementById('bb-fill'); if (b) { b.textContent = 'Authenticating...'; b.disabled = true; }
    bannerMsg('Opening biometric verification...', true);
    // Ask background to open a small auth popup window
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_AUTH_POPUP', site: SITE });
      // Credentials will arrive via DO_FILL message after auth completes
    } catch (e) {
      bannerMsg('Failed to open authentication', false);
      if (b) { b.textContent = 'Fill & Login'; b.disabled = false; }
    }
  }

  // Called when background sends credentials after successful auth in popup
  function doFillFromAuth(msg) {
    const pwFields = findPwFields();
    const pw = pwFields[0];
    if (!pw) { console.error('BioBridge: No password field found'); return; }

    const uf = findUserField(pw);
    const sb = findSubmitBtn(pw);

    // Fill username
    if (uf && msg.username) fillInput(uf, msg.username);

    // Fill password after short delay
    setTimeout(function() {
      fillInput(pw, msg.password);
      bannerMsg('Credentials filled — logging in...', true);

      // Click submit after another short delay
      setTimeout(function() {
        clickSubmit(sb, pw);

        // Clear password from DOM
        setTimeout(function() {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(pw, '');
          removeBanner();
        }, 400);
      }, 350);
    }, 120);
  }

  async function doSave(pw) {
    const uf = findUserField(pw), u = uf?.value?.trim()||'', p = pw.value;
    if (!u) { bannerMsg('Enter username first', false); return; }
    if (!p) { bannerMsg('Enter password first', false); return; }
    const b = document.getElementById('bb-save'); if (b) { b.textContent = 'Saving...'; b.disabled = true; }
    try {
      const r = await chrome.runtime.sendMessage({ type: 'SAVE_FROM_CONTENT', site: SITE, username: u, password: p });
      if (r?.success) { bannerMsg('Saved to BioBridge!', true); setTimeout(removeBanner, 2000); }
      else { bannerMsg(r?.error || 'Save failed', false); if (b) { b.textContent = 'Save'; b.disabled = false; } }
    } catch { bannerMsg('Save failed', false); }
  }

  document.addEventListener('submit', async e => {
    if (!(e.target instanceof HTMLFormElement)) return;
    const pw = e.target.querySelector('input[type="password"]'); if (!pw) return;
    const uf = findUserField(pw), u = uf?.value?.trim(), p = pw.value;
    if (!u || !p) return;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'CHECK_SITE', site: SITE });
      if (!r?.hasCredential && r?.isUnlocked) setTimeout(() => { if (confirm('BioBridge — save login for '+SITE+'?')) chrome.runtime.sendMessage({ type:'SAVE_FROM_CONTENT', site:SITE, username:u, password:p }); }, 300);
    } catch {}
  }, true);

  async function init() {
    if (initialized) return;
    await new Promise(r => setTimeout(r, 500));
    const fields = findPwFields(); if (!fields.length) return;
    initialized = true;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'CHECK_SITE', site: SITE });
      if (r?.success) showBanner(fields[0], r.hasCredential, r.isUnlocked);
    } catch (e) { console.error('BioBridge init:', e); }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') init();
  else window.addEventListener('DOMContentLoaded', init);

  new MutationObserver(() => { if (!initialized && findPwFields().length) init(); })
    .observe(document.body || document.documentElement, { childList: true, subtree: true });
})();
