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

/* ---- 9. Beaufort: picking a force uses the top of its range, like the sheet's wind table ---- */
for (let n = 0; n <= 12; n++) eq('Beaufort ' + n + ' maps back to itself', M.beaufort(M.BFT_SPEED[n]), n);
for (let n = 0; n <= 10; n++) eq('sheet scale ' + n + ' speed is the top of Beaufort ' + n, M.SCALE[n].v, M.BFT_SPEED[n]);
eq('13.8 m/s is still force 6', M.beaufort(13.8), 6); eq('13.9 m/s is force 7', M.beaufort(13.9), 7);
ok('force 6 runs 10.8 to 13.8 m/s', M.bftRange(6).lo === 10.8 && M.bftRange(6).hi === 13.8, JSON.stringify(M.bftRange(6)));
ok('force 1 runs 0.3 to 1.5 m/s', M.bftRange(1).lo === 0.3 && M.bftRange(1).hi === 1.5, JSON.stringify(M.bftRange(1)));
ok('force 12 has no top', M.bftRange(12).lo === 32.7 && M.bftRange(12).hi === null, JSON.stringify(M.bftRange(12)));
for (let n = 1; n <= 12; n++) ok('force ' + n + ' starts just above force ' + (n - 1), Math.abs(M.bftRange(n).lo - (M.bftRange(n - 1).hi + 0.1)) < 1e-9, JSON.stringify([M.bftRange(n - 1), M.bftRange(n)]));
for (let n = 1; n <= 10; n++) {   // outdoors at the top of a force gives the sheet's pressure for that row, to the table's rounding
  const W = M.windInfo(base({ mode: 'outdoor', gust: 0, outSpeed: M.BFT_SPEED[n] }));
  ok('outdoor Beaufort ' + n + ' pressure matches the sheet row', Math.abs(W.qMean - M.SCALE[n].q) < 0.06, [W.qMean, M.SCALE[n].q]);
}

/* ---- 10. indoor loads other than wind: door gust, knock, stage sway, earthquake, code minimum ---- */
{
  const sheetBal = { ballastAuto: false, ballastPer: 9.055, ballastPos: 'rear' };
  const a = M.derive(base()), b = M.derive(base({ indoorCase: 'draught' }));
  eq('the draught case is the sheet', b.SFact, a.SFact); eq('the draught case needs the sheet ballast', b.req.per, a.req.per);
  const dg = M.derive(base({ indoorCase: 'door', door: { v: 3.3, dur: 2 } }));
  ok('a door gust at 3.3 m/s needs the sheet ballast (the table rounds 6.806 to 6.8 N/m2)', Math.abs(dg.req.per - a.req.per) / a.req.per < 0.005, [dg.req.per, a.req.per]);

  // code minimum 2.5% of the weight, ballast at the rear end: SF*acc*sum(m*eta) = g*sum(m*xi), solved by hand for the forward tip
  const Sn = base({ indoorCase: 'notional', ballastPos: 'rear' }), Dn = M.derive(Sn);
  const a0 = 0.025, etaW = 0.1 + Sn.H / 2, etaB = 0.1 + 0.12, xiF = 0.46, xiB = 0.862;
  const Bt = (Sn.SF * a0 * (Dn.Ws + Dn.Wf) * etaW - Dn.Wf * xiF) / (xiB - Sn.SF * a0 * etaB);
  eq('code minimum: ballast from the moment balance', Dn.sides.fwd.req.total, Bt, 1e-6);
  ok('the screen sits at the front toe, so forward is the weak side', Dn.dir === 'rear' && Dn.sides.fwd.SFact < Dn.sides.back.SFact, [Dn.sides.fwd.SFact, Dn.sides.back.SFact]);
  eq('reported safety factor is the weaker side', Dn.SFact, Math.min(Dn.sides.fwd.SFact, Dn.sides.back.SFact));

  // sway: acceleration = (2 pi f)^2 * amplitude; twice the amplitude halves the safety factor; a 20% bounce lowers it by 20%
  const sw = (o) => M.derive(base(Object.assign({ indoorCase: 'sway', ballastAuto: false, ballastPer: 60, ballastPos: 'rear' }, o)));
  const s0 = sw({ sway: { amp: 5, f: 1.5, bounce: 0 } }), s2 = sw({ sway: { amp: 10, f: 1.5, bounce: 0 } }), sb = sw({ sway: { amp: 5, f: 1.5, bounce: 0.2 } });
  eq('sway acceleration', M.loadFor(base({ indoorCase: 'sway' }), 'sway', 'rear').acc, Math.pow(2 * Math.PI * 1.5, 2) * 0.005, 1e-12);
  eq('twice the sway halves the safety factor', s2.sides.fwd.SFact, s0.sides.fwd.SFact / 2, 1e-9);
  eq('a 20% bounce lowers the safety factor by 20%', sb.sides.fwd.SFact / s0.sides.fwd.SFact, 0.8, 1e-9);
  eq('quake: a vertical shake of half the horizontal', M.loadFor(base({ indoorCase: 'quake' }), 'quake', 'rear').gs, 1 - 0.5 * 0.24, 1e-12);

  // knock: the push is carried by `share` bases, so more sharing holds proportionally better
  const kn = (share) => M.derive(base({ indoorCase: 'knock', knock: { kgf: 40, h: 1.2, from: 'rear', dur: 0.3, share }, ballastAuto: false, ballastPer: 9.055, ballastPos: 'rear' }));
  eq('a push shared by 4 bases holds twice as well as by 2', kn(4).SFact, 2 * kn(2).SFact, 1e-9);
  ok('a push from the front is the easy one (the wall tips backward, onto its screen)', M.derive(base({ indoorCase: 'knock', knock: { kgf: 40, h: 1.2, from: 'front', dur: 0.3, share: 2 } })).req.per < M.derive(base({ indoorCase: 'knock', knock: { kgf: 40, h: 1.2, from: 'rear', dur: 0.3, share: 2 } })).req.per);

  // from either side the ballast position matters: at the rear end it sits on the rear pivot, so Auto goes to the middle for a quake
  const qa = M.derive(base({ indoorCase: 'quake' }));
  ok('auto position moves the ballast to the middle for a quake', qa.posUsed === 'mid', qa.posUsed);
  eq('auto ballast for the quake reaches the required safety factor', qa.SFact, 1.5, 1e-6);
  ok('the quake needs far more than the sheet draught', qa.req.per > 20 * a.req.per, qa.req.per);
  eq('sfOf at the ballast in use gives the weaker way back', qa.sfOf(qa.Wb), qa.SFact, 1e-9);
  eq('and so does the load-based requirement at the load in use', qa.reqPerAtLoad(0.24, 1.5, 0.24), qa.req.per, 1e-6);

  // the comparison table
  const cmp = M.compareCases(base(), a);
  ok('six cases, in order', cmp.map((c) => c.id).join() === M.CASES.join());
  eq('draught row, on the sheet ballast', cmp[0].SF, 1.5, 1e-9);
  ok('a 5.4 m/s door gust needs more than the draught', cmp[1].req > cmp[0].req && cmp[1].SF < cmp[0].SF);

  // the record behind the earthquake animation
  const rec = M.makeRecord(1, 12);
  let pk = 0, pd = 0; for (const v of rec.acc) pk = Math.max(pk, Math.abs(v)); for (const v of rec.disp) pd = Math.max(pd, Math.abs(v));
  ok('the record is cached', rec === M.makeRecord(1, 12));
  eq('record peak acceleration is 1', pk, 1, 1e-6); eq('record peak displacement is 1', pd, 1, 1e-6);
  eq('record is quiet when it has finished', rec.acc[rec.acc.length - 1], 0, 1e-9);

  // the rocking simulation, tipping either way
  const runSim = (S, secs) => {
    const D = M.derive(S), sim = new M.Sim(); sim.setRig(D, S); sim.reset();
    const sides = new Set();
    for (let i = 0; i < secs * 240; i++) { sim.step(1 / 240); if (sim.phi > 1e-4) sides.add(sim.side); if (sim.toppled) break; }
    return { D, sim, sides };
  };
  const sheetOn = { ballastAuto: false, ballastPer: 9.055 };
  let r = runSim(base(Object.assign({ indoorCase: 'door' }, sheetOn)), 20);
  ok('a 2 s door gust at 5.4 m/s topples the sheet wall', r.sim.toppled);
  r = runSim(base(Object.assign({ indoorCase: 'door', door: { v: 5.4, dur: 0.2 } }, sheetOn)), 20);
  ok('the same gust for 0.2 s makes it lift and settle (the impulse is too small to tip it)', !r.sim.toppled && r.sim.maxPhi > 0 && r.sim.maxPhi < 0.01, r.sim.maxPhi);
  r = runSim(base({ indoorCase: 'quake', ballastAuto: false, ballastPer: 9.055 }), 40);
  ok('a 0.24 g quake topples the sheet wall', r.sim.toppled);
  r = runSim(base({ indoorCase: 'quake' }), 40);
  ok('on the ballast it asks for, the quake does not even lift it', r.sim.maxPhi === 0 && !r.sim.toppled, r.sim.maxPhi);
  r = runSim(base({ indoorCase: 'sway', sway: { amp: 8, f: 2, bounce: 0 }, ballastAuto: false, ballastPer: 60 }), 40);
  ok('8 mm of sway at 2 Hz rocks the wall both ways without toppling it', r.sides.has(1) && r.sides.has(-1) && !r.sim.toppled, [...r.sides]);
  r = runSim(base({ indoorCase: 'sway', ballastAuto: false, ballastPer: 60 }), 40);
  ok('5 mm of sway at 1.5 Hz on 60 kg per base never lifts it', r.sim.maxPhi === 0);
  r = runSim(base({ indoorCase: 'knock', knock: { kgf: 25, h: 1.2, from: 'both', dur: 0.3, share: 2 }, ballastAuto: false, ballastPer: 9.055 }), 30);
  ok('a 25 kgf knock does not lift the sheet wall', r.sim.maxPhi === 0);

  /* ---- Start and End simulation: a gust, a knock or a quake happens once and the wall settles; the other loads go on until it is ended ---- */
  const mk = (o) => { const S = base(o), D = M.derive(S), sim = new M.Sim(); sim.setRig(D, S); sim.reset(); return { S, D, sim }; };
  const kn2 = (o) => ({ indoorCase: 'knock', knock: Object.assign({ kgf: 25, h: 1.2, from: 'both', dur: 0.3, share: 2 }, o) });
  eq('a door gust is over when its time is up', mk({ indoorCase: 'door', door: { v: 5.4, dur: 1.2 } }).sim.doneAt, 2.2, 1e-12);
  eq('a knock is over when it ends', mk(kn2()).sim.doneAt, 1.3, 1e-12);
  eq('an earthquake is over when the record ends', mk({ indoorCase: 'quake', quake: { pga: 0.24, floor: 1, dur: 12 } }).sim.doneAt, 13, 1e-12);
  for (const id of ['draught', 'sway', 'notional']) ok(id + ' has no end of its own', mk({ indoorCase: id }).sim.doneAt === null);
  ok('outdoor wind has no end of its own', mk({ mode: 'outdoor' }).sim.doneAt === null);

  // the ongoing loads are still there a long time later
  ok('the draught is still blowing after 100 s', mk({ indoorCase: 'draught' }).sim.loadAt(100).u > 0.99);
  ok('the code load is still there after 100 s', mk({ indoorCase: 'notional' }).sim.loadAt(100).u > 0.99);
  { const { sim } = mk({ indoorCase: 'sway' }); let pk = 0; for (let t = 100; t < 102; t += 0.01) pk = Math.max(pk, Math.abs(sim.loadAt(t).u)); ok('the stage is still swaying after 100 s', pk > 0.99, pk); }
  { const { sim } = mk({ mode: 'outdoor', gust: 0.3 }); let pk = 0; for (let t = 100; t < 160; t += 0.1) pk = Math.max(pk, sim.loadAt(t).u); ok('outdoors the wind is still blowing after 100 s', pk > 0.5, pk); }

  // the one-off events: quiet for the first second, then once, then gone for good, and the wall ends up still
  const events = [
    ['door gust', { indoorCase: 'door', door: { v: 5.4, dur: 0.4 }, ballastAuto: false, ballastPer: 9.055 }, 'u'],
    ['knock', Object.assign(kn2({ kgf: 60, from: 'both' }), { ballastAuto: false, ballastPer: 9.055 }), 'u'],
    ['earthquake', { indoorCase: 'quake', ballastAuto: false, ballastPer: 30 }, 'lam'],
  ];
  for (const [name, o, key] of events) {
    const { D, sim } = mk(o);
    let early = 0, late = 0, lastMove = 0;
    for (let i = 0; i < 45 * 240; i++) {
      sim.step(1 / 240);
      const v = Math.abs(sim.loadAt(sim.t)[key]);
      if (sim.t < 1) early = Math.max(early, v);
      if (sim.t > sim.doneAt + 0.05) late = Math.max(late, v);
      if (sim.phi > 0 || sim.omega !== 0) lastMove = sim.t;
    }
    ok(name + ': nothing happens in the first second', early === 0, early);
    ok(name + ': the load is gone once the event is over and never comes back', late === 0, late);
    ok(name + ': the wall lifted a little but did not topple', sim.maxPhi > 0 && !sim.toppled && sim.toppledAt === -1, [sim.maxPhi, sim.toppled]);
    ok(name + ': it comes to rest, flat, after the event', sim.phi === 0 && sim.omega === 0 && lastMove < sim.doneAt + 6, [sim.phi, sim.omega, lastMove, sim.doneAt]);
  }

  // when it does topple it says when, and a restart forgets it
  r = runSim(base(Object.assign({ indoorCase: 'door', door: { v: 5.4, dur: 2 } }, sheetOn)), 20);
  ok('a toppled wall knows when it went', r.sim.toppled && r.sim.toppledAt > 1 && r.sim.toppledAt <= r.sim.t, [r.sim.toppledAt, r.sim.t]);
  r.sim.reset();
  ok('a restart forgets that it toppled', !r.sim.toppled && r.sim.toppledAt === -1 && r.sim.maxPhi === 0 && r.sim.t === 0);
  r = runSim(base(Object.assign({ indoorCase: 'quake', ballastAuto: false, ballastPer: 9.055 }, {})), 40);
  ok('the quake topples a light wall, and toppledAt is during the shaking', r.sim.toppled && r.sim.toppledAt > 1 && r.sim.toppledAt < 1 + 12, r.sim.toppledAt);
  r = runSim(base({ indoorCase: 'door', door: { v: 5.4, dur: 0.2 }, ballastAuto: false, ballastPer: 9.055 }), 20);
  ok('a wall that did not topple has no toppled time', r.sim.toppledAt === -1);

  // a knock "from either side" is pushed the weaker way, which is what the picture and the simulation use
  { const o = Object.assign(kn2({ kgf: 60 }), { ballastAuto: false, ballastPer: 9.055, ballastPos: 'rear' });
    const both = mk(o), rear = mk(Object.assign({}, o, { knock: Object.assign({}, o.knock, { from: 'rear' }) })), front = mk(Object.assign({}, o, { knock: Object.assign({}, o.knock, { from: 'front' }) }));
    const weak = both.D.sides.fwd.SFact <= both.D.sides.back.SFact ? 1 : -1;
    ok('the weaker way for this wall is forward (onto the front toe)', weak === 1 && both.D.dir === 'rear', [both.D.sides.fwd.SFact, both.D.sides.back.SFact, both.D.dir]);
    ok('the simulation pushes the weaker way', both.sim.pushSign === weak);
    eq('the safety factor from either side is the weaker side', both.D.SFact, Math.min(rear.D.SFact, front.D.SFact), 1e-9);
    ok('pushing from the front is the easy one', front.D.SFact > rear.D.SFact);
    for (const w of [both, rear]) for (let i = 0; i < 6 * 240; i++) w.sim.step(1 / 240);
    ok('either side, and the rear push, make the wall lift by about the same', both.sim.maxPhi > 0 && Math.abs(both.sim.maxPhi - rear.sim.maxPhi) <= 0.25 * rear.sim.maxPhi, [both.sim.maxPhi, rear.sim.maxPhi]);
  }
}

/* ---- 11. cabinet locks: loads shared through the locks, and the most loaded lock letting go first ---- */
{
  const f64 = (...a) => Float64Array.from(a);
  // two cabinets side by side, the load on the first one only; worked by hand: (g + k) w0 - k w1 = F, (g + k) w1 - k w0 = 0, with g = k = 1
  let r = M.lockNet({ cols: 2, rows: 1, F: f64(1, 0), fixN: 1, lockN: 1, kl: 1, Tf: 0, Tl: 0 });
  eq('the loaded cabinet moves 2/3', r.x[0], 2 / 3, 1e-9); eq('its neighbour 1/3', r.x[1], 1 / 3, 1e-9);
  eq('the lock between them carries 1/3', r.lockH[0], 1 / 3, 1e-9);
  eq('the frame holds the whole load', r.reaction, 1, 1e-9);
  ok('nothing is entered, so nothing lets go', r.events.length === 0 && r.lamFirst === Infinity);
  // a stiffer lock shares more: k = 3 gives w1 = 3/4 w0 ... (1 + 3) w0 - 3 w1 = 1, (1 + 3) w1 - 3 w0 = 0
  r = M.lockNet({ cols: 2, rows: 1, F: f64(1, 0), fixN: 1, lockN: 1, kl: 3, Tf: 0, Tl: 0 });
  eq('a stiff lock shares more', r.x[1] / r.x[0], 3 / 4, 1e-9); eq('and the loaded one moves 4/7', r.x[0], 4 / 7, 1e-9);
  // two fixings of 3 N under a 10 N load: 5 N each, so the first goes at 0.6, and the second takes 10 N at once
  r = M.lockNet({ cols: 1, rows: 1, F: f64(10), fixN: 2, lockN: 0, kl: 1, Tf: 3, Tl: 0, lamStop: 2 });
  eq('two 3 N fixings under 10 N give way at 0.6', r.lamFirst, 0.6, 1e-9);
  ok('the second goes at the same load and the cabinet comes off', r.events.length === 2 && r.events[1].lam === r.events[0].lam && r.events[1].lost[0] === 0 && r.lostAt(0.6) === 1 && r.lostAt(0.59) === 0, JSON.stringify(r.events.map((e) => e.lam)));
  // an even load: every cabinet carries its own load, nothing is shared, so nothing is weaker than anything else and they all let go together
  r = M.lockNet({ cols: 4, rows: 3, F: new Float64Array(12).fill(4), fixN: 2, lockN: 2, kl: 1, Tf: 1, Tl: 1, lamStop: 5 });
  eq('an even load goes straight into each cabinet\'s own fixings', r.fixF[5], 2, 1e-9);
  ok('and the locks carry none of it', Math.max(...r.lockH, ...r.lockV) < 1e-9);
  ok('so the whole wall goes at once', r.events[0].n === 12 && Math.abs(r.events[0].lam - 0.5) < 1e-9 && r.events[r.events.length - 1].lostTotal === 12);
  // an uneven load: the cabinet that is pulled hardest goes first, and its neighbour that has to take over comes next
  const F3 = f64(1, 1, 3, 1, 1);
  r = M.lockNet({ cols: 5, rows: 1, F: F3, fixN: 1, lockN: 1, kl: 1, Tf: 4, Tl: 0, lamStop: 10 });
  ok('the cabinet pulled hardest goes first', r.events[0].rep.i === 2 && r.fixAt === 2, r.events[0].rep.i);
  ok('loads and failure loads are in order', r.events.every((e, i) => i === 0 || e.lam >= r.events[i - 1].lam - 1e-12));
  // locks that cannot break (not entered) hold a cabinet whose fixings have gone, and hand its load to the neighbours
  const keep = M.lockNet({ cols: 3, rows: 1, F: f64(1, 6, 1), fixN: 1, lockN: 2, kl: 1, Tf: 2.5, Tl: 0, lamStop: 10 });
  ok('a cabinet with no fixing left but locked to its neighbours stays on', keep.events[0].rep.i === 1 && keep.events[0].lost.length === 0, JSON.stringify(keep.events[0]));
  // doubling the strength doubles the load it takes; doubling the load halves it
  const mk = (F, Tf) => M.lockNet({ cols: 6, rows: 4, F, fixN: 2, lockN: 2, kl: 1, Tf, Tl: Tf, lamStop: 100 });
  const F6 = Float64Array.from({ length: 24 }, (_, i) => 3 + (i % 5) + Math.floor(i / 6) * 0.5);
  eq('twice the strength, twice the load', mk(F6, 20).lamFirst / mk(F6, 10).lamFirst, 2, 1e-9);
  eq('twice the load, half the load factor', mk(F6.map((v) => v * 2), 10).lamFirst / mk(F6, 10).lamFirst, 0.5, 1e-9);
  // equilibrium for any network: what the frame holds is exactly what the wind pulls
  for (const [c, rw, fx, lk, kl] of [[3, 3, 1, 1, 0.2], [7, 2, 4, 3, 5], [1, 6, 2, 0, 1], [9, 9, 2, 2, 1]]) {
    const F = Float64Array.from({ length: c * rw }, (_, i) => 1 + (i * 7) % 5);
    const q = M.lockNet({ cols: c, rows: rw, F, fixN: fx, lockN: lk, kl, Tf: 0, Tl: 0 });
    eq('equilibrium ' + c + 'x' + rw, q.reaction, q.load, 1e-8);
  }

  // the loads of the load in play
  const lk = (o, so) => base(Object.assign({ locks: Object.assign({ on: true, fixKgf: 0, fixN: 2, lockKgf: 0, lockN: 2, edge: 1, stiff: 1 }, so || {}) }, o || {}));
  const forS = (S) => { const D = M.derive(S); return { D, L: M.locksFor(S, D) }; };
  ok('off means nothing is computed', M.locksFor(base(), M.derive(base())) === null);
  let { D: Dl, L } = forS(lk());
  ok('the sheet wall is 28 x 14 cabinets of 0.5 m', L.cols === 28 && L.rows === 14 && L.n === 392);
  eq('with no edge factor the cabinets together carry the sheet\'s wind force', L.load.total * M.G, Dl.F.N, 1e-9);
  eq('an even load goes into each cabinet\'s own fixings: half of one cabinet\'s share', L.peak.fix, L.load.mean / 2, 1e-6);
  eq('the strength you need is the busiest fixing times your margin', L.need.fix, L.peak.fix * 1.5, 1e-12);
  ok('nothing entered: no verdict', L.status === 'none' && L.useKind === 'relative');
  ({ D: Dl, L } = forS(lk({}, { edge: 2 })));
  ok('the top corners feel the most wind', L.peak.fixAt === 13 * 28 || L.peak.fixAt === 13 * 28 + 27, L.peak.fixAt);
  eq('a corner cabinet feels the edge factor on its top and on its side: 3 times at 2', L.F[13 * 28] / L.F[5 * 28 + 10], 3, 1e-6);
  eq('an edge cabinet feels it once: 2 times', L.F[13 * 28 + 10] / L.F[5 * 28 + 10], 2, 1e-6);
  const out = forS(lk({ mode: 'outdoor', outSpeed: 10, profile: 'open' }, { edge: 1 })).L;
  ok('outdoors the cabinets higher up feel more wind', out.F[13 * 28 + 10] > out.F[0 * 28 + 10] * 1.1, [out.F[13 * 28 + 10], out.F[10]]);
  // entering the strength that exactly matches the busiest fixing times the margin: the first one lets go at the margin
  const need = forS(lk({}, { edge: 2 })).L.need.fix;
  L = forS(lk({}, { edge: 2, fixKgf: need })).L;
  eq('a fixing rated at the strength you need lets go at the margin', L.lamFirst, 1.5, 1e-6);
  ok('so the verdict is that it holds the margin, with nothing at all coming off', L.status === 'ok' && L.lostAt1 === 0 && L.lostAtSF === 0, L.status);
  L = forS(lk({}, { edge: 2, fixKgf: need * 0.9 })).L;
  ok('a bit weaker, and it lets go inside the margin', L.status === 'marginal' && L.lamFirst < 1.5 && L.lamFirst > 1, [L.status, L.lamFirst]);
  L = forS(lk({}, { edge: 2, fixKgf: need * 0.5 })).L;
  ok('half as strong, and it lets go at your wind', L.status === 'fail' && L.lamFirst < 1, [L.status, L.lamFirst]);
  ok('the first lock to go is on a top corner', [13 * 28, 13 * 28 + 27].indexOf(L.events[0].rep.i) >= 0 && L.events[0].rep.kind === 0, JSON.stringify(L.events[0].rep));
  eq('wind speed at the first failure is the peak speed times the root of the load factor', L.limit.v, Dl.wind.vPeak * Math.sqrt(L.lamFirst), 1e-9);

  // which loads pull the cabinets off the frame
  ok('wind from the front presses the cabinets onto the frame', !forS(lk({ windDir: 180 })).L.active && forS(lk({ windDir: 180 })).L.status === 'inactive');
  ok('wind from the rear pulls them off', forS(lk({ windDir: 0 })).L.active);
  ok('a push from the front does not pull a cabinet off', !forS(lk({ indoorCase: 'knock', knock: { kgf: 40, h: 1.2, from: 'front', dur: 0.3, share: 2 } })).L.active);
  const kn = forS(lk({ indoorCase: 'knock', knock: { kgf: 40, h: 1.2, from: 'rear', dur: 0.3, share: 2 } })).L;
  eq('a knock is one push on one cabinet', kn.load.total * M.G, 40 * M.G, 1e-9);
  ok('on the cabinet at that height, in the middle of the wall', kn.knockAt === Math.floor((1.2 - 0.1) / 0.5) * 28 + 14, kn.knockAt);
  ok('and the neighbours take part of it through the locks', kn.peak.lock > 0 && kn.peak.fix < 40 / 2 - 1e-6, [kn.peak.fix, kn.peak.lock]);
  const qk = forS(lk({ indoorCase: 'quake' })).L;
  eq('an earthquake shakes every cabinet by its own weight times the acceleration', qk.F[100] * M.G, 6.6 * 0.24 * M.G, 1e-6);
  ok('a shake pulls them off one way or the other, so it is checked', qk.active);

  // failures within 3% of each other are shown as one step: the steps cover every failure, in order, and add up
  { const g = forS(lk({ indoorCase: 'knock', knock: { kgf: 60, h: 1.2, from: 'rear', dur: 0.3, share: 2 }, ballastAuto: false, ballastPer: 9.055 }, { fixKgf: 6, lockKgf: 6, edge: 1.5 })).L;
    ok('a hard shove on one cabinet with weak locks is one step', g.groups.length === 1 && g.groups[0].lostTotal === 1 && g.groups[0].lost[0] === g.knockAt, JSON.stringify(g.groups.map((x) => [x.lam, x.n, x.lostTotal])));
    eq('and only that cabinet comes off at your load: one cabinet breaks, the rest stand', g.lostAt1, 1, 0);
    ok('the neighbours that lost a lock are marked, the cabinet itself too', g.groups[0].hit.length === 5 && g.groups[0].hit.indexOf(g.knockAt) >= 0, g.groups[0].hit.length);
    eq('every failure is in some step', g.groups.reduce((a, x) => a + x.n, 0), g.events.reduce((a, x) => a + x.n, 0), 0);
    ok('steps are in order of load', g.groups.every((x, i) => i === 0 || x.lam > g.groups[i - 1].lam * 1.03 - 1e-12)); }

  // the simulation: locks let go as the load passes their limit, once each, and a restart puts everything back
  const wk = lk({ mode: 'outdoor', outSpeed: 12, gust: 0.3, profile: 'open', ballastAuto: true }, { edge: 2, fixKgf: need * 1.6, lockKgf: 0 });
  const Dw = M.derive(wk), Lw = M.locksFor(wk, Dw), sm = new M.Sim(); sm.setRig(Dw, wk); sm.setLocks(Lw); sm.reset();
  ok('the weak-lock wind case has something to let go', Lw.events.length > 0 && Lw.lamFirst < 1.0 * 1.6 / 1.5 + 1e-9, Lw.lamFirst);
  let first = -1, count = 0, peakAtFirst = 0;
  for (let i = 0; i < 30 * 240; i++) { sm.step(1 / 240); if (sm.lkI > 0 && first < 0) { first = sm.t; peakAtFirst = sm.lamPeak; } count = sm.lkCount; }
  ok('nothing comes off at the start, and the first lock goes when the load has reached its limit', first > 0.1 && peakAtFirst >= Lw.lamFirst * (1 - 1e-9) && peakAtFirst < Lw.events[Math.min(Lw.events.length - 1, 5)].lam + 0.05, [first, peakAtFirst, Lw.lamFirst]);
  eq('what has come off is what the sequence says for the highest load reached', count, Lw.net.lostAt(sm.lamPeak), 0);
  ok('each event fired once, in order', sm.lkI === Lw.events.filter((e) => e.lam <= sm.lamPeak * (1 + 1e-9)).length, [sm.lkI, sm.lamPeak]);
  sm.reset();
  ok('a restart puts the cabinets back', sm.lkI === 0 && sm.lkCount === 0 && sm.lamPeak === 0 && sm.lkLost.every((v) => v === 0));
  sm.setLocks(M.locksFor(wk, Dw)); for (let i = 0; i < 240; i++) sm.step(1 / 240);
  ok('a new but identical lock result does not wipe the state', sm.lkSig === Lw.sig && sm.lamPeak > 0);
}

const D1 = M.derive(base({ mode: 'outdoor' }));
console.log('outdoor default: req per base', D1.req.per.toFixed(1), 'peak v', D1.wind.vPeak.toFixed(2), 'bft', D1.wind.bft, 'top deflection', (D1.bend.topEl * 1000).toFixed(1), 'mm (H/' + D1.bend.ratio.toFixed(0) + ')', 'seam', (D1.bend.seamOpen * 1000).toFixed(3), 'mm');
console.log(fails ? 'TESTS FAILED: ' + fails + ' of ' + checks : 'ALL ' + checks + ' CHECKS PASSED');
process.exit(fails ? 1 : 0);
