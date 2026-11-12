// konfetti editor: fire confetti, draw an area with the crayon, and whatever lies inside is the program.
// World units: 1 = one bit length = 1000 language units. The language origin is where the crayon
// first touched down; language (x, y) = world (x - origin.x, -(z - origin.z)). Seen from above,
// +y is away from the default camera and left turns are counter-clockwise.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildWorld, paint, strokes, PAPER } from './world.js';
import { sound } from './sound.js';
import { createHand } from './hand.js';
import { EXPLAIN, describe, turn, TURN_WORDS, TURN_ARROW, drawStacks, drawTrace, makeLabels } from './debug.js';
import { createLearn } from './learn.js';
import { initPwa } from './pwa.js';

const PALETTE = [
  ['red', '#d2103a', 'PUSH'], ['orange', '#f16603', 'DUP'], ['yellow', '#ffff00', 'SWAP'],
  ['green', '#28b260', 'ADD'], ['cyan', '#00f0ff', 'SUB'], ['blue', '#195cec', 'MUL'],
  ['purple', '#7a0a9e', 'DIVMOD'], ['pink', '#ff659a', 'BRANCH'], ['white', '#ffffff', 'OUT'],
  ['black', '#1c1c1c', 'IN'], ['brown', '#6e3104', 'DROP'], ['silver', '#9ca8ac', 'STASH'],
  ['gold', '#ffb300', 'FETCH'],
];
const UNIT = 1000, REACH = 1500, MIN_GAP = 500;
const TOOTH = 0.03;             // how much the paper's tooth darkens the picture at most
const THICK = 0.008;            // a bit is a paper-thin strip
const LAYER = THICK * 1.5;      // height step between stacked bits; the slack keeps faces from flickering
const FOOTPRINT = 1.05;         // bits with centres closer than this may touch, so they stack
const CRAYON = '#2447d8';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
// The phone layout (the panel is a sheet at the bottom): the same query is in ui.css.
const compact = matchMedia('(max-width: 700px), (max-height: 500px)');
const noHover = matchMedia('(hover: none)');
const calm = matchMedia('(prefers-reduced-motion: reduce)');
/** Key hints like "(Space)" mean nothing on a touch screen. */
const keyless = text => (noHover.matches ? text.replace(/ \((?:Space|[A-Z])\)/g, '') : text);

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
renderer.toneMapping = THREE.NoToneMapping; // painted colors go to the screen as painted
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, 1, 0.3, 2000);
camera.position.set(0, 7.5, 25);
// ?grass=N sets the number of grass blades, for slow machines. They stand in tufts of about eight.
const world = buildWorld(scene, renderer, Number(params.get('grass')) || 180000);

// The picture is on cold-press paper, and paper does not move: its tooth is a still, very faint layer over
// the canvas. Everything else a painter leaves (mottling, granulation, ragged and pooled edges) is painted
// onto the things themselves in world.js, so it travels with them when the camera moves.
{
  const N = 256, c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = c.height = N;
  const img = g.createImageData(N, N), v = Float32Array.from({ length: N * N }, Math.random);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const at = (dx, dy) => v[((y + dy + N) % N) * N + (x + dx + N) % N];
    const t = 255 - Math.round(TOOTH * 255 * (at(0, 0) * 2 + at(1, 0) + at(0, 1) + at(-1, 0) + at(0, -1)) / 6);
    img.data.set([t, t, t, 255], (y * N + x) * 4);
  }
  g.putImageData(img, 0, 0);
  const tooth = document.createElement('div');
  tooth.id = 'tooth';
  tooth.style.cssText = `position:fixed;inset:0;pointer-events:none;mix-blend-mode:multiply;background:url(${c.toDataURL()})`;
  canvas.after(tooth);
}

// Overlay: links between program bits, a ring on the start bit, a pointer on the running bit.
// Links and rings are drawn lines with a rim of another color, so they read on pale stone, on any strip
// and on each other, and none can be taken for a pencil seam. They never get thinner than a couple of pixels.
const ink = '#1c1f36';
/** A line with a rim: `set(pts)` as for strokes(). */
function cased(color, rimColor, width, rim, minPx) {
  const under = strokes({ color: rimColor, width: width + rim * 2, minPx: minPx + 2 }), over = strokes({ color, width, minPx });
  under.renderOrder = 2; over.renderOrder = 3;
  const group = new THREE.Group().add(under, over);
  group.set = pts => { under.set(pts); over.set(pts); };
  return group;
}
/**
 * A ring with a rim, flat on the ground: true in perspective from close by. Inside it runs a hair of a drawn
 * line in the same color, which is what keeps the ring in sight from far off or from low down.
 */
function ringMark(color, rimColor, r, width, rim) {
  const flat = (r0, r1, c, y) => new THREE.Mesh(new THREE.RingGeometry(r0, r1, 72).rotateX(-Math.PI / 2).translate(0, y, 0), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
  const hair = strokes({ color, width: 0.02, minPx: 2 }), pts = [];
  for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, b = (i + 1) / 72 * Math.PI * 2; pts.push(Math.cos(a) * r, 0.004, Math.sin(a) * r, Math.cos(b) * r, 0.004, Math.sin(b) * r); }
  hair.set(pts);
  hair.renderOrder = 3;
  return new THREE.Group().add(flat(r - width / 2 - rim, r + width / 2 + rim, rimColor, 0), flat(r - width / 2, r + width / 2, color, 0.003), hair);
}
const links = cased(ink, PAPER, 0.046, 0.02, 1.6);
const startRing = ringMark(ink, PAPER, 0.7, 0.085, 0.03);
// The debugger's marks are one family: flat yellow with an ink rim. The pointer over the bit that runs now,
// the arrow along the way the walk takes, the ring on the bit it goes to next.
const NOW = '#ffd21f';
const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 20).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: NOW }));
pointer.add(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 20).rotateX(Math.PI).scale(1.32, 1.2, 1.32).translate(0, 0.02, 0), new THREE.MeshBasicMaterial({ color: ink, side: THREE.BackSide })));
pointer.castShadow = true;
// Debug mode only: a ring on the bit the walk goes to next, and an arrow to it from the current one.
const nextRing = ringMark(NOW, ink, 0.6, 0.075, 0.032);
const arrow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: NOW, side: THREE.DoubleSide }));
const arrowRim = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: ink, side: THREE.DoubleSide }));
arrow.add(arrowRim);
arrow.frustumCulled = arrowRim.frustumCulled = false;
arrow.renderOrder = 5; arrowRim.renderOrder = 4; // over the links, which are drawn late because they are see-through at their edges
arrow.material.transparent = arrowRim.material.transparent = true;
startRing.visible = pointer.visible = nextRing.visible = arrow.visible = false;
scene.add(links, startRing, pointer, nextRing, arrow);

/** Lays a flat arrow on the ground from world point `a` to `b`, clear of both bits' middles. */
function drawArrow(a, b) {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
  const y = Math.max(a.y, b.y) + 0.03, t0 = Math.min(0.3, len * 0.25), t1 = len - t0;
  const shape = (w, head, grow, y) => {
    const tn = t1 - 0.3 - grow * 0.4, at = (t, side) => [a.x + ux * t - uz * side, y, a.z + uz * t + ux * side];
    return new THREE.Float32BufferAttribute([
      ...at(t0 - grow, w), ...at(t0 - grow, -w), ...at(tn, w), ...at(tn, w), ...at(t0 - grow, -w), ...at(tn, -w),
      ...at(tn, head), ...at(tn, -head), ...at(t1 + grow * 2.2, 0)], 3);
  };
  arrow.geometry.setAttribute('position', shape(0.045, 0.15, 0, y));
  arrowRim.geometry.setAttribute('position', shape(0.075, 0.2, 0.03, y - 0.004));
}

// ---- the crayon and the area it draws ----
/** { pts: [{x, z}], origin: {x, z} }: bits inside the outline are the program; origin is where the crayon touched down. */
let area = null;
let stroke = null;       // points of the line being drawn right now
let crayonMode = false;
const wax = paint(new THREE.MeshLambertMaterial({ color: CRAYON, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
const outline = new THREE.Mesh(new THREE.BufferGeometry(), wax);
outline.frustumCulled = false;
const originDot = new THREE.Mesh(new THREE.CircleGeometry(0.24, 24).rotateX(-Math.PI / 2), wax);
originDot.visible = false;
scene.add(outline, originDot);

const crayon = new THREE.Group(); // the tip is at the group's origin
// Painted flat like the world, with an ink line round it, so it reads as a thing in the hand and not as scenery.
const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1.3, 16).translate(0, 0.95, 0), paint(new THREE.MeshLambertMaterial({ color: CRAYON })));
const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 16).rotateX(Math.PI).translate(0, 0.15, 0), stick.material);
const wrapper = new THREE.Mesh(new THREE.CylinderGeometry(0.116, 0.116, 0.8, 16).translate(0, 1.05, 0), paint(new THREE.MeshLambertMaterial({ color: PAPER })));
// The line: one shell a little larger than the whole crayon, of which only the far side shows.
const shell = new THREE.Mesh(new THREE.LatheGeometry([[0.001, -0.06], [0.145, 0.3], [0.148, 1.635], [0.001, 1.635]].map(([r, y]) => new THREE.Vector2(r, y)), 20), new THREE.MeshBasicMaterial({ color: ink, side: THREE.BackSide }));
crayon.add(stick, tip, wrapper, shell);
for (const part of [stick, tip, wrapper]) part.castShadow = true;
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
  $('qcrayon').setAttribute('aria-pressed', String(on));
  if (on && compact.matches) setSheet('peek'); // drawing needs the ground in sight
  coach();
}

// ---- bits ----
// Strips are stickers: one flat, solid color each, inside one border that is the same on all thirteen: an ink
// line with a white hairline inside it. A light strip shows the ink, a dark one the white, so any strip lying
// on any other (black on black, white on white) is seen to be a second strip, and the upper one. There is no
// texture: the shader draws the border from how far a point is from the strip's edge.
const EDGE = [0.036, 1.6], HAIR = [0.016, 1.2]; // the ink line and the white hairline: [width in strip lengths, least width in pixels]
const bitGeo = new THREE.BoxGeometry(1, THICK, 0.4);
{ // uv: where on the face a point is, in strip lengths from its middle. The four thin sides are all edge.
  const { position, normal, uv } = bitGeo.attributes;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, normal.getY(i) ? position.getX(i) : 0.5, normal.getY(i) ? position.getZ(i) : 0.2);
}
const sticker = shader => {
  shader.uniforms.rim = { value: new THREE.Color(ink) };
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 rim;').replace('#include <color_fragment>', `#include <color_fragment>
    // strip lengths per pixel, along the strip and across it; then how many pixels this point is in from the edge, each way
    vec2 perPx = vec2(length(vec2(dFdx(vUv.x), dFdy(vUv.x))), length(vec2(dFdx(vUv.y), dFdy(vUv.y)))) + 1e-6;
    vec2 inPx = (vec2(0.5, 0.2) - abs(vUv)) / perPx;
    float across = 0.4 / perPx.y;
    // Neither line gets thinner on screen than a pixel or so, and the two never take more than half of the strip.
    vec2 line = max(vec2(${EDGE[0]}) / perPx, ${EDGE[1].toFixed(1)}), hair = max(vec2(${HAIR[0]}) / perPx, ${HAIR[1].toFixed(1)});
    vec2 fit = min(vec2(1.0), 0.25 * vec2(1.0 / perPx.x, across) / (line + hair));
    line *= fit; hair *= fit;
    // A strip only a few pixels across would be mostly border, and colors would muddy into each other: there it
    // is all fill. Measured across the strip's short side, so a strip seen end-on keeps its border.
    float far = 1.0 - smoothstep(3.0, 8.0, across);
    vec3 inner = mix(vec3(1.0), diffuseColor.rgb, max(clamp(min(inPx.x - line.x - hair.x, inPx.y - line.y - hair.y) + 0.5, 0.0, 1.0), far));
    diffuseColor.rgb = mix(rim, inner, max(clamp(min(inPx.x - line.x, inPx.y - line.y) + 0.5, 0.0, 1.0), far));`);
};
const bitMats = PALETTE.map(([, hex]) => Object.assign(paint(new THREE.MeshLambertMaterial({ color: hex }), sticker), { defines: { USE_UV: '' } }));
/** state: 'air' (flying) | 'land' (lying on the ground) | 'held' (being dragged) */
let bits = [];
let dirty = true; // the program may have changed: redraw the overlay and the text
let serial = 0;

// A landed strip darkens the sheet a little all round it, so even a white strip stands off pale stone.
const haloTexture = (() => {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = 128; c.height = 64;
  g.fillStyle = '#000'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#fff'; g.fillRect(9, 9, 110, 46);
  // softened by drawing it small and back up: canvas `filter` is not in every browser
  const s = document.createElement('canvas'), sg = s.getContext('2d');
  s.width = 32; s.height = 16;
  sg.drawImage(c, 0, 0, 32, 16);
  g.drawImage(s, 0, 0, 128, 64);
  return new THREE.CanvasTexture(c);
})();
const haloGeo = new THREE.PlaneGeometry(1.17, 0.585).rotateX(-Math.PI / 2).translate(0, -THICK / 2 - 0.001, 0);
const haloMat = new THREE.MeshBasicMaterial({ color: '#33293c', alphaMap: haloTexture, transparent: true, opacity: 0.5, depthWrite: false });
// All halos are one mesh, one draw call however many strips there are. Same color, so the order they blend in is no matter.
let halos = new THREE.InstancedMesh(haloGeo, haloMat, 64);
/** Puts a halo under every landed strip, where it lies this frame. */
function drawHalos() {
  const land = bits.filter(b => b.state === 'land');
  if (land.length > halos.instanceMatrix.count) {
    scene.remove(halos);
    halos.dispose();
    halos = new THREE.InstancedMesh(haloGeo, haloMat, land.length * 2);
  }
  if (!halos.parent) {
    halos.frustumCulled = false; // its instances move every frame
    halos.renderOrder = -1;      // under the links and everything else see-through on the stones
    scene.add(halos);
  }
  land.forEach((b, i) => { b.mesh.updateMatrix(); halos.setMatrixAt(i, b.mesh.matrix); }); // a strip's parent is the scene
  halos.count = land.length;
  halos.instanceMatrix.needsUpdate = true;
}

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
  explain(null); // the bit being explained may be gone
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
    const old = new Set(bits.filter(b => b.state === 'land' && !b.tray && !inArea(b.mesh.position.x, b.mesh.position.z)).slice(0, extra));
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

// The Mac app's web view never answers a browser's request for the location, not even with a no.
// There the app asks the Mac instead, and hands over `coords` it has already rounded to one decimal.
const APP = window.__TAURI_INTERNALS__;

async function fetchWind() {
  try {
    const pos = APP ? { coords: await APP.invoke('location') }
      : await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { timeout: 8000 }));
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
  links.set(pts);
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
  $('hint').textContent = keyless(
    crayonMode ? 'Draw an outline on the stones. The spot where the crayon touches down is the program’s origin.'
    : !bits.length ? 'Start here: fire the cannon! (Space)'
    : !area ? 'Next: pick the crayon (C) and draw an outline around some confetti. What is inside becomes the program.'
    : !n ? 'Nothing inside the outline yet. Drag confetti in, or fire again.'
    : debugOn ? `${n} bits in the program. Step (N) runs one bit; Play (P) runs them one after another.`
    : `${n} bit${n > 1 ? 's' : ''} in the program. Press Run, or turn on Debug (D) to step through it.`);
}
/** Shows `text` in the hint for a few seconds, then the hint goes back to coaching. */
function say(text) {
  $('hint').textContent = keyless(text);
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
// A finger hides what it holds, so a bit held by touch rides this many pixels above the finger. It
// rises over the first 40 px of the drag, so a tap does not make it jump.
const LIFT = 56;
let grab = null; // { x, y, touch, from }: where the pointer took hold of the bit, and where the bit lay

/** The ground point under the pointer, or `up` pixels above it. */
function groundAt(e, up = 0) {
  const r = canvas.getBoundingClientRect();
  mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - up - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  return ray.ray.intersectPlane(floor, new THREE.Vector3());
}
const FINGER = 30; // CSS pixels: how far from a strip a fingertip may land and still take it
const end = new THREE.Vector3();
function bitAt(e) {
  groundAt(e);
  const land = bits.filter(b => b.state === 'land');
  const hit = ray.intersectObjects(land.map(b => b.mesh))[0];
  if (hit) return hit.object.userData.bit;
  if (e.pointerType !== 'touch') return undefined;
  // A strip is thinner than a fingertip, so a near miss takes the strip nearest on screen,
  // measured to the strip's long middle line and not just to its centre.
  const r = canvas.getBoundingClientRect();
  const px = v => (v.project(camera), { x: (v.x + 1) / 2 * r.width + r.left, y: (1 - v.y) / 2 * r.height + r.top, behind: v.z > 1 });
  let best, near = FINGER;
  for (const b of land) {
    const p = b.mesh.position, yaw = b.mesh.rotation.y, hx = Math.cos(yaw) / 2, hz = -Math.sin(yaw) / 2;
    const a = px(end.set(p.x - hx, p.y, p.z - hz)), c = px(end.set(p.x + hx, p.y, p.z + hz));
    if (a.behind || c.behind) continue;
    const dx = c.x - a.x, dy = c.y - a.y;
    const t = Math.max(0, Math.min(1, ((e.clientX - a.x) * dx + (e.clientY - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(e.clientX - a.x - t * dx, e.clientY - a.y - t * dy);
    // In a pile, a tie goes to the strip on top.
    if (d < near - 0.5 || (d < near + 0.5 && best && p.y > best.mesh.position.y)) { best = b; near = d; }
  }
  return best;
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
    grab = { x: e.clientX, y: e.clientY, touch: e.pointerType === 'touch', from: held.mesh.position.clone() };
    held.mesh.position.y += 0.35;
    if (debugOn) explain(held); // a finger has no hover: touching a bit is how it asks
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
  const up = held && grab.touch ? LIFT * Math.min(1, Math.hypot(e.clientX - grab.x, e.clientY - grab.y) / 40) : 0;
  const p = (crayonMode || held) && groundAt(e, up);
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
    const b = held, tap = grab.touch && Math.hypot(e.clientX - grab.x, e.clientY - grab.y) < 10;
    held.state = 'land';
    // A tap only asks what the bit is: it stays where it lay, in its place in the pile.
    if (tap) held.mesh.position.copy(grab.from);
    else settle(held); // on top of whatever is there, covering it
    held = null;
    sound.drop();
    dirty = true;
    // Not every browser gives fingers a dblclick: two quick taps on one bit flick it away, as a double-click does.
    const twice = tap && lastTap && lastTap.bit === b && e.timeStamp - lastTap.time < 400;
    if (twice) {
      flick(b);
      tapFlicked = e.timeStamp;
    }
    lastTap = tap && !twice ? { bit: b, time: e.timeStamp } : null;
  }
}
let lastTap = null, tapFlicked = -Infinity;
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

function flick(b) {
  launch(b, Math.random() * 6 - 3, 7, Math.random() * 6 - 3);
  sound.flick();
}
canvas.addEventListener('dblclick', e => {
  if (e.timeStamp - tapFlicked < 500) return; // the two taps that made this have flicked their bit already
  const b = !crayonMode && bitAt(e);
  if (b) flick(b);
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
      say('Nothing to run yet: draw an outline with the crayon first.');
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
  if (!quiet) $('output').closest('details').open = true; // a run asked for is a run to watch: output and stacks in sight
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
  say(run.fast ? 'The program halted.' : run.n ? `The program halted after ${run.n} step${run.n > 1 ? 's' : ''}.` : 'There is nothing in the outline to run.');
}

function showMachine() {
  const m = onScreen();
  // Only the last 64 KB, far more than the box shows: a program that prints without end must not slow every frame.
  if (run) $('output').textContent = (m.out.length > 1 << 16 ? '…' : '') + dec.decode(m.out.subarray(-(1 << 16)));
  $('peekout').classList.toggle('ended', !!run && run.halted); // once the program has stopped, an empty peek says so, not "nothing yet"
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
    if (compact.matches) setSheet('peek'); // the dock takes the top, its buttons the bottom: the program goes between
  } else {
    if (run && !run.playing) stop();
    nextRing.visible = arrow.visible = false;
    labels.draw([]);
  }
  coach();
  drawDebug();
  fitView();
}

/** The dock: buttons, status, trace and stacks. Called whenever the machine or the program changes. */
function drawDebug() {
  if (!debugOn) return;
  const slow = run && !run.fast, m = onScreen();
  drawStacks($('dstacks'), m.main, m.stash);
  drawTrace($('trace'), slow ? trace : [], run && run.fast ? 'Run fast does not keep a trace. Use Step or Play.'
    : !area ? 'Draw an outline with the crayon: the confetti inside it is the program.'
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
  $('dexplain').classList.toggle('idle', !bit); // only the invitation: a phone on its side has no room for it
  if (!bit) return void ($('dexplain').textContent = noHover.matches ? 'Touch a bit to see what it does.' : 'Point at a bit to see what it does.');
  const [name, , op] = PALETTE[bit.color], i = view.list.indexOf(bit);
  $('dexplain').textContent = `${name} ${op}${i < 0 ? ' (outside the outline, not in the program)' : ` #${i}${view.live[i] ? '' : ' (covered, so ignored)'}`}: ${EXPLAIN[bit.color]}`;
}

/** Floating names over the program's bits. Called every frame: the camera moves. */
const corner = new THREE.Vector3();
function drawLabels() {
  const items = [], zoom = innerHeight / 2 / Math.tan(camera.fov * Math.PI / 360);
  const room = compact.matches ? 12 / 10.5 : 1; // a phone's labels are 12px, not 10.5px (ui.css), so they need more room
  const put = (pos, html, cls, always) => {
    corner.copy(pos).project(camera);
    if (corner.z > 1 || Math.abs(corner.x) > 1.05 || Math.abs(corner.y) > 1.05) return;
    // Screen pixels per bit length here. Names need room: far away they shrink to numbers, then go.
    const size = zoom / camera.position.distanceTo(pos);
    const full = always || size > 46 * room, alpha = always ? 1 : Math.min(1, (size - 14 * room) / 8);
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
const rowsOf = text => text.split('\n').map(line => line.split('#')[0].trim().split(/\s+/)).filter(r => r[0])
  .map(([name, x, y]) => ({ color: PALETTE.findIndex(p => p[0] === name), x: x / UNIT, z: -y / UNIT }));

/**
 * Lays `text` out as the program and draws an outline around it. A lesson also passes `fit`, program
 * text whose bits must find room inside the outline too, and `tray`, the colors of spare bits to lay in
 * a row outside it. Returns the patch of ground it used, { x0, x1, z0, z1 }, or nothing if the text is bad.
 */
function loadText(text, { fit = '', tray = [] } = {}) {
  stop(); // checking the text replaces the program in the runtime, so no run can go on
  if (!kfLoad(text, '', true)) {
    $('output').textContent = 'error: ' + kfOutput();
    sound.error();
    say('That text is not a program. The output box says why.');
    return showMachine();
  }
  const rows = rowsOf(text);
  stop();
  removeBits(() => false);
  // Lay the program out in front of the cannon, clear of where its bursts come down.
  const box = { x0: 0, x1: 0, z0: 0, z1: 0 }; // around the bits and the origin, origin-relative
  for (const r of [...rows, ...rowsOf(fit)]) {
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
  if (compact.matches) frame({ x0, x1, z0, z1 }); // a narrow screen cuts the ends off a long row otherwise
  say(`Loaded ${rows.length} bits. Press Run!`);
  // The tray: a row on the near side of the outline, clear of it.
  const pitch = 1.5, reach = (tray.length - 1) / 2 * pitch + 0.6;
  tray.forEach((color, i) => {
    const b = addBit(color, (x0 + x1) / 2 + (i - (tray.length - 1) / 2) * pitch, 0, z1 + 1.5, 'land');
    b.tray = true; // the lesson needs these: they are not litter, whatever lies outside the outline
    b.mesh.rotation.y = 0;
    settle(b);
  });
  return tray.length ? { x0: Math.min(x0, (x0 + x1) / 2 - reach), x1: Math.max(x1, (x0 + x1) / 2 + reach), z0, z1: z1 + 2.2 } : { x0, x1, z0, z1 };
}

// ---- what covers the world: the panel or sheet, the lesson card, the dock, the quick buttons ----
/**
 * The part of the window, in pixels { l, t, r, b }, that nothing covers. On a phone it is worked out
 * from where the sheet is going, not where it is mid-slide.
 */
function freeRect() {
  const W = innerWidth, H = innerHeight;
  const box = el => (el.getClientRects().length ? el.getBoundingClientRect() : null);
  const dock = box($('dock'));
  if (!compact.matches) {
    // The lesson card stands on the left on a wide screen; on a narrower one it is inside the panel.
    const card = getComputedStyle($('lesson')).position === 'fixed' && box($('lesson'));
    return { l: card ? card.right : 0, t: 0, r: box($('panel')).left, b: dock ? dock.top : H };
  }
  const gap = 10, fabs = box($('fabs')), sizes = sheetSizes();
  if (W > H) { // on its side: the dock on the left; the sheet and the quick buttons on the right
    const right = sheet === 'peek' ? W : W - $('panel').offsetWidth;
    return { l: dock ? dock.right : 0, t: 0, r: right - gap - (fabs ? fabs.width + gap : 0), b: H };
  }
  const btns = debugOn ? box(document.querySelector('.dockbtns')) : null;
  const row = Math.max(fabs ? fabs.height : 0, btns ? btns.height : 0);
  // Past half open the sheet covers the world anyway; the view keeps the half-open framing.
  return { l: 0, t: dock ? dock.bottom : 0, r: W, b: H - Math.min(sizes[sheet], sizes.half) - (row ? row + gap : 0) };
}

/** The view's shift, so that the middle of the scene is the middle of what can be seen. It glides to `liftTo`. */
let lift = { x: 0, y: 0 }, liftTo = { x: 0, y: 0 };
function fitView(now = false) {
  const f = freeRect(), W = innerWidth, H = innerHeight;
  const cap = (v, m) => Math.max(-m, Math.min(m, v)); // a sliver of free room must not throw the scene off screen
  liftTo = { x: cap(W / 2 - (f.l + f.r) / 2, W / 3), y: cap(H / 2 - (f.t + f.b) / 2, H / 3) };
  if (now || calm.matches) lift = { ...liftTo };
  applyLift();
}
function applyLift() {
  if (Math.abs(lift.x) > 0.5 || Math.abs(lift.y) > 0.5) camera.setViewOffset(innerWidth, innerHeight, lift.x, lift.y, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

// ---- the sheet: the panel on a phone. It rests as a peek (handle and output), half open or full. ----
const STOPS = ['peek', 'half', 'full'];
let sheet = 'peek';
try { if (STOPS.includes(localStorage.getItem('konfetti.sheet'))) sheet = localStorage.getItem('konfetti.sheet'); } catch {}
document.documentElement.dataset.sheet = sheet;

/** The sheet's height at each stop, in pixels. Half open shows the Run group down to the stacks, or a good part of a lesson. */
function sheetSizes() {
  const H = innerHeight, panel = $('panel'), side = innerWidth > H;
  // The handle, the sheet's top border, and the home indicator's inset (the bottom padding is 12px plus it).
  const peek = $('sheetbar').offsetHeight + panel.clientTop + parseFloat(getComputedStyle(panel).paddingBottom) - 12;
  const runs = panel.querySelector('.run').getBoundingClientRect();
  const need = runs.bottom - panel.getBoundingClientRect().top + panel.scrollTop + 14;
  const learning = document.body.classList.contains('learning');
  const half = learning ? H * (side ? 0.62 : 0.52) : Math.min(H * (side ? 0.9 : 0.6), Math.max(H * 0.36, need));
  return { peek, half: Math.round(Math.max(half, peek)), full: side ? H : H - 52 };
}

function setSheet(to) {
  if (sheet === 'peek' && to !== 'peek') $('panel').scrollTop = 0; // opening shows the top: Run, or the lesson
  sheet = to;
  document.documentElement.dataset.sheet = to;
  try { localStorage.setItem('konfetti.sheet', to); } catch {}
  placeSheet();
}
function placeSheet() {
  if (!compact.matches) return;
  document.documentElement.style.setProperty('--sheet', `${sheetSizes()[sheet]}px`);
  $('sheet').setAttribute('aria-expanded', String(sheet !== 'peek'));
  $('sheet').setAttribute('aria-label', { peek: 'Show more controls', half: 'Show all controls', full: 'Hide the controls' }[sheet]);
  fitView();
}

// The handle: a tap goes peek, half, full and back to peek; a drag follows the finger and settles on
// the nearest stop, or on the next stop the way it was flicked.
let sheetDrag = null, sheetDragged = false;
$('sheet').addEventListener('pointerdown', e => {
  if (e.button || sheetDrag) return; // one finger moves the sheet; a second one is ignored until it lifts
  sheetDragged = false;
  sheetDrag = { id: e.pointerId, y: e.clientY, h: sheetSizes()[sheet], at: e.clientY, t: e.timeStamp, v: 0, now: 0 };
  $('sheet').setPointerCapture(e.pointerId);
});
$('sheet').addEventListener('pointermove', e => {
  if (!sheetDrag || e.pointerId !== sheetDrag.id || (!sheetDragged && Math.abs(e.clientY - sheetDrag.y) < 6)) return;
  if (!sheetDragged) {
    sheetDragged = true;
    if (sheet === 'peek') $('panel').scrollTop = 0;
    document.documentElement.classList.add('sheetdrag');
    document.documentElement.dataset.sheet = 'drag'; // everything in the sheet shows while it moves
  }
  const sizes = sheetSizes();
  sheetDrag.now = Math.min(sizes.full, Math.max(sizes.peek, sheetDrag.h + sheetDrag.y - e.clientY));
  sheetDrag.v = (sheetDrag.at - e.clientY) / Math.max(1, e.timeStamp - sheetDrag.t); // px/ms, up is positive
  sheetDrag.at = e.clientY;
  sheetDrag.t = e.timeStamp;
  document.documentElement.style.setProperty('--sheet', `${sheetDrag.now}px`);
});
function endSheetDrag(e) {
  const d = sheetDrag;
  if (!d || e.pointerId !== d.id) return;
  sheetDrag = null;
  if (!sheetDragged) return;
  document.documentElement.classList.remove('sheetdrag');
  const sizes = sheetSizes(), h = d.now;
  const v = e.timeStamp - d.t < 100 ? d.v : 0; // a finger that stopped before lifting did not flick
  let to = STOPS.reduce((a, b) => (Math.abs(sizes[b] - h) < Math.abs(sizes[a] - h) ? b : a));
  if (v > 0.4) to = STOPS.find(s => sizes[s] > h + 1) || 'full';
  if (v < -0.4) to = [...STOPS].reverse().find(s => sizes[s] < h - 1) || 'peek';
  setSheet(to);
}
$('sheet').addEventListener('pointerup', endSheetDrag);
$('sheet').addEventListener('pointercancel', endSheetDrag);
$('sheet').onclick = () => {
  if (sheetDrag) return; // a second finger's tap while the first one drags
  if (sheetDragged) return void (sheetDragged = false);
  setSheet(STOPS[(STOPS.indexOf(sheet) + 1) % STOPS.length]);
};

// The peek shows the end of the output, the part a running program just wrote.
new MutationObserver(() => {
  const out = $('output').textContent.replace(/\n/g, '⏎');
  $('peekout').textContent = out.length > 40 ? `…${out.slice(-39)}` : out;
}).observe($('output'), { childList: true, characterData: true, subtree: true });

// ---- learn mode (the lessons and the card are in learn.js) ----
/** Looks down on a patch of ground, steeply, so that it fits in the part of the window nothing covers. */
function frame({ x0, x1, z0, z1 }) {
  const f = freeRect();
  const free = Math.max(0.2, Math.min(0.9, (f.r - f.l) / innerWidth));
  const clear = Math.max(0.15, Math.min(0.6, (f.b - f.t) / innerHeight - 0.05));
  const t = Math.tan(camera.fov * Math.PI / 360), tilt = 1.05; // radians up from the ground: bits seen from above are easy to grab
  const dist = Math.max((x1 - x0 + 1.5) / (2 * t * camera.aspect * free), (z1 - z0 + 1.5) * Math.sin(tilt) / (2 * t * clear));
  controls.target.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  camera.position.set((x0 + x1) / 2, dist * Math.sin(tilt), (z0 + z1) / 2 + dist * Math.cos(tilt));
}

/**
 * Runs the program in the outline once for each input, off screen, for at most `cap` steps each.
 * Gives [{ halted, out }], or null when there is no outline.
 */
function judge(inputs, cap) {
  if (!area) return null;
  // A slow run that has halted shows its own copy of the machine and its trace, so it can stay on screen.
  const ended = run && !run.fast && run.halted ? run : null;
  stop();
  const src = toKft(program());
  const runs = inputs.map(input => {
    kfLoad(src, input, true);
    return { halted: kf.kf_run(cap) === 1, out: kfBytes().slice() };
  });
  // Leave the runtime as a fresh load does, so the panels do not show the stacks of the last check.
  kfLoad(src, '', true);
  run = ended;
  if (debugOn && !ended) start(false, false, true);
  else showMachine();
  return runs;
}

// ---- panel ----
const THEMES = ['paper', 'toybox', 'craft', 'arcade']; // the first is the default
function setTheme(name) {
  if (!THEMES.includes(name)) name = THEMES[0];
  document.documentElement.dataset.theme = name;
  for (const b of $('themes').children) b.setAttribute('aria-pressed', String(b.dataset.theme === name));
}
$('themes').innerHTML = THEMES.map(t => `<button class="small" data-theme="${t}">${t}</button>`).join('');
// Only a theme someone picks here is kept, so that one only shown (the default, or from ?theme=) never sticks.
$('themes').onclick = e => {
  const name = e.target.dataset.theme;
  if (!name) return;
  setTheme(name);
  try { localStorage.setItem('konfetti.theme.picked', name); } catch {}
};
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
$('logo').innerHTML = [...'konfetti'].map((ch, i) => `<span style="--c:${PALETTE[[0, 1, 3, 5, 2, 7, 4, 12][i]][1]};--i:${i}">${ch}</span>`).join('');
$('logo').onclick = burst;

$('fire').onclick = fire;
$('crayon').onclick = () => setCrayonMode(!crayonMode);
$('wind').onclick = toggleWind;
$('mute').onclick = () => setMuted(!sound.muted);
$('debug').onclick = () => setDebug(!debugOn);
$('sweep').onclick = () => {
  const before = bits.length;
  removeBits(b => b.state !== 'land' || b.tray || inArea(b.mesh.position.x, b.mesh.position.z));
  say(before > bits.length ? `Swept away ${before - bits.length} bits of litter.` : 'Nothing to sweep.');
};
$('clear').onclick = () => { stop(); removeBits(() => false); setArea(null); $('output').textContent = ''; say('All clear. Fire the cannon! (Space)'); };
$('run').onclick = () => start(false);
$('fast').onclick = () => start(true);
$('stop').onclick = stop;
$('load').onclick = () => loadText($('kft').value);
// A pick made with the pointer hands the keys back to the editor, or every shortcut would go to the
// list; a pick made with the keyboard leaves focus where the user put it.
let pickedByPointer = false;
$('examples').onpointerdown = () => { pickedByPointer = true; };
$('examples').onblur = () => { pickedByPointer = false; };
$('examples').onchange = async e => {
  const name = e.target.value;
  e.target.value = '';
  if (pickedByPointer) e.target.blur();
  if (name) loadText(await (await fetch(`../examples/${name}.kft`)).text());
};

// The quick buttons (phone layout). Run turns into Stop while a program runs.
$('qcrayon').onclick = () => setCrayonMode(!crayonMode);
$('qfire').onclick = fire;
$('qrun').onclick = () => (run && !run.halted ? stop() : start(false));
$('qcheck').onclick = () => learn.check();
let shownBusy = false;
function showBusy() {
  const busy = !!run && !run.halted;
  if (busy === shownBusy) return;
  shownBusy = busy;
  $('qrun').classList.toggle('busy', busy);
  $('qrun').querySelector('.ico').textContent = busy ? '⏹' : '▶';
  $('qrun').querySelector('.lbl').textContent = busy ? 'Stop' : 'Run';
}

// Groups fold; which are open is remembered, separately for the phone layout and the wide one.
// Defaults: on a phone only Run is open (the quick buttons stand in for Make); wide, all but Colors and How it works.
const groups = [...document.querySelectorAll('details.group')];
const foldKey = `konfetti.groups.${compact.matches ? 'phone' : 'wide'}`;
let folds = {};
try { const f = JSON.parse(localStorage.getItem(foldKey)); if (f && typeof f === 'object') folds = f; } catch {}
for (const g of groups) {
  const name = g.dataset.group;
  g.open = name in folds ? !!folds[name] : compact.matches ? name === 'run' : !['colors', 'how'].includes(name);
  // Only a person's choice is kept, not Run opening for a run.
  g.querySelector('summary').addEventListener('click', () => {
    folds[name] = !g.open;
    try { localStorage.setItem(foldKey, JSON.stringify(folds)); } catch {}
  });
  g.addEventListener('toggle', () => { if (sheet === 'half') placeSheet(); }); // half open is sized to the Run group
}

const step = () => { if (!run || run.fast || run.halted) start(false, false); else { run.playing = false; stepOnce(); } showMachine(); };
const playPause = () => { if (!run || run.fast || run.halted) start(false, true); else run.playing = !run.playing; showMachine(); };
const restart = () => start(false, false);
$('dstep').onclick = step;
$('dplay').onclick = playPause;
$('drestart').onclick = restart;
$('dclose').onclick = () => setDebug(false);
$('dspeed').oninput = () => { $('dspeedv').textContent = `${$('dspeed').value} a second`; };

// Browsers only let a page make sound after the user has touched it; any touch or key will do.
addEventListener('pointerdown', () => sound.unlock(), { capture: true });
addEventListener('keydown', () => sound.unlock(), { capture: true });
document.addEventListener('click', e => {
  if (e.target.closest('button:not(#fire, #qfire)')) sound.ui();
  // A mouse click leaves focus on the control, and Space would press it again instead of firing.
  // A press from the keyboard (detail 0) keeps focus where the user put it.
  if (e.detail) e.target.closest('button, summary')?.blur();
});

addEventListener('keydown', e => {
  const keys = { Space: fire, KeyC: () => setCrayonMode(!crayonMode), KeyW: toggleWind, KeyM: () => setMuted(!sound.muted), KeyD: () => setDebug(!debugOn), KeyL: learn.toggle };
  const debugKeys = { KeyN: step, KeyP: playPause, KeyR: restart };
  const act = keys[e.code] || (debugOn && debugKeys[e.code]);
  if (!act || e.ctrlKey || e.metaKey || e.altKey) return;
  // A list the pointer opened keeps focus after it shuts, even without a pick, but nobody is typing in it.
  if (pickedByPointer && document.activeElement === $('examples')) $('examples').blur();
  const tag = document.activeElement.tagName;
  // Typing in a field is typing, not a shortcut. The speed slider takes no letters, so it does not count.
  if (document.activeElement.matches('input:not([type=range]), textarea, select')) return;
  if (e.code === 'Space' && (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A')) return; // space presses the focused control
  e.preventDefault(); // a letter must not also pick from a list or start a find
  act();
});
// The words are in the title for a mouse to hover, and written out where there is no hover.
$('legend').innerHTML = PALETTE.map(([name, hex, op], i) =>
  `<li title="${name} ${op} ${EXPLAIN[i]}"><i style="background:${hex}"></i><span>${name}</span><b>${op}</b><small>${EXPLAIN[i]}</small></li>`).join('');
explain(null);

// ---- main loop ----
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  placeSheet();
  fitView(true);
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let windHeard = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  physics(dt, t);
  runFrame(dt, t);
  showBusy();
  if (dirty) refresh();
  if (lift.x !== liftTo.x || lift.y !== liftTo.y) {
    const k = Math.min(1, dt * 12);
    lift = { x: lift.x + (liftTo.x - lift.x) * k, y: lift.y + (liftTo.y - lift.y) * k };
    if (Math.abs(lift.x - liftTo.x) + Math.abs(lift.y - liftTo.y) < 0.5) lift = { ...liftTo };
    applyLift();
  }
  const air = windAt(t), strength = Math.hypot(air.x, air.z);
  world.update(dt, t, air, camera);
  // The wind sound follows the gusts; only told when it has changed enough to hear.
  if (Math.abs(strength - windHeard) > 0.25 || (!strength && windHeard)) sound.setWind(windHeard = strength);
  controls.update();
  // A finger gets the glove only while it holds a bit, pinching it above the finger.
  hand.group.visible = (!!handAt || !!held) && !crayonMode;
  // The glove is the pointer over the ground and the crayon draws with a crosshair; over the sky there
  // is no glove, so the system pointer comes back.
  canvas.style.cursor = crayonMode ? 'crosshair' : handAt ? 'none' : '';
  if (hand.group.visible) {
    // Hover just above the ground; while holding, the pinch sits on the bit it carries. Over a finger the
    // glove is smaller, to keep the bits around the one it carries in sight.
    const at = held ? held.mesh.position : handAt;
    hand.group.scale.setScalar(held && grab.touch ? 0.6 : 0.85);
    hand.group.position.set(at.x, held ? at.y + 0.02 : 0.22, at.z);
    hand.group.rotation.y = Math.atan2(camera.position.x - at.x, camera.position.z - at.z); // back of the hand to the viewer
    hand.setGrab(!!held);
    hand.update(dt, t);
  }
  if (debugOn) drawLabels();
  drawHalos();
  renderer.render(scene, camera);
});

const learn = createLearn({
  sound, judge, celebrate: fire,
  lay(text, fit, tray) {
    // A lesson starts on still ground: no run, no wind, no crayon in the hand, no debugger in the way.
    stop();
    if (wind || $('wind').getAttribute('aria-pressed') === 'true') toggleWind();
    setCrayonMode(false);
    if (debugOn) setDebug(false);
    // On a phone the lesson is read in the sheet: half open upright, so the program shows above it;
    // all the way on its side, where the sheet stands beside the program.
    if (compact.matches) setSheet(innerWidth > innerHeight ? 'full' : 'half');
    const box = loadText(text, { fit, tray: tray.map(name => PALETTE.findIndex(p => p[0] === name)).sort((a, b) => a - b) });
    if (box) frame(box);
  },
  setInput(text) { $('input').value = text; },
  resize: () => { placeSheet(); fitView(); },
  /** Brings `el` (in the lesson card) into sight: on a phone the sheet opens first, and the scroll waits for it. */
  reveal(el, block = 'nearest') {
    if (!compact.matches) return el.scrollIntoView({ block });
    const opening = sheet === 'peek';
    if (opening) setSheet(innerWidth > innerHeight ? 'full' : 'half');
    setTimeout(() => el.scrollIntoView({ block }), opening && !calm.matches ? 300 : 0);
  },
  watch() { setDebug(true); restart(); },
});

const pwa = initPwa(); // the service worker, and the offer to install konfetti as an app

// For tests and the curious: poke at the editor from the console.
window.konfetti = {
  learn, pwa,
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
