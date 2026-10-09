/* Modo Oscuro Forzado — service worker */

const DEFAULT_GLOBAL = {
  mode: 'off',
  engine: 'dynamic',
  brightness: 100,
  contrast: 100,
  sepia: 0,
  detectDark: true,
  dimImages: false
};

chrome.runtime.onInstalled.addListener(async () => {
  const { global } = await chrome.storage.local.get('global');
  await chrome.storage.local.set({ global: { ...DEFAULT_GLOBAL, ...(global || {}) } });
  const { sites } = await chrome.storage.local.get('sites');
  if (!sites) await chrome.storage.local.set({ sites: {} });
});

// Descarga hojas de estilo de otros dominios (el content script no puede leerlas)
const cssCache = new Map();

async function fetchCSS(url) {
  if (cssCache.has(url)) return cssCache.get(url);
  const p = (async () => {
    const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const type = res.headers.get('content-type') || '';
    if (type && !type.includes('css') && !type.includes('text/plain')) throw new Error('No es CSS');
    const text = await res.text();
    if (text.length > 5_000_000) throw new Error('CSS demasiado grande');
    return text;
  })();
  cssCache.set(url, p);
  if (cssCache.size > 300) cssCache.delete(cssCache.keys().next().value);
  p.catch(() => cssCache.delete(url));
  return p;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'fetchCSS') {
    fetchCSS(msg.url)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'status' && sender.tab) {
    const text = msg.active ? (msg.scheme === 'light' ? '☀' : '☾') : '';
    chrome.action.setBadgeText({ tabId: sender.tab.id, text });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: msg.scheme === 'light' ? '#f5b301' : '#3b4a6b' });
  }
});

function hostOf(url) {
  try {
    const u = new URL(url);
    return u.hostname || u.protocol;
  } catch (e) {
    return null;
  }
}

// Atajo de teclado: Alt+Shift+D alterna el sitio actual entre oscuro y original
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-site') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const host = tab && hostOf(tab.url);
  if (!host) return;

  let status = null;
  try {
    status = await chrome.tabs.sendMessage(tab.id, { type: 'getStatus' });
  } catch (e) { /* página sin content script */ }

  const { sites = {} } = await chrome.storage.local.get('sites');
  const site = sites[host] || {};
  site.mode = status && status.active ? 'off' : 'dark';
  sites[host] = site;
  await chrome.storage.local.set({ sites });
});
