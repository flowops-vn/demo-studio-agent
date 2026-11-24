// A presentation session: one browser page with the overlay installed, a
// narrator, and (optionally) a recorder. Steps are plain objects (see SCRIPT.md).
import { chromium } from 'playwright-core';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { overlayInit } from './overlay.js';
import { observePage, settlePage, formatObservation } from './observe.js';
import { Narrator } from './narrator.js';
import { Recorder } from './recorder.js';
import { finalize } from './finalize.js';
import { compose, panelSizes } from './stage.js';
import { DEFAULT_VOICE } from './tts.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Branded Chrome (158+) quits headless sessions after ~30 s, so headless runs use a
// "Chrome for Testing"/Chromium build from the Playwright cache; headed runs use system Chrome.
export function findTestingChrome() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  let dirs = []; try { dirs = readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.split('-')[1] - a.split('-')[1]); } catch { return null; }
  const rel = ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-linux64/chrome', 'chrome-linux/chrome'];
  for (const d of dirs) for (const r of rel) { const p = join(base, d, r); if (existsSync(p)) return p; }
  return null;
}
// Drop value keys (e.g. the text to type) so they are not mistaken for target keys.
const omit = (v, keys) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k))) : v);
const TARGET_KEYS = ['sel', 'css', 'role', 'name', 'text', 'label', 'placeholder', 'testId', 'alt', 'title', 'nth', 'exact', 'within', 'ref', 'target'];
const MODIFIERS = new Set(['say', 'wait_say', 'lead', 'hold', 'id', 'note', 'keep', 'async', 'on']);
// Device presets for apps: phones get a touch-style dot cursor and mobile emulation.
export const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  tablet: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: {}
};
const POINTER = new Set(['click', 'dblclick', 'hover', 'type', 'fill', 'check', 'uncheck', 'select']);
const INK_KEYS = ['text', 'from', 'color', 'ttl', 'width', 'length', 'id', 'ms'];

export const DEFAULTS = {
  mode: 'record', viewport: { width: 1440, height: 810 }, output: { width: 1920, height: 1080, fps: 30 },
  voice: DEFAULT_VOICE, theme: {}, captions: true, autoClear: true, typingDelay: 55, cursorSpeed: 1,
  timeout: 15000, trimLoads: true, browser: 'auto', locale: 'vi-VN', zoomScale: 1.8, autoZoom: false
};

export function normalizeConfig(c = {}) {
  const cfg = { ...DEFAULTS, ...c };
  if (Array.isArray(cfg.viewport)) cfg.viewport = { width: cfg.viewport[0], height: cfg.viewport[1] };
  cfg.output = { ...DEFAULTS.output, ...(c.output || {}) };
  cfg.voice = { ...DEFAULT_VOICE, ...(c.voice || {}) };
  cfg.appsSpec = c.apps;
  cfg.apps = normalizeApps(c, cfg);
  if (cfg.mode === 'live') { cfg.headed ??= true; cfg.live = true; cfg.record ??= false; }
  else if (cfg.mode === 'dry') { cfg.headed ??= false; cfg.dry = true; cfg.record = false; cfg.cursorSpeed = 4; cfg.typingDelay = 0; }
  else { cfg.headed ??= false; cfg.record ??= true; }
  return cfg;
}

// One entry per browser context. Without `apps` the session has a single app "main" built from
// the top-level keys, so older scripts behave exactly as before.
function normalizeApps(c, cfg) {
  const multi = c.apps && typeof c.apps === 'object' && Object.keys(c.apps).length;
  const src = multi ? c.apps : { main: {} };
  return Object.entries(src).map(([name, raw]) => {
    const a = typeof raw === 'string' ? { url: raw } : { ...(raw || {}) };
    const dev = DEVICES[a.device || 'desktop'] || {};
    let vp = a.viewport ?? dev.viewport ?? cfg.viewport;
    if (Array.isArray(vp)) vp = { width: vp[0], height: vp[1] };
    const isMobile = a.isMobile ?? dev.isMobile ?? false;
    return {
      name, label: a.label ?? name, url: a.url, baseURL: a.baseURL ?? cfg.baseURL, device: a.device || 'desktop', viewport: vp, isMobile,
      hasTouch: a.hasTouch ?? dev.hasTouch ?? false, dpr: a.deviceScaleFactor ?? dev.deviceScaleFactor, userAgent: a.userAgent,
      storageState: multi ? a.storageState : cfg.storageState, permissions: a.permissions ?? cfg.permissions, geolocation: a.geolocation ?? cfg.geolocation,
      theme: { ...(isMobile ? { cursor: 'dot' } : {}), ...(cfg.theme || {}), ...(a.theme || {}) },
      zoomed: 0, autoZoomed: false, cursor: null, mutMark: null
    };
  });
}

export class Session {
  constructor(config) {
    this.cfg = normalizeConfig(config);
    this.log = []; this.after = []; this.cuts = []; this.chapters = []; this.chapterNo = 0;
    this.state = { caption: null, chapter: null };
    this.tcounter = 0; this.t0 = performance.now();
    this.apps = {}; this.switches = [];
    const c = this.cfg;
    this.narrator = new Narrator({ voice: c.voice, live: c.live, dry: c.dry, clock: () => this.clock(), captions: c.captions, onCaption: t => { this.state.caption = t; this.ov('caption', t); } });
  }
  clock = () => (this.rec ? this.rec.time() : performance.now() - this.t0);
  // Per-app state; actions always run against the current app (`on: name` switches).
  get multi() { return Object.keys(this.apps).length > 1; }
  get page() { return this.cur?.page; }
  get cdp() { return this.cur?.cdp; }
  get context() { return this.cur?.context; }
  get zoomed() { return this.cur?.zoomed || 0; }
  set zoomed(v) { if (this.cur) this.cur.zoomed = v; }
  get autoZoomed() { return !!this.cur?.autoZoomed; }
  set autoZoomed(v) { if (this.cur) this.cur.autoZoomed = v; }
  get mutMark() { return this.cur?.mutMark; }
  set mutMark(v) { if (this.cur) this.cur.mutMark = v; }
  app(name) {
    const a = this.apps[name];
    if (!a) throw new Error('unknown app "' + name + '" (apps: ' + Object.keys(this.apps).join(', ') + ')');
    return a;
  }
  // Make another app the one being driven; the caption follows the action.
  async use(name) {
    const a = this.app(name);
    if (this.cur === a) return;
    const prev = this.cur;
    this.cur = a;
    this.switches.push({ at: this.clock(), app: name });
    if (prev) await this.ovOn(prev.page, 'caption', null);
    if (this.state.caption) await this.ov('caption', this.state.caption);
  }

  async start() {
    const c = this.cfg;
    this.outDir = resolve(c.outDir || join('demo-out', (c.name || 'demo') + '-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)));
    await mkdir(this.outDir, { recursive: true });
    const apps = c.apps, multi = apps.length > 1, single = apps[0];
    // Several apps, or one phone: record onto a composed stage instead of stretching to 16:9.
    const staged = this.staged = multi || single.isMobile;
    const w = single.viewport.width, h = single.viewport.height;
    const args = ['--hide-scrollbars', '--disable-features=Translate,TranslateUI', '--no-first-run', '--no-default-browser-check'];
    if (c.headed && !multi) args.push('--window-size=' + w + ',' + (h + 88), '--window-position=40,40');
    // Same UI language as the app, so Chrome never offers to translate the page mid-demo.
    if (c.headed && c.locale) args.push('--lang=' + c.locale);
    if (c.cdpPort) args.push('--remote-debugging-port=' + c.cdpPort);
    if (process.env.DEMO_STUDIO_CHROME_ARGS) args.push(...process.env.DEMO_STUDIO_CHROME_ARGS.split(' '));
    const launch = { headless: !c.headed, args };
    if (c.executablePath) launch.executablePath = c.executablePath;
    else if (c.browser === 'auto') {
      const cft = c.headed ? null : findTestingChrome();
      if (cft) launch.executablePath = cft; else { launch.channel = 'chrome'; if (!c.headed) console.error('[demo-studio] no Chrome for Testing found (run: demo-studio install); system Chrome headless stops after ~30 s'); }
    } else if (c.browser !== 'chromium') launch.channel = c.browser;
    this.browser = await chromium.launch({ ...launch, ignoreDefaultArgs: ['--enable-automation'],
      // Shell tools send SIGHUP when a command moves to the background; keep the browser alive.
      handleSIGHUP: false });
    this.browser.on('disconnected', () => { this.dead = true; if (!this.stopping) console.error('[demo-studio] browser disconnected unexpectedly'); });
    // Multi-app recordings capture each app at its final panel size on the composite canvas.
    this.panels = staged ? panelSizes(apps, c.output.width, c.output.height, c.layout || {}) : null;
    for (const a of apps) {
      const ctxOpts = { locale: c.locale, baseURL: a.baseURL, colorScheme: c.colorScheme || 'light', isMobile: a.isMobile, hasTouch: a.hasTouch };
      if (a.userAgent) ctxOpts.userAgent = a.userAgent;
      if (c.headed && !a.isMobile) ctxOpts.viewport = null; // the window decides
      else {
        ctxOpts.viewport = { ...a.viewport };
        ctxOpts.deviceScaleFactor = c.headed ? 2 : staged ? Math.min(3, Math.max(1, this.panels[a.name].width / a.viewport.width)) : (c.deviceScaleFactor || Math.max(1, c.output.width / a.viewport.width));
      }
      if (a.storageState && existsSync(a.storageState)) ctxOpts.storageState = a.storageState;
      if (a.permissions) ctxOpts.permissions = a.permissions; // e.g. [notifications, geolocation, camera]
      if (a.geolocation) ctxOpts.geolocation = a.geolocation; // {latitude, longitude}
      a.context = await this.browser.newContext(ctxOpts);
      a.context.setDefaultTimeout(c.timeout);
      await a.context.addInitScript(overlayInit, a.theme);
      a.context.on('page', p => this.adopt(p, a).catch(() => {}));
      const page = await a.context.newPage();
      await this.adopt(page, a);
      // Dark blank page so title cards/slides before the first goto never flash white.
      await page.setContent('<html style="background:#0b0d1a"><body></body></html>').catch(() => {});
      this.apps[a.name] = a;
    }
    this.cur = this.apps[apps[0].name];
    if (c.headed && multi) await this.tileWindows().catch(e => console.error('[demo-studio] window layout: ' + e.message));
    if (c.record) {
      const sinks = staged
        ? apps.map(a => ({ name: a.name, file: join(this.outDir, '.raw-' + a.name + '.mp4'), ...this.panels[a.name] }))
        : [{ name: single.name, file: join(this.outDir, '.raw.mp4'), width: c.output.width, height: c.output.height }];
      this.rec = new Recorder({ sinks, fps: c.output.fps });
      await this.rec.start(Object.fromEntries(apps.map(a => [a.name, this.apps[a.name].page])));
      this.rec.pause(); // resumes at the first step, so the blank start is never recorded
    }
    this.switches.push({ at: 0, app: this.cur.name });
    // Apps declared with a url open straight away (recording is paused, nobody waits on it).
    for (const a of apps) if (a.url) {
      const app = this.apps[a.name];
      await app.page.goto(a.url, { waitUntil: 'load' }).catch(e => console.error('[demo-studio] ' + a.name + ': ' + e.message.split('\n')[0]));
      const prev = this.cur; this.cur = app; await this.settle({ min: 0, quiet: 250, max: 3000 }); this.cur = prev;
    }
    await this.nudgeAll();
    return this;
  }

  // Live multi-app: one window per app, side by side, phones at their emulated size.
  async tileWindows() {
    const list = Object.values(this.apps);
    const scr = await list[0].page.evaluate(() => ({ w: screen.availWidth, h: screen.availHeight, x: screen.availLeft || 0, y: screen.availTop || 0 }));
    const chromeH = 88, gap = 12;
    const widths = list.map(a => (a.isMobile ? Math.max(a.viewport.width, 500) : a.viewport.width));
    let total = widths.reduce((s, x) => s + x, 0) + gap * (list.length - 1);
    // Desktop apps give up width first when the screen is too narrow.
    const desk = list.map((a, i) => (a.isMobile ? null : i)).filter(i => i != null);
    if (total > scr.w && desk.length) { const over = total - scr.w; desk.forEach(i => { widths[i] = Math.max(520, widths[i] - over / desk.length); }); total = widths.reduce((s, x) => s + x, 0) + gap * (list.length - 1); }
    let left = scr.x + Math.max(0, Math.round((scr.w - total) / 2));
    for (const [i, a] of list.entries()) {
      let height = Math.min(scr.h, a.viewport.height + chromeH);
      if (a.isMobile && a.viewport.height + chromeH > scr.h) { a.viewport = { width: a.viewport.width, height: scr.h - chromeH }; await a.page.setViewportSize(a.viewport); }
      const { windowId } = await a.cdp.send('Browser.getWindowForTarget');
      await a.cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: Math.round(left), top: scr.y, width: Math.round(widths[i]), height: Math.round(height), windowState: 'normal' } });
      left += widths[i] + gap;
    }
  }

  // Follow new tabs/popups so the recording and overlay stay on the app's active page.
  async adopt(page, app = this.cur) {
    if (app.page === page) return;
    app.page = page;
    app.cdp = await app.context.newCDPSession(page);
    // Keep rAF/menus rendering while the window is not focused (the agent's terminal usually is).
    await app.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    page.on('load', () => this.restore(app).catch(() => {}));
    // In-flight requests (incl. lazy-loaded chunks) so settle() does not report "quiet" while the app is still fetching.
    app.reqs = new Map();
    page.on('request', r => { if (!['websocket', 'eventsource', 'media'].includes(r.resourceType())) app.reqs.set(r, performance.now()); });
    const done = r => app.reqs.delete(r);
    page.on('requestfinished', done); page.on('requestfailed', done);
    if (process.env.DEMO_STUDIO_DEBUG) { page.on('close', () => console.error('[debug] page closed', new Error().stack)); page.on('crash', () => console.error('[debug] page crashed')); }
    if (this.rec?.started) await this.rec.attach(page, app.name);
    if (this.cfg.headed && Object.keys(this.apps).length <= 1) await page.bringToFront().catch(() => {});
  }

  // Every recorded app needs a fresh frame (an untouched page emits none).
  async nudgeAll() { if (this.rec) await Promise.all(Object.values(this.apps).map(a => this.ovOn(a.page, 'nudge'))); }
  async ovOn(page, fn, ...args) {
    try { return await page.evaluate(([fn, args]) => window.__ds && window.__ds[fn](...args), [fn, args]); } catch { return undefined; }
  }
  ov(fn, ...args) { return this.page ? this.ovOn(this.page, fn, ...args) : undefined; }
  async restore(app = this.cur) {
    await this.ovOn(app.page, 'ready');
    if (this.rec) await this.ovOn(app.page, 'nudge');
    if (this.state.chapter && this.cfg.theme?.chapterSticky) await this.ovOn(app.page, 'chapter', ...this.state.chapter);
    if (app.cursor) await this.ovOn(app.page, 'setCursor', app.cursor.x, app.cursor.y);
    if (app === this.cur && this.state.caption) await this.ovOn(app.page, 'caption', this.state.caption);
  }

  // Only visible matches count, so an element hidden behind a dialog is never picked (upload opts out).
  locator(t, { visible = true } = {}) {
    if (t == null) throw new Error('missing target');
    const vis = l => (visible ? l.filter({ visible: true }) : l);
    if (typeof t === 'string' && /^[et]\d+$/.test(t)) return this.page.locator('[data-ds-id="' + t + '"]').first();
    if (typeof t === 'string') return vis(this.page.locator(t)).first();
    if (t.node) return this.page.locator('[data-ds-id="' + t.node + '"]').first();
    if (t.target !== undefined) return this.locator(t.target, { visible });
    const scope = t.within ? this.locator(t.within) : this.page;
    let l;
    if (t.ref) l = scope.locator('aria-ref=' + t.ref);
    else if (t.sel || t.css) l = scope.locator(t.sel || t.css);
    else if (t.role) l = scope.getByRole(t.role, { name: t.name, exact: t.exact });
    else if (t.testId) l = scope.getByTestId(t.testId);
    else if (t.label) l = scope.getByLabel(t.label, { exact: t.exact });
    else if (t.placeholder) l = scope.getByPlaceholder(t.placeholder, { exact: t.exact });
    else if (t.alt) l = scope.getByAltText(t.alt, { exact: t.exact });
    else if (t.title) l = scope.getByTitle(t.title, { exact: t.exact });
    else if (t.text) l = scope.getByText(t.text, { exact: t.exact });
    else throw new Error('cannot build a locator from ' + JSON.stringify(t));
    l = vis(l);
    return t.nth != null ? l.nth(t.nth) : l.first();
  }
  // Tag the element so the overlay can track it every frame (survives scrolling).
  async mark(loc) {
    const key = 't' + (++this.tcounter);
    await loc.waitFor({ state: 'visible' });
    await loc.evaluate((el, k) => el.setAttribute('data-ds-target', k), key);
    return key;
  }
  // A selector that still works on a fresh page load, for the replayable script log.
  async stable(t) {
    const ephemeral = s => typeof s === 'string' && (s.startsWith('aria-ref=') || /^[et]\d+$/.test(s));
    if (typeof t === 'string' && !ephemeral(t)) return t;
    if (t && typeof t === 'object' && !t.ref && !t.node && !ephemeral(t.target)) return t;
    const loc = this.locator(t);
    return loc.evaluate(el => {
      const q = s => JSON.stringify(s);
      if (el.id && !/\d{3,}|:/.test(el.id)) return '#' + CSS.escape(el.id);
      const tid = el.getAttribute('data-testid'); if (tid) return '[data-testid=' + q(tid) + ']';
      const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || '').toLowerCase();
      const role = el.getAttribute('role') || ({ a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', h1: 'heading', h2: 'heading', h3: 'heading' })[tag] || (tag === 'input' ? ({ checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button' })[type] || 'textbox' : null);
      const name = (el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('placeholder') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (role && name) return 'role=' + role + '[name=' + q(name) + ']';
      if (name) return 'text=' + q(name);
      return tag;
    });
  }

  // Element rect in layout-viewport px plus the visual viewport (pinch-zoom) state.
  geometry(loc) {
    return loc.evaluate(el => { const r = el.getBoundingClientRect(), v = window.visualViewport || { scale: 1, offsetLeft: 0, offsetTop: 0, width: innerWidth, height: innerHeight };
      return { x: r.x, y: r.y, w: r.width, h: r.height, s: v.scale, vx: v.offsetLeft, vy: v.offsetTop, vw: v.width, vh: v.height, iw: innerWidth, ih: innerHeight }; });
  }
  inVisual(g, m = 6) { return g.x >= g.vx + m && g.y >= g.vy + m && g.x + g.w <= g.vx + g.vw - m && g.y + g.h <= g.vy + g.vh - m; }
  // One atomic read of the page: visible, uncovered controls and text with stable ids.
  async observe(name) {
    const a = name ? this.app(name) : this.cur;
    const tag = o => ({ ...o, app: a.name, text: (this.multi ? '[' + a.name + (a === this.cur ? ', active' : '') + '] ' : '') + formatObservation(o) });
    try { return tag(await a.page.evaluate(observePage)); }
    catch (e) { await sleep(300); return tag(await a.page.evaluate(observePage)); }
  }
  // Adaptive wait: return as soon as the DOM is quiet instead of sleeping a fixed time.
  async settle(o = {}) {
    const c = this.cfg;
    const opts = { min: o.min ?? (c.dry ? 0 : c.live || c.record ? 220 : 60), quiet: o.quiet ?? 150, max: o.max ?? 1500, waitChange: !!o.waitChange, since: o.since ?? null };
    let r;
    try { r = await this.page.evaluate(settlePage, opts); }
    catch { await this.page.waitForLoadState('domcontentloaded').catch(() => {}); return { ms: 0, navigated: true }; }
    // A click that starts a fetch or a lazy chunk leaves the DOM quiet until the response lands: wait for it.
    if (o.network !== false && this.cur?.reqs) {
      const t0 = performance.now(), busy = () => [...this.cur.reqs.values()].some(t => performance.now() - t < 4000);
      let waited = false;
      while (busy() && performance.now() - t0 < opts.max) { waited = true; await sleep(40); }
      if (waited) { try { const r2 = await this.page.evaluate(settlePage, { ...opts, min: 0, waitChange: false, max: Math.min(1200, opts.max) }); r = { ...r, ms: r.ms + Math.round(performance.now() - t0), net: true, timedOut: r.timedOut && !r2.changed && r2.timedOut }; } catch {} }
    }
    return r;
  }
  async ensureVisible(loc) {
    let g = await this.geometry(loc);
    if (this.zoomed && !this.inVisual(g)) { await this.unzoom(); g = await this.geometry(loc); }
    const inView = g.y >= 0 && g.y + g.h <= g.ih && g.x >= 0 && g.x + g.w <= g.iw;
    if (!inView) { await loc.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' })); await sleep(this.cfg.dry ? 50 : 650); g = await this.geometry(loc); }
    return g;
  }
  // Move the drawn cursor and the real mouse onto the element. Under pinch-zoom Playwright's
  // locator actions are unreliable, so pointer input goes through page.mouse with coordinates
  // in the space CDP expects (layout px minus the visual-viewport offset).
  async pointTo(loc, { zoomable = true } = {}) {
    await loc.waitFor({ state: 'visible' });
    let g = await this.ensureVisible(loc);
    const az = this.cfg.autoZoom;
    if (az && zoomable && !this.zoomed && !this.cfg.dry) {
      const sc = typeof az === 'number' ? az : 1.5;
      if (g.w * sc < g.iw * 0.75 && g.h * sc < g.ih * 0.75) { await this.pinch(g.x + g.w / 2, g.y + g.h / 2, sc); this.autoZoomed = true; g = await this.geometry(loc); }
    }
    const x = g.x + g.w / 2, y = g.y + Math.min(g.h / 2, 24);
    const from = this.cur.cursor || { x: x - 160, y: y + 120 };
    const dist = Math.hypot(x - from.x, y - from.y);
    const ms = Math.round(Math.min(1100, Math.max(350, 300 + dist * 0.55)) / this.cfg.cursorSpeed);
    await Promise.all([this.ov('moveCursor', x, y, ms), this.page.mouse.move(x - g.vx, y - g.vy, { steps: Math.max(2, Math.round(ms / 25)) })]);
    this.cur.cursor = { x, y };
    const clear = await loc.evaluate((el, [px, py]) => { const h = document.elementFromPoint(px, py); return !!h && (h === el || el.contains(h) || (h.contains(el) && h.closest('label') != null)); }, [x, y]);
    return { x, y, dx: x - g.vx, dy: y - g.vy, clear };
  }
  // Click at the pointed spot; if something covers the target, fall back to Playwright's own click.
  async press(loc, pt, kind = 'click', opts = {}) {
    if (!pt.clear) { await this.unzoom(); if (kind === 'dblclick') await loc.dblclick(); else await loc.click({ button: opts.button || 'left', force: opts.force }); return; }
    await this.ov('press', true);
    if (kind === 'dblclick') await this.page.mouse.dblclick(pt.dx, pt.dy);
    else await this.page.mouse.click(pt.dx, pt.dy, { button: opts.button || 'left' });
    await this.ov('press', false);
  }

  async pinch(x, y, scale) {
    await this.cdp.send('Input.synthesizePinchGesture', { x, y, scaleFactor: scale, relativeSpeed: this.cfg.dry ? 3000 : 420, gestureSourceType: 'mouse' });
    this.zoomed = scale;
  }
  async unzoom() {
    this.autoZoomed = false;
    if (!this.zoomed) return;
    const vp = this.page.viewportSize() || await this.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    try { await this.cdp.send('Input.synthesizePinchGesture', { x: vp.width / 2, y: vp.height / 2, scaleFactor: 1 / this.zoomed, relativeSpeed: 800, gestureSourceType: 'mouse' }); } catch {}
    await this.cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).catch(() => {});
    this.zoomed = 0;
  }
  async zoom(spec) {
    if (spec === false || spec === 'out' || spec == null) return this.unzoom();
    const scale = (typeof spec === 'object' && spec.scale) || this.cfg.zoomScale;
    const loc = this.locator(spec);
    await this.unzoom(); await this.ensureVisible(loc);
    const g = await this.geometry(loc);
    await this.pinch(g.x + g.w / 2, g.y + g.h / 2, scale);
  }

  // ---- step execution -------------------------------------------------------
  async step(raw) {
    const st = typeof raw === 'string' ? { say: raw } : raw;
    const actions = Object.keys(st).filter(k => !MODIFIERS.has(k));
    // Live agent sessions: the previous beat's sentence finishes before this beat acts.
    // A beat with its own sentence starts after the previous sentence; a silent beat continues the current one.
    if (this.cfg.asyncSay && st.say) { await this.narrator.pending; if (this.pendingAfter) { await this.pendingAfter; this.pendingAfter = null; } }
    if (st.on) await this.use(st.on);
    // Fail fast on element ids that the page no longer has (instead of a 15 s locator timeout), before anything is said.
    const ids = [...JSON.stringify(st).matchAll(/"(?:node"\s*:\s*")?([et]\d+)"/g)].map(m => m[1]).filter(x => /^[et]\d+$/.test(x));
    if (ids.length) {
      const missing = await this.page.evaluate(list => list.filter(id => !document.querySelector('[data-ds-id="' + id + '"]')), ids);
      if (missing.length) throw new Error('unknown element id ' + missing.join(', '));
    }
    if (this.rec && this.rec.paused && !this.recOff) { this.rec.resume(); if (this.staged && !this.nudged) { this.nudged = true; await this.nudgeAll(); } }
    const t0 = this.clock();
    if (this.autoZoomed && !actions.some(k => POINTER.has(k) || k === 'zoom')) await this.unzoom();
    if (this.cfg.autoClear && st.say && !st.keep) await this.ov('clear');
    let speech = null;
    if (st.say) {
      speech = this.narrator.say(st.say);
      // Act shortly after the voice starts, but never wait on a slow TTS longer than leadMax.
      if (actions.length && !this.cfg.dry) {
        if (this.cfg.live) await Promise.race([speech.started.then(() => sleep(st.lead ?? 450)), sleep(this.cfg.leadMax ?? 1600)]);
        else {
          // Recording: hold the tape while the clip is synthesized so TTS latency never shows up in the video.
          const holding = this.rec && !this.rec.paused; if (holding) this.rec.pause();
          await speech.started; if (holding) this.rec.resume();
          await sleep(st.lead ?? 450);
        }
      }
    }
    const logged = {};
    // Mark the mutation count before this beat acts; a later {wait: {change}} compares against it.
    if (actions.some(k => k !== 'wait')) this.mutMark = await this.page.evaluate(() => window.__dsMut?.n ?? 0).catch(() => null);
    if (st.on) logged.on = st.on;
    if (st.say) logged.say = st.say;
    for (const k of actions) logged[k] = await this.action(k, st[k], st, speech);
    const hooks = this.after.splice(0);
    const finish = async () => { if (speech) await speech.catch(() => {}); if (st.hold) await sleep(this.cfg.dry ? 0 : st.hold); for (const fn of hooks) await fn(); };
    // asyncSay: return once the actions are done; speech (and slide teardown) continue while the agent thinks.
    if (this.cfg.asyncSay && !st.wait_say) this.pendingAfter = finish();
    else if (speech && st.async) { if (st.hold) await sleep(this.cfg.dry ? 0 : st.hold); for (const fn of hooks) await fn(); }
    else await finish();
    this.log.push(logged);
    return { t0, t1: this.clock() };
  }

  async action(k, v, st, speech) {
    const p = this.page, c = this.cfg;
    const opt = (o, key) => (o && typeof o === 'object' ? o[key] : undefined);
    switch (k) {
      case 'goto': {
        const idle = this.rec && c.trimLoads && !this.narrator.speaking && !this.rec.paused;
        await this.unzoom();
        if (idle) this.rec.pause();
        try { await p.goto(v, { waitUntil: 'load' }); await this.settle({ min: 0, quiet: 250, max: 3000 }); await this.restore(); }
        finally { if (idle) this.rec.resume(); }
        return v;
      }
      case 'click': case 'dblclick': case 'hover': case 'check': case 'uncheck': {
        const loc = this.locator(v);
        const stable = await this.stable(v);
        if ((k === 'check' || k === 'uncheck') && (await loc.isChecked()) === (k === 'check')) return stable;
        const pt = await this.pointTo(loc);
        if (k === 'hover') { await sleep(c.dry ? 0 : 300); return stable; }
        await this.ov('ripple', pt.x, pt.y);
        await this.press(loc, pt, k === 'dblclick' ? 'dblclick' : 'click', { button: opt(v, 'button'), force: opt(v, 'force') });
        await this.settle();
        return stable;
      }
      case 'type': case 'fill': {
        const loc = this.locator(omit(v, ['text', 'value'])); const text = String(v.text ?? v.value ?? '');
        const stable = await this.stable(omit(v, ['text', 'value']));
        const pt = await this.pointTo(loc);
        await this.ov('ripple', pt.x, pt.y);
        await this.press(loc, pt);
        if (k === 'fill' || v.fast || c.dry) await loc.fill(text);
        else {
          if (v.clear !== false) await loc.evaluate(el => { if ('value' in el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } else if (el.isContentEditable) el.textContent = ''; });
          await p.keyboard.type(text, { delay: v.delay ?? c.typingDelay });
        }
        if (v.enter) { await this.ov('keys', 'Enter'); await p.keyboard.press('Enter'); }
        await this.settle({ quiet: 200, max: 1200 });
        return { ...(typeof stable === 'string' ? { sel: stable } : stable), text, ...(v.enter ? { enter: true } : {}) };
      }
      case 'select': {
        const loc = this.locator(omit(v, ['value', 'label'])); await this.pointTo(loc, { zoomable: false });
        const stable = await this.stable(omit(v, ['value', 'label']));
        await loc.selectOption(v.label ? { label: v.label } : v.value);
        return { ...(typeof stable === 'string' ? { sel: stable } : stable), ...(v.label ? { label: v.label } : { value: v.value }) };
      }
      case 'upload': { const loc = this.locator(omit(v, ['files']), { visible: false }); await loc.setInputFiles(v.files); return v; }
      case 'press': { await this.ov('keys', v); await p.keyboard.press(v); await this.settle(); return v; }
      case 'scroll': {
        if (v.to || typeof v === 'string' || TARGET_KEYS.some(key => key in v && key !== 'within')) {
          const loc = this.locator(v.to ?? v);
          await loc.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        } else {
          // Wheel at a point scrolls whatever container is under it (dialogs, side panels), like a person would.
          await this.unzoom();
          let at = this.cur.cursor;
          if (v.within) { const g = await this.geometry(this.locator(v.within)); at = { x: g.x + g.w / 2, y: g.y + g.h / 2 }; }
          if (!at) { const vp = await p.evaluate(() => ({ x: innerWidth / 2, y: innerHeight / 2 })); at = vp; }
          await p.mouse.move(at.x, at.y);
          const n = c.dry ? 2 : 10, dy = (v.y || 0) / n, dx = (v.x || 0) / n;
          for (let i = 0; i < n; i++) { await p.mouse.wheel(dx, dy); await sleep(c.dry ? 0 : 28); }
        }
        await this.settle({ min: c.dry ? 0 : 300, quiet: 150, max: 1200 }); return v;
      }
      case 'wait': {
        if (typeof v === 'number') await sleep(c.fastDry ? Math.min(v, 100) : v);
        else if (v.change || v.stable) { const r = await this.settle({ waitChange: !!v.change, since: v.change ? this.mutMark : null, min: 0, quiet: v.quiet ?? v.stable ?? 700, max: v.timeout ?? 30000 }); if (r.timedOut && v.change) throw new Error('page did not change within ' + (v.timeout ?? 30000) + 'ms'); }
        else if (v.url) await p.waitForURL(v.url);
        else if (v.idle) await p.waitForLoadState('networkidle').catch(() => {});
        else if (v.gone) await this.locator(v.gone).waitFor({ state: 'hidden', timeout: v.timeout });
        else await this.locator(v).waitFor({ state: 'visible', timeout: v.timeout });
        return v;
      }
      case 'pause': case 'sleep': await sleep(c.fastDry ? 0 : v); return v;
      case 'spotlight': {
        if (!v || v === 'off') { await this.ov('spotlight', null); return null; }
        const loc = this.locator(v); await this.ensureVisible(loc);
        await this.ov('spotlight', await this.mark(loc), opt(v, 'pad')); await sleep(c.dry ? 0 : 450); return this.stable(v);
      }
      case 'highlight': {
        if (!v || v === 'off') { await this.ov('unhighlight', null); return null; }
        const loc = this.locator(v); await this.ensureVisible(loc);
        await this.ov('highlight', opt(v, 'id') || st.id || 'h' + this.tcounter, await this.mark(loc), opt(v, 'pad')); await sleep(c.dry ? 0 : 300); return this.stable(v);
      }
      case 'unhighlight': await this.ov('unhighlight', v === true ? null : v); return v;
      case 'callout': {
        if (!v || v === 'off') { await this.ov('uncallout', null); return null; }
        const tv = omit(v, ['text', 'title', 'placement', 'id']);
        const loc = this.locator(tv); await this.ensureVisible(loc);
        await this.ov('callout', v.id || st.id || 'c' + this.tcounter, await this.mark(loc), v.text, v.title, v.placement);
        await sleep(c.dry ? 0 : 350);
        const stable = await this.stable(tv);
        return { ...(typeof stable === 'string' ? { sel: stable } : stable), text: v.text, ...(v.title ? { title: v.title } : {}), ...(v.placement ? { placement: v.placement } : {}) };
      }
      case 'circle': case 'box': case 'underline': case 'arrow': {
        if (!v || v === 'off') { await this.ov('unshape', null); return null; }
        // `text` is the arrow label only when another key names the target; otherwise it is the target.
        const textIsTarget = typeof v === 'object' && v.text != null && !TARGET_KEYS.some(x => x !== 'text' && x !== 'exact' && x !== 'nth' && x in v);
        const keys = textIsTarget ? INK_KEYS.filter(x => x !== 'text') : INK_KEYS;
        const tv = omit(v, keys);
        const loc = this.locator(tv); await this.ensureVisible(loc);
        const o = typeof v === 'object' ? Object.fromEntries(keys.filter(x => v[x] != null).map(x => [x, v[x]])) : {};
        await this.ov('shape', o.id || st.id || k + this.tcounter, k, await this.mark(loc), o);
        await sleep(c.dry ? 0 : (k === 'arrow' ? 950 : 800));
        const stable = await this.stable(tv);
        return Object.keys(o).length ? { ...(typeof stable === 'string' ? { sel: stable } : stable), ...o } : stable;
      }
      case 'draw': {
        const o = Array.isArray(v) ? { points: v } : v;
        await this.ov('freehand', o.points, o); await sleep(c.dry ? 0 : (o.ms || 900)); return v;
      }
      case 'slide': case 'whiteboard': {
        if (!v || v === 'off') { await this.ov('slide', null); await sleep(c.dry ? 0 : 450); return v; }
        const o = { theme: k === 'whiteboard' ? 'board' : 'dark', ...(typeof v === 'string' ? { title: v } : v) };
        await this.unzoom();
        await this.ov('slide', o);
        const n = o.bullets?.length || 0;
        const span = st.say ? await this.narrator.durationOf(st.say) : n * 1100;
        // Bullets reveal across the narration while later keys of this step (e.g. draw) run.
        const reveals = (async () => { for (let i = 0; i < n; i++) { await sleep(c.dry ? 0 : (i === 0 ? 350 : span * 0.82 / n)); await this.ov('reveal', i); } })();
        this.after.push(async () => {
          await reveals;
          if (!speech) await sleep(c.dry ? 0 : o.ms ?? 1800);
          if (!o.keep) { await this.ov('slide', null); await sleep(c.dry ? 0 : 450); }
        });
        return v;
      }
      case 'clear': await this.ov('clear'); await this.ov('caption', null); return true;
      case 'caption': await this.ov('caption', v || null); return v;
      case 'zoom': await this.zoom(v); await sleep(c.dry ? 0 : 300); return v === false || v === 'out' ? v : { ...(typeof v === 'string' ? { sel: v } : v) };
      case 'title': {
        const o = typeof v === 'string' ? { text: v } : v;
        await this.unzoom();
        await this.ov('card', o.kicker || '', o.text, o.sub || '');
        if (speech) await speech; else await sleep(c.dry ? 0 : o.ms ?? 2800);
        await this.ov('card', '', null); await sleep(c.dry ? 0 : 450);
        return v;
      }
      case 'chapter': {
        const o = typeof v === 'string' ? { title: v } : v;
        this.chapterNo++;
        this.chapters.push({ at: this.clock(), title: o.title });
        this.state.chapter = [o.number === false ? '' : String(this.chapterNo), o.title];
        await this.ov('chapter', ...this.state.chapter);
        return v;
      }
      case 'saveState': { const f = resolve(v); await this.context.storageState({ path: f }); return f; }
      case 'geolocation': await this.context.setGeolocation(v); return v;
      case 'grant': await this.context.grantPermissions(Array.isArray(v) ? v : [v], { origin: new URL(p.url()).origin }); return v;
      case 'cursor': if (v === 'hide') { await this.ov('hideCursor'); this.cur.cursor = null; } return v;
      case 'record': this.recOff = v === 'off' || v === false; if (this.rec) { if (this.recOff) this.rec.pause(); else this.rec.resume(); } return v;
      case 'eval': return (await p.evaluate(v)) ?? v;
      case 'screenshot': { const f = resolve(this.outDir, typeof v === 'string' ? v : 'shot-' + Date.now() + '.png'); await p.screenshot({ path: f }); return f; }
      default: throw new Error('unknown step key "' + k + '"');
    }
  }

  // Remove [from, to) of recording time from the final cut (failed or rejected steps).
  cut(from, to) { this.cuts.push({ from, to }); this.narrator.dropBetween(from, to); }

  async snapshot(name) { const p = name ? this.app(name).page : this.page; return { url: p.url(), title: await p.title(), tree: await p.ariaSnapshot({ mode: 'ai' }) }; }

  async stop({ finalizeVideo = true } = {}) {
    this.stopping = true;
    await this.narrator.pending;
    for (const a of Object.values(this.apps)) {
      this.cur = a;
      await this.unzoom().catch(() => {});
      await this.ov('slide', null); await this.ov('clear'); await this.ov('caption', null);
    }
    const result = { outDir: this.outDir };
    let rec = null;
    if (this.rec) { await sleep(600); rec = await this.rec.stop(); }
    const scriptFile = join(this.outDir, 'script.yaml');
    const { mode, headed, live, dry, record, outDir, cdpPort, apps, appsSpec, ...keep } = this.cfg;
    await writeFile(scriptFile, YAML.stringify({ ...keep, ...(appsSpec ? { apps: appsSpec } : {}), steps: this.log }, { lineWidth: 0 }));
    result.script = scriptFile;
    let raw = rec?.file, frame = this.cfg.frame;
    if (rec && finalizeVideo && this.staged) {
      // Lay every app's stream onto one canvas; the wallpaper/bezels replace the single-app frame.
      raw = join(this.outDir, '.raw.mp4');
      await compose({ browser: this.browser, apps: this.cfg.apps, files: rec.files, switches: this.switches, totalMs: rec.ms, out: raw, size: this.cfg.output, fps: this.cfg.output.fps,
        layout: this.cfg.layout || {}, background: (typeof frame === 'object' && frame?.background) || (typeof frame === 'string' ? frame : null) || 'midnight', dir: this.outDir });
      frame = null;
      if (!process.env.DEMO_STUDIO_KEEP_RAW) await Promise.all(Object.values(rec.files).map(f => rm(f, { force: true })));
    }
    await this.browser.close().catch(() => {});
    if (rec && finalizeVideo) {
      Object.assign(result, await finalize({ raw, outDir: this.outDir, name: this.cfg.name || 'demo', segments: this.narrator.segments, chapters: this.chapters, cuts: this.cuts, music: this.cfg.music, fps: this.cfg.output.fps, frame, size: this.cfg.output }));
      await writeFile(join(this.outDir, 'timeline.json'), JSON.stringify({ narration: this.narrator.segments.map(({ file, ...s }) => s), chapters: this.chapters, cuts: this.cuts, apps: this.staged ? this.switches : undefined }, null, 2));
    }
    return result;
  }
}
