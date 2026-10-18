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
      Cf: 1.0, shape: 'auto', gustAuto: true, depth: SHEET.depth, mu: 0.5,
      zeta: 0.01,                                                 // damping of the wall's own vibration, as a share of critical
      share: 1,                                                   // how much the wall shares load between bases: 1 = it acts as one piece, 0 = each base stands alone
      // the cabinet locks (a what-if): strengths in kgf per fixing or lock, 0 = not entered; how many per cabinet or joint; how the wind is spread over the cabinets
      locks: { on: false, fixKgf: 0, fixN: 2, lockKgf: 0, lockN: 2, pattern: 'en', edge: 1.5, stiff: 1, preset: 'custom' },
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

  /* ---- wind: the numbers the standards use, instead of the sheet's single coefficient ----
     EN 1991-1-4:2005+A1:2010. Table 4.1 gives the roughness of each terrain category, (4.7) the turbulence intensity Iv = 1 / ln(z / z0), and (4.8) the
     peak velocity pressure as (1 + 7 Iv) times the mean, so the peak speed is the square root of that times the mean speed. The three terrain choices of
     the app stand for categories II, III and IV. */
  const TERRAIN = {
    uniform: { cat: 'II', z0: 0.05, zmin: 2, name: 'open country' },
    open: { cat: 'II', z0: 0.05, zmin: 2, name: 'open country' },
    suburban: { cat: 'III', z0: 0.3, zmin: 5, name: 'suburb or village' },
    urban: { cat: 'IV', z0: 1.0, zmin: 10, name: 'city' }
  };
  const terrainOf = (profile) => TERRAIN[profile] || TERRAIN.open;
  const turbInt = (profile, z) => { const t = terrainOf(profile); return 1 / Math.log(Math.max(z, t.zmin) / t.z0); };
  const gustEN = (profile, z) => clamp(Math.sqrt(1 + 7 * turbInt(profile, z)) - 1, 0, 1);
  const wallTop = (S) => (S.stage && S.stage.on ? S.stage.h : 0) + SHEET.screenBottom + S.H;
  // the height the wind is taken at: a free-standing wall at its top (EN 7.4.1, ze = h), a signboard at its middle (Figure 7.21, ze = zg + h/2)
  const zRef = (S) => (S.W / S.H > 1 && (S.stage && S.stage.on ? S.stage.h : 0) + SHEET.screenBottom <= S.H / 4 ? wallTop(S) : wallTop(S) - S.H / 2);
  const gustOf = (S) => (S.gustAuto ? gustEN(S.profile, zRef(S)) : clamp(+S.gust || 0, 0, 1));

  /* EN 1991-1-4 Table 7.9: net pressure coefficients of a solid free-standing wall (no return corners) by zone, for length over height 3, 5 and 10 or more.
     Figure 7.19 measures the zones from the free end that an oblique wind arrives at: A within 0.3 h, B up to 2 h, C up to 4 h, D beyond (a shorter wall just has
     fewer of them). The wall's overall coefficient is the average along its length. For the cabinets the wind can arrive at either end, so each column takes the
     larger of the two. */
  const EN_WALL_ROWS = [{ lh: 3, A: 2.3, B: 1.4, C: 1.2, D: 1.2 }, { lh: 5, A: 2.9, B: 1.8, C: 1.4, D: 1.2 }, { lh: 10, A: 3.4, B: 2.1, C: 1.7, D: 1.2 }];
  function enWallRow(lh) {                                    // between the tabulated lengths by straight lines, outside them the nearest row
    const R = EN_WALL_ROWS;
    if (lh <= R[0].lh) return R[0];
    if (lh >= R[2].lh) return R[2];
    const i = lh < R[1].lh ? 0 : 1, a = R[i], b = R[i + 1], t = (lh - a.lh) / (b.lh - a.lh);
    return { A: a.A + t * (b.A - a.A), B: a.B + t * (b.B - a.B), C: a.C + t * (b.C - a.C), D: a.D + t * (b.D - a.D) };
  }
  const enZone = (d) => (d < 0.3 ? 'A' : d < 2 ? 'B' : d < 4 ? 'C' : 'D');
  function enWall(W, h) {                                     // the coefficient of each cabinet column (wind arriving at the left end), the larger of that and its mirror, and the average
    const cp = enWallRow(W / h), n = Math.max(1, Math.round(W / CAB.w)), cols = [];
    let sum = 0;
    for (let c = 0; c < n; c++) { const v = cp[enZone((c + 0.5) * W / n / h)]; cols.push(v); sum += v; }
    return { cols, env: cols.map((v, c) => Math.max(v, cols[n - 1 - c])), mean: sum / n, row: cp };
  }
  // shape (force) coefficients to choose from; cf null means the standard's own rule by the size of the wall
  const WIND_SHAPES = [
    { id: 'sheet', cf: 1.0, name: 'The sheet', note: 'The ballast sheet uses a coefficient of 1.', src: '' },
    { id: 'roe', cf: 1.57, name: 'Closed LED panel, wind tunnel', note: 'ROE Visual measured 1.57 in a wind tunnel for a fully closed panel.', src: 'https://www.roevisual.com/en/knowledge-and-support/blow-through-led-panel-design-dont-get-fooled' },
    { id: 'en', cf: null, name: 'EN 1991-1-4 by size', note: 'A wall near the ground and longer than it is high: the net coefficients of Table 7.9, averaged over its zones. Anything else is a signboard: 1.8.', src: 'EN 1991-1-4:2005+A1:2010, 7.4' },
    { id: 'ensign', cf: 1.8, name: 'Signboard, EN 1991-1-4', note: 'Force coefficient 1.8 for a signboard (7.4.3).', src: 'EN 1991-1-4:2005+A1:2010, 7.4.3' },
    { id: 'mesh', cf: 0.81, name: 'Mesh panel, wind tunnel', note: 'ROE Visual measured 0.81 for the see-through Vanish V8T.', src: 'https://www.roevisual.com/en/knowledge-and-support/blow-through-led-panel-design-dont-get-fooled' }
  ];
  // EN 7.4: a wall near the ground and longer than it is high is a wall (Table 7.9), anything else a signboard (7.4.3)
  const enRule = (S) => (S.W / S.H > 1 && (S.stage && S.stage.on ? S.stage.h : 0) + SHEET.screenBottom <= S.H / 4 ? 'wall' : 'sign');
  function cfOf(S) {                                          // the force coefficient in use
    const sh = S.shape || 'auto';
    if (sh === 'custom') return S.Cf;
    if (S.mode !== 'outdoor') return 1.0;                      // the presets are for outdoor wind; indoors the sheet's wind scale stays as it is
    const en = () => (enRule(S) === 'wall' ? enWall(S.W, S.H).mean : 1.8);
    if (sh === 'auto') return S.mode === 'outdoor' ? en() : 1.0;
    const p = WIND_SHAPES.find((x) => x.id === sh);
    return !p ? S.Cf : p.cf == null ? en() : p.cf;
  }

  function windInfo(S) {
    let vMean, qMean, pk = 1, gust = 0;
    if (S.mode === 'indoor' && S.indoorCase === 'door') {
      vMean = S.door.v; qMean = RHO_FACTOR * vMean * vMean;
    } else if (S.mode === 'indoor') {
      const row = SCALE[clamp(Math.round(S.indoorScale), 0, SCALE.length - 1)];
      vMean = row.v; qMean = row.q;
    } else {
      vMean = S.outSpeed; qMean = RHO_FACTOR * vMean * vMean; gust = gustOf(S); pk = 1 + gust;
    }
    return { vMean, qMean, pk, gust, cf: cfOf(S), vPeak: vMean * pk, qPeak: qMean * pk * pk };
  }

  /* ---- how the wall vibrates ----
     The wall is a cantilever from its base (the same beam as the bending). Its first sideways mode comes from Rayleigh's quotient on the shape it takes
     under its own weight acting sideways, with the bending and shear flexibility of the beam. With the mode shape phi (1 at the top), the participation
     Gamma = sum(m phi) / sum(m phi^2), A = sum(m h) (the overturning moment of the rigid wall per unit of acceleration) and B = sum(m phi h): a floor that
     accelerates the wall by a(t) makes the mode move, q'' + 2 zeta w q' + w^2 q = Gamma a(t), and the moment on the base is A a(t) - B q''. For a steady
     shake at the ratio r = f / f1 that is amplified by |1 + (B Gamma / A) r^2 / (1 - r^2 + 2 i zeta r)|. */
  const TWO_PI = Math.PI * 2;
  function modalOf(EIw, GAw, mass, L) {
    const n = 48, dzm = L / n, mj = mass / n;
    const fl = (z, a) => (z <= a ? z * z * (3 * a - z) / (6 * EIw) : a * a * (3 * z - a) / (6 * EIw)) + Math.min(z, a) / GAw;
    const zj = Array.from({ length: n }, (_, j) => (j + 0.5) * dzm);
    const defAt = (z) => { let d = 0; for (let j = 0; j < n; j++) d += mj * fl(z, zj[j]); return d; };
    const dj = zj.map(defAt), top = defAt(L);
    let num = 0, den = 0, sPhi = 0, sPhi2 = 0, A0 = 0, B0 = 0;
    for (let j = 0; j < n; j++) {
      const ph = dj[j] / top;
      num += mj * dj[j]; den += mj * dj[j] * dj[j];
      sPhi += mj * ph; sPhi2 += mj * ph * ph; A0 += mj * zj[j]; B0 += mj * ph * zj[j];
    }
    const w = Math.sqrt(num / den);
    return { w, f1: w / TWO_PI, T1: TWO_PI / w, Gamma: sPhi / sPhi2, mass, L, A0, B0, Sphi: sPhi, phiAt: (z) => defAt(z) / top };
  }
  const modalSys = (mod, hs) => { const A = mod.A0 + hs * mod.mass, B = mod.B0 + hs * mod.Sphi; return { A, B, k: B * mod.Gamma / A }; };     // hs: the pivot is that much lower than the base
  function dafHarm(r, zeta, k) {
    const dr = 1 - r * r, di = 2 * zeta * r, m2 = dr * dr + di * di;
    return m2 < 1e-12 ? Infinity : Math.hypot(1 + k * r * r * dr / m2, k * r * r * di / m2);
  }
  // the same amplification for the earthquake record: the first mode is run through it and the largest base moment compared with the rigid wall's
  const dafCache = {};
  function quakeDaf(mod, ms, zeta, dur) {
    const key = [mod.w.toFixed(3), mod.Gamma.toFixed(4), ms.A.toFixed(1), ms.B.toFixed(1), zeta, dur].join('|');
    if (dafCache[key] !== undefined) return dafCache[key];
    const rec = makeRecord(1, dur).acc, dt0 = REC_DT / 4;
    if (mod.w * dt0 > 8) return (dafCache[key] = 1);                                       // stiff enough to follow the floor
    const ns = Math.max(1, Math.ceil(mod.w * dt0 / 0.25)), dt = dt0 / ns, steps = Math.ceil((dur + 1) / dt);
    let q = 0, qd = 0, mx = 0, mr = 0;
    for (let i = 0; i < steps; i++) {
      const a = recAt(rec, i * dt), qdd = mod.Gamma * a - 2 * zeta * mod.w * qd - mod.w * mod.w * q, Mo = ms.A * a - ms.B * qdd;
      mx = Math.max(mx, Math.abs(Mo)); mr = Math.max(mr, Math.abs(ms.A * a));
      qd += qdd * dt; q += qd * dt;
    }
    return (dafCache[key] = mr > 0 ? mx / mr : 1);
  }
  /* EN 1991-1-4 6.3.1 and Annex B: the structural factor cs cd, which says how much the wall's size takes off the gust load and how much its own vibration
     adds. (B.3) background, (B.2) spectrum, (B.6) resonance, (B.4)-(B.5) peak factor, F.5 damping with the aerodynamic part (F.16). */
  function windCscd(S, mod, wind, mass) {
    const t = terrainOf(S.profile), zs = Math.max(wallTop(S) - S.H / 2, t.zmin), Iv = turbInt(S.profile, zs);      // Figure 6.1 c): a board's reference height is the middle of the board
    const Lz = 300 * Math.pow(zs / 200, 0.67 + 0.05 * Math.log(t.z0)), b = S.W, h = S.H;
    const B2 = 1 / (1 + 0.9 * Math.pow((b + h) / Lz, 0.63));
    const alpha = PROFILE_ALPHA[S.profile] || 0, vm = Math.max(0.5, wind.vMean * (alpha ? Math.pow(zs / 10, alpha) : 1));
    const n1 = mod.f1, fL = n1 * Lz / vm, SL = 6.8 * fL / Math.pow(1 + 10.2 * fL, 5 / 3);
    const adm = (eta) => (eta > 1e-9 ? 1 / eta - (1 - Math.exp(-2 * eta)) / (2 * eta * eta) : 1);
    const Rh = adm(4.6 * h / Lz * fL), Rb = adm(4.6 * b / Lz * fL);
    const delta = TWO_PI * S.zeta + wind.cf * 1.25 * vm / (2 * n1 * (mass / (b * h)));
    const R2 = Math.PI * Math.PI / (2 * delta) * SL * Rh * Rb;
    const nu = Math.max(n1 * Math.sqrt(R2 / (B2 + R2)), 0.08), x = Math.sqrt(2 * Math.log(nu * 600));
    const kp = Math.max(x + 0.6 / x, 3);
    return { cscd: (1 + 2 * kp * Iv * Math.sqrt(B2 + R2)) / (1 + 7 * Iv), B2, R2, kp, Iv, delta, zs, Lz };
  }

  /* ---------- rigid-body scan ----------
     sys = { comps:[{m,xi,eta,Ig}], F (N), hc (m), xiw (m), strap|null }
     Returns the load factor lambda at which the moments balance for each rotation phi, and the best one. */
  function momentsAt(sys, phi) {
    // sys.acc: the floor accelerates sideways by acc, so every mass m gets a force m*acc at its own height; sys.gs scales the weights
    // (a floor dropping away makes the wall lighter, one pushing up makes it heavier).
    const c = Math.cos(phi), s = Math.sin(phi), gs = sys.gs === undefined ? 1 : sys.gs;
    let Mr = 0, Ti = 0;
    for (const k of sys.comps) { Mr += k.m * G * (k.xi * c - k.eta * s); Ti += k.m * (k.dyn === undefined ? 1 : k.dyn) * (k.eta * c + k.xi * s); }       // k.dyn: the first mode amplifies this mass's inertia
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

    // --- how it vibrates: the first mode, and what it does to shaking and to gusts
    const zeta = clamp(+S.zeta || 0.01, 0.001, 0.2), massW = Ws + Wf, mod = modalOf(N * S.EI, S.gaRatio * N * S.EI, massW, L);
    const msW = modalSys(mod, 0), msS = modalSys(mod, hs);
    let dynM = { W: 1, S: 1 }, dyn = { kind: 'none', W: 1, S: 1, f1: mod.f1, zeta };
    if (accel && ld.cs === 'sway') {                                  // a steady shake: how close it is to the wall's own frequency
      const r = Math.max(0.05, S.sway.f) / mod.f1;
      dynM = { W: Math.max(1, dafHarm(r, zeta, msW.k)), S: Math.max(1, dafHarm(r, zeta, msS.k)) }; dyn = { kind: 'sway', r, W: dynM.W, S: dynM.S, f1: mod.f1, zeta };
    } else if (accel && ld.cs === 'quake') {                          // the record, run through the first mode
      dynM = { W: Math.max(1, quakeDaf(mod, msW, zeta, S.quake.dur)), S: Math.max(1, quakeDaf(mod, msS, zeta, S.quake.dur)) }; dyn = { kind: 'quake', W: dynM.W, S: dynM.S, f1: mod.f1, zeta };
    }
    let dynW = 1, wcs = null;
    if (!ld && S.mode === 'outdoor') { wcs = windCscd(S, mod, wind, massW); dynW = Math.max(1, wcs.cscd); }      // never below 1: the size effect is not counted as a relief
    wind.dyn = dynW; wind.cfTot = wind.cf * dynW;

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
    const pBase = accel ? ld.acc * dynM.W * (Ws + Wf) / A : wind.qPeak * cn * wind.cfTot;      // N/m2; for shaking, the inertia of the screen and frame spread over the face
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

    const phiNodes = nodeZ.map((z) => mod.phiAt(z));                  // the first mode's shape at the same nodes

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
    const compsW = (B, dn) => [
      { m: Ws, xi: aS, eta: y0 + S.H / 2, Ig: Ws * S.H * S.H / 12, dyn: dn },
      { m: Wf, xi: aF, eta: y0 + S.H / 2, Ig: Wf * S.H * S.H / 12, dyn: dn },
      { m: B, xi: aB, eta: y0 + 0.12, Ig: 0 }];
    const inert = accel ? { acc: ld.acc, gs: ld.gs } : null;           // shaking: inertia of every mass, and a lighter or heavier wall
    const useS = !!stg && !(ld && ld.systems && ld.systems.S === false);   // deck sway moves the deck under the wall, not the stage on the floor
    const sysW = (B) => Object.assign({ kind: 'W', comps: compsW(B, dynM.W), F, hc, xiw: aS, strap: strapFor('W', aS) }, inert);
    const sysS = (B) => {
      const c = compsW(B, dynM.S).map((k) => ({ m: k.m, xi: k.xi + xi0, eta: k.eta + hs, Ig: k.Ig, dyn: k.dyn }));
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
    // Uneven ballast. The sheet divides the total over the bases, as if the wall acted as one piece. A wall can also be taken one base at a time, each with
    // its slice of the weight and of the wind, so that the weakest base decides. S.share says how much the wall shares between its bases: 1 is the first, 0 the second.
    const sliceSys = (sys, Bi) => Object.assign({}, sys, {
      comps: sys.comps.map((k, i) => (i === 2 ? Object.assign({}, k, { m: Bi }) : Object.assign({}, k, { m: k.m / N }))), F: sys.F / N,
      strap: sys.strap ? Object.assign({}, sys.strap, { kh: sys.strap.kh / N, c0: sys.strap.c0 / N, PhCap: sys.strap.PhCap / N }) : null });
    const topB = Math.max(...ballast), uneven = N > 1 && topB - Math.min(...ballast) > 1e-6 * Math.max(1, topB), shr = clamp(S.share === undefined ? 1 : +S.share, 0, 1);
    const lmShared = lamOf(Wb);
    let lm = lmShared, baseSF = null, sfInd = lmShared.lam;
    if (uneven) {
      const cap = SF_CAP * 10, per = ballast.map((b) => ({ w: Math.min(scanSys(sliceSys(sysW(b), b)).lamMax, cap), s: useS ? Math.min(scanSys(sliceSys(sysS(b), b)).lamMax, cap) : Infinity }));
      const indW = Math.min(...per.map((x) => x.w)), indS = useS ? Math.min(...per.map((x) => x.s)) : Infinity;
      const lamWc = indW + shr * (lmShared.lamW - indW), lamSc = useS ? indS + shr * (lmShared.lamS - indS) : Infinity;
      lm = { lamW: lamWc, lamS: lamSc, lam: Math.min(lamWc, lamSc), gov: lamSc < lamWc ? 'S' : 'W' };
      baseSF = per.map((x) => Math.min(x.w, x.s)); sfInd = Math.min(indW, indS);
    }
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
    const Fdisp = sysG.acc ? sysG.acc * sum(sysG.comps.map((k) => k.m * (k.dyn === undefined ? 1 : k.dyn))) : F;           // N: the push, or the inertia of everything that moves
    const TiG = sysG.acc ? sysG.comps.reduce((t, k) => t + k.m * (k.dyn === undefined ? 1 : k.dyn) * (k.eta * cC + k.xi * sC), 0) : 0;
    const MwG = sysG.acc ? sysG.acc * TiG / G : (gov === 'S' ? hs + hc : hc) * Fkgf;
    const M = { w: MwG, wSF: S.SF * MwG, s: Mpart.s, f: Mpart.f, b: Mpart.b, stage: Mpart.stage, strap: Mpart.strap, rest: Mpart.s + Mpart.f + Mpart.b + Mpart.stage + Mpart.strap, gov };
    const aBgov = gov === 'S' ? aB + xi0 : aB;
    const MwShare = MwG / N, base0 = (M.rest - M.b) / N;
    const local = baseSF || ballast.map((b) => (MwShare > 1e-9 ? SFact + (b - Wb / N) * aBgov / MwShare : Infinity));

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
        acc: sys.acc || 0, gs: sys.gs === undefined ? 1 : sys.gs,
        modal: accel && ld.cs !== 'notional' ? { w: mod.w, zeta, Gamma: mod.Gamma, B: sys.kind === 'S' ? msS.B : msW.B } : null
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
      ballast, SFact, status, lam: lm, uneven, share: shr, sfInd: Math.min(sfInd, 1e9), sfShared: Math.min(lmShared.lam, 1e9),
      limits,
      slide, slideStage, deck, stage, strap: strapOut, bend, lean, eq: { phi, Ph: Phn, none: !!eq.none, capped: scanG.capped },
      local, rig, rigs, gov, sfOf, reqPerAtSpeed, reqPerAtLoad, profileAlpha: alpha,
      loadKind: accel ? 'accel' : pushed ? 'force' : 'wind',
      modal: { f1: mod.f1, T1: mod.T1, zeta, Gamma: mod.Gamma, kW: msW.k, mass: massW, phi: phiNodes }, dyn, wcs,
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

  /* ---- lock strength presets ----
     Makers do not publish the pull-off strength of a cabinet lock. What they publish are hanging and stacking limits, and those give a lower bound for the lock
     system that carries them. That is a vertical load, so it is only a guide to the pull-off strength. `basis` says where a number came from: 'published' (as
     the maker states it), 'derived' (worked out from published limits), 'standard' (an ISO fastener table) or 'example' (made up, to try a weak lock). */
  const LOCK_PRESETS = [
    { id: 'roe-bp2', group: 'Makers', name: 'ROE Black Pearl BP2 V2, joint between panels', lock: { kgf: 444, n: 2 }, basis: 'derived',
      note: 'Derived. The spec sheet lets 20 panels of 9.35 kg hang with a safety factor of 5 (the product page now says 8). The top joint carries 19 panels, 178 kg, so it must hold at least 5 × 178 = 888 kgf. Shared over an assumed 2 locks: 444 kgf each. A vertical rating, so only a guide to the pull-off strength.',
      src: [['ROE BP2 V2 spec sheet', 'https://www.roevisual.com/uploads/Images/Products/Black%20Pearl%202%20V2/bp-v2-specs.pdf'], ['ROE Black Pearl page', 'https://www.roevisual.com/us-en/products/black-pearl']] },
    { id: 'planar-cli', group: 'Makers', name: 'Planar CarbonLight CLI, per cabinet', lock: { kgf: 500, n: 2 }, basis: 'derived',
      note: 'Derived. Planar states a weight bearing capacity of 1,000 kg per cabinet for hanging. Shared over an assumed 2 locks: 500 kgf each. A vertical rating, so only a guide to the pull-off strength.',
      src: [['Planar CLI brochure', 'https://www.planar.com/media/442248/planar-carbonlight-cli-series_brochure_web.pdf']] },
    { id: 'planar-cla', group: 'Makers', name: 'Planar CarbonLight CLA, small 250 mm cabinet', lock: { kgf: 150, n: 2 }, basis: 'derived',
      note: 'Derived. Planar states a weight bearing capacity of 300 kg per cabinet for hanging. Shared over an assumed 2 locks: 150 kgf each. A vertical rating, so only a guide to the pull-off strength.',
      src: [['Planar CLA brochure', 'https://www.planar.com/media/438679/planar_carbonlight_cla_series_brochure.pdf']] },
    { id: 'm6', group: 'Standard fasteners', name: 'M6 bolt, class 8.8', fix: { kgf: 1640, n: 2 }, basis: 'standard',
      note: 'ISO 898-1: an M6 class 8.8 bolt breaks in tension at 16.1 kN (stress area 20.1 mm² × 800 MPa), about 1,640 kgf. The bolt only: the thread, the lug or the frame may give way sooner.',
      src: [['ISO metric thread minimum ultimate tensile loads (Optimas)', 'https://optimas.com/technical-resources/iso-metric-thread-minimum-ultimate-tensile-loads/'], ['Screw loads (Roymech)', 'https://roymech.org/Useful_Tables/Screws/Screw_loads.html']] },
    { id: 'm8', group: 'Standard fasteners', name: 'M8 bolt, class 8.8', fix: { kgf: 2980, n: 2 }, basis: 'standard',
      note: 'ISO 898-1: an M8 class 8.8 bolt breaks in tension at 29.2 kN (stress area 36.6 mm² × 800 MPa), about 2,980 kgf. The bolt only: the thread, the lug or the frame may give way sooner.',
      src: [['ISO metric thread minimum ultimate tensile loads (Optimas)', 'https://optimas.com/technical-resources/iso-metric-thread-minimum-ultimate-tensile-loads/'], ['Screw loads (Roymech)', 'https://roymech.org/Useful_Tables/Screws/Screw_loads.html']] },
    { id: 'weak', group: 'Examples', name: 'A weak lock, 20 kgf', fix: { kgf: 20, n: 2 }, lock: { kgf: 20, n: 2 }, basis: 'example', note: 'Made up, to see what happens with a lock that is much weaker than the makers\' hanging ratings.', src: [] },
    { id: 'vweak', group: 'Examples', name: 'A very weak lock, 5 kgf', fix: { kgf: 5, n: 2 }, lock: { kgf: 5, n: 2 }, basis: 'example', note: 'Made up, to see what happens with a lock that is almost not there.', src: [] }
  ];

  /* ---- cabinet locks: a what-if on the lock strengths you type in ----
     Every cabinet is a rigid block that the load pulls away from the back frame. It is held by `fixN` fixings to the frame and by `lockN` locks to
     each neighbour, all springs. The loads are solved as a network: cabinets are the nodes, the frame is the ground. A cabinet that is pulled harder
     than its neighbours hands part of its load to them through the locks. The element with the largest load / strength lets go first; the network is
     solved again without it, and so on. Either one cabinet comes off, or the failure runs on like a zip. With the same springs everywhere and an
     even load nothing is shared and every cabinet carries its own load, so a weak link only shows where the load or the strength is uneven.
     All forces are linear in the load factor, so the first failure comes at 1 / (largest ratio) and later ones follow in order. */
  // a long run of failures is cut off by the work it takes (cabinets times solver passes), not by the clock, so the same wall always gives the same answer
  const LOCK_EVENTS_MAX = 300, LOCK_WORK_MAX = 2e6, LOCK_LAM_FAR = 1e6;

  // conjugate gradients on the cabinet network (symmetric, positive definite, Jacobi preconditioner); x holds the starting guess and the answer.
  // w: four work arrays of length n, kept between solves.
  function lockCG(n, A, dinv, b, x, maxIt, tol2rel, w) {
    const r = w[0], z = w[1], p = w[2], q = w[3];
    A(x, q);
    let bn = 0, rz = 0;
    for (let i = 0; i < n; i++) { r[i] = b[i] - q[i]; bn += b[i] * b[i]; }
    if (bn === 0) { x.fill(0); return 0; }
    for (let i = 0; i < n; i++) { z[i] = r[i] * dinv[i]; p[i] = z[i]; rz += r[i] * z[i]; }
    const tol2 = tol2rel * bn;
    let it = 0;
    for (; it < maxIt; it++) {
      let rn = 0; for (let i = 0; i < n; i++) rn += r[i] * r[i];
      if (rn <= tol2) break;
      A(p, q);
      let pq = 0; for (let i = 0; i < n; i++) pq += p[i] * q[i];
      if (!(pq > 0)) break;
      const alpha = rz / pq; let rz2 = 0;
      for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * q[i]; z[i] = r[i] * dinv[i]; rz2 += r[i] * z[i]; }
      const beta = rz2 / rz; rz = rz2;
      for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    }
    return it;
  }

  /* o: { cols, rows, F (N per cabinet at load factor 1, index row * cols + col, row 0 at the bottom), fixN, lockN, kl (a lock's stiffness over a fixing's),
          Tf, Tl (N that one fixing or lock holds, 0 = not entered), lamStop, workMax } */
  function lockNet(o) {
    const cols = o.cols, rows = o.rows, n = cols * rows, F = o.F;
    const kf = 1, kl = o.kl > 0 ? o.kl : 1, Tf = o.Tf > 0 ? o.Tf : 0, Tl = o.Tl > 0 ? o.Tl : 0;
    const fixN = clamp(Math.round(o.fixN), 1, 16), lockN = clamp(Math.round(o.lockN), 0, 16);
    const lamStop = o.lamStop > 0 ? o.lamStop : 1.5, workMax = o.workMax > 0 ? o.workMax : LOCK_WORK_MAX;
    let work = 0;
    const alive = new Uint8Array(n).fill(1), nf = new Uint8Array(n).fill(fixN), nlh = new Uint8Array(n), nlv = new Uint8Array(n);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const i = r * cols + c; if (c < cols - 1) nlh[i] = lockN; if (r < rows - 1) nlv[i] = lockN; }
    const x = new Float64Array(n), rhs = new Float64Array(n), dinv = new Float64Array(n), wk = [0, 1, 2, 3].map(() => new Float64Array(n));
    const A = (v, out) => {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (!alive[i]) { out[i] = 0; continue; }
          const vi = v[i]; let s = nf[i] * kf * vi;
          if (c < cols - 1 && nlh[i] && alive[i + 1]) s += nlh[i] * kl * (vi - v[i + 1]);
          if (c > 0 && nlh[i - 1] && alive[i - 1]) s += nlh[i - 1] * kl * (vi - v[i - 1]);
          if (r < rows - 1 && nlv[i] && alive[i + cols]) s += nlv[i] * kl * (vi - v[i + cols]);
          if (r > 0 && nlv[i - cols] && alive[i - cols]) s += nlv[i - cols] * kl * (vi - v[i - cols]);
          out[i] = s;
        }
      }
    };
    const solve = (tol2rel) => {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (!alive[i]) { rhs[i] = 0; x[i] = 0; dinv[i] = 0; continue; }
          rhs[i] = F[i];
          let d = nf[i] * kf;
          if (c < cols - 1 && nlh[i] && alive[i + 1]) d += nlh[i] * kl;
          if (c > 0 && nlh[i - 1] && alive[i - 1]) d += nlh[i - 1] * kl;
          if (r < rows - 1 && nlv[i] && alive[i + cols]) d += nlv[i] * kl;
          if (r > 0 && nlv[i - cols] && alive[i - cols]) d += nlv[i - cols] * kl;
          dinv[i] = d > 0 ? 1 / d : 0;
        }
      }
      work += n * (1 + lockCG(n, A, dinv, rhs, x, Math.min(8000, 10 * n + 50), tol2rel, wk));
    };
    // cabinets that no longer have any path to the frame come off
    const groundCheck = () => {
      const seen = new Uint8Array(n), stack = [];
      for (let i = 0; i < n; i++) if (alive[i] && nf[i] > 0) { seen[i] = 1; stack.push(i); }
      while (stack.length) {
        const i = stack.pop(), r = Math.floor(i / cols), c = i - r * cols;
        const go = (j) => { if (alive[j] && !seen[j]) { seen[j] = 1; stack.push(j); } };
        if (c < cols - 1 && nlh[i]) go(i + 1);
        if (c > 0 && nlh[i - 1]) go(i - 1);
        if (r < rows - 1 && nlv[i]) go(i + cols);
        if (r > 0 && nlv[i - cols]) go(i - cols);
      }
      const gone = [];
      for (let i = 0; i < n; i++) if (alive[i] && !seen[i]) { alive[i] = 0; x[i] = 0; gone.push(i); }
      return gone;
    };
    // the largest load / strength over all fixings and locks that can still break
    const worst = () => {
      let best = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c; if (!alive[i]) continue;
          if (Tf > 0 && nf[i] > 0) best = Math.max(best, kf * Math.abs(x[i]) / Tf);
          if (Tl > 0) {
            if (c < cols - 1 && nlh[i] && alive[i + 1]) best = Math.max(best, kl * Math.abs(x[i] - x[i + 1]) / Tl);
            if (r < rows - 1 && nlv[i] && alive[i + cols]) best = Math.max(best, kl * Math.abs(x[i] - x[i + cols]) / Tl);
          }
        }
      }
      return best;
    };

    solve(1e-26);                                                    // the whole wall, before anything lets go
    const fixF = new Float64Array(n), lockH = new Float64Array(n), lockV = new Float64Array(n);
    let peakFix = 0, peakLock = 0, fixAt = -1, lockAt = -1;
    for (let r = rows - 1; r >= 0; r--) {                            // top row first, so a tie is called for the top left
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        fixF[i] = kf * Math.abs(x[i]);
        if (c < cols - 1 && nlh[i]) lockH[i] = kl * Math.abs(x[i] - x[i + 1]);
        if (r < rows - 1 && nlv[i]) lockV[i] = kl * Math.abs(x[i] - x[i + cols]);
        if (fixF[i] > peakFix * (1 + 1e-9)) { peakFix = fixF[i]; fixAt = i; }
        const lk = Math.max(lockH[i], lockV[i]);
        if (lk > peakLock * (1 + 1e-9)) { peakLock = lk; lockAt = i; }
      }
    }
    const x1 = Float64Array.from(x);
    let reaction = 0; for (let i = 0; i < n; i++) reaction += nf[i] * kf * x[i];

    const events = []; let lam = 0, lostTotal = 0, truncated = false;
    if (Tf > 0 || Tl > 0) {
      for (let iter = 0; iter < LOCK_EVENTS_MAX; iter++) {
        if (iter > 0) solve(1e-20);
        const best = worst();
        if (!(best > 1e-12)) break;
        const lamFail = Math.max(lam, 1 / best);
        if (lamFail > LOCK_LAM_FAR) break;
        if (events.length && lamFail > lamStop) break;
        if (events.length && work > workMax) { truncated = true; break; }
        const thr = best * (1 - 1e-9), picks = [];
        for (let r = rows - 1; r >= 0; r--) {                        // everything within rounding of the worst goes together; top left is named first
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c; if (!alive[i]) continue;
            if (Tf > 0 && nf[i] > 0 && kf * Math.abs(x[i]) / Tf >= thr) picks.push([0, i]);
            if (Tl > 0) {
              if (c < cols - 1 && nlh[i] && alive[i + 1] && kl * Math.abs(x[i] - x[i + 1]) / Tl >= thr) picks.push([1, i]);
              if (r < rows - 1 && nlv[i] && alive[i + cols] && kl * Math.abs(x[i] - x[i + cols]) / Tl >= thr) picks.push([2, i]);
            }
          }
        }
        const kinds = { fix: 0, lockH: 0, lockV: 0 }, hit = new Set();
        let cut = false;                                             // did a fixing or a joint run out, so a cabinet may have lost its path to the frame?
        for (const [k, i] of picks) {
          if (k === 0) { if (--nf[i] === 0) cut = true; kinds.fix++; hit.add(i); }
          else if (k === 1) { if (--nlh[i] === 0) cut = true; kinds.lockH++; hit.add(i); hit.add(i + 1); }
          else { if (--nlv[i] === 0) cut = true; kinds.lockV++; hit.add(i); hit.add(i + cols); }
        }
        const lost = cut ? groundCheck() : []; lostTotal += lost.length; lam = lamFail;
        events.push({ lam: lamFail, n: picks.length, kinds, hit: Array.from(hit), lost, lostTotal, rep: { kind: picks[0][0], i: picks[0][1] } });
        if (lostTotal >= n) break;
      }
    }
    const lostAt = (lf) => { let c = 0; for (const e of events) { if (e.lam <= lf * (1 + 1e-9)) c = e.lostTotal; else break; } return c; };
    return { cols, rows, n, x: x1, fixF, lockH, lockV, peakFix, peakLock, fixAt, lockAt, reaction, load: F.reduce((s, v) => s + v, 0),
      events, lamFirst: events.length ? events[0].lam : Infinity, lostAt, truncated, kf, kl, Tf, Tl, fixN, lockN };
  }

  /* The cabinet loads of the load in play, and the lock network under them. Wind (outdoors, a draught, a door gust) is a pressure on every cabinet,
     stronger up the height outdoors and by `edge` on the top and side edges; a shake is the cabinet's own weight times the acceleration; a knock is one
     push on one cabinet. Only a load that pulls the cabinets off their frame is checked: wind from the front, or a push from the front, presses them
     onto it. Returns null when the check is off. */
  function locksFor(S, D) {
    const lk = S.locks; if (!lk || !lk.on || !D) return null;
    const cols = D.cols, rows = D.rows, n = cols * rows, cabH = D.cabH, area = CAB.w * cabH, y0 = SHEET.screenBottom, hs = D.geom.hs;
    const kind = D.loadKind, cs = D.loadCase;
    const alpha = S.mode === 'outdoor' ? (PROFILE_ALPHA[S.profile] || 0) : 0;
    const psi = (zAbs) => (alpha ? Math.pow(Math.max(zAbs, 3) / 10, 2 * alpha) : 1);
    const edge = clamp(+lk.edge || 1, 1, 4), fixN = clamp(Math.round(lk.fixN) || 1, 1, 16), lockN = clamp(Math.round(lk.lockN) || 0, 0, 16);
    const pat = lk.pattern === 'edge' || lk.pattern === 'even' ? lk.pattern : 'en', enw = pat === 'en' && enRule(S) === 'wall' ? enWall(S.W, S.H) : null;
    const out = { on: true, kind, cs, cols, rows, n, cabH, area, fixN, lockN, edge, pattern: pat === 'en' ? (enw ? 'en' : 'even') : pat, stiff: lk.stiff > 0 ? lk.stiff : 1, TfKgf: Math.max(0, +lk.fixKgf || 0), TlKgf: Math.max(0, +lk.lockKgf || 0) };
    out.entered = out.TfKgf > 0 || out.TlKgf > 0;
    out.active = kind === 'wind' ? D.dir === 'rear' : kind === 'force' ? S.knock.from !== 'front' : true;
    out.why = out.active ? '' : kind === 'wind' ? 'Wind from the front presses the cabinets onto the frame, so their locks are not pulled.' : 'A push from the front presses the cabinet onto the frame, so its locks are not pulled.';
    const F = new Float64Array(n);
    let ld = null, knockAt = -1;
    if (out.active) {
      if (kind === 'wind') {
        const pBase = D.wind.qPeak * D.wind.cn * D.wind.cfTot;
        for (let r = 0; r < rows; r++) {
          const p = pBase * psi(hs + y0 + (r + 0.5) * cabH);
          for (let c = 0; c < cols; c++) {
            const f = pat === 'edge' ? 1 + (edge - 1) * ((r === rows - 1 ? 1 : 0) + (c === 0 ? 1 : 0) + (c === cols - 1 ? 1 : 0))      // a plain factor on the top and side edges
              : enw ? enw.env[c] / enw.mean : 1;                                                                                    // or the zones of EN 1991-1-4 Table 7.9 (the wind can arrive at either end)
            F[r * cols + c] = p * area * f;
          }
        }
      } else if (kind === 'accel') {
        ld = loadFor(S, cs, 'rear'); F.fill(S.kgm2 * area * ld.acc);
      } else {
        const row = clamp(Math.floor((S.knock.h - y0) / cabH), 0, rows - 1); knockAt = row * cols + Math.floor(cols / 2);
        F[knockAt] = Math.max(0, S.knock.kgf) * G;
      }
    }
    out.knockAt = knockAt;
    const net = lockNet({ cols, rows, F, fixN, lockN, kl: out.stiff, Tf: out.TfKgf * G, Tl: out.TlKgf * G, lamStop: Math.max(S.SF, 1) * (1 + 1e-9) });
    const kgf = (v) => v / G, f32 = (a) => Float32Array.from(a, kgf);
    out.net = net;
    out.load = { total: kgf(net.load), max: kgf(Math.max(0, ...F)), mean: n ? kgf(net.load / n) : 0 };
    out.F = f32(F); out.fixF = f32(net.fixF); out.lockH = f32(net.lockH); out.lockV = f32(net.lockV);
    out.peak = { fix: kgf(net.peakFix), lock: kgf(net.peakLock), fixAt: net.fixAt, lockAt: net.lockAt };
    out.need = { fix: out.peak.fix * S.SF, lock: out.peak.lock * S.SF };
    out.events = net.events; out.lamFirst = net.lamFirst; out.truncated = net.truncated;
    out.sig = [kind, cs, out.active, n, out.TfKgf, out.TlKgf, fixN, lockN, edge, out.stiff, net.load.toFixed(4), isFinite(net.lamFirst) ? net.lamFirst.toFixed(6) : '-', net.events.length].join('|');
    out.lostAt1 = net.lostAt(1); out.lostAtSF = net.lostAt(S.SF);
    // one failure drags the next along within a hair of the same load, so the failures that come within 3% of each other are shown as one step
    out.groups = [];
    net.events.forEach((e, k) => {
      const g = out.groups[out.groups.length - 1];
      if (g && e.lam <= g.lam * 1.03) { g.last = k; g.n += e.n; g.fix += e.kinds.fix; g.lock += e.kinds.lockH + e.kinds.lockV; for (const i of e.hit) g.hitSet.add(i); for (const i of e.lost) g.lost.push(i); g.lostTotal = e.lostTotal; }
      else out.groups.push({ first: k, last: k, lam: e.lam, n: e.n, fix: e.kinds.fix, lock: e.kinds.lockH + e.kinds.lockV, hitSet: new Set(e.hit), lost: e.lost.slice(), lostTotal: e.lostTotal, rep: e.rep });
    });
    for (const g of out.groups) { g.hit = Array.from(g.hitSet); delete g.hitSet; }
    // how hard each cabinet's own fixings and the joints around it are worked: against the strengths you typed, else against the busiest element
    const use = new Float32Array(n), ref = Math.max(out.peak.fix, out.peak.lock, 1e-12);
    const fixU = (v) => (!out.entered ? v / ref : out.TfKgf > 0 ? v / out.TfKgf : 0), lockU = (v) => (!out.entered ? v / ref : out.TlKgf > 0 ? v / out.TlKgf : 0);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        let u = fixU(out.fixF[i]);
        for (const v of [out.lockH[i], c > 0 ? out.lockH[i - 1] : 0, out.lockV[i], r > 0 ? out.lockV[i - cols] : 0]) u = Math.max(u, lockU(v));
        use[i] = u;
      }
    }
    out.use = use; out.useKind = out.entered ? 'strength' : 'relative';
    out.status = !out.active ? 'inactive' : !out.entered ? 'none' : out.lamFirst < 1 - 1e-9 ? 'fail' : out.lamFirst < S.SF - 1e-9 ? 'marginal' : 'ok';
    out.unit = kind === 'wind' ? { v: D.wind.vPeak } : kind === 'accel' ? { g: out.active ? ld.acc / G : 0 } : { kgf: S.knock.kgf };      // what a load factor of 1 is
    // the load at which the first lock lets go, in the units of the load in play
    if (isFinite(out.lamFirst) && out.active) {
      if (kind === 'wind') { const v = D.wind.vPeak * Math.sqrt(out.lamFirst); out.limit = { kind: 'speed', v, bft: beaufort(v) }; }
      else if (kind === 'accel') out.limit = { kind: 'accel', g: out.lamFirst * ld.acc / G };
      else out.limit = { kind: 'force', kgf: out.lamFirst * S.knock.kgf };
    } else out.limit = null;
    return out;
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
      this.rig = D.rig; this.gust = S.mode === 'outdoor' ? D.wind.gust : 0;
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
      this.t = 0; this.phi = 0; this.omega = 0; this.toppled = false; this.toppledAt = -1; this.maxPhi = 0; this.impactAt = -1; this.lastU = 0; this.lam = 0; this.lamB = 0; this.Ph = 0; this.broken = false;
      this.q = 0; this.qd = 0; this.qdd = 0; this.qMax = 0;      // the first mode of the wall: how far its top has moved, how fast, how fast that changes, the most it has swung
      this.resetLocks();
      this.side = this.dirSign || 1;                       // +1 tilting forward about the front toe, -1 backward about the rear toe
      this.pushDir = this.dirSign || 1;
      this.ground = 0;                                     // how far the floor is displaced, -1..1 of its peak
    }
    /* The cabinet locks (see locksFor): when the load on the wall has reached the next lock's limit, that lock lets go, and any cabinet left with no hold
       on the frame comes off. The load only has to have been that high once, so it is the highest load so far that counts. */
    setLocks(L) {
      const lk = L && L.active && L.events && L.events.length ? L : null, sig = lk ? lk.sig : '';
      if (sig !== this.lkSig) { this.lkSig = sig; this.lk = lk; this.resetLocks(); } else this.lk = lk;
    }
    resetLocks() {
      this.lkI = 0; this.lamPeak = 0; this.lkCount = 0; this.lkLastAt = -1;
      const n = this.lk ? this.lk.n : 0;
      this.lkLost = n ? new Uint8Array(n) : null; this.lkHit = n ? new Uint8Array(n) : null; this.lkLostAt = n ? new Float32Array(n).fill(-1) : null;
    }
    lockStep() {
      const L = this.lk; if (!L || this.toppled || !this.lkLost) return;
      const a = Math.abs(this.lam); if (a > this.lamPeak) this.lamPeak = a;
      while (this.lkI < L.events.length && this.lamPeak >= L.events[this.lkI].lam * (1 - 1e-12)) {
        const ev = L.events[this.lkI++];
        for (const i of ev.hit) this.lkHit[i] = 1;
        for (const i of ev.lost) { this.lkLost[i] = 1; this.lkLostAt[i] = this.t; this.lkCount++; }
        this.lkLastAt = this.t;
      }
    }
    /* The first mode, q'' + 2 zeta w q' + w^2 q = Gamma a. A stiff wall has a fast mode, so the step is cut up to keep it stable; above about 300 Hz it just follows the load. */
    stepMode(md, a, dt) {
      const wdt = md.w * dt;
      if (wdt > 8) { this.q = md.Gamma * a / (md.w * md.w); this.qd = 0; this.qdd = 0; return; }
      const ns = Math.max(1, Math.ceil(wdt / 0.25)), h = dt / ns;
      for (let k = 0; k < ns; k++) { this.qdd = md.Gamma * a - 2 * md.zeta * md.w * this.qd - md.w * md.w * this.q; this.qd += this.qdd * h; this.q += this.qd * h; }
      const amp = Math.hypot(this.q, this.qd / md.w); if (amp > this.qMax) this.qMax = amp;          // how big the vibration has been, to tell when it has died down
    }
    ramp(t) { const x = clamp(t / 1.5, 0, 1); return x * x * (3 - 2 * x); }
    windU(t) { const m = 1 + this.gust * gustN(t * 0.9 + 3); return this.ramp(t) * m / (1 + this.gust); }
    /* A door gust, a knock or an earthquake happens once, one second after the start; the wind, the draught, the code load and the sway go on
       until the simulation is ended. doneAt is when the event is over (null for loads that go on). */
    get doneAt() {
      switch (this.caseId) {
        case 'door': return 1 + this.door.dur;
        case 'knock': return 1 + this.knock.dur;
        case 'quake': return 1 + this.quake.dur;
        default: return null;
      }
    }
    /* the load at time t: u (speed or load fraction), lam (load factor, signed when it can push either way), gs (weight factor), g (floor displacement) */
    loadAt(t) {
      switch (this.caseId) {
        case 'door': { const u = pulseAt(t, 1, this.door.dur, 0.5, 0.7, Infinity); return { u, lam: u * u, gs: 1, g: 0 }; }
        case 'knock': {
          const u = pulseAt(t, 1, this.knock.dur, 0.05, 0.1, Infinity);
          const sgn = this.knock.from === 'rear' ? 1 : this.knock.from === 'front' ? -1 : this.pushSign;      // "worst side": the weaker way
          return { u, lam: this.shake ? sgn * u : u, gs: 1, g: 0 };
        }
        case 'sway': { const r = smoothstep(t / 2), s = Math.sin(2 * Math.PI * this.sway.f * t) * r; return { u: s, lam: s, gs: 1 - this.sway.bounce * Math.abs(s), g: s }; }
        case 'quake': {
          const tau = t < 1 ? -1 : t - 1;
          if (tau < 0) return { u: 0, lam: 0, gs: 1, g: 0 };
          const a = recAt(this.recs.h.acc, tau), v = recAt(this.recs.v.acc, tau);
          return { u: a, lam: a, gs: 1 + 0.5 * this.quake.pga * this.quake.floor * v, g: -recAt(this.recs.h.disp, tau) };
        }
        case 'notional': { const u = this.ramp(t); return { u, lam: this.pushSign * u, gs: 1, g: 0 }; }
        default: { const u = this.windU(t); return { u, lam: u * u, gs: 1, g: 0 }; }
      }
    }
    step(dt) { if (this.shake) this.stepShake(dt); else this.stepOne(dt); this.lockStep(); }
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
      if (!this.toppled && this.phi > R.phiCrit && net > 0 && (!R.strap || this.broken || this.phi > 0.6)) { this.toppled = true; this.toppledAt = this.t; }
    }
    /* Shaking, or a push from either side. The wall rests flat, or rocks about the front toe (side +1) or the rear toe (side -1). Each toe has its
       own geometry. When it comes back to the floor the other toe lands, some energy is lost, and it goes on over to the other side if it still has the speed. */
    stepShake(dt) {
      this.t += dt;
      const L = this.loadAt(this.t), lam = L.lam, gs = L.gs;
      this.lastU = L.u; this.lam = lam; this.ground = L.g;
      this.lamB = lam * this.dirSign;                      // the load factor along the weaker way, which is how the bending is worked out
      if (Math.abs(lam) > 1e-3) this.pushDir = lam >= 0 ? 1 : -1;       // which way the last push went (for the picture)
      const md = this.shake.fwd.modal;                      // the wall's first mode moves under the shake; its inertia takes part of the load off the base and puts it back
      if (md) this.stepMode(md, this.shake.fwd.acc * lam, dt);
      const moment = (side, phi) => {
        const r = side > 0 ? this.shake.fwd : this.shake.back, c = Math.cos(phi), s = Math.sin(phi), ll = side * lam;   // ll < 0: the load helps this side
        let Tr = 0, Ti = 0;
        for (let i = 0; i < r.m.length; i++) { Tr += r.m[i] * G * (r.x[i] * c - r.y[i] * s); Ti += r.m[i] * (r.y[i] * c + r.x[i] * s); }
        const Tw = r.acc ? ll * r.acc * Ti - (r.modal ? side * this.qdd * r.modal.B : 0) : ll * r.F * c * (r.hc * c + r.xiw * s);
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
      if (!this.toppled && this.phi > r.phiCrit && this.omega > 0 && (!r.strap || this.broken || this.phi > 0.6)) { this.toppled = true; this.toppledAt = this.t; }
    }
    liftMM(depth) { return Math.sin(this.phi) * depth * 1000; }
  }

  return { G, CAB, SHEET, SCALE, CABINETS, cabArea, cabHeight, RESTRAINT, PROFILE_ALPHA, MAX_BALLAST, SF_CAP, BFT_NAME, BFT_SPEED, bftRange, CASES, CASE_KIND, CASE_NAME, QUAKE_ZONES, beaufort, defaults, derive, compareCases, loadFor, lockNet, locksFor, makeRecord, gustN, Sim, sheetBases, clamp, windInfo, scanSys, lamAt,
    TERRAIN, terrainOf, turbInt, gustEN, gustOf, wallTop, zRef, EN_WALL_ROWS, enWallRow, enWall, enRule, WIND_SHAPES, cfOf, LOCK_PRESETS, modalOf, dafHarm };
});
