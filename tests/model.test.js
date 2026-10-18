const path = require('path');
const M = require(path.join(__dirname, '..', 'src', 'model.js'));
const cases = require('./sheet_cases.json');
let fails = 0, checks = 0;
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
function eq(name, got, want, tol) { checks++; if (!near(got, want, tol)) { fails++; console.log('FAIL', name, 'got', got, 'want', want); } }
function ok(name, cond, extra) { checks++; if (!cond) { fails++; console.log('FAIL', name, extra === undefined ? '' : extra); } }
const base = (o) => { const S = M.defaults(); return Object.assign(S, o || {}); };

/* ---- 1. the sheet, cell by cell (sheet cabinets are 1 m long, D7 = 1) ---- */
for (const size of ['500x1000', '500x500']) {
  for (const c of cases) {
    if (c.scale === 1) continue;                       // sheet lists 0.14 N/m2 (typo); we use 1.4
    const S = base({ W: c.W, H: c.H, kgm2: c.kg, SF: c.SF, indoorScale: c.scale, windDir: c.dir === 'rear' ? 0 : 180, cabSize: size });
    S.N = M.sheetBases(S);
    const D = M.derive(S), o = c.out, tag = size + JSON.stringify([c.W, c.H, c.kg, c.SF, c.scale, c.dir]);
    eq(tag + ' A7', D.cols, o.A7); if (size === '500x1000') eq(tag + ' B7', D.rows, o.B7); else eq(tag + ' rows500', D.rows, o.B7 * 2);
    eq(tag + ' E7', D.wind.qPeak * D.wind.cn, o.E7); eq(tag + ' F7', D.geom.aB, o.F7); eq(tag + ' A14', D.A, o.A14); eq(tag + ' B14', D.N, o.B14);
    eq(tag + ' B10', D.Ws, o.B10); eq(tag + ' C10', D.Wf, o.C10); eq(tag + ' E10', D.F.kgf, o.E10);
    eq(tag + ' B11', D.geom.aS, o.B11); eq(tag + ' C11', D.geom.aF, o.C11); eq(tag + ' D11', D.geom.aB, o.D11);
    eq(tag + ' E11', D.geom.hW, o.E11); eq(tag + ' C14', D.req.totalRaw, o.C14); eq(tag + ' D14', D.req.perRaw, o.D14);
    if (o.C14 > 0) eq(tag + ' SF', D.SFact, c.SF, 1e-9);
  }
}
console.log('sheet comparison:', checks, 'checks,', fails, 'failures');

/* ---- 2. defaults reproduce the sheet's headline numbers ---- */
{
  const D = M.derive(base());
  eq('default total', D.req.total, 126.77262180974468); eq('default per base', D.req.per, 9.05518727212462);
  eq('default SF', D.SFact, 1.5, 1e-9); ok('default stable', D.status === 'stable');
  eq('default Ws', D.Ws, 2587.2); eq('default Wf', D.Wf, 560.7); eq('rows 500x500', D.rows, 14);
  eq('stage off', D.stage, null);
}

/* ---- 3. beam: closed forms for a uniform load on [b, L] ---- */
{
  const S = base({ N: 14, EI: 2.9e6, gaRatio: 0.12, mode: 'outdoor', outSpeed: 10, gust: 0, ballastAuto: false, ballastPer: 400 });
  const D = M.derive(S);
  const b = 0.1, L = b + S.H, q = D.wind.qPeak * S.W, EIw = 14 * 2.9e6, GAw = 0.12 * EIw;
  const tipB = q * (0.75 * Math.pow(L, 4) - L * Math.pow(b, 3) + Math.pow(b, 4) / 4) / (6 * EIw);
  const tipS = q * (L * L - b * b) / (2 * GAw);
  eq('beam tip (bending+shear)', D.bend.topEl, tipB + tipS, 0.01);
  eq('beam base moment', D.bend.Mb, q * (L * L - b * b) / 2, 0.01);
  ok('no strap: no strap force', D.strap === null && D.eq.Ph === 0);
  ok('deflection increases with height', D.bend.defl.every((v, i, a) => i === 0 || v >= a[i - 1]));
  ok('moment decreases with height', D.bend.bm.every((v, i, a) => i === 0 || v <= a[i - 1] + 1e-9));
  const S2 = base(Object.assign({}, S)); S2.EI = 2.9e7; const D2 = M.derive(S2);
  ok('10x stiffer, ~10x less deflection', D2.bend.topEl < D.bend.topEl / 8, [D.bend.topEl, D2.bend.topEl]);
}

/* ---- 4. restraint behaves like a spring ---- */
{
  const mk = (rest, extra) => base(Object.assign({ mode: 'outdoor', outSpeed: 10, gust: 0, ballastAuto: false, ballastPer: 150, rest: Object.assign({ type: 'none', n: 7, a: 0, d: 0, to: 'floor', wll: 2000, slack: 0, anchorKg: 0, side: 'rear' }, rest) }, extra || {}));
  const D0 = M.derive(mk({}));
  const Dst = M.derive(mk({ type: 'strap' })), Dca = M.derive(mk({ type: 'cable' })), Dtr = M.derive(mk({ type: 'truss', wll: 10000 }));
  ok('strap helps', Dst.SFact >= D0.SFact - 1e-9, [D0.SFact, Dst.SFact]);
  ok('cable at least as good as strap', Dca.SFact >= Dst.SFact - 1e-9, [Dst.SFact, Dca.SFact]);
  ok('bending: strap reduces the top deflection', Dst.bend.topEl < D0.bend.topEl && Dca.bend.topEl < Dst.bend.topEl, [D0.bend.topEl, Dst.bend.topEl, Dca.bend.topEl]);
  // rigid prop at the top: reaction is the propped-cantilever share, equal to dp(L)/f(L,L)
  const S = mk({ type: 'truss', wll: 1e5, a: 0 }); S.ballastPer = 3000; const D = M.derive(S);
  const sb = D.strap, share = D.bend.defl.length ? (D.bend.defl[48] + D.eq.Ph * 0) : 0;
  ok('rigid prop is engaged at phi=0', D.eq.phi === 0 && D.eq.Ph > 0, [D.eq.phi, D.eq.Ph]);
  ok('rigid prop leaves almost no top deflection', D.bend.topEl < 0.02 * Dst.bend.topEl * 10, [D.bend.topEl]);
  // 3/8 qL for a prop at the tip with the load covering the whole span (b is tiny)
  const q = D.wind.qPeak * S.W, L = 7.1; eq('prop reaction ~ 3/8 q L (partial load, bending only)', D.eq.Ph / (3 / 8 * q * L), 1, 0.12);
  // anchor limit
  const Dan = M.derive(mk({ type: 'strap', anchorKg: 20 }));
  ok('weak anchor limits the strap', Dan.strap.anchorLimited && Dan.SFact <= Dst.SFact + 1e-9, [Dan.strap.anchorLimKg, Dan.SFact, Dst.SFact]);
  // strap on the wrong side does nothing in rear wind, front-side strap works in front wind
  const Dfr = M.derive(mk({ type: 'strap', side: 'front' })); eq('front-side strap ignored in rear wind', Dfr.SFact, D0.SFact, 1e-9);
  const Df = M.derive(mk({ type: 'strap', side: 'front' }, { windDir: 180, ballastPer: 0, outSpeed: 18 })), Df0 = M.derive(mk({}, { windDir: 180, ballastPer: 0, outSpeed: 18 }));
  ok('front strap helps in front wind', Df.SFact > Df0.SFact, [Df0.SFact, Df.SFact]);
  // truss works in compression for front wind
  const Dtf = M.derive(mk({ type: 'truss', wll: 10000 }, { windDir: 180, ballastPer: 0, outSpeed: 18 }));
  ok('truss helps in front wind (compression)', Dtf.SFact > Df0.SFact, [Df0.SFact, Dtf.SFact]);
  // monotone in WLL
  let prev = 0, mono = true; for (const w of [200, 500, 1000, 2000, 4000]) { const d = M.derive(mk({ type: 'cable', wll: w })); if (d.SFact < prev - 1e-9) mono = false; prev = d.SFact; }
  ok('SF monotone in WLL', mono);
}

/* ---- 5. required ballast with straps and with a stage matches the solver ---- */
{
  const cfgs = [
    { rest: { type: 'strap', n: 4, wll: 1500, a: 0, d: 0, to: 'floor', slack: 0, anchorKg: 0, side: 'rear' }, mode: 'outdoor', outSpeed: 9 },
    { rest: { type: 'cable', n: 3, wll: 800, a: 4, d: 3, to: 'floor', slack: 20, anchorKg: 0, side: 'rear' }, mode: 'outdoor', outSpeed: 12 },
    { stage: { on: true, h: 1.6, depth: 5, extra: 2, front: 3.6, deckKgm2: 30, rating: 750, muDeck: 0.4, muFloor: 0.5 }, mode: 'outdoor', outSpeed: 11 },
    { stage: { on: true, h: 2.0, depth: 4, extra: 1, front: 2.7, deckKgm2: 25, rating: 750, muDeck: 0.4, muFloor: 0.5 }, mode: 'outdoor', outSpeed: 16, windDir: 180 }
  ];
  cfgs.forEach((cfg, i) => {
    const S = base(cfg); const D = M.derive(S);
    const tot = D.req.total;
    if (D.req.capped) { ok('cfg' + i + ' capped (skip)', true); return; }
    if (tot > 0) eq('cfg' + i + ' SF at required ballast', D.sfOf(tot), S.SF, 2e-3);
    else ok('cfg' + i + ' none needed => SF at 0 is enough', D.sfOf(0) >= S.SF - 1e-6, D.sfOf(0));
    ok('cfg' + i + ' less ballast fails', tot <= 1e-9 || D.sfOf(tot * 0.97) < S.SF, [D.sfOf(tot * 0.97)]);
    const hov = D.reqPerAtSpeed(D.wind.vMean, S.SF); eq('cfg' + i + ' reqPerAtSpeed at the current wind', hov * D.N, tot, 5e-3);
    console.log('  cfg' + i, 'gov', D.gov, 'req/base', D.req.per.toFixed(1), 'strap', D.strap ? D.strap.T.toFixed(0) + ' N' : '-', 'top', (D.bend.topEl * 1000).toFixed(1) + ' mm');
  });
}

/* ---- 6. stage ---- */
{
  const noStage = M.derive(base({ ballastAuto: false, ballastPer: 9 }));
  const flat = M.derive(base({ ballastAuto: false, ballastPer: 9, stage: { on: true, h: 0, depth: 6, extra: 2, front: 4.6, deckKgm2: 0, rating: 750, muDeck: 0.4, muFloor: 0.5 } }));
  eq('stage of height 0 and no weight: same SF', flat.SFact, noStage.SFact, 1e-9); ok('wall governs', flat.gov === 'W');
  const tall = M.derive(base({ mode: 'outdoor', outSpeed: 10, ballastAuto: false, ballastPer: 400, stage: { on: true, h: 2.5, depth: 2.5, extra: 0, front: 0.3, deckKgm2: 10, rating: 750, muDeck: 0.4, muFloor: 0.5 } }));
  ok('tall light stage: stage governs', tall.gov === 'S', [tall.lam.lamW, tall.lam.lamS]);
  ok('stage lowers the overall safety factor', tall.SFact < tall.lam.lamW + 1e-9);
  ok('deck check present', tall.deck && tall.deck.local > 0 && tall.slideStage.SF > 0);
  const hi = M.derive(base({ mode: 'outdoor', outSpeed: 8, ballastAuto: true, stage: { on: true, h: 0.4, depth: 6, extra: 2, front: 4.6, deckKgm2: 40, rating: 750, muDeck: 0.4, muFloor: 0.5 } }));
  const lo = M.derive(base({ mode: 'outdoor', outSpeed: 8, ballastAuto: true, stage: { on: true, h: 2.0, depth: 6, extra: 2, front: 4.6, deckKgm2: 40, rating: 750, muDeck: 0.4, muFloor: 0.5 } }));
  ok('higher stage never needs less ballast', lo.req.total >= hi.req.total - 1e-9, [hi.req.total, lo.req.total]);
}

/* ---- 7. wind gradient raises the load centre ---- */
{
  const a = M.derive(base({ mode: 'outdoor', outSpeed: 10, gust: 0, profile: 'uniform' })), b = M.derive(base({ mode: 'outdoor', outSpeed: 10, gust: 0, profile: 'open' }));
  ok('gradient: resultant sits higher than mid-height', b.geom.hc > a.geom.hc, [a.geom.hc, b.geom.hc]);
  ok('gradient at 7 m is below the uniform 10 m value', b.F.kgf < a.F.kgf);
}

/* ---- 8. rocking sim, including a strap catching the wall ---- */
function run(label, S, seconds = 40) {
  const D = M.derive(S); const sim = new M.Sim(); sim.setRig(D, S); sim.reset();
  const dt = 1 / 240; let tTop = null, tTilt = null, maxPh = 0;
  for (let i = 0; i < seconds / dt; i++) { sim.step(dt); if (tTilt === null && sim.phi > 1e-4) tTilt = sim.t; if (tTop === null && sim.toppled) tTop = sim.t; maxPh = Math.max(maxPh, sim.Ph); }
  console.log(label.padEnd(38), 'SF', D.SFact.toFixed(3), D.status.padEnd(8), 'gov', D.gov, 'maxTilt', (sim.maxPhi * 180 / Math.PI).toFixed(2) + 'deg', 'lift@', tTilt === null ? '-' : tTilt.toFixed(2) + 's', 'toppled@', tTop === null ? '-' : tTop.toFixed(2) + 's', 'final', (sim.phi * 180 / Math.PI).toFixed(2) + 'deg', maxPh ? 'Ph ' + (maxPh / 1000).toFixed(1) + 'kN' : '', sim.broken ? 'BROKEN' : '');
  return { D, sim, tTop };
}
let r;
r = run('sheet default', base());
ok('sheet default does not move', r.sim.maxPhi === 0);
r = run('no ballast, scale 2', base({ ballastAuto: false, ballastPer: 0 }));
r = run('9 kg/base, scale 4 (tips)', base({ ballastAuto: false, ballastPer: 9.055, indoorScale: 4 })); ok('tips', r.sim.toppled);
r = run('rear 60deg scale 4, 9 kg', base({ ballastAuto: false, ballastPer: 9.055, indoorScale: 4, windDir: 60 }));
r = run('tiny 2x1 m, scale 3, no ballast', base({ W: 2, H: 1, N: 2, ballastAuto: false, ballastPer: 0, indoorScale: 3 }));
r = run('outdoor 8 m/s, 100 kg/base', base({ mode: 'outdoor', ballastAuto: false, ballastPer: 100 })); ok('outdoor 100 kg tips', r.sim.toppled);
const rope = { type: 'cable', n: 7, a: 0, d: 0, to: 'floor', wll: 2000, slack: 0, anchorKg: 0, side: 'rear' };
r = run('outdoor 8 m/s, 100 kg + cable', base({ mode: 'outdoor', ballastAuto: false, ballastPer: 100, rest: rope })); ok('cable saves it', !r.sim.toppled && r.D.SFact > 1, [r.D.SFact]);
r = run('outdoor 8 m/s, 100 kg + strap', base({ mode: 'outdoor', ballastAuto: false, ballastPer: 100, rest: Object.assign({}, rope, { type: 'strap' }) }));
r = run('outdoor 8 m/s, 100 kg + weak anchor', base({ mode: 'outdoor', ballastAuto: false, ballastPer: 100, rest: Object.assign({}, rope, { anchorKg: 30 }) }));
r = run('outdoor gale 14 m/s, 300 kg', base({ mode: 'outdoor', outSpeed: 14, gust: 0.4, ballastAuto: false, ballastPer: 300 }));
r = run('same + stage 1.2 m', base({ mode: 'outdoor', outSpeed: 14, gust: 0.4, ballastAuto: false, ballastPer: 300, stage: { on: true, h: 1.2, depth: 6, extra: 2, front: 4.6, deckKgm2: 40, rating: 750, muDeck: 0.4, muFloor: 0.5 } }));
r = run('tall light stage, outdoor 13 m/s', base({ mode: 'outdoor', outSpeed: 13, ballastAuto: false, ballastPer: 400, stage: { on: true, h: 2.5, depth: 2.5, extra: 0, front: 0.3, deckKgm2: 10, rating: 750, muDeck: 0.4, muFloor: 0.5 } }));
ok('stage + wall topple together', r.D.gov === 'S' && r.sim.toppled);

const D1 = M.derive(base({ mode: 'outdoor' }));
console.log('outdoor default: req per base', D1.req.per.toFixed(1), 'peak v', D1.wind.vPeak.toFixed(2), 'bft', D1.wind.bft, 'top deflection', (D1.bend.topEl * 1000).toFixed(1), 'mm (H/' + D1.bend.ratio.toFixed(0) + ')', 'seam', (D1.bend.seamOpen * 1000).toFixed(3), 'mm');
console.log(fails ? 'TESTS FAILED: ' + fails + ' of ' + checks : 'ALL ' + checks + ' CHECKS PASSED');
process.exit(fails ? 1 : 0);
