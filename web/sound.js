// Sound effects for the editor, all synthesized with the Web Audio API.
//
//   import { sound } from './sound.js';
//   sound.unlock();   // from a user gesture; everything else is silent until then
//
// `makeEngine` builds the whole graph on any BaseAudioContext, so the effects
// can also be rendered on an OfflineAudioContext and measured.

const rand = (a, b) => a + Math.random() * (b - a);

// One pitch per color: C major pentatonic from C4, so any order of steps
// sounds like a tune and never like a wrong note.
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28].map(n => 261.63 * 2 ** (n / 12));

export function makeEngine(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.5;
  // A fast, hard compressor used as a limiter: stacked effects cannot clip.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -9;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  // After the limiter, so its make-up gain and attack overshoot keep headroom.
  const OUT = 0.8;
  const mute = ctx.createGain();
  mute.gain.value = OUT;
  master.connect(limiter);
  limiter.connect(mute);
  mute.connect(ctx.destination);

  // Two seconds of white noise shared by every noisy sound; each one starts
  // at a random offset so repeats do not sound identical.
  const noiseBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 2), ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  // Sources started and not yet ended, so hush() can stop them.
  const playing = new Set();

  // Plays `src` through `chain` (already connected in order) from `t` for
  // `dur`, then takes the nodes out of the graph so nothing accumulates.
  function oneShot(src, chain, t, dur, pan, offset) {
    const last = chain[chain.length - 1];
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      last.connect(p);
      p.connect(master);
      chain.push(p);
    } else {
      last.connect(master);
    }
    src.onended = () => { playing.delete(src); src.disconnect(); for (const n of chain) n.disconnect(); };
    src.start(t, offset);
    src.stop(t + dur + 0.02);
    playing.add(src);
  }

  // Quick rise, exponential fall: a pluck.
  function pluck(param, t, dur, vol, attack) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(vol, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function tone(freq, at, dur, vol, { to, type = 'sine', pan = 0, attack = 0.005 } = {}) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    pluck(g.gain, t, dur, vol, attack);
    osc.connect(g);
    oneShot(osc, [g], t, dur, pan);
  }

  function hiss(freq, at, dur, vol, { to, type = 'bandpass', q = 1, pan = 0, attack = 0.003 } = {}) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf;
    src.loop = true;
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    pluck(g.gain, t, dur, vol, attack);
    src.connect(f);
    f.connect(g);
    oneShot(src, [f, g], t, dur, pan, Math.random() * 1.9);
  }

  // A looping noise bed with a filter and a level that start silent: the
  // crayon and the wind are each one of these, built on first use and kept.
  function bed(filterType, q) {
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), level = ctx.createGain();
    src.buffer = noiseBuf;
    src.loop = true;
    filter.type = filterType;
    filter.Q.value = q;
    level.gain.value = 0;
    src.connect(filter);
    filter.connect(level);
    src.start();
    return { filter, level };
  }

  // A slow or fast wobble on the loudness of `from`, so a bed is not a
  // steady hiss.
  function wobble(from, hz, depth, type) {
    const g = ctx.createGain(), lfo = ctx.createOscillator(), amount = ctx.createGain();
    g.gain.value = 1 - depth;
    lfo.type = type;
    lfo.frequency.value = hz;
    amount.gain.value = depth;
    lfo.connect(amount);
    amount.connect(g.gain);
    lfo.start();
    from.connect(g);
    g.connect(master);
  }

  // Eases a parameter toward `v`. Only setTargetAtTime is ever used on these
  // parameters, so cancelling later events never makes the value jump.
  function ease(param, v, tau, at = 0) {
    const t = ctx.currentTime + at;
    if (!at) param.cancelScheduledValues(t);
    param.setTargetAtTime(v, t, tau);
  }

  let crayonBed = null, windBed = null, nextLand = 0;

  return {
    setMute(on) { ease(mute.gain, on ? 0 : OUT, 0.015); },

    // Stops every effect, even the parts booked for later: a suspended
    // context keeps them and would play them whenever it resumes.
    hush() {
      for (const src of playing) src.stop();
      nextLand = 0;
    },

    fire() {
      tone(150, 0, 0.24, 0.42, { to: 48, attack: 0.004 });
      hiss(700, 0, 0.07, 0.5, { type: 'lowpass' });
      hiss(6000, 0.02, 0.5, 0.1, { type: 'highpass', attack: 0.03 });
    },

    land() {
      // Ticks queue a little apart instead of piling onto one instant; when
      // the queue is already a quarter second deep, extra ones are dropped.
      const now = ctx.currentTime;
      const t = Math.max(now, nextLand);
      if (t - now > 0.25) return;
      nextLand = t + rand(0.018, 0.05);
      hiss(rand(2200, 5200), t - now, rand(0.02, 0.04), rand(0.12, 0.3),
        { q: 2, pan: rand(-0.6, 0.6), attack: 0.002 });
    },

    pickUp() {
      tone(440, 0, 0.1, 0.11, { to: 720 });
      hiss(3000, 0, 0.05, 0.12);
    },

    drop() {
      tone(420, 0, 0.11, 0.11, { to: 250 });
      hiss(320, 0, 0.08, 0.3, { type: 'lowpass' });
    },

    flick() {
      hiss(900, 0, 0.18, 0.45, { to: 4000, q: 2, attack: 0.04 });
      tone(700, 0, 0.12, 0.05, { to: 1400 });
    },

    crayon(on, speed) {
      if (!crayonBed) {
        if (!on) return;
        crayonBed = bed('bandpass', 1.2);
        // Wax sticks and slips: a fast flutter makes noise read as a scribble.
        wobble(crayonBed.level, 43, 0.35, 'triangle');
      }
      const s = on ? Math.min(1, Math.max(0, speed / 20)) || 0 : 0;
      ease(crayonBed.filter.frequency, 700 + 2400 * s, 0.03);
      ease(crayonBed.level.gain, 0.35 * s ** 0.6, on ? 0.025 : 0.04);
      // Pointer events stop arriving when the hand stops, so every call also
      // books its own fade; the next call cancels it.
      if (on) ease(crayonBed.level.gain, 0, 0.05, 0.09);
    },

    outlineClosed() {
      [659.25, 880, 1318.51].forEach((f, i) => tone(f, i * 0.08, 0.38, 0.09));
    },

    step(colorIndex) {
      const f = SCALE[(((colorIndex | 0) % 13) + 13) % 13];
      tone(f, 0, 0.22, 0.16);
      tone(f * 2, 0, 0.12, 0.04);
    },

    output() {
      tone(2093, 0, 0.45, 0.07);
      tone(3135.96, 0, 0.3, 0.03);
    },

    halt() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.07, i === 3 ? 0.9 : 0.6, 0.09));
    },

    error() {
      tone(311.13, 0, 0.14, 0.12, { type: 'triangle', to: 290 });
      tone(233.08, 0.13, 0.24, 0.12, { type: 'triangle', to: 208 });
    },

    ui() {
      tone(880, 0, 0.04, 0.07, { to: 620, attack: 0.002 });
    },

    setWind(strength) {
      const s = Math.min(12, Math.max(0, +strength || 0));
      if (!windBed) {
        if (!s) return;
        windBed = bed('bandpass', 0.6);
        wobble(windBed.level, 0.17, 0.25, 'sine');
      }
      if (s) ease(windBed.filter.frequency, 220 + 60 * s, 0.6);
      ease(windBed.level.gain, s ? 0.04 + 0.018 * s : 0, 0.5);
    },

    // One bird: a few short whistles sliding up or down around one pitch.
    chirp() {
      const pan = rand(-0.7, 0.7), base = rand(2600, 4200), vol = rand(0.02, 0.04);
      let at = 0;
      for (let n = 2 + Math.floor(Math.random() * 4); n > 0; n--) {
        const d = rand(0.05, 0.1);
        tone(base * rand(0.92, 1.08), at, d, vol, { to: base * rand(0.8, 1.4), pan, attack: 0.015 });
        at += d + rand(0.03, 0.09);
      }
    },
  };
}

const KEY = 'konfetti.muted';
const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
const hidden = () => typeof document !== 'undefined' && document.hidden;

let ctx = null, eng = null, wind = 0, ambience = true, birdTimer = 0;
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch {}

// A suspended context does not advance its clock, so anything scheduled then
// would all play at once on resume: effects only fire while it is running.
const live = () => !!eng && !muted && ctx.state === 'running';

function birds() {
  const want = live() && ambience && !hidden();
  if (want && !birdTimer) {
    birdTimer = setTimeout(() => {
      birdTimer = 0;
      try { if (live() && ambience) eng.chirp(); } catch {}
      birds();
    }, rand(2500, 9000));
  } else if (!want && birdTimer) {
    clearTimeout(birdTimer);
    birdTimer = 0;
  }
}

// Brings the context in line with what should be audible: running only when
// unmuted and the tab is visible.
function sync() {
  if (!ctx) return;
  try {
    const want = !muted && !hidden();
    if (want && ctx.state !== 'running') ctx.resume().catch(() => {});
    if (!want && ctx.state === 'running') {
      eng.hush();
      ctx.suspend().catch(() => {});
    }
  } catch {}
  birds();
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync);

export const sound = {
  get muted() { return muted; },

  setMuted(on) {
    muted = !!on;
    try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch {}
    try {
      if (!eng) return;
      eng.setMute(muted);
      // Let the fade finish before the context stops, or it ends in a click.
      if (muted) { birds(); setTimeout(sync, 80); } else sync();
    } catch {}
  },

  unlock() {
    try {
      if (!ctx) {
        if (!AC) return;
        ctx = new AC();
        eng = makeEngine(ctx);
        eng.setMute(muted);
        eng.setWind(wind);
        ctx.onstatechange = sync;
      }
      sync();
    } catch {}
  },

  setWind(strength) {
    wind = strength;
    try { if (eng) eng.setWind(wind); } catch {}
  },

  setAmbience(on) {
    ambience = !!on;
    birds();
  },
};

// The one-shot effects all share the same guard.
for (const name of ['fire', 'land', 'pickUp', 'drop', 'flick', 'crayon', 'outlineClosed',
  'step', 'output', 'halt', 'error', 'ui']) {
  sound[name] = (...args) => {
    try { if (live()) eng[name](...args); } catch {}
  };
}
