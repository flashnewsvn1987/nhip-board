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
async function candles(sym) {
  const to = Math.floor(Date.now() / 1000), from = to - 400 * 86400;
  for (let t = 0; t < 3; t++) {
    try {
      const ac = new AbortController(), tm = setTimeout(() => ac.abort(), 15000);
      const r = await fetch(BASE + '?' + new URLSearchParams({ symbol: sym, resolution: 'D', from: String(from), to: String(to) }), { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: ac.signal });
      clearTimeout(tm);
      if (r.ok) {
        const j = await r.json();
        if (j && Array.isArray(j.t) && Array.isArray(j.c) && j.t.length === j.c.length && j.c.length) {
          const rows = j.t.map((t, i) => ({ t: num(t), c: num(j.c[i]) })).filter(x => x.t != null && x.c != null && x.c > 0).sort((a, b) => a.t - b.t);
          if (rows.length) return rows;
        }
        return null; // 200 nhưng rỗng: mã không có
      }
      if (r.status === 400 || r.status === 404) return null;
    } catch (e) { }
    await sleep(1200 * (t + 1));
  }
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
  
