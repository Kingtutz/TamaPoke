// Minimal Arduino_GFX look-alike, so TamaPoke.ino's drawing code ports line by
// line (RGB565 colors, top-left text cursor). The canvas is always 466 logical
// units wide; its height (gfx.h) follows the element's aspect ratio.
import { rgb565ToCss, INK_K } from './sprites.js';
import { MAPS, PALETTE } from './data.js';

export const W = 466;
export const C565 = (r, g, b) => (((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));

export const UI_BG_DAY = 0xf77c, UI_BG_NIGHT = 0x10c5, UI_INK = 0x2946, UI_INK_NIGHT = 0xdefe,
  UI_TRACK = 0xde97, UI_BAR_OK = 0x5dcd, UI_BAR_WARN = 0xed07, UI_BAR_BAD = 0xea87,
  UI_WHITE = 0xffff, BLACK = 0;

export function lerp565(a, b, i, n) {
  if (n <= 0) return a;
  const ar = (a >> 11) & 31, ag = (a >> 5) & 63, ab = a & 31;
  const br = (b >> 11) & 31, bg = (b >> 5) & 63, bb = b & 31;
  const t = (x, y) => Math.trunc(x + ((y - x) * i) / n);
  return (t(ar, br) << 11) | (t(ag, bg) << 5) | t(ab, bb);
}

const cssCache = new Map();
const css = (c) => {
  let s = cssCache.get(c);
  if (!s) { s = rgb565ToCss(c); cssCache.set(c, s); }
  return s;
};

const FONT = '"PressStart2P", "Hiragino Sans", "Apple SD Gothic Neo", "Noto Sans CJK JP", system-ui, sans-serif';

export class Gfx {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 1;
    this.cx = 0;
    this.cy = 0;
    this.color = UI_INK;
    this.cjk = false;
    this.h = W;
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return; // hidden: keep the last size
    this.h = Math.max(240, Math.round((W * r.height) / r.width));
    const k = (r.width * (window.devicePixelRatio || 1)) / W;
    const pw = Math.round(W * k), ph = Math.round(this.h * k);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.ctx.setTransform(pw / W, 0, 0, pw / W, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  fillScreen(c) { this.fillRect(0, 0, W, this.h, c); }
  fillRect(x, y, w, h, c) { this.ctx.fillStyle = css(c); this.ctx.fillRect(x, y, w, h); }

  rr(x, y, w, h, r) {
    const ctx = this.ctx;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }
  fillRoundRect(x, y, w, h, r, c) {
    if (w <= 0 || h <= 0) return;
    this.rr(x, y, w, h, r);
    this.ctx.fillStyle = css(c);
    this.ctx.fill();
  }
  drawRoundRect(x, y, w, h, r, c) {
    this.rr(x + 0.5, y + 0.5, w - 1, h - 1, r);
    this.ctx.strokeStyle = css(c);
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }
  fillCircle(x, y, r, c) {
    if (r <= 0) return;
    this.ctx.beginPath();
    this.ctx.arc(x + 0.5, y + 0.5, r + 0.5, 0, Math.PI * 2);
    this.ctx.fillStyle = css(c);
    this.ctx.fill();
  }
  drawCircle(x, y, r, c) {
    if (r <= 0) return;
    this.ctx.beginPath();
    this.ctx.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2);
    this.ctx.strokeStyle = css(c);
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }
  fillTriangle(x0, y0, x1, y1, x2, y2, c) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fillStyle = css(c);
    ctx.fill();
  }
  drawLine(x0, y0, x1, y1, c) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, y0 + 0.5);
    ctx.lineTo(x1 + 0.5, y1 + 0.5);
    ctx.strokeStyle = css(c);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---- text (cursor = top-left, like the firmware's classic font) ----
  // CJK falls back to a system font; bold keeps its strokes as heavy as the pixel font
  font(size) { return this.cjk ? `bold ${7 * size}px ${FONT}` : `${6 * size}px ${FONT}`; }
  setTextSize(n) { this.size = n; }
  setTextColor(c) { this.color = c; }
  setCursor(x, y) { this.cx = x; this.cy = y; }
  textW(s, size) {
    this.ctx.font = this.font(size);
    return Math.round(this.ctx.measureText(String(s)).width);
  }
  centerX(s, size) { return (W >> 1) - (this.textW(s, size) >> 1); }
  print(s) {
    s = String(s);
    const ctx = this.ctx;
    ctx.font = this.font(this.size);
    ctx.textBaseline = 'top';
    ctx.fillStyle = css(this.color);
    ctx.fillText(s, this.cx, this.cy);
    this.cx += ctx.measureText(s).width;
  }

  // ---- bitmaps ----
  // char-map sprite from species.h ('.' = transparent), scaled by s
  drawMap(name, x, y, s, sil) {
    const cv = mapCanvas(name, sil);
    this.blit(cv, x, y, cv.width * s, cv.height * s);
  }
  blit(cv, x, y, w, h) {
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(cv, Math.round(x), Math.round(y), w, h);
  }
}

// species.h char maps rendered once to 1:1 canvases (also used as HTML icons)
const mapCache = new Map();
export function mapCanvas(name, sil = false) {
  const key = name + (sil ? '#' : '');
  let cv = mapCache.get(key);
  if (!cv) {
    const rows = MAPS[name];
    cv = document.createElement('canvas');
    cv.width = rows[0].length;
    cv.height = rows.length;
    const c = cv.getContext('2d');
    rows.forEach((row, r) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.') continue;
        c.fillStyle = css(sil ? INK_K : PALETTE[ch] ?? 0);
        c.fillRect(i, r, 1, 1);
      }
    });
    mapCache.set(key, cv);
  }
  return cv;
}
export const mapDataUrl = (name) => mapCanvas(name).toDataURL();
export const cssColor = css;
