# LED Wall Ballast Simulator

**Live version: https://unilordgr.github.io/led-ballast-simulator/** (runs in any browser, nothing to install)

An interactive simulator for stacked LED screens. Choose the cabinets, how wide and how tall the wall is, how many bases it stands on and how much ballast sits at the rear of each base. Then push wind at it, indoors or outdoors, and watch whether it holds, how far the top bends, whether the straps hold and whether the stage underneath copes.

It started from the spreadsheet *Calculation for indoor stacking system of ballast weight* and reproduces that sheet exactly. On top of the sheet it adds a bending wall, straps, a stage and outdoor wind.

It is one HTML file with no dependencies. There is nothing to install: open `index.html` in any browser, or host it as a static page.

## What you can do

- **Cabinets:** 500 × 500 mm or 500 × 1000 mm, with weights from Unilumin datasheets (Uslim2, Uslim4, UGC, USlim-O3, USlim-O4), the sheet's own 26.4 kg/m², or your own number.
- **Wall and bases:** any width and height, any number of bases, ballast per base set by hand or solved automatically for the safety factor you ask for.
- **Environment:** indoor draught using the sheet's wind scale, or outdoor wind in m/s with the Beaufort scale, gusts and a wind gradient (open country, suburb, city).
- **Wind direction:** from the rear or the front, and any angle in between. A dial shows it.
- **Stage:** put the wall on a standard deck, pick the stage height, depth and how far the screen sits from the front edge. It checks the wall sliding on the deck and the stage and wall tipping together about the stage edge, and compares the load with the deck rating.
- **Straps:** ratchet strap, steel cable or rear truss, from the top of the wall (or any height) to the floor or the stage deck, with a rated load and an anchor weight.
- **Views:**
  - a side view of one base with the forces and moment arms drawn on it,
  - a 3D front view in which the top moves further than the bottom (bending is drawn exaggerated unless you switch to true scale),
  - a rear view of the ballast,
  - a wind dial from above,
  - a stability map of ballast against wind speed,
  - a bending profile.
- **Animation:** wind and gusts run live. A wall that is pushed past its tipping point rocks over, and one held by straps stays up and leans.
- **The sheet, cell by cell:** the original formulas with your current numbers filled in.
- Quick scenarios: *Sheet example*, *No ballast*, *Strong draught*, *Front draught*, *Outdoor breeze*, *Outdoor gale*, *On a stage*, *Top straps*.

The defaults reproduce the sheet: a 14 m × 7 m wall of 500 × 500 cabinets on 14 bases needs 9.06 kg of ballast per base (126.8 kg in all) at a safety factor of 1.5.

## Run it

```bash
open index.html            # macOS; or just double-click the file
```

Or host the folder anywhere that serves static files. On GitHub Pages: *Settings → Pages → Deploy from a branch → `main` / root*. The page only reaches outside for Google Fonts, and falls back to system fonts without them.

## How it works

**The sheet.** Wind pushes on the whole screen at half its height plus 0.1 m. The screen, the back frame and the ballast resist it about the toe of the base:

```
wind force × arm × safety factor = screen + frame + ballast moments
```

With wind from the rear the toe is under the screen (screen arm 0, frame arm 0.46 m, ballast arm 0.862 m). With wind from the front the toe is at the rear of the base (screen arm 0.922 m, frame and ballast arm 0.46 m). Wind pressure is ½ · 1.25 · v².

**Beyond the sheet.**

- *Tipping.* The wall is treated as a rigid body that rocks about the toe. The safety factor is the largest multiple of the wind load at which the moments (weights, wind and strap pull) can still balance for some rotation. Outdoors this gives the wind speed at tipping.
- *Bending.* The wall is a cantilever (bending plus shear) loaded by wind pressure, so the top moves more than the bottom. The stiffness per base is a setting.
- *Straps.* A strap, cable or truss is a spring from the screen to an anchor. It only pulls as hard as the wall moves it, plus the lift of the base. The program finds the largest wind the wall can take before a strap reaches its rated load or the wall passes its tipping point. Elongation at rated load: ratchet strap 7 % (the EN 12195-2 limit), steel cable 0.4 %, truss 0.03 %. Anchor weights are checked for uplift and sliding.
- *Stage.* Two failure systems are checked and the worse one governs: the wall on the deck, and the stage with the wall about the stage edge.
- *Wind.* Outdoors, gusts raise the design wind to the peak speed, and the animation replays them. The gradient uses a power law (exponent 0.14, 0.22 or 0.30), measured from the floor including the stage.

## Assumptions and limits

- Straps are hand-tight with no slack. A loose strap lets the wall start to fall before it pulls and then takes a shock load.
- Bending stiffness is illustrative (about two 50 × 50 × 3 aluminium posts 0.38 m apart per base, EI = 2.9 MN·m²). Set it to your own frame in *Advanced*.
- The sheet counts frame weight per 1 m row. With 500 mm cabinets that would double it, which is not conservative, so the frame is counted per metre of height here (4 kg per metre per base, plus 4.15 kg per base and 7.9 kg per metre of width, as in the sheet).
- The sheet's wind table lists 0.14 N/m² for scale 1 (1.5 m/s). That should be 1.4, so 1.4 is used.
- Frame strength, cabinet locks, anchors and the ground are not checked. Sliding is an extra check; the sheet assumes enough friction.
- Where straps carry the load the safety factor is shown as "10+" rather than a precise number.

**This is a rough reference.** As the sheet itself says, it cannot replace a structural simulation or a practical test. Use it to see how a wall reacts and to size a first guess, and have a qualified rigger or engineer approve any real installation.

## Sources

- The spreadsheet *Calculation for indoor stacking system of ballast weight*.
- Unilumin datasheets and listings: Uslim4 500 × 1000 mm 13 kg, Uslim2 500 × 500 mm 7.8 kg, USlim-O3 14.8 kg, USlim-O4 32 to 34 kg, UGC 5.6 kg.
- Steeldeck 8 × 4 ft stage deck, rated about 7.5 kN/m².
- EN 12195-2 for ratchet strap elongation (manufacturer datasheets).
- ROE Visual and PRG guidance on wind loads and bracing for LED walls.

## Develop

Needs Python 3 for the build. Node is only used by the tests (and for a syntax check during the build); it was tested with Node 24. There are no packages to install.

```bash
python3 build.py                    # src/ -> index.html
node tests/model.test.js            # physics checks, including the sheet's own cases
node tests/fuzz.test.js             # 4000 random set-ups, looking for contradictions
python3 tests/sheet_ref.py          # rewrites tests/sheet_cases.json from an independent copy of the sheet
```

| Path | What it holds |
| --- | --- |
| `index.html` | The built page: everything in one file. Do not edit by hand. |
| `src/model.js` | The physics. No page code, so Node can run it too. |
| `src/scene.js`, `rig.js`, `front.js`, `views.js` | Canvas drawing: environments, side view, 3D front view, rear view, dial, map, bending chart. |
| `src/app.js` | State, controls, scenarios, animation loop. |
| `src/body.html`, `src/style.css` | Markup and styling (light and dark). |
| `tests/` | Physics tests, fuzz test, and a Python copy of the sheet used as reference. |
