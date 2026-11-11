# konfetti language spec — v0

A program is a scatter of colored confetti bits lying on the ground, inside an
outline drawn with a crayon. Execution follows the trail of bits like a finger
tracing a path. Only color, position and what lies on top of what matter.

## 1. Program

A program is a list of **bits**. Each bit has:

- `color` — one of 13 palette colors (section 4)
- `x`, `y` — integer ground coordinates of its centre, 1000 units = one bit length

Integer coordinates are deliberate: all geometry is exact integer math, so the
native and web runtimes agree on every program, bit for bit.

A bit is a thin paper strip. Which way it points is rendering only.

The origin `(0, 0)` is the mark where the crayon first touched the ground. The
program is the bits inside the outline; everything outside is litter.

**Covering.** Bits are listed bottom of the pile first: a later bit lies on top
of an earlier one. A bit closer than 500 units to any later bit is **covered**.
A covered bit is not part of the program: it links to nothing and cannot be the
start. Dropping a bit on another replaces it.

## 2. Machine

- Two stacks, **main** and **stash**, of wrapping signed 64-bit integers.
  Both grow without bound.
- Byte input stream, byte output stream.
- Instruction pointer: a pair `(prev, cur)` — the bit it came from and the bit
  it is on. `cur - prev` is the **heading**.

Two unbounded stacks plus branching finite control is a two-stack machine,
which is Turing complete.

## 3. Walking the trail

**Links.** Two uncovered bits are linked when their centres are at most 1500
units apart.

**Start.** `cur` is the bit nearest the origin (first listed wins a tie);
`prev` is the origin itself, so the first heading points away from the mark.
A bit exactly on the origin starts heading +x. An empty program halts at once.

**Step.** Execute `cur`, then pick the next bit from the **candidates**: bits
linked to `cur`, excluding `prev`. For each candidate, the **turn** is the
signed angle from the heading to `candidate - cur`, in (-180°, 180°], positive
= left (counter-clockwise).

- Default: take the candidate with the smallest absolute turn (go straightest).
- After a BRANCH: see section 4.
- No candidates: halt. A dead end is how programs end.

Ties: nearer candidate wins, then the one listed first in the file. Turns are
compared exactly using integer cross and dot products, never floating point.

Loops are literal: bend the trail back into itself.

## 4. Instructions

| Color  | Hex       | Op     | Effect                                                        |
|--------|-----------|--------|---------------------------------------------------------------|
| red    | `#ff4b5c` | PUSH   | If the previously executed bit was red: increment top. Else push 1. So a run of *n* reds pushes *n*. |
| orange | `#ff9233` | DUP    | `a -- a a`                                                    |
| yellow | `#ffe14d` | SWAP   | `a b -- b a`                                                  |
| green  | `#2fd07a` | ADD    | `a b -- a+b`                                                  |
| cyan   | `#29d3e6` | SUB    | `a b -- a-b`                                                  |
| blue   | `#3d7bff` | MUL    | `a b -- a*b`                                                  |
| purple | `#9b5cff` | DIVMOD | `a b -- a/b a%b` (floored; `b = 0` is a no-op)                |
| pink   | `#ff6ec7` | BRANCH | Pop `a`. `a = 0`: go straightest. `a > 0`: take the leftmost candidate (largest turn). `a < 0`: take the rightmost (smallest turn). |
| white  | `#fff8ec` | OUT    | Pop `a`, write its low 8 bits as one byte                     |
| black  | `#2a2c3a` | IN     | Push next input byte, or -1 at end of input                   |
| brown  | `#b06a3c` | DROP   | `a --`                                                        |
| silver | `#dfe6ee` | STASH  | Pop main, push onto stash                                     |
| gold   | `#f2b73a` | FETCH  | Pop stash, push onto main                                     |

An instruction without enough operands is a no-op (BRANCH then goes
straightest). Sloppy confetti should misbehave, not crash.

## 5. Text format — `.kft`

One bit per line: `color x y`, bottom of the pile first. `#` starts a comment.
Blank lines ignored.
This is what the editor shows and loads, what the CLI runs, and what goes in
git.

```
# prints "A" (8*8+1 = 65)
red     1000 0
red     2000 0
red     3000 0
red     4000 0
red     5000 0
red     6000 0
red     7000 0
red     8000 0
orange  9000 0
blue   10000 0
red    11000 0
green  12000 0
white  13000 0
```

## 6. Making it fast

Geometry is resolved once, at load. Every `(prev, cur)` pair has fixed
successors (straight, left, right), so the scatter compiles to a plain control
flow graph: one instruction per pair, red runs folded into constants. The run
loop is a table-driven dispatch that never looks at a coordinate.

One Rust core crate does parse, link, compile and run. It builds to a native
CLI and to WebAssembly for the editor.

## 7. Wind

Wind is not part of the language; it is part of the world the editor puts the
program in. With wind on, the editor reads the local wind from weather data and
blows airborne bits off course. Gusts slowly slide landed bits along the
ground, into and out of the outline; a landed bit never takes off again. A
moved bit has new coordinates, so wind rewrites programs. A run works on a
snapshot taken when it starts.

## 8. Not in v0

- Colorblind-safe alternate palette.
