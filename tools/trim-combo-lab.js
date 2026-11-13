#!/usr/bin/env node
/**
 * 일부익절 신호 × 고점판독 기술지표 — 3·5·10거래일 OR 하락 (사전 등록 docs/2026-11-13-trim-or-combo.md · 보고 전용)
 * 성공 = D+3·D+5·D+10 종가 중 하나라도 신호일 종가보다 1% 초과 하락. 일부익절 출처는 trim-lab.js와 같은 화면 함수 추출(재구현 없음).
 * 종목 이름순 번갈아 A(탐색)·B(미사용). 같은 종목·조합 5거래일 안 재발생 제외.
 * 사용: node tools/trim-combo-lab.js backtest/raw.json [backtest/trim-or-combo.json]
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8'), outPath = (process.argv[3] && !process.argv[3].startsWith('--')) ? process.argv[3] : '';
const VERIFY = process.argv.includes('--verify');
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
      out.push({ t: s.ticker, d: h.last_date, i, ph: h.market_level || row.market_level || '', src: [...new Set(src)], tech: Object.keys(T).filter(k => T[k]), f3: f(3), f5: f(5), f10: f(10) }); }); });
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
function events(pred, gap = 5){ const last = {}, out = []; for (const r of R) { if (!pred(r)) continue; if (last[r.t] != null && r.i - last[r.t] < gap) continue; last[r.t] = r.i; out.push(r); } return out; }
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
if (VERIFY) verify();

/* ── 추가 검증(사전 등록 보충 6926742 · 별도 실행 · 기존 기준 유지) ── */
function verify(){
  const P = x => x == null ? '—' : (x * 100).toFixed(0) + '%', PP = x => x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(0) + '%p';
  const orOf = E => E.length ? E.filter(hit).length / E.length : null;
  const wilson = (k, n) => { if (!n) return [null, null]; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; };
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const boot = (E, key) => { const g = {}; E.forEach(r => (g[key(r)] = g[key(r)] || []).push(r)); const G = Object.values(g); if (G.length < 3) return [null, null]; const v = [];
    for (let b = 0; b < 500; b++) { let h = 0, n = 0; for (let j = 0; j < G.length; j++) { const x = G[Math.floor(rnd() * G.length)]; n += x.length; h += x.filter(hit).length; } v.push(h / n); }
    v.sort((a, b) => a - b); return [v[12], v[487]]; };
  const months = new Set(R.map(r => r.d.slice(0, 7))).size;
  const regime = r => r.ph === 'strong' ? '상승' : r.ph === 'weak' ? '하락' : (r.ph === 'neutral' || r.ph === 'caution') ? '횡보' : '기타';
  const allE = events(() => true), anyE = events(r => r.src.length > 0);
  console.log('\n\n■■ 추가 검증 — 기준선(같은 3년 · 같은 판정 · 같은 종목 5거래일 안 중복 제거)');
  console.log(`  ① 전체 종목·전체 날 OR ${P(orOf(allE))} (${allE.length}건) · A ${P(orOf(allE.filter(r => SET[r.t] === 'A')))} · B ${P(orOf(allE.filter(r => SET[r.t] === 'B')))}`);
  console.log(`  ② 일부익절 아무거나 OR ${P(orOf(anyE))} (${anyE.length}건) · A ${P(orOf(anyE.filter(r => SET[r.t] === 'A')))} · B ${P(orOf(anyE.filter(r => SET[r.t] === 'B')))}`);
  console.log('  ③ 출처별 OR: ' + ANCH.map(a => { const E = events(r => has(r, a)); return `${NM[a] || a} ${P(orOf(E))}(${E.length})`; }).join(' · '));
  console.log('  ⑤ 국면별 OR(전체 / 일부익절): ' + ['상승', '횡보', '하락'].map(g => `${g} ${P(orOf(allE.filter(r => regime(r) === g)))}(${allE.filter(r => regime(r) === g).length}) / ${P(orOf(anyE.filter(r => regime(r) === g)))}(${anyE.filter(r => regime(r) === g).length})`).join(' · '));
  console.log(`  개별 하락률(전체) 3·5·10일 ${P(allE.filter(r => r.f3 < -1).length / allE.length)}·${P(allE.filter(r => r.f5 < -1).length / allE.length)}·${P(allE.filter(r => r.f10 < -1).length / allE.length)}`);
  const L = [];
  for (const a of ANCH) {
    const aE = events(r => has(r, a)), aA = aE.filter(r => SET[r.t] === 'A'), aB = aE.filter(r => SET[r.t] === 'B');
    const subsets = [[]]; TECH.forEach((x, i) => { subsets.push([x]); TECH.slice(i + 1).forEach(y => subsets.push([x, y])); });
    for (const sub of subsets) {
      if (!sub.length) continue;
      const pred = r => has(r, a) && sub.every(k => r.tech.includes(k)); const E = events(pred);
      const A = E.filter(r => SET[r.t] === 'A'), B = E.filter(r => SET[r.t] === 'B'), dA = new Set(A.map(r => r.d)).size, dB = new Set(B.map(r => r.d)).size;
      const orA = orOf(A); if (!(dA >= 6 && orA >= 0.65)) continue;
      const orB = orOf(B), baseA = orOf(allE.filter(r => SET[r.t] === 'A')), baseB = orOf(allE.filter(r => SET[r.t] === 'B'));
      const ancA = orOf(aA), ancB = orOf(aB), tk = {}, mo = {};
      E.forEach(r => { tk[r.t] = (tk[r.t] || 0) + 1; mo[r.d.slice(0, 7)] = (mo[r.d.slice(0, 7)] || 0) + 1; });
      const mt = Object.entries(tk).sort((x, y) => y[1] - x[1])[0], mm = Object.entries(mo).sort((x, y) => y[1] - x[1])[0];
      let ov = 0; const byT = {}; E.forEach(r => (byT[r.t] = byT[r.t] || []).push(r.i)); Object.values(byT).forEach(xs => xs.forEach((x, j) => { if (j && x - xs[j - 1] < 10) ov++; }));
      const E10 = events(pred, 10), sAll = E.map(r => r.f10).sort((x, y) => x - y), ups = E.filter(r => r.f10 > 0);
      const filt = aE.filter(r => !sub.every(k => r.tech.includes(k)));
      const crit = { b65: dB >= 6 && orB >= 0.65, sim: dB >= 6 && Math.abs(orA - orB) <= 0.10, overBase: dB >= 6 && orB > baseB, overAnc: dB >= 6 && orB > ancB };
      const conc = (mt[1] / E.length > 0.25 ? '종목 집중 ' + mt[0] : '') + (mm[1] / E.length > 0.30 ? ' 시기 집중 ' + mm[0] : '');
      const freq = E.length / months, prereg = orA > 0.65;
      let verdict = '탈락';
      if (crit.overBase && crit.overAnc) verdict = (dB >= 30 && orB - ancB >= 0.10 && !conc && freq >= 0.5) ? '강력 추천' : '추가 검증';
      else if (crit.overBase || crit.b65) verdict = '보류';
      const sig = E.map(r => r.t + r.i).join(',');
      L.push({ sig, a, sub, name: [NM[a] || a.replace('OR_', '오렌지 '), ...sub.map(k => NM[k])].join(' ∩ '), n: E.length, hit: E.filter(hit).length, orAll: orOf(E), orA, orB, nA: A.length, nB: B.length, dA, dB,
        baseA, baseB, ancA, ancB, impBaseA: orA - baseA, impAncA: orA - ancA, impBaseB: orB == null ? null : orB - baseB, impAncB: orB == null ? null : orB - ancB,
        wil: wilson(E.filter(hit).length, E.length), bootT: boot(E, r => r.t), bootM: boot(E, r => r.d.slice(0, 7)), maxT: mt, maxM: mm, ov: ov / E.length, or10: orOf(E10), n10: E10.length,
        freq, med10: sAll[Math.floor(sAll.length / 2)], a3: E.reduce((s, r) => s + r.f3, 0) / E.length, a5: E.reduce((s, r) => s + r.f5, 0) / E.length, a10: E.reduce((s, r) => s + r.f10, 0) / E.length,
        dn3: E.filter(r => r.f3 < -1).length / E.length, dn5: E.filter(r => r.f5 < -1).length / E.length, dn10: E.filter(r => r.f10 < -1).length / E.length,
        upAvg: ups.length ? ups.reduce((s, r) => s + r.f10, 0) / ups.length : null, nUp: ups.length, filtOr: orOf(filt), nFilt: filt.length, crit, conc, verdict, prereg,
        years: Object.entries(E.reduce((m, r) => (m[r.d.slice(0, 4)] = (m[r.d.slice(0, 4)] || 0) + 1, m), {})).map(x => x.join(':')).join(' ') });
    }
  }
  // 같은 사건 집합인 조합은 하나로(조건이 적은 것 · 이름 있는 출처 우선) — 'RSI≥70 ∩ RSI≥75' = 'RSI≥75' 같은 중복
  const bySig = {}; L.forEach(x => { const b = bySig[x.sig]; const better = !b || x.sub.length < b.sub.length || (x.sub.length === b.sub.length && b.a === 'ANY' && x.a !== 'ANY'); if (better) bySig[x.sig] = x; });
  const nDup = L.length; L.splice(0, L.length, ...Object.values(bySig));
  console.log(`  같은 사건 집합 중복 제거: ${nDup} → ${L.length}개`);
  // 10거래일 안 중복 민감도(사전 등록 보충): 5일 간격 vs 10일 간격 OR 차이 분포
  const sens = L.map(x => x.or10 - x.orAll).filter(x => !isNaN(x)).sort((a, b) => a - b);
  if (sens.length) console.log(`  10일 간격 제한 시 OR 변화: 중앙 ${PP(sens[Math.floor(sens.length / 2)])} · 하위 10% ${PP(sens[Math.floor(sens.length * 0.1)])} · 상위 10% ${PP(sens[Math.floor(sens.length * 0.9)])}`);
  const eq65 = L.filter(x => Math.abs(x.orA - 0.65) < 1e-9).length;
  console.log(`\n  A OR ≥ 65% 조합 ${L.length} (사전 등록 '> 65%' 후보 ${L.filter(x => x.prereg).length} · 정확히 65.0% ${eq65}) · 비교 대상 전체 조합 ${combos}개 — 다중 검정 위험: 우연 기대 ${res.summary.chance}개(> 65% 기준)`);
  const row = x => `${x.name.slice(0, 46).padEnd(46)} | 전체 ${P(x.orAll)} ${x.hit}/${x.n} | A ${P(x.orA)}(${x.nA}) B ${P(x.orB)}(${x.nB}) | 기준선 대비 A ${PP(x.impBaseA)} B ${PP(x.impBaseB)} | 앵커 대비 A ${PP(x.impAncA)} B ${PP(x.impAncB)}`;
  console.log('\n■ 표 A — A OR ≥ 65% 전체(A 승률순 상위 60 · 전체 수는 위) ' + (L.length > 60 ? '' : ''));
  L.sort((x, y) => y.orA - x.orA || y.n - x.n).slice(0, 60).forEach(x => console.log((x.prereg ? '  ' : '= ') + row(x)));
  console.log('\n■ 표 B — 일부익절 단독(같은 A 집합) 대비 개선 순 상위 30');
  L.filter(x => x.impAncA > 0).sort((x, y) => y.impAncA - x.impAncA || y.n - x.n).slice(0, 30).forEach(x => console.log('  ' + row(x)));
  const C = L.filter(x => x.crit.overBase && x.crit.overAnc);
  console.log(`\n■ 표 C — B에서 ③ B 기준선 초과 ∧ ④ B 앵커 단독 초과 ${C.length}개 (①·② 표시)`);
  C.sort((x, y) => y.impAncB - x.impAncB).forEach(x => console.log(`  ${x.crit.b65 ? '①' : ' '}${x.crit.sim ? '②' : ' '} ` + row(x) + ` | B 독립 ${x.dB}일`));
  const vr = { '강력 추천': 0, '추가 검증': 1, '보류': 2, '탈락': 3 };
  const TOP = L.slice().sort((x, y) => vr[x.verdict] - vr[y.verdict] || (y.impAncB ?? -9) - (x.impAncB ?? -9) || y.n - x.n).slice(0, 10);
  console.log('\n■ 표 D — 최종 후보 TOP 10 (판정 → B 앵커 대비 개선 → 표본 순)');
  TOP.forEach((x, k) => console.log(`  ${k + 1}. [${x.verdict}] ${x.name}\n     A ${P(x.orA)}(${x.nA}건 ${x.dA}일) · B ${P(x.orB)}(${x.nB}건 ${x.dB}일) · 앵커 단독 A ${P(x.ancA)} B ${P(x.ancB)} → 개선 ${PP(x.impAncA)} / ${PP(x.impAncB)} · 기준선 A ${P(x.baseA)} B ${P(x.baseB)}` +
    `\n     95% Wilson ${P(x.wil[0])}~${P(x.wil[1])} · 종목 묶음 ${P(x.bootT[0])}~${P(x.bootT[1])} · 월 묶음 ${P(x.bootM[0])}~${P(x.bootM[1])} · 최대 종목 ${x.maxT[0]} ${(x.maxT[1] / x.n * 100).toFixed(0)}% · 최대 달 ${x.maxM[0]} ${(x.maxM[1] / x.n * 100).toFixed(0)}% ${x.conc ? '⚠ ' + x.conc : ''} · 연도 ${x.years}` +
    `\n     관측 겹침 ${P(x.ov)} · 10일 간격 제한 OR ${P(x.or10)}(${x.n10}) · 빈도 월 ${x.freq.toFixed(2)}회${x.freq < 0.5 ? ' (드묾)' : ''} · 3·5·10일 하락 ${P(x.dn3)}·${P(x.dn5)}·${P(x.dn10)} · 평균 ${x.a3.toFixed(1)}·${x.a5.toFixed(1)}·${x.a10.toFixed(1)}% · 10일 중앙 ${x.med10.toFixed(1)}%` +
    `\n     10일 뒤 오른 ${x.nUp}건 평균 ${x.upAvg == null ? '—' : '+' + x.upAvg.toFixed(1) + '%'} · 앵커에서 걸러진 ${x.nFilt}건의 OR ${P(x.filtOr)}`));
  console.log('\n  판정 규칙: 강력 추천 = B가 B 기준선·B 앵커 단독을 모두 넘고 ∧ B 독립 30일↑ ∧ 앵커 대비 B +10%p↑ ∧ 집중 없음 ∧ 월 0.5회↑ / 추가 검증 = 앞 둘만 충족 / 보류 = B 기준선 초과 또는 B 65%↑ 하나 / 탈락 = 그 밖.');
  console.log('  ※ OR 성공은 세 시점 중 한 번이라도 1% 초과 하락 — 매도 수익 개선·최적 매도 시점의 증거가 아니다. B를 본 뒤 조합을 바꾸지 않았다.');
  console.log('\n■ 끝 요약(로그 꼬리에서도 보이게) — 기준선');
  console.log(`  전체 OR ${P(orOf(allE))}(${allE.length}) A ${P(orOf(allE.filter(r => SET[r.t] === 'A')))} B ${P(orOf(allE.filter(r => SET[r.t] === 'B')))} · 일부익절 아무거나 ${P(orOf(anyE))}(${anyE.length}) A ${P(orOf(anyE.filter(r => SET[r.t] === 'A')))} B ${P(orOf(anyE.filter(r => SET[r.t] === 'B')))}`);
  console.log('  출처별: ' + ANCH.map(a => { const E = events(r => has(r, a)); return `${NM[a] || a} ${P(orOf(E))}(${E.length})`; }).join(' · '));
  console.log('  국면별(전체/일부익절): ' + ['상승', '횡보', '하락'].map(g => `${g} ${P(orOf(allE.filter(r => regime(r) === g)))}(${allE.filter(r => regime(r) === g).length})/${P(orOf(anyE.filter(r => regime(r) === g)))}(${anyE.filter(r => regime(r) === g).length})`).join(' · '));
  console.log(`  개별 3·5·10일 하락(전체) ${P(allE.filter(r => r.f3 < -1).length / allE.length)}·${P(allE.filter(r => r.f5 < -1).length / allE.length)}·${P(allE.filter(r => r.f10 < -1).length / allE.length)} · 조합 ${combos} · 사전등록 후보 ${res.summary.gt65}(우연 ${res.summary.chance}) · B 재현(>65%) ${res.summary.replicated}(우연 ${res.summary.rep_chance}) · 정식 통과 ${res.summary.passed} · ≥65% 고유 ${L.length} · 표 C ${C.length}`);
  const sens2 = L.map(x => x.or10 - x.orAll).sort((a, b) => a - b); if (sens2.length) console.log(`  10일 간격 민감도: 중앙 ${PP(sens2[Math.floor(sens2.length / 2)])} · 하위10% ${PP(sens2[Math.floor(sens2.length * 0.1)])}`);
}
