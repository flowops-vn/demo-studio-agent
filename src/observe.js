// Atomic page observation for agent-driven sessions (idea from browser-use/jev-ultrafast):
// one in-page pass returns the visible, uncovered controls and text in reading order,
// each tagged with a stable id (data-ds-id="e7" / "t12") that steps can target directly.
export function observePage(max) {
  max = max || { controls: 160, texts: 140, chars: 5000 };
  const S = window.__dsObs || (window.__dsObs = { ids: new WeakMap(), next: 1, tnext: 1 });
  const idOf = (e, p) => {
    let id = S.ids.get(e);
    if (!id) { id = p + (p === 'e' ? S.next++ : S.tnext++); S.ids.set(e, id); }
    if (e.getAttribute('data-ds-id') !== id) e.setAttribute('data-ds-id', id);
    return id;
  };
  const visible = e => !e.closest('[aria-hidden="true"],[inert]') && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const name = (e, seen = new Set()) => {
    if (!e || seen.has(e)) return ''; seen.add(e);
    const ref = (e.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => name(document.getElementById(id), seen)).filter(Boolean).join(' ');
    return ref || e.getAttribute('aria-label') || [...(e.labels || [])].map(l => l.innerText).join(' ') ||
      (['button', 'submit', 'reset'].includes(e.type) ? e.value : '') || e.getAttribute('alt') ||
      (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' ? '' : e.innerText) ||
      e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };
  const roles = ['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'combobox', 'textbox', 'searchbox', 'spinbutton', 'slider', 'treeitem'];
  const sel = 'a[href],button,input,textarea,select,summary,[contenteditable="true"],[tabindex]:not([tabindex="-1"]),' + roles.map(r => '[role="' + r + '"]').join(',');
  const roleOf = e => {
    const r = e.getAttribute('role'); if (roles.includes(r)) return r;
    const t = e.tagName;
    if (t === 'BUTTON' || t === 'SUMMARY') return 'button';
    if (t === 'A') return 'link';
    if (t === 'SELECT') return 'combobox';
    if (t === 'TEXTAREA' || e.isContentEditable) return 'textbox';
    if (t === 'INPUT') { const ty = e.type; if (ty === 'checkbox' || ty === 'radio') return ty; if (['button', 'submit', 'reset', 'image'].includes(ty)) return 'button'; if (ty === 'hidden') return null; if (ty === 'file') return 'file'; return ty === 'search' ? 'searchbox' : ty === 'number' ? 'spinbutton' : 'textbox'; }
    return e.hasAttribute('tabindex') ? 'focusable' : null;
  };
  const vw = innerWidth, vh = innerHeight;
  const inView = r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  const covered = (e, r) => {
    const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(vh - 1, Math.max(0, r.top + Math.min(r.height / 2, 20)));
    const h = document.elementFromPoint(x, y);
    return !!h && !(h === e || e.contains(h) || h.contains(e) && h.tagName === 'LABEL');
  };
  const items = [], controlEls = new Set(); let omitted = 0, chars = 0;
  for (const e of document.querySelectorAll(sel)) {
    const role = roleOf(e); if (!role || role === 'file' && !visible(e)) { if (role === 'file') { items.push({ el: e, id: idOf(e, 'e'), role: 'file', name: clip(name(e) || 'file input', 60), hidden: true }); controlEls.add(e); } continue; }
    if (!visible(e)) continue;
    const r = e.getBoundingClientRect(); if (!inView(r)) continue;
    if (covered(e, r)) { omitted++; continue; }
    const it = { el: e, id: idOf(e, 'e'), role, name: clip(name(e), 80) };
    if ('value' in e && role !== 'button' && role !== 'link' && e.type !== 'checkbox' && e.type !== 'radio') it.value = clip(e.tagName === 'SELECT' ? [...e.selectedOptions].map(o => o.label).join(', ') : e.value, 60);
    if (e.type === 'checkbox' || e.type === 'radio') it.checked = e.checked;
    for (const k of ['checked', 'expanded', 'selected', 'pressed']) { const a = e.getAttribute('aria-' + k); if (a != null) it[k] = a; }
    if (e.matches(':disabled') || e.getAttribute('aria-disabled') === 'true') it.disabled = true;
    items.push(it); controlEls.add(e);
    if (items.length >= max.controls) break;
  }
  // Text: leaf-ish elements with their own visible text, outside the controls already listed and
  // not hidden behind a dialog/backdrop (covered controls must not resurface as text either).
  let texts = 0, hiddenText = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seenEl = new Set(); let n;
  while ((n = walker.nextNode()) && texts < max.texts && chars < max.chars) {
    const v = n.textContent.trim(); const p = n.parentElement;
    if (!v || !p || seenEl.has(p) || p.closest('script,style,noscript,template,demo-studio-overlay')) continue;
    let inControl = false; for (const c of controlEls) if (c.contains(p)) { inControl = true; break; }
    if (inControl) continue;
    seenEl.add(p);
    if (!visible(p)) continue;
    const r = p.getBoundingClientRect(); if (!inView(r)) continue;
    if (covered(p, r)) { hiddenText++; continue; }
    const own = clip([...p.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent).join(' '), 120);
    if (own.length < 2) continue;
    items.push({ el: p, id: idOf(p, 't'), role: 'text', name: own }); texts++; chars += own.length;
  }
  items.sort((a, b) => (a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const dialogs = [...document.querySelectorAll('dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"]')].filter(visible);
  const top = dialogs.at(-1);
  const scroller = document.scrollingElement;
  return {
    url: location.href, title: document.title, vw, vh,
    scroll: { y: Math.round(scroller.scrollTop), h: scroller.scrollHeight },
    dialog: top ? clip(top.getAttribute('aria-label') || name(top), 60) : null,
    focused: document.activeElement && document.activeElement !== document.body ? (S.ids.get(document.activeElement) || null) : null,
    items: items.map(({ el, ...it }) => it), covered: omitted, coveredText: hiddenText
  };
}

// Resolve when the DOM has been quiet for quietMs (after at least minMs), or after maxMs.
// With waitChange, first wait (up to maxMs) for any mutation, then for quiet.
export function settlePage(o) {
  return new Promise(res => {
    const t0 = performance.now(); let last = t0, changed = false;
    const M = window.__dsMut; if (o.since != null && M && M.n > o.since) { changed = true; last = M.t; }
    const mo = new MutationObserver(() => { last = performance.now(); changed = true; });
    mo.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'open', 'disabled', 'aria-expanded', 'aria-hidden', 'aria-busy', 'aria-selected', 'aria-checked', 'value'] });
    const tick = () => {
      const now = performance.now();
      const ready = (!o.waitChange || changed) && now - t0 >= o.min && now - last >= o.quiet;
      if (ready || now - t0 >= o.max) { mo.disconnect(); res({ ms: Math.round(now - t0), changed, timedOut: !ready }); }
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// Compact, model-friendly text form of an observation.
export function formatObservation(o) {
  const head = [o.title + ' — ' + o.url, 'viewport ' + o.vw + 'x' + o.vh + ' · scroll ' + o.scroll.y + '/' + o.scroll.h + (o.dialog != null ? ' · dialog "' + o.dialog + '"' : '') + (o.covered || o.coveredText ? ' · ' + [o.covered ? o.covered + ' controls' : '', o.coveredText ? o.coveredText + ' texts' : ''].filter(Boolean).join(' + ') + ' covered, hidden' : '')];
  const lines = o.items.map(it => {
    if (it.role === 'text') return '  [' + it.id + '] "' + it.name + '"';
    let s = '[' + it.id + '] ' + it.role + ' "' + it.name + '"';
    if (it.value != null && it.value !== '') s += ' = "' + it.value + '"';
    for (const k of ['checked', 'expanded', 'selected', 'pressed']) if (it[k] != null) s += ' ' + k + '=' + it[k];
    if (it.disabled) s += ' disabled'; if (it.hidden) s += ' (hidden)';
    if (o.focused === it.id) s += ' *focused';
    return s;
  });
  return head.concat(lines).join('\n');
}
