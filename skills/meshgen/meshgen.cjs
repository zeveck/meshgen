#!/usr/bin/env node

// meshgen.cjs - Meshy API wrapper for 3D game assets: models from text or
// pictures, auto-rigging, animation, one game-ready GLB per asset, and
// screenshot previews. Zero external dependencies. Requires Node.js 20.12+.
//
// Usage:
//   node meshgen.cjs <command> [name] [options]     (node meshgen.cjs --help)

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const zlib = require("zlib");
const crypto = require("crypto");
const { execFile } = require("child_process");

// Load .env files the same way imagegen2 does: cwd and its parents, then the
// script's directory and its parents. Nearest wins per variable, and a file
// never overrides a variable that is already set.
(function loadEnv() {
  const tried = new Set();
  for (const start of [process.cwd(), __dirname]) {
    let dir = start;
    while (dir && dir !== path.dirname(dir)) {
      const p = path.join(dir, ".env");
      dir = path.dirname(dir);
      if (tried.has(p)) continue;
      tried.add(p);
      try {
        if (fs.existsSync(p)) process.loadEnvFile(p);
      } catch {}
    }
  }
})();

// Date-based release version; keep in sync with package.json (tests check).
const MESHGEN_VERSION = "2026.11.2";

// MESHGEN_API_BASE exists for the offline tests, which run a fake Meshy.
const API_BASE = (process.env.MESHGEN_API_BASE || "https://api.meshy.ai").replace(/\/$/, "");
const DEFAULT_DIR = path.join("assets", "meshgen");
const DEFAULT_WAIT_SECONDS = 540;
const DEFAULT_MAX_TEXTURE = 1024;
const DEFAULT_HEIGHT = 1.7;
// Game-sized triangle budgets. Meshy's newest model doesn't remesh unless
// asked and returns 200k-900k triangles; rigging refuses more than 380k.
const CHARACTER_POLYCOUNT = 30000;
const PROP_POLYCOUNT = 10000;
const RIG_LIMIT = 300000;
const VIEWER_DIR = path.join(__dirname, "viewer");

const ENDPOINTS = {
  text: "/openapi/v2/text-to-3d",
  image: "/openapi/v1/image-to-3d",
  multi: "/openapi/v1/multi-image-to-3d",
  rig: "/openapi/v1/rigging",
  animate: "/openapi/v1/animations",
  remesh: "/openapi/v1/remesh",
  print: "/openapi/v1/print/analyze",
  repair: "/openapi/v1/print/repair",
  multicolor: "/openapi/v1/print/multi-color",
  split: "/openapi/v1/print/split",
};

// Plain game words for Meshy animation library actions (GET
// /openapi/v1/animations/library). walk and run come free with every rig.
const ACTIONS = {
  idle: { id: 0, loop: true },
  walk: { free: "walk", id: 30, loop: true },
  run: { free: "run", id: 14, loop: true },
  jump: { id: 466 },
  attack: { id: 4 },
  slash: { id: 97 },
  combo: { id: 92 },
  cast: { id: 125 },
  hit: { id: 178 },
  die: { id: 8 },
  block: { id: 147 },
  dodge: { id: 158 },
  punch: { id: 198 },
  kick: { id: 103 },
  wave: { id: 28 },
  cheer: { id: 49 },
  bow: { id: 41 },
  taunt: { id: 88 },
  dance: { id: 22, loop: true },
  "combat-idle": { id: 89, loop: true },
  crouch: { id: 524, loop: true },
  swim: { id: 569, loop: true },
  climb: { id: 438, loop: true },
  fall: { id: 502, loop: true },
  "get-up": { id: 344 },
  sit: { id: 32, loop: true },
  sleep: { id: 267, loop: true },
  push: { id: 261, loop: true },
  pickup: { id: 276 },
};

const DEFAULT_CHARACTER_ACTIONS = ["idle", "walk", "run", "jump", "attack", "hit", "die"];
const FORMATS = ["glb", "fbx", "obj", "usdz", "stl", "3mf"];

// ---------------------------------------------------------------------------
// --version and --help
// ---------------------------------------------------------------------------

const HELP = `
meshgen ${MESHGEN_VERSION} - 3D game assets with Meshy (needs MESHY_API_KEY in .env)

Commands:
  balance                         Credits left (free)
  actions [search]                Plain action names, or search Meshy's library (free)
  model <name> --prompt "..."     A textured model from text (30 credits, --draft 15)
  model <name> --image a.png      ...or from 1-4 pictures, front view first (30, --draft 15)
  remesh <name> [--polycount n]   Fewer triangles: 10000 for props, 30000 for characters (5)
  rig <name>                      Add a skeleton; walk and run come free (5)
  animate <name> <actions...>     Add clips: idle slash cast=129 Left_Slash (3 each)
  character <name> --prompt|--image ... [--actions idle,walk,...]
                                  Model in A-pose, rig, animate, preview (about 50)
  rebuild <name>                  Remake the final GLB from saved files with new options (free)
  inspect <name|file.glb>         Height, triangles, bones, clips, textures (free)
  preview <name|file.glb>         Screenshot sheet: four views plus frames of each clip
  view <name|file.glb>            Open an interactive viewer on a local web address
  printcheck <name>               3D print: check for holes and thin walls (free)
  repair <name>                   3D print: fix holes and thicken thin walls (10)
  multicolor <name>               3D print: a multi-color 3MF for your printer (10)
  split <name>                    3D print: cut into parts that print separately (10)

Options:
  --prompt <text>       What to make
  --image <path|url>    Reference picture (repeat for side and back views)
  --texture-prompt <t>  Extra texture guidance
  --draft               Cheaper, rougher model (meshy-6-lite)
  --height <meters>     Character height for rigging, or scale a model to this height
  --polycount <n>       Triangles (100-300000; default 30000 characters, 10000 models, full for prints)
  --topology <t>        triangle (default) or quad
  --pose <p>            a-pose, t-pose or none (character defaults to a-pose)
  --pbr                 Add metallic, roughness and normal maps
  --texture <res>       2k (default), 4k or 8k: what Meshy paints (--draft: 2k only)
  --max-texture <px>    Shrink the final GLB's textures to fit (default ${DEFAULT_MAX_TEXTURE}; 0 keeps them)
  --formats <list>      glb (default), fbx, obj, usdz, stl, 3mf
  --actions <list>      Actions for character (default ${DEFAULT_CHARACTER_ACTIONS.join(",")})
  --quadruped           rig, character: four-legged rig, walk clip only (experimental)
  --root-motion         Keep clips' forward motion (default: clips play in place)
  --no-root-motion      Back to in-place clips (rebuild, animate)
  --dir <path>          Where asset folders go (default ${DEFAULT_DIR})
  --max-credits <n>     Refuse to start if the estimate is higher
  --wait <seconds>      How long to wait for Meshy (default ${DEFAULT_WAIT_SECONDS}); rerun to resume
  --print               model: for a 3D print (full detail, STL and 3MF, no game remesh)
  --height-mm <n>       Planned print height in millimeters
  --printer <type>      printcheck, repair: fdm (default), sla or full_color
  --colors <n>          multicolor: up to 16 (default 4)
  --style <s>           multicolor: realistic (default) or cartoon
  --printer-brand <b>   multicolor: bambu (default), prusa, creality, elegoo, ...
  --parts <text>        split: name the parts to cut along ("head, arms, base")
  --plate               split: lay the parts flat on the build plate
  --connectors          split: add pegs so the parts fit back together
  --clips <list>        preview: only these clips
  --category <name>     actions: only this category (WalkAndRun, Fighting, ...)
  --port <n>            view: port (default 8737)
  --dry-run             Show the requests and credit cost, call nothing
  --no-history          Skip .meshgen-history.jsonl
  --version, --help

Every command prints one JSON line on stdout. Progress goes to stderr.
`.trim();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

class MeshgenError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = "MeshgenError";
    this.extra = extra;
  }
}

function out(result) {
  process.stdout.write(JSON.stringify({ ...result, meshgenVersion: MESHGEN_VERSION }) + "\n");
}

function fail(message, extra = {}) {
  out({ success: false, error: message, ...extra });
  process.exit(1);
}

function log(message) {
  if (!process.env.MESHGEN_QUIET) process.stderr.write(`meshgen: ${message}\n`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function slug(name) {
  const s = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) throw new MeshgenError("Give the asset a name, like: meshgen model treasure-chest --prompt \"...\"");
  return s;
}

function sha1(value) {
  return crypto.createHash("sha1").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const VALUE_FLAGS = new Set([
  "--prompt", "--image", "--texture-prompt", "--height", "--polycount", "--topology", "--pose",
  "--texture", "--formats", "--actions", "--dir", "--max-credits", "--wait", "--height-mm",
  "--printer", "--clips", "--port", "--category", "--max-texture",
  "--colors", "--style", "--printer-brand", "--parts",
]);
const BOOL_FLAGS = new Set([
  "--draft", "--pbr", "--root-motion", "--no-root-motion", "--quadruped", "--print", "--plate", "--connectors",
  "--dry-run", "--no-history",
]);
const PRINTER_BRANDS = ["bambu", "anycubic", "creality", "elegoo", "flashforge", "prusa", "qidi", "snapmaker", "ankermake"];

function parseArgs(argv) {
  const opts = { command: null, positional: [], images: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let flag = arg;
    let value;
    if (arg.startsWith("--") && arg.includes("=")) {
      flag = arg.slice(0, arg.indexOf("="));
      value = arg.slice(arg.indexOf("=") + 1);
    }
    if (VALUE_FLAGS.has(flag)) {
      if (value === undefined) {
        value = argv[++i];
        if (value === undefined || (value.startsWith("--") && value.length > 2)) throw new MeshgenError(`${flag} needs a value.`);
      }
      const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (flag === "--image") opts.images.push(value);
      else opts[key] = value;
    } else if (BOOL_FLAGS.has(flag)) {
      opts[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    } else if (arg.startsWith("--")) {
      throw new MeshgenError(`Unknown option ${arg}. Run meshgen --help for the list.`);
    } else if (!opts.command) {
      opts.command = arg;
    } else {
      opts.positional.push(arg);
    }
  }
  return validateOpts(opts);
}

function numberOpt(opts, key, min, max, label) {
  if (opts[key] === undefined) return;
  const n = Number(opts[key]);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new MeshgenError(`${label} must be a number from ${min} to ${max}.`);
  }
  opts[key] = n;
}

function validateOpts(opts) {
  numberOpt(opts, "height", 0.05, 100, "--height");
  numberOpt(opts, "polycount", 100, 300000, "--polycount");
  numberOpt(opts, "maxCredits", 0, 100000, "--max-credits");
  numberOpt(opts, "wait", 1, 86400, "--wait");
  numberOpt(opts, "heightMm", 1, 1000, "--height-mm");
  numberOpt(opts, "port", 1, 65535, "--port");
  numberOpt(opts, "maxTexture", 0, 16384, "--max-texture");
  numberOpt(opts, "colors", 1, 16, "--colors");
  if (opts.style && !["realistic", "cartoon"].includes(opts.style)) {
    throw new MeshgenError("--style must be realistic or cartoon.");
  }
  if (opts.printerBrand && !PRINTER_BRANDS.includes(opts.printerBrand)) {
    throw new MeshgenError(`--printer-brand must be one of ${PRINTER_BRANDS.join(", ")}.`);
  }
  if (opts.print && !opts.formats) opts.formats = "glb,stl,3mf";
  if (opts.polycount !== undefined) opts.polycount = Math.round(opts.polycount);
  if (opts.topology && !["triangle", "quad"].includes(opts.topology)) {
    throw new MeshgenError("--topology must be triangle or quad.");
  }
  if (opts.pose && !["a-pose", "t-pose", "none"].includes(opts.pose)) {
    throw new MeshgenError("--pose must be a-pose, t-pose or none.");
  }
  if (opts.texture && !["2k", "4k", "8k"].includes(opts.texture)) {
    throw new MeshgenError("--texture must be 2k, 4k or 8k.");
  }
  if (opts.draft && opts.texture && opts.texture !== "2k") {
    throw new MeshgenError("--draft models only come with 2k textures.");
  }
  if (opts.printer && !["fdm", "sla", "full_color"].includes(opts.printer)) {
    throw new MeshgenError("--printer must be fdm, sla or full_color.");
  }
  if (opts.formats) {
    opts.formats = opts.formats.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean);
    const bad = opts.formats.filter((f) => !FORMATS.includes(f));
    if (bad.length) throw new MeshgenError(`Unknown format ${bad.join(", ")}. Choose from ${FORMATS.join(", ")}.`);
    if (!opts.formats.includes("glb")) opts.formats.unshift("glb");
  }
  if (opts.images.length > 4) throw new MeshgenError("Use at most 4 pictures (--image), front view first.");
  if (opts.actions) opts.actions = opts.actions.split(",").map((a) => a.trim()).filter(Boolean);
  if (opts.clips) opts.clips = opts.clips.split(",").map((a) => a.trim()).filter(Boolean);
  return opts;
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

function modelCredits(opts) {
  if (!opts.images.length) {
    return (opts.draft ? 5 : 20) + (opts.texture === "8k" ? 15 : 10);
  }
  if (opts.draft) return 15;
  return opts.texture === "8k" ? 35 : 30;
}

// ---------------------------------------------------------------------------
// Meshy API
// ---------------------------------------------------------------------------

function apiKey() {
  const key = (process.env.MESHY_API_KEY || "").trim();
  if (!key) {
    throw new MeshgenError("MESHY_API_KEY isn't set. Add it to the project's .env (get one at meshy.ai > Settings > API).");
  }
  return key;
}

function friendlyError(status, message, context) {
  const m = message || `HTTP ${status}`;
  if (status === 401) return "Meshy didn't accept MESHY_API_KEY. Check the key in .env.";
  if (status === 402) return `Meshy says there aren't enough credits, or the account needs a paid plan (${m}). Check with: meshgen balance`;
  if (status === 403) return `Meshy can't do this with that model: ${m}`;
  if (status === 404) return `Meshy can't find that ${context || "task"}; its files may have expired (Meshy keeps them 3 days). ${m}`;
  if (status === 422 && context === "rig") {
    return `Meshy couldn't find a pose to rig (${m}). Rigging needs a textured character facing forward: two-legged in an A-pose, or four-legged with --quadruped.`;
  }
  return `Meshy returned ${status}: ${m}`;
}

async function api(method, apiPath, body, { context, deadline } = {}) {
  const key = apiKey();
  let tries = 0;
  for (;;) {
    tries++;
    let res;
    try {
      res = await fetch(API_BASE + apiPath, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(method === "POST" ? 120000 : 30000),
      });
    } catch (err) {
      if (method === "POST") throw new MeshgenError(`Couldn't reach Meshy: ${err.message}`, { uncertain: true });
      if (tries < 5) { await sleep(2000 * tries); continue; }
      throw new MeshgenError(`Couldn't reach Meshy: ${err.message}`);
    }
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text }; }
    if (res.status === 429) {
      const busy = /NoMorePendingTasks/i.test(json.message || text);
      const wait = busy ? 15000 : Math.max(0, Number(res.headers.get("retry-after") || 1)) * 1000;
      if (deadline && Date.now() + wait > deadline) throw new MeshgenError("Meshy is busy (rate limit). Try again shortly.");
      if (busy) log("Meshy is already running as many jobs as this plan allows; waiting for one to finish.");
      if (tries < 200) { await sleep(wait); continue; }
    }
    if (res.status >= 500 && method === "GET" && tries < 5) { await sleep(2000 * tries); continue; }
    if (res.status >= 500 && method === "POST") {
      throw new MeshgenError(friendlyError(res.status, json.message, context), { uncertain: true });
    }
    if (!res.ok) throw new MeshgenError(friendlyError(res.status, json.message, context), { status: res.status });
    return json;
  }
}

async function balance() {
  return api("GET", "/openapi/v1/balance");
}

// With { ctx, step }, a link Meshy has expired (403/404/410) drops that step,
// so running the command again makes it afresh instead of failing forever.
async function download(url, file, job) {
  for (let tries = 1; ; tries++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if ([403, 404, 410].includes(res.status) && job) {
        job.ctx.dropped.add(job.step);
        delete job.ctx.manifest.tasks[job.step];
        saveManifest(job.ctx);
        throw new MeshgenError(
          `Meshy no longer has the files for ${path.basename(file)} (it keeps jobs 3 days). Run the same command again to make them again; that step costs credits again.`
        );
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
      return buf.length;
    } catch (err) {
      if (err instanceof MeshgenError) throw err;
      if (tries >= 3) throw new MeshgenError(`Couldn't download ${path.basename(file)} from Meshy: ${err.message}`);
      await sleep(2000 * tries);
    }
  }
}

function dataUri(file, mime) {
  const buf = fs.readFileSync(file);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function imageInput(ref) {
  if (/^https?:\/\//i.test(ref) || ref.startsWith("data:")) return ref;
  if (!fs.existsSync(ref)) throw new MeshgenError(`Picture not found: ${ref}`);
  const ext = path.extname(ref).toLowerCase();
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[ext];
  if (!mime) throw new MeshgenError(`${ref}: Meshy takes PNG, JPG or WebP pictures.`);
  if (fs.statSync(ref).size > 20 * 1024 * 1024) throw new MeshgenError(`${ref} is over Meshy's 20 MB limit.`);
  return dataUri(ref, mime);
}

// ---------------------------------------------------------------------------
// Asset folders and the manifest (meshgen.json)
// ---------------------------------------------------------------------------

function assetDir(opts, name) {
  return path.resolve(opts.dir || DEFAULT_DIR, name);
}

function loadManifest(dir) {
  const file = path.join(dir, "meshgen.json");
  if (!fs.existsSync(file)) return null;
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  // 2026.11.1 saved text models with no expiry (Meshy sends none for them),
  // so they never looked expired: take it from the saved job.
  for (const ref of [m.modelTask, m.originalModelTask, m.rig]) {
    if (!ref || !ref.id || ref.expiresAt) continue;
    const t = Object.values(m.tasks || {}).find((x) => x && x.id === ref.id && x.task);
    if (t) ref.expiresAt = expiryOf(t.task);
  }
  return m;
}

// Two meshgen commands can work on one asset at once (say multicolor and
// split), so a save keeps job records the other one wrote in the meantime.
function withLock(file, fn) {
  const lock = `${file}.lock`;
  for (let i = 0; ; i++) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch (err) {
      if (err.code !== "EEXIST") break;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 10000) fs.rmSync(lock, { force: true }); } catch {}
      if (i > 500) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

function saveManifest(ctx) {
  fs.mkdirSync(ctx.dir, { recursive: true });
  withLock(path.join(ctx.dir, "meshgen.json"), () => saveManifestNow(ctx));
}

function saveManifestNow(ctx) {
  const m = ctx.manifest;
  const disk = loadManifest(ctx.dir);
  if (disk) {
    for (const [step, task] of Object.entries(disk.tasks || {})) {
      if (!(step in m.tasks) && !ctx.dropped.has(step)) m.tasks[step] = task;
    }
    m.print = { ...(disk.print || {}), ...(m.print || {}) };
    for (const clip of disk.clips || []) {
      if (!m.clips.some((c) => c.name === clip.name) && !ctx.droppedClips.has(clip.name)) m.clips.push(clip);
    }
  }
  m.updatedAt = new Date().toISOString();
  writeJson(path.join(ctx.dir, "meshgen.json"), m);
}

// A new model never overwrites an asset: an unfinished one with the same
// request is resumed, anything else gets the next free -v2, -v3 name.
// Only what changes Meshy's model counts: rerunning a pending job with other
// clips, texture limits or root motion resumes it instead of paying again.
function requestHash(r) {
  const { prompt, images, texturePrompt, draft, polycount, topology, pose, pbr, texture, formats, character, print, quadruped } = r;
  return sha1({
    prompt, images, texturePrompt, draft, polycount, topology, pose, pbr, texture, formats, character,
    print: print || undefined, quadruped: quadruped || undefined,
  });
}

function claimDir(opts, name, request) {
  const base = slug(name);
  for (let v = 1; ; v++) {
    const finalName = v === 1 ? base : `${base}-v${v}`;
    const dir = assetDir(opts, finalName);
    const manifest = loadManifest(dir);
    if (!manifest && !fs.existsSync(path.join(dir, `${finalName}.glb`))) {
      return { name: finalName, dir, manifest: null };
    }
    if (manifest && manifest.requestHash === requestHash(request) && !manifest.done) {
      return { name: finalName, dir, manifest };
    }
  }
}

function openAsset(opts, name) {
  const finalName = slug(name);
  const dir = assetDir(opts, finalName);
  const manifest = loadManifest(dir);
  if (!manifest) throw new MeshgenError(`No meshgen asset named ${finalName} in ${path.relative(process.cwd(), dir) || "."}.`);
  return { name: finalName, dir, manifest };
}

// ---------------------------------------------------------------------------
// Tasks: create once, resume after a crash or timeout, poll until done
// ---------------------------------------------------------------------------

// Meshy keeps jobs 3 days. Text-to-3D jobs come back without expires_at, so
// the 3 days count from when the job finished.
const KEEP_MS = 3 * 24 * 60 * 60 * 1000;
function expiryOf(task) {
  if (!task) return null;
  if (task.expires_at) return task.expires_at;
  const base = task.finished_at || task.created_at;
  return base ? base + KEEP_MS : Date.now() + KEEP_MS;
}

function isExpired(t, marginMs = 10 * 60 * 1000) {
  if (!t) return false;
  const at = t.expiresAt || (t.task ? expiryOf(t.task) : null);
  return !!at && at < Date.now() + marginMs;
}

// After a create call whose answer got lost, finds the job it made: the one
// recent job of that kind (matching the prompt when there is one). Gives up
// when unsure, since adopting another asset's job would be worse.
// Job ids every asset next to this one has recorded.
function knownTaskIds(ctx) {
  const ids = new Set();
  const parent = path.dirname(ctx.dir);
  let names = [];
  try { names = fs.readdirSync(parent); } catch {}
  for (const name of names) {
    const m = loadManifestQuiet(path.join(parent, name));
    if (!m) continue;
    for (const t of Object.values(m.tasks || {})) if (t && t.id) ids.add(t.id);
    for (const t of [m.modelTask, m.originalModelTask, m.rig]) if (t && t.id) ids.add(t.id);
  }
  return ids;
}

function loadManifestQuiet(dir) {
  try { return loadManifest(dir); } catch { return null; }
}

async function recoverTask(ctx, endpoint, since, body) {
  try {
    const list = await api("GET", `${endpoint}?page_num=1&page_size=10&sort_by=-created_at`);
    const items = Array.isArray(list) ? list : list.result || list.data || [];
    const known = knownTaskIds(ctx);
    const recent = items.filter((t) => t.created_at >= since - 120000 && !known.has(t.id) && (!body.prompt || t.prompt === body.prompt));
    return recent.length === 1 ? recent[0] : null;
  } catch {
    return null;
  }
}

async function runTask(ctx, step, kind, body, label) {
  const endpoint = ENDPOINTS[kind];
  const tasks = ctx.manifest.tasks;
  const hash = sha1(body);
  let t = tasks[step];
  if (!t || t.hash !== hash || t.status === "FAILED" || t.status === "CANCELED") {
    t = null;
  }
  if (t && t.status === "SUCCEEDED" && t.task) return t.task;

  if (t && !t.id) {
    const found = await recoverTask(ctx, endpoint, t.requestedAt, body);
    if (found) {
      log(`picked up the ${label} job started earlier (${found.id}).`);
      t.id = found.id;
      saveManifest(ctx);
    } else {
      t = null;
    }
  }

  if (!t) {
    t = tasks[step] = { kind, hash, requestedAt: Date.now() };
    saveManifest(ctx);
    log(`starting ${label}...`);
    let res;
    try {
      res = await api("POST", endpoint, body, { context: kind, deadline: ctx.deadline });
    } catch (err) {
      if (err.extra && err.extra.uncertain) {
        const found = await recoverTask(ctx, endpoint, t.requestedAt, body);
        if (!found) { ctx.dropped.add(step); delete tasks[step]; saveManifest(ctx); throw err; }
        res = { result: found.id };
      } else {
        ctx.dropped.add(step);
        delete tasks[step];
        saveManifest(ctx);
        throw err;
      }
    }
    t.id = res.result;
    ctx.created.push(t.id);
    saveManifest(ctx);
  } else if (t.status !== "SUCCEEDED") {
    log(`resuming ${label} (${t.id})...`);
  }

  let lastProgress = -1;
  for (;;) {
    const res = await fetch(API_BASE + `${endpoint}/${t.id}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    let task = null;
    let retryAfter = null;
    if (res) {
      retryAfter = res.headers.get("retry-after");
      if (res.status === 404) {
        ctx.dropped.add(step);
        delete tasks[step];
        saveManifest(ctx);
        throw new MeshgenError(`Meshy no longer has the ${label} job (it keeps jobs 3 days). Run the command again to start that step over.`);
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        const body = await res.json().catch(() => ({}));
        throw new MeshgenError(friendlyError(res.status, body.message, kind));
      }
      if (res.ok) task = await res.json().catch(() => null);
    }
    if (task) {
      t.status = task.status;
      if (task.progress !== lastProgress && task.status === "IN_PROGRESS") {
        lastProgress = task.progress;
        log(`${label}: ${task.progress}%`);
      }
      if (task.status === "SUCCEEDED") {
        if (!t.counted) { ctx.spent += task.consumed_credits || 0; t.counted = true; }
        t.task = task;
        t.credits = task.consumed_credits;
        t.expiresAt = expiryOf(task);
        saveManifest(ctx);
        log(`${label}: done.`);
        return task;
      }
      if (task.status === "FAILED" || task.status === "CANCELED") {
        saveManifest(ctx);
        const why = (task.task_error && task.task_error.message) || task.status.toLowerCase();
        throw new MeshgenError(`Meshy's ${label} job failed: ${why}. Meshy refunds failed jobs.`, { taskId: t.id });
      }
    }
    const waitMs = retryAfter !== null && retryAfter !== "" ? Number(retryAfter) * 1000 : 5000;
    if (Date.now() + waitMs > ctx.deadline) {
      saveManifest(ctx);
      throw new MeshgenError(
        `Meshy is still working on the ${label} (${t.id}). Run the same command again to pick it up; that costs nothing extra.`,
        { pending: true, taskId: t.id, step }
      );
    }
    await sleep(Number.isFinite(waitMs) ? waitMs : 5000);
  }
}

function newCtx(opts, claimed, request) {
  const now = new Date().toISOString();
  const manifest = claimed.manifest || {
    name: claimed.name,
    createdAt: now,
    request,
    requestHash: request ? requestHash(request) : null,
    tasks: {},
    clips: [],
  };
  return {
    opts,
    name: claimed.name,
    dir: claimed.dir,
    manifest,
    created: [],
    dropped: new Set(),
    droppedClips: new Set(),
    spent: 0,
    deadline: Date.now() + (opts.wait || DEFAULT_WAIT_SECONDS) * 1000,
  };
}

// ---------------------------------------------------------------------------
// Making a model
// ---------------------------------------------------------------------------

// 3D prints keep Meshy's full detail unless --polycount says otherwise.
function defaultPolycount(req) {
  if (req.polycount) return req.polycount;
  const formats = req.formats || ["glb"];
  if (req.print || formats.includes("stl") || formats.includes("3mf")) return null;
  return req.character ? CHARACTER_POLYCOUNT : PROP_POLYCOUNT;
}

function modelRequests(req) {
  const formats = req.formats || ["glb"];
  const common = {};
  const polycount = defaultPolycount(req);
  if (polycount) { common.should_remesh = true; common.target_polycount = polycount; }
  if (req.topology) common.topology = req.topology;
  if (req.pose && req.pose !== "none") common.pose_mode = req.pose;
  common.target_formats = formats;
  const texture = {};
  if (req.pbr) texture.enable_pbr = true;
  if (req.texture) texture.texture_resolution = req.texture;
  if (req.texturePrompt) texture.texture_prompt = req.texturePrompt;
  const aiModel = req.draft ? "meshy-6-lite" : "latest";
  if (!req.images.length) {
    return [
      { step: "preview", kind: "text", label: "model shape", body: { mode: "preview", prompt: req.prompt, ai_model: aiModel, ...common } },
      { step: "refine", kind: "text", label: "textures", body: { mode: "refine", preview_task_id: "$preview", ...texture, target_formats: formats } },
    ];
  }
  const images = req.images.map(imageInput);
  if (images.length === 1) {
    return [{ step: "model", kind: "image", label: "model", body: { image_url: images[0], ai_model: aiModel, should_texture: true, ...common, ...texture } }];
  }
  return [{ step: "model", kind: "multi", label: "model", body: { image_urls: images, ai_model: aiModel, should_texture: true, ...common, ...texture } }];
}

async function makeModel(ctx) {
  const req = ctx.manifest.request;
  // Textures are painted onto the preview job, which Meshy keeps 3 days. An
  // expired one has to be made again, unless its textures are done or still
  // being made.
  const { preview, refine } = ctx.manifest.tasks;
  const refineAlive = refine && (refine.status === "SUCCEEDED"
    || (refine.id && !["FAILED", "CANCELED"].includes(refine.status) && Date.now() - refine.requestedAt < KEEP_MS));
  if (preview && isExpired(preview) && !refineAlive) {
    ctx.dropped.add("preview");
    delete ctx.manifest.tasks.preview;
  }
  let last = null;
  for (const r of modelRequests(req)) {
    if (r.body.preview_task_id === "$preview") r.body.preview_task_id = last.id;
    last = await runTask(ctx, r.step, r.kind, r.body, r.label);
  }
  ctx.manifest.modelTask = { id: last.id, expiresAt: expiryOf(last), kind: ctx.manifest.tasks[req.images.length ? "model" : "refine"].kind };
  const urls = last.model_urls || {};
  if (!urls.glb) throw new MeshgenError("Meshy finished but sent no GLB file.");
  const files = {};
  for (const fmt of req.formats || ["glb"]) {
    if (!urls[fmt]) continue;
    const file = path.join(ctx.dir, "source", `model.${fmt}`);
    await download(urls[fmt], file, { ctx, step: req.images.length ? "model" : "refine" });
    files[fmt] = rel(ctx, file);
    if (fmt === "obj" && urls.mtl) await download(urls.mtl, path.join(ctx.dir, "source", "model.mtl"));
  }
  if (last.thumbnail_url) {
    await download(last.thumbnail_url, path.join(ctx.dir, "source", "thumbnail.png")).catch(() => {});
  }
  ctx.manifest.files = { ...(ctx.manifest.files || {}), model: files };
  saveManifest(ctx);
}

function rel(ctx, file) {
  return path.relative(ctx.dir, file).split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// Rigging and animation
// ---------------------------------------------------------------------------

// Remeshes source/model.glb at Meshy (5 credits). The original stays in
// source/model-full.glb.
async function remeshModel(ctx, polycount) {
  const m = ctx.manifest;
  const src = path.join(ctx.dir, "source");
  const full = path.join(src, "model-full.glb");
  const current = path.join(src, "model.glb");
  if (!fs.existsSync(full)) fs.copyFileSync(current, full);
  const body = { target_polycount: polycount, topology: m.request.topology || "triangle", target_formats: ["glb"] };
  const original = m.originalModelTask || m.modelTask;
  if (original && original.id && !isExpired(original)) body.input_task_id = original.id;
  else body.model_url = dataUri(full, "application/octet-stream");
  const task = await runTask(ctx, `remesh-${polycount}`, "remesh", body, `remesh to ${polycount} triangles`);
  const url = task.model_urls && task.model_urls.glb;
  if (!url) throw new MeshgenError("Meshy finished the remesh but sent no GLB file.");
  await download(url, current, { ctx, step: `remesh-${polycount}` });
  if (!m.originalModelTask) m.originalModelTask = m.modelTask;
  m.modelTask = { id: task.id, expiresAt: expiryOf(task), kind: "remesh" };
  m.remeshed = polycount;
  saveManifest(ctx);
}

async function rigModel(ctx) {
  const m = ctx.manifest;
  const tooBig = inspectGlb(fs.readFileSync(path.join(ctx.dir, "source", "model.glb"))).triangles > RIG_LIMIT;
  if (tooBig) {
    log("the model has too many triangles to rig, so remeshing it first (5 credits).");
    await remeshModel(ctx, m.request.polycount || CHARACTER_POLYCOUNT);
  }
  const height = m.request.height || DEFAULT_HEIGHT;
  const modelFile = path.join(ctx.dir, "source", "model.glb");
  const body = { height_meters: height };
  // Only in Meshy's OpenAPI spec so far; quadruped rigs get a walk clip and
  // can't use the animation library.
  if (m.request.quadruped) body.animation_type = "quadruped";
  if (m.modelTask && m.modelTask.id && !isExpired(m.modelTask)) body.input_task_id = m.modelTask.id;
  else {
    if (!fs.existsSync(modelFile)) throw new MeshgenError("source/model.glb is missing, so there's nothing to rig.");
    body.model_url = dataUri(modelFile, "model/gltf-binary");
  }
  // An expired rig is set aside so a new one is made. A newer rig still
  // being made (a rerun after --wait ran out) has no expiry yet: picked up.
  if (isExpired(m.tasks.rig)) {
    m.tasks[`rig-${Date.now()}`] = m.tasks.rig;
    delete m.tasks.rig;
    log("the old rig has expired at Meshy (it keeps jobs 3 days), so rigging again.");
  }
  const task = await runTask(ctx, "rig", "rig", body, "rig");
  const r = task.result || {};
  const src = path.join(ctx.dir, "source");
  // A new rig's walk and run replace the old ones (if it sends them).
  if (!m.rig || m.rig.id !== task.id) for (const f of ["walk.glb", "run.glb"]) fs.rmSync(path.join(src, f), { force: true });
  await download(r.rigged_character_glb_url, path.join(src, "rigged.glb"), { ctx, step: "rig" });
  const basic = r.basic_animations || {};
  if (basic.walking_glb_url) await download(basic.walking_glb_url, path.join(src, "walk.glb"));
  if (basic.running_glb_url) await download(basic.running_glb_url, path.join(src, "run.glb"));
  if ((m.request.formats || []).includes("fbx") && r.rigged_character_fbx_url) {
    await download(r.rigged_character_fbx_url, path.join(src, "rigged.fbx"));
  }
  m.rig = { id: task.id, expiresAt: expiryOf(task), height };
  saveManifest(ctx);
  return task;
}

const LOOPING = /idle|walk|run|loop|swim|dance/i;

// "idle", "cast=129", "cast=mage_soell_cast", "Left_Slash" or "466".
function resolveAction(spec, library) {
  let name = spec;
  let pick = null;
  const eq = spec.indexOf("=");
  if (eq > 0) { name = spec.slice(0, eq); pick = spec.slice(eq + 1); }
  const clip = slugClip(name);
  if (!pick && ACTIONS[clip]) return { clip, ...ACTIONS[clip] };
  const target = pick || name;
  if (/^\d+$/.test(target)) {
    const id = Number(target);
    const entry = library && library.find((a) => a.action_id === id);
    if (library && !entry) throw new MeshgenError(`There's no Meshy action ${id}. Look one up with: meshgen actions <word>`);
    // A clip made again on a new rig comes back as "idle=0": it keeps its loop.
    const loop = ACTIONS[clip] && ACTIONS[clip].id === id ? !!ACTIONS[clip].loop : !!entry && LOOPING.test(entry.key);
    return { clip: /^\d+$/.test(name) ? slugClip(entry ? entry.key : `action-${id}`) : clip, id, loop };
  }
  const entry = library && library.find((a) => a.key.toLowerCase() === target.toLowerCase() || a.name.toLowerCase() === target.toLowerCase());
  if (!entry) {
    throw new MeshgenError(`"${target}" isn't an action meshgen knows. Plain names: ${Object.keys(ACTIONS).join(", ")}. Or search Meshy's library: meshgen actions ${target}`);
  }
  return { clip, id: entry.action_id, loop: LOOPING.test(entry.key) };
}

function slugClip(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function needsLibrary(specs) {
  return specs.some((s) => s.includes("=") || !ACTIONS[slugClip(s)]);
}

async function animateModel(ctx, specs) {
  const m = ctx.manifest;
  const library = needsLibrary(specs) ? await api("GET", "/openapi/v1/animations/library") : null;
  const wanted = specs.map((s) => resolveAction(s, library));
  const paid = wanted.filter((a) => !a.free || !hasFreeClip(ctx, a.free));
  if (paid.length && isExpired(m.rig)) {
    const credits = 5 + (m.request.quadruped ? 0 : paidSpecs(m).length * 3);
    throw new MeshgenError(`Meshy has deleted this character's rig (it keeps jobs 3 days). Run \`meshgen rig ${ctx.name}\` to rig it again and remake its clips (about ${credits} credits), then run this command again.`);
  }
  for (let i = 0; i < paid.length; i += 10) {
    const batch = paid.slice(i, i + 10);
    const ids = [...new Set(batch.map((a) => a.id))];
    const step = `animate-${sha1([m.rig.id, ids]).slice(0, 10)}`;
    const task = await runTask(ctx, step, "animate", { rig_task_id: m.rig.id, action_ids: ids }, `animation (${batch.map((a) => a.clip).join(", ")})`);
    const r = task.result || {};
    const file = path.join(ctx.dir, "source", `anim-${task.id.slice(0, 8)}.glb`);
    if (!fs.existsSync(file)) await download(r.animation_glb_url, file, { ctx, step });
    if ((m.request.formats || []).includes("fbx") && r.animation_fbx_url) {
      await download(r.animation_fbx_url, file.replace(/\.glb$/, ".fbx")).catch(() => {});
    }
    for (const a of batch) setClip(m, { name: a.clip, source: rel(ctx, file), index: ids.indexOf(a.id), actionId: a.id, loop: !!a.loop });
  }
  for (const a of wanted) {
    if (a.free && hasFreeClip(ctx, a.free) && !paid.includes(a)) {
      setClip(m, { name: a.clip, source: `source/${a.free}.glb`, index: 0, actionId: null, loop: true });
    }
  }
  saveManifest(ctx);
}

function hasFreeClip(ctx, which) {
  return fs.existsSync(path.join(ctx.dir, "source", `${which}.glb`));
}

// The paid clips as specs ("slash=97") that make them again on a new rig.
function paidSpecs(m) {
  return m.clips.filter((c) => c.actionId !== null && c.actionId !== undefined).map((c) => `${c.name}=${c.actionId}`);
}

function setClip(m, clip) {
  const i = m.clips.findIndex((c) => c.name === clip.name);
  if (i >= 0) m.clips[i] = clip;
  else m.clips.push(clip);
}

function buildFinal(ctx) {
  saveManifest(ctx); // picks up clips another command added meanwhile
  const m = ctx.manifest;
  const out = path.join(ctx.dir, `${ctx.name}.glb`);
  const rigged = path.join(ctx.dir, "source", "rigged.glb");
  let glb;
  m.warnings = [];
  m.notes = [];
  if (fs.existsSync(rigged)) {
    const clips = m.clips.map((c) => ({
      buf: fs.readFileSync(path.join(ctx.dir, c.source)),
      index: c.index,
      name: c.name,
      loop: c.loop,
    }));
    const merged = mergeClips(fs.readFileSync(rigged), clips, { inPlace: !m.request.rootMotion });
    glb = merged.glb;
    if (merged.warnings.length) m.warnings = merged.warnings;
    // Meshy's four-legged rigs have come back at the wrong scale (a 0.3 m cat
    // measured 0.005 m), so a rig more than twice off its requested height is
    // resized. Humanoid rigs come back at the requested height.
    const target = (m.rig && m.rig.height) || m.request.height;
    const measured = inspectGlb(glb).height;
    if (target && measured && (measured / target < 0.5 || measured / target > 2)) {
      glb = scaleToHeight(glb, target);
      m.notes = [`Meshy's rig was ${measured} m tall, so meshgen scaled it to ${target} m.`];
    }
  } else {
    // Meshy centers models on the origin; every model stands on the ground,
    // and --height also scales it.
    glb = scaleToHeight(fs.readFileSync(path.join(ctx.dir, "source", "model.glb")), m.request.height);
  }
  const maxTexture = m.request.maxTexture === undefined ? DEFAULT_MAX_TEXTURE : m.request.maxTexture;
  if (maxTexture) {
    const shrunk = shrinkTextures(glb, maxTexture);
    glb = shrunk.glb;
    if (shrunk.skipped.length) {
      m.notes.push(`Kept ${shrunk.skipped.join(", ")} textures as they are: meshgen shrinks PNG only, and Meshy's JPEGs are already compact.`);
    }
  }
  fs.writeFileSync(out, glb);
  saveManifest(ctx);
  return out;
}

// ---------------------------------------------------------------------------
// GLB reading, writing and editing (glTF 2.0 binary)
// ---------------------------------------------------------------------------

const COMPONENT = {
  5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
};
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function parseGlb(buf) {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new MeshgenError("Not a GLB file.");
  let offset = 12;
  let json = null;
  let bin = Buffer.alloc(0);
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
    else if (type === 0x004e4942) bin = data;
    offset += 8 + len;
  }
  if (!json) throw new MeshgenError("GLB has no JSON chunk.");
  return { json, bin };
}

function writeGlb(json, bin) {
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  if (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(4 - (jsonBuf.length % 4), 0x20)]);
  if (bin.length % 4) bin = Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
  const chunks = [chunkHeader(jsonBuf.length, 0x4e4f534a), jsonBuf];
  if (bin.length) chunks.push(chunkHeader(bin.length, 0x004e4942), bin);
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + body.length, 8);
  return Buffer.concat([header, body]);
}

function chunkHeader(length, type) {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(length, 0);
  h.writeUInt32LE(type, 4);
  return h;
}

function readAccessor(gltf, index) {
  const acc = gltf.json.accessors[index];
  if (acc.sparse) throw new MeshgenError("Sparse accessors aren't supported.");
  const Type = COMPONENT[acc.componentType];
  const size = TYPE_SIZE[acc.type];
  const out = new Type(acc.count * size);
  if (acc.bufferView === undefined) return { acc, array: out, size };
  const view = gltf.json.bufferViews[acc.bufferView];
  const bytes = Type.BYTES_PER_ELEMENT;
  const stride = view.byteStride || size * bytes;
  const base = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(gltf.bin.buffer, gltf.bin.byteOffset, gltf.bin.byteLength);
  const get = {
    5120: (o) => dv.getInt8(o), 5121: (o) => dv.getUint8(o), 5122: (o) => dv.getInt16(o, true),
    5123: (o) => dv.getUint16(o, true), 5125: (o) => dv.getUint32(o, true), 5126: (o) => dv.getFloat32(o, true),
  }[acc.componentType];
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < size; k++) out[i * size + k] = get(base + i * stride + k * bytes);
  }
  return { acc, array: out, size };
}

// Column-major 4x4 matrices, as glTF stores them.
function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

function applyPoint(m, p) {
  return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
}

function parentMap(json) {
  const parents = new Map();
  (json.nodes || []).forEach((n, i) => (n.children || []).forEach((c) => parents.set(c, i)));
  return parents;
}

function worldMatrix(json, index, parents) {
  let m = nodeMatrix(json.nodes[index]);
  for (let p = parents.get(index); p !== undefined; p = parents.get(p)) m = mul(nodeMatrix(json.nodes[p]), m);
  return m;
}

function imageInfo(gltf, img) {
  const info = { mimeType: img.mimeType || null };
  if (img.bufferView === undefined) return info;
  const view = gltf.json.bufferViews[img.bufferView];
  const b = gltf.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  info.bytes = b.length;
  if (b.readUInt32BE(0) === 0x89504e47) {
    info.width = b.readUInt32BE(16);
    info.height = b.readUInt32BE(20);
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    for (let o = 2; o + 9 < b.length; ) {
      if (b[o] !== 0xff) break;
      const marker = b[o + 1];
      const len = b.readUInt16BE(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        info.height = b.readUInt16BE(o + 5);
        info.width = b.readUInt16BE(o + 7);
        break;
      }
      o += 2 + len;
    }
  }
  return info;
}

function inspectGlb(buf) {
  const gltf = parseGlb(buf);
  const { json } = gltf;
  const nodes = json.nodes || [];
  const parents = parentMap(json);
  let triangles = 0;
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  nodes.forEach((node, i) => {
    if (node.mesh === undefined) return;
    let m;
    if (node.skin !== undefined) {
      // Bind pose: joint world matrix times its inverse bind matrix.
      const skin = json.skins[node.skin];
      const ibm = skin.inverseBindMatrices !== undefined ? Array.from(readAccessor(gltf, skin.inverseBindMatrices).array.slice(0, 16)) : nodeMatrix({});
      m = mul(worldMatrix(json, skin.joints[0], parents), ibm);
    } else {
      m = worldMatrix(json, i, parents);
    }
    for (const prim of json.meshes[node.mesh].primitives) {
      const mode = prim.mode === undefined ? 4 : prim.mode;
      const posAcc = json.accessors[prim.attributes.POSITION];
      const count = prim.indices !== undefined ? json.accessors[prim.indices].count : posAcc.count;
      if (mode === 4) triangles += Math.floor(count / 3);
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
      if (!posAcc.min || !posAcc.max) continue;
      for (let c = 0; c < 8; c++) {
        const p = applyPoint(m, [0, 1, 2].map((k) => ((c >> k) & 1 ? posAcc.max[k] : posAcc.min[k])));
        lo = lo.map((v, k) => Math.min(v, p[k]));
        hi = hi.map((v, k) => Math.max(v, p[k]));
      }
    }
  });
  const round = (v) => Math.round(v * 1000) / 1000;
  const skins = json.skins || [];
  const jointNames = skins.length ? skins[0].joints.map((j) => nodes[j].name || `node${j}`) : [];
  const clips = (json.animations || []).map((a) => {
    let duration = 0;
    for (const s of a.samplers) {
      const acc = json.accessors[s.input];
      duration = Math.max(duration, acc.max ? acc.max[0] : 0);
    }
    return { name: a.name || "", duration: round(duration), channels: a.channels.length, ...(a.extras && a.extras.loop !== undefined ? { loop: a.extras.loop } : {}) };
  });
  const textures = (json.images || []).map((img) => imageInfo(gltf, img));
  const size = Number.isFinite(lo[0]) ? hi.map((v, k) => round(v - lo[k])) : null;
  const info = {
    bytes: buf.length,
    triangles,
    meshes: (json.meshes || []).length,
    skinned: skins.length > 0,
    joints: jointNames.length,
    jointNames,
    clips,
    size,
    height: size ? size[1] : null,
    min: Number.isFinite(lo[0]) ? lo.map(round) : null,
    max: Number.isFinite(hi[0]) ? hi.map(round) : null,
    textures,
  };
  // Exact bounds for resizing; kept out of the JSON that inspect prints.
  Object.defineProperty(info, "exact", { value: { lo, hi }, enumerable: false });
  return info;
}

function checkInspect(info, { height } = {}) {
  const warnings = [];
  if (!info.size) warnings.push("No mesh with known bounds found.");
  else {
    if (height && Math.abs(info.height - height) > height * 0.15) {
      warnings.push(`It is ${info.height} m tall; the target was ${height} m.`);
    }
    if (Math.abs(info.min[1]) > Math.max(0.02, info.height * 0.03)) {
      warnings.push(`Its lowest point is at y=${info.min[1]} m, not on the ground (y=0).`);
    }
  }
  if (!info.textures.length) warnings.push("It has no textures.");
  return warnings;
}

class Appender {
  constructor(gltf) {
    this.json = gltf.json;
    this.parts = [gltf.bin];
    this.length = gltf.bin.length;
  }
  add(typed, acc) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.parts.push(Buffer.alloc(pad)); this.length += pad; }
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length });
    this.parts.push(Buffer.from(bytes));
    this.length += bytes.length;
    const copy = { bufferView: this.json.bufferViews.length - 1, componentType: acc.componentType, count: acc.count, type: acc.type };
    if (acc.normalized) copy.normalized = true;
    if (acc.min) copy.min = acc.min;
    if (acc.max) copy.max = acc.max;
    this.json.accessors.push(copy);
    return this.json.accessors.length - 1;
  }
  finish() {
    const bin = Buffer.concat(this.parts);
    this.json.buffers = [{ byteLength: bin.length }];
    return writeGlb(this.json, bin);
  }
}

function findRootBone(json) {
  const skin = (json.skins || [])[0];
  if (!skin) return null;
  const hips = skin.joints.find((j) => /hips|pelvis/i.test(json.nodes[j].name || ""));
  return hips !== undefined ? hips : skin.joints[0];
}

// Copies clips from GLBs that share the base's skeleton (same bone names) into
// the base, renamed. With inPlace, the root bone keeps only its up-and-down
// movement, so code can move the character without it drifting off.
function mergeClips(baseBuf, clips, { inPlace = true } = {}) {
  const base = parseGlb(baseBuf);
  base.json.accessors = base.json.accessors || [];
  base.json.bufferViews = base.json.bufferViews || [];
  base.json.animations = [];
  const nodes = base.json.nodes || [];
  const byName = new Map();
  nodes.forEach((n, i) => { if (n.name && !byName.has(n.name)) byName.set(n.name, i); });
  const root = findRootBone(base.json);
  const parents = parentMap(base.json);
  let upAxis = 1;
  if (root !== undefined && root !== null && parents.has(root)) {
    const pm = worldMatrix(base.json, parents.get(root), parents);
    const ys = [Math.abs(pm[1]), Math.abs(pm[5]), Math.abs(pm[9])];
    upAxis = ys.indexOf(Math.max(...ys));
  }
  const rest = root !== null && root !== undefined ? nodes[root].translation || [0, 0, 0] : null;
  const app = new Appender(base);
  const warnings = [];
  const parsed = new Map();
  for (const clip of clips) {
    if (!parsed.has(clip.buf)) parsed.set(clip.buf, parseGlb(clip.buf));
    const src = parsed.get(clip.buf);
    const anim = (src.json.animations || [])[clip.index || 0];
    if (!anim) { warnings.push(`No clip ${clip.index} in the source for "${clip.name}".`); continue; }
    const out = { name: clip.name, channels: [], samplers: [], extras: { loop: !!clip.loop } };
    const accMap = new Map();
    const copyAcc = (i, edit) => {
      const key = edit ? `${i}:edit` : i;
      if (!accMap.has(key)) {
        const r = readAccessor(src, i);
        if (edit) edit(r.array, r.size);
        accMap.set(key, app.add(r.array, r.acc));
      }
      return accMap.get(key);
    };
    let missing = 0;
    for (const ch of anim.channels) {
      const srcNode = src.json.nodes[ch.target.node];
      const target = srcNode && byName.get(srcNode.name);
      if (target === undefined) { missing++; continue; }
      const s = anim.samplers[ch.sampler];
      const pin = inPlace && target === root && ch.target.path === "translation";
      const cubic = s.interpolation === "CUBICSPLINE";
      const output = copyAcc(s.output, pin ? (arr, size) => {
        for (let i = 0, e = 0; i < arr.length; i += size, e++) {
          // CUBICSPLINE stores in-tangent, value, out-tangent per keyframe.
          const tangent = cubic && e % 3 !== 1;
          for (let k = 0; k < 3; k++) if (k !== upAxis) arr[i + k] = tangent ? 0 : rest[k];
        }
      } : null);
      out.samplers.push({ input: copyAcc(s.input), output, interpolation: s.interpolation || "LINEAR" });
      out.channels.push({ sampler: out.samplers.length - 1, target: { node: target, path: ch.target.path } });
    }
    if (missing) warnings.push(`"${clip.name}": ${missing} channels had no matching bone and were skipped.`);
    if (out.channels.length) base.json.animations.push(out);
  }
  if (!base.json.animations.length) delete base.json.animations;
  return { glb: app.finish(), warnings };
}

// Puts the scene under one new root node, scaled to the given height and
// standing on y=0.
// Scales the scene to `height` meters (kept as it is with no height) and
// stands it on the ground.
function scaleToHeight(buf, height) {
  const { lo, hi } = inspectGlb(buf).exact;
  const current = hi[1] - lo[1];
  if (!Number.isFinite(current) || current <= 0) return buf;
  const gltf = parseGlb(buf);
  const json = gltf.json;
  const s = height ? height / current : 1;
  const sceneIndex = json.scene || 0;
  const scene = json.scenes[sceneIndex];
  json.nodes.push({ name: "meshgen_root", scale: [s, s, s], translation: [0, -lo[1] * s, 0], children: scene.nodes });
  scene.nodes = [json.nodes.length - 1];
  return writeGlb(json, gltf.bin);
}

// ---------------------------------------------------------------------------
// Textures: Meshy sends 2048 px PNGs (about 4 MB each). Web games load much
// faster at 1024, so the final GLB gets PNGs halved until they fit.
// ---------------------------------------------------------------------------

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// 8-bit grey, RGB, grey+alpha and RGBA, non-interlaced. Returns null for
// anything else, which then stays as it is.
function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };
  if (!ihdr || ihdr.depth !== 8 || ihdr.interlace !== 0 || !CHANNELS[ihdr.color]) return null;
  const ch = CHANNELS[ihdr.color];
  const row = ihdr.width * ch;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const raw = Buffer.alloc(row * ihdr.height);
  for (let y = 0, i = 0; y < ihdr.height; y++) {
    const filter = inflated[i++];
    const o = y * row;
    for (let x = 0; x < row; x++) {
      const a = x >= ch ? raw[o + x - ch] : 0;
      const b = y ? raw[o + x - row] : 0;
      const c = y && x >= ch ? raw[o + x - row - ch] : 0;
      const v = inflated[i++];
      raw[o + x] = (filter === 0 ? v : filter === 1 ? v + a : filter === 2 ? v + b : filter === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xff;
    }
  }
  return { width: ihdr.width, height: ihdr.height, channels: ch, color: ihdr.color, data: raw };
}

function encodePng({ width, height, channels, color, data }) {
  const row = width * channels;
  const out = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * row;
    out[y * (row + 1)] = 4;
    for (let x = 0; x < row; x++) {
      const a = x >= channels ? data[o + x - channels] : 0;
      const b = y ? data[o + x - row] : 0;
      const c = y && x >= channels ? data[o + x - row - channels] : 0;
      out[y * (row + 1) + 1 + x] = (data[o + x] - paeth(a, b, c)) & 0xff;
    }
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = color;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(out, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function halve(img) {
  const w = Math.max(1, img.width >> 1), h = Math.max(1, img.height >> 1), ch = img.channels;
  const out = Buffer.alloc(w * h * ch);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const r0 = Math.min(2 * y, img.height - 1) * img.width;
    const r1 = Math.min(2 * y + 1, img.height - 1) * img.width;
    for (let x = 0; x < w; x++) {
      const c0 = Math.min(2 * x, img.width - 1);
      const c1 = Math.min(2 * x + 1, img.width - 1);
      for (let k = 0; k < ch; k++) {
        out[(y * w + x) * ch + k] = (d[(r0 + c0) * ch + k] + d[(r0 + c1) * ch + k] + d[(r1 + c0) * ch + k] + d[(r1 + c1) * ch + k] + 2) >> 2;
      }
    }
  }
  return { ...img, width: w, height: h, data: out };
}

// Rebuilds the binary chunk with some bufferViews replaced.
function repackGlb(gltf, replace) {
  const parts = [];
  let length = 0;
  gltf.json.bufferViews = gltf.json.bufferViews.map((view, i) => {
    const bytes = replace.get(i) || gltf.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const pad = (4 - (length % 4)) % 4;
    if (pad) { parts.push(Buffer.alloc(pad)); length += pad; }
    parts.push(bytes);
    const next = { ...view, byteOffset: length, byteLength: bytes.length };
    length += bytes.length;
    return next;
  });
  const bin = Buffer.concat(parts);
  gltf.json.buffers = [{ byteLength: bin.length }];
  return writeGlb(gltf.json, bin);
}

function shrinkTextures(buf, maxSize) {
  const gltf = parseGlb(buf);
  const replace = new Map();
  const changed = [];
  const skipped = [];
  for (const img of gltf.json.images || []) {
    if (img.bufferView === undefined || replace.has(img.bufferView)) continue;
    const view = gltf.json.bufferViews[img.bufferView];
    const bytes = gltf.bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    let png = decodePng(bytes);
    if (!png) {
      const info = imageInfo(gltf, img);
      if (info.width > maxSize) skipped.push(`${info.mimeType || "image"} ${info.width}px`);
      continue;
    }
    if (Math.max(png.width, png.height) <= maxSize) continue;
    const from = png.width;
    while (Math.max(png.width, png.height) > maxSize) png = halve(png);
    replace.set(img.bufferView, encodePng(png));
    img.mimeType = "image/png";
    changed.push(`${from}->${png.width}`);
  }
  if (!replace.size) return { glb: buf, changed, skipped };
  return { glb: repackGlb(gltf, replace), changed, skipped };
}

// Binary STL of every mesh in the scene: millimeters, standing on z = 0 with
// Z up as slicers expect, scaled to heightMm when given.
function glbToStl(buf, heightMm) {
  const gltf = parseGlb(buf);
  const { json } = gltf;
  const parents = parentMap(json);
  const tris = [];
  (json.nodes || []).forEach((node, i) => {
    if (node.mesh === undefined) return;
    const m = worldMatrix(json, i, parents);
    for (const prim of json.meshes[node.mesh].primitives) {
      if ((prim.mode === undefined ? 4 : prim.mode) !== 4) continue;
      const pos = readAccessor(gltf, prim.attributes.POSITION).array;
      const idx = prim.indices !== undefined ? readAccessor(gltf, prim.indices).array : null;
      const count = idx ? idx.length : pos.length / 3;
      for (let k = 0; k < count; k++) {
        const v = idx ? idx[k] : k;
        tris.push(applyPoint(m, [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]));
      }
    }
  });
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const p of tris) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const scale = heightMm && hi[1] > lo[1] ? heightMm / (hi[1] - lo[1]) : 1000;
  const cx = (lo[0] + hi[0]) / 2;
  const cz = (lo[2] + hi[2]) / 2;
  // glTF (x, y up, z toward viewer) -> STL (x, -z, y up).
  const P = (p) => [(p[0] - cx) * scale, -(p[2] - cz) * scale, (p[1] - lo[1]) * scale];
  const n = tris.length / 3;
  const out = Buffer.alloc(84 + n * 50);
  out.write("meshgen STL, millimeters, Z up", 0, "ascii");
  out.writeUInt32LE(n, 80);
  for (let t = 0; t < n; t++) {
    const a = P(tris[t * 3]), b = P(tris[t * 3 + 1]), c = P(tris[t * 3 + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    let o = 84 + t * 50;
    for (const v of [nx / len, ny / len, nz / len, ...a, ...b, ...c]) { out.writeFloatLE(v, o); o += 4; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Preview and view (three.js viewer page, screenshots through playwright-cli)
// ---------------------------------------------------------------------------

function resolveGlb(opts, target) {
  if (!target) throw new MeshgenError("Name an asset or a .glb file.");
  if (/\.glb$/i.test(target)) {
    if (!fs.existsSync(target)) throw new MeshgenError(`File not found: ${target}`);
    return { file: path.resolve(target), dir: path.dirname(path.resolve(target)), name: path.basename(target, ".glb"), manifest: null };
  }
  const { name, dir, manifest } = openAsset(opts, target);
  const file = path.join(dir, `${name}.glb`);
  if (!fs.existsSync(file)) throw new MeshgenError(`${name} has no finished GLB yet.`);
  return { file, dir, name, manifest };
}

function serve(glbFile, port = 0) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".glb": "model/gltf-binary", ".css": "text/css" };
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) { res.writeHead(403); res.end(); return; }
    let url;
    try { url = decodeURIComponent(req.url.split("?")[0]); } catch { url = null; }
    if (!url || url.includes("\0")) { res.writeHead(400); res.end(); return; }
    let file;
    if (url === "/model.glb") file = glbFile;
    else {
      file = path.join(VIEWER_DIR, path.normalize(url === "/" ? "/viewer.html" : url));
      if (!file.startsWith(VIEWER_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// Async on purpose: the viewer's web server runs in this same process.
function playwright(args, configFile) {
  return new Promise((resolve, reject) => {
    execFile("playwright-cli", args, { encoding: "utf8", timeout: 120000, cwd: path.dirname(configFile) }, (err, stdout, stderr) => {
      if (err && err.code === "ENOENT") {
        reject(new MeshgenError("Previews need playwright-cli: npm install -g @playwright/cli, then npx playwright install chromium"));
        return;
      }
      resolve(`${stdout || ""}${stderr || ""}`);
    });
  });
}

async function previewSheet(glbFile, outFile, { clips } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meshgen-preview-"));
  const config = path.join(tmp, "cli.config.json");
  writeJson(config, {
    browser: {
      browserName: "chromium",
      launchOptions: { headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
    },
    outputDir: tmp,
  });
  const server = await serve(glbFile);
  const session = `-s=meshgen-${process.pid}`;
  try {
    const query = clips && clips.length ? `&clips=${encodeURIComponent(clips.join(","))}` : "";
    const url = `http://127.0.0.1:${server.address().port}/viewer.html?mode=sheet${query}`;
    const opened = await playwright([session, "open", url, "--config", config], config);
    if (/Error|not found/i.test(opened) && !/Page URL/i.test(opened)) throw new MeshgenError(`Couldn't open the preview browser: ${opened.trim().split("\n").slice(-3).join(" ")}`);
    let state = null;
    for (let i = 0; i < 90 && !state; i++) {
      const r = await playwright([session, "eval", "JSON.stringify(window.meshgenSheet || null)"], config);
      const m = r.match(/### Result\s*\n"(.*)"/);
      if (m) {
        const value = JSON.parse(JSON.parse(`"${m[1]}"`));
        if (value) state = value;
      }
      if (!state) await sleep(1000);
    }
    if (!state) throw new MeshgenError("The preview page didn't finish rendering.");
    if (state.error) throw new MeshgenError(`The preview page couldn't show the model: ${state.error}`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await playwright([session, "screenshot", "canvas", "--filename", outFile], config);
    if (!fs.existsSync(outFile)) throw new MeshgenError("The screenshot wasn't saved.");
    return state;
  } finally {
    await playwright([session, "close"], config).catch(() => {});
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function modelRequestFrom(opts, { character = false } = {}) {
  if (!opts.prompt && !opts.images.length) {
    throw new MeshgenError("Say what to make with --prompt \"...\", or give a picture with --image.");
  }
  return {
    prompt: opts.prompt || null,
    images: opts.images.map((p) => (/^(https?:|data:)/.test(p) ? p : path.relative(process.cwd(), path.resolve(p)).split(path.sep).join("/"))),
    texturePrompt: opts.texturePrompt || null,
    draft: !!opts.draft,
    height: opts.height || (opts.print && opts.heightMm ? opts.heightMm / 1000 : null) || (character ? DEFAULT_HEIGHT : null),
    polycount: opts.polycount || null,
    topology: opts.topology || null,
    pose: opts.pose || (character ? "a-pose" : null),
    pbr: !!opts.pbr,
    texture: opts.texture || null,
    formats: opts.formats || ["glb"],
    rootMotion: !!opts.rootMotion,
    maxTexture: opts.maxTexture,
    quadruped: !!opts.quadruped,
    print: !!opts.print,
    character,
    actions: character ? (opts.actions || DEFAULT_CHARACTER_ACTIONS) : null,
  };
}

function actionCredits(specs) {
  return specs.filter((s) => {
    const a = ACTIONS[slugClip(s.split("=")[0])];
    return !(a && a.free && !s.includes("="));
  }).length * 3;
}

function dryRun(command, opts, request, credits) {
  const steps = [];
  if (request) {
    for (const r of modelRequests({ ...request, images: request.images.map(() => "data:...") })) {
      steps.push({ endpoint: `POST ${ENDPOINTS[r.kind]}`, body: r.body });
    }
  }
  if (command === "character" || command === "rig") {
    const rigBody = { input_task_id: "$model", height_meters: (request && request.height) || opts.height || DEFAULT_HEIGHT };
    if ((request && request.quadruped) || opts.quadruped) rigBody.animation_type = "quadruped";
    steps.push({ endpoint: `POST ${ENDPOINTS.rig}`, body: rigBody });
  }
  if ((command === "character" && !request.quadruped) || command === "animate") {
    const specs = command === "character" ? request.actions : opts.positional.slice(1);
    const ids = specs.map((sp) => {
      try { const a = resolveAction(sp, null); return a.free ? `${a.clip} (free with the rig)` : a.id; } catch { return `${sp} (looked up in Meshy's library)`; }
    });
    steps.push({ endpoint: `POST ${ENDPOINTS.animate}`, body: { rig_task_id: "$rig", action_ids: ids } });
  }
  out({ success: true, dryRun: true, command, credits, steps });
}

// A rerun that collects a job Meshy has already charged for costs nothing,
// so while one is unfinished the balance isn't checked (Meshy still refuses
// a new job the account can't pay for).
function balanceUnlessPending(manifest) {
  const pending = Object.values(manifest.tasks || {}).some((t) => t && !["SUCCEEDED", "FAILED", "CANCELED"].includes(t.status));
  return pending ? null : balance();
}

function checkBudget(opts, credits, before) {
  if (opts.maxCredits !== undefined && credits > opts.maxCredits) {
    throw new MeshgenError(`This would cost about ${credits} credits, over --max-credits ${opts.maxCredits}.`);
  }
  if (before && typeof before.balance === "number" && before.balance < credits) {
    throw new MeshgenError(`This needs about ${credits} credits and the account has ${before.balance}.`);
  }
}

async function finish(ctx, command, before, extra = {}) {
  const m = ctx.manifest;
  const file = path.join(ctx.dir, `${ctx.name}.glb`);
  let info = null;
  let warnings = [...(m.warnings || [])];
  if (fs.existsSync(file)) {
    info = inspectGlb(fs.readFileSync(file));
    warnings = warnings.concat(checkInspect(info, { height: m.request.height }));
  }
  let after = null;
  try { after = await balance(); } catch {}
  const used = ctx.spent;
  m.done = true;
  m.creditsUsed = (m.creditsUsed || 0) + used;
  saveManifest(ctx);
  const result = {
    success: true,
    command,
    name: ctx.name,
    dir: path.relative(process.cwd(), ctx.dir) || ".",
    file: path.relative(process.cwd(), file),
    clips: m.clips.map((c) => c.name),
    height: info && info.height,
    triangles: info && info.triangles,
    joints: info && info.joints,
    textures: info && info.textures.length,
    warnings,
    ...(m.notes && m.notes.length ? { notes: m.notes } : {}),
    creditsUsed: used,
    creditsLeft: after ? after.balance : null,
    ...extra,
  };
  if (!ctx.opts.noHistory) {
    try {
      fs.appendFileSync(path.resolve(".meshgen-history.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...result, request: { ...m.request, images: m.request.images } }) + "\n");
    } catch (err) {
      result.historyWarning = `Failed to write history: ${err.message}`;
    }
  }
  return result;
}

async function tryPreview(ctx) {
  const file = path.join(ctx.dir, `${ctx.name}.glb`);
  const sheet = path.join(ctx.dir, "preview", "sheet.png");
  try {
    await previewSheet(file, sheet);
    return { preview: path.relative(process.cwd(), sheet) };
  } catch (err) {
    return { previewError: err.message };
  }
}

async function cmdModel(opts, character) {
  const name = opts.positional[0];
  const request = modelRequestFrom(opts, { character });
  if (character && request.print) throw new MeshgenError("Prints don't need a rig: use model --print instead of character.");
  const credits = modelCredits(request) + (character ? 5 + (request.quadruped ? 0 : actionCredits(request.actions)) : 0);
  if (opts.dryRun) return dryRun(character ? "character" : "model", opts, request, credits);
  const claimed = claimDir(opts, name, request);
  const before = claimed.manifest ? null : await balance();
  if (!claimed.manifest) checkBudget(opts, credits, before);
  const ctx = newCtx(opts, claimed, request);
  if (claimed.manifest) {
    // A resumed run takes this run's later-step options.
    const passed = {
      actions: opts.actions !== undefined,
      maxTexture: opts.maxTexture !== undefined,
      rootMotion: !!opts.rootMotion,
      height: opts.height !== undefined || !!(opts.print && opts.heightMm),
    };
    for (const key of Object.keys(passed)) if (passed[key]) ctx.manifest.request[key] = request[key];
  }
  saveManifest(ctx);
  if (!fs.existsSync(path.join(ctx.dir, "source", "model.glb")) || !ctx.manifest.modelTask) await makeModel(ctx);
  if (character) {
    if (!ctx.manifest.rig) await rigModel(ctx);
    const actions = ctx.manifest.request.quadruped
      ? ["walk", "run"].filter((w) => hasFreeClip(ctx, w))
      : ctx.manifest.request.actions;
    await animateModel(ctx, actions);
  }
  buildFinal(ctx);
  const result = await finish(ctx, character ? "character" : "model", before);
  Object.assign(result, await tryPreview(ctx));
  out(result);
}

// Rebuilds the final GLB from source/ with new settings, without Meshy.
async function cmdRebuild(opts) {
  const claimed = openAsset(opts, opts.positional[0]);
  const ctx = newCtx(opts, claimed);
  const req = ctx.manifest.request;
  if (opts.maxTexture !== undefined) req.maxTexture = opts.maxTexture;
  if (opts.height && ctx.manifest.rig && opts.height !== ctx.manifest.rig.height) {
    throw new MeshgenError(`${ctx.name} has a skeleton, so its height comes from the rig. Rig it again at the new height: meshgen rig ${ctx.name} --height ${opts.height} (5 credits, plus 3 for each paid clip).`);
  }
  if (opts.height && !ctx.manifest.rig) req.height = opts.height;
  if (opts.rootMotion) req.rootMotion = true;
  if (opts.noRootMotion) req.rootMotion = false;
  if (!fs.existsSync(path.join(ctx.dir, "source", "model.glb"))) {
    throw new MeshgenError(`${ctx.name} has no model yet. Run the command that made it again to finish it.`);
  }
  buildFinal(ctx);
  const result = await finish(ctx, "rebuild", null);
  Object.assign(result, await tryPreview(ctx));
  out(result);
}

async function cmdRemesh(opts) {
  const claimed = openAsset(opts, opts.positional[0]);
  const polycount = opts.polycount || (claimed.manifest.request.character ? CHARACTER_POLYCOUNT : PROP_POLYCOUNT);
  if (opts.dryRun) return out({ success: true, dryRun: true, command: "remesh", credits: 5, steps: [{ endpoint: `POST ${ENDPOINTS.remesh}`, body: { input_task_id: "$model", target_polycount: polycount } }] });
  const before = await balanceUnlessPending(claimed.manifest);
  checkBudget(opts, 5, before);
  const ctx = newCtx(opts, claimed);
  await remeshModel(ctx, polycount);
  if (ctx.manifest.rig) log("the model changed, so rig it again to use the new mesh: meshgen rig " + ctx.name);
  else buildFinal(ctx);
  const result = await finish(ctx, "remesh", before);
  Object.assign(result, await tryPreview(ctx));
  out(result);
}

// A new rig makes old clips wrong (they were made for the old skeleton), so
// rig makes the paid ones again on it, with walk and run, in one step. The
// old clips stay until the new ones replace them, so a rerun after a timeout
// asks for the same clips and picks up the pending job.
async function cmdRig(opts) {
  const claimed = openAsset(opts, opts.positional[0]);
  const m = claimed.manifest;
  const quadruped = !!(opts.quadruped || m.request.quadruped);
  const paid = quadruped ? [] : paidSpecs(m);
  const credits = 5 + paid.length * 3;
  if (opts.dryRun) return dryRun("rig", opts, null, credits);
  const before = await balanceUnlessPending(m);
  checkBudget(opts, credits, before);
  const ctx = newCtx(opts, claimed);
  if (opts.height) m.request.height = opts.height;
  if (opts.quadruped) m.request.quadruped = true;
  await rigModel(ctx);
  const specs = ["walk", "run"].filter((w) => hasFreeClip(ctx, w) && !paid.some((s) => s.startsWith(`${w}=`))).concat(paid);
  await animateModel(ctx, specs);
  // Clips that weren't made again don't fit the new rig.
  const kept = new Set(specs.map((s) => s.split("=")[0]));
  const gone = m.clips.filter((c) => !kept.has(c.name));
  if (gone.length) log(`${gone.map((c) => c.name).join(", ")} can't be made on this rig${quadruped ? " (four-legged rigs can't use Meshy's animation library)" : ""}, so they were dropped.`);
  for (const c of gone) ctx.droppedClips.add(c.name);
  m.clips = m.clips.filter((c) => kept.has(c.name));
  buildFinal(ctx);
  const result = await finish(ctx, "rig", before);
  Object.assign(result, await tryPreview(ctx));
  out(result);
}

async function cmdAnimate(opts) {
  const specs = opts.positional.slice(1);
  if (!specs.length) throw new MeshgenError("Say which actions to add, like: meshgen animate hero idle slash cast");
  const claimed = openAsset(opts, opts.positional[0]);
  const rigged = !!claimed.manifest.rig;
  const credits = actionCredits(specs) + (rigged ? 0 : 5);
  if (opts.dryRun) return dryRun("animate", opts, null, credits);
  const before = await balanceUnlessPending(claimed.manifest);
  checkBudget(opts, credits, before);
  const ctx = newCtx(opts, claimed);
  if (opts.rootMotion) ctx.manifest.request.rootMotion = true;
  if (opts.noRootMotion) ctx.manifest.request.rootMotion = false;
  if (!rigged) await rigModel(ctx);
  await animateModel(ctx, specs);
  buildFinal(ctx);
  const result = await finish(ctx, "animate", before);
  Object.assign(result, await tryPreview(ctx));
  out(result);
}

async function cmdActions(opts) {
  const search = opts.positional.join(" ").trim();
  if (!search && !opts.category) {
    return out({
      success: true,
      actions: Object.entries(ACTIONS).map(([name, a]) => ({ name, actionId: a.id, loop: !!a.loop, ...(a.free ? { free: true } : {}) })),
      note: "walk and run come free with every rig. Any other library action works too: name=<id or key>.",
    });
  }
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (opts.category) params.set("category", opts.category);
  const list = await api("GET", `/openapi/v1/animations/library?${params}`);
  out({
    success: true,
    count: list.length,
    actions: list.slice(0, 60).map((a) => ({ actionId: a.action_id, key: a.key, category: `${a.category}/${a.sub_category}`, preview: a.preview_url })),
  });
}

async function cmdInspect(opts) {
  const { file, manifest } = resolveGlb(opts, opts.positional[0]);
  const info = inspectGlb(fs.readFileSync(file));
  out({ success: true, file: path.relative(process.cwd(), file), ...info, warnings: checkInspect(info, { height: manifest && manifest.request.height }) });
}

async function cmdPreview(opts) {
  const { file, dir, name, manifest } = resolveGlb(opts, opts.positional[0]);
  const sheet = manifest ? path.join(dir, "preview", "sheet.png") : path.join(dir, `${name}-preview.png`);
  const state = await previewSheet(file, sheet, { clips: opts.clips });
  out({ success: true, file: path.relative(process.cwd(), file), preview: path.relative(process.cwd(), sheet), ...state });
}

async function cmdView(opts) {
  const { file } = resolveGlb(opts, opts.positional[0]);
  const server = await serve(file, opts.port || 8737);
  const url = `http://localhost:${server.address().port}/viewer.html`;
  out({ success: true, url, file: path.relative(process.cwd(), file), note: "Open the address in a browser. Stop with Ctrl+C." });
  log(`serving ${url} (Ctrl+C to stop)`);
}

async function cmdPrintcheck(opts) {
  const claimed = openAsset(opts, opts.positional[0]);
  const m = claimed.manifest;
  const body = {};
  Object.assign(body, printInput(claimed, true));
  body.printer_type = opts.printer || "fdm";
  if (opts.heightMm) body.intended_print_height_mm = opts.heightMm;
  if (opts.dryRun) return out({ success: true, dryRun: true, command: "printcheck", credits: 0, steps: [{ endpoint: `POST ${ENDPOINTS.print}`, body: { ...body, model_url: body.model_url && "data:..." } }] });
  const ctx = newCtx(opts, claimed);
  const task = await runTask(ctx, `printcheck-${sha1(body).slice(0, 8)}`, "print", body, "print check");
  out({ success: true, name: claimed.name, printability: task.printability || task.result || task });
}

// The model Meshy should work on for a print step: its own job id while
// Meshy still has it (never the game remesh), otherwise the saved GLB.
// Only printcheck uses a repaired model: repair drops the colors, and Meshy's
// multi-color and split steps refuse repair jobs.
function printInput(claimed, preferRepair) {
  const m = claimed.manifest;
  const repaired = preferRepair && m.tasks && Object.keys(m.tasks).filter((k) => k.startsWith("repair-")).map((k) => m.tasks[k])
    .filter((t) => t.status === "SUCCEEDED" && !isExpired(t)).sort((a, b) => b.requestedAt - a.requestedAt)[0];
  if (repaired) return { input_task_id: repaired.id };
  const original = m.originalModelTask || m.modelTask;
  if (original && original.id && !isExpired(original)) return { input_task_id: original.id };
  const full = path.join(claimed.dir, "source", fs.existsSync(path.join(claimed.dir, "source", "model-full.glb")) ? "model-full.glb" : "model.glb");
  if (!fs.existsSync(full)) throw new MeshgenError(`${claimed.name} has no model yet.`);
  return { model_url: dataUri(full, "model/gltf-binary") };
}

function printSize(opts, body) {
  if (opts.printer) body.printer_type = opts.printer;
  if (opts.heightMm) body.intended_print_height_mm = opts.heightMm;
  return body;
}

// repair, multicolor and split: one Meshy job, files saved in print/.
async function cmdPrintStep(opts, kind) {
  const claimed = openAsset(opts, opts.positional[0]);
  let body;
  if (kind === "repair") {
    body = printSize(opts, printInput(claimed, false));
  } else if (kind === "multicolor") {
    body = { ...printInput(claimed, false), max_colors: opts.colors || 4, style: opts.style || "realistic", printer_brand: opts.printerBrand || "bambu" };
  } else {
    body = { ...printInput(claimed, false), mode: opts.parts ? "by_parts" : "auto", target_formats: ["glb", "stl", "3mf"], layout: opts.plate ? "on_plate" : "assembled" };
    if (opts.parts) body.prompt = opts.parts;
    if (opts.connectors) body.connectors = true;
    if (body.model_url) {
      throw new MeshgenError("split needs Meshy's original job, and Meshy keeps jobs only 3 days. Make the model again (model --print), then split it.");
    }
  }
  if (opts.dryRun) {
    return out({ success: true, dryRun: true, command: kind, credits: 10, steps: [{ endpoint: `POST ${ENDPOINTS[kind]}`, body: { ...body, model_url: body.model_url && "data:..." } }] });
  }
  const before = await balanceUnlessPending(claimed.manifest);
  checkBudget(opts, 10, before);
  const ctx = newCtx(opts, claimed);
  const step = `${kind}-${sha1(body).slice(0, 8)}`;
  const old = ctx.manifest.tasks[step];
  if (old && old.status === "SUCCEEDED" && isExpired(old, 0)) {
    // Its download links are dead, so make it again.
    ctx.dropped.add(step);
    delete ctx.manifest.tasks[step];
  }
  const notes = [];
  if (!ctx.manifest.request.print && !ctx.manifest.request.formats.some((f) => f === "stl" || f === "3mf")) {
    notes.push("This model was made for games (game-sized, about 10,000 triangles). For a detailed print, make it again with model --print.");
  }
  const task = await runTask(ctx, step, kind, body, kind === "multicolor" ? "multi-color print file" : kind);
  const files = [];
  for (const [fmt, url] of Object.entries(task.model_urls || {})) {
    if (!url) continue;
    const file = path.join(ctx.dir, "print", `${ctx.name}-${kind}.${fmt}`);
    await download(url, file, { ctx, step });
    files.push(path.relative(process.cwd(), file));
  }
  if (!files.length) throw new MeshgenError(`Meshy finished the ${kind} but sent no files.`);
  // Repair answers with a GLB; slicers want STL, in millimeters, Z up.
  const repairedGlb = files.find((f) => f.endsWith("-repair.glb"));
  if (repairedGlb) {
    const req = ctx.manifest.request;
    const mm = opts.heightMm || (req.print && req.height ? req.height * 1000 : null);
    if (mm) {
      const stl = repairedGlb.replace(/\.glb$/, ".stl");
      fs.writeFileSync(stl, glbToStl(fs.readFileSync(repairedGlb), mm));
      files.push(stl);
    } else {
      notes.push("No STL written: give --height-mm so meshgen knows the print size.");
    }
  }
  ctx.manifest.print = { ...(ctx.manifest.print || {}), [kind]: files.map((f) => path.relative(ctx.dir, f).split(path.sep).join("/")) };
  saveManifest(ctx);
  let after = null;
  try { after = await balance(); } catch {}
  out({ success: true, command: kind, name: ctx.name, files, ...(notes.length ? { notes } : {}), creditsUsed: ctx.spent, creditsLeft: after ? after.balance : null });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--version") { process.stdout.write(`${MESHGEN_VERSION}\n`); return; }
  if (!argv.length || argv.includes("--help") || argv.includes("-h") || argv[0] === "help") { process.stdout.write(HELP + "\n"); return; }
  const opts = parseArgs(argv);
  const needsName = ["model", "character", "remesh", "rebuild", "rig", "repair", "multicolor", "split", "animate", "inspect", "preview", "view", "printcheck"];
  if (needsName.includes(opts.command) && !opts.positional[0]) {
    throw new MeshgenError(`meshgen ${opts.command} needs a name, like: meshgen ${opts.command} hero`);
  }
  switch (opts.command) {
    case "balance": {
      const b = await balance();
      return out({ success: true, ...b, resetsAt: b.monthly_resets_at ? new Date(b.monthly_resets_at).toISOString() : null });
    }
    case "actions": return cmdActions(opts);
    case "model": return cmdModel(opts, false);
    case "character": return cmdModel(opts, true);
    case "rig": return cmdRig(opts);
    case "remesh": return cmdRemesh(opts);
    case "rebuild": return cmdRebuild(opts);
    case "animate": return cmdAnimate(opts);
    case "inspect": return cmdInspect(opts);
    case "preview": return cmdPreview(opts);
    case "view": return cmdView(opts);
    case "printcheck": return cmdPrintcheck(opts);
    case "repair":
    case "multicolor":
    case "split":
      return cmdPrintStep(opts, opts.command);
    default:
      throw new MeshgenError(`Unknown command "${opts.command}". Run meshgen --help.`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    if (err instanceof MeshgenError) fail(err.message, err.extra);
    fail(`Unexpected error: ${err.message}`);
  });
} else {
  module.exports = {
    MeshgenError,
    ACTIONS,
    MESHGEN_VERSION,
    parseArgs,
    modelCredits,
    actionCredits,
    modelRequests,
    resolveAction,
    parseGlb,
    writeGlb,
    readAccessor,
    inspectGlb,
    checkInspect,
    mergeClips,
    scaleToHeight,
    shrinkTextures,
    glbToStl,
    decodePng,
    encodePng,
  };
}
