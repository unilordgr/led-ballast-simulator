/* ===== util.js : small helpers shared by the drawing code and the UI ===== */
const M = LEDModel;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const F = {
  mono: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  sans: '"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
  disp: '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif'
};

/* number formatting */
function nf(v, d) {
  if (v === Infinity) return '∞';
  if (!isFinite(v)) return '–';
  if (d == null) d = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  const s = Math.abs(v) < Math.pow(10, -d) / 2 ? (0).toFixed(d) : v.toFixed(d);
  const [a, b] = s.split('.');
  return a.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (b ? '.' + b : '');
}
const nf0 = (v) => nf(v, 0), nf1 = (v) => nf(v, 1), nf2 = (v) => nf(v, 2);
function niceMax(v) {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
function mixRGB(a, b, t) { return 'rgb(' + a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',') + ')'; }

/* canvas helpers */
function fitCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}
function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function arrow(ctx, x0, y0, x1, y1, hl, hw) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  const bx = x1 - Math.cos(a) * hl, by = y1 - Math.sin(a) * hl;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(bx, by); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(bx + Math.cos(a + Math.PI / 2) * hw, by + Math.sin(a + Math.PI / 2) * hw);
  ctx.lineTo(bx + Math.cos(a - Math.PI / 2) * hw, by + Math.sin(a - Math.PI / 2) * hw);
  ctx.closePath(); ctx.fill();
}
function txt(ctx, s, x, y, o) {
  o = o || {};
  ctx.font = o.font || ('500 11px ' + F.sans);
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = o.base || 'alphabetic';
  if (o.halo) { ctx.lineJoin = 'round'; ctx.lineWidth = o.haloW || 3; ctx.strokeStyle = o.halo; ctx.strokeText(s, x, y); }
  ctx.fillStyle = o.color || '#fff';
  ctx.fillText(s, x, y);
}
function line(ctx, x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }

/* theme tokens for the canvases that follow the page theme (the stability map) */
let themeCache = null;
function theme() {
  if (!themeCache) {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    themeCache = {
      ink: g('--ink'), ink2: g('--ink2'), ink3: g('--ink3'), line: g('--line'), line2: g('--line2'), panel: g('--panel'),
      accent: g('--accent'), good: g('--good'), warn: g('--warn'), crit: g('--crit'),
      goodInk: g('--good-ink'), warnInk: g('--warn-ink'), critInk: g('--crit-ink'),
      screen: g('--c-screen'), ballast: g('--c-ballast'), frame: g('--c-frame')
    };
  }
  return themeCache;
}
function resetTheme() { themeCache = null; }
