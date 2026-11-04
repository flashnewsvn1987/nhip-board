// Dựng data/indices.json cho tab "Chỉ số" của NHIP.
// Nguồn điểm số: VNDirect DChart (nến ngày, cùng nguồn Worker đang dùng).
// Nguồn GTGD/KL/khối ngoại: cộng từ data/foreign.json theo sàn (chỉ cho VN-Index/HNX/UPCoM, ghi rõ "tổng sàn").
// Chỉ số không có thành phần chính thức -> để trống (null) và ghi lý do, KHÔNG tự điền số.
// An toàn: thiếu VNINDEX hoặc <3 chỉ số có điểm -> thoát lỗi, KHÔNG ghi đè file cũ.
import fs from 'node:fs';
const BASE = process.env.DCHART_BASE || 'https://dchart-api.vndirect.com.vn/dchart/history';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => { const n = Number(v); return v === null || v === '' || v === undefined || !isFinite(n) ? null : n; };
// [mã dchart, tên, nhóm, sàn để cộng GTGD (hoặc null)]
const LIST = [
  ['VNINDEX', 'VN-Index', 'HOSE', 'HOSE'], ['VN30', 'VN30', 'HOSE', null], ['VN100', 'VN100', 'HOSE', null],
  ['VNALL', 'VN-All', 'HOSE', null], ['VNMIDCAP', 'VN Midcap', 'HOSE', null], ['VNSMALLCAP', 'VN Smallcap', 'HOSE', null],
  ['HNX', 'HNX-Index', 'HNX', 'HNX'], ['HNX30', 'HNX30', 'HNX', null], ['UPCOM', 'UPCoM-Index', 'UPCoM', 'UPCOM'],
  // chỉ số ngành: thử, mã nào dchart không có thì bỏ qua
  ['VNFIN', 'Tài chính', 'Ngành', null], ['VNIT', 'Công nghệ thông tin', 'Ngành', null], ['VNREAL', 'Bất động sản', 'Ngành', null],
  ['VNMAT', 'Nguyên vật liệu', 'Ngành', null], ['VNHEAL', 'Y tế', 'Ngành', null], ['VNCOND', 'Tiêu dùng không thiết yếu', 'Ngành', null],
  ['VNCONS', 'Tiêu dùng thiết yếu', 'Ngành', null], ['VNENE', 'Năng lượng', 'Ngành', null], ['VNIND', 'Công nghiệp', 'Ngành', null],
  ['VNUTI', 'Tiện ích', 'Ngành', null],
];
// ---- nhiều nguồn nến ngày: thử lần lượt với VNINDEX, nguồn nào chạy được thì dùng cho mọi chỉ số ----
const TMO = 12000;
async function http(url, opt = {}) {
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), TMO);
  try { const r = await fetch(url, { ...opt, headers: { Accept: 'application/json', 'User-Agent': UA, ...(opt.headers || {}) }, signal: ac.signal }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) { } return { status: r.status, j, head: txt.slice(0, 80).replace(/\s+/g, ' ') }; }
  catch (e) { return { status: 0, j: null, head: String(e && (e.cause && e.cause.code || e.name || e.message)) }; } finally { clearTimeout(tm); }
}
const clean = rows => { const o = rows.filter(x => x.t != null && x.c != null && x.c > 0).sort((a, b) => a.t - b.t); return o.length ? o : null; };
const SRC = {
  async dchart(sym) {
    const to = Math.floor(Date.now() / 1000), r = await http(BASE + '?' + new URLSearchParams({ symbol: sym, resolution: 'D', from: String(to - 400 * 86400), to: String(to) }));
    const j = r.j; if (j && Array.isArray(j.t) && Array.isArray(j.c) && j.t.length === j.c.length) return { rows: clean(j.t.map((t, i) => ({ t: num(t), c: num(j.c[i]) }))), r };
    return { rows: null, r };
  },
  async vndfinfo(sym) {
    const from = new Date(Date.now() - 400 * 86400e3).toISOString().slice(0, 10);
    for (const host of ['https://api-finfo.vndirect.com.vn', 'https://finfo-api.vndirect.com.vn']) {
      const r = await http(host + '/v4/vnmarket_prices?' + new URLSearchParams({ q: 'code:' + sym + '~date:gte:' + from, sort: 'date', size: '500' }));
      const d = r.j && Array.isArray(r.j.data) ? r.j.data : null;
      if (d && d.length) return { rows: clean(d.map(x => ({ t: /^\d{4}-\d{2}-\d{2}/.test(String(x.date)) ? Math.floor(Date.parse(String(x.date).slice(0, 10) + 'T00:00:00+07:00') / 1000) : null, c: num(x.close != null ? x.close : x.adClose) }))), r };
      if (host.startsWith('https://finfo')) return { rows: null, r };
    }
  },
  async vietcap(sym) {
    const r = await http('https://trading.vietcap.com.vn/api/chart/OHLCChart/gap-chart', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://trading.vietcap.com.vn', Referer: 'https://trading.vietcap.com.vn/' }, body: JSON.stringify({ timeFrame: 'ONE_DAY', symbols: [sym], countBack: 300, to: Math.floor(Date.now() / 1000) + 86400 }) });
    const x = Array.isArray(r.j) ? r.j[0] : null;
    if (x && Array.isArray(x.t) && Array.isArray(x.c) && x.t.length === x.c.length) return { rows: clean(x.t.map((t, i) => ({ t: num(t), c: num(x.c[i]) }))), r };
    return { rows: null, r };
  },
};
let USE = null;
async function pickSource() {
  for (const name of Object.keys(SRC)) {
    const o = await SRC[name]('VNINDEX'); const r = o && o.r || {};
    console.log('[nguồn ' + name + '] HTTP ' + (r.status || 0) + ' · ' + (o && o.rows ? o.rows.length + ' nến' : 'không có nến') + (o && o.rows ? '' : ' · ' + (r.head || '')));
    if (o && o.rows) { USE = name; return; }
  }
}
async function candles(sym) {
  for (let t = 0; t < 2; t++) { const o = await SRC[USE](sym); if (o && o.rows) return o.rows; if (o && o.r && (o.r.status === 400 || o.r.status === 404)) return null; await sleep(1000); }
  return null;
}
const vnDate = t => new Date((t + 25200) * 1000).toISOString().slice(0, 10);
function perf(rows) {
  const n = rows.length, last = rows[n - 1], lastD = vnDate(last.t), out = {};
  const back = days => { const lim = last.t - days * 86400; let b = null; for (let i = n - 1; i >= 0; i--) { if (rows[i].t <= lim) { b = rows[i]; break; } } return b; };
  const pc = b => b && b.c ? +((last.c / b.c - 1) * 100).toFixed(2) : null;
  out.d1 = n > 1 ? pc(rows[n - 2]) : null; out.w1 = pc(back(7)); out.m1 = pc(back(30)); out.m3 = pc(back(91)); out.y1 = pc(back(365));
  const y0 = lastD.slice(0, 4) + '-01-01'; let ytdBase = null; for (let i = n - 1; i >= 0; i--) { if (vnDate(rows[i].t) < y0) { ytdBase = rows[i]; break; } }
  out.ytd = pc(ytdBase);
  return out;
}
let F = null; try { F = JSON.parse(fs.readFileSync('data/foreign.json', 'utf8')); } catch (e) { }
function exTotals(ex, d) {
  if (!F || !F.ok || !Array.isArray(F.rows)) return null;
  const rs = F.rows.filter(r => String(r.ex).toUpperCase() === ex); if (rs.length < 20 || F.day !== d) return null; // chỉ cộng khi foreign.json cùng ngày với điểm chỉ số
  let kl = 0, gt = 0, nnq = 0, nnv = 0;
  for (const r of rs) { kl += num(r.tradedQ) || 0; gt += (num(r.tradedV) || 0) * 1e6; nnq += (num(r.buyQ) || 0) - (num(r.sellQ) || 0); nnv += (num(r.buyV) || 0) - (num(r.sellV) || 0); }
  return { kl, gt, nnq, nnv, n: rs.length, day: F.day };
}
await pickSource();
if (!USE) { console.log('LỖI: không nguồn nào trả được nến VNINDEX từ máy chủ GitHub — xem các dòng [nguồn …] ở trên.'); process.exit(1); }
const indices = {}, missing = []; let day = null;
for (const [code, name, grp, ex] of LIST) {
  const rows = await candles(code);
  if (!rows || !rows.length) { missing.push(code); continue; }
  const n = rows.length, c = rows[n - 1].c, pv = n > 1 ? rows[n - 2].c : null, d = vnDate(rows[n - 1].t);
  if (!day || d > day) day = d;
  const x = { name, grp, pts: +c.toFixed(2), chg: pv != null ? +(c - pv).toFixed(2) : null, pct: pv ? +((c / pv - 1) * 100).toFixed(2) : null, perf: perf(rows), asOf: d,
    kl: null, gt: null, nnq: null, nnv: null, ptq: null, ptv: null, cap: null, n: 0, nHit: 0, fit: null, memSrc: 'thiếu', memNote: 'Chưa có danh sách thành phần chính thức', reasons: { flow: 'Chưa có danh sách thành phần của chỉ số này', pt: 'Chưa có nguồn thỏa thuận', pts: '' } };
  if (ex) { x.reasons.flow = 'foreign.json chưa cùng ngày với điểm chỉ số'; const t = exTotals(ex, d); if (t) { Object.assign(x, { kl: t.kl, gt: t.gt, nnq: t.nnq, nnv: t.nnv, n: t.n, nHit: t.n, memSrc: 'tổng sàn', memNote: 'Tổng toàn sàn ' + ex + ' từ foreign.json (ngày ' + t.day + ')' }); x.reasons.flow = ''; } else x.memNote = 'foreign.json chưa cùng ngày — chưa có tổng sàn'; }
  indices[code] = x; await sleep(250);
}
for (const k of Object.keys(indices)) if (day && indices[k].asOf < day) indices[k].stale = true;
if (!indices.VNINDEX || Object.keys(indices).length < 3) { console.log('LỖI: thiếu dữ liệu (VNINDEX hoặc <3 chỉ số). Thiếu:', missing.join(',')); process.exit(1); }
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/indices.json', JSON.stringify({ ok: true, day, built: new Date().toISOString(), source: 'VNDirect DChart + data/foreign.json', missing, indices }));
console.log('OK', Object.keys(indices).length, 'chỉ số; thiếu:', missing.join(',') || 'không');
