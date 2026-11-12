// The scenery as a pop-up picture book: a painted ground sheet and flat watercolor cut-outs standing
// on it in layers, each with a rim of bare paper. Everything is painted in canvas or in shaders;
// there are no asset files.
import * as THREE from 'three';

/** Radius of the paved circle the cannon stands on. */
export const PATIO = 28;
/** Bare cold-press paper. */
export const PAPER = '#f6eedd';
/** The wash on the stones: pale, but far enough from paper white that a white strip stands on it. */
export const STONE = '#e0d1b4';

const UP = new THREE.Vector3(0, 1, 0);
const CALM = { x: 0, z: 0 };

const NOISE_GLSL = `
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; }
    return s;
  }`;

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
  vec3 bendAt(vec2 p, float r) {
    float g = gustAt(p + r * 1.5);
    vec2 b = uWind * (0.1 * (0.35 + 1.1 * g) * (0.7 + 0.6 * r));
    float wobble = sin(uFlutter * (2.5 + 3.0 * r) + r * 40.0) * (0.03 + 0.012 * length(uWind) * g);
    float own = r * 37.0;
    b += vec2(cos(own), sin(own)) * (0.12 + wobble);
    float len = max(length(b), 1e-4);
    return vec3(b / len * 1.3 * (1.0 - exp(-len * 0.8)), g);
  }`;

/**
 * Drawn lines that lie on the ground: `set(pts, alphas)` takes segments as [ax, ay, az, bx, by, bz, ...].
 * Each is as wide as a flat ribbon of `width` world units looks from where the camera is, but never
 * thinner on screen than `minPx` CSS pixels, so a line cannot vanish far off or at a grazing angle.
 * With `fade`, a line held at that floor pales instead of looking heavier than it is (pencil);
 * without it, the line keeps its full strength (links, rings). `maxPx` stops a pencil line from growing into a band up close.
 */
export function strokes({ color, width, minPx = 1, maxPx = 1e4, opacity = 1, fade = false }) {
  const uniforms = { uColor: { value: new THREE.Color(color) }, uWidth: { value: width }, uMinPx: { value: minPx }, uMaxPx: { value: maxPx }, uRes: { value: new THREE.Vector2(1, 1) },
    uOpacity: { value: opacity }, uFade: { value: fade ? 1 : 0 } };
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms,
    vertexShader: `
      attribute vec3 aA, aB;
      attribute vec3 aSide; // 0 at A or 1 at B; -1 or 1 across; alpha
      uniform vec2 uRes;
      uniform float uWidth, uMinPx, uMaxPx, uFade;
      varying float vAcross, vHalf, vAlpha;
      void main() {
        vec4 va = modelViewMatrix * vec4(aA, 1.0), vb = modelViewMatrix * vec4(aB, 1.0);
        // A piece that runs behind the eye is cut off just in front of it.
        float nz = -0.32;
        if (va.z > nz && vb.z < nz) va = mix(va, vb, (va.z - nz) / (va.z - vb.z));
        else if (vb.z > nz && va.z < nz) vb = mix(vb, va, (vb.z - nz) / (vb.z - va.z));
        vec4 ca = projectionMatrix * va, cb = projectionMatrix * vb;
        vec2 d = cb.xy / cb.w - ca.xy / ca.w;
        d *= uRes;
        float len = length(d);
        d = len > 1e-4 ? d / len : vec2(1.0, 0.0);
        vec2 n = vec2(-d.y, d.x);
        vec4 v = mix(va, vb, aSide.x), c = projectionMatrix * v;
        // How wide the flat ribbon looks here: its edge, projected, measured across the line.
        vec3 flatAcross = cross(vec3(0.0, 1.0, 0.0), normalize(aB - aA));
        flatAcross = length(flatAcross) > 1e-4 ? normalize(flatAcross) : vec3(1.0, 0.0, 0.0);
        vec4 e = projectionMatrix * (v + modelViewMatrix * vec4(flatAcross * uWidth * 0.5, 0.0));
        float seen = abs(dot((e.xy / e.w - c.xy / c.w) * uRes * 0.5, n));
        float half_ = clamp(seen, uMinPx * 0.5, uMaxPx * 0.5);
        vHalf = half_;
        vAcross = aSide.y * (half_ + 1.0);
        vAlpha = aSide.z * mix(1.0, clamp(seen / half_, 0.0, 1.0), uFade);
        c.xy += n * vAcross / (uRes * 0.5) * c.w;
        // the ends reach half a width past the points, so joints have no gaps (not in pencil: where two see-through pieces overlap a dot would show)
        c.xy += d * (aSide.x * 2.0 - 1.0) * half_ * 0.5 * (1.0 - uFade) / (uRes * 0.5) * c.w;
        if (va.z > nz && vb.z > nz) c = vec4(0.0, 0.0, 2.0, 1.0);
        gl_Position = c;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAcross, vHalf, vAlpha;
      void main() {
        float a = clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0) * uOpacity * vAlpha;
        if (a <= 0.003) discard;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  }));
  mesh.frustumCulled = false;
  mesh.onBeforeRender = renderer => { renderer.getDrawingBufferSize(uniforms.uRes.value); uniforms.uMinPx.value = minPx * renderer.getPixelRatio(); uniforms.uMaxPx.value = maxPx * renderer.getPixelRatio(); };
  mesh.set = (pts, alphas) => {
    const n = pts.length / 6, A = new Float32Array(n * 12), B = new Float32Array(n * 12), side = new Float32Array(n * 12), index = [];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) {
        A.set(pts.slice(i * 6, i * 6 + 3), i * 12 + k * 3);
        B.set(pts.slice(i * 6 + 3, i * 6 + 6), i * 12 + k * 3);
        side.set([k >> 1, k & 1 ? 1 : -1, alphas ? alphas[i] : 1], i * 12 + k * 3);
      }
      index.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3);
    }
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry();
    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(A, 3)); // unused by the shader; three wants one
    mesh.geometry.setAttribute('aA', new THREE.BufferAttribute(A, 3));
    mesh.geometry.setAttribute('aB', new THREE.BufferAttribute(B, 3));
    mesh.geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 3));
    mesh.geometry.setIndex(index);
  };
  return mesh;
}

/**
 * Makes a lit material paint flat: every surface faces the sun, so a thing is one wash where the
 * light reaches it and one cooler, darker wash where a shadow falls. `inject(shader)` may edit more;
 * materials given the same `inject` function share one shader program.
 */
const injects = new Map();
export function paint(mat, inject) {
  if (inject && !injects.has(inject)) injects.set(inject, injects.size + 1);
  const id = inject ? injects.get(inject) : 0;
  mat.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>',
      '#if NUM_DIR_LIGHTS > 0\n  normal = directionalLights[ 0 ].direction;\n#endif');
    if (inject) inject(shader);
  };
  mat.customProgramCacheKey = () => 'paint' + id;
  return mat;
}
const flat = opts => paint(new THREE.MeshLambertMaterial(opts));

/**
 * The rim round a solid thing: a material for a second mesh of the same geometry, which shows only
 * its back faces, pushed out by `grow`, in one flat color.
 */
export function hull(color, grow) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false });
  mat.onBeforeCompile = s => { s.vertexShader = s.vertexShader.replace('#include <begin_vertex>', `vec3 transformed = position + normalize(normal) * ${grow.toFixed(4)};`); };
  mat.customProgramCacheKey = () => 'hull' + grow;
  return mat;
}

/**
 * Builds the world into `scene`. Returns `update(dt, t, wind, camera)` and the cannon's muzzle.
 * The cut-outs turn and lean toward `camera`, so `update` needs it every frame.
 * `grassCount` is a number of grass blades; they stand in tufts of about eight, 22,500 tufts at most.
 */
export function buildWorld(scene, renderer, grassCount) {
  // Seeded, so the scenery is the same on every visit.
  const seeded = seed => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rnd = seeded(7), rndPaper = seeded(11), rndPencil = seeded(4); // their own dice, so adding grain or a seam moves no tree
  const range = (a, b) => a + rnd() * (b - a);
  const pick = list => list[Math.floor(rnd() * list.length)];
  const tickers = []; // per-frame animations: (dt, t, camera) => void
  const dummy = new THREE.Object3D();

  // ---- wind ----
  const pull = new THREE.Vector2(), blow = new THREE.Vector2(), air = new THREE.Vector2();
  let airSpeed = 0;
  const windUniforms = { uWind: { value: air }, uScroll: { value: new THREE.Vector2() }, uFlutter: { value: 0 } };
  function feelWind(dt, t, wind) {
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

  // ---- light: lit + shade add up to the painted color, shade alone is a cool transparent wash ----
  const SHADE = [0.44, 0.54, 0.6];
  scene.add(new THREE.AmbientLight(new THREE.Color().setRGB(...SHADE), Math.PI));
  const sunDir = new THREE.Vector3(0.62, 0.52, -0.4).normalize();
  const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(...SHADE.map(v => 1 - v)), Math.PI);
  sun.position.copy(sunDir).multiplyScalar(110);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -36, right: 36, top: 36, bottom: -36, near: 20, far: 220 }); // the stones and the fence: cut-outs do not cast into it
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const SKY_LOW = '#cfe9df';
  scene.fog = new THREE.Fog(SKY_LOW, 120, 760);

  // ---- painting tools ----
  const sheet = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
  const tex = (c, srgb = true) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  };
  // Pigment granulation that belongs to the thing it is on: a tile of fine speckle, sampled in world space
  // on the ground and dabbed into every cut-out, so it travels with the picture when the camera moves.
  const grain = (() => {
    const N = 256, [C, c] = sheet(N, N), img = c.createImageData(N, N);
    const v = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) v[i] = rndPaper();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      // each speck two pixels or so across: a little of its neighbours, wrapped so the tile repeats
      const at = (dx, dy) => v[((y + dy + N) % N) * N + (x + dx + N) % N];
      const g = Math.round(255 * Math.min(1, Math.max(0, 0.5 + ((at(0, 0) * 2 + at(1, 0) + at(0, 1) + at(-1, 0) + at(0, -1)) / 6 - 0.5) * 2.2)));
      img.data.set([g, g, g, 255], (y * N + x) * 4);
    }
    c.putImageData(img, 0, 0);
    const t = tex(C, false);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  /** A soft copy of a canvas: drawn small and back up again, which every browser can do (canvas `filter` is not in Safari). */
  function blurred(src, px) {
    const k = Math.max(1, px), [T, t] = sheet(Math.ceil(src.width / k), Math.ceil(src.height / k)), [B, b] = sheet(src.width, src.height);
    t.imageSmoothingQuality = b.imageSmoothingQuality = 'high';
    t.drawImage(src, 0, 0, T.width, T.height);
    b.drawImage(T, 0, 0, B.width, B.height);
    return B;
  }
  // Granulation for the cut-outs: dark specks where pigment settled in the paper's hollows, pale ones where it missed the tops.
  const speck = (() => {
    const N = 192, [C, c] = sheet(N, N), img = c.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const v = rndPaper(), dark = v > 0.5;
      img.data.set(dark ? [40, 30, 60, Math.max(0, v - 0.72) * 330] : [255, 248, 232, Math.max(0, 0.16 - v) * 190], i * 4);
    }
    c.putImageData(img, 0, 0);
    return c.createPattern(blurred(C, 1.5), 'repeat');
  })();
  /** Wet blobs of pigment, a little denser at their rims. */
  function wash(g, x0, y0, x1, y1, colors, n, rmin, rmax, alpha) {
    for (let i = 0; i < n; i++) {
      const x = range(x0, x1), y = range(y0, y1), r = range(rmin, rmax), c = pick(colors);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, rgba(c, alpha * 0.5)); gr.addColorStop(0.82, rgba(c, alpha)); gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  }
  /** Small leaf-shaped dabs in rows, like scales. */
  function dabs(g, x0, y0, x1, y1, step, colors, len, a0, a1, turn = Math.PI / 2) {
    let odd = false;
    for (let y = y0; y < y1; y += step * 0.78, odd = !odd) for (let x = x0 + (odd ? step / 2 : 0); x < x1; x += step) {
      if (rnd() < 0.2) continue;
      g.save();
      g.translate(x + range(-4, 4), y + range(-4, 4));
      g.rotate(turn + range(-0.8, 0.8));
      g.fillStyle = rgba(pick(colors), range(a0, a1));
      g.beginPath(); g.ellipse(0, 0, len * range(0.8, 1.2), len * 0.42, 0, 0, 7); g.fill();
      g.restore();
    }
  }
  const circlePath = (g, circles, grow = 0) => { g.beginPath(); for (const [x, y, r] of circles) { g.moveTo(x + r + grow, y); g.arc(x, y, Math.max(0.1, r + grow), 0, 7); } };
  const polyPath = (g, pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
  function fillShape(g, shape, grow) {
    if (shape.circles) { circlePath(g, shape.circles, grow); g.fill(); }
    for (const [x, y, rx, ry] of shape.ovals || []) { g.beginPath(); g.ellipse(x, y, rx + grow, ry + grow, 0, 0, 7); g.fill(); }
    for (const pts of shape.polys || []) {
      polyPath(g, pts); g.fill();
      if (grow > 0) { g.lineWidth = grow * 2; g.lineJoin = 'round'; g.strokeStyle = g.fillStyle; g.stroke(); }
    }
  }
  /**
   * A cut-out: `shape` painted by `painter`, on paper that shows as a ragged rim around it.
   * Color and cut are separate textures, so the rim keeps its color right up to the cut.
   */
  function cutout(w, h, shape, painter, { rim = 7, bites = 1, grainy = true } = {}) {
    const [A, a] = sheet(w, h);
    a.fillStyle = '#fff';
    fillShape(a, shape, 0);
    // The wash does not quite reach the edge everywhere.
    a.globalCompositeOperation = 'destination-out';
    for (const [x, y, r] of shape.circles || []) for (let i = 0; i < bites; i++) {
      const an = rnd() * 7;
      a.beginPath(); a.arc(x + Math.cos(an) * r, y + Math.sin(an) * r, range(1, 3), 0, 7); a.fill();
    }
    for (const pts of shape.polys || []) for (let i = 0; i < pts.length * 0.5 * bites; i++) {
      const [x, y] = pick(pts);
      a.beginPath(); a.arc(x + range(-2, 2), y + range(-2, 2), range(1.5, 4), 0, 7); a.fill();
    }
    a.globalCompositeOperation = 'source-atop';
    painter(a, w, h);
    // What the paper does to the paint, painted in: it belongs to the cut-out, so it moves with it.
    if (grainy) { a.fillStyle = speck; a.fillRect(0, 0, w, h); }
    if (grainy) {
      // pigment pools along the edge of the wash
      const [T, t] = sheet(w, h);
      t.fillStyle = '#2a2440'; t.fillRect(0, 0, w, h);
      t.globalCompositeOperation = 'destination-out';
      t.drawImage(blurred(A, 5), 0, 0);
      a.globalAlpha = 0.34; a.drawImage(T, 0, 0); a.globalAlpha = 1;
    }
    const [K, k] = sheet(w, h); // the cut, as alpha
    k.fillStyle = '#fff'; fillShape(k, shape, rim);
    const [C, c] = sheet(w, h);
    c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
    if (rim) {
      // the cut edge of the paper is a shade darker, so the rim reads against pale things behind it
      const [T, t] = sheet(w, h);
      t.fillStyle = '#7d7468'; t.fillRect(0, 0, w, h);
      t.globalCompositeOperation = 'destination-out';
      t.drawImage(blurred(K, 3), 0, 0);
      c.globalAlpha = 0.75; c.drawImage(T, 0, 0); c.globalAlpha = 1;
    }
    c.drawImage(A, 0, 0);
    const [M, m] = sheet(w, h);
    m.fillStyle = '#000'; m.fillRect(0, 0, w, h);
    m.drawImage(K, 0, 0);
    return { map: tex(C), alphaMap: tex(M, false), w, h, soft: soften(M) };
  }
  /** A small blurred copy of a cut, for the soft shadow a card drops on whatever is behind it. */
  function soften(M) {
    const [S, g] = sheet(Math.round(128 * M.width / Math.max(M.width, M.height)), Math.round(128 * M.height / Math.max(M.width, M.height)));
    g.fillStyle = '#000'; g.fillRect(0, 0, S.width, S.height);
    g.drawImage(M, 3, 3, S.width - 6, S.height - 6);
    g.drawImage(blurred(S, 3), 0, 0);
    return tex(S, false);
  }
  /** A standing card with its foot on the ground at the origin. */
  function card(art, width, { lit = true, fog = true, drop = 1, dark = 0.36 } = {}) {
    const key = lit ? 'lit' : fog ? 'plain' : 'far';
    art[key] ||= lit
      ? flat({ map: art.map, alphaMap: art.alphaMap, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({ map: art.map, alphaMap: art.alphaMap, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, fog });
    const height = width * art.h / art.w;
    art.geo ||= new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(art.geo, art[key]);
    mesh.scale.set(width, height, 1);
    if (lit) mesh.receiveShadow = true;
    if (drop && art.soft) {
      // Paper standing in front of paper: a soft shadow, down and to the left, on the layer behind.
      art.shade ||= new THREE.MeshBasicMaterial({ color: '#1f4a55', alphaMap: art.soft, transparent: true, opacity: dark, depthWrite: false, fog: false });
      const shade = new THREE.Mesh(art.geo, art.shade);
      shade.position.set(-0.065 * drop, -0.05 * drop * width / height, -0.006 * width);
      mesh.add(shade);
    }
    return mesh;
  }
  // Cards that turn on their foot to face the viewer, each a little askew like a card pushed into a slot.
  const flats = [], TILT_FROM = 0.45, TILT_FULL = 1.1, TILT_MOST = 0.93;
  function stand(mesh, x, z, { askew = 0.12, sway = 1 } = {}) {
    mesh.position.x = x; mesh.position.z = z;
    scene.add(mesh);
    flats.push({ mesh, askew: range(-askew, askew), phase: rnd() * 6, sway });
    return mesh;
  }
  tickers.push((dt, t, camera) => {
    const s = 0.008 + airSpeed * 0.004;
    for (const f of flats) {
      const p = f.mesh.position;
      const dx = camera ? camera.position.x - p.x : 0, dz = camera ? camera.position.z - p.z : 1, yaw = Math.atan2(dx, dz);
      // Seen from high up a standing card is only its top edge, so it leans back to show its face:
      // not at all below about 25 degrees, and lying nearly flat, like a pop-up book closing, from straight above.
      const elev = camera ? Math.atan2(camera.position.y, Math.hypot(dx, dz)) : 0, e = Math.min(1, Math.max(0, (elev - TILT_FROM) / (TILT_FULL - TILT_FROM)));
      // Lean with the wind as far as the wind blows across the card.
      f.mesh.rotation.set(-elev * e * e * (3 - 2 * e) * TILT_MOST, yaw + f.askew,
        f.sway * (Math.sin(t * 1.1 + f.phase) * s - (air.x * Math.cos(yaw) - air.y * Math.sin(yaw)) * 0.006), 'YXZ');
    }
  });

  // ---- sky: a flat pale wash, lighter toward the horizon ----
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#84c8d6') }, low: { value: new THREE.Color(SKY_LOW) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top, low;
      varying vec3 vDir;
      ${NOISE_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec2 p = d.xz * 4.0 + d.y * 6.0;
        float n = fbm(p * 1.1) + 0.5 * fbm(p * 3.1 + 3.0);
        vec3 c = mix(low, top, smoothstep(-0.03, 0.22, d.y + (n - 0.7) * 0.05));
        c *= 0.97 + 0.045 * n;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat));

  // The sun: a paper-white disc, a loose yellow ring and scratchy rays.
  {
    const S = 512, [C, c] = sheet(S, S), [M, m] = sheet(S, S);
    c.fillStyle = '#fffdf4'; c.fillRect(0, 0, S, S);
    m.fillStyle = '#000'; m.fillRect(0, 0, S, S);
    m.fillStyle = m.strokeStyle = '#fff';
    m.beginPath(); m.arc(256, 256, 104, 0, 7); m.fill();
    for (const g of [c, m]) {
      g.lineCap = 'round';
      if (g === c) g.strokeStyle = '#f2cf45';
      g.lineWidth = g === c ? 16 : 9;
      g.beginPath();
      for (let i = 0; i <= 60; i++) {
        const an = 0.5 + i / 60 * 5.5, r = 146 + Math.sin(i * 0.7) * 5;
        g[i ? 'lineTo' : 'moveTo'](256 + Math.cos(an) * r, 256 + Math.sin(an) * r);
      }
      g.stroke();
    }
    m.lineWidth = 2.5;
    for (let i = 0; i < 90; i++) {
      const an = rnd() * 7, r0 = range(168, 215), r1 = r0 + range(10, 34);
      m.beginPath(); m.moveTo(256 + Math.cos(an) * r0, 256 + Math.sin(an) * r0); m.lineTo(256 + Math.cos(an + 0.03) * r1, 256 + Math.sin(an + 0.03) * r1); m.stroke();
    }
    const disc = card({ map: tex(C), alphaMap: tex(M, false), w: S, h: S }, 300, { lit: false, fog: false });
    disc.position.set(sunDir.x, 0, sunDir.z).normalize().multiplyScalar(1150).y = 150; // low enough to be seen: the editor's camera cannot look far up
    disc.lookAt(0, 0, 0);
    scene.add(disc);
  }

  // ---- ground: one painted sheet. A calm pale wash for the stones, a ring of bare paper, then the meadow's washes ----
  const groundMat = paint(new THREE.MeshLambertMaterial(), shader => {
    Object.assign(shader.uniforms, {
      uG1: { value: new THREE.Color('#b9cf58') }, uG2: { value: new THREE.Color('#86bd52') }, uG3: { value: new THREE.Color('#6fb089') },
      uG4: { value: new THREE.Color('#5f9440') }, uFar: { value: new THREE.Color('#bfdccf') }, uPaper: { value: new THREE.Color(PAPER) },
      uS1: { value: new THREE.Color(STONE) }, uS2: { value: new THREE.Color('#d6c6c0') }, uS3: { value: new THREE.Color('#c7b59b') }, uGrain: { value: grain },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vGround;
        uniform vec3 uG1, uG2, uG3, uG4, uFar, uPaper, uS1, uS2, uS3;
        uniform sampler2D uGrain;
        ${NOISE_GLSL}
        vec3 groundColor(vec2 p) {
          float r = length(p);
          // the edge of a wash is never a clean circle
          float rr = r + (fbm(p * 0.45) - 0.47) * 1.4 + (fbm(p * 2.3) - 0.47) * 0.4;
          // granulation, fixed to the ground: fine speck, and a broader mottle. Both are textures, so they filter away far off instead of sparkling.
          float speck = texture2D(uGrain, p / 3.3).r - 0.5, mottle = texture2D(uGrain, p.yx / 23.0 + 0.37).r - 0.5;
          float edge = ${PATIO.toFixed(1)};
          vec3 c = uPaper * (1.0 + 0.03 * speck); // the ring of bare paper between the two
          if (rr > edge + 0.3) {
            // meadow: broad washes, darker stains with a wet edge, mottling
            float a = fbm(p * 0.03 + 3.1), b = fbm(p * 0.085 + 11.0), stain = fbm(p * 0.06 + 40.0);
            vec3 g = mix(uG1, uG2, smoothstep(0.32, 0.62, a));
            g = mix(g, uG3, smoothstep(0.5, 0.7, b) * 0.75);
            g = mix(g, uG4, smoothstep(0.55, 0.6, stain) * 0.6);
            g *= 1.0 - 0.1 * smoothstep(0.53, 0.58, stain) * (1.0 - smoothstep(0.58, 0.68, stain));
            g *= 0.9 + 0.2 * fbm(p * 0.7);
            g *= 1.0 + 0.1 * speck + 0.06 * mottle;
            g = mix(g, uFar, smoothstep(70.0, 520.0, r) * 0.8);
            c = mix(c, g * (1.0 - 0.12 * (1.0 - smoothstep(edge + 0.5, edge + 3.0, rr))), smoothstep(edge + 0.3, edge + 0.4, rr));
          } else if (rr < edge - 0.24) {
            // stones: one wash of warm sand that drifts toward a cooler grey, with a few damp stains,
            // soft blooms and the drag of a broad brush
            float tone = fbm(p * 0.06 + 17.0), damp = fbm(p * 0.1 + 90.0), bloom = fbm(p * 0.21 + 60.0), drag = fbm(vec2(p.x * 0.11, p.y * 0.9) + 31.0);
            vec3 st = mix(uS1, uS2, smoothstep(0.34, 0.7, tone) * 0.75);
            st = mix(st, uS3, smoothstep(0.54, 0.66, damp) * 0.3);
            st *= 1.0 - 0.03 * smoothstep(0.52, 0.56, damp) * (1.0 - smoothstep(0.56, 0.68, damp)); // where a wetter wash dried with an edge
            st *= 0.955 + 0.09 * bloom;
            st *= 0.985 + 0.03 * drag;
            st *= 1.0 + 0.06 * speck + 0.04 * mottle;
            st *= 1.0 - 0.13 * smoothstep(edge - 1.3, edge - 0.3, rr); // pigment pools where the wash stops
            c = mix(st, c, smoothstep(edge - 0.32, edge - 0.24, rr));
          }
          return c;
        }`)
      .replace('#include <map_fragment>', 'diffuseColor.rgb = groundColor(vGround);');
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  // A few loose pencil seams: rings round the cannon with staggered joints, drawn in broken strokes.
  // They curve, so none can be taken for a link between two strips, and they are pale graphite.
  {
    const pts = [], alphas = [], rangeP = (a, b) => a + rndPencil() * (b - a);
    /** One pencil stroke along f(u), u from 0 to 1: pressed harder in the middle, lifting at both ends. */
    const pencil = (f, length, press) => {
      const n = Math.max(2, Math.round(length / 0.45));
      let last = f(0);
      for (let i = 1; i <= n; i++) {
        const u = i / n, q = f(u);
        pts.push(last[0], 0.004, last[1], q[0], 0.004, q[1]);
        alphas.push(press * (0.35 + 0.65 * Math.sin(Math.min(1, (u - 0.5 / n) * 1.15) * Math.PI) ** 0.6) * rangeP(0.8, 1));
        last = q;
      }
    };
    const RINGS = [6.6, 13.1, 19.8, 25.2];
    RINGS.forEach((R, k) => {
      // the ring, in a few strokes with gaps between them
      for (let a = rndPencil() * 2; a < Math.PI * 2 + 0.3;) {
        const span = rangeP(0.5, 1.5) * (k ? 1 : 1.6), p1 = rndPencil() * 6, p2 = rndPencil() * 6, lean = rangeP(-0.12, 0.12), press = rangeP(0.6, 1);
        if (rndPencil() < 0.82) pencil(u => { const an = a + span * u, r = R + lean * u + 0.07 * Math.sin(an * 5 + p1) + 0.04 * Math.sin(an * 13 + p2); return [Math.cos(an) * r, Math.sin(an) * r]; }, span * R, press);
        a += span + rangeP(0.05, 0.22) * (k ? 1 : 2);
      }
      // joints out to the next ring, not quite reaching either. Every joint bows: a straight line on the stones is a link
      const out = RINGS[k + 1] || PATIO - 0.6, n = 5 + k * 3;
      for (let j = 0; j < n; j++) {
        if (rndPencil() < 0.3) continue;
        const an = (j + rangeP(0.2, 0.8)) / n * Math.PI * 2 + k, r0 = R + (out - R) * rangeP(0.04, 0.3), r1 = R + (out - R) * rangeP(0.6, 0.97), bow = rangeP(0.05, 0.13) * (rndPencil() < 0.5 ? -1 : 1) * 6.6 / R, p1 = rndPencil() * 6;
        pencil(u => { const r = r0 + (r1 - r0) * u, t = an + bow * u * u + 0.018 * Math.sin(u * 7 + p1) * 6.6 / R; return [Math.cos(t) * r, Math.sin(t) * r]; }, r1 - r0, rangeP(0.5, 0.9));
      }
    });
    const seams = strokes({ color: '#6b5d58', width: 0.042, minPx: 1, maxPx: 2.6, opacity: 0.54, fade: true });
    seams.set(pts, alphas);
    seams.renderOrder = -3;
    scene.add(seams);
  }

  // ---- where things stand ----
  const MILL = new THREE.Vector3(36, 0, -104);
  const POLE = new THREE.Vector3(-17.5, 0, -17.5); // the flagpole
  const AIRSHIP_FROM = -1.72, AIRSHIP_R = 210;
  const EYE_Z = 25;
  const sights = [[MILL.x, MILL.z, 0.1, 135], [POLE.x, POLE.z, 0.17, 400], [Math.cos(AIRSHIP_FROM) * AIRSHIP_R, Math.sin(AIRSHIP_FROM) * AIRSHIP_R, 0.08, 400]]
    .map(([x, z, half, reach]) => ({ bearing: Math.atan2(z - EYE_Z, x), half, reach }));
  const clearings = [{ x: MILL.x, z: MILL.z, r: 4.5 }];
  const shroomSpots = [0.3, 0.95, 1.5, 2.2, 2.85, 3.3, 3.45].map(a => {
    const r = PATIO + range(1.6, 2.6), spot = { x: Math.cos(a) * r, z: Math.sin(a) * r, r: 1.3 };
    clearings.push(spot);
    return spot;
  });
  const trees = [];
  while (trees.length < 70) {
    const near = trees.length < 18, r = near ? range(36, 60) : range(60, 210), a = rnd() * Math.PI * 2, s = near ? range(1.1, 1.8) : range(1.3, 2.6);
    const x = Math.cos(a) * r, z = Math.sin(a) * r, bearing = Math.atan2(z - EYE_Z, x), far = Math.hypot(x, z - EYE_Z);
    if (Math.hypot(x - MILL.x, z - MILL.z) < 14) continue;
    if (trees.some(o => Math.hypot(x - o.x, z - o.z) < 5)) continue;
    if (sights.some(v => far < v.reach && Math.abs(Math.atan2(Math.sin(bearing - v.bearing), Math.cos(bearing - v.bearing))) < v.half)) continue;
    trees.push({ x, z, s });
  }

  // ---- trees, bushes and rocks: painted cut-outs ----
  /** A crown of overlapping rounds with a scalloped edge, inside the ellipse (rx, ry) at (cx, cy). */
  function clump(cx, cy, rx, ry, big = 8, scallops = 34) {
    const m = Math.min(rx, ry), circles = [[cx, cy, m * 0.72]], bigs = [];
    for (let i = 0; i < big; i++) {
      const a = (i + rnd() * 0.6) / big * Math.PI * 2, d = range(0.3, 0.52), c = [cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, m * range(0.32, 0.44)];
      circles.push(c); bigs.push(c);
      const d2 = range(0.62, 0.72);
      circles.push([cx + Math.cos(a + 0.4) * rx * d2, cy + Math.sin(a + 0.4) * ry * d2, m * 0.27]);
    }
    for (let i = 0; i < scallops; i++) {
      const a = (i + rnd() * 0.5) / scallops * Math.PI * 2, r = range(13, 25), k = range(0.94, 1.0);
      circles.push([cx + Math.cos(a) * (rx - r) * k, cy + Math.sin(a) * (ry - r) * k, r]);
    }
    // The rounds do not quite tile: an oval inside the scallops closes the gaps they leave in the crown.
    return { circles, bigs, core: [cx, cy, rx - 26, ry - 26] };
  }
  function foliage(g, w, h, { circles, bigs, core }, top, bottom, [dark, mid, light], leaf = 9, turn) {
    g.save();
    circlePath(g, circles); g.moveTo(core[0] + core[2], core[1]); g.ellipse(...core, 0, 0, 7); g.clip();
    const gr = g.createLinearGradient(0, top, 0, bottom);
    gr.addColorStop(0, light); gr.addColorStop(0.5, mid); gr.addColorStop(1, dark);
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    wash(g, 0, top, w, bottom, [dark, mid, light, mid], 36, 22, 70, 0.4);
    // each round catches light on top and holds shade beneath
    for (const [x, y, r] of [...bigs].sort((p, q) => p[1] - q[1])) {
      g.fillStyle = rgba(dark, 0.3); g.beginPath(); g.arc(x, y + r * 0.35, r * 0.95, 0, 7); g.fill();
      g.fillStyle = rgba(light, 0.4); g.beginPath(); g.arc(x, y - r * 0.2, r * 0.8, 0, 7); g.fill();
    }
    dabs(g, 0, top, w, bottom, leaf * 2.1, [dark, dark, light, mid], leaf, 0.35, 0.8, turn);
    g.restore();
  }
  const BARK = ['#5b3c4a', '#3f2a38', '#80586a'], BIRCH = ['#ece2d2', '#5b4a50', '#fbf5ea'];
  function broadleaf(greens, { rx = 188, ry = 150, cy = 190, trunkW = 15, bark = BARK, leaf = 9 } = {}) {
    const W = 512, H = 512, cx = 256, base = 500;
    const crown = clump(cx, cy, rx, ry);
    const t = trunkW, trunk = [[cx - t * 0.7, cy], [cx + t * 0.7, cy], [cx + t, base - 60], [cx + t * 1.6, base - 14], [cx + t * 3.2, base], [cx + t * 0.8, base - 4], [cx, base - 12],
      [cx - t * 0.9, base - 3], [cx - t * 3.4, base], [cx - t * 1.6, base - 16], [cx - t, base - 60]];
    return cutout(W, H, { circles: crown.circles, ovals: [crown.core], polys: [trunk] }, (g, w, h) => {
      g.fillStyle = bark[0]; g.fillRect(0, 0, w, h);
      wash(g, cx - 60, cy, cx + 60, base, [bark[1], bark[2]], 26, 6, 26, 0.6);
      foliage(g, w, h, crown, cy - ry, cy + ry, greens, leaf);
    });
  }
  function conifer(greens) {
    const W = 384, H = 640, cx = 192, n = 5, tiers = [];
    for (let i = 0; i < n; i++) {
      const hw = 152 - i * 26, yb = 588 - i * 98, yt = yb - (205 - i * 9), pts = [[cx, yt], [cx + hw * 0.36, yt + (yb - yt) * 0.6], [cx + hw, yb]];
      const k = 5 - (i > 2);
      for (let j = 1; j <= k * 5; j++) { const u = j / (k * 5); pts.push([cx + hw - u * 2 * hw, yb - 24 * Math.abs(Math.sin(u * k * Math.PI)) + range(-2, 2)]); }
      pts.push([cx - hw * 0.36, yt + (yb - yt) * 0.6]);
      tiers.push({ pts, yt, yb, hw });
    }
    const trunk = [[cx - 11, 560], [cx + 11, 560], [cx + 15, 620], [cx + 36, 633], [cx, 628], [cx - 36, 633], [cx - 15, 620]];
    return cutout(W, H, { polys: [trunk, ...tiers.map(t => t.pts)] }, (g, w, h) => {
      g.fillStyle = BARK[0]; g.fillRect(0, 0, w, h);
      for (const { pts, yt, yb, hw } of tiers) {
        g.save(); polyPath(g, pts); g.clip();
        const gr = g.createLinearGradient(0, yt, 0, yb);
        gr.addColorStop(0, greens[2]); gr.addColorStop(0.55, greens[1]); gr.addColorStop(1, greens[0]);
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        wash(g, cx - hw, yt, cx + hw, yb, greens, 14, 14, 44, 0.4);
        g.strokeStyle = rgba(greens[0], 0.55); g.lineWidth = 2.2; g.lineCap = 'round';
        for (let i = 0; i < 46; i++) {
          const x = range(cx - hw, cx + hw), y = range(yt + 30, yb), lean = (x - cx) / hw * 9;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + lean + range(-3, 3), y + range(9, 17)); g.stroke();
        }
        g.restore();
      }
    }, { bites: 0.6 });
  }
  function bush(greens, flowers) {
    const W = 512, H = 300, crown = clump(256, 205, 225, 135, 7, 30);
    return cutout(W, H, { circles: crown.circles, ovals: [crown.core] }, (g, w, h) => {
      foliage(g, w, h, crown, 60, 300, greens, 8);
      if (flowers) for (let i = 0; i < 26; i++) {
        const x = range(60, 450), y = range(110, 280);
        g.fillStyle = PAPER; g.beginPath(); g.arc(x, y, 9.5, 0, 7); g.fill();
        g.fillStyle = pick(flowers); g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
      }
    });
  }
  function rock([dark, mid, light]) {
    const W = 512, H = 300, cx = 256, base = 300, pts = [], p1 = rnd() * 6, p2 = rnd() * 6;
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * i / 40, k = 1 + 0.13 * Math.sin(a * 5 + p1) + 0.08 * Math.sin(a * 9 + p2);
      pts.push([cx + Math.cos(a) * 225 * k, base - Math.pow(Math.sin(a), 0.7) * 215 * k]);
    }
    return cutout(W, H, { polys: [pts] }, (g, w, h) => {
      g.fillStyle = mid; g.fillRect(0, 0, w, h);
      wash(g, 0, 0, w, h, [dark, mid, light], 30, 30, 90, 0.4);
      // a lit top and a shaded foot, each one wash
      g.fillStyle = rgba(light, 0.75);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, 110);
      for (let x = w; x >= 0; x -= 24) g.lineTo(x, 120 + Math.sin(x * 0.02 + p1) * 30 + range(-5, 5));
      g.closePath(); g.fill();
      g.fillStyle = rgba(dark, 0.5);
      g.beginPath(); g.moveTo(w, h); g.lineTo(w * 0.52, h);
      for (let y = h; y >= 60; y -= 20) g.lineTo(w * 0.56 + Math.sin(y * 0.03 + p2) * 26, y);
      g.lineTo(w, 60); g.closePath(); g.fill();
      g.strokeStyle = rgba('#4a3f52', 0.55); g.lineWidth = 2;
      for (let i = 0; i < 5; i++) { const x = range(90, 420), y = range(120, 270); g.beginPath(); g.moveTo(x, y); g.lineTo(x + range(-22, 22), y + range(12, 30)); g.stroke(); }
    }, { rim: 8 });
  }

  const LEAVES = [['#2f7a52', '#4fa05a', '#9fcf62'], ['#3a8040', '#6bb04a', '#c3d95e'], ['#2a7466', '#48a07c', '#9ad39a'], ['#4d8a34', '#8fbb3e', '#dbe067']];
  const oaks = [...LEAVES.map(g => broadleaf(g)), broadleaf(['#c0527c', '#e98aa8', '#fbd3dc']), broadleaf(['#c4622e', '#e9973f', '#f6cf62'])];
  const poplars = [broadleaf(['#2d7a5a', '#55a468', '#a8d277'], { rx: 92, ry: 215, cy: 235, trunkW: 11 }), broadleaf(['#4a8a3a', '#7fb548', '#cfe06a'], { rx: 100, ry: 205, cy: 240, trunkW: 11 })];
  const birches = [broadleaf(['#6aa23a', '#a5cc4c', '#e6ea7e'], { rx: 135, ry: 150, cy: 175, trunkW: 9, bark: BIRCH, leaf: 7 })];
  const pines = [conifer(['#1f5f5f', '#2f8a7c', '#6fbfa0']), conifer(['#24584a', '#3b8a62', '#86c486']), conifer(['#2a5a78', '#3f8596', '#86c5c0'])];
  const bushes = [bush(LEAVES[0]), bush(LEAVES[3]), bush(LEAVES[2], ['#f2c53a', '#fbf4e2', '#ef7a5a']), bush(['#b9527c', '#e58aa6', '#f9cfd9'])];
  const rocks = [rock(['#7f7391', '#a79bb3', '#d3cada']), rock(['#8a7f96', '#b3a9b7', '#ddd6dc']), rock(['#a0705c', '#c79a80', '#e9cdb4'])];

  const shadeX = -sunDir.x / sunDir.y, shadeZ = -sunDir.z / sunDir.y; // where a thing's shade lies, per unit of its height
  // A cut-out's shade is a dab of wash on the ground, fixed there: it does not turn when the card turns to the viewer.
  const casters = [{ x: MILL.x, z: MILL.z, w: 7, h: 9 }];
  for (const { x, z, s } of trees) {
    const kind = pick(['oak', 'oak', 'oak', 'oak', 'birch', 'poplar', 'pine', 'pine', 'pine']);
    const art = kind === 'oak' ? (rnd() < 0.2 ? pick(oaks.slice(4)) : pick(oaks.slice(0, 4))) : kind === 'birch' ? birches[0] : kind === 'poplar' ? pick(poplars) : pick(pines);
    const width = (kind === 'pine' ? 5.4 : kind === 'oak' ? 8.2 : 7) * s;
    stand(card(art, width), x, z);
    casters.push({ x, z, w: width * (kind === 'pine' ? 0.75 : 0.8), h: width * art.h / art.w });
  }
  for (let i = 0; i < 46; i++) {
    const near = i < 26, r = near ? range(PATIO + 3.5, PATIO + 24) : range(60, 170), a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x - MILL.x, z - MILL.z) < 9 || clearings.some(c => Math.hypot(x - c.x, z - c.z) < c.r + 2)) continue;
    const isRock = rnd() < 0.42, w = isRock ? range(1.6, 4.2) : range(3, 5.5);
    stand(card(pick(isRock ? rocks : bushes), w * (near ? 1 : 1.6)), x, z, { sway: isRock ? 0 : 0.6 });
    casters.push({ x, z, w: w * (near ? 1 : 1.6) * 0.9, h: w * (near ? 1 : 1.6) * 0.5 });
    if (near) clearings.push({ x, z: z + 0.2, r: w * 0.3 });
  }
  const shadeLen = Math.hypot(shadeX, shadeZ), sdx = shadeX / shadeLen, sdz = shadeZ / shadeLen;
  for (const c of casters) { c.long = Math.min(c.h * shadeLen * 0.62, c.w * 1.7); c.wide = c.w * 0.95; } // shorter than the sun would make it: a pool under the thing, as in a picture book
  {
    // a lumpy soft-edged pool: overlapping rounds, densest in the middle
    const [C, c] = sheet(256, 128);
    c.fillStyle = '#000'; c.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 60; i++) {
      const u = range(-1, 1), v = range(-1, 1), x = 128 + u * 78, y = 64 + v * 26 * Math.sqrt(1 - u * u * 0.8), r = range(16, 34);
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.2)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
    const dabsMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#2a5a58', alphaMap: tex(C, false), transparent: true, opacity: 0.5, depthWrite: false }), casters.length);
    casters.forEach((k, i) => {
      dummy.position.set(k.x + sdx * k.long * 0.42, 0.012 + i * 0.0002, k.z + sdz * k.long * 0.42);
      dummy.rotation.set(0, Math.atan2(-sdz, sdx), 0);
      dummy.scale.set(k.long * 1.25, 1, k.wide * 1.2);
      dummy.updateMatrix();
      dabsMesh.setMatrixAt(i, dummy.matrix);
    });
    dabsMesh.renderOrder = -2;
    scene.add(dabsMesh);
  }

  // ---- grass and flowers: little painted cards that turn to the viewer and bend in the wind ----
  function sprites(count, art, cells, place, blend = false) {
    const geo = new THREE.InstancedBufferGeometry(), plane = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    const offsets = new Float32Array(count * 3), data = new Float32Array(count * 4), tints = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) place(i, offsets, data, tints);
    if (blend) {
      // Blended sprites are not sorted each frame. Drawn outermost first they come out back to front
      // for any view from the stones, which is where the editor's camera lives.
      const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.hypot(offsets[b * 3], offsets[b * 3 + 2]) - Math.hypot(offsets[a * 3], offsets[a * 3 + 2]));
      for (const [arr, n] of [[offsets, 3], [data, 4], [tints, 3]]) { const old = arr.slice(); order.forEach((from, to) => arr.set(old.subarray(from * n, from * n + n), to * n)); }
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
    geo.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide, fog: true, alphaToCoverage: !blend, transparent: blend, depthWrite: !blend,
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...windUniforms, uSoft: { value: blend ? 1 : 0 }, map: { value: art.map }, alphaMap: { value: art.alphaMap }, uCells: { value: cells }, uSize: { value: new THREE.Vector2(art.map.image.width, art.map.image.height) },
        uShade: { value: new THREE.Color().setRGB(...SHADE) } },
      vertexShader: `
        attribute vec3 aOffset; // x, shade, z
        attribute vec4 aData;   // cell, height, width, random
        attribute vec3 aTint;
        uniform float uCells;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vShade;
        #include <fog_pars_vertex>
        ${WIND_GLSL}
        void main() {
          vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
          float h = position.y * aData.y, flip = aData.w > 0.5 ? 1.0 : -1.0;
          vec3 bend = bendAt(aOffset.xz, aData.w);
          vec2 shift = bend.xy * h * position.y * 0.55;
          vec3 p = vec3(aOffset.x, 0.0, aOffset.z) + right * position.x * aData.z;
          p.xz += shift;
          p.y = h - dot(shift, shift) * 0.4 / max(h, 0.2);
          // from high up, lean back to show a face instead of an edge, as the cut-outs do
          vec3 toEye = cameraPosition - vec3(aOffset.x, 0.0, aOffset.z);
          float elev = atan(toEye.y, length(toEye.xz)), lean = elev * smoothstep(${TILT_FROM.toFixed(2)}, ${TILT_FULL.toFixed(2)}, elev) * ${TILT_MOST.toFixed(2)};
          p.xz -= normalize(toEye.xz) * sin(lean) * p.y;
          p.y *= cos(lean);
          vUv = vec2((floor(aData.x) + 0.5 + (uv.x - 0.5) * flip) / uCells, uv.y);
          vTint = aTint * (1.0 + bend.z * 0.07 * min(length(uWind), 9.0) * position.y);
          vShade = aOffset.y;
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map, alphaMap;
        uniform vec3 uShade;
        uniform vec2 uSize;
        uniform float uSoft;
        varying vec2 vUv;
        varying vec3 vTint;
        varying float vShade;
        #include <fog_pars_fragment>
        void main() {
          float raw = texture2D(alphaMap, vUv).g;
          // Near, a stroke has a clean edge. Far off, where strokes are thinner than a pixel, a hard cut would
          // make them blink on and off as they sway, so there they go in by how much of the pixel they cover: a soft wash.
          vec2 texel = vUv * uSize;
          float thin = max(length(dFdx(texel)), length(dFdy(texel)));
          float near = mix(smoothstep(0.5, 0.5 + fwidth(raw), raw), smoothstep(0.15, 0.75, raw), uSoft); // blended strokes keep the soft foot painted into them
          float a = mix(near, clamp(raw * 1.6, 0.0, 1.0), uSoft * smoothstep(0.8, 2.0, thin));
          if (a < 0.02) discard;
          vec3 c = texture2D(map, vUv).rgb * vTint * mix(vec3(1.0), uShade, vShade);
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    // Blended grass goes last: after the shades on the ground, and after the editor's links, rings and arrow (render
    // orders 2 to 5), which write no depth. A tuft only ever hides ground behind it, so drawing it over them is right.
    mesh.renderOrder = blend ? 6 : 0;
    scene.add(mesh);
  }
  /** How deep in a cut-out's shade the ground at (x, z) is, 0 to 1: the same pools as the dabs above. */
  function shadeAt(x, z) {
    let shade = 0;
    for (const c of casters) {
      const along = (x - c.x) * sdx + (z - c.z) * sdz - c.long * 0.42, across = (x - c.x) * sdz - (z - c.z) * sdx;
      const d = Math.hypot(along / (c.long * 0.5), across / (c.wide * 0.5));
      if (d < 1) shade = Math.max(shade, Math.min(1, (1 - d) * 3));
    }
    return shade;
  }
  // Tufts: a few thin strokes each.
  const TUFTS = 8;
  const tuftArt = (() => {
    const cw = 256, ch = 192, [C, c] = sheet(cw * TUFTS, ch), [M, m] = sheet(cw * TUFTS, ch);
    c.fillStyle = '#c6d6ae'; c.fillRect(0, 0, cw * TUFTS, ch); // the blades' middle tone, so their color does not pale where the sheet is seen small
    m.fillStyle = '#000'; m.fillRect(0, 0, cw * TUFTS, ch);
    for (const g of [c, m]) g.lineCap = 'round';
    for (let cell = 0; cell < TUFTS; cell++) {
      const cx = cell * cw + cw / 2, wide = cell >= 5, n = wide ? 24 : 5 + cell * 2;
      for (let i = 0; i < n; i++) {
        const u = n > 1 ? i / (n - 1) * 2 - 1 : 0, x0 = cx + u * (wide ? 100 : 26) + range(-6, 6), len = range(70, 182) * (1 - 0.3 * Math.abs(u)), sp = u * range(20, 60) + range(-14, 14);
        const lightness = range(0.82, 1), foot = ch + 2 - range(0, wide ? 26 : 8); // feet at different heights: a tuft has no hem
        // a blade is one stroke of a pointed brush: broad and dark where it touched down, running out to a pale tip
        const half = range(2.2, 3.4), side = [[], []];
        for (let k = 0; k <= 12; k++) {
          const f = k / 12, x = x0 + sp * f * f, y = foot - len * f, w = half * Math.pow(1 - f, 0.7) + 0.35;
          side[0].push([x - w, y]); side[1].unshift([x + w, y]);
        }
        const shade = c.createLinearGradient(0, foot, 0, foot - len);
        for (const [f, v] of [[0, 0.7], [0.45, 0.86], [1, 1]]) { const t = Math.round(255 * v * lightness); shade.addColorStop(f, `rgb(${t - 14},${t},${t - 40})`); }
        for (const g of [c, m]) {
          g.fillStyle = g.strokeStyle = g === c ? shade : '#fff';
          g.lineWidth = g === c ? 3 : 0.01; // the color runs a little past the cut, so no pale fringe shows
          polyPath(g, [...side[0], ...side[1]]); g.fill(); g.stroke();
        }
      }
    }
    // a stroke starts softly where the brush touched down
    const fade = m.createLinearGradient(0, ch * 0.8, 0, ch);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,0.92)');
    m.fillStyle = fade; m.fillRect(0, ch * 0.8, cw * TUFTS, ch * 0.2);
    return { map: tex(C), alphaMap: tex(M, false) };
  })();
  const TINTS = ['#7ec24c', '#64b462', '#9ccb4a', '#52a880', '#b2d254', '#86c25a'].map(c => new THREE.Color(c));
  const DRY = new THREE.Color('#c4b84a'), tint = new THREE.Color();
  const tufts = Math.round(Math.min(grassCount, 180000) / 8);
  sprites(tufts, tuftArt, TUFTS, (i, offsets, data, tints) => {
    for (;;) {
      // A thick fringe where the meadow meets the paper ring, then thinning with distance.
      const fringe = i < tufts * 0.09, r = fringe ? PATIO + range(0.35, 1.3) : PATIO + 0.9 + 105 * Math.pow(rnd(), 1.75), a = rnd() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (clearings.some(c => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
      const patch = Math.sin(x * 0.07 + Math.sin(z * 0.09) * 1.5) * Math.sin(z * 0.08 + Math.sin(x * 0.06) * 1.2);
      const far = 1 + r / 110;
      offsets.set([x, shadeAt(x, z), z], i * 3);
      { const hgt = range(0.55, 1.2) * (fringe ? 0.75 : 1) * far; data.set([Math.floor(rnd() * TUFTS), hgt, hgt * range(1.2, 1.5), rnd()], i * 4); }
      tint.copy(TINTS[Math.floor((patch * 0.5 + 0.5) * 3.99 + rnd() * 2)]).multiplyScalar(range(0.82, 1.12));
      if (rnd() < 0.07) tint.copy(DRY);
      tint.toArray(tints, i * 3);
      return;
    }
  }, true);
  // Flowers: six kinds on one sheet, heads rimmed with paper.
  const KINDS = 6;
  const flowerArt = (() => {
    const cw = 128, ch = 192, [C, c] = sheet(cw * KINDS, ch), [M, m] = sheet(cw * KINDS, ch);
    c.fillStyle = '#4f8f3c'; c.fillRect(0, 0, cw * KINDS, ch);
    m.fillStyle = '#000'; m.fillRect(0, 0, cw * KINDS, ch);
    const heads = [
      (g, x, y, k) => { g.beginPath(); g.moveTo(x - 24 - k, y - 30 - k); g.lineTo(x - 10, y - 14); g.lineTo(x, y - 34 - k); g.lineTo(x + 10, y - 14); g.lineTo(x + 24 + k, y - 30 - k); g.bezierCurveTo(x + 30 + k, y + 24 + k, x - 30 - k, y + 24 + k, x - 24 - k, y - 30 - k); g.fill(); },
      (g, x, y, k) => { for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(x + Math.cos(i * 0.7) * 19, y + Math.sin(i * 0.7) * 19, 13 + k, 7 + k, i * 0.7, 0, 7); g.fill(); } },
      (g, x, y, k) => { g.beginPath(); g.moveTo(x - 8, y - 22 - k); g.bezierCurveTo(x - 34 - k, y - 4, x - 30 - k, y + 30 + k, x - 20, y + 26 + k); g.lineTo(x, y + 14); g.lineTo(x + 20, y + 26 + k); g.bezierCurveTo(x + 30 + k, y + 30 + k, x + 34 + k, y - 4, x + 8, y - 22 - k); g.fill(); },
      (g, x, y, k) => { for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(x + Math.cos(i * 1.257 - 1.57) * 15, y + Math.sin(i * 1.257 - 1.57) * 15, 13 + k, 0, 7); g.fill(); } },
    ];
    const kinds = [[0, '#f7cc2e', '#e89a1c'], [0, '#ee5438', '#b5302a'], [1, '#fffaf0', '#f2c230'], [2, '#6c7fe6', '#3b4fb0'], [3, '#f584b4', '#f7d44a'], [0, '#fff6e6', '#f0d6a8']];
    kinds.forEach(([head, main, second], cell) => {
      const x = cell * cw + cw / 2, y = 52, bend = range(-10, 10);
      for (const g of [c, m]) {
        g.lineCap = 'round';
        g.strokeStyle = g === c ? '#4f8f3c' : '#fff'; g.fillStyle = g === c ? '#5fa04a' : '#fff';
        g.lineWidth = 6;
        g.beginPath(); g.moveTo(x + bend, ch + 2); g.quadraticCurveTo(x + bend, 120, x, y + 14); g.stroke();
        g.beginPath(); g.ellipse(x + bend * 0.8 + 14, 150, 17, 6, -0.7, 0, 7); g.fill();
        g.beginPath(); g.ellipse(x + bend * 0.8 - 13, 132, 15, 5, 0.8, 0, 7); g.fill();
        g.fillStyle = g === c ? PAPER : '#fff';
        heads[head](g, x, y, 5);
      }
      c.fillStyle = main; heads[head](c, x, y, 0);
      c.fillStyle = second;
      if (head === 1 || head === 3) { c.beginPath(); c.arc(x, y, 9, 0, 7); c.fill(); }
      else { c.globalAlpha = 0.45; c.beginPath(); c.ellipse(x, y + 12, 16, 8, 0, 0, 7); c.fill(); c.globalAlpha = 1; }
    });
    return { map: tex(C), alphaMap: tex(M, false) };
  })();
  const FLOWERS = 800;
  sprites(FLOWERS, flowerArt, KINDS, (i, offsets, data, tints) => {
    for (;;) {
      const r = PATIO + 1.0 + 60 * Math.pow(rnd(), 1.5), a = rnd() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (clearings.some(c => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
      // Kinds grow in drifts.
      const drift = Math.floor((Math.sin(x * 0.11 + 2) * Math.sin(z * 0.13) * 0.5 + 0.5) * KINDS + rnd() * 1.6) % KINDS;
      const hgt = range(1.1, 1.8);
      offsets.set([x, shadeAt(x, z), z], i * 3);
      data.set([drift, hgt, hgt * 0.667, rnd()], i * 4);
      tints.set([1, 1, 1], i * 3);
      return;
    }
  });

  // ---- far hills: three rings of flats, paler and bluer with distance ----
  function hill([dark, mid, light], woods) {
    const W = 1024, H = 256, pts = [[0, H]], p = [rnd() * 6, rnd() * 6, rnd() * 6];
    for (let x = 0; x <= W; x += 16) {
      const u = x / W, env = Math.pow(Math.sin(u * Math.PI), 0.9);
      pts.push([x, H - 4 - env * (128 + 58 * Math.sin(u * 7 + p[0]) + 34 * Math.sin(u * 13 + p[1]) + 12 * Math.sin(u * 29 + p[2]))]);
    }
    pts.push([W, H]);
    return cutout(W, H, { polys: [pts] }, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, mid); gr.addColorStop(1, light);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      wash(g, 0, 0, w, h, [dark, mid, light], 40, 40, 150, 0.35);
      if (woods) for (let i = 0; i < 150; i++) {
        const x = range(0, w), y = pts[1 + Math.floor(x / 16)][1] + range(4, 90);
        g.fillStyle = rgba(dark, range(0.35, 0.7));
        g.beginPath(); g.ellipse(x, y, range(3, 7), range(12, 26), 0, 0, 7); g.fill();
      }
    }, { rim: 13, bites: 0.3 });
  }
  const hillLayers = [
    { r: 600, n: 11, w: 520, tall: [0.08, 0.13], art: [hill(['#8fa6d6', '#a9bfe2', '#cfdcec']), hill(['#9d9fd2', '#b6bbe0', '#d6dcec'])] },
    { r: 480, n: 13, w: 400, tall: [0.06, 0.09], art: [hill(['#5fa59a', '#86c3ae', '#b9dcc3']), hill(['#69aba6', '#90c7b8', '#c0e0cb'])] },
    { r: 370, n: 14, w: 300, tall: [0.045, 0.07], art: [hill(['#4f9a50', '#86bf58', '#bcd873'], true), hill(['#5a9f46', '#97c657', '#cade78'], true)] },
  ];
  for (const { r, n, w, tall, art } of hillLayers) for (let i = 0; i < n; i++) {
    const a = (i + range(-0.2, 0.2)) / n * Math.PI * 2, m = card(pick(art), w * range(0.9, 1.2), { lit: false, fog: false });
    m.scale.y = m.scale.x * range(...tall);
    m.position.set(Math.cos(a) * r, -3, Math.sin(a) * r);
    m.rotation.y = Math.atan2(-m.position.x, -m.position.z);
    scene.add(m);
  }

  // ---- clouds: bare paper with scalloped edges, one layer behind another ----
  function cloud() {
    const W = 512, H = 224, circles = [], n = 7 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) * 2 - 1, r = (30 + 44 * (1 - u * u)) * range(0.8, 1.15);
      circles.push([256 + u * 185, 168 - r * 0.55 + range(-6, 6), r]);
    }
    for (let i = 0; i < 12; i++) circles.push([range(90, 420), range(150, 176), range(22, 34)]);
    return cutout(W, H, { circles }, (g, w, h) => {
      g.fillStyle = '#a9cbd8'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#dcebec'; circlePath(g, circles.map(([x, y, r]) => [x - 3, y - 13, r * 0.97])); g.fill();
      g.fillStyle = '#fffdf6'; circlePath(g, circles.map(([x, y, r]) => [x - 6, y - 27, r * 0.9])); g.fill();
    }, { rim: 0, bites: 0, grainy: false }); // bare paper: nothing was painted on it
  }
  const cloudArt = [cloud(), cloud(), cloud(), cloud()];
  const sky = new THREE.Group();
  for (let i = 0; i < 22; i++) {
    const a = (i + range(-0.3, 0.3)) / 22 * Math.PI * 2, r = range(640, 980), m = card(pick(cloudArt), range(170, 330), { lit: false, fog: false, dark: 0.2 }); // a cloud's shade falls on the sky, far behind it: faint
    m.position.set(Math.cos(a) * r, i % 2 ? range(30, 95) : range(110, 300), Math.sin(a) * r);
    m.lookAt(0, m.position.y * 0.5, 0);
    sky.add(m);
  }
  scene.add(sky);
  tickers.push(dt => { sky.rotation.y += (0.0012 + air.x * 0.0009) * dt; });

  // ---- a windmill on the far side: its sails turn with the wind ----
  const millArt = (() => {
    const W = 384, H = 640, cx = 192, tower = [[cx - 62, 250], [cx + 62, 250], [cx + 104, 634], [cx - 104, 634]], cap = [[cx, 150], [cx + 88, 262], [cx - 88, 262]];
    return cutout(W, H, { polys: [tower, cap] }, (g, w, h) => {
      g.fillStyle = '#f1e6d0'; g.fillRect(0, 0, w, h);
      wash(g, 0, 250, w, h, ['#dccbb0', '#f9f1df', '#d9c6b6'], 30, 20, 70, 0.5);
      g.fillStyle = rgba('#b9a48c', 0.45); g.fillRect(cx + 30, 250, 100, 400); // the shaded side
      g.fillStyle = '#5b3c4a'; g.beginPath(); g.roundRect(cx - 24, 560, 48, 80, [24, 24, 0, 0]); g.fill();
      g.fillStyle = '#4d7fb5'; for (const y of [330, 440]) { g.beginPath(); g.roundRect(cx - 14, y, 28, 38, [14, 14, 0, 0]); g.fill(); }
      g.save(); polyPath(g, cap); g.clip();
      g.fillStyle = '#c9553a'; g.fillRect(0, 0, w, h);
      wash(g, 0, 150, w, 262, ['#a53f2e', '#e07a52'], 18, 14, 40, 0.5);
      g.restore();
    });
  })();
  const sailArt = (() => {
    const S = 512, polys = [];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.2, rot = ([x, y]) => [256 + x * Math.cos(a) - y * Math.sin(a), 256 + x * Math.sin(a) + y * Math.cos(a)];
      polys.push([[-5, 0], [5, 0], [5, -245], [-5, -245]].map(rot), [[5, -60], [52, -60], [52, -240], [5, -240]].map(rot));
    }
    return cutout(S, S, { polys, circles: [[256, 256, 16]] }, (g, w, h) => {
      g.fillStyle = '#fbf4e2'; g.fillRect(0, 0, w, h);
      wash(g, 0, 0, w, h, ['#e6d6ba', '#fffaf0'], 40, 20, 60, 0.5);
      g.fillStyle = '#6a4a40';
      for (let i = 0; i < polys.length; i += 2) { polyPath(g, polys[i]); g.fill(); }
      g.beginPath(); g.arc(256, 256, 16, 0, 7); g.fill();
    }, { rim: 5 });
  })();
  const mill = new THREE.Group();
  const sails = card(sailArt, 17, { drop: 0 });
  sails.geometry = new THREE.PlaneGeometry(1, 1); // turns about its middle
  sails.position.set(0, 11.2, 0.35);
  mill.add(card(millArt, 9), sails);
  stand(mill, MILL.x, MILL.z, { askew: 0, sway: 0 });
  tickers.push(dt => { sails.rotation.z -= (0.2 + airSpeed * 0.2) * dt; });

  // ---- a hot-air balloon, far off ----
  const airshipArt = (() => {
    const W = 256, H = 384, cx = 128, env = [];
    for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 2, s = Math.sin(a), c = Math.cos(a); env.push([cx + s * 108 * (c > 0 ? 1 : 1 - 0.35 * c * c), 128 - c * (c > 0 ? 112 : 150)]); }
    const basket = [[cx - 20, 318], [cx + 20, 318], [cx + 16, 352], [cx - 16, 352]], neck = [[cx - 16, 270], [cx + 16, 270], [cx + 14, 320], [cx - 14, 320]];
    return cutout(W, H, { polys: [env, basket, neck] }, (g, w, h) => {
      g.fillStyle = '#8a5f45'; g.fillRect(0, 0, w, h);
      g.save(); polyPath(g, env); g.clip();
      ['#e8533f', '#f6d043', '#fbf4e2', '#4a86d8', '#e8533f', '#f6d043', '#fbf4e2'].forEach((c, i) => {
        g.fillStyle = c; g.beginPath(); g.ellipse(cx, 128, 108 * (1 - i / 7), 160, 0, 0, 7); g.fill();
      });
      wash(g, 0, 0, w, 280, ['#ffffff', '#7a4a3a'], 14, 20, 50, 0.16);
      g.restore();
    }, { rim: 5 });
  })();
  const airship = card(airshipArt, 14, { lit: false });
  stand(airship, 0, 0, { askew: 0, sway: 0.5 });
  let airshipAngle = AIRSHIP_FROM;
  tickers.push((dt, t) => {
    airshipAngle += 0.0025 * dt;
    airship.position.set(Math.cos(airshipAngle) * AIRSHIP_R, 18 + Math.sin(t * 0.15) * 2.5, Math.sin(airshipAngle) * AIRSHIP_R);
  });

  // ---- solid things, painted flat, with a hull of bare paper behind them as their rim ----
  const hullMat = hull(PAPER, 0.05);
  const rimmed = mesh => { mesh.add(new THREE.Mesh(mesh.geometry, hullMat)); return mesh; };

  // ---- a fence round the back of the circle ----
  const fenceMat = flat({ color: '#fbf3e2' });
  const POSTS = 30, FENCE_R = PATIO + 1.7, FENCE_FROM = -Math.PI / 2 - 1.15, FENCE_STEP = 2.3 / (POSTS - 1);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 1.35, 0.2).translate(0, 0.675, 0), fenceMat, POSTS);
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.13, 0.05), fenceMat, (POSTS - 1) * 2);
  const chord = 2 * FENCE_R * Math.sin(FENCE_STEP / 2);
  for (let i = 0; i < POSTS; i++) {
    const a = FENCE_FROM + i * FENCE_STEP;
    dummy.position.set(Math.cos(a) * FENCE_R, 0, Math.sin(a) * FENCE_R);
    dummy.rotation.set(0, -a, range(-0.06, 0.06));
    dummy.scale.set(1, range(0.9, 1.1), 1);
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
  const shroomStems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 8).translate(0, 0.25, 0), flat({ color: '#fbf3e2' }), SHROOMS);
  const shroomCaps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.45, 0), flat({}), SHROOMS);
  const capColors = ['#e2472e', '#e2472e', '#f0902c', '#c9a27a'].map(c => new THREE.Color(c));
  for (let i = 0; i < SHROOMS; i++) {
    const spot = shroomSpots[i >> 2], s = range(0.9, 1.9);
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

  // ---- birds ----
  const wing = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, 0, 0, -0.3, 1.5, 0, -0.45], 3));
  const birdMat = new THREE.MeshBasicMaterial({ color: '#4a4258', side: THREE.DoubleSide });
  const birds = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group(), right = new THREE.Mesh(wing, birdMat), left = new THREE.Mesh(wing, birdMat), mirror = new THREE.Group();
    mirror.scale.x = -1;
    mirror.add(left);
    g.add(right, mirror);
    scene.add(g);
    const row = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
    birds.push({ g, right, left, back: row * 0.03, out: side * row * 2.6, phase: rnd() * 6 });
  }
  tickers.push((dt, t) => {
    for (const b of birds) {
      const a = -1.2 + t * 0.045 - b.back, r = 105 + b.out + Math.sin(t * 0.21) * 14;
      b.g.position.set(Math.cos(a) * r, 19 + Math.sin(t * 0.3 + b.phase) * 0.8 + Math.sin(a * 2) * 3, Math.sin(a) * r);
      b.g.rotation.y = -a;
      b.right.rotation.z = b.left.rotation.z = Math.sin(t * 6.5 + b.phase) * 0.6 + 0.15;
    }
  });

  // ---- a picnic at the edge of the circle ----
  const picnic = new THREE.Group();
  const [G, gg] = sheet(256, 256);
  gg.fillStyle = '#fbf4e2'; gg.fillRect(0, 0, 256, 256);
  gg.fillStyle = 'rgba(226, 66, 62, 0.55)';
  for (let i = 0; i < 8; i += 2) { gg.fillRect(i * 32, 0, 32, 256); gg.fillRect(0, i * 32, 256, 32); }
  wash(gg, 0, 0, 256, 256, ['#ffffff', '#c9a08a'], 30, 10, 40, 0.18);
  const gingham = tex(G);
  gingham.wrapS = gingham.wrapT = THREE.RepeatWrapping;
  gingham.repeat.set(2, 1.5);
  const blanket = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.3).rotateX(-Math.PI / 2), flat({ map: gingham }));
  blanket.position.y = 0.03;
  blanket.receiveShadow = true;
  const wicker = flat({ color: '#c9924e' });
  const basket = rimmed(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.55, 14).translate(0, 0.3, 0), wicker));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 6, 20, Math.PI).translate(0, 0.55, 0), wicker);
  basket.position.set(-1, 0, -0.5);
  handle.position.copy(basket.position);
  const ball = rimmed(new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), flat({ color: '#4a86d8' })));
  ball.position.set(1.1, 0.45, 0.6);
  picnic.add(blanket, basket, handle, ball);
  for (const [x, z, c] of [[0.1, 0.3, '#e2472e'], [0.45, 0.1, '#9ac43c'], [0.2, -0.15, '#e2472e']]) {
    const apple = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), flat({ color: c }));
    apple.position.set(x, 0.15, z);
    picnic.add(apple);
  }
  picnic.traverse(o => { if (o.isMesh && o !== blanket && o.material !== hullMat) o.castShadow = true; });
  picnic.position.set(17.5, 0, -18.5);
  picnic.rotation.y = 0.5;
  scene.add(picnic);

  // ---- the wind flag: a pennant that lifts, streams downwind and ripples faster as it blows ----
  const POLE_TOP = 11, FLAG_LONG = 6.4, FLAG_HIGH = 3.4, NU = 30, NV = 10;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, POLE_TOP + 0.2, 10).translate(0, (POLE_TOP + 0.2) / 2, 0), flat({ color: '#fbf3e2' }));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10).translate(0, POLE_TOP + 0.35, 0), flat({ color: '#e9b23a' }));
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.3, 14).translate(0, 0.15, 0), flat({ color: '#a79bb3' }));
  for (const m of [pole, knob, foot]) { m.position.copy(POLE); m.castShadow = true; scene.add(m); }
  const [B, bg] = sheet(512, 256);
  ['#ee4f48', '#f8d648', '#3f7fe6'].forEach((c, i) => { bg.fillStyle = c; bg.fillRect(0, i * 256 / 3, 512, 256 / 3 + 1); });
  wash(bg, 0, 0, 512, 256, ['#ffffff', '#7a3050'], 50, 14, 50, 0.13);
  bg.strokeStyle = PAPER; bg.lineWidth = 5;
  for (const y of [256 / 3, 512 / 3]) { bg.beginPath(); for (let x = 0; x <= 512; x += 16) bg.lineTo(x, y + range(-2, 2)); bg.stroke(); }
  bg.fillStyle = PAPER;
  for (let i = 0; i < 26; i++) { bg.beginPath(); bg.arc(rnd() * 512, rnd() * 256, 7 + rnd() * 6, 0, 7); bg.fill(); }
  const cloth = new THREE.PlaneGeometry(1, 1, NU, NV); // uv.x runs from the pole to the fly end
  const flag = new THREE.Mesh(cloth, flat({ map: tex(B), side: THREE.DoubleSide }));
  flag.castShadow = true;
  flag.frustumCulled = false;
  scene.add(flag);
  const flagDir = new THREE.Vector2(0.8, 0.6);
  let ripple = 0;
  tickers.push((dt, t) => {
    const speed = blow.length();
    if (speed > 0.05) {
      flagDir.addScaledVector(blow, Math.min(1, dt * 2.5) / speed * Math.min(1, speed));
      if (flagDir.lengthSq() < 1e-6) flagDir.set(blow.y, -blow.x);
      flagDir.normalize();
    }
    const lift = 1 - Math.exp(-speed / 3.2);
    ripple += (0.9 + speed * 1.15) * dt;
    const droop = (1 - lift) * 1.37, wave = 0.05 + 0.4 * lift, limp = 1 - lift;
    const pos = cloth.getAttribute('position'), uv = cloth.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i), v = uv.getY(i), along = u * FLAG_LONG;
      const a = droop * (0.8 + 0.2 * u);
      const out = 0.1 + along * Math.cos(a);
      const side = Math.pow(u, 0.8) * (wave * (Math.sin(along * 1.5 - ripple + v * 0.9) + 0.4 * Math.sin(along * 2.9 - ripple * 1.7 + 1.3))
        + limp * (0.3 * Math.sin(along * 2.1 + v * 3) + 0.06 * Math.sin(t * 0.8 + along)));
      const y = POLE_TOP - 0.1 - (1 - v) * FLAG_HIGH * (1 - 0.62 * u) - 0.31 * FLAG_HIGH * u
        - along * Math.sin(a) + Math.pow(u, 0.8) * wave * 0.35 * Math.cos(along * 1.5 - ripple);
      pos.setXYZ(i, POLE.x + flagDir.x * out - flagDir.y * side, y, POLE.z + flagDir.y * out + flagDir.x * side);
    }
    pos.needsUpdate = true;
  });

  // ---- butterflies: two paper wings each ----
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.02);
  wingShape.bezierCurveTo(0.04, 0.24, 0.3, 0.3, 0.3, 0.1);
  wingShape.bezierCurveTo(0.31, 0.02, 0.2, -0.02, 0.17, -0.03);
  wingShape.bezierCurveTo(0.24, -0.12, 0.12, -0.24, 0, -0.06);
  const wingGeo = new THREE.ShapeGeometry(wingShape, 8).rotateX(Math.PI / 2);
  // Cut from paper like everything else: a wider wing of bare paper in the same plane, drawn behind from either side.
  const wingRimGeo = wingGeo.clone().scale(1.22, 1, 1.22).translate(-0.02, 0, 0.004);
  const wingRimMat = new THREE.MeshBasicMaterial({ color: PAPER, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
  const bodyGeo = new THREE.CapsuleGeometry(0.018, 0.2, 3, 6).rotateX(Math.PI / 2);
  const bodyMat = new THREE.MeshBasicMaterial({ color: '#3f2a38' });
  const wingMats = ['#ff8a1f', '#3f8cff', '#ffe04a', '#fffaf0', '#ff5fa2', '#9b6bff', '#33c9a7'].map(c => flat({ color: c, side: THREE.DoubleSide }));
  const butterflies = [];
  for (let i = 0; i < 18; i++) {
    const g = new THREE.Group(), mat = pick(wingMats);
    const right = new THREE.Mesh(wingGeo, mat), left = new THREE.Mesh(wingGeo, mat), mirror = new THREE.Group();
    mirror.scale.x = -1;
    mirror.add(left);
    right.castShadow = left.castShadow = true;
    right.add(new THREE.Mesh(wingRimGeo, wingRimMat)); left.add(new THREE.Mesh(wingRimGeo, wingRimMat));
    g.add(new THREE.Mesh(bodyGeo, bodyMat), right, mirror);
    g.scale.setScalar(range(1.1, 1.7));
    scene.add(g);
    // Over the meadow, never over the stones: a butterfly or its shadow on a strip would hide what the strip is.
    // Its loops reach about 7 out from home, and a strong wind carries it a few more.
    const r = range(PATIO + 11, PATIO + 20), a = rnd() * Math.PI * 2;
    butterflies.push({ g, right, left, hx: Math.cos(a) * r, hz: Math.sin(a) * r, hy: range(0.9, 2.8), rx: range(2, 6), rz: range(2, 6), speed: range(0.35, 0.7), phase: rnd() * 60 });
  }
  tickers.push((dt, t) => {
    for (const b of butterflies) {
      const tt = t * b.speed + b.phase;
      const x = b.hx + Math.sin(tt) * b.rx + Math.sin(tt * 2.3) * 0.7 + air.x * 0.25;
      const z = b.hz + Math.cos(tt * 0.8) * b.rz + Math.cos(tt * 1.9) * 0.7 + air.y * 0.25;
      const y = b.hy + Math.sin(tt * 1.7) * 0.5 + Math.abs(Math.sin(t * 9 + b.phase)) * 0.12;
      b.g.lookAt(x, b.g.position.y, z);
      b.g.position.set(x, y, z);
      b.right.rotation.z = b.left.rotation.z = 0.25 + Math.sin(t * 24 + b.phase) * 0.95;
    }
  });

  // ---- balloons: they lean with the wind ----
  const balloonGeo = new THREE.SphereGeometry(0.5, 24, 18).scale(1, 1.22, 1);
  const knotGeo = new THREE.ConeGeometry(0.07, 0.12, 8).translate(0, -0.64, 0);
  const glintGeo = new THREE.CircleGeometry(0.1, 12).scale(0.45, 1.2, 1).rotateZ(0.5);
  const glintMat = new THREE.MeshBasicMaterial({ color: PAPER, fog: false });
  const stringMat = new THREE.LineBasicMaterial({ color: '#5b3c4a' });
  const stakeMat = flat({ color: '#9a6a4d' });
  const balloons = [];
  for (const [ax, az, colors] of [[-9, -8, ['#ee4f48', '#f8d648', '#3f7fe6', '#f584b4', '#3fc47a']], [10.5, -10, ['#9b6bef', '#f79433', '#35c9d6', '#ee4f48']]]) {
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 8), stakeMat);
    stake.position.set(ax, 0.55, az);
    stake.castShadow = true;
    scene.add(stake);
    colors.forEach((color, i) => {
      const mat = flat({ color });
      const mesh = new THREE.Group(), body = rimmed(new THREE.Mesh(balloonGeo, mat)), glint = new THREE.Mesh(glintGeo, glintMat);
      mesh.add(body, new THREE.Mesh(knotGeo, mat), glint);
      body.castShadow = true;
      const string = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)), stringMat);
      string.frustumCulled = false;
      scene.add(mesh, string);
      const a = (i / colors.length) * Math.PI * 2;
      balloons.push({ mesh, glint, string, anchor: new THREE.Vector3(ax, 1.1, az), len: 2.6 + i * 0.42, sx: Math.cos(a) * 0.2, sz: Math.sin(a) * 0.2, phase: i * 1.7 });
    });
  }
  const lean = new THREE.Vector3(), toEye = new THREE.Vector3(), unlean = new THREE.Quaternion();
  tickers.push((dt, t, camera) => {
    for (const b of balloons) {
      lean.set(b.sx + air.x * 0.1 + Math.sin(t * 1.3 + b.phase) * 0.07, 1, b.sz + air.y * 0.1 + Math.cos(t * 1.1 + b.phase) * 0.07).normalize();
      b.mesh.position.copy(b.anchor).addScaledVector(lean, b.len);
      b.mesh.quaternion.setFromUnitVectors(UP, lean);
      if (camera) {
        // The glint is a fleck of bare paper on the side that faces the viewer.
        unlean.copy(b.mesh.quaternion).invert();
        toEye.copy(camera.position).sub(b.mesh.position).normalize().applyQuaternion(unlean);
        b.glint.position.copy(toEye).multiplyScalar(0.64);
        b.glint.position.x -= 0.2; b.glint.position.y += 0.34;
        b.glint.quaternion.copy(unlean).multiply(camera.quaternion);
      }
      const p = b.string.geometry.attributes.position;
      p.setXYZ(0, b.anchor.x, b.anchor.y, b.anchor.z);
      p.setXYZ(1, b.mesh.position.x - lean.x * 0.68, b.mesh.position.y - lean.y * 0.68, b.mesh.position.z - lean.z * 0.68);
      p.needsUpdate = true;
    }
  });

  // ---- the cannon ----
  const TILT = 0.35, AXLE = 0.67, BARREL = 1.55, CANNON_SCALE = 1.5; // tilt is from straight up, toward +z
  const cannon = new THREE.Group();
  const red = flat({ color: '#e2443e', side: THREE.DoubleSide });
  const brass = flat({ color: '#f0bc3c' });
  const wood = flat({ color: '#a8703f' });
  const iron = flat({ color: '#4a4258' });
  const pivot = new THREE.Group();
  pivot.position.y = AXLE;
  pivot.rotation.x = TILT;
  const profile = [[0.001, -0.4], [0.2, -0.42], [0.31, -0.33], [0.36, -0.15], [0.34, 0.05], [0.28, 0.9], [0.27, 1.25], [0.36, 1.5], [0.38, BARREL], [0.31, BARREL], [0.22, 1.2], [0.2, 0.2]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  pivot.add(rimmed(new THREE.Mesh(new THREE.LatheGeometry(profile, 36), red)));
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.21, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#3f2a38' }));
  bore.position.y = 0.6;
  pivot.add(bore);
  for (const [y, r] of [[-0.12, 0.365], [0.5, 0.315], [1.22, 0.285], [1.5, 0.37]]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 36).rotateX(Math.PI / 2), brass);
    band.position.y = y;
    pivot.add(band);
  }
  cannon.add(pivot);
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 1.25), wood);
    cheek.position.set(side * 0.44, 0.52, -0.2);
    const wheel = new THREE.Group();
    wheel.add(rimmed(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.075, 10, 36).rotateY(Math.PI / 2), wood)));
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 14).rotateZ(Math.PI / 2), iron));
    for (let i = 0; i < 4; i++) wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.2, 6).rotateX(i * Math.PI / 4), wood));
    wheel.position.set(side * 0.62, AXLE, 0);
    cannon.add(cheek, wheel);
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 10).rotateZ(Math.PI / 2), iron);
  axle.position.y = AXLE;
  const trail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 1.5), wood);
  trail.position.set(0, 0.3, -1.05);
  trail.rotation.x = -0.36;
  cannon.add(axle, trail);
  cannon.traverse(o => { if (o.isMesh && o.material !== hullMat) o.castShadow = true; });
  cannon.scale.setScalar(CANNON_SCALE);
  scene.add(cannon);

  const dir = new THREE.Vector3(0, Math.cos(TILT), Math.sin(TILT));
  return {
    muzzle: { pos: new THREE.Vector3(0, AXLE, 0).addScaledVector(dir, BARREL).multiplyScalar(CANNON_SCALE), dir },
    update(dt, t, wind = CALM, camera) {
      feelWind(dt, t, wind);
      for (const tick of tickers) tick(dt, t, camera);
    },
  };
}
