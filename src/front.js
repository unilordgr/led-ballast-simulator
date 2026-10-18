/* ===== front.js : perspective view of the LED face (and stage) that bends in the wind ===== */
const CAM_PRESETS = { front: { az: 0, el: 0.06 }, three: { az: -0.56, el: 0.17 }, side: { az: -1.5, el: 0.06 } };
const fview = { particles: [], lastT: 0, hit: null };

function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function v3cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function v3norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

function makeCamera(az, el, T, dist) {
  const dir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const C0 = [T[0] + dist * dir[0], T[1] + dist * dir[1], T[2] + dist * dir[2]];
  const f = v3norm(v3sub(T, C0)), r = v3norm(v3cross(f, [0, 1, 0])), u = v3cross(r, f);
  return { C: C0, f, r, u };
}
function cameraFit(cam, pts, w, h, pad) {          // focal length and centre so that all pts fit
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    const v = v3sub(p, cam.C), zc = v3dot(v, cam.f); if (zc < 0.1) continue;
    const x = v3dot(v, cam.r) / zc, y = v3dot(v, cam.u) / zc;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (!isFinite(x0 + x1 + y0 + y1)) { x0 = -1; x1 = 1; y0 = -1; y1 = 1; }
  const fpx = Math.min((w - pad.l - pad.r) / Math.max(x1 - x0, 1e-6), (h - pad.t - pad.b) / Math.max(y1 - y0, 1e-6));
  return { fpx, ox: pad.l + (w - pad.l - pad.r) / 2 - (x0 + x1) / 2 * fpx, oy: pad.t + (h - pad.t - pad.b) / 2 + (y0 + y1) / 2 * fpx };
}

function drawFront(canvas, st) {
  const { ctx, w, h } = fitCanvas(canvas);
  const { S, D, sim, ui } = st, outdoor = S.mode === 'outdoor';
  const hs = D.geom.hs, L = D.geom.L, y0 = M.SHEET.screenBottom, W = S.W, H = S.H, stg = D.stage;
  const tipDir = D.dir === 'rear' ? 1 : -1, sMode = D.gov === 'S';
  const dep = S.cabDepth || 0.083, cabH = D.cabH;
  const exag = st.exag || bendExag(D, ui.exag), nodes = st.nodesNow || bendNow(D, sim), Kn = nodes.length - 1;
  const windy = D.loadKind === 'wind';
  const t = st.t, u = sim.lastU, vNow = windy ? D.wind.vPeak * u : 0;
  const defl = (y) => { const f = clamp(y / L, 0, 1) * Kn, i = Math.min(Kn - 1, Math.floor(f)), k = f - i; return nodes[i] * (1 - k) + nodes[i + 1] * k; };
  const sd = sim.side || tipDir;                                              // the toe it tips about now
  const th = sd * sim.phi, cth = Math.cos(th), sth = Math.sin(th);
  const pivZ = D.shake ? (sd > 0 ? D.sides.fwd.geom.pivotX : D.sides.back.geom.pivotX) : D.geom.pivotX, pivY = sMode ? 0 : hs;
  const gz = sim.groundAmp > 0 ? sim.ground * sim.groundAmp * clamp(0.2 / sim.groundAmp, 1, 200) : 0;   // the floor shaking, drawn larger than it is
  const rot3 = (p) => { if (!th) return p; const dZ = p[2] - pivZ, dY = p[1] - pivY; return [p[0], pivY + dY * cth - dZ * sth, pivZ + dZ * cth + dY * sth]; };
  const wallPt = (x, y, z0) => rot3([x, hs + y, z0 + tipDir * exag * defl(clamp(y, 0, L))]);

  // ---- camera
  const camTarget = [0, hs + (L) / 2, 0];
  const R0 = 0.5 * Math.hypot(W + (stg ? 2 : 0), H + hs, stg ? stg.depth : 2) + 1;
  const cam = makeCamera(ui.camAz, ui.camEl, camTarget, R0 * 3.4);
  const fitPts = [];
  for (const x of [-W / 2, W / 2]) for (const y of [hs, hs + L]) fitPts.push([x, y, 0], [x, y, -1]);
  if (stg) for (const x of [-stg.width / 2 - 0.2, stg.width / 2 + 0.2]) for (const z of [stg.xRear, stg.xFront]) fitPts.push([x, 0, z], [x, hs, z]);
  const fit = cameraFit(cam, fitPts, w, h, { l: 70, r: 70, t: 56, b: 46 });
  const P = (p) => { const v = v3sub([p[0], p[1], p[2] + gz], cam.C), zc = v3dot(v, cam.f); return [fit.ox + v3dot(v, cam.r) / zc * fit.fpx, fit.oy - v3dot(v, cam.u) / zc * fit.fpx, zc]; };
  st.fcam = { cam, fit };

  // ---- backdrop
  const storm = clamp((D.wind.vMean - 9) / 16, 0, 1);
  let g = ctx.createLinearGradient(0, 0, 0, h);
  if (outdoor) { g.addColorStop(0, mixRGB([84, 150, 222], [82, 92, 103], storm)); g.addColorStop(0.62, mixRGB([196, 226, 248], [146, 156, 166], storm)); g.addColorStop(1, mixRGB([120, 170, 110], [90, 130, 95], storm)); }
  else { g.addColorStop(0, '#070b12'); g.addColorStop(0.7, '#16212e'); g.addColorStop(1, '#0e151e'); }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // ---- floor
  const fx = W / 2 + 14, fz0 = -13, fz1 = 13;
  const fl = [[-fx, 0, fz0], [fx, 0, fz0], [fx, 0, fz1], [-fx, 0, fz1]].map(P);
  g = ctx.createLinearGradient(0, Math.min(fl[0][1], fl[1][1]), 0, Math.max(fl[2][1], fl[3][1]));
  if (outdoor) { g.addColorStop(0, mixRGB([110, 162, 100], [86, 120, 88], storm)); g.addColorStop(1, mixRGB([60, 118, 62], [48, 88, 58], storm)); }
  else { g.addColorStop(0, '#222e3b'); g.addColorStop(1, '#10161e'); }
  ctx.fillStyle = g; ctx.beginPath(); fl.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = outdoor ? 'rgba(255,255,255,.14)' : 'rgba(150,185,225,.12)'; ctx.lineWidth = 1;
  for (let z = fz0; z <= fz1; z += 1) { const a = P([-fx, 0, z]), b = P([fx, 0, z]); line(ctx, a[0], a[1], b[0], b[1]); }
  for (let x = -Math.floor(fx / 2) * 2; x <= fx; x += 2) { const a = P([x, 0, fz0]), b = P([x, 0, fz1]); line(ctx, a[0], a[1], b[0], b[1]); }

  // ---- wind streaks that stay behind the wall
  const wallC = P([0, hs + L / 2, 0]);
  if (windy) streaks(ctx, P, fview, st, W, H + hs, wallC[2], true, vNow);

  // ---- stage
  if (stg) {
    const sx = stg.width / 2 + 0.1, zr = stg.xRear, zf = stg.xFront, dk = 0.09;
    const rotS = sMode ? rot3 : (p) => p;
    const Q = (pts, fill, stroke) => { const pp = pts.map((p) => P(rotS(p))); ctx.fillStyle = fill; ctx.beginPath(); pp.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } };
    // legs
    ctx.strokeStyle = 'rgba(160,180,205,.35)'; ctx.lineWidth = 1.2;
    for (const x of [-sx, sx]) for (const z of [zr, zf]) { const a = P(rotS([x, 0, z])), b = P(rotS([x, hs, z])); line(ctx, a[0], a[1], b[0], b[1]); }
    Q([[-sx, 0, zr], [sx, 0, zr], [sx, hs - dk, zr], [-sx, hs - dk, zr]], '#2a3340');                     // rear face
    Q([[-sx, 0, zf], [-sx, 0, zr], [-sx, hs, zr], [-sx, hs, zf]], '#313c4c');                              // left face
    Q([[sx, 0, zf], [sx, 0, zr], [sx, hs, zr], [sx, hs, zf]], '#313c4c');                                  // right face
    Q([[-sx, 0, zf], [sx, 0, zf], [sx, hs - dk, zf], [-sx, hs - dk, zf]], '#3a4658');                     // front face
    Q([[-sx, hs - dk, zf], [sx, hs - dk, zf], [sx, hs, zf], [-sx, hs, zf]], '#c3cfdf');                    // deck edge
    Q([[-sx, hs, zf], [sx, hs, zf], [sx, hs, zr], [-sx, hs, zr]], '#a2b0c4');                              // deck top
    ctx.strokeStyle = 'rgba(8,14,24,.22)'; ctx.lineWidth = 1;
    for (let x = -sx; x <= sx + 1e-6; x += 1.22) { const a = P(rotS([x, hs, zf])), b = P(rotS([x, hs, zr])); line(ctx, a[0], a[1], b[0], b[1]); }
    for (let z = zf; z >= zr - 1e-6; z -= 1.22) { const a = P(rotS([-sx, hs, z])), b = P(rotS([sx, hs, z])); line(ctx, a[0], a[1], b[0], b[1]); }
    const lab = P(rotS([-sx, hs / 2, zf]));
    txt(ctx, 'stage ' + nf(stg.h, 2) + ' m', lab[0] - 6, lab[1], { font: '600 11px ' + F.mono, align: 'right', color: outdoor ? '#0b3550' : '#dcf2ff', halo: outdoor ? 'rgba(255,255,255,.9)' : 'rgba(6,10,18,.88)', haloW: 3 });
  }

  // ---- straps and anchors (behind the wall)
  const sp = D.strap;
  if (sp) {
    const nS = sp.n, aY = sp.a;
    const Tn = sim.Ph / (sp.cb * sp.n), cap = sp.TcapKg * M.G, util = cap > 0 ? Tn / cap : 0;
    const col = sim.broken || util >= 1 ? C.strapBad : util > 0.6 ? C.strapHot : C.strap;
    for (let i = 0; i < nS; i++) {
      const xi = nS === 1 ? 0 : -W / 2 + 0.3 + (W - 0.6) * i / (nS - 1);
      const Apt = wallPt(xi, aY, sp.attachX);
      const Bpt = [xi, hs + sp.anchorY, sp.anchorX];
      const A2 = P(Apt), B2 = P(Bpt);
      if (sim.broken) { ctx.strokeStyle = C.strapBad; ctx.lineWidth = 1.8; line(ctx, B2[0], B2[1], B2[0] + (A2[0] - B2[0]) * 0.3, B2[1] + (A2[1] - B2[1]) * 0.3); line(ctx, A2[0], A2[1], A2[0], A2[1] + 12); }
      else {
        ctx.lineCap = 'round';
        if (!sp.active) { ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(190,200,215,.6)'; ctx.lineWidth = 1.2; }
        else if (sp.type === 'truss') { ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 2.4; }
        else { ctx.strokeStyle = col; ctx.lineWidth = sp.type === 'cable' ? 1.6 : 2.8; }
        line(ctx, A2[0], A2[1], B2[0], B2[1]); ctx.setLineDash([]); ctx.lineCap = 'butt';
      }
      ctx.fillStyle = '#8a97a8'; ctx.beginPath(); ctx.arc(B2[0], B2[1], 3, 0, TAU); ctx.fill();
    }
  }

  // ---- the wall: end faces, then cabinets
  const lighting = v3norm([0.3, 0.6, 0.75]);
  const faceVisible = (p0, p1, p2) => { const n = v3cross(v3sub(p1, p0), v3sub(p2, p0)); return v3dot(n, v3sub(cam.C, p0)) > 0; };
  const endFace = (xe, outward) => {                       // the quad below has its normal along +X
    for (let r = 0; r < D.rows; r++) {
      const ya = y0 + r * cabH, yb = ya + cabH;
      const p = [wallPt(xe, ya, 0), wallPt(xe, ya, -dep), wallPt(xe, yb, -dep), wallPt(xe, yb, 0)];
      const fv = faceVisible(p[0], p[1], p[2]);
      if (outward > 0 ? !fv : fv) continue;
      const pp = p.map(P);
      ctx.fillStyle = r % 2 ? '#93a0b4' : '#8795aa'; ctx.beginPath(); pp.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(8,14,24,.5)'; ctx.lineWidth = 0.8; ctx.stroke();
    }
  };
  endFace(-W / 2, -1); endFace(W / 2, 1);
  const topP = [wallPt(-W / 2, L, 0), wallPt(W / 2, L, 0), wallPt(W / 2, L, -dep), wallPt(-W / 2, L, -dep)];
  if (faceVisible(topP[0], topP[1], topP[2]) === false) { /* top not visible from below */ } else { const pp = topP.map(P); ctx.fillStyle = '#b7c3d4'; ctx.beginPath(); pp.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.closePath(); ctx.fill(); }

  const cols = D.cols, rows = D.rows, tt = t * 0.5;
  const hue = (uu, vv) => 220 + 48 * Math.sin(uu * 5.2 + tt * 1.3) + 36 * Math.cos(vv * 6.1 - tt) + 22 * Math.sin((uu + vv) * 9 + tt * 2.1);
  const hsl = (hh, ss, ll) => 'hsl(' + ((Math.round(hh) % 360) + 360) % 360 + ',' + ss + '%,' + clamp(ll, 4, 92).toFixed(0) + '%)';
  for (let r = 0; r < rows; r++) {
    const ya = y0 + r * cabH, yb = ya + cabH, vb = r / rows, vt = (r + 1) / rows;
    for (let c = 0; c < cols; c++) {
      const xa = -W / 2 + c * CAB_W2, xb = xa + CAB_W2;
      const q00 = wallPt(xa, ya, 0), q10 = wallPt(xb, ya, 0), q11 = wallPt(xb, yb, 0), q01 = wallPt(xa, yb, 0);
      if (!faceVisible(q00, q10, q01)) continue;
      const n = v3norm(v3cross(v3sub(q10, q00), v3sub(q01, q00)));
      const lam = Math.max(0, v3dot(n, lighting)), shade = 0.55 + 0.6 * lam;
      const gloss = smooth((n[1] - 0.02) / 0.07) * 0.3;
      const uc = (c + 0.5) / cols;
      const p00 = P(q00), p10 = P(q10), p11 = P(q11), p01 = P(q01);
      const gr = ctx.createLinearGradient((p00[0] + p10[0]) / 2, (p00[1] + p10[1]) / 2, (p01[0] + p11[0]) / 2, (p01[1] + p11[1]) / 2);
      gr.addColorStop(0, hsl(hue(uc, vb), 88, 46 * shade)); gr.addColorStop(1, hsl(hue(uc, vt), 88, 46 * shade));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(p00[0], p00[1]); ctx.lineTo(p10[0], p10[1]); ctx.lineTo(p11[0], p11[1]); ctx.lineTo(p01[0], p01[1]); ctx.closePath(); ctx.fill();
      if (gloss > 0.01) { ctx.fillStyle = 'rgba(255,255,255,' + gloss.toFixed(3) + ')'; ctx.fill(); }
      ctx.strokeStyle = 'rgba(6,10,16,.55)'; ctx.lineWidth = 0.7; ctx.stroke();
    }
  }

  // ---- wind streaks in front of the wall
  if (windy) streaks(ctx, P, fview, st, W, H + hs, wallC[2], false, vNow);

  // ---- labels on the wall
  const labCol = outdoor ? '#0b3550' : '#dcf2ff', labHalo = outdoor ? 'rgba(255,255,255,.9)' : 'rgba(6,10,18,.88)';
  const lb = P(wallPt(0, 0, 0)), lt = P(wallPt(-W / 2, L, 0));
  txt(ctx, nf(W, 1) + ' m · ' + cols + ' cabinets', lb[0], lb[1] + 17, { font: '600 11px ' + F.mono, align: 'center', color: labCol, halo: labHalo, haloW: 3 });
  const ll = P(wallPt(-W / 2, y0 + H / 2, 0)), rowTxt = nf(H, 1) + ' m · ' + rows + ' rows';
  ctx.font = '600 11px ' + F.mono; const rowW = ctx.measureText(rowTxt).width;
  txt(ctx, rowTxt, Math.max(ll[0] - 10, rowW + 8), ll[1], { font: '600 11px ' + F.mono, align: 'right', color: labCol, halo: labHalo, haloW: 3 });
  if (exag > 1.5 && Math.abs(D.bend.topEl) > 1e-5) {
    const tp = P(wallPt(0, L, 0));
    txt(ctx, 'top moves ' + nf(Math.abs(D.bend.topEl) * 1000, Math.abs(D.bend.topEl) * 1000 < 10 ? 1 : 0) + ' mm, drawn ×' + nf0(exag), tp[0], tp[1] - 12, { font: '600 11px ' + F.mono, align: 'center', color: labCol, halo: labHalo, haloW: 3 });
  }
  if (sim.toppled && sim.phi > 1.2) txt(ctx, sMode ? 'STAGE AND WALL TOPPLED' : 'TOPPLED', w / 2, h * 0.28, { font: '700 ' + clamp(w * 0.06, 28, 54) + 'px ' + F.disp, align: 'center', color: '#fff', halo: 'rgba(160,30,30,.95)', haloW: 8 });
}
const CAB_W2 = 0.5;

/* wind streaks in a box around the wall; drawn in two passes so they pass behind or in front of it */
function streaks(ctx, P, fv, st, W, Htot, wallDepth, behind, vNow) {
  const { D, S } = st, th = S.windDir * Math.PI / 180;
  const d = [-Math.sin(th), 0, Math.cos(th)];
  const bx = W / 2 + 6, bz = 8, by = Htot + 2.5;
  const want = clamp(Math.round(W * 4 + 70), 90, 220);
  if (fv.particles.length !== want) fv.particles = Array.from({ length: want }, () => ({ x: (Math.random() * 2 - 1) * bx, y: 0.3 + Math.random() * by, z: (Math.random() * 2 - 1) * bz, sp: 0.7 + Math.random() * 0.6 }));
  const dt = clamp(st.t - fv.lastT, 0, 0.05); fv.lastT = st.t;
  const speed = vNow * 0.8;
  const col = st.S.mode === 'outdoor' ? '255,255,255' : '160,205,255';
  ctx.lineCap = 'round';
  for (const p of fv.particles) {
    if (behind) {
      p.x += d[0] * speed * p.sp * dt; p.z += d[2] * speed * p.sp * dt;
      const hitWall = Math.abs(p.z) < 0.14 && Math.abs(p.x) < W / 2 && p.y < Htot + 0.2;
      if (hitWall || Math.abs(p.x) > bx || Math.abs(p.z) > bz) {
        const along = Math.abs(d[2]) >= Math.abs(d[0]);                     // enter from the upstream face
        if (along) { p.z = -Math.sign(d[2] || 1) * bz; p.x = (Math.random() * 2 - 1) * bx; } else { p.x = -Math.sign(d[0] || 1) * bx; p.z = (Math.random() * 2 - 1) * bz; }
        p.y = 0.3 + Math.random() * by;
      }
    }
    const len = clamp(speed * 0.18, 0.2, 2.2) * p.sp;
    const a = P([p.x, p.y, p.z]), b = P([p.x - d[0] * len, p.y, p.z - d[2] * len]);
    if ((a[2] > wallDepth) !== behind) continue;
    const alpha = clamp(0.5 - (a[2] - wallDepth) * 0.01, 0.1, 0.65);
    ctx.strokeStyle = 'rgba(' + col + ',' + alpha.toFixed(2) + ')'; ctx.lineWidth = 1.3; line(ctx, a[0], a[1], b[0], b[1]);
  }
  ctx.lineCap = 'butt';
}
