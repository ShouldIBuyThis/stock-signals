#!/usr/bin/env node
/**
 * 주의장 강한매수 개선 시험 (사전 등록 docs/2026-11-13-caution-strongbuy.md · 읽기 전용)
 *
 * 화면 evaluate()를 그대로 돌려 강한매수(grade 5) 사건을 모은 뒤, 사전 등록한 안 V1~V4가
 * '지우는' 사건과 남는 사건의 +1·+3·+5일 승률을 같은 국면 기준선과 비교한다.
 * 안들은 강한매수를 지우기만 하므로(새로 만들지 않음) 사후 필터가 산식 변경과 같다.
 * 승률 = 보합(±1%) 제외 · 실적 영향권 제외 — strategyValidation과 같은 규칙.
 * 사용: node tools/caution-lab.js backtest/raw.json
 */
const fs = require('fs'), H = require('./_harness');
const raw = JSON.parse(fs.readFileSync(process.argv[2] || 'signals.json', 'utf8'));
const ctx = H.buildContext({
  extra: ['qqqRsiOn', 'washoutLevel', 'competitionRank', 'strategyOrdinalRank', 'volumeOrdinalRank', 'rankMapsFor', 'rankOf',
          'previousOverallGrade', 'earningsWindowsForValidation', 'validationWindowTouchesEarnings'],
  tail: `this.collect = d => {
    state.data = normalize(d); const out = [];
    allStocks().forEach(s => {
      const hs = histStocks(s); if (!hs || !hs.length) return;
      const ew = earningsWindowsForValidation(s, hs);
      hs.forEach((r, i) => {
        if (!r.last_date || !r.price) return;
        if (i > 0) withPrev(r, hs[i - 1]);
        r._prevOverallGrade = i > 0 ? evaluate(hs[i - 1]).grade : null;
        r.sig = evaluate(r);
        if (ew.blocked.has(r.last_date)) return;
        const rets = {};
        for (const h of [1, 3, 5, 10]) {
          if (i + h >= hs.length || !hs[i + h].price) continue;
          if (validationWindowTouchesEarnings(ew.affected, hs, i, h)) continue;
          rets[h] = (hs[i + h].price / r.price - 1) * 100;
        }
        out.push({ tk: s.ticker, d: r.last_date, cat: s.category || '', ph: r.market_level || 'none', ret20: r.market_ret20,
                   g: r.sig.grade, pull: r.sig.pullGrade === 5, rev: r.sig.revGrade === 5, rets,
                   wrsi: r.w_rsi ?? null, w20: r.w_ma20_pos ?? null, m6: r.m_ma6_pos ?? null, mst: r.m_streak ?? null });
      });
    });
    return out;
  };`
});
const DEF = JSON.parse(JSON.stringify(vm_get('DEFENSIVE_CATS')));
function vm_get(n){ return require('vm').runInContext(n, ctx); }
const rows = ctx.collect(raw);
const dates = [...new Set(rows.map(r => r.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
const isKR = t => /\.(KS|KQ)$/.test(t);
const SB = rows.filter(r => r.g === 5);
const caution = r => r.ph === 'caution' && !isKR(r.tk);
const V = {
  V1: r => caution(r) && r.rev && !r.pull,
  V2: r => caution(r) && !(r.ret20 != null && r.ret20 < -2) && !DEF.includes(r.cat),
  V3: r => caution(r),
  V4: r => (caution(r) && r.rev && !r.pull) || (caution(r) && !(r.ret20 != null && r.ret20 < -2) && !DEF.includes(r.cat)),
};
const st = (L, h) => { const a = L.map(r => r.rets[h]).filter(x => x != null); const w = a.filter(x => x > 1).length, l = a.filter(x => x < -1).length;
  return { n: a.length, rate: (w + l) ? w / (w + l) : null, avg: a.length ? a.reduce((s, x) => s + x, 0) / a.length : null }; };
const pc = x => x == null ? ' — ' : (x * 100).toFixed(0).padStart(3) + '%';
const line = (nm, L) => `${nm.padEnd(28)} ` + [1, 3, 5].map(h => { const s = st(L, h); return `${pc(s.rate)}(${String(s.n).padStart(4)}) ${s.avg == null ? '' : (s.avg >= 0 ? '+' : '') + s.avg.toFixed(2)}`; }).join(' | ');
const base = rows; const cBase = rows.filter(caution);
console.log(`3년 백필 · 행 ${rows.length} · 강한매수 ${SB.length} · 주의장 강한매수 ${SB.filter(caution).length} · 앞/뒤 경계 ${mid}\n`);
console.log('                              +1일            | +3일            | +5일');
console.log(line('기준선(전체 아무 종목)', base)); console.log(line('기준선(주의장 · 미국)', cBase));
console.log(line('V0 현행 강한매수 전체', SB)); console.log(line('V0 주의장 강한매수', SB.filter(caution)));
const res = { mid, variants: {} };
for (const [k, f] of Object.entries(V)) {
  const rm = SB.filter(f), keep = SB.filter(r => !f(r));
  console.log(`\n■ ${k} — 지우는 ${rm.length}건`);
  console.log(line('  지워지는 표본', rm)); console.log(line('  남는 강한매수 전체', keep));
  for (const [hn, sel] of [['앞', r => r.d < mid], ['뒤', r => r.d >= mid]]) {
    console.log(line(`  ${hn} 반 · 지워지는`, rm.filter(sel)) + '   vs 주의장 기준선 ' + [3, 5].map(h => pc(st(cBase.filter(sel), h).rate)).join('/'));
  }
  res.variants[k] = { removed: [1, 3, 5].map(h => st(rm, h)), keep: [1, 3, 5].map(h => st(keep, h)),
    halves: ['앞', '뒤'].map((hn, j) => ({ rm: [3, 5].map(h => st(rm.filter(r => j ? r.d >= mid : r.d < mid), h)), base: [3, 5].map(h => st(cBase.filter(r => j ? r.d >= mid : r.d < mid), h)) })),
    tickers: [...new Set(rm.map(r => r.tk))].length, cats: Object.entries(rm.reduce((m, r) => (m[r.cat] = (m[r.cat] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 6) };
  console.log(`  지워지는 종목 ${res.variants[k].tickers}개 · 섹터 상위 ${res.variants[k].cats.map(x => x.join(' ')).join(' · ')}`);
}
// 주의장 강한매수 내역: 경로 × 관문
const C = SB.filter(caution);
console.log('\n■ 주의장 강한매수 내역');
console.log(line('  추세 경로', C.filter(r => r.pull))); console.log(line('  반등 경로만', C.filter(r => r.rev && !r.pull)));
console.log(line('  나스닥20일 ≥ −2%(완화 경로)', C.filter(r => !(r.ret20 != null && r.ret20 < -2))));
console.log(line('  나스닥20일 < −2%(관문)', C.filter(r => r.ret20 != null && r.ret20 < -2)));
console.log(line('  방어섹터', C.filter(r => DEF.includes(r.cat)))); console.log(line('  비방어섹터', C.filter(r => !DEF.includes(r.cat))));
if (process.argv[3] && process.argv[3] !== '--explore') fs.writeFileSync(process.argv[3], JSON.stringify(res));

/* ── §2 성공 조건 탐색(사전 등록 docs/2026-11-13-caution-strongbuy.md §2) ── */
if (process.argv.includes('--explore')) {
  // 주의장 지속일: 날짜별 국면(미국 종목 행의 market_level · 같은 날 같은 값) → 연속 주의장 거래일
  const phDay = {}; rows.filter(r => !isKR(r.tk)).forEach(r => { phDay[r.d] = r.ph; });
  const dd = Object.keys(phDay).sort(), age = {}; let run = 0;
  dd.forEach(d => { run = phDay[d] === 'caution' ? run + 1 : 0; age[d] = run; });
  const bin = (x, edges) => { if (x == null) return null; for (let k = 0; k < edges.length; k++) if (x < edges[k]) return k; return edges.length; };
  const DIM = {
    NQ:   { nm: '나스닥20일', lab: ['<−6', '−6~−4', '−4~−2', '−2~0', '0~2', '≥2'], f: r => bin(r.ret20, [-6, -4, -2, 0, 2]) },
    AGE:  { nm: '주의장 지속', lab: ['1~3일', '4~10일', '11일↑'], f: r => { const a = age[r.d] || 0; return a <= 3 ? 0 : a <= 10 ? 1 : 2; } },
    PATH: { nm: '경로', lab: ['반등만', '추세 포함'], f: r => r.pull ? 1 : 0 },
    WRSI: { nm: '주봉 RSI', lab: ['<40', '40~50', '50~60', '≥60'], f: r => bin(r.wrsi, [40, 50, 60]) },
    W20:  { nm: '20주선 대비', lab: ['<−5%', '−5~0%', '0~5%', '≥5%'], f: r => bin(r.w20, [-5, 0, 5]) },
    M6:   { nm: '월봉 6개월선', lab: ['아래', '위'], f: r => r.m6 == null ? null : (r.m6 >= 0 ? 1 : 0) },
    MST:  { nm: '월봉 연속', lab: ['상승 아님', '연속 상승'], f: r => r.mst == null ? null : (r.mst > 0 ? 1 : 0) },
  };
  const C = SB.filter(caution), tickA = [...new Set(rows.map(r => r.tk))].sort(), SET = Object.fromEntries(tickA.map((t, k) => [t, k % 2 ? 'B' : 'A']));
  const keys = Object.keys(DIM), cells = [];
  keys.forEach(k => DIM[k].lab.forEach((_, v) => cells.push([[k, v]])));
  keys.forEach((k1, a) => keys.slice(a + 1).forEach(k2 => DIM[k1].lab.forEach((_, v1) => DIM[k2].lab.forEach((_, v2) => cells.push([[k1, v1], [k2, v2]])))));
  const nm = cs => cs.map(([k, v]) => `${DIM[k].nm} ${DIM[k].lab[v]}`).join(' ∩ ');
  const bS = { 3: st(cBase, 3), 5: st(cBase, 5), 10: st(cBase, 10) }, cS = { 3: st(C, 3), 5: st(C, 5), 10: st(C, 10) }, aS = { 3: st(SB, 3), 5: st(SB, 5), 10: st(SB, 10) };
  const bH = [st(cBase.filter(r => r.d < mid), 5), st(cBase.filter(r => r.d >= mid), 5)], bAB = { A: st(cBase.filter(r => SET[r.tk] === 'A'), 5), B: st(cBase.filter(r => SET[r.tk] === 'B'), 5) };
  console.log(`\n■ §2 성공 조건 탐색 — 주의장 강한매수 ${C.length}건 · 조합 ${cells.length}`);
  console.log(`  기준: 주의장 아무 종목 +3/+5/+10일 ${pc(bS[3].rate)}/${pc(bS[5].rate)}/${pc(bS[10].rate)} · 주의장 강한매수 ${pc(cS[3].rate)}/${pc(cS[5].rate)}/${pc(cS[10].rate)} · 강한매수 전체 ${pc(aS[3].rate)}/${pc(aS[5].rate)}/${pc(aS[10].rate)}`);
  console.log(`  주의장 기준선 +5일 앞 ${pc(bH[0].rate)} · 뒤 ${pc(bH[1].rate)} · 종목 A ${pc(bAB.A.rate)} · B ${pc(bAB.B.rate)}`);
  const out2 = [];
  for (const cs of cells) {
    const L = C.filter(r => cs.every(([k, v]) => DIM[k].f(r) === v)); const s5 = st(L, 5); if (s5.n < 6 || s5.rate == null) continue;
    const h = [st(L.filter(r => r.d < mid), 5), st(L.filter(r => r.d >= mid), 5)], ab = { A: st(L.filter(r => SET[r.tk] === 'A'), 5), B: st(L.filter(r => SET[r.tk] === 'B'), 5) };
    const ok = [h[0].rate > bH[0].rate, h[1].rate > bH[1].rate, ab.A.rate > bAB.A.rate, ab.B.rate > bAB.B.rate].every(x => x === true);
    out2.push({ name: nm(cs), n: s5.n, dates: new Set(L.map(r => r.d)).size, tickers: new Set(L.map(r => r.tk)).size, s3: st(L, 3), s5, s10: st(L, 10), h, ab, ok });
  }
  out2.sort((a, b) => b.s5.rate - a.s5.rate || b.n - a.n);
  const hi = out2.filter(x => x.s5.rate >= 0.65);
  console.log(`  표본 6↑ 조합 ${out2.length} · +5일 65%↑ ${hi.length} · 그중 앞·뒤·A·B 모두 기준선 위 ${hi.filter(x => x.ok).length} · 30건↑ ${hi.filter(x => x.n >= 30).length}`);
  const f = s => `${pc(s.rate)}(${s.n}) ${s.avg == null ? '' : (s.avg >= 0 ? '+' : '') + s.avg.toFixed(2)}`;
  for (const x of hi.slice(0, 60)) console.log(`  ${x.ok ? '✓' : ' '}${x.n >= 30 ? '★' : ' '} ${x.name.padEnd(40)} | +3 ${f(x.s3)} | +5 ${f(x.s5)} | +10 ${f(x.s10)} | ${x.dates}일 ${x.tickers}종목 | 앞/뒤 ${pc(x.h[0].rate)}(${x.h[0].n})/${pc(x.h[1].rate)}(${x.h[1].n}) | A/B ${pc(x.ab.A.rate)}(${x.ab.A.n})/${pc(x.ab.B.rate)}(${x.ab.B.n})`);
  console.log('\n  단일 차원 전체(65% 미만 포함):');
  for (const x of out2.filter(x => !x.name.includes('∩'))) console.log(`    ${x.name.padEnd(24)} +3 ${f(x.s3)} | +5 ${f(x.s5)} | +10 ${f(x.s10)} | 앞/뒤 ${pc(x.h[0].rate)}/${pc(x.h[1].rate)}`);
}
