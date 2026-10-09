/* Modo Oscuro Forzado — popup */

const DEFAULT_GLOBAL = {
  mode: 'off',
  engine: 'dynamic',
  brightness: 100,
  contrast: 100,
  sepia: 0,
  detectDark: true,
  dimImages: false
};

const $ = (id) => document.getElementById(id);
let host = null;
let tabId = null;
let global = { ...DEFAULT_GLOBAL };
let sites = {};

function hostOf(url) {
  try {
    const u = new URL(url);
    if (!/^(https?|file):$/.test(u.protocol)) return null;
    if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return null;
    if (u.hostname === 'chromewebstore.google.com') return null;
    return u.hostname || u.protocol;
  } catch (e) {
    return null;
  }
}

function setSeg(el, value) {
  el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === value));
}

function render() {
  const site = sites[host] || {};
  setSeg($('siteMode'), site.mode || 'default');
  $('siteEngine').value = site.engine || 'default';
  setSeg($('globalMode'), global.mode);
  $('globalEngine').value = global.engine;
  $('detectDark').checked = !!global.detectDark;
  $('dimImages').checked = !!global.dimImages;
  for (const k of ['brightness', 'contrast', 'sepia']) {
    $(k).value = global[k];
    $(k + 'Out').textContent = global[k] + '%';
  }
}

async function refreshStatus() {
  const el = $('status');
  el.className = 'status';
  if (tabId == null) return;
  // Pequeña espera para que la página aplique el cambio
  await new Promise((r) => setTimeout(r, 120));
  let st = null;
  try {
    st = await chrome.tabs.sendMessage(tabId, { type: 'getStatus' });
  } catch (e) {
    el.textContent = 'Recarga la página para activar la extensión aquí.';
    return;
  }
  if (!st) return;
  if (st.active) {
    el.textContent = `Activo: modo ${st.scheme === 'dark' ? 'oscuro' : 'claro'} · motor ${st.engine === 'filter' ? 'filtro' : 'dinámico'}`;
    el.classList.add('ok');
  } else if (st.skippedBecauseNative) {
    el.textContent = `Este sitio ya es ${st.detected === 'dark' ? 'oscuro' : 'claro'}; no se modificó. Elige un modo arriba para forzarlo.`;
  } else {
    el.textContent = 'Sin cambios: la página se ve como el original.';
  }
}

async function saveGlobal(patch) {
  global = { ...global, ...patch };
  await chrome.storage.local.set({ global });
  render();
  refreshStatus();
}

async function saveSite(patch) {
  const site = { ...(sites[host] || {}), ...patch };
  if ((site.mode || 'default') === 'default' && (site.engine || 'default') === 'default') delete sites[host];
  else sites[host] = site;
  await chrome.storage.local.set({ sites });
  render();
  refreshStatus();
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  host = tab && hostOf(tab.url || '');
  tabId = tab ? tab.id : null;

  const data = await chrome.storage.local.get(['global', 'sites']);
  global = { ...DEFAULT_GLOBAL, ...(data.global || {}) };
  sites = data.sites || {};

  if (!host) {
    $('host').textContent = tab && tab.url ? new URL(tab.url).protocol.replace(':', '') + ' (página protegida)' : '—';
    $('unsupported').hidden = false;
    $('siteMode').closest('section').classList.add('disabled');
    $('resetSite').classList.add('disabled');
  } else {
    $('host').textContent = host;
  }
  render();
  if (host) refreshStatus();

  $('siteMode').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) saveSite({ mode: v });
  });
  $('siteEngine').addEventListener('change', (e) => saveSite({ engine: e.target.value }));
  $('globalMode').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (v) saveGlobal({ mode: v });
  });
  $('globalEngine').addEventListener('change', (e) => saveGlobal({ engine: e.target.value }));
  $('detectDark').addEventListener('change', (e) => saveGlobal({ detectDark: e.target.checked }));
  $('dimImages').addEventListener('change', (e) => saveGlobal({ dimImages: e.target.checked }));

  for (const k of ['brightness', 'contrast', 'sepia']) {
    let t = 0;
    $(k).addEventListener('input', (e) => {
      $(k + 'Out').textContent = e.target.value + '%';
      clearTimeout(t);
      t = setTimeout(() => saveGlobal({ [k]: +e.target.value }), 80);
    });
  }
  $('resetVisual').addEventListener('click', () =>
    saveGlobal({ brightness: 100, contrast: 100, sepia: 0, dimImages: false }));
  $('resetSite').addEventListener('click', () => {
    delete sites[host];
    chrome.storage.local.set({ sites }).then(() => { render(); refreshStatus(); });
  });
}

init();
