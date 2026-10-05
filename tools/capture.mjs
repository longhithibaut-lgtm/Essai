#!/usr/bin/env node
// Capture automatique d'Aube dans Chromium (sans écran, WebGL logiciel).
//
//   node tools/capture.mjs [--root .] [--out .captures/latest] [--only views,route,frames,ui,perf]
//
// Produit : views/*.png (points de vue fixes), route.json (le pilote automatique
// termine-t-il le parcours ?), frames/*.png (séquences de mouvement), ui/*.png,
// perf.json et summary.json.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const root = path.resolve(arg('root', repo));
const out = path.resolve(arg('out', path.join(root, '.captures', 'latest')));
const only = new Set((arg('only', 'views,route,frames,ui,perf')).split(','));
const [W, H] = arg('size', '1280x720').split('x').map(Number);

function loadPlaywright() {
  const tries = [root, repo, '/opt/node22/lib/node_modules/', '/usr/lib/node_modules/'];
  for (const t of tries) {
    try {
      return createRequire(path.join(t, 'x.js'))('playwright');
    } catch { /* suivant */ }
  }
  throw new Error('Playwright introuvable');
}
const { chromium } = loadPlaywright();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary' };

function serve(dir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = path.join(dir, url === '/' ? 'index.html' : url);
      if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Les requêtes externes passent par curl (qui connaît le proxy et ses certificats),
// avec un cache disque. three.js est servi depuis node_modules quand il y est.
const cacheDir = path.join(repo, '.captures', 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
function localThree(url) {
  const m = url.match(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/);
  if (!m) return null;
  for (const base of [root, repo]) {
    const f = path.join(base, 'node_modules', 'three', m[1].split('?')[0]);
    if (fs.existsSync(f)) return f;
  }
  return null;
}
function externalFetch(url) {
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const body = path.join(cacheDir, key + '.bin');
  const meta = path.join(cacheDir, key + '.json');
  if (fs.existsSync(body) && fs.existsSync(meta)) {
    return { body: fs.readFileSync(body), ...JSON.parse(fs.readFileSync(meta, 'utf8')) };
  }
  const headers = execFileSync('curl', ['-sSL', '-m', '30', '-D', '-', '-o', body, '-A', 'Mozilla/5.0 Chrome/130', url], { encoding: 'utf8' });
  const ct = (headers.match(/content-type:\s*([^\r\n]+)/gi) || []).pop()?.split(':').slice(1).join(':').trim() || 'application/octet-stream';
  const status = Number((headers.match(/HTTP\/[\d.]+ (\d+)/g) || []).pop()?.split(' ')[1] || 200);
  fs.writeFileSync(meta, JSON.stringify({ contentType: ct, status }));
  return { body: fs.readFileSync(body), contentType: ct, status };
}

async function newPage(browser, url, errors) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('**/*', async (route) => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1')) return route.continue();
    const lt = localThree(u);
    if (lt) return route.fulfill({ path: lt, contentType: 'text/javascript' });
    try {
      const r = externalFetch(u);
      return route.fulfill({ status: r.status, body: r.body, contentType: r.contentType, headers: { 'access-control-allow-origin': '*' } });
    } catch (e) {
      errors.push('fetch failed: ' + u);
      return route.abort();
    }
  });
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  return page;
}

function montage(files, dest, tile = '5x2', labels = null) {
  if (!files.length) return;
  const args = [];
  files.forEach((f, i) => {
    if (labels) args.push('-label', labels[i]);
    args.push(f);
  });
  try {
    execFileSync('montage', [...args, '-tile', tile, '-geometry', '512x288+4+4', '-background', '#222', '-fill', '#eee', '-pointsize', '16', dest]);
  } catch (e) {
    console.warn('montage indisponible :', e.message);
  }
}

// Une seule capture à la fois sur la machine : plusieurs Chromium en rendu
// logiciel en parallèle font grimper la mémoire jusqu'à faire tomber le conteneur.
const LOCK = '/tmp/aube-capture.lock';
let lockHeld = false;
async function acquireLock() {
  if (process.argv.includes('--no-lock')) return;
  let warned = false;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid));
      lockHeld = true;
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = 0;
      try { pid = Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')); } catch { /* pas encore écrit */ }
      let alive = false;
      if (pid) { try { process.kill(pid, 0); alive = true; } catch { /* processus disparu */ } }
      if (!alive) {
        try {
          const age = Date.now() - fs.statSync(LOCK).mtimeMs;
          if (pid || age > 10000) fs.rmSync(LOCK, { recursive: true, force: true });
        } catch { /* déjà libéré */ }
        continue;
      }
      if (!warned) { console.error('Une autre capture tourne déjà sur la machine : attente de son tour…'); warned = true; }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
function releaseLock() {
  if (!lockHeld) return;
  try {
    if (Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')) === process.pid) fs.rmSync(LOCK, { recursive: true, force: true });
  } catch { /* rien à libérer */ }
  lockHeld = false;
}
process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { releaseLock(); process.exit(130); });

async function main() {
  fs.mkdirSync(out, { recursive: true });
  await acquireLock();
  const server = await serve(root);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const summary = { root, out, size: [W, H] };

  try {
    const page = await newPage(browser, base + 'index.html?test', errors);
    await page.waitForFunction(() => window.__aube && window.__aube.ready, null, { timeout: 180000 });
    const shot = async (file) => {
      await page.evaluate(() => window.__aube.render());
      await page.screenshot({ path: file });
    };

    if (only.has('views')) {
      fs.mkdirSync(path.join(out, 'views'), { recursive: true });
      const names = await page.evaluate(() => Object.keys(window.__aube.viewpoints));
      summary.views = [];
      // Vues fixes : sans HUD, pour juger l'image seule.
      await page.evaluate(() => { const h = document.getElementById('hud'); if (h) h.style.visibility = 'hidden'; });
      for (const n of names) {
        await page.evaluate((n) => { window.__aube.view(n); window.__aube.step(0.25); }, n);
        const f = path.join(out, 'views', n + '.png');
        await shot(f);
        summary.views.push(path.relative(out, f));
      }
      await page.evaluate(() => { window.__aube.followPlayer(); const h = document.getElementById('hud'); if (h) h.style.visibility = ''; });
    }

    let route = null;
    if (only.has('route') || only.has('frames')) {
      route = await page.evaluate(() => window.__aube.runRoute(150));
      const counts = {};
      for (const e of route.events) counts[e.type] = (counts[e.type] || 0) + 1;
      summary.route = { finished: route.finished, time: +route.time.toFixed(2), orbs: route.orbs, counts, falls: counts.fall || 0 };
      fs.writeFileSync(path.join(out, 'route.json'), JSON.stringify(route, null, 1));
    }

    if (only.has('frames') && route) {
      fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
      const firstOf = (type) => route.events.find((e) => e.type === type);
      const moments = [];
      for (const type of ['jump', 'vault', 'wallrunStart', 'slideStart', 'climb', 'mantle', 'finish']) {
        const e = firstOf(type);
        if (e) moments.push({ name: type, t: e.t });
      }
      summary.frames = {};
      for (const m of moments) {
        await page.evaluate(() => { window.__aube.reset(); window.__aube.startBot(); });
        const start = Math.max(0, m.t - 0.5);
        await page.evaluate((s) => window.__aube.step(s), start);
        const files = [];
        for (let i = 0; i < 10; i++) {
          const f = path.join(out, 'frames', `${m.name}_${String(i).padStart(2, '0')}.png`);
          await shot(f);
          files.push(f);
          await page.evaluate(() => window.__aube.step(0.1));
        }
        const sheet = path.join(out, 'frames', `${m.name}_sheet.png`);
        montage(files, sheet, '5x2', files.map((_, i) => `${(start + i * 0.1).toFixed(1)} s`));
        summary.frames[m.name] = path.relative(out, sheet);
      }
      // Tout le parcours, une image par seconde
      await page.evaluate(() => { window.__aube.reset(); window.__aube.startBot(); });
      const files = [];
      const total = Math.min(route.time, 60);
      for (let t = 0; t < total; t += 1) {
        const f = path.join(out, 'frames', `run_${String(t).padStart(3, '0')}.png`);
        await shot(f);
        files.push(f);
        await page.evaluate(() => window.__aube.step(1));
      }
      montage(files, path.join(out, 'frames', 'run_sheet.png'), '6x', files.map((_, i) => `${i} s`));
      summary.frames.run = 'frames/run_sheet.png';
    }

    if (only.has('perf')) {
      const perf = await page.evaluate(() => {
        const a = window.__aube;
        a.reset();
        a.startBot();
        a.step(8);
        a.stopBot();
        const t0 = performance.now();
        a.step(2);
        const simMs = (performance.now() - t0) / 120;
        for (let i = 0; i < 20; i++) a.render();
        return { simMsPerFrame: simMs, ...a.stats() };
      });
      perf.note = 'Rendu logiciel (SwiftShader) : avgRenderMs n’est qu’un indicateur relatif, pas des images/s réelles.';
      summary.perf = perf;
      fs.writeFileSync(path.join(out, 'perf.json'), JSON.stringify(perf, null, 1));
    }
    await page.close();

    if (only.has('ui')) {
      fs.mkdirSync(path.join(out, 'ui'), { recursive: true });
      const p2 = await newPage(browser, base + 'index.html', errors);
      await p2.waitForTimeout(12000);
      await p2.screenshot({ path: path.join(out, 'ui', 'title.png'), timeout: 120000 });
      await p2.context().close();
      const p3 = await newPage(browser, base + 'index.html?test', errors);
      await p3.waitForFunction(() => window.__aube && window.__aube.ready, null, { timeout: 180000 });
      await p3.evaluate(() => { const a = window.__aube; a.reset(); a.startBot(); a.step(1.2); });
      await p3.waitForTimeout(800);
      await p3.evaluate(() => window.__aube.render());
      await p3.screenshot({ path: path.join(out, 'ui', 'hud.png') });
      await p3.evaluate(() => { document.getElementById('pause').hidden = false; window.__aube.render(); });
      await p3.screenshot({ path: path.join(out, 'ui', 'pause.png') });
      await p3.evaluate(() => { document.getElementById('pause').hidden = true; document.getElementById('end').hidden = false; window.__aube.render(); });
      await p3.screenshot({ path: path.join(out, 'ui', 'end.png') });
      summary.ui = ['ui/title.png', 'ui/hud.png', 'ui/pause.png', 'ui/end.png'];
    }
  } finally {
    summary.errors = errors;
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1));
    await browser.close();
    server.close();
  }
  console.log(JSON.stringify(summary, null, 1));
  if (errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
