# konfetti

A programming language written in confetti. A program is a scatter of colored
paper strips on the ground, inside an outline drawn with a crayon; running it
means following the trail bit by bit. Color says what to do, position says
where to go next.

- **Turing complete**: two unbounded stacks and a three-way branch.
- **Fast**: about 800 million steps a second natively, and 400 million steps
  in 0.7 s as WebAssembly in Chrome (Apple Silicon laptop, `examples/count.kft`).
- **3D editor**: a meadow painted like a watercolor pop-up book, a confetti
  cannon and a crayon. Fire, draw an outline, arrange what landed inside it,
  run it, step through it. Then turn on the wind.
- **Shareable**: `konfetti build` turns a program into a standalone executable
  or a single web page.

**Try it** in the browser, with nothing to install:
<https://konfetti.ax/>. GitHub Pages publishes the
`main` branch there; the root `index.html` only forwards to `web/`, and
`.nojekyll` makes Pages serve the files as they are.

**New here?** [web/docs.html](web/docs.html) is the friendly guide: your first
program in five minutes, every color and control, pictures of how the walk
works. Open it in a browser, or press **Docs** in the editor.
[SPEC.md](SPEC.md) is the full definition. This page is the tour.

**Learning?** In the editor, press **Learn konfetti** (or L) for twelve short
lessons: each lays out a program on the ground and checks your work.
The second half of [web/docs.html](web/docs.html#learn) teaches the same
twelve as tutorials you can follow in the terminal, then four more that design
programs from nothing, one on finding mistakes, and a cheat sheet.

## Download

Nothing needs downloading: konfetti runs in the browser at
<https://konfetti.ax/>, and installs from there as an app that works offline.

The same editor as a desktop app, in a window of its own, is on the
[releases page](https://github.com/Aventyret-Hackaton/konfetti/releases).
Under the newest release, pick the file for your system:

| System | File | The first time |
|--------|------|----------------|
| macOS 11 or later, Apple silicon or Intel | `Konfetti_…_universal.dmg` | Open it and drag Konfetti to Applications. The app is not signed by an Apple developer, so macOS stops it once: try to open it, then go to **System Settings > Privacy & Security** and press **Open Anyway** (before macOS 15: right-click the app and choose **Open**). |
| Windows 10 or 11, 64-bit | `Konfetti_…_x64-setup.exe` | The installer is not signed, so SmartScreen says *Windows protected your PC*: press **More info**, then **Run anyway**. It installs for you alone, without an administrator, and fetches Microsoft's WebView2 if Windows lacks it. |
| Linux, x86_64 | `Konfetti_…_amd64.AppImage`, or the `.deb` (Debian, Ubuntu) or `.rpm` (Fedora) | The AppImage runs as it is once it may: `chmod +x Konfetti_*.AppImage`, then `./Konfetti_*.AppImage`. If it asks for FUSE, add `--appimage-extract-and-run`. If the window opens but the meadow stays blank, start the app with `WEBKIT_DISABLE_DMABUF_RENDERER=1` in front. |

On Linux and Windows the app cannot tell where you are, so **Wind** there is
always a made-up wind; on a Mac it is the real one, if you allow it. GitHub
builds all three (`.github/workflows/release.yml`) and starts each once
before a release is published, but nobody has used the Linux and Windows apps
yet, so tell us what you see. [CHANGELOG.md](CHANGELOG.md) says what changed
in each version, and [The desktop app](#the-desktop-app) below says more.

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

## Share a program

```sh
./target/release/konfetti build examples/cat.kft -o cat              # an executable
echo hi | ./cat
./target/release/konfetti build examples/cat.kft --html -o cat.html  # a web page
```

- **An executable** is the konfetti binary with your program inside, about
  half a megabyte. It runs on the platform konfetti was built for, without
  konfetti installed, and ignores its arguments. On a Mac, a copy downloaded
  from the internet is blocked like any unsigned app, and it cannot be signed
  or notarised: `codesign` rejects a binary with data after its end. Removing
  the quarantine flag, `xattr -d com.apple.quarantine ./cat`, is the only way
  to run it.
- **A web page** is one HTML file of about 70 KB with the WebAssembly runtime
  inside. It opens straight from disk, with no server and no network, and has
  an input box, Run and Stop buttons and the output.
- A program that does not load fails the build, not later on someone else's
  machine.
- A `.kft` file may start with `#!/usr/bin/env konfetti`; with `chmod +x` and
  konfetti on `PATH`, `./prog.kft` runs it.

## The language in two minutes

A bit has a color and a position. Positions are integers; 1000 is one bit
length. `(0, 0)` is the mark where the crayon first touched the ground.

**Walking.** Bits at most 1500 apart are linked. The walk starts on the bit
nearest the mark, heading away from it. After each bit it moves to a linked
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

**Piles.** A bit lying on another (centres closer than 500) covers it, and a
covered bit is out of the program. To replace a bit, drop another on top.

**On disk.** A `.kft` file has one bit per line, `color x y`, bottom of the
pile first, with `#` comments:

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
| [examples/dad.kft](examples/dad.kft) | A long trail folded into rows. Prints `dad` |
| [examples/countdown.kft](examples/countdown.kft) | A counted loop with a constant in the stash. `5` prints `54321` |
| [examples/compare.kft](examples/compare.kft) | A three-way branch. `ab` prints `<` |
| [examples/reverse.kft](examples/reverse.kft) | Two rings in a row. `stressed` prints `desserts` |
| [examples/aventyret.kft](examples/aventyret.kft) | A long trail of arithmetic, with no input. Prints `Hello, Äventyret` |
| [examples/8ball.kft](examples/8ball.kft) | A ring, then a three-way branch into three long arms. Answers a question with `Yes`, `No` or `Maybe` |

`examples/mistakes` holds the broken programs of the guide's last tutorial,
with their fixes. `examples/exercises` holds the programs that answer
exercises in the guide's tutorials.

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
  right angle, the walk, arriving from one of the two sides, has two 90° turns
  to choose between, and the tie goes to the nearer bit, then by file order.
  Join from behind instead, so the loop's next bit is the smaller turn for
  both arrivals. `count.kft` does this.

## The editor

`make serve`, then open <http://localhost:8137/web/>. The bubble at the top
left always says what to do next.

The world is a watercolor pop-up book: flat painted cut-outs of trees,
bushes, rocks, hills, clouds, a windmill and a balloon stand in layers on a
painted ground, each with a rim of bare paper, and the grass is painted tufts
that bend in the wind. The stones the cannon stands on are one pale wash with
a few curved pencil seams. The confetti does not belong to the painting: it
lies on it like stickers. Every strip is one flat, bright color inside the
same border, a dark line with a white hairline inside it, and the thirteen
colors are set as far from each other as their names allow.

- **Learn konfetti** (or L) opens twelve lessons. Each lays out a program
  with the spare strips it needs; **Check my program** runs it on the lesson's
  inputs and says what is wrong, **Hint** helps, **Watch it run** opens the
  debugger. Passed lessons are remembered in the browser.
- **Fire** (or Space) shoots a burst of random bits from the cannon. They
  flutter down and lie where they land.
- **Crayon** (or C), then drag on the stones to draw an outline. It closes
  itself when you let go. The confetti inside is the program; the dot where the
  crayon touched down is the origin. Drawing again replaces the outline.
- **Drag** bits in, out and into place with the glove that stands in for the
  mouse pointer. Dark lines with a pale edge show the links; a dark ring
  marks the start. A bit dropped on another covers it. **Double-click** a bit
  to flick it into the air.
- **Run** walks the trail at five bits a second with a pointer over the current
  bit, showing output and stacks. **Run fast** runs flat out.
- **Debug** (or D) opens a debugger: **Step** (N), **Play** (P), **Restart**
  (R) and a speed slider, a trace of the last steps in plain words, and both
  stacks as boxes. Every bit gets a floating label with its number and
  instruction, and the bit that runs next is marked, with an arrow for the turn.
- **As text (.kft)**, under **Program**, shows the program as text. Paste
  text and press **Load text** to lay it out with an outline around it, or
  pick one of the nine examples. **Save** writes the text to a file,
  `program.kft`, and **Open…** lays such a file out again.
- **Sweep outside** removes the litter outside the outline.
- **Wind** (or W) asks for your location (your browser asks you; in the
  desktop app on a Mac, macOS does), rounds it to about 10 km, and fetches the current wind
  from [Open-Meteo](https://open-meteo.com).
  Flying bits drift with it. Landed bits only creep in gusts, about two or
  three bit lengths a minute in a 6 m/s wind, and never take off again, so a
  program keeps its shape for a while but slowly walks out of its outline.
  The flag on the stones hangs limp with the wind off and streams downwind as
  the wind picks up. Without a location, because you said no or none could
  be found, the editor invents a wind and says so.
- **Sound** is all synthesized: the cannon, landings, the crayon, a note per
  step. **Mute** (or M) silences it and is remembered.
- **Themes** for the panel, the hint, the lesson card and the debugger: paper
  (the default: torn watercolor paper and hand-lettered headings), toybox,
  craft and arcade, from the switcher at the bottom of the panel or
  `?theme=craft` in the address. The world looks the same in all four.
- Drag the ground to orbit, scroll to zoom, right-drag to pan.
- On a phone the panel is a sheet at the bottom that opens half way or all
  the way, with the end of the output on its edge, and **Crayon**, **Fire**,
  **Run** (and **Check** in a lesson) float above it. One finger turns the
  view, two pinch and slide; touch a bit in the debugger to have it
  explained, and tap it twice to flick it.

On a slow machine, add `?grass=20000` to the address for a thinner meadow.
The editor needs no network: three.js 0.170.0 is in the repo, under
`web/vendor/three/`. Only **Wind** goes out, to Open-Meteo.

The editor is installable as an app (a PWA): `web/manifest.webmanifest` and
`web/icons/` describe it, `web/sw.js` makes it start offline after one visit,
and `web/pwa.js` (styled by `web/pwa.css`) registers the worker and, a few
seconds after the editor opens, offers to install it where the browser can:
Chrome and Edge, or Safari on iPhone and iPad. After **Not now** it waits a
month before offering again. It only works over HTTPS or on localhost; online,
the worker always fetches the latest files first, so a change reaches people
on their next load.

### The desktop app

The editor is also a desktop app for macOS, Linux and Windows, made with
[Tauri](https://tauri.app): the same files as the web version, in a window of
its own, with nothing to serve and no network needed. [Download](#download)
says where to get it. `make app` builds it for the machine you are on; on a
Mac that is `Konfetti.app`. It needs the Tauri CLI once, on top of Rust and
the system's build tools (Xcode's command line tools on a Mac):

```sh
cargo install tauri-cli --version "^2" --locked
make app
open src-tauri/target/release/bundle/macos/Konfetti.app
```

The installers on the releases page are built by GitHub Actions when a
version tag is pushed.

- **Docs** opens the guide in a second window, or brings it back; a link out
  of the guide opens in your browser. Closing the editor's window quits the
  app, guide included.
- The theme you pick, **Mute** and the lessons you have passed are remembered
  between launches.
- **Save** asks where to keep the program, with `program.kft` filled in as
  its name, and **Open…** shows the system's own file chooser.
- **Wind** on Linux and Windows is always an invented wind, marked *(made up:
  no location)*: the app has no way to ask where it is there. On a Mac it
  uses the Mac's location. The first time you press it, macOS asks
  whether Konfetti may use your location, and says what for. Say yes and you
  get the real wind where you are. Choose **Don't Allow** and the wind is an
  invented one, marked *(made up: no location)*, as in a browser that says
  no. macOS remembers the answer; to change it, open **System Settings >
  Privacy & Security > Location Services** and find Konfetti in the list. The
  app rounds your position to about 10 km before the page gets it, and only
  that goes to Open-Meteo. If the question stays unanswered for a minute, the
  wind is invented that time: answer the question, then press Wind off and on.
- The Mac app is not signed by an Apple developer. On the Mac that built it,
  it just opens. A copy that reached another Mac through a browser, a chat or
  AirDrop is stopped the first time: open it once, then go to **System
  Settings > Privacy & Security** and press **Open Anyway** (before macOS 15:
  right-click the app and choose **Open**). Or, in a terminal:
  `xattr -dr com.apple.quarantine Konfetti.app`. One built with `make app`
  runs on the kind of Mac that built it (Apple silicon or Intel); the one on
  the releases page runs on both.

## Layout of this repo

| Path | What |
|------|------|
| `SPEC.md` | The language definition |
| `src/lib.rs` | The whole runtime: parse, link, compile, run, tests, wasm exports |
| `src/main.rs` | The CLI: run, trace, and `build` for executables and web pages |
| `web/` | The editor: `index.html`, `main.js` (editing and running), `world.js` (the painted scenery, cannon, flag), `debug.js` (the debugger's words and views), `learn.js` (learn mode), `sound.js`, `hand.js` (the glove), `ui.css` (panel and themes), the built `konfetti.wasm`, `vendor/three/` (three.js 0.170.0, as published), `docs.html`, the guide and tutorials, and the installable app: `manifest.webmanifest`, `icons/`, `sw.js`, `pwa.js`, `pwa.css` |
| `src-tauri/` | The desktop app: a small Tauri crate of its own that shows `web/` in a window; `make app` builds it |
| `.github/workflows/release.yml` | Builds the desktop app for macOS, Linux and Windows, and publishes a release when a version tag is pushed |
| `index.html`, `.nojekyll` | For GitHub Pages: the site's root forwards to `web/` |
| `lessons/` | The lessons of learn mode: `index.json` and a starter and a solution program for each; `make test` checks that each can be solved |
| `examples/` | Programs, including the tutorials' |
| `AGENTS.md` | Notes for AI agents working here or writing konfetti |

## Not there yet

A colorblind-safe palette.
