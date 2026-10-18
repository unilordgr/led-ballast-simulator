/* ===== model.js (v2) : ballast sheet + stage + straps + bending + rocking dynamics =====
   Pure functions, no DOM. Runs in the browser (global LEDModel) and in Node (tests).

   Physics in one paragraph. The wall is a rigid body that can rock about a toe (the sheet's check), and also a cantilever that bends
   (Timoshenko beam fixed at its base). Wind pushes on it. Straps, cables or a rear truss are springs from an attach point to an
   anchor. For every rotation phi about the toe the model solves the load factor lambda at which moments balance, including the
   spring force that the wall's own bending and rotation produce. The largest lambda reached before a strap hits its limit is the
   safety factor. With no strap and no stage this collapses to the sheet's formula exactly. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LEDModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G = 9.8;                       // the sheet converts N to kgf with 9.8
  const CAB = { w: 0.5 };              // cabinet width, sheet cell C7 (height is 0.5 or 1.0 m, see cabHeight)
  const SHEET = {
    depth: 0.922, frameArm: 0.46, ballastRear: 0.862, ballastMid: 0.46, screenBottom: 0.1,
    frame: { perRow: 4, perBase: 4.15, perW: 7.9 }   // C10 = 4*rows*bases + 4.15*bases + 7.9*width (rows are 1 m)
  };
  const MAX_BALLAST = 5000;            // kg per base, cap for the auto solver
  const RHO_FACTOR = 0.625;            // q = 0.5 * 1.25 * v^2 (the sheet's pressure table)
  const SF_CAP = 99;

  // Sheet table I4:K14. Scale 1 lists 0.14 N/m2 for 1.5 m/s; 0.625*1.5^2 = 1.4, so 0.14 is a typo.
  const SCALE = [
    { n: 0, v: 0.2, q: 0.025, name: 'Calm' }, { n: 1, v: 1.5, q: 1.4, name: 'Light air' }, { n: 2, v: 3.3, q: 6.8, name: 'Light breeze' },
    { n: 3, v: 5.4, q: 18.2, name: 'Gentle breeze' }, { n: 4, v: 7.9, q: 39, name: 'Moderate breeze' }, { n: 5, v: 10.7, q: 71.6, name: 'Fresh breeze' },
    { n: 6, v: 13.8, q: 119, name: 'Strong breeze' }, { n: 7, v: 17.1, q: 182.8, name: 'Near gale' }, { n: 8, v: 20.7, q: 267.8, name: 'Gale' },
    { n: 9, v: 24.4, q: 372.1, name: 'Strong gale' }, { n: 10, v: 28.4, q: 504.1, name: 'Storm' }
  ];
  const BFT_UPPER = [0.2, 1.5, 3.3, 5.4, 7.9, 10.7, 13.8, 17.1, 20.7, 24.4, 28.4, 32.6];
  const BFT_NAME = ['Calm', 'Light air', 'Light breeze', 'Gentle breeze', 'Moderate breeze', 'Fresh breeze',
    'Strong breeze', 'Near gale', 'Gale', 'Strong gale', 'Storm', 'Violent storm', 'Hurricane force'];
  // Picking a Beaufort force sets the top of its speed range, as the sheet's wind table does (force 12 has no top: 36.9 m/s ends the usual scale).
  const BFT_SPEED = BFT_UPPER.concat([36.9]);
  const bftRange = (n) => ({ lo: n <= 0 ? 0 : Math.round((BFT_UPPER[n - 1] + 0.1) * 10) / 10, hi: n >= 12 ? null : BFT_UPPER[n] });

  // Indoor load cases. 'wind' pushes on the whole screen like moving air, 'force' is a push at one height,
  // 'accel' is the floor or deck moving under the wall (every mass feels an inertia force, up and down too).
  const CASES = ['draught', 'door', 'knock', 'sway', 'quake', 'notional'];
  const CASE_KIND = { draught: 'wind', door: 'wind', knock: 'force', sway: 'accel', quake: 'accel', notional: 'accel' };
  const CASE_NAME = { draught: 'Draught', door: 'Door gust', knock: 'Knock or push', sway: 'Stage sway', quake: 'Earthquake', notional: 'Code minimum' };
  // Design ground acceleration of the three Greek seismic zones (Greek National Annex to Eurocode 8).
  const QUAKE_ZONES = [{ zone: 'I', g: 0.16 }, { zone: 'II', g: 0.24 }, { zone: 'III', g: 0.36 }];

  // Cabinets, by module size. Weight per cabinet and depth are the manufacturer datasheet values (see notes); kg/m2 = kg / area.
  const CABINETS = [
    { id: 'sheet5', size: '500x500', name: 'Sheet value', kg: 6.6, depth: 0.0833, note: '26.4 kg/m² from the ballast sheet, which is 6.6 kg per 500×500 cabinet.' },
    { id: 'uslim2', size: '500x500', name: 'Unilumin Uslim2 indoor', kg: 7.8, depth: 0.0833, note: '7.8 kg per 500×500×83.3 mm die-cast aluminium cabinet (Unilumin datasheet V1.5).' },
    { id: 'ugc', size: '500x500', name: 'Unilumin UGC rental', kg: 5.6, depth: 0.07, note: '5.6 kg per 500×500×70 mm panel (distributor listing).' },
    { id: 'uslimO3', size: '500x500', name: 'Unilumin USlim-O3 outdoor', kg: 14.8, depth: 0.0833, note: '14.8 kg per 500×500×83.3 mm cabinet, IP65 (Unilumin USA sheet).' },
    { id: 'custom5', size: '500x500', name: 'Custom', kg: 6.6, depth: 0.0833, note: 'Set the weight yourself.' },
    { id: 'sheet10', size: '500x1000', name: 'Sheet value', kg: 13.2, depth: 0.0833, note: '26.4 kg/m² from the ballast sheet, which is 13.2 kg per 500×1000 cabinet.' },
    { id: 'uslim4', size: '500x1000', name: 'Unilumin Uslim4 indoor', kg: 13, depth: 0.0833, note: '13 kg per 500×1000×83.3 mm die-cast aluminium cabinet (Unilumin datasheet V1.5).' },
    { id: 'uslimO4', size: '500x1000', name: 'Unilumin USlim-O4 outdoor', kg: 33, depth: 0.086, note: '32 to 34 kg per 500×1000×86 mm cabinet, IP66 front (Unilumin USA sheet).' },
    { id: 'custom10', size: '500x1000', name: 'Custom', kg: 13.2, depth: 0.0833, note: 'Set the weight yourself.' }
  ];
  const cabArea = (size) => (size === '500x1000' ? 0.5 : 0.25);
  const cabHeight = (size) => (size === '500x1000' ? 1.0 : 0.5);
  CABINETS.forEach((c) => { c.kgm2 = c.kg / cabArea(c.size); });
  // Rated elongation at rated load: ratchet strap 7% (EN 12195-2 limit), steel cable with turnbuckle 0.4%, rigid truss member 0.03%.
  const RESTRAINT = {
    strap: { name: 'Ratchet strap', eps: 0.07 },
    cable: { name: 'Steel cable', eps: 0.004 },
    truss: { name: 'Rear truss', eps: 0.0003 }
  };
  const PROFILE_ALPHA = { uniform: 0, open: 0.14, suburban: 0.22, urban: 0.30 };

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const sum = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

  function beaufort(v) { for (let n = 0; n < BFT_UPPER.length; n++) if (v <= BFT_UPPER[n]) return n; return 12; }

  function defaults() {
    return {
      mode: 'indoor',
      W: 14, H: 7, kgm2: 26.4, cabSize: '500x500', cab: 'sheet5', cabDepth: 0.0833, SF: 1.5,
      N: 14, autoN: true,
      ballastAuto: true, ballastPer: 9, ballast: null, ballastPos: 'auto',
      indoorScale: 2, outSpeed: 8, gust: 0.3, facing: 180, windDir: 0, profile: 'uniform',
      indoorCase: 'draught',
      door: { v: 5.4, dur: 2 },                                   // m/s at the screen, seconds
      knock: { kgf: 25, h: 1.2, from: 'both', dur: 0.3, share: 2 }, // kgf, metres above the base, 'front' | 'rear' | 'both', seconds, bases that share it
      sway: { amp: 5, f: 1.5, bounce: 0 },                        // mm, Hz, up-and-down shake as a fraction of g
      quake: { pga: 0.24, floor: 1, dur: 12 },                    // ground acceleration in g, building amplification, seconds
      notional: { pct: 2.5 },                                     // % of the weight, sideways
      Cf: 1.0, depth: SHEET.depth, mu: 0.5,
      frame: { perRow: SHEET.frame.perRow, perBase: SHEET.frame.perBase, perW: SHEET.frame.perW },
      EI: 2.9e6, gaRatio: 0.12, defLimit: 150,
      stage: { on: false, h: 1.2, depth: 6, extra: 2, front: 4.6, deckKgm2: 40, rating: 750, muDeck: 0.4, muFloor: 0.5 },
      rest: { type: 'none', n: 0, a: 0, d: 0, to: 'floor', wll: 2000, slack: 0, anchorKg: 0, side: 'rear' }
    };
  }

  function rigPhiCrit(sys) {
    let mx = 0, my = 0; for (const k of sys.comps) { mx += k.m * k.xi; my += k.m * k.eta; }
    return Math.atan2(mx, my);
  }
  function sheetBases(S) { return Math.max(1, Math.ceil(Math.round(S.W / CAB.w) / 2)); }

  function windInfo(S) {
    let vMean, qMean, pk;
    if (S.mode === 'indoor' && S.indoorCase === 'door') {
      vMean = S.door.v; qMean = RHO_FACTOR * vMean * vMean; pk = 1;
    } else if (S.mode === 'indoor') {
      const row = SCALE[clamp(Math.round(S.indoorScale), 0, SCALE.length - 1)];
      vMean = row.v; qMean = row.q; pk = 1;
    } else {
      vMean = S.outSpeed; qMean = RHO_FACTOR * vMean * vMean; pk = 1 + S.gust;
    }
    return { vMean, qMean, pk, vPeak: vMean * pk, qPeak: qMean * pk * pk };
  }

  /* ---------- rigid-body scan ----------
     sys = { comps:[{m,xi,eta,Ig}], F (N), hc (m), xiw (m), strap|null }
     Returns the load factor lambda at which the moments balance for each rotation phi, and the best one. */
  function momentsAt(sys, phi) {
    // sys.acc: the floor accelerates sideways by acc, so every mass m gets a force m*acc at its own height; sys.gs scales the weights
    // (a floor dropping away makes the wall lighter, one pushing up makes it heavier).
    const c = Math.cos(phi), s = Math.sin(phi), gs = sys.gs === undefined ? 1 : sys.gs;
    let Mr = 0, Ti = 0;
    for (const k of sys.comps) { Mr += k.m * G * (k.xi * c - k.eta * s); Ti += k.m * (k.eta * c + k.xi * s); }
    return { c, s, Mr: Mr * gs, M1: sys.acc ? sys.acc * Ti : sys.F * c * (sys.hc * c + sys.xiw * s) };
  }
  function strapGamma(st, c, s) {            // moment arm of the horizontal strap force about the toe (vertical component included)
    return (st.aPiv * c + st.xiAtt * s) + st.sgnV * st.tanb * (st.xiAtt * c - st.aPiv * s);
  }
  function lamAt(sys, phi) {
    const { c, s, Mr, M1 } = momentsAt(sys, phi), st = sys.strap;
    if (!st) return { lam: M1 > 1e-12 ? Mr / M1 : Infinity, Ph: 0, over: false, Mr, M1, Gam: 0 };
    const Gam = strapGamma(st, c, s);
    const den = M1 - st.c0 * st.dp1 * Gam;
    const lamFree = M1 > 1e-12 ? Mr / M1 : Infinity;                     // strap slack
    let lam, Ph = 0;
    if (lamFree * st.dp1 + phi * st.aPiv - st.gp <= 0) lam = lamFree;
    else if (den > 1e-9 * Math.max(1, M1)) {
      lam = (Mr + st.c0 * (phi * st.aPiv - st.gp) * Gam) / den;
      Ph = st.c0 * (lam * st.dp1 + phi * st.aPiv - st.gp);
    } else { lam = Infinity; Ph = Infinity; }
    return { lam, Ph, over: Ph > st.PhCap, Mr, M1, Gam };                // over: the strap would be past its rated load
  }
  function scanSys(sys, targets) {
    const out = { lamMax: 0, phiAtMax: 0, lam0: 0, capped: false, eq: {} };
    const st = sys.strap, n = st ? 260 : 0, phiMax = 0.2;                    // a wall leaning more than about 11 degrees has failed in practice
    const want = (targets || []).map((t) => ({ t, phi: null, Ph: 0 }));
    let prev = null, dipped = false;
    for (let i = 0; i <= n; i++) {
      const phi = phiMax * (i / Math.max(n, 1)) * (i / Math.max(n, 1));
      const r = lamAt(sys, phi);
      if (r.over) {
        // The strap reaches its rated load on the way from the last good state to this one. A strap that gets there has failed,
        // so the safety factor is the load at that point, not what the base could take with the strap still pulling.
        let phiStar = 0, lamStar;
        if (!prev) lamStar = Math.max(0, (st.PhCap / st.c0 + st.gp) / Math.max(st.dp1, 1e-300));
        else {
          let lo = prev.phi, hi = phi;
          for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (lamAt(sys, mid).over) hi = mid; else lo = mid; }
          phiStar = lo; lamStar = lamAt(sys, lo).lam;
        }
        if (i === 0) out.lam0 = lamStar;
        if (lamStar > out.lamMax && !dipped) { out.lamMax = lamStar; out.phiAtMax = phiStar; }
        out.capped = true;
        break;
      }
      if (i === 0) out.lam0 = r.lam;
      // Follow the load path. If it dips (a slack strap lets the wall rotate before it pulls) the wall falls through the dip and the
      // strap then takes a shock load, so nothing beyond the first peak counts. Dips under 3% are treated as flat.
      if (st && r.lam < out.lamMax * 0.97) dipped = true;
      if (r.lam > out.lamMax) {
        if (dipped) break;
        out.lamMax = r.lam; out.phiAtMax = phi;
      }
      for (const w of want) {
        if (w.phi !== null) continue;
        if (i === 0 && r.lam >= w.t) { w.phi = 0; w.Ph = st ? st.c0 * Math.max(0, w.t * st.dp1 - st.gp) : 0; }
        else if (prev && r.lam >= w.t && prev.lam < w.t) {
          const f = (w.t - prev.lam) / (r.lam - prev.lam); w.phi = prev.phi + f * (phi - prev.phi);
          w.Ph = st ? Math.min(st.PhCap, st.c0 * Math.max(0, w.t * st.dp1 + w.phi * st.aPiv - st.gp)) : 0;
        }
      }
      prev = { phi, lam: r.lam };
      if (!st) break;                                                    // weights only: the best load factor is at phi = 0
    }
    for (const w of want) out.eq[w.t] = w.phi === null ? null : { phi: w.phi, Ph: w.Ph };
    return out;
  }

  /* Everything the UI needs, from the raw inputs. `ld` is an indoor load other than wind (see loadFor); null means the sheet's wind. */
  function deriveOne(S, ld) {
    const cabH = cabHeight(S.cabSize);
    const cols = Math.round(S.W / CAB.w), rows = Math.max(1, Math.round(S.H / cabH));
    const A = S.W * S.H, N = Math.max(1, Math.round(S.N));
    const fr = S.frame;
    const Ws = A * S.kgm2;
    const Wf = fr.perRow * S.H * N + fr.perBase * N + fr.perW * S.W;

    const wind = windInfo(S);
    const th = S.windDir * Math.PI / 180, cosT = ld ? (ld.dir === 'front' ? -1 : 1) : Math.cos(th), cn = ld ? 1 : Math.abs(cosT);
    const dir = cosT >= 0 ? 'rear' : 'front';
    wind.cn = cn; wind.dir = dir; wind.sinT = ld ? 0 : Math.sin(th);
    const accel = !!(ld && ld.kind === 'accel'), pushed = !!(ld && ld.kind === 'force');
    wind.bft = beaufort(wind.vPeak); wind.bftName = BFT_NAME[wind.bft]; wind.bftMean = beaufort(wind.vMean);

    const stg = S.stage && S.stage.on ? S.stage : null;
    const hs = stg ? stg.h : 0;
    const y0 = SHEET.screenBottom;
    const L = y0 + S.H;

    // --- base geometry (wall on its deck)
    const dd = S.depth - SHEET.depth;
    const pos = S.ballastPos === 'auto' ? ((ld && ld.pos) || (dir === 'rear' ? 'rear' : 'mid')) : S.ballastPos;   // the sheet puts the ballast mid-base for front wind
    const Lrear = pos === 'rear' ? S.depth - (SHEET.depth - SHEET.ballastRear) : SHEET.ballastMid + dd / 2;
    const Lfront = pos === 'rear' ? SHEET.depth - SHEET.ballastRear : SHEET.ballastMid + dd / 2;
    const aF = dir === 'rear' ? SHEET.frameArm : SHEET.frameArm + dd;
    const aS = dir === 'rear' ? 0 : S.depth;
    const aB = dir === 'rear' ? Lrear : Lfront;
    const ballastX = dir === 'rear' ? Lrear : S.depth - Lfront;
    const hW = S.H / 2 + y0;

    // --- wind load over the height (uniform like the sheet, or a power-law gradient outdoors)
    const alpha = S.mode === 'outdoor' ? (PROFILE_ALPHA[S.profile] || 0) : 0;
    const psi = (zAbs) => (alpha ? Math.pow(Math.max(zAbs, 3) / 10, 2 * alpha) : 1);
    const NS = 24, dz = S.H / NS, zs = new Array(NS), line = new Array(NS);
    let F = 0, M1 = 0;
    const pBase = accel ? ld.acc * (Ws + Wf) / A : wind.qPeak * cn * S.Cf;      // N/m2; for shaking, the inertia of the screen and frame spread over the face
    for (let j = 0; j < NS; j++) {
      const z = y0 + (j + 0.5) * dz, p = pBase * psi(hs + z);
      zs[j] = z; line[j] = p * S.W; F += p * S.W * dz; M1 += p * S.W * dz * z;
    }
    let hc = F > 0 ? M1 / F : hW;
    if (!alpha) { F = A * pBase; hc = hW; }
    if (pushed) {            // a push at one height; the bases that share it stand in for the whole wall, so scale the push up to the wall
      const Feq = ld.P * N / Math.min(N, Math.max(1, Math.round(ld.share || 1)));
      const hk = clamp(ld.h, y0 + 0.05, L), jh = clamp(Math.floor((hk - y0) / dz), 0, NS - 1);
      for (let j = 0; j < NS; j++) line[j] = 0;
      zs[jh] = hk; line[jh] = Feq / dz; F = Feq; hc = hk;
    }
    const Fkgf = F / G, FkgfMean = F / G * (wind.qMean / (wind.qPeak || 1));
    const Mw = Fkgf * hc;                                   // kg*m about the toe, peak, unfactored

    // --- bending beam (Timoshenko cantilever, whole wall in parallel)
    const EIw = N * S.EI, GAw = S.gaRatio * EIw;
    const fl = (z, a) => (z <= a ? z * z * (3 * a - z) / (6 * EIw) : a * a * (3 * z - a) / (6 * EIw)) + Math.min(z, a) / GAw;
    const dpAt = (z) => { let d = 0; for (let j = 0; j < NS; j++) d += line[j] * dz * fl(z, zs[j]); return d; };
    const K = 48, nodeZ = new Array(K + 1), dp1 = new Array(K + 1), Mp = new Array(K + 1);
    for (let k = 0; k <= K; k++) {
      const z = L * k / K; nodeZ[k] = z; dp1[k] = dpAt(z);
      let m = 0; for (let j = 0; j < NS; j++) if (zs[j] > z) m += line[j] * dz * (zs[j] - z);
      Mp[k] = m;
    }

    // --- restraint (strap, cable or rear truss)
    const R = S.rest;
    let sb = null;
    if (R.type !== 'none') {
      const n = R.n > 0 ? Math.round(R.n) : Math.max(1, Math.ceil(S.W / 2));
      const a = clamp(R.a > 0 ? R.a : L, 0.3, L);
      const zA = (R.to === 'floor' && stg) ? hs : 0;
      const d = Math.max(0.5, R.d > 0 ? R.d : (a + zA));
      const Ls = Math.hypot(d, a + zA), cb = d / Ls, sbeta = (a + zA) / Ls;
      const kS = R.wll * G / (RESTRAINT[R.type].eps * Ls);
      const kh = n * kS * cb * cb, Gaa = fl(a, a), c0 = kh / (1 + kh * Gaa);
      const muA = R.to === 'deck' && stg ? stg.muDeck : (stg ? stg.muFloor : S.mu);
      let Tcap = R.wll * G, anchorLim = Infinity;
      if (R.anchorKg > 0) {
        const up = R.anchorKg * G / Math.max(sbeta, 1e-6), sl = muA * R.anchorKg * G / (cb + muA * sbeta);
        anchorLim = Math.min(up, sl); Tcap = Math.min(Tcap, anchorLim);
      }
      sb = { type: R.type, n, a, zA, d, Ls, cb, sb: sbeta, tanb: sbeta / cb, kS, kh, Gaa, c0, dp1a: dpAt(a), gp: 0,
        WLL: R.wll * G, Tcap, anchorLim, PhCap: n * Tcap * cb, to: R.to, side: R.side };
    }
    const restoringSide = dir === 'rear' ? 'rear' : 'front';
    function strapFor(kind, screenXi) {
      if (!sb) return null;
      const compression = sb.type === 'truss' && dir === 'front';
      const active = sb.type === 'truss' ? true : (sb.side === 'both' || sb.side === restoringSide);
      if (!active) return null;
      if (kind === 'S' && sb.to !== 'floor') return null;                  // tied to the deck: internal to stage + wall
      const aPiv = (kind === 'S' ? hs : 0) + sb.a;
      const xiAtt = compression ? screenXi - 0.3 : (dir === 'rear' ? screenXi + 0.3 : screenXi + 0.05);
      return { kh: sb.kh, c0: sb.c0, dp1: sb.dp1a, gp: compression ? 0 : sb.gp, PhCap: sb.PhCap, tanb: sb.tanb, sgnV: compression ? -1 : 1, aPiv, xiAtt, compression };
    }

    // --- stage
    let stage = null, xi0 = 0, xiScreenS = 0, stageMass = 0;
    if (stg) {
      const width = S.W + stg.extra, area = stg.depth * width;
      stageMass = stg.deckKgm2 * area;
      xi0 = dir === 'rear' ? stg.front : (stg.depth - stg.front - S.depth);
      xiScreenS = dir === 'rear' ? stg.front : (stg.depth - stg.front);
      stage = { h: stg.h, depth: stg.depth, width, area, mass: stageMass, front: stg.front, rearGap: stg.depth - stg.front - (S.depth + 0.1), rating: stg.rating,
        xFront: stg.front, xRear: -(stg.depth - stg.front) };
    }
    const compsW = (B) => [
      { m: Ws, xi: aS, eta: y0 + S.H / 2, Ig: Ws * S.H * S.H / 12 },
      { m: Wf, xi: aF, eta: y0 + S.H / 2, Ig: Wf * S.H * S.H / 12 },
      { m: B, xi: aB, eta: y0 + 0.12, Ig: 0 }];
    const inert = accel ? { acc: ld.acc, gs: ld.gs } : null;           // shaking: inertia of every mass, and a lighter or heavier wall
    const useS = !!stg && !(ld && ld.systems && ld.systems.S === false);   // deck sway moves the deck under the wall, not the stage on the floor
    const sysW = (B) => Object.assign({ kind: 'W', comps: compsW(B), F, hc, xiw: aS, strap: strapFor('W', aS) }, inert);
    const sysS = (B) => {
      const c = compsW(B).map((k) => ({ m: k.m, xi: k.xi + xi0, eta: k.eta + hs, Ig: k.Ig }));
      c.push({ m: stageMass, xi: stg.depth / 2, eta: 0.55 * hs, Ig: stageMass * (stg.depth * stg.depth + hs * hs) / 12 });
      return Object.assign({ kind: 'S', comps: c, F, hc: hs + hc, xiw: xiScreenS, strap: strapFor('S', xiScreenS) }, inert);
    };
    const lamOf = (B) => {
      const w = scanSys(sysW(B)), s = useS ? scanSys(sysS(B)) : null;
      const lamW = Math.min(w.lamMax, SF_CAP * 10), lamS = s ? Math.min(s.lamMax, SF_CAP * 10) : Infinity;
      return { lamW, lamS, lam: Math.min(lamW, lamS), gov: lamS < lamW ? 'S' : 'W' };
    };

    // --- required ballast: closed form without straps (sheet formula), bisection with straps
    let reqTotalRaw, reqTotal, capHit = false;
    const hasStrap = !!(strapFor('W', aS) || (useS && strapFor('S', xiScreenS)));
    const reqClosed = (kind) => {
      const sys = kind === 'W' ? sysW(0) : sysS(0);
      const bl = kind === 'W' ? aB : aB + xi0;
      let Mr0 = 0; for (const k of sys.comps) Mr0 += k.m * k.xi;
      return (S.SF * Fkgf * sys.hc - Mr0) / bl;
    };
    if (!hasStrap && !accel) {                                   // the load does not depend on the ballast: closed form, as in the sheet
      reqTotalRaw = reqClosed('W');
      if (useS) reqTotalRaw = Math.max(reqTotalRaw, reqClosed('S'));
      reqTotal = Math.max(0, reqTotalRaw);
    } else {                                                     // straps, or shaking (the ballast itself adds inertia): bisection
      const ok = (B) => lamOf(B).lam >= S.SF - 1e-9;
      if (ok(0)) { reqTotal = 0; reqTotalRaw = 0; }
      else {
        let lo = 0, hi = MAX_BALLAST * N;
        if (!ok(hi)) { reqTotal = hi; capHit = true; } else { for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; } reqTotal = hi; }
        reqTotalRaw = reqTotal;
      }
    }
    const reqPer = reqTotal / N;

    let ballast;
    if (S.ballastAuto) ballast = new Array(N).fill(ld && ld.ballastPer != null ? ld.ballastPer : Math.min(reqPer, MAX_BALLAST));
    else ballast = Array.from({ length: N }, (_, i) => (S.ballast && S.ballast[i] != null ? S.ballast[i] : S.ballastPer));
    const Wb = sum(ballast);

    // --- the answer: safety factor of the governing system
    const lm = lamOf(Wb);
    const SFact = Math.min(lm.lam, 1e9);
    const status = SFact >= S.SF - 1e-9 ? 'stable' : (SFact >= 1 - 1e-9 ? 'marginal' : 'tipping');
    const gov = lm.gov, sysG = gov === 'S' ? sysS(Wb) : sysW(Wb);
    const lamC = Math.min(SFact, S.SF);
    const scanG = scanSys(sysG, [1, lamC]);
    const eq1 = scanG.eq[1], eqC = scanG.eq[lamC];

    // --- moments (kg*m) about the governing pivot, at the check state
    const stC = eqC || { phi: scanG.phiAtMax, Ph: 0 };
    const cC = Math.cos(stC.phi), sC = Math.sin(stC.phi);
    const gsG = sysG.gs === undefined ? 1 : sysG.gs;
    const part = (k) => k.m * (k.xi * cC - k.eta * sC) * gsG;
    const Mpart = { s: part(sysG.comps[0]), f: part(sysG.comps[1]), b: part(sysG.comps[2]), stage: stg && gov === 'S' ? part(sysG.comps[3]) : 0, strap: 0 };
    if (sysG.strap) Mpart.strap = stC.Ph * strapGamma(sysG.strap, cC, sC) / G;
    const Fdisp = sysG.acc ? sysG.acc * sum(sysG.comps.map((k) => k.m)) : F;           // N: the push, or the inertia of everything that moves
    const TiG = sysG.acc ? sysG.comps.reduce((t, k) => t + k.m * (k.eta * cC + k.xi * sC), 0) : 0;
    const MwG = sysG.acc ? sysG.acc * TiG / G : (gov === 'S' ? hs + hc : hc) * Fkgf;
    const M = { w: MwG, wSF: S.SF * MwG, s: Mpart.s, f: Mpart.f, b: Mpart.b, stage: Mpart.stage, strap: Mpart.strap, rest: Mpart.s + Mpart.f + Mpart.b + Mpart.stage + Mpart.strap, gov };
    const aBgov = gov === 'S' ? aB + xi0 : aB;
    const MwShare = MwG / N, base0 = (M.rest - M.b) / N;
    const local = ballast.map((b) => (MwShare > 1e-9 ? SFact + (b - Wb / N) * aBgov / MwShare : Infinity));

    // --- limits (peak wind speed scales as sqrt(load factor))
    const vCritPeak = isFinite(SFact) && F > 0 ? wind.vPeak * Math.sqrt(SFact) : Infinity;
    const vAllowPeak = isFinite(SFact) && F > 0 ? wind.vPeak * Math.sqrt(SFact / S.SF) : Infinity;
    const limits = { vCritPeak, vAllowPeak, vCritMean: vCritPeak / wind.pk, vAllowMean: vAllowPeak / wind.pk, kind: accel ? 'accel' : pushed ? 'force' : 'speed' };
    if (accel) {                                  // in g, at the wall's base: the load grows in step with the safety factor
      const a0 = ld.acc / G;
      limits.crit = isFinite(SFact) ? SFact * a0 : Infinity; limits.allow = isFinite(SFact) ? SFact / S.SF * a0 : Infinity;
    } else if (pushed) {                          // in kgf, at the height of the push
      const P0 = ld.P / G;
      limits.crit = isFinite(SFact) ? SFact * P0 : Infinity; limits.allow = isFinite(SFact) ? SFact / S.SF * P0 : Infinity;
    }

    // --- elastic response at the nominal peak wind
    const eq = eq1 || { phi: scanG.phiAtMax, Ph: 0, none: true };
    const sideActive = sb ? (sb.type === 'truss' ? true : (sb.side === 'both' || sb.side === restoringSide)) : false;
    const intStrap = !!(sb && sideActive && !sysG.strap && gov === 'S' && sb.to !== 'floor');
    const Phn = sysG.strap && eq ? eq.Ph : (intStrap ? Math.min(sb.PhCap, sb.c0 * Math.max(0, sb.dp1a - sb.gp)) : 0);
    const phi = eq.phi || 0;
    const tipDir = dir === 'rear' ? 1 : -1;
    const GatNode = sb ? nodeZ.map((z) => fl(z, sb.a)) : nodeZ.map(() => 0);
    const defl = nodeZ.map((z, k) => dp1[k] - Phn * GatNode[k]);                 // elastic, relative to the lifted base (m)
    const bm = nodeZ.map((z, k) => Mp[k] - (sb && z < sb.a ? Phn * (sb.a - z) : 0)); // bending moment (N*m)
    const topEl = defl[K], rigidTop = phi * (L + (gov === 'S' ? hs : 0));
    const Mb = bm[0], kappa = Mb / EIw;
    const t = S.cabDepth || 0.083;
    const seamOpen = kappa * t;                                                   // m, on the tension face
    const bend = { nodeZ, defl, dp1, Gat: GatNode, bm, Mp, topEl, rigidTop, topTot: topEl + rigidTop, ratio: Math.abs(topEl) > 1e-9 ? L / Math.abs(topEl) : Infinity,
      Mb, kappa, seamOpen, seamFront: dir === 'front' ? seamOpen : 0, EIw, GAw, L, limit: L / S.defLimit, phi, lift: Math.sin(phi) * S.depth * 1000 };
    const compressionNow = !!(sb && sb.type === 'truss' && dir === 'front');
    const cfgSide = sb ? (sb.type === 'truss' ? 'rear' : (sb.side === 'front' ? 'front' : 'rear')) : 'rear';
    const actSide = sb ? (sb.type === 'truss' ? 'rear' : (sb.side === 'both' ? restoringSide : sb.side)) : 'rear';
    const lean = { phi, hangs: phi > rigPhiCrit(sysG), liftMm: Math.sin(phi) * (gov === 'S' && stg ? stg.depth : S.depth) * 1000 };
    const strapOut = sb ? {
      type: sb.type, n: sb.n, a: sb.a, d: sb.d, zA: sb.zA, Ls: sb.Ls, cb: sb.cb, sb: sb.sb, active: sideActive, inCheck: !!sysG.strap, internal: intStrap, to: sb.to,
      anchorKgPer: R.anchorKg,
      compression: compressionNow, cfgSide, actSide, side: sb.side,
      attachX: (actSide === 'rear' ? -0.3 : 0.05), anchorX: (actSide === 'rear' ? -0.3 - sb.d : 0.05 + sb.d), anchorY: -sb.zA,
      T: Phn / sb.cb / sb.n, Ttot: Phn / sb.cb, Ph: Phn, WLL: sb.WLL / G, TcapKg: sb.Tcap / G, util: sb.Tcap > 0 ? (Phn / sb.cb / sb.n) / sb.Tcap : 0,
      anchorLimKg: sb.anchorLim / G, anchorLimited: sb.anchorLim < sb.WLL, PhCap: sb.PhCap, kS: sb.kS
    } : null;

    // --- sliding and deck checks
    const FN = Fdisp, Wwall = (Ws + Wf + Wb) * G;
    const muW = stg ? stg.muDeck : S.mu;
    const PhFloor = strapOut && strapOut.active && (sb.to === 'floor' || !stg) ? Phn : 0;
    const slide = { cap: muW * Wwall + (stg ? 0 : PhFloor), F: FN, SF: FN > 1e-9 ? (muW * Wwall + (stg ? 0 : PhFloor)) / FN : Infinity, mu: muW };
    let slideStage = null, deck = null;
    if (stg) {
      const Wt = (Ws + Wf + Wb + stageMass) * G;
      slideStage = { cap: stg.muFloor * Wt + (sb && strapOut.active && sb.to === 'floor' ? Phn : 0), F: FN, mu: stg.muFloor };
      slideStage.SF = FN > 1e-9 ? slideStage.cap / FN : Infinity;
      const plate = 1.08 * 0.45, maxB = Math.max(...ballast);
      const baseLoad = (Ws + Wf) / N + maxB;
      deck = { rating: stg.rating, local: baseLoad / plate, band: (Ws + Wf + Wb) / (S.W * (S.depth + 0.2)), plate, baseLoad };
    }

    const pivotX = gov === 'S' ? (dir === 'rear' ? stg.front : -(stg.depth - stg.front)) : (dir === 'rear' ? 0 : -S.depth);
    const buildRig = (sys) => {               // everything the rocking simulation needs about one failure system (wall on deck, or stage and wall)
      const internal = !!(sb && sideActive && !sys.strap && sys.kind === 'S' && sb.to !== 'floor');
      const r = {
        m: sys.comps.map((k) => k.m), x: sys.comps.map((k) => k.xi), y: sys.comps.map((k) => k.eta), Ig: sys.comps.map((k) => k.Ig),
        F, hc: sys.hc, xiw: sys.xiw, strap: sys.strap, gov: sys.kind, hs, tipDir,
        bendStrap: internal ? { c0: sb.c0, dp1: sb.dp1a, gp: sb.gp, PhCap: sb.PhCap } : null,
        acc: sys.acc || 0, gs: sys.gs === undefined ? 1 : sys.gs
      };
      r.I = 0; let mx = 0, my = 0;
      for (let i = 0; i < r.m.length; i++) {
        r.I += r.m[i] * (r.x[i] * r.x[i] + r.y[i] * r.y[i]) + r.Ig[i];
        mx += r.m[i] * r.x[i]; my += r.m[i] * r.y[i];
      }
      const Mtot = sum(r.m);
      r.phiCrit = Math.atan2(mx, my); r.xcg = mx / Mtot; r.ycg = my / Mtot;
      return r;
    };
    const rig = buildRig(sysG);
    const rigs = { W: gov === 'W' ? rig : buildRig(sysW(Wb)), S: !useS ? null : (gov === 'S' ? rig : buildRig(sysS(Wb))) };

    // hypothetical ballast -> safety factor (chart, hover tips, other tools)
    const sfOf = (Btot) => Math.min(lamOf(Btot).lam, 1e9);
    const reqPerAtK = (k) => {                                  // kg per base so that the load factor reaches k
      const ok = (B) => lamOf(B).lam >= k - 1e-9;
      if (ok(0)) return 0;
      let lo = 0, hi = MAX_BALLAST * N; if (!ok(hi)) return hi / N;
      for (let i = 0; i < 34; i++) { const mid = (lo + hi) / 2; if (ok(mid)) hi = mid; else lo = mid; }
      return hi / N;
    };
    const reqPerAtSpeed = (v, SFt) => reqPerAtK(Math.pow(v / (wind.vMean || 1), 2) * SFt);    // at mean wind speed v for target SFt
    const reqPerAtLoad = (x, SFt, x0) => reqPerAtK((x / (x0 || 1)) * SFt);                   // loads that grow in step with x (a push, a shake)

    return {
      cols, rows, A, N, Ws, Wf, Wb, wind, dir, pos, cabH,
      spacing: S.W / N, sheetN: sheetBases(S), spacingOK: S.W / N <= 1 + 1e-9,
      geom: { aS, aF, aB, hW, hc, ballastX, depth: S.depth, y0, L, hs, pivotX },
      F: { kgf: Fdisp / G, kgfMean: accel || pushed ? Fdisp / G : FkgfMean, N: Fdisp },
      M, Mpart,
      req: { totalRaw: reqTotalRaw, total: reqTotal, per: reqPer, perRaw: reqTotalRaw / N, none: reqTotal <= 1e-9 && reqTotalRaw <= 0 || ((hasStrap || accel) && reqTotal <= 1e-9), capped: capHit || reqPer > MAX_BALLAST },
      ballast, SFact, status, lam: lm,
      limits,
      slide, slideStage, deck, stage, strap: strapOut, bend, lean, eq: { phi, Ph: Phn, none: !!eq.none, capped: scanG.capped },
      local, rig, rigs, gov, sfOf, reqPerAtSpeed, reqPerAtLoad, profileAlpha: alpha,
      loadKind: accel ? 'accel' : pushed ? 'force' : 'wind',
      sys: { W: sysW, S: stg ? sysS : null }
    };
  }

  /* The load of one indoor case, pushing one way. 'rear' tips the wall forward about the front toe (the sheet's rear wind),
     'front' tips it backward about the rear toe. */
  function loadFor(S, cs, dir) {
    const base = { cs, dir, systems: { W: true, S: true } };
    if (cs === 'knock') {
      const k = S.knock;
      return Object.assign(base, { kind: 'force', P: Math.max(0, k.kgf) * G, h: k.h, share: k.share });
    }
    if (cs === 'sway') {                                  // the deck moves by +-amp at f Hz: peak acceleration (2 pi f)^2 * amp; the bounce makes the wall lighter at the peaks
      const w = 2 * Math.PI * Math.max(0.05, S.sway.f), a = w * w * Math.max(0, S.sway.amp) / 1000;
      return Object.assign(base, { kind: 'accel', acc: a, gs: Math.max(0.05, 1 - Math.max(0, S.sway.bounce)), systems: { W: true, S: false } });
    }
    if (cs === 'quake') {                                 // ground acceleration times the building's amplification, with a vertical shake of half that
      const a = Math.max(0, S.quake.pga) * Math.max(0.1, S.quake.floor);
      return Object.assign(base, { kind: 'accel', acc: a * G, gs: Math.max(0.05, 1 - 0.5 * a) });
    }
    return Object.assign(base, { kind: 'accel', acc: Math.max(0, S.notional.pct) / 100 * G, gs: 1 });     // a notional sideways load as a share of the weight
  }

  /* Everything the UI needs for the selected load case. Shaking, and a push from either side, are checked both ways and the weaker way is reported. */
  function derive(S) {
    const cs = S.mode === 'indoor' ? (S.indoorCase || 'draught') : 'outdoor';
    const kind = CASE_KIND[cs] || 'wind';
    if (kind === 'wind') { const D = deriveOne(S, null); D.loadCase = cs; return D; }
    const from = cs === 'knock' ? S.knock.from : 'both';
    if (from === 'front' || from === 'rear') { const D = deriveOne(S, loadFor(S, cs, from)); D.loadCase = cs; return D; }
    // Where the ballast sits matters when the load can come from either side: at the rear end it does nothing against a backward tip, in the
    // middle it works both ways. With "Auto" try both and keep the one that needs less ballast (a layout that cannot reach the margin at all loses).
    const attempt = (pos) => {
      const ldR = loadFor(S, cs, 'rear'), ldF = loadFor(S, cs, 'front'); ldR.pos = ldF.pos = pos;
      let dR = deriveOne(S, ldR), dF = deriveOne(S, ldF);
      const reqR = dR.req, reqF = dF.req, per = Math.max(reqR.per, reqF.per);
      if (S.ballastAuto) { ldR.ballastPer = ldF.ballastPer = Math.min(per, MAX_BALLAST); dR = deriveOne(S, ldR); dF = deriveOne(S, ldF); }
      return { dR, dF, reqR, reqF, per, sf: Math.min(dR.SFact, dF.SFact), capped: reqR.capped || reqF.capped, pos };
    };
    let best = attempt(S.ballastPos === 'auto' ? 'rear' : S.ballastPos);
    if (S.ballastPos === 'auto') {
      const alt = attempt('mid');
      const better = alt.capped === best.capped ? alt.per < best.per - 1e-9 : best.capped;
      if (better) best = alt;
    }
    const { dR, dF, reqR, reqF, per } = best;
    const D = dR.SFact <= dF.SFact ? dR : dF;
    D.loadCase = cs; D.both = true; D.sides = { fwd: dR, back: dF }; D.posUsed = best.pos;
    D.shake = { fwd: dR.rigs[D.gov] || dR.rig, back: dF.rigs[D.gov] || dF.rig };       // the rocking simulation tips either way
    const sfR = dR.sfOf, sfF = dF.sfOf, rqR = dR.reqPerAtLoad, rqF = dF.reqPerAtLoad;      // (D is one of the two, so keep their own functions before replacing)
    D.sfOf = (Btot) => Math.min(sfR(Btot), sfF(Btot));                                    // charts and tables use the weaker way at every ballast
    D.reqPerAtLoad = (x, SFt, x0) => Math.max(rqR(x, SFt, x0), rqF(x, SFt, x0));
    D.req = Object.assign({}, D.req, { per, total: per * D.N, perRaw: Math.max(reqR.perRaw, reqF.perRaw), totalRaw: Math.max(reqR.totalRaw, reqF.totalRaw),
      none: reqR.none && reqF.none, capped: reqR.capped || reqF.capped });
    return D;
  }

  /* Every indoor case side by side, for the ballast now on the bases (cur is the derive() result for the selected case). */
  function compareCases(S, cur) {
    const bal = cur ? { ballastAuto: false, ballast: cur.ballast.slice(), ballastPer: cur.Wb / cur.N } : {};
    return CASES.map((id) => {
      const S2 = Object.assign({}, S, { mode: 'indoor', indoorCase: id });
      const Dn = derive(Object.assign({}, S2, bal));                                  // the safety factor on the ballast you have
      const Dr = cur ? derive(Object.assign({}, S2, { ballastAuto: true })) : Dn;      // the ballast each case needs, on its own
      return { id, name: CASE_NAME[id], kind: CASE_KIND[id], SF: Dn.SFact, status: Dn.status, req: Dr.req.per, none: Dr.req.none, capped: Dr.req.capped, limits: Dn.limits, gov: Dn.gov };
    });
  }

  /* ---- how each load changes in time: all deterministic, so a replay looks the same ---- */
  const smoothstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  // a pulse that repeats: starts at t0, rises, holds, falls, then rests before the next one
  function pulseAt(t, t0, dur, rise, fall, rest) {
    if (t < t0) return 0;
    const tau = (t - t0) % (dur + rest);
    if (tau >= dur) return 0;
    const r = Math.max(0.01, Math.min(rise, dur / 2)), f = Math.max(0.01, Math.min(fall, dur / 2));
    return smoothstep(tau / r) * (1 - smoothstep((tau - (dur - f)) / f));
  }
  /* An earthquake-like record: shaking from 0.4 to 10 Hz that builds up, stays strong, then dies away. Acceleration peak = 1, and the
     ground displacement it gives (high-passed, peak 1) for drawing. Sum of sines with fixed phases, so it never changes between runs. */
  const REC_DT = 1 / 120, recCache = {};
  function makeRecord(seed, dur) {
    const key = seed + ':' + dur; if (recCache[key]) return recCache[key];
    let x = (seed * 2654435761) >>> 0; const rnd = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
    const n = 28, f = [], a = [], p = [];
    for (let k = 0; k < n; k++) {
      const fk = 0.4 * Math.pow(25, k / (n - 1)), lo = (fk / 0.7) * (fk / 0.7), sd = lo / (1 + lo) / (1 + Math.pow(fk / 4.5, 4));
      f.push(fk); a.push(Math.sqrt(sd * fk)); p.push(2 * Math.PI * rnd());
    }
    const N = Math.ceil((dur + 0.2) / REC_DT) + 1, acc = new Float32Array(N), disp = new Float32Array(N);
    const t1 = 0.12 * dur, t2 = 0.4 * dur, c = 3 / Math.max(dur - t2, 0.5);
    let pk = 1e-9;
    for (let i = 0; i < N; i++) {
      const t = i * REC_DT; let s = 0;
      for (let k = 0; k < n; k++) s += a[k] * Math.sin(2 * Math.PI * f[k] * t + p[k]);
      const env = t >= dur ? 0 : t < t1 ? (t / t1) * (t / t1) : t <= t2 ? 1 : Math.exp(-c * (t - t2));
      acc[i] = s * env; pk = Math.max(pk, Math.abs(acc[i]));
    }
    let v = 0, xd = 0, pd = 1e-9;
    for (let i = 0; i < N; i++) {
      acc[i] /= pk;
      v = v * (1 - 1.2 * REC_DT) + acc[i] * REC_DT; xd = xd * (1 - 1.2 * REC_DT) + v * REC_DT; disp[i] = xd; pd = Math.max(pd, Math.abs(xd));
    }
    for (let i = 0; i < N; i++) disp[i] /= pd;
    return (recCache[key] = { acc, disp });
  }
  const recAt = (arr, t) => { const x = t / REC_DT, i = Math.floor(x); if (!(x >= 0) || i >= arr.length - 1) return 0; const k = x - i; return arr[i] * (1 - k) + arr[i + 1] * k; };

  /* Deterministic gust signal in [-1, 1] (sum of incommensurate sines). */
  function gustN(t) {
    const f = [0.083, 0.167, 0.31, 0.57, 1.1], a = [1.0, 0.8, 0.6, 0.35, 0.2], p = [0.4, 2.1, 4.4, 1.3, 5.2];
    let s = 0, sa = 0;
    for (let i = 0; i < 5; i++) { s += a[i] * Math.sin(2 * Math.PI * f[i] * t + p[i]); sa += a[i]; }
    return clamp(1.6 * s / sa, -1, 1);
  }

  /* Rigid body rocking about the governing toe, with the strap as a spring. phi >= 0 tilts in the overturning direction. */
  class Sim {
    constructor() { this.rig = null; this.gust = 0; this.reset(); }
    setRig(D, S) {
      this.rig = D.rig; this.gust = S.mode === 'outdoor' ? S.gust : 0;
      this.dirSign = D.dir === 'rear' ? 1 : -1; this.cn = D.wind.cn;
      this.caseId = D.loadCase || 'draught';
      this.shake = D.shake || null;                       // loads that can tip the wall either way: two rigs, one per toe
      this.door = Object.assign({}, S.door); this.knock = Object.assign({}, S.knock); this.sway = Object.assign({}, S.sway); this.quake = Object.assign({}, S.quake);
      this.pushSign = D.dir === 'rear' ? 1 : -1;
      this.recs = this.caseId === 'quake' ? { h: makeRecord(1, S.quake.dur), v: makeRecord(7, S.quake.dur) } : null;
      this.groundAmp = this.caseId === 'sway' ? S.sway.amp / 1000 : this.caseId === 'quake' ? 0.4 * S.quake.pga * S.quake.floor : 0;   // metres the floor really moves
      if (!this.side) this.side = this.dirSign;
    }
    reset() {
      this.t = 0; this.phi = 0; this.omega = 0; this.toppled = false; this.maxPhi = 0; this.impactAt = -1; this.lastU = 0; this.lam = 0; this.lamB = 0; this.Ph = 0; this.broken = false;
      this.side = this.dirSign || 1;                       // +1 tilting forward about the front toe, -1 backward about the rear toe
      this.pushDir = this.dirSign || 1;
      this.ground = 0;                                     // how far the floor is displaced, -1..1 of its peak
    }
    ramp(t) { const x = clamp(t / 1.5, 0, 1); return x * x * (3 - 2 * x); }
    windU(t) { const m = 1 + this.gust * gustN(t * 0.9 + 3); return this.ramp(t) * m / (1 + this.gust); }
    /* the load at time t: u (speed or load fraction), lam (load factor, signed when it can push either way), gs (weight factor), g (floor displacement) */
    loadAt(t) {
      switch (this.caseId) {
        case 'door': { const u = pulseAt(t, 1, this.door.dur, 0.5, 0.7, 6); return { u, lam: u * u, gs: 1, g: 0 }; }
        case 'knock': {
          const d = this.knock.dur, u = pulseAt(t, 1, d, 0.05, 0.1, 5), n = t < 1 ? 0 : Math.floor((t - 1) / (d + 5));
          const sgn = this.knock.from === 'rear' ? 1 : this.knock.from === 'front' ? -1 : (n % 2 === 0 ? 1 : -1);
          return { u, lam: this.shake ? sgn * u : u, gs: 1, g: 0 };
        }
        case 'sway': { const r = smoothstep(t / 2), s = Math.sin(2 * Math.PI * this.sway.f * t) * r; return { u: s, lam: s, gs: 1 - this.sway.bounce * Math.abs(s), g: s }; }
        case 'quake': {
          const tau = t < 1 ? -1 : (t - 1) % (this.quake.dur + 6);
          if (tau < 0) return { u: 0, lam: 0, gs: 1, g: 0 };
          const a = recAt(this.recs.h.acc, tau), v = recAt(this.recs.v.acc, tau);
          return { u: a, lam: a, gs: 1 + 0.5 * this.quake.pga * this.quake.floor * v, g: -recAt(this.recs.h.disp, tau) };
        }
        case 'notional': { const u = this.ramp(t); return { u, lam: this.pushSign * u, gs: 1, g: 0 }; }
        default: { const u = this.windU(t); return { u, lam: u * u, gs: 1, g: 0 }; }
      }
    }
    step(dt) { if (this.shake) this.stepShake(dt); else this.stepOne(dt); }
    stepOne(dt) {                                          // wind, a door gust or a push from one side: tips one way, about one toe
      const R = this.rig; if (!R) return;
      this.t += dt;
      const L = this.loadAt(this.t), u = L.u; this.lastU = u;
      const lam = L.lam; this.lam = lam; this.lamB = lam;
      const c = Math.cos(this.phi), s = Math.sin(this.phi);
      const Tw = R.F * lam * c * (R.hc * c + R.xiw * s);
      let Tr = 0;
      for (let i = 0; i < R.m.length; i++) Tr += R.m[i] * G * (R.x[i] * c - R.y[i] * s);
      let Ph = 0, Tst = 0; const st = R.strap;
      if (st && !this.broken) {
        const eng = lam * st.dp1 + this.phi * st.aPiv - st.gp;
        if (eng > 0) {
          Ph = st.c0 * eng;
          if (Ph > st.PhCap * 1.0000001) { this.broken = true; Ph = 0; }
          else Tst = Ph * strapGamma(st, c, s);
        }
      }
      if (R.bendStrap && !this.broken) { const eb = lam * R.bendStrap.dp1 - R.bendStrap.gp; Ph = eb > 0 ? Math.min(R.bendStrap.PhCap, R.bendStrap.c0 * eb) : 0; }
      this.Ph = Ph;
      const net = Tw - Tr - Tst;
      if (this.phi <= 0 && net <= 0) { this.phi = 0; this.omega = 0; return; }
      this.omega += (net / R.I) * dt;
      this.omega *= (1 - 0.35 * dt);
      this.phi += this.omega * dt;
      if (this.phi < 0) { this.phi = 0; this.omega = this.omega < -0.002 ? -this.omega * 0.35 : 0; }
      const floor = Math.PI / 2;
      if (this.phi > floor) {
        this.phi = floor;
        if (this.omega > 0.25 && this.impactAt < 0) this.impactAt = this.t;
        this.omega = this.omega > 0.25 ? -this.omega * 0.18 : 0;
      }
      if (this.phi > this.maxPhi) this.maxPhi = this.phi;
      if (!this.toppled && this.phi > R.phiCrit && net > 0 && (!R.strap || this.broken || this.phi > 0.6)) this.toppled = true;
    }
    /* Shaking, or a push from either side. The wall rests flat, or rocks about the front toe (side +1) or the rear toe (side -1). Each toe has its
       own geometry. When it comes back to the floor the other toe lands, some energy is lost, and it goes on over to the other side if it still has the speed. */
    stepShake(dt) {
      this.t += dt;
      const L = this.loadAt(this.t), lam = L.lam, gs = L.gs;
      this.lastU = L.u; this.lam = lam; this.ground = L.g;
      this.lamB = lam * this.dirSign;                      // the load factor along the weaker way, which is how the bending is worked out
      if (Math.abs(lam) > 1e-3) this.pushDir = lam >= 0 ? 1 : -1;       // which way the last push went (for the picture)
      const moment = (side, phi) => {
        const r = side > 0 ? this.shake.fwd : this.shake.back, c = Math.cos(phi), s = Math.sin(phi), ll = side * lam;   // ll < 0: the load helps this side
        let Tr = 0, Ti = 0;
        for (let i = 0; i < r.m.length; i++) { Tr += r.m[i] * G * (r.x[i] * c - r.y[i] * s); Ti += r.m[i] * (r.y[i] * c + r.x[i] * s); }
        const Tw = r.acc ? ll * r.acc * Ti : ll * r.F * c * (r.hc * c + r.xiw * s);
        let Ph = 0, Tst = 0; const st = r.strap;
        if (st && !this.broken) {
          const eng = ll * st.dp1 + phi * st.aPiv - st.gp;
          if (eng > 0) { Ph = st.c0 * eng; if (Ph > st.PhCap * 1.0000001) { this.broken = true; Ph = 0; } else Tst = Ph * strapGamma(st, c, s); }
        }
        return { net: Tw - gs * Tr - Tst, Ph, r };
      };
      if (this.phi <= 0 && this.omega === 0) {            // lying flat: does the load lift one edge?
        const sd = lam >= 0 ? 1 : -1, m0 = moment(sd, 0);
        if (m0.net <= 0) { this.phi = 0; this.Ph = 0; return; }
        this.side = sd;
      }
      const m = moment(this.side, this.phi), r = m.r; this.Ph = m.Ph;
      this.omega += (m.net / r.I) * dt;
      this.omega *= (1 - 0.35 * dt);
      this.phi += this.omega * dt;
      if (this.phi < 0) {                                  // back down: the other toe lands
        const w = -this.omega; this.phi = 0; this.side = -this.side;
        this.omega = w > 0.01 ? 0.85 * w : 0;
      }
      const floor = Math.PI / 2;
      if (this.phi > floor) {
        this.phi = floor;
        if (this.omega > 0.25 && this.impactAt < 0) this.impactAt = this.t;
        this.omega = this.omega > 0.25 ? -this.omega * 0.18 : 0;
      }
      if (this.phi > this.maxPhi) this.maxPhi = this.phi;
      if (!this.toppled && this.phi > r.phiCrit && this.omega > 0 && (!r.strap || this.broken || this.phi > 0.6)) this.toppled = true;
    }
    liftMM(depth) { return Math.sin(this.phi) * depth * 1000; }
  }

  return { G, CAB, SHEET, SCALE, CABINETS, cabArea, cabHeight, RESTRAINT, PROFILE_ALPHA, MAX_BALLAST, SF_CAP, BFT_NAME, BFT_SPEED, bftRange, CASES, CASE_KIND, CASE_NAME, QUAKE_ZONES, beaufort, defaults, derive, compareCases, loadFor, makeRecord, gustN, Sim, sheetBases, clamp, windInfo, scanSys, lamAt };
});
