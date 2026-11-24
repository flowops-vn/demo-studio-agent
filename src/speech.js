// Spoken Vietnamese for narration. Two jobs:
//  1. spoken(): turn written text into what a presenter would say, so TTS reads "230.000đ",
//     "94%", "24/11/2026", "14:30", "DH-1021", "0912 345 678" or "KPI" the way people do. Captions
//     keep the written form; only the voice gets the spoken one.
//  2. lintNarration(): flag lines that read like documents instead of speech (long sentences, mixed
//     forms of address, bureaucratic phrasing, acronyms with no known pronunciation).
// The conventions follow Vietnamese vendor training videos (KiotViet, MISA, Sapo, Base, Viettel…).

const DIGIT = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const SCALE = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ'];

function triple(n, full) {
  const h = Math.floor(n / 100), t = Math.floor(n / 10) % 10, u = n % 10, w = [];
  if (full || h) w.push(DIGIT[h], 'trăm');
  if (t === 0) { if (u) w.push(...(full || h ? ['linh'] : []), DIGIT[u]); }
  else if (t === 1) { w.push('mười'); if (u) w.push(u === 5 ? 'lăm' : DIGIT[u]); }
  else { w.push(DIGIT[t], 'mươi'); if (u) w.push(u === 1 ? 'mốt' : u === 4 ? 'tư' : u === 5 ? 'lăm' : DIGIT[u]); }
  return w.join(' ');
}
export const digitsWords = s => String(s).replace(/\D/g, '').split('').map(d => DIGIT[+d]).join(' ');
// 1005 → "một nghìn không trăm linh năm", 230000 → "hai trăm ba mươi nghìn", 21 → "hai mươi mốt"
export function numberWords(s) {
  s = String(s).replace(/^0+(?=\d)/, '');
  if (!/^\d+$/.test(s)) return s;
  if (s === '0') return 'không';
  if (s.length > 18) return digitsWords(s);
  const groups = []; for (let i = s.length; i > 0; i -= 3) groups.unshift(+s.slice(Math.max(0, i - 3), i));
  const out = []; let started = false;
  groups.forEach((g, i) => { if (!g) return; out.push(triple(g, started), SCALE[groups.length - 1 - i]); started = true; });
  return out.filter(Boolean).join(' ');
}

// Vietnamese letter names, for spelling codes and unknown acronyms.
const LETTER = { A: 'a', B: 'bê', C: 'xê', D: 'đê', Đ: 'đê', E: 'e', F: 'ép', G: 'gờ', H: 'hát', I: 'i', J: 'gi', K: 'ca', L: 'lờ', M: 'em', N: 'en', O: 'o', P: 'pê', Q: 'quy', R: 'rờ', S: 'ét', T: 'tê', U: 'u', V: 'vê', W: 'vê kép', X: 'ích', Y: 'i dài', Z: 'dét' };
export const spell = s => s.toUpperCase().split('').map(c => LETTER[c] || c).join(' ');

// How Vietnamese presenters say common tech/business acronyms (English letter names where that is
// the norm, the full word where one exists). Projects add their own with pronounce: {…}.
export const ACRONYMS = {
  AI: 'ây ai', API: 'ây pi ai', CRM: 'xi a em', ERP: 'i a pi', TMS: 'tê em ét', WMS: 'vê kép em ét', KPI: 'cây pi ai', OKR: 'ô kê a',
  OTP: 'ô tê pê', QR: 'qui a', GPS: 'gi pi ét', SMS: 'ét em ét', PDF: 'pi đi ép', ID: 'ai đi', OK: 'ô kê', CEO: 'xi i âu', HR: 'hát a', IT: 'ai ti',
  VAT: 'vê a tê', VND: 'việt nam đồng', VNĐ: 'việt nam đồng', USD: 'đô la mỹ', SaaS: 'sát', POS: 'pốt', SKU: 'ét ca u', COD: 'xi âu đi', SLA: 'ét eo ây',
  HĐ: 'hóa đơn', SĐT: 'số điện thoại', ĐVT: 'đơn vị tính', MST: 'mã số thuế', CMND: 'chứng minh nhân dân', CCCD: 'căn cước công dân', BKS: 'biển kiểm soát',
  'TP.HCM': 'thành phố hồ chí minh', TPHCM: 'thành phố hồ chí minh', HCM: 'hồ chí minh', TP: 'thành phố', HN: 'hà nội', KH: 'khách hàng', NCC: 'nhà cung cấp', NV: 'nhân viên',
  Excel: 'ếch xen', Email: 'i meo', email: 'i meo', Zalo: 'da lô', Google: 'gu gồ', dashboard: 'đát bọt', Dashboard: 'đát bọt', popup: 'póp áp', Popup: 'póp áp'
};
const UNITS = { 'km/h': 'ki lô mét một giờ', km: 'ki lô mét', kg: 'ki lô gam', m2: 'mét vuông', 'm²': 'mét vuông', m3: 'mét khối', 'm³': 'mét khối', cm: 'xen ti mét', mm: 'mi li mét', ml: 'mi li lít', m: 'mét', l: 'lít', tấn: 'tấn', GB: 'gi ga bai', MB: 'mê ga bai' };

const frac = f => (f.length <= 2 && f[0] !== '0' ? numberWords(f) : digitsWords(f));
// "230.000" / "1.500.000" (dot thousands), "2,5" (comma decimal), "4.0" (a dot that is not a thousands group)
export function readNumber(raw) {
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) { const [i, f] = raw.replace(/\./g, '').split(','); return f ? numberWords(i) + ' phẩy ' + frac(f) : numberWords(i); }
  if (/^\d+,\d+$/.test(raw)) { const [i, f] = raw.split(','); return numberWords(i) + ' phẩy ' + frac(f); }
  if (/^\d+\.\d+$/.test(raw)) { const [i, f] = raw.split('.'); return numberWords(i) + ' chấm ' + frac(f); }
  return numberWords(raw.replace(/\D/g, ''));
}
const NUM = '\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:[.,]\\d+)?';
const esc = s => s.replace(/[.*+?^$\{}()|[\]\\]/g, '\\$&');
const word = k => new RegExp('(^|[^\\p{L}\\p{N}])' + esc(k) + '(?=$|[^\\p{L}\\p{N}])', 'gu');
const MULT = { k: 'nghìn', K: 'nghìn', tr: 'triệu' };
const month = mo => (+mo === 4 ? 'tư' : numberWords(mo));

export function spoken(text, { lang = 'vi', pronounce = {} } = {}) {
  let s = String(text);
  // Project words first (brand names, product codes): whole-word, longest first.
  for (const [k, v] of Object.entries(pronounce || {}).sort((a, b) => b[0].length - a[0].length)) s = s.replace(word(k), (m, p) => p + v);
  if (lang && !/^vi/i.test(lang)) return s;
  // URLs and domains: "kiotviet.vn/hotro" → "kiotviet chấm vê en gạch chéo hotro"
  const TLD = { vn: 'vê en', com: 'com', net: 'nét', org: 'o rờ gờ', io: 'ai ô', ai: 'ây ai', app: 'áp' };
  s = s.replace(/\bhttps?:\/\//g, '').replace(/\b([a-z0-9-]+)\.(vn|com|net|org|io|ai|app)(\.vn)?((?:\/[\w-]+)*)/gi, (m, d, t1, t2, path) =>
    d + ' chấm ' + TLD[t1.toLowerCase()] + (t2 ? ' chấm vê en' : '') + (path ? path.split('/').filter(Boolean).map(p => ' gạch chéo ' + p).join('') : ''));
  // Phone numbers and hotlines: mobile digit by digit in groups, 1800/1900 lines as presenters read them.
  s = s.replace(/(?<![\d.,])(0\d{2,3})[ .]?(\d{3})[ .]?(\d{3,4})(?!\d|[.,]\d)/g, (m, a, b, c) => [a, b, c].map(digitsWords).join(', '));
  s = s.replace(/(?<![\d.,])(1[89]00)[ .]?(\d{3,4})(?:[ .](\d{2,4}))?(?!\d|[.,]\d)/g, (m, a, b, c) => [a, b, c].filter(Boolean).map(digitsWords).join(', '));
  // Vehicle plates "29C-123.45" and codes "DH-1021", "O-241126-0003", "HD0012": letters spelled, digits one by one.
  s = s.replace(/\b(\d{2})([A-ZĐ])(\d?)-(\d{3})\.?(\d{2})\b/g, (m, a, L, x, b, c) => digitsWords(a) + ' ' + spell(L) + (x ? ' ' + digitsWords(x) : '') + ', ' + digitsWords(b) + ' ' + digitsWords(c));
  s = s.replace(/\b([A-ZĐ]{1,4})(-?)(\d[\d-]*\d|\d)\b/g, (m, L, dash, d) => (ACRONYMS[L] || spell(L)) + ', ' + d.split('-').map(digitsWords).join(', '));
  // Dates and times.
  s = s.replace(/(?:(?<!\p{L})ngày\s+)?\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/gu, (m, d, mo, y) => (+d <= 31 && +mo <= 12 ? 'ngày ' + numberWords(d) + ' tháng ' + month(mo) + ' năm ' + numberWords(y) : m));
  s = s.replace(/(ngày|hôm|sáng|chiều|tối|đến|từ)\s+(\d{1,2})\/(\d{1,2})\b/gi, (m, w, d, mo) => (+d <= 31 && +mo <= 12 ? w + ' ' + numberWords(d) + ' tháng ' + month(mo) : m));
  s = s.replace(/(?:(?<!\p{L})tháng\s+)?\b(\d{1,2})\/(\d{4})\b/gu, (m, mo, y) => (+mo <= 12 ? 'tháng ' + month(mo) + ' năm ' + numberWords(y) : m));
  s = s.replace(/\b(\d{1,2})[:h](\d{2})\b/g, (m, h, mi) => (+h < 24 && +mi < 60 ? numberWords(h) + ' giờ' + (+mi ? ' ' + numberWords(mi) : '') : m));
  s = s.replace(/\b(\d{1,2})h(?![\p{L}\d])/gu, (m, h) => numberWords(h) + ' giờ');
  // Money: "230.000đ", "1,5 triệu đồng", "750k", "$20", "20 USD"
  s = s.replace(new RegExp('(' + NUM + ')\\s?(k|K|tr|triệu|tỷ|nghìn|ngàn)?\\s?(đ|₫|đồng|VNĐ|VND|vnđ)(?![\\p{L}])', 'gu'), (m, n, mult, cur) => readNumber(n) + (mult ? ' ' + (MULT[mult] || mult) : '') + ' đồng');
  s = s.replace(new RegExp('(' + NUM + ')(k|K|tr)(?![\\p{L}])', 'gu'), (m, n, mult) => readNumber(n) + ' ' + MULT[mult]);
  s = s.replace(/\$\s?(\d+(?:[.,]\d+)*)/g, (m, n) => readNumber(n.replace(/,(?=\d{3}\b)/g, '.')) + ' đô la');
  s = s.replace(new RegExp('(' + NUM + ')\\s?USD\\b', 'g'), (m, n) => readNumber(n) + ' đô la mỹ');
  // Percentages, ranges, multipliers, units.
  s = s.replace(new RegExp('(' + NUM + ')\\s?%', 'g'), (m, n) => readNumber(n) + ' phần trăm');
  s = s.replace(new RegExp('(?<![\\p{L}\\d])(' + NUM + ')\\s?[-–]\\s?(' + NUM + ')(?=\\s|$)', 'gu'), (m, a, b) => readNumber(a) + ' đến ' + readNumber(b));
  s = s.replace(/(?<![\p{L}\d])[xX×](\d+)\b/gu, (m, n) => 'gấp ' + numberWords(n));
  const unitRe = Object.keys(UNITS).map(esc).join('|');
  s = s.replace(new RegExp('(' + NUM + ')\\s?(' + unitRe + ')(?![\\p{L}\\p{N}])', 'gu'), (m, n, u) => readNumber(n) + ' ' + UNITS[u]);
  // Remaining numbers.
  s = s.replace(new RegExp('(?<![\\p{L}\\d])(' + NUM + ')(?!\\d)', 'gu'), (m, n) => readNumber(n));
  // Acronyms and loanwords with a known spoken form.
  for (const [k, v] of Object.entries(ACRONYMS)) s = s.replace(word(k), (m, p) => p + v);
  // Symbols a voice would say, or skip.
  s = s.replace(/\s*&\s*/g, ' và ').replace(/\s*(→|->|=>)\s*/g, ' sang ').replace(/[“”"«»*_#]/g, '').replace(/(\p{L})\s*\/\s*(?=\p{L})/gu, '$1 hoặc ');
  return s.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
}

// ---- narration lint ----------------------------------------------------------------------------
const ADDRESS = [['anh chị', /(?<!\p{L})anh\s*(?:\/\s*)?chị(?!\p{L})/iu], ['quý khách', /(?<!\p{L})quý khách(?!\p{L})/iu], ['bạn', /(?<!\p{L})bạn(?!\p{L})/iu], ['mọi người', /(?<!\p{L})mọi người(?!\p{L})/iu]];
// Document-style wording that sounds stiff when spoken, with what presenters say instead.
const STIFF = [
  [/(?<!\p{L})tiến hành(?!\p{L})/iu, '"tiến hành X": nói thẳng động từ ("lưu", "gửi", "tạo")'],
  [/(?<!\p{L})người dùng(?!\p{L})/iu, '"người dùng": gọi thẳng người nghe ("anh chị", "bạn")'],
  [/(?<!\p{L})thực hiện thao tác(?!\p{L})/iu, '"thực hiện thao tác": dùng "bấm", "chọn", "kéo"'],
  [/(?<!\p{L})nhằm(?!\p{L})/iu, '"nhằm": nói "để"'],
  [/(?<!\p{L})được thực hiện bởi(?!\p{L})/iu, 'câu bị động: đổi sang chủ động ("hệ thống tự …")'],
  [/(?<!\p{L})click(?!\p{L})/iu, '"click": nói "bấm" hoặc "nhấn"'],
  [/như sau\s*:/iu, '"như sau:": nói luôn nội dung, hoặc "gồm ba bước"'],
  [/(?<!\p{L})vân vân(?!\p{L})|(?<!\p{L})etc\b/iu, '"vân vân": nêu 2–3 ví dụ cụ thể'],
  [/;/, 'dấu chấm phẩy là văn viết: tách thành hai câu'],
  [/\([^)]*\)/, 'ngoặc đơn không đọc lên được: đưa ý đó thành câu riêng hoặc bỏ']
];
export const syllables = s => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;

// items: [{text, index}]; returns warnings plus an estimate of spoken length at the given pace.
export function lintNarration(items, { pronounce = {}, rate = 210 } = {}) {
  const warn = [], forms = new Map();
  const known = new Set([...Object.keys(ACRONYMS), ...Object.keys(pronounce || {})]);
  let total = 0;
  for (const { text, index } of items) {
    const where = '#' + index;
    for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
      const n = syllables(spoken(sentence, { pronounce }));
      if (n > 32) warn.push(where + ' câu dài ' + n + ' âm tiết (dễ nghe nhất 8–25): tách ý: "' + sentence.slice(0, 60) + '…"');
    }
    total += syllables(spoken(text, { pronounce }));
    for (const [name, re] of ADDRESS) if (re.test(text)) forms.set(name, [...(forms.get(name) || []), index]);
    for (const [re, tip] of STIFF) if (re.test(text)) warn.push(where + ' ' + tip);
    for (const m of text.matchAll(/(?<![\p{L}\d-])[A-ZĐ][A-ZĐ]{1,6}(?![\p{L}\d-])/gu)) if (!known.has(m[0])) warn.push(where + ' "' + m[0] + '" chưa có cách đọc sẵn: nghe thử (demo-studio say "…"), nếu sai thêm pronounce: {' + m[0] + ': "' + spell(m[0]) + '"}');
  }
  // One way of addressing the audience for the whole video.
  if (forms.size > 1) warn.push('xưng hô lẫn lộn: ' + [...forms].map(([k, v]) => '"' + k + '" (' + v.map(i => '#' + i).join(' ') + ')').join(', ') + '; chọn một cách gọi người nghe cho cả video');
  return { warnings: [...new Set(warn)], syllables: total, estSeconds: Math.round(total / rate * 60) };
}
