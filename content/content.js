/*
 * Modo Oscuro Forzado — content script
 *
 * Dos motores:
 *  - "dynamic": lee las hojas de estilo, estilos inline y atributos de color de la
 *    página, recalcula cada color (fondo, texto, bordes, sombras, gradientes,
 *    variables CSS, SVG) y genera una hoja de estilos de reemplazo.
 *  - "filter": invierte la página con filtros CSS (rápido, compatible con todo,
 *    menos preciso). Imágenes y videos se re-invierten para verse normales.
 */
(() => {
  if (window.__darkForceLoaded) return;
  window.__darkForceLoaded = true;

  const C = globalThis.DFColors;
  const isTop = window.top === window;
  const HOST = topHost();

  const DEFAULTS = {
    global: {
      mode: 'off',          // 'off' | 'dark' | 'light'
      engine: 'dynamic',    // 'dynamic' | 'filter'
      brightness: 100,
      contrast: 100,
      sepia: 0,
      detectDark: true,     // no oscurecer sitios que ya son oscuros (solo modo global)
      dimImages: false
    },
    sites: {}               // host -> { mode: 'default'|'dark'|'light'|'off', engine: 'default'|'dynamic'|'filter' }
  };

  let settings = structuredClone(DEFAULTS);
  let current = { scheme: null, engine: null };
  let detected = null; // 'dark' | 'light' | null — esquema original de la página
  let skippedBecauseNative = false;

  // ---------------------------------------------------------------- utilidades
  function topHost() {
    try {
      if (isTop) return location.hostname || location.protocol;
      const ao = location.ancestorOrigins;
      if (ao && ao.length) return new URL(ao[ao.length - 1]).hostname;
      if (document.referrer) return new URL(document.referrer).hostname;
    } catch (e) { /* ignore */ }
    return location.hostname;
  }

  function effective() {
    const g = settings.global;
    const s = settings.sites[HOST] || {};
    const explicit = s.mode && s.mode !== 'default';
    return {
      mode: explicit ? s.mode : g.mode,
      explicit,
      engine: s.engine && s.engine !== 'default' ? s.engine : g.engine
    };
  }

  function makeStyle(id) {
    const el = document.createElement('style');
    el.id = id;
    el.dataset.df = '1';
    el.setAttribute('media', 'all');
    return el;
  }

  const nodes = {
    base: makeStyle('darkforce-base'),
    override: makeStyle('darkforce-override'),
    filter: makeStyle('darkforce-filter')
  };

  function ensureNodes() {
    const root = document.documentElement;
    if (!root) return;
    for (const n of [nodes.base, nodes.override, nodes.filter]) {
      if (!n.textContent) { if (n.isConnected) n.remove(); continue; }
      if (n.parentNode !== root) root.appendChild(n);
    }
    // Mantener nuestros estilos al final del documento para ganar en la cascada
    const ours = [nodes.base, nodes.override, nodes.filter].filter((n) => n.isConnected);
    const tail = Array.from(root.children).slice(-ours.length);
    if (ours.some((n, i) => tail[i] !== n)) ours.forEach((n) => root.appendChild(n));
  }

  // --------------------------------------------------- CSS base y de filtros
  function baseCSS(scheme) {
    if (scheme === 'dark') {
      return `@layer darkforce-base {
  :root { color-scheme: dark; }
  html { background-color: #181a1b; color: #e8e6e3; }
  input, textarea, select, button { background-color: #1e2022; color: #e8e6e3; border-color: #3c4144; }
  a { color: #6ea8fe; }
  a:visited { color: #b39ddb; }
  ::placeholder { color: #8b9095; }
  mark { background-color: #5c4d00; color: #f0ece4; }
  hr { border-color: #3c4144; }
}
::selection { background-color: #1d4f91 !important; color: #fff !important; }
::-webkit-scrollbar { background-color: #202324; }
::-webkit-scrollbar-thumb { background-color: #454a4d; border-radius: 6px; }
::-webkit-scrollbar-corner { background-color: #181a1b; }`;
    }
    return `@layer darkforce-base {
  :root { color-scheme: light; }
  html { background-color: #ffffff; color: #1b1b1b; }
  input, textarea, select, button { background-color: #ffffff; color: #1b1b1b; border-color: #c4c7cc; }
  a { color: #0b57d0; }
  a:visited { color: #6a1b9a; }
  ::placeholder { color: #6b7075; }
  hr { border-color: #d0d3d8; }
}
::selection { background-color: #b3d4ff !important; color: #000 !important; }`;
  }

  function userFilter() {
    const g = settings.global;
    const parts = [];
    if (+g.brightness !== 100) parts.push(`brightness(${g.brightness / 100})`);
    if (+g.contrast !== 100) parts.push(`contrast(${g.contrast / 100})`);
    if (+g.sepia !== 0) parts.push(`sepia(${g.sepia / 100})`);
    return parts.join(' ');
  }

  function filterCSS(scheme, engine) {
    const extra = userFilter();
    let css = '';
    if (engine === 'filter') {
      const inv = 'invert(1) hue-rotate(180deg)';
      css += `html { filter: ${inv} ${extra} !important; }
@layer darkforce-base { html { background-color: ${scheme === 'dark' ? '#fff' : '#000'}; } }
img, video, canvas, iframe, embed, object, svg image, [style*="background-image"]:not(html):not(body) {
  filter: ${inv} !important;
}
picture img, picture video { filter: none !important; }
picture { filter: ${inv} !important; }
:fullscreen, :fullscreen * { filter: none !important; }`;
    } else if (extra) {
      css += `html { filter: ${extra} !important; }`;
    }
    if (settings.global.dimImages && scheme === 'dark') {
      css += `\nimg, video, picture { filter: brightness(0.82) !important; }`;
    }
    return css;
  }

  // ------------------------------------------------ motor dinámico: hojas CSS
  const PROPS = [
    ['background-color', 'bg'],
    ['color', 'text'],
    ['border-top-color', 'border'],
    ['border-right-color', 'border'],
    ['border-bottom-color', 'border'],
    ['border-left-color', 'border'],
    ['outline-color', 'border'],
    ['column-rule-color', 'border'],
    ['text-decoration-color', 'text'],
    ['caret-color', 'text'],
    ['-webkit-text-fill-color', 'text'],
    ['-webkit-text-stroke-color', 'text'],
    ['fill', 'text'],
    ['stroke', 'text'],
    ['stop-color', 'bg'],
    ['flood-color', 'bg'],
    ['lighting-color', 'bg']
  ];
  const COMPOSITE = [
    ['background-image', 'bg'],
    ['box-shadow', 'bg'],
    ['text-shadow', 'bg']
  ];

  const VAR_BG = /(bg|background|surface|canvas|backdrop|paper|card|panel|layer|overlay|base|body|page|fill|well|shade|highlight)/;
  const VAR_TEXT = /(text|fg|foreground|font|ink|link|heading|title|icon|on-|label|copy|content|primary-color|muted)/;
  const VAR_BORDER = /(border|outline|divider|separator|stroke|ring|rule|line)/;

  function varKind(name, value) {
    const n = name.toLowerCase();
    if (VAR_BORDER.test(n)) return 'border';
    if (VAR_TEXT.test(n) && !/bg|background/.test(n)) return 'text';
    if (VAR_BG.test(n)) return 'bg';
    // Desconocida: decidir por luminosidad (claras -> fondo, oscuras -> texto)
    const c = C.parse(value);
    if (!c) return 'bg';
    const L = C.luminance(c);
    if (current.scheme === 'dark') return L > 0.6 ? 'bg' : L < 0.08 ? 'text' : null;
    return L < 0.06 ? 'bg' : L > 0.5 ? 'text' : null;
  }

  function transformVar(name, value, scheme) {
    const v = value.trim();
    if (!v || v.includes('url(')) return null;
    if (C.parse(v)) {
      const kind = varKind(name, v);
      return kind ? C.transform(v, kind, scheme) : null;
    }
    if (/^#[0-9a-f]{3,8}$|rgba?\(|hsla?\(|gradient/i.test(v)) {
      return C.transformAll(v, VAR_BORDER.test(name) ? 'border' : 'bg', scheme);
    }
    // Canales sueltos tipo "255, 255, 255" o "255 255 255" (Tailwind, Bootstrap)
    const ch = v.match(/^(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})$/);
    if (ch) {
      const kind = varKind(name, `rgb(${ch[1]},${ch[2]},${ch[3]})`);
      if (!kind) return null;
      const t = C.transform(`rgb(${ch[1]},${ch[2]},${ch[3]})`, kind, scheme);
      const m = t && t.match(/\d+/g);
      if (m) return v.includes(',') ? `${m[0]}, ${m[1]}, ${m[2]}` : `${m[0]} ${m[1]} ${m[2]}`;
    }
    return null;
  }

  function processDeclarations(style, scheme) {
    let out = '';
    for (const [prop, kind] of PROPS) {
      const v = style.getPropertyValue(prop);
      if (!v) continue;
      const t = C.transform(v, kind, scheme);
      if (t) out += `${prop}:${t}!important;`;
    }
    for (const [prop, kind] of COMPOSITE) {
      const v = style.getPropertyValue(prop);
      if (!v || v === 'none' || v.includes('url(') || v.includes('var(')) continue;
      const t = C.transformAll(v, kind, scheme);
      if (t) out += `${prop}:${t}!important;`;
    }
    for (let i = 0; i < style.length; i++) {
      const name = style[i];
      if (!name.startsWith('--')) continue;
      const t = transformVar(name, style.getPropertyValue(name), scheme);
      if (t) out += `${name}:${t}!important;`;
    }
    return out;
  }

  function processRules(rules, scheme, depth = 0) {
    if (depth > 12) return '';
    let out = '';
    for (const r of rules) {
      try {
        if (r.selectorText !== undefined && r.style) {
          // CSSStyleRule (puede tener reglas anidadas)
          const decl = processDeclarations(r.style, scheme);
          const nested = r.cssRules && r.cssRules.length ? processRules(r.cssRules, scheme, depth + 1) : '';
          if (decl || nested) out += `${r.selectorText}{${decl}${nested}}\n`;
        } else if (r.style && !r.cssRules) {
          // CSSNestedDeclarations
          out += processDeclarations(r.style, scheme);
        } else if (r.styleSheet && r.href !== undefined) {
          // @import
          const inner = processSheet(r.styleSheet, scheme);
          const media = r.media && r.media.mediaText;
          if (inner) out += media && media !== 'all' ? `@media ${media}{${inner}}\n` : inner;
        } else if (r.cssRules) {
          const inner = processRules(r.cssRules, scheme, depth + 1);
          if (!inner) continue;
          const ctor = r.constructor.name;
          if (ctor === 'CSSMediaRule') out += `@media ${r.media.mediaText}{${inner}}\n`;
          else if (ctor === 'CSSSupportsRule') out += `@supports ${r.conditionText}{${inner}}\n`;
          else if (ctor === 'CSSContainerRule') out += `@container ${r.conditionText}{${inner}}\n`;
          else if (ctor === 'CSSScopeRule') out += `@scope ${r.cssText.slice(6, r.cssText.indexOf('{'))}{${inner}}\n`;
          else if (ctor === 'CSSLayerBlockRule' || ctor === 'CSSStartingStyleRule') out += inner;
          // keyframes, font-face, etc. se ignoran
        }
      } catch (e) { /* regla no procesable */ }
    }
    return out;
  }

  const sheetCache = new WeakMap();   // CSSStyleSheet -> { len, scheme, css }
  const remote = new Map();           // href -> 'pending' | 'error' | CSSStyleSheet

  function processSheet(sheet, scheme) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      return processRemote(sheet, scheme);
    }
    if (!rules) return '';
    const cached = sheetCache.get(sheet);
    if (cached && cached.len === rules.length && cached.scheme === scheme) return cached.css;
    let css = processRules(rules, scheme);
    const media = sheet.media && sheet.media.mediaText;
    if (css && media && media !== 'all') css = `@media ${media}{${css}}`;
    sheetCache.set(sheet, { len: rules.length, scheme, css });
    return css;
  }

  // Hojas de otro dominio: el navegador no deja leer sus reglas, así que el
  // service worker las descarga y las analizamos aparte.
  function processRemote(sheet, scheme) {
    const href = sheet.href;
    if (!href) return '';
    const entry = remote.get(href);
    if (entry === 'pending' || entry === 'error') return '';
    if (entry) {
      let css = processSheet(entry, scheme);
      const media = sheet.media && sheet.media.mediaText;
      if (css && media && media !== 'all') css = `@media ${media}{${css}}`;
      return css;
    }
    remote.set(href, 'pending');
    chrome.runtime.sendMessage({ type: 'fetchCSS', url: href }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        remote.set(href, 'error');
        return;
      }
      try {
        const s = new CSSStyleSheet();
        s.replaceSync(res.text);
        remote.set(href, s);
        scheduleRebuild();
      } catch (e) {
        remote.set(href, 'error');
      }
    });
    return '';
  }

  function isOurs(sheet) {
    const n = sheet.ownerNode;
    return n && n.dataset && n.dataset.df === '1';
  }

  function sheetsSignature() {
    let sig = '';
    for (const s of document.styleSheets) {
      if (isOurs(s)) continue;
      let len = 'x';
      try { len = s.cssRules.length; } catch (e) { len = remote.get(s.href) instanceof CSSStyleSheet ? 'r' : 'x'; }
      sig += (s.disabled ? 'd' : '') + len + ',';
    }
    for (const s of document.adoptedStyleSheets || []) {
      try { sig += 'a' + s.cssRules.length + ','; } catch (e) { /* */ }
    }
    return sig;
  }

  let lastSig = '';
  function rebuildOverride() {
    if (current.engine !== 'dynamic' || !current.scheme) return;
    const scheme = current.scheme;
    const parts = [];
    for (const sheet of document.styleSheets) {
      if (sheet.disabled || isOurs(sheet)) continue;
      parts.push(processSheet(sheet, scheme));
    }
    for (const sheet of document.adoptedStyleSheets || []) parts.push(processSheet(sheet, scheme));
    const css = parts.join('\n');
    lastSig = sheetsSignature();
    if (nodes.override.textContent !== css) nodes.override.textContent = css;
    ensureNodes();
  }

  let rebuildTimer = 0;
  function scheduleRebuild() {
    if (rebuildTimer) return;
    rebuildTimer = setTimeout(() => {
      rebuildTimer = 0;
      rebuildOverride();
    }, 60);
  }

  // ------------------------------------- motor dinámico: inline y atributos
  const touched = new Map(); // Element -> Map(prop -> { orig, prio, ours })
  const INLINE_SELECTOR = '[style],[bgcolor],font[color],body[text],svg [fill],svg [stroke],svg[fill]';

  function setOverride(el, prop, value) {
    let rec = touched.get(el);
    if (!rec) { rec = new Map(); touched.set(el, rec); }
    const st = el.style;
    if (!rec.has(prop)) rec.set(prop, { orig: st.getPropertyValue(prop), prio: st.getPropertyPriority(prop), ours: value });
    else rec.get(prop).ours = value;
    st.setProperty(prop, value, 'important');
  }

  function processElement(el, scheme) {
    if (!(el instanceof Element) || el.dataset?.df) return;
    const st = el.style;
    const rec = touched.get(el);
    if (st && st.length) {
      for (const [prop, kind] of PROPS) {
        const v = st.getPropertyValue(prop);
        if (!v) continue;
        const r = rec && rec.get(prop);
        if (r && r.ours === v) continue; // ya es nuestro valor
        if (r) r.orig = v, r.prio = st.getPropertyPriority(prop); // la página lo cambió
        const t = C.transform(v, kind, scheme);
        if (t) setOverride(el, prop, t);
      }
      for (const [prop, kind] of COMPOSITE) {
        const v = st.getPropertyValue(prop);
        if (!v || v === 'none' || v.includes('url(') || v.includes('var(')) continue;
        const r = rec && rec.get(prop);
        if (r && r.ours === v) continue;
        if (r) r.orig = v, r.prio = st.getPropertyPriority(prop);
        const t = C.transformAll(v, kind, scheme);
        if (t) setOverride(el, prop, t);
      }
      for (let i = 0; i < st.length; i++) {
        const name = st[i];
        if (!name.startsWith('--')) continue;
        const v = st.getPropertyValue(name);
        const r = rec && rec.get(name);
        if (r && r.ours === v) continue;
        if (r) r.orig = v, r.prio = st.getPropertyPriority(name);
        const t = transformVar(name, v, scheme);
        if (t) setOverride(el, name, t);
      }
    }
    // Atributos HTML antiguos (sitios viejos usan bgcolor / <font color>)
    const attr = (name, prop, kind) => {
      const v = el.getAttribute(name);
      if (!v || (st && st.getPropertyValue(prop) && !(rec && rec.has(prop)))) return;
      const t = C.transform(v, kind, scheme);
      if (t) setOverride(el, prop, t);
    };
    if (el.hasAttribute('bgcolor')) attr('bgcolor', 'background-color', 'bg');
    if (el.tagName === 'FONT' && el.hasAttribute('color')) attr('color', 'color', 'text');
    if (el.tagName === 'BODY' && el.hasAttribute('text')) attr('text', 'color', 'text');
    if (el instanceof SVGElement) {
      if (el.hasAttribute('fill')) attr('fill', 'fill', 'text');
      if (el.hasAttribute('stroke')) attr('stroke', 'stroke', 'text');
    }
  }

  function processTree(root, scheme) {
    if (!root) return;
    if (root.nodeType === 1) {
      if (root.matches(INLINE_SELECTOR)) processElement(root, scheme);
      root.querySelectorAll(INLINE_SELECTOR).forEach((el) => processElement(el, scheme));
    }
  }

  function restoreInline() {
    for (const [el, rec] of touched) {
      for (const [prop, { orig, prio, ours }] of rec) {
        if (el.style.getPropertyValue(prop) !== ours) continue; // la página lo cambió, no tocar
        if (orig) el.style.setProperty(prop, orig, prio);
        else el.style.removeProperty(prop);
      }
      if (el.getAttribute('style') === '') el.removeAttribute('style');
    }
    touched.clear();
  }

  // --------------------------------------------------------------- observadores
  let observer = null;
  let pendingNodes = new Set();
  let flushTimer = 0;

  function flushNodes() {
    flushTimer = 0;
    const scheme = current.scheme;
    if (!scheme || current.engine !== 'dynamic') { pendingNodes.clear(); return; }
    const list = pendingNodes;
    pendingNodes = new Set();
    for (const n of list) if (n.isConnected) processTree(n, scheme);
  }

  function onMutations(muts) {
    let styleChanged = false;
    for (const m of muts) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) {
            if (m.target.nodeName === 'STYLE') styleChanged = true;
            continue;
          }
          if (n.dataset && n.dataset.df) continue;
          const tag = n.nodeName;
          if (tag === 'STYLE' || tag === 'LINK') styleChanged = true;
          else pendingNodes.add(n);
        }
        if (m.target === document.documentElement) ensureNodes();
        for (const n of m.removedNodes) if (n.nodeName === 'STYLE' || n.nodeName === 'LINK') styleChanged = true;
      } else if (m.type === 'attributes') {
        const t = m.target;
        if (t.dataset && t.dataset.df) continue;
        if (t.nodeName === 'LINK' || t.nodeName === 'STYLE') styleChanged = true;
        else pendingNodes.add(t);
      } else if (m.type === 'characterData') {
        if (m.target.parentNode && m.target.parentNode.nodeName === 'STYLE') styleChanged = true;
      }
    }
    if (styleChanged) scheduleRebuild();
    if (pendingNodes.size && !flushTimer) flushTimer = setTimeout(flushNodes, 30);
  }

  let pollTimer = 0;
  function startWatching() {
    if (observer) return;
    observer = new MutationObserver(onMutations);
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'bgcolor', 'color', 'text', 'fill', 'stroke', 'href', 'media', 'disabled'],
      characterData: true
    });
    document.addEventListener('load', onResourceLoad, true);
    // CSS-in-JS (emotion, styled-components...) usa insertRule sin mutar el DOM
    pollTimer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (sheetsSignature() !== lastSig) scheduleRebuild();
    }, 1000);
  }

  function stopWatching() {
    if (observer) observer.disconnect();
    observer = null;
    document.removeEventListener('load', onResourceLoad, true);
    clearInterval(pollTimer);
    clearTimeout(flushTimer);
    clearTimeout(rebuildTimer);
    flushTimer = rebuildTimer = 0;
    pendingNodes.clear();
  }

  function onResourceLoad(e) {
    if (e.target && e.target.nodeName === 'LINK') scheduleRebuild();
  }

  // ----------------------------------------------- detección de tema original
  function detectScheme() {
    if (!document.body) return null;
    const ours = [nodes.base, nodes.override, nodes.filter];
    ours.forEach((n) => (n.media = 'not all'));
    const savedInline = [];
    for (const [el, rec] of touched) {
      if (el === document.body || el === document.documentElement) {
        for (const [prop, r] of rec) {
          savedInline.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
          if (r.orig) el.style.setProperty(prop, r.orig, r.prio); else el.style.removeProperty(prop);
        }
      }
    }
    let result = 'light';
    try {
      const pick = (el) => {
        const c = C.parse(getComputedStyle(el).backgroundColor);
        return c && c.a > 0.5 ? c : null;
      };
      const bg = pick(document.body) || pick(document.documentElement);
      if (bg) {
        result = C.luminance(bg) < 0.18 ? 'dark' : 'light';
      } else {
        const cs = getComputedStyle(document.documentElement).colorScheme || '';
        const meta = document.querySelector('meta[name="color-scheme"]');
        const metaVal = meta ? meta.content : '';
        if (/^\s*dark/.test(cs) || /^\s*dark/.test(metaVal)) result = 'dark';
      }
    } catch (e) { result = null; }
    for (const [el, prop, v, p] of savedInline) el.style.setProperty(prop, v, p);
    ours.forEach((n) => (n.media = 'all'));
    return result;
  }

  // -------------------------------------------------------- aplicar / quitar
  function teardown() {
    stopWatching();
    restoreInline();
    for (const n of Object.values(nodes)) {
      n.textContent = '';
      if (n.isConnected) n.remove();
    }
    current = { scheme: null, engine: null };
  }

  function apply() {
    const cfg = effective();
    let scheme = cfg.mode === 'dark' || cfg.mode === 'light' ? cfg.mode : null;
    skippedBecauseNative = false;
    if (scheme && !cfg.explicit && settings.global.detectDark && detected === scheme) {
      scheme = null;
      skippedBecauseNative = true;
    }
    const engine = cfg.engine;

    if (scheme !== current.scheme || engine !== current.engine) teardown();
    if (!scheme) { reportStatus(); return; }

    current = { scheme, engine };
    nodes.filter.textContent = filterCSS(scheme, engine);
    if (engine === 'dynamic') {
      nodes.base.textContent = baseCSS(scheme);
      rebuildOverride();
      processTree(document.documentElement, scheme);
      startWatching();
    }
    ensureNodes();
    reportStatus();
  }

  function reportStatus() {
    if (!isTop) return;
    try {
      chrome.runtime.sendMessage({
        type: 'status',
        active: !!current.scheme,
        scheme: current.scheme
      }, () => void chrome.runtime.lastError);
    } catch (e) { /* contexto invalidado */ }
  }

  // ---------------------------------------------------------------- arranque
  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['global', 'sites'], (data) => {
        settings = {
          global: { ...DEFAULTS.global, ...(data.global || {}) },
          sites: data.sites || {}
        };
        resolve();
      });
    });
  }

  function redetect() {
    const d = detectScheme();
    if (d && d !== detected) {
      detected = d;
      apply();
    } else if (current.engine === 'dynamic') {
      scheduleRebuild();
    }
  }

  function whenRoot(fn) {
    if (document.documentElement) return fn();
    const mo = new MutationObserver(() => {
      if (document.documentElement) { mo.disconnect(); fn(); }
    });
    mo.observe(document, { childList: true });
  }

  loadSettings().then(() => {
    whenRoot(apply);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', redetect, { once: true });
    } else {
      redetect();
    }
    window.addEventListener('load', () => setTimeout(redetect, 50), { once: true });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.global) settings.global = { ...DEFAULTS.global, ...(changes.global.newValue || {}) };
    if (changes.sites) settings.sites = changes.sites.newValue || {};
    // Si cambian brillo/contraste/sepia sin cambiar el modo, solo actualizar filtros
    const prev = { ...current };
    apply();
    if (current.scheme && prev.scheme === current.scheme && prev.engine === current.engine) {
      nodes.filter.textContent = filterCSS(current.scheme, current.engine);
      ensureNodes();
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'getStatus' && isTop) {
      sendResponse({
        host: HOST,
        active: !!current.scheme,
        scheme: current.scheme,
        engine: current.engine,
        detected,
        skippedBecauseNative
      });
    }
  });
})();
