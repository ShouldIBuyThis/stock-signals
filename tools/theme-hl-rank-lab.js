#!/usr/bin/env node
/**
 * '앞설 테마' 순위 × 테마 52주 신고가·신저가 — 순위 반영 검증 (사전 등록 docs/2026-11-18-theme-hl-rank.md · 연구 전용 · 사이트 불변)
 * 화면 함수 그대로(H.loadPage): themeStocks · themeDailyRows · themeRowsAt · themeMultiRank · THEME_SIGS(메모리 안에서만 기준 하나를 잠깐 덧붙였다 뺀다).
 * 성공 기준 = 화면 themeCheck()와 같음: TOP3 평균 n일 수익 > 그날 모든 테마 중앙값.
 * 사용: node tools/theme-hl-rank-lab.js backtest/raw.json   (lab-quick years=10)
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8');
const page = H.loadPage();
page.runInPage(`this.__go = j => { state.data = normalize(JSON.parse(j));
  const D5 = themeDailyRows(themeStocks(), 5), D10 = themeDailyRows(themeStocks(), 10), dates = D5.map(x => x.d);
  /* 테마 52주 지표 — theme-hit-lab과 같은 정의(미국 상장 · 레버리지 아님 · n ≥ 4) */
  const mem = {}; themeStocks().forEach(s => { if (s._benchmark || CONGRESS_TICKERS.has(s.ticker) || isKR(s.ticker) || LEVERAGED[s.ticker]) return;
    const m = {}; (histStocks(s) || []).forEach(h => { if (has(h.pct_from_high) && has(h.pct_from_low)) m[String(h.last_date)] = [h.pct_from_high, h.pct_from_low]; });
    (mem[s.category || '기타'] = mem[s.category || '기타'] || []).push({ t: s.ticker, m }); });
  const TH = {};
  Object.entries(mem).forEach(([c, ms]) => { const hr = [], lr = [], nhs = [];
    dates.forEach(d => { let k = 0, h = 0, l = 0; const set = []; ms.forEach(x => { const r = x.m[d]; if (!r) return; k++; if (r[0] >= -1) { h++; set.push(x.t); } if (r[1] <= 1) l++; });
      hr.push(k >= 4 ? h / k : null); lr.push(k >= 4 ? l / k : null); nhs.push(k >= 4 ? set : null); });
    const m5 = a => a.map((_, i) => { if (i < 4) return null; let z = 0; for (let q = i - 4; q <= i; q++) { if (a[q] == null) return null; z += a[q]; } return z / 5; });
    const hr5 = m5(hr), lr5 = m5(lr), net5 = hr5.map((v, i) => v == null || lr5[i] == null ? null : v - lr5[i]);
    const dk = (a, i, k) => i - k >= 0 && a[i] != null && a[i - k] != null ? a[i] - a[i - k] : null;
    TH[c] = dates.map((_, i) => { const u = new Set(); for (let q = Math.max(0, i - 4); q <= i; q++) (nhs[q] || []).forEach(t => u.add(t));
      return { net5: net5[i], d3: dk(net5, i, 3), d5: dk(net5, i, 5), d10: dk(net5, i, 10), lrd5: dk(lr5, i, 5), hrd5: dk(hr5, i, 5), hr5p: i >= 5 ? hr5[i - 5] : null,
        spread: dk(hr5, i, 5) != null && dk(hr5, i, 5) >= 0.05 && u.size >= 2 && lr5[i] != null && lr5[i - 5] != null && lr5[i] <= lr5[i - 5] }; }); });
  const EX = { V5: ['순신고가 강도', 58, r => has(r.net5) ? r.net5 : null], V6: ['순신고가 5일 개선', 58, r => has(r.d5) ? r.d5 : null],
    V7: ['신저가 감소', 58, r => has(r.lrd5) ? -r.lrd5 : null], V9: ['순신고가 3일 개선', 58, r => has(r.d3) ? r.d3 : null],
    V10: ['순신고가 10일 개선', 58, r => has(r.d10) ? r.d10 : null], V11: ['신고가 확산', 58, r => r.spread ? 1 : null] };
  const PURE = { V1: 'net5', V2: 'd5', V3: 'd3', V4: 'd10' };
  const out = dates.map((d, i) => { const rows = D5[i].rows.map(r => Object.assign({}, r, (TH[r.name] || [])[i] || {}));
    const f10 = new Map(D10[i].rows.map(r => [r.name, r]));
    const top = {}; if (rows.length >= 5) {
      const base = themeMultiRank(rows); top.V0 = base.slice(0, 3).map(t => t.name);
      Object.entries(PURE).forEach(([k, f]) => { const a = rows.filter(r => has(r[f])); top[k] = a.length >= 5 ? a.slice().sort((x, y) => y[f] - x[f]).slice(0, 3).map(t => t.name) : null; });
      Object.entries(EX).forEach(([k, sig]) => { THEME_SIGS.push(sig); try { top[k] = themeMultiRank(rows).slice(0, 3).map(t => t.name); } finally { THEME_SIGS.pop(); } });
      top.V8 = base.filter(r => !(has(r.d5) && r.d5 <= -0.05 && has(r.hr5p) && r.hr5p > 0)).slice(0, 3).map(t => t.name); }
    return { d, top, f5: rows.every(r => r.complete && has(r.fwd)) ? Object.fromEntries(rows.map(r => [r.name, r.fwd])) : null,
      f10: D10[i].rows.length && D10[i].rows.every(r => r.complete && has(r.fwd)) ? Object.fromEntries(D10[i].rows.map(r => [r.name, r.fwd])) : null,
      n52: rows.filter(r => has(r.net5)).length }; });
  return JSON.stringify({ dates, out, sigs: THEME_SIGS.length }); };`);
const X = JSON.parse(page.__go(raw)), { dates, out } = X, T = dates.length, CUT = Math.max(0, T - 756);
const NM = { V0: '현행 4기준', V1: '단독: 순신고가 강도(net5)', V2: '단독: 순신고가 5일 개선', V3: '단독: 3일 개선', V4: '단독: 10일 개선', V5: '+순신고가 강도', V6: '+순신고가 5일 개선',
  V7: '+신저가 감소', V8: '감점: 약화 테마 제외', V9: '+순신고가 3일 개선', V10: '+순신고가 10일 개선', V11: '+신고가 확산' };
const KEYS = Object.keys(NM);
console.log(`기간 ${dates[0]}~${dates[T - 1]} · ${T}거래일 · 독립 ~${dates[CUT - 1] || '—'} | 최근 3년 ${dates[CUT]}~ · THEME_SIGS 복원 ${X.sigs}개 · 52주 자료 테마 수(마지막 날) ${out[T - 1].n52}`);
const med = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function day(o, k, h) { const F = h === 5 ? o.f5 : o.f10, t = o.top[k]; if (!F || !t || t.length < 3 || t.some(x => F[x] == null)) return null;
  const v = Object.values(F); if (v.length < 5) return null; const r = t.reduce((a, x) => a + F[x], 0) / 3, m = med(v); return { hit: r > m ? 1 : 0, ex: r - m, pos: r > 0 ? 1 : 0 }; }
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function boot(diff) { if (diff.length < 30) return [null, null]; const B = 10, nb = Math.ceil(diff.length / B), res = [];
  for (let b = 0; b < 2000; b++) { let s = 0, n = 0; for (let q = 0; q < nb; q++) { const st = Math.floor(rnd() * Math.max(1, diff.length - B)); for (let z = 0; z < B && st + z < diff.length; z++) { s += diff[st + z]; n++; } } res.push(s / n); }
  res.sort((a, b) => a - b); return [res[Math.floor(0.05 * res.length)], res[Math.floor(0.95 * res.length)]]; }
const pc = x => x == null ? '  —' : String(Math.round(x * 100)).padStart(3) + '%', pp = x => x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%p', sg = x => x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const RES = {};
for (const [tag, lo, hi] of [['독립(최근 3년 이전)', 0, CUT], ['최근 3년', CUT, T]]) {
  console.log(`\n■ ${tag} · 적중 = TOP3 평균 수익 > 그날 모든 테마 중앙값 (5일 | 10일) · 초과 = TOP3 − 중앙값 · 양수 = TOP3 평균 수익 > 0`);
  for (const k of KEYS) {
    const r = {}; for (const h of [5, 10]) { const a = [], b = [], ch = [], dif = [];
      for (let i = lo; i < hi; i++) { const v = day(out[i], k, h), z = day(out[i], 'V0', h); if (!v || !z) continue; a.push(v); b.push(z); dif.push(v.hit - z.hit);
        if (out[i].top[k].slice().sort().join() !== out[i].top.V0.slice().sort().join()) ch.push([v.hit, z.hit]); }
      const m = (L, f) => L.length ? L.reduce((s, x) => s + x[f], 0) / L.length : null;
      r[h] = { n: a.length, hit: m(a, 'hit'), ex: m(a, 'ex'), pos: m(a, 'pos'), d: a.length ? m(a, 'hit') - m(b, 'hit') : null, dex: a.length ? m(a, 'ex') - m(b, 'ex') : null,
        ch: ch.length, chv: ch.length ? ch.reduce((s, x) => s + x[0], 0) / ch.length : null, ch0: ch.length ? ch.reduce((s, x) => s + x[1], 0) / ch.length : null, ci: k === 'V0' ? [null, null] : boot(dif) }; }
    (RES[k] = RES[k] || {})[tag] = r;
    const f = h => `${pc(r[h].hit)}(${r[h].n}) 초과 ${sg(r[h].ex)} 양수 ${pc(r[h].pos)}${k === 'V0' ? '' : ` · 현행 대비 ${pp(r[h].d)} [${pp(r[h].ci[0])}~${pp(r[h].ci[1])}] · 바뀐 날 ${r[h].ch}일 ${pc(r[h].chv)} vs 현행 ${pc(r[h].ch0)}`}`;
    console.log(`  ${k.padEnd(3)} ${NM[k].padEnd(16)} 5일 ${f(5)}\n${' '.repeat(23)}10일 ${f(10)}`);
  }
}
console.log('\n■ 판정(사전 등록: 독립·최근 둘 다 5·10일 +3%p↑ ∧ 초과수익 ≥ 현행 ∧ 독립 5일 90% 하한 > 0 ∧ 바뀐 날 50↑)');
for (const k of KEYS.filter(k => k !== 'V0')) { const A = RES[k]['독립(최근 3년 이전)'], B = RES[k]['최근 3년'];
  const ok = [A, B].every(R => [5, 10].every(h => R[h].d != null && R[h].d >= 0.03 && R[h].dex >= 0)) && A[5].ci[0] != null && A[5].ci[0] > 0 && A[5].ch >= 50;
  const tgt = [A, B].every(R => [5, 10].every(h => R[h].d != null && R[h].d > 0));
  console.log(`  ${k} ${NM[k]} → ${ok ? '개선 통과' : tgt ? '방향만 같음(미통과)' : '미통과'} · 독립 5/10일 ${pp(A[5].d)}/${pp(A[10].d)} · 최근 ${pp(B[5].d)}/${pp(B[10].d)}`); }
console.log('\n※ 현재 관심종목 소급(생존 편향) · 연속 날짜 겹침 · 11개 변형 동시 비교. 사이트 순위 산식은 바꾸지 않았다.');
