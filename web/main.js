// konfetti editor: a 3D world where you fire confetti and arrange it into a program.
// World units: 1 = one bit width = 1000 language units. Language (x, y) = world (x, -z),
// so seen from above, +y is away from the default camera and left turns are counter-clockwise.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const PALETTE = [
  ['red', '#e6194b', 'PUSH'], ['orange', '#f58231', 'DUP'], ['yellow', '#ffe119', 'SWAP'],
  ['green', '#3cb44b', 'ADD'], ['cyan', '#42d4f4', 'SUB'], ['blue', '#4363d8', 'MUL'],
  ['purple', '#911eb4', 'DIVMOD'], ['pink', '#f032e6', 'BRANCH'], ['white', '#ffffff', 'OUT'],
  ['black', '#000000', 'IN'], ['brown', '#9a6324', 'DROP'], ['silver', '#c0c0c0', 'STASH'],
  ['gold', '#d4af37', 'FETCH'],
];
const UNIT = 1000, REACH = 1500, GAP = 0.501; // GAP: a hair over 500 units so rounding never makes an overlap
const $ = id => document.getElementById(id);

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
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bcd8ee');
scene.fog = new THREE.Fog('#bcd8ee', 70, 190);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(-2, 12, 14);

scene.add(new THREE.HemisphereLight('#ffffff', '#55704a', 1.5));
const sun = new THREE.DirectionalLight('#fff4e0', 1.8);
sun.position.set(8, 20, 6);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.CircleGeometry(220, 64), new THREE.MeshStandardMaterial({ color: '#7d9b6b', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const cannon = new THREE.Group();
const metal = new THREE.MeshStandardMaterial({ color: '#39424e', roughness: 0.5, metalness: 0.4 });
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.25, 24), metal);
base.position.y = 0.125;
const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.16, 1.3, 24, 1, true), metal);
barrel.material.side = THREE.DoubleSide;
barrel.position.y = 0.9;
cannon.add(base, barrel);
scene.add(cannon);

// Trail overlay: links between placed bits, a ring on the start bit, a pointer on the running bit.
const links = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
links.frustumCulled = false;
const startRing = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.72, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
startRing.rotation.x = -Math.PI / 2;
const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 20), new THREE.MeshStandardMaterial({ color: '#fff36b', emissive: '#c9a800' }));
pointer.rotation.x = Math.PI;
startRing.visible = pointer.visible = false;
scene.add(links, startRing, pointer);

// ---- bits ----
const bitGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.03, 28);
const bitMats = PALETTE.map(([, hex], i) =>
  new THREE.MeshStandardMaterial({ color: hex, roughness: i >= 11 ? 0.3 : 0.75, metalness: i >= 11 ? 0.6 : 0 }));
/** state: 'air' (flying) | 'loose' (landed litter) | 'placed' (part of the program) | 'held' (being dragged) */
let bits = [];
let dirty = true; // placed bits changed: redraw the trail and the program text
let serial = 0;

function addBit(color, x, y, z, state) {
  const mesh = new THREE.Mesh(bitGeo, bitMats[color]);
  const bit = { mesh, color, state, vel: new THREE.Vector3(), spin: new THREE.Vector3(), phase: Math.random() * 7,
                slip: 0.5 + Math.random(), rest: 0.016 + (serial++ % 40) * 0.0005 }; // rest heights differ so overlapping litter doesn't flicker
  mesh.position.set(x, state === 'air' ? y : bit.rest, z);
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

function fire() {
  for (let i = 0; i < 40; i++) {
    const b = addBit(Math.floor(Math.random() * PALETTE.length), 0, 1.6, 0, 'air');
    const a = Math.random() * Math.PI * 2, h = 2 + Math.random() * 7;
    b.vel.set(Math.cos(a) * h, 9 + Math.random() * 6, Math.sin(a) * h);
    b.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
  }
}

const placed = () => bits.filter(b => b.state === 'placed');
const kx = b => Math.round(b.mesh.position.x * UNIT);
const ky = b => Math.round(-b.mesh.position.z * UNIT);
const toKft = list => list.map(b => `${PALETTE[b.color][0]} ${kx(b)} ${ky(b)}`).join('\n') + (list.length ? '\n' : '');

/** True if (x, z) keeps clear of every placed bit except `self`. */
function hasRoom(x, z, self) {
  return bits.every(o => o === self || o.state !== 'placed' || Math.hypot(o.mesh.position.x - x, o.mesh.position.z - z) >= GAP);
}

// ---- wind ----
let wind = null; // { x, z } in world units per second, plus speed/dir/real for the label

async function fetchWind() {
  try {
    const pos = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { timeout: 8000 }));
    // One decimal (about 10 km) is plenty for weather and keeps the location vague.
    const q = `latitude=${pos.coords.latitude.toFixed(1)}&longitude=${pos.coords.longitude.toFixed(1)}`;
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`);
    const cur = (await res.json()).current;
    if (!Number.isFinite(cur.wind_speed_10m) || !Number.isFinite(cur.wind_direction_10m)) throw new Error('no wind data');
    return { speed: cur.wind_speed_10m, dir: cur.wind_direction_10m, real: true };
  } catch {
    return { speed: 2 + Math.random() * 6, dir: Math.random() * 360, real: false };
  }
}

$('wind').onclick = async () => {
  if (wind) {
    wind = null;
    $('wind').textContent = 'Wind: off';
    $('wind').setAttribute('aria-pressed', 'false');
    $('windinfo').textContent = '';
    return;
  }
  $('windinfo').textContent = 'asking the weather…';
  const w = await fetchWind();
  // Weather reports where wind comes from, clockwise from north. North is language +y, world -z.
  const r = w.dir * Math.PI / 180;
  wind = { ...w, x: -Math.sin(r) * w.speed, z: Math.cos(r) * w.speed };
  $('wind').textContent = 'Wind: on';
  $('wind').setAttribute('aria-pressed', 'true');
  $('windinfo').textContent = `${w.speed.toFixed(1)} m/s from ${Math.round(w.dir)}°${w.real ? '' : ' (made up: no location)'}`;
};

// ---- physics ----
function physics(dt, t) {
  const wx = wind ? wind.x : 0, wz = wind ? wind.z : 0;
  // Gusts come and go; only they are strong enough to shove bits that have landed.
  const gust = wind ? Math.max(0, Math.sin(t * 0.7) + Math.sin(t * 1.9 + 1) - 0.4) : 0;
  for (const b of bits) {
    const p = b.mesh.position;
    if (b.state === 'air') {
      b.vel.x += ((wx - b.vel.x) * 1.5 + Math.sin(t * 7 + b.phase) * 2) * dt;
      b.vel.z += ((wz - b.vel.z) * 1.5 + Math.cos(t * 6 + b.phase) * 2) * dt;
      b.vel.y -= (6 + b.vel.y * 1.5) * dt;
      p.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
      if (p.y <= b.rest && b.vel.y < 0) {
        p.y = b.rest;
        b.mesh.rotation.set(0, Math.random() * 6, 0);
        b.state = 'loose';
      }
    } else if (gust && b.state !== 'held') {
      const k = 0.03 * gust * b.slip * dt;
      const x = p.x + wx * k, z = p.z + wz * k;
      if (b.state === 'loose') p.set(x, p.y, z);
      else if (hasRoom(x, z, b)) { p.set(x, p.y, z); dirty = true; } // a placed bit never slides into an overlap
    }
  }
}

// ---- trail overlay and program text ----
function refresh() {
  dirty = false;
  const list = placed();
  const pts = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if ((kx(list[i]) - kx(list[j])) ** 2 + (ky(list[i]) - ky(list[j])) ** 2 <= REACH * REACH) {
        const a = list[i].mesh.position, b = list[j].mesh.position;
        pts.push(a.x, 0.06, a.z, b.x, 0.06, b.z);
      }
    }
  }
  links.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  // Same rule as the runtime: nearest the cannon, first placed wins a tie.
  const first = list.reduce((m, b) => (!m || kx(b) ** 2 + ky(b) ** 2 < kx(m) ** 2 + ky(m) ** 2 ? b : m), null);
  startRing.visible = !!first;
  if (first) startRing.position.set(first.mesh.position.x, 0.012, first.mesh.position.z);
  if (document.activeElement !== $('kft')) $('kft').value = toKft(list);
}

// ---- picking up and placing ----
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let held = null;

function aim(e) {
  const r = canvas.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
}
function bitAt(e) {
  aim(e);
  const hit = ray.intersectObjects(bits.filter(b => b.state === 'loose' || b.state === 'placed').map(b => b.mesh))[0];
  return hit && hit.object.userData.bit;
}

// Capture phase: this must run before OrbitControls sees the event, so a grab doesn't also orbit.
canvas.addEventListener('pointerdown', e => {
  const b = e.button === 0 && bitAt(e);
  if (!b) return;
  held = b;
  b.from = { x: b.mesh.position.x, z: b.mesh.position.z, state: b.state };
  b.state = 'held';
  b.mesh.position.y = 0.35;
  controls.enabled = false;
  canvas.setPointerCapture(e.pointerId);
  dirty = true;
}, { capture: true });

canvas.addEventListener('pointermove', e => {
  if (!held) return;
  aim(e);
  const p = ray.ray.intersectPlane(floor, new THREE.Vector3());
  if (p) held.mesh.position.set(p.x, 0.35, p.z);
});

function drop() {
  if (!held) return;
  const b = held, p = b.mesh.position;
  held = null;
  controls.enabled = true;
  if (hasRoom(p.x, p.z, b)) {
    b.state = 'placed';
    // Sit exactly on the integer coordinates the program text will show.
    p.set(kx(b) / UNIT, b.rest, -ky(b) / UNIT);
  } else {
    // No room here: back where it came from.
    b.state = b.from.state;
    p.set(b.from.x, b.rest, b.from.z);
  }
  dirty = true;
}
canvas.addEventListener('pointerup', drop);
canvas.addEventListener('pointercancel', drop);

canvas.addEventListener('dblclick', e => {
  const b = bitAt(e);
  if (!b || b.state !== 'placed') return;
  b.state = 'air';
  b.vel.set(Math.random() * 6 - 3, 7, Math.random() * 6 - 3);
  b.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
  dirty = true;
});

const controls = new OrbitControls(camera, canvas);
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.maxDistance = 150;

// ---- running ----
let running = null; // { fast, list, budget }

function stop() {
  running = null;
  pointer.visible = false;
}

function start(fast) {
  stop();
  const list = placed();
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
    pointer.position.set(p.x, 0.75 + Math.sin(t * 6) * 0.08, p.z);
  }
  if (halted) stop();
}

// ---- loading text ----
function loadText(text) {
  if (!kfLoad(text, '', true)) {
    $('output').textContent = 'error: ' + kfOutput();
    return;
  }
  stop();
  removeBits(() => false);
  for (const line of text.split('\n')) {
    const [name, x, y] = line.split('#')[0].trim().split(/\s+/);
    if (name) addBit(PALETTE.findIndex(p => p[0] === name), x / UNIT, 0, -y / UNIT, 'placed');
  }
  $('output').textContent = '';
  $('kft').blur();
  frameProgram();
}

/** Points the camera at the placed bits. */
function frameProgram() {
  const box = new THREE.Box3();
  box.expandByPoint(new THREE.Vector3());
  placed().forEach(b => box.expandByPoint(b.mesh.position));
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const d = Math.max(size.x, size.z) * 0.75 + 7;
  controls.target.set(c.x, 0, c.z);
  camera.position.set(c.x, d, c.z + d);
}

// ---- panel ----
$('fire').onclick = fire;
$('sweep').onclick = () => removeBits(b => b.state !== 'loose');
$('clear').onclick = () => { stop(); removeBits(() => false); };
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
  if (e.code === 'Space' && !/INPUT|TEXTAREA|BUTTON|SELECT/.test(document.activeElement.tagName)) {
    e.preventDefault();
    fire();
  }
});
$('legend').innerHTML = PALETTE.map(([name, hex, op]) => `<li><i style="background:${hex}"></i>${name} ${op}</li>`).join('');

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
  controls.update();
  renderer.render(scene, camera);
});

fire();
