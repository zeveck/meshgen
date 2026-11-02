// Creature Showcase: four Meshy models brought to life in code. Meshy only
// rigs humanoids (and, experimentally, four-legged animals), so the fish,
// dragon and frog are plain models animated by bending their vertices in the
// shader and moving them along paths.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

const loader = new GLTFLoader();
const load = (name) => loader.loadAsync(`assets/meshgen/${name}/${name}.glb`);

// Puts every mesh's world transform into its geometry, so shader code works
// in the model's own meters: +Y up, +Z the side Meshy saw as the front.
function bake(gltf) {
  const group = new THREE.Group();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const mesh = new THREE.Mesh(geometry, o.material.clone());
    mesh.castShadow = true;
    group.add(mesh);
  });
  const box = new THREE.Box3().setFromObject(group);
  return { group, box, size: box.getSize(new THREE.Vector3()) };
}

// Adds a bit of GLSL after three.js computes `transformed` (the vertex in
// model space), with shared uniforms.
function deform(group, key, uniforms, glsl) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      const decl = Object.keys(uniforms).map((u) => `uniform float ${u};`).join('\n');
      shader.vertexShader = decl + '\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${glsl}`);
    };
    o.material.customProgramCacheKey = () => key;
  });
}

function baseScene(sky, groundColor, fog) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  if (fog) scene.fog = new THREE.Fog(sky, fog[0], fog[1]);
  scene.add(new THREE.HemisphereLight(0xffffff, groundColor, 1.8));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  return scene;
}

const panels = [];

// ---------------------------------------------------------------------------
// Betta: a travelling sine wave down the body, stronger toward the tail.
// Meshy turned the side-view fish to face +Z, so the head is at max Z.
// ---------------------------------------------------------------------------

async function betta() {
  const { group, box, size } = bake(await load('betta'));
  const fish = new THREE.Group();
  const scale = 1 / size.z;
  group.scale.setScalar(scale);
  group.position.set(-(box.min.x + size.x / 2) * scale, -(box.min.y + size.y / 2) * scale, -(box.min.z + size.z / 2) * scale);
  fish.add(group);
  const u = { uTime: { value: 0 }, uMaxZ: { value: box.max.z }, uLen: { value: size.z } };
  deform(group, 'betta', u, `
    float along = clamp((uMaxZ - position.z) / uLen, 0.0, 1.0);
    float amp = uLen * (0.02 + 0.16 * pow(along, 1.7));
    transformed.x += amp * sin(uTime * 5.0 - along * 5.5);
  `);
  const scene = baseScene(0x0d4a6b, 0x0a2030, [3, 9]);
  scene.add(fish);
  const sand = new THREE.Mesh(new THREE.CircleGeometry(12, 32), new THREE.MeshStandardMaterial({ color: 0xc9b98a }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.y = -1.3;
  scene.add(sand);
  const weeds = [];
  for (let i = 0; i < 14; i++) {
    const h = 0.8 + Math.random() * 1.2;
    const weed = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, h, 5, 6), new THREE.MeshStandardMaterial({ color: 0x2f8a4a }));
    weed.geometry.translate(0, h / 2, 0);
    const a = Math.random() * Math.PI * 2;
    const r = 1.8 + Math.random() * 2.5;
    weed.position.set(Math.cos(a) * r, -1.3, Math.sin(a) * r - 1);
    weeds.push(weed);
    scene.add(weed);
  }
  const bubbles = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(150).map(() => (Math.random() - 0.5) * 6), 3)),
    new THREE.PointsMaterial({ color: 0xcfefff, size: 0.04, transparent: true, opacity: 0.7 }),
  );
  scene.add(bubbles);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
  camera.position.set(0, 0.3, 3.2);
  camera.lookAt(0, 0, 0);
  panels.push({
    name: 'Betta fish', how: 'Meshy model · body wave in a vertex shader', scene, camera,
    update(t) {
      u.uTime.value = t;
      const a = t * 0.35;
      const pos = new THREE.Vector3(Math.cos(a) * 1.1, Math.sin(t * 0.9) * 0.15, Math.sin(2 * a) * 0.45);
      const vel = new THREE.Vector3(-Math.sin(a) * 1.1, 0, Math.cos(2 * a) * 0.9);
      fish.position.copy(pos);
      fish.rotation.y = Math.atan2(vel.x, vel.z);
      weeds.forEach((w, i) => { w.rotation.z = Math.sin(t * 1.3 + i) * 0.12; });
      const p = bubbles.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, ((p.getY(i) + 3 + 0.01) % 6) - 3);
      p.needsUpdate = true;
    },
  });
}

// ---------------------------------------------------------------------------
// Dragon: the picture was a front view with wings out to the sides, so the
// wings are ±X, head +Y and belly +Z. Each wing turns about its shoulder
// (a quick downstroke, a slower upstroke, the tip trailing a little), and
// the model is tipped forward to fly belly-down over a sea of clouds.
// ---------------------------------------------------------------------------

// A soft round puff, drawn once and shared by every cloud sprite.
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function skyTexture(top, bottom) {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Same clouds on every load, so screenshots and GIFs match.
function seeded(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

const DRAGON_LOOP = 5.6; // seconds: four wingbeats, one weave, clouds wrap

async function dragon() {
  const { group, box, size } = bake(await load('dragon'));
  const scale = 2.4 / size.x;
  group.scale.setScalar(scale);
  group.position.set(-(box.min.x + size.x / 2) * scale, -(box.min.y + size.y / 2) * scale, -(box.min.z + size.z / 2) * scale);
  const tilt = new THREE.Group();
  tilt.rotation.x = Math.PI / 2 - 0.1; // belly down, head a touch up
  tilt.add(group);
  const bank = new THREE.Group();
  bank.add(tilt);
  const dragon = new THREE.Group();
  dragon.add(bank);
  const centerX = box.min.x + size.x / 2;
  const u = {
    uTime: { value: 0 }, uCenterX: { value: centerX }, uBody: { value: size.x * 0.1 },
    uHalf: { value: size.x / 2 }, uMinY: { value: box.min.y }, uHeight: { value: size.y },
  };
  deform(group, 'dragon', u, `
    float side = sign(position.x - uCenterX);
    float r = max(abs(position.x - uCenterX) - uBody, 0.0);
    float out_ = r / (uHalf - uBody);
    float phase = uTime * 6.2832 / 1.4;
    // Fast down, slow up: a sine bent by its own phase.
    float beat = sin(phase + 0.6 * sin(phase));
    float lag = sin(phase - 0.9 + 0.6 * sin(phase - 0.9));
    float angle = 0.65 * mix(beat, lag, out_) + 0.1;
    float w = smoothstep(0.0, 0.15, out_);
    transformed.x = mix(position.x, uCenterX + side * (uBody + r * cos(angle)), w);
    transformed.z = mix(position.z, position.z - r * sin(angle), w);
    float tail = clamp((uMinY + uHeight * 0.35 - position.y) / (uHeight * 0.35), 0.0, 1.0);
    transformed.x += sin(phase * 0.5 - tail * 3.0) * tail * tail * uHeight * 0.1;
  `);
  const scene = baseScene(0x9cc7ee, 0x9aa6b8, [14, 40]);
  scene.background = skyTexture('#3f7fcf', '#cfe4f7');
  scene.add(dragon);

  // Clouds: clusters of soft sprites in three layers. They stream past the
  // dragon and wrap around, so it reads as flying forward.
  const rand = seeded(7);
  const puff = puffTexture();
  const clouds = [];
  for (let i = 0; i < 26; i++) {
    const cloud = new THREE.Group();
    const below = i < 16;
    const y = below ? -3 - rand() * 1.5 : 5 + rand() * 2;
    const n = 5 + Math.floor(rand() * 5);
    for (let k = 0; k < n; k++) {
      const shade = below ? 0.92 + rand() * 0.08 : 0.97;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: new THREE.Color(shade, shade, shade * 1.02), transparent: true, opacity: below ? 0.95 : 0.7, depthWrite: false }));
      const s = 1.6 + rand() * 1.8;
      sprite.scale.set(s * 1.4, s, 1);
      sprite.position.set((k - n / 2) * 0.8 + rand() * 0.4, rand() * 0.5 - (k % 2) * 0.3, rand() * 0.8);
      cloud.add(sprite);
    }
    cloud.userData = { x: (rand() - 0.5) * 26, y, z0: rand() * 40 };
    clouds.push(cloud);
    scene.add(cloud);
  }

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);
  const look = new THREE.Vector3();
  panels.push({
    name: 'Dragon', how: 'Meshy model · wingbeats and tail sway in a vertex shader', scene, camera, zoom: 1.1,
    update(t) {
      u.uTime.value = t;
      const a = (t / DRAGON_LOOP) * Math.PI * 2;
      // A lazy weave and bob. It flies toward the camera (+Z), which backs
      // away in front of it, so the clouds stream off behind.
      dragon.position.set(Math.sin(a) * 1.4, Math.sin(a * 2) * 0.25 + Math.sin(t * 4.488 + 1.4) * 0.08, 0);
      dragon.rotation.y = Math.cos(a) * 0.35;
      bank.rotation.z = -0.55 - Math.cos(a) * 0.25; // rolled toward the camera
      // Clouds move -Z, one wrap per loop.
      for (const c of clouds) {
        const { x, y, z0 } = c.userData;
        const z = 4 - ((z0 + (t / DRAGON_LOOP) * 40) % 40);
        c.position.set(x, y, z);
        // Fade in far away and out before reaching the camera.
        const fade = Math.min(1, (z + 36) / 6, (4 - z) / 4);
        c.children.forEach((sp) => { sp.material.opacity = fade * (y < 0 ? 0.95 : 0.7); });
      }
      camera.position.set(dragon.position.x * 0.4 + 3.6, 1.6, 2.6);
      look.set(dragon.position.x * 0.7, dragon.position.y - 0.2, 0);
      camera.lookAt(look);
    },
  });
}

// ---------------------------------------------------------------------------
// Frog: two Meshy models, like two keyframes. The sitting frog (front view)
// squashes on the pads; in the air it's swapped for the same frog stretched
// out mid-leap (a side view, which Meshy turned to face +Z), tipped to follow
// the arc. The frog mesh is one shell, so bending its folded legs out in a
// shader smeared them; a second pose looks far better.
// ---------------------------------------------------------------------------

async function frog() {
  const [sitting, leaping] = await Promise.all([load('frog'), load('frog-leap')]);
  const { group, box, size } = bake(sitting);
  const scale = 0.6 / size.y;
  group.scale.setScalar(scale);
  group.position.set(-(box.min.x + size.x / 2) * scale, -box.min.y * scale, -(box.min.z + size.z / 2) * scale);
  const squash = new THREE.Group();
  squash.add(group);
  const leap = bake(leaping);
  const leapScale = (size.z * scale * 2.4) / leap.size.z; // legs out, about 2.4 times as long
  leap.group.scale.setScalar(leapScale);
  leap.group.position.copy(leap.box.getCenter(new THREE.Vector3()).multiplyScalar(-leapScale));
  const pitch = new THREE.Group(); // turns about the body's middle
  pitch.position.y = 0.25;
  pitch.add(leap.group);
  const frog = new THREE.Group();
  frog.add(squash, pitch);
  const scene = baseScene(0x9fd0c8, 0x2f5a3a, [6, 20]);
  const water = new THREE.Mesh(new THREE.CircleGeometry(14, 40), new THREE.MeshStandardMaterial({ color: 0x2f6f73, roughness: 0.25, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  const pads = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 20, 1, false, 0.3, Math.PI * 2 - 0.6), new THREE.MeshStandardMaterial({ color: 0x4f9a3c }));
    pad.position.set(Math.cos(a) * 1.9, 0.02, Math.sin(a) * 1.9);
    pads.push(pad.position.clone().setY(0.04));
    scene.add(pad);
  }
  scene.add(frog);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
  camera.position.set(0, 3.3, 4.6);
  camera.lookAt(0, 0, 0);
  const HOP = 1.7;
  panels.push({
    name: 'Tree frog', how: 'Two Meshy models (sitting, leaping) · squash and hops in code', scene, camera, zoom: 1.3,
    update(t) {
      const n = Math.floor(t / HOP);
      const f = (t % HOP) / HOP;
      const from = pads[n % pads.length];
      const to = pads[(n + 1) % pads.length];
      const dir = to.clone().sub(from);
      frog.rotation.y = Math.atan2(dir.x, dir.z);
      let k = 0, sy = 1;
      if (f < 0.3) { sy = 1 - 0.18 * Math.sin((f / 0.3) * Math.PI / 2); }
      else if (f < 0.7) { k = (f - 0.3) / 0.4; sy = 1.18 - 0.18 * k; }
      else if (f < 0.82) { k = 1; sy = 1 - 0.15 * Math.sin(((f - 0.7) / 0.12) * Math.PI); }
      else { k = 1; sy = 1 + 0.015 * Math.sin(t * 9); }
      frog.position.lerpVectors(from, to, k);
      frog.position.y += Math.sin(Math.min(k, 1) * Math.PI) * (f < 0.7 ? 0.6 : 0);
      squash.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      // In the air: the leaping pose, nose up on the way up, down on the way down.
      const flying = f >= 0.3 && f < 0.7 && k > 0.06 && k < 0.94;
      squash.visible = !flying;
      pitch.visible = flying;
      pitch.rotation.x = -0.22 * Math.cos(k * Math.PI);
      camera.lookAt(frog.position.x * 0.6, 0.2 + frog.position.y * 0.5, frog.position.z * 0.6);
    },
  });
}

// ---------------------------------------------------------------------------
// Cat: a trot made in code. Legs swing in diagonal pairs (front-left with
// back-right), the body bobs and the tail sways. Meshy's experimental
// four-legged rig was tried first; its walk clip wasn't usable.
// ---------------------------------------------------------------------------

async function cat() {
  const { group, box, size } = bake(await load('cat'));
  const scale = 0.8 / size.y;
  group.scale.setScalar(scale);
  group.position.set(-(box.min.x + size.x / 2) * scale, -box.min.y * scale, -(box.min.z + size.z / 2) * scale);
  const body = new THREE.Group();
  body.add(group);
  const cat = new THREE.Group();
  cat.add(body);
  const u = {
    uTime: { value: 0 }, uMinY: { value: box.min.y }, uH: { value: size.y },
    uCX: { value: box.min.x + size.x / 2 }, uCZ: { value: box.min.z + size.z / 2 }, uD: { value: size.z },
  };
  deform(group, 'cat', u, `
    float legTop = uMinY + uH * 0.42;
    float leg = clamp((legTop - position.y) / (uH * 0.42), 0.0, 1.0);
    float front = position.z > uCZ ? 1.0 : 0.0;
    float left = position.x > uCX ? 1.0 : 0.0;
    float phase = (front == left ? 0.0 : 3.14159);
    transformed.z += sin(uTime * 7.0 + phase) * leg * uD * 0.18;
    transformed.y += max(0.0, cos(uTime * 7.0 + phase)) * leg * leg * uH * 0.05;
    float tail = clamp((uCZ - uD * 0.3 - position.z) / (uD * 0.2), 0.0, 1.0) * clamp((position.y - uMinY - uH * 0.4) / (uH * 0.6), 0.0, 1.0);
    transformed.x += sin(uTime * 2.2 + position.y * 20.0) * tail * uH * 0.12;
  `);
  const scene = baseScene(0xcfe3f0, 0x6b8a4a, [6, 20]);
  const grass = new THREE.Mesh(new THREE.CircleGeometry(14, 40), new THREE.MeshStandardMaterial({ color: 0x77a85a }));
  grass.rotation.x = -Math.PI / 2;
  scene.add(grass, cat);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
  camera.position.set(0, 1.5, 3.4);
  camera.lookAt(0, 0.3, 0);
  panels.push({
    name: 'Tabby cat', how: 'Meshy model · trot and tail sway in a vertex shader', scene, camera,
    update(t) {
      u.uTime.value = t;
      const a = t * 0.3;
      cat.position.set(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5);
      cat.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
      body.position.y = Math.abs(Math.sin(t * 7.0)) * 0.03;
      camera.lookAt(cat.position.x * 0.7, 0.35, cat.position.z * 0.7);
    },
  });
}

// ---------------------------------------------------------------------------
// Layout, labels and the loop
// ---------------------------------------------------------------------------

await Promise.all([betta(), dragon(), frog(), cat()]);
const order = ['Betta fish', 'Dragon', 'Tree frog', 'Tabby cat'];
panels.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
document.getElementById('loading').remove();

let focus = Number(new URLSearchParams(location.search).get('focus') || -1);
for (const p of panels) {
  p.label = document.createElement('div');
  p.label.className = 'label';
  p.label.innerHTML = `<b>${p.name}</b><span>${p.how}</span>`;
  document.body.appendChild(p.label);
}

function rects() {
  const w = innerWidth, h = innerHeight;
  if (focus >= 0) return panels.map((p, i) => (i === focus ? [0, 0, w, h] : null));
  const cols = w > h * 1.1 ? 2 : 1;
  const rows = Math.ceil(panels.length / cols);
  return panels.map((p, i) => [(i % cols) * (w / cols), Math.floor(i / cols) * (h / rows), w / cols, h / rows]);
}

renderer.domElement.addEventListener('click', (e) => {
  if (focus >= 0) { focus = -1; return; }
  focus = rects().findIndex((r) => r && e.clientX >= r[0] && e.clientX < r[0] + r[2] && e.clientY >= r[1] && e.clientY < r[1] + r[3]);
});

let time = 0;
let paused = false;
let last = performance.now();
const size = new THREE.Vector2();
function draw() {
  // Also catches a resize that happened while the models were loading.
  renderer.getSize(size);
  if (size.x !== innerWidth || size.y !== innerHeight) renderer.setSize(innerWidth, innerHeight);
  const H = innerHeight;
  rects().forEach((r, i) => {
    const p = panels[i];
    p.label.style.display = r ? '' : 'none';
    if (!r) return;
    p.update(time);
    p.camera.aspect = r[2] / r[3];
    p.camera.zoom = focus >= 0 ? (p.zoom || 1.7) : 1;
    p.camera.updateProjectionMatrix();
    renderer.setViewport(r[0], H - r[1] - r[3], r[2], r[3]);
    renderer.setScissor(r[0], H - r[1] - r[3], r[2], r[3]);
    renderer.render(p.scene, p.camera);
    p.label.style.left = r[0] + 'px';
    p.label.style.top = r[1] + 'px';
  });
}
renderer.setAnimationLoop(() => {
  const now = performance.now();
  if (!paused) time += Math.min((now - last) / 1000, 0.05);
  last = now;
  draw();
});

// Hooks for screenshots and GIFs: set the clock, pick a scene.
window.showcase = {
  ready: true,
  at(t) { paused = true; time = t; document.getElementById('hint').hidden = true; draw(); },
  focus(i) { focus = i; draw(); },
  resume() { paused = false; },
};
