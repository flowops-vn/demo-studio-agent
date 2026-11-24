// Run a whole demo script (YAML/JSON) through a Session.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { Session } from './session.js';
import { applyProjectTheme } from './theme.js';

export async function loadScript(file) {
  const doc = YAML.parse(await readFile(file, 'utf8'));
  const base = dirname(resolve(file));
  if (doc.storageState) doc.storageState = resolve(base, doc.storageState);
  // baseURL: ./folder/ next to the script → file:// URL (portable examples)
  if (doc.baseURL && /^\.{1,2}\//.test(doc.baseURL)) doc.baseURL = 'file://' + resolve(base, doc.baseURL) + '/';
  for (const a of Object.values(doc.apps || {})) {
    if (!a || typeof a !== 'object') continue;
    if (a.storageState) a.storageState = resolve(base, a.storageState);
    // Local files (./page.html or /abs/page.html) become file:// URLs; /path stays relative to baseURL.
    if (a.url && !/^[a-z]+:/i.test(a.url) && existsSync(resolve(base, a.url))) a.url = 'file://' + resolve(base, a.url);
  }
  if (doc.frame?.background && /[./]/.test(doc.frame.background) && !doc.frame.background.startsWith('#')) doc.frame.background = resolve(base, doc.frame.background);
  if (doc.music?.file) doc.music.file = resolve(base, doc.music.file);
  // The look comes from the codebase being demoed (.demo-studio/theme.yaml next to the script or above the cwd).
  await applyProjectTheme(doc, base, process.cwd());
  return doc;
}

// Collect every narration string so TTS runs before the browser opens.
export function narrationOf(steps) { return steps.map(s => (typeof s === 'string' ? s : s.say)).filter(Boolean); }

export async function runScript(doc, overrides = {}, log = console.error) {
  const { steps = [], ...cfg } = doc;
  const session = new Session({ ...cfg, ...overrides });
  if (session.cfg.dry) session.cfg.fastDry = true; // `run --dry` only checks that steps resolve
  const from = overrides.from ?? 0, to = overrides.to ?? steps.length;
  if (!session.cfg.dry) {
    log('tts: synthesizing ' + narrationOf(steps.slice(from, to)).length + ' narration clips (' + session.cfg.voice.provider + ' ' + session.cfg.voice.name + ')');
    await session.narrator.prepare(narrationOf(steps.slice(from, to)));
  }
  log(session.cfg.projectTheme ? 'theme: ' + session.cfg.projectTheme : 'theme: none (no .demo-studio/theme.yaml in this codebase; create one with: demo-studio theme init --url <app url>)');
  await session.start();
  log('session: mode=' + session.cfg.mode + ' headed=' + session.cfg.headed + ' record=' + !!session.cfg.record + ' out=' + session.outDir);
  let failed = null;
  for (let i = from; i < to; i++) {
    const st = steps[i];
    const label = typeof st === 'string' ? 'say' : Object.keys(st).filter(k => k !== 'say').join('+') || 'say';
    try {
      await session.step(st);
      log('  ok   #' + i + ' ' + label);
    } catch (e) {
      const shot = resolve(session.outDir, 'error-step-' + i + '.png');
      await session.page.screenshot({ path: shot }).catch(() => {});
      failed = { index: i, step: st, error: e.message.split('\n')[0], screenshot: shot };
      log('  FAIL #' + i + ' ' + label + ': ' + failed.error);
      break;
    }
  }
  const result = await session.stop({ finalizeVideo: !failed || overrides.keepPartial });
  return { ...result, failed };
}
