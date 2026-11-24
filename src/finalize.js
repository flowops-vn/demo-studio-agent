// Post-production: cut ranges out, lay narration clips at their offsets,
// embed chapters, and write SRT + a contact sheet for self-review.
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './proc.js';
import { probeMs } from './tts.js';

const fmt = ms => { const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, x = Math.floor(ms % 1000); return [h, m, s].map(v => String(v).padStart(2, '0')).join(':') + ',' + String(x).padStart(3, '0'); };

// Merge overlapping cuts and build a mapper from raw time to edited time.
function cutMap(cuts, total) {
  const cs = cuts.map(c => [Math.max(0, c.from), Math.min(total, c.to)]).filter(c => c[1] > c[0]).sort((a, b) => a[0] - b[0]);
  const merged = []; for (const c of cs) { const l = merged.at(-1); if (l && c[0] <= l[1]) l[1] = Math.max(l[1], c[1]); else merged.push([...c]); }
  const map = t => { let off = 0; for (const [a, b] of merged) { if (t >= b) off += b - a; else if (t > a) return a - off; } return t - off; };
  const inCut = t => merged.some(([a, b]) => t >= a && t < b);
  const keep = []; let p = 0; for (const [a, b] of merged) { if (a > p) keep.push([p, a]); p = b; } if (p < total) keep.push([p, total]);
  return { merged, map, inCut, keep };
}

// Pre-render the still layers of the "framed" look: background, drop shadow alpha, rounded mask.
const FRAME_PRESETS = { aurora: 'linear:#1e1b4b,#4f46e5,#0ea5e9', midnight: 'linear:#0b1020,#1f2a55', sunset: 'linear:#f97316,#db2777,#7c3aed', mist: 'linear:#e2e8f0,#cbd5e1', ocean: 'linear:#0f766e,#1d4ed8' };
async function frameLayers(frame, W, H, dir) {
  const pad = Math.round(frame.padding ?? W * 0.045), R = frame.radius ?? 18;
  const iw = Math.round((W - pad * 2) / 2) * 2, ih = Math.round(iw * H / W / 2) * 2, x = (W - iw) / 2, y = Math.round((H - ih) / 2 / 2) * 2;
  let bgSpec = frame.background || 'aurora'; bgSpec = FRAME_PRESETS[bgSpec] || bgSpec;
  const bg = join(dir, '.bg.png'), mask = join(dir, '.mask.png'), sh = join(dir, '.shadow.png');
  if (bgSpec.startsWith('linear:')) {
    const cs = bgSpec.slice(7).split(',').map(c => c.trim());
    const cols = cs.map((c, i) => 'c' + i + '=' + c.replace('#', '0x')).join(':');
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'gradients=s=' + W + 'x' + H + ':' + cols + ':nb_colors=' + cs.length + ':x0=0:y0=0:x1=' + W + ':y1=' + H + ':speed=0.0001', '-frames:v', '1', bg]);
  } else if (/^#|^0x|^[a-z]+$/i.test(bgSpec)) {
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=' + bgSpec.replace('#', '0x') + ':s=' + W + 'x' + H, '-frames:v', '1', bg]);
  } else {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', bgSpec, '-vf', 'scale=' + W + ':' + H + ':force_original_aspect_ratio=increase,crop=' + W + ':' + H + (frame.blur ? ',gblur=sigma=' + frame.blur : ''), '-frames:v', '1', bg]);
  }
  // Anti-aliased rounded rectangle as a luma mask (inside=255).
  const rr = (w, h, ox, oy) => "clip(255*(" + R + "+0.5-hypot(max(abs(X-" + ox + "-" + w / 2 + "+0.5)-" + (w / 2 - R) + ",0),max(abs(Y-" + oy + "-" + h / 2 + "+0.5)-" + (h / 2 - R) + ",0))),0,255)";
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=' + iw + 'x' + ih, '-vf', "format=gray,geq=lum='" + rr(iw, ih, 0, 0) + "'", '-frames:v', '1', mask]);
  const so = Math.round(ih * 0.02), sb = Math.max(8, Math.round(W / 60));
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=' + W + 'x' + H, '-vf', "format=gray,geq=lum='" + rr(iw, ih, x, y + so) + "',gblur=sigma=" + sb, '-frames:v', '1', sh]);
  return { bg, mask, sh, iw, ih, x, y, shadow: frame.shadow ?? 0.55 };
}

export async function finalize({ raw, outDir, name = 'demo', segments = [], chapters = [], cuts = [], music, fps = 30, frame, size }) {
  const total = await probeMs(raw);
  const { merged, map, inCut, keep } = cutMap(cuts, total);
  const segs = segments.filter(s => s.file && !inCut(s.start)).map(s => ({ ...s, at: map(s.start), chunks: s.chunks.map(c => ({ ...c, start: map(c.start), end: map(c.end) })) }));
  const editedMs = keep.reduce((s, [a, b]) => s + b - a, 0);
  const chs = chapters.filter(c => !inCut(c.at)).map(c => ({ ...c, at: map(c.at) }));
  const out = join(outDir, name + '.mp4');

  const args = ['-y', '-v', 'error', '-i', raw];
  segs.forEach(s => args.push('-i', s.file));
  let musicIdx = -1; if (music?.file) { musicIdx = segs.length + 1; args.push('-stream_loop', '-1', '-i', music.file); }
  let metaIdx = -1;
  if (chs.length) {
    const meta = [';FFMETADATA1'];
    chs.forEach((c, i) => meta.push('[CHAPTER]', 'TIMEBASE=1/1000', 'START=' + Math.round(c.at), 'END=' + Math.round(chs[i + 1]?.at ?? editedMs), 'title=' + c.title.replace(/[=;#\\\n]/g, ' ')));
    const mf = join(outDir, '.chapters.txt'); await writeFile(mf, meta.join('\n') + '\n');
    metaIdx = segs.length + 1 + (musicIdx >= 0 ? 1 : 0); args.push('-i', mf);
  }
  const f = [];
  let vOut = merged.length ? '[v]' : '0:v';
  let fl = null;
  if (frame) {
    const W = size?.width || 1920, H = size?.height || 1080;
    fl = await frameLayers(typeof frame === 'object' ? frame : typeof frame === 'string' ? { background: frame } : {}, W, H, outDir);
    const base = args.filter(a => a === '-i').length; // index of next input
    const dur = (editedMs / 1000 + 1).toFixed(3);
    args.push('-loop', '1', '-t', dur, '-i', fl.bg, '-loop', '1', '-t', dur, '-i', fl.sh, '-loop', '1', '-t', dur, '-i', fl.mask);
    fl.idx = [base, base + 1, base + 2];
  }
  if (merged.length) {
    const sel = keep.map(([a, b]) => 'between(t,' + (a / 1000).toFixed(3) + ',' + (b / 1000).toFixed(3) + ')').join('+');
    f.push('[0:v]select=\'' + sel + '\',setpts=N/' + fps + '/TB[v]');
  }
  if (fl) {
    const [bi, si, mi] = fl.idx;
    const src = merged.length ? '[v]' : '[0:v]';
    f.push('color=c=black:s=' + (size?.width || 1920) + 'x' + (size?.height || 1080) + ':r=' + fps + '[blk]');
    f.push('[blk][' + si + ':v]alphamerge,colorchannelmixer=aa=' + fl.shadow + '[shd]');
    f.push('[' + bi + ':v][shd]overlay=shortest=1[bgs]');
    f.push(src + 'scale=' + fl.iw + ':' + fl.ih + ':flags=lanczos,format=yuva420p[vs]');
    f.push('[vs][' + mi + ':v]alphamerge[vr]');
    f.push('[bgs][vr]overlay=' + fl.x + ':' + fl.y + ':shortest=1,format=yuv420p[vf]');
    vOut = '[vf]';
  }
  const mix = [];
  segs.forEach((s, i) => { f.push('[' + (i + 1) + ':a]aresample=48000,adelay=' + Math.round(s.at) + ':all=1[n' + i + ']'); mix.push('[n' + i + ']'); });
  if (musicIdx >= 0) {
    const vol = music.volume ?? 0.12;
    f.push('[' + musicIdx + ':a]aresample=48000,volume=' + vol + ',atrim=0:' + (editedMs / 1000).toFixed(3) + ',afade=t=out:st=' + Math.max(0, editedMs / 1000 - 2).toFixed(3) + ':d=2[m]');
    if (mix.length) {
      f.push(mix.join('') + 'amix=inputs=' + mix.length + ':normalize=0:dropout_transition=0,asplit=2[voice][key]');
      f.push('[m][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[duck]');
      f.push('[voice][duck]amix=inputs=2:normalize=0[a0]');
    } else f.push('[m]anull[a0]');
  } else if (mix.length) f.push(mix.join('') + 'amix=inputs=' + mix.length + ':normalize=0:dropout_transition=0[a0]');
  const hasAudio = mix.length || musicIdx >= 0;
  if (hasAudio) f.push('[a0]apad,atrim=0:' + (editedMs / 1000).toFixed(3) + ',loudnorm=I=-16:TP=-1.5:LRA=11[a]');
  if (f.length) args.push('-filter_complex', f.join(';'));
  args.push('-map', vOut);
  if (hasAudio) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
  if (metaIdx >= 0) args.push('-map_metadata', String(metaIdx), '-map_chapters', String(metaIdx));
  if (merged.length || fl) args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps));
  else args.push('-c:v', 'copy');
  args.push('-movflags', '+faststart', out);
  await run('ffmpeg', args);
  if (metaIdx >= 0) await rm(join(outDir, '.chapters.txt'), { force: true });
  if (fl) await Promise.all([fl.bg, fl.sh, fl.mask].map(p => rm(p, { force: true })));

  // Sidecars: SRT captions, chapters list, contact sheet.
  const srt = segs.flatMap(s => s.chunks).map((c, i) => (i + 1) + '\n' + fmt(c.start) + ' --> ' + fmt(c.end) + '\n' + c.text + '\n').join('\n');
  const srtFile = join(outDir, name + '.srt'); await writeFile(srtFile, srt);
  const chapterTxt = chs.map(c => { const s = Math.floor(c.at / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + ' ' + c.title; }).join('\n');
  if (chs.length) await writeFile(join(outDir, 'chapters.txt'), chapterTxt + '\n');
  const contact = join(outDir, 'contact.jpg');
  const every = Math.max(1, editedMs / 1000 / 12);
  await run('ffmpeg', ['-y', '-v', 'error', '-i', out, '-vf', 'fps=1/' + every.toFixed(3) + ',scale=640:-2,tile=4x3:padding=6:color=white', '-frames:v', '1', '-update', '1', contact]).catch(() => {});
  return { video: out, srt: srtFile, contact, ms: editedMs, chapters: chapterTxt, narration: segs.length, cut_ms: total - editedMs };
}
