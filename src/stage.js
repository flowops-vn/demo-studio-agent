// Multi-app stage: several browser contexts (e.g. a driver's phone and a dispatcher's
// screen) laid out on one 1080p canvas. Each app is recorded to its own stream at its
// panel size; compose() places them on a pre-rendered background (wallpaper, device
// bezels, labels), dims the apps that are not being driven, and writes one raw video
// that finalize() then cuts, narrates and captions like a single-app recording.
import { join } from 'node:path';
import { rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { run } from './proc.js';

const even = v => Math.max(2, Math.round(v / 2) * 2);
export const BACKGROUNDS = { aurora: 'linear-gradient(135deg,#1e1b4b,#4f46e5 55%,#0ea5e9)', midnight: 'linear-gradient(135deg,#0b1020,#1f2a55)', sunset: 'linear-gradient(135deg,#f97316,#db2777 55%,#7c3aed)', mist: 'linear-gradient(135deg,#e2e8f0,#cbd5e1)', ocean: 'linear-gradient(135deg,#0f766e,#1d4ed8)' };
export function cssBackground(spec = 'midnight') {
  if (BACKGROUNDS[spec]) return BACKGROUNDS[spec];
  if (spec.startsWith('linear:')) return 'linear-gradient(135deg,' + spec.slice(7) + ')';
  if (/^#|^rgb|^[a-z]+$/i.test(spec)) return spec;
  return 'url(' + JSON.stringify(pathToFileURL(spec).href) + ') center/cover';
}
const bezelOf = a => (a.isMobile ? 14 : 0);
const radiusOf = a => (a.isMobile ? 34 : 12);

// Side-by-side panels sharing one content height, centred on the canvas.
export function splitLayout(apps, W, H, o = {}) {
  const pad = o.padding ?? 56, gap = o.gap ?? 56, labelH = o.labels === false ? 0 : 56;
  const availW = W - pad * 2, availH = H - pad * 2 - labelH;
  const ar = apps.map(a => a.viewport.width / a.viewport.height), b = apps.map(bezelOf);
  let ch = availH - 2 * Math.max(...b);
  const widthAt = h => ar.reduce((s, r, i) => s + h * r + 2 * b[i], 0) + gap * (apps.length - 1);
  if (widthAt(ch) > availW) ch = (availW - gap * (apps.length - 1) - b.reduce((s, x) => s + 2 * x, 0)) / ar.reduce((s, r) => s + r, 0);
  ch = even(ch);
  let x = (W - widthAt(ch)) / 2;
  const top = (H - (ch + 2 * Math.max(...b) + labelH)) / 2 + labelH;
  return apps.map((a, i) => {
    const w = even(ch * ar[i]), px = even(x + b[i]), py = even(top + Math.max(...b));
    x += w + 2 * b[i] + gap;
    return { name: a.name, label: a.label, x: px, y: py, w, h: ch, bezel: b[i], radius: radiusOf(a), labelH };
  });
}

// Focus layout: the active app large in the centre, the others as small tiles in the bottom-right corner.
export function focusLayout(apps, W, H, o = {}) {
  const pad = o.padding ?? 48;
  return apps.map((a, i) => {
    const r = a.viewport.width / a.viewport.height;
    let bh = H - pad * 2, bw = bh * r; if (bw > W - pad * 2) { bw = W - pad * 2; bh = bw / r; }
    const sh = H * 0.3, sw = sh * r;
    const big = { x: even((W - bw) / 2), y: even((H - bh) / 2), w: even(bw), h: even(bh) };
    const slot = apps.length - 1 - i; // fixed corner slot per app, right to left
    const small = { w: even(sw), h: even(sh), y: even(H - pad - sh), x: even(W - pad - sw - slot * (sw + 24)) };
    return { name: a.name, label: a.label, big, small, radius: radiusOf(a) };
  });
}

export function panelSizes(apps, W, H, layout = {}) {
  if ((layout.mode || 'split') === 'focus') return Object.fromEntries(focusLayout(apps, W, H, layout).map(p => [p.name, { width: p.big.w, height: p.big.h }]));
  return Object.fromEntries(splitLayout(apps, W, H, layout).map(p => [p.name, { width: p.w, height: p.h }]));
}

// Render the static background with the browser that is already running (real fonts, real CSS).
async function renderStage(browser, html, W, H, file) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.setContent(html, { waitUntil: 'load' });
  await p.screenshot({ path: file });
  await ctx.close();
}
const roundMask = (w, h, R, file) => {
  const lum = 'clip(255*(' + R + '+0.5-hypot(max(abs(X-' + w / 2 + '+0.5)-' + (w / 2 - R) + ',0),max(abs(Y-' + h / 2 + '+0.5)-' + (h / 2 - R) + ',0))),0,255)';
  return run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=' + w + 'x' + h, '-vf', "format=gray,geq=lum='" + lum + "'", '-frames:v', '1', file]);
};
// Recording-time intervals (seconds) during which each app is the active one.
function activeSpans(switches, names, totalMs) {
  const spans = Object.fromEntries(names.map(n => [n, []]));
  const sw = switches.length ? switches : [{ at: 0, app: names[0] }];
  sw.forEach((s, i) => { const end = sw[i + 1]?.at ?? totalMs + 10000; if (end > s.at && spans[s.app]) spans[s.app].push([s.at / 1000, end / 1000]); });
  return spans;
}
const expr = spans => spans.map(([a, b]) => 'between(t,' + a.toFixed(3) + ',' + b.toFixed(3) + ')').join('+') || '0';
const invert = (spans, total) => { const out = []; let p = 0; for (const [a, b] of spans) { if (a > p) out.push([p, a]); p = b; } if (p < total) out.push([p, total]); return out; };

export async function compose({ browser, apps, files, switches, totalMs, out, size, fps = 30, layout = {}, background, font, dir }) {
  const W = size.width, H = size.height, names = apps.map(a => a.name), total = totalMs / 1000;
  const spans = activeSpans(switches, names, totalMs);
  const mode = layout.mode || 'split';
  const tmp = []; const bgFile = join(dir, '.stage.png'); tmp.push(bgFile);
  const bg = cssBackground(background);
  const args = ['-y', '-v', 'error', '-loop', '1', '-framerate', String(fps), '-t', (total + 1).toFixed(3), '-i', bgFile];
  names.forEach(n => args.push('-i', files[n]));
  const f = []; let last = '[0:v]';
  const addMask = async (w, h, R, key) => { const m = join(dir, '.mask-' + key + '.png'); tmp.push(m); await roundMask(w, h, R, m); args.push('-loop', '1', '-framerate', String(fps), '-t', (total + 1).toFixed(3), '-i', m); return args.filter(a => a === '-i').length - 1; };
  if (mode === 'focus') {
    const ps = focusLayout(apps, W, H, layout);
    await renderStage(browser, '<html><body style="margin:0;width:' + W + 'px;height:' + H + 'px;background:' + bg + '"></body></html>', W, H, bgFile);
    const bigs = [], smalls = [];
    for (const [i, p] of ps.entries()) {
      const mb = await addMask(p.big.w, p.big.h, p.radius, p.name + '-b'), ms = await addMask(p.small.w, p.small.h, Math.round(p.radius * 0.6), p.name + '-s');
      f.push('[' + (i + 1) + ':v]split[a' + i + '][b' + i + ']');
      f.push('[a' + i + ']scale=' + p.big.w + ':' + p.big.h + ':flags=lanczos,format=yuva420p[ab' + i + '];[ab' + i + '][' + mb + ':v]alphamerge[A' + i + ']');
      f.push('[b' + i + ']scale=' + p.small.w + ':' + p.small.h + ':flags=lanczos,format=yuva420p[bb' + i + '];[bb' + i + '][' + ms + ':v]alphamerge[B' + i + ']');
      bigs.push(['[A' + i + ']', p.big, expr(spans[p.name])]); smalls.push(['[B' + i + ']', p.small, expr(invert(spans[p.name], total + 10))]);
    }
    [...bigs, ...smalls].forEach(([lbl, r, en], k) => { f.push(last + lbl + 'overlay=' + r.x + ':' + r.y + ':shortest=1:enable=\'' + en + '\'[o' + k + ']'); last = '[o' + k + ']'; });
  } else {
    const ps = splitLayout(apps, W, H, layout);
    const labelTop = Math.min(...ps.map(q => q.y - q.bezel)) - (ps[0]?.labelH || 0);
    const panels = ps.map(p => {
      const box = '<div style="position:absolute;left:' + (p.x - p.bezel) + 'px;top:' + (p.y - p.bezel) + 'px;width:' + (p.w + 2 * p.bezel) + 'px;height:' + (p.h + 2 * p.bezel) + 'px;border-radius:' + (p.radius + p.bezel) + 'px;background:#0a0a0f;box-shadow:0 28px 70px rgba(0,0,0,.45),0 0 0 1.5px rgba(255,255,255,.14)"></div>';
      const label = p.labelH ? '<div style="position:absolute;left:' + (p.x - 40) + 'px;width:' + (p.w + 80) + 'px;top:' + labelTop + 'px;height:' + (p.labelH - 10) + 'px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:26px;font-family:' + String(font || '-apple-system,Segoe UI,Inter,sans-serif').replace(/"/g, "'") + ';letter-spacing:.2px;text-shadow:0 2px 10px rgba(0,0,0,.35)">' + String(p.label).replace(/</g, '&lt;') + '</div>' : '';
      return box + label;
    }).join('');
    await renderStage(browser, '<html><body style="margin:0;width:' + W + 'px;height:' + H + 'px;background:' + bg + ';position:relative;overflow:hidden">' + panels + '</body></html>', W, H, bgFile);
    const dim = layout.dim ?? 0.45;
    for (const [i, p] of ps.entries()) {
      const m = await addMask(p.w, p.h, p.radius, p.name);
      const off = expr(invert(spans[p.name], total + 10));
      f.push('[' + (i + 1) + ':v]scale=' + p.w + ':' + p.h + ':flags=lanczos' + (dim > 0 && names.length > 1 ? ',drawbox=x=0:y=0:w=iw:h=ih:color=black@' + dim + ':t=fill:enable=\'' + off + '\'' : '') + ',format=yuva420p[p' + i + ']');
      f.push('[p' + i + '][' + m + ':v]alphamerge[r' + i + ']');
      f.push(last + '[r' + i + ']overlay=' + p.x + ':' + p.y + ':shortest=1[o' + i + ']'); last = '[o' + i + ']';
    }
  }
  f.push(last + 'format=yuv420p[v]');
  const script = join(dir, '.compose.txt'); tmp.push(script); await writeFile(script, f.join(';\n'));
  args.push('-filter_complex_script', script, '-map', '[v]', '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  await run('ffmpeg', args);
  await Promise.all(tmp.map(t => rm(t, { force: true })));
  return out;
}
