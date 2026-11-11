// Learn mode: a list of lessons and a card that walks the student through one of them.
// The lessons are files: ../lessons/index.json plus a starter and a solution .kft for each. `cargo test`
// runs every solution against the lesson's checks, so what the card asks for is known to be possible.
// No three.js in here; main.js hands over the few things a lesson needs from the editor.

const KEY = 'konfetti.learn';   // localStorage: a JSON array of the ids of the lessons passed
const STEP_CAP = 1_000_000;     // a check gives up here; the lesson test in src/lib.rs uses the same cap
const SHOW_BYTES = 24;          // a wrong answer shows this much output and counts the rest

function el(tag, props, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

/** Bytes as a row of boxes, one per byte, so a space, a newline or an unprintable byte can be seen. */
function byteRow(bytes, want) {
  if (!bytes.length) return el('p', { className: 'lbytes' }, el('span', { className: 'lbyte word', textContent: 'nothing' }));
  const row = el('p', { className: 'lbytes' });
  bytes.slice(0, SHOW_BYTES).forEach((n, i) => {
    const plain = n > 32 && n < 127;
    const box = el('span', { className: plain ? 'lbyte' : 'lbyte word',
      textContent: plain ? String.fromCharCode(n) : n === 32 ? 'space' : n === 10 ? 'new line' : `number ${n}` });
    // The first place where the output goes wrong, when comparing against what was wanted.
    if (want && n !== want[i] && bytes.slice(0, i).every((b, j) => b === want[j])) {
      box.classList.add('diff');
      box.title = 'The first character that is different';
    }
    row.append(box);
  });
  if (bytes.length > SHOW_BYTES) row.append(el('span', { className: 'lbyte word', textContent: `and ${bytes.length - SHOW_BYTES} more` }));
  return row;
}

/**
 * `ed` is the editor's side of the bargain:
 *   lay(text, fit, tray)  lays `text` out as the program, in an outline with room for `fit` too, with one
 *                         spare strip outside the outline for each color name in `tray`
 *   setInput(text)        fills the Input box
 *   resize()              fits the view to the window again, after the card has changed size
 *   reveal(el, block)     scrolls `el` into sight, first opening the sheet the card is in on a phone
 *   judge(inputs, cap)    runs the program once per input: [{ halted, out }], or null without an outline
 *   watch()               opens the debugger on the program, stopped before its first strip
 *   celebrate()           fires the cannon
 *   sound                 the sound object
 */
export function createLearn(ed) {
  const host = document.getElementById('lesson'), body = document.getElementById('lbody');
  const where = document.getElementById('lwhere'), button = document.getElementById('learn');
  const encoder = new TextEncoder();
  let lessons = null, loading = null;
  let open = false, cur = null, hints = 0, passed = false, shown = false;

  let done = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (Array.isArray(saved)) done = new Set(saved);
  } catch {} // storage blocked or garbled: learn mode works, it just starts with nothing ticked off
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...done])); } catch {} };

  function load() {
    loading ||= (async () => {
      const get = async path => {
        const res = await fetch(`../lessons/${path}`);
        if (!res.ok) throw new Error(`lessons/${path}: ${res.status}`);
        return res;
      };
      const index = await (await get('index.json')).json();
      await Promise.all(index.map(async l => {
        [l.start, l.solution] = await Promise.all(['start', 'solution'].map(async kind => (await get(`${l.id}.${kind}.kft`)).text()));
      }));
      return (lessons = index);
    })().catch(e => { loading = null; throw e; }); // a failed load may be tried again
    return loading;
  }

  function setOpen(on) {
    const inside = host.contains(document.activeElement) && document.activeElement;
    open = on;
    host.hidden = !on;
    document.body.classList.toggle('learning', on);
    button.setAttribute('aria-pressed', String(on));
    ed.resize();
    if (on) ed.reveal(host, 'start');
    // Focus must not be left on something hidden. It goes back to the Learn button only for someone
    // using the keyboard: anywhere else, the next Space would press that button instead of firing.
    if (!on && inside) (keyed(inside) ? button.focus() : inside.blur());
  }

  /** Puts the keyboard and screen readers at the top of what was just shown. */
  const focusTitle = () => document.getElementById('ltitle').focus();
  /** Did the user reach this control with the keyboard? The title is focused by script, never tabbed to. */
  const keyed = e => e.tabIndex >= 0 && e.matches(':focus-visible');

  // ---- the list ----
  const suggested = () => lessons.find(l => !done.has(l.id));

  async function showList() {
    setOpen(true);
    cur = null;
    where.textContent = 'Learn';
    document.getElementById('llist').hidden = true;
    body.replaceChildren(el('h2', { id: 'ltitle', tabIndex: -1, textContent: 'Learn konfetti' }), el('p', { textContent: 'Loading the lessons…' }));
    focusTitle();
    try {
      await load();
    } catch (e) {
      if (open && !cur) body.lastChild.textContent = 'The lessons could not be loaded. They are in the lessons folder, next to the web folder.';
      throw e;
    }
    if (!open || cur) return; // closed, or a lesson was started, while the files were on their way
    const next = suggested();
    body.replaceChildren(
      el('h2', { id: 'ltitle', tabIndex: -1, textContent: 'Learn konfetti' }),
      el('p', { className: 'lidea', textContent: `${lessons.length} short lessons, from running your first program to writing a loop. Do them in order, or pick any.` }),
      el('ol', { id: 'lessons' }, ...lessons.map((l, i) => el('li', {},
        el('button', { className: `lpick${done.has(l.id) ? ' done' : ''}${l === next ? ' next' : ''}`, onclick: () => start(l.id) },
          el('span', { className: 'lnum', textContent: i + 1 }),
          el('span', { className: 'lname', textContent: l.title }),
          el('span', { className: 'lmark', textContent: done.has(l.id) ? '✓ done' : l === next ? (done.size ? 'next' : 'start here') : '' }))))),
      el('p', { className: 'lfoot', textContent: next ? '' : 'You have passed every lesson. Leave learn mode and make something of your own!' }));
    ed.resize();
    focusTitle();
  }

  // ---- one lesson ----
  /** Lays the starter (with its tray of spare strips) or the solution on the ground. */
  function layOut(solution) {
    const tray = solution ? [] : Object.entries(cur.tray).flatMap(([color, n]) => Array(n).fill(color));
    // Room for both, whichever is shown: the outline must hold everything the student will build.
    ed.lay(solution ? cur.solution : cur.start, `${cur.start}\n${cur.solution}`, tray);
    ed.setInput(cur.checks[0].in);
  }

  async function start(id) {
    await load();
    const lesson = lessons.find(l => l.id === id);
    if (!lesson) throw new Error(`there is no lesson "${id}"`);
    setOpen(true);
    cur = lesson;
    hints = 0;
    passed = shown = false;
    const n = lessons.indexOf(cur), last = n === lessons.length - 1;
    where.textContent = `Lesson ${n + 1} of ${lessons.length}`;
    document.getElementById('llist').hidden = false;
    body.replaceChildren(
      el('h2', { id: 'ltitle', tabIndex: -1, textContent: cur.title }),
      el('p', { className: 'lidea', textContent: cur.idea }),
      el('ol', { className: 'lsteps' }, ...cur.steps.map(s => el('li', { textContent: s }))),
      el('p', { id: 'lgoal' }, el('b', { textContent: 'Goal: ' }), cur.goal),
      // The buttons and what they say come into sight together: the result alone, scrolled up to, would
      // leave the buttons half under the sheet's handle on a phone.
      el('div', { className: 'lact' },
        el('div', { className: 'row' },
          el('button', { id: 'lcheck', className: 'go', textContent: 'Check my program', onclick: check }),
          el('button', { id: 'lhint', textContent: 'Hint', onclick: () => (hints < cur.hints.length ? hint() : showSolution()) }),
          el('button', { id: 'lwatch', textContent: 'Watch it run', onclick: ed.watch }),
          el('button', { id: 'lreset', textContent: 'Start over', onclick: reset })),
        el('div', { id: 'lresult', role: 'status' })),
      el('ol', { id: 'lhints', ariaLive: 'polite' }),
      el('div', { className: 'row' },
        el('button', { id: 'lnext', className: 'go', hidden: true, textContent: last ? 'Back to lessons' : 'Next lesson',
          onclick: () => (last ? openList() : start(lessons[n + 1].id)) })));
    host.scrollTop = 0;
    // The card first: on a phone the view is fitted to the room the card leaves.
    ed.resize();
    layOut(false);
    focusTitle();
    return state();
  }

  function say(cls, ...kids) {
    const box = document.getElementById('lresult');
    box.className = cls;
    box.replaceChildren(...kids);
    if (kids.length) ed.reveal(box.parentElement); // a long lesson has it below the fold
  }

  function reset() {
    if (!cur) return;
    shown = false;
    layOut(false);
    say('');
  }

  /** Runs the program on every check of the lesson and says how it went. */
  function check() {
    if (!cur) return null;
    const runs = ed.judge(cur.checks.map(c => c.in), STEP_CAP);
    if (!runs) {
      ed.sound.error();
      say('fail', el('p', {}, el('b', { textContent: 'Not yet. ' }), 'There is no crayon outline, so there is no program. Press Start over.'));
      return { pass: false, results: [] };
    }
    const results = cur.checks.map((c, i) => {
      const want = [...encoder.encode(c.out)], output = [...runs[i].out];
      return { input: c.in, expected: c.out, want, output, halted: runs[i].halted,
               pass: runs[i].halted && output.length === want.length && output.every((b, j) => b === want[j]) };
    });
    const bad = results.find(r => !r.pass);
    if (!bad) {
      passed = true;
      done.add(cur.id);
      save();
      ed.celebrate();
      const next = document.getElementById('lnext');
      next.hidden = false; // before the result is scrolled into sight, so that it comes along
      say('pass', el('p', {}, el('b', { textContent: 'Yes! ' }),
        results.length > 2 ? `The program does it, for all ${results.length} inputs it was tried with.`
          : results.length > 1 ? 'The program does it, for both inputs it was tried with.' : 'The program does it.'));
      if (keyed(document.activeElement)) next.focus(); // after a click, Space must still fire, not move on
    } else {
      ed.sound.error();
      const given = bad.input ? el('span', {}, 'With ', el('code', { textContent: bad.input }), ' in the Input box, ') : 'With the Input box empty, ';
      say('fail', ...(bad.halted
        ? [el('p', {}, el('b', { textContent: 'Not yet. ' }), given, 'the program should write'), byteRow(bad.want),
           el('p', { textContent: 'but it wrote' }), byteRow(bad.output, bad.want)]
        : [el('p', {}, el('b', { textContent: 'Not yet. ' }), given,
            `the program kept going: it had not stopped after ${STEP_CAP.toLocaleString('en')} steps. Is there a way out of the loop?`)]));
    }
    return { pass: !bad, results };
  }

  /** Shows the next hint and gives its text, or null when there are no more. */
  function hint() {
    if (!cur || hints >= cur.hints.length) return null;
    const text = cur.hints[hints++];
    document.getElementById('lhints').append(el('li', { textContent: text }));
    document.getElementById('lhint').textContent = hints < cur.hints.length ? 'Another hint' : 'Show me';
    return text;
  }

  function showSolution() {
    if (!cur) return;
    shown = true;
    layOut(true);
    say('', el('p', { textContent: 'This is one way to do it. Press Check my program to see it pass, or Start over to build it yourself.' }));
  }

  function exit() {
    cur = null;
    hints = 0;
    passed = shown = false;
    setOpen(false);
  }

  const state = () => ({ open, id: cur ? cur.id : null, done: [...done], hints, passed, solutionShown: shown });

  // From a button or a key there is nobody to catch a failed load, and the list has already said so.
  const openList = () => { showList().catch(() => {}); };
  const toggle = () => (open ? exit() : openList());
  button.onclick = toggle;
  document.getElementById('llist').onclick = openList;
  document.getElementById('lexit').onclick = exit;

  return {
    /** Opens the lesson list. Resolves when the lessons are loaded and listed. */
    open: showList,
    exit, toggle,
    /** [{ id, title, done }], in order. */
    list: async () => (await load()).map(l => ({ id: l.id, title: l.title, done: done.has(l.id) })),
    start, check, hint, showSolution, reset, state,
  };
}
