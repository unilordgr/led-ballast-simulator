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
  S.depth = R(0.5, 3); S.EI = R(0.2e6, 50e6); S.autoN = rnd() < 0.5; S.N = Math.max(1, Math.round(R(1, S.W * 2)));
  S.ballastAuto = rnd() < 0.4; S.ballastPer = pick([0, 5, 50, 300, 2000]); S.ballast = null; S.ballastPos = pick(['auto', 'rear', 'mid']);
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
  let D;
  try { D = M.derive(S); } catch (e) { bad++; console.log('THROW', e.message, JSON.stringify(S)); continue; }
  n++;
  for (const [k, v] of Object.entries({ SFact: D.SFact, Ws: D.Ws, Wf: D.Wf, Wb: D.Wb, reqPer: D.req.per, top: D.bend.topEl, Mb: D.bend.Mb, seam: D.bend.seamOpen, vCrit: D.limits.vCritMean === Infinity ? 0 : D.limits.vCritMean, Mrest: D.M.rest, Mw: D.M.w, I: D.rig.I, phiCrit: D.rig.phiCrit })) finite(k, v, S);
  for (const v of D.bend.defl) finite('defl', v, S); for (const v of D.bend.bm) finite('bm', v, S);
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
}
console.log('fuzz cases', n, 'problems', bad);
process.exit(bad ? 1 : 0);
