// Project theme: a demo video takes its look (accent, font, logo, surfaces, wallpaper) from the
// codebase being demoed. The theme lives in that repo at .demo-studio/theme.yaml; run()/serve find
// it by walking up from the script (then the cwd). "theme init" derives one from the code (CSS
// custom properties, Tailwind config, next/font, logo files) and/or the running app (computed styles).
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, relative, extname, basename } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

export const THEME_FILE = join('.demo-studio', 'theme.yaml');
// Keys that style the overlay; everything else in the file (frame, source…) is handled separately.
const OVERLAY_KEYS = ['accent', 'onAccent', 'ink', 'font', 'surface', 'onSurface', 'radius', 'logo', 'logoBg', 'cursor', 'chapterSticky', 'dim'];

export function findThemeFile(...starts) {
  const stop = homedir();
  for (const s of starts.filter(Boolean)) {
    let d = resolve(s);
    for (;;) {
      const f = join(d, THEME_FILE);
      if (existsSync(f)) return f;
      const up = dirname(d);
      if (up === d || d === stop) break;
      d = up;
    }
  }
  return null;
}

const MIME = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
// The overlay runs inside the app's page, so a logo has to travel as a data: URI.
async function dataUri(file) {
  const m = MIME[extname(file).toLowerCase()];
  if (!m || !existsSync(file) || (await stat(file)).size > 400_000) return null;
  return 'data:' + m + ';base64,' + (await readFile(file)).toString('base64');
}

export async function loadThemeFile(file) {
  const t = YAML.parse(await readFile(file, 'utf8')) || {};
  const base = dirname(file);
  const fileish = v => typeof v === 'string' && !/^(#|linear:|data:|https?:|[a-z]+$)/i.test(v);
  if (t.logo && fileish(t.logo)) t.logo = await dataUri(resolve(base, t.logo));
  if (t.frame?.background && fileish(t.frame.background)) t.frame.background = resolve(base, t.frame.background);
  return t;
}

// Merge the project theme under the script's own settings (script wins). theme: false opts out.
export async function applyProjectTheme(doc, ...starts) {
  if (doc.theme === false) { doc.theme = {}; return null; }
  const file = findThemeFile(...starts);
  if (!file) return null;
  // script.yaml (the replay log) keeps only the script's own look; the project theme is found again on replay.
  doc.ownLook = { theme: doc.theme, frame: doc.frame };
  doc.projectTheme = file;
  const t = await loadThemeFile(file);
  doc.theme = { ...pick(t, OVERLAY_KEYS), ...(doc.theme || {}) };
  if (doc.frame === undefined && t.frame) doc.frame = t.frame;
  return file;
}
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] != null).map(k => [k, o[k]]));

// ---- colour helpers (hex in, hex out) ----
const hexRgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, c => c + c); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const rgbHex = a => '#' + a.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => rgbHex(hexRgb(a).map((v, i) => v * (1 - t) + hexRgb(b)[i] * t));
const lum = h => { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const sat = h => { const c = hexRgb(h).map(v => v / 255), mx = Math.max(...c), mn = Math.min(...c); return mx === 0 ? 0 : (mx - mn) / mx; };
function hueOf(h) { const [r, g, b] = hexRgb(h).map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; }

// Everything else derives from the accent so a theme needs one colour to look intentional.
export function deriveTheme(t) {
  const accent = t.accent || '#4f46e5';
  const surface = t.surface || mix(accent, '#0a0c14', 0.86);
  const deep = mix(accent, '#05060a', 0.55), hue = hueOf(accent);
  return {
    ...t, accent, surface,
    onAccent: t.onAccent || (contrast(accent, '#ffffff') >= 3 ? '#ffffff' : '#111111'),
    onSurface: t.onSurface || '#ffffff',
    // Ink must stand out from the brand: amber for red/pink brands, otherwise a hot pink-red.
    ink: t.ink || (hue >= 320 || hue < 25 ? '#f59e0b' : '#ff2d55'),
    frame: t.frame || { background: 'linear:' + mix(accent, '#05060a', 0.8) + ',' + deep + ',' + mix(accent, '#ffffff', 0.12) }
  };
}

// ---- codebase scan ----
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', 'vendor', '.turbo', '.cache', 'demo-out', 'target', '.venv', '__pycache__', 'storybook-static', '.output', '.nuxt', '.svelte-kit']);
async function walk(root, maxDepth = 7, limit = 6000) {
  let files = [];
  try { files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean).filter(f => !f.split('/').some(p => SKIP.has(p))); }
  catch {
    const rec = async (d, depth) => { if (depth > maxDepth || files.length > limit) return; for (const e of await readdir(join(root, d), { withFileTypes: true }).catch(() => [])) { if (SKIP.has(e.name) || e.name.startsWith('.')) continue; const p = d ? d + '/' + e.name : e.name; if (e.isDirectory()) await rec(p, depth + 1); else files.push(p); } };
    await rec('', 0);
  }
  return files.slice(0, 20000);
}

const COLOR_VAR = /--(?:color-)?(primary|brand|accent|main|theme)(?:-(?:500|600|DEFAULT|base|color))?\s*:\s*([^;}\n]+)[;}\n]/gi;
const FONT_VAR = /--font-(?:sans|body|base|primary)\s*:\s*([^;}\n]+)/i;
export async function scanCodebase(root) {
  const files = await walk(root);
  const found = { colors: [], fonts: [], logos: [] };
  const isStyle = f => /\.(css|scss|sass|less|pcss|html|vue|svelte|astro)$/.test(f);
  const isTw = f => /(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/.test(f);
  const isCode = f => /(^|\/)(layout|_app|app|main|root|index)\.(tsx|jsx|ts|js)$/.test(f) || /theme|tokens/i.test(basename(f)) && /\.(ts|js|json|tsx)$/.test(f);
  const isDoc = f => /(^|\/)DESIGN\.md$/i.test(f);
  const vars = {};
  for (const f of files.filter(f => isStyle(f) || isTw(f) || isCode(f) || isDoc(f)).slice(0, 400)) {
    let s; try { s = await readFile(join(root, f), 'utf8'); } catch { continue; }
    if (s.length > 600_000) continue;
    if (isStyle(f)) {
      for (const m of s.matchAll(/--([\w-]+)\s*:\s*([^;}\n]+)/g)) vars[m[1]] ??= m[2].trim();
      for (const m of s.matchAll(COLOR_VAR)) found.colors.push({ name: m[1].toLowerCase(), value: m[2].trim(), file: f, w: /primary|brand/i.test(m[1]) ? 3 : 1 });
      const fv = FONT_VAR.exec(s); if (fv) found.fonts.push({ value: fv[1].trim(), file: f });
      const bf = /(?:^|\n)\s*(?:html|body|:root)[^{]*\{[^}]*?font-family\s*:\s*([^;}]+)/.exec(s); if (bf) found.fonts.push({ value: bf[1].trim(), file: f });
    } else if (isTw(f) || isCode(f)) {
      const obj = /\b(primary|brand)\s*:\s*\{([^}]*)\}/.exec(s);
      const hex = obj && (/(?:DEFAULT|600|500)\s*:\s*['"]([^'"]+)['"]/.exec(obj[2]) || /['"](#[0-9a-fA-F]{3,8})['"]/.exec(obj[2]));
      const flat = /\b(primary|brand)\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgb[^'"]+|hsl[^'"]+|oklch[^'"]+)['"]/.exec(s);
      if (hex) found.colors.push({ name: obj[1], value: hex[1], file: f, w: 2 }); else if (flat) found.colors.push({ name: flat[1], value: flat[2], file: f, w: 2 });
      const tf = /fontFamily\s*:\s*\{[^}]*?sans\s*:\s*\[\s*['"]([^'"]+)['"]/.exec(s); if (tf) found.fonts.push({ value: tf[1], file: f });
      for (const m of s.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](?:next\/font\/google|@next\/font\/google)['"]/g)) for (const n of m[1].split(',')) { const nm = n.trim().split(/\s+as\s+/)[0]; if (nm) found.fonts.push({ value: nm.replace(/_/g, ' '), file: f, w: 2 }); }
    } else if (isDoc(f)) {
      for (const m of s.matchAll(/(primary|brand|accent)[^\n#]{0,40}(#[0-9a-fA-F]{6})\b/gi)) found.colors.push({ name: m[1].toLowerCase(), value: m[2], file: f, w: 4 });
      const df = /font[^\n:]*:\s*\**\s*([A-Z][\w ]+?)(?:[,(\n*]|$)/m.exec(s); if (df) found.fonts.push({ value: df[1].trim(), file: f, w: 3 });
    }
  }
  // Resolve var(--x) chains and shadcn-style bare HSL triplets ("222 47% 11%").
  const resolveVal = (v, n = 0) => {
    const r = /^var\(--([\w-]+)\)$/.exec(v); if (r && vars[r[1]] && n < 5) return resolveVal(vars[r[1]], n + 1);
    if (/^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(v)) return 'hsl(' + v + ')';
    return v.replace(/\s*!important$/, '');
  };
  found.colors = found.colors.map(c => ({ ...c, value: resolveVal(c.value) })).filter(c => /^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/i.test(c.value));
  const fvar = v => { const r = /var\(--([\w-]+)\)/.exec(v); return r && vars[r[1]] ? v.replace(r[0], vars[r[1]]) : v; };
  found.fonts = found.fonts.map(f => ({ ...f, value: fvar(f.value) })).filter(f => !/^var\(|^inherit$|^\$|^theme\(/.test(f.value));
  // Logo files: "*logo*"/"*wordmark*" anywhere, or images in a brand/ folder. The title card puts the logo on a
  // white chip, so the variant for light backgrounds wins over dark-bg/white/inverse ones; svg over bitmaps.
  const isLogo = f => /\.(svg|png|webp)$/i.test(f) && (/(logo|wordmark)/i.test(basename(f)) || /(^|\/)brand(ing)?\//i.test(f)) && !/(^|\/)(test|tests|__tests__|fixtures?|examples?|stories|icons?|node_modules)\//i.test(f);
  const score = f => { const b = basename(f).toLowerCase(); return (extname(b) === '.svg' ? 0 : 4) + (/logo|wordmark/.test(b) ? 0 : 2) + (/dark|white|inverse|negative|mono|light-?text/.test(b) ? 3 : 0) + (/favicon|icon|mark|emblem/.test(b) ? 1 : 0); };
  found.logos = files.filter(isLogo).sort((a, b) => score(a) - score(b) || a.length - b.length);
  // Brand colours drawn in the logo itself: a fallback when neither the code nor the app gives one.
  for (const f of found.logos.filter(f => f.endsWith('.svg')).slice(0, 2)) {
    const s = await readFile(join(root, f), 'utf8').catch(() => '');
    const counts = {}; for (const m of s.matchAll(/(?:fill|stop-color|stroke)\s*[=:]\s*["']?(#[0-9a-fA-F]{6})\b/g)) counts[m[1].toLowerCase()] = (counts[m[1].toLowerCase()] || 0) + 1;
    for (const [hex, n] of Object.entries(counts)) { const c = (found.logoColors ||= []).find(x => x.value === hex); if (c) c.w += n; else found.logoColors.push({ name: 'logo', value: hex, file: f, w: n }); }
  }
  return found;
}

// ---- running app ----
async function scanPage(page) {
  return page.evaluate(() => {
    const parse = c => { const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?/.exec(c); return m && (m[4] === undefined || +m[4] > 0.6) ? [+m[1], +m[2], +m[3]] : null; };
    const hex = a => '#' + a.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const satur = a => { const mx = Math.max(...a), mn = Math.min(...a); return mx ? (mx - mn) / mx : 0; };
    const votes = new Map();
    const vote = (c, w) => { const a = parse(c); if (!a || satur(a) < 0.28 || Math.max(...a) < 40) return; const k = hex(a); votes.set(k, (votes.get(k) || 0) + w); };
    for (const el of document.querySelectorAll('button,a,[role=button],[role=tab][aria-selected=true],input[type=submit],[class*=primary],[class*=active],header,nav,aside')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight * 2) continue;
      const cs = getComputedStyle(el), area = Math.min(r.width * r.height, 40000);
      vote(cs.backgroundColor, 2 + area / 2000); vote(cs.color, 1); vote(cs.borderTopColor, 0.5);
    }
    const meta = document.querySelector('meta[name=theme-color]')?.content;
    const colors = [...votes].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c, w]) => ({ c, w: Math.round(w) }));
    const font = getComputedStyle(document.body).fontFamily;
    const cand = [...document.querySelectorAll('img,svg')].filter(el => { const r = el.getBoundingClientRect(); if (r.width < 16 || r.height < 12 || r.top > innerHeight) return false; const s = (el.getAttribute('src') || '') + ' ' + (el.getAttribute('alt') || '') + ' ' + (el.getAttribute('class') || '') + ' ' + (el.id || '') + ' ' + (el.closest('[class*=logo],[id*=logo],[class*=brand]') ? 'logo' : ''); return /logo|brand/i.test(s) || el.closest('a[href="/"],a[href="./"]'); });
    const el = cand[0]; if (el) el.setAttribute('data-ds-logo', '1');
    const icon = [...document.querySelectorAll('link[rel~=icon],link[rel=apple-touch-icon]')].map(l => l.href).sort((a, b) => (/svg|apple/.test(b) ? 1 : 0) - (/svg|apple/.test(a) ? 1 : 0))[0] || null;
    return { colors, meta, font, logo: !!el, icon, title: document.title };
  });
}

// Any CSS colour → #rrggbb, via the browser's own parser (oklch, hsl, named…).
async function normalizeColors(page, list) {
  return page.evaluate(list => list.map(v => { const d = document.createElement('div'); d.style.color = v; if (!d.style.color) return null; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); const cv = document.createElement('canvas').getContext('2d'); cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const [r, g, b, a] = cv.getImageData(0, 0, 1, 1).data; return a < 128 ? null : '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join(''); }), list);
}

const cleanFont = f => f && f.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(s => s && !/^__|Fallback$|^var\(/.test(s));
const fontStack = names => { const list = [...new Set(names)].filter(Boolean); const generic = ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif']; return [...list, ...generic.filter(g => !list.includes(g))].map(n => /\s/.test(n) && !/^-/.test(n) ? '"' + n + '"' : n).join(', '); };
const GENERIC_FONT = /^(system-ui|-apple-system|BlinkMacSystemFont|Times|Times New Roman|serif|sans-serif|Arial|Helvetica)$/i;

export async function initTheme({ browser, root, url, storageState, out, force }) {
  out = out || join(root, THEME_FILE);
  if (existsSync(out) && !force) throw new Error(relative(process.cwd(), out) + ' exists (use --force to re-derive)');
  const code = await scanCodebase(root);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ...(storageState && existsSync(storageState) ? { storageState } : {}) });
  const page = await ctx.newPage();
  const src = {}, notes = [];
  let live = null;
  if (url) {
    try { await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.waitForLoadState('load')); await page.waitForTimeout(800); live = await scanPage(page); }
    catch (e) { notes.push('could not read ' + url + ': ' + e.message.split('\n')[0]); }
  }
  if (!live) await page.setContent('<html><body></body></html>');
  // Accent: the codebase's declared primary/brand colour beats what happens to be on screen.
  const codeColors = code.colors.sort((a, b) => b.w - a.w);
  const hexes = await normalizeColors(page, codeColors.map(c => c.value));
  const codeAccent = codeColors.map((c, i) => ({ ...c, hex: hexes[i] })).find(c => c.hex && sat(c.hex) >= 0.2 && lum(c.hex) > 0.015 && lum(c.hex) < 0.85);
  const vivid = h => sat(h) >= 0.28 && lum(h) > 0.02 && lum(h) < 0.8;
  const liveAccent = live?.colors.find(c => vivid(c.c));
  // Logo colours: the most used; ties go to the darker one (brand blues/greens over accent reds).
  const logoAccent = (code.logoColors || []).filter(c => vivid(c.value)).sort((a, b) => b.w - a.w || lum(a.value) - lum(b.value))[0];
  let accent;
  if (codeAccent) { accent = codeAccent.hex; src.accent = codeAccent.file + ' (' + codeAccent.name + ': ' + codeAccent.value + ')'; }
  else if (liveAccent) { accent = liveAccent.c; src.accent = url + ' (most used colour on buttons/links)'; }
  else if (live?.meta) { accent = (await normalizeColors(page, [live.meta]))[0]; src.accent = url + ' (meta theme-color)'; }
  else if (logoAccent) { accent = logoAccent.value; src.accent = logoAccent.file + ' (logo colour)'; }
  if (!accent) notes.push('no brand colour found; using the default indigo, set accent by hand');
  // Font: what the app actually renders, else what the code declares.
  const liveFont = cleanFont(live?.font)?.[0];
  const codeFont = code.fonts.sort((a, b) => (b.w || 1) - (a.w || 1)).map(f => cleanFont(f.value)?.[0]).find(f => f && !GENERIC_FONT.test(f));
  const font = liveFont && !GENERIC_FONT.test(liveFont) ? liveFont : codeFont || liveFont;
  if (font) src.font = font === liveFont ? url + ' (body font)' : code.fonts.find(f => cleanFont(f.value)?.[0] === font)?.file;
  // Logo: a file in the repo, else the logo element on the page, else the favicon.
  await mkdir(dirname(out), { recursive: true });
  let logo = null;
  if (code.logos[0]) { logo = relative(dirname(out), join(root, code.logos[0])); src.logo = code.logos[0]; }
  else if (live) {
    const el = page.locator('[data-ds-logo]').first();
    if (live.logo && await el.count()) await el.screenshot({ path: join(dirname(out), 'logo.png'), omitBackground: true }).then(() => { logo = 'logo.png'; src.logo = url + ' (logo element, captured)'; }).catch(() => {});
    if (!logo && live.icon) {
      const ext = extname(new URL(live.icon).pathname).toLowerCase();
      const r = MIME[ext] ? await ctx.request.get(live.icon).catch(() => null) : null;
      if (r?.ok()) { await writeFile(join(dirname(out), 'logo' + ext), await r.body()); logo = 'logo' + ext; src.logo = live.icon + ' (favicon)'; }
    }
  }
  await ctx.close();
  const t = deriveTheme({ accent: accent || '#4f46e5' });
  // Keep machine paths out of a file that gets committed: file:// sources are shown relative to the repo.
  for (const k in src) if (src[k] && url?.startsWith('file://')) src[k] = src[k].replace(url, relative(root, new URL(url).pathname));
  const theme = { accent: t.accent, onAccent: t.onAccent, ink: t.ink, font: fontStack([font, 'Inter']), surface: t.surface, onSurface: t.onSurface, radius: 14, ...(logo ? { logo } : {}), frame: t.frame };
  const head = '# demo-studio theme for this codebase: recorded videos and live demos take their look from here.\n' +
    '# Derived by "demo-studio theme init" on ' + new Date().toISOString().slice(0, 10) + '. Edit freely; a demo script\'s own theme:/frame: keys win.\n' +
    Object.entries(src).filter(([, v]) => v).map(([k, v]) => '#   ' + k + ' <- ' + v).join('\n') + '\n' +
    '# accent: cursor halo, rings, chapter badge, slide bullets | surface: captions, callouts, title cards\n' +
    '# ink: hand-drawn marks | logo: title cards (logoBg: none = no white chip) | frame: wallpaper + rounded window (frame: false = full-bleed)\n';
  await writeFile(out, head + YAML.stringify(theme, { lineWidth: 0 }));
  return { file: out, theme, sources: src, notes, candidates: { logo: (code.logoColors || []).map(c => c.value + ' x' + c.w), code: codeColors.slice(0, 5).map((c, i) => c.file + ' ' + c.name + '=' + c.value + (hexes[i] ? ' -> ' + hexes[i] : '')), live: live?.colors || [], fonts: [...new Set(code.fonts.map(f => f.value))].slice(0, 4), logos: code.logos.slice(0, 4) } };
}

// Self-review: the theme on the real app (caption, chapter pill, ring + callout, cursor) framed on
// its wallpaper, plus the title card. Returns the PNG paths for the agent to look at.
export async function previewTheme({ browser, themeFile, url, storageState, outDir }) {
  const { overlayInit } = await import('./overlay.js');
  const { cssBackground } = await import('./stage.js');
  const t = await loadThemeFile(themeFile);
  const ot = pick(t, OVERLAY_KEYS);
  await mkdir(outDir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1, ...(storageState && existsSync(storageState) ? { storageState } : {}) });
  await ctx.addInitScript(overlayInit, ot);
  const page = await ctx.newPage();
  if (url) await page.goto(url, { waitUntil: 'load', timeout: 30000 }).then(() => page.waitForTimeout(1200)).catch(() => {});
  else await page.setContent('<html><body style="margin:0;font-family:system-ui;background:#f6f7f9"><div style="height:64px;background:#fff;border-bottom:1px solid #e5e7eb"></div><div style="padding:48px"><h2 style="margin:0 0 24px">Orders</h2><button style="padding:12px 20px;border-radius:8px;border:1px solid #d1d5db;background:#fff;font-size:16px">New order</button></div></body></html>');
  await page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); return r.width > 30 && r.height > 18 && r.top > 6 && r.bottom < innerHeight - 160 && r.left > 0 && r.right < innerWidth; };
    const el = [...document.querySelectorAll('button,a,[role=button]')].find(vis) || document.body.firstElementChild;
    el.setAttribute('data-ds-target', 'pv');
    const r = el.getBoundingClientRect();
    const ds = window.__ds;
    ds.chapter(2, 'Chapter pill', 60000);
    ds.caption('Caption: the narration shows here in the theme surface colour.');
    ds.highlight('h', 'pv', 6);
    ds.callout('c', 'pv', 'Callouts use the surface colour; the title takes the accent.', 'Tip');
    ds.setCursor(r.left + r.width / 2, r.top + r.height / 2);
  });
  await page.waitForTimeout(900);
  const app = join(outDir, 'theme-app.png'), title = join(outDir, 'theme-title.png'), framed = join(outDir, 'theme-preview.png');
  await page.screenshot({ path: app });
  await page.evaluate(() => { const ds = window.__ds; ds.clear(); ds.caption(null); ds.chapter(0, null); ds.card('Product demo', 'Video title on the theme', 'Subtitle line · ' + location.hostname); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: title });
  const bg = cssBackground(t.frame?.background || 'midnight');
  const fp = await ctx.newPage();
  await fp.setViewportSize({ width: 1920, height: 1080 });
  const img = 'data:image/png;base64,' + (await readFile(app)).toString('base64');
  await fp.setContent('<html><body style="margin:0;width:1920px;height:1080px;background:' + bg.replace(/"/g, "'") + ';display:grid;place-items:center"><img src="' + img + '" style="width:1740px;border-radius:' + (t.frame?.radius ?? 18) + 'px;box-shadow:0 30px 80px rgba(0,0,0,.45)"></body></html>');
  await fp.screenshot({ path: framed });
  await ctx.close();
  await import('node:fs/promises').then(f => f.rm(app, { force: true }));
  return { preview: framed, title };
}
