// In-page presentation layer. Serialized with Function#toString and injected via
// context.addInitScript, so it must stay self-contained (no imports, no closures).
export function overlayInit(theme) {
  if (window.__ds) return;
  const T = Object.assign({ accent: '#4f46e5', onAccent: '#fff', surface: '#0f1222', onSurface: '#fff', radius: 14, logoBg: '#fff', font: 'Inter, "SF Pro Text", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', dim: 0.55 }, theme || {});
  // Theme colours may be any CSS colour, so translucency goes through color-mix rather than hex suffixes.
  const A = (c, p) => 'color-mix(in srgb,' + c + ' ' + p + '%,transparent)';
  const deep = 'linear-gradient(135deg,' + T.surface + ',color-mix(in srgb,' + T.surface + ' 78%,' + T.accent + '))';
  const css = '\
:host{all:initial}\
*{box-sizing:border-box;font-family:' + T.font + '}\
.layer{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;overflow:visible}\
.screen{transform-origin:0 0}\
.cursor{position:absolute;left:0;top:0;width:34px;height:34px;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));z-index:9}\
.ripple{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid ' + T.accent + ';opacity:.9;animation:rip .55s ease-out forwards;z-index:8}\
@keyframes rip{from{transform:scale(.3);opacity:.95}to{transform:scale(1.6);opacity:0}}\
.spot{position:absolute;border-radius:12px;box-shadow:0 0 0 200vmax rgba(8,10,20,' + T.dim + ');transition:all .45s cubic-bezier(.4,0,.2,1),opacity .35s;opacity:0}\
.ring{position:absolute;border-radius:10px;border:3px solid ' + T.accent + ';box-shadow:0 0 0 6px ' + A(T.accent, 20) + ',0 0 24px ' + A(T.accent, 40) + ';transition:all .3s ease,opacity .3s;opacity:0}\
.call{position:absolute;max-width:360px;min-width:180px;background:' + T.surface + ';color:' + T.onSurface + ';border-radius:' + T.radius + 'px;padding:14px 16px;box-shadow:0 18px 48px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,.06);opacity:0;transition:opacity .3s ease,transform .3s ease;font-size:16px;line-height:1.45}\
.call b{display:block;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:color-mix(in srgb,' + T.accent + ' 55%,#fff);margin-bottom:4px}\
.call .ar{position:absolute;width:14px;height:14px;background:' + T.surface + ';transform:rotate(45deg)}\
.cap{position:absolute;left:50%;bottom:44px;transform:translate(-50%,12px);max-width:78%;background:' + A(T.surface, 88) + ';color:' + T.onSurface + ';font-size:22px;line-height:1.4;font-weight:500;padding:12px 22px;border-radius:' + T.radius + 'px;text-align:center;opacity:0;transition:opacity .3s,transform .3s;backdrop-filter:blur(6px)}\
.cap.on{opacity:1;transform:translate(-50%,0)}\
@media (max-width:640px){.cap{max-width:94%;width:max-content;font-size:17px;line-height:1.35;padding:8px 14px;border-radius:12px;bottom:88px}.chap{left:12px;top:12px;font-size:13px}.card{padding:0 8vw}.card h1{font-size:30px}.card p{font-size:17px}}\
.chap{position:absolute;left:24px;top:20px;transform:translateY(-8px);transition:opacity .35s,transform .35s;display:flex;align-items:center;gap:10px;background:' + A(T.surface, 85) + ';color:' + T.onSurface + ';font-size:15px;font-weight:600;padding:8px 14px 8px 10px;border-radius:999px;opacity:0;transition:opacity .3s}\
.chap.on{opacity:1;transform:none}\
.chap i{font-style:normal;background:' + T.accent + ';color:' + T.onAccent + ';border-radius:999px;min-width:24px;height:24px;display:grid;place-items:center;font-size:13px;padding:0 7px}\
.card{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:0 9vw;background:radial-gradient(1200px 600px at 20% 10%,' + A(T.accent, 33) + ',transparent 60%),' + deep + ';color:' + T.onSurface + ';opacity:0;transition:opacity .5s}\
.card .logo{display:inline-flex;align-items:center;margin-bottom:30px;border-radius:12px;' + (T.logoBg === 'none' ? '' : 'background:' + T.logoBg + ';padding:10px 16px;box-shadow:0 10px 30px rgba(0,0,0,.25)') + '}\
.card .logo img{height:44px;max-width:300px;display:block;object-fit:contain}\
.card.on{opacity:1}\
.card .k{font-size:15px;letter-spacing:.18em;text-transform:uppercase;opacity:.7;margin-bottom:18px}\
.card h1{font-size:clamp(36px,5vw,68px);line-height:1.1;margin:0 0 18px;font-weight:700;max-width:16em}\
.card p{font-size:clamp(18px,1.8vw,26px);opacity:.82;margin:0;max-width:34em;line-height:1.45}\
.keys{position:absolute;left:50%;top:22px;transform:translateX(-50%);display:flex;gap:6px;opacity:0;transition:opacity .25s}\
.keys.on{opacity:1}\
.halo{position:absolute;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:' + A(T.accent, 18) + ';border:2px solid ' + A(T.accent, 60) + ';transform:translate(-200px,-200px);transition:width .15s,height .15s,margin .15s;z-index:8}\
.halo.down{width:32px;height:32px;margin:-16px 0 0 -16px;background:' + A(T.accent, 33) + '}\
.ink{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}\
.ink path{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset var(--d,.7s) cubic-bezier(.6,0,.3,1) var(--dl,0s),opacity .3s;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.22))}\
.ink path.on{stroke-dashoffset:0}\
.inklabel{position:absolute;font-weight:700;font-size:20px;line-height:1.25;max-width:280px;opacity:0;transition:opacity .3s .5s;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 6px #fff}\
.inklabel.on{opacity:1}\
.slide{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 10vw;opacity:0;transition:opacity .45s}\
.slide.on{opacity:1}\
.slide.dark{background:radial-gradient(1100px 600px at 85% 0%,' + A(T.accent, 27) + ',transparent 60%),' + deep + ';color:' + T.onSurface + '}\
.slide.light{background:#fbfbfd;color:#14172a}\
.slide.board{background-color:#fdfdfb;background-image:radial-gradient(#d9dbe3 1.2px,transparent 1.2px);background-size:26px 26px;color:#1b1f33}\
.slide .k{font-size:15px;letter-spacing:.18em;text-transform:uppercase;opacity:.65;margin-bottom:16px}\
.slide h2{font-size:clamp(30px,3.6vw,54px);line-height:1.12;margin:0 0 28px;font-weight:700;max-width:20em}\
.slide ul{list-style:none;margin:0;padding:0;display:grid;gap:18px;max-width:46em}\
.slide li{font-size:clamp(18px,1.7vw,27px);line-height:1.4;padding-left:40px;position:relative;opacity:0;transform:translateY(10px);transition:opacity .4s,transform .4s}\
.slide li.on{opacity:1;transform:none}\
.slide li:before{content:"";position:absolute;left:0;top:.45em;width:18px;height:18px;border-radius:6px;background:' + T.accent + '}\
.slide .html{margin-top:8px}\
.keys span{background:#fff;color:#111;border-radius:8px;padding:6px 12px;font-size:16px;font-weight:600;box-shadow:0 2px 0 #c9c9d6,0 6px 18px rgba(0,0,0,.25)}';
  let host, root, pageL, screenL, cursor, halo, ink, sink, spot, cap, chap, card, keys, slide;
  const shapes = new Map(), INK = T.ink || '#ff2d55';
  const rings = new Map(), calls = new Map();
  const tracked = new Map(); // id -> {key, el, pad}
  function build() {
    host = document.createElement('demo-studio-overlay');
    host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    root = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style'); st.textContent = css; root.appendChild(st);
    pageL = div('layer'); screenL = div('layer screen'); root.append(pageL, screenL);
    cursor = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cursor.setAttribute('viewBox', '0 0 28 28'); cursor.setAttribute('class', 'cursor');
    cursor.innerHTML = '<path d="M5 3 L5 22 L10 17.5 L13.5 25 L17 23.5 L13.6 16.2 L20.5 16 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>';
    halo = div('halo'); pageL.appendChild(halo); pageL.appendChild(cursor);
    if (T.cursor === 'dot') cursor.style.display = 'none'; if (T.cursor === 'arrow') halo.style.display = 'none';
    ink = svg('ink'); pageL.appendChild(ink);
    spot = div('spot'); pageL.appendChild(spot);
    cap = div('cap'); chap = div('chap'); card = div('card'); keys = div('keys');
    slide = div('slide'); sink = svg('ink');
    screenL.append(slide, card, sink, chap, keys, cap);
    document.documentElement.appendChild(host);
  }
  function svg(c) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', c); return s; }
  function pathEl(parent, color, width, d, delay) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('pathLength', '1'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', width); if (d) p.setAttribute('d', d); if (delay) p.style.setProperty('--dl', delay + 's'); parent.appendChild(p); requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('on'))); return p; }
  function div(c) { const d = document.createElement('div'); d.className = c; return d; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function ensure() { if (!host || !host.isConnected) { if (!document.documentElement) return false; if (!host) build(); else document.documentElement.appendChild(host); } return true; }
  // Keep screen-space UI glued to the visual viewport while pinch-zoomed.
  function syncScreen() {
    const vv = window.visualViewport; if (!vv || !screenL) return;
    screenL.style.width = vv.width * vv.scale + 'px'; screenL.style.height = vv.height * vv.scale + 'px';
    screenL.style.transform = 'translate(' + vv.offsetLeft + 'px,' + vv.offsetTop + 'px) scale(' + (1 / vv.scale) + ')';
  }
  const cur = { x: -100, y: -100 };
  function placeCursor(x, y) { cur.x = x; cur.y = y; cursor.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px)'; halo.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
  // Where to draw for a marked element: the box people see, not the layout box.
  // - Text in a wide block (a value cell, a label) is measured with a Range, so the ink hugs the words
  //   instead of the whole row.
  // - Nothing is drawn while the element is hidden, scrolled out, covered by a dialog, or has been
  //   reused by the app for different content (a re-render that keeps the node but swaps its text).
  const CONTROL = /^(BUTTON|INPUT|TEXTAREA|SELECT|IMG|SVG|CANVAS|VIDEO|IFRAME|LABEL)$/i;
  const firstText = new Map();
  function contentRect(el) {
    const r = el.getBoundingClientRect();
    if (CONTROL.test(el.tagName) || el.getAttribute('role') === 'button' || !el.textContent.trim()) return r;
    const rg = document.createRange(); rg.selectNodeContents(el);
    const t = rg.getBoundingClientRect();
    if (!t.width || !t.height) return r;
    const x1 = Math.max(r.left, t.left), y1 = Math.max(r.top, t.top), x2 = Math.min(r.right, t.right), y2 = Math.min(r.bottom, t.bottom);
    if (x2 <= x1 || y2 <= y1) return r;
    return (x2 - x1) * (y2 - y1) < r.width * r.height * 0.85 ? { left: x1, top: y1, width: x2 - x1, height: y2 - y1 } : r;
  }
  function rectOf(key, pad) {
    const el = document.querySelector('[data-ds-target="' + key + '"]');
    if (!el || !el.isConnected) return null;
    const txt = CONTROL.test(el.tagName) ? '' : el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!firstText.has(key)) firstText.set(key, txt); else if (txt && firstText.get(key) && txt !== firstText.get(key) && !txt.startsWith(firstText.get(key).slice(0, 12))) return null;
    const r = contentRect(el);
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
    const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(cx, cy);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !(hit.closest && hit.closest('demo-studio-overlay'))) return null;
    pad = pad == null ? 8 : pad;
    return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
  }
  function setBox(node, r) { node.style.left = r.x + 'px'; node.style.top = r.y + 'px'; node.style.width = r.w + 'px'; node.style.height = r.h + 'px'; }
  function placeCall(node, r, placement) {
    const vw = innerWidth, vh = innerHeight, cw = node.offsetWidth, ch = node.offsetHeight, gap = 16;
    let p = placement || 'auto';
    if (p === 'auto') p = (vh - (r.y + r.h) > ch + gap + 10) ? 'bottom' : (r.y > ch + gap + 10) ? 'top' : (vw - (r.x + r.w) > cw + gap + 10) ? 'right' : 'left';
    let x, y; const ar = node.querySelector('.ar');
    if (p === 'bottom' || p === 'top') { x = r.x + r.w / 2 - cw / 2; y = p === 'bottom' ? r.y + r.h + gap : r.y - ch - gap; }
    else { y = r.y + r.h / 2 - ch / 2; x = p === 'right' ? r.x + r.w + gap : r.x - cw - gap; }
    x = Math.max(12, Math.min(vw - cw - 12, x)); y = Math.max(12, Math.min(vh - ch - 12, y));
    node.style.left = x + 'px'; node.style.top = y + 'px';
    if (p === 'bottom') { ar.style.cssText = 'top:-7px;left:' + Math.max(14, Math.min(cw - 28, r.x + r.w / 2 - x - 7)) + 'px'; }
    if (p === 'top') { ar.style.cssText = 'bottom:-7px;left:' + Math.max(14, Math.min(cw - 28, r.x + r.w / 2 - x - 7)) + 'px'; }
    if (p === 'right') { ar.style.cssText = 'left:-7px;top:' + Math.max(14, Math.min(ch - 28, r.y + r.h / 2 - y - 7)) + 'px'; }
    if (p === 'left') { ar.style.cssText = 'right:-7px;top:' + Math.max(14, Math.min(ch - 28, r.y + r.h / 2 - y - 7)) + 'px'; }
  }
  const rnd = (s, i) => { const v = Math.sin(s * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
  const seedOf = id => { let h = 7; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 9973; return h; };
  const pts2d = ps => ps.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  function smooth(ps) { if (ps.length < 3) return pts2d(ps); let d = 'M' + ps[0][0] + ' ' + ps[0][1]; for (let i = 0; i < ps.length - 1; i++) { const p0 = ps[i - 1] || ps[i], p1 = ps[i], p2 = ps[i + 1], p3 = ps[i + 2] || p2; d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1); } return d; }
  // Hand-drawn geometry around a rect r = {x,y,w,h}; deterministic per seed so it is stable frame to frame.
  function geom(kind, r, s, o) {
    if (kind === 'circle') {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2 + 14, ry = r.h / 2 + 12, a0 = -2.2 + rnd(s, 1) * 0.6, ps = [];
      for (let i = 0; i <= 56; i++) { const t = i / 56, a = a0 + t * (Math.PI * 2 + 0.45), k = 1 + 0.035 * Math.sin(3 * a + s) + t * 0.05; ps.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]); }
      return { d: smooth(ps.filter((_, i) => i % 2 === 0)) };
    }
    if (kind === 'box') { const p = 10, j = i => (rnd(s, i) - 0.5) * 5; return { d: pts2d([[r.x - p + j(1), r.y - p + j(2)], [r.x + r.w + p + j(3), r.y - p + j(4)], [r.x + r.w + p + j(5), r.y + r.h + p + j(6)], [r.x - p + j(7), r.y + r.h + p + j(8)], [r.x - p + 3, r.y - p + 6]]) }; }
    if (kind === 'underline') { const y = r.y + r.h + 7; return { d: 'M' + (r.x - 4) + ' ' + (y + 1) + ' Q' + (r.x + r.w * 0.45) + ' ' + (y + 5 + rnd(s, 2) * 4) + ' ' + (r.x + r.w + 6) + ' ' + (y - 1) }; }
    if (kind === 'arrow') {
      const vw = innerWidth, vh = innerHeight, L = o.length || 150, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const dirs = { 'top-left': [-1, -1], 'top-right': [1, -1], 'bottom-left': [-1, 1], 'bottom-right': [1, 1], left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
      let order = o.from && dirs[o.from] ? [o.from] : ['bottom-left', 'bottom-right', 'top-left', 'top-right', 'left', 'right', 'bottom', 'top'];
      let tail, dir;
      for (const k of order) { const v = dirs[k], n = Math.hypot(v[0], v[1]); const ex = cx + v[0] * (r.w / 2), ey = cy + v[1] * (r.h / 2); const tx = ex + v[0] / n * L, ty = ey + v[1] / n * L; tail = [tx, ty]; dir = v; if (tx > 40 && tx < vw - 40 && ty > 40 && ty < vh - 40) break; }
      const n = Math.hypot(dir[0], dir[1]), head = [cx + dir[0] * (r.w / 2 + 8), cy + dir[1] * (r.h / 2 + 8)];
      if (dir[0] && dir[1]) { head[0] = cx + dir[0] * Math.min(r.w / 2 + 8, r.w / 2 * 0.6 + 14); head[1] = cy + dir[1] * (r.h / 2 + 8); }
      const mx = (tail[0] + head[0]) / 2, my = (tail[1] + head[1]) / 2, px = -(head[1] - tail[1]), py = head[0] - tail[0], pl = Math.hypot(px, py) || 1, bend = 0.22 * L;
      const c = [mx + px / pl * bend, my + py / pl * bend];
      const ang = Math.atan2(head[1] - c[1], head[0] - c[0]), hl = 18;
      const h1 = [head[0] - hl * Math.cos(ang - 0.5), head[1] - hl * Math.sin(ang - 0.5)], h2 = [head[0] - hl * Math.cos(ang + 0.5), head[1] - hl * Math.sin(ang + 0.5)];
      return { d: 'M' + tail[0].toFixed(1) + ' ' + tail[1].toFixed(1) + ' Q' + c[0].toFixed(1) + ' ' + c[1].toFixed(1) + ' ' + head[0].toFixed(1) + ' ' + head[1].toFixed(1), head: pts2d([h1, head, h2]), tail: tail, dir: dir };
    }
  }
  function frame() {
    if (ensure()) {
      syncScreen();
      for (const [id, t] of tracked) {
        const r = rectOf(t.key, t.pad); const node = t.node;
        if (!r) { node.style.opacity = 0; continue; }
        if (t.kind === 'call') placeCall(node, r, t.placement);
        else if (t.kind === 'shape') {
          const g = geom(t.shape, r, t.seed, t);
          t.p.setAttribute('d', g.d); if (t.h) t.h.setAttribute('d', g.head);
          if (t.label) { const lw = t.label.offsetWidth, lh = t.label.offsetHeight; t.label.style.left = (g.tail[0] - (g.dir[0] > 0 ? 0 : g.dir[0] < 0 ? lw : lw / 2) + g.dir[0] * 6) + 'px'; t.label.style.top = (g.tail[1] - (g.dir[1] > 0 ? 0 : g.dir[1] < 0 ? lh : lh / 2) + g.dir[1] * 6) + 'px'; }
        } else setBox(node, r);
        node.style.opacity = 1;
      }
    }
    requestAnimationFrame(frame);
  }
  function track(id, kind, node, key, opts) { tracked.set(id, Object.assign({ kind: kind, node: node, key: key }, opts || {})); }
  function untrack(id, remove) { const t = tracked.get(id); if (!t) return; tracked.delete(id); t.node.style.opacity = 0; if (remove) setTimeout(() => t.node.remove(), 350); }
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const api = {
    ready: () => ensure(),
    moveCursor(x, y, ms) {
      ensure(); const x0 = cur.x < -50 ? x - 160 : cur.x, y0 = cur.y < -50 ? y + 120 : cur.y, t0 = performance.now(); ms = ms || 600;
      return new Promise(res => { const step = now => { const k = Math.min(1, (now - t0) / ms), e = ease(k); placeCursor(x0 + (x - x0) * e, y0 + (y - y0) * e); k < 1 ? requestAnimationFrame(step) : res(); }; requestAnimationFrame(step); });
    },
    setCursor(x, y) { ensure(); placeCursor(x, y); },
    hideCursor() { ensure(); placeCursor(-100, -100); },
    ripple(x, y) { ensure(); const r = div('ripple'); r.style.left = x + 'px'; r.style.top = y + 'px'; pageL.appendChild(r); setTimeout(() => r.remove(), 700); },
    spotlight(key, pad) { ensure(); if (!key) { untrack('spot'); return; } track('spot', 'box', spot, key, { pad: pad == null ? 10 : pad }); },
    highlight(id, key, pad) { ensure(); let n = rings.get(id); if (!n) { n = div('ring'); pageL.appendChild(n); rings.set(id, n); } track('ring:' + id, 'box', n, key, { pad: pad == null ? 6 : pad }); },
    unhighlight(id) { if (id) { untrack('ring:' + id, true); rings.delete(id); return; } for (const k of [...rings.keys()]) api.unhighlight(k); },
    callout(id, key, text, title, placement) {
      ensure(); let n = calls.get(id); if (!n) { n = div('call'); pageL.appendChild(n); calls.set(id, n); }
      n.innerHTML = (title ? '<b>' + esc(title) + '</b>' : '') + esc(text) + '<div class="ar"></div>';
      track('call:' + id, 'call', n, key, { placement: placement, pad: 0 });
    },
    uncallout(id) { if (id) { untrack('call:' + id, true); calls.delete(id); return; } for (const k of [...calls.keys()]) api.uncallout(k); },
    caption(text) { ensure(); if (text) { cap.innerHTML = esc(text); cap.classList.add('on'); } else cap.classList.remove('on'); },
    // The chapter pill shows briefly (sticky only when theme.chapterSticky) so it never hides app chrome for long.
    chapter(n, text, ms) { ensure(); clearTimeout(api._ct); if (text) { chap.innerHTML = (n ? '<i>' + esc(n) + '</i>' : '') + esc(text); chap.classList.add('on'); if (!T.chapterSticky) api._ct = setTimeout(() => chap.classList.remove('on'), ms || 4000); } else chap.classList.remove('on'); },
    card(kicker, title, sub) { ensure(); if (title) { card.innerHTML = (T.logo ? '<div class="logo"><img src="' + esc(T.logo) + '"></div>' : '') + (kicker ? '<div class="k">' + esc(kicker) + '</div>' : '') + '<h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : ''); card.classList.add('on'); } else card.classList.remove('on'); },
    keys(combo, ms) { ensure(); keys.innerHTML = String(combo).split('+').map(k => '<span>' + esc(k) + '</span>').join(''); keys.classList.add('on'); clearTimeout(api._kt); api._kt = setTimeout(() => keys.classList.remove('on'), ms || 1200); },
    press(on) { ensure(); halo.classList.toggle('down', !!on); },
    // Hand-drawn annotation tracked to an element: circle | box | underline | arrow (with optional label text).
    shape(id, kind, key, o) {
      ensure(); api.unshape(id); o = o || {};
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); ink.appendChild(g);
      const color = o.color || INK, w = o.width || 4;
      const t = { kind: 'shape', node: g, key: key, shape: kind, seed: seedOf(id), from: o.from, length: o.length, pad: 0 };
      t.p = pathEl(g, color, w, null, 0); t.p.style.setProperty('--d', (o.ms || (kind === 'underline' ? 450 : 750)) / 1000 + 's');
      if (kind === 'arrow') { t.h = pathEl(g, color, w, null, 0.62); t.h.style.setProperty('--d', '.25s'); }
      if (kind === 'arrow' && o.text) { const l = div('inklabel'); l.style.color = color; l.textContent = o.text; pageL.appendChild(l); t.label = l; requestAnimationFrame(() => l.classList.add('on')); }
      tracked.set('shape:' + id, t); shapes.set(id, t);
      if (o.ttl) setTimeout(() => api.unshape(id), o.ttl);
    },
    unshape(id) {
      if (id == null) { for (const k of [...shapes.keys()]) api.unshape(k); sink.innerHTML = ''; return; }
      const t = shapes.get(id); if (!t) return; shapes.delete(id); tracked.delete('shape:' + id);
      t.node.style.transition = 'opacity .3s'; t.node.style.opacity = 0; if (t.label) t.label.style.opacity = 0;
      setTimeout(() => { t.node.remove(); if (t.label) t.label.remove(); }, 350);
    },
    // Freehand stroke in screen coordinates (CSS px of the visible viewport); sits above slides.
    freehand(points, o) { ensure(); o = o || {}; const p = pathEl(sink, o.color || INK, o.width || 4, smooth(points), 0); p.style.setProperty('--d', (o.ms || 900) / 1000 + 's'); if (o.ttl) setTimeout(() => p.remove(), o.ttl); },
    slide(o) {
      ensure();
      if (!o) { slide.classList.remove('on'); return; }
      slide.className = 'slide ' + (o.theme || 'dark');
      slide.innerHTML = (o.kicker ? '<div class="k">' + esc(o.kicker) + '</div>' : '') + (o.title ? '<h2>' + esc(o.title) + '</h2>' : '') + (o.bullets && o.bullets.length ? '<ul>' + o.bullets.map(b => '<li>' + esc(b) + '</li>').join('') + '</ul>' : '') + (o.html ? '<div class="html">' + o.html + '</div>' : '');
      requestAnimationFrame(() => slide.classList.add('on'));
    },
    reveal(i) { const li = slide.querySelectorAll('li')[i]; if (li) li.classList.add('on'); },
    vv() { const v = window.visualViewport; return v ? { s: v.scale, x: v.offsetLeft, y: v.offsetTop, w: v.width, h: v.height } : { s: 1, x: 0, y: 0, w: innerWidth, h: innerHeight }; },
    clear() { api.spotlight(null); api.unhighlight(); api.uncallout(); api.unshape(null); },
    // Force a compositor frame (screencast only emits frames on damage), e.g. for a recorder that just attached.
    nudge() { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;background:#000;pointer-events:none;z-index:2147483647'; document.documentElement.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.remove())); },
    cursorPos: () => ({ x: cur.x, y: cur.y })
  };
  window.__ds = api;
  // Page-wide mutation counter, so "wait for change" also sees changes that happened during the last action.
  if (!window.__dsMut) {
    window.__dsMut = { n: 0, t: performance.now() };
    const startMut = () => new MutationObserver(() => { window.__dsMut.n++; window.__dsMut.t = performance.now(); })
      .observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'disabled', 'aria-expanded', 'aria-hidden', 'aria-busy', 'value'] });
    if (document.documentElement) startMut(); else document.addEventListener('readystatechange', startMut, { once: true });
  }
  const boot = () => { ensure(); requestAnimationFrame(frame); };
  if (document.documentElement) boot(); else document.addEventListener('readystatechange', boot, { once: true });
}
