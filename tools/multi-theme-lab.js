#!/usr/bin/env node
/**
 * 다중 관문 × 테마 저점 규칙(M_*) — 넣으면 승률이 어떻게 되나 (읽기 전용 · 아무 파일도 안 고친다)
 *
 * 왜 (2026-11-06 사용자: "다중관문에 테마 규칙 넣으면 승률 어케돼?")
 *
 * 방법 — 화면 검증표와 같은 strategyValidation()을 그대로 돌리고(§0), 기준선 표본에 그날 행을 실어 낸다.
 *   현행 다중        : _phaseRows.multi (화면 '다중 신호' 행과 같은 표본)
 *   다중 ∩ 테마 규칙 : 다중 표본 중 그날 pat에 M_* 가 있는 것 (관문을 '조이는' 경우)
 *   다중 ∪ 테마 규칙 : 다중 + 다중이 아니어도 M_* 가 뜬 날 (관문에 '더하는' 경우)
 *   테마 규칙 단독    : M_* 가 뜬 날 전부 (등급 무관)
 *   기준선            : 아무 날 매수
 * 승률 = (+1% 초과) / (+1% 초과 + −1% 미만), 보합 제외 — 화면 stat()과 같다. 실적 영향권 제외도 같다.
 * §2 반쪽: 기간을 날짜 중앙값으로 앞·뒤 반으로 나눠 같은 표를 다시 찍는다.
 *
 * ⚠ M_* 규칙은 10년 데이터(이 기간 포함)에서 골랐다 → 이 표의 테마 규칙 성적은 표본 내 성적이다.
 * 입력  backtest/raw.json (CI: lab-quick.yml years=3 days=690 — pat 열은 main.py analyze()가 채운다)
 * 사용  node tools/multi-theme-lab.js backtest/raw.json
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'signals.json';
const RAW = fs.readFileSync(IN, 'utf8');
const base = JSON.parse(RAW);
if (!(base.hist_fields || []).includes('pat')) H.die('hist_fields에 pat 없음 — main.py 2026-11-05 이후 데이터가 필요');
/* VXN 주입 — raw.json은 macro.vxn에만 있다(winrate65-lab.js와 같은 처리). 빠지면 💡 강한다중이 0건이 된다. */
const F = base.hist_fields, iD = F.indexOf('date'), iV = F.indexOf('market_vxn'), VXN = ((base.macro || {}).vxn) || {};
let vfill = 0;
for (const s of base.stocks) for (const r of s.hist || []) {
  while (r.length <= iV) r.push(null);
  if (r[iV] == null && VXN[r[iD]] != null) { r[iV] = +VXN[r[iD]]; vfill++; }
}
const RAW_IN = JSON.stringify(base);

const BASEPUSH = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});';
const page = H.loadPage({ patch: [[BASEPUSH,
  'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date, ticker:row.ticker, pat:row.pat, grade:row.sig&&row.sig.grade});']] });
page.runInPage(`this.__run = j => { state.data = normalize(JSON.parse(j)); const r = strategyValidation();
  const H=[1,3,5,10,20], o={base:{},multi:{}};
  H.forEach(h=>{ o.base[h]=(r._phaseRows.base[h]||[]).map(x=>({t:x.ticker,d:x.date,ret:x.ret,pat:x.pat||'',g:x.grade}));
                 o.multi[h]=(r._phaseRows.multi[h]||[]).map(x=>({t:x.ticker,d:x.date,ret:x.ret,k:x.tier})); });
  return JSON.stringify(o); };`);
const R = JSON.parse(page.__run(RAW_IN));
console.log(`VXN 주입 ${vfill}칸`);

const HS = [1, 3, 5, 10, 20];
const isM = p => String(p || '').split(',').some(c => c.startsWith('M_'));
const st = a => {
  const w = a.filter(x => x.ret > 1).length, l = a.filter(x => x.ret < -1).length;
  return { n: a.length, rate: w + l ? Math.round(w / (w + l) * 100) : null,
           avg: a.length ? a.reduce((z, x) => z + x.ret, 0) / a.length : null };
};
const fmt = s => s.n ? `${s.rate == null ? '—' : s.rate + '%'}(${s.n}) ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(1)}%`.padEnd(18) : '—(0)'.padEnd(18);

const allDates = [...new Set(R.base[1].map(x => x.d))].sort();
const mid = allDates[Math.floor(allDates.length / 2)];
console.log(`■ 다중 관문 × 테마 저점 규칙 · ${allDates[0]}~${allDates[allDates.length - 1]} (${allDates.length}거래일) · 반쪽 경계 ${mid}`);
console.log('  칸 = 승률(표본) 평균수익 · 승률은 ±1% 보합 제외(화면과 같음)');

function table(label, keep) {
  console.log(`\n  [${label}]`);
  console.log('    ' + ''.padEnd(26) + HS.map(h => `+${h}일`.padEnd(18)).join(''));
  const row = (name, f) => console.log('    ' + name.padEnd(26) + HS.map(h => fmt(st(f(h).filter(x => keep(x.d))))).join(''));
  const patOf = h => { const m = new Map(); R.base[h].forEach(x => m.set(x.t + '|' + x.d, x.pat)); return m; };
  row('기준선(아무 날)', h => R.base[h]);
  row('현행 다중', h => R.multi[h]);
  row('  └ 💡 강한다중', h => R.multi[h].filter(x => x.k === 1));
  row('다중 ∩ 테마 규칙(조이기)', h => { const P = patOf(h); return R.multi[h].filter(x => isM(P.get(x.t + '|' + x.d))); });
  row('다중 ∪ 테마 규칙(더하기)', h => {
    const seen = new Set(R.multi[h].map(x => x.t + '|' + x.d));
    return R.multi[h].concat(R.base[h].filter(x => isM(x.pat) && !seen.has(x.t + '|' + x.d)));
  });
  row('테마 규칙 단독', h => R.base[h].filter(x => isM(x.pat)));
  row('  └ 그날 강한매수(5)', h => R.base[h].filter(x => isM(x.pat) && x.g === 5));
  row('  └ 강한매수 아님', h => R.base[h].filter(x => isM(x.pat) && x.g !== 5));
}
table('전체', () => true);
table('§2 앞 반', d => d < mid);
table('§2 뒤 반', d => d >= mid);

console.log('\n  [테마 규칙이 뜬 날 목록 — +5일 · +10일 · +20일]');
const by = {}; HS.forEach(h => R.base[h].forEach(x => { if (!isM(x.pat)) return;
  const k = x.t + '|' + x.d; (by[k] = by[k] || { t: x.t, d: x.d, pat: x.pat, g: x.g, r: {} }).r[h] = x.ret; }));
const multiKeys = new Set(R.multi[1].map(x => x.t + '|' + x.d));
const list = Object.values(by).sort((a, b) => a.d.localeCompare(b.d));
const f1 = v => v == null ? '  —  ' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
list.forEach(x => console.log(`    ${x.d} ${x.t.padEnd(6)} ${x.pat.split(',').filter(c => c.startsWith('M_')).join(',').padEnd(8)} 등급${x.g}${multiKeys.has(x.t + '|' + x.d) ? ' 다중' : '     '}  ${f1(x.r[5])} · ${f1(x.r[10])} · ${f1(x.r[20])}`));
console.log(`    (총 ${list.length}건)`);
