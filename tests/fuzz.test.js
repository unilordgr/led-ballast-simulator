const path = require('path');
const M = require(path.join(__dirname, '..', 'src', 'model.js'));
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const R = (a, b) => a + (b - a) * rnd();
let bad = 0, n = 0;
function finite(name, v, ctx) { if (typeof v === 'number' && !isFinite(v)) { bad++; if (bad < 12) console.log('NON-FINITE', name, v, JSON.stringify(ctx)); } }
for (let it = 0; it < 4000; it++) {
  const S = M.defaults();
  S.cabSize = pick(['500x500', '500x1000']); const cabH = M.cabHeight(S.cabSize);
  S.W = pick([1, 1.5, 2, 3, 5, 8, 14, 20, 30]); S.H = Math.max(1, Math.round(R(1, 12) / cabH) * cabH); S.kgm2 = R(10, 80); S.SF = R(1, 2.5);
  S.mode = pick(['indoor', 'outdoor']); S.indoorScale = Math.floor(R(0, 11)); S.outSpeed = R(0, 35); S.gust = R(0, 0.8);
  S.windDir = pick([0, 0, 45, 90, 135, 180, 180, 270, R(0, 360)]); S.profile = pick(['uniform', 'open', 'suburban', 'urban']); S.Cf = R(0.5, 2);
  S.shape = pick(['auto', 'auto', 'sheet', 'roe', 'en', 'ensign', 'mesh', 'custom']); S.gustAuto = rnd() < 0.5; S.zeta = pick([0.01, 0.01, R(0.002, 0.08)]);
  S.depth = R(0.5, 3); S.EI = R(0.2e6, 50e6); S.autoN = rnd() < 0.5; S.N = Math.max(1, Math.round(R(1, S.W * 2)));
  S.ballastAuto = rnd() < 0.4; S.ballastPer = pick([0, 5, 50, 300, 2000]); S.ballast = null; S.ballastPos = pick(['auto', 'rear', 'mid']); S.share = pick([1, 1, 0, R(0, 1)]);
  if (rnd() < 0.5) S.stage = { on: true, h: R(0.2, 3), depth: R(2, 12), extra: 2, front: R(0.3, 6), deckKgm2: R(10, 120), rating: 750, muDeck: R(0.2, 0.8), muFloor: R(0.2, 0.8) };
  if (rnd() < 0.6) S.rest = { type: pick(['strap', 'cable', 'truss']), n: Math.floor(R(0, 12)), a: pick([0, R(0.5, 8)]), d: pick([0, R(1, 12)]), to: pick(['floor', 'deck']), wll: R(200, 8000), slack: 0, anchorKg: pick([0, 0, R(10, 800)]), side: pick(['rear', 'front', 'both']) };
  if (S.mode === 'indoor') {                         // indoor: the sheet's draught, or one of the other indoor loads
    S.indoorCase = pick(['draught', 'draught', 'door', 'knock', 'sway', 'quake', 'notional']);
    S.door = { v: R(0, 15), dur: R(0.2, 6) };
    S.knock = { kgf: R(0, 120), h: R(0.3, 7), from: pick(['front', 'rear', 'both']), dur: R(0.1, 2), share: Math.floor(R(1, 6)) };
    S.sway = { amp: R(0, 20), f: R(0.5, 4), bounce: R(0, 0.5) };
    S.quake = { pga: R(0.02, 0.6), floor: R(1, 2.5), dur: R(4, 20) };
    S.notional = { pct: R(0.5, 10) };
  }
  // the UI clamps these before calling derive
  S.stage.front = Math.min(S.stage.front, Math.max(0.3, S.stage.depth - S.depth - 0.15));
  S.N = Math.min(S.N, Math.round(S.W / 0.5));
  if (S.stage.on && S.stage.depth - S.stage.front - (S.depth + 0.1) < 0) S.stage.depth = S.stage.front + S.depth + 0.4;   // the UI warns when the base overhangs the stage
  if (!S.ballastAuto && rnd() < 0.4) S.ballast = Array.from({ length: S.N }, () => pick([0, R(0, 400), S.ballastPer]));        // uneven ballast along the width
  let D;
  try { D = M.derive(S); } catch (e) { bad++; console.log('THROW', e.message, JSON.stringify(S)); continue; }
  n++;
  for (const [k, v] of Object.entries({ SFact: D.SFact, Ws: D.Ws, Wf: D.Wf, Wb: D.Wb, reqPer: D.req.per, top: D.bend.topEl, Mb: D.bend.Mb, seam: D.bend.seamOpen, vCrit: D.limits.vCritMean === Infinity ? 0 : D.limits.vCritMean, Mrest: D.M.rest, Mw: D.M.w, I: D.rig.I, phiCrit: D.rig.phiCrit })) finite(k, v, S);
  for (const v of D.bend.defl) finite('defl', v, S); for (const v of D.bend.bm) finite('bm', v, S);
  // the wind numbers, the first mode and the load sharing between bases
  for (const [k, v] of Object.entries({ cf: D.wind.cf, cfTot: D.wind.cfTot, gust: D.wind.gust, f1: D.modal.f1, T1: D.modal.T1, gamma: D.modal.Gamma, dynW: D.dyn.W, dynS: D.dyn.S, sfInd: D.sfInd, sfShared: D.sfShared })) finite(k, v, S);
  if (!(D.modal.f1 > 0) || !(D.dyn.W >= 1 - 1e-12) || !(D.dyn.S >= 1 - 1e-12)) { bad++; if (bad < 12) console.log('MODAL OUT OF RANGE', D.modal.f1, D.dyn.W, D.dyn.S); }
  if (D.wind.cf <= 0 || D.wind.cfTot < D.wind.cf - 1e-12) { bad++; console.log('WIND FACTORS', D.wind.cf, D.wind.cfTot); }
  if (D.modal.phi.some((v, i, a) => !isFinite(v) || v < -1e-9 || v > 1 + 1e-9 || (i > 0 && v < a[i - 1] - 1e-9))) { bad++; if (bad < 12) console.log('MODE SHAPE', D.modal.phi.slice(0, 5)); }
  // (with a strap the answer is not monotone in the ballast, so a lighter base can be the better one there: only weights and wind are held to this)
  if (!D.strap && D.sfInd > D.sfShared * (1 + 1e-6) + 1e-9) { bad++; if (bad < 12) console.log('ONE BASE ALONE BEATS THE WHOLE', D.sfInd, D.sfShared, D.uneven); }
  if (!D.uneven && Math.abs(D.sfInd - D.sfShared) > 1e-9 * Math.max(1, D.sfShared)) { bad++; console.log('EVEN BALLAST BUT DIFFERENT', D.sfInd, D.sfShared); }
  if (D.uneven && !D.strap) {
    const lo = M.derive(Object.assign({}, S, { share: 0 })), hi = M.derive(Object.assign({}, S, { share: 1 }));
    if (lo.SFact > hi.SFact * (1 + 1e-9) + 1e-9 || D.SFact < lo.SFact - 1e-9 || D.SFact > hi.SFact + 1e-9) { bad++; if (bad < 12) console.log('SHARE NOT BETWEEN', lo.SFact, D.SFact, hi.SFact); }
  }
  if (D.SFact < 0) { bad++; console.log('NEGATIVE SF', D.SFact); }
  // wind: more wind never raises the safety factor (check through sfOf: ballast more never lowers it)
  // (not for shaking: ballast is also mass that gets shaken, so ballast close to the pivot can lower the safety factor)
  const a = D.sfOf(10 * D.N), b = D.sfOf(500 * D.N);
  if (D.loadKind !== 'accel' && b < a * 0.995 - 1e-6) { bad++; if (bad < 12) console.log('NON-MONOTONE in ballast', a, b, JSON.stringify(S)); }
  // short sim: no NaN, tilt stays in [0, pi/2]
  const sim = new M.Sim(); sim.setRig(D, S); sim.reset();
  for (let i = 0; i < 240 * 4; i++) sim.step(1 / 240);
  finite('phi', sim.phi, S); finite('Ph', sim.Ph, S);
  if (sim.phi < -1e-9 || sim.phi > Math.PI / 2 + 1e-9) { bad++; console.log('PHI OUT OF RANGE', sim.phi); }
  // consistency between static verdict and dynamics: a stable verdict (peak load) must not topple
  // (a push or a shake arrives suddenly: a strap that catches the wall can see up to twice its static pull, so with straps ask for more margin)
  const margin = D.loadKind !== 'wind' && D.strap ? 2.3 : 1.3;
  if (D.SFact >= margin && sim.toppled) { bad++; if (bad < 12) console.log('STATIC OK BUT TOPPLED', D.SFact, D.gov, D.loadCase, JSON.stringify(S)); }
  // cabinet locks: whatever the wall, the load the cabinets carry is the load the frame holds, the failures come in order, and nothing is invented
  if (it % 2 === 0) {
    S.locks = { on: true, fixKgf: pick([0, 0, R(0.2, 6), R(6, 60), 400]), fixN: Math.floor(R(1, 6)), lockKgf: pick([0, 0, R(0.2, 6), R(6, 60), 400]), lockN: Math.floor(R(0, 5)), edge: R(1, 3), stiff: pick([1, 1, R(0.1, 10)]) };
    let L; try { L = M.locksFor(S, D); } catch (e) { bad++; console.log('LOCKS THROW', e.message, JSON.stringify(S)); continue; }
    const nc = L.cols * L.rows;
    for (const [k, v] of Object.entries({ peakFix: L.peak.fix, peakLock: L.peak.lock, needFix: L.need.fix, needLock: L.need.lock, loadTotal: L.load.total, reaction: L.net.reaction })) finite('locks ' + k, v, S);
    for (let i = 0; i < nc; i++) { if (!isFinite(L.use[i]) || L.use[i] < 0 || !isFinite(L.F[i]) || !isFinite(L.fixF[i])) { bad++; if (bad < 12) console.log('LOCK ARRAY', i, L.use[i], L.F[i], L.fixF[i]); break; } }
    if (Math.abs(L.net.reaction - L.net.load) > 1e-6 * Math.max(1, L.net.load)) { bad++; if (bad < 12) console.log('LOCK EQUILIBRIUM', L.net.reaction, L.net.load, JSON.stringify(S.locks)); }
    if (Math.abs(L.need.fix - L.peak.fix * S.SF) > 1e-9 * Math.max(1, L.need.fix)) { bad++; console.log('LOCK NEED', L.need.fix, L.peak.fix, S.SF); }
    let prevLam = 0, prevLost = 0;
    for (const e of L.events) {
      if (e.lam < prevLam - 1e-9 || e.lostTotal < prevLost || e.lostTotal > nc || e.n < 1 || !(e.lam > 0)) { bad++; if (bad < 12) console.log('LOCK EVENT ORDER', e.lam, prevLam, e.lostTotal, prevLost, nc); break; }
      prevLam = e.lam; prevLost = e.lostTotal;
    }
    if (!L.entered && L.events.length) { bad++; console.log('LOCK EVENTS WITHOUT STRENGTHS'); }
    if (!L.active && (L.events.length || L.peak.fix !== 0)) { bad++; console.log('LOCK LOAD WHERE NONE PULLS OFF'); }
    if (L.events.length && L.net.lamFirst !== L.events[0].lam) { bad++; console.log('LOCK FIRST'); }
    // the first failure is where the worst load / strength ratio says it is (before any sharing is undone)
    const w = Math.max(L.TfKgf > 0 ? L.peak.fix / L.TfKgf : 0, L.TlKgf > 0 ? L.peak.lock / L.TlKgf : 0);
    if (w > 0 && L.events.length && Math.abs(L.lamFirst * w - 1) > 1e-6 && !(L.lamFirst > 1e6)) { bad++; if (bad < 12) console.log('LOCK FIRST LOAD', L.lamFirst, w); }
    const sm = new M.Sim(); sm.setRig(D, S); sm.setLocks(L); sm.reset();
    for (let i = 0; i < 240 * 3; i++) sm.step(1 / 240);
    if (L.events.length && sm.lkCount !== L.net.lostAt(sm.lamPeak) && !sm.toppled) { bad++; if (bad < 12) console.log('LOCK SIM COUNT', sm.lkCount, L.net.lostAt(sm.lamPeak), sm.lamPeak); }
  }
}
console.log('fuzz cases', n, 'problems', bad);
process.exit(bad ? 1 : 0);
