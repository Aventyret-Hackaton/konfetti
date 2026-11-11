// The scenery: sky, meadow, stone circle, grass, flowers, trees, rocks, hills, clouds,
// butterflies, balloons and the cannon. Everything is procedural; there are no asset files.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Radius of the paved circle the cannon stands on. */
export const PATIO = 28;

const SKY_TOP = '#3f8fe0', SKY_HORIZON = '#cfe6f5';
const UP = new THREE.Vector3(0, 1, 0);

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
  const tickers = []; // per-frame animations: (dt, t, wind) => void

  // ---- light and sky ----
  scene.fog = new THREE.Fog(SKY_HORIZON, 90, 430);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight('#d6eaff', '#7a9a58', 0.8));
  const sunDir = new THREE.Vector3(0.5, 0.78, 0.38).normalize();
  const sun = new THREE.DirectionalLight('#fff0d2', 2.1);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 200 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(SKY_TOP) }, horizon: { value: new THREE.Color(SKY_HORIZON) }, sunDir: { value: sunDir } },
      vertexShader: `
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 top, horizon, sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 c = mix(horizon, top, pow(max(d.y, 0.0), 0.55));
          float s = max(dot(d, sunDir), 0.0);
          c += vec3(1.0, 0.9, 0.7) * (pow(s, 700.0) * 4.0 + pow(s, 14.0) * 0.22);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
  scene.add(sky);

  // ---- ground ----
  function speckled(base, dots, extra) {
    const size = 512, c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = dots[i % dots.length];
      g.globalAlpha = 0.12 + rnd() * 0.25;
      g.beginPath();
      g.arc(rnd() * size, rnd() * size, 0.5 + rnd() * 2.4, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
    extra?.(g, size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  const meadowTex = speckled('#5c8a3c', ['#4a7a30', '#6f9c48', '#527f36', '#7aa552']);
  meadowTex.repeat.set(130, 130);
  const meadow = new THREE.Mesh(new THREE.RingGeometry(PATIO + 0.55, 560, 96, 1), new THREE.MeshStandardMaterial({ map: meadowTex, roughness: 1 }));
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = -0.02;
  meadow.receiveShadow = true;
  scene.add(meadow);

  // Pale stone slabs: somewhere a crayon line shows up.
  const stoneTex = speckled('#d6c8ac', ['#c8b99a', '#e2d6bd', '#bfae8e', '#e9dfc9'], (g, size) => {
    g.strokeStyle = 'rgba(110, 94, 72, 0.6)';
    g.lineWidth = 3;
    for (const p of [0, size / 2]) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
    }
  });
  stoneTex.repeat.set(PATIO / 2, PATIO / 2); // one texture tile is 2 x 2 slabs, each slab 2 units
  const patio = new THREE.Mesh(new THREE.CircleGeometry(PATIO, 96), new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95 }));
  patio.rotation.x = -Math.PI / 2;
  patio.receiveShadow = true;
  scene.add(patio);
  const rim = new THREE.Mesh(new THREE.RingGeometry(PATIO, PATIO + 0.6, 96, 1), new THREE.MeshStandardMaterial({ color: '#b8aa90', roughness: 1 }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.012;
  rim.receiveShadow = true;
  scene.add(rim);

  // ---- grass: one instanced blade, bent by the wind in the vertex shader ----
  const blade = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1, 1, 1, 4).translate(0, 0.5, 0);
  blade.index = plane.index;
  blade.setAttribute('position', plane.getAttribute('position'));
  const offsets = new Float32Array(grassCount * 3), data = new Float32Array(grassCount * 4);
  for (let i = 0; i < grassCount; i++) {
    // Thickest near the stone circle, thinning with distance.
    const r = PATIO + 0.7 + 100 * Math.pow(rnd(), 1.6), a = rnd() * Math.PI * 2;
    offsets.set([Math.cos(a) * r, 0, Math.sin(a) * r], i * 3);
    data.set([rnd() * Math.PI, range(0.45, 1.05) * (1 + r / 220), range(0.12, 0.22) * (1 + r / 90), rnd()], i * 4); // yaw, height, width, random
  }
  blade.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  blade.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
  blade.instanceCount = grassCount;
  const grassMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uWind: { value: new THREE.Vector2(1, 0.5) },
      uBase: { value: new THREE.Color('#3f7a2c') }, uTip: { value: new THREE.Color('#a4cf5c') },
    }]),
    vertexShader: `
      attribute vec3 aOffset;
      attribute vec4 aData;
      uniform float uTime;
      uniform vec2 uWind;
      varying float vH;
      varying float vRand;
      #include <fog_pars_vertex>
      void main() {
        float h = position.y;
        vH = h;
        vRand = aData.w;
        float x = position.x * aData.z * (1.0 - 0.85 * h);
        vec3 p = vec3(x * cos(aData.x), h * aData.y, x * sin(aData.x));
        float strength = length(uWind);
        vec2 dir = strength > 0.001 ? uWind / strength : vec2(1.0, 0.0);
        // Gusts travel across the meadow as waves, downwind.
        float wave = 0.5 + 0.5 * sin(dot(aOffset.xz, dir) * 0.3 - uTime * (1.3 + strength * 0.3) + aData.w);
        float flutter = sin(uTime * (3.0 + aData.w * 2.5) + aData.w * 40.0) * (0.04 + strength * 0.012);
        float bend = min(0.1 + strength * 0.1 * (0.3 + wave), 1.25);
        vec2 push = dir * bend + vec2(flutter, flutter * 0.7);
        float k = h * h * aData.y;
        p.xz += push * k;
        p.y -= dot(push, push) * k * 0.4; // a bent blade is lower, not longer
        vec4 mvPosition = modelViewMatrix * vec4(p + aOffset, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform vec3 uBase, uTip;
      varying float vH;
      varying float vRand;
      #include <fog_pars_fragment>
      void main() {
        vec3 c = mix(uBase, uTip, vH) * (0.8 + 0.4 * vRand);
        c = mix(c, c * vec3(1.15, 1.02, 0.6), step(0.82, vRand) * 0.6); // a few dry blades
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const grass = new THREE.Mesh(blade, grassMat);
  grass.frustumCulled = false; // the blades are placed in the shader, so the mesh's own bounds mean nothing
  scene.add(grass);
  tickers.push((dt, t, wind) => {
    grassMat.uniforms.uTime.value = t;
    grassMat.uniforms.uWind.value.set(wind.x, wind.z);
  });

  // ---- flowers ----
  const dummy = new THREE.Object3D();
  const FLOWERS = 1100;
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.016, 1, 5).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: '#4f8a35' }), FLOWERS);
  const petals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.13, 6).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), FLOWERS);
  const hearts = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshLambertMaterial({ color: '#ffc93c' }), FLOWERS);
  const petalColors = ['#ffffff', '#fff2a8', '#ff9ec4', '#c9a2ff', '#ff7a6b', '#9ad0ff'].map(c => new THREE.Color(c));
  for (let i = 0; i < FLOWERS; i++) {
    const r = PATIO + 0.9 + 55 * Math.pow(rnd(), 1.4), a = rnd() * Math.PI * 2, h = range(0.6, 1.15);
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
  scene.add(stems, petals, hearts);

  // ---- trees ----
  const bark = new THREE.MeshStandardMaterial({ color: '#7a5636', roughness: 1 });
  const leaves = ['#4f9a3e', '#5fae48', '#3f8a3a', '#74b955'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
  const needles = ['#2f6b45', '#27603f', '#3a7a4e'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
  const crowns = [];

  function broadleaf(s) {
    const tree = new THREE.Group(), crown = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.4 * s, 2.8 * s, 7), bark);
    trunk.position.y = 1.4 * s;
    crown.position.y = 2.5 * s;
    for (const [x, y, z, r] of [[0, 1.3, 0, 1.75], [1.05, 0.8, 0.3, 1.2], [-0.95, 0.9, -0.4, 1.3], [0.2, 2.25, -0.2, 1.15], [-0.1, 0.7, 0.95, 1.1], [0.3, 0.9, -1.0, 1.05]]) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), pick(leaves));
      blob.position.set(x * s, y * s, z * s);
      blob.rotation.set(rnd() * 6, rnd() * 6, 0);
      crown.add(blob);
    }
    tree.add(trunk, crown);
    crowns.push({ crown, phase: rnd() * 6 });
    return tree;
  }
  function pine(s) {
    const tree = new THREE.Group(), crown = new THREE.Group(), mat = pick(needles);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.26 * s, 1.6 * s, 6), bark);
    trunk.position.y = 0.8 * s;
    crown.position.y = 1.2 * s;
    [[1.6, 1.9, 0.6], [1.3, 1.7, 1.6], [1.0, 1.5, 2.5], [0.65, 1.4, 3.4]].forEach(([r, h, y]) => {
      const tier = new THREE.Mesh(new THREE.ConeGeometry(r * s, h * s, 8), mat);
      tier.position.y = y * s;
      crown.add(tier);
    });
    tree.add(trunk, crown);
    crowns.push({ crown, phase: rnd() * 6 });
    return tree;
  }
  for (let i = 0; i < 46; i++) {
    const r = i < 9 ? range(40, 58) : range(58, 190), a = rnd() * Math.PI * 2, s = range(1.3, 2.6);
    const tree = rnd() < 0.62 ? broadleaf(s) : pine(s * 1.15);
    tree.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    tree.rotation.y = rnd() * 6;
    scene.add(tree);
  }
  tickers.push((dt, t, wind) => {
    const sway = 0.012 + Math.hypot(wind.x, wind.z) * 0.006;
    for (const c of crowns) {
      c.crown.rotation.z = Math.sin(t * 1.1 + c.phase) * sway;
      c.crown.rotation.x = Math.cos(t * 0.9 + c.phase) * sway;
    }
  });

  // ---- rocks ----
  const rockMat = new THREE.MeshStandardMaterial({ color: '#8f918b', roughness: 0.95, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(range(0.4, 1.3), 0), rockMat);
    const r = range(PATIO + 1.5, PATIO + 16), a = rnd() * Math.PI * 2;
    rock.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    rock.scale.set(1, range(0.45, 0.8), range(0.7, 1.2));
    rock.rotation.set(rnd(), rnd() * 6, rnd());
    rock.castShadow = true;
    scene.add(rock);
  }

  // ---- far hills ----
  const hillMat = new THREE.MeshLambertMaterial({ color: '#5a8a50' });
  for (let i = 0; i < 11; i++) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), hillMat);
    const a = (i / 11) * Math.PI * 2 + range(-0.15, 0.15), r = range(300, 380);
    hill.position.set(Math.cos(a) * r, -8, Math.sin(a) * r);
    hill.scale.set(range(90, 150), range(26, 52), range(80, 130));
    scene.add(hill);
  }

  // ---- clouds ----
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', fog: false });
  const clouds = [];
  for (let i = 0; i < 12; i++) {
    const cloud = new THREE.Group();
    const puffs = 5 + Math.floor(rnd() * 4);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(range(7, 13), 2), cloudMat);
      puff.position.set((j - puffs / 2) * 9 + range(-2, 2), range(-2, 3), range(-5, 5));
      puff.scale.y = 0.62;
      cloud.add(puff);
    }
    cloud.position.set(range(-420, 420), range(95, 160), range(-420, 420));
    scene.add(cloud);
    clouds.push(cloud);
  }
  tickers.push((dt, t, wind) => {
    for (const c of clouds) {
      c.position.x += wind.x * 0.5 * dt;
      c.position.z += wind.z * 0.5 * dt;
      if (c.position.x > 440) c.position.x -= 880; else if (c.position.x < -440) c.position.x += 880;
      if (c.position.z > 440) c.position.z -= 880; else if (c.position.z < -440) c.position.z += 880;
    }
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
  tickers.push((dt, t, wind) => {
    for (const b of butterflies) {
      const tt = t * b.speed + b.phase;
      const x = b.hx + Math.sin(tt) * b.rx + Math.sin(tt * 2.3) * 0.7 + wind.x * 0.25;
      const z = b.hz + Math.cos(tt * 0.8) * b.rz + Math.cos(tt * 1.9) * 0.7 + wind.z * 0.25;
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
  tickers.push((dt, t, wind) => {
    for (const b of balloons) {
      lean.set(b.sx + wind.x * 0.1 + Math.sin(t * 1.3 + b.phase) * 0.07, 1, b.sz + wind.z * 0.1 + Math.cos(t * 1.1 + b.phase) * 0.07).normalize();
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
    update(dt, t, wind) { for (const tick of tickers) tick(dt, t, wind); },
  };
}
