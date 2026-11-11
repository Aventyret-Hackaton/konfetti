# konfetti

A programming language written in confetti. A program is a scatter of colored
bits on the ground; running it means following the trail from the cannon,
bit by bit. Color says what to do, position says where to go next.

- **Turing complete**: two unbounded stacks and a three-way branch.
- **Fast**: about 800 million steps a second natively, and 400 million steps
  in 0.7 s as WebAssembly in Chrome (Apple Silicon laptop, `examples/count.kft`).
- **3D editor**: fire a confetti cannon, pick up what lands, lay it out, run it.

[SPEC.md](SPEC.md) is the full definition. This page is the tour.

## Quick start

You need [Rust](https://rustup.rs) with the wasm target
(`rustup target add wasm32-unknown-unknown`) and Python 3 for the dev server.

```sh
make                                          # CLI + web/konfetti.wasm
./target/release/konfetti examples/hello.kft  # prints A
echo hi | ./target/release/konfetti examples/cat.kft
make test
make serve                                    # then open http://localhost:8137/web/
```

`konfetti --trace program.kft` prints every step and both stacks to stderr.

## The language in two minutes

A bit has a color and a position. Positions are integers; 1000 is one bit
width. The cannon stands at `(0, 0)`.

**Walking.** Bits at most 1500 apart are linked. The walk starts on the bit
nearest the cannon, heading away from it. After each bit it moves to a linked
bit, never straight back to the one it came from, choosing whichever needs the
smallest turn. When there is nowhere to go, the program halts. To loop, bend
the trail back into itself.

**The machine.** Two stacks of 64-bit integers, `main` and `stash`, plus byte
input and output.

| Color  | Op     | What it does |
|--------|--------|--------------|
| red    | PUSH   | A run of *n* reds pushes *n* |
| orange | DUP    | Copy the top |
| yellow | SWAP   | Swap the top two |
| green  | ADD    | `a b` → `a+b` |
| cyan   | SUB    | `a b` → `a-b` |
| blue   | MUL    | `a b` → `a*b` |
| purple | DIVMOD | `a b` → `a/b` `a%b`, floored |
| pink   | BRANCH | Pop. Zero: go straightest. Positive: turn leftmost. Negative: turn rightmost |
| white  | OUT    | Pop, write one byte |
| black  | IN     | Push the next input byte, or -1 at the end |
| brown  | DROP   | Discard the top |
| silver | STASH  | Move the top from main to stash |
| gold   | FETCH  | Move the top from stash to main |

An instruction that lacks operands does nothing. Nothing ever crashes.

**On disk.** A `.kft` file has one bit per line, `color x y`, with `#` comments:

```
# prints "A": 8, squared, plus 1
red     1000 0
red     2000 0
...
```

## Examples

| File | What it shows |
|------|---------------|
| [examples/hello.kft](examples/hello.kft) | A straight line. Prints `A` |
| [examples/cat.kft](examples/cat.kft) | A loop with a branch and an exit. Copies input to output |
| [examples/count.kft](examples/count.kft) | An on-ramp into a ring. Counts down from 100,000,000; the benchmark |

## Layout patterns

- **Spacing.** At a pitch of 1200, a bit links only to its four straight
  neighbours (diagonals are 1697 apart). At 1000, diagonals link too.
- **Numbers.** A run of reds is one number. To push two numbers in a row, put
  any other color between the runs. Zero is `red orange cyan` (1, copy,
  subtract). Build big numbers by multiplying: `hello.kft` makes 65 from 8.
- **Corners.** A bit with one way onward needs nothing special; the walk
  follows the bend.
- **Branches.** Put pink where the trail forks. Zero carries straight on,
  positive takes the leftmost fork, negative the rightmost. To compare two
  numbers, subtract and branch.
- **Ending.** A dead end halts, and the last bit still executes. Brown makes a
  tidy exit.
- **Doing nothing.** There is no no-op color. Orange then brown (copy, discard)
  changes nothing and is safe on an empty stack.
- **Joining a loop.** Do not join at a T: where a side trail meets a loop at a
  right angle, the loop's own next bit and the side trail are both a 90° turn,
  and the tie is settled by file order. Join from behind instead, so the loop's
  next bit is the smaller turn for both arrivals. `count.kft` does this.

## The editor

`make serve`, then open <http://localhost:8137/web/>.

- **Fire** (or space) shoots a burst of random bits. They flutter down and lie
  where they land as loose litter.
- **Click or drag** a landed bit to place it. Placed bits are the program.
  Lines show the links; the white ring marks the start. A bit dropped on top of
  another goes back where it came from.
- **Double-click** a placed bit to flick it out of the program.
- **Run** walks the trail at five bits a second with a pointer over the current
  bit, showing output and stacks. **Run fast** runs flat out.
- **Program (.kft)** shows the program as text. Paste text and press
  **Load text** to lay it out, or pick an example.
- **Wind** asks your browser for your location, rounds it to about 10 km, and
  fetches the current wind from [Open-Meteo](https://open-meteo.com). Flying
  bits drift downwind; gusts push landed bits along the ground, placed ones
  included, so wind rewrites your program. Without a location it invents a wind
  and says so.
- Drag the ground to orbit, scroll to zoom, right-drag to pan.

The editor loads three.js from a CDN, so it needs a network connection.

## Layout of this repo

| Path | What |
|------|------|
| `SPEC.md` | The language definition |
| `src/lib.rs` | The whole runtime: parse, link, compile, run, tests, wasm exports |
| `src/main.rs` | The CLI |
| `web/` | The editor: `index.html`, `main.js`, and the built `konfetti.wasm` |
| `examples/` | Programs |
| `AGENTS.md` | Notes for AI agents working here or writing konfetti |

## Not there yet

A colorblind-safe palette, and a world with more in it than grass and a cannon.
