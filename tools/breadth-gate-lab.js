#!/usr/bin/env node
/**
 * 시장 폭(52주 신고가−신저가)을 산식에 넣을 수 있나 — v21 시장 폭과 중복·반쪽·고원 검증 (읽기 전용)
 *
 * 왜 (2026-11-06 사용자: "1하고 2하고 3으로 해줘" — 표시 → 검증 → 버티면 산식 반영)
 * 후보 산식: v21의 바닥권 해제(bottomBreadth = 관심종목 20일선 위 30% 미만 → 약세 제한·국면 강등 해제)에
 *   '순신고가(신고가권−신저가권)/종목수 < T' 를 OR로 더한다. 판정 함수는 화면 그대로, 줄 하나만 바꾼다.
 * 보는 것
 *   [1] 중복: 현행 강한매수·다중 표본을 (v21 바닥권 여부) × (순신고가<0 여부) 4칸으로
 *   [2] 변형별 강한매수·다중 +1/+3/+5 승률·표본 · 추가된 표본의 성적 · §2 앞/뒤 반
 *   [3] §3 고원: 문턱 T(0, −2%, −5%) × 신고가권 폭(1·2·3%)
 * 입력 backtest/raw.json (lab-quick years=3 days=690)
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'signals.json';
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
const F = base.hist_fields, iD = F.indexOf('date'), iV = F.indexOf('market_vxn'), VXN = ((base.macro || {}).vxn) || {};
for (const s of base.stocks) for (const r of s.hist || []) { while (r.length <= iV) r.push(null); if (r[iV] == null && VXN[r[iD]] != null) r[iV] = +VXN[r[iD]]; }
const RAW = JSON.stringify(base);

const A_HIST = 'market_breadth: (typeof marketBreadthOn === "function") ? marketBreadthOn(o.date) : null,';
const A_NORM = 'if (s.market_breadth == null && typeof marketBreadthOn === "function") s.market_breadth = marketBreadthOn(s.last_date);';
const A_EVAL = 'const bottomBreadth = has(s.market_breadth) && s.market_breadth < 30;';
const NETF = '(x => x ? (x.nh - x.nl) / x.n : null)';
function run(T, W) {
  const patch = [
    [A_HIST, A_HIST + ` market_hlnet: (typeof highLowOn === "function") ? ${NETF}(highLowOn(o.date)) : null,`],
    [A_NORM, A_NORM + ` if (s.market_hlnet == null && typeof highLowOn === "function") s.market_hlnet = ${NETF}(highLowOn(s.last_date));`],
  ];
  if (W != null) patch.push(['if(r[iH] >= -1) a.nh++; if(r[iL] <= 1) a.nl++;', `if(r[iH] >= -${W}) a.nh++; if(r[iL] <= ${W}) a.nl++;`]);
  if (T != null) patch.push([A_EVAL, `const bottomBreadth = (has(s.market_breadth) && s.market_breadth < 30) || (has(s.market_hlnet) && s.market_hlnet < ${T});`]);
  const page = H.loadPage({ patch });
  page.runInPage(`this.__run = j => { state.data = normalize(JSON.parse(j)); const r = strategyValidation(); const o = {};
    ['strongBuy','multi'].forEach(k => { o[k] = {}; [1,3,5].forEach(h => o[k][h] = (r._phaseRows[k][h]||[]).map(x => {
      const hl = highLowOn(x.date); return {t:x.ticker, d:x.date, ret:x.ret, mb:marketBreadthOn(x.date), net: hl ? (hl.nh-hl.nl)/hl.n : null}; })); });
    return JSON.stringify(o); };`);
  return JSON.parse(page.__run(RAW));
}
const st = a => { const w = a.filter(x => x.ret > 1).length, l = a.filter(x => x.ret < -1).length;
  return `${w + l ? Math.round(w / (w + l) * 100) : '—'}%(${a.length})`.padEnd(11); };
const key = x => x.t + '|' + x.d;

const B0 = run(null, null);
const dates = [...new Set(B0.strongBuy[1].map(x => x.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
console.log(`■ 시장 폭 산식 후보 검증 · 신호일 ${dates[0]}~${dates[dates.length - 1]} · 반쪽 경계 ${mid}`);

console.log('\n[1] 중복 — 현행(v22) 표본을 v21 바닥권 × 순신고가<0 으로 나눔        강한매수 +3 · +5      다중 +3 · +5');
const cells = [['바닥권 O · 순신고가<0', x => x.mb != null && x.mb < 30 && x.net < 0], ['바닥권 O · 순신고가≥0', x => x.mb != null && x.mb < 30 && x.net >= 0],
               ['바닥권 X · 순신고가<0', x => !(x.mb != null && x.mb < 30) && x.net < 0], ['바닥권 X · 순신고가≥0', x => !(x.mb != null && x.mb < 30) && x.net >= 0]];
for (const [nm, f] of cells) console.log('   ' + nm.padEnd(26) + st(B0.strongBuy[3].filter(f)) + st(B0.strongBuy[5].filter(f)) + '   ' + st(B0.multi[3].filter(f)) + st(B0.multi[5].filter(f)));
/* 상위 단계 후보(바닥권 ∩ 순신고가<T) — §2 앞/뒤 반 · §3 문턱 */
console.log('\n[1-b] 상위 단계 후보: 바닥권 O ∩ 순신고가<T — 강한매수 +1·+3·+5 (전체 | 앞 반 | 뒤 반)  vs 나머지 바닥권');
for (const T of [0.02, 0, -0.02, -0.05, -0.10]) {
  const f = x => x.mb != null && x.mb < 30 && x.net != null && x.net < T, g = x => x.mb != null && x.mb < 30 && !(x.net != null && x.net < T);
  const L = (k, fn, half) => [1, 3, 5].map(h => st(B0[k][h].filter(x => fn(x) && (half === 0 || (half === 1 ? x.d < mid : x.d >= mid))))).join('');
  console.log(`   T=${String(T).padEnd(5)} 강매 ${L('strongBuy', f, 0)}| 앞 ${L('strongBuy', f, 1)}| 뒤 ${L('strongBuy', f, 2)}|| 나머지 ${L('strongBuy', g, 0)}`);
  console.log(`   ${''.padEnd(7)} 다중 ${L('multi', f, 0)}| 앞 ${L('multi', f, 1)}| 뒤 ${L('multi', f, 2)}|| 나머지 ${L('multi', g, 0)}`);
}
if (process.argv.includes('--cells-only')) process.exit(0);

function show(nm, R) {
  for (const k of ['strongBuy', 'multi']) {
    const add = h => { const s0 = new Set(B0[k][h].map(key)); return R[k][h].filter(x => !s0.has(key(x))); };
    const rem = h => { const s1 = new Set(R[k][h].map(key)); return B0[k][h].filter(x => !s1.has(key(x))); };
    console.log(`   ${(nm + ' ' + (k === 'strongBuy' ? '강매' : '다중')).padEnd(24)} 전체 ${[1, 3, 5].map(h => st(R[k][h])).join('')}`
      + ` | 앞 ${[3, 5].map(h => st(R[k][h].filter(x => x.d < mid))).join('')} 뒤 ${[3, 5].map(h => st(R[k][h].filter(x => x.d >= mid))).join('')}`
      + ` | 추가 ${[3, 5].map(h => st(add(h))).join('')} 빠짐 ${st(rem(5))}`);
  }
}
console.log('\n[2] 변형별 +1·+3·+5 | §2 앞/뒤 반 +3·+5 | 추가된 표본 +3·+5 | 빠진 표본 +5');
show('현행 v22', B0);
show('순신고가<0 해제', run(0, null));
console.log('\n[3] §3 고원 — 문턱 T × 신고가권 폭');
for (const W of [1, 2, 3]) for (const T of [0, -0.02, -0.05]) show(`폭${W}% T${T}`, run(T, W));
