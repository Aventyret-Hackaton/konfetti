// All sounds are synthesised with WebAudio — no sample files.

let ctx = null;
let master = null;
let noiseBuf = null;
const pluckCache = new Map();

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(comp).connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state !== 'running') ctx.resume();
  return ctx;
}

export const audioTime = () => (ctx ? ctx.currentTime : 0);
export const audioRunning = () => !!ctx && ctx.state === 'running';

function env(t, peak, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function noise(t, dur) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.start(t, Math.random() * 0.5, dur);
  return s;
}

function kick(t) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  o.connect(env(t, 1.0, 0.003, 0.32)).connect(master);
  o.start(t); o.stop(t + 0.4);
}

function snare(t) {
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.7;
  noise(t, 0.25).connect(bp).connect(env(t, 0.6, 0.002, 0.17)).connect(master);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(240, t);
  o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
  o.connect(env(t, 0.45, 0.002, 0.1)).connect(master);
  o.start(t); o.stop(t + 0.15);
}

function hihat(t) {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7500;
  noise(t, 0.1).connect(hp).connect(env(t, 0.28, 0.001, 0.05)).connect(master);
}

function piano(t, f) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(f * 7, t);
  lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.9);
  const g = env(t, 0.32, 0.004, 1.3);
  lp.connect(g).connect(master);
  for (const [type, mult, detune, level] of [['triangle', 1, -4, 1], ['triangle', 1, 5, 0.7], ['sine', 2, 0, 0.35], ['sine', 3, 0, 0.12]]) {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f * mult; o.detune.value = detune;
    const og = ctx.createGain(); og.gain.value = level;
    o.connect(og).connect(lp);
    o.start(t); o.stop(t + 1.4);
  }
}

// Karplus-Strong plucked string, rendered once per pitch.
function pluckBuffer(f) {
  let buf = pluckCache.get(f);
  if (buf) return buf;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 1.6);
  buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const n = Math.max(2, Math.round(sr / f));
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev = 0.5 * prev + 0.5 * (Math.random() * 2 - 1);
    d[i] = prev;
  }
  for (let i = n + 1; i < len; i++) d[i] = 0.997 * 0.5 * (d[i - n] + d[i - n - 1]);
  pluckCache.set(f, buf);
  return buf;
}

function guitar(t, f) {
  const s = ctx.createBufferSource();
  s.buffer = pluckBuffer(f);
  const g = ctx.createGain(); g.gain.value = 0.75;
  s.connect(g).connect(master);
  s.start(t);
}

function cat(t) {
  const dur = 0.75;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const base = 520 + Math.random() * 120;
  o.frequency.setValueAtTime(base, t);
  o.frequency.exponentialRampToValueAtTime(base * 1.9, t + 0.22);
  o.frequency.exponentialRampToValueAtTime(base * 1.6, t + 0.5);
  o.frequency.exponentialRampToValueAtTime(base * 0.8, t + dur);
  // growly vibrato that gets wilder
  const lfo = ctx.createOscillator(); lfo.frequency.value = 27;
  const lg = ctx.createGain();
  lg.gain.setValueAtTime(5, t);
  lg.gain.linearRampToValueAtTime(70, t + dur);
  lfo.connect(lg).connect(o.frequency);
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.5, t + 0.07);
  out.gain.setValueAtTime(0.5, t + 0.45);
  out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  // vowel-ish formants sweeping "mee-aow"
  for (const [f0, f1, q, lvl] of [[900, 1500, 5, 1], [2800, 2100, 7, 0.7], [4200, 3600, 8, 0.3]]) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.linearRampToValueAtTime(f1, t + dur * 0.6);
    const g = ctx.createGain(); g.gain.value = lvl;
    o.connect(bp).connect(g).connect(out);
  }
  out.connect(master);
  o.start(t); lfo.start(t);
  o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
}

function clap(t) {
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  // a few fast bursts, then a tail — many hands, slightly apart
  for (const d of [0, 0.011, 0.023]) {
    g.gain.setValueAtTime(0.7, t + d);
    g.gain.exponentialRampToValueAtTime(0.08, t + d + 0.009);
  }
  g.gain.setValueAtTime(0.6, t + 0.034);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  noise(t, 0.25).connect(bp).connect(g).connect(master);
}

function tom(t, f = 130) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(f * 1.6, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.1);
  o.connect(env(t, 0.7, 0.003, 0.3)).connect(master);
  o.start(t); o.stop(t + 0.36);
}

function cowbell(t) {
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 1.5;
  const g = env(t, 0.3, 0.002, 0.22);
  bp.connect(g).connect(master);
  for (const f of [540, 800]) {
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.value = f;
    o.connect(bp);
    o.start(t); o.stop(t + 0.26);
  }
}

function bass(t, f) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.Q.value = 6;
  lp.frequency.setValueAtTime(f * 10, t);
  lp.frequency.exponentialRampToValueAtTime(f * 2, t + 0.18);
  const g = env(t, 0.55, 0.004, 0.32);
  lp.connect(g).connect(master);
  const o = ctx.createOscillator();
  o.type = 'sawtooth'; o.frequency.value = f;
  const sub = ctx.createOscillator();
  sub.frequency.value = f / 2;
  o.connect(lp); sub.connect(lp);
  o.start(t); sub.start(t); o.stop(t + 0.36); sub.stop(t + 0.36);
}

// FM bell
function bell(t, f) {
  const mod = ctx.createOscillator();
  mod.frequency.value = f * 3.5;
  const mg = ctx.createGain();
  mg.gain.setValueAtTime(f * 2, t);
  mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.8);
  const car = ctx.createOscillator();
  car.frequency.value = f;
  mod.connect(mg).connect(car.frequency);
  car.connect(env(t, 0.2, 0.002, 1.1)).connect(master);
  mod.start(t); car.start(t); mod.stop(t + 1.15); car.stop(t + 1.15);
}

// the bomb going off: thump + burst of air + crackle
function pow(t) {
  // everything goes through a soft-clipper so it can be pushed hard without harsh peaks
  const drive = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) curve[i] = Math.tanh((i / 511.5 - 1) * 2.5);
  drive.curve = curve;
  const out = ctx.createGain();
  out.gain.value = 1.5;
  drive.connect(out).connect(master);

  // chest-thump: a pitch drop into sub-bass with a long tail
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(260, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
  o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
  o.connect(env(t, 1.4, 0.002, 1.3)).connect(drive);
  o.start(t); o.stop(t + 1.4);

  // second, slightly late boom an octave up for body on small speakers
  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.setValueAtTime(420, t);
  o2.frequency.exponentialRampToValueAtTime(70, t + 0.25);
  o2.connect(env(t + 0.015, 0.8, 0.003, 0.6)).connect(drive);
  o2.start(t); o2.stop(t + 0.7);

  // the crack: full-band noise slamming shut
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(14000, t);
  lp.frequency.exponentialRampToValueAtTime(300, t + 0.5);
  noise(t, 0.9).connect(lp).connect(env(t, 1.3, 0.001, 0.7)).connect(drive);

  // rumble rolling away afterwards
  const rl = ctx.createBiquadFilter();
  rl.type = 'lowpass'; rl.frequency.value = 160; rl.Q.value = 2;
  const rg = ctx.createGain();
  rg.gain.setValueAtTime(0.0001, t);
  rg.gain.exponentialRampToValueAtTime(2.2, t + 0.12);
  rg.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
  const rumble = ctx.createBufferSource();
  rumble.buffer = noiseBuf; rumble.loop = true;
  rumble.connect(rl).connect(rg).connect(drive);
  rumble.start(t); rumble.stop(t + 2.3);

  // echo of the crack, like it bounced off the room
  const delay = ctx.createDelay(0.5);
  delay.delayTime.value = 0.11;
  const fb = ctx.createGain(); fb.gain.value = 0.45;
  const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 1800;
  const send = env(t, 0.5, 0.001, 0.4);
  lp.connect(send).connect(delay);
  delay.connect(dl).connect(fb).connect(delay);
  const wet = ctx.createGain();
  wet.gain.setValueAtTime(0.6, t);
  wet.gain.setValueAtTime(0.6, t + 1.5);
  wet.gain.linearRampToValueAtTime(0, t + 2.2); // close the feedback loop's output
  dl.connect(wet).connect(master);
  setTimeout(() => { fb.disconnect(); wet.disconnect(); }, 3000);

  // confetti crackle
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 5000;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0, t);
  for (let i = 0; i < 22; i++) {
    const ct = t + 0.05 + Math.random() * 0.8;
    cg.gain.setValueAtTime(0.3 * (1 - (ct - t) / 0.9), ct);
    cg.gain.setValueAtTime(0, ct + 0.012);
  }
  noise(t, 0.95).connect(hp).connect(cg).connect(master);
}

const voices = { kick, snare, hihat, piano, guitar, cat, clap, tom, cowbell, bass, bell, pow };

export function play(type, when, freq) {
  if (!ctx) return;
  voices[type](Math.max(when, ctx.currentTime), freq);
}
