/*
 * Konfetti – Power Mode for claude.ai
 *
 * Every character typed into a prompt (the ProseMirror composer, or any
 * textarea such as the "edit message" box) is copied onto a full-screen
 * canvas, thrown into the air together with a burst of confetti, and falls
 * to the bottom of the screen. Nothing ever disappears: the confetti piles up
 * higher and higher for as long as you keep typing (reload the tab to sweep).
 *
 * Every keystroke also gives the prompt box a discreet shake and a short
 * haptic pulse (on devices that have a vibration motor).
 *
 * The page's own DOM is never modified: the only elements this script adds
 * are one click-through <canvas> and (lazily) one hidden measuring <div>,
 * and the shake is a Web Animation, which leaves styles and classes alone.
 */
(() => {
  'use strict';

  if (window.__konfettiLoaded) return;
  window.__konfettiLoaded = true;

  // ---------------------------------------------------------------- config

  const COLORS = [
    '#ff3b6b', '#ff8a00', '#ffd400', '#3ddc84',
    '#00c2ff', '#5b6cff', '#b45bff', '#ff5bd1',
  ];
  const PIECES_PER_CHAR = 10;   // confetti pieces for the first character
  const PIECES_GROWTH = 1;      // extra pieces for every further character
  const MAX_PIECES_PER_CHAR = 60;
  const STREAK_TIMEOUT = 10;    // seconds without typing before the amount
                                // starts over (0 = never start over)
  const PIECES_PER_PASTE = 60;  // confetti pieces for a paste
  const MAX_GLYPHS_PER_EVENT = 24;
  const MAX_FLYING = 4000;      // airborne pieces at once (keeps frames smooth)
  const GRAVITY = 1200;         // px / s^2
  const BUCKET = 6;             // px width of one pile column
  const PILE_GROWTH = 0.4;      // px a column grows per piece landing on it
  const SHAKE_PX = 1.5;         // how far the prompt box moves per keystroke
  const SHAKE_MS = 110;         // how long one shake lasts
  const VIBRATE_MS = 8;         // haptic pulse (only felt on devices with a
                                // vibration motor; 0 = off)
  const KEY_SOUND = false;      // true = soft "tick" per keystroke, a stand-in
                                // for haptics on machines that cannot vibrate
  const PILE_SLOPE = 2;         // px step between columns before pieces slide

  // ---------------------------------------------------------------- canvas

  let canvas = null;
  let ctx = null;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let pile = new Float32Array(0);  // height of the heap, per column

  // Confetti that has landed never moves again, so it is painted once onto
  // this off-screen canvas instead of being redrawn every frame. That keeps
  // the cost constant no matter how big the heap gets.
  let heapCanvas = null;
  let heapCtx = null;
  /** Everything that has landed, in landing order (used to rebuild on resize). */
  const resting = [];

  function ensureCanvas() {
    if (canvas && canvas.isConnected) return;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.setAttribute('data-konfetti', '');
      canvas.style.cssText = [
        'position:fixed', 'left:0', 'top:0', 'width:100vw', 'height:100vh',
        'margin:0', 'padding:0', 'border:0', 'background:transparent',
        'pointer-events:none', 'z-index:2147483647',
      ].map((d) => d + ' !important').join(';');
      ctx = canvas.getContext('2d');
      heapCanvas = document.createElement('canvas');
      heapCtx = heapCanvas.getContext('2d');
    }
    document.documentElement.appendChild(canvas);
    resize();
  }

  function resize() {
    if (!canvas) return;
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = window.devicePixelRatio || 1;
    heapCanvas.width = canvas.width = Math.max(1, Math.round(W * dpr));
    heapCanvas.height = canvas.height = Math.max(1, Math.round(H * dpr));
    // The floor moved: re-stack the whole heap on the new floor.
    pile = new Float32Array(Math.max(1, Math.ceil(W / BUCKET)));
    for (const p of resting) {
      p.x = Math.min(Math.max(p.x, 4), Math.max(4, W - 4));
      settle(p);
      paint(heapCtx, p);
    }
    if (!running) draw();
  }

  /**
   * Put a piece to rest on top of the heap below it. Pieces slide downhill
   * when the heap is too steep, so it grows as a mound rather than a tower.
   */
  function settle(p) {
    const last = pile.length - 1;
    let b = Math.min(last, Math.max(0, (p.x / BUCKET) | 0));
    for (let i = 0; i < 200; i++) {
      const left = b > 0 ? pile[b - 1] : Infinity;
      const right = b < last ? pile[b + 1] : Infinity;
      if (pile[b] - Math.min(left, right) <= PILE_SLOPE) break;
      const dir = left === right ? (Math.random() < 0.5 ? -1 : 1) : left < right ? -1 : 1;
      b += dir;
      p.x += dir * BUCKET;
    }
    p.y = H - pile[b] - p.h * 0.5 - 1;
    // Once a column reaches the top of the screen it stops growing.
    if (pile[b] < H) pile[b] += PILE_GROWTH;
  }

  window.addEventListener('resize', resize);

  // ------------------------------------------------------------- particles

  /** @type {Array<object>} */
  const particles = [];
  let running = false;
  let lastTime = 0;

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  function launch(p, power) {
    // Mostly upwards, fanned out to both sides.
    const angle = -Math.PI / 2 + rand(-1.15, 1.15);
    const speed = rand(300, 900) * power;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.drag = rand(1.6, 2.6);
    p.rot = rand(0, Math.PI * 2);
    p.vr = rand(-10, 10);
    p.swayPhase = rand(0, Math.PI * 2);
    p.swayFreq = rand(2, 5);
    p.swayAmp = rand(15, 50);
    p.color = pick(COLORS);
    return p;
  }

  function addPiece(x, y, power) {
    const shape = Math.random();
    const p = launch({ kind: 'piece', x, y }, power);
    if (shape < 0.6) {            // rectangle
      p.w = rand(6, 11);
      p.h = rand(4, 7);
      p.round = false;
    } else if (shape < 0.85) {    // streamer
      p.w = rand(10, 16);
      p.h = rand(2, 3.5);
      p.round = false;
    } else {                      // dot
      p.w = p.h = rand(5, 8);
      p.round = true;
    }
    p.flip = rand(0, Math.PI * 2);
    p.vflip = rand(6, 16);
    particles.push(p);
  }

  function addGlyph(ch, x, y, font, size) {
    const p = launch({ kind: 'glyph', x, y }, 0.8);
    p.ch = ch;
    p.font = font;
    p.h = size * 0.7;
    p.vr = rand(-7, 7);
    p.rot = 0;                    // starts upright, exactly where it was typed
    particles.push(p);
  }

  function burst(x, y, count, power) {
    ensureCanvas();
    for (let i = 0; i < count && particles.length < MAX_FLYING; i++) {
      addPiece(x + rand(-3, 3), y + rand(-3, 3), power);
    }
    start();
  }

  function start() {
    if (running) return;
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    const dt = Math.min(0.034, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    update(dt);
    draw();
    if (particles.length) {
      requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  function update(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const damp = Math.exp(-p.drag * dt);
      p.vx *= damp;
      p.vy = p.vy * damp + GRAVITY * dt;
      p.swayPhase += p.swayFreq * dt;
      // Flutter sideways only while falling, like paper does.
      const sway = p.vy > 0 ? Math.sin(p.swayPhase) * p.swayAmp : 0;
      p.x += (p.vx + sway) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'piece') p.flip += p.vflip * dt;

      // Keep everything on screen horizontally.
      if (p.x < 4) { p.x = 4; p.vx = Math.abs(p.vx) * 0.4; }
      else if (p.x > W - 4) { p.x = W - 4; p.vx = -Math.abs(p.vx) * 0.4; }

      // Land on the floor, or on whatever confetti is already lying there,
      // and stay there for good.
      const b = Math.min(pile.length - 1, Math.max(0, (p.x / BUCKET) | 0));
      if (p.vy > 0 && p.y >= H - pile[b] - p.h * 0.5 - 1) {
        if (p.kind === 'piece') {
          // Lie mostly flat, facing the viewer.
          p.rot = rand(-0.5, 0.5);
          p.flip = rand(-0.6, 0.6);
        }
        settle(p);
        paint(heapCtx, p);
        resting.push(p);
        particles.splice(i, 1);
      }
    }
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(heapCanvas, 0, 0);
    for (const p of particles) paint(ctx, p);
  }

  /** Paint one particle onto a canvas context (the live one or the heap). */
  function paint(c, p) {
    const cos = Math.cos(p.rot);
    const sin = Math.sin(p.rot);
    c.fillStyle = p.color;

    if (p.kind === 'glyph') {
      c.setTransform(cos * dpr, sin * dpr, -sin * dpr, cos * dpr, p.x * dpr, p.y * dpr);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = p.font;
      c.fillText(p.ch, 0, 0);
      return;
    }

    // Fake a 3D tumble by squashing the piece along its own Y axis.
    let sy = Math.cos(p.flip);
    if (Math.abs(sy) < 0.12) sy = sy < 0 ? -0.12 : 0.12;
    c.setTransform(
      cos * dpr, sin * dpr,
      -sin * sy * dpr, cos * sy * dpr,
      p.x * dpr, p.y * dpr
    );
    if (p.round) {
      c.beginPath();
      c.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      c.fill();
    } else {
      c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    }
  }

  // ------------------------------------------------- locating typed text

  const segmenter =
    typeof Intl !== 'undefined' && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;

  /** Split a string into user-perceived characters with UTF-16 offsets. */
  function graphemes(text) {
    const out = [];
    if (segmenter) {
      for (const s of segmenter.segment(text)) out.push({ ch: s.segment, index: s.index });
    } else {
      let index = 0;
      for (const ch of text) { out.push({ ch, index }); index += ch.length; }
    }
    return out;
  }

  const sameText = (a, b) => a.replace(/ /g, ' ') === b.replace(/ /g, ' ');
  const isBlank = (ch) => /^\s*$/.test(ch);

  function fontOf(el) {
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize) || 16;
    return {
      size,
      font: `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`,
    };
  }

  function usable(rect) {
    return rect && (rect.width > 0 || rect.height > 0);
  }

  /** Where the caret is right now, as {x, y} in viewport pixels. */
  function caretPoint(host) {
    if (host instanceof HTMLTextAreaElement) {
      const r = textareaRect(host, host.selectionEnd, host.selectionEnd);
      return { x: r.left, y: r.top + r.height / 2 };
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0).cloneRange();
      range.collapse(false);
      const rects = range.getClientRects();
      const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
      if (usable(rect)) return { x: rect.left, y: rect.top + rect.height / 2 };
      // Caret in an empty block: fall back to that block's box.
      const node = range.startContainer;
      const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      if (el && host.contains(el)) {
        const r = el.getBoundingClientRect();
        if (usable(r)) {
          const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
          return { x: r.left + pad, y: r.top + r.height / 2 };
        }
      }
    }
    const r = host.getBoundingClientRect();
    return { x: r.left + Math.min(24, r.width / 2), y: r.top + r.height / 2 };
  }

  // Hidden mirror used to find pixel positions inside a <textarea>.
  let mirror = null;
  const MIRROR_PROPS = [
    'direction', 'fontFamily', 'fontSize', 'fontStyle', 'fontVariant',
    'fontWeight', 'fontStretch', 'fontKerning', 'fontFeatureSettings',
    'letterSpacing', 'wordSpacing', 'lineHeight', 'textAlign', 'textIndent',
    'textTransform', 'tabSize', 'paddingTop', 'paddingRight',
    'paddingBottom', 'paddingLeft',
  ];

  /** Viewport rect of the text between two offsets of a textarea. */
  function textareaRect(ta, from, to) {
    if (!mirror) {
      mirror = document.createElement('div');
      mirror.setAttribute('aria-hidden', 'true');
      mirror.setAttribute('data-konfetti', '');
    }
    const cs = getComputedStyle(ta);
    const ms = mirror.style;
    ms.cssText =
      'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;' +
      'box-sizing:content-box;height:auto;border:0;margin:0;overflow:hidden;' +
      'white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;';
    for (const prop of MIRROR_PROPS) ms[prop] = cs[prop];
    // clientWidth excludes a vertical scrollbar, so wrapping matches exactly.
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    ms.width = Math.max(0, ta.clientWidth - padX) + 'px';

    const value = ta.value;
    mirror.textContent = value.slice(0, from);
    const span = document.createElement('span');
    // A zero-width space gives an empty span a measurable line box.
    span.textContent = value.slice(from, to) || '​';
    mirror.appendChild(span);
    mirror.appendChild(document.createTextNode(value.slice(to) + '​'));
    document.documentElement.appendChild(mirror);

    const box = ta.getBoundingClientRect();
    const left = box.left + ta.clientLeft + span.offsetLeft - ta.scrollLeft;
    const top = box.top + ta.clientTop + span.offsetTop - ta.scrollTop;
    const width = from === to ? 0 : span.offsetWidth;
    const height = span.offsetHeight;
    mirror.remove();
    return { left, top, width, height };
  }

  /**
   * Find the on-screen box of each character of `text`, assuming it is the
   * text that sits immediately before the caret. Returns null when that
   * cannot be confirmed (the caller then uses the caret position instead).
   */
  function locateTyped(host, text) {
    const parts = graphemes(text);

    if (host instanceof HTMLTextAreaElement) {
      const end = host.selectionEnd;
      const begin = end - text.length;
      if (begin < 0 || host.value.slice(begin, end) !== text) return null;
      const style = fontOf(host);
      return parts.map(({ ch, index }) => {
        const r = textareaRect(host, begin + index, begin + index + ch.length);
        return { ch, style, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
    }

    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const node = range.endContainer;
    const end = range.endOffset;
    if (node.nodeType !== Node.TEXT_NODE || !node.parentElement) return null;
    const begin = end - text.length;
    if (begin < 0 || !sameText(node.data.slice(begin, end), text)) return null;

    const style = fontOf(node.parentElement);
    const probe = document.createRange();
    const out = [];
    for (const { ch, index } of parts) {
      probe.setStart(node, begin + index);
      probe.setEnd(node, begin + index + ch.length);
      const rects = probe.getClientRects();
      const rect = rects.length ? rects[rects.length - 1] : probe.getBoundingClientRect();
      if (!usable(rect)) return null;
      out.push({ ch, style, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    return out;
  }

  // --------------------------------------------------------------- effects

  // Like Power Mode's combo: every character entered makes the next burst
  // bigger, until you stop typing for STREAK_TIMEOUT seconds.
  let streak = 0;
  let lastTypedAt = 0;

  /** Count one more character and return how many pieces it has earned. */
  function nextBurstSize() {
    const now = Date.now();
    if (STREAK_TIMEOUT > 0 && now - lastTypedAt > STREAK_TIMEOUT * 1000) streak = 0;
    lastTypedAt = now;
    const size = PIECES_PER_CHAR + streak * PIECES_GROWTH;
    streak++;
    return Math.min(MAX_PIECES_PER_CHAR, size);
  }

  /** Bigger bursts are also thrown a little harder, so they spread out. */
  const burstPower = (size) => 1 + Math.min(0.4, size / 150);

  /** Turn freshly typed text into confetti. */
  function explodeTyped(host, text, mustLocate) {
    if (!text || !host.isConnected) return false;

    let chars = locateTyped(host, text);
    // `mustLocate`: only celebrate if the text really ended up in the prompt.
    if (!chars && mustLocate) return false;
    if (!chars) {
      // Position of each character unknown: everything flies from the caret.
      const at = caretPoint(host);
      const style = fontOf(host);
      chars = graphemes(text).map(({ ch }) => ({ ch, style, x: at.x, y: at.y }));
    }
    // For long insertions (IME, autocomplete) only the last few are shown.
    chars = chars.slice(-MAX_GLYPHS_PER_EVENT);

    // Text arriving in one go (IME, autocomplete) shares the airtime.
    const share = Math.sqrt(chars.length);
    for (const c of chars) {
      if (!isBlank(c.ch)) {
        ensureCanvas();
        addGlyph(c.ch, c.x, c.y, c.style.font, c.style.size);
      }
      const size = nextBurstSize();
      burst(c.x, c.y, Math.max(4, Math.round(size / share)), burstPower(size));
    }
    return true;
  }

  /** A bigger burst, with a handful of the pasted characters mixed in. */
  function explodePasted(host, text) {
    if (!host.isConnected) return;
    const at = caretPoint(host);
    const style = fontOf(host);
    const visible = graphemes(text || '').filter(({ ch }) => !isBlank(ch));
    ensureCanvas();
    for (const { ch } of visible.slice(0, MAX_GLYPHS_PER_EVENT)) {
      addGlyph(ch, at.x + rand(-6, 6), at.y + rand(-6, 6), style.font, style.size);
    }
    burst(at.x, at.y, PIECES_PER_PASTE, 1.25);
  }

  // ---------------------------------------------------- keystroke feedback

  const boxCache = new WeakMap();
  const shaking = new WeakMap();

  const isTransparent = (color) =>
    color === 'transparent' || /(,|\/)\s*0\)$/.test(color);

  /**
   * The visible "box" around a prompt: the nearest rounded ancestor that has
   * a border, shadow or background of its own. On claude.ai the editable
   * element itself is unstyled and sits inside such a box.
   */
  function promptBox(host) {
    const cached = boxCache.get(host);
    if (cached && cached.isConnected && cached.contains(host)) return cached;

    let box = host;
    const maxWidth = host.getBoundingClientRect().width * 1.6 + 120;
    let el = host;
    for (let depth = 0; depth < 8; depth++) {
      if (!el || el === document.body || el === document.documentElement) break;
      const cs = getComputedStyle(el);
      const framed =
        cs.boxShadow !== 'none' ||
        (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') ||
        !isTransparent(cs.backgroundColor);
      if (framed && parseFloat(cs.borderTopLeftRadius) >= 6 && cs.display !== 'inline') {
        // Guard against grabbing a whole page section instead of the box.
        if (el.getBoundingClientRect().width <= maxWidth) box = el;
        break;
      }
      el = el.parentElement;
    }
    boxCache.set(host, box);
    return box;
  }

  /** Nudge the prompt box a pixel or so in a random direction and back. */
  function shake(host) {
    if (SHAKE_PX <= 0 || !host.isConnected) return;
    const box = promptBox(host);
    if (typeof box.animate !== 'function') return;
    const previous = shaking.get(box);
    if (previous) previous.cancel();
    const angle = rand(0, Math.PI * 2);
    const dx = Math.cos(angle) * SHAKE_PX;
    const dy = Math.sin(angle) * SHAKE_PX;
    const at = (k) => `translate(${(dx * k).toFixed(2)}px, ${(dy * k).toFixed(2)}px)`;
    shaking.set(box, box.animate(
      [
        { transform: at(0) },
        { transform: at(1), offset: 0.25 },
        { transform: at(-0.6), offset: 0.6 },
        { transform: at(0) },
      ],
      // 'add' keeps any transform the page itself has on the box.
      { duration: SHAKE_MS, easing: 'linear', composite: 'add' }
    ));
  }

  let audio = null;

  /** A very quiet, very short tick (only used when KEY_SOUND is on). */
  function tick() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) audio = new AC();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190 + rand(-15, 15), t);
    osc.frequency.exponentialRampToValueAtTime(90, t + 0.03);
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  /** What every keystroke in a prompt feels like. */
  function feedback(host) {
    safely(() => shake(host));
    if (VIBRATE_MS > 0 && typeof navigator.vibrate === 'function') {
      safely(() => navigator.vibrate(VIBRATE_MS));
    }
    if (KEY_SOUND) safely(tick);
  }

  // ---------------------------------------------------------------- events

  /** The prompt being typed into, or null if the event is not for a prompt. */
  function promptHost(target) {
    if (!(target instanceof Element)) return null;
    if (target instanceof HTMLTextAreaElement) {
      return target.readOnly || target.disabled ? null : target;
    }
    // <input> elements are deliberately ignored (search boxes, passwords…).
    if (target instanceof HTMLElement && target.isContentEditable) {
      return target.closest('[contenteditable]:not([contenteditable="false"])') || target;
    }
    return null;
  }

  function safely(fn) {
    try {
      fn();
    } catch (err) {
      // Never let a cosmetic effect interfere with typing.
      console.debug('[konfetti]', err);
    }
  }

  // Normally the browser inserts the character and fires `input`. Rich-text
  // editors sometimes cancel the keypress and insert the text themselves, in
  // which case no `input` event follows; `pendingKey` covers that case.
  let pendingKey = null;
  let composing = false;

  window.addEventListener('keypress', (e) => {
    if (e.ctrlKey || e.metaKey || e.isComposing) return;
    if (!e.key || e.key.length > 2 || e.charCode < 32) return;
    const host = promptHost(e.target);
    if (!host) return;
    const mine = (pendingKey = { text: e.key });
    setTimeout(() => {
      if (pendingKey !== mine) return;
      pendingKey = null;
      safely(() => { if (explodeTyped(host, mine.text, true)) feedback(host); });
    }, 0);
  }, true);

  window.addEventListener('input', (e) => {
    pendingKey = null;
    const host = promptHost(e.target);
    if (!host) return;
    // Confetti first: it measures where the character is, and the shake
    // would move it. Every edit is felt, deleting included; only newly
    // typed characters turn into confetti.
    if (e.inputType === 'insertText' && e.data && !e.isComposing && !composing) {
      safely(() => explodeTyped(host, e.data));
    }
    feedback(host);
  }, true);

  // IME / dead keys: celebrate the committed text once, when composition ends.
  window.addEventListener('compositionstart', () => { composing = true; }, true);
  window.addEventListener('compositionend', (e) => {
    composing = false;
    const host = promptHost(e.target);
    const text = e.data;
    if (!host || !text) return;
    // Let the editor finish committing the text before measuring it.
    setTimeout(() => safely(() => explodeTyped(host, text)), 0);
  }, true);

  window.addEventListener('paste', (e) => {
    const host = promptHost(e.target);
    if (!host) return;
    let text = '';
    try {
      text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    } catch (_) { /* clipboard not readable: confetti only */ }
    setTimeout(() => {
      safely(() => explodePasted(host, text));
      feedback(host);
    }, 0);
  }, true);
})();
