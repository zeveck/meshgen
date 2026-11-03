// Mage Playground: a meshgen character with a staff and a flaming sword,
// driven by keyboard and mouse, or a stick and buttons on a touchscreen.
// Plain three.js, no build step.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODELS = {
  mage: 'assets/meshgen/mage/mage.glb',
  staff: 'assets/meshgen/staff/staff.glb',
  sword: 'assets/meshgen/sword/sword.glb',
};

// Where each weapon sits in its hand bone, in meters and radians. The bones
// are Meshy's Mixamo-style RightHand and LeftHand.
const GRIPS = {
  sword: { bone: 'RightHand', grip: 0.14, position: [0, 0.09, 0.02], rotation: [Math.PI / 2, 0, 0] },
  staff: { bone: 'LeftHand', grip: 0.8, position: [0, 0.09, 0.02], rotation: [Math.PI / 2, 0, 0] },
};

const WALK_SPEED = 1.5;
const RUN_SPEED = 4.2;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

// Phones get a lighter renderer: fewer pixels and a smaller shadow map.
const coarse = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3b4a72);
scene.fog = new THREE.Fog(0x3b4a72, 18, 45);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3020, 1.6));
const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
sun.position.set(6, 12, 4);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(coarse ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 40 });
scene.add(sun, sun.target);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(40, 64),
  new THREE.MeshStandardMaterial({ color: 0x4d6b3c, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const arena = new THREE.Mesh(
  new THREE.RingGeometry(9.6, 10, 64),
  new THREE.MeshBasicMaterial({ color: 0x8f86c9, transparent: true, opacity: 0.35 }),
);
arena.rotation.x = -Math.PI / 2;
arena.position.y = 0.01;
scene.add(arena);

const stone = new THREE.MeshStandardMaterial({ color: 0x8a8790, roughness: 0.9 });
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 3 + (i % 3), 8), stone);
  pillar.position.set(Math.cos(a) * 12, (3 + (i % 3)) / 2, Math.sin(a) * 12);
  pillar.castShadow = pillar.receiveShadow = true;
  scene.add(pillar);
}

// ---------------------------------------------------------------------------
// Particles: one additive point cloud per effect color
// ---------------------------------------------------------------------------

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const GLOW = glowTexture();

class Particles {
  constructor(max, size, hot, cool) {
    this.max = max;
    this.hot = new THREE.Color(hot);
    this.cool = new THREE.Color(cool);
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.span = new Float32Array(max).fill(1);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(p, v, life) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = this.span[i] = life;
  }
  update(dt) {
    const c = new THREE.Color();
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col.fill(0, i * 3, i * 3 + 3); continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.span[i]);
      for (let j = 0; j < 3; j++) this.pos[i * 3 + j] += this.vel[i * 3 + j] * dt;
      this.vel[i * 3 + 1] += 1.2 * dt;
      c.copy(this.cool).lerp(this.hot, k).multiplyScalar(k);
      this.col.set([c.r, c.g, c.b], i * 3);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

const flames = new Particles(1400, 0.2, 0xffa040, 0xc01800);
const arcane = new Particles(700, 0.2, 0xe9c8ff, 0x6a1cff);
const rand = (a) => (Math.random() - 0.5) * a;

// ---------------------------------------------------------------------------
// Training dummies: animated in code (wobble, topple, rise)
// ---------------------------------------------------------------------------

const straw = new THREE.MeshStandardMaterial({ color: 0xc9a25a, roughness: 1 });
const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });

function makeDummy(x, z) {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  root.add(pivot);
  const parts = [
    [new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8), wood, 0.5],
    [new THREE.CylinderGeometry(0.28, 0.24, 0.8, 10), straw, 1.25],
    [new THREE.SphereGeometry(0.2, 12, 10), straw, 1.85],
    [new THREE.BoxGeometry(1.1, 0.1, 0.1), wood, 1.45],
  ];
  for (const [geo, mat, y] of parts) {
    const m = new THREE.Mesh(geo, mat.clone());
    m.position.y = y;
    m.castShadow = true;
    pivot.add(m);
  }
  root.position.set(x, 0, z);
  root.lookAt(0, 0, 0);
  scene.add(root);
  return { root, pivot, hp: 3, wobble: 0, wobbleV: 0, flash: 0, down: 0, fallDir: new THREE.Vector3() };
}

const dummies = [[0, 4], [3.5, 3], [-3.5, 3], [6, 0], [-6, 0]].map(([x, z]) => makeDummy(x, z));
let toppled = 0;

function hitDummy(d, from, damage) {
  if (d.down > 0) return;
  d.hp -= damage;
  d.flash = 0.25;
  d.wobbleV += 9;
  d.fallDir.copy(d.root.position).sub(from).setY(0).normalize();
  if (d.hp <= 0) {
    d.down = 3.5;
    toppled++;
    document.getElementById('count').textContent = toppled;
  }
}

function updateDummies(dt) {
  for (const d of dummies) {
    d.wobbleV += (-40 * d.wobble - 4 * d.wobbleV) * dt;
    d.wobble += d.wobbleV * dt;
    const local = d.root.worldToLocal(d.root.position.clone().add(d.fallDir)).normalize();
    const axis = new THREE.Vector3(local.z, 0, -local.x);
    if (d.down > 0) {
      d.down -= dt;
      const fall = Math.min(1, (3.5 - d.down) * 3);
      const rise = d.down < 0.6 ? d.down / 0.6 : 1;
      d.pivot.quaternion.setFromAxisAngle(axis, (Math.PI / 2) * fall * rise);
      if (d.down <= 0) d.hp = 3;
    } else {
      d.pivot.quaternion.setFromAxisAngle(axis, d.wobble * 0.08);
    }
    d.flash = Math.max(0, d.flash - dt);
    d.pivot.children.forEach((m) => m.material.emissive?.setRGB(d.flash * 3, d.flash * 0.8, 0));
  }
}

// ---------------------------------------------------------------------------
// Loading the mage and attaching the weapons
// ---------------------------------------------------------------------------

const loader = new GLTFLoader();
const [mageGltf, staffGltf, swordGltf] = await Promise.all([MODELS.mage, MODELS.staff, MODELS.sword].map((u) => loader.loadAsync(u)));

const mage = mageGltf.scene;
mage.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
scene.add(mage);

function attach(weapon, { bone, grip, position, rotation }) {
  const hand = mage.getObjectByName(bone);
  if (!hand) throw new Error(`No bone named ${bone}`);
  mage.updateMatrixWorld(true);
  const scale = hand.getWorldScale(new THREE.Vector3()).x;
  const holder = new THREE.Group();
  holder.scale.setScalar(1 / scale);
  holder.position.fromArray(position).multiplyScalar(1 / scale);
  holder.rotation.fromArray(rotation);
  weapon.position.y = -grip;
  weapon.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  holder.add(weapon);
  hand.add(holder);
  return holder;
}

const sword = swordGltf.scene;
const staff = staffGltf.scene;
attach(sword, GRIPS.sword);
attach(staff, GRIPS.staff);

const swordLight = new THREE.PointLight(0xff7a2a, 3, 4, 2);
scene.add(swordLight);
const staffLight = new THREE.PointLight(0xb070ff, 2, 3, 2);
scene.add(staffLight);

const BLADE_BASE = new THREE.Vector3(0, 0.32, 0);
const BLADE_TIP = new THREE.Vector3(0, 0.98, 0);
const CRYSTAL = new THREE.Vector3(0, 1.5, 0);
const tmp = new THREE.Vector3();
const bladeBase = new THREE.Vector3();
const bladeTip = new THREE.Vector3();
const crystal = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Animation: locomotion plus one-shot actions with timed events
// ---------------------------------------------------------------------------

const mixer = new THREE.AnimationMixer(mage);
const actions = {};
for (const clip of mageGltf.animations) actions[clip.name] = mixer.clipAction(clip);
for (const name of ['idle', 'walk', 'run']) actions[name].setLoop(THREE.LoopRepeat);

let locomotion = 'idle';
let current = actions.idle;
current.play();
let oneShot = null;
let dead = false;

function fadeTo(action, duration = 0.2) {
  if (current === action) return;
  action.reset().setEffectiveWeight(1).play();
  current.crossFadeTo(action, duration, false);
  current = action;
}

const ONE_SHOTS = {
  slash: { speed: 1.6, move: 0, events: [[0.28, () => slashBurst(true)], [0.5, slashHit], [0.62, () => slashBurst(false)]] },
  cast: { speed: 1.4, move: 0, events: [[0.36, fireball]] },
  spell: { speed: 1.2, move: 0, events: [[0.6, nova]] },
  jump: { speed: 1.25, move: 'keep' },
  dodge: { speed: 1.3, move: 3.2, moveWindow: [0.1, 0.7] },
  hit: { speed: 1.2, move: -0.8, moveWindow: [0, 0.3] },
  wave: { speed: 1.3, move: 0 },
  die: { speed: 1, move: 0, hold: true },
};

function play(name) {
  if (dead && name !== 'die') return;
  const spec = ONE_SHOTS[name];
  const action = actions[name];
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.timeScale = spec.speed;
  oneShot = { name, action, spec, fired: new Set(), keepSpeed: speed };
  fadeTo(action, 0.12);
  if (name === 'die') dead = true;
}

mixer.addEventListener('finished', (e) => {
  if (!oneShot || e.action !== oneShot.action || oneShot.spec.hold) return;
  oneShot = null;
  fadeTo(actions[locomotion], 0.25);
});

// ---------------------------------------------------------------------------
// Spells and the sword
// ---------------------------------------------------------------------------

const forward = () => new THREE.Vector3(Math.sin(mage.rotation.y), 0, Math.cos(mage.rotation.y));

function slashBurst(start) {
  for (let i = 0; i < (start ? 40 : 80); i++) {
    tmp.lerpVectors(bladeBase, bladeTip, Math.random());
    flames.emit(tmp, new THREE.Vector3(rand(3), rand(2) + 1, rand(3)), 0.5 + Math.random() * 0.4);
  }
}

function slashHit() {
  for (const d of dummies) {
    const to = d.root.position.clone().sub(mage.position).setY(0);
    if (to.length() < 2.3 && to.normalize().dot(forward()) > 0.2) hitDummy(d, mage.position, 1);
  }
}

const bolts = [];
function fireball() {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffb347 }));
  ball.position.copy(crystal);
  const light = new THREE.PointLight(0xff8a2a, 4, 5, 2);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, color: 0xff7a20, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(1.1);
  ball.add(light, glow);
  scene.add(ball);
  bolts.push({ ball, vel: forward().multiplyScalar(11), life: 1.6 });
}

function updateBolts(dt) {
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.ball.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    for (let k = 0; k < 6; k++) flames.emit(b.ball.position, new THREE.Vector3(rand(1), rand(1), rand(1)), 0.35);
    const hit = dummies.find((d) => d.down <= 0 && d.root.position.distanceTo(tmp.copy(b.ball.position).setY(0)) < 0.6);
    if (hit || b.life <= 0) {
      if (hit) hitDummy(hit, mage.position, 2);
      for (let k = 0; k < 70; k++) flames.emit(b.ball.position, new THREE.Vector3(rand(6), rand(6), rand(6)), 0.6);
      scene.remove(b.ball);
      bolts.splice(i, 1);
    }
  }
}

const rings = [];
function nova() {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 64), new THREE.MeshBasicMaterial({ color: 0x9a4dff, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(mage.position).setY(0.15);
  scene.add(ring);
  rings.push({ ring, age: 0, hit: new Set() });
  for (let k = 0; k < 120; k++) {
    const a = Math.random() * Math.PI * 2;
    arcane.emit(tmp.copy(mage.position).setY(0.3), new THREE.Vector3(Math.cos(a) * 6, Math.random() * 2, Math.sin(a) * 6), 0.8);
  }
}

function updateRings(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i];
    r.age += dt;
    const radius = 1 + r.age * 9;
    r.ring.scale.setScalar(radius);
    r.ring.material.opacity = 0.8 * Math.max(0, 1 - r.age / 0.7);
    for (const d of dummies) {
      if (!r.hit.has(d) && d.root.position.distanceTo(r.ring.position.clone().setY(0)) < radius) {
        r.hit.add(d);
        hitDummy(d, mage.position, 3);
      }
    }
    if (r.age > 0.7) { scene.remove(r.ring); rings.splice(i, 1); }
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const keys = new Set();
const KEY_ACTIONS = { KeyJ: 'slash', KeyK: 'cast', KeyL: 'spell', Space: 'jump', KeyQ: 'dodge', KeyE: 'wave', KeyH: 'hit' };

// X (or the Fall button) collapses, and again gets back up.
function collapse() {
  if (dead) { dead = false; oneShot = null; fadeTo(actions.idle, 0.6); } else play('die');
}

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  setTouch(false);
  if (e.code === 'KeyX') {
    collapse();
  } else if (KEY_ACTIONS[e.code]) {
    e.preventDefault();
    play(KEY_ACTIONS[e.code]);
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

let camYaw = Math.PI;
let camDist = 5.5;
let camHeight = 1.9;
let drag = null;
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
// Each drag follows its own pointer, so a thumb on the stick doesn't turn
// the camera.
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX, moved: 0, button: e.button }; });
addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  drag.x = e.clientX;
  drag.moved += Math.abs(dx);
  camYaw -= dx * 0.006;
});
addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (drag.moved < 6) play(drag.button === 2 ? 'cast' : 'slash');
  drag = null;
});
addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) drag = null; });

// Touch: a stick on the left (push to the edge to run) and buttons on the
// right. They show on touchscreens; a key press switches back to the key
// list, and a touch brings the buttons back.
const touchUI = document.getElementById('touch');
const stickEl = document.getElementById('stick');
const knob = document.getElementById('knob');
const stick = { id: null, x: 0, y: 0 };
function setTouch(on) {
  document.body.classList.toggle('touch', on);
  touchUI.hidden = !on;
}
addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setTouch(true); }, true);

function moveStick(e) {
  const r = stickEl.getBoundingClientRect();
  const radius = r.width / 2;
  let x = (e.clientX - r.left - radius) / radius;
  let y = (e.clientY - r.top - radius) / radius;
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  stick.x = x;
  stick.y = y;
  knob.style.transform = `translate(${x * radius * 0.6}px, ${y * radius * 0.6}px)`;
}
stickEl.addEventListener('pointerdown', (e) => {
  stick.id = e.pointerId;
  stickEl.setPointerCapture(e.pointerId);
  moveStick(e);
});
stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) moveStick(e); });
const releaseStick = (e) => {
  if (e.pointerId !== stick.id) return;
  stick.id = null;
  stick.x = stick.y = 0;
  knob.style.transform = '';
};
stickEl.addEventListener('pointerup', releaseStick);
stickEl.addEventListener('pointercancel', releaseStick);

for (const b of touchUI.querySelectorAll('button[data-action]')) {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    b.classList.add('down');
    if (b.dataset.action === 'collapse') collapse(); else play(b.dataset.action);
  });
  b.addEventListener('pointerup', () => b.classList.remove('down'));
  b.addEventListener('pointercancel', () => b.classList.remove('down'));
}
document.getElementById('more').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const extras = document.getElementById('extras');
  extras.hidden = !extras.hidden;
});
touchUI.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------

let speed = 0;
let last = performance.now();
const camTarget = new THREE.Vector3();

function update(dt) {
  const input = new THREE.Vector3(
    (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0),
    0,
    (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
  );
  let running = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const pushed = Math.hypot(stick.x, stick.y);
  if (pushed > 0.2) { // a small dead zone in the middle
    input.set(stick.x, 0, -stick.y);
    running ||= pushed > 0.85;
  }
  const moving = input.lengthSq() > 0 && !dead;

  if (oneShot) {
    const { action, spec } = oneShot;
    const t = action.time / action.getClip().duration;
    for (const [at, fn] of spec.events || []) {
      if (t >= at && !oneShot.fired.has(at)) { oneShot.fired.add(at); fn(); }
    }
    let v = 0;
    if (spec.move === 'keep') v = oneShot.keepSpeed;
    else if (spec.move && (!spec.moveWindow || (t >= spec.moveWindow[0] && t <= spec.moveWindow[1]))) v = spec.move;
    mage.position.addScaledVector(forward(), v * dt);
  } else if (!dead) {
    if (moving) {
      // Camera-relative movement: W goes away from the camera.
      const dir = new THREE.Vector3(-input.x, 0, input.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), camYaw + Math.PI);
      const targetYaw = Math.atan2(dir.x, dir.z);
      let diff = targetYaw - mage.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      mage.rotation.y += diff * Math.min(1, dt * 12);
      speed = running ? RUN_SPEED : WALK_SPEED;
      mage.position.addScaledVector(forward(), speed * dt);
    } else {
      speed = 0;
    }
    const next = moving ? (running ? 'run' : 'walk') : 'idle';
    if (next !== locomotion) { locomotion = next; fadeTo(actions[next], 0.2); }
  }
  const r = mage.position.length();
  if (r > 9.4) mage.position.multiplyScalar(9.4 / r);
  for (const d of dummies) {
    if (d.down > 0) continue;
    const away = tmp.copy(mage.position).sub(d.root.position).setY(0);
    const dist = away.length();
    if (dist < 0.75 && dist > 1e-4) mage.position.addScaledVector(away.normalize(), 0.75 - dist);
  }

  mixer.update(dt);
  mage.updateMatrixWorld(true);

  sword.localToWorld(bladeBase.copy(BLADE_BASE));
  sword.localToWorld(bladeTip.copy(BLADE_TIP));
  staff.localToWorld(crystal.copy(CRYSTAL));
  for (let i = 0; i < 8; i++) {
    tmp.lerpVectors(bladeBase, bladeTip, Math.random());
    tmp.x += rand(0.05); tmp.z += rand(0.05);
    flames.emit(tmp, new THREE.Vector3(rand(0.4), 0.6 + Math.random() * 0.8, rand(0.4)), 0.25 + Math.random() * 0.3);
  }
  if (Math.random() < 0.6) arcane.emit(crystal, new THREE.Vector3(rand(0.4), 0.3, rand(0.4)), 0.5);
  swordLight.position.lerpVectors(bladeBase, bladeTip, 0.5);
  swordLight.intensity = 2.5 + Math.random() * 1.5;
  staffLight.position.copy(crystal);

  flames.update(dt);
  arcane.update(dt);
  updateBolts(dt);
  updateRings(dt);
  updateDummies(dt);

  camTarget.lerp(tmp.copy(mage.position).setY(1.2), Math.min(1, dt * 6));
  // A tall, narrow screen sees less across, so the camera backs off to fit.
  const fit = Math.sqrt(Math.max(1, 0.9 / camera.aspect));
  camera.position.set(camTarget.x + Math.sin(camYaw) * camDist * fit, camTarget.y + camHeight * fit, camTarget.z + Math.cos(camYaw) * camDist * fit);
  camera.lookAt(camTarget);
  sun.position.copy(camTarget).add(new THREE.Vector3(6, 12, 4));
  sun.target.position.copy(camTarget);
}

document.getElementById('loading').remove();
document.getElementById('hud').hidden = false;
document.getElementById('score').hidden = false;
setTouch(coarse);
camTarget.set(0, 1.2, 0);

let paused = false;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  if (!paused) update(Math.min((now - last) / 1000, 0.05));
  last = now;
  renderer.render(scene, camera);
});

// Hooks for automated checks (playwright): press keys and step time.
window.game = {
  play, keys, mage, actions, camera, ready: true,
  get toppled() { return toppled; },
  view(yaw, dist = 5.5, height = 1.9) { camYaw = yaw; camDist = dist; camHeight = height; },
  // Freezes real time and advances the game in fixed 1/30 s steps.
  step(seconds) {
    paused = true;
    for (let t = 0; t < seconds; t += 1 / 30) update(1 / 30);
    renderer.render(scene, camera);
  },
  resume() { paused = false; },
};
