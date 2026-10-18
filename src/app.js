/* ===== app.js (v2) : state, controls, text, pointer interaction, animation loop ===== */
const $ = (id) => document.getElementById(id);
const S = M.defaults();
const sim = new M.Sim();
const ui = { selected: -1, speed: 1, paused: false, showInset: true, dragTop: 0, exag: 'auto', cam: 'three', camAz: CAM_PRESETS.three.az, camEl: CAM_PRESETS.three.el, camTAz: CAM_PRESETS.three.az, camTEl: CAM_PRESETS.three.el };
const hits = { rear: null, plan: null, map: null, hoverV: null };
const st = { S, sim, ui, D: null, V: null, t: 0 };
const SUB = 1 / 240;
let D = null, sig = '';
let dirty = { rear: true, map: true, bend: true };

const BAL_MAX = () => (S.mode === 'indoor' ? (S.indoorCase === 'quake' ? 1500 : S.indoorCase === 'door' ? 300 : 200) : 1500);
const roundBallast = (kg) => (kg < 20 ? Math.round(kg * 10) / 10 : kg < 200 ? Math.round(kg * 2) / 2 : Math.round(kg));
const fmtB = (kg) => (kg < 20 ? kg.toFixed(1) : kg < 200 ? (Math.round(kg * 2) / 2).toFixed(kg % 1 ? 1 : 0) : Math.round(kg).toString());
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compassName = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const kmh = (v) => v * 3.6;
const EI_MN = (pos) => 0.1 * Math.pow(1000, pos / 1000), EI_POS = (mn) => 1000 * Math.log10(Math.max(mn, 0.1) / 0.1) / 3;
const customId = () => (S.cabSize === '500x1000' ? 'custom10' : 'custom5');
const preset = () => M.CABINETS.find((c) => c.id === S.cab) || M.CABINETS[0];
const cabKg = () => S.kgm2 * M.cabArea(S.cabSize);

/* ------------------------------------------------------------------ model plumbing */
function normalize() {
  const cabH = M.cabHeight(S.cabSize);
  S.W = clamp(Math.round(S.W * 2) / 2, 1, 60);
  S.H = clamp(Math.round(S.H / cabH) * cabH, 1, 20);
  S.kgm2 = clamp(S.kgm2, 1, 200);
  S.SF = clamp(S.SF, 1, 3);
  S.Cf = clamp(S.Cf, 0.1, 3);
  S.depth = clamp(S.depth, 0.3, 5);
  S.mu = clamp(S.mu, 0.05, 1.5);
  S.outSpeed = clamp(S.outSpeed, 0, 60);
  S.gust = clamp(S.gust, 0, 1);
  S.indoorScale = clamp(Math.round(S.indoorScale), 0, 10);
  if (M.CASES.indexOf(S.indoorCase) < 0) S.indoorCase = 'draught';
  S.door.v = clamp(S.door.v, 0, 30); S.door.dur = clamp(S.door.dur, 0.05, 20);
  const kn = S.knock; kn.kgf = clamp(kn.kgf, 0, 500); kn.h = clamp(kn.h, 0.1, 20); kn.dur = clamp(kn.dur, 0.05, 10); kn.share = clamp(Math.round(kn.share), 1, 60);
  S.sway.amp = clamp(S.sway.amp, 0, 100); S.sway.f = clamp(S.sway.f, 0.1, 10); S.sway.bounce = clamp(S.sway.bounce, 0, 0.9);
  S.quake.pga = clamp(S.quake.pga, 0.01, 1.5); S.quake.floor = clamp(S.quake.floor, 1, 4); S.quake.dur = clamp(Math.round(S.quake.dur), 3, 60);
  S.notional.pct = clamp(S.notional.pct, 0.1, 30);
  S.windDir = ((S.windDir % 360) + 360) % 360;
  S.facing = ((S.facing % 360) + 360) % 360;
  S.EI = clamp(S.EI, 0.05e6, 200e6);
  S.defLimit = clamp(S.defLimit, 20, 1000);
  const sg = S.stage;
  sg.h = clamp(sg.h, 0.1, 4); sg.depth = clamp(sg.depth, 1.5, 20);
  sg.front = clamp(sg.front, 0.3, Math.max(0.3, sg.depth - S.depth - 0.15));
  sg.deckKgm2 = clamp(sg.deckKgm2, 1, 400); sg.rating = clamp(sg.rating, 50, 3000);
  sg.muDeck = clamp(sg.muDeck, 0.05, 1.5); sg.muFloor = clamp(sg.muFloor, 0.05, 1.5);
  const R = S.rest, cols = Math.max(1, Math.round(S.W / M.CAB.w));
  R.n = clamp(Math.round(R.n || 0), 0, 60); R.a = Math.max(0, R.a || 0); R.d = Math.max(0, R.d || 0);
  R.wll = clamp(R.wll, 50, 50000); R.slack = clamp(R.slack, 0, 2000); R.anchorKg = clamp(R.anchorKg, 0, 10000);
  if (S.autoN) S.N = M.sheetBases(S);
  S.N = clamp(Math.round(S.N), 1, cols);
  if (!S.ballastAuto && (!S.ballast || S.ballast.length !== S.N)) {
    S.ballast = Array.from({ length: S.N }, (_, i) => (S.ballast && S.ballast[i] != null ? S.ballast[i] : S.ballastPer));
  }
  if (ui.selected >= S.N) ui.selected = -1;
}
function physSig() {
  const r = D.rig, f = (a) => a.map((v) => v.toFixed(4)).join(',');
  const sp = r.strap ? [r.strap.c0.toFixed(1), r.strap.dp1.toExponential(4), r.strap.gp, r.strap.PhCap.toFixed(0), r.strap.aPiv.toFixed(3), r.strap.xiAtt.toFixed(3)].join(',') : '-';
  const bs = r.bendStrap ? [r.bendStrap.c0.toFixed(1), r.bendStrap.dp1.toExponential(4)].join(',') : '-';
  const ld = S.mode === 'indoor' ? [D.loadCase, S.door.v, S.door.dur, S.knock.kgf, S.knock.h, S.knock.from, S.knock.dur, S.knock.share, S.sway.amp, S.sway.f, S.sway.bounce, S.quake.pga, S.quake.floor, S.quake.dur, S.notional.pct].join(',') : '';
  return [f(r.m), f(r.x), f(r.y), r.FN === undefined ? r.F.toFixed(2) : r.FN, r.hc.toFixed(4), D.dir, S.mode === 'outdoor' ? S.gust : 0, D.wind.cn.toFixed(4), sp, bs, r.gov, ld].join('|');
}
function update() {
  normalize();
  D = M.derive(S);
  st.D = D;
  const s2 = physSig();
  sim.setRig(D, S);
  if (s2 !== sig) { sig = s2; sim.reset(); }
  syncControls();
  renderText();
  dirty.rear = dirty.map = dirty.bend = true;
}
function ensureManual() {
  if (S.ballastAuto) { S.ballastAuto = false; S.ballast = D.ballast.slice(); S.ballastPer = D.Wb / D.N; }
}
function setBallastAll(kg) {
  S.ballastAuto = false; kg = clamp(roundBallast(Math.max(0, kg)), 0, 5000);
  S.ballastPer = kg; S.ballast = new Array(S.N).fill(kg);
}
function setBase(i, kg) {
  ensureManual(); S.ballast[i] = clamp(roundBallast(Math.max(0, kg)), 0, 5000);
  S.ballastPer = S.ballast.reduce((a, b) => a + b, 0) / S.N;
}

/* ------------------------------------------------------------------ controls */
const pairs = {};
function bindPair(id, o) {          // slider + number box
  const r = $(id + '-r'), n = $(id + '-n');
  const toSlider = o.toSlider || ((v) => v), fromSlider = o.fromSlider || ((v) => v);
  const p = { r, n, sync() {
    const v = o.get();
    if (o.max) { const mx = o.max(); r.max = mx; n.max = Math.max(mx, +n.max || 0); }
    if (o.min) { r.min = o.min(); }
    r.value = toSlider(v);
    r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%');
    if (document.activeElement !== n) n.value = o.fmt ? o.fmt(v) : v;
  } };
  r.addEventListener('input', () => { o.set(fromSlider(parseFloat(r.value))); update(); });
  n.addEventListener('input', () => { const v = parseFloat(n.value); if (isFinite(v)) { o.set(v); update(); } });
  n.addEventListener('change', () => { update(); n.value = o.fmt ? o.fmt(o.get()) : o.get(); });
  n.addEventListener('blur', () => { n.value = o.fmt ? o.fmt(o.get()) : o.get(); });
  pairs[id] = p; return p;
}
function bindSeg(id, set) {
  const el = $(id);
  el.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; set(b.dataset.v); });
  return { set(v) { el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === String(v)))); } };
}

const segs = {};
function fillCabModels() {
  const sel = $('cabModel'); sel.textContent = '';
  for (const c of M.CABINETS.filter((x) => x.size === S.cabSize)) {
    const o = document.createElement('option'); o.value = c.id;
    o.textContent = c.name + (c.id.startsWith('custom') ? '' : ' · ' + nf1(c.kg) + ' kg');
    sel.appendChild(o);
  }
}
function initControls() {
  fillCabModels();
  segs.cab = bindSeg('segCab', (v) => {
    S.cabSize = v; const first = M.CABINETS.find((c) => c.size === v);
    S.cab = first.id; S.kgm2 = first.kgm2; S.cabDepth = first.depth; fillCabModels(); update();
  });
  $('cabModel').addEventListener('change', () => {
    const c = M.CABINETS.find((x) => x.id === $('cabModel').value); if (!c) return;
    S.cab = c.id; S.cabDepth = c.depth; if (!c.id.startsWith('custom')) S.kgm2 = c.kgm2; update();
  });
  bindPair('W', { get: () => S.W, set: (v) => (S.W = v), fmt: (v) => (+v).toFixed(1) });
  bindPair('H', { get: () => S.H, set: (v) => (S.H = v), fmt: (v) => String(+(+v).toFixed(1)) });
  bindPair('K', { get: () => S.kgm2, set: (v) => { S.kgm2 = v; S.cab = customId(); }, fmt: (v) => (+v).toFixed(1) });
  bindPair('N', { get: () => S.N, set: (v) => { S.autoN = false; S.N = v; }, fmt: (v) => String(Math.round(v)), max: () => Math.max(1, Math.round(S.W / M.CAB.w)) });
  bindPair('B', {
    get: () => D.Wb / D.N, set: (v) => setBallastAll(v), fmt: fmtB,
    toSlider: (kg) => 1000 * Math.sqrt(clamp(kg / BAL_MAX(), 0, 1)), fromSlider: (v) => BAL_MAX() * Math.pow(v / 1000, 2)
  });
  bindPair('DG', { get: () => S.door.v, set: (v) => (S.door.v = v), fmt: (v) => (+v).toFixed(1) });
  bindPair('DD', { get: () => S.door.dur, set: (v) => (S.door.dur = v), fmt: (v) => (+v).toFixed(1) });
  bindPair('KG', { get: () => S.knock.kgf, set: (v) => (S.knock.kgf = v), fmt: (v) => String(Math.round(v)) });
  bindPair('KH', { get: () => S.knock.h, set: (v) => (S.knock.h = v), fmt: (v) => (+v).toFixed(1), max: () => Math.max(1, D ? D.geom.L : 7) });
  bindPair('KD', { get: () => S.knock.dur, set: (v) => (S.knock.dur = v), fmt: (v) => (+v).toFixed(2) });
  bindPair('KS', { get: () => S.knock.share, set: (v) => (S.knock.share = v), fmt: (v) => String(Math.round(v)), max: () => clamp(D ? D.N : 6, 1, 6) });
  bindPair('SA', { get: () => S.sway.amp, set: (v) => (S.sway.amp = v), fmt: (v) => (+v).toFixed(1) });
  bindPair('SQ', { get: () => S.sway.f, set: (v) => (S.sway.f = v), fmt: (v) => (+v).toFixed(1) });
  bindPair('SB', { get: () => S.sway.bounce, set: (v) => (S.sway.bounce = v), fmt: (v) => (+v).toFixed(2) });
  bindPair('QP', { get: () => S.quake.pga, set: (v) => (S.quake.pga = v), fmt: (v) => (+v).toFixed(2) });
  bindPair('QF', { get: () => S.quake.floor, set: (v) => (S.quake.floor = v), fmt: (v) => (+v).toFixed(2) });
  bindPair('QD', { get: () => S.quake.dur, set: (v) => (S.quake.dur = v), fmt: (v) => String(Math.round(v)) });
  bindPair('NP', { get: () => S.notional.pct, set: (v) => (S.notional.pct = v), fmt: (v) => (+v).toFixed(1) });
  bindPair('V', { get: () => S.outSpeed, set: (v) => (S.outSpeed = v), fmt: (v) => (+v).toFixed(1) });
  bindPair('BF', { get: () => M.beaufort(S.outSpeed), set: (n) => { S.outSpeed = M.BFT_SPEED[clamp(Math.round(n), 0, 12)]; }, fmt: (v) => String(Math.round(v)) });
  bindPair('GU', { get: () => S.gust * 100, set: (v) => (S.gust = v / 100), fmt: (v) => String(Math.round(v)) });
  bindPair('FA', { get: () => S.facing, set: (v) => (S.facing = v), fmt: (v) => String(Math.round(v)) });
  bindPair('DIR', { get: () => S.windDir, set: (v) => (S.windDir = v), fmt: (v) => String(Math.round(v)) });
  bindPair('SF', { get: () => S.SF, set: (v) => (S.SF = v), fmt: (v) => (+v).toFixed(2) });
  bindPair('CF', { get: () => S.Cf, set: (v) => (S.Cf = v), fmt: (v) => (+v).toFixed(2) });
  bindPair('DP', { get: () => S.depth, set: (v) => (S.depth = v), fmt: (v) => (+v).toFixed(3) });
  bindPair('MU', { get: () => S.mu, set: (v) => (S.mu = v), fmt: (v) => (+v).toFixed(2) });
  bindPair('STM', { get: () => S.stage.muDeck, set: (v) => (S.stage.muDeck = v), fmt: (v) => (+v).toFixed(2) });
  bindPair('EI', { get: () => S.EI / 1e6, set: (v) => (S.EI = v * 1e6), fmt: (v) => (+v).toFixed(2), toSlider: (mn) => EI_POS(mn), fromSlider: (pos) => EI_MN(pos) });
  bindPair('DL', { get: () => S.defLimit, set: (v) => (S.defLimit = v), fmt: (v) => String(Math.round(v)) });
  // stage
  bindPair('STH', { get: () => S.stage.h, set: (v) => (S.stage.h = v), fmt: (v) => (+v).toFixed(2) });
  bindPair('STD', { get: () => S.stage.depth, set: (v) => (S.stage.depth = v), fmt: (v) => (+v).toFixed(1) });
  bindPair('STF', { get: () => S.stage.front, set: (v) => (S.stage.front = v), fmt: (v) => (+v).toFixed(1), max: () => Math.max(0.5, S.stage.depth - S.depth - 0.15) });
  bindPair('STW', { get: () => S.stage.deckKgm2, set: (v) => (S.stage.deckKgm2 = v), fmt: (v) => String(Math.round(v)) });
  bindPair('STR', { get: () => S.stage.rating, set: (v) => (S.stage.rating = v), fmt: (v) => String(Math.round(v)) });
  segs.stage = bindSeg('segStage', (v) => { S.stage.on = v === 'on'; update(); });
  document.querySelectorAll('[data-sth]').forEach((b) => b.addEventListener('click', () => { S.stage.on = true; S.stage.h = +b.dataset.sth; update(); }));
  // restraint
  bindPair('RN', { get: () => (D && D.strap ? D.strap.n : (S.rest.n || Math.max(1, Math.ceil(S.W / 2)))), set: (v) => (S.rest.n = v), fmt: (v) => String(Math.round(v)), max: () => Math.max(2, D ? 2 * D.N : 28) });
  bindPair('RA', { get: () => (D && D.strap ? D.strap.a : (D ? D.geom.L : 7)), set: (v) => (S.rest.a = v), fmt: (v) => (+v).toFixed(1), max: () => Math.max(1, D ? D.geom.L : 7) });
  bindPair('RD', { get: () => (D && D.strap ? D.strap.d : 7), set: (v) => (S.rest.d = v), fmt: (v) => (+v).toFixed(1) });
  bindPair('RW', { get: () => S.rest.wll, set: (v) => (S.rest.wll = v), fmt: (v) => String(Math.round(v)) });
  bindPair('RK', { get: () => S.rest.anchorKg, set: (v) => (S.rest.anchorKg = v), fmt: (v) => String(Math.round(v)) });
  $('btnRATop').addEventListener('click', () => { S.rest.a = 0; update(); });
  $('btnRD45').addEventListener('click', () => { S.rest.d = 0; update(); });
  const WLL_DEF = { strap: 2000, cable: 1500, truss: 10000 };
  segs.rest = bindSeg('segRest', (v) => { S.rest.type = v; if (v !== 'none') { S.rest.wll = WLL_DEF[v]; } update(); });
  segs.rto = bindSeg('segRTo', (v) => { S.rest.to = v; update(); });
  segs.rside = bindSeg('segRSide', (v) => { S.rest.side = v; update(); });
  segs.prof = bindSeg('segProf', (v) => { S.profile = v; update(); });
  $('SC-r').addEventListener('input', () => { S.indoorScale = parseInt($('SC-r').value, 10); update(); });
  for (const [id, key] of [['FR-row', 'perRow'], ['FR-base', 'perBase'], ['FR-w', 'perW']]) {
    $(id).addEventListener('input', () => { const v = parseFloat($(id).value); if (isFinite(v) && v >= 0) { S.frame[key] = v; update(); } });
    $(id).addEventListener('blur', () => { $(id).value = S.frame[key]; });
  }
  segs.mode = bindSeg('segMode', (v) => { S.mode = v; update(); });
  segs.case = bindSeg('segCase', (v) => { S.indoorCase = v; update(); });
  segs.kfrom = bindSeg('segKFrom', (v) => { S.knock.from = v; update(); });
  document.querySelectorAll('[data-kg]').forEach((b) => b.addEventListener('click', () => { S.knock.kgf = +b.dataset.kg; S.knock.dur = +b.dataset.kd; update(); }));
  document.querySelectorAll('[data-sa]').forEach((b) => b.addEventListener('click', () => { S.sway.amp = +b.dataset.sa; S.sway.f = +b.dataset.sq; update(); }));
  document.querySelectorAll('[data-pga]').forEach((b) => b.addEventListener('click', () => { S.quake.pga = +b.dataset.pga; update(); }));
  document.querySelectorAll('[data-qf]').forEach((b) => b.addEventListener('click', () => { S.quake.floor = +b.dataset.qf; update(); }));
  const pickRow = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) { S.indoorCase = tr.dataset.id; update(); } };
  $('cmpRows').addEventListener('click', pickRow);
  $('cmpRows').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRow(e); } });
  segs.bal = bindSeg('segBal', (v) => { if (v === 'auto') S.ballastAuto = true; else ensureManual(); update(); });
  segs.pos = bindSeg('segPos', (v) => { S.ballastPos = v; update(); });
  segs.speed = bindSeg('segSpeed', (v) => { ui.speed = +v; segs.speed.set(v); });
  segs.cam = bindSeg('segCam', (v) => { ui.cam = v; ui.camTAz = CAM_PRESETS[v].az; ui.camTEl = CAM_PRESETS[v].el; segs.cam.set(v); });
  segs.exag = bindSeg('segExag', (v) => { ui.exag = v; segs.exag.set(v); update(); });
  $('btnAutoN').addEventListener('click', () => { S.autoN = !S.autoN; update(); });
  document.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => { S.windDir = +b.dataset.dir; update(); }));
  document.querySelectorAll('[data-scn]').forEach((b) => b.addEventListener('click', () => loadScenario(b.dataset.scn)));
  $('btnReset').addEventListener('click', () => loadScenario('sheet'));
  $('btnReplay').addEventListener('click', () => { sim.reset(); ui.paused = false; syncPause(); });
  $('btnPause').addEventListener('click', () => { ui.paused = !ui.paused; syncPause(); });
  $('btnInset').addEventListener('click', () => { ui.showInset = !ui.showInset; $('btnInset').setAttribute('aria-pressed', String(ui.showInset)); });
  $('selClear').addEventListener('click', () => { ui.selected = -1; update(); });
  const step = (kg) => (kg < 20 ? 0.5 : kg < 100 ? 2 : kg < 500 ? 10 : 50);
  $('selMinus').addEventListener('click', () => { const i = ui.selected; if (i >= 0) { setBase(i, D.ballast[i] - step(D.ballast[i])); update(); } });
  $('selPlus').addEventListener('click', () => { const i = ui.selected; if (i >= 0) { setBase(i, D.ballast[i] + step(D.ballast[i])); update(); } });
  $('selVal').addEventListener('input', () => { const v = parseFloat($('selVal').value); if (ui.selected >= 0 && isFinite(v)) { setBase(ui.selected, v); update(); } });
  $('selVal').addEventListener('blur', () => { if (ui.selected >= 0) $('selVal').value = fmtB(D.ballast[ui.selected]); });
  $('selAll').addEventListener('click', () => { if (ui.selected >= 0) { setBallastAll(D.ballast[ui.selected]); update(); } });
  document.querySelectorAll('details.tv').forEach((d) => d.addEventListener('toggle', () => { if (d.open) renderTables(); }));
}
function syncPause() {
  $('btnPause').setAttribute('aria-pressed', String(ui.paused));
  $('btnPause').querySelector('use').setAttribute('href', ui.paused ? '#i-play' : '#i-pause');
}
function syncControls() {
  const cabH = M.cabHeight(S.cabSize);
  $('H-r').step = cabH; $('H-n').step = cabH;
  for (const k in pairs) pairs[k].sync();
  $('SC-r').value = S.indoorScale; $('SC-r').style.setProperty('--p', (S.indoorScale / 10 * 100) + '%');
  segs.mode.set(S.mode); segs.bal.set(S.ballastAuto ? 'auto' : 'manual'); segs.pos.set(S.ballastPos); segs.speed.set(ui.speed);
  segs.cab.set(S.cabSize); if ($('cabModel').value !== S.cab) $('cabModel').value = S.cab;
  segs.stage.set(S.stage.on ? 'on' : 'off'); segs.rest.set(S.rest.type); segs.rto.set(S.rest.to); segs.rside.set(S.rest.side); segs.prof.set(S.profile);
  segs.cam.set(ui.cam); segs.exag.set(ui.exag);
  const indoorNow = S.mode === 'indoor', cs = indoorNow ? S.indoorCase : 'outdoor';
  $('indoorPick').hidden = !indoorNow; $('cmpSec').hidden = !indoorNow;
  $('windIndoor').hidden = !(indoorNow && cs === 'draught'); $('windOutdoor').hidden = indoorNow;
  for (const [id, key] of [['caseDoor', 'door'], ['caseKnock', 'knock'], ['caseSway', 'sway'], ['caseQuake', 'quake'], ['caseNotional', 'notional']]) $(id).hidden = !(indoorNow && cs === key);
  $('ctlDir').hidden = !(!indoorNow || cs === 'draught' || cs === 'door');
  segs.case.set(S.indoorCase); segs.kfrom.set(S.knock.from);
  setText('loadH', indoorNow ? 'What pushes on the wall' : 'Wind');
  $('stageBox').hidden = !S.stage.on;
  const hasR = S.rest.type !== 'none';
  $('restBox').hidden = !hasR; $('ctlTo').hidden = !S.stage.on; $('ctlSide').hidden = S.rest.type === 'truss';
  $('legStrap').hidden = !hasR; $('legStage').hidden = !S.stage.on;
  $('btnAutoN').setAttribute('aria-pressed', String(S.autoN));
  for (const [id, key] of [['FR-row', 'perRow'], ['FR-base', 'perBase'], ['FR-w', 'perW']]) if (document.activeElement !== $(id)) $(id).value = S.frame[key];
  $('B-r').disabled = false;
  const sel = ui.selected >= 0;
  $('selBox').hidden = !sel;
  if (sel) { $('selName').textContent = 'Base ' + (ui.selected + 1) + ' of ' + D.N; if (document.activeElement !== $('selVal')) $('selVal').value = fmtB(D.ballast[ui.selected]); }
}

function loadScenario(name) {
  const keepSpeed = ui.speed;
  const d = M.defaults();
  for (const k in d) S[k] = d[k];
  S.frame = Object.assign({}, d.frame); S.stage = Object.assign({}, d.stage); S.rest = Object.assign({}, d.rest);
  ui.selected = -1; ui.speed = keepSpeed; fillCabModels();
  if (name === 'noballast') { S.ballastAuto = false; S.ballastPer = 0; S.ballast = null; }
  if (name === 'draft') { S.indoorScale = 4; S.ballastAuto = false; S.ballastPer = 9.055; S.ballast = null; }
  if (name === 'front') { S.indoorScale = 4; S.windDir = 180; }
  const sheetBallast = () => { S.ballastAuto = false; S.ballastPer = 9.055; S.ballast = null; };
  if (name === 'door') { S.indoorCase = 'door'; S.door = { v: 5.4, dur: 1.2 }; sheetBallast(); }
  if (name === 'knock') { S.indoorCase = 'knock'; S.knock = { kgf: 60, h: 1.2, from: 'rear', dur: 0.3, share: 2 }; sheetBallast(); }
  if (name === 'wobble') {
    S.indoorCase = 'sway'; S.sway = { amp: 9, f: 2, bounce: 0.1 }; S.ballastAuto = false; S.ballastPer = 60; S.ballast = null;
    S.stage.on = true; S.stage.h = 1.2; S.stage.depth = 6; S.stage.front = 4.6;
  }
  if (name === 'quake') { S.indoorCase = 'quake'; S.quake = { pga: 0.24, floor: 1, dur: 12 }; sheetBallast(); }
  if (name === 'breeze') { S.mode = 'outdoor'; S.outSpeed = 8; S.gust = 0.3; }
  if (name === 'gale') { S.mode = 'outdoor'; S.outSpeed = 14; S.gust = 0.4; S.ballastAuto = false; S.ballastPer = 300; S.ballast = null; }
  if (name === 'stage') { S.mode = 'outdoor'; S.outSpeed = 8; S.gust = 0.3; S.stage.on = true; S.stage.h = 1.6; S.stage.depth = 6; S.stage.front = 4.6; }
  if (name === 'straps') {
    S.mode = 'outdoor'; S.outSpeed = 10; S.gust = 0.3; S.ballastAuto = false; S.ballastPer = 100; S.ballast = null;
    S.stage.on = true; S.stage.h = 1.2; S.stage.depth = 6; S.stage.front = 4.6;
    S.rest = Object.assign(S.rest, { type: 'strap', n: 0, a: 0, d: 0, to: 'floor', wll: 2000, anchorKg: 0, side: 'rear' });
  }
  sig = ''; update(); sim.reset(); ui.paused = false; syncPause();
}

/* ------------------------------------------------------------------ text */
function dirText(deg) {
  const a = deg > 180 ? deg - 360 : deg, m = Math.abs(a);
  if (m <= 8) return 'from the rear';
  if (m >= 172) return 'from the front';
  if (m >= 82 && m <= 98) return 'from the ' + (a > 0 ? 'right' : 'left') + ' side';
  return (m < 90 ? 'rear' : 'front') + '-' + (a > 0 ? 'right' : 'left');
}
function setText(id, s) { const e = $(id); if (e.textContent !== s) e.textContent = s; }
function setHint(id, s, cls) { const e = $(id); setText(id, s); e.className = 'hint' + (cls ? ' ' + cls : ''); }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const ICON = { ok: 'i-check', wn: 'i-warn', bd: 'i-x', in: 'i-info' };
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'ic'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use'); use.setAttribute('href', '#' + name); svg.appendChild(use); return svg;
}
const govText = () => (D.gov === 'S' ? 'the stage and wall tip together about the stage edge' : 'the wall tips about its toe');
const sfTxt = (v) => (v >= 10 ? '10+' : nf2(v));

function renderText() {
  const w = D.wind, g = D.geom, outdoor = S.mode === 'outdoor', avg = D.Wb / D.N, pr = preset(), sp = D.strap, stg = D.stage;
  const kindL = D.loadKind, isWind = kindL === 'wind';
  const cabLabel = S.cabSize === '500x500' ? '500 × 500 mm' : '500 × 1000 mm';
  setText('screenSub', nf0(D.A) + ' m² · ' + nf0(D.Ws) + ' kg');
  setText('cabNote', pr.note);
  setHint('W-h', D.cols + ' cabinets wide (0.5 m each)');
  setHint('H-h', D.rows + ' rows of ' + (D.cabH * 1000) + ' mm · ' + (D.cols * D.rows) + ' cabinets in all');
  setHint('K-h', nf1(cabKg()) + ' kg per ' + cabLabel + ' cabinet · the screen weighs ' + nf0(D.Ws) + ' kg');
  setHint('N-h', D.spacingOK ? 'One base every ' + nf2(D.spacing) + ' m. Sheet rule: ' + D.sheetN + ' for this width.' : 'One base every ' + nf2(D.spacing) + ' m. The sheet wants at most 1 m, so ' + D.sheetN + ' bases.', D.spacingOK ? '' : 'warn');
  setHint('B-h', S.ballastAuto ? 'Solves for ' + (sp || stg ? 'the smallest ballast that works with your ' + [stg ? 'stage' : '', sp ? 'straps' : ''].filter(Boolean).join(' and ') : 'the sheet result') + ': ' + nf2(D.req.per) + ' kg per base' + (D.req.capped ? ' (capped, not enough)' : '') + '. Move the slider to take over.' : nf1(D.Wb) + ' kg on ' + D.N + ' bases' + (D.req.none ? '. Nothing is needed here.' : '. Needed: ' + nf2(D.req.per) + ' kg per base.'));
  setText('posNote', 'arm ' + nf(g.aB, 3) + ' m from the toe');
  setText('modeHint', outdoor ? 'Open-air wind with gusts. The sheet is written for indoor use, so treat this as a rough guide.' : 'Draught from air conditioning, fans and doors. Uses the wind scale from the sheet, which is the Beaufort scale.');
  const row = M.SCALE[S.indoorScale];
  setText('SC-v', S.indoorScale + ' · ' + row.v + ' m/s');
  setHint('SC-h', row.name + ' · ' + row.q + ' N/m² of wind pressure' + (S.indoorScale >= 7 ? '. The sheet says to stay below Beaufort 7.' : ''), S.indoorScale >= 7 ? 'warn' : '');
  const bn = w.bftMean, br = M.bftRange(bn);
  setText('BF-v', M.BFT_NAME[bn]);
  const bfRange = bn >= 12 ? nf1(br.lo) + ' m/s and over (' + nf0(kmh(br.lo)) + ' km/h and over)'
    : bn === 0 ? 'up to ' + nf1(br.hi) + ' m/s'
    : nf1(br.lo) + ' to ' + nf1(br.hi) + ' m/s (' + nf0(kmh(br.lo)) + ' to ' + nf0(kmh(br.hi)) + ' km/h)';
  setHint('BF-h', 'Force ' + bn + ': ' + bfRange + '. A force sets the top of its range, as in the sheet. Type m/s for an exact speed.');
  setText('V-v', nf0(kmh(S.outSpeed)) + ' km/h');
  setHint('V-h', nf1(0.625 * S.outSpeed * S.outSpeed) + ' N/m² of wind pressure on average' + (w.bft >= 7 ? '. Peak gusts reach Beaufort ' + w.bft + ', above the sheet limit (below 7).' : ''), w.bft >= 7 ? 'warn' : '');
  setHint('GU-h', 'Peak wind ' + nf1(S.outSpeed * (1 + S.gust)) + ' m/s (Beaufort ' + M.beaufort(S.outSpeed * (1 + S.gust)) + '). The design check uses the peak.');
  setHint('PROF-h', S.profile === 'uniform' ? 'The sheet applies the same pressure over the whole screen.' : 'Wind speed grows with height as (z/10 m)^' + nf2(M.PROFILE_ALPHA[S.profile]) + ', measured at 10 m' + (stg ? ' and counted from the floor, so the stage raises the screen into stronger wind.' : '.') + ' Under 3 m it stays constant.');
  setText('FA-v', 'faces ' + compassName(S.facing) + ' (' + Math.round(S.facing) + '°)');
  const bearing = (S.facing + 180 + S.windDir) % 360;
  setText('DIR-v', dirText(S.windDir) + (outdoor ? ' · ' + compassName(bearing) + ' wind' : ''));
  setHint('DIR-h', nf0(w.cn * 100) + '% of the wind pushes on the screen. ' + (D.dir === 'rear' ? 'Rear wind tips it forward about the toe under the screen.' : 'Front wind tips it backward about the rear toe.'));
  setHint('DP-h', 'Ballast arm ' + nf(g.aB, 3) + ' m · screen arm ' + nf(g.aS, 3) + ' m. A deeper base moves the ballast further back.');
  setHint('EI-h', 'About 2.9 for two 50×50×3 aluminium posts 0.38 m apart. Lighter truss is nearer 1, heavy steel nearer 8. Shear flexing of the ladder is included.');
  setText('stageSub', S.stage.on ? nf2(S.stage.h) + ' m high' : 'off');
  if (stg) {
    setHint('STH-h', 'The ' + (isWind ? 'wind' : kindL === 'force' ? 'push' : 'shaking') + ' now acts ' + nf2(g.hs + g.hc) + ' m above the floor.');
    setHint('STD-h', 'Deck area ' + nf0(stg.area) + ' m² (' + nf0(stg.width) + ' m wide), weighs ' + nf0(stg.mass) + ' kg.');
    setHint('STF-h', stg.rearGap < 0 ? 'The base overhangs the rear edge by ' + nf2(-stg.rearGap) + ' m.' : 'The rear of the base is ' + nf2(stg.rearGap) + ' m from the rear edge.', stg.rearGap < 0 ? 'bad' : stg.rearGap < 0.2 ? 'warn' : '');
    setHint('STW-h', 'A Steeldeck 8×4 ft deck weighs 69 to 85 kg, about 25 kg/m², before legs and bracing.');
  }
  const RT = { none: 'None', strap: 'Ratchet strap', cable: 'Steel cable', truss: 'Rear truss' };
  setText('restSub', sp ? sp.n + ' × ' + RT[sp.type].toLowerCase() : 'none');
  setHint('restHint', { none: 'Straps, a cable or a rear truss from the top of the screen to an anchor behind. They also stop the wall bending.', strap: 'Webbing stretches up to 7% at its rated load (EN 12195-2), so it only pulls hard once the base has begun to lift.', cable: 'Steel cable with turnbuckles stretches about 0.4% at its rated load: stiff, it holds the top almost still.', truss: 'A rigid truss behind works in both directions: it pulls against rear wind and pushes against front wind.' }[S.rest.type]);
  if (sp) {
    setHint('RD-h', nf0(Math.atan2(sp.a + sp.zA, sp.d) * 180 / Math.PI) + '° from the horizontal, ' + nf1(sp.Ls) + ' m long.' + (stg && sp.to === 'floor' && sp.d < stg.depth - stg.front - 0.3 ? ' The anchor is under the stage deck: move it behind the stage.' : ''), stg && sp.to === 'floor' && sp.d < stg.depth - stg.front - 0.3 ? 'warn' : '');
    setText('RW-v', 'stretches ' + nf1(M.RESTRAINT[sp.type].eps * 100) + '% at that load');
    setHint('RW-h', 'Ratchet strap 50 mm: 2000 daN direct pull. ' + (sp.anchorLimited ? 'The anchor limits each ' + RT[sp.type].toLowerCase() + ' to ' + nf0(sp.anchorLimKg) + ' kg.' : 'Used as the limit for each one.'));
    setHint('RK-h', S.rest.anchorKg > 0 ? 'Each anchor block holds about ' + nf0(sp.anchorLimKg) + ' kg of pull before it lifts or drags.' : 'A fixed anchor: ground screw, rigging point or building.');
  }

  // verdict
  const status = D.status, v = $('verdict'); v.dataset.s = status;
  const ic = status === 'stable' ? 'i-check' : status === 'marginal' ? 'i-warn' : 'i-x';
  $('vIcon').querySelector('use').setAttribute('href', '#' + ic);
  setText('vLabel', status === 'stable' ? 'Stable' : status === 'marginal' ? 'Marginal' : 'Will tip over');
  setText('vSF', sfTxt(D.SFact));
  setText('vReq', nf2(S.SF) + '×');
  $('meterFill').style.width = clamp((D.SFact === Infinity ? 3 : D.SFact) / 3, 0, 1) * 100 + '%';
  $('tkTip').style.left = (1 / 3 * 100) + '%'; $('tkReq').style.left = clamp(S.SF / 3, 0, 1) * 100 + '%';
  $('tkReq').firstChild.textContent = 'needs ' + nf2(S.SF);
  $('meter').setAttribute('aria-valuenow', String(D.SFact === Infinity ? 3 : D.SFact.toFixed(2)));
  const need1 = isWind ? D.reqPerAtSpeed(w.vMean, 1) : 0, toToe = D.dir === 'rear' ? 'front' : 'rear';
  const strapHolds = sp && sp.active && sp.inCheck && D.SFact >= 10;
  let msg;
  if (!isWind) msg = indoorVerdict(status, avg);
  else if (w.cn < 0.02 || D.M.w < 1e-9) msg = 'No wind load: at this angle nothing pushes on the screen.';
  else if (status === 'stable') {
    msg = (D.req.none ? 'The weight of the screen and frame' + (stg ? ', the stage' : '') + (sp ? ' and your straps' : '') + ' alone covers the wind with the margin you asked for. ' : '') +
      'With ' + nf1(avg) + ' kg on each of ' + D.N + ' bases, what holds the screen down is ' + sfTxt(D.SFact) + '× the wind (you need ' + nf2(S.SF) + '×). ' +
      (sp && D.lean.hangs ? 'At the ' + PKW() + ' it leans ' + nf(D.lean.phi * 180 / Math.PI, 1) + '° and hangs on the ' + RT_NAME(sp.type) + 's, so add ballast to keep the base down. ' : '') +
      (strapHolds ? 'The straps hold it, so tipping is no longer the limit. Check the anchors, the frame and the cabinet connectors. ' : 'It would start to tip at about ' + nf1(D.limits.vCritMean) + ' m/s' + (outdoor && S.gust > 0 ? ' mean wind' : '') + ' (Beaufort ' + M.beaufort(D.limits.vCritMean) + '). ') +
      (stg ? 'The weaker check is that ' + govText() + '.' : '');
  } else if (status === 'marginal') {
    msg = 'It will not tip, but it holds only ' + nf2(D.SFact) + '× the wind and you need ' + nf2(S.SF) + '×. Add about ' + nf1(Math.max(0, D.req.per - avg)) + ' kg to each base, to ' + nf1(D.req.per) + ' kg.' + (stg ? ' The weaker check is that ' + govText() + '.' : '');
  } else {
    msg = 'The wind is ' + nf2(1 / D.SFact) + '× what holds it down, so ' + govText() + '. It needs at least ' + nf1(need1) + ' kg per base to stay up, and ' + nf1(D.req.per) + ' kg for your ' + nf2(S.SF) + '× margin.' +
      (D.gov === 'S' ? ' A lower stage, a heavier deck, moving the screen back from the front edge, or straps to the floor all help.' : sp ? ' The straps run out of rating or anchor before the wind does.' : stg ? ' A strap to the floor would help too.' : '');
  }
  if (D.req.capped) msg += ' The required ballast is beyond what the solver allows (' + nf0(M.MAX_BALLAST) + ' kg per base). Use more bases, a deeper base, straps or less wind.';
  setText('vText', msg);

  $('tNeedPer').firstChild.textContent = D.req.none ? '0' : nf(D.req.per); setText('tNeedTot', D.req.none ? 'none needed' + (!sp && !stg ? ' (sheet: ' + nf1(D.req.totalRaw) + ' kg)' : '') : nf1(D.req.total) + ' kg in total');
  $('tYourPer').firstChild.textContent = nf(avg); setText('tYourTot', nf1(D.Wb) + ' kg in total');
  const lv = limitView();
  setText('limH', isWind ? 'Ballast and wind limits' : 'Ballast and load limits');
  setText('tAllowK', lv.kAllow); setText('tTipK', lv.kTip);
  $('tAllow').firstChild.textContent = lv.infin ? '∞' : lv.allow; $('tAllow').querySelector('small').textContent = lv.infin ? '' : lv.unit;
  setText('tAllowS', lv.infin ? lv.none : lv.allowS);
  $('tTip').firstChild.textContent = lv.infin ? '∞' : lv.crit; $('tTip').querySelector('small').textContent = lv.infin ? '' : lv.unit;
  setText('tTipS', lv.infin ? lv.none : lv.critS);

  renderBend(); renderMoments(); renderChecks(); renderSheet(); renderTables(); renderIndoor();
  setText('planInfo', isWind ? nf0(w.cn * 100) + '% pushes the screen · ' + nf0(Math.abs(w.sinT) * 100) + '% slides along it'
    : kindL === 'force' ? (S.knock.from === 'both' ? 'the push is checked from the front and from the rear' : 'push from the ' + S.knock.from)
    : 'the floor moves front to back; the wall tips whichever way is weaker');
  setText('planCap', isWind ? 'Wind direction' : kindL === 'force' ? 'Push direction' : 'Shaking direction');
  setText('planSub', isWind ? 'drag the arrow' : '');
  const axx = axisOf(st);
  setText('mapSub', axx.sub); setText('mapTh1', axx.th1); setText('mapTh2', axx.th2);
  setText('rearSub', S.ballastAuto ? 'seen from behind · click a base' : 'seen from behind · click a base, or drag a bar');
  const exagNow = bendExag(D, ui.exag);
  setText('frontSub', ui.exag === 'true' ? 'true scale: real proportions' : 'bending drawn ×' + nf0(exagNow) + ' so you can see it');
  $('frontLegend').textContent = '';
  const lg = (txtv, col) => { const s2 = el('span'); const i = el('i'); i.style.background = col; s2.appendChild(i); s2.append(txtv); $('frontLegend').appendChild(s2); };
  lg('LED face', 'var(--c-screen)'); if (stg) lg('Stage', '#8a97a8'); if (sp) lg(RT[sp.type], '#ffb020'); lg(isWind ? 'Wind' : kindL === 'force' ? 'Push' : 'Shaking', '#d6409f');
  setText('legForce', isWind ? 'Wind force' : kindL === 'force' ? 'Push' : 'Inertia force');
}

/* ------------------------------------------------------------------ indoor loads: wording, limits, comparison */
const PKW = () => (D.loadKind === 'wind' ? 'peak wind' : 'peak load');
const swayG = () => Math.pow(2 * Math.PI * S.sway.f, 2) * S.sway.amp / 1000 / M.G;               // peak acceleration of the deck, in g
const floorAmp = () => (S.mode === 'indoor' && S.indoorCase === 'quake' ? S.quake.floor : 1);
const SIDE_TXT = () => (D.dir === 'rear' ? 'forward, about the front toe under the screen' : 'backward, about the rear toe');
const zonesHeld = (allowG) => { const held = M.QUAKE_ZONES.filter((z) => allowG >= z.g - 1e-9); return held.length ? 'holds Greek zone ' + held[held.length - 1].zone : 'is below zone I'; };
function loadSummary(id) {
  switch (id) {
    case 'draught': return 'Beaufort ' + S.indoorScale + ' · ' + M.SCALE[S.indoorScale].v + ' m/s';
    case 'door': return nf1(S.door.v) + ' m/s for ' + nf1(S.door.dur) + ' s';
    case 'knock': return nf0(S.knock.kgf) + ' kgf at ' + nf1(S.knock.h) + ' m, shared by ' + S.knock.share;
    case 'sway': return nf1(S.sway.amp) + ' mm at ' + nf1(S.sway.f) + ' Hz · ' + nf3(swayG()) + ' g';
    case 'quake': return nf2(S.quake.pga) + ' g' + (S.quake.floor > 1.001 ? ', upper floor ×' + nf2(S.quake.floor) : ', ground floor');
    default: return nf1(S.notional.pct) + '% of the weight, sideways';
  }
}
function limitView() {
  const L = D.limits, sp = D.strap;
  const strapLim = !!(sp && sp.active && sp.inCheck && D.eq.capped);
  const kAllow = strapLim ? 'Within the strap rating up to' : 'Holds, with margin, up to';
  const kTip = strapLim ? 'Straps reach their rating at' : (D.gov === 'S' ? 'Stage and wall tip at' : 'Tips over at');
  if (L.kind === 'speed') {
    const gustMean = S.mode === 'outdoor' && S.gust > 0, bft = (v) => 'Beaufort ' + M.beaufort(v) + ' · ' + nf0(kmh(v)) + ' km/h' + (gustMean ? ' mean' : '');
    return { infin: !isFinite(L.vAllowMean), kAllow, kTip, unit: 'm/s', allow: nf1(L.vAllowMean), crit: nf1(L.vCritMean), allowS: bft(L.vAllowMean), critS: bft(L.vCritMean), none: 'no wind load',
      critFull: nf1(L.vCritMean) + ' m/s' + (gustMean ? ' mean wind' : '') + ' (Beaufort ' + M.beaufort(L.vCritMean) + ')' };
  }
  if (L.kind === 'force') {
    const at = 'at ' + nf1(S.knock.h) + ' m up';
    return { infin: !isFinite(L.allow), kAllow: 'Holds, with margin, a push of', kTip, unit: 'kgf', allow: nf0(L.allow), crit: nf0(L.crit), allowS: at, critS: at, none: 'no push',
      critFull: nf0(L.crit) + ' kgf ' + at };
  }
  const fa = floorAmp(), pct = S.indoorCase === 'notional';
  const val = (x) => (pct ? nf1(x * 100) : nf(x / fa, x / fa < 0.1 ? 3 : 2)), unit = pct ? '%' : 'g';
  let allowS = pct ? 'of the weight, sideways' : fa > 1.001 ? 'at the ground, ' + nf2(fa) + '× on this floor' : 'at the ground';
  let critS = allowS;
  if (S.indoorCase === 'sway') {
    const mm = (g) => nf1(g * M.G / Math.pow(2 * Math.PI * S.sway.f, 2) * 1000);
    allowS = 'deck moves ' + mm(L.allow) + ' mm at ' + nf1(S.sway.f) + ' Hz'; critS = 'deck moves ' + mm(L.crit) + ' mm at ' + nf1(S.sway.f) + ' Hz';
  } else if (S.indoorCase === 'quake') allowS += ' · ' + zonesHeld(L.allow / fa);
  return { infin: !isFinite(L.allow), kAllow, kTip, unit, allow: val(L.allow), crit: val(L.crit), allowS, critS, none: 'no shaking',
    critFull: val(L.crit) + (pct ? '% of the weight' : ' g' + (fa > 1.001 ? ' at the ground' : '')) };
}
function dynNote(cs) {
  return { door: 'The animation shows what a gust of this length really does: a short one can lift the wall and leave it standing.',
    knock: 'The safety factor treats the push as steady. A short push can lift the wall and leave it standing, as the animation shows.',
    sway: 'The safety factor holds the worst moment of the shake steady. The animation shows the wall rocking and whether it keeps going.',
    quake: 'The safety factor is the usual force-coefficient check. The animation uses one earthquake-like record, so it shows what could happen, not what will.' }[cs] || '';
}
function indoorVerdict(status, avg) {
  const cs = D.loadCase, sp = D.strap, stg = D.stage, lv = limitView();
  const noun = { door: 'the gust', knock: 'the push', sway: 'the sway', quake: 'the earthquake', notional: 'the code load' }[cs] || 'the load';
  const where = D.both ? ' The weaker way is to tip ' + SIDE_TXT() + '.' : '';
  const stgTxt = stg && D.gov === 'S' ? ' With the stage, ' + govText() + '.' : '';
  const tipsWhere = D.gov === 'S' ? govText() : D.both ? 'it tips ' + SIDE_TXT() : govText();
  let msg;
  if (D.F.N < 1e-6) return 'Nothing pushes on the wall: the load is zero.';
  if (status === 'stable') {
    msg = (D.req.none ? 'The weight of the screen and frame' + (stg ? ', the stage' : '') + (sp ? ' and your straps' : '') + ' alone covers ' + noun + ' with the margin you asked for. ' : '') +
      'With ' + nf1(avg) + ' kg on each of ' + D.N + ' bases, the wall holds ' + sfTxt(D.SFact) + '× ' + noun + ' (you need ' + nf2(S.SF) + '×). It would start to tip at ' + lv.critFull + '.' + where + stgTxt;
  } else if (status === 'marginal') {
    msg = 'It will not tip, but it holds only ' + nf2(D.SFact) + '× ' + noun + ' and you need ' + nf2(S.SF) + '×.' + (D.req.capped ? '' : ' Add about ' + nf1(Math.max(0, D.req.per - avg)) + ' kg to each base, to ' + nf1(D.req.per) + ' kg.') + where + stgTxt;
  } else {
    msg = 'The wall tips: ' + noun + ' is ' + nf2(1 / D.SFact) + '× what holds it down, so ' + tipsWhere + '.' + (D.req.capped ? '' : ' It needs ' + nf1(D.req.per) + ' kg per base for your ' + nf2(S.SF) + '× margin.');
  }
  if (status !== 'stable' || cs === 'quake') msg += ' ' + dynNote(cs);
  if (D.req.capped) msg += ' No amount of ballast fixes it in this layout (the solver stops at ' + nf0(M.MAX_BALLAST) + ' kg per base). Try the middle position, more bases, a deeper base, straps or a rear truss.';
  return msg;
}
function renderIndoor() {
  if (S.mode !== 'indoor') return;
  const cs = S.indoorCase, wallW = D.Ws + D.Wf + D.Wb;
  setHint('caseHint', {
    draught: 'The sheet’s wind scale. Air in a hall hardly moves, so it really stands in for small sideways loads: at Beaufort ' + S.indoorScale + ' it pushes with ' + (cs === 'draught' ? nf1(100 * D.F.kgf / wallW) : '–') + '% of the wall’s weight. Building rules ask for about 2.5%.',
    door: 'Air rushes in when a door opens, for a moment. It pushes on the whole screen like wind, so a gust that would tip a steady wall may only make it lift.',
    knock: 'Someone leans on the wall, bumps it, or a trolley hits it. The push is at one height and the bases next to it help carry it.',
    sway: 'The deck wobbles under dancers or a crowd. The wall moves with it, so every part is pushed by its own inertia, and the wall can tip either way.',
    quake: 'The ground shakes. Greece designs for 0.16 g (zone I), 0.24 g (II) and 0.36 g (III), and upper floors shake harder. A tall wall on a shallow base is very sensitive.',
    notional: 'The sideways load temporary-works rules ask for when nothing else is known: 2.5% of the weight, for out-of-plumb and rough handling.'
  }[cs]);
  if (cs === 'door') {
    setText('DG-v', 'Beaufort ' + M.beaufort(S.door.v) + ' · ' + nf0(kmh(S.door.v)) + ' km/h');
    setHint('DG-h', nf0(0.625 * S.door.v * S.door.v) + ' N/m² on the screen, ' + nf1(Math.pow(S.door.v / 3.3, 2)) + '× the sheet’s draught at Beaufort 2 (3.3 m/s). Air measured in doorways is mostly 0.5 to 2.5 m/s, more with a wind outside.');
    setHint('DD-h', 'The safety factor assumes the gust never ends. For ' + nf1(S.door.dur) + ' s the wall may only rock: watch the animation.');
  }
  if (cs === 'knock') {
    setText('KG-v', nf0(S.knock.kgf * M.G) + ' N');
    setHint('KG-h', 'A standing worker pushes with up to about 23 kgf using the whole body, and up to about 70 kgf braced against something (CCOHS).');
    setHint('KS-h', 'The push is carried by ' + S.knock.share + ' of ' + D.N + ' bases, about ' + nf1(S.knock.share * D.spacing) + ' m of wall, and the rest of the wall helps in proportion.');
  }
  if (cs === 'sway') {
    setText('SA-v', nf(swayG(), 3) + ' g peak');
    setHint('SA-h', 'The deck moves ' + nf1(S.sway.amp) + ' mm each way at ' + nf1(S.sway.f) + ' Hz, so the wall feels ' + nf(swayG(), 3) + ' g. This wall tips at ' + (isFinite(D.limits.crit) ? nf(D.limits.crit, 3) : '∞') + ' g.' +
      (S.sway.bounce > 0 ? ' Up and down shaking of ' + nf2(S.sway.bounce) + ' g makes it lighter at the peaks.' : ''));
  }
  if (cs === 'quake') {
    const fa = S.quake.floor;
    setText('QP-v', nf2(S.quake.pga) + ' g');
    setText('QF-v', fa < 1.02 ? 'ground floor' : '×' + nf2(fa));
    setHint('QP-h', 'Greek zones: I 0.16 g, II 0.24 g, III 0.36 g. With your margin this wall ' + zonesHeld(D.limits.allow / fa) + '; it tips at ' + (isFinite(D.limits.crit) ? nf(D.limits.crit / fa, 3) : '∞') + ' g at the ground.' + (fa > 1.02 ? ' An upper floor shakes ' + nf2(fa) + '× harder (EN 1998-1, rigid element up to 2.5×).' : ''));
  }
  if (cs === 'notional') setHint('NP-h', nf0(D.F.kgf) + ' kgf sideways on this wall. The sheet’s draught at Beaufort 2 is about 2% of its weight, close to this rule.');

  // every case side by side, on the ballast now on the bases
  const rows = M.compareCases(S, D), host = $('cmpRows'); host.textContent = '';
  let most = rows[0]; for (const r of rows) if (!r.capped && r.req > most.req || (r.capped && !most.capped)) most = r;
  for (const r of rows) {
    const tr = el('tr'); tr.dataset.id = r.id; tr.tabIndex = 0; tr.setAttribute('aria-selected', String(r.id === cs));
    const td0 = el('td'); td0.appendChild(document.createTextNode(r.name)); td0.appendChild(el('small', null, loadSummary(r.id)));
    const sf = el('td', 'sf', r.SF === Infinity ? '∞' : sfTxt(r.SF) + '×'); sf.dataset.s = r.status;
    const nd = el('td', null, r.none ? '0' : r.capped ? '> ' + nf0(M.MAX_BALLAST) : nf(r.req, 1));
    if (r === most && !r.none) nd.appendChild(el('span', 'gov', 'most'));
    tr.appendChild(td0); tr.appendChild(sf); tr.appendChild(nd); host.appendChild(tr);
  }
  setText('cmpHint', 'Click a row to play that load. “Needs” is the ballast per base for ' + nf2(S.SF) + '× on its own, with the ballast where it works best. The ' + (most.none ? 'weight alone covers every case.' : most.name.toLowerCase() + ' asks for the most.'));
}

function renderBend() {
  const b = D.bend, sp = D.strap, L = b.L, topAbs = Math.abs(b.topEl);
  const topMm = topAbs * 1000, ratio = topAbs > 1e-9 ? L / topAbs : Infinity;
  const level = ratio >= S.defLimit ? 'ok' : ratio >= S.defLimit / 2 ? 'wn' : 'bd';
  $('bTop').firstChild.textContent = nf(topMm, topMm < 10 ? 1 : 0);
  setText('bTopS', (isFinite(ratio) ? 'H/' + nf0(ratio) + ' · ' : '') + (level === 'ok' ? 'comfortable' : level === 'wn' ? 'noticeable' : 'too much') + ' (limit H/' + nf0(S.defLimit) + ')' + (b.lift > 0.5 ? ' · plus ' + nf(b.rigidTop * 1000, 0) + ' mm from the base lifting' : ''));
  const seamMm = b.seamOpen * 1000;
  $('bSeam').firstChild.textContent = nf(Math.abs(seamMm), Math.abs(seamMm) < 1 ? 3 : 2);
  setText('bSeamS', D.dir === 'front' ? 'on the LED face: gaps show light (makers quote 0.1 to 0.3 mm flatness)' : 'on the back; the LED face closes up');
  $('bStrapTile').hidden = !sp;
  if (sp) {
    const T = sp.T;
    $('bStrap').firstChild.textContent = nf(T / 1000, T < 10000 ? 2 : 1);
    setText('bStrapS', sp.active ? nf0(sp.util * 100) + '% of ' + nf0(sp.TcapKg) + ' kg' + (sp.anchorLimited ? ' (anchor limit)' : ' rating') + ' · ' + sp.n + ' across' : 'wrong side for this wind: slack');
  }
  $('bLift').firstChild.textContent = nf(b.lift, b.lift < 10 ? 1 : 0);
  setText('bLiftS', b.phi > 1e-6 ? 'tilted ' + nf(b.phi * 180 / Math.PI, 2) + '° at the ' + PKW() + '' : 'sits flat at the ' + PKW() + '');
  $('bendStrapKey').hidden = !(sp && sp.active);
  setText('bendNote', 'The top moves most, but the bending moment is greatest at the base, which is where seams open. ' + (sp ? 'The ' + RT_NAME(sp.type) + ' takes ' + nf0(Math.min(100, (sp.Ph / Math.max(D.F.N, 1)) * 100)) + '% of the wind force and cuts both.' : 'A strap near the top would cut both.'));
}
function RT_NAME(t) { return { strap: 'strap', cable: 'cable', truss: 'truss' }[t]; }

function renderMoments() {
  const lw = D.loadKind === 'wind' ? 'wind' : D.loadKind === 'force' ? 'push' : 'shaking', LW = lw.charAt(0).toUpperCase() + lw.slice(1);
  setText('momK', LW + ' × safety factor');
  const mx = Math.max(D.M.wSF, D.M.rest, 1e-9) * 1.02;
  const seg = (host, parts, total) => {
    host.textContent = ''; host.style.width = clamp(total / mx, 0, 1) * 100 + '%';
    for (const p of parts) if (p.v > 1e-9) { const i = el('i'); i.style.flex = p.v + ' 1 0'; i.style.background = p.c; i.title = p.t + ' ' + nf1(p.v) + ' kg·m'; host.appendChild(i); }
  };
  seg($('momWind'), [{ v: D.M.w, c: 'var(--ink2)', t: LW }, { v: D.M.wSF - D.M.w, c: 'var(--ink3)', t: 'Safety margin' }], D.M.wSF);
  seg($('momRest'), [{ v: D.M.s, c: 'var(--c-screen)', t: 'Screen' }, { v: D.M.b, c: 'var(--c-ballast)', t: 'Ballast' }, { v: D.M.f, c: 'var(--c-frame)', t: 'Frame' }, { v: D.M.stage, c: '#8a97a8', t: 'Stage' }, { v: D.M.strap, c: '#ffb020', t: 'Straps' }], D.M.rest);
  setText('mWind', nf1(D.M.wSF)); setText('mRest', nf1(D.M.rest));
  setText('kScreen', nf1(D.M.s)); setText('kBallast', nf1(D.M.b)); setText('kFrame', nf1(D.M.f)); setText('kStage', nf1(D.M.stage)); setText('kStrap', nf1(D.M.strap));
  $('kStageWrap').hidden = !D.stage; $('kStrapWrap').hidden = !D.strap;
  const eq = $('eq'); eq.textContent = '';
  const ln = (a) => { eq.appendChild(el('div', null, a)); };
  ln(lw + ' ' + nf1(D.M.w) + ' × ' + nf2(S.SF) + ' = ' + nf1(D.M.wSF) + (D.gov === 'S' ? '  (about the stage edge)' : ''));
  ln('screen ' + nf1(D.M.s) + ' + ballast ' + nf1(D.M.b) + ' + frame ' + nf1(D.M.f) + (D.stage && D.gov === 'S' ? ' + stage ' + nf1(D.M.stage) : '') + (D.strap ? ' + straps ' + nf1(D.M.strap) : '') + ' = ' + nf1(D.M.rest));
}

function renderChecks() {
  const ul = $('checks'); ul.textContent = '';
  const w = D.wind, sp = D.strap, stg = D.stage, b = D.bend;
  const K = D.loadKind, isWindK = K === 'wind', lwd = isWindK ? 'wind' : K === 'force' ? 'push' : 'shaking';
  const add = (cls, html, small) => {
    const li = el('li', cls); li.appendChild(icon(ICON[cls])); const d = el('div'); const bb = el('span'); bb.textContent = html; d.appendChild(bb);
    if (small) { d.appendChild(document.createElement('br')); d.appendChild(el('small', null, small)); } li.appendChild(d); ul.appendChild(li);
  };
  if (D.loadCase === 'draught' || D.loadCase === 'outdoor') add(w.bft < 7 ? 'ok' : 'wn', w.bft < 7 ? 'Beaufort ' + w.bft + '. Within the sheet limit (below 7).' : 'Beaufort ' + w.bft + ' is above the sheet limit (below 7). Treat the result as a rough guide only.', 'Statement 1');
  const rows = []; for (let r = 2; r <= D.rows; r += 2) rows.push(r); if (D.rows % 2 === 1) rows.push(D.rows);
  add('in', 'Tie each back frame to the screen at rows ' + rows.join(', ') + ' (every 2nd row, topmost included).', 'Statement 2 · the cyan connectors in the drawing' + (D.cabH === 0.5 ? ' · with 500 mm cabinets that is every 1 m' : ''));
  add(D.spacingOK ? 'ok' : 'wn', D.spacingOK ? 'Bases are ' + nf2(D.spacing) + ' m apart (at most 1 m, first and last column included).' : 'Bases are ' + nf2(D.spacing) + ' m apart. The sheet asks for a connection at least every 1 m, which means ' + D.sheetN + ' bases.', 'Statement 3');
  if (isWindK) add('in', D.dir === 'rear' ? 'Rear wind is the critical case. Keep the ballast at the rear end of each base, ' + nf(D.geom.aB, 3) + ' m behind the toe.' : 'Front wind: the screen’s own weight works with you (arm ' + nf(D.geom.aS, 3) + ' m). The sheet puts the ballast mid-base for this direction.', 'Statement 5');
  else {
    if (D.both) {
      const f = D.sides.fwd.SFact, bk = D.sides.back.SFact, lvl = (v) => (v >= S.SF - 1e-9 ? 'ok' : v >= 1 - 1e-9 ? 'wn' : 'bd');
      add(lvl(Math.min(f, bk)), 'Tipping forward holds ' + sfTxt(f) + '×, tipping backward holds ' + sfTxt(bk) + '×. The ' + (f <= bk ? 'forward' : 'backward') + ' way is weaker' + (f <= bk ? ': the screen’s weight sits at the front toe, so it adds nothing there.' : '.'), 'Both ways are checked, because the floor or the push can come from either side');
      add('in', 'The ballast sits ' + (D.posUsed === 'mid' ? 'in the middle of each base, which works both ways.' : 'at the rear end of each base, the best place against a forward tip.'), 'Position “Auto” tries both and keeps the better one');
    } else add('in', D.dir === 'rear' ? 'A push from behind tips the wall forward about the front toe, under the screen.' : 'A push from the front tips the wall backward about the rear toe, so the screen’s weight works with you.', 'Ballast sits at the rear end for a rear push and mid-base for a front push, as in the sheet');
    if (D.loadCase === 'quake') for (const z of M.QUAKE_ZONES) {
      const ok = D.limits.allow / floorAmp() >= z.g - 1e-9;
      add(ok ? 'ok' : 'bd', 'Greek zone ' + z.zone + ' (' + z.g + ' g): ' + (ok ? 'holds, with your margin.' : 'does not hold.'), 'Greek National Annex to Eurocode 8' + (floorAmp() > 1.02 ? ' · upper floor ×' + nf2(floorAmp()) : ''));
    }
    if (D.strap && (D.loadCase === 'knock' || D.loadCase === 'sway' || D.loadCase === 'quake')) add('wn', 'A sudden load can double the pull on a strap or cable. The static figures here do not show that.', 'Keep the strap rating well above the pull shown');
  }
  if (D.req.none && !sp && !stg) add('ok', 'Required ballast is negative (' + nf1(D.req.totalRaw) + ' kg), so no extra ballast is needed.', 'Statement 6');

  if (stg) {
    const lw = D.lam.lamW, ls = D.lam.lamS;
    add(Math.min(lw, ls) >= S.SF ? 'ok' : Math.min(lw, ls) >= 1 ? 'wn' : 'bd', 'Two ways to fail: the wall tipping on the deck holds ' + sfTxt(lw) + '×, the stage and wall tipping together hold ' + sfTxt(ls) + '×. ' + (D.gov === 'S' ? 'The stage governs.' : 'The wall governs.'), 'The ' + lwd + ' acts ' + nf2(D.geom.hs + D.geom.hc) + ' m above the floor with the stage');
    add(stg.rearGap < 0 ? 'bd' : stg.rearGap < 0.2 ? 'wn' : 'ok', stg.rearGap < 0 ? 'The base overhangs the rear edge of the stage by ' + nf2(-stg.rearGap) + ' m.' : 'The rear of the base is ' + nf2(stg.rearGap) + ' m inside the stage edge.', 'Screen ' + nf2(stg.front) + ' m from the front edge');
    const dk = D.deck, ut = dk.local / dk.rating;
    add(ut < 0.8 ? 'ok' : ut <= 1 ? 'wn' : 'bd', 'Deck load under each base: about ' + nf0(dk.local) + ' kg/m² against ' + nf0(dk.rating) + ' kg/m² rated (' + nf0(ut * 100) + '%).' + (ut > 1 ? ' Spread the ballast with plywood or a beam, or use a stronger deck.' : ''), 'Base plate footprint about 1.1 × 0.45 m');
    const ss = D.slideStage;
    add(ss.SF >= S.SF ? 'ok' : ss.SF >= 1 ? 'wn' : 'bd', 'Stage sliding on the floor: ' + lwd + ' ' + nf0(ss.F) + ' N, friction (µ ' + nf2(ss.mu) + ') holds ' + nf0(ss.cap) + ' N, ' + sfTxt(ss.SF) + '×.' + (ss.SF < S.SF ? ' Strap or anchor the stage to the floor.' : ''), 'Extra check, not in the sheet');
  }
  const sl = D.slide;
  add(sl.SF >= S.SF ? 'ok' : sl.SF >= 1 ? 'wn' : 'bd', sl.F < 1e-6 ? 'Sliding: no sideways force.' : 'Wall sliding' + (stg ? ' on the deck' : '') + ': the ' + lwd + (isWindK ? ' pushes ' : ' force is ') + nf0(sl.F) + ' N, friction (µ ' + nf2(sl.mu) + ') holds ' + nf0(sl.cap) + ' N, ' + sfTxt(sl.SF) + '×.' + (sl.SF < S.SF ? ' The sheet assumes friction is big enough, but it is not here.' : ''), 'Extra check, not in the sheet');

  if (sp) {
    const util = sp.util;
    if (!sp.active) add('wn', 'The ' + RT_NAME(sp.type) + 's are on the ' + sp.cfgSide + ' side, but the ' + (isWindK ? 'wind' : 'load') + ' comes from the ' + D.dir + ', so they hang slack and do nothing.', 'Set "Pulls against wind from" or use a rear truss');
    else {
      add(util < 0.6 ? 'ok' : util < 1 ? 'wn' : 'bd', sp.n + ' × ' + RT_NAME(sp.type) + ': pull ' + nf(sp.T / 1000, 2) + ' kN each at the ' + PKW() + ', ' + nf0(util * 100) + '% of what each can take (' + nf0(sp.TcapKg) + ' kg' + (sp.anchorLimited ? ', limited by the anchor' : '') + ').', 'Rated load counts as the limit; breaking load is several times higher');
      const ln = D.lean;
      if (ln.hangs) add('bd', 'At the ' + PKW() + ' the wall leans ' + nf(ln.phi * 180 / Math.PI, 1) + '° and the base lifts ' + nf(ln.liftMm, 0) + ' mm. Past its tipping point only the ' + RT_NAME(sp.type) + 's are holding it up.', 'Add ballast so the base stays down');
      else if (ln.liftMm > 25) add('wn', 'The base lifts ' + nf(ln.liftMm, 0) + ' mm at the rear at the ' + PKW() + ' before the ' + RT_NAME(sp.type) + ' takes over.', sp.type === 'strap' ? 'Webbing stretches; a steel cable or a truss catches it with almost no movement' : 'More ballast keeps the base down');
      else if (ln.liftMm > 0.5) add('in', 'The base lifts ' + nf(ln.liftMm, 1) + ' mm at the rear at the ' + PKW() + ' before the ' + RT_NAME(sp.type) + ' takes over.', sp.type === 'strap' ? 'Webbing stretches; a steel cable or a truss catches it with almost no movement' : '');
      if (S.rest.anchorKg > 0 && sp.anchorLimited) add('wn', 'The anchor blocks limit each ' + RT_NAME(sp.type) + ' to ' + nf0(sp.anchorLimKg) + ' kg, well under its rating of ' + nf0(S.rest.wll) + ' kg.', 'Heavier blocks or a fixed anchor raise it');
    }
    if (D.SFact >= 10) add('in', 'The straps take so much of the load that tipping stops being the limit. The frame, the cabinet connectors, the anchors and the floor are not checked here.', 'Ask the maker for the frame’s rated moment');
  }
  const topAbs = Math.abs(b.topEl), ratio = topAbs > 1e-9 ? b.L / topAbs : Infinity;
  add(ratio >= S.defLimit ? 'ok' : ratio >= S.defLimit / 2 ? 'wn' : 'bd', 'Bending: the top moves ' + nf(topAbs * 1000, topAbs * 1000 < 10 ? 1 : 0) + ' mm, H/' + (isFinite(ratio) ? nf0(ratio) : '∞') + ' (comfortable above H/' + nf0(S.defLimit) + ').', 'Illustrative stiffness: ' + nf(S.EI / 1e6, 1) + ' MN·m² per base');
  if (D.profileAlpha) add('in', 'Wind gradient on: the load centre is ' + nf2(D.geom.hc) + ' m up instead of ' + nf2(D.geom.hW) + ' m, and the pressure at the top is higher than at the bottom.', 'Not in the sheet');
  if (D.req.per > 100) add('wn', 'It needs ' + nf0(D.req.per) + ' kg on every base. That is a lot for a base plate. More bases, a deeper base, straps or anchoring would help.');
  const lo = Math.min(...D.local), lowI = D.local.indexOf(lo);
  if (lo < S.SF - 1e-9 && D.status === 'stable') add('wn', 'Uneven ballast: base ' + (lowI + 1) + ' only holds ' + nf2(lo) + '× its share of the wind. The screen has to carry load between bases.');
  add('in', 'A rough reference only. It cannot replace a structural simulation or a practical test.', 'Statement 4');
}

function renderSheet() {
  $('sheetBox').hidden = D.loadKind !== 'wind';                    // the sheet only knows wind
  const t = $('sheetTable'); t.textContent = '';
  const eff = D.wind.qPeak * D.wind.cn * S.Cf;
  const R = [
    ['h', 'Inputs'], ['Width of screen (m)', nf(S.W, 1), 'A4'], ['Height of screen (m)', nf(S.H, 1), 'B4'], ['Weight of cabinet (kg/m²)', nf(S.kgm2, 1), 'C4'],
    ['Safety factor', nf2(S.SF), 'D4'], ['Wind scale (Beaufort)', S.mode === 'indoor' ? String(S.indoorScale) : 'outdoor', 'E4'], ['Wind direction', D.dir, 'F4'],
    ['h', 'Derived'], ['Columns of cabinets', nf0(D.cols), 'A7'], ['Rows of cabinets', nf0(D.rows), 'B7'], ['Wind pressure (N/m²)', nf(eff, 3), 'E7'], ['L, cabinet to ballast (m)', nf(D.geom.aB, 3), 'F7'],
    ['h', 'Weights (kg)'], ['Screen', nf(D.Ws, 1), 'B10'], ['Frame', nf(D.Wf, 1), 'C10'], ['Ballast needed', nf(D.req.totalRaw, 3), 'D10'], ['Wind force (kgf)', nf(D.F.kgf, 2), 'E10'],
    ['h', 'Arms of force (m)'], ['Screen', nf(D.geom.aS, 3), 'B11'], ['Frame', nf(D.geom.aF, 3), 'C11'], ['Ballast', nf(D.geom.aB, 3), 'D11'], ['Wind', nf(D.geom.hc, 2), 'E11'],
    ['h', 'Result'], ['S, total size (m²)', nf(D.A, 1), 'A14'], ['Columns of back frame', nf0(D.N), 'B14'], ['Total weight of ballast (kg)', nf(D.req.totalRaw, 3), 'C14'], ['Ballast per column (kg)', nf(D.req.perRaw, 4), 'D14']
  ];
  for (const r of R) {
    const tr = el('tr');
    if (r[0] === 'h') { tr.className = 'h'; const th = el('th', null, r[1]); th.colSpan = 3; tr.appendChild(th); }
    else { tr.appendChild(el('th', null, r[0])); tr.appendChild(el('td', null, r[1])); tr.appendChild(el('td', 'c', r[2])); }
    t.appendChild(tr);
  }
}

function renderTables() {
  const rb = $('baseRows');
  rb.textContent = '';
  for (let i = 0; i < D.N; i++) {
    const tr = el('tr'), sf = D.local[i];
    tr.appendChild(el('td', null, '#' + (i + 1))); tr.appendChild(el('td', null, nf(D.ballast[i], D.ballast[i] < 10 ? 2 : 1)));
    tr.appendChild(el('td', null, sf === Infinity ? '∞' : nf2(Math.min(sf, 99))));
    tr.appendChild(el('td', null, sf >= S.SF - 1e-9 ? 'meets SF' : sf >= 1 - 1e-9 ? 'below SF' : 'would lift'));
    if (i === ui.selected) tr.style.background = 'var(--accent-wash)';
    rb.appendChild(tr);
  }
  const det = $('mapRows').closest('details');
  const mr = $('mapRows'); mr.textContent = '';
  if (det && !det.open) return;                                  // the map table needs a solve per row: only when it is on screen
  const ax = axisOf(st), windA = ax.kind === 'wind';
  setText('mapTh1', ax.th1); setText('mapTh2', ax.th2);
  const xs = windA ? (S.mode === 'indoor' ? M.SCALE.slice(0, 9).map((r) => r.v) : [2, 4, 6, 8, 10, 12, 15, 18, 21, 25, 30]) : [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((k) => k * ax.x0);
  const dec = ax.kind === 'force' ? 0 : ax.x0 < 1 ? 3 : 1;
  for (const v of xs) {
    const tr = el('tr'); tr.appendChild(el('td', null, windA ? nf1(v) : nf(v, dec))); tr.appendChild(el('td', null, windA ? String(M.beaufort(v)) : nf2(v / ax.x0) + '×'));
    tr.appendChild(el('td', null, nf(reqAtAxis(D, ax, v, S.SF), 1))); tr.appendChild(el('td', null, nf(reqAtAxis(D, ax, v, 1), 1)));
    mr.appendChild(tr);
  }
}

/* ------------------------------------------------------------------ live HUD */
let hudKey = '';
function hudCells() {                          // the two live readouts at the top of the side view, for the load in play
  const L = sim.lam, kind = D.loadKind, cs = D.loadCase;
  if (kind === 'wind') { const vNow = D.wind.vPeak * sim.lastU; return [cs === 'door' ? 'Gust now' : 'Wind now', nf1(vNow) + ' m/s · Bft ' + M.beaufort(vNow), 'Force', nf0(D.F.kgf * sim.lastU * sim.lastU) + ' kgf']; }
  if (kind === 'force') return ['Pushed from', Math.abs(L) < 0.02 ? '–' : 'the ' + (D.shake ? (L > 0 ? 'rear' : 'front') : D.dir), 'Push', nf0(S.knock.kgf * Math.abs(L)) + ' kgf'];
  const aNow = L * D.rig.acc / M.G;                                                                 // g at the wall's base, + tips it forward
  const c1 = cs === 'sway' ? ['Deck moves', nf1(S.sway.amp * sim.ground) + ' mm'] : cs === 'quake' ? ['Ground shakes', nf2(Math.abs(aNow) / S.quake.floor) + ' g'] : ['Load now', nf1(S.notional.pct * Math.abs(L)) + '%'];
  return [c1[0], c1[1], 'Inertia force', nf0(D.F.kgf * Math.abs(L)) + ' kgf'];
}
function updateHud() {
  const u = sim.lastU, deg = sim.phi * 180 / Math.PI, hc = hudCells();
  let s = D.status;
  if (sim.toppled) s = sim.phi > 1.2 ? 'toppled' : 'falling'; else if (sim.phi > 0.0004) s = 'rocking';
  const text = { stable: 'Stable', marginal: 'Marginal', tipping: 'Will tip', toppled: 'Toppled', falling: 'Falling', rocking: 'Rocking' }[s];
  const nodes = st.nodesNow || bendNow(D, sim), Kn = nodes.length - 1;
  const tiltTop = sim.phi * (D.geom.L + (D.gov === 'S' ? D.geom.hs : 0));
  const topNow = D.shake ? Math.abs(nodes[Kn]) + tiltTop : (nodes[Kn] + tiltTop) * (D.dir === 'rear' ? 1 : -1);
  const topMm = Math.abs(topNow) * 1000;
  const sp = D.strap, Tn = sp ? sim.Ph / (sp.cb * sp.n) : 0;
  const key = [s, hc.join('~'), deg.toFixed(2), sim.liftMM(D.geom.depth).toFixed(0), topMm.toFixed(topMm < 10 ? 1 : 0), Tn.toFixed(0), sim.broken].join('|');
  if (key === hudKey) return; hudKey = key;
  const pill = $('pill'); pill.dataset.s = s === 'rocking' ? 'marginal' : s === 'falling' ? 'toppled' : s;
  $('btnReplay').classList.toggle('attn', s === 'toppled');
  pill.querySelector('use').setAttribute('href', s === 'stable' ? '#i-check' : s === 'marginal' || s === 'rocking' ? '#i-warn' : '#i-x');
  setText('pillText', text);
  setText('liveWindK', hc[0]); setText('liveWind', hc[1]); setText('liveForceK', hc[2]); setText('liveForce', hc[3]);
  setText('liveTilt', deg < 10 ? deg.toFixed(2) + '°' : deg.toFixed(0) + '°');
  const topTxt = topMm < 10 ? nf(topMm, 1) + ' mm' : topMm < 1000 ? nf0(topMm) + ' mm' : nf(topMm / 1000, 2) + ' m';
  setText('liveTop', topTxt); setText('fTop', topTxt);
  const topEl = Math.abs(nodes[Kn]);
  setText('fRatio', topEl > 2e-5 ? 'H/' + nf0(D.bend.L / topEl) : '–');
  setText('fStrap', sp ? (sim.broken ? 'let go' : sp.active ? nf(Tn / 1000, 2) + ' kN' : 'slack') : 'none');
  const bl = D.bend, MbNow = sim.lam * bl.Mp[0] - (sp ? sim.Ph * sp.a : 0), seamMm = Math.abs(MbNow / bl.EIw * (S.cabDepth || 0.083)) * 1000;
  setText('fSeam', nf(seamMm, 3) + ' mm' + (D.dir === 'front' ? ' front' : ' back'));
}

/* ------------------------------------------------------------------ pointer interaction */
const ptr = (e, c) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function initPointers() {
  const rear = $('rear'); let dragB = null;
  const barKg = (y) => { const h = hits.rear; const top = ui.dragTop || h.top; return clamp((h.bBot - y) / (h.bBot - h.bTop), 0, 1) * top; };
  rear.addEventListener('pointerdown', (e) => {
    const h = hits.rear; if (!h) return; const p = ptr(e, rear);
    if (p.x < h.x0 || p.x > h.x1 || p.y < h.y0 - 4) { ui.selected = -1; update(); return; }
    const i = clamp(Math.floor((p.x - h.x0) / h.pitch), 0, h.N - 1);
    ui.selected = i;
    if (e.pointerType === 'mouse' && p.y >= h.bTop - 10) { dragB = i; ui.dragTop = h.top; rear.setPointerCapture(e.pointerId); setBase(i, barKg(p.y)); }
    update();
  });
  rear.addEventListener('pointermove', (e) => { if (dragB == null) return; setBase(dragB, barKg(ptr(e, rear).y)); update(); });
  const end = () => { dragB = null; ui.dragTop = 0; dirty.rear = true; };
  rear.addEventListener('pointerup', end); rear.addEventListener('pointercancel', end);

  const plan = $('plan'); let dragD = false;
  const setDir = (e) => {
    const h = hits.plan; if (!h || D.loadKind !== 'wind') return; const p = ptr(e, plan), dx = p.x - h.cx, dy = p.y - h.cy;
    if (Math.hypot(dx, dy) < 10) return;
    let deg = Math.atan2(dx, -dy) * 180 / Math.PI; deg = (deg + 360) % 360;
    deg = Math.round(deg / 5) * 5; for (const m of [0, 90, 180, 270]) if (Math.abs(deg - m) <= 4) deg = m;
    S.windDir = deg % 360; update();
  };
  plan.addEventListener('pointerdown', (e) => { dragD = true; plan.classList.add('drag'); plan.setPointerCapture(e.pointerId); setDir(e); });
  plan.addEventListener('pointermove', (e) => { if (dragD) setDir(e); });
  const endD = () => { dragD = false; plan.classList.remove('drag'); };
  plan.addEventListener('pointerup', endD); plan.addEventListener('pointercancel', endD);

  const map = $('map'), tip = $('mapTip'); let dragM = false;
  const setMap = (e) => {
    const h = hits.map; if (!h) return; const p = ptr(e, map); let v = hits.vAt(p.x);
    if (h.ax.kind === 'wind') {
      if (S.mode === 'indoor' && S.indoorCase === 'door') S.door.v = Math.round(v * 10) / 10;
      else if (S.mode === 'indoor') { let best = 0; M.SCALE.forEach((r, i) => { if (Math.abs(r.v - v) < Math.abs(M.SCALE[best].v - v)) best = i; }); S.indoorScale = best; }
      else S.outSpeed = Math.round(v * 2) / 2;
    } else if (S.indoorCase === 'knock') S.knock.kgf = Math.round(v);
    else if (S.indoorCase === 'sway') S.sway.amp = Math.round(v * M.G / Math.pow(2 * Math.PI * S.sway.f, 2) * 2000) / 2;
    else if (S.indoorCase === 'quake') S.quake.pga = Math.max(0.01, Math.round(v * 100) / 100);
    else S.notional.pct = Math.max(0.1, Math.round(v * 10) / 10);
    const kg = hits.kgAt(p.y); setBallastAll(kg < 0.4 ? 0 : kg);
    update();
  };
  map.addEventListener('pointerdown', (e) => {
    const d = hits.map && hits.dot; const p = ptr(e, map);
    if (d && Math.hypot(p.x - d.x, p.y - d.y) < 18) { dragM = true; map.setPointerCapture(e.pointerId); map.style.cursor = 'grabbing'; }
  });
  map.addEventListener('pointermove', (e) => {
    const p = ptr(e, map);
    if (dragM) { setMap(e); return; }
    const h = hits.map; if (!h) return;
    if (p.x < h.padL || p.x > h.padL + h.pw || p.y < h.padT - 4 || p.y > h.padT + h.ph + 4) { leaveMap(); return; }
    hits.hoverV = hits.vAt(p.x); dirty.map = true;
    const v = hits.hoverV, ax = h.ax, r1 = reqAtAxis(D, ax, v, S.SF), r0 = reqAtAxis(D, ax, v, 1), sf = sfAtAxis(D, ax, v), avg = D.Wb / D.N;
    tip.textContent = '';
    const t = el('div', 't', axisTitle(ax, v)); tip.appendChild(t);
    const row = (a, b, c) => { const d = el('div', 'r'); d.appendChild(el('span', null, a)); const bb = el('b', null, b); if (c) bb.style.color = c; d.appendChild(bb); tip.appendChild(d); };
    const T = theme();
    row('Needed for ' + nf2(S.SF) + '×', nf1(r1) + ' kg', T.goodInk); row('Tips below', nf1(r0) + ' kg', T.critInk); row('You have', nf1(avg) + ' kg'); row('Safety factor here', sf === Infinity ? '∞' : sfTxt(sf) + '×');
    tip.hidden = false;
    const wr = $('mapWrap').getBoundingClientRect(); const tw = tip.offsetWidth, th = tip.offsetHeight;
    let tx = p.x + 14, ty = p.y - th - 10; if (tx + tw > wr.width - 4) tx = p.x - tw - 14; if (ty < 2) ty = p.y + 14;
    tip.style.left = Math.max(2, tx) + 'px'; tip.style.top = Math.max(2, ty) + 'px';
  });
  const leaveMap = () => { hits.hoverV = null; tip.hidden = true; dirty.map = true; };
  map.addEventListener('pointerleave', () => { if (!dragM) leaveMap(); });
  const endM = () => { dragM = false; map.style.cursor = ''; };
  map.addEventListener('pointerup', endM); map.addEventListener('pointercancel', endM);

  // front view: drag to orbit (touch: sideways only, so the page still scrolls)
  const fr = $('front'); let dragF = null;
  fr.addEventListener('pointerdown', (e) => { dragF = { x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' }; fr.classList.add('drag'); fr.setPointerCapture(e.pointerId); });
  fr.addEventListener('pointermove', (e) => {
    if (!dragF) return;
    const dx = e.clientX - dragF.x, dy = e.clientY - dragF.y; dragF.x = e.clientX; dragF.y = e.clientY;
    ui.camTAz = clamp(ui.camTAz + dx * 0.008, -1.55, 1.55); ui.camAz = ui.camTAz;
    if (!dragF.touch) { ui.camTEl = clamp(ui.camTEl + dy * 0.006, 0.02, 0.9); ui.camEl = ui.camTEl; }
    ui.cam = 'custom'; segs.cam.set('custom');
  });
  const endF = () => { dragF = null; fr.classList.remove('drag'); };
  fr.addEventListener('pointerup', endF); fr.addEventListener('pointercancel', endF);
}

/* ------------------------------------------------------------------ loop */
let last = performance.now(), acc = 0;
const seenErr = {};
function safe(name, fn) { try { fn(); } catch (e) { if (!seenErr[name]) { seenErr[name] = true; console.error(name + ' drawing failed:', e); } } }
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!ui.paused) {
    acc += dt * ui.speed;
    let n = 0; while (acc >= SUB && n < 260) { sim.step(SUB); acc -= SUB; n++; }
    if (acc > SUB * 260) acc = 0;
    st.t += dt;
    if (st.V) advanceScene(dt, D.loadKind === 'wind' ? D.wind.vPeak * sim.lastU * D.wind.cn : 0, D.dir === 'rear' ? 1 : -1, st.V);
  }
  ui.camAz += (ui.camTAz - ui.camAz) * 0.14; ui.camEl += (ui.camTEl - ui.camEl) * 0.14;
  safe('side', () => drawSide($('side'), st));
  safe('front', () => drawFront($('front'), st));
  safe('plan', () => drawPlan($('plan'), st, hits));
  if (dirty.rear) { safe('rear', () => drawRear($('rear'), st, hits)); dirty.rear = false; }
  if (dirty.map) { safe('map', () => drawMap($('map'), st, hits)); dirty.map = false; }
  if (dirty.bend) { safe('bend', () => drawBend($('bendC'), st)); dirty.bend = false; }
  safe('hud', updateHud);
  requestAnimationFrame(frame);
}

function init() {
  initControls(); initPointers();
  update(); sim.reset();
  for (const id of ['rear', 'map', 'bendC']) new ResizeObserver(() => { dirty.rear = dirty.map = dirty.bend = true; }).observe($(id));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { dirty.rear = dirty.map = dirty.bend = true; });
  const themeChanged = () => { resetTheme(); dirty.rear = dirty.map = dirty.bend = true; };
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged); } catch (e) { /* older browsers */ }
  new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  window.__led = { S, sim, ui, hits, st, get D() { return D; }, M, update, loadScenario,
    redraw() { drawSide($('side'), st); drawFront($('front'), st); drawPlan($('plan'), st, hits); drawRear($('rear'), st, hits); drawMap($('map'), st, hits); drawBend($('bendC'), st); updateHud(); },
    bench(n) { n = n || 30; const t0 = performance.now(); for (let i = 0; i < n; i++) { drawSide($('side'), st); drawFront($('front'), st); drawPlan($('plan'), st, hits); } const t1 = performance.now(); for (let i = 0; i < n; i++) { drawMap($('map'), st, hits); drawRear($('rear'), st, hits); drawBend($('bendC'), st); } const t2 = performance.now(); const t3 = performance.now(); for (let i = 0; i < n; i++) { M.derive(S); } const t4 = performance.now(); return { perFrameMs: (t1 - t0) / n, perDirtyMs: (t2 - t1) / n, deriveMs: (t4 - t3) / n }; } };
  requestAnimationFrame(frame);
}
init();
