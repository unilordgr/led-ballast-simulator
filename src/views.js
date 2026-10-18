/* ===== views.js : rear view (+ ballast bars), wind-direction dial (+ stage, straps), stability map, bending profile ===== */
const BP = { bg: '#0c1522', wall: '#162539', grid: 'rgba(140,170,210,.16)', edge: 'rgba(200,220,245,.5)', text: '#aebfd4', bright: '#e3edf9',
  ballast: '#eb6834', warn: '#fab219', crit: '#d03b3b', accent: '#5aa2ff', frame: '#25c48d', plate: '#f2c230', force: '#ff72d8', cyan: '#6fd0ff', strap: '#ffb020', stage: '#8a97a8' };

/* ---------------- rear view ---------------- */
function drawRear(canvas, st, hit) {
  const { ctx, w, h } = fitCanvas(canvas);
  const { S, D, ui } = st, CABW = M.CAB.w, cabH = D.cabH;
  ctx.fillStyle = BP.bg; ctx.fillRect(0, 0, w, h);
  const padL = 50, padR = 14, padT = 30, padB = 22;
  const innerW = w - padL - padR;
  const wallMaxH = Math.max(64, (h - padT - padB) * 0.44);
  const sc = Math.min(innerW / S.W, wallMaxH / S.H);
  const wallW = S.W * sc, wallH = S.H * sc;
  const x0 = padL + (innerW - wallW) / 2, y0 = padT, y1 = y0 + wallH;
  const pitch = wallW / D.N;
  hit.rear = { x0, x1: x0 + wallW, y0, y1, pitch, N: D.N };

  ctx.fillStyle = BP.wall; ctx.fillRect(x0, y0, wallW, wallH);
  ctx.strokeStyle = BP.grid; ctx.lineWidth = 1;
  if (CABW * sc >= 3.5) for (let c = 1; c < D.cols; c++) line(ctx, x0 + c * CABW * sc + 0.5, y0, x0 + c * CABW * sc + 0.5, y1);
  if (cabH * sc >= 3.5) for (let r = 1; r < D.rows; r++) line(ctx, x0, y0 + r * cabH * sc + 0.5, x0 + wallW, y0 + r * cabH * sc + 0.5);
  ctx.strokeStyle = BP.edge; ctx.strokeRect(x0 + 0.5, y0 + 0.5, wallW - 1, wallH - 1);
  if (D.stage) {                                          // the deck under the wall
    ctx.fillStyle = BP.stage; ctx.fillRect(x0 - 8, y1 + 1, wallW + 16, 5);
    txt(ctx, 'stage ' + nf(D.stage.h, 2) + ' m', x0 - 8, y1 + 18, { font: '500 10px ' + F.mono, color: BP.text });
  }

  const maxKg = Math.max(1e-6, ...D.ballast), niceTop = niceMax(Math.max(maxKg, D.req.per, 1) * 1.15);
  const bw = Math.min(0.45 * sc, pitch * 0.72), plateH = Math.max(2.5, 0.1 * sc);
  for (let i = 0; i < D.N; i++) {
    const cx = x0 + (i + 0.5) * pitch, sel = i === ui.selected;
    ctx.strokeStyle = BP.frame; ctx.lineWidth = Math.max(1, Math.min(2, bw * 0.16));
    line(ctx, cx - bw / 2, y0 + 3, cx - bw / 2, y1); line(ctx, cx + bw / 2, y0 + 3, cx + bw / 2, y1);
    ctx.lineWidth = 1;
    for (let r = 1; r <= Math.round(S.H); r++) { const yy = r === Math.round(S.H) ? y0 + 3 : y1 - r * sc * (S.H / Math.round(S.H)); line(ctx, cx - bw / 2, yy + 0.5, cx + bw / 2, yy + 0.5); }
    ctx.fillStyle = BP.plate; ctx.fillRect(cx - bw * 0.72, y1 - plateH, bw * 1.44, plateH);
    const kg = D.ballast[i], bh = kg > 0.01 ? 2.5 + 15 * Math.sqrt(kg / niceTop) : 0;
    ctx.fillStyle = BP.ballast; ctx.fillRect(cx - bw * 0.5, y1 - plateH - bh, bw, bh);
    if (sel) { ctx.strokeStyle = BP.accent; ctx.lineWidth = 2; ctx.strokeRect(cx - Math.max(bw * 0.9, 5), y0 - 2, Math.max(bw * 1.8, 10), wallH + 4); }
  }
  // straps: markers on top, with a line going away from the viewer (shown as a short tick)
  if (D.strap) {
    const sp = D.strap, ay = y1 - Math.min(sp.a / D.bend.L, 1) * wallH;
    ctx.fillStyle = BP.strap; ctx.strokeStyle = BP.strap; ctx.lineWidth = 1.4;
    for (let i = 0; i < sp.n; i++) {
      const cx = sp.n === 1 ? x0 + wallW / 2 : x0 + 0.3 * sc + (wallW - 0.6 * sc) * i / (sp.n - 1);
      ctx.beginPath(); ctx.arc(cx, ay, 3.2, 0, TAU); ctx.fill();
      line(ctx, cx, ay, cx, ay + 6);
    }
    txt(ctx, sp.n + ' × ' + (sp.type === 'truss' ? 'truss' : sp.type === 'cable' ? 'cable' : 'strap') + ' at ' + nf(sp.a, 1) + ' m', x0 + 6, ay + 19, { font: '500 10px ' + F.mono, color: BP.strap, halo: BP.wall, haloW: 3 });
  }
  const rearWind = D.dir === 'rear', gx = w - 22, gy = 15;
  if (D.loadKind === 'wind') {
    ctx.strokeStyle = BP.force; ctx.fillStyle = BP.force; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(gx, gy, 7.5, 0, TAU); ctx.stroke();
    if (rearWind) { line(ctx, gx - 3.2, gy - 3.2, gx + 3.2, gy + 3.2); line(ctx, gx + 3.2, gy - 3.2, gx - 3.2, gy + 3.2); }
    else { ctx.beginPath(); ctx.arc(gx, gy, 2.4, 0, TAU); ctx.fill(); }
    txt(ctx, D.wind.cn < 0.03 ? 'wind parallel to the screen' : rearWind ? 'wind from the rear (away from you)' : 'wind from the front (toward you)', gx - 13, gy + 4, { font: '500 11px ' + F.sans, align: 'right', color: BP.text });
  } else {
    const say = D.loadKind === 'force' ? (S.knock.from === 'both' ? 'push from either side' : 'push from the ' + S.knock.from) : 'floor shakes front to back';
    txt(ctx, say, gx + 8, gy + 4, { font: '500 11px ' + F.sans, align: 'right', color: BP.text });
  }

  const bTop = y1 + 40, bBot = h - padB;
  const yv = (kg) => bBot - clamp(kg / niceTop, 0, 1.05) * (bBot - bTop);
  const hr = hit.rear; hr.bars = []; hr.bTop = bTop; hr.bBot = bBot; hr.top = ui.dragTop || niceTop;
  const topUse = ui.dragTop || niceTop;
  const yv2 = (kg) => bBot - clamp(kg / topUse, 0, 1.05) * (bBot - bTop);
  for (const f of [0, 0.5, 1]) {
    const y = yv2(topUse * f);
    ctx.strokeStyle = f === 0 ? 'rgba(190,210,235,.4)' : BP.grid; ctx.lineWidth = 1; line(ctx, x0 - 5, y + 0.5, x0 + wallW, y + 0.5);
    txt(ctx, nf(topUse * f, topUse * f < 10 && f > 0 ? 1 : 0), x0 - 9, y + 3.5, { font: '10.5px ' + F.mono, align: 'right', color: BP.text });
  }
  txt(ctx, 'kg of ballast per base', x0 - 5, bTop - 12, { font: '600 11px ' + F.disp, color: BP.text });
  if (D.req.per > 0 && D.req.per < topUse * 1.05) {
    const yr = yv2(D.req.per);
    ctx.strokeStyle = BP.bright; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); line(ctx, x0, yr + 0.5, x0 + wallW, yr + 0.5); ctx.setLineDash([]);
    if (w - (x0 + wallW) >= 62) txt(ctx, 'needed ' + nf(D.req.per), x0 + wallW + 5, yr + 3.5, { font: '500 10.5px ' + F.mono, align: 'left', color: BP.bright });
    else txt(ctx, 'needed ' + nf(D.req.per), x0 + wallW, yr - 4, { font: '500 10.5px ' + F.mono, align: 'right', color: BP.bright, halo: BP.bg, haloW: 3 });
  }
  const bwBar = clamp(pitch * 0.62, 3, 24);
  for (let i = 0; i < D.N; i++) {
    const cx = x0 + (i + 0.5) * pitch, kg = D.ballast[i], sf = D.local[i];
    const col = sf >= S.SF - 1e-9 ? BP.ballast : sf >= 1 - 1e-9 ? BP.warn : BP.crit;
    const yTop = yv2(kg), bx = cx - bwBar / 2, bh = bBot - yTop;
    hr.bars.push({ i, x0: cx - pitch / 2, x1: cx + pitch / 2 });
    if (bh > 0.5) {
      ctx.fillStyle = col;
      if (bwBar >= 6 && bh > 4) { ctx.save(); ctx.beginPath(); ctx.rect(bx - 1, yTop - 1, bwBar + 2, bh + 1); ctx.clip(); rr(ctx, bx, yTop, bwBar, bh + 6, 3); ctx.fill(); ctx.restore(); }
      else ctx.fillRect(bx, yTop, bwBar, bh);
    }
    if (col !== BP.ballast && bwBar >= 7) {
      ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 1.6;
      const gy2 = Math.min(yTop, bBot - 2) - 7;
      if (col === BP.warn) { ctx.beginPath(); ctx.moveTo(cx, gy2 - 4); ctx.lineTo(cx + 4, gy2 + 3); ctx.lineTo(cx - 4, gy2 + 3); ctx.closePath(); ctx.fill(); }
      else { line(ctx, cx - 3.5, gy2 - 3.5, cx + 3.5, gy2 + 3.5); line(ctx, cx + 3.5, gy2 - 3.5, cx - 3.5, gy2 + 3.5); }
    }
    if (i === ui.selected) { ctx.strokeStyle = BP.accent; ctx.lineWidth = 2; ctx.strokeRect(bx - 1.5, Math.min(yTop, bBot - 1) - 1.5, bwBar + 3, Math.max(bh, 1) + 3); }
    const showAll = pitch >= 30;
    if (showAll || i === ui.selected) {
      txt(ctx, nf(kg, kg < 10 ? 1 : 0), cx, Math.min(yTop, bBot) - (col !== BP.ballast && bwBar >= 7 ? 18 : 5), { font: (i === ui.selected ? '600 ' : '500 ') + '10.5px ' + F.mono, align: 'center', color: i === ui.selected ? '#fff' : BP.text, halo: BP.bg, haloW: 3 });
    }
    const every = pitch >= 20 ? 1 : pitch >= 10 ? 2 : 5;
    if (i % every === 0 || i === ui.selected) txt(ctx, String(i + 1), cx, bBot + 13, { font: (i === ui.selected ? '600 ' : '500 ') + '10px ' + F.mono, align: 'center', color: i === ui.selected ? '#fff' : BP.text });
  }
  txt(ctx, 'base', x0 - 9, bBot + 13, { font: '10px ' + F.sans, align: 'right', color: BP.text });
}

/* ---------------- wind direction dial (plan view) ---------------- */
function drawPlan(canvas, st, hit) {
  const { ctx, w, h } = fitCanvas(canvas);
  const { S, D } = st, g = D.geom, outdoor = S.mode === 'outdoor';
  ctx.fillStyle = BP.bg; ctx.fillRect(0, 0, w, h);
  const R = Math.min(w, h) * (outdoor ? 0.36 : 0.4), cx = w / 2, cy = h / 2 + 2;
  hit.plan = { cx, cy, R };
  ctx.strokeStyle = 'rgba(150,180,215,.38)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
  ctx.strokeStyle = 'rgba(150,180,215,.14)'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, TAU); ctx.stroke();
  for (let a = 0; a < 360; a += 15) {
    const r1 = R - (a % 45 === 0 ? 8 : 4), t = a * Math.PI / 180;
    ctx.strokeStyle = 'rgba(150,180,215,' + (a % 45 === 0 ? 0.55 : 0.28) + ')'; ctx.lineWidth = 1;
    line(ctx, cx + Math.sin(t) * R, cy - Math.cos(t) * R, cx + Math.sin(t) * r1, cy - Math.cos(t) * r1);
  }
  txt(ctx, 'REAR', cx + 20, cy - R + 17, { font: '600 11px ' + F.disp, align: 'left', color: BP.text, halo: BP.bg, haloW: 3 });
  txt(ctx, 'FRONT · LED face', cx, cy + R - 12, { font: '600 11px ' + F.disp, align: 'center', color: BP.text, halo: BP.bg, haloW: 3 });
  if (outdoor) {
    const rearBearing = S.facing + 180;
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([l, b]) => {
      const a = (b - rearBearing) * Math.PI / 180, rr2 = R + 14;
      txt(ctx, l, cx + Math.sin(a) * rr2, cy - Math.cos(a) * rr2 + 4, { font: '600 12px ' + F.disp, align: 'center', color: l === 'N' ? '#ffb4a8' : BP.text });
    });
  } else {
    txt(ctx, 'LEFT', cx - R + 20, cy + 4, { font: '600 10px ' + F.disp, align: 'center', color: 'rgba(174,191,212,.7)' });
    txt(ctx, 'RIGHT', cx + R - 20, cy + 4, { font: '600 10px ' + F.disp, align: 'center', color: 'rgba(174,191,212,.7)' });
  }
  const wallPx = R * (0.55 + 1.15 * clamp(S.W / 30, 0, 1)), k = wallPx / S.W;
  const wx0 = cx - wallPx / 2, depthPx = Math.max(6, g.depth * k), pitch = wallPx / D.N;
  if (D.stage) {                                          // stage outline under everything
    const stg = D.stage, sw = (S.W + (S.stage.extra || 0)) * k, yF = cy + stg.xFront * k, yR = cy - (-stg.xRear) * k;
    ctx.fillStyle = 'rgba(138,151,168,.16)'; ctx.fillRect(cx - sw / 2, yR, sw, yF - yR);
    ctx.strokeStyle = 'rgba(138,151,168,.7)'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.strokeRect(cx - sw / 2 + 0.5, yR + 0.5, sw - 1, yF - yR - 1); ctx.setLineDash([]);
    txt(ctx, 'stage ' + nf(stg.depth, 1) + ' × ' + nf(stg.width, 1) + ' m', cx - sw / 2 + 4, yF - 5, { font: '500 10px ' + F.mono, color: BP.text });
  }
  if (D.strap) {                                          // straps run straight back (or forward) to their anchors
    const sp = D.strap;
    ctx.lineWidth = 1.3;
    for (let i = 0; i < sp.n; i++) {
      const sx = sp.n === 1 ? cx : cx - wallPx / 2 + 0.3 * k + (wallPx - 0.6 * k) * i / (sp.n - 1);
      const y1 = cy + (sp.attachX < 0 ? -1 : 1) * 5, y2 = cy + (sp.anchorX < 0 ? -1 : 1) * (Math.abs(sp.anchorX) * k);
      ctx.strokeStyle = sp.active ? BP.strap : 'rgba(190,200,215,.5)'; ctx.setLineDash(sp.active ? [] : [3, 3]); line(ctx, sx, y1, sx, y2); ctx.setLineDash([]);
      ctx.fillStyle = BP.stage; ctx.fillRect(sx - 2.5, y2 - 2.5, 5, 5);
    }
  }
  ctx.fillStyle = BP.frame;
  for (let i = 0; i < D.N; i++) {
    const bx = wx0 + (i + 0.5) * pitch, bwp = Math.max(1.5, Math.min(0.45 * k, pitch * 0.6));
    ctx.fillRect(bx - bwp / 2, cy - 4 - depthPx, bwp, depthPx);
  }
  ctx.fillStyle = BP.ballast;
  for (let i = 0; i < D.N; i++) {
    const bx = wx0 + (i + 0.5) * pitch, bwp = Math.max(2, Math.min(0.45 * k, pitch * 0.6));
    ctx.fillRect(bx - bwp / 2, cy - 4 - depthPx, bwp, Math.min(depthPx * 0.3, 4));
  }
  ctx.fillStyle = '#c5d0df'; ctx.fillRect(wx0, cy - 4, wallPx, 5);
  ctx.save(); ctx.shadowColor = 'rgba(100,215,255,.9)'; ctx.shadowBlur = 8; ctx.fillStyle = '#6fd6ff'; ctx.fillRect(wx0, cy + 0.5, wallPx, 2); ctx.restore();

  if (D.loadKind !== 'wind') {                              // a push or a shake works along the front-back line only: no direction to drag
    hit.handle = null;
    ctx.strokeStyle = BP.force; ctx.fillStyle = BP.force; ctx.lineCap = 'round';
    const pulse = 0.5 + 0.5 * Math.min(1, Math.abs(st.sim.lam));
    if (D.loadKind === 'force') {
      const both = S.knock.from === 'both', sides = both ? [-1, 1] : [S.knock.from === 'rear' ? -1 : 1];
      for (const sd of sides) {                              // sd -1: from the rear (top of the dial), +1: from the front
        const y0p = cy + sd * (R * 0.95), y1p = cy + sd * (R * 0.34), act = both ? (st.sim.lam >= 0 ? sd === -1 : sd === 1) : true;
        ctx.globalAlpha = act ? 1 : 0.4; ctx.lineWidth = 2.6; line(ctx, cx, y0p, cx, y1p);
        arrow(ctx, cx, cy + sd * R * 0.4, cx, cy + sd * R * 0.3, 10, 6.5);
        ctx.beginPath(); ctx.arc(cx, y0p, 7 * pulse + 2, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      txt(ctx, nf0(S.knock.kgf) + ' kgf at ' + nf1(S.knock.h) + ' m', cx, cy + R * 0.62, { font: '600 11.5px ' + F.mono, align: 'center', color: BP.bright, halo: BP.bg, haloW: 3 });
      txt(ctx, 'shared by ' + S.knock.share + ' of ' + D.N + ' bases', cx, cy + R * 0.62 + 14, { font: '500 10.5px ' + F.sans, align: 'center', color: BP.cyan, halo: BP.bg, haloW: 3 });
    } else {
      ctx.lineWidth = 2.6; line(ctx, cx, cy - R * 0.86, cx, cy + R * 0.86);
      arrow(ctx, cx, cy - R * 0.96, cx, cy - R * 0.74, 10, 6.5); arrow(ctx, cx, cy + R * 0.96, cx, cy + R * 0.74, 10, 6.5);
      const aNow = Math.abs(st.sim.lam) * (D.rig.acc || 0) / M.G;
      txt(ctx, nf(aNow, 3) + ' g now', cx, cy + R * 0.62, { font: '600 11.5px ' + F.mono, align: 'center', color: BP.bright, halo: BP.bg, haloW: 3 });
      txt(ctx, 'the wall tips the weaker way', cx, cy + R * 0.62 + 14, { font: '500 10.5px ' + F.sans, align: 'center', color: BP.cyan, halo: BP.bg, haloW: 3 });
    }
    ctx.lineCap = 'butt';
    return;
  }
  const a = S.windDir * Math.PI / 180, sn = Math.sin(a), cs = Math.cos(a);
  const sx = cx + sn * R, sy = cy - cs * R;
  const dx = -sn, dy = cs, nx = -dy, ny = dx;
  ctx.strokeStyle = BP.cyan; ctx.lineWidth = 3; ctx.lineCap = 'round';
  line(ctx, cx, cy, cx, cy - cs * R); ctx.lineCap = 'butt';
  ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(111,208,255,.6)'; ctx.lineWidth = 1; line(ctx, sx, sy, cx, sy); ctx.setLineDash([]);
  const flowOff = -(st.t * 60) % 18;
  ctx.strokeStyle = BP.force; ctx.fillStyle = BP.force; ctx.lineWidth = 2.2;
  for (const off of [-14, 0, 14]) {
    const x0p = sx + nx * off, y0p = sy + ny * off, x1p = cx + sn * R * 0.3 + nx * off, y1p = cy - cs * R * 0.3 + ny * off;
    ctx.setLineDash([9, 9]); ctx.lineDashOffset = flowOff; line(ctx, x0p, y0p, x1p, y1p);
  }
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  arrow(ctx, cx + sn * R * 0.36, cy - cs * R * 0.36, cx + sn * R * 0.27, cy - cs * R * 0.27, 10, 6.5);
  ctx.fillStyle = BP.force; ctx.beginPath(); ctx.arc(sx, sy, 8.5, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  hit.handle = { x: sx, y: sy };
  const vTxt = nf(D.wind.vPeak, 1) + ' m/s' + (S.mode === 'outdoor' && S.gust > 0 ? ' peak' : '');
  txt(ctx, vTxt, cx, cy + R * 0.32, { font: '600 11.5px ' + F.mono, align: 'center', color: BP.bright, halo: BP.bg, haloW: 3 });
  txt(ctx, nf0(D.wind.cn * 100) + '% pushes the screen', cx, cy + R * 0.32 + 14, { font: '500 10.5px ' + F.sans, align: 'center', color: BP.cyan, halo: BP.bg, haloW: 3 });
}

/* ---------------- stability map ----------------
   Curves are traced from the ballast side: for each ballast, the load that just reaches the required safety factor and the load
   that tips it. Wind speed scales with the square root of the load factor, a push or a shake directly, so this needs one solve
   per ballast value. */
function axisOf(st) {                                // what the horizontal axis is, for the load in play
  const { S, D } = st, kind = D.loadKind, cs = D.loadCase;
  if (kind === 'wind') {
    return { kind, x0: D.wind.vMean, exp: 0.5, label: 'mean wind speed (m/s)', sub: 'ballast per base against wind', th1: 'Wind (m/s)', th2: 'Beaufort',
      max: Math.ceil(Math.max(S.mode === 'indoor' ? 18 : 30, D.wind.vMean * 1.3) / 5) * 5, you: nf(D.wind.vMean, 1) + ' m/s' };
  }
  if (kind === 'force') {
    const x0 = Math.max(S.knock.kgf, 1e-6);
    return { kind, x0, exp: 1, label: 'push (kgf)', sub: 'ballast per base against the push', th1: 'Push (kgf)', th2: 'Times yours', max: niceMax(Math.max(100, x0 * 1.6)), you: nf0(x0) + ' kgf' };
  }
  if (cs === 'sway') {
    const g = Math.max(Math.pow(2 * Math.PI * S.sway.f, 2) * S.sway.amp / 1000 / M.G, 1e-6);
    return { kind, x0: g, exp: 1, label: 'peak deck acceleration (g)', sub: 'ballast per base against the shake', th1: 'Shake (g)', th2: 'Times yours', max: niceMax(Math.max(0.15, g * 1.6)), you: nf(g, 3) + ' g' };
  }
  if (cs === 'quake') {
    const g = Math.max(S.quake.pga, 1e-6);
    return { kind, x0: g, exp: 1, label: 'ground acceleration (g)', sub: 'ballast per base against the earthquake', th1: 'Ground (g)', th2: 'Times yours', max: niceMax(Math.max(0.5, g * 1.4)), you: nf2(g) + ' g', zones: true };
  }
  const p = Math.max(S.notional.pct, 1e-6);
  return { kind, x0: p, exp: 1, label: 'sideways load (% of the weight)', sub: 'ballast per base against the sideways load', th1: 'Load (% of weight)', th2: 'Times yours', max: niceMax(Math.max(6, p * 1.6)), you: nf1(p) + '%' };
}
function axisTitle(ax, v) {
  if (ax.kind === 'wind') return 'Mean wind ' + nf1(v) + ' m/s · Beaufort ' + M.beaufort(v);
  if (ax.kind === 'force') return 'Push ' + nf0(v) + ' kgf';
  if (ax.zones) return 'Ground ' + nf2(v) + ' g';
  return ax.th1.indexOf('Shake') === 0 ? 'Deck shake ' + nf(v, 3) + ' g' : 'Load ' + nf1(v) + '% of the weight';
}
const reqAtAxis = (D, ax, x, SFt) => (ax.kind === 'wind' ? D.reqPerAtSpeed(x, SFt) : D.reqPerAtLoad(x, SFt, ax.x0));
const sfAtAxis = (D, ax, x) => { const r = x / ax.x0; return x > 0 ? D.SFact / (ax.kind === 'wind' ? r * r : r) : Infinity; };
function mapCurves(D, S, ax) {
  const N = D.N, pts = [];
  const grid = [0];
  for (let b = 0.4; b < 8000; b *= 1.115) grid.push(b);
  for (const b of grid) {
    const lam = Math.min(D.sfOf(b * N), 1e6);
    pts.push({ b, vAllow: ax.x0 * Math.pow(lam / S.SF, ax.exp), vCrit: ax.x0 * Math.pow(lam, ax.exp) });
  }
  return pts;
}
function bAtV(pts, key, v) {                         // ballast per base needed to reach load v
  if (v <= pts[0][key]) return 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][key] >= v) { const a = pts[i - 1], b = pts[i], f = (v - a[key]) / (b[key] - a[key] || 1); return a.b + f * (b.b - a.b); }
  return Infinity;
}
function drawMap(canvas, st, hit) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const { S, D } = st, T = theme(), ax = axisOf(st), wind = ax.kind === 'wind';
  const padL = 46, padR = 14, padT = 38, padB = 34, pw = w - padL - padR, ph = h - padT - padB;
  const xMax = ax.max;
  const pts = mapCurves(D, S, ax);
  const req = (v) => bAtV(pts, 'vAllow', v), tip = (v) => bAtV(pts, 'vCrit', v);
  const avg = D.Wb / D.N;
  let yTop = Math.pow(10, Math.ceil(Math.log10(Math.max(Math.min(req(xMax), 1e6), avg * 2, 30))));
  yTop = clamp(yTop, 100, 1e6);
  const c0 = 2, ys = (kg) => Math.log10(1 + Math.max(0, kg) / c0), ysTop = ys(yTop);
  const xp = (v) => padL + v / xMax * pw, yp = (kg) => padT + ph - clamp(ys(kg) / ysTop, 0, 1.2) * ph;
  hit.map = { padL, padT, pw, ph, xMax, yTop, c0, ysTop, xp, yp, w, h, ax };
  hit.vAt = (px) => clamp((px - padL) / pw * xMax, 0, xMax);
  hit.kgAt = (py) => { const f = clamp((padT + ph - py) / ph, 0, 1); return c0 * (Math.pow(10, f * ysTop) - 1); };

  const n = 140, A = [], Bc = [];
  for (let i = 0; i <= n; i++) { const v = xMax * i / n; A.push([xp(v), yp(req(v))]); Bc.push([xp(v), yp(tip(v))]); }
  ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, pw, ph); ctx.clip();
  const fillPoly = (p, col, al) => { ctx.fillStyle = col; ctx.globalAlpha = al; ctx.beginPath(); p.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; };
  fillPoly([[padL, padT], ...A.map(p => [p[0], Math.max(padT, p[1])]), [padL + pw, padT]], T.good, 0.13);
  fillPoly([...A, ...Bc.slice().reverse()], T.warn, 0.26);
  fillPoly([...Bc, [padL + pw, padT + ph], [padL, padT + ph]], T.crit, 0.14);
  ctx.restore();

  ctx.lineWidth = 1; ctx.font = '10.5px ' + F.mono;
  const yt = [0, 10, 100, 1000, 10000, 100000, 1000000].filter(v => v <= yTop);
  yt.forEach(v => { const y = Math.round(yp(v)) + 0.5; ctx.strokeStyle = v === 0 ? T.ink3 : T.line; line(ctx, padL, y, padL + pw, y); txt(ctx, v >= 1000 ? (v / 1000) + 'k' : String(v), padL - 7, y + 3.5, { font: '10.5px ' + F.mono, align: 'right', color: T.ink3 }); });
  const xs = wind ? (xMax <= 20 ? 2 : 5) : niceMax(xMax / 5), xd = xs < 0.1 ? 2 : xs < 1 ? 1 : 0;
  for (let v = 0; v <= xMax + 1e-9; v += xs) { const x = Math.round(xp(v)) + 0.5; ctx.strokeStyle = T.line; line(ctx, x, padT, x, padT + ph); txt(ctx, wind ? String(v) : nf(v, xd), x, padT + ph + 14, { font: '10.5px ' + F.mono, align: 'center', color: T.ink3 }); }
  txt(ctx, ax.label, padL + pw / 2, h - 5, { font: '11px ' + F.sans, align: 'center', color: T.ink2 });
  txt(ctx, 'kg of ballast per base', padL - 40, 11, { font: '11px ' + F.sans, color: T.ink2 });
  if (wind) {
    const bl = M.BFT_NAME.length - 1;
    const bu = M.BFT_SPEED;
    ctx.strokeStyle = T.ink3; ctx.lineWidth = 1;
    for (let b = 1; b <= bl; b++) {
      const lo = bu[b - 1], hi = bu[b]; if (lo >= xMax) break;
      const xa = xp(lo), xb = xp(Math.min(hi, xMax));
      line(ctx, xa + 0.5, padT - 6, xa + 0.5, padT);
      if (xb - xa >= 13) txt(ctx, String(b), (xa + xb) / 2, padT - 9, { font: '10px ' + F.mono, align: 'center', color: T.ink3 });
    }
    txt(ctx, 'Beaufort', padL - 7, padT - 9, { font: '10px ' + F.sans, align: 'right', color: T.ink3 });
  } else if (ax.zones) {                              // the three Greek seismic zones
    ctx.strokeStyle = T.ink3; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    for (const z of M.QUAKE_ZONES) {
      if (z.g > xMax) continue;
      const x = Math.round(xp(z.g)) + 0.5; line(ctx, x, padT - 6, x, padT + ph);
      txt(ctx, 'zone ' + z.zone, x, padT - 9, { font: '10px ' + F.mono, align: 'center', color: T.ink2 });
    }
    ctx.setLineDash([]);
  }

  ctx.save(); ctx.beginPath(); ctx.rect(padL, padT - 1, pw, ph + 1); ctx.clip();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 2;
  const stroke = (p, col) => { ctx.strokeStyle = col; ctx.beginPath(); let on = false; p.forEach(q => { if (q[1] >= padT + ph - 0.5) { on = false; return; } if (!on) { ctx.moveTo(q[0], q[1]); on = true; } else ctx.lineTo(q[0], q[1]); }); ctx.stroke(); };
  stroke(A, T.good); stroke(Bc, T.crit);
  ctx.restore();
  const lx = padL + pw * 0.6, vAtL = hit.vAt(lx);
  const yA = yp(req(vAtL)), yB = yp(tip(vAtL));
  txt(ctx, 'Stable', padL + 8, padT + 16, { font: '600 11.5px ' + F.sans, color: T.goodInk });
  if (yB < padT + ph - 14) txt(ctx, 'Tips over', lx + 6, Math.min(padT + ph - 7, yB + 16), { font: '600 11.5px ' + F.sans, color: T.critInk });
  if (yA < padT + ph - 6) txt(ctx, 'needs SF ' + nf2(S.SF), lx - 4, Math.max(padT + 13, yA - 7), { font: '500 11px ' + F.sans, align: 'right', color: T.ink2 });

  const vx = xp(ax.x0), vy = yp(avg);
  hit.dot = { x: vx, y: vy };
  ctx.strokeStyle = T.ink3; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); line(ctx, vx + 0.5, vy, vx + 0.5, padT + ph); ctx.setLineDash([]);
  const col = D.status === 'stable' ? T.good : D.status === 'marginal' ? T.warn : T.crit;
  ctx.fillStyle = T.panel; ctx.beginPath(); ctx.arc(vx, vy, 9, 0, TAU); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(vx, vy, 6.5, 0, TAU); ctx.fill();
  ctx.strokeStyle = T.ink; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(vx, vy, 6.5, 0, TAU); ctx.stroke();
  const lab = 'You: ' + nf(avg, avg < 10 ? 1 : 0) + ' kg · ' + ax.you;
  const right = vx > padL + pw * 0.55;
  txt(ctx, lab, vx + (right ? -13 : 13), vy - 11, { font: '600 11px ' + F.mono, align: right ? 'right' : 'left', color: T.ink, halo: T.panel, haloW: 4 });
  if (hit.hoverV != null) {
    const x = xp(hit.hoverV);
    ctx.strokeStyle = T.ink2; ctx.lineWidth = 1; line(ctx, Math.round(x) + 0.5, padT, Math.round(x) + 0.5, padT + ph);
    for (const [val, c] of [[req(hit.hoverV), T.good], [tip(hit.hoverV), T.crit]]) {
      const y = yp(val); ctx.fillStyle = T.panel; ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill(); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill();
    }
  }
}

/* ---------------- bending profile: sideways movement and bending moment along the height ---------------- */
function drawBend(canvas, st) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const { S, D } = st, T = theme(), b = D.bend, L = b.L;
  const padT = 24, padB = 30, padL = 40, padR = 12, gap = 30;
  const pw = (w - padL - padR - gap) / 2, ph = h - padT - padB;
  const yz = (z) => padT + ph - clamp(z / L, 0, 1) * ph;
  const dMm = b.defl.map((v) => v * 1000), mKn = b.bm.map((v) => v / 1000);
  const dLo = Math.min(0, ...dMm), dHi = Math.max(0.001, ...dMm), mHi = Math.max(0.001, ...mKn);
  const dSpan = niceMax(Math.max(dHi, -dLo) * 1.2), mSpan = niceMax(mHi * 1.2);
  const panels = [
    { x0: padL, lo: dLo < -1e-9 ? -dSpan : 0, hi: dSpan, vals: dMm, col: T.screen, unit: 'mm', title: 'Sideways movement', fmt: (v) => nf(v, Math.abs(v) < 10 ? 1 : 0) },
    { x0: padL + pw + gap, lo: 0, hi: mSpan, vals: mKn, col: T.ballast, unit: 'kN·m', title: 'Bending moment', fmt: (v) => nf(v, Math.abs(v) < 10 ? 1 : 0) }
  ];
  for (const p of panels) {
    const xv = (v) => p.x0 + (v - p.lo) / (p.hi - p.lo) * pw;
    ctx.strokeStyle = T.line; ctx.lineWidth = 1;
    for (let f = 0; f <= 1.001; f += 0.25) { const y = Math.round(yz(L * f)) + 0.5; line(ctx, p.x0, y, p.x0 + pw, y); }
    ctx.strokeStyle = T.ink3; const zx = Math.round(xv(0)) + 0.5; line(ctx, zx, padT, zx, padT + ph);
    txt(ctx, p.title, p.x0, 12, { font: '600 11px ' + F.sans, color: T.ink2 });
    txt(ctx, p.unit, p.x0 + pw, h - 5, { font: '10.5px ' + F.sans, align: 'right', color: T.ink3 });
    txt(ctx, p.fmt(p.hi), p.x0 + pw, padT + ph + 14, { font: '10.5px ' + F.mono, align: 'right', color: T.ink3 });
    if (p.lo < 0) txt(ctx, p.fmt(p.lo), p.x0, padT + ph + 14, { font: '10.5px ' + F.mono, align: 'left', color: T.ink3 });
    else txt(ctx, '0', p.x0, padT + ph + 14, { font: '10.5px ' + F.mono, align: 'left', color: T.ink3 });
    ctx.fillStyle = p.col; ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.moveTo(xv(0), yz(0));
    p.vals.forEach((v, k) => ctx.lineTo(xv(v), yz(b.nodeZ[k]))); ctx.lineTo(xv(0), yz(L)); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = p.col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    p.vals.forEach((v, k) => (k ? ctx.lineTo(xv(v), yz(b.nodeZ[k])) : ctx.moveTo(xv(v), yz(b.nodeZ[k])))); ctx.stroke();
  }
  for (let f = 0; f <= 1.001; f += 0.5) txt(ctx, nf(L * f, 1), padL - 6, yz(L * f) + 3.5, { font: '10.5px ' + F.mono, align: 'right', color: T.ink3 });
  txt(ctx, 'height (m)', 4, h - 5, { font: '10.5px ' + F.sans, color: T.ink3 });
  // direct labels at the extremes
  const pd = panels[0], pm = panels[1];
  const xd = (v) => pd.x0 + (v - pd.lo) / (pd.hi - pd.lo) * pw, xm = (v) => pm.x0 + (v - pm.lo) / (pm.hi - pm.lo) * pw;
  const dTop = dMm[dMm.length - 1];
  ctx.fillStyle = T.screen; ctx.beginPath(); ctx.arc(xd(dTop), yz(L), 4, 0, TAU); ctx.fill();
  txt(ctx, nf(dTop, Math.abs(dTop) < 10 ? 1 : 0) + ' mm', xd(dTop) - 7, yz(L) + 14, { font: '600 11px ' + F.mono, align: 'right', color: T.ink, halo: T.panel, haloW: 3 });
  ctx.fillStyle = T.ballast; ctx.beginPath(); ctx.arc(xm(mKn[0]), yz(0), 4, 0, TAU); ctx.fill();
  txt(ctx, nf(mKn[0], mKn[0] < 10 ? 1 : 0) + ' kN·m at the base', xm(mKn[0]) - 6, yz(0) - 8, { font: '600 11px ' + F.mono, align: 'right', color: T.ink, halo: T.panel, haloW: 3 });
  if (D.strap && D.strap.active) {
    const ya = yz(D.strap.a);
    for (const p of panels) { ctx.strokeStyle = BP.strap; ctx.lineWidth = 1.4; ctx.setLineDash([3, 3]); line(ctx, p.x0, ya, p.x0 + pw, ya); ctx.setLineDash([]); }
    ctx.fillStyle = BP.strap; ctx.beginPath(); ctx.moveTo(pd.x0 + pw, ya); ctx.lineTo(pd.x0 + pw - 9, ya - 5); ctx.lineTo(pd.x0 + pw - 9, ya + 5); ctx.closePath(); ctx.fill();
    txt(ctx, 'strap', pd.x0 + pw - 12, ya - 7, { font: '600 10.5px ' + F.sans, align: 'right', color: T.ink2, halo: T.panel, haloW: 3 });
  }
}
