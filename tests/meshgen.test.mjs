// Offline tests for meshgen.cjs. They never call the real Meshy API: the
// end-to-end tests run a fake Meshy on localhost (MESHGEN_API_BASE) that
// serves tiny GLBs built here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'skills/meshgen/meshgen.cjs');
const require = createRequire(import.meta.url);
const meshgen = require(SCRIPT);

// --- Tiny GLBs --------------------------------------------------------------

// A one-triangle mesh skinned to Hips > Spine, 1 m tall, plus clips that move
// Hips forward along +Z (root motion) and bob it up and down.
function makeGlb({ clips = [], height = 1, armatureScale = 1 } = {}) {
  const parts = [];
  let length = 0;
  const views = [];
  const accessors = [];
  function add(typed, acc) {
    const bytes = Buffer.from(typed.buffer);
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    parts.push(bytes);
    length += bytes.length;
    accessors.push({ bufferView: views.length - 1, ...acc });
    return accessors.length - 1;
  }
  const pos = add(new Float32Array([-0.2, 0, 0, 0.2, 0, 0, 0, height, 0]), { componentType: 5126, count: 3, type: 'VEC3', min: [-0.2, 0, 0], max: [0.2, height, 0] });
  const joints = add(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]), { componentType: 5123, count: 3, type: 'VEC4' });
  const weights = add(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), { componentType: 5126, count: 3, type: 'VEC4' });
  const s = 1 / armatureScale;
  const ibm = add(new Float32Array([
    s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, -1, 0, 1,
    s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, -1.5, 0, 1,
  ]), { componentType: 5126, count: 2, type: 'MAT4' });
  const animations = clips.map((name, i) => {
    const input = add(new Float32Array([0, 0.5, 1 + i]), { componentType: 5126, count: 3, type: 'SCALAR', min: [0], max: [1 + i] });
    const output = add(new Float32Array([0, 1, 0, 0, 1.2, 0.5, 0, 1, 1]), { componentType: 5126, count: 3, type: 'VEC3' });
    return { name, samplers: [{ input, output }], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] };
  });
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 3] }],
    nodes: [
      { name: 'Armature', scale: [armatureScale, armatureScale, armatureScale], children: [1] },
      { name: 'Hips', translation: [0, 1, 0], children: [2] },
      { name: 'Spine', translation: [0, 0.5, 0] },
      { name: 'Body', mesh: 0, skin: 0 },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: pos, JOINTS_0: joints, WEIGHTS_0: weights } }] }],
    skins: [{ joints: [1, 2], inverseBindMatrices: ibm }],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: length }],
  };
  if (animations.length) json.animations = animations;
  return meshgen.writeGlb(json, Buffer.concat(parts));
}

function translations(glb, clipIndex) {
  const g = meshgen.parseGlb(glb);
  const ch = g.json.animations[clipIndex].channels[0];
  const s = g.json.animations[clipIndex].samplers[ch.sampler];
  return Array.from(meshgen.readAccessor(g, s.output).array);
}

// --- Unit tests -------------------------------------------------------------

test('version matches package.json, plugin.json and the CHANGELOG', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills/.claude-plugin/plugin.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.equal(pkg.version, meshgen.MESHGEN_VERSION);
  assert.equal(plugin.version, meshgen.MESHGEN_VERSION);
  assert.match(meshgen.MESHGEN_VERSION, /^\d{4}\.\d{1,2}\.\d{1,2}(\.\d+)?$/);
  assert.equal(changelog.match(/^## (\S+)/m)[1], meshgen.MESHGEN_VERSION);
});

test('every flag in the CLI is in SKILL.md and the README', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const flags = new Set(src.match(/"--[a-z-]+"/g).map((f) => f.slice(1, -1)));
  const skill = fs.readFileSync(path.join(ROOT, 'skills/meshgen/SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const flag of flags) {
    if (['--version', '--help', '--config', '--filename', '--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'].includes(flag)) continue;
    assert.ok(skill.includes(flag), `SKILL.md is missing ${flag}`);
    assert.ok(readme.includes(flag), `README.md is missing ${flag}`);
  }
});

test('parseArgs reads commands, names, repeated pictures and lists', () => {
  const o = meshgen.parseArgs(['character', 'hero', '--image', 'a.png', '--image=b.png', '--actions', 'idle, slash', '--height', '1.8', '--formats', 'fbx,stl', '--draft']);
  assert.equal(o.command, 'character');
  assert.deepEqual(o.positional, ['hero']);
  assert.deepEqual(o.images, ['a.png', 'b.png']);
  assert.deepEqual(o.actions, ['idle', 'slash']);
  assert.equal(o.height, 1.8);
  assert.deepEqual(o.formats, ['glb', 'fbx', 'stl']);
  assert.equal(o.draft, true);
});

test('parseArgs rejects bad values with plain messages', () => {
  assert.throws(() => meshgen.parseArgs(['model', 'x', '--bogus']), /Unknown option --bogus/);
  assert.throws(() => meshgen.parseArgs(['model', 'x', '--height', 'tall']), /--height must be a number/);
  assert.throws(() => meshgen.parseArgs(['model', 'x', '--formats', 'gif']), /Unknown format gif/);
  assert.throws(() => meshgen.parseArgs(['model', 'x', '--topology', 'hex']), /triangle or quad/);
  assert.throws(() => meshgen.parseArgs(['model', 'x', '--prompt']), /needs a value/);
  assert.throws(() => meshgen.parseArgs(['model', 'x', '--prompt', '--draft']), /needs a value/);
  assert.throws(() => meshgen.parseArgs(['model', 'x', ...Array(5).fill(['--image', 'a.png']).flat()]), /at most 4/);
});

test('credit estimates follow Meshy pricing', () => {
  const base = { images: [] };
  assert.equal(meshgen.modelCredits(base), 30);
  assert.equal(meshgen.modelCredits({ ...base, draft: true }), 15);
  assert.equal(meshgen.modelCredits({ ...base, texture: '8k' }), 35);
  assert.equal(meshgen.modelCredits({ images: ['a'] }), 30);
  assert.equal(meshgen.modelCredits({ images: ['a'], draft: true }), 15);
  assert.equal(meshgen.modelCredits({ images: ['a'], texture: '8k' }), 35);
  assert.equal(meshgen.actionCredits(['idle', 'walk', 'run', 'slash']), 6);
  assert.equal(meshgen.actionCredits(['walk=115']), 3);
});

test('actions resolve from plain names, ids and library keys', () => {
  const library = [{ action_id: 129, key: 'mage_soell_cast', name: 'mage_soell_cast' }, { action_id: 97, key: 'Left_Slash', name: 'Left Slash' }];
  assert.deepEqual(meshgen.resolveAction('idle', null), { clip: 'idle', id: 0, loop: true });
  assert.equal(meshgen.resolveAction('cast=129', library).id, 129);
  assert.equal(meshgen.resolveAction('cast=129', library).clip, 'cast');
  assert.equal(meshgen.resolveAction('Left_Slash', library).clip, 'left-slash');
  assert.equal(meshgen.resolveAction('97', library).clip, 'left-slash');
  assert.throws(() => meshgen.resolveAction('moonwalk', library), /isn't an action meshgen knows/);
  assert.throws(() => meshgen.resolveAction('x=5', library), /no Meshy action 5/);
});

test('inspect measures height, triangles, bones and clips', () => {
  const info = meshgen.inspectGlb(makeGlb({ clips: ['Walk', 'Run'], height: 1.75 }));
  assert.equal(info.triangles, 1);
  assert.equal(info.skinned, true);
  assert.deepEqual(info.jointNames, ['Hips', 'Spine']);
  assert.equal(info.height, 1.75);
  assert.deepEqual(info.clips.map((c) => [c.name, c.duration]), [['Walk', 1], ['Run', 2]]);
  assert.deepEqual(meshgen.checkInspect(info, { height: 1.75 }), ['It has no textures.']);
  assert.match(meshgen.checkInspect(info, { height: 1.2 })[0], /1.75 m tall; the target was 1.2 m/);
});

test('inspect sees through a scaled armature (like FBX-style 0.01 rigs)', () => {
  const info = meshgen.inspectGlb(makeGlb({ height: 1.7, armatureScale: 0.01 }));
  assert.equal(info.height, 1.7);
});

test('mergeClips copies, renames and pins root motion in place', () => {
  const base = makeGlb();
  const src = makeGlb({ clips: ['Walking', 'Other'] });
  const { glb, warnings } = meshgen.mergeClips(base, [{ buf: src, index: 0, name: 'walk', loop: true }, { buf: src, index: 1, name: 'jump' }]);
  assert.deepEqual(warnings, []);
  const info = meshgen.inspectGlb(glb);
  assert.deepEqual(info.clips.map((c) => [c.name, c.loop]), [['walk', true], ['jump', false]]);
  // x and z stay at the rest pose (0, 0); y (up) still moves.
  assert.deepEqual(translations(glb, 0), [0, 1, 0, 0, 1.2000000476837158, 0, 0, 1, 0]);
  const moving = meshgen.mergeClips(base, [{ buf: src, index: 0, name: 'walk' }], { inPlace: false });
  assert.deepEqual(translations(moving.glb, 0), [0, 1, 0, 0, 1.2000000476837158, 0.5, 0, 1, 1]);
});

test('mergeClips warns about bones the base does not have', () => {
  const src = meshgen.parseGlb(makeGlb({ clips: ['Walk'] }));
  src.json.nodes[1].name = 'mixamorig:Hips';
  const other = meshgen.writeGlb(src.json, src.bin);
  const { warnings } = meshgen.mergeClips(makeGlb(), [{ buf: other, index: 0, name: 'walk' }]);
  assert.match(warnings[0], /1 channels had no matching bone/);
});

test('scaleToHeight scales the scene and stands it on the ground', () => {
  const scaled = meshgen.scaleToHeight(makeGlb({ height: 4 }), 1);
  const info = meshgen.inspectGlb(scaled);
  assert.equal(info.height, 1);
  assert.equal(info.min[1], 0);
});

// --- End to end against a fake Meshy ------------------------------------------

function fakeMeshy({ failRig = false, slow = false } = {}) {
  const state = { balance: 1000, posts: [], tasks: new Map(), polls: 0, slow };
  const files = {
    '/files/model.glb': makeGlb({ height: 1.6 }),
    '/files/rigged.glb': makeGlb({ height: 1.75 }),
    '/files/walk.glb': makeGlb({ clips: ['Walking'] }),
    '/files/run.glb': makeGlb({ clips: ['Running'] }),
    '/files/anim.glb': makeGlb({ clips: ['Idle', 'Left_Slash', 'Charged_Spell_Cast'] }),
    '/files/thumb.png': Buffer.from('png'),
  };
  const cost = { 'image-to-3d': 30, 'text-to-3d': 20, rigging: 5, animations: 9 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const send = (status, json, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Retry-After': '0', ...headers });
        res.end(JSON.stringify(json));
      };
      if (files[req.url]) { res.writeHead(200); res.end(files[req.url]); return; }
      if (req.headers.authorization !== 'Bearer msy_test') return send(401, { message: 'Invalid API key' });
      if (req.url === '/openapi/v1/balance') return send(200, { balance: state.balance });
      if (req.url.startsWith('/openapi/v1/animations/library')) {
        return send(200, [{ action_id: 0, key: 'Idle', name: 'Idle' }, { action_id: 97, key: 'Left_Slash', name: 'Left Slash' }, { action_id: 125, key: 'Charged_Spell_Cast', name: 'Charged Spell Cast' }]);
      }
      const m = req.url.match(/^\/openapi\/v[12]\/([a-z0-9-]+)(?:\/([^/?]+))?/);
      if (!m) return send(404, { message: 'nope' });
      const [, kind, id] = m;
      if (req.method === 'POST') {
        const json = JSON.parse(body);
        state.posts.push({ kind, json });
        if (state.balance < cost[kind]) return send(402, { message: 'Insufficient credits' });
        state.balance -= cost[kind];
        const newId = `task-${state.posts.length}`;
        state.tasks.set(newId, { kind, json });
        return send(202, { result: newId });
      }
      const t = state.tasks.get(id);
      if (!t) return send(404, { message: 'Task not found' });
      state.polls++;
      if (state.slow) return send(200, { id, status: 'IN_PROGRESS', progress: 40 });
      if (t.kind === 'rigging' && failRig) {
        state.balance += cost.rigging;
        return send(200, { id, status: 'FAILED', task_error: { message: 'Pose estimation failed' } });
      }
      const done = { id, status: 'SUCCEEDED', progress: 100, consumed_credits: cost[t.kind], expires_at: Date.now() + 3 * 864e5 };
      if (t.kind === 'image-to-3d' || t.kind === 'text-to-3d') {
        return send(200, { ...done, model_urls: { glb: `${base}/files/model.glb` }, thumbnail_url: `${base}/files/thumb.png` });
      }
      if (t.kind === 'rigging') {
        return send(200, { ...done, result: { rigged_character_glb_url: `${base}/files/rigged.glb`, basic_animations: { walking_glb_url: `${base}/files/walk.glb`, running_glb_url: `${base}/files/run.glb` } } });
      }
      return send(200, { ...done, result: { animation_glb_url: `${base}/files/anim.glb` } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}

function run(args, { cwd, base, key = 'msy_test' }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd,
      env: { ...process.env, MESHY_API_KEY: key, MESHGEN_API_BASE: base, MESHGEN_QUIET: '1', PATH: '/nonexistent' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, json: JSON.parse(stdout.trim().split('\n').pop() || '{}'), stderr }));
  });
}

function tempProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meshgen-test-'));
  fs.writeFileSync(path.join(dir, 'hero.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  return dir;
}

test('character: picture to model, rig, animate, one GLB with every clip', async () => {
  const fake = await fakeMeshy();
  const cwd = tempProject();
  try {
    const r = await run(['character', 'Hero Mage', '--image', 'hero.png', '--height', '1.75', '--actions', 'idle,walk,run,slash,cast'], { cwd, base: fake.base });
    assert.equal(r.code, 0, r.stderr + JSON.stringify(r.json));
    assert.equal(r.json.success, true);
    assert.equal(r.json.name, 'hero-mage');
    assert.equal(r.json.file, path.join('assets', 'meshgen', 'hero-mage', 'hero-mage.glb'));
    assert.deepEqual(r.json.clips, ['idle', 'slash', 'cast', 'walk', 'run']);
    assert.equal(r.json.height, 1.75);
    assert.equal(r.json.creditsUsed, 44);
    assert.match(r.json.previewError, /playwright-cli/);
    const kinds = fake.state.posts.map((p) => p.kind);
    assert.deepEqual(kinds, ['image-to-3d', 'rigging', 'animations']);
    assert.match(fake.state.posts[0].json.image_url, /^data:image\/png;base64,/);
    assert.equal(fake.state.posts[0].json.pose_mode, 'a-pose');
    assert.equal(fake.state.posts[1].json.height_meters, 1.75);
    assert.deepEqual(fake.state.posts[2].json.action_ids, [0, 97, 125]);
    const info = meshgen.inspectGlb(fs.readFileSync(path.join(cwd, r.json.file)));
    assert.deepEqual(info.clips.map((c) => c.name), ['idle', 'slash', 'cast', 'walk', 'run']);
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'assets/meshgen/hero-mage/meshgen.json'), 'utf8'));
    assert.equal(manifest.done, true);
    assert.ok(fs.existsSync(path.join(cwd, '.meshgen-history.jsonl')));
  } finally {
    fake.server.close();
  }
});

test('model from text runs preview then refine, and never overwrites', async () => {
  const fake = await fakeMeshy();
  const cwd = tempProject();
  try {
    const args = ['model', 'chest', '--prompt', 'a wooden chest', '--height', '0.6', '--no-history'];
    const first = await run(args, { cwd, base: fake.base });
    assert.equal(first.code, 0, JSON.stringify(first.json));
    assert.equal(first.json.height, 0.6);
    assert.deepEqual(fake.state.posts.map((p) => p.json.mode), ['preview', 'refine']);
    assert.equal(fake.state.posts[1].json.preview_task_id, 'task-1');
    const second = await run(args, { cwd, base: fake.base });
    assert.equal(second.json.name, 'chest-v2');
    assert.ok(!fs.existsSync(path.join(cwd, '.meshgen-history.jsonl')));
  } finally {
    fake.server.close();
  }
});

test('a timed-out job resumes on the next run without paying again', async () => {
  const fake = await fakeMeshy({ slow: true });
  const cwd = tempProject();
  try {
    const args = ['model', 'rock', '--image', 'hero.png', '--wait', '1'];
    const first = await run(args, { cwd, base: fake.base });
    assert.equal(first.code, 1);
    assert.equal(first.json.pending, true);
    assert.match(first.json.error, /Run the same command again/);
    fake.state.slow = false;
    const second = await run(args, { cwd, base: fake.base });
    assert.equal(second.json.success, true, JSON.stringify(second.json));
    assert.equal(second.json.name, 'rock');
    assert.equal(fake.state.posts.length, 1);
  } finally {
    fake.server.close();
  }
});

test('failures explain themselves: bad key, no credits, failed rig, budget', async () => {
  const fake = await fakeMeshy({ failRig: true });
  const cwd = tempProject();
  try {
    const badKey = await run(['balance'], { cwd, base: fake.base, key: 'wrong' });
    assert.match(badKey.json.error, /didn't accept MESHY_API_KEY/);
    const budget = await run(['character', 'x', '--image', 'hero.png', '--max-credits', '20'], { cwd, base: fake.base });
    assert.match(budget.json.error, /about 50 credits, over --max-credits 20/);
    const rig = await run(['character', 'y', '--image', 'hero.png'], { cwd, base: fake.base });
    assert.match(rig.json.error, /rig job failed: Pose estimation failed\. Meshy refunds failed jobs/);
    fake.state.balance = 3;
    const poor = await run(['model', 'z', '--image', 'hero.png'], { cwd, base: fake.base });
    assert.match(poor.json.error, /needs about 30 credits and the account has 3/);
  } finally {
    fake.server.close();
  }
});

test('dry runs show the plan and cost without a key or network', async () => {
  const r = await run(['character', 'hero', '--prompt', 'a knight', '--draft', '--dry-run'], { cwd: tempProject(), base: 'http://127.0.0.1:9', key: '' });
  assert.equal(r.json.success, true);
  assert.equal(r.json.credits, 15 + 5 + 15);
  assert.deepEqual(r.json.steps.map((s) => s.body.mode || Object.keys(s.body)[0]), ['preview', 'refine', 'input_task_id', 'rig_task_id']);
  assert.equal(r.json.steps[0].body.ai_model, 'meshy-6-lite');
});

test('PNG textures round-trip and shrink to fit inside the GLB', () => {
  const size = 8;
  const data = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) data.set([i * 4, 255 - i * 4, (i * 7) & 0xff], i * 3);
  const png = meshgen.encodePng({ width: size, height: size, channels: 3, color: 2, data });
  assert.deepEqual(meshgen.decodePng(png).data, data);

  const g = meshgen.parseGlb(makeGlb());
  const offset = g.bin.length;
  g.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
  g.json.images = [{ bufferView: g.json.bufferViews.length - 1, mimeType: 'image/png' }];
  const glb = meshgen.writeGlb(g.json, Buffer.concat([g.bin, png]));
  const { glb: small, changed } = meshgen.shrinkTextures(glb, 4);
  assert.deepEqual(changed, ['8->4']);
  const info = meshgen.inspectGlb(small);
  assert.deepEqual([info.textures[0].width, info.textures[0].height], [4, 4]);
  assert.equal(info.triangles, 1);
  assert.equal(meshgen.shrinkTextures(glb, 8).glb, glb);
});

test('rerunning a pending job with other clips resumes it and counts its credits', async () => {
  const fake = await fakeMeshy({ slow: true });
  const cwd = tempProject();
  try {
    const first = await run(['character', 'hero', '--image', 'hero.png', '--actions', 'idle', '--wait', '1'], { cwd, base: fake.base });
    assert.equal(first.json.pending, true);
    fake.state.slow = false;
    const second = await run(['character', 'hero', '--image', 'hero.png', '--actions', 'idle,slash', '--max-texture', '512'], { cwd, base: fake.base });
    assert.equal(second.json.success, true, JSON.stringify(second.json));
    assert.equal(second.json.name, 'hero');
    assert.deepEqual(second.json.clips, ['idle', 'slash']);
    assert.equal(fake.state.posts.filter((p) => p.kind === 'image-to-3d').length, 1);
    assert.equal(second.json.creditsUsed, 30 + 5 + 9);
  } finally {
    fake.server.close();
  }
});

test('a job Meshy rejects while polling fails at once with its message', async () => {
  const fake = await fakeMeshy();
  const cwd = tempProject();
  const listener = fake.server.listeners('request')[0];
  fake.server.removeAllListeners('request');
  fake.server.on('request', (req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/openapi/v1/image-to-3d/')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'This model type does not support this operation' }));
      return;
    }
    listener(req, res);
  });
  try {
    const r = await run(['model', 'rock', '--image', 'hero.png', '--wait', '30'], { cwd, base: fake.base });
    assert.match(r.json.error, /can't do this with that model: This model type does not support/);
  } finally {
    fake.server.close();
  }
});

test('re-rigging redoes the paid clips on the new skeleton', async () => {
  const fake = await fakeMeshy();
  const cwd = tempProject();
  try {
    await run(['character', 'hero', '--image', 'hero.png', '--actions', 'idle,slash'], { cwd, base: fake.base });
    const dry = await run(['rig', 'hero', '--height', '2', '--dry-run'], { cwd, base: fake.base });
    assert.equal(dry.json.credits, 5 + 6);
    const r = await run(['rig', 'hero', '--height', '2'], { cwd, base: fake.base });
    assert.equal(r.json.success, true, JSON.stringify(r.json));
    const anims = fake.state.posts.filter((p) => p.kind === 'animations');
    assert.equal(anims.length, 2);
    assert.equal(anims[1].json.rig_task_id, 'task-4');
    assert.deepEqual(anims[1].json.action_ids, [0, 97]);
  } finally {
    fake.server.close();
  }
});
