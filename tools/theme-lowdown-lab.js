#!/usr/bin/env node
/**
 * 🔭 앞설 테마 ∩ 신저가 둔화 — 변형 조합 연구 (사전 등록 docs/2026-11-17-theme-lowdown.md · 읽기 전용)
 * theme-hit-lab.js(D)의 후속. 화면 함수 그대로(H.loadPage): themeStocks · themeDailyRows · themeMultiRank · histStocks · qqqBenchmarkStock.
 * 진입 = 신호일 종가(체결 보장 아님). 주 지표 = 5일 안 +1% 도달률(기존 연구와 같음) · 보조 = +5일 종가 승률(±1% 보합 제외 · 화면 승률과 같은 규칙).
 * 사용: node tools/theme-lowdown-lab.js backtest/raw.json
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8');
const page = H.loadPage();
page.runInPage(`this.__x = j => { state.data = normalize(JSON.parse(j));
  const daily = themeDailyRows(themeStocks(), 5), dates = daily.map(x => x.d);
  const R5 = daily.map(x => x.rows.length >= 5 ? themeMultiRank(x.rows).slice(0, 5).map(t => t.name) : []);
  const themesAll = daily.map(x => x.rows.map(t => t.name));
  const mem = {}; themeStocks().forEach(s => { if (s._benchmark || CONGRESS_TICKERS.has(s.ticker) || isKR(s.ticker) || LEVERAGED[s.ticker]) return;
    const c = s.category || '기타', hs = histStocks(s) || [], m = {}; hs.forEach(h => { m[String(h.last_date)] = [num(h.open), num(h.price), num(h.ma20), num(h.pct_from_high), num(h.pct_from_low)]; });
    (mem[c] = mem[c] || []).push({ t: s.ticker, m }); });
  const q = qqqBenchmarkStock(), qh = (q && histStocks(q)) || [], qm = {}; qh.forEach(h => { qm[String(h.last_date)] = num(h.price); });
  return JSON.stringify({ dates, R5, themesAll, mem, qm }); };`);
const { dates, R5, themesAll, mem, qm } = JSON.parse(page.__x(raw)); const T = dates.length;
const SPLIT = Math.max(0, T - 756);   // 앞 = 2017~ · 뒤 = 최근 756거래일(기존 연구의 독립/탐색 경계와 같다)
console.log(`기간 ${dates[0]}~${dates[T - 1]} · ${T}거래일 · 테마 ${Object.keys(mem).length} · 앞/뒤 경계 ${dates[SPLIT]}`);
// 시장 국면(QQQ 200일선 · 60일 수익) — theme-hit-lab과 같다
const qp = dates.map(d => qm[d] ?? null), RG = dates.map((d, i) => { if (i < 200 || qp[i] == null || qp[i - 60] == null) return null;
  const w = qp.slice(i - 199, i + 1).filter(x => x != null); if (w.length < 180) return null; const ma = w.reduce((a, b) => a + b, 0) / w.length, r60 = qp[i] / qp[i - 60] - 1;
  return qp[i] > ma && r60 > 0 ? '상승' : qp[i] < ma && r60 < 0 ? '하락' : '횡보'; });
const TH = {};
for (const [c, ms] of Object.entries(mem)) {
  const hr = [], lr = [], ab = [], n = [];
  dates.forEach(d => { let k = 0, h = 0, l = 0, a = 0;
    ms.forEach(x => { const r = x.m[d]; if (!r || r[1] == null || r[2] == null || r[3] == null || r[4] == null) return; k++; if (r[3] >= -1) h++; if (r[4] <= 1) l++; if (r[1] > r[2]) a++; });
    n.push(k); hr.push(k >= 4 ? h / k : null); lr.push(k >= 4 ? l / k : null); ab.push(k >= 4 ? a / k : null); });
  const m5 = a => a.map((_, i) => { if (i < 4) return null; const w = a.slice(i - 4, i + 1); return w.some(x => x == null) ? null : w.reduce((p, q) => p + q, 0) / 5; });
  const hr5 = m5(hr), lr5 = m5(lr), d5 = a => a.map((x, i) => i < 5 || x == null || a[i - 5] == null ? null : x - a[i - 5]);
  const lrMax10 = lr5.map((_, i) => { const w = lr5.slice(Math.max(0, i - 10), i).filter(x => x != null); return w.length ? Math.max(...w) : null; });
  TH[c] = { n, lr, lr5, dHr: d5(hr5), dLr: d5(lr5), dAb: d5(ab), lrMax10 };
}
const OUT = (c, i) => { const ms = mem[c]; if (i + 10 >= T) return null; const d0 = dates[i];
  const pick = ms.filter(x => x.m[d0] && x.m[d0][1] > 0); if (pick.length < 4) return null; const V = [];
  for (let k = 1; k <= 10; k++) { const d = dates[i + k]; let s = 0; for (const x of pick) { const r = x.m[d]; if (!r || r[1] == null) return null; s += r[1] / x.m[d0][1]; } V.push(s / pick.length - 1); }
  return V; };
/* ── 사전 등록 조합(이것만) ── */
const nn = v => v != null;
const L = {
  L1: (t, i) => nn(TH[t].lr5[i - 5]) && TH[t].lr5[i - 5] > 0 && nn(TH[t].dLr[i]) && TH[t].dLr[i] < 0,                                   // 기존 D
  L2: (t, i) => nn(TH[t].lr5[i - 5]) && TH[t].lr5[i - 5] >= 0.05 && nn(TH[t].dLr[i]) && TH[t].dLr[i] <= -0.05,                          // 5%p 이상 감소
  L3: (t, i) => nn(TH[t].lr5[i - 5]) && TH[t].lr5[i - 5] > 0 && TH[t].lr[i] === 0,                                                       // 오늘 신저가권 0
  L4: (t, i) => { const a = TH[t].lr5; return [0, 1, 2, 3].every(k => nn(a[i - k])) && a[i - 3] > 0 && a[i] < a[i - 1] && a[i - 1] < a[i - 2] && a[i - 2] < a[i - 3]; }, // 3일 연속 둔화
  L5: (t, i) => nn(TH[t].lrMax10[i]) && TH[t].lrMax10[i] >= 0.10 && nn(TH[t].lr5[i]) && TH[t].lr5[i] <= TH[t].lrMax10[i] - 0.05,        // 기존 F(급증 멈춤)
};
const P = {
  P1: (t, i) => nn(TH[t].dHr[i]) && TH[t].dHr[i] >= 0,      // 신고가 비율 안 줄어듦
  P2: (t, i) => nn(TH[t].dAb[i]) && TH[t].dAb[i] > 0,       // 20일선 위 비율 증가
  P3: (t, i) => RG[i] != null && RG[i] !== '하락',          // 시장 하락 국면 아님
};
const RULES = {}; for (const [k, f] of Object.entries(L)) RULES[k] = f; for (const [k, f] of Object.entries(P)) RULES['L1+' + k] = (t, i) => L.L1(t, i) && f(t, i);
const UNIV = { U3: (t, i) => R5[i].slice(0, 3).includes(t), U5: (t, i) => R5[i].includes(t), UA: () => true };
const UNAME = { U3: 'TOP3', U5: 'TOP5', UA: '전체 테마' };
const RNAME = { L1: '신저가 비율 감소(기존 D)', L2: '신저가 5%p↑ 감소', L3: '오늘 신저가권 0', L4: '3일 연속 둔화', L5: '급증 멈춤(기존 F)', 'L1+P1': 'D ∩ 신고가 비율 유지', 'L1+P2': 'D ∩ 20일선 위 증가', 'L1+P3': 'D ∩ 하락장 아님' };
// 행: 우주(U)에 속한 날 · 그 우주의 기준 행 + 조건 행. 사건 = 같은 키 5거래일 안 재발생 제외
const rows = [], last = {};
const push = (k, t, i, V) => { const key = k + '|' + t; const ev = !(last[key] != null && i - last[key] <= 5); last[key] = i; if (ev) rows.push({ k, t, i, V }); };
for (let i = 0; i < T; i++) for (const t of themesAll[i]) { if (!TH[t] || TH[t].n[i] < 4) continue; const V = OUT(t, i); if (!V) continue;
  for (const [u, uf] of Object.entries(UNIV)) { if (!uf(t, i)) continue; push(u, t, i, V); for (const [r, rf] of Object.entries(RULES)) if (rf(t, i)) push(u + ':' + r, t, i, V); } }
const reach = (V, N) => V.slice(0, N).some(x => x >= 0.01 - 1e-12);
const st = R => { if (!R.length) return null; const w5 = R.filter(r => r.V[4] > 0.01).length, l5 = R.filter(r => r.V[4] < -0.01).length;
  const dd = R.map(r => { const k = r.V.findIndex(x => x >= 0.01 - 1e-12); return Math.min(0, ...r.V.slice(0, k < 0 ? 10 : k + 1)); }).sort((a, b) => a - b);
  return { n: R.length, dates: new Set(R.map(r => r.i)).size, themes: new Set(R.map(r => r.t)).size,
    h3: R.filter(r => reach(r.V, 3)).length / R.length, h5: R.filter(r => reach(r.V, 5)).length / R.length, h10: R.filter(r => reach(r.V, 10)).length / R.length,
    win5: w5 + l5 ? w5 / (w5 + l5) : null, wl5: [w5, l5], fin10: R.reduce((a, r) => a + r.V[9], 0) / R.length, dd: dd[dd.length >> 1] }; };
const boot = (S, C) => { const by = new Map(), add = (r, w) => { const o = by.get(r.i) || [0, 0, 0, 0], h = reach(r.V, 5) ? 1 : 0; if (w) { o[0] += h; o[1]++; } else { o[2] += h; o[3]++; } by.set(r.i, o); };
  S.forEach(r => add(r, 1)); C.forEach(r => add(r, 0)); const D = [...by.values()]; let s = 7; const rng = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648, out = [];
  for (let b = 0; b < 2000; b++) { const a = [0, 0, 0, 0]; for (let j = 0; j < D.length; j++) { const o = D[Math.floor(rng() * D.length)]; for (let q = 0; q < 4; q++) a[q] += o[q]; } if (a[1] && a[3]) out.push(a[0] / a[1] - a[2] / a[3]); }
  out.sort((p, q) => p - q); return out.length ? [out[Math.floor(out.length * 0.05)], out[Math.floor(out.length * 0.95)]] : [null, null]; };
const pc = v => v == null ? ' —' : String(Math.round(v * 100)).padStart(3) + '%', pp = v => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1);
const PARTS = [['앞(2017~)', r => r.i < SPLIT], ['뒤(최근 3년)', r => r.i >= SPLIT], ['전체', () => true]];
console.log('\n칸 = 사건 수(날) | 5일 안 +1% 도달 [3·10일] | +5일 종가 승률(승·패, ±1% 제외) | 10일 최종 | 도달 전 낙폭 중앙 | 같은 우주 나머지 대비 5일 도달 %p');
const verdict = [];
for (const u of Object.keys(UNIV)) {
  console.log(`\n■ 우주 ${UNAME[u]}`);
  const base = {}; for (const [pn, pf] of PARTS) base[pn] = rows.filter(r => r.k === u && pf(r));
  for (const [pn] of PARTS) { const z = st(base[pn]); console.log(`  [기준 ${UNAME[u]} 전부 · ${pn}] ${z.n}(${z.dates}) | ${pc(z.h5)} [${pc(z.h3)}·${pc(z.h10)}] | ${pc(z.win5)}(${z.wl5.join('·')}) | ${pp(z.fin10)} | ${pp(z.dd)}`); }
  for (const r of Object.keys(RULES)) {
    const key = u + ':' + r, res = {};
    for (const [pn, pf] of PARTS) { const S = rows.filter(x => x.k === key && pf(x)); const sk = new Set(S.map(x => x.t + '|' + x.i));
      const rest = base[pn].filter(x => !sk.has(x.t + '|' + x.i)); res[pn] = { z: st(S), zr: st(rest), S, rest }; }
    const A = res['앞(2017~)'], B = res['뒤(최근 3년)'], C = res['전체'];
    const ci = C.z ? boot(C.S, C.rest) : [null, null];
    const imp = o => o.z && o.zr ? o.z.h5 - o.zr.h5 : null;
    const zb = st(base['전체']);
    const pass = A.z && B.z && C.z.n >= 40 && A.z.n >= 15 && B.z.n >= 15 && imp(A) >= 0.05 && imp(B) >= 0.05 && ci[0] > 0 && C.z.fin10 >= zb.fin10;
    const warn = []; if (C.z && C.z.dd < zb.dd - 0.01) warn.push('낙폭 깊음'); if (C.z && C.z.fin10 < 0) warn.push('10일 최종 음수');
    const grade = !C.z ? '사건 0' : pass ? '통과' : C.z.n < 15 ? '표본 부족' : C.z.n < 40 || !A.z || !B.z || A.z.n < 15 || B.z.n < 15 ? '참고(표본)' : '미통과';
    verdict.push({ u, r, grade, n: C.z ? C.z.n : 0, h5: C.z ? C.z.h5 : null, win5: C.z ? C.z.win5 : null, impA: imp(A), impB: imp(B), ci, warn });
    const cell = o => o.z ? `${o.z.n}(${o.z.dates}) ${pc(o.z.h5)} 승률${pc(o.z.win5)}(${o.z.wl5.join('·')}) 10일${pp(o.z.fin10)} 낙폭${pp(o.z.dd)} 대비${pp(imp(o))}` : '사건 0';
    console.log(`  ${(r + ' ' + RNAME[r]).padEnd(30)} 앞 ${cell(A)}\n  ${''.padEnd(30)} 뒤 ${cell(B)}\n  ${''.padEnd(30)} 전체 ${cell(C)} · 90% 구간 [${pp(ci[0])}~${pp(ci[1])}] → ${grade}${warn.length ? ' ⚠ ' + warn.join('·') : ''}`);
  }
}
console.log(`\n■ 판정 요약(사전 등록 · ${verdict.length}개 조합 — 다중 비교: 아무 효과가 없어도 일부는 우연히 좋아 보인다)`);
verdict.sort((a, b) => (b.grade === '통과') - (a.grade === '통과') || (b.impA ?? -9) + (b.impB ?? -9) - (a.impA ?? -9) - (a.impB ?? -9));
for (const v of verdict) console.log(`  ${v.grade.padEnd(8)} ${(UNAME[v.u] + ' ∩ ' + RNAME[v.r]).padEnd(32)} 사건 ${String(v.n).padStart(4)} · 5일 도달 ${pc(v.h5)} · +5 승률 ${pc(v.win5)} · 나머지 대비 앞 ${pp(v.impA)} / 뒤 ${pp(v.impB)}%p · 구간 [${pp(v.ci[0])}~${pp(v.ci[1])}]${v.warn.length ? ' ⚠ ' + v.warn.join('·') : ''}`);
