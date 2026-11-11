# Notes for AI agents

konfetti is a programming language whose programs are colored confetti bits
at positions on the ground. `SPEC.md` defines it and is the source of truth:
if code and spec disagree, raise it rather than picking one.

## Commands

Cargo may not be on `PATH`. If `cargo` is not found, prefix commands with
`PATH="$HOME/.cargo/bin:$PATH"`.

```sh
make test     # cargo test: the runtime's whole test suite
make          # release CLI at target/release/konfetti, plus web/konfetti.wasm
make serve    # editor at http://localhost:8137/web/
target/release/konfetti prog.kft            # stdin -> program -> stdout
target/release/konfetti --trace prog.kft    # each step and both stacks, on stderr
```

After changing `src/lib.rs`, run `make`: the editor runs `web/konfetti.wasm`,
which is a build output, and goes stale otherwise.

## Map

- `src/lib.rs`: everything in the runtime. `parse` reads `.kft`; `compile`
  links bits and emits one instruction per `(prev, cur)` pair; `Vm::run` is the
  dispatch loop; `mod wasm` is the C ABI the editor calls; tests are at the
  bottom.
- `src/main.rs`: the CLI.
- `web/main.js`: the three.js editor: bits, crayon outline, wind, running.
  `web/world.js`: the scenery and the cannon, all procedural. No build step,
  no dependencies besides three.js from a CDN.
- `examples/*.kft`: `hello` and `cat` are also test fixtures.

## Rules of the codebase

- All geometry is exact integer math. No floating point in `src/lib.rs`, ever:
  native and wasm must agree on every program.
- The palette order is the opcode order. It appears in `COLORS` in
  `src/lib.rs`, in `PALETTE` in `web/main.js`, and in the table in `SPEC.md`.
  Change all three together.
- The editor maps language `(x, y)` to world `(origin.x + x, -, origin.z - y)`,
  1000 language units per world unit, where the origin is the first point of
  the crayon outline.
- The editor's program is the landed bits inside the outline, sorted by height
  so that file order is stacking order.
- The editor's covering, start-bit and link rules in `refresh()` mirror the
  runtime's. Keep them in step.
- A language change means: `SPEC.md`, then `src/lib.rs` with a test, then
  `README.md` and this file if the tour or the recipes change.

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
bit out of the outline removes its line; **Wind** moves landed bits. The page
should log no console errors.

`window.konfetti` exposes `camera`, `controls`, `bits()`, `area()`,
`program()` and `physics(dt, t)` for driving the editor from a script. To land
a burst without waiting, call `physics(0.03, i * 0.03)` a few hundred times.
Headless Chrome's software renderer is too slow for the meadow; on a Mac,
launch it with `--use-angle=metal --enable-gpu`, or load the page with
`?grass=3000`.
