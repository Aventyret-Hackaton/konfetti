// The scenery: sky, meadow, stone circle, grass, flowers, trees, hills, clouds, the wind flag,
// a windmill, a picnic, birds, butterflies, balloons and the cannon. Everything is procedural;
// there are no asset files.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Radius of the paved circle the cannon stands on. */
export const PATIO = 28;

const SKY_TOP = '#2c7bd6', SKY_MID = '#8fc6ef', SKY_HORIZON = '#dfecef';
const UP = new THREE.Vector3(0, 1, 0);
const CALM = { x: 0, z: 0 };

// Shared by everything that bends in the wind. Gusts are a fixed pattern that slides downwind by
// uScroll, and every clock is a phase accumulated in JS, so a change of wind changes how fast
// things move from here on and never where they already are.
const WIND_GLSL = `
  uniform vec2 uWind;     // eased wind, world units per second
  uniform vec2 uScroll;   // how far the gusts have travelled
  uniform float uFlutter; // clock for the small quick wobble
  float gustAt(vec2 p) {
    vec2 q = p - uScroll;
    float a = sin(q.x * 0.11 + sin(q.y * 0.07) * 1.9);
    float b = sin(q.y * 0.13 + sin(q.x * 0.09 + 1.7) * 1.6);
    float c = sin((q.x + q.y) * 0.33 + a * 1.4) * sin((q.x - q.y) * 0.27 + b);
    return clamp(0.5 + 0.3 * a * b + 0.28 * c, 0.0, 1.0);
  }
  // xy: which way and how far, in radians, a stalk rooted at p leans. z: the gust there, 0 to 1.
  // r is the stalk's own random number, so that neighbours differ.
  vec3 bendAt(vec2 p, float r) {
    float g = gustAt(p + r * 1.5);
    vec2 b = uWind * (0.1 * (0.35 + 1.1 * g) * (0.7 + 0.6 * r));
    float wobble = sin(uFlutter * (2.5 + 3.0 * r) + r * 40.0) * (0.03 + 0.012 * length(uWind) * g);
    float own = r * 37.0;
    b += vec2(cos(own), sin(own)) * (0.12 + wobble);
    float len = max(length(b), 1e-4);
    return vec3(b / len * 1.3 * (1.0 - exp(-len * 0.8)), g); // eases off: never bends flat
  }`;

/** Builds the world into `scene`. Returns `update(dt, t, wind)` and the cannon's muzzle. */
export function buildWorld(scene, renderer, grassCount) {
  // Seeded, so the scenery is the same on every visit.
  let seed = 7;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (a, b) => a + rnd() * (b - a);
  const pick = list => list[Math.floor(rnd() * list.length)];
  const tickers = []; // per-frame animations: (dt, t) => void
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  // ---- wind ----
  // `blow` is the caller's wind, eased. `air` adds the world's own breeze, which fades as real wind
  // takes over: it is what grass, trees and clouds feel. The flag follows `blow` alone, so it
  // hangs limp when the wind is off.
  const pull = new THREE.Vector2(), blow = new THREE.Vector2(), air = new THREE.Vector2();
  let airSpeed = 0;
  const windUniforms = { uWind: { value: air }, uScroll: { value: new THREE.Vector2() }, uFlutter: { value: 0 } };
  function feelWind(dt, t, wind) {
    // Eased twice, so when the wind is switched on or off the grass starts and stops moving gently
    // instead of at full speed in one frame.
    const k = 1 - Math.exp(-dt / 0.5);
    pull.x += (wind.x - pull.x) * k;
    pull.y += (wind.z - pull.y) * k;
    blow.x += (pull.x - blow.x) * k;
    blow.y += (pull.y - blow.y) * k;
    const a = 0.4 + 0.9 * Math.sin(t * 0.043) + 0.5 * Math.sin(t * 0.017 + 1.3);
    const breeze = (0.8 + 0.25 * Math.sin(t * 0.23)) * Math.max(0, 1 - blow.length() / 2.5);
    air.set(blow.x + Math.cos(a) * breeze, blow.y + Math.sin(a) * breeze);
    airSpeed = air.length();
    windUniforms.uScroll.value.addScaledVector(air, 0.9 * dt);
    windUniforms.uFlutter.value += (1 + 0.12 * airSpeed) * dt;
  }
  /** Makes a built-in material's instances lean with the wind, hinged at the ground. */
  function sways(material) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, windUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + WIND_GLSL)
        .replace('#include <project_vertex>', `
          vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
          vec3 lean = bendAt(instanceMatrix[3].xz, fract(instanceMatrix[3].x * 7.31));
          vec2 shift = lean.xy * mvPosition.y * mvPosition.y * 0.5;
          mvPosition.xz += shift;
          mvPosition.y -= dot(shift, shift) * 0.45 / max(mvPosition.y, 0.2); // leaning is lower, not longer
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
    };
    return material;
  }

  // ---- light and sky ----
  scene.fog = new THREE.Fog(SKY_HORIZON, 80, 520);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;
  scene.add(new THREE.HemisphereLight('#cfe4ff', '#8aa860', 0.85));
  // A mid-afternoon sun from the right: side light gives everything a lit and a shaded face.
  const sunDir = new THREE.Vector3(0.68, 0.56, 0.22).normalize();
  const sun = new THREE.DirectionalLight('#fff0d8', 2.5);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 40, far: 140 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(SKY_TOP) }, mid: { value: new THREE.Color(SKY_MID) }, horizon: { value: new THREE.Color(SKY_HORIZON) },
      glow: { value: new THREE.Color('#ffe6b8') }, sunDir: { value: sunDir }, drift: { value: new THREE.Vector2() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 top, mid, horizon, glow, sunDir;
      uniform vec2 drift;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 c = mix(mix(horizon, mid, smoothstep(0.0, 0.2, y)), top, smoothstep(0.12, 0.85, y));
        float s = max(dot(d, sunDir), 0.0);
        c = mix(c, glow, pow(s, 4.0) * (1.0 - smoothstep(0.0, 0.4, y)) * 0.6); // warm haze under the sun
        c += vec3(1.0, 0.86, 0.62) * (pow(s, 900.0) * 5.0 + pow(s, 40.0) * 0.3 + pow(s, 6.0) * 0.08);
        // High thin cloud, stretched across the wind.
        float wisp = fbm((d.xz / (d.y + 0.25) * 1.5 + drift) * vec2(1.0, 2.4));
        c = mix(c, vec3(1.0), smoothstep(0.5, 0.85, wisp) * smoothstep(0.04, 0.3, d.y) * 0.5);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat));
  tickers.push(dt => skyMat.uniforms.drift.value.addScaledVector(air, 0.0015 * dt));

  // ---- ground ----
  function canvasTexture(size, draw) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }
  function speckle(g, size, dots, n) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = dots[i % dots.length];
      g.globalAlpha = 0.12 + rnd() * 0.25;
      g.beginPath();
      g.arc(rnd() * size, rnd() * size, 0.5 + rnd() * 2.4, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  const meadowTex = canvasTexture(512, (g, size) => {
    g.fillStyle = '#4f8236';
    g.fillRect(0, 0, size, size);
    speckle(g, size, ['#437529', '#5f9340', '#4a7a30', '#6a9c48'], 9000);
  });
  meadowTex.repeat.set(130, 130);
  const meadow = new THREE.Mesh(new THREE.RingGeometry(PATIO + 0.55, 560, 96, 1), new THREE.MeshStandardMaterial({ map: meadowTex, roughness: 1 }));
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = -0.02;
  meadow.receiveShadow = true;
  scene.add(meadow);

  // Pale stone slabs: somewhere a crayon line shows up.
  const SLABS = 4; // per texture tile, each way; a slab is 2 units
  const stoneTex = canvasTexture(1024, (g, size) => {
    const s = size / SLABS;
    for (let i = 0; i < SLABS; i++) for (let j = 0; j < SLABS; j++) {
      g.fillStyle = pick(['#d9cfb9', '#d4cab2', '#ded6c2', '#d7cdb6', '#dbd2bd']);
      g.fillRect(i * s, j * s, s, s);
    }
    speckle(g, size, ['#c9bda3', '#e3dac6', '#c5b99f', '#e9e1cf'], 30000);
    g.strokeStyle = 'rgba(112, 96, 74, 0.55)';
    g.lineWidth = 5;
    for (let i = 0; i < SLABS; i++) {
      g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, size); g.stroke();
      g.beginPath(); g.moveTo(0, i * s); g.lineTo(size, i * s); g.stroke();
    }
  });
  stoneTex.repeat.set(PATIO / SLABS, PATIO / SLABS);
  const patio = new THREE.Mesh(new THREE.CircleGeometry(PATIO, 96), new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95 }));
  patio.rotation.x = -Math.PI / 2;
  patio.receiveShadow = true;
  scene.add(patio);
  const rim = new THREE.Mesh(new THREE.RingGeometry(PATIO, PATIO + 0.6, 96, 1), new THREE.MeshStandardMaterial({ color: '#b3a58b', roughness: 1 }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.012;
  rim.receiveShadow = true;
  scene.add(rim);

  // ---- where things stand: decided before the grass, which grows around them ----
  const MILL = new THREE.Vector3(36, 0, -104);
  const POLE = new THREE.Vector3(-17.5, 0, -17.5); // the flagpole
  const AIRSHIP_FROM = -1.72, AIRSHIP_R = 210;
  // Seen from where the camera starts, no tree may stand in front of these: [x, z, half-width in radians, how far the rule reaches].
  const EYE_Z = 25;
  const sights = [[MILL.x, MILL.z, 0.1, 135], [POLE.x, POLE.z, 0.17, 400], [Math.cos(AIRSHIP_FROM) * AIRSHIP_R, Math.sin(AIRSHIP_FROM) * AIRSHIP_R, 0.08, 400]]
    .map(([x, z, half, reach]) => ({ bearing: Math.atan2(z - EYE_Z, x), half, reach }));
  const clearings = [{ x: MILL.x, z: MILL.z, r: 4.5 }]; // no grass here
  // Mushrooms grow outside the fence's arc, where they can be seen from the circle.
  const shroomSpots = [0.3, 0.95, 1.5, 2.2, 2.85, 3.3, 3.45].map(a => {
    const r = PATIO + range(1.6, 2.6), spot = { x: Math.cos(a) * r, z: Math.sin(a) * r, r: 1.3 };
    clearings.push(spot);
    return spot;
  });
  const trees = [];
  while (trees.length < 60) {
    const near = trees.length < 10, r = near ? range(40, 58) : range(58, 200), a = rnd() * Math.PI * 2, s = near ? range(1.1, 1.8) : range(1.3, 2.6);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, bearing = Math.atan2(z - EYE_Z, x), far = Math.hypot(x, z - EYE_Z);
    if (Math.hypot(x - MILL.x, z - MILL.z) < 14) continue;
    if (sights.some(v => far < v.reach && Math.abs(Math.atan2(Math.sin(bearing - v.bearing), Math.cos(bearing - v.bearing))) < v.half)) continue;
    trees.push({ x, z, s });
  }

  // ---- grass: one instanced blade, bent by the wind in the vertex shader ----
  const blade = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1, 1, 1, 4).translate(0, 0.5, 0);
  blade.index = plane.index;
  blade.setAttribute('position', plane.getAttribute('position'));
  const offsets = new Float32Array(grassCount * 3), data = new Float32Array(grassCount * 4);
  // The sun is not overhead, so a tree's shade lies to one side of it.
  const shadeX = -sunDir.x / sunDir.y, shadeZ = -sunDir.z / sunDir.y;
  for (let i = 0; i < grassCount;) {
    // Thickest near the stone circle, thinning with distance.
    const r = PATIO + 0.7 + 100 * Math.pow(rnd(), 1.6), a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (clearings.some(c => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
    let shade = 0;
    for (const tr of trees) {
      const d = Math.hypot(x - tr.x - shadeX * tr.s * 3.6, z - tr.z - shadeZ * tr.s * 3.6) / (tr.s * 2.4);
      if (d < 1) shade = Math.max(shade, Math.min(1, (1 - d) * 2.5));
    }
    const clump = 0.8 + 0.35 * Math.sin(x * 0.21 + Math.sin(z * 0.17) * 2) * Math.sin(z * 0.19 + 1); // taller and shorter patches
    offsets.set([x, shade, z], i * 3); // the blade stands on the ground, so y is free to carry the shade
    data.set([rnd() * Math.PI, range(0.5, 1.05) * clump * (1 + r / 220), range(0.12, 0.22) * (1 + r / 90), rnd()], i * 4); // yaw, height, width, random
    i++;
  }
  blade.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  blade.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
  blade.instanceCount = grassCount;
  const grassMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...windUniforms,
      uBase: { value: new THREE.Color('#2b6423') }, uTip: { value: new THREE.Color('#8fc452') },
    },
    vertexShader: `
      attribute vec3 aOffset;
      attribute vec4 aData;
      varying float vH;
      varying float vRand;
      varying float vSheen;
      varying vec3 vTint;
      #include <fog_pars_vertex>
      ${WIND_GLSL}
      void main() {
        float h = position.y, tall = aData.y;
        vH = h;
        vRand = aData.w;
        vec2 root = aOffset.xz;
        vec3 lean = bendAt(root, aData.w);
        float angle = max(length(lean.xy), 1e-3);
        // The blade curls into an arc of its own length: it neither stretches nor sinks.
        vec2 over = lean.xy / angle * tall * (1.0 - cos(angle * h)) / angle;
        float x = position.x * aData.z * (1.0 - 0.85 * h);
        vec3 p = vec3(x * cos(aData.x) + over.x, tall * sin(angle * h) / angle, x * sin(aData.x) + over.y);
        vSheen = lean.z * (0.25 + 0.09 * min(length(uWind), 9.0)); // bent grass shows its pale side
        // Slow patches of warmer and cooler green, and the shade of the trees.
        float hue = sin(root.x * 0.07 + sin(root.y * 0.09) * 1.5) * sin(root.y * 0.08 + sin(root.x * 0.06) * 1.2);
        vTint = mix(vec3(1.0), hue > 0.0 ? vec3(1.16, 1.05, 0.62) : vec3(0.74, 0.96, 0.94), abs(hue) * 0.85) * (1.0 - 0.42 * aOffset.y);
        vec4 mvPosition = modelViewMatrix * vec4(p + vec3(root.x, 0.0, root.y), 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uBase, uTip;
      varying float vH;
      varying float vRand;
      varying float vSheen;
      varying vec3 vTint;
      #include <fog_pars_fragment>
      void main() {
        vec3 c = mix(uBase, uTip, vH) * (0.82 + 0.36 * vRand) * vTint;
        c = mix(c, c * vec3(1.15, 1.02, 0.6), step(0.82, vRand) * 0.6); // a few dry blades
        c += vec3(0.2, 0.22, 0.08) * vSheen * vH * vH;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const grass = new THREE.Mesh(blade, grassMat);
  grass.frustumCulled = false; // the blades are placed in the shader, so the mesh's own bounds mean nothing
  scene.add(grass);

  // ---- flowers ----
  const FLOWERS = 1400;
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.016, 1, 5, 4).translate(0, 0.5, 0), sways(new THREE.MeshLambertMaterial({ color: '#4f8a35' })), FLOWERS);
  const petals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.13, 6).rotateX(-Math.PI / 2), sways(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), FLOWERS);
  const hearts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), sways(new THREE.MeshLambertMaterial({ color: '#ffc93c' })), FLOWERS);
  const petalColors = ['#ffffff', '#fff2a8', '#ff9ec4', '#c9a2ff', '#ff7a6b', '#9ad0ff', '#ffffff', '#ff5a4e'].map(c => new THREE.Color(c));
  for (let i = 0; i < FLOWERS; i++) {
    const r = PATIO + 0.9 + 55 * Math.pow(rnd(), 1.4), a = rnd() * Math.PI * 2, h = range(0.7, 1.25);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    dummy.position.set(x, 0, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, h, 1); dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);
    const s = range(0.8, 1.5);
    dummy.position.y = h; dummy.rotation.set(range(-0.4, 0.4), rnd() * 6, range(-0.4, 0.4)); dummy.scale.set(s, s, s); dummy.updateMatrix();
    petals.setMatrixAt(i, dummy.matrix);
    petals.setColorAt(i, pick(petalColors));
    dummy.position.y = h + 0.02; dummy.scale.set(s, s * 0.6, s); dummy.updateMatrix();
    hearts.setMatrixAt(i, dummy.matrix);
  }
  for (const m of [stems, petals, hearts]) m.frustumCulled = false; // they lean out of their resting bounds
  scene.add(stems, petals, hearts);

  // ---- trees ----
  /** Vertex colours from `low` at the bottom of a geometry to `high` at the top, each part with its own tint. */
  function shadeByHeight(parts, low, high) {
    const geo = mergeGeometries(parts);
    geo.computeBoundingBox();
    const { min, max } = geo.boundingBox, pos = geo.getAttribute('position');
    const colors = new Float32Array(pos.count * 3), a = new THREE.Color(low), b = new THREE.Color(high);
    let v = 0;
    for (const part of parts) {
      const tint = range(0.88, 1.1);
      for (let n = part.getAttribute('position').count; n > 0; n--, v++) {
        const k = (pos.getY(v) - min.y) / (max.y - min.y);
        tmpColor.copy(a).lerp(b, k * k * (3 - 2 * k)).multiplyScalar(tint).toArray(colors, v * 3);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geo;
  }
  /** A lumpy ball of leaves. The lumps depend only on position, so that faces stay joined. */
  function blob(x, y, z, r, squash = 1) {
    const geo = new THREE.IcosahedronGeometry(r, 1), pos = geo.getAttribute('position'), p = rnd() * 6;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i) / r, py = pos.getY(i) / r, pz = pos.getZ(i) / r;
      const k = 1 + 0.2 * Math.sin(px * 3.3 + p) * Math.sin(py * 2.9 + p * 2) + 0.12 * Math.sin(pz * 4.1 + p * 3);
      pos.setXYZ(i, px * r * k + x, py * r * k * squash + y, pz * r * k + z);
    }
    return geo;
  }
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const barkMat = new THREE.MeshStandardMaterial({ color: '#7a5636', roughness: 1 });
  const birchMat = new THREE.MeshStandardMaterial({ color: '#ece6da', roughness: 0.9 });
  const GREENS = [['#2d6a2c', '#86c257'], ['#356f30', '#a3cc5c'], ['#27623a', '#6fb565'], ['#4a7a2a', '#c0cf5e']];
  const BLOSSOM = ['#c9608c', '#ffd3e2'];
  const kinds = {
    oak(s) {
      const parts = [blob(0, 1.5 * s, 0, 1.7 * s, 0.9)];
      for (let i = 0, n = 5 + Math.floor(rnd() * 4); i < n; i++) {
        const a = (i + rnd() * 0.7) / n * Math.PI * 2, d = range(0.8, 1.35) * s;
        parts.push(blob(Math.cos(a) * d, range(0.6, 2.3) * s, Math.sin(a) * d, range(0.85, 1.3) * s));
      }
      return { trunk: [0.2, 0.42, 2.8], top: 2.4, parts, colors: rnd() < 0.09 ? BLOSSOM : pick(GREENS) };
    },
    birch(s) {
      const parts = [];
      for (let i = 0; i < 6; i++) {
        const a = rnd() * Math.PI * 2, d = range(0, 0.55) * s;
        parts.push(blob(Math.cos(a) * d, (0.3 + i * 0.62) * s, Math.sin(a) * d, range(0.7, 1.0) * s * (1 - i * 0.07), 1.2));
      }
      return { trunk: [0.1, 0.17, 4.4], top: 3.6, parts, colors: ['#5a9a34', '#bfdc70'], bark: birchMat };
    },
    poplar(s) {
      const parts = [];
      for (let i = 0; i < 5; i++) parts.push(blob(range(-0.15, 0.15) * s, (0.6 + i * 1.05) * s, range(-0.15, 0.15) * s, (0.95 - Math.abs(i - 1.5) * 0.14) * s, 1.5));
      return { trunk: [0.16, 0.24, 1.8], top: 1.4, parts, colors: ['#285f33', '#7ab552'] };
    },
    pine(s) {
      const parts = [], tiers = 5 + Math.floor(rnd() * 2);
      for (let i = 0; i < tiers; i++) {
        const k = i / tiers, r = (1.75 - 1.3 * k) * s, h = (1.9 - 0.6 * k) * s;
        const cone = new THREE.ConeGeometry(r, h, 9, 1, true), pos = cone.getAttribute('position');
        // Boughs hang unevenly at the rim.
        for (let j = 0; j < pos.count; j++) if (pos.getY(j) < 0) pos.setY(j, pos.getY(j) - Math.abs(Math.sin(Math.atan2(pos.getZ(j), pos.getX(j)) * 4.5 + i)) * 0.3 * s);
        parts.push(cone.rotateY(rnd() * 6).translate(range(-0.08, 0.08) * s, (0.7 + i * 0.85) * s, range(-0.08, 0.08) * s));
      }
      return { trunk: [0.16, 0.27, 1.8], top: 1.2, parts, colors: pick([['#1f4f38', '#4f9460'], ['#234f30', '#5f9a52']]), side: THREE.DoubleSide };
    },
  };
  const pineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
  const crowns = [];
  for (const { x, z, s } of trees) {
    const kind = pick(['oak', 'oak', 'oak', 'birch', 'poplar', 'pine', 'pine']);
    const { trunk: [r0, r1, th], top, parts, colors, bark = barkMat, side } = kinds[kind](kind === 'pine' ? s * 1.15 : s);
    const k = kind === 'pine' ? s * 1.15 : s;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r0 * k, r1 * k, th * k, 7).translate(0, th * k / 2, 0), bark);
    const crown = new THREE.Mesh(shadeByHeight(parts, colors[0], colors[1]), side ? pineMat : leafMat);
    crown.position.y = top * k;
    const tree = new THREE.Group();
    tree.add(trunk, crown);
    tree.position.set(x, 0, z);
    scene.add(tree);
    crowns.push({ crown, phase: rnd() * 6 });
  }
  tickers.push((dt, t) => {
    const sway = 0.01 + airSpeed * 0.005;
    for (const c of crowns) {
      c.crown.rotation.z = Math.sin(t * 1.1 + c.phase) * sway - air.x * 0.005;
      c.crown.rotation.x = Math.cos(t * 0.9 + c.phase) * sway + air.y * 0.005;
    }
  });

  // ---- rocks ----
  const rockMat = new THREE.MeshStandardMaterial({ color: '#93948c', roughness: 0.95, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(range(0.4, 1.3), 0), rockMat);
    const r = range(PATIO + 2.6, PATIO + 16), a = rnd() * Math.PI * 2;
    rock.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    rock.scale.set(1, range(0.45, 0.8), range(0.7, 1.2));
    rock.rotation.set(rnd(), rnd() * 6, rnd());
    rock.castShadow = true;
    scene.add(rock);
  }

  // ---- a fence round the back of the circle ----
  const fenceMat = new THREE.MeshStandardMaterial({ color: '#f1eadb', roughness: 0.85 });
  const POSTS = 30, FENCE_R = PATIO + 1.7, FENCE_FROM = -Math.PI / 2 - 1.15, FENCE_STEP = 2.3 / (POSTS - 1);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.17, 1.35, 0.17).translate(0, 0.675, 0), fenceMat, POSTS);
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.11, 0.05), fenceMat, (POSTS - 1) * 2);
  const chord = 2 * FENCE_R * Math.sin(FENCE_STEP / 2);
  for (let i = 0; i < POSTS; i++) {
    const a = FENCE_FROM + i * FENCE_STEP;
    dummy.position.set(Math.cos(a) * FENCE_R, 0, Math.sin(a) * FENCE_R);
    dummy.rotation.set(0, -a, range(-0.04, 0.04));
    dummy.scale.set(1, range(0.95, 1.05), 1);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
    if (i === POSTS - 1) break;
    const m = a + FENCE_STEP / 2, mr = FENCE_R * Math.cos(FENCE_STEP / 2);
    for (const [n, y] of [[0, 0.55], [1, 1.05]]) {
      dummy.position.set(Math.cos(m) * mr, y, Math.sin(m) * mr);
      dummy.rotation.set(0, -m - Math.PI / 2, 0);
      dummy.scale.set(chord, 1, 1);
      dummy.updateMatrix();
      rails.setMatrixAt(i * 2 + n, dummy.matrix);
    }
  }
  posts.castShadow = rails.castShadow = true;
  scene.add(posts, rails);

  // ---- mushrooms at the edge of the grass ----
  const SHROOMS = shroomSpots.length * 4;
  const shroomStems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 8).translate(0, 0.25, 0), new THREE.MeshStandardMaterial({ color: '#f3ecdc', roughness: 0.8 }), SHROOMS);
  const shroomCaps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.45, 0), new THREE.MeshStandardMaterial({ roughness: 0.5 }), SHROOMS);
  const capColors = ['#e03a2e', '#e03a2e', '#f08a2c', '#c9a27a'].map(c => new THREE.Color(c));
  for (let i = 0; i < SHROOMS; i++) {
    const spot = shroomSpots[i >> 2], s = range(0.7, 1.6);
    dummy.position.set(spot.x + range(-0.7, 0.7), 0, spot.z + range(-0.7, 0.7));
    dummy.rotation.set(range(-0.15, 0.15), rnd() * 6, range(-0.15, 0.15));
    dummy.scale.set(s, s * range(0.9, 1.4), s);
    dummy.updateMatrix();
    shroomStems.setMatrixAt(i, dummy.matrix);
    shroomCaps.setMatrixAt(i, dummy.matrix);
    shroomCaps.setColorAt(i, pick(capColors));
  }
  shroomStems.castShadow = shroomCaps.castShadow = true;
  scene.add(shroomStems, shroomCaps);

  // ---- far hills ----
  for (let i = 0; i < 20; i++) {
    const far = i % 2, a = (i / 20) * Math.PI * 2 + range(-0.12, 0.12), r = far ? range(370, 420) : range(270, 320);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshLambertMaterial({ color: tmpColor.set(far ? '#6c9a78' : '#5f9150').offsetHSL(range(-0.02, 0.02), 0, range(-0.03, 0.03)).clone() }));
    hill.position.set(Math.cos(a) * r, -8, Math.sin(a) * r);
    hill.scale.set(range(80, 140), far ? range(34, 58) : range(18, 34), range(70, 120));
    scene.add(hill);
  }

  // ---- clouds ----
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: sunDir }, under: { value: new THREE.Color('#9fb6d6') }, haze: { value: new THREE.Color(SKY_HORIZON) } },
    vertexShader: `
      varying vec3 vNormal;
      varying float vDist;
      void main() {
        vNormal = mat3(modelMatrix) * normal;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDist = distance(world.xyz, cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform vec3 sunDir, under, haze;
      varying vec3 vNormal;
      varying float vDist;
      void main() {
        vec3 n = normalize(vNormal);
        float lit = 0.5 + 0.5 * dot(n, sunDir);
        vec3 c = mix(under, vec3(1.0), smoothstep(0.25, 0.8, lit * 0.55 + (0.5 + 0.5 * n.y) * 0.5));
        c += vec3(0.1, 0.06, 0.0) * pow(lit, 3.0);
        c = mix(c, haze, smoothstep(250.0, 900.0, vDist) * 0.6); // far clouds melt into the horizon
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const CLOUD_SPAN = 640;
  const clouds = [];
  for (let i = 0; i < 18; i++) {
    const puffs = [], n = 6 + Math.floor(rnd() * 5), size = range(9, 15);
    for (let j = 0; j < n; j++) {
      const u = j / (n - 1) * 2 - 1, r = size * (0.55 + 0.6 * (1 - u * u)) * range(0.85, 1.15);
      puffs.push(new THREE.IcosahedronGeometry(r, 2).scale(1, 0.8, 1).translate(u * n * size * 0.42, r * 0.35 + range(-1, 2), range(-0.5, 0.5) * size));
      if (rnd() < 0.45) puffs.push(new THREE.IcosahedronGeometry(r * 0.7, 2).translate(u * n * size * 0.42 + range(-3, 3), r * 0.95, range(-0.4, 0.4) * size));
    }
    const geo = mergeGeometries(puffs), pos = geo.getAttribute('position');
    for (let v = 0; v < pos.count; v++) if (pos.getY(v) < 0) pos.setY(v, pos.getY(v) * 0.15); // a flat base
    const cloud = new THREE.Mesh(geo, cloudMat);
    cloud.position.set(range(-CLOUD_SPAN, CLOUD_SPAN), range(60, 120), range(-CLOUD_SPAN, CLOUD_SPAN));
    cloud.rotation.y = range(-0.4, 0.4);
    cloud.scale.setScalar(range(1, 2));
    scene.add(cloud);
    clouds.push(cloud);
  }
  tickers.push(dt => {
    for (const c of clouds) {
      const p = c.position;
      p.x += (0.6 + air.x * 0.5) * dt; // they drift on their own in still air
      p.z += air.y * 0.5 * dt;
      if (p.x > CLOUD_SPAN) p.x -= CLOUD_SPAN * 2; else if (p.x < -CLOUD_SPAN) p.x += CLOUD_SPAN * 2;
      if (p.z > CLOUD_SPAN) p.z -= CLOUD_SPAN * 2; else if (p.z < -CLOUD_SPAN) p.z += CLOUD_SPAN * 2;
    }
  });

  // ---- a windmill on the far side: its sails turn with the wind ----
  /** Colours a geometry in `n` stripes around the y axis. */
  function striped(geo, colors, n) {
    geo = geo.toNonIndexed();
    const pos = geo.getAttribute('position'), out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 3) {
      const a = Math.atan2(pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2), pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / (Math.PI * 2) + 0.5;
      tmpColor.set(colors[Math.floor(a * n) % colors.length]);
      for (let j = 0; j < 3; j++) tmpColor.toArray(out, (i + j) * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
    return geo;
  }
  const mill = new THREE.Group();
  const plaster = new THREE.MeshStandardMaterial({ color: '#f4ecda', roughness: 0.9, flatShading: true });
  const roof = new THREE.MeshStandardMaterial({ color: '#b4513c', roughness: 0.8, flatShading: true });
  const timber = new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.9 });
  const sailcloth = new THREE.MeshStandardMaterial({ color: '#fbf6ea', roughness: 0.9, side: THREE.DoubleSide });
  mill.add(new THREE.Mesh(new THREE.CylinderGeometry(2, 3.4, 11, 8).translate(0, 5.5, 0), plaster));
  mill.add(new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.8, 8).translate(0, 12.4, 0), roof));
  mill.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.3).translate(0, 1.1, 3.25), timber));
  const rotor = new THREE.Group();
  rotor.position.set(0, 11, 2.7);
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 10).rotateX(Math.PI / 2), timber));
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 8, 0.22).translate(0, 4, 0), timber));
    arm.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 6, 0.06).translate(0.85, 4.8, 0), sailcloth));
    arm.rotation.z = i * Math.PI / 2;
    rotor.add(arm);
  }
  mill.add(rotor);
  mill.position.copy(MILL);
  mill.lookAt(0, 0, 0); // the sails face the circle
  scene.add(mill);
  tickers.push(dt => { rotor.rotation.z -= (0.2 + airSpeed * 0.2) * dt; });

  // ---- a hot-air balloon, far off ----
  const airship = new THREE.Group();
  const envelope = [[0.01, 0], [1.2, 0.3], [3.2, 2.2], [5.6, 5.5], [6.9, 9], [6.9, 11.8], [5.6, 14.6], [3.2, 16.6], [0.01, 17.3]].map(([r, y]) => new THREE.Vector2(r, y));
  airship.add(new THREE.Mesh(striped(new THREE.LatheGeometry(envelope, 16), ['#ff4b5c', '#ffe14d', '#3d7bff', '#fbf6ea'], 16), new THREE.MeshLambertMaterial({ vertexColors: true })));
  airship.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.3, 1.6).translate(0, -1.6, 0), new THREE.MeshLambertMaterial({ color: '#9a6a3d' })));
  airship.add(new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.85, 1.1, 8, 1, true).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: '#4a3a2a', wireframe: true })));
  scene.add(airship);
  let airshipAngle = AIRSHIP_FROM;
  tickers.push((dt, t) => {
    airshipAngle += 0.0025 * dt;
    airship.position.set(Math.cos(airshipAngle) * AIRSHIP_R, 20 + Math.sin(t * 0.15) * 2.5, Math.sin(airshipAngle) * AIRSHIP_R);
    airship.rotation.y = t * 0.03;
  });

  // ---- birds ----
  const wing = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, 0, 0, -0.3, 1.5, 0, -0.45], 3));
  const birdMat = new THREE.MeshBasicMaterial({ color: '#39404d', side: THREE.DoubleSide });
  const birds = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group(), right = new THREE.Mesh(wing, birdMat), left = new THREE.Mesh(wing, birdMat), mirror = new THREE.Group();
    mirror.scale.x = -1;
    mirror.add(left);
    g.add(right, mirror);
    scene.add(g);
    const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1; // a V behind the leader
    birds.push({ g, right, left, back: row * 0.03, out: side * row * 2.6, phase: rnd() * 6 });
  }
  tickers.push((dt, t) => {
    for (const b of birds) {
      const a = -1.2 + t * 0.045 - b.back, r = 105 + b.out + Math.sin(t * 0.21) * 14;
      b.g.position.set(Math.cos(a) * r, 19 + Math.sin(t * 0.3 + b.phase) * 0.8 + Math.sin(a * 2) * 3, Math.sin(a) * r);
      b.g.rotation.y = -a; // flying along the circle
      b.right.rotation.z = b.left.rotation.z = Math.sin(t * 6.5 + b.phase) * 0.6 + 0.15;
    }
  });

  // ---- a picnic at the edge of the circle ----
  const picnic = new THREE.Group();
  const gingham = canvasTexture(256, (g, size) => {
    const s = size / 8;
    g.fillStyle = '#fbf6ea';
    g.fillRect(0, 0, size, size);
    g.fillStyle = 'rgba(226, 58, 74, 0.55)'; // two passes overlap into the darker squares
    for (let i = 0; i < 8; i += 2) { g.fillRect(i * s, 0, s, size); g.fillRect(0, i * s, size, s); }
  });
  gingham.repeat.set(2, 1.5);
  const blanket = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.3).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: gingham, roughness: 1 }));
  blanket.position.y = 0.03;
  blanket.receiveShadow = true;
  const wicker = new THREE.MeshStandardMaterial({ color: '#c59555', roughness: 0.8 });
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.55, 14).translate(0, 0.3, 0), wicker);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 20, Math.PI).translate(0, 0.55, 0), wicker);
  basket.position.set(-1, 0, -0.5);
  handle.position.copy(basket.position);
  const ball = new THREE.Mesh(striped(new THREE.SphereGeometry(0.42, 18, 12), ['#ff4b5c', '#fbf6ea', '#3d7bff', '#fbf6ea', '#ffe14d', '#fbf6ea'], 6), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 }));
  ball.position.set(1.1, 0.45, 0.6);
  ball.rotation.set(0.5, 0, 0.4);
  picnic.add(blanket, basket, handle, ball);
  for (const [x, z, c] of [[0.1, 0.3, '#d8342c'], [0.45, 0.1, '#8fc43c'], [0.2, -0.15, '#d8342c']]) {
    const apple = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 }));
    apple.position.set(x, 0.15, z);
    picnic.add(apple);
  }
  picnic.traverse(o => { if (o.isMesh && o !== blanket) o.castShadow = true; });
  picnic.position.set(17.5, 0, -18.5);
  picnic.rotation.y = 0.5;
  scene.add(picnic);

  // ---- the wind flag: a pennant that lifts, streams downwind and ripples faster as it blows ----
  const POLE_TOP = 11, FLAG_LONG = 6.4, FLAG_HIGH = 3.4, NU = 30, NV = 10;
  const poleMat = new THREE.MeshStandardMaterial({ color: '#f6f2ea', roughness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, POLE_TOP + 0.2, 10).translate(0, (POLE_TOP + 0.2) / 2, 0), poleMat);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10).translate(0, POLE_TOP + 0.35, 0), new THREE.MeshStandardMaterial({ color: '#e9b23a', roughness: 0.25, metalness: 1 }));
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.3, 14).translate(0, 0.15, 0), new THREE.MeshStandardMaterial({ color: '#a89a82', roughness: 1 }));
  for (const m of [pole, knob, foot]) { m.position.copy(POLE); m.castShadow = true; scene.add(m); }
  const bunting = canvasTexture(512, (g, size) => {
    ['#ff4b5c', '#ffe14d', '#3d7bff'].forEach((c, i) => { g.fillStyle = c; g.fillRect(0, i * size / 3, size, size / 3 + 1); });
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 46; i++) { g.beginPath(); g.arc(rnd() * size, rnd() * size, 9 + rnd() * 7, 0, 7); g.fill(); }
  });
  const cloth = new THREE.PlaneGeometry(1, 1, NU, NV); // uv.x runs from the pole to the fly end
  const flag = new THREE.Mesh(cloth, new THREE.MeshStandardMaterial({ map: bunting, roughness: 0.75, side: THREE.DoubleSide }));
  flag.castShadow = true;
  flag.frustumCulled = false; // its vertices are rewritten every frame
  scene.add(flag);
  const flagDir = new THREE.Vector2(0.8, 0.6); // which way it streams; it keeps the last one when the wind dies
  let ripple = 0;
  tickers.push((dt, t) => {
    const speed = blow.length();
    if (speed > 0.05) {
      flagDir.addScaledVector(blow, Math.min(1, dt * 2.5) / speed * Math.min(1, speed));
      if (flagDir.lengthSq() < 1e-6) flagDir.set(blow.y, -blow.x); // swinging straight through the pole: go round
      flagDir.normalize();
    }
    const lift = 1 - Math.exp(-speed / 3.2);
    ripple += (0.9 + speed * 1.15) * dt;
    const droop = (1 - lift) * 1.37, wave = 0.05 + 0.4 * lift, limp = 1 - lift;
    const pos = cloth.getAttribute('position'), uv = cloth.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i), v = uv.getY(i), along = u * FLAG_LONG;
      const a = droop * (0.8 + 0.2 * u); // the fly end hangs lowest
      const out = 0.1 + along * Math.cos(a);
      // Ripples run down the cloth and grow toward the free end; a limp flag hangs in slow folds.
      const side = Math.pow(u, 0.8) * (wave * (Math.sin(along * 1.5 - ripple + v * 0.9) + 0.4 * Math.sin(along * 2.9 - ripple * 1.7 + 1.3))
        + limp * (0.3 * Math.sin(along * 2.1 + v * 3) + 0.06 * Math.sin(t * 0.8 + along)));
      const y = POLE_TOP - 0.1 - (1 - v) * FLAG_HIGH * (1 - 0.62 * u) - 0.31 * FLAG_HIGH * u // tapers to a point
        - along * Math.sin(a) + Math.pow(u, 0.8) * wave * 0.35 * Math.cos(along * 1.5 - ripple);
      pos.setXYZ(i, POLE.x + flagDir.x * out - flagDir.y * side, y, POLE.z + flagDir.y * out + flagDir.x * side);
    }
    pos.needsUpdate = true;
    cloth.computeVertexNormals();
  });

  // ---- butterflies ----
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.02);
  wingShape.bezierCurveTo(0.04, 0.24, 0.3, 0.3, 0.3, 0.1);
  wingShape.bezierCurveTo(0.31, 0.02, 0.2, -0.02, 0.17, -0.03);
  wingShape.bezierCurveTo(0.24, -0.12, 0.12, -0.24, 0, -0.06);
  const wingGeo = new THREE.ShapeGeometry(wingShape, 8).rotateX(Math.PI / 2); // flat, front lobe toward +z
  const bodyGeo = new THREE.CapsuleGeometry(0.018, 0.2, 3, 6).rotateX(Math.PI / 2);
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#2b2118', roughness: 0.8 });
  const wingMats = ['#ff8a1f', '#3f8cff', '#ffe04a', '#ffffff', '#ff5fa2', '#9b6bff', '#33c9a7']
    .map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, side: THREE.DoubleSide }));
  const butterflies = [];
  for (let i = 0; i < 18; i++) {
    const g = new THREE.Group(), mat = pick(wingMats);
    const right = new THREE.Mesh(wingGeo, mat), left = new THREE.Mesh(wingGeo, mat), mirror = new THREE.Group();
    mirror.scale.x = -1;
    mirror.add(left);
    right.castShadow = left.castShadow = true;
    g.add(new THREE.Mesh(bodyGeo, bodyMat), right, mirror);
    g.scale.setScalar(range(1.1, 1.7));
    scene.add(g);
    const r = range(6, PATIO + 14), a = rnd() * Math.PI * 2;
    butterflies.push({ g, right, left, hx: Math.cos(a) * r, hz: Math.sin(a) * r, hy: range(0.9, 2.8), rx: range(2, 6), rz: range(2, 6), speed: range(0.35, 0.7), phase: rnd() * 60 });
  }
  tickers.push((dt, t) => {
    for (const b of butterflies) {
      const tt = t * b.speed + b.phase;
      const x = b.hx + Math.sin(tt) * b.rx + Math.sin(tt * 2.3) * 0.7 + air.x * 0.25;
      const z = b.hz + Math.cos(tt * 0.8) * b.rz + Math.cos(tt * 1.9) * 0.7 + air.y * 0.25;
      const y = b.hy + Math.sin(tt * 1.7) * 0.5 + Math.abs(Math.sin(t * 9 + b.phase)) * 0.12;
      b.g.lookAt(x, b.g.position.y, z); // face the way it is about to move, kept level
      b.g.position.set(x, y, z);
      b.right.rotation.z = b.left.rotation.z = 0.25 + Math.sin(t * 24 + b.phase) * 0.95;
    }
  });

  // ---- balloons: they lean with the wind ----
  const balloonGeo = new THREE.SphereGeometry(0.5, 24, 18).scale(1, 1.22, 1);
  const knotGeo = new THREE.ConeGeometry(0.07, 0.12, 8).translate(0, -0.64, 0);
  const stringMat = new THREE.LineBasicMaterial({ color: '#f4f1e8' });
  const stakeMat = new THREE.MeshStandardMaterial({ color: '#9a6a3d', roughness: 0.9 });
  const balloons = [];
  for (const [ax, az, colors] of [[-9, -8, ['#ff4b5c', '#ffe14d', '#3d7bff', '#ff6ec7', '#2fd07a']], [10.5, -10, ['#9b5cff', '#ff9233', '#29d3e6', '#ff4b5c']]]) {
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 8), stakeMat);
    stake.position.set(ax, 0.55, az);
    stake.castShadow = true;
    scene.add(stake);
    colors.forEach((color, i) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.18, transparent: true, opacity: 0.93 });
      const mesh = new THREE.Group();
      mesh.add(new THREE.Mesh(balloonGeo, mat), new THREE.Mesh(knotGeo, mat));
      mesh.children[0].castShadow = true;
      const string = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), stringMat);
      string.frustumCulled = false;
      scene.add(mesh, string);
      const a = (i / colors.length) * Math.PI * 2;
      balloons.push({ mesh, string, anchor: new THREE.Vector3(ax, 1.1, az), len: 2.6 + i * 0.42, sx: Math.cos(a) * 0.2, sz: Math.sin(a) * 0.2, phase: i * 1.7 });
    });
  }
  const lean = new THREE.Vector3();
  tickers.push((dt, t) => {
    for (const b of balloons) {
      lean.set(b.sx + air.x * 0.1 + Math.sin(t * 1.3 + b.phase) * 0.07, 1, b.sz + air.y * 0.1 + Math.cos(t * 1.1 + b.phase) * 0.07).normalize();
      b.mesh.position.copy(b.anchor).addScaledVector(lean, b.len);
      b.mesh.quaternion.setFromUnitVectors(UP, lean);
      const p = b.string.geometry.attributes.position;
      p.setXYZ(0, b.anchor.x, b.anchor.y, b.anchor.z);
      p.setXYZ(1, b.mesh.position.x - lean.x * 0.68, b.mesh.position.y - lean.y * 0.68, b.mesh.position.z - lean.z * 0.68);
      p.needsUpdate = true;
    }
  });

  // ---- the cannon ----
  const TILT = 0.35, AXLE = 0.67, BARREL = 1.55, CANNON_SCALE = 1.5; // tilt is from straight up, toward +z
  const cannon = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: '#e23a4a', roughness: 0.25, metalness: 0.35, side: THREE.DoubleSide });
  const brass = new THREE.MeshStandardMaterial({ color: '#e9b23a', roughness: 0.25, metalness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: '#9a6a3d', roughness: 0.85 });
  const iron = new THREE.MeshStandardMaterial({ color: '#30343c', roughness: 0.5, metalness: 0.7 });
  const pivot = new THREE.Group();
  pivot.position.y = AXLE;
  pivot.rotation.x = TILT;
  const profile = [[0.001, -0.4], [0.2, -0.42], [0.31, -0.33], [0.36, -0.15], [0.34, 0.05], [0.28, 0.9], [0.27, 1.25], [0.36, 1.5], [0.38, BARREL], [0.31, BARREL], [0.22, 1.2], [0.2, 0.2]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  pivot.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 36), paint));
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.21, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#15161a' }));
  bore.position.y = 0.6;
  pivot.add(bore);
  for (const [y, r] of [[-0.12, 0.365], [0.5, 0.315], [1.22, 0.285], [1.5, 0.37]]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.028, 8, 36).rotateX(Math.PI / 2), brass);
    band.position.y = y;
    pivot.add(band);
  }
  cannon.add(pivot);
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 1.25), wood);
    cheek.position.set(side * 0.44, 0.52, -0.2);
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.065, 10, 36).rotateY(Math.PI / 2), wood));
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 14).rotateZ(Math.PI / 2), iron));
    for (let i = 0; i < 4; i++) wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6).rotateX(i * Math.PI / 4), wood));
    wheel.position.set(side * 0.62, AXLE, 0);
    cannon.add(cheek, wheel);
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 10).rotateZ(Math.PI / 2), iron);
  axle.position.y = AXLE;
  const trail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 1.5), wood);
  trail.position.set(0, 0.3, -1.05);
  trail.rotation.x = -0.36;
  cannon.add(axle, trail);
  cannon.traverse(o => { if (o.isMesh) o.castShadow = true; });
  cannon.scale.setScalar(CANNON_SCALE);
  scene.add(cannon);

  const dir = new THREE.Vector3(0, Math.cos(TILT), Math.sin(TILT));
  return {
    muzzle: { pos: new THREE.Vector3(0, AXLE, 0).addScaledVector(dir, BARREL).multiplyScalar(CANNON_SCALE), dir },
    update(dt, t, wind = CALM) {
      feelWind(dt, t, wind);
      for (const tick of tickers) tick(dt, t);
    },
  };
}
