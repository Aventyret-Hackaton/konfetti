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
- `web/index.html`: the page and the import map for three.js 0.170.0.
- `web/main.js`: the editor: bits, crayon outline, wind physics, running,
  debug mode, keys, themes, `window.konfetti`.
- `web/world.js`: the scenery, the cannon and the wind flag, all procedural.
  `buildWorld(scene, renderer, grassCount)` returns `{ muzzle, update(dt, t, wind) }`.
- `web/debug.js`: the debugger's words (`EXPLAIN`, `describe`) and views
  (stacks as boxes, the trace, the floating labels). No three.js.
- `web/sound.js`: every sound, synthesized with Web Audio. Exports `sound`.
- `web/hand.js`: the cartoon glove that replaces the mouse pointer.
- `web/ui.css`: the panel, hint, debugger dock and labels, and the three
  themes (`toybox`, `craft`, `arcade`).
- `web/docs.html`: the guide for people, linked from the editor's panel. Static
  HTML with inline CSS and SVG, no script, no requests.
- `examples/*.kft`: `hello` and `cat` are also test fixtures.

## Rules of the codebase

- All geometry is exact integer math. No floating point in `src/lib.rs`, ever:
  native and wasm must agree on every program.
- The palette order is the opcode order. It appears in `COLORS` in
  `src/lib.rs`, in `PALETTE` in `web/main.js`, in `EXPLAIN` in `web/debug.js`,
  in the palette strip of `APP` in `src/main.rs`, in the tables in `SPEC.md`,
  `README.md` and `web/docs.html`, and in `docs.html`'s band. Change them all
  together.
- The web side has no build step, no dependencies besides three.js from the
  CDN import map, and no asset files: textures are drawn and sounds are
  synthesized in code.
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
  loop's next bit and the side trail are both 90° turns; the tie goes to the
  nearer bit, then to the one listed first. Do not rely on it. Join from
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
| 0 | red orange cyan |
| -n | 0, then n reds, then cyan (after a non-red) |
| a == b ? | cyan, pink: zero means equal |
| a > b ? | cyan, pink: positive means greater |
| Read until end of input | black orange red green pink: zero means end (`cat.kft`) |
| Keep a value for later | silver now, gold later |

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

Controls have these ids: `fire`, `crayon`, `wind`, `run`, `fast`, `stop`,
`debug`, `mute`, `docs`, `input`, `output`, `stacks`, `kft`, `load`,
`examples`, `sweep`, `clear`, `hint`, and in the debugger `dstep`, `dplay`,
`drestart`, `dspeed`, `dstatus`, `trace`, `dstacks`. Keys: Space, C, W, M, D,
and N, P, R in debug mode; they are ignored while a text field has focus.
`?theme=toybox|craft|arcade` picks a theme.

Headless Chrome's software renderer is too slow for the meadow; on a Mac,
launch it with `--use-angle=metal --enable-gpu`, or load the page with
`?grass=3000`.

Always launch a test browser with `--mute-audio`. The editor plays sound once
a script clicks or presses a key, and headless Chrome plays it out loud on the
machine's speakers.

## Checking the CLI and the docs

`make test`, then build an example both ways and run the results:
`konfetti build examples/cat.kft -o cat && echo hi | ./cat` prints `hi`, and
`konfetti build examples/hello.kft --html -o hello.html` gives a page that
prints `A` when opened from disk and run. After changing `web/docs.html`, look
at it at phone width in both light and dark mode.
