#!/usr/bin/env node
/**
 * 검증표 창 길이 비교 (읽기 전용) — 2026-10-07 사용자 질문 "도움말 최근 60거래일 재검증으로 바꾸면 어떻게 되나"
 * 화면 strategyValidation()을 그대로 돌리되 각 종목 hist를 최근 N행으로 잘라 N=30·60을 비교한다.
 * 입력이 raw.json(소급 계산)이면 원장과 다르다 — 그 사실을 같이 찍는다.
 * 사용: node tools/window-lab.js backtest/raw.json [30,60]
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'signals.json', NS = (process.argv[3] || '30,60').split(',').map(Number);
const base = JSON.parse(fs.readFileSync(IN, 'utf8')), F = base.hist_fields, iD = F.indexOf('date'), iV = F.indexOf('market_vxn');
const VXN = ((base.macro || {}).vxn) || {};
for (const s of base.stocks) for (const r of s.hist || []) { while (r.length <= iV) r.push(null); if (r[iV] == null && VXN[r[iD]] != null) r[iV] = +VXN[r[iD]]; }
const page = H.loadPage();
page.runInPage('this.__v = j => { state.data = normalize(JSON.parse(j)); const r = strategyValidation(); return { s:r._strict, nq:r._nqRebound||{}, m:r.multi, g:r._strongBuy, p:r.pull, rv:r.rev, b:r._baseline }; };');
const c = o => [1, 3, 5].map(h => o && o[h] && o[h].n ? `${String(o[h].rate).padStart(3)}%(${String(o[h].n).padStart(4)})` : '   —(   0)').join(' | ');
console.log(`■ ${IN} · 검증표 창 길이 비교 (+1 | +3 | +5 · 보합 제외 승률 · 괄호 표본)`);
for (const N of NS) {
  const d = JSON.parse(JSON.stringify(base));
  d.stocks.forEach(s => { s.hist = (s.hist || []).slice(-N); });
  const ds = [...new Set([].concat(...d.stocks.map(s => s.hist.map(r => r[iD]))))].sort();
  const v = page.__v(JSON.stringify(d));
  console.log(`\n  [${N}거래일] 신호일 ${ds[0]} ~ ${ds[ds.length - 1]}`);
  for (const [nm, k] of [['💡 강한다중', 's'], ['🌊 연속하락 반등', 'nq'], ['🔵 다중', 'm'], ['🟢 강한매수', 'g'], ['   추세 강매', 'p'], ['   반등 강매', 'rv'], ['기준선', 'b']])
    console.log(`    ${nm.padEnd(12)} ${c(v[k])}`);
}
