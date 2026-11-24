// Voice/action alignment. A step's actions should land when the narration reaches what they show:
// the circle around "94%" appears as the voice says "chín mươi tư phần trăm", the click on "Tạo đơn"
// lands as the voice says "Tạo đơn". The clip's speech/pause structure comes from ffmpeg silencedetect;
// within a phrase, time is interpolated by syllables of the spoken form (what the voice actually reads).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { spoken, syllables } from './speech.js';

// Voiced spans [[startMs, endMs], …] of an audio file, cached next to it.
export async function voicedSpans(file, ms) {
  const side = file + '.voiced.json';
  if (existsSync(side)) { try { return JSON.parse(await readFile(side, 'utf8')); } catch {} }
  const err = await new Promise(res => {
    let e = ''; const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=n=-38dB:d=0.12', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', d => (e += d)); p.on('close', () => res(e)); p.on('error', () => res(''));
  });
  const sil = []; let open = null;
  for (const m of err.matchAll(/silence_(start|end): ([\d.]+)/g)) { const t = Math.round(parseFloat(m[2]) * 1000); if (m[1] === 'start') open = t; else { sil.push([open ?? 0, t]); open = null; } }
  if (open != null) sil.push([open, ms]);
  const spans = []; let at = 0;
  for (const [a, b] of sil) { if (a > at + 40) spans.push([at, a]); at = Math.max(at, b); }
  if (ms > at + 40) spans.push([at, ms]);
  const out = spans.length ? spans : [[0, ms]];
  await writeFile(side, JSON.stringify(out)).catch(() => {});
  return out;
}

// Normalised text with a map back to original indices: lower case, letters/digits only, single spaces.
function norm(s) {
  const map = []; let out = '', space = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i].toLowerCase();
    if (/[\p{L}\p{N}]/u.test(c)) { out += c; map.push(i); space = false; }
    else if (!space) { out += ' '; map.push(i); space = true; }
  }
  return { out, map };
}
// Where (char index in say) the narration mentions one of the candidate labels; longest match wins.
export function findPhrase(say, candidates) {
  const S = norm(say.normalize('NFC'));
  let best = null;
  for (const raw of candidates) {
    if (!raw) continue;
    let c = norm(String(raw).normalize('NFC')).out.trim();
    if (c.length < 2) continue;
    const words = c.split(' ');
    const tries = [c, ...(words.length > 4 ? [words.slice(0, 4).join(' '), words.slice(0, 3).join(' ')] : [])];
    for (const t of tries) {
      const re = new RegExp('(^| )' + t.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&') + '(?= |$)');
      const m = re.exec(S.out);
      if (m) { const idx = m.index + m[1].length; if (!best || t.length > best.len) best = { index: S.map[idx], len: t.length, text: t }; break; }
    }
  }
  return best;
}

// Milliseconds from the start of the clip to the moment the voice reaches charIndex of the written text.
export function timeAt(text, charIndex, clip, opts = {}) {
  const sp = s => syllables(spoken(s, opts));
  const voiced = clip.voiced?.length ? clip.voiced : [[0, clip.ms]];
  // Phrases between punctuation usually match the clip's pauses one for one.
  const parts = []; let start = 0;
  for (const m of text.matchAll(/[,.;:!?…]+\s*/g)) { const end = m.index + m[0].length; if (text.slice(start, m.index).trim()) parts.push([start, end]); start = end; }
  if (text.slice(start).trim()) parts.push([start, text.length]);
  if (parts.length === voiced.length && parts.length > 1) {
    const j = Math.max(0, parts.findIndex(([a, b]) => charIndex >= a && charIndex < b));
    const [a, b] = parts[j], [va, vb] = voiced[j];
    const n = sp(text.slice(a, b)) || 1, k = sp(text.slice(a, charIndex));
    return Math.round(va + (vb - va) * Math.min(1, k / n));
  }
  // Otherwise interpolate over the voiced time as one stream.
  const total = sp(text) || 1, k = sp(text.slice(0, charIndex));
  const len = voiced.reduce((s, [a, b]) => s + b - a, 0);
  let want = len * Math.min(1, k / total);
  for (const [a, b] of voiced) { if (want <= b - a) return Math.round(a + want); want -= b - a; }
  return clip.ms;
}
