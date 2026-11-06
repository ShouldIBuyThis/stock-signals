#!/usr/bin/env node
/**
 * v22(테마 하락 패턴 → 매수 등급 보류) 전후 비교 (읽기 전용)
 * 같은 데이터로 strategyValidation()을 두 번 돌린다: 현행(v22) / v22 끄기(themeDanger를 false로).
 * 강한매수·다중 +1/+3/+5 승률(±1% 보합 제외, 화면 stat과 같음)과, 보류로 '지워지는 표본'의 성적을 찍는다.
 * 입력 backtest/raw.json (CI lab-quick years=3 days=690 — pat 열 필요)
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'signals.json';
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
const F = base.hist_fields, iD = F.indexOf('date'), iV = F.indexOf('market_vxn'), VXN = ((base.macro || {}).vxn) || {};
for (const s of base.stocks) for (const r of s.hist || []) { while (r.length <= iV) r.push(null); if (r[iV] == null && VXN[r[iD]] != null) r[iV] = +VXN[r[iD]]; }
const RAW = JSON.stringify(base);
const ON = 'const g=themeDanger ? 3 : (buyGrade>=4 ? buyGrade : 3);';
function run(off) {
  const page = H.loadPage({ patch: off ? [[ON, 'const g=(buyGrade>=4 ? buyGrade : 3);']] : [] });
  page.runInPage(`this.__run = j => { state.data = normalize(JSON.parse(j)); const r = strategyValidation();
    const o = {}; ['strongBuy','multi'].forEach(k => { o[k] = {}; [1,3,5].forEach(h => o[k][h] = (r._phaseRows[k][h]||[]).map(x => ({t:x.ticker, d:x.date, ret:x.ret}))); });
    return JSON.stringify(o); };`);
  return JSON.parse(page.__run(RAW));
}
const A = run(false), B = run(true);
const st = a => { const w = a.filter(x => x.ret > 1).length, l = a.filter(x => x.ret < -1).length;
  return `${w + l ? Math.round(w / (w + l) * 100) : '—'}%(${a.length}) ${a.length ? (a.reduce((z, x) => z + x.ret, 0) / a.length).toFixed(1) : '—'}%`.padEnd(18); };
console.log('■ v22 테마 하락 패턴 매수 보류 — 전후 비교');
for (const k of ['strongBuy', 'multi']) {
  console.log(`  [${k === 'strongBuy' ? '강한매수' : '다중'}]        +1일              +3일              +5일`);
  console.log('    v22 끄기     ' + [1, 3, 5].map(h => st(B[k][h])).join(''));
  console.log('    v22(현행)    ' + [1, 3, 5].map(h => st(A[k][h])).join(''));
  console.log('    지워진 표본  ' + [1, 3, 5].map(h => { const keep = new Set(A[k][h].map(x => x.t + '|' + x.d)); return st(B[k][h].filter(x => !keep.has(x.t + '|' + x.d))); }).join(''));
  const keep = new Set(A[k][5].map(x => x.t + '|' + x.d));
  B[k][5].filter(x => !keep.has(x.t + '|' + x.d)).forEach(x => console.log(`      ${x.d} ${x.t} +5일 ${x.ret.toFixed(1)}%`));
}
