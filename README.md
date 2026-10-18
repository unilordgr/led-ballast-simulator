# LED Wall Ballast Simulator

**Live version: https://unilordgr.github.io/led-ballast-simulator/** (runs in any browser, nothing to install)

An interactive simulator for stacked LED screens. Choose the cabinets, how wide and how tall the wall is, how many bases it stands on and how much ballast sits at the rear of each base. Then push wind at it, indoors or outdoors, and watch whether it holds, how far the top bends, whether the straps hold and whether the stage underneath copes.

It started from the spreadsheet *Calculation for indoor stacking system of ballast weight* and reproduces that sheet exactly. On top of the sheet it adds a bending wall, straps, a stage and outdoor wind.

It is one HTML file with no dependencies. There is nothing to install: open `index.html` in any browser, or host it as a static page.

## How to use it

1. **Set up the wall.** The settings on the left are in tabs: **Wall** (cabinets, size, bases, ballast), **Stage & straps**, **Load** (what pushes on the wall) and **Advanced**. Choosing a load, such as *Knock* or *Earthquake*, only picks the load: it never touches the wall you set up.
2. **Let it work out the ballast, or enter your own.** *Work it out for me* finds the least ballast per base that gives your safety margin. *I'll enter it* lets you type or drag a weight, and offers a button to use the weight the load needs.
3. **Read the verdict.** The strip under the picture always shows stable, marginal or will tip over, the safety factor, the ballast needed and the ballast you have. The tabs below it hold the **Summary**, the **Drawings** and the **Details** (the sheet, cell by cell).
4. **Press Start simulation.** Nothing moves until you do. A door gust, a knock or an earthquake happens once, a second in, and then the wall settles and you are told whether it held or toppled. Wind, a draught, the code load and stage sway go on until you press **End simulation**. You can pause, restart, change the speed, or change the wall while it runs.

**New wall** puts every setting back to the starting values (and *Undo* brings your wall back). **Examples** loads a whole ready-made wall, such as the sheet wall, a strong draught, a door gust, an earthquake or a gale. Your wall is kept in this browser, so it is there when you come back. On a phone the picture stays at the top while you change the settings below it. Space starts, pauses or restarts the simulation and Escape ends it.

## What you can do

- **Cabinets:** 500 × 500 mm or 500 × 1000 mm, with weights from Unilumin datasheets (Uslim2, Uslim4, UGC, USlim-O3, USlim-O4), the sheet's own 26.4 kg/m², or your own number.
- **Wall and bases:** any width and height, any number of bases, ballast per base set by hand or solved automatically for the safety factor you ask for.
- **Outdoor wind:** set in Beaufort (0 to 12, the way forecasts give it) or in m/s, with gusts and a wind gradient (open country, suburb, city). Picking a Beaufort force uses the top of its speed range, like the sheet's wind table.
- **Indoor loads:** indoors wind is not the real load, so you choose what pushes on the wall: the sheet's **draught**, a **door gust** (speed and how long it lasts), a **knock** or push (force, height, which side, how many bases share it), **stage sway** (deck movement in mm at a frequency, with optional up-and-down bounce), an **earthquake** (ground acceleration, with the three Greek seismic zones as presets, and which floor of the building) or the **code minimum** (a sideways load of 2.5% of the weight). A table compares all of them on your ballast, so you can see which one governs.
- **Cabinet locks (a what-if):** switch on *Check the locks* in the Wall tab and type the strength of your frame fixings and your cabinet-to-cabinet locks. The simulator works out the load on every cabinet and every lock, tells you which lock lets go first and at what load, and then lets the most loaded lock break and the load move on, so you can see whether one cabinet comes off or the failure zips along the wall. With no strengths typed it still tells you how strong your locks must be for your margin.
- **Wind direction:** from the rear or the front, and any angle in between (draught, door gust and outdoor wind). A dial shows it.
- **Stage:** put the wall on a standard deck, pick the stage height, depth and how far the screen sits from the front edge. It checks the wall sliding on the deck and the stage and wall tipping together about the stage edge, and compares the load with the deck rating.
- **Straps:** ratchet strap, steel cable or rear truss, from the top of the wall (or any height) to the floor or the stage deck, with a rated load and an anchor weight.
- **Views:**
  - a side view of one base with the forces and moment arms drawn on it,
  - a 3D front view in which the top moves further than the bottom (bending is drawn exaggerated unless you switch to true scale),
  - a rear view of the ballast,
  - a wind dial from above,
  - a stability map of ballast against wind speed,
  - a bending profile.
- **Animation:** once you press Start, wind, gusts, pushes and shaking run live. A wall that is pushed past its tipping point rocks over, and one held by straps stays up and leans. Under shaking it rocks about either toe, and a brief gust or push that lifts the wall can leave it standing. When that happens but the safety factor says it should tip, the result says it held only because the load was brief.
- **The sheet, cell by cell:** the original formulas with your current numbers filled in.
- **Examples:** *Sheet wall*, *No ballast*, *Strong draught*, *Front draught*, *Door gust*, *Knock*, *Weak locks*, *Stage wobble*, *Earthquake*, *Outdoor breeze*, *Outdoor gale*, *On a stage* and *Top straps*. Each replaces the whole wall, and *Undo* brings yours back.

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

### Cabinet locks

This is a what-if, not a prediction: nobody knows your locks' real strength except you (and your manufacturer), so you type it in. It checks the one thing the tipping check cannot: whether a cabinet is pulled off its frame.

- *The load on each cabinet.* Wind is a pressure on every cabinet (the same pressure model as the rest, stronger up the height outdoors, and stronger by the *Extra wind on the edges* factor on the top and side edges; the default 1.5 is a guess, set 1 for an even load). A shake is the cabinet's own weight times the acceleration. A knock is one push on the one cabinet at that height, in the middle of the wall.
- *The network.* Every cabinet is held to the back frame by a number of fixings, and to each neighbour by a number of locks. They are springs, the cabinets are the nodes and the frame is the ground. A cabinet that is pulled harder than its neighbours hands part of its load on through the locks. The solver is a conjugate-gradient solve, and tests check it against hand-worked cases and that what the frame holds is exactly what the wind pulls.
- *Breaking.* The fixing or lock with the largest load over strength lets go first, at a load factor of 1 divided by that ratio. The network is solved again without it and the next one goes, and so on. If one failure pushes the next past its limit at once they go together, so a wall with no weak spot lets go all in one step. A cabinet whose fixings have gone but is still locked to its neighbours hangs on and passes its load to them. A cabinet with no hold left on the frame comes off. The steps of the failure are numbered on the map.
- *Which direction.* Only a load that pulls the cabinets off the frame is checked: wind from the rear, a push from the rear, a shake. Wind or a push from the front presses the cabinets onto the frame, and the locks are not loaded.
- *In the simulation* the locks let go as the load reaches each limit (the highest load so far counts), cabinets drop off the wall in the front view, and the result says how many came off.
- *Limits.* The strengths are yours, and so is the stiffness ratio in *Advanced* (1 means a lock gives as much as a fixing). Stretching of the vertical locks from the wall bending, the frame and base plate strength, dynamic gust loads and one cabinet hitting another as it falls are not checked. A cabinet coming off does not change the tipping check. A very long failure run is cut short (the page says so) so the page stays fast.

### Indoor loads

Air in a hall hardly moves, so the sheet's wind scale really stands in for sideways loads that nobody has measured: a draught, a bump, a wobbling floor. At Beaufort 2 it pushes with about 2% of the wall's weight, close to the 2.5% that temporary-works rules ask for as a minimum. The simulator lets you pick the loads one by one:

| Load | What it is | How it is worked out |
| --- | --- | --- |
| Draught | The sheet's wind scale | The sheet's formulas, unchanged |
| Door gust | Air through a door for a moment | Wind pressure at your speed; the animation shows a gust of your length |
| Knock | A person leans, bumps or pushes a trolley | A push at one height, carried by the bases that share it |
| Stage sway | The deck wobbles | Every mass feels the acceleration (2π·f)²·amplitude; bounce makes the wall lighter at the peaks |
| Earthquake | The ground shakes | Ground acceleration times the building's amplification (up to 2.5 on a top floor), with a vertical shake of half of it |
| Code minimum | A notional sideways load | 2.5% of the weight, for out-of-plumb and rough handling |

For shaking and for a push from either side the wall is checked both ways, because the screen's weight sits at the front toe: tipping forward is the weak direction. The ballast sits where it helps most (rear end against a forward tip, middle when the load can come from both sides). The safety factor is the usual steady-load check (tipping acceleration, push or gust against yours). The animation is a rocking-block simulation about either toe, with an earthquake-like record, so it also shows what a short load really does. It uses a single deterministic record, so it shows what could happen, not what will.

## Assumptions and limits

- A sudden push, gust or shake on a strapped wall can double the pull on the strap compared with the static figure.
- Sliding is checked but not simulated, so a shake above µ·g, which would make the wall slide and lower the load on it, is not followed.
- Building rules for interior partitions ask for 0.24 kN/m² (5 psf). That is about 35 times the sheet's Beaufort 2 pressure. It is meant for walls people lean on, not for LED screens, so it is not used here.
- The sway and push defaults are engineering guesses, not figures from a standard. Check them against your venue.
- Straps are hand-tight with no slack. A loose strap lets the wall start to fall before it pulls and then takes a shock load.
- Bending stiffness is illustrative (about two 50 × 50 × 3 aluminium posts 0.38 m apart per base, EI = 2.9 MN·m²). Set it to your own frame in *Advanced*.
- The sheet counts frame weight per 1 m row. With 500 mm cabinets that would double it, which is not conservative, so the frame is counted per metre of height here (4 kg per metre per base, plus 4.15 kg per base and 7.9 kg per metre of width, as in the sheet).
- The sheet's wind table lists 0.14 N/m² for scale 1 (1.5 m/s). That should be 1.4, so 1.4 is used.
- Frame strength, anchors and the ground are not checked, and cabinet locks only in the what-if above, on strengths you type. Sliding is an extra check; the sheet assumes enough friction.
- Where straps carry the load the safety factor is shown as "10+" rather than a precise number.

**This is a rough reference.** As the sheet itself says, it cannot replace a structural simulation or a practical test. Use it to see how a wall reacts and to size a first guess, and have a qualified rigger or engineer approve any real installation.

## Sources

- The spreadsheet *Calculation for indoor stacking system of ballast weight*.
- Unilumin datasheets and listings: Uslim4 500 × 1000 mm 13 kg, Uslim2 500 × 500 mm 7.8 kg, USlim-O3 14.8 kg, USlim-O4 32 to 34 kg, UGC 5.6 kg.
- Steeldeck 8 × 4 ft stage deck, rated about 7.5 kN/m².
- EN 12195-2 for ratchet strap elongation (manufacturer datasheets).
- ROE Visual and PRG guidance on wind loads and bracing for LED walls.
- Notional sideways load of 2.5% of the vertical load for temporary works: [Hong Kong Labour Department falsework code](https://www.labour.gov.hk/eng/public/os/C/falsework_eng.pdf) (BS 5975 uses the same figure).
- Push forces: [CCOHS, Pushing and pulling](https://ccohs.gc.ca/oshanswers/ergonomics/push1.html): about 225 N for a whole-body push, up to about 675 N when braced.
- Earthquakes: the Greek National Annex to Eurocode 8 uses design ground accelerations of 0.16, 0.24 and 0.36 g ([Springer, 2024](https://link.springer.com/article/10.1007/s10518-024-01919-8)); force on non-structural elements from EN 1998-1, 4.3.5 ([explained here](https://protasoftware.com/wiki/seismic-forces-on-non-structural-members/)), with a rigid element on the roof feeling up to 2.5 times the ground.
- Air through doorways, mostly 0.5 to 2.5 m/s: [AIVC, entrance doors](https://www.aivc.org/resource/infiltration-characteristics-entrance-doors).
- Level floors matter for ground-supported LED walls, which lean forward: [Nationwide Video](https://nationwidevideo.com/ground-supported-led-wall-ballast-factors/).

## Develop

Needs Python 3 for the build. Node is only used by the tests (and for a syntax check during the build); it was tested with Node 24. There are no packages to install.

```bash
python3 build.py                    # src/ -> index.html
node tests/model.test.js            # physics checks, including the sheet's own cases
node tests/fuzz.test.js             # 4000 random set-ups (half with cabinet locks), looking for contradictions
python3 tests/sheet_ref.py          # rewrites tests/sheet_cases.json from an independent copy of the sheet
```

| Path | What it holds |
| --- | --- |
| `index.html` | The built page: everything in one file. Do not edit by hand. |
| `src/model.js` | The physics. No page code, so Node can run it too. |
| `src/scene.js`, `rig.js`, `front.js`, `views.js` | Canvas drawing: environments, side view, 3D front view, rear view, dial, map, bending chart. |
| `src/app.js` | State, controls, the saved wall, New wall and Examples, the Start and End flow, animation loop. |
| `src/body.html`, `src/style.css` | Markup and styling (light and dark). |
| `tests/` | Physics tests, fuzz test, and a Python copy of the sheet used as reference. |
