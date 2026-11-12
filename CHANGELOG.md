# Changelog

What changed in each version of konfetti, newest first. The editor runs at
<https://konfetti.ax/>; the desktop apps are on the
[releases page](https://github.com/Aventyret-Hackaton/konfetti/releases).

## v0.0.11

2026-11-12

- **A calculator, written in konfetti.** `calc` in the **Examples** menu
  works in reverse Polish notation: numbers first, then what to do with them.
  Put `3 4 + 2 *` in **Input** and it writes `14`. It knows `+ - * /`,
  negative results and big numbers, and in the terminal it answers one
  expression per line. 117 strips: three three-way branches sort each
  character, and three small loops print the number.
- **Build**, next to Save and Open, makes your program into one web page,
  `program.html`, that anyone can open and run with nothing installed. It is
  exactly the page `konfetti build --html` makes in the terminal.
- In the desktop app on Linux, the world is now drawn on machines without a
  graphics card too.

## v0.0.10

2026-11-12

- **Desktop apps for macOS, Linux and Windows**, built by GitHub Actions and
  attached to each release from now on: a `.dmg` for Macs (Apple silicon and
  Intel in one), an AppImage, `.deb` and `.rpm` for Linux, and a setup `.exe`
  for Windows.
- The apps are not signed with a paid identity. On a Mac, open the app once
  through **System Settings > Privacy & Security > Open Anyway**; on Windows,
  choose **More info > Run anyway** when SmartScreen asks.
- On Linux and Windows the wind is the made-up one, and **Save** asks where
  with the system's own dialog. Nobody has used these two builds by hand yet:
  they are built and started by the release workflow, no more. Tell us what
  you find.
- This changelog, and release notes for every version so far.

## v0.0.9

2026-11-12

- **Save** writes your program to a file, `program.kft`, and **Open…** lays
  such a file out again. In a browser Save is a download; the Mac app asks
  where to put it. The terminal's `konfetti` runs the same file.
- Two new examples in the **Examples** menu:
  - `aventyret` writes `Hello, Äventyret` with no input, as one long trail of
    arithmetic.
  - `8ball` answers a yes-or-no question with `Yes`, `No` or `Maybe`. konfetti
    has no dice, so the answer comes from the letters of the question: the
    same question always gets the same answer.
- The site moved to <https://konfetti.ax/>.

## v0.0.8

2026-11-12

- In the Mac app, **Wind** now shows the real wind where you are. macOS asks
  for permission the first time you press it, and only a position rounded to
  about 10 km leaves the app. Say no and the wind is made up, as in a browser.
- The buttons in a row are all the same size. In Safari and the Mac app a
  label could stack on top of its picture and make one button taller.
- The paper theme's group headings use the same lettering as the other themes.

## v0.0.7

2026-11-12

- The confetti is flat, bold color. A legibility round measured candidate
  palettes on rendered pixels and moved the thirteen colors apart until the
  closest pair is about twice as far apart as before, and every pair still
  differs under simulated red-green color blindness.
- Every strip has the same border, a dark line with a white hairline inside,
  so any strip stands off any other, black on black included. The bands on
  silver and gold, the watercolor wash and black's own inner line are gone.
- The color names and their order are unchanged, so every program still means
  the same thing. Only the shades moved.

## v0.0.6

2026-11-12

- **The Mac app.** `make app` builds `Konfetti.app`: the same editor in a
  window of its own. The guide opens in a second window.
- The editor no longer needs the internet. three.js ships with it instead of
  coming from a CDN, so the site, the installed web app and the Mac app all
  start offline.

## v0.0.5

2026-11-12

- The world is a watercolor pop-up book: flat painted cut-outs standing on a
  painted ground, grass as tufts that bend in the wind, and the stone circle
  as one pale wash with pencil seams.
- So that the program stays clear on the new ground, links are bold ink lines
  on a paper rim and the debugger's marks are one yellow family.
- A new panel theme, **paper**, is the default. toybox, craft and arcade are
  still there. The editor remembers a theme only when you pick one.

## v0.0.4

2026-11-11

- **Learn konfetti.** Twelve lessons in the editor, each with a starter
  program, spare strips, a check and hints. A test proves every lesson can be
  solved with what the student is given.
- The guide gains seventeen tutorials and a cheat sheet. Every program in it
  is a file, and every stack it shows comes from a real trace.
- A phone layout: a bottom sheet, big quick buttons, and strips that are easy
  to pick up with a fingertip.
- The site can be installed as an app and works offline once opened.

## v0.0.3

2026-11-11

- **Debug mode**: a label on every strip, step and play controls, a trace in
  plain words and both stacks as boxes.
- Sound, synthesized in the browser, with a mute button.
- Three panel themes, a coaching hint and keyboard shortcuts.
- A flag shows the wind's force and direction. The wind itself is gentle
  again: flying strips drift, landed ones only creep in gusts.
- `konfetti build` turns a program into a standalone executable or a single
  web page.
- A cartoon glove picks up the confetti.

## v0.0.2

2026-11-11

- The program is the confetti inside an outline you draw on the ground with a
  crayon. The origin is where the crayon first touched down.
- A strip lying under another is covered and takes no part in the program.
- Confetti is thin paper strips that stack in real piles.
- A new world: grass, trees, flowers, butterflies.

## v0.0.1

2026-11-11

- The language: thirteen colors, two stacks, a three-way branch. A program is
  colored strips on the ground, and running it follows the trail from one
  strip to the next. `SPEC.md` defines it.
- A fast runtime in Rust, natively and as WebAssembly, and a command line
  tool with `--trace`.
- A 3D editor in the browser: fire the cannon, arrange the confetti, run it,
  and let the wind from your local weather push it around.
