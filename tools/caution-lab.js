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
        for (const h of [1, 3, 5]) {
          if (i + h >= hs.length || !hs[i + h].price) continue;
          if (validationWindowTouchesEarnings(ew.affected, hs, i, h)) continue;
          rets[h] = (hs[i + h].price / r.price - 1) * 100;
        }
        out.push({ tk: s.ticker, d: r.last_date, cat: s.category || '', ph: r.market_level || 'none', ret20: r.market_ret20,
                   g: r.sig.grade, pull: r.sig.pullGrade === 5, rev: r.sig.revGrade === 5, rets });
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
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(res));
