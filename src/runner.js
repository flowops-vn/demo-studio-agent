// Run a whole demo script (YAML/JSON) through a Session.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import YAML from 'yaml';
import { Session } from './session.js';
import { applyProjectTheme } from './theme.js';
import { lintNarration } from './speech.js';

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
// With a session, dialogue lines (as: name) come back with their voice.
export function narrationOf(steps, session) {
  return steps.map(s => (typeof s === 'string' ? { say: s } : s)).filter(s => s?.say).map(s => {
    if (!session) return s.say;
    try { return { text: s.say, voice: session.voiceFor(s) }; } catch { return { text: s.say }; }
  });
}
// Speech review: long sentences, stiff written phrasing, mixed forms of address, unknown acronyms.
const APP_KEYS = new Set(['goto', 'click', 'dblclick', 'type', 'fill', 'select', 'check', 'uncheck', 'upload', 'press', 'scroll', 'hover']);
export function lintScript(doc) {
  const steps = doc.steps || [];
  const items = steps.map((s, index) => ({ index, text: typeof s === 'string' ? s : s?.say })).filter(x => x.text);
  const r = lintNarration(items, { pronounce: { ...(doc.pronounce || {}), ...(doc.voice?.pronounce || {}) } });
  // Structure: an agenda/outline slide once, up front; chapters carry the viewer through the rest.
  const obj = steps.map((s, i) => [s && typeof s === 'object' ? s : {}, i]);
  const slideOf = s => { const v = s.slide ?? s.whiteboard; return v && v !== 'off' ? v : null; };
  const outlines = obj.filter(([s]) => slideOf(s)?.bullets?.length >= 2);
  if (outlines.length > 1) r.warnings.push('slide dàn ý xuất hiện ' + outlines.length + ' lần (' + outlines.map(([, i]) => '#' + i).join(' ') + '): chỉ một lần ở đầu video; các phần sau dùng chapter (badge hiện "2/4")');
  const app = obj.filter(([s]) => Object.keys(s).some(k => APP_KEYS.has(k))).map(([, i]) => i);
  if (app.length) for (const [s, i] of obj) if (slideOf(s) && i > app[0] && i < app[app.length - 1]) r.warnings.push('#' + i + ' slide chen giữa lúc đang thao tác: người xem phải đổi ngữ cảnh; dùng chapter, callout hoặc caption. Slide để ở đầu (dàn ý) và cuối (tóm tắt)');
  return r;
}

export async function runScript(doc, overrides = {}, log = console.error) {
  const { steps = [], ...cfg } = doc;
  const session = new Session({ ...cfg, ...overrides });
  session.cfg.chapterTotal = steps.filter(s => s && typeof s === 'object' && s.chapter).length;
  if (session.cfg.dry) {
    session.cfg.fastDry = true; // `run --dry` only checks that steps resolve
    const l = lintScript(doc);
    log('narration: ~' + l.estSeconds + ' s spoken' + (l.warnings.length ? ', ' + l.warnings.length + ' speech notes:' : ', no speech notes'));
    for (const w of l.warnings) log('  speech ' + w);
  }
  const from = overrides.from ?? 0, to = overrides.to ?? steps.length;
  if (!session.cfg.dry) {
    log('tts: synthesizing ' + narrationOf(steps.slice(from, to)).length + ' narration clips (' + session.cfg.voice.provider + ' ' + session.cfg.voice.name + ')');
    await session.narrator.prepare(narrationOf(steps.slice(from, to), session));
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
