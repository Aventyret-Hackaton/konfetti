// The words and the small views of the debugger: what a step did, in plain language, the stacks as
// boxes, and the labels that float over the bits. No three.js in here; main.js owns the machine.

/** One line per instruction, in palette order, for hover help and the legend. */
export const EXPLAIN = [
  'pushes 1. Several reds in a row count up instead, so a run of n reds pushes n.',
  'copies the top number.',
  'swaps the top two numbers.',
  'adds the top two numbers.',
  'subtracts the top number from the one below it.',
  'multiplies the top two numbers.',
  'divides the number below the top by the top: leaves the quotient, then the remainder on top.',
  'pops a number and picks the way: zero goes straightest, positive takes the leftmost way, negative the rightmost.',
  'pops a number and writes it to the output as one byte.',
  'reads one byte of the input and pushes it, or pushes -1 when the input has run out.',
  'throws the top number away.',
  'moves the top number over to the stash.',
  'takes the top number of the stash back.',
];

const byteWords = n => (n > 32 && n < 127 ? `"${String.fromCharCode(n)}" (${n})`
  : n === 32 ? 'a space (32)' : n === 10 ? 'a newline (10)' : `byte ${n}`);

/**
 * What one instruction did, from the machine before and after it.
 * `before` and `after` are { main, stash, out }: the stacks as arrays of decimal strings, top last,
 * and the output bytes. `color` is the palette index of the bit.
 */
export function describe(color, before, after) {
  const m0 = before.main, m1 = after.main;
  const a = m0[m0.length - 2], b = m0[m0.length - 1], top = m1[m1.length - 1];
  const needs = n => `needs ${n === 1 ? 'a number' : 'two numbers'} on the stack: did nothing`;
  const sign = ['+', '−', '×'][color - 3];
  switch (color) {
    case 0: return m1.length > m0.length ? 'pushed 1' : `counted up to ${top} (run of ${top})`;
    case 1: return m0.length ? `copied the top: ${b}` : needs(1);
    case 2: return m0.length > 1 ? `swapped ${a} and ${b}` : needs(2);
    case 3: case 4: case 5: return m0.length > 1 ? `${a} ${sign} ${b} = ${top}` : needs(2);
    case 6: return m0.length < 2 ? needs(2) : b === '0' ? 'cannot divide by 0: did nothing'
      : `${a} ÷ ${b} = ${m1[m1.length - 2]} remainder ${top}`;
    case 7: return !m0.length ? 'nothing to pop, so straightest'
      : `popped ${b}, ${b === '0' ? 'zero' : b[0] === '-' ? 'negative' : 'positive'}`;
    case 8: return m0.length ? `popped ${b}, wrote ${byteWords(after.out[after.out.length - 1])}` : needs(1);
    case 9: return top === '-1' ? 'the input has run out: pushed -1' : `read ${byteWords(Number(top))} from the input`;
    case 10: return m0.length ? `threw away ${b}` : needs(1);
    case 11: return m0.length ? `moved ${b} to the stash` : needs(1);
    default: return before.stash.length ? `took ${top} back from the stash` : 'the stash is empty: did nothing';
  }
}

/**
 * The turn from heading (from -> at) to (at -> to), in language coordinates where left is
 * counter-clockwise: 'straight', 'left' or 'right'. For words and arrows only; the runtime decides the walk.
 */
export function turn(from, at, to) {
  const hx = at.x - from.x, hy = at.y - from.y, nx = to.x - at.x, ny = to.y - at.y;
  const deg = Math.atan2(hx * ny - hy * nx, hx * nx + hy * ny) * 180 / Math.PI;
  return Math.abs(deg) < 8 ? 'straight' : deg > 0 ? 'left' : 'right';
}
export const TURN_WORDS = { straight: 'went straight on', left: 'turned left', right: 'turned right' };
export const TURN_ARROW = { straight: '↑', left: '↰', right: '↱' };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** Draws both stacks into `host` as rows of boxes, bottom on the left, the top one marked. */
export function drawStacks(host, main, stash) {
  const SHOW = 8;
  host.replaceChildren(...[['main', main], ['stash', stash]].map(([name, values]) => {
    const row = el('div', 'stack');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `${name} stack, ${values.length ? `bottom to top: ${values.join(', ')}` : 'empty'}`);
    row.append(el('span', 'sname', name));
    if (!values.length) row.append(el('span', 'empty', 'empty'));
    if (values.length > SHOW) row.append(el('span', 'more', `+${values.length - SHOW} below`));
    values.slice(-SHOW).forEach((v, i, shown) => {
      const box = el('span', i === shown.length - 1 ? 'box top' : 'box', v);
      // A number that is a printable character is probably text on its way in or out.
      if (/^\d+$/.test(v) && v > 32 && v < 127) box.append(el('small', '', `'${String.fromCharCode(v)}'`));
      if (i === shown.length - 1) box.append(el('em', '', 'top'));
      row.append(box);
    });
    return row;
  }));
}

/** Draws the trace, newest first. Each entry: { n, bit, name, hex, op, text }. */
export function drawTrace(host, trace, emptyText) {
  if (!trace.length) return host.replaceChildren(el('li', 'empty', emptyText));
  host.replaceChildren(...trace.map(s => {
    const li = el('li');
    const swatch = el('i');
    swatch.style.background = s.hex;
    li.append(el('span', 'n', s.n), swatch, el('b', '', `${s.name} ${s.op}`), el('span', 'at', `#${s.bit}`), el('span', 'did', s.text));
    return li;
  }));
}

/** A pool of labels in `layer`. `draw(items)` shows exactly `items`: [{ x, y, html, cls, alpha }] in page pixels. */
export function makeLabels(layer) {
  const pool = [];
  return {
    draw(items) {
      while (pool.length < items.length) pool.push(layer.appendChild(el('span')));
      pool.forEach((e, i) => {
        const it = items[i];
        e.hidden = !it;
        if (!it) return;
        if (e.dataset.html !== it.html) e.innerHTML = e.dataset.html = it.html;
        e.className = it.cls;
        e.style.opacity = it.alpha;
        e.style.transform = `translate(${it.x.toFixed(1)}px, ${it.y.toFixed(1)}px)`;
      });
    },
  };
}
