import * as THREE from 'three';
import { initAudio, audioTime, audioRunning, play } from './audio.js';

// ---------- configuration ----------

const TYPES = [
  // lane decides how the sequencer places a piece: drum / bass / mel(ody) / cat
  { id: 'kick',    label: 'Kick',    color: '#ff3b6b', count: 8,  size: 0.2,  lane: 'drum' },
  { id: 'snare',   label: 'Snare',   color: '#ffd23f', count: 5,  size: 0.17, lane: 'drum' },
  { id: 'clap',    label: 'Clap',    color: '#ffffff', count: 4,  size: 0.17, lane: 'drum' },
  { id: 'hihat',   label: 'Hi-hat',  color: '#3ff0e0', count: 16, size: 0.13, lane: 'drum' },
  { id: 'tom',     label: 'Tom',     color: '#b061ff', count: 5,  size: 0.18, lane: 'drum' },
  { id: 'cowbell', label: 'Cowbell', color: '#c9a227', count: 4,  size: 0.17, lane: 'drum' },
  { id: 'bass',    label: 'Bass',    color: '#2f6bff', count: 9,  size: 0.21, lane: 'bass' },
  { id: 'piano',   label: 'Piano',   color: '#9fb0ff', count: 9,  size: 0.16, lane: 'mel' },
  { id: 'guitar',  label: 'Guitar',  color: '#ff8a3d', count: 8,  size: 0.17, lane: 'mel' },
  { id: 'bell',    label: 'Bell',    color: '#7dff8a', count: 7,  size: 0.14, lane: 'mel' },
  { id: 'cat',     label: 'Cat',     color: '#ff6bf2', count: 2,  size: 0.2,  lane: 'cat' },
];
const CAP = 120; // max live pieces per type

// A minor pentatonic
const NOTES = {
  piano:  [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25],
  guitar: [110.0, 130.81, 146.83, 164.81, 196.0, 220.0, 261.63],
  bell:   [880.0, 1046.5, 1174.66, 1318.51, 1567.98, 1760.0],
  bass:   [55.0, 55.0, 65.41, 73.42, 82.41, 98.0],
  tom:    [98.0, 130.81, 164.81],
};

const BPM = 112;
const STEP = 60 / BPM / 4; // 16th note

const BOMB_X = -0.53, BOMB_Y = 2.45, BOMB_R = 0.72; // hangs right above the upturned ear
const FLOOR_Y = -3.2;
const GRAVITY = 4.2;

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);

// ---------- renderer / scene ----------

const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (e) {
  const el = document.getElementById('error');
  el.style.display = 'grid';
  el.textContent = 'This needs WebGL, which is not available in this browser.';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
const camDir = new THREE.Vector3(0, 0.1, 1).normalize();
const camBase = new THREE.Vector3();
const camTarget = new THREE.Vector3(0, 0.3, 0);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = Math.max(3.85 / t, 3.0 / (t * camera.aspect)) * 1.04;
  camBase.copy(camDir).multiplyScalar(dist).add(camTarget);
  camera.position.copy(camBase);
  camera.lookAt(camTarget);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

scene.add(new THREE.HemisphereLight(0xffffff, 0x35206a, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 5);
scene.add(sun);
const flashLight = new THREE.PointLight(0xffe2a8, 0, 14);
flashLight.position.set(BOMB_X, BOMB_Y, 0.5);
scene.add(flashLight);

// ---------- the head: a flat picture cut-out, lying on its side ----------
// Only the bomb and the confetti live in 3D. The head is a picture lying on one stack
// of speakers (its ears), with the other stack pointing straight up under the bomb.
// Confetti drains into those speakers and is spat out of the mouth; the jaw is a
// separate scrap of the same picture that slides away.

const IMG_W = 399, IMG_H = 439;             // the picture, upright (assets/head.png is stored at 2x)
const PX = 0.012;                           // world units per picture pixel
const JAW_DROP_PX = 26;
const JAW_DROP = JAW_DROP_PX * PX;
const HEAD_X = -0.15;
const HEAD_Y = FLOOR_Y + (IMG_W / 2 - 31) * PX + 0.02; // the lower speakers' edge (x = 31) rests on the floor
// The picture is turned a quarter anticlockwise: its right-hand side (the head's own
// left ear) points up, the crown points left and the chin right.
const toWorld = (x, y) => ({ x: HEAD_X + (y - IMG_H / 2) * PX, y: HEAD_Y + (x - IMG_W / 2) * PX });

// landmarks in picture pixels
const EAR_CENTRE = toWorld(392, 188);       // just above the upturned speaker stack
const EAR_CANAL = toWorld(334, 195);        // the cone of the middle speaker
const EAR_R = 1.0;
const MOUTH = toWorld(200, 384);            // middle of the mouth line

const head = new THREE.Group();
head.position.set(HEAD_X, HEAD_Y, 0);
head.rotation.z = Math.PI / 2;
scene.add(head);
const jaw = new THREE.Group();
head.add(jaw);

// a plane covering a rectangle of picture pixels
function pxPlane(x, y, w, h, z, material, parent = head) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * PX, h * PX), material);
  m.position.set((x + w / 2 - IMG_W / 2) * PX, (IMG_H / 2 - y - h / 2) * PX, z);
  parent.add(m);
  return m;
}
// Each scrap is a premultiplied texture drawn as-is and blended the way a 2D canvas
// would do it, rather than alpha-tested: the scraps get soft edges, and the jaw melts
// into the head behind it instead of showing a cut line.
let layerCount = 0;
function layer(x, y, w, h, z, parent) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main() { vec4 c = texture2D(map, vUv); if (c.a < 0.02) discard; gl_FragColor = c; }',
    transparent: true, visible: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = pxPlane(x, y, w, h, z, mat, parent);
  mesh.renderOrder = ++layerCount; // strictly back to front
  return canvas => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace; // already the colours the screen should show
    texture.premultiplyAlpha = true;
    texture.anisotropy = 4;
    mat.uniforms.map.value = texture; mat.visible = true;
  };
}
const JAW_BOX = { x: 136, y: 370, w: 128, h: 50 };
// Back to front. First the inside of the mouth, seen through the slot the jaw leaves
// behind: two 1px-tall strips hanging from the mouth line, stretched as the jaw drops
// so they never show past the chin.
const MOUTH_TOP = 376;
const mouthGlowMat = new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
});
const mouthStrips = [[new THREE.MeshBasicMaterial({ color: 0x031202 }), -0.05], [mouthGlowMat, -0.04]].map(([mat, z]) => {
  const m = pxPlane(152, MOUTH_TOP, 98, 1, z, mat);
  m.geometry.translate(0, -0.5 * PX, 0); // hang from the top edge
  m.position.y = (IMG_H / 2 - MOUTH_TOP) * PX;
  m.renderOrder = ++layerCount;
  return m;
});
const setHead = layer(0, 0, IMG_W, IMG_H, 0);
const setJaw = layer(JAW_BOX.x, JAW_BOX.y, JAW_BOX.w, JAW_BOX.h, 0.03, jaw);

// Scissor lines, in picture pixels (SVG path syntax). The jaw is everything below the
// dark line of the mouth, across the full width of the face.
const JAW_PATH = 'M 138 373 L 160 378 L 172 381 L 185 383 L 200 384 L 215 383 L 228 381 L 240 378 L 262 373 L 262 425 L 138 425 Z';
// the slot the jaw leaves behind: a little inside the jaw's own edge, so the two overlap
const SLOT_PATH = 'M 138 376 L 160 381 L 172 384 L 185 386 L 200 387 L 215 386 L 228 384 L 240 381 L 262 376 '
  + `L 262 ${388 + JAW_DROP_PX} L 138 ${388 + JAW_DROP_PX} Z`;

const picture = new Image();
picture.onload = () => {
  const K = picture.naturalWidth / IMG_W; // texture pixels per picture pixel
  const canvas2d = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w * K; c.height = h * K;
    const g = c.getContext('2d');
    g.scale(K, K);
    return [c, g];
  };
  const [jc, j] = canvas2d(JAW_BOX.w, JAW_BOX.h);
  j.translate(-JAW_BOX.x, -JAW_BOX.y);
  j.clip(new Path2D(JAW_PATH));
  j.drawImage(picture, 0, 0, IMG_W, IMG_H);
  // the head: the same picture with the slot cut away
  const [hc, h] = canvas2d(IMG_W, IMG_H);
  h.drawImage(picture, 0, 0, IMG_W, IMG_H);
  h.globalCompositeOperation = 'destination-out';
  h.fill(new Path2D(SLOT_PATH));
  setHead(hc);
  setJaw(jc);
};
picture.src = './assets/head.png';

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(3.6, 64),
  new THREE.MeshStandardMaterial({ color: 0x2a1a55, transparent: true, opacity: 0.55, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2; floor.position.set(0.3, FLOOR_Y - 0.01, 1.2);
scene.add(floor);

// mouth animation, cut-out style: the whole jaw slides away in jerky steps
let jawOpen = 0, jawHold = 0, mouthGlow = 0;
function yap(type) {
  jawOpen = 1;
  jawHold = Math.max(jawHold, type.id === 'cat' ? 0.7 : 0.07);
  mouthGlowMat.color.copy(type.threeColor);
  mouthGlow = 1;
}
function animateHead(dt) {
  if (jawHold > 0) jawHold -= dt;
  else jawOpen = Math.max(0, jawOpen - dt * 6);
  mouthGlow = Math.max(0, mouthGlow - dt * 5);
  const shown = Math.ceil(jawOpen * 3) / 3; // three poses, no in-betweens
  jaw.position.y = -shown * JAW_DROP; // the head's own "down", which is to the right on screen
  for (const m of mouthStrips) { m.visible = shown > 0; m.scale.y = 10 + shown * JAW_DROP_PX; }
  mouthGlowMat.opacity = mouthGlow * 0.22;
}

// ---------- bomb ----------

function bombTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#2a1458'; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) {
    g.save();
    g.translate(Math.random() * 512, 20 + Math.random() * 216);
    g.rotate(Math.random() * Math.PI);
    g.fillStyle = TYPES[i % TYPES.length].color;
    g.fillRect(-9, -5, 18, 10);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const bomb = new THREE.Group();
bomb.position.set(BOMB_X, BOMB_Y, 0.6);
scene.add(bomb);
const bombBody = new THREE.Mesh(
  new THREE.SphereGeometry(BOMB_R, 48, 32),
  new THREE.MeshPhysicalMaterial({ map: bombTexture(), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 })
);
bomb.add(bombBody);
const cap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.2, 0.24, 0.2, 24),
  new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.7, roughness: 0.3 })
);
cap.position.y = BOMB_R + 0.05;
bomb.add(cap);
const fuseCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, BOMB_R + 0.12, 0),
  new THREE.Vector3(0.08, BOMB_R + 0.35, 0.02),
  new THREE.Vector3(0.28, BOMB_R + 0.5, 0),
  new THREE.Vector3(0.42, BOMB_R + 0.42, -0.04),
]);
bomb.add(new THREE.Mesh(
  new THREE.TubeGeometry(fuseCurve, 20, 0.03, 8),
  new THREE.MeshStandardMaterial({ color: 0xf2e6d0, roughness: 0.9 })
));
const spark = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0xffc040 })
);
spark.position.copy(fuseCurve.getPoint(1));
bomb.add(spark);
// generous invisible tap target
const hitTarget = new THREE.Mesh(new THREE.SphereGeometry(BOMB_R * 1.5, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
bomb.add(hitTarget);

const blast = new THREE.Mesh(
  new THREE.SphereGeometry(1, 48, 32),
  new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
);
blast.position.set(BOMB_X, BOMB_Y, 0.6);
blast.renderOrder = 10; // over the head's layers
scene.add(blast);

let bombScale = 1;      // current visual scale
let bombRearm = 0;      // seconds until it starts growing back
let blastT = 1;         // 0..1 progress of blast flash
let shake = 0;

// ---------- confetti pieces ----------

function catShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0.75); s.lineTo(-0.2, 0.42); s.lineTo(0.2, 0.42); s.lineTo(0.5, 0.75);
  s.lineTo(0.55, 0.1);
  s.absarc(0, 0, 0.55, 0.18, Math.PI - 0.18, true);
  s.lineTo(-0.5, 0.75);
  return new THREE.ShapeGeometry(s, 10);
}
function starShape() {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.3 : 0.7;
    s[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  return new THREE.ShapeGeometry(s);
}
function trapezoidShape() {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0.55); s.lineTo(0.3, 0.55); s.lineTo(0.6, -0.55); s.lineTo(-0.6, -0.55);
  s.closePath();
  return new THREE.ShapeGeometry(s);
}
const GEOMS = {
  kick:   new THREE.CircleGeometry(0.6, 20),
  snare:  new THREE.PlaneGeometry(1, 1),
  hihat:  new THREE.CircleGeometry(0.65, 3),
  piano:  new THREE.PlaneGeometry(0.55, 1.5),
  guitar: new THREE.CircleGeometry(0.7, 4),
  cat:    catShape(),
  clap:   starShape(),
  tom:    new THREE.CircleGeometry(0.6, 6),
  cowbell: trapezoidShape(),
  bass:   new THREE.PlaneGeometry(1.5, 0.6),
  bell:   new THREE.RingGeometry(0.3, 0.65, 18),
};

const dummy = new THREE.Object3D();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpColor = new THREE.Color();

for (const type of TYPES) {
  type.index = TYPES.indexOf(type);
  type.threeColor = new THREE.Color(type.color);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.15,
    emissive: type.threeColor, emissiveIntensity: 0.25,
  });
  type.mesh = new THREE.InstancedMesh(GEOMS[type.id], mat, CAP);
  type.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  type.mesh.frustumCulled = false;
  for (let i = 0; i < CAP; i++) {
    type.mesh.setMatrixAt(i, ZERO);
    tmpColor.copy(type.threeColor).offsetHSL((Math.random() - 0.5) * 0.05, 0, (Math.random() - 0.5) * 0.16);
    type.mesh.setColorAt(i, tmpColor);
  }
  type.free = Array.from({ length: CAP }, (_, i) => CAP - 1 - i);
  scene.add(type.mesh);
}

const pieces = []; // live pieces
const queue = [];  // pieces waiting in the neck, in arrival order
const rand = (a, b) => a + Math.random() * (b - a);

function spawn(type) {
  if (!type.free.length) return;
  const slot = type.free.pop();
  // direction: anywhere, biased upward
  const th = Math.random() * Math.PI * 2;
  const up = rand(-0.35, 1);
  const hr = Math.sqrt(1 - up * up);
  const speed = rand(3, 9);
  const notes = NOTES[type.id];
  pieces.push({
    type, slot, state: 'fly',
    x: BOMB_X + Math.cos(th) * hr * BOMB_R * 0.6, y: BOMB_Y + up * BOMB_R * 0.6, z: 0.6 + Math.sin(th) * hr * BOMB_R * 0.6,
    vx: Math.cos(th) * hr * speed, vy: up * speed + 1.5, vz: Math.sin(th) * hr * speed,
    rx: rand(0, 6.28), ry: rand(0, 6.28), rz: rand(0, 6.28),
    wx: rand(-9, 9), wy: rand(-9, 9), wz: rand(-4, 4),
    wall: false, q: new THREE.Quaternion(), spin: rand(0, 6.28),
    drag: rand(1.3, 3.4),
    age: 0, r: 0, a: 0, rdot: 0, speedIn: rand(0.4, 1.3),
    swirl: rand(0.3, 1.6) * (Math.random() < 0.85 ? 1 : -1),
    phase: rand(0, 6.28), flutter: rand(2, 5),
    size: type.size * rand(0.85, 1.15),
    pop: 0, life: 0,
    freq: notes ? notes[Math.floor(Math.random() * notes.length)] : 0,
  });
}

function kill(p) {
  p.type.mesh.setMatrixAt(p.slot, ZERO);
  p.type.free.push(p.slot);
  p.state = 'dead';
}

const tmpQ = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const FUNNEL_X = 0.95, FUNNEL_Y = 0.4; // the swirl is a wide, squat ellipse: a funnel seen from the side

function stepPiece(p, dt, time) {
  if (p.state === 'dead' || p.state === 'queued') return; // queued = inside the head
  if (p.state === 'rest') {
    p.life -= dt;
    if (p.life <= 0) kill(p);
    return;
  }

  if (p.state === 'ear') {
    // Caught by the ear: swirl round an invisible funnel in a tightening spiral, lying flat
    // against the picture, sinking into the middle speaker and vanishing.
    p.rdot += (-p.speedIn - p.rdot) * Math.min(1, 4 * dt);
    p.r = Math.max(0, p.r + p.rdot * dt);
    p.a += p.swirl * 1.8 / (0.25 + p.r) * dt;
    const k = Math.min(1, p.r / EAR_R);
    const tx = EAR_CANAL.x + (EAR_CENTRE.x - EAR_CANAL.x) * k + Math.cos(p.a) * p.r * FUNNEL_X;
    const ty = EAR_CANAL.y + (EAR_CENTRE.y - EAR_CANAL.y) * k + Math.sin(p.a) * p.r * FUNNEL_Y;
    const f = Math.min(1, 10 * dt);
    p.x += (tx - p.x) * f; p.y += (ty - p.y) * f;
    p.z += (0.08 + 0.3 * k - p.z) * Math.min(1, 5 * dt);
    p.spin += p.swirl * 1.5 * dt;
    p.q.slerp(tmpQ.setFromAxisAngle(Z_AXIS, p.spin), 1 - Math.exp(-8 * dt));
    if (p.r < 0.07) { p.state = 'queued'; queue.push(p); }
    return;
  }

  // free flight (both before the ear and after the mouth)
  const k = Math.exp(-p.drag * dt);
  p.vy -= GRAVITY * dt;
  p.vx *= k; p.vy *= k; p.vz *= k;
  const fl = Math.sin(time * p.flutter + p.phase) * 1.2 * dt;
  p.vx += fl * Math.cos(p.phase); p.vz += fl * Math.sin(p.phase);
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
  p.pop = Math.max(0, p.pop - dt * 4);

  if (p.state === 'out') {
    if (p.y <= FLOOR_Y + 0.02) {
      p.y = FLOOR_Y + 0.01 + Math.random() * 0.03;
      p.rx = -Math.PI / 2; p.ry = 0;
      p.state = 'rest'; p.life = rand(4, 7); p.pop = 0;
    }
    return;
  }

  // --- 'fly': flutter down in front of the picture while the ear draws everything in ---
  p.age += dt;
  if (p.z < 0.12) { p.z = 0.12; if (p.vz < 0) p.vz *= -0.3; } // the picture is solid
  const dx = EAR_CENTRE.x - p.x, dy = EAR_CENTRE.y - p.y, dz = 0.3 - p.z;
  const d = Math.hypot(dx, dy, dz) || 1e-6;
  const pull = Math.min(16, 0.5 + 1.5 * p.age * p.age) * dt / d;
  p.vx += dx * pull; p.vy += dy * pull; p.vz += dz * pull;

  const flat = Math.hypot(dx, dy);
  if (p.age > 0.5 && flat < EAR_R && p.z < 1.1) {
    p.state = 'ear';
    p.r = flat;
    p.a = Math.atan2(-dy / FUNNEL_Y, -dx / FUNNEL_X);
    p.rdot = Math.max(-2, Math.min(0, (p.vx * -dx + p.vy * -dy) / (flat || 1))); // keep its inward speed
    p.wall = true;
    p.q.setFromEuler(tmpEuler.set(p.rx, p.ry, p.rz));
  }
}

function writePiece(p) {
  dummy.position.set(p.x, p.y, p.z);
  if (p.wall) dummy.quaternion.copy(p.q);
  else dummy.rotation.set(p.rx, p.ry, p.rz);
  let s = p.size * (1 + p.pop * 1.4);
  if (p.state === 'rest') s *= Math.min(1, p.life / 0.6);
  else if (p.state === 'ear') s *= 0.3 + 0.7 * Math.min(1, p.r / 0.7); // shrinking into the canal
  else if (p.state === 'queued') s = 0;
  dummy.scale.setScalar(s);
  dummy.updateMatrix();
  p.type.mesh.setMatrixAt(p.slot, dummy.matrix);
}

// ---------- sequencer: releases queued pieces on a 16th-note grid ----------

let clockIsAudio = false;
let nextTick = 0;
let stepIndex = 0;

function clockNow() {
  const a = audioRunning();
  if (a !== clockIsAudio) { clockIsAudio = a; nextTick = 0; }
  return a ? audioTime() : performance.now() / 1000;
}

function takeFromQueue(pred) {
  const i = queue.findIndex(pred);
  return i < 0 ? null : queue.splice(i, 1)[0];
}

function release(p, when) {
  if (!p) return false;
  play(p.type.id, when, p.freq);
  p.state = 'out';
  // it went in the ear; it comes out of the mouth
  p.x = MOUTH.x + JAW_DROP * rand(0.2, 0.7);
  p.y = MOUTH.y + rand(-0.3, 0.3);
  p.z = 0.1;
  p.vx = rand(0, 2.6); p.vy = rand(0.8, 3.2); p.vz = rand(1.5, 4);
  tmpEuler.setFromQuaternion(p.q);
  p.rx = tmpEuler.x; p.ry = tmpEuler.y; p.rz = tmpEuler.z;
  p.wall = false; // tumble freely again
  p.wx = rand(-8, 8); p.wy = rand(-8, 8);
  p.drag = rand(1, 1.8);
  p.pop = 1;
  yap(p.type);
  flashLegend(p.type);
  return true;
}

function tick(when) {
  const s = stepIndex++ % 8;
  if (!queue.length) return;
  const byId = id => takeFromQueue(p => p.type.id === id);
  // drums: kick on the downbeat, snare/clap on the backbeat, hats and toys in between
  const wants = s === 0 ? ['kick'] : s === 4 ? ['snare', 'clap'] : s % 2 ? ['hihat', 'cowbell', 'tom'] : ['hihat', 'tom', 'cowbell', 'kick'];
  let drum = null;
  for (const id of wants) if ((drum = byId(id))) break;
  drum ||= takeFromQueue(p => p.type.lane === 'drum' && (s % 2 === 0 || p.type.id !== 'kick'));
  let released = release(drum, when);
  // bass: a syncopated line under the drums
  if (s === 0 || s === 3 || s === 6 || !released) {
    released = release(takeFromQueue(p => p.type.lane === 'bass'), when) || released;
  }
  // melody on 8th notes (or whenever nothing else played)
  if (s % 2 === 0 || !released) {
    released = release(takeFromQueue(p => p.type.lane === 'mel'), when) || released;
  }
  // the cat does whatever it wants
  if (!released || Math.random() < 0.2) {
    released = release(byId('cat'), when) || released;
  }
  if (!released) release(queue.shift(), when);
}

function runSequencer() {
  const now = clockNow();
  if (nextTick < now - STEP) nextTick = now + 0.02; // (re)sync after a pause
  while (nextTick <= now + 0.04) {
    tick(nextTick);
    nextTick += STEP;
  }
}

// ---------- UI ----------

const legend = document.getElementById('legend');
for (const type of TYPES) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.style.setProperty('--c', type.color);
  b.innerHTML = `<i></i>${type.label}`;
  b.addEventListener('click', () => {
    initAudio();
    const n = NOTES[type.id];
    play(type.id, audioTime() + 0.01, n ? n[Math.floor(Math.random() * n.length)] : 0);
    flashLegend(type);
    yap(type);
  });
  type.button = b;
  li.append(b);
  legend.append(li);
}
function flashLegend(type) {
  type.button.classList.add('hit');
  clearTimeout(type.hitTimer);
  type.hitTimer = setTimeout(() => type.button.classList.remove('hit'), 110);
}

function explode() {
  if (bombScale < 0.95) return;
  initAudio();
  for (const type of TYPES) for (let i = 0; i < type.count; i++) spawn(type);
  play('pow', audioTime() + 0.005);
  bombScale = 0; bombRearm = 1.2;
  blastT = 0; shake = reduceMotion ? 0 : 1.6;
  navigator.vibrate?.([60, 30, 120]);
  document.getElementById('hint').classList.add('hidden');
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function overBomb(e) {
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(hitTarget).length > 0;
}
canvas.addEventListener('pointerdown', e => { if (overBomb(e)) explode(); });
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') canvas.style.cursor = overBomb(e) && bombScale > 0.95 ? 'pointer' : '';
});
addEventListener('keydown', e => {
  if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat && e.target === document.body) { e.preventDefault(); explode(); }
});
// browsers suspend audio in background tabs; pick it back up
document.addEventListener('visibilitychange', () => { if (!document.hidden && audioTime()) initAudio(); });

// ---------- main loop ----------

let last = performance.now();
let time = 0;

function frame(nowMs) {
  const dt = Math.min(0.05, Math.max(0, (nowMs - last) / 1000));
  last = nowMs;
  time += dt;

  // bomb: bob, wobble, re-arm
  if (bombRearm > 0) bombRearm -= dt;
  else if (bombScale < 1) bombScale = Math.min(1, bombScale + dt * 2.5);
  const ease = 1 - Math.pow(1 - bombScale, 3);
  const pulse = 1 + Math.sin(time * 5) * 0.025;
  bomb.scale.setScalar(Math.max(0.0001, ease * pulse));
  bomb.position.y = BOMB_Y + Math.sin(time * 1.7) * 0.08;
  bomb.rotation.y = time * 0.5;
  bomb.rotation.z = Math.sin(time * 2.3) * 0.08;
  spark.scale.setScalar(0.7 + Math.random() * 0.9);

  // blast flash
  if (blastT < 1) {
    blastT = Math.min(1, blastT + dt * 3.5);
    blast.scale.setScalar(0.6 + blastT * 2.4);
    blast.material.opacity = (1 - blastT) * 0.8;
    flashLight.intensity = (1 - blastT) * 60;
  }

  // physics in small substeps so nothing tunnels through the wall
  const sub = dt / 2;
  for (let s = 0; s < 2; s++) for (const p of pieces) stepPiece(p, sub, time);
  runSequencer();
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    if (p.state === 'dead') { pieces[i] = pieces[pieces.length - 1]; pieces.pop(); }
    else writePiece(p);
  }
  for (const type of TYPES) type.mesh.instanceMatrix.needsUpdate = true;

  animateHead(dt);

  // camera shake
  camera.position.copy(camBase);
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 3.5);
    camera.position.x += (Math.random() - 0.5) * shake * 0.25;
    camera.position.y += (Math.random() - 0.5) * shake * 0.25;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// test hooks: ?auto explodes on load, window.konfetti exposes state
if (params.has('auto')) setTimeout(explode, 300);
window.konfetti = { explode, pieces, queue };
