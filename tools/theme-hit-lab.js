#!/usr/bin/env node
/**
 * 🔭 앞설 테마 TOP3 — 상승 도달률 개선 연구. docs/2026-11-12-theme-top3-hit.md 사전 등록 그대로.
 * 화면 함수 그대로(H.loadPage): themeStocks · themeDailyRows · themeMultiRank · histStocks · qqqBenchmarkStock. 순위 재구현 없음.
 * 사용: node tools/theme-hit-lab.js backtest/raw.json backtest/group-breadth.json [out.json]
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8');
let GB = null; try { GB = JSON.parse(fs.readFileSync(process.argv[3] || 'backtest/group-breadth.json', 'utf8')); } catch (e) { console.log('4그룹 자료 없음 — H·I 생략'); }
const outPath = process.argv[4] || '';
const page = H.loadPage();
page.runInPage(`this.__x = j => { state.data = normalize(JSON.parse(j));
  const daily = themeDailyRows(themeStocks(), 5), dates = daily.map(x => x.d);
  const A = daily.map(x => x.rows.length >= 5 ? themeMultiRank(x.rows).slice(0, 3).map(t => t.name) : []);
  const themesAll = daily.map(x => x.rows.map(t => t.name));
  const mem = {}; themeStocks().forEach(s => { if (s._benchmark || CONGRESS_TICKERS.has(s.ticker) || isKR(s.ticker) || LEVERAGED[s.ticker]) return;
    const c = s.category || '기타', hs = histStocks(s) || [], m = {}; hs.forEach(h => { m[String(h.last_date)] = [num(h.open), num(h.price), num(h.ma20), num(h.pct_from_high), num(h.pct_from_low)]; });
    (mem[c] = mem[c] || []).push({ t: s.ticker, m }); });
  const q = qqqBenchmarkStock(), qh = (q && histStocks(q)) || [], qm = {}; qh.forEach(h => { qm[String(h.last_date)] = num(h.price); });
  return JSON.stringify({ dates, A, themesAll, mem, qm }); };`);
const X = JSON.parse(page.__x(raw)); const { dates, A, themesAll, mem, qm } = X; const T = dates.length;
console.log(`기간 ${dates[0]}~${dates[T - 1]} · ${T}거래일 · 테마 ${Object.keys(mem).length}`);
// 시장 국면(QQQ 종가 vs 200일선 · 60일 수익)
const qp = dates.map(d => qm[d] ?? null), RG = dates.map((d, i) => { if (i < 200 || qp[i] == null || qp[i - 60] == null) return null;
  const w = qp.slice(i - 199, i + 1).filter(x => x != null); if (w.length < 180) return null; const ma = w.reduce((a, b) => a + b, 0) / w.length, r60 = qp[i] / qp[i - 60] - 1;
  return qp[i] > ma && r60 > 0 ? '상승' : qp[i] < ma && r60 < 0 ? '하락' : '횡보'; });
// 테마 지표(그날까지)
const TH = {};
for (const [c, ms] of Object.entries(mem)) {
  const hr = [], lr = [], ab = [], n = [], nhSet = [];
  dates.forEach((d, i) => { let k = 0, h = 0, l = 0, a = 0; const s = new Set();
    ms.forEach(x => { const r = x.m[d]; if (!r || r[1] == null || r[2] == null || r[3] == null || r[4] == null) return; k++; if (r[3] >= -1) { h++; s.add(x.t); } if (r[4] <= 1) l++; if (r[1] > r[2]) a++; });
    n.push(k); hr.push(k >= 4 ? h / k : null); lr.push(k >= 4 ? l / k : null); ab.push(k >= 4 ? a / k : null); nhSet.push(s); });
  const m5 = a => a.map((_, i) => { if (i < 4) return null; const w = a.slice(i - 4, i + 1); return w.some(x => x == null) ? null : w.reduce((p, q) => p + q, 0) / 5; });
  const hr5 = m5(hr), lr5 = m5(lr), net5 = hr5.map((x, i) => x == null || lr5[i] == null ? null : x - lr5[i]);
  const d5 = a => a.map((x, i) => i < 5 || x == null || a[i - 5] == null ? null : x - a[i - 5]);
  const nh5 = dates.map((_, i) => { if (i < 4) return 0; const u = new Set(); for (let j = i - 4; j <= i; j++) nhSet[j].forEach(t => u.add(t)); return u.size; });
  const lrMax10 = lr5.map((_, i) => { const w = lr5.slice(Math.max(0, i - 10), i).filter(x => x != null); return w.length ? Math.max(...w) : null; });
  TH[c] = { n, hr5, lr5, net5, ab, dHr: d5(hr5), dLr: d5(lr5), dNet: d5(net5), dAb: d5(ab), nh5, lrMax10 };
}
// 4그룹
const ALLUP = new Set((GB && GB.state_series && GB.state_series.ALL_UP) || []);
const NDXD = {}; if (GB && GB.groups && GB.groups.NDX) { const g = GB.groups.NDX, net = GB.dates.map((d, i) => g.n[i] ? (g.nh[i] - g.nl[i]) / g.n[i] : null);
  const n5 = net.map((_, i) => { if (i < 4) return null; const w = net.slice(i - 4, i + 1); return w.some(x => x == null) ? null : w.reduce((a, b) => a + b, 0) / 5; });
  GB.dates.forEach((d, i) => { if (i >= 5 && n5[i] != null && n5[i - 5] != null) NDXD[d] = n5[i] - n5[i - 5]; }); }
const gbStart = GB && GB.dates ? GB.dates[0] : null, ssStart = GB && GB.state_series && GB.state_series.ALL_UP ? GB.state_series.ALL_UP[0] : null;
// 결과 경로
const OUT = (c, i) => { const ms = mem[c]; if (i + 10 >= T) return null; const d1 = dates[i + 1]; const pick = ms.filter(x => x.m[d1] && x.m[d1][0] != null && x.m[d1][0] > 0);
  if (pick.length < 4) return null; const V = [];
  for (let k = 1; k <= 10; k++) { const d = dates[i + k]; let s = 0; for (const x of pick) { const r = x.m[d]; if (!r || r[1] == null) return null; s += r[1] / x.m[d1][0]; } V.push(s / pick.length - 1); }
  return V; };
const TH_X = [0, 0.01, 0.02, 0.03], HZ = [3, 5, 7, 10];
const cond = {
  A: () => true,
  B: (t, i) => TH[t].dHr[i] != null && TH[t].dHr[i] > 0,
  C: (t, i) => TH[t].dNet[i] != null && TH[t].dNet[i] >= 0.05,
  D: (t, i) => TH[t].lr5[i - 5] != null && TH[t].lr5[i - 5] > 0 && TH[t].dLr[i] != null && TH[t].dLr[i] < 0,
  E: (t, i) => TH[t].dHr[i] != null && TH[t].dHr[i] >= 0.05 && TH[t].nh5[i] >= 2 && TH[t].lr5[i] != null && TH[t].lr5[i - 5] != null && TH[t].lr5[i] <= TH[t].lr5[i - 5],
  F: (t, i) => TH[t].lrMax10[i] != null && TH[t].lrMax10[i] >= 0.10 && TH[t].lr5[i] != null && TH[t].lr5[i] <= TH[t].lrMax10[i] - 0.05,
  G: (t, i) => cond.E(t, i) && TH[t].dAb[i] != null && TH[t].dAb[i] > 0,
  H: (t, i) => ssStart != null && dates[i] >= ssStart && ALLUP.has(dates[i]),
  I: (t, i) => NDXD[dates[i]] != null && NDXD[dates[i]] > 0,
};
const NAMES = { A: '기존 TOP3', B: 'A ∩ 신고가 참여율 증가', C: 'A ∩ 순신고가 5일 개선(+5%p)', D: 'A ∩ 신저가 비율 감소', E: 'A ∩ 신고가 확산', F: 'A ∩ 신저가 급증 멈춤', G: 'A ∩ 신고가 확산 ∩ 20일선 위 증가', H: 'A ∩ 4그룹 전 그룹 확산', I: 'A ∩ 나스닥100 순신고가 개선', ALL: '모든 테마(평소)' };
const EXPL = Math.max(0, T - 756);   // 탐색 = 최근 756거래일 · 독립 = 그 이전
// 행 모으기: {set, t, i, ev(사건), V, rg}
const rows = []; let lack = 0;
const lastIn = {};
for (let i = 0; i < T; i++) {
  for (const t of themesAll[i]) { if (!TH[t]) continue; if (TH[t].n[i] < 4) { lack++; continue; }
    const V = OUT(t, i); if (!V) continue;
    const inA = A[i].includes(t), sets = ['ALL'].concat(inA ? Object.keys(cond).filter(k => cond[k](t, i)) : []);
    for (const k of sets) { const key = k + '|' + t; const ev = !(lastIn[key] != null && i - lastIn[key] <= 5); lastIn[key] = i; rows.push({ k, t, i, ev, V, rg: RG[i] }); }
  }
}
const hitDay = (V, x, N) => { for (let k = 0; k < N; k++) if (x === 0 ? V[k] > 0 : V[k] >= x - 1e-12) return k + 1; return null; };
const stat = R => { if (!R.length) return null; const z = { n: R.length, dates: new Set(R.map(r => r.i)).size, themes: new Set(R.map(r => r.t)).size };
  for (const N of HZ) for (const x of TH_X) { const h = R.filter(r => hitDay(r.V, x, N)).length; z[`h${N}_${x * 100}`] = h / R.length; if (x === 0.01) { z[`w${N}`] = h; z[`l${N}`] = R.length - h; } }
  const dd = R.map(r => { const k = hitDay(r.V, 0.01, 10); const w = r.V.slice(0, k || 10); return Math.min(0, ...w); }).sort((a, b) => a - b);
  const td = R.map(r => hitDay(r.V, 0.01, 10)).filter(Boolean).sort((a, b) => a - b);
  z.dd_med = dd[dd.length >> 1]; z.dd_mean = dd.reduce((a, b) => a + b, 0) / dd.length; z.days_med = td.length ? td[td.length >> 1] : null;
  z.mfe = R.reduce((a, r) => a + Math.max(...r.V), 0) / R.length; z.fin10 = R.reduce((a, r) => a + r.V[9], 0) / R.length; return z; };
const boot = (S, C) => { if (!S.length || !C.length) return [null, null]; const by = new Map(); const add = (r, w) => { const o = by.get(r.i) || [0, 0, 0, 0]; const h = hitDay(r.V, 0.01, 5) ? 1 : 0; if (w) { o[0] += h; o[1]++; } else { o[2] += h; o[3]++; } by.set(r.i, o); };
  S.forEach(r => add(r, 1)); C.forEach(r => add(r, 0)); const D = [...by.values()], rng = (() => { let s = 7; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; })(), out = [];
  for (let b = 0; b < 2000; b++) { let a = [0, 0, 0, 0]; for (let j = 0; j < D.length; j++) { const o = D[Math.floor(rng() * D.length)]; a[0] += o[0]; a[1] += o[1]; a[2] += o[2]; a[3] += o[3]; } if (a[1] && a[3]) out.push(a[0] / a[1] - a[2] / a[3]); }
  out.sort((p, q) => p - q); return [out[Math.floor(out.length * 0.05)], out[Math.floor(out.length * 0.95)]]; };
const res = { period: [dates[0], dates[T - 1]], explore_from: dates[EXPL], lack_rows: lack, names: NAMES, parts: {} };
const pc = v => v == null ? '—' : (v * 100).toFixed(0), pp = v => v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1);
for (const [pn, pf] of [['독립(이전)', r => r.i < EXPL], ['탐색(최근 3년)', r => r.i >= EXPL]]) {
  const P = res.parts[pn] = {}; console.log(`\n■ ${pn} — 사건 기준(같은 테마 5거래일 안 재발생 제외) · +1% 도달률 3·5·7·10일 · [+0/+2/+3% 5일] · 낙폭 중앙 · 도달일 · 최고 · 10일 최종`);
  const evOf = k => rows.filter(r => r.k === k && (r.ev || k === 'ALL') && pf(r)), allOf = k => rows.filter(r => r.k === k && pf(r));   // ALL(평소)은 모든 테마·날
  const Aev = evOf('A'), ALLev = evOf('ALL'), zA = stat(Aev), zAll = stat(ALLev);
  for (const k of ['ALL', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) {
    const S = evOf(k), z = stat(S), zd = stat(allOf(k)); if (!z) { console.log(`  ${k} 사건 0`); P[k] = null; continue; }
    const rest = k === 'A' || k === 'ALL' ? null : Aev.filter(a => !S.some(s => s.t === a.t && s.i === a.i));
    const zr = rest ? stat(rest) : null, ci = rest ? boot(S, rest) : null, ciAll = boot(S, ALLev);
    const reg = {}; for (const g of ['상승', '횡보', '하락']) { const R = S.filter(r => r.rg === g); reg[g] = R.length ? [R.filter(r => hitDay(r.V, 0.01, 5)).length, R.length] : null; }
    const warn = []; if (zA && z.dd_med < zA.dd_med - 0.01) warn.push('낙폭 깊음'); if (z.fin10 < 0) warn.push('10일 최종 음수');
    P[k] = { ev: z, days: zd, rest: zr, ci_rest: ci, ci_all: ciAll, regime: reg, warn };
    const imp = zr ? z.h5_1 - zr.h5_1 : null;
    console.log(`  ${k.padEnd(3)} ${NAMES[k].slice(0, 26).padEnd(26)} 사건 ${String(z.n).padStart(4)}(${z.dates}일·${z.themes}테마) | ${pc(z.h3_1)}·${pc(z.h5_1)}·${pc(z.h7_1)}·${pc(z.h10_1)}% [${pc(z.h5_0)}/${pc(z.h5_2)}/${pc(z.h5_3)}] (5일 ${z.w5}승 ${z.l5}패) | 낙폭 ${pp(z.dd_med)} · ${z.days_med ?? '—'}일 · 최고 ${pp(z.mfe)} · 10일 ${pp(z.fin10)}`
      + (zr ? ` | A∖X 대비 ${pp(imp)}p [${pp(ci[0])}~${pp(ci[1])}]` : '') + (k !== 'ALL' && zAll ? ` · 평소 대비 ${pp(z.h5_1 - zAll.h5_1)}p` : '') + ` | 국면 ${Object.entries(reg).map(([g, v]) => v ? `${g} ${Math.round(v[0] / v[1] * 100)}%(${v[1]})` : '').filter(Boolean).join(' ')}` + (warn.length ? ` ⚠ ${warn.join('·')}` : ''));
  }
}
// 판정(사전 등록 §5)
res.verdict = {}; const Ii = res.parts['독립(이전)'], Ee = res.parts['탐색(최근 3년)'];
for (const k of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) { const a = Ii[k], b = Ee[k], A0 = Ii.A, AL = Ii.ALL;
  if (!a) { res.verdict[k] = '자료 없음(독립 기간)'; continue; } const z = a.ev;
  if (z.n < 15) { res.verdict[k] = '표본 부족'; continue; }
  const dir = N => a.rest && z[`h${N}_1`] - a.rest.ev?.[`h${N}_1`] ;
  const up = N => a.rest ? z[`h${N}_1`] - a.rest[`h${N}_1`] : null;
  const ok = z.n >= 30 && z.dates >= 20 && up(5) >= 0.05 && a.ci_rest[0] > 0 && AL && z.h5_1 - AL.ev.h5_1 >= 0.05 && [3, 7, 10].every(N => up(N) > 0)
    && b && b.rest && b.ev.h5_1 - b.rest.h5_1 > 0 && A0 && z.fin10 >= A0.ev.fin10;
  res.verdict[k] = ok ? '개선 통과' : z.n < 30 ? '참고(15~29건)' : '미통과'; }
console.log('\n■ 판정(독립 기간 기준 · 사전 등록 §5):', JSON.stringify(res.verdict));
if (outPath) { fs.writeFileSync(outPath, JSON.stringify(res)); console.log('→ ' + outPath); }
