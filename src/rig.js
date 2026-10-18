/* ===== rig.js : the structure, stage, straps, annotations, the side view and the base-detail inset ===== */
const C = {
  screenBack: '#6b7789', screenFront: '#d5dde9', led: '#6fd6ff',
  frame: '#25c48d', frameDark: '#12875c',
  plate: '#f2c230', plateDark: '#9c7406', foot: '#d98a1a',
  ball0: '#f69660', ball1: '#c4511b', ballEdge: '#6e2a0c',
  conn: '#5ad7ff', gray: '#c9d4e3',
  strap: '#ffb020', strapHot: '#ff7a1a', strapBad: '#ff3b3b', stage0: '#445064', stage1: '#2b3544', deck: '#a9b6c9'
};
const INK = {
  indoor: { dim: '#7dd6ff', text: '#dcf2ff', halo: 'rgba(6,10,18,.88)', force: '#ff72d8', pivot: '#ff5a5a', arrow: 'rgba(200,228,255,.9)' },
  outdoor: { dim: '#0d5f8c', text: '#0b3550', halo: 'rgba(255,255,255,.9)', force: '#c2188f', pivot: '#d11f1f', arrow: 'rgba(255,255,255,.95)' }
};

function ballastPlates(kg) {
  if (kg < 0.05) return { n: 0, unit: 1, rem: 0 };
  const units = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  let unit = units[units.length - 1];
  for (const u of units) if (Math.ceil(kg / u - 1e-9) <= 10) { unit = u; break; }
  const n = Math.floor(kg / unit + 1e-9), rem = kg - n * unit;
  return { n, unit, rem: rem > 0.02 * unit ? rem / unit : 0 };
}

/* instantaneous elastic deflection (m, in the tipping direction) at each beam node, from the live wind and strap force */
function bendNow(D, sim) {
  if (D.loadKind === 'accel' && D.dyn.kind !== 'none' && sim.shake && D.modal.phi) {      // a shaken wall: the first mode moves, with its own swing
    const sg = D.dir === 'rear' ? 1 : -1; return D.modal.phi.map((p) => p * sim.q * sg);
  }
  const b = D.bend, lam = sim.lamB !== undefined ? sim.lamB : (sim.lam || 0), Ph = sim.Ph || 0;
  return b.nodeZ.map((z, k) => lam * b.dp1[k] - Ph * b.Gat[k]);
}
function bendExag(D, mode) {                         // visual exaggeration: auto makes a few per cent of the height visible
  const top = Math.abs(D.bend.topEl) + 1e-9;
  if (mode === 'true') return 1;
  return clamp(0.035 * D.geom.L / top, 1, 400);
}
/* offset in px for a point at height z above the toe */
function offFn(st, V, nodesNow, exag) {
  const D = st.D, b = D.bend, sign = D.dir === 'rear' ? 1 : -1, K = b.nodeZ.length - 1, L = b.L;
  return (zRel) => {
    const f = clamp(zRel / L, 0, 1) * K, i = Math.min(K - 1, Math.floor(f)), t = f - i;
    return sign * exag * (nodesNow[i] * (1 - t) + nodesNow[i + 1] * t) * V.s;
  };
}

function sideView(w, h, S, inset, D) {
  const hs = D.geom.hs, stg = D.stage;
  const padTop = w < 560 ? 96 : 66, padBot = Math.max(44, h * 0.12);
  let s = (h - padTop - padBot) / (S.H + hs + 0.7);
  let minX = -4.5, maxX = 3.5;                                   // screen, base, wind arrows and dimensions
  if (stg) { minX = Math.min(minX, stg.xRear - 0.7); maxX = Math.max(maxX, stg.xFront + 0.7); }
  if (D.strap) { minX = Math.min(minX, D.strap.anchorX - 0.8, D.strap.attachX - 0.8); maxX = Math.max(maxX, D.strap.anchorX + 0.8, D.strap.attachX + 0.8); }
  s = Math.min(clamp(s, 10, 120), w * (inset ? 0.9 : 0.95) / (maxX - minX));
  const oy = h - padBot;
  const ox = w * (inset ? 0.43 : 0.5) - (minX + maxX) / 2 * s;
  return { w, h, s, oy, ox, padTop, X: (x) => ox + x * s, Y: (y) => oy - y * s };
}

/* a vertical strip made of short segments, each shifted by off(z); fill(segment index) returns a fillStyle */
function bentStrip(ctx, V, xc, wpx, yb, yt, off, fill, seg) {
  const n = Math.max(1, Math.ceil((yt - yb) / seg));
  for (let i = 0; i < n; i++) {
    const ya = yb + (yt - yb) * i / n, yc = yb + (yt - yb) * (i + 1) / n;
    const oa = off(ya), oc = off(yc), xa = V.X(xc) - wpx / 2 + oa, xb = V.X(xc) - wpx / 2 + oc;
    ctx.fillStyle = fill(i, xa);
    ctx.beginPath(); ctx.moveTo(xa, V.Y(ya)); ctx.lineTo(xa + wpx, V.Y(ya)); ctx.lineTo(xb + wpx, V.Y(yc)); ctx.lineTo(xb, V.Y(yc)); ctx.closePath(); ctx.fill();
  }
}

/* The rig on its deck. o.rotate rocks it about its own toe; o.off bends it; o.detail is used by the zoomed inset. */
function drawRig(ctx, V, st, o) {
  const { S, D, sim } = st, g = D.geom, rear = D.dir === 'rear';
  const X = V.X, Y = V.Y, s = V.s, y0 = M.SHEET.screenBottom, cabH = D.cabH;
  const sd = sim.side || (rear ? 1 : -1);                           // which toe it tips about: +1 front, -1 rear
  const pivotX = sd > 0 ? 0 : -g.depth, rot = o.rotate === false ? 0 : sd * sim.phi;
  const off = o.off || (() => 0);
  const px = (m, mn) => Math.max(m * s, mn);
  const scrDepth = S.cabDepth || 0.083;
  ctx.save();
  if (rot) { ctx.translate(X(pivotX), Y(0)); ctx.rotate(rot); ctx.translate(-X(pivotX), -Y(0)); }

  // feet + base plate
  const fw = px(0.1, 6);
  ctx.fillStyle = C.foot;
  for (const fx of [0, -g.depth]) {
    ctx.beginPath(); ctx.moveTo(X(fx) - fw / 2, Y(0.05)); ctx.lineTo(X(fx) + fw / 2, Y(0.05));
    ctx.lineTo(X(fx) + fw * 0.35, Y(0)); ctx.lineTo(X(fx) - fw * 0.35, Y(0)); ctx.closePath(); ctx.fill();
  }
  const plateH = Math.max(3, Y(0.05) - Y(y0)), plateX0 = X(-(g.depth + 0.1)), plateX1 = X(0.06);
  ctx.fillStyle = C.plate; ctx.fillRect(plateX0, Y(y0), plateX1 - plateX0, plateH);
  ctx.fillStyle = C.plateDark; ctx.fillRect(plateX0, Y(y0) + plateH - 1, plateX1 - plateX0, 1);

  // back frame: two posts (bent), rungs, connectors
  const postW = px(0.05, 3), segM = Math.max(0.25, cabH * 0.5);
  for (const cx of [-0.27, -0.653]) bentStrip(ctx, V, cx, postW, y0, y0 + S.H - 0.04, (z) => off(z), () => C.frame, segM);
  const rungT = px(0.035, 2);
  ctx.fillStyle = C.frame;
  const nRung = Math.max(1, Math.round(S.H));
  for (let r = 1; r <= nRung; r++) {
    const yy = r === nRung ? y0 + S.H - 0.06 : y0 + r * (S.H / nRung), o1 = off(yy);
    ctx.fillRect(X(-0.653) + o1, Y(yy) - rungT / 2, X(-0.27) - X(-0.653), rungT);
  }
  const conRows = []; for (let r = 2; r <= D.rows; r += 2) conRows.push(r);
  if (D.rows % 2 === 1) conRows.push(D.rows);
  const cth = px(0.03, 2.4);
  for (const r of conRows) {
    const yh = y0 + (r - 0.5) * cabH, o1 = off(yh), yy = Y(yh);
    ctx.fillStyle = C.conn; ctx.fillRect(X(-0.04) + o1, yy - cth / 2, X(-0.27) - X(-0.04), cth);
    ctx.fillRect(X(-0.04) - 1 + o1, yy - cth * 1.3, Math.max(3, 0.05 * s), cth * 2.6);
  }

  // ballast plates
  const bi = st.ui.selected, kg = bi >= 0 && bi < D.N ? D.ballast[bi] : D.Wb / D.N;
  const bp = ballastPlates(kg), bw = px(0.24, 9), bx = X(-g.ballastX) - bw / 2;
  const pt = px(0.045, 3.4);
  let yy = Y(y0);
  const drawPlate = (thick) => {
    const gr = ctx.createLinearGradient(0, yy - thick, 0, yy);
    gr.addColorStop(0, C.ball0); gr.addColorStop(1, C.ball1);
    ctx.fillStyle = gr; ctx.fillRect(bx, yy - thick, bw, thick);
    ctx.fillStyle = C.ballEdge; ctx.fillRect(bx, yy - 1, bw, 1);
    yy -= thick;
  };
  for (let i = 0; i < bp.n; i++) drawPlate(pt);
  if (bp.rem) drawPlate(Math.max(1.5, pt * bp.rem));
  const stackTop = yy;

  // screen: one segment per cabinet row, each with its own gradient so the bend stays crisp
  const sw = px(scrDepth, 5), ledW = Math.max(1.6, sw * 0.3);
  const rowsN = Math.max(1, D.rows);
  for (let r = 0; r < rowsN; r++) {
    const ya = y0 + r * cabH, yb = y0 + (r + 1) * cabH, oa = off(ya), ob = off(yb);
    const xa = X(0) - sw / 2 + oa, xb = X(0) - sw / 2 + ob;
    const sg = ctx.createLinearGradient(xa, 0, xa + sw, 0);
    sg.addColorStop(0, C.screenBack); sg.addColorStop(1, C.screenFront);
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.moveTo(xa, Y(ya)); ctx.lineTo(xa + sw, Y(ya)); ctx.lineTo(xb + sw, Y(yb)); ctx.lineTo(xb, Y(yb)); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.shadowColor = 'rgba(100,215,255,.9)'; ctx.shadowBlur = 8; ctx.fillStyle = C.led;
    ctx.beginPath(); ctx.moveTo(xa + sw - ledW, Y(ya)); ctx.lineTo(xa + sw, Y(ya)); ctx.lineTo(xb + sw, Y(yb)); ctx.lineTo(xb + sw - ledW, Y(yb)); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(8,14,24,.6)'; ctx.lineWidth = 1;
    if (r > 0 && cabH * s >= 4) line(ctx, xa, Y(ya) + 0.5, xa + sw, Y(ya) + 0.5);
  }

  // ballast label rides with the stack
  if (!o.detail && kg > 0.05 && V.s > 14) {
    txt(ctx, nf(kg) + ' kg', X(-g.ballastX), stackTop - 5, { font: '600 11px ' + F.mono, align: 'center', color: '#ffd9c2', halo: 'rgba(6,10,18,.85)', haloW: 3 });
  }
  ctx.restore();
}

/* the stage under the wall (world view: floor at y = 0) */
function drawStage(ctx, V, st, ink) {
  const stg = st.D.stage; if (!stg) return;
  const x0 = V.X(stg.xRear), x1 = V.X(stg.xFront), yT = V.Y(stg.h), yB = V.Y(0), s = V.s;
  const th = Math.max(4, 0.09 * s);
  ctx.strokeStyle = 'rgba(170,188,212,.55)'; ctx.lineWidth = Math.max(1.5, 0.05 * s);
  const nLeg = Math.max(2, Math.round(stg.depth / 1.2) + 1), sh = st.legShear || 0;     // sh: the feet stay on the floor while the deck sways
  for (let i = 0; i < nLeg; i++) { const x = x0 + (x1 - x0) * i / (nLeg - 1); line(ctx, x, yT + th, x + sh, yB); }
  ctx.lineWidth = 1;
  for (let i = 0; i < nLeg - 1; i++) { const xa = x0 + (x1 - x0) * i / (nLeg - 1), xb = x0 + (x1 - x0) * (i + 1) / (nLeg - 1); line(ctx, xa + sh, yB, xb, yT + th); line(ctx, xb + sh, yB, xa, yT + th); }
  const sk = ctx.createLinearGradient(0, yT, 0, yB); sk.addColorStop(0, C.stage0); sk.addColorStop(1, C.stage1);
  ctx.fillStyle = sk; ctx.fillRect(x1 - Math.max(5, 0.12 * s), yT + th, Math.max(5, 0.12 * s), yB - yT - th);
  ctx.fillStyle = C.deck; ctx.fillRect(x0, yT, x1 - x0, th);
  ctx.fillStyle = 'rgba(8,14,24,.35)'; ctx.fillRect(x0, yT + th - 1, x1 - x0, 1);
  ctx.strokeStyle = 'rgba(8,14,24,.35)'; ctx.lineWidth = 1;
  for (let x = x1 - 1.22 * s; x > x0 + 4; x -= 1.22 * s) line(ctx, x, yT, x, yT + th);
  txt(ctx, 'stage ' + nf(stg.h, 2) + ' m', x1 - 6, yT + th + 14, { font: '600 11px ' + F.mono, align: 'right', color: ink.text, halo: ink.halo, haloW: 3 });
}

/* strap, cable or truss from the (bent, tilted) attach point to its anchor. Drawn in world coordinates. */
function drawStrap(ctx, V, st, ink, offA) {
  const { S, D, sim } = st, sp = D.strap; if (!sp) return;
  const hs = D.geom.hs, sMode = D.gov === 'S', rear = D.dir === 'rear', sign = rear ? 1 : -1;
  const rot = (sim.side || sign) * sim.phi;
  let ax = sp.attachX + sign * offA, ay = sp.a + hs;
  const pivX = D.geom.pivotX, pivY = sMode ? 0 : hs;
  if (rot) { const dx = ax - pivX, dy = ay - pivY, c = Math.cos(rot), sn = Math.sin(rot); ax = pivX + dx * c + dy * sn; ay = pivY - dx * sn + dy * c; }
  const bx = sp.anchorX, by = hs + sp.anchorY;
  const A = [V.X(ax), V.Y(ay)], B = [V.X(bx), V.Y(by)];
  const Tn = sim.Ph / (sp.cb * sp.n), cap = sp.TcapKg * M.G, util = cap > 0 ? Tn / cap : 0;
  const col = sim.broken || util >= 1 ? C.strapBad : util > 0.6 ? C.strapHot : C.strap;
  const engaged = sim.Ph > 1 && !sim.broken, mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  ctx.fillStyle = '#8a97a8';
  if (sp.anchorKgPer > 0) {
    const w = clamp(Math.sqrt(sp.anchorKgPer) * 0.55, 8, 26);
    rr(ctx, B[0] - w / 2, B[1] - w * 0.7, w, w * 0.7, 2); ctx.fill();
    txt(ctx, nf0(sp.anchorKgPer) + ' kg', B[0], B[1] + 12, { font: '600 10px ' + F.mono, align: 'center', color: ink.text, halo: ink.halo, haloW: 3 });
  } else { ctx.beginPath(); ctx.moveTo(B[0], B[1]); ctx.lineTo(B[0] - 6, B[1] + 9); ctx.lineTo(B[0] + 6, B[1] + 9); ctx.closePath(); ctx.fill(); }
  if (sim.broken) {
    ctx.strokeStyle = C.strapBad; ctx.lineWidth = 2.2; line(ctx, B[0], B[1], B[0] + (A[0] - B[0]) * 0.35, B[1] + (A[1] - B[1]) * 0.35);
    line(ctx, A[0], A[1], A[0] + (B[0] - A[0]) * 0.2, A[1] + (B[1] - A[1]) * 0.2 + 14);
    txt(ctx, 'let go', mid[0], mid[1], { font: '700 11px ' + F.sans, align: 'center', color: '#fff', halo: 'rgba(160,30,30,.95)', haloW: 4 });
    return;
  }
  if (!sp.active) {                                                       // wrong side for this wind: it hangs slack
    ctx.strokeStyle = 'rgba(190,200,215,.65)'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.quadraticCurveTo(mid[0], mid[1] + 18, B[0], B[1]); ctx.stroke(); ctx.setLineDash([]);
    return;
  }
  if (sp.type === 'truss') {
    ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 1.4;
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len * 3, ny = dx / len * 3;
    line(ctx, A[0] + nx, A[1] + ny, B[0] + nx, B[1] + ny); line(ctx, A[0] - nx, A[1] - ny, B[0] - nx, B[1] - ny);
    const k = Math.max(3, Math.round(len / 10));
    for (let i = 0; i <= k; i++) {
      const t = i / k, x = A[0] + dx * t, y = A[1] + dy * t; line(ctx, x + nx, y + ny, x - nx, y - ny);
      if (i < k) { const t2 = (i + 1) / k; line(ctx, x + nx, y + ny, A[0] + dx * t2 - nx, A[1] + dy * t2 - ny); }
    }
  } else {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(8,14,24,.55)'; ctx.lineWidth = 6; line(ctx, A[0], A[1], B[0], B[1]);
    ctx.strokeStyle = col; ctx.lineWidth = sp.type === 'cable' ? 2.4 : 4; line(ctx, A[0], A[1], B[0], B[1]);
    ctx.lineCap = 'butt';
    if (sp.type === 'strap') { ctx.fillStyle = '#d9e1ec'; ctx.fillRect(mid[0] - 5, mid[1] - 3.5, 10, 7); ctx.fillStyle = '#44506a'; ctx.fillRect(mid[0] - 3, mid[1] - 1.5, 6, 3); }
  }
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(A[0], A[1], 3.5, 0, TAU); ctx.fill();
  const left = sp.actSide === 'rear';
  txt(ctx, (engaged ? 'T ' + nf(Tn / 1000, Tn < 10000 ? 2 : 1) + ' kN' : 'taut, no pull yet') + (engaged && cap > 0 ? ' · ' + nf0(util * 100) + '%' : ''), A[0] + (left ? -8 : 8), A[1] - 9, { font: '600 11px ' + F.mono, align: left ? 'right' : 'left', color: '#fff3d0', halo: ink.halo, haloW: 3.5 });
}

/* arms, weights and the lift gap, drawn unrotated and faded out once the screen tilts */
function drawBaseNotes(ctx, V, st, ink, fade, o) {
  const { S, D, sim, ui } = st, g = D.geom, X = V.X, Y = V.Y, s = V.s;
  const rear = (sim.side || (D.dir === 'rear' ? 1 : -1)) > 0;       // the toe it tips about now (front toe when true)
  const sMode = D.gov === 'S';
  const pivotX = rear ? 0 : -g.depth;
  const kgB = ui.selected >= 0 && ui.selected < D.N ? D.ballast[ui.selected] : D.Wb / D.N;
  const items = [
    { name: 'screen', x: 0, kg: D.Ws / D.N, arm: g.aS, col: '#9ed8ff' },
    { name: 'frame', x: -0.46, kg: D.Wf / D.N, arm: g.aF, col: C.frame },
    { name: 'ballast', x: -g.ballastX, kg: kgB, arm: g.aB, col: C.ball0 }
  ];
  if (o && o.arms) {
    ctx.save(); ctx.globalAlpha = fade;
    for (const it of items) {
      const x = X(it.x), len = clamp(12 + 3.2 * Math.sqrt(Math.max(it.kg, 0)), 14, 50), yTop = Y(0.9);
      ctx.strokeStyle = it.col; ctx.fillStyle = it.col; ctx.lineWidth = 2.2;
      arrow(ctx, x, yTop, x, yTop + len, 7, 4.2);
      const up = it.name === 'frame' ? 15 : 0;
      txt(ctx, it.name, x, yTop - 17 - up, { font: '600 10px ' + F.sans, align: 'center', color: ink.text, halo: ink.halo, haloW: 3 });
      txt(ctx, nf(it.kg) + ' kg', x, yTop - 5 - up, { font: '600 11.5px ' + F.mono, align: 'center', color: '#fff', halo: ink.halo, haloW: 3 });
    }
    ctx.strokeStyle = ink.dim; ctx.fillStyle = ink.dim; ctx.lineWidth = 1.2;
    let lvl = 0; const px0 = X(pivotX);
    for (const it of [items[2], items[1], items[0]]) {
      if (it.arm < 0.02) continue;
      const yy = Y(-0.09 - 0.085 * lvl), x1 = X(it.x);
      ctx.setLineDash([]); line(ctx, px0, yy, x1, yy); line(ctx, px0, yy - 3, px0, yy + 3); line(ctx, x1, yy - 3, x1, yy + 3);
      ctx.setLineDash([2, 3]); ctx.strokeStyle = it.col; line(ctx, x1, Y(0.0) + 1, x1, yy - 2); ctx.strokeStyle = ink.dim; ctx.setLineDash([]);
      txt(ctx, nf(it.arm, 3) + ' m', (px0 + x1) / 2, yy - 3, { font: '500 10px ' + F.mono, align: 'center', color: ink.text, halo: ink.halo, haloW: 3 });
      lvl++;
    }
    ctx.restore();
  }
  const pX = X(pivotX), pY = Y(0);
  if (!sMode) {
    const tri = (x) => { ctx.fillStyle = ink.pivot; ctx.beginPath(); ctx.moveTo(x, pY + 1); ctx.lineTo(x - 6, pY + 11); ctx.lineTo(x + 6, pY + 11); ctx.closePath(); ctx.fill(); };
    tri(pX);
    if (D.shake && sim.phi < 0.0008) { tri(X(rear ? -g.depth : 0)); txt(ctx, 'toes', X(-g.depth / 2), pY + 22, { font: '600 10px ' + F.sans, align: 'center', color: ink.text, halo: ink.halo, haloW: 3 }); }   // it can tip about either
    else txt(ctx, 'pivot', pX + (rear ? 9 : -9), pY + 22, { font: '600 10px ' + F.sans, align: rear ? 'left' : 'right', color: ink.text, halo: ink.halo, haloW: 3 });
  }
  if (!sMode && sim.phi > 0.0008) {
    const rotA = (rear ? 1 : -1) * sim.phi, farX = rear ? -g.depth : 0;
    const dx = (farX - pivotX) * s, c = Math.cos(rotA), sn = Math.sin(rotA);
    const fx = X(pivotX) + dx * c, fy = Y(0) + dx * sn;
    ctx.strokeStyle = '#ffd24a'; ctx.fillStyle = '#ffd24a'; ctx.lineWidth = 1.6;
    line(ctx, fx, Y(0), fx, fy); line(ctx, fx - 4, Y(0), fx + 4, Y(0)); line(ctx, fx - 4, fy, fx + 4, fy);
    const lm = sim.liftMM(g.depth);
    txt(ctx, 'lift ' + nf(lm, lm < 100 ? 1 : 0) + ' mm', fx + (rear ? -8 : 8), (fy + Y(0)) / 2 + 3, { font: '600 10.5px ' + F.mono, align: rear ? 'right' : 'left', color: '#ffe9a8', halo: ink.halo, haloW: 3 });
  }
}

/* the push, or the inertia of a shaking wall, in place of the wind arrows */
function drawLoadArrows(ctx, V, st, ink, fade) {
  const { S, D, sim } = st, g = D.geom, L = sim.lam, a = Math.abs(L);
  if (a < 0.01 || fade < 0.02) return;
  const sgn = D.shake ? (L >= 0 ? 1 : -1) : (D.dir === 'rear' ? 1 : -1);          // +1 pushes toward the front (right on screen)
  const hy = V.Y(g.hc);
  ctx.save(); ctx.globalAlpha = fade; ctx.strokeStyle = ink.force; ctx.fillStyle = ink.force; ctx.lineCap = 'round';
  if (D.loadKind === 'force') {
    const kg = S.knock.kgf * a, contact = V.X(sgn > 0 ? -0.67 : 0.05), len = clamp(26 + 0.8 * kg, 30, 130), tail = contact - sgn * (len + 8);
    ctx.lineWidth = 4.5; arrow(ctx, tail, hy, contact - sgn * 8, hy, 13, 8);
    ctx.beginPath(); ctx.arc(tail, hy, 6.5, 0, TAU); ctx.fill();                       // the hand or the trolley
    txt(ctx, 'push ' + nf0(kg) + ' kgf', (tail + contact) / 2, hy - 13, { font: '600 12px ' + F.mono, align: 'center', color: ink.force, halo: ink.halo, haloW: 3.5 });
  } else {
    const Fk = D.F.kgf * a, x0 = V.X(-0.3), len = clamp(22 + 46 * Math.sqrt(a), 24, 120);
    ctx.lineWidth = 4; arrow(ctx, x0, hy, x0 + sgn * len, hy, 13, 8);
    txt(ctx, 'inertia ' + nf0(Fk) + ' kgf', x0 + sgn * len / 2, hy - 12, { font: '600 12px ' + F.mono, align: 'center', color: ink.force, halo: ink.halo, haloW: 3.5 });
    const fy = V.Y(0) + 26, xm = V.X(-g.depth / 2), fl = clamp(14 + 40 * Math.sqrt(a), 16, 90);   // the floor goes the other way
    ctx.strokeStyle = ink.dim; ctx.fillStyle = ink.dim; ctx.lineWidth = 2.4; arrow(ctx, xm + sgn * fl / 2, fy, xm - sgn * fl / 2, fy, 9, 6);
    txt(ctx, 'floor', xm - sgn * (fl / 2 + 6), fy + 4, { font: '600 10px ' + F.sans, align: sgn > 0 ? 'right' : 'left', color: ink.text, halo: ink.halo, haloW: 3 });
  }
  ctx.restore();
}

/* wind arrows on the windward face, the resultant, and the height dimensions on the lee side (rig view) */
function drawWindNotes(ctx, V, st, ink, u) {
  const { S, D, sim } = st, g = D.geom, rear = D.dir === 'rear', sign = rear ? 1 : -1;
  const faceX = V.X(rear ? -0.05 : 0.05);
  const pStrength = D.wind.qPeak * D.wind.cn * D.wind.cfTot * u * u;
  const fade = 1 - smooth((sim.phi - 0.12) / 0.5);
  const y0 = M.SHEET.screenBottom, hs = g.hs;
  const alpha = D.profileAlpha || 0;
  if (D.loadKind !== 'wind') drawLoadArrows(ctx, V, st, ink, fade);
  else if (pStrength > 0.005 && fade > 0.02) {
    const n = clamp(Math.round(S.H), 3, 14);
    ctx.globalAlpha = fade; ctx.strokeStyle = ink.arrow; ctx.fillStyle = ink.arrow; ctx.lineWidth = 1.6;
    for (let j = 0; j < n; j++) {
      const yw = y0 + (j + 0.5) / n * S.H;
      const psi = alpha ? Math.pow(Math.max(hs + yw, 3) / 10, 2 * alpha) : 1;
      const len = clamp(10 + 6.4 * Math.sqrt(pStrength * psi), 12, 175);
      arrow(ctx, faceX - sign * (len + 7), V.Y(yw), faceX - sign * 7, V.Y(yw), 6.5, 4);
    }
    const yR = V.Y(g.hc), lenR = clamp(10 + 6.4 * Math.sqrt(pStrength), 12, 175) + 22;
    ctx.strokeStyle = ink.force; ctx.fillStyle = ink.force; ctx.lineWidth = 4;
    arrow(ctx, faceX - sign * (lenR + 40), yR, faceX - sign * 10, yR, 13, 8);
    txt(ctx, 'F ' + nf(D.F.kgf * u * u) + ' kgf', faceX - sign * (lenR + 40), yR - 12, { font: '600 12px ' + F.mono, align: sign > 0 ? 'left' : 'right', color: ink.force, halo: ink.halo, haloW: 3.5 });
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = fade;
  const lee = rear ? 1 : -1, baseX = V.X(rear ? 0.38 : -g.depth - 0.38);
  const dimV = (x, ya, yb, label, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = 1.2; line(ctx, x, ya, x, yb);
    line(ctx, x - 4, ya, x + 4, ya); line(ctx, x - 4, yb, x + 4, yb);
    txt(ctx, label, x + lee * 7, ya + 4, { font: '600 11px ' + F.mono, align: lee > 0 ? 'left' : 'right', color: ink.text, halo: ink.halo, haloW: 3 });
  };
  ctx.setLineDash([]);
  dimV(baseX, V.Y(y0 + S.H), V.Y(y0), 'H ' + nf(S.H, 1) + ' m', ink.dim);
  const hx = baseX + lee * Math.max(30, 0.6 * V.s);
  ctx.strokeStyle = ink.force; ctx.lineWidth = 1.2;
  line(ctx, V.X(rear ? 0.04 : -0.04), V.Y(g.hc), hx, V.Y(g.hc));
  dimV(hx, V.Y(g.hc), V.Y(0), 'h ' + nf(g.hc, 2) + ' m', ink.force);
  ctx.globalAlpha = 1;
}

function drawSide(canvas, st) {
  const { ctx, w, h } = fitCanvas(canvas);
  const { S, D, sim, ui } = st, outdoor = S.mode === 'outdoor';
  const insetOn = ui.showInset && w >= 640 && !(D.gov === 'S' && sim.phi > 0.002);
  const V = sideView(w, h, S, insetOn, D);
  st.V = V;
  const hs = D.geom.hs, sMode = D.gov === 'S';
  const Vr = Object.assign({}, V, { oy: V.oy - hs * V.s });
  Vr.Y = (y) => Vr.oy - y * V.s;
  const ink = INK[outdoor ? 'outdoor' : 'indoor'];
  const u = sim.lastU, sign = D.dir === 'rear' ? 1 : -1;
  const sd = sim.side || sign, windy = D.loadKind === 'wind';                      // sd: the toe it tips about now
  const exagG = sim.groundAmp > 0 ? clamp(0.2 / sim.groundAmp, 1, 200) : 1;        // the floor's movement is tiny: draw it larger
  const gx = sim.groundAmp > 0 ? sim.ground * sim.groundAmp * exagG * V.s : 0;
  const vNow = windy ? D.wind.vPeak * u : 0, vNormal = windy ? vNow * D.wind.cn : 0;
  const deckSway = D.loadCase === 'sway' && !!D.stage;                             // the deck wobbles on legs that stay on the floor
  st.legShear = deckSway ? -gx : 0;
  const env = { sign, vmean: vNow, speed: vNormal, outdoor, kind: D.loadCase, gx: deckSway ? 0 : gx, amt: windy ? u : Math.abs(sim.lam),
    pushSign: D.shake ? (sim.pushDir || 1) : sign, pushH: D.geom.hc };
  const nodesNow = bendNow(D, sim), exag = bendExag(D, ui.exag);
  st.exag = exag; st.nodesNow = nodesNow;
  const off = offFn(st, V, nodesNow, exag);
  ctx.save();
  if (sim.impactAt >= 0 && sim.t - sim.impactAt < 0.5) {
    const k = (1 - (sim.t - sim.impactAt) / 0.5);
    ctx.translate(Math.sin(sim.t * 80) * 5 * k, Math.cos(sim.t * 67) * 4 * k);
  }
  if (outdoor) drawOutdoor(ctx, V, env); else drawIndoor(ctx, V, env);
  const topY = V.oy - (hs + (S.H + 0.1) * Math.cos(sim.phi) + 0.35) * V.s;
  if (windy) drawParticles(ctx, V, env, topY);
  const pivS = D.shake ? (sd > 0 ? D.sides.fwd.geom.pivotX : D.sides.back.geom.pivotX) : D.geom.pivotX;

  // stage + rig. In stage mode the whole thing rocks about the stage toe; otherwise only the wall rocks on its deck.
  ctx.save(); ctx.translate(gx, 0);                              // everything standing on the floor goes with it when the floor shakes
  ctx.save();
  if (outdoor) { ctx.shadowColor = 'rgba(6,18,30,.55)'; ctx.shadowBlur = 5; }
  if (sMode && sim.phi) {
    ctx.translate(V.X(pivS), V.Y(0)); ctx.rotate(sd * sim.phi); ctx.translate(-V.X(pivS), -V.Y(0));
  }
  drawStage(ctx, V, st, ink);
  drawRig(ctx, Vr, st, { detail: false, rotate: !sMode, off });
  ctx.restore();
  if (D.strap) drawStrap(ctx, V, st, ink, nodesNow[Math.round(clamp(D.strap.a / D.bend.L, 0, 1) * (nodesNow.length - 1))] * exag);
  drawWindNotes(ctx, Vr, st, ink, u);
  drawBaseNotes(ctx, Vr, st, ink, 0, { arms: false });
  if (sMode) {                                                   // stage rocks: pivot marker on the floor and the lift at the far edge
    const pX = V.X(pivS), pY = V.Y(0), rear = sd > 0;
    ctx.fillStyle = ink.pivot; ctx.beginPath(); ctx.moveTo(pX, pY + 1); ctx.lineTo(pX - 6, pY + 11); ctx.lineTo(pX + 6, pY + 11); ctx.closePath(); ctx.fill();
    txt(ctx, 'pivot', pX + (rear ? 9 : -9), pY + 22, { font: '600 10px ' + F.sans, align: rear ? 'left' : 'right', color: ink.text, halo: ink.halo, haloW: 3 });
    if (sim.phi > 0.0008) {
      const rotA = sd * sim.phi, farX = rear ? D.stage.xRear : D.stage.xFront, dx = (farX - pivS) * V.s, c = Math.cos(rotA), sn = Math.sin(rotA);
      const fx = pX + dx * c, fy = pY + dx * sn, lm = Math.sin(sim.phi) * D.stage.depth * 1000;
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 1.6; line(ctx, fx, pY, fx, fy); line(ctx, fx - 4, pY, fx + 4, pY); line(ctx, fx - 4, fy, fx + 4, fy);
      txt(ctx, 'stage lifts ' + nf(lm, lm < 100 ? 1 : 0) + ' mm', fx + (rear ? -8 : 8), (fy + pY) / 2 + 3, { font: '600 10.5px ' + F.mono, align: rear ? 'right' : 'left', color: '#ffe9a8', halo: ink.halo, haloW: 3 });
    }
  }
  if (st.exag > 1.5 && Math.abs(D.bend.topEl) > 1e-5) {
    txt(ctx, 'bending drawn ×' + nf0(st.exag), V.X(D.dir === 'rear' ? 0.38 : -D.geom.depth - 0.38) + (D.dir === 'rear' ? 7 : -7), Vr.Y(S.H + 0.1) + 18, { font: '500 10px ' + F.mono, align: D.dir === 'rear' ? 'left' : 'right', color: ink.text, halo: ink.halo, haloW: 3 });
  }
  ctx.restore();                                                 // the floor's shake
  if (exagG > 1.5) txt(ctx, (deckSway ? 'deck' : 'floor') + ' shaking drawn ×' + nf0(exagG), V.w - 12, V.oy + 42, { font: '500 10px ' + F.mono, align: 'right', color: ink.text, halo: ink.halo, haloW: 3 });
  ctx.restore();
  if (sim.toppled && sim.phi > 1.2) {
    ctx.fillStyle = 'rgba(208,59,59,.12)'; ctx.fillRect(0, 0, w, h);
    const by = Math.max(V.padTop + 46, h * 0.36);
    txt(ctx, sMode ? 'STAGE AND WALL TOPPLED' : 'TOPPLED', V.ox - 0.4 * V.s, by, { font: '700 ' + clamp(w * 0.07, 34, 60) * (sMode ? 0.62 : 1) + 'px ' + F.disp, align: 'center', color: '#fff', halo: 'rgba(160,30,30,.95)', haloW: 8 });
    txt(ctx, 'Add ballast, straps or a lower stage, then press Run again', V.ox - 0.4 * V.s, by + 24, { font: '500 13px ' + F.sans, align: 'center', color: '#fff', halo: 'rgba(120,20,20,.9)', haloW: 5 });
  }
  if (insetOn) drawInset(ctx, V, Vr, st, ink, off);
}

function drawInset(ctx, V, Vr, st, ink) {
  const { S, D } = st, g = D.geom;
  const iw = clamp(V.w * 0.31, 220, 320), ih = clamp(iw * 0.84, 180, 262);
  const rect = { x: V.w - iw - 12, y: V.h - ih - 12, w: iw, h: ih };
  const worldW = g.depth + 0.62, worldH = 1.72;
  const s2 = Math.min(rect.w / worldW, rect.h / worldH);
  const V2 = {
    w: V.w, h: V.h, s: s2, padTop: 0,
    ox: rect.x + (rect.w - worldW * s2) / 2 + (g.depth + 0.24) * s2,
    oy: rect.y + (rect.h - worldH * s2) / 2 + 1.34 * s2
  };
  V2.X = (x) => V2.ox + x * s2; V2.Y = (y) => V2.oy - y * s2;
  ctx.save();
  rr(ctx, rect.x, rect.y, rect.w, rect.h, 10); ctx.clip();
  ctx.fillStyle = 'rgba(7,12,20,.94)'; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  const gg = ctx.createLinearGradient(0, V2.oy, 0, rect.y + rect.h);
  gg.addColorStop(0, D.stage ? '#4a566a' : '#26323f'); gg.addColorStop(1, '#0b1018');
  ctx.fillStyle = gg; ctx.fillRect(rect.x, V2.oy, rect.w, rect.y + rect.h - V2.oy);
  ctx.fillStyle = D.stage ? 'rgba(200,214,235,.5)' : 'rgba(255,255,255,.2)'; ctx.fillRect(rect.x, V2.oy, rect.w, D.stage ? 2 : 1);
  drawRig(ctx, V2, st, { detail: true, rotate: true, off: () => 0 });
  drawBaseNotes(ctx, V2, st, INK.indoor, 1 - smooth(st.sim.phi / 0.05), { arms: true });
  const bi = st.ui.selected;
  txt(ctx, (bi >= 0 ? 'BASE ' + (bi + 1) + ' OF ' + D.N : 'ONE BASE · 1 OF ' + D.N) + (D.stage ? ' · ON THE DECK' : ''), rect.x + 10, rect.y + 16, { font: '600 11px ' + F.disp, color: '#9fb6cf', halo: 'rgba(7,12,20,.9)' });
  ctx.restore();
  rr(ctx, rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, 10);
  ctx.strokeStyle = 'rgba(160,190,225,.38)'; ctx.lineWidth = 1; ctx.stroke();
}
