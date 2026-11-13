#!/usr/bin/env node
/**
 * 일부익절 신호 × 고점판독 기술지표 — 3·5·10거래일 OR 하락 (사전 등록 docs/2026-11-13-trim-or-combo.md · 보고 전용)
 * 성공 = D+3·D+5·D+10 종가 중 하나라도 신호일 종가보다 1% 초과 하락. 일부익절 출처는 trim-lab.js와 같은 화면 함수 추출(재구현 없음).
 * 종목 이름순 번갈아 A(탐색)·B(미사용). 같은 종목·조합 5거래일 안 재발생 제외.
 * 사용: node tools/trim-combo-lab.js backtest/raw.json [backtest/trim-or-combo.json]
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8'), outPath = process.argv[3] || '';
const page = H.loadPage();
page.runInPage(`this.__run = j => { const RAW = JSON.parse(j); state.data = normalize(RAW); const out = [];
  allStocks().forEach(s => { const hs = histStocks(s); if (!hs) return; const ew = earningsWindowsForValidation(s, hs);
    hs.forEach((h, i) => { if (!h.last_date || !has(h.price) || ew.blocked.has(h.last_date)) return;
      const row = Object.assign({}, s, h); if (i > 0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null; row.sig = evaluate(row); row.earnings_hold = false; row.ext_pair = null;
      const src = [];
      (row.sig.tags || []).forEach(t => { if (/분할익절/.test(t.t || "")) src.push("TAG_SPLIT"); else if (/익절/.test(t.t || "")) src.push("TAG_CAUTION"); });
      try { patternBadges(row).forEach(b => { if (b.key === "🟡 일부 익절 후보") src.push("PAT_TRIM"); }); } catch(e){}
      try { sbItemsFor(row, {main:true}).forEach(x => { if (x.kind === "orange") src.push("OR_" + x.code); }); } catch(e){}
      const f = n => hs[i+n] && has(hs[i+n].price) ? (hs[i+n].price / row.price - 1) * 100 : null;
      const p = i > 0 ? hs[i-1] : null;
      const T = {
        R70: has(h.rsi) && h.rsi >= 70, R75: has(h.rsi) && h.rsi >= 75, R80: has(h.rsi) && h.rsi >= 80,
        B90: has(h.bb_pos) && h.bb_pos >= 90, B100: has(h.bb_pos) && h.bb_pos > 100, BRE: !!p && has(p.bb_pos) && p.bb_pos > 100 && has(h.bb_pos) && h.bb_pos <= 100,
        S80: has(h.stoch_k) && h.stoch_k >= 80, SDX: h.stoch_cross === "dead" && has(h.stoch_k) && h.stoch_k >= 70,
        MDEAD: h.macd_cross === "dead", MFADE: !!p && has(h.macd) && has(p.macd) && h.macd > 0 && h.macd < p.macd,
        H5: has(h.pct_from_high) && h.pct_from_high >= -5, H2: has(h.pct_from_high) && h.pct_from_high >= -2,
        MA5: has(h.ma5) && h.price < h.ma5, MA20X: !!p && has(h.ma20) && has(p.ma20) && has(p.price) && h.price < h.ma20 && p.price >= p.ma20,
        UPW: (() => { const F = histFields(), x = (s._hist || [])[i]; const u = Array.isArray(x) ? num(x[F.indexOf("upw")]) : null; return has(u) && u >= 0.5; })(),
        V15: has(h.vol_ratio) && h.vol_ratio >= 1.5, V2: has(h.vol_ratio) && h.vol_ratio >= 2, VDRY: has(h.vol_ratio) && h.vol_ratio < 0.7,
        RUN8: has(h.run3_sum) && h.run3_sum >= 8, EXT15: has(h.ma20) && h.ma20 > 0 && h.price / h.ma20 - 1 >= 0.15 };
      out.push({ t: s.ticker, d: h.last_date, i, src: [...new Set(src)], tech: Object.keys(T).filter(k => T[k]), f3: f(3), f5: f(5), f10: f(10) }); }); });
  return out; };`);
const R = page.__run(raw).filter(r => r.f3 != null && r.f5 != null && r.f10 != null);
const tick = [...new Set(R.map(r => r.t))].sort(), SET = Object.fromEntries(tick.map((t, k) => [t, k % 2 ? 'B' : 'A']));
const days = [...new Set(R.map(r => r.d))].sort(), MID = days[Math.floor(days.length / 2)];
const hit = r => r.f3 < -1 || r.f5 < -1 || r.f10 < -1;
const TECH = ['R70', 'R75', 'R80', 'B90', 'B100', 'BRE', 'S80', 'SDX', 'MDEAD', 'MFADE', 'H5', 'H2', 'MA5', 'MA20X', 'UPW', 'V15', 'V2', 'VDRY', 'RUN8', 'EXT15'];
const NM = { R70: 'RSI≥70', R75: 'RSI≥75', R80: 'RSI≥80', B90: '%B≥90', B100: '볼밴 상단 밖', BRE: '볼밴 상단 재진입', S80: '스토캐스틱≥80', SDX: '스토캐스틱 고점 데드',
  MDEAD: 'MACD 데드', MFADE: 'MACD 약화', H5: '52주 고가 5% 안', H2: '52주 고가 2% 안', MA5: '5일선 아래', MA20X: '20일선 첫 이탈', UPW: '윗꼬리 50%↑',
  V15: '거래량 1.5배↑', V2: '거래량 2배↑', VDRY: '거래량 0.7배↓', RUN8: '3일 +8%↑', EXT15: '20일선 이격 15%↑',
  ANY: '일부익절 아무거나', TAG_SPLIT: '🔥 과열 분할익절', TAG_CAUTION: '⚠ 과열 익절 주의', PAT_TRIM: '🟡 캔들 일부익절' };
const ANCH = ['ANY', 'TAG_SPLIT', 'TAG_CAUTION', 'PAT_TRIM', ...[...new Set(R.flatMap(r => r.src.filter(s => s.startsWith('OR_'))))].sort()];
const has = (r, a) => a === 'ANY' ? r.src.length > 0 : r.src.includes(a);
function events(pred){ const last = {}, out = []; for (const r of R) { if (!pred(r)) continue; if (last[r.t] != null && r.i - last[r.t] < 5) continue; last[r.t] = r.i; out.push(r); } return out; }
function stat(E){ const n = E.length, h = E.filter(hit).length, dates = new Set(E.map(r => r.d)).size, tk = {};
  E.forEach(r => tk[r.t] = (tk[r.t] || 0) + 1); const mx = n ? Math.max(...Object.values(tk)) / n : 0;
  const avg = k => n ? E.reduce((a, r) => a + r['f' + k], 0) / n : null, dn = k => n ? E.filter(r => r['f' + k] < -1).length / n : null;
  return { n, hit: h, miss: n - h, or: n ? h / n : null, dates, tickers: Object.keys(tk).length, maxTk: mx, dn3: dn(3), dn5: dn(5), dn10: dn(10), a3: avg(3), a5: avg(5), a10: avg(10) }; }
const lgam = x => { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5; t -= (x + .5) * Math.log(t); let s = 1.000000000190015; for (const q of c) s += q / ++y; return -t + Math.log(2.5066282746310005 * s / x); };
const tailGT = (n, p, thr) => { let s = 0; for (let k = Math.floor(n * thr) + 1; k <= n; k++) s += Math.exp(lgam(n + 1) - lgam(k + 1) - lgam(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p)); return s; };
const all = events(() => true), baseA = stat(all.filter(r => SET[r.t] === 'A')), baseB = stat(all.filter(r => SET[r.t] === 'B')), base = stat(all);
const baseH = [stat(all.filter(r => r.d < MID)), stat(all.filter(r => r.d >= MID))];
const pc = x => x == null ? '—' : (x * 100).toFixed(0) + '%';
console.log(`${days[0]}~${days[days.length - 1]} · 종목·날 ${R.length} · 종목 A ${tick.filter(t => SET[t] === 'A').length} / B ${tick.filter(t => SET[t] === 'B').length} · 앞/뒤 경계 ${MID}`);
console.log(`평소 OR(아무 날) 전체 ${pc(base.or)} · A ${pc(baseA.or)} · B ${pc(baseB.or)} · 앞 ${pc(baseH[0].or)} · 뒤 ${pc(baseH[1].or)} | 개별 3·5·10일 하락 ${pc(base.dn3)}·${pc(base.dn5)}·${pc(base.dn10)}`);
const res = { generated: new Date().toISOString().slice(0, 10), kind: 'research', doc: 'docs/2026-11-13-trim-or-combo.md', period: [days[0], days[days.length - 1]], split: MID,
  base: { all: base, A: baseA, B: baseB, halves: baseH }, anchors: {}, cands: [], summary: {} };
let combos = 0, tested = 0, gt = 0, chance = 0, rep = 0, repChance = 0, passed = 0;
for (const a of ANCH) {
  const aE = events(r => has(r, a)); const aA = stat(aE.filter(r => SET[r.t] === 'A')), aB = stat(aE.filter(r => SET[r.t] === 'B'));
  res.anchors[a] = { all: stat(aE), A: aA, B: aB };
  const subsets = [[]]; TECH.forEach((x, i) => { subsets.push([x]); TECH.slice(i + 1).forEach(y => subsets.push([x, y])); });
  for (const sub of subsets) {
    combos++;
    const E = events(r => has(r, a) && sub.every(k => r.tech.includes(k)));
    const A = stat(E.filter(r => SET[r.t] === 'A')), B = stat(E.filter(r => SET[r.t] === 'B'));
    if (A.dates >= 6) { tested++; chance += tailGT(A.n, baseA.or, 0.65); }
    if (!(A.dates >= 6 && A.or > 0.65)) continue;
    gt++;
    const hs = [stat(E.filter(r => r.d < MID)), stat(E.filter(r => r.d >= MID))];
    const replicated = B.dates >= 6 && B.or > 0.65; if (B.dates >= 6) repChance += tailGT(B.n, baseB.or, 0.65); if (replicated) rep++;
    const formal = B.dates >= 30 && B.or >= 0.65 && B.or - baseB.or >= 0.10 && hs[0].or > baseH[0].or && hs[1].or > baseH[1].or && B.maxTk <= 0.25;
    if (formal) passed++;
    res.cands.push({ anchor: a, tech: sub, name: [NM[a] || a.replace('OR_', '오렌지 '), ...sub.map(k => NM[k])].join(' ∩ '), A, B, all: stat(E), halves: hs,
      vsBase: { A: A.or - baseA.or, B: B.dates ? B.or - baseB.or : null }, vsAnchor: { A: A.or - aA.or, B: B.dates && aB.n ? B.or - aB.or : null },
      replicated, formal, tier: A.dates >= 30 ? '검토 가능' : '소표본 연구 후보' });
  }
}
res.cands.sort((x, y) => y.A.or - x.A.or || y.A.dates - x.A.dates);
res.summary = { combos, tested, gt65: gt, chance: Math.round(chance * 10) / 10, replicated: rep, rep_chance: Math.round(repChance * 10) / 10, passed };
console.log(`조합 ${combos} · A 독립일 6↑ ${tested} · A 65% 초과 ${gt} (우연 기대 ${res.summary.chance}) · B 재현 ${rep} (우연 기대 ${res.summary.rep_chance}) · 정식 통과 ${passed}`);
console.log('\n앵커 단독(OR): ' + ANCH.map(a => `${NM[a] || a} A ${pc(res.anchors[a].A.or)}(${res.anchors[a].A.dates}일) B ${pc(res.anchors[a].B.or)}(${res.anchors[a].B.dates}일)`).join(' · '));
console.log('\n■ A 65% 초과 후보(승률순) — 탐색 A | 미사용 B | 평소 대비 | 3·5·10일 개별 | 평균 3·5·10일 | 앞/뒤 반');
for (const c of res.cands.slice(0, 80)) {
  console.log(`${c.replicated ? '✓' : ' '}${c.formal ? '★' : ' '} ${c.name.slice(0, 54).padEnd(54)} | A ${pc(c.A.or)} ${c.A.hit}/${c.A.n} ${c.A.dates}일 | B ${pc(c.B.or)} ${c.B.hit}/${c.B.n} ${c.B.dates}일 | ` +
    `+${((c.vsBase.A || 0) * 100).toFixed(0)}/${c.vsBase.B == null ? '—' : ((c.vsBase.B) * 100).toFixed(0)}%p | ${pc(c.all.dn3)}·${pc(c.all.dn5)}·${pc(c.all.dn10)} | ` +
    `${c.all.a3.toFixed(1)}·${c.all.a5.toFixed(1)}·${c.all.a10.toFixed(1)}% | ${pc(c.halves[0].or)}(${c.halves[0].n})/${pc(c.halves[1].or)}(${c.halves[1].n})`);
}
if (outPath) fs.writeFileSync(outPath, JSON.stringify(res));
