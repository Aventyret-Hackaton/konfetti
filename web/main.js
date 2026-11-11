// konfetti editor: fire confetti, draw an area with the crayon, and whatever lies inside is the program.
// World units: 1 = one bit length = 1000 language units. The language origin is where the crayon
// first touched down; language (x, y) = world (x - origin.x, -(z - origin.z)). Seen from above,
// +y is away from the default camera and left turns are counter-clockwise.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld } from './world.js';

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
const WINDINESS = 1.8;          // world wind per m/s of real wind. Turn up for more chaos
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
  return kf.kf_load(s.length, fold ? 1 : 0) === 0;
}
// Views are rebuilt on every read: the wasm memory can move when it grows.
const kfOutput = () => dec.decode(new Uint8Array(kf.memory.buffer, kf.kf_out(), kf.kf_out_len()));
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
startRing.visible = pointer.visible = false;
scene.add(links, startRing, pointer);

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
  canvas.style.cursor = on ? 'crosshair' : '';
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
  const bit = { id: serial++, mesh, color, state, vel: new THREE.Vector3(), spin: new THREE.Vector3(), phase: Math.random() * 7, slip: 0.5 + Math.random() };
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
let wind = null; // { x, z, speed } in world units per second, plus what the weather said, for the label
const BREEZE = { x: 1.1, z: 0.5 }; // with the wind off, the grass still stirs; bits do not
/** Gusts: the wind's strength over time, as a factor around 1. */
const gustAt = t => 1 + 0.55 * Math.sin(t * 0.6) + 0.35 * Math.sin(t * 1.7 + 2);

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

$('wind').onclick = async () => {
  if (wind) {
    wind = null;
    $('wind').setAttribute('aria-pressed', 'false');
    $('windinfo').textContent = '';
    return;
  }
  $('windinfo').textContent = 'asking the weather…';
  const w = await fetchWind();
  // Even a calm day gets a stiff breeze: a windless wind button would be no fun.
  const speed = Math.min(Math.max(w.real * WINDINESS, 5), 24);
  // Weather reports where wind comes from, clockwise from north. North is language +y, world -z.
  const r = w.dir * Math.PI / 180;
  wind = { speed, x: -Math.sin(r) * speed, z: Math.cos(r) * speed };
  $('wind').setAttribute('aria-pressed', 'true');
  $('windinfo').textContent = `${w.real.toFixed(1)} m/s from ${Math.round(w.dir)}°${w.known ? '' : ' (made up: no location)'}`;
};

// ---- physics ----
let restackAt = 0;

function physics(dt, t) {
  const gust = wind ? gustAt(t) : 0;
  const wx = wind ? wind.x * gust : 0, wz = wind ? wind.z * gust : 0;
  // Landed bits hold still in a lull, skitter along once the gust picks up, and the strongest gusts lift them.
  const shove = Math.max(0, gust - 0.7), liftOdds = wind ? 0.02 * Math.max(0, gust - 1) * wind.speed * dt : 0;
  let slid = false;
  for (const b of bits) {
    const p = b.mesh.position;
    if (b.state === 'air') {
      b.vel.x += ((wx - b.vel.x) * 1.5 + Math.sin(t * 7 + b.phase) * 2.5) * dt;
      b.vel.z += ((wz - b.vel.z) * 1.5 + Math.cos(t * 6 + b.phase) * 2.5) * dt;
      b.vel.y -= (6 + b.vel.y * 1.5) * dt;
      p.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
      if (p.y <= THICK && b.vel.y < 0) {
        b.mesh.rotation.set(0, b.mesh.rotation.y, 0);
        b.state = 'land';
        settle(b);
        dirty = true;
      }
    } else if (b.state === 'land' && shove) {
      if (Math.random() < liftOdds) {
        launch(b, wx * 0.5, 2 + Math.random() * 3, wz * 0.5);
        continue;
      }
      const k = 0.12 * shove * b.slip * dt;
      p.x += wind.x * k;
      p.z += wind.z * k;
      slid = true;
    }
  }
  if (slid) {
    dirty = true;
    if (t > restackAt) {
      restackAt = t + 0.3;
      restack();
    }
  }
  // Whatever blows far off into the meadow is gone.
  if (bits.some(b => Math.abs(b.mesh.position.x) > 250 || Math.abs(b.mesh.position.z) > 250)) {
    removeBits(b => Math.abs(b.mesh.position.x) <= 250 && Math.abs(b.mesh.position.z) <= 250);
  }
}

// ---- overlay and program text ----
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
  $('kft').placeholder = area ? 'No confetti inside the crayon outline yet.' : 'Draw an outline with the crayon. The confetti inside it is the program.';
  if (document.activeElement !== $('kft')) $('kft').value = toKft(list);
}

// ---- pointer: draw with the crayon, or pick up and put down bits ----
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let held = null;

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
  if (e.button !== 0) return;
  if (crayonMode) {
    const p = groundAt(e);
    if (!p) return;
    stroke = [{ x: p.x, z: p.z }];
    setArea(null);
  } else {
    held = bitAt(e);
    if (!held) return;
    held.state = 'held';
    held.mesh.position.y += 0.35;
    dirty = true;
  }
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
}, { capture: true });

canvas.addEventListener('pointermove', e => {
  const p = (crayonMode || held) && groundAt(e);
  if (!p) return;
  if (crayonMode) {
    crayon.visible = true;
    crayon.position.set(p.x, 0, p.z);
    const last = stroke && stroke[stroke.length - 1];
    if (last && Math.hypot(p.x - last.x, p.z - last.z) > 0.12) {
      stroke.push({ x: p.x, z: p.z });
      drawOutline(stroke, false);
    }
  } else {
    held.mesh.position.set(p.x, held.mesh.position.y, p.z);
  }
});

function release() {
  controls.enabled = true;
  if (stroke) {
    // The outline closes itself: the end joins back to where the crayon touched down.
    let twiceArea = 0;
    stroke.forEach((p, i) => { const q = stroke[(i + 1) % stroke.length]; twiceArea += p.x * q.z - q.x * p.z; });
    setArea(Math.abs(twiceArea) > 1 ? stroke : null); // a dot or a scribble with nothing inside is no area
    stroke = null;
    setCrayonMode(false);
  }
  if (held) {
    held.state = 'land';
    settle(held); // on top of whatever is there, covering it
    held = null;
    dirty = true;
  }
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

canvas.addEventListener('dblclick', e => {
  const b = !crayonMode && bitAt(e);
  if (b) launch(b, Math.random() * 6 - 3, 7, Math.random() * 6 - 3);
});

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 3);
controls.maxPolarAngle = Math.PI / 2 - 0.06;
controls.minDistance = 2;
controls.maxDistance = 130;
controls.enableDamping = true;

// ---- running ----
let running = null; // { fast, list, budget }

function stop() {
  running = null;
  pointer.visible = false;
}

function start(fast) {
  stop();
  if (!area) {
    $('output').textContent = 'Nothing to run: draw an outline with the crayon first.';
    return;
  }
  const list = program(); // a snapshot: the wind may move the confetti, but not this run
  if (!kfLoad(toKft(list), $('input').value, fast)) {
    $('output').textContent = 'error: ' + kfOutput();
    return;
  }
  running = { fast, list, budget: 1 };
  showMachine();
}

function showMachine() {
  $('output').textContent = kfOutput();
  const show = s => `[${s.length > 12 ? '… ' : ''}${s.slice(-12).join(' ')}]`;
  $('stacks').textContent = `main  ${show(kfStack(0))}\nstash ${show(kfStack(1))}`;
}

function runFrame(dt, t) {
  if (!running) return;
  let halted = false;
  if (running.fast) {
    // As many steps as fit in most of a frame, so the page stays responsive.
    for (const end = performance.now() + 12; !halted && performance.now() < end;) halted = kf.kf_run(1_000_000) === 1;
  } else {
    running.budget += dt * 5; // five bits a second, slow enough to follow
    for (; running.budget >= 1 && !halted; running.budget--) halted = kf.kf_run(1) === 1;
  }
  showMachine();
  const cur = kf.kf_cur();
  pointer.visible = cur >= 0;
  if (cur >= 0) {
    const p = running.list[cur].mesh.position;
    pointer.position.set(p.x, p.y + 0.6 + Math.sin(t * 6) * 0.08, p.z);
  }
  if (halted) stop();
}

// ---- loading text ----
function loadText(text) {
  if (!kfLoad(text, '', true)) {
    $('output').textContent = 'error: ' + kfOutput();
    return;
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
}

// ---- panel ----
$('fire').onclick = fire;
$('crayon').onclick = () => setCrayonMode(!crayonMode);
$('sweep').onclick = () => removeBits(b => b.state !== 'land' || inArea(b.mesh.position.x, b.mesh.position.z));
$('clear').onclick = () => { stop(); removeBits(() => false); setArea(null); };
$('run').onclick = () => start(false);
$('fast').onclick = () => start(true);
$('stop').onclick = stop;
$('load').onclick = () => loadText($('kft').value);
$('examples').onchange = async e => {
  const name = e.target.value;
  e.target.value = '';
  if (name) loadText(await (await fetch(`../examples/${name}.kft`)).text());
};
addEventListener('keydown', e => {
  if (/INPUT|TEXTAREA|BUTTON|SELECT/.test(document.activeElement.tagName)) return;
  if (e.code === 'Space') { e.preventDefault(); fire(); }
  if (e.code === 'KeyC') setCrayonMode(!crayonMode);
});
$('legend').innerHTML = PALETTE.map(([name, hex, op]) => `<li><i style="background:${hex}"></i>${name} <b>${op}</b></li>`).join('');

// ---- main loop ----
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  physics(dt, t);
  runFrame(dt, t);
  if (dirty) refresh();
  const g = wind ? gustAt(t) : 1;
  world.update(dt, t, wind ? { x: wind.x * g, z: wind.z * g } : BREEZE);
  controls.update();
  renderer.render(scene, camera);
});

// For tests and the curious: poke at the editor from the console.
window.konfetti = { camera, controls, bits: () => bits, area: () => area, program, physics };

fire();
