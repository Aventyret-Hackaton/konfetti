# Konfetti – Power Mode for Claude

A Chrome extension inspired by [Power Mode](https://github.com/hoovercj/vscode-power-mode).
Every character you type into a prompt on [claude.ai](https://claude.ai) is turned into
confetti: a copy of the character is thrown into the air together with a burst of paper,
tumbles down, and lands at the bottom of the screen. It never disappears: the heap of
confetti keeps growing for as long as you type. Reload the tab to sweep the floor.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open (or reload) a claude.ai tab and start typing.

## What triggers confetti

| Action | Effect |
| --- | --- |
| Typing a character | The character plus a burst of confetti launch from where it was typed. The first character gets 10 pieces and every further character gets one more (up to 60), until you pause for 10 seconds |
| IME / dead-key composition | The committed text explodes when composition ends |
| Paste | One big burst from the caret, with some of the pasted characters mixed in |
| Any keystroke that edits the prompt (typing, deleting, pasting) | The prompt box gives a discreet 1.5px shake, plus a short vibration on devices that have a vibration motor |

It works in the main prompt box and in textareas such as the "edit message" box.
Single-line `<input>` fields (search, rename, login) are ignored on purpose.

## About haptics

Web pages and extensions can only reach a vibration motor through `navigator.vibrate`,
which works on phones and tablets. Desktop and laptop hardware (including trackpads)
is not reachable, so there the call does nothing. As a stand-in you can set
`KEY_SOUND = true` in `content.js` for a very quiet tick on every keystroke.

## Tuning

The constants at the top of `content.js` control the effect: `COLORS`,
<<<<<<< Updated upstream
`PIECES_PER_CHAR`, `GRAVITY`, `PILE_GROWTH` (how fast the heap rises) and so on.
=======
`SHAKE_PX`, `SHAKE_MS`, `VIBRATE_MS`, `KEY_SOUND`, `PIECES_PER_CHAR`, `PIECES_GROWTH`, `MAX_PIECES_PER_CHAR`, `STREAK_TIMEOUT`, `GRAVITY`, `PILE_GROWTH` (how fast the heap rises) and so on.
>>>>>>> Stashed changes
After editing, press the reload button for the extension on `chrome://extensions`
and reload the claude.ai tab.

## Privacy

The extension requests no permissions, makes no network requests and stores nothing.
It only runs on `https://claude.ai/*`, and the only thing it adds to the page is a
click-through canvas on top of it. The shake is a temporary animation and changes
nothing in the page.
