// HTTP control surface so an agent can drive a session one step at a time.
// Recording pauses between requests, so agent think-time never reaches the video.
import { createServer } from 'node:http';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import YAML from 'yaml';
import { Session } from './session.js';

export const STATE_DIR = join(homedir(), '.cache', 'demo-studio');
export const stateFile = port => join(STATE_DIR, 'server-' + port + '.json');

export async function serve(config, port = 7788) {
  // Agent sessions speak asynchronously: a request returns when its actions are done and the
  // sentence keeps playing while the agent decides the next beat.
  const session = await new Session({ asyncSay: true, ...config }).start();
  let queue = Promise.resolve(), last = null, stopping = false, busy = false;
  const idle = () => { if (!busy && session.rec && !session.narrator.speaking && !session.recOff) session.rec.pause(); };
  session.narrator.onEnd = () => setTimeout(idle, 0);
  const look = async name => {
    if (name === 'all') return (await Promise.all(Object.keys(session.apps).map(n => session.observe(n).then(o => o.text)))).join('\n\n');
    return (await session.observe(name || undefined)).text;
  };
  const body = req => new Promise(r => { let b = ''; req.on('data', d => (b += d)); req.on('end', () => r(b)); });
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj, null, 1)); };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'POST' && url.pathname === '/steps') {
        const txt = await body(req);
        let steps = YAML.parse(txt); if (!Array.isArray(steps)) steps = [steps];
        if (session.dead || session.page.isClosed()) return json(res, 410, { ok: false, error: 'browser is gone; run `demo-studio stop` to keep what was recorded, then serve again' });
        const withObs = url.searchParams.get('observe') !== '0';
        const job = queue.then(async () => {
          busy = true;
          const started = performance.now();
          // Synthesize every sentence of the batch in parallel without blocking the first action.
          if (!session.cfg.dry) session.narrator.prepare(steps.map(s => (typeof s === 'string' ? s : s.say)).filter(Boolean))?.catch(() => {});
          const done = [];
          for (const st of steps) {
            const t0 = session.clock(), w0 = performance.now();
            try { const r = await session.step(st); last = r; done.push(Math.round(performance.now() - w0)); }
            catch (e) {
              session.cut(t0, session.clock());
              const shot = join(session.outDir, 'error-' + Date.now() + '.png');
              await session.page.screenshot({ path: shot }).catch(() => {});
              const usesIds = /"(?:node"\s*:\s*")?[et]\d+"|:\s*[et]\d+\b/.test(JSON.stringify(st));
              return { ok: false, done, failedStep: done.length, error: e.message.split('\n')[0] + (usesIds ? ' — element ids come from the latest observation; the page may have changed, run `look` and retry' : ''), screenshot: shot, note: 'step cut from any recording; fix and resend', observe: await look().catch(() => null) };
            }
          }
          return { ok: true, done, ms: Math.round(performance.now() - started), observe: withObs ? await look().catch(() => null) : undefined };
        }).finally(() => { busy = false; idle(); });
        queue = job.catch(() => {});
        return json(res, 200, await job);
      }
      const appName = url.searchParams.get('app') || undefined;
      if (url.pathname === '/snapshot') return json(res, 200, await session.snapshot(appName));
      if (url.pathname === '/observe') return json(res, 200, { observe: await look(appName) });
      if (url.pathname === '/screenshot') { const f = join(session.outDir, 'peek-' + (appName ? appName + '-' : '') + Date.now() + '.png'); await (appName ? session.app(appName).page : session.page).screenshot({ path: f }); return json(res, 200, { file: f }); }
      if (url.pathname === '/undo') { if (last) { session.cut(last.t0, last.t1); session.log.pop(); } return json(res, 200, { ok: !!last, cut: last }); }
      if (url.pathname === '/status') return json(res, 200, { alive: !session.dead && !session.page.isClosed(), outDir: session.outDir, url: session.page.url(), app: session.cur.name, apps: Object.fromEntries(Object.values(session.apps).map(a => [a.name, a.page.url()])), recordedMs: Math.round(session.clock()), steps: session.log.length, cuts: session.cuts.length, mode: session.cfg.mode });
      if (req.method === 'POST' && url.pathname === '/stop') {
        if (stopping) return json(res, 409, { error: 'already stopping' });
        stopping = true; await queue; if (session.pendingAfter) await session.pendingAfter;
        const out = await session.stop();
        json(res, 200, out);
        await rm(stateFile(port), { force: true });
        setTimeout(() => process.exit(0), 100);
        return;
      }
      json(res, 404, { error: 'POST /steps | GET /snapshot | GET /screenshot | POST /undo | GET /status | POST /stop' });
    } catch (e) { json(res, 500, { error: e.message }); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  process.on('SIGHUP', () => {});
  session.idle = idle;
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(stateFile(port), JSON.stringify({ port, pid: process.pid, outDir: session.outDir, cdpPort: session.cfg.cdpPort ?? null }));
  return { server, session };
}
