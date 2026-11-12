# Notes for AI agents

konfetti is a programming language whose programs are colored confetti bits
at positions on the ground. `SPEC.md` defines it and is the source of truth:
if code and spec disagree, raise it rather than picking one.

## Commands

Cargo may not be on `PATH`. If `cargo` is not found, prefix commands with
`PATH="$HOME/.cargo/bin:$PATH"`.

```sh
make test     # cargo test: runtime and CLI tests
make          # web/konfetti.wasm first, then the release CLI at target/release/konfetti
make serve    # editor at http://localhost:8137/web/
make app      # the Mac app: src-tauri/target/release/bundle/macos/Konfetti.app (needs the Tauri CLI)
target/release/konfetti prog.kft            # stdin -> program -> stdout
target/release/konfetti --trace prog.kft    # each step and both stacks, on stderr
target/release/konfetti build prog.kft -o prog              # standalone executable
target/release/konfetti build prog.kft --html -o prog.html  # one self-contained web page
```

After changing `src/lib.rs`, run `make`: the editor runs `web/konfetti.wasm`,
which is a build output, and goes stale otherwise. The CLI embeds that same
file for `build --html`, which is why `make` builds the wasm first. The wasm is
tracked in git so that `cargo build` works on a clean checkout; commit the
rebuilt one with the runtime change.

Exit codes: 0 when the program halts, 1 with `konfetti: <path>: <reason>` on
stderr for I/O and load errors, 2 with the usage text for bad arguments.

## Map

- `src/lib.rs`: everything in the runtime. `parse` reads `.kft`; `compile`
  links bits and emits one instruction per `(prev, cur)` pair; `Vm::run` is the
  dispatch loop; `mod wasm` is the C ABI the editor calls; tests are at the
  bottom.
- `src/main.rs`: the CLI. `build` writes either a copy of the running binary
  with the source appended (then a u64 little-endian length and the magic
  `\x89KFTexe\n`; at startup the binary checks its own last 16 bytes), or the
  page template `APP`, whose `§` slots take the name, the source and the wasm
  as base64. Tests are at the bottom.
- `web/index.html`: the page, and the import map that points `three` and
  `three/addons/` at `web/vendor/three/`.
- `web/vendor/three/`: three.js 0.170.0, the files the editor imports and
  three's `LICENSE`, unchanged from the npm package. See "Rules of the
  codebase".
- `web/main.js`: the editor: bits and how they look, links and rings, the
  crayon outline, the paper tooth, wind physics, running, debug mode, keys,
  themes, `window.konfetti`. A mouse must hit a strip to pick it up; on a
  touch screen `bitAt` also takes a strip when the touch lands within
  `FINGER` (30 CSS px) of its long middle line: the nearest one, and the top
  one in a pile. See "How the world is drawn".
- `web/world.js`: the scenery as a watercolor pop-up book, the cannon and the
  wind flag, all procedural. `buildWorld(scene, renderer, grassCount)` returns
  `{ muzzle, update(dt, t, wind, camera) }`. Pass the camera every frame: the
  cut-outs turn and lean toward it and the balloons' glints face it.
  `grassCount` counts grass blades, drawn as
  `round(min(grassCount, 180000) / 8)` tufts of about eight. It also exports
  `PATIO` (the stones' radius), `PAPER` and `STONE` (bare paper and the
  stones' wash), `paint(material, inject)` (flat painted light),
  `hull(color, grow)` (a rim: the material for a second mesh of the same
  geometry, back faces only, pushed out by `grow`) and
  `strokes({ color, width, minPx, maxPx, opacity, fade })` (lines on the
  ground, a mesh with `.set(pts, alphas)`, never thinner on screen than
  `minPx`).
- `web/debug.js`: the debugger's words (`EXPLAIN`, `describe`) and views
  (stacks as boxes, the trace, the floating labels). No three.js.
- `web/sound.js`: every sound, synthesized with Web Audio. Exports `sound`.
- `web/hand.js`: the cartoon glove that replaces the mouse pointer, flat
  white with an ink rim made with `paint` and `hull` from `world.js`.
- `web/learn.js`: learn mode: the lesson list and the lesson card. It fetches
  `../lessons/`, so serve the repo root, as `make serve` does.
- `web/ui.css`: the panel, hint, debugger dock and labels, and the four
  themes: `paper` (the default), `toybox` (the base values), `craft` and
  `arcade`.
- `web/docs.html`: the guide for people, linked from the editor's panel. Static
  HTML with inline CSS and SVG, no script, no requests. Its second half,
  *Learn konfetti*, is 17 tutorials and a cheat sheet; see "Checking the docs".
- `web/sw.js`, `web/pwa.js`, `web/pwa.css`, `web/manifest.webmanifest`,
  `web/icons/`: konfetti as an installable app. The worker is network-first
  (3 s, then the cache) for our own files, three.js among them, and touches
  nothing from another origin, so it never caches the weather API. See "The site and the
  app".
- `index.html` and `.nojekyll` at the root: for GitHub Pages. The page only
  forwards to `web/`.
- `src-tauri/`: the Mac app, a Tauri 2 crate of its own (`konfetti-app`), not
  part of the root crate. `src/main.rs` is all of its code, `tauri.conf.json`
  its window, CSP and bundle, `icons/icon@2x.png` its icon. `build.rs` and the
  capability in `tauri.conf.json` give its one command, `location`, to the
  editor's window alone; `Info.plist` and `Entitlements.plist` are what macOS
  wants before an app may ask where it is. See "The Mac app".
- `lessons/`: the twelve lessons of learn mode. See "Lessons".
- `examples/*.kft`: `hello` and `cat` are also test fixtures. `dad`,
  `countdown`, `compare` and `reverse` are the programs of tutorials 13 to 16.
- `examples/mistakes/`: broken programs for tutorial 17, and their fixes.
- `examples/exercises/`: answers to the tutorials' exercises.

## Rules of the codebase

- All geometry is exact integer math. No floating point in `src/lib.rs`, ever:
  native and wasm must agree on every program.
- The palette order is the opcode order. It appears in `COLORS` in
  `src/lib.rs`, in `PALETTE` in `web/main.js`, in `EXPLAIN` in `web/debug.js`,
  in the palette strip of `APP` in `src/main.rs`, in the tables in `SPEC.md`,
  `README.md` and `web/docs.html`, and in `docs.html`'s band. Change them all
  together. The hex values also stand in the docs-check script below (`HEX`)
  and in every strip `docs.html` draws; its diagrams number the dark strips
  (red, blue, purple, black, brown) in white (`num on-dark`). The theme
  accents in `web/ui.css`, `--mark` in `docs.html` and the app icons are the
  interface's own colors, not the palette.
- The web side has no build step and no dependencies besides three.js, and
  loads nothing from another host: the only request that leaves is Wind's, to
  `api.open-meteo.com`. three.js is vendored at exactly 0.170.0 in
  `web/vendor/three/`, laid out as in the npm package: `build/three.module.js`
  (sha256 `ce1fa418de16a19495a9f72495580e3015d7745c296d3ce0485897f902ddedfb`),
  `examples/jsm/controls/OrbitControls.js` (`80efaadea4f8a636a65fb0bd08bfef62f3d93a0bb94e2e7500f23176c5c07f4e`)
  and `LICENSE` (`4c40a1ef62450b857c3b2aaf294936304cd552d965fbcd9d32d4c5bcf4ba4454`).
  Never edit them. An addon the editor starts to import is copied in from
  `https://registry.npmjs.org/three/-/three-0.170.0.tgz` at the same path,
  with every module it imports in turn.
- There are no asset files: textures are drawn and sounds are
  synthesized in code. The one exception is the app icons, `web/icons/*.png`,
  which `web/icons/icon.html` draws. To redraw them, open that page from a
  local server and save as PNG the canvas `draw(size, 'blue4', shape, zoom)`
  returns (`.toDataURL('image/png')`): `draw(192, 'blue4', 'any')` and
  `draw(512, 'blue4', 'any')` for `icon-192.png` and `icon-512.png`,
  `draw(512, 'blue4', 'full')` for `maskable-512.png`, and
  `draw(180, 'blue4', 'full', 1.12)` for `apple-touch-icon.png`. The Mac
  app's `src-tauri/icons/icon@2x.png` is `draw(896, 'blue4', 'any')` drawn at
  `(64, 64)` on a clear 1024 px canvas, which leaves the margin Mac icons
  have. Its name matters: the bundler makes the `.icns` from it and takes a
  1024 px image only as `@2x`.
- The editor maps language `(x, y)` to world `(origin.x + x, -, origin.z - y)`,
  1000 language units per world unit, where the origin is the first point of
  the crayon outline.
- The editor's program is the landed bits inside the outline, sorted by height
  so that file order is stacking order.
- The editor's covering, start-bit and link rules in `refresh()` mirror the
  runtime's. Keep them in step. Nothing else in JS decides the walk: debug
  mode learns where it goes next by running the wasm one step ahead of what it
  shows, and `turn()` in `web/debug.js` only names the turn for words and
  arrows.
- Wind: flying bits ease toward the real wind (1 world unit/s per m/s); landed
  bits only creep in gusts (`0.03 * gust * wind * slip`) and never take off.
  `world.update` gets exactly `{ x: 0, z: 0 }` when wind is off, so the flag
  hangs limp. `SPEC.md` section 7 describes this; keep it in step.
- A language change means: `SPEC.md`, then `src/lib.rs` with a test, then
  `README.md`, `web/docs.html` and this file if the tour or the recipes change.
- An editor or CLI change that a person would notice (a control, a key, a
  command, a message) goes into `web/docs.html` and `README.md` too.
- Tutorials 1 to 12 in `web/docs.html` teach the same programs as the lessons.
  Change a lesson, change its tutorial, and the other way round.

## Writing konfetti programs

A `.kft` file is one bit per line, `color x y`, integers, `#` comments, bottom
of the pile first. Bit numbers in traces count bits from 0 in file order.

### Semantics you must hold in your head

- Bits link when their centres are at most 1500 apart.
- A bit closer than 500 to any later-listed bit is covered: it is ignored
  entirely. When writing a program by hand, keep every pair at least 500
  apart so nothing is covered by accident.
- Start: the bit nearest `(0, 0)`. First heading: from `(0, 0)` to that bit.
- Each step: execute the current bit, then move to a linked bit other than the
  one just left, taking the smallest absolute turn. No such bit: halt.
- Pink pops a value: zero goes straightest, positive goes to the candidate
  with the largest left (counter-clockwise) turn, negative to the largest
  right turn. With one candidate, all three are that candidate.
- Red pushes 1, unless the bit just executed was also red, in which case it
  adds 1 to the top. So *n* reds in a row push *n*.
- Stack effects (top on the right): orange `a -- a a`, yellow `a b -- b a`,
  green `a b -- a+b`, cyan `a b -- a-b`, blue `a b -- a*b`, purple
  `a b -- a/b a%b` (floored, no-op when `b` is 0), white pops and writes a
  byte, black pushes an input byte or -1, brown pops, silver moves main to
  stash, gold moves stash to main.
- Missing operands make an instruction a no-op.
- Every bit the walk lands on executes, including the first and the last.

### Recipe

1. Write the program as a flat list of ops with the stack after each one.
2. Lay it on a grid with pitch 1200. At that pitch only the four straight
   neighbours link, which keeps accidental links out. Never put two bits
   diagonal at pitch 1000 unless you want them linked (1414 < 1500).
3. Put the first bit nearest the origin, with the origin behind it: the first
   heading must point along the trail.
4. Loops run counter-clockwise if the branch that continues them is positive
   (left), clockwise if negative.
5. Put each pink at a fork: the loop continues by a turn, the exit is the
   straighter way, or the other way round with the signs to match.
6. End each path in a dead end. Brown is a good last bit.
7. Run `konfetti --trace` and read the trace against your list from step 1.

### Pitfalls

- **Two numbers in a row.** `red red red` then `red red` is 5, not 3 and 2.
  Separate runs with a non-red op.
- **Parallel rows link.** Two rows 1200 apart link vertically. That is fine
  while the walk has a straight option, since straight beats a 90° turn, but
  check every corner: at a corner the cross-link may be the only candidate
  you did not intend.
- **T-junctions tie.** Where a side trail meets a loop at a right angle, the
  walk has two 90° turns to choose between when it arrives from one side:
  round the loop if the join is at a corner, from the side trail if it is on
  a straight side. The tie goes to the nearer bit, then to the one listed
  first. Do not rely on it. Join from
  behind: place the joining bit so that, arriving along the loop, the turn to
  it is more than 90°. `examples/count.kft` shows the layout, with the joining
  bit at offset `(-1450, 300)` from the ring bit it feeds.
- **Exits near on-ramps.** An exit bit within 1500 of an on-ramp bit links to
  it and the program never halts. Check distances between every pair of bits
  that should not link.
- **No no-op color.** Use orange then brown to pad a trail.
- **The origin matters.** Translating a program changes which bit is nearest
  `(0, 0)` and the first heading. Re-check the start after moving anything.

### Idioms

| Want | Bits |
|------|------|
| 0 | red orange cyan (not right after a red) |
| -n | 0, then n reds, then cyan (after a non-red) |
| a == b ? | cyan, pink: zero means equal |
| a > b ? | cyan, pink: positive means greater |
| Read until end of input | black orange red green pink: zero means end (`cat.kft`) |
| Keep a value for later | silver now, gold later |

## Lessons

`lessons/index.json` is a JSON array, in lesson order, ASCII only. Each lesson:
`id` (lowercase letters, digits, hyphens; unique), `title`, `idea` (one to
three sentences), `steps` (short paragraphs), `goal`, `tray` (color name to
count: the spare strips laid outside the outline; `{}` for none), `checks`
(`[{ "in", "out" }]`, ASCII, compared byte for byte; the first `in` also fills
the Input box), `hints` (two or three, each more direct), and `run_only: true`
for a lesson whose starter already passes. The programs are
`lessons/<id>.start.kft` and `lessons/<id>.solution.kft`; the outline is drawn
round both, so everything the student builds fits inside.

`make test` runs `lessons_can_be_solved_and_are_not_solved_already` in
`src/lib.rs`, which reads these files at test time. For every lesson: the
solution passes every check within 1,000,000 steps, folded and unfolded alike;
the starter passes only if `run_only`; the solution needs no more of any color
than the starter and the tray hold; and every strip the solution adds still
passes when dropped 250 off in any of eight directions. The test reads a small
JSON subset: objects, arrays, strings with only the escapes `\"`, `\\` and
`\n`, whole numbers, `true` and `false`.

## How the world is drawn

The world is a watercolor pop-up book: flat painted cut-outs (trees, bushes,
rocks, hills, clouds, the windmill, the balloon) standing in layers on one
painted ground sheet, each with a rim of bare paper, and grass as painted
tufts that bend in the wind. `paint()` lights every material flat; the
renderer has no tone mapping and no post-processing pass. Grain and pooled
edges are painted onto things in world space, so they move with them. The
only thing fixed to the screen is the paper tooth: `<div id="tooth">`, which
`main.js` inserts right after the canvas, `position: fixed`,
`mix-blend-mode: multiply`, no z-index, darkening by at most `TOOTH` (3%).
Every overlay has a z-index of 1 or more and so sits above it; give a new
overlay one too.

The program must stay clear over all of that. This is how it is drawn, in
`main.js`:

- **Strips** are stickers on the painting, not part of it: one flat, solid
  palette color each, no texture, and round every one of the thirteen the
  same border, an ink (`#1c1f36`) line with a white hairline inside it
  (`EDGE`, `HAIR`: 0.036 and 0.016 strip lengths, never under 1.6 and 1.2 px
  on screen, together never more than half of the strip). A light strip
  shows the ink and a dark one the white, so any strip lying on any other,
  black on black and white on white too, is seen to be a second strip and
  the upper one. The shader draws the border (`sticker`) from the strip's
  `uv`, which holds where on the face a point is. No strip may get a mark of
  its own: what tells two colors apart is the color. A strip under about
  8 px across fades to its fill alone: at a pixel or two the border would
  muddy its color. A landed strip has a soft dark halo under it; all halos
  are one `InstancedMesh`, refilled every frame by `drawHalos()`.
- **Links** are ink (`#1c1f36`) lines on a paper-colored rim (`cased()`, made
  of two `strokes()`), never thinner than 1.6 px on screen.
- **The start ring** is an ink ring on a paper rim, with a drawn hairline
  along it that keeps it in sight from far off or low down (`ringMark()`).
- **Debug marks** are one family, flat yellow (`NOW`, `#ffd21f`) with an ink
  rim: the pointer over the bit that runs now, the ring on the bit that runs
  next, and the arrow between them, drawn over the links. The labels, dock,
  trace and stacks are DOM, styled per theme in `ui.css`.
- **Pencil seams** on the stones (in `world.js`) are pale curved graphite
  strokes, so none can be taken for a link.

**Legibility criteria.** Measured on rendered pixels, not on palette values,
in a 1400 by 860 window at 1x, at the framing the editor gives a loaded
program, in sun, in shade, on the ring of bare paper round the stones, and
with strips half over each other. Contrast is the WCAG ratio; color distance
is CIEDE2000 (ΔE00).

- Every two strip colors' fills are at least ΔE00 20 apart, and at least
  ΔE00 10 apart as a deuteranope and as a protanope see them (simulated with
  the matrices of Machado, Oliveira and Fernandes, severity 1).
- A strip is flat: no point of its face is more than ΔE00 3 from the face's
  mean.
- Every strip stands off the ground: its border is at least 4.5:1 against
  the ground beside it, in sun, in shade and on bare paper.
- A half-covered strip keeps its color within ΔE00 3 of its color in the
  open.
- Where one strip lies on another, the upper one's edge is at least 2.5:1
  against the lower one's fill. This holds for all 169 pairs of colors, the
  thirteen same-color pairs among them, with no way out for fills that differ.
- Where a link crosses a strip, the link (its ink or its paper rim) is at
  least 3.6:1 against the strip's fill; the debugger's arrow (its yellow or
  its ink rim) at least 3.4:1.
- Links and the start ring are at least 4.5:1 against the ground, the crayon
  outline at least 3:1, and the pencil seams at most 2:1.

Strips at the far edge of the stones, seen from the default camera, are a
pixel or two high and are not judged. Any change to the world, the strips,
the links, the rings or the debug marks must be checked against these
criteria before it lands. One way: load the 13 colors 1700 apart with **Load
text** (`red 0 1000`, `orange 1700 1000`, five to a row), project the strips'
faces and edges to the screen with `konfetti.camera`, and sample a
screenshot; for the pairs, load each lower strip with its upper one 440
along and 200 up from it, 24 pairs at a time. The closest calls today are
white against silver (ΔE00 21.8) and red against pink (22.6); yellow against
gold to a deuteranope (10.9); orange lying on orange (3.2:1); and links and
the arrow across red and blue (4.1:1 and 3.7:1), whose fills are about as
far from ink as from paper or yellow. Moving one color moves these: the
palette was found by pushing the smallest of all the distances up, with
every color held to what its name allows, so check all 78 pairs again, not
only the one that moved.

## Checking editor changes

`make serve`, open the page, and confirm at least: the examples load and
**Run fast** gives `A` for hello and echoes the input for cat; after **Fire**,
a crayon outline drawn around landed bits fills the program text; dragging a
bit out of the outline removes its line; with **Wind** on, landed bits creep
in gusts and never lift off; **Debug** (D) opens the dock and **Step** (N)
adds a trace line; **Docs** opens `docs.html`. The page should log no console
errors.

`window.konfetti` is for driving the editor from a script:

- `camera`, `controls`, `bits()`, `area()`, `program()`, `physics(dt, t)`.
  To land a burst without waiting, call `physics(0.03, i * 0.03)` a few hundred
  times.
- `sound`: the `web/sound.js` object. Wrap its methods to see which sounds
  were asked for.
- `wind()`: `null`, or `{ x, z, speed }` in world units/s (= m/s). The object
  is live, so a test can set a known wind on it.
- `theme()`, `setTheme(name)`, `setDebug(on)`.
- `debug()`: `{ on, running, fast, playing, halted, steps, cur, next, main,
  stash, output, trace, labels }`. `cur` and `next` are bit indexes or -1;
  `main` and `stash` are decimal strings, top last; `trace` is newest first,
  lines like `5  pink BRANCH  #4  popped 98, positive, turned left to #5 white`.

- `learn`: learn mode. `open()` and `start(id)` return promises; `list()`
  gives `[{ id, title, done }]`; `check()` gives `{ pass, results }`, or
  `null` with no lesson open; `hint()`, `showSolution()`, `reset()`, `exit()`,
  `toggle()`, `state()`. Wait about 300 ms after `start` or `showSolution`
  before projecting world points to the screen: the camera has just moved.
- `pwa`: the install card. `show(kind)` puts it up at once (`'prompt'` with
  an Install button, `'ios'` with the steps), `hide()` takes it down,
  `state()` says what is going on, including whether a worker controls the
  page.

Controls have these ids: `fire`, `crayon`, `wind`, `run`, `fast`, `stop`,
`debug`, `mute`, `docs`, `learn`, `input`, `output`, `stacks`, `kft`, `load`,
`examples`, `sweep`, `clear`, `hint`, in the debugger `dstep`, `dplay`,
`drestart`, `dspeed`, `dstatus`, `trace`, `dstacks`, and on the lesson card
(`lesson`) `llist`, `lexit`, `ltitle`, `lcheck`, `lhint`, `lwatch`, `lreset`,
`lresult`, `lnext`, and on a phone the quick buttons (`fabs`) `qcrayon`,
`qfire`, `qrun`, `qcheck` and the sheet's handle `sheet` with `peekout`; the
dock's close button is `dclose`. The panel's groups are `details.group` with
`data-group` (`make`, `run`, `program`, `tidy`, `colors`, `how`); in the phone
layout only `run` starts open, so open a group before using a control in it.
Keys: Space, C, W, M, D, L, and N, P, R in debug mode; they are ignored while
a text field has focus. Learn mode
remembers passed lessons in `localStorage` under `konfetti.learn`; the sheet's
stop is `konfetti.sheet`, which groups are folded `konfetti.groups.phone`
and `konfetti.groups.wide`, and the install card's dismissal (until when not
to offer again) `konfetti.install`.
`?theme=paper|toybox|craft|arcade` picks a theme; without it the theme
picked with the switcher wins (stored under `konfetti.theme.picked` on the
click, never on load), then `konfetti.theme` unless it says `toybox`, then
`paper`. Browsers that ran v0.0.4 hold `konfetti.theme`, written on every
load, so its `toybox` is that version's default and not a choice.

`?grass=N` sets the number of grass blades, drawn as `N / 8` tufts; it is
180,000 (22,500 tufts) when absent or 0, and more is capped at that.
Headless Chrome's software renderer is too slow for the meadow; on a Mac,
launch it with `--use-angle=metal --enable-gpu`, or load the page with
`?grass=3000`.

To hide the UI for a screenshot, set `opacity: 0` on it, not
`display: none`: framing the view, debug mode included, measures `#panel`
and throws without it.

Always launch a test browser with `--mute-audio`. The editor plays sound once
a script clicks or presses a key, and headless Chrome plays it out loud on the
machine's speakers.

## The site and the app

GitHub Pages publishes the `main` branch at
<https://aventyret-hackaton.github.io/konfetti/>, and every push to `main`
redeploys it. The root `index.html` only forwards to `web/`, and `.nojekyll`
makes Pages serve the files as they are. Keep every path relative (no leading
`/`), so the site also works under another path or a custom domain.

The service worker only runs over HTTPS or on localhost. Cache versioning:
changing the editor's files needs nothing. Bump `VERSION` in `web/sw.js`
whenever you change what or how `sw.js` caches (the precache list, the
strategy, the keys); the new worker then deletes the old cache. Keep `PAGES`
in `sw.js` in step with the Examples menu in `index.html`. A new module or
file the editor loads needs no entry: the page sends the worker what it
loaded. The vendored three.js files are the exception and are listed in
`PAGES`: the page that installs worker 2 may be a v0.0.5 page that loaded
three.js from the CDN, and offline the new `./` needs them.

## The Mac app

`make app` runs `make`, copies `web/`, `lessons/` and `examples/` into
`src-tauri/dist/` (git-ignored; laid out like the repo root, because the
editor fetches `../lessons/` and `../examples/`), and runs `cargo tauri build`
in `src-tauri/`. Tauri embeds `dist/` in the binary; every `make app`
recompiles the crate, so the app never carries old files. The result is
`src-tauri/target/release/bundle/macos/Konfetti.app`, about 8 MB, ad-hoc
signed (`signingIdentity: "-"`), for the architecture of the Mac that built
it. The Tauri CLI is needed only for this:
`cargo install tauri-cli --version "^2" --locked`. The root crate does not
depend on Tauri; `make`, `make test` and `cargo build` work without the CLI.
`cargo tauri dev` does not work: with no `devUrl` the CLI serves `dist/` over
`http://127.0.0.1`, and `on_navigation` hands that page, like any `http(s)`
one, to the browser, so the window stays blank. Rebuild with `make app`.
`src-tauri/Cargo.lock` is committed. The CLI rewrites the dependency lines in
`src-tauri/Cargo.toml` as `{ version = "2", features = [] }`; keep that form
or every build dirties the tree. The version is in `tauri.conf.json` and
`src-tauri/Cargo.toml`; keep both in step with the root `Cargo.toml`.

The page in the app is `tauri://localhost/web/index.html`, the same files as
the web version. It gets one thing from the app, the command `location`, and
no Tauri API besides. `build.rs` names the command (`AppManifest::commands`),
which takes it away from every window, and the one capability in
`tauri.conf.json` (`wind`) gives `allow-location` back to the window `main`.
Any other call, and `location` from the guide's window, is refused with
`Command ... not allowed by ACL`. tauri-build writes
`src-tauri/permissions/autogenerated/` on every build; it is git-ignored.
What differs in the app:

- **Network.** The CSP in `tauri.conf.json` allows the app's own files and
  `https://api.open-meteo.com`, nothing else. `style-src` is kept out of
  Tauri's nonces (`dangerousDisableAssetCspModification`) because the pages
  use `style` attributes. A new host the editor must reach needs a CSP entry.
  `ipc:` in `connect-src` is how a command is called (a `fetch` to
  `ipc://localhost`); without it Tauri reports a CSP violation, warns on the
  console and falls back to `postMessage`.
- **Wind.** The web view (WKWebView under wry) never answers
  `navigator.geolocation`: no position, no error, no timeout, with or without
  a usage string in `Info.plist`. So in the app `fetchWind` in `main.js` asks
  the app instead: when `window.__TAURI_INTERNALS__` is there (`APP`), it
  calls `APP.invoke('location')` in place of the browser's request, and all
  that follows is shared. `APP` is the only thing in `web/` that knows about
  the app; no Tauri JS package is loaded. `location` in
  `src-tauri/src/main.rs` asks CoreLocation (one `CLLocationManager` with a
  delegate, on the main thread, made at the first press) and answers
  `{ latitude, longitude }`, rounded to one decimal in Rust so the page never
  sees more, or an error. An error makes the page invent a wind, as a
  browser's no does. The command always answers: at once when location is
  denied, restricted or switched off for the whole Mac; after `FIX` (10 s)
  when it is allowed and no position comes; after `ANSWER` (60 s) while the
  Mac's question stands unanswered, so a person has time to read it. macOS
  asks at the first press of Wind, never at launch, shows the sentence from
  `src-tauri/Info.plist` (`NSLocationUsageDescription` and
  `NSLocationWhenInUseUsageDescription`; the bundler merges that file into
  the bundle's), and remembers the answer: **System Settings > Privacy &
  Security > Location Services** changes it. The app is signed with the
  hardened runtime, under which CoreLocation wants the entitlement
  `com.apple.security.personal-information.location`: `Entitlements.plist`,
  named in `bundle.macOS.entitlements`. Check a build with
  `codesign -d --entitlements - Konfetti.app` and
  `plutil -p Konfetti.app/Contents/Info.plist`.
- **Docs.** The link asks for a new tab (`target="_blank"`), which a web view
  ignores. `on_new_window` in `src-tauri/src/main.rs` answers `Deny` and
  builds a second window itself, labelled `docs`, on `web/docs.html`; a
  second press brings that window forward, out of the Dock too (`set_focus`
  alone does nothing to a minimized window). Do not hand the request back to
  WebKit (`NewWindowResponse::Create` with `window_features`): a web view
  WebKit makes from the editor's shares the editor's IPC handler, Tauri takes
  its calls for `main`'s, and the guide could call `location`.
  `on_navigation` keeps both windows on the app's own pages and hands any
  `http(s)` link to `open`, so it opens in the browser. Closing the editor's
  window quits the app, guide included (`on_window_event`): nothing in the
  guide leads back to the editor.
- **Service worker and install card.** `pwa.js` runs unchanged. Registration
  fails silently on `tauri://` (no worker, no console message) and the card
  never has a reason to show.
- **Storage.** `localStorage` works and persists between launches, in
  `~/Library/WebKit/io.github.aventyret-hackaton.konfetti/`.
- **Window.** 1280 by 800 with the title bar, so the page is 1280 by 768.

To check a change in the app, `make app`, then `open -n` the app. Never click
or type in it from a script. To see what the page sees, add test code for the
run and take it out again: a `#[tauri::command]` that appends a string to a
file, registered with `invoke_handler`, named in `build.rs` beside `location`
and allowed in a second capability (`allow-<name>`, windows `["*"]`), and an
`initialization_script` on the
main window that calls it through `window.__TAURI_INTERNALS__.invoke` with
`document.title`, `konfetti.theme()`, the output after loading hello and
pressing `fast`, and what `console.error`, `error`, `unhandledrejection` and
`securitypolicyviolation` reported. Set `localStorage['konfetti.muted'] = '1'` first in that script
so nothing can sound, and `localStorage.clear()` at the end. For a picture,
call `takeSnapshotWithConfiguration:completionHandler:` on the `WKWebView`
from `with_webview`; `screencapture` needs a permission agents do not have.
The snapshot is the whole web view, 32 px taller than the page, with an empty
band at the bottom that the window does not show. With the screen locked the
web view gets no animation frames and the editor stands still: replace
`requestAnimationFrame` with a 16 ms timer in the hook, and keep the page
awake from `with_webview` (`_setWindowOcclusionDetectionEnabled:` off on the
web view). Even so WebKit may suspend the hidden page 5 to 20 s after it
loads, so keep each launch's checks to a few seconds and split a longer probe
into stages, one per launch, with a counter in `localStorage`. The guide
window is a web view of its own: give its builder in `on_new_window` its own
`initialization_script`. A scripted `click()` on `#docs` opens it.

Do not let a probe ask for the location. Every launch that calls `location`
while nobody has answered queues one macOS question, and a queued question
outlives the probe: with the screen locked it is not drawn, and then all of
them are shown to whoever next unlocks the Mac. So in a probe, stub out
`requestWhenInUseAuthorization` (the `ANSWER` timeout can still be tested,
with `ANSWER` lowered) and send the delegate its messages yourself to test
the other paths. A probe that must really ask needs the owner's agreement
first, its own bundle identifier and name, so that the answer the owner gave
Konfetti is not touched, and is never answered or scripted. For reading the
state, `authorizationStatus()` is 0 not determined, 1 restricted, 2 denied,
3 or 4 allowed, and `locationd` logs a request:
`/usr/bin/log show --last 2m --predicate 'process == "locationd" AND eventMessage CONTAINS "AuthPrompt"'`
shows `Showing #AuthPrompt` and `#AuthPrompt posted`.

## Checking the CLI

`make test`, then build an example both ways and run the results:
`konfetti build examples/cat.kft -o cat && echo hi | ./cat` prints `hi`, and
`konfetti build examples/hello.kft --html -o hello.html` gives a page that
prints `A` when opened from disk and run.

## Checking the docs

Everything the tutorials in `web/docs.html` say a program does is marked up so
that a script can rerun it. Every program there is a file under `lessons/` or
`examples/`, named in a `data-kft` attribute:

- `<pre class="kft" data-kft="F">` is the text of `F`, exactly.
- `<svg class="prog" data-kft="F">` draws `F`: one `rect` per strip, with
  `data-bit` (its line number from 0), `data-xy` (its `x y`) and `fill` (its
  palette color).
- `<table class="walk" data-kft="F" data-in="I" data-from="N">` lists steps of
  `konfetti --trace F` with input `I`, from step `N`: in each row, the strip
  number after the swatch and the stacks in the cells `m` (main) and `s`
  (stash) must match the trace. `<pre class="trace">` is trace lines verbatim.
- Any element with `data-kft`, `data-in` and `data-out` claims that the
  program writes exactly `data-out` and stops; `data-starts` claims that it
  writes that and then goes on writing. Bytes that are not printable are
  written `\xff`.

After `make`, from the repo root, this checks all of it (Python 3, no Rust):

```sh
python3 - <<'CHECK'
import codecs, html, re, shlex, subprocess, sys
K, doc = './target/release/konfetti', open((sys.argv + ['web/docs.html'])[1]).read()
HEX = dict(zip('red orange yellow green cyan blue purple pink white black brown silver gold'.split(), '#d2103a #f16603 #ffff00 #28b260 #00f0ff '
               '#195cec #7a0a9e #ff659a #ffffff #1c1c1c #6e3104 #9ca8ac #ffb300'.split()))
data = lambda s: codecs.decode(html.unescape(s), 'unicode_escape').encode('latin1')  # \xff in an attribute is byte 255
text = lambda s: html.unescape(re.sub('<[^>]+>', '', s))
nums = lambda s: [int(v) for v in re.findall(r'-?\d+', text(s).replace('−', '-'))]

def output(f, inp, cap):
    """At most cap bytes of output; None after an error, or if the program neither stops nor writes that much in 5 s."""
    try:
        r = subprocess.run(f'{K} {shlex.quote(f)} | head -c {cap}', shell=True, input=inp, capture_output=True, timeout=5)
        return None if r.stderr else r.stdout
    except subprocess.TimeoutExpired:
        return None

def trace(f, inp, n):
    """The first n lines of --trace; empty lines past the end."""
    p = subprocess.Popen([K, '--trace', f], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    p.stdin.write(inp); p.stdin.close()
    lines = [p.stderr.readline().decode().rstrip('\n') for _ in range(n)]
    p.kill(); p.wait()
    return lines

bad = []
for m in re.finditer(r'<(pre|svg|table|code|span)( [^>]*data-kft="[^"]*"[^>]*)>(.*?)</\1>', doc, re.S):
    a, body = dict(re.findall(r'data-([\w-]+)="([^"]*)"', m[2])), m[3]
    f, inp, cls = a['kft'], data(a.get('in', '')), (re.findall(r'class="([^"]*)"', m[2]) or [''])[0]
    where = f'{f} with input {a.get("in", "")!r}'
    if cls == 'kft' and text(body) != open(f).read().rstrip():
        bad.append(f'{f}: the program text differs from the file')
    if cls == 'prog':
        drawn = sorted((int(i), c, xy) for xy, c, i in re.findall(r'data-xy="([^"]*)"[^>]*fill="([^"]*)"[^>]*data-bit="(\d+)"', body))
        lines = [l.split('#')[0].split() for l in open(f) if l.split('#')[0].strip()]
        if drawn != [(i, HEX[c], f'{x} {y}') for i, (c, x, y) in enumerate(lines)]:
            bad.append(f'{f}: the diagram does not match the file')
    if cls in ('walk', 'trace'):
        rows = re.findall(r'<tr><td class="n">.*?</tr>', body, re.S) if cls == 'walk' else text(body).split('\n')
        start = int(a.get('from', 1))
        for row, line in zip(rows, trace(f, inp, start + len(rows) - 1)[start - 1:]):
            t = re.match(r'bit (\d+) .*main \[(.*)\]  stash \[(.*)\]$', line)
            stash = re.search(r'class="s">(.*?)</td>', row)
            ok = row == line if cls == 'trace' else t and re.search(r'</span>#(\d+)', row)[1] == t[1] and \
                nums(re.search(r'class="m">(.*?)</td>', row)[1]) == nums(t[2]) and (not stash or nums(stash[1]) == nums(t[3]))
            if not ok:
                bad.append(f'{where}: the steps differ from the trace at {line!r}')
                break
    if 'out' in a and output(f, inp, len(data(a['out'])) + 1) != data(a['out']):
        bad.append(f'{where}: does not write {a["out"]!r} and stop')
    if 'starts' in a:  # a program that never stops: it must write this, then a lot more
        want = data(a['starts'])
        got = output(f, inp, len(want) + 4096)
        if not (got and len(got) == len(want) + 4096 and got.startswith(want)):
            bad.append(f'{where}: does not keep writing after {a["starts"]!r}')
print('\n'.join(bad) or 'web/docs.html agrees with the runtime')
sys.exit(bool(bad))
CHECK
```

It prints `web/docs.html agrees with the runtime`, or one line per claim that
is wrong. When a tutorial changes, make what it shows from the files and the
trace rather than typing numbers in, and keep the markup above on it. The
diagrams use 0.05 px per language unit, strips 720 by 300 units, `y` up. Then
look at the page at 1200 and 420 px wide, light and dark.
