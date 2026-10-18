/* ===== scene.js : indoor hall, outdoor field, wind particles (side view backdrop) ===== */
const scene = { t: 0, fanA: 0, cloudT: 0, particles: [] };
const CLOUDS = [
  { x: 0.08, y: 0.17, s: 1.15, sp: 0.9 }, { x: 0.44, y: 0.09, s: 0.8, sp: 0.7 }, { x: 0.72, y: 0.24, s: 1.3, sp: 1.0 },
  { x: 0.27, y: 0.36, s: 0.7, sp: 0.55 }, { x: 0.9, y: 0.42, s: 0.9, sp: 0.6 }
];
const PUFFS = [[-1.15, 0.12, 0.5], [-0.55, -0.22, 0.68], [0.1, -0.38, 0.86], [0.8, -0.14, 0.66], [1.3, 0.1, 0.46], [0.1, 0.1, 0.8]];
const TREES = [{ dx: -6.6, h: 5.2, ph: 0.3 }, { dx: -4.7, h: 3.4, ph: 1.7 }, { dx: 5.9, h: 4.3, ph: 2.4 }, { dx: 7.7, h: 5.7, ph: 4.0 }];

function seedParticles(n) {
  scene.particles = Array.from({ length: n }, () => ({ fx: Math.random(), fy: Math.random(), sp: 0.7 + Math.random() * 0.6, len: 0.6 + Math.random() * 0.8 }));
}
/* speedMS: normal wind speed now (m/s), sign: +1 flows to the right */
function advanceScene(dt, speedMS, sign, V) {
  scene.t += dt;
  scene.fanA += dt * clamp(speedMS * 7, 0, 46);
  scene.cloudT += dt * (0.5 + speedMS) * sign;
  const want = clamp(Math.round(V.w * V.h / 2300), 90, 320);
  if (scene.particles.length !== want) seedParticles(want);
  const pxs = speedMS * V.s * 0.62;
  for (const q of scene.particles) {
    q.fx += sign * pxs * q.sp * dt / V.w;
    if (q.fx > 1.05) q.fx -= 1.1; else if (q.fx < -0.05) q.fx += 1.1;
  }
}

/* ---------------- indoor hall ---------------- */
function drawIndoor(ctx, V, env) {
  const { w, h, oy, s } = V;
  let g = ctx.createLinearGradient(0, 0, 0, oy);
  g.addColorStop(0, '#070b12'); g.addColorStop(1, '#16212e');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, oy);
  // acoustic wall panels
  const pw = Math.max(0.6 * s, 26);
  ctx.fillStyle = 'rgba(160,190,225,.03)';
  for (let x = -(((V.ox % (pw * 2)) + pw * 2) % (pw * 2)); x < w; x += pw * 2) ctx.fillRect(x, 0, pw, oy);
  // ceiling truss
  const th = clamp(oy * 0.06, 16, 30);
  ctx.fillStyle = '#0b1019'; ctx.fillRect(0, 0, w, th);
  ctx.strokeStyle = 'rgba(150,185,225,.25)'; ctx.lineWidth = 1;
  line(ctx, 0, th * 0.3, w, th * 0.3); line(ctx, 0, th - 0.5, w, th - 0.5);
  ctx.beginPath();
  for (let x = 0; x < w; x += th * 1.2) { ctx.moveTo(x, th * 0.3); ctx.lineTo(x + th * 0.6, th - 0.5); ctx.lineTo(x + th * 1.2, th * 0.3); }
  ctx.stroke();
  // light cones
  for (const f of [0.13, 0.38, 0.63, 0.88]) {
    const x = f * w, rad = oy * 0.5;
    const cg = ctx.createLinearGradient(0, th, 0, th + rad * 1.6);
    cg.addColorStop(0, 'rgba(255,236,200,.10)'); cg.addColorStop(1, 'rgba(255,236,200,0)');
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.moveTo(x - 5, th); ctx.lineTo(x + 5, th); ctx.lineTo(x + rad * 0.62, th + rad * 1.6); ctx.lineTo(x - rad * 0.62, th + rad * 1.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#d9e4f2'; ctx.fillRect(x - 5, th, 10, 3);
  }
  // floor
  g = ctx.createLinearGradient(0, oy, 0, h);
  g.addColorStop(0, '#28343f'); g.addColorStop(1, '#0a0e14');
  ctx.fillStyle = g; ctx.fillRect(0, oy, w, h - oy);
  ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.fillRect(0, oy, w, 1);
  floorRuler(ctx, V, 'rgba(190,210,235,.55)');
  drawFan(ctx, V, env);
}

function floorRuler(ctx, V, col) {
  const { w, oy, s, ox } = V;
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.fillStyle = col;
  ctx.font = '10px ' + F.mono; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const stepM = s >= 28 ? 1 : 2;
  const mMin = Math.floor((0 - ox) / s) - 1, mMax = Math.ceil((w - ox) / s) + 1;
  for (let m = mMin; m <= mMax; m += 0.5) {
    const x = ox + m * s; if (x < 0 || x > w) continue;
    const major = Math.abs(m - Math.round(m)) < 1e-6;
    line(ctx, x + 0.5, oy + 1, x + 0.5, oy + (major ? 7 : 3.5));
    if (major && Math.round(m) % stepM === 0 && Math.abs(x - ox) > 2) ctx.fillText((m > 0 ? '+' : '') + Math.round(m), x, oy + 10);
  }
  ctx.fillText('0', ox, oy + 10);
  ctx.textAlign = 'right'; ctx.fillText('m', w - 6, oy + 24);
}

function drawFan(ctx, V, env) {
  const { oy, s, w } = V;
  const dirS = env.sign;                         // +1: wind flows right, the fan sits on the left
  let x = V.ox - dirS * 4.6 * s;
  x = clamp(x, 34, w - 34);
  const hubY = oy - 1.02 * s, R = 0.4 * s;
  ctx.save(); ctx.translate(x, 0);
  ctx.fillStyle = '#2a3646'; rr(ctx, -0.26 * s, oy - 0.07 * s, 0.52 * s, 0.07 * s, 3); ctx.fill();
  ctx.fillStyle = '#3b4b5f'; ctx.fillRect(-0.022 * s, hubY, 0.044 * s, oy - hubY - 0.05 * s);
  ctx.fillStyle = '#4a5c73'; rr(ctx, -0.13 * s - 0.03 * s * dirS, hubY - 0.09 * s, 0.26 * s, 0.18 * s, 5); ctx.fill();
  const cx = dirS * 0.2 * s;
  ctx.fillStyle = 'rgba(170,210,255,.12)'; ctx.beginPath(); ctx.ellipse(cx, hubY, 0.055 * s, R, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(170,210,255,.5)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.ellipse(cx, hubY, 0.055 * s, R, 0, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#c4daf5'; ctx.lineWidth = Math.max(2, 0.03 * s); ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    const a = scene.fanA + k * TAU / 3;
    line(ctx, cx, hubY, cx + Math.cos(a) * 0.05 * s * dirS, hubY + Math.sin(a) * R * 0.93);
  }
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#8fb0d6'; ctx.beginPath(); ctx.arc(cx, hubY, 0.03 * s + 1, 0, TAU); ctx.fill();
  ctx.restore();
}

/* ---------------- outdoor field ---------------- */
function drawOutdoor(ctx, V, env) {
  const { w, h, oy, s, ox } = V;
  const storm = clamp((env.vmean - 9) / 16, 0, 1);
  let g = ctx.createLinearGradient(0, 0, 0, oy);
  g.addColorStop(0, mixRGB([84, 150, 222], [82, 92, 103], storm));
  g.addColorStop(1, mixRGB([196, 226, 248], [146, 156, 166], storm));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, oy);
  if (storm < 0.65) {                                    // sun
    const sx = w * 0.84, sy = oy * 0.2, a = 1 - storm / 0.65;
    const sg = ctx.createRadialGradient(sx, sy, 4, sx, sy, 70);
    sg.addColorStop(0, 'rgba(255,248,214,' + (0.95 * a) + ')'); sg.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = sg; ctx.fillRect(sx - 80, sy - 80, 160, 160);
    ctx.fillStyle = 'rgba(255,252,236,' + a + ')'; ctx.beginPath(); ctx.arc(sx, sy, 17, 0, TAU); ctx.fill();
  }
  hills(ctx, w, oy, oy * 0.10, oy * 0.12, mixRGB([142, 176, 156], [108, 124, 118], storm), 1.3);
  hills(ctx, w, oy, oy * 0.03, oy * 0.08, mixRGB([96, 144, 104], [74, 100, 84], storm), 4.1);
  // clouds
  const cc = mixRGB([255, 255, 255], [128, 138, 150], storm);
  for (const c of CLOUDS) {
    const span = w + 320;
    let x = ((c.x * span + env.sign * 0 + scene.cloudT * c.sp * 14) % span + span) % span - 160;
    const y = c.y * oy, r = 30 * c.s * clamp(s / 60, 0.7, 1.3);
    ctx.fillStyle = cc; ctx.globalAlpha = 0.86 - storm * 0.1;
    for (const p of PUFFS) { ctx.beginPath(); ctx.arc(x + p[0] * r, y + p[1] * r, p[2] * r, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  // ground
  g = ctx.createLinearGradient(0, oy, 0, h);
  g.addColorStop(0, mixRGB([96, 156, 84], [78, 118, 78], storm)); g.addColorStop(1, mixRGB([40, 98, 52], [34, 76, 50], storm));
  ctx.fillStyle = g; ctx.fillRect(0, oy, w, h - oy);
  ctx.fillStyle = 'rgba(40,52,64,.85)'; ctx.fillRect(ox - 3.4 * s, oy, 6.9 * s, Math.max(3, 0.09 * s));   // paved pad under the wall
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, oy, w, 1);
  floorRuler(ctx, V, 'rgba(255,255,255,.72)');
  // trees (sway with the wind)
  for (const t of TREES) {
    const x = ox + t.dx * s; if (x < -80 || x > w + 80) continue;
    const lean = env.sign * clamp(env.vmean / 24, 0, 0.55) * 0.9 + Math.sin(scene.t * (1.4 + env.vmean * 0.06) + t.ph) * 0.025 * (0.4 + env.vmean / 9);
    const th = t.h * s, tw = Math.max(3, 0.17 * s), trunk = th * 0.45, r = th * 0.27;
    ctx.save(); ctx.translate(x, oy); ctx.rotate(lean);
    ctx.fillStyle = '#5a3d27'; ctx.fillRect(-tw / 2, -trunk, tw, trunk);
    ctx.fillStyle = mixRGB([44, 120, 62], [34, 88, 56], storm);
    for (const p of [[0, -trunk - r * 0.55, r], [-r * 0.7, -trunk - r * 0.05, r * 0.72], [r * 0.7, -trunk - r * 0.1, r * 0.7], [0, -trunk - r * 1.35, r * 0.7]]) { ctx.beginPath(); ctx.arc(p[0], p[1], p[2], 0, TAU); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,.09)'; ctx.beginPath(); ctx.arc(-r * 0.25, -trunk - r * 0.9, r * 0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }
  drawFlag(ctx, V, env);
}
function hills(ctx, w, oy, base, amp, col, seed) {
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, oy);
  for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, oy - base - amp * (0.5 + 0.5 * Math.sin(x * 0.004 + seed)) - amp * 0.35 * Math.sin(x * 0.011 + seed * 2));
  ctx.lineTo(w, oy); ctx.closePath(); ctx.fill();
}
function drawFlag(ctx, V, env) {
  const { oy, s, ox } = V;
  const x = ox + env.sign * 3.9 * s, ph = 4.4 * s;
  const v = env.vmean, sgn = env.sign;
  ctx.fillStyle = '#c9d2dc'; ctx.fillRect(x - 1.5, oy - ph, 3, ph);
  ctx.beginPath(); ctx.arc(x, oy - ph, 3, 0, TAU); ctx.fill();
  const L = 1.35 * s, Hh = 0.8 * s, n = 14;
  const droop = (1 - clamp(v / 8, 0, 1)) * 1.25;
  const top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, wav = Math.sin(f * 7 - scene.t * (3 + v * 1.1)) * (0.02 + 0.06 * clamp(v / 10, 0, 1)) * s * f * 3;
    const px = x + sgn * Math.cos(droop * f) * L * f, py = oy - ph + 3 + Math.sin(droop * f) * L * f + wav;
    top.push([px, py]); bot.push([px, py + Hh * (1 - 0.15 * f)]);
  }
  ctx.fillStyle = '#e0453a'; ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]);
  for (const p of top) ctx.lineTo(p[0], p[1]);
  for (let i = n; i >= 0; i--) ctx.lineTo(bot[i][0], bot[i][1]);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.moveTo(top[4][0], top[4][1]);
  for (let i = 4; i <= 9; i++) ctx.lineTo(top[i][0], top[i][1]);
  for (let i = 9; i >= 4; i--) ctx.lineTo(lerp(top[i][0], bot[i][0], 0.45), lerp(top[i][1], bot[i][1], 0.45));
  ctx.closePath(); ctx.fill();
}

/* ---------------- wind streamlines ---------------- */
function drawParticles(ctx, V, env, topY) {
  const sign = env.sign, pxs = env.speed * V.s * 0.62;
  if (pxs < 0.5) return;
  const yMin = V.padTop - 6, yMax = V.oy - 8;
  ctx.lineCap = 'round';
  const col = env.outdoor ? '255,255,255' : '160,205,255';
  const A = env.outdoor ? 0.8 : 0.55;
  for (const q of scene.particles) {
    const x = q.fx * V.w, y0 = yMin + q.fy * (yMax - yMin);
    const len = clamp(pxs * 0.085 * q.len, 3, 72);
    const x2 = x - sign * len;
    const y1 = deflectY(y0, x, V, topY, sign), y2 = deflectY(y0, x2, V, topY, sign);
    ctx.strokeStyle = 'rgba(' + col + ',' + (A * (0.45 + 0.55 * (q.sp - 0.7) / 0.6)) + ')';
    ctx.lineWidth = 1.3;
    line(ctx, x2, y2, x, y1);
  }
  ctx.lineCap = 'butt';
}
function deflectY(y0, x, V, topY, sign) {
  const dx = (x - V.ox) * sign;
  const d = dx < 0 ? -dx / (1.5 * V.s) : dx / (2.6 * V.s);
  const f = d >= 1 ? 0 : smooth(1 - d);
  return y0 - Math.max(0, y0 - topY) * f;
}
