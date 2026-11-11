// konfetti editor: fire confetti, draw an area with the crayon, and whatever lies inside is the program.
// World units: 1 = one bit length = 1000 language units. The language origin is where the crayon
// first touched down; language (x, y) = world (x - origin.x, -(z - origin.z)). Seen from above,
// +y is away from the default camera and left turns are counter-clockwise.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld } from './world.js';
import { sound } from './sound.js';
import { createHand } from './hand.js';
import { EXPLAIN, describe, turn, TURN_WORDS, TURN_ARROW, drawStacks, drawTrace, makeLabels } from './debug.js';

const PALETTE = [
  ['red', '#ff4b5c', 'PUSH'], ['orange', '#ff9233', 'DUP'], ['yellow', '#ffe14d', 'SWAP'],
  ['green', '#2fd07a', 'ADD'], ['cyan', '#29d3e6', 'SUB'], ['blue', '#3d7bff', 'MUL'],
  ['purple', '#9b5cff', 'DIVMOD'], ['pink', '#ff6ec7', 'BRANCH'], ['white', '#fff8ec', 'OUT'],
  ['black', '#2a2c3a', 'IN'], ['brown', '#b06a3c', 'DROP'], ['silver', '#dfe6ee', 'STASH'],
  ['gold', '#f2b73a', 'FETCH'],
];
const UNIT = 1000, REACH = 1500, MIN_GAP = 500;
const THICK = 0.008;            // a bit is a paper-thin strip
const LAYER = THICK * 1.5;      // height step between stacked bits; the slack keeps faces from flickering
const FOOTPRINT = 1.05;         // bits with centres closer than this may touch, so they stack
const CRAYON = '#2447d8';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ---- runtime (web/konfetti.wasm, built from src/lib.rs) ----
const kf = (await WebAssembly.instantiateStreaming(fetch('konfetti.wasm'))).instance.exports;
const enc = new TextEncoder(), dec = new TextDecoder();

function kfLoad(src, input, fold) {
  const s = enc.encode(src), i = enc.encode(input);
  const p = kf.kf_buf(s.length + i.length);
  const mem = new Uint8Array(kf.memory.buffer, p, s.length + i.length);
  mem.set(s);
  mem.set(i, s.length);
  still = null; // the runtime drops its old program, and with it what a stopped run left on screen
  return kf.kf_load(s.length, fold ? 1 : 0) === 0;
}
// Views are rebuilt on every read: the wasm memory can move when it grows.
const kfBytes = () => new Uint8Array(kf.memory.buffer, kf.kf_out(), kf.kf_out_len());
const kfOutput = () => dec.decode(kfBytes());
const kfStack = which => Array.from(new BigInt64Array(kf.memory.buffer, kf.kf_stack(which), kf.kf_stack_len(which)), String);

// ---- world ----
const canvas = $('world');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.3, 2000);
camera.position.set(0, 7.5, 25);
// ?grass=N sets the number of grass blades, for slow machines.
const world = buildWorld(scene, renderer, Number(params.get('grass')) || 180000);

// Overlay: links between program bits, a ring on the start bit, a pointer on the running bit.
const ink = '#22242e';
const links = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.6 }));
links.frustumCulled = false;
const startRing = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.74, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: ink, side: THREE.DoubleSide }));
const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 20).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: '#ffe14d', emissive: '#b98f00', roughness: 0.4 }));
pointer.castShadow = true;
// Debug mode only: a ring on the bit the walk goes to next, and an arrow to it from the current one.
const nextRing = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.64, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd21f', side: THREE.DoubleSide }));
const arrow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: ink, side: THREE.DoubleSide }));
arrow.frustumCulled = false;
startRing.visible = pointer.visible = nextRing.visible = arrow.visible = false;
scene.add(links, startRing, pointer, nextRing, arrow);

/** Lays a flat arrow on the ground from world point `a` to `b`, clear of both bits' middles. */
function drawArrow(a, b) {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
  const y = Math.max(a.y, b.y) + 0.03, w = 0.05, head = 0.16, t0 = Math.min(0.3, len * 0.25), t1 = len - t0, tn = t1 - 0.3;
  const at = (t, side) => [a.x + ux * t - uz * side, y, a.z + uz * t + ux * side];
  arrow.geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    ...at(t0, w), ...at(t0, -w), ...at(tn, w), ...at(tn, w), ...at(t0, -w), ...at(tn, -w),
    ...at(tn, head), ...at(tn, -head), ...at(t1, 0)], 3));
}

// ---- the crayon and the area it draws ----
/** { pts: [{x, z}], origin: {x, z} }: bits inside the outline are the program; origin is where the crayon touched down. */
let area = null;
let stroke = null;       // points of the line being drawn right now
let crayonMode = false;
const wax = new THREE.MeshStandardMaterial({ color: CRAYON, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const outline = new THREE.Mesh(new THREE.BufferGeometry(), wax);
outline.frustumCulled = false;
const originDot = new THREE.Mesh(new THREE.CircleGeometry(0.24, 24).rotateX(-Math.PI / 2), wax);
originDot.visible = false;
scene.add(outline, originDot);

const crayon = new THREE.Group(); // the tip is at the group's origin
const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.3, 16).translate(0, 0.95, 0), new THREE.MeshStandardMaterial({ color: CRAYON, roughness: 0.6 }));
const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 16).rotateX(Math.PI).translate(0, 0.15, 0), stick.material);
const wrapper = new THREE.Mesh(new THREE.CylinderGeometry(0.116, 0.116, 0.8, 16).translate(0, 1.05, 0), new THREE.MeshStandardMaterial({ color: '#f3efe2', roughness: 0.9 }));
crayon.add(stick, tip, wrapper);
crayon.traverse(o => { o.castShadow = true; });
crayon.rotation.set(0.45, 0, -0.5);
crayon.visible = false;
scene.add(crayon);

/** Lays a flat ribbon along `pts`, joined back to the start if `closed`. */
function drawOutline(pts, closed) {
  const line = closed ? [...pts, pts[0]] : pts, pos = [], half = 0.085, y = 0.006;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i], b = line[i + 1], len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len * half, nz = (b.x - a.x) / len * half;
    // Overshoot each piece a little so the joints have no gaps.
    const ex = (b.x - a.x) / len * half * 0.6, ez = (b.z - a.z) / len * half * 0.6;
    pos.push(a.x - ex + nx, y, a.z - ez + nz, a.x - ex - nx, y, a.z - ez - nz, b.x + ex + nx, y, b.z + ez + nz,
             b.x + ex + nx, y, b.z + ez + nz, a.x - ex - nx, y, a.z - ez - nz, b.x + ex - nx, y, b.z + ez - nz);
  }
  outline.geometry.dispose();
  outline.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  outline.geometry.computeVertexNormals();
  originDot.visible = pts.length > 0;
  if (pts.length) originDot.position.set(pts[0].x, 0.007, pts[0].z);
}

function setArea(pts) {
  area = pts ? { pts, origin: pts[0] } : null;
  drawOutline(pts || [], true);
  dirty = true;
}

/** Even-odd test: is world point (x, z) inside the crayon outline? */
function inArea(x, z) {
  if (!area) return false;
  let inside = false;
  const p = area.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i].z > z) !== (p[j].z > z) && x < (p[j].x - p[i].x) * (z - p[i].z) / (p[j].z - p[i].z) + p[i].x) inside = !inside;
  }
  return inside;
}

function setCrayonMode(on) {
  crayonMode = on;
  crayon.visible = false;
  $('crayon').setAttribute('aria-pressed', String(on));
  coach();
}

// ---- bits ----
const bitGeo = new THREE.BoxGeometry(1, THICK, 0.4);
const bitMats = PALETTE.map(([, hex], i) =>
  new THREE.MeshStandardMaterial({ color: hex, roughness: i >= 11 ? 0.3 : 0.55, metalness: i >= 11 ? 0.35 : 0.05 }));
/** state: 'air' (flying) | 'land' (lying on the ground) | 'held' (being dragged) */
let bits = [];
let dirty = true; // the program may have changed: redraw the overlay and the text
let serial = 0;

function addBit(color, x, y, z, state) {
  const mesh = new THREE.Mesh(bitGeo, bitMats[color]);
  mesh.castShadow = true;
  mesh.position.set(x, y, z);
  mesh.rotation.y = Math.random() * Math.PI;
  // slip: how easily the wind slides this bit. Close to 1 for all, so a program drifts as one before it falls apart.
  const bit = { id: serial++, mesh, color, state, vel: new THREE.Vector3(), spin: new THREE.Vector3(), phase: Math.random() * 7, slip: 0.75 + Math.random() * 0.5 };
  mesh.userData.bit = bit;
  scene.add(mesh);
  bits.push(bit);
  return bit;
}

function removeBits(keep) {
  bits.filter(b => !keep(b)).forEach(b => scene.remove(b.mesh));
  bits = bits.filter(keep);
  dirty = true;
}

const touching = (a, b) => (a.mesh.position.x - b.mesh.position.x) ** 2 + (a.mesh.position.z - b.mesh.position.z) ** 2 < FOOTPRINT * FOOTPRINT;

/** Rests `b` on top of whatever landed bits lie under it. */
function settle(b) {
  let y = THICK / 2 + 0.008;
  for (const o of bits) if (o !== b && o.state === 'land' && touching(o, b)) y = Math.max(y, o.mesh.position.y + LAYER);
  b.mesh.position.y = y;
}

/** Re-rests every landed bit, lowest first, after the wind has slid them about. */
function restack() {
  const land = bits.filter(b => b.state === 'land').sort((a, b) => a.mesh.position.y - b.mesh.position.y || a.id - b.id);
  land.forEach((b, i) => {
    let y = THICK / 2 + 0.008;
    for (let j = 0; j < i; j++) if (touching(land[j], b)) y = Math.max(y, land[j].mesh.position.y + LAYER);
    b.mesh.position.y = y;
  });
}

function launch(b, vx, vy, vz) {
  b.state = 'air';
  b.vel.set(vx, vy, vz);
  b.spin.set(Math.random() * 14 - 7, Math.random() * 14 - 7, Math.random() * 14 - 7);
  dirty = true;
}

function fire() {
  const { pos, dir } = world.muzzle;
  sound.fire();
  burst();
  for (let i = 0; i < 40; i++) {
    const b = addBit(Math.floor(Math.random() * PALETTE.length), pos.x, pos.y, pos.z, 'air');
    // Up the barrel, plus a sideways scatter wide enough that the burst lands as a spread, not a heap.
    const speed = 10 + Math.random() * 7, a = Math.random() * Math.PI * 2, out = 1 + Math.random() * 10;
    launch(b, dir.x * speed + Math.cos(a) * out, dir.y * speed + Math.random() * 2, dir.z * speed + Math.sin(a) * out);
  }
  // ponytail: one mesh per bit. Past this many, drop the oldest litter; use an InstancedMesh if more are wanted.
  const extra = bits.length - 1200;
  if (extra > 0) {
    const old = new Set(bits.filter(b => b.state === 'land' && !inArea(b.mesh.position.x, b.mesh.position.z)).slice(0, extra));
    removeBits(b => !old.has(b));
  }
}

/** The program: landed bits inside the outline, bottom of the pile first. File order is stacking order. */
const program = () => bits
  .filter(b => b.state === 'land' && inArea(b.mesh.position.x, b.mesh.position.z))
  .sort((a, b) => a.mesh.position.y - b.mesh.position.y || a.id - b.id);
const kx = b => Math.round((b.mesh.position.x - area.origin.x) * UNIT);
const ky = b => Math.round(-(b.mesh.position.z - area.origin.z) * UNIT);
const toKft = list => list.map(b => `${PALETTE[b.color][0]} ${kx(b)} ${ky(b)}`).join('\n') + (list.length ? '\n' : '');

// ---- wind ----
let wind = null; // { x, z, speed }: the real wind, one world unit per second per m/s
const CALM = { x: 0, z: 0 };
/** Gusts: 0 in a lull, up to about 1.6. Only gusts are strong enough to move confetti that has landed. */
const gustAt = t => Math.max(0, Math.sin(t * 0.7) + Math.sin(t * 1.9 + 1) - 0.4);
/** The wind in the air at time t: the real wind, a little under in a lull and over in a gust. */
function windAt(t) {
  if (!wind) return CALM;
  const k = 0.9 + 0.4 * gustAt(t);
  return { x: wind.x * k, z: wind.z * k };
}

async function fetchWind() {
  try {
    const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { timeout: 8000 }));
    // One decimal (about 10 km) is plenty for weather and keeps the location vague.
    const q = `latitude=${pos.coords.latitude.toFixed(1)}&longitude=${pos.coords.longitude.toFixed(1)}`;
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`);
    const cur = (await res.json()).current;
    if (!Number.isFinite(cur.wind_speed_10m) || !Number.isFinite(cur.wind_direction_10m)) throw new Error('no wind data');
    return { real: cur.wind_speed_10m, dir: cur.wind_direction_10m, known: true };
  } catch {
    return { real: 3 + Math.random() * 7, dir: Math.random() * 360, known: false };
  }
}

let windAsked = 0; // counts presses, so a slow weather answer cannot switch on a wind that was switched off again
async function toggleWind() {
  const ask = ++windAsked;
  if (wind || $('wind').getAttribute('aria-pressed') === 'true') {
    wind = null;
    $('wind').setAttribute('aria-pressed', 'false');
    $('windinfo').textContent = '';
    return;
  }
  $('wind').setAttribute('aria-pressed', 'true');
  $('windinfo').textContent = 'asking the weather…';
  const w = await fetchWind();
  if (ask !== windAsked) return;
  // Weather reports where wind comes from, clockwise from north. North is language +y, world -z.
  const r = w.dir * Math.PI / 180;
  wind = { speed: w.real, x: -Math.sin(r) * w.real, z: Math.cos(r) * w.real };
  $('windinfo').textContent = `${w.real.toFixed(1)} m/s from ${Math.round(w.dir)}°${w.known ? '' : ' (made up: no location)'}`;
}

// ---- physics ----
let restackAt = 0;

function physics(dt, t) {
  const air = windAt(t);
  // Landed bits hold still in a lull and creep along the ground in a gust. They never take off again.
  const creep = wind ? 0.03 * gustAt(t) * dt : 0;
  let slid = false;
  for (const b of bits) {
    const p = b.mesh.position;
    if (b.state === 'air') {
      b.vel.x += ((air.x - b.vel.x) * 1.5 + Math.sin(t * 7 + b.phase) * 2.5) * dt;
      b.vel.z += ((air.z - b.vel.z) * 1.5 + Math.cos(t * 6 + b.phase) * 2.5) * dt;
      b.vel.y -= (6 + b.vel.y * 1.5) * dt;
      p.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
      if (p.y <= THICK && b.vel.y < 0) {
        b.mesh.rotation.set(0, b.mesh.rotation.y, 0);
        b.state = 'land';
        settle(b);
        sound.land();
        dirty = true;
      }
    } else if (b.state === 'land' && creep) {
      p.x += wind.x * creep * b.slip;
      p.z += wind.z * creep * b.slip;
      slid = true;
    }
  }
  if (slid) {
    dirty = true;
    // Bits that slid over or off each other need new heights; often enough that none pass through another.
    if (Math.abs(t - restackAt) > 0.3) {
      restackAt = t;
      restack();
    }
  }
  // Whatever blows far off into the meadow is gone.
  if (bits.some(b => Math.abs(b.mesh.position.x) > 250 || Math.abs(b.mesh.position.z) > 250)) {
    removeBits(b => Math.abs(b.mesh.position.x) <= 250 && Math.abs(b.mesh.position.z) <= 250);
  }
}

// ---- overlay and program text ----
/** What refresh() last worked out: the program's bits, which of them are uncovered, and the start bit's index. */
let view = { list: [], live: [], first: -1 };

function refresh() {
  dirty = false;
  const list = area ? program() : [];
  const xs = list.map(kx), ys = list.map(ky);
  const near = (i, j) => (xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2;
  // Same rules as the runtime: a bit under a later one is covered, and covered bits link to nothing.
  const live = list.map((_, i) => !list.some((_, j) => j > i && near(i, j) < MIN_GAP * MIN_GAP));
  const pts = [];
  let first = -1;
  for (let i = 0; i < list.length; i++) {
    if (!live[i]) continue;
    if (first < 0 || xs[i] ** 2 + ys[i] ** 2 < xs[first] ** 2 + ys[first] ** 2) first = i;
    for (let j = i + 1; j < list.length; j++) {
      if (live[j] && near(i, j) <= REACH * REACH) {
        const a = list[i].mesh.position, b = list[j].mesh.position;
        pts.push(a.x, a.y + 0.02, a.z, b.x, b.y + 0.02, b.z);
      }
    }
  }
  links.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  startRing.visible = first >= 0;
  if (first >= 0) startRing.position.copy(list[first].mesh.position).y += 0.015;
  view = { list, live, first };
  $('kft').placeholder = area ? 'No confetti inside the crayon outline yet.' : 'Draw an outline with the crayon. The confetti inside it is the program.';
  if (document.activeElement !== $('kft')) $('kft').value = toKft(list);
  coach();
  // A paused debug run that has not taken a step yet follows the confetti as it is rearranged.
  if (debugOn && area && (!run || (!run.fast && !run.n && !run.playing && run.src !== toKft(list)))) start(false, false, true);
  if (debugOn) drawDebug();
}

// ---- the hint: what to do next, and what just happened ----
let saidUntil = 0;
function coach() {
  if (performance.now() < saidUntil) return;
  const n = view.list.length;
  $('hint').textContent =
    crayonMode ? 'Draw a loop on the stones. The spot where the crayon touches down is the program’s origin.'
    : !bits.length ? 'Start here: fire the cannon! (Space)'
    : !area ? 'Next: pick the crayon (C) and draw a loop around some confetti. What is inside becomes the program.'
    : !n ? 'Nothing inside the loop yet. Drag confetti in, or fire again.'
    : debugOn ? `${n} bits in the program. Step (N) runs one bit; Play (P) runs them one after another.`
    : `${n} bit${n > 1 ? 's' : ''} in the program. Press Run, or turn on Debug (D) to step through it.`;
}
/** Shows `text` in the hint for a few seconds, then the hint goes back to coaching. */
function say(text) {
  $('hint').textContent = text;
  saidUntil = performance.now() + 3500;
  setTimeout(coach, 3600);
}

// ---- pointer: draw with the crayon, or pick up and put down bits ----
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let held = null;
let owner = null; // the pointer that holds a bit or draws the outline; other fingers leave both alone
// The glove that stands in for the mouse pointer. Fingers have no hover, so touch gets no glove.
const hand = createHand();
hand.group.scale.setScalar(0.85);
hand.group.visible = false;
scene.add(hand.group);
let handAt = null; // the ground point under the pointer, or null when it is off the canvas
canvas.addEventListener('pointerleave', () => { handAt = null; });
let crayonAt = null; // { x, z, time } of the last crayon move, for the speed of the scratch

function groundAt(e) {
  const r = canvas.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  return ray.ray.intersectPlane(floor, new THREE.Vector3());
}
function bitAt(e) {
  groundAt(e);
  const hit = ray.intersectObjects(bits.filter(b => b.state === 'land').map(b => b.mesh))[0];
  return hit && hit.object.userData.bit;
}

// Capture phase: this must run before OrbitControls sees the event, so a grab or a stroke doesn't also orbit.
canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || owner !== null) return;
  if (crayonMode) {
    const p = groundAt(e);
    if (!p) return;
    stroke = [{ x: p.x, z: p.z }];
    crayonAt = { x: p.x, z: p.z, time: e.timeStamp };
    setArea(null);
  } else {
    held = bitAt(e);
    if (!held) return;
    held.state = 'held';
    held.mesh.position.y += 0.35;
    sound.pickUp();
    dirty = true;
  }
  owner = e.pointerId;
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
}, { capture: true });

canvas.addEventListener('pointermove', e => {
  handAt = e.pointerType === 'touch' ? null : groundAt(e);
  if (debugOn && !crayonMode && !held && !e.buttons) explain(bitAt(e));
  if (owner !== null && e.pointerId !== owner) return;
  const p = (crayonMode || held) && groundAt(e);
  if (!p) return;
  if (crayonMode) {
    crayon.visible = true;
    crayon.position.set(p.x, 0, p.z);
    const last = stroke && stroke[stroke.length - 1];
    if (last) {
      const secs = Math.max((e.timeStamp - crayonAt.time) / 1000, 0.001);
      sound.crayon(true, Math.hypot(p.x - crayonAt.x, p.z - crayonAt.z) / secs);
      crayonAt = { x: p.x, z: p.z, time: e.timeStamp };
    }
    if (last && Math.hypot(p.x - last.x, p.z - last.z) > 0.12) {
      stroke.push({ x: p.x, z: p.z });
      drawOutline(stroke, false);
    }
  } else {
    held.mesh.position.set(p.x, held.mesh.position.y, p.z);
  }
});

function release(e) {
  if (e.pointerId !== owner) return;
  owner = null;
  controls.enabled = true;
  if (stroke) {
    sound.crayon(false);
    // The outline closes itself: the end joins back to where the crayon touched down.
    let twiceArea = 0;
    stroke.forEach((p, i) => { const q = stroke[(i + 1) % stroke.length]; twiceArea += p.x * q.z - q.x * p.z; });
    const closed = Math.abs(twiceArea) > 1; // a dot or a scribble with nothing inside is no area
    setArea(closed ? stroke : null);
    if (closed) sound.outlineClosed();
    stroke = null;
    setCrayonMode(false);
  }
  if (held) {
    held.state = 'land';
    settle(held); // on top of whatever is there, covering it
    held = null;
    sound.drop();
    dirty = true;
  }
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

canvas.addEventListener('dblclick', e => {
  const b = !crayonMode && bitAt(e);
  if (!b) return;
  launch(b, Math.random() * 6 - 3, 7, Math.random() * 6 - 3);
  sound.flick();
});

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 3);
controls.maxPolarAngle = Math.PI / 2 - 0.06;
controls.minDistance = 2;
controls.maxDistance = 130;
controls.enableDamping = true;

// ---- running ----
// A slow run keeps the runtime one step ahead of what is shown. That is how the editor knows, without
// repeating the runtime's walking rules, where the current bit will send the walk before it has "run".
/**
 * { fast, list, src, pts, origin, playing, budget, n, prev, shown, pending, halted }
 * list: the bits, a snapshot; pts: their language coordinates at the start; n: steps shown so far;
 * prev: index of the bit shown last; shown: the machine as displayed; pending: the step taken ahead,
 * { cur, next, before, after }, or null once the program has halted.
 */
let run = null;
let still = null; // what a stopped slow run showed last: the runtime has already gone a step past it
let trace = [];   // the last steps of a slow run, newest first
let debugOn = false;
const TRACE_MAX = 30;

const machine = () => ({ main: kfStack(0), stash: kfStack(1), out: kfBytes().slice() });
/** The machine as the panels show it. */
const onScreen = () => (run && !run.fast ? run.shown : still || machine());

function stop() {
  if (run) still = run.fast ? null : run.shown;
  run = null;
  pointer.visible = false;
  showMachine();
}

/** Loads the program in the outline. `quiet` is for loads nobody asked for, which must not scold. */
function start(fast, playing = true, quiet = false) {
  run = null;
  pointer.visible = false;
  if (!area) {
    if (!quiet) {
      $('output').textContent = 'Nothing to run: draw an outline with the crayon first.';
      sound.error();
      say('Nothing to run yet: draw a loop with the crayon first.');
    }
    return showMachine();
  }
  const list = program(); // a snapshot: the wind may move the confetti, but not this run
  const src = toKft(list);
  if (!kfLoad(src, $('input').value, fast)) {
    $('output').textContent = 'error: ' + kfOutput();
    sound.error();
    return showMachine();
  }
  trace = [];
  run = { fast, list, src, playing, budget: 0, n: 0, prev: -1, halted: false, shown: machine(), pending: null,
          pts: list.map(b => ({ x: kx(b), y: ky(b) })) };
  if (!fast) {
    lookAhead();
    if (!run.pending) finish(quiet);
  }
  showMachine();
}

/** Takes the next step in the runtime and keeps what it did, to be shown when the user gets there. */
function lookAhead() {
  const cur = kf.kf_cur();
  if (cur < 0) return void (run.pending = null);
  const before = run.pending ? run.pending.after : run.shown;
  kf.kf_run(1);
  run.pending = { cur, next: kf.kf_cur(), before, after: machine() };
}

/** Which way the walk bends at bit `at` on its way to bit `to`, having come from the bit shown before. */
const bend = (at, to) => turn(run.prev < 0 ? { x: 0, y: 0 } : run.pts[run.prev], run.pts[at], run.pts[to]);

/** Shows the step that was taken ahead: one bit runs, as far as the user can tell. False once halted. */
function stepOnce() {
  if (!run || run.fast || !run.pending) return false;
  const { cur, next, before, after } = run.pending, bit = run.list[cur], [name, hex, op] = PALETTE[bit.color];
  const went = next < 0 ? 'dead end: the program stops'
    : `${TURN_WORDS[bend(cur, next)]} to #${next} ${PALETTE[run.list[next].color][0]}`;
  trace.unshift({ n: ++run.n, bit: cur, name, hex, op, text: `${describe(bit.color, before, after)}, ${went}` });
  trace.length = Math.min(trace.length, TRACE_MAX);
  run.shown = after;
  sound.step(bit.color);
  if (after.out.length > before.out.length) sound.output();
  lookAhead();
  run.prev = cur;
  if (!run.pending) finish();
  return true;
}

function finish(quiet) {
  run.halted = true;
  run.playing = false;
  pointer.visible = false;
  if (quiet) return;
  sound.halt();
  say(run.fast ? 'The program halted.' : run.n ? `The program halted after ${run.n} step${run.n > 1 ? 's' : ''}.` : 'There is nothing in the loop to run.');
}

function showMachine() {
  const m = onScreen();
  // Only the last 64 KB, far more than the box shows: a program that prints without end must not slow every frame.
  if (run) $('output').textContent = (m.out.length > 1 << 16 ? '…' : '') + dec.decode(m.out.subarray(-(1 << 16)));
  drawStacks($('stacks'), m.main, m.stash);
  if (debugOn) drawDebug();
}

function runFrame(dt, t) {
  if (!run || run.halted) return;
  if (run.fast) {
    // As many steps as fit in most of a frame, so the page stays responsive.
    let halted = false;
    for (const end = performance.now() + 12; !halted && performance.now() < end;) halted = kf.kf_run(1_000_000) === 1;
    if (halted) finish();
    showMachine();
    return;
  }
  if (run.playing) {
    run.budget += dt * Number($('dspeed').value);
    let stepped = false;
    for (; run.budget >= 1 && stepOnce(); run.budget--) stepped = true;
    if (stepped) showMachine();
  }
  pointer.visible = !!run.pending;
  if (run.pending) {
    const p = run.list[run.pending.cur].mesh.position;
    pointer.position.set(p.x, p.y + 0.6 + Math.sin(t * 6) * 0.08, p.z);
  }
}

// ---- debug mode ----
const labels = makeLabels($('labels'));

function setDebug(on) {
  debugOn = on;
  $('debug').setAttribute('aria-pressed', String(on));
  $('dock').hidden = !on;
  document.body.classList.toggle('debugging', on);
  if (on) {
    if (!run || run.halted) start(false, false, true); // paused on the first bit, ready to step
  } else {
    if (run && !run.playing) stop();
    nextRing.visible = arrow.visible = false;
    labels.draw([]);
  }
  coach();
  drawDebug();
  resize();
}

/** The dock: buttons, status, trace and stacks. Called whenever the machine or the program changes. */
function drawDebug() {
  if (!debugOn) return;
  const slow = run && !run.fast, m = onScreen();
  drawStacks($('dstacks'), m.main, m.stash);
  drawTrace($('trace'), slow ? trace : [], run && run.fast ? 'Run fast does not keep a trace. Use Step or Play.'
    : !area ? 'Draw a loop with the crayon: the confetti inside it is the program.'
    : 'No steps yet. Press Step to run the first bit.');
  $('dplay').setAttribute('aria-pressed', String(!!(run && run.playing)));
  const p = slow && run.pending;
  $('dstatus').textContent = !run ? '' : run.fast ? (run.halted ? 'halted' : 'running fast')
    : run.halted ? `halted after ${run.n} step${run.n === 1 ? '' : 's'}`
    : `${run.playing ? 'playing' : 'paused'} · step ${run.n + 1}: #${p.cur} ${PALETTE[run.list[p.cur].color][2]} is next to run`
      + (run.src === $('kft').value || document.activeElement === $('kft') ? '' : ' · the confetti has moved since: Restart to debug it as it lies now');
  // The arrow and the ring on the ground.
  nextRing.visible = arrow.visible = !!p && p.next >= 0;
  if (p && p.next >= 0) {
    const a = run.list[p.cur].mesh.position, b = run.list[p.next].mesh.position;
    nextRing.position.copy(b).y += 0.02;
    drawArrow(a, b);
  }
}

function explain(bit) {
  if (!bit) return void ($('dexplain').textContent = 'Point at a bit to see what it does.');
  const [name, , op] = PALETTE[bit.color], i = view.list.indexOf(bit);
  $('dexplain').textContent = `${name} ${op}${i < 0 ? ' (outside the loop, not in the program)' : ` #${i}${view.live[i] ? '' : ' (covered, so ignored)'}`}: ${EXPLAIN[bit.color]}`;
}

/** Floating names over the program's bits. Called every frame: the camera moves. */
const corner = new THREE.Vector3();
function drawLabels() {
  const items = [], zoom = innerHeight / 2 / Math.tan(camera.fov * Math.PI / 360);
  const put = (pos, html, cls, always) => {
    corner.copy(pos).project(camera);
    if (corner.z > 1 || Math.abs(corner.x) > 1.05 || Math.abs(corner.y) > 1.05) return;
    // Screen pixels per bit length here. Names need room: far away they shrink to numbers, then go.
    const size = zoom / camera.position.distanceTo(pos);
    const full = always || size > 46, alpha = always ? 1 : Math.min(1, (size - 14) / 8);
    if (alpha <= 0) return;
    items.push({ x: (corner.x + 1) / 2 * innerWidth, y: (1 - corner.y) / 2 * innerHeight, html: html(full), cls: `${cls}${full ? '' : ' tiny'}`, alpha });
  };
  const p = run && !run.fast && run.pending;
  const now = p && run.list[p.cur], next = p && p.next >= 0 && run.list[p.next];
  // ponytail: one DOM label per bit, capped. Past a few hundred bits, draw them into one canvas instead.
  view.list.slice(0, 300).forEach((b, i) => {
    const op = PALETTE[b.color][2];
    if (!view.live[i]) return put(b.mesh.position, full => (full ? `<small>${i}</small> <s>${op}</s> covered` : `<s>${i}</s>`), 'covered below', false);
    put(b.mesh.position, full => (full ? `${b === now ? '<em>NOW</em>' : ''}<small>${i}</small> ${op}` : String(i)), b === now ? 'now' : '', b === now || b === next);
    // Start and next go under the bit, so a row of neighbours' names stays readable.
    const under = [i === view.first && 'START', b === next && `NEXT ${TURN_ARROW[bend(p.cur, p.next)]}`].filter(Boolean).join(' · ');
    if (under) put(b.mesh.position, () => under, b === next ? 'next below' : 'start below', true);
  });
  if (area) put(originDot.position, () => 'origin (0, 0)', 'origin below', true);
  labels.draw(items);
}

// ---- loading text ----
function loadText(text) {
  stop(); // checking the text replaces the program in the runtime, so no run can go on
  if (!kfLoad(text, '', true)) {
    $('output').textContent = 'error: ' + kfOutput();
    sound.error();
    say('That text is not a program. The output box says why.');
    return showMachine();
  }
  const rows = text.split('\n').map(line => line.split('#')[0].trim().split(/\s+/)).filter(r => r[0])
    .map(([name, x, y]) => ({ color: PALETTE.findIndex(p => p[0] === name), x: x / UNIT, z: -y / UNIT }));
  stop();
  removeBits(() => false);
  // Lay the program out in front of the cannon, clear of where its bursts come down.
  const box = { x0: 0, x1: 0, z0: 0, z1: 0 }; // around the bits and the origin, origin-relative
  for (const r of rows) {
    box.x0 = Math.min(box.x0, r.x); box.x1 = Math.max(box.x1, r.x);
    box.z0 = Math.min(box.z0, r.z); box.z1 = Math.max(box.z1, r.z);
  }
  const pad = 1.3, ox = -(box.x0 + box.x1) / 2, oz = 12 + pad - box.z0;
  for (const r of rows) {
    const b = addBit(r.color, ox + r.x, 0, oz + r.z, 'land');
    b.mesh.rotation.y = 0;
    settle(b); // in file order, so later bits land on top of earlier ones
  }
  // A crayon outline as if drawn by hand: touch down on the origin, out to the nearest side, once around.
  const x0 = ox + box.x0 - pad, x1 = ox + box.x1 + pad, z0 = oz + box.z0 - pad, z1 = oz + box.z1 + pad;
  const exits = [[x0, oz, 0], [x1, oz, 2], [ox, z0, 1], [ox, z1, 3]]; // where a straight line from the origin meets each side
  const [ex, ez, side] = exits.reduce((m, c) => (Math.hypot(c[0] - ox, c[1] - oz) < Math.hypot(m[0] - ox, m[1] - oz) ? c : m));
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; // sides: 0 = left (corner 3 to 0), 1 = far, 2 = right, 3 = near
  const path = [[ox, oz], [ex, ez]];
  for (let i = 0; i < 4; i++) path.push(corners[(side + i) % 4]);
  path.push([ex, ez]);
  const pts = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1], steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.35));
    for (let s = 0; s < steps; s++) {
      const wobble = i === 0 && s === 0 ? 0 : 0.035; // the first point is the origin, exactly
      pts.push({ x: ax + (bx - ax) * s / steps + (Math.random() - 0.5) * wobble, z: az + (bz - az) * s / steps + (Math.random() - 0.5) * wobble });
    }
  }
  pts.push({ x: ex, z: ez });
  setArea(pts);
  $('output').textContent = '';
  $('kft').blur();
  // Look at it.
  const d = Math.max(x1 - x0, z1 - z0) * 0.62 + 6;
  controls.target.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  camera.position.set((x0 + x1) / 2, d, (z0 + z1) / 2 + d);
  say(`Loaded ${rows.length} bits. Press Run!`);
}

// ---- panel ----
const THEMES = ['toybox', 'craft', 'arcade'];
function setTheme(name) {
  if (!THEMES.includes(name)) name = THEMES[0];
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem('konfetti.theme', name); } catch {}
  for (const b of $('themes').children) b.setAttribute('aria-pressed', String(b.dataset.theme === name));
}
$('themes').innerHTML = THEMES.map(t => `<button class="small" data-theme="${t}">${t}</button>`).join('');
$('themes').onclick = e => { if (e.target.dataset.theme) setTheme(e.target.dataset.theme); };
setTheme(document.documentElement.dataset.theme);

function setMuted(on) {
  sound.setMuted(on);
  $('mute').setAttribute('aria-pressed', String(sound.muted));
  $('muteicon').textContent = sound.muted ? '🔇' : '🔊';
}
setMuted(sound.muted);

/** A puff of paper confetti out of the logo. Decoration only, so it is skipped for people who asked for less motion. */
function burst() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < 16; i++) {
    const s = document.createElement('i'), a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 60;
    s.style.cssText = `background:${PALETTE[Math.floor(Math.random() * 8)][1]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d * 0.6 - 20}px;--rot:${Math.random() * 720 - 360}deg`;
    s.onanimationend = () => s.remove();
    $('burst').append(s);
  }
}
$('logo').innerHTML = [...'konfetti'].map((ch, i) => `<span style="--c:${PALETTE[[0, 1, 3, 5, 6, 7, 4, 12][i]][1]};--i:${i}">${ch}</span>`).join('');
$('logo').onclick = burst;

$('fire').onclick = fire;
$('crayon').onclick = () => setCrayonMode(!crayonMode);
$('wind').onclick = toggleWind;
$('mute').onclick = () => setMuted(!sound.muted);
$('debug').onclick = () => setDebug(!debugOn);
$('sweep').onclick = () => {
  const before = bits.length;
  removeBits(b => b.state !== 'land' || inArea(b.mesh.position.x, b.mesh.position.z));
  say(before > bits.length ? `Swept away ${before - bits.length} bits of litter.` : 'Nothing to sweep.');
};
$('clear').onclick = () => { stop(); removeBits(() => false); setArea(null); $('output').textContent = ''; say('All clear. Fire the cannon! (Space)'); };
$('run').onclick = () => start(false);
$('fast').onclick = () => start(true);
$('stop').onclick = stop;
$('load').onclick = () => loadText($('kft').value);
$('examples').onchange = async e => {
  const name = e.target.value;
  e.target.value = '';
  if (name) loadText(await (await fetch(`../examples/${name}.kft`)).text());
};

const step = () => { if (!run || run.fast || run.halted) start(false, false); else { run.playing = false; stepOnce(); } showMachine(); };
const playPause = () => { if (!run || run.fast || run.halted) start(false, true); else run.playing = !run.playing; showMachine(); };
const restart = () => start(false, false);
$('dstep').onclick = step;
$('dplay').onclick = playPause;
$('drestart').onclick = restart;
$('dspeed').oninput = () => { $('dspeedv').textContent = `${$('dspeed').value} a second`; };

// Browsers only let a page make sound after the user has touched it; any touch or key will do.
addEventListener('pointerdown', () => sound.unlock(), { capture: true });
addEventListener('keydown', () => sound.unlock(), { capture: true });
document.addEventListener('click', e => {
  if (e.target.closest('button:not(#fire)')) sound.ui();
  // A mouse click leaves focus on the control, and Space would press it again instead of firing.
  // A press from the keyboard (detail 0) keeps focus where the user put it.
  if (e.detail) e.target.closest('button, summary')?.blur();
});

addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  // Typing in a field is typing, not a shortcut. The speed slider takes no letters, so it does not count.
  if (e.ctrlKey || e.metaKey || e.altKey || document.activeElement.matches('input:not([type=range]), textarea, select')) return;
  if (e.code === 'Space') {
    if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A') return; // space presses the focused control
    e.preventDefault();
    fire();
  }
  const keys = { KeyC: () => setCrayonMode(!crayonMode), KeyW: toggleWind, KeyM: () => setMuted(!sound.muted), KeyD: () => setDebug(!debugOn) };
  const debugKeys = { KeyN: step, KeyP: playPause, KeyR: restart };
  const act = keys[e.code] || (debugOn && debugKeys[e.code]);
  if (act) act();
});
$('legend').innerHTML = PALETTE.map(([name, hex, op], i) =>
  `<li title="${name} ${op} ${EXPLAIN[i]}"><i style="background:${hex}"></i><span>${name}</span><b>${op}</b></li>`).join('');

// ---- main loop ----
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  // Shift the view past what covers it, so the scene's middle stays in sight: on a wide screen the debugger's
  // dock at the bottom; on a phone the panel at the bottom and, while debugging, the dock at the top.
  const h = id => $(id).offsetHeight;
  const lift = innerWidth > 700 ? (debugOn ? h('dock') / 2 : 0) : (h('panel') - (debugOn ? h('dock') : 0)) / 2;
  if (lift) camera.setViewOffset(innerWidth, innerHeight, 0, lift, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let windHeard = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  physics(dt, t);
  runFrame(dt, t);
  if (dirty) refresh();
  const air = windAt(t), strength = Math.hypot(air.x, air.z);
  world.update(dt, t, air);
  // The wind sound follows the gusts; only told when it has changed enough to hear.
  if (Math.abs(strength - windHeard) > 0.25 || (!strength && windHeard)) sound.setWind(windHeard = strength);
  controls.update();
  hand.group.visible = !!handAt && !crayonMode;
  // The glove is the pointer over the ground and the crayon draws with a crosshair; over the sky there
  // is no glove, so the system pointer comes back.
  canvas.style.cursor = crayonMode ? 'crosshair' : hand.group.visible ? 'none' : '';
  if (hand.group.visible) {
    // Hover just above the ground; while holding, the pinch sits on the bit it carries.
    const at = held ? held.mesh.position : handAt;
    hand.group.position.set(at.x, held ? at.y + 0.02 : 0.22, at.z);
    hand.group.rotation.y = Math.atan2(camera.position.x - at.x, camera.position.z - at.z); // back of the hand to the viewer
    hand.setGrab(!!held);
    hand.update(dt, t);
  }
  if (debugOn) drawLabels();
  renderer.render(scene, camera);
});

// For tests and the curious: poke at the editor from the console.
window.konfetti = {
  camera, controls, bits: () => bits, area: () => area, program, physics, sound,
  wind: () => wind, theme: () => document.documentElement.dataset.theme, setTheme, setDebug,
  /** What the debugger shows: stacks top last, trace newest first as plain lines, labels as their texts. */
  debug: () => ({
    on: debugOn, running: !!run, fast: !!(run && run.fast), playing: !!(run && run.playing), halted: !!(run && run.halted),
    steps: run ? run.n : 0, cur: run && run.pending ? run.pending.cur : -1, next: run && run.pending ? run.pending.next : -1,
    main: onScreen().main, stash: onScreen().stash,
    output: $('output').textContent,
    trace: trace.map(s => `${s.n}  ${s.name} ${s.op}  #${s.bit}  ${s.text}`),
    labels: [...$('labels').children].filter(e => !e.hidden).map(e => e.textContent),
  }),
};

showMachine();
fire();
