/*
 * Utilidades de color: parseo de cualquier color CSS y transformación
 * a esquema oscuro o claro manteniendo el tono (hue) original.
 */
(() => {
  if (globalThis.DFColors) return;

  const parseCache = new Map();
  let ctx = null;

  function getCtx() {
    if (!ctx) {
      try {
        ctx = new OffscreenCanvas(1, 1).getContext('2d');
      } catch (e) {
        ctx = document.createElement('canvas').getContext('2d');
      }
    }
    return ctx;
  }

  const RGB_RE = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

  /** Devuelve {r,g,b,a} (0-255, a 0-1) o null si no es un color concreto. */
  function parse(value) {
    if (!value) return null;
    const v = value.trim().toLowerCase();
    if (!v || v === 'transparent' || v === 'currentcolor' || v === 'inherit' ||
        v === 'initial' || v === 'unset' || v === 'revert' || v === 'none' ||
        v.includes('var(') || v.includes('calc(') || v.startsWith('-webkit-')) {
      return null;
    }
    if (parseCache.has(v)) return parseCache.get(v);

    let out = null;
    let m = v.match(RGB_RE);
    if (!m) {
      const c = getCtx();
      c.fillStyle = '#010203';
      c.fillStyle = v;
      const s = c.fillStyle;
      if (s === '#010203' && v !== '#010203' && v !== 'rgb(1, 2, 3)') {
        out = null;
      } else if (s[0] === '#') {
        out = {
          r: parseInt(s.slice(1, 3), 16),
          g: parseInt(s.slice(3, 5), 16),
          b: parseInt(s.slice(5, 7), 16),
          a: 1
        };
      } else {
        m = s.match(RGB_RE);
      }
    }
    if (m) {
      let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      out = { r: +m[1], g: +m[2], b: +m[3], a };
    }
    if (parseCache.size > 5000) parseCache.clear();
    parseCache.set(v, out);
    return out;
  }

  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return { h, s, l };
  }

  function hslToRgb({ h, s, l }) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    };
  }

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

  /** Luminancia relativa (0 = negro, 1 = blanco). */
  function luminance({ r, g, b }) {
    const f = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  /*
   * Curvas de luminosidad. kind: 'bg' | 'text' | 'border'
   */
  const curves = {
    dark: {
      bg: (l) => (l < 0.22 ? l : 0.08 + (1 - l) * 0.28),
      text: (l) => (l > 0.55 ? Math.max(l, 0.8) : 0.92 - l * 0.45),
      border: (l) => 0.2 + (1 - l) * 0.3
    },
    light: {
      bg: (l) => (l > 0.8 ? l : 0.97 - l * 0.22),
      text: (l) => (l < 0.45 ? Math.min(l, 0.25) : 0.08 + (1 - l) * 0.45),
      border: (l) => 0.88 - l * 0.3
    }
  };

  function transformRGBA(c, kind, scheme) {
    const hsl = rgbToHsl(c);
    const curve = curves[scheme][kind] || curves[scheme].bg;
    hsl.l = clamp(curve(hsl.l));
    // Reducimos un poco la saturación de fondos muy saturados en modo oscuro
    if (scheme === 'dark' && kind === 'bg' && hsl.s > 0.7) hsl.s *= 0.85;
    const o = hslToRgb(hsl);
    return c.a < 1 ? `rgba(${o.r}, ${o.g}, ${o.b}, ${+c.a.toFixed(3)})` : `rgb(${o.r}, ${o.g}, ${o.b})`;
  }

  const outCache = new Map();

  /** Transforma un valor de color CSS. Devuelve null si no se puede. */
  function transform(value, kind, scheme) {
    const key = scheme + kind + value;
    if (outCache.has(key)) return outCache.get(key);
    const c = parse(value);
    const res = c ? transformRGBA(c, kind, scheme) : null;
    if (outCache.size > 10000) outCache.clear();
    outCache.set(key, res);
    return res;
  }

  const COLOR_IN_TEXT = /(rgba?\([^)]*\)|hsla?\([^)]*\)|#[0-9a-f]{3,8}\b)/gi;

  /** Reemplaza todos los colores dentro de un valor compuesto (gradientes, sombras). */
  function transformAll(value, kind, scheme) {
    let changed = false;
    const out = value.replace(COLOR_IN_TEXT, (m) => {
      const t = transform(m, kind, scheme);
      if (t) { changed = true; return t; }
      return m;
    });
    return changed ? out : null;
  }

  globalThis.DFColors = { parse, transform, transformAll, luminance };
})();
