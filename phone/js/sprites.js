// Browser port of sdmon.cpp: reads the TPK2 (animated PMD sprites) and TPTH
// (gallery thumbnails) files that tools/pack_pmd.py / make_thumbs.py produce.
// Frames are pre-rendered once to small canvases so drawing is a scaled blit.

export const PMD_IDLE = 0, PMD_WALKL = 1, PMD_WALKR = 2, PMD_SLEEP = 3, PMD_EAT = 4,
  PMD_HURT = 5, PMD_ATTACK = 6, PMD_POSE = 7, PMD_HOP = 8, PMD_NOD = 9,
  PMD_BREATH = 10, PMD_SIT = 11, PMD_NACTS = 12;

// sprite files live in the firmware's SD-card folder, one level above phone/
export const MONS_URL = new URL('../../tools/sdcard/mons/', import.meta.url);

export const INK_K = 0x18c4;

export function rgb565ToCss(c) {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  return `rgb(${(r << 3) | (r >> 2)},${(g << 2) | (g >> 4)},${(b << 3) | (b >> 2)})`;
}
function rgb565ToRgba(c) {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255];
}
const INK_RGBA = rgb565ToRgba(INK_K);

// indexed pixels (0xFF = transparent) -> canvas
export function indexedToCanvas(data, off, w, h, pal, sil) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  const px = img.data;
  for (let i = 0; i < w * h; i++) {
    const idx = data[off + i];
    if (idx === 0xff) continue;
    const c = sil ? INK_RGBA : pal[idx] || INK_RGBA;
    px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export class PmdMon {
  constructor() { this.unload(); }

  unload() {
    this.loaded = false;
    this.failed = false;
    this.key = '';
    this.acts = Array.from({ length: PMD_NACTS }, () => ({ w: 0, h: 0, frames: 0, base: 0, top: 0, ms: [], data: null, off: 0 }));
    this.pal = [];
    this.cache = new Map();
    this.token = (this.token || 0) + 1;
  }

  has(a) { return this.loaded && a < PMD_NACTS && this.acts[a].frames > 0; }

  // async; draws nothing until ready. Falls back to the normal sprite if the shiny is missing.
  load(dex, shiny) {
    const key = `${dex}:${shiny ? 1 : 0}`;
    if (this.key === key && (this.loaded || !this.failed)) return;
    this.unload();
    this.key = key;
    const token = this.token;
    const name = (s) => `p${s ? 's' : ''}${String(dex).padStart(3, '0')}.bin`;
    const get = (n) => fetch(new URL(n, MONS_URL)).then((r) => (r.ok ? r.arrayBuffer() : null));
    (async () => {
      let buf = null;
      try {
        buf = await get(name(shiny));
        if (!buf && shiny) buf = await get(name(false));
      } catch { buf = null; }
      if (token !== this.token) return;
      if (!buf || !this.parse(new Uint8Array(buf))) this.failed = true;
    })();
  }

  parse(b) {
    if (b.length < 7 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'TPK2') return false;
    const nActs = b[4];
    const palCount = b[5] | (b[6] << 8);
    if (palCount > 256 || 7 + palCount * 2 > b.length) return false;
    for (let i = 0; i < palCount; i++) this.pal.push(rgb565ToRgba(b[7 + i * 2] | (b[8 + i * 2] << 8)));
    let p = 7 + palCount * 2;
    for (let i = 0; i < nActs && p + 4 <= b.length; i++) {
      const id = b[p], w = b[p + 1], h = b[p + 2], nf = b[p + 3];
      p += 4;
      if (id >= PMD_NACTS || nf > 24) return false;
      const bytes = nf * 2 + w * h * nf;
      if (!w || !h || !nf || p + bytes > b.length) return false;
      const a = this.acts[id];
      a.w = w; a.h = h; a.frames = nf; a.ms = [];
      for (let k = 0; k < nf; k++) {
        const ms = b[p] | (b[p + 1] << 8);
        a.ms.push(ms || 100);
        p += 2;
      }
      a.data = b; a.off = p;
      p += w * h * nf;
      // lowest and highest opaque rows over all frames: feet line, and the
      // visible height (frames carry a lot of empty margin)
      let base = 1, top = h - 1;
      const rowHas = (fo, r) => {
        for (let c = 0; c < w; c++) if (b[fo + r * w + c] !== 0xff) return true;
        return false;
      };
      for (let f = 0; f < nf; f++) {
        const fo = a.off + f * w * h;
        for (let r = h - 1; r >= 0; r--) if (rowHas(fo, r)) { if (r + 1 > base) base = r + 1; break; }
        for (let r = 0; r < h; r++) if (rowHas(fo, r)) { if (r < top) top = r; break; }
      }
      a.base = base;
      a.top = Math.min(top, base - 1);
    }
    this.loaded = true;
    return true;
  }

  frameCanvas(actId, fi, sil) {
    const k = actId * 64 + fi * 2 + (sil ? 1 : 0);
    let cv = this.cache.get(k);
    if (!cv) {
      const a = this.acts[actId];
      cv = indexedToCanvas(a.data, a.off + fi * a.w * a.h, a.w, a.h, this.pal, sil);
      this.cache.set(k, cv);
    }
    return cv;
  }
}

export function pmdActTotalMs(a) {
  let t = 0;
  for (let i = 0; i < a.frames; i++) t += a.ms[i];
  return t || 100;
}

export function pmdFrameAt(a, t, loop) {
  const total = pmdActTotalMs(a);
  if (!loop && t >= total) return a.frames - 1;
  t %= total;
  let i = 0;
  for (let guard = 0; guard < a.frames && t >= a.ms[i]; guard++) {
    t -= a.ms[i];
    i = (i + 1) % a.frames;
  }
  return i;
}

// thumbs.bin: 40x40 gallery thumbnails for all 151
export class Thumbs {
  constructor() { this.loaded = false; this.cache = new Map(); }

  async load() {
    try {
      const r = await fetch(new URL('thumbs.bin', MONS_URL));
      if (!r.ok) return;
      const b = new Uint8Array(await r.arrayBuffer());
      if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'TPTH') return;
      this.data = b;
      this.count = b[4] | (b[5] << 8);
      this.loaded = true;
    } catch {}
  }

  // {w, h, canvas} for a dex number, or null
  get(dex, sil) {
    if (!this.loaded || dex < 1 || dex > this.count) return null;
    const k = dex * 2 + (sil ? 1 : 0);
    if (this.cache.has(k)) return this.cache.get(k);
    const b = this.data;
    const o = 6 + 4 * (dex - 1);
    const off = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    if (off > b.length - 3) return null;
    const w = b[off], h = b[off + 1], n = b[off + 2];
    if (off + 3 + n * 2 + w * h > b.length) return null;
    const pal = [];
    for (let i = 0; i < n; i++) pal.push(rgb565ToRgba(b[off + 3 + i * 2] | (b[off + 4 + i * 2] << 8)));
    const t = { w, h, canvas: indexedToCanvas(b, off + 3 + n * 2, w, h, pal, sil) };
    this.cache.set(k, t);
    return t;
  }
}
