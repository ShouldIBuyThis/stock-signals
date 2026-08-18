#!/usr/bin/env node
/**
 * 방어주 신호 쏠림이 다음날 QQQ를 예고하는가 (읽기 전용)
 *
 * 사용자 가설: 코카콜라·경기방어·금융에 다중/강한다중이 여러 개 뜬 날은
 * 자금이 방어로 돌았다는 뜻이니 다음날 나스닥이 약할 것이다.
 *
 * 방법: 그날 방어군(경기방어+금융) 중 다중 이상이 몇 개였는지 세고,
 * 다음 거래일 QQQ 등락률을 본다. 표본이 얇으면 결론을 내지 않는다(§5-1).
 *
 * 사용: node tools/defensive-lead.js
 */
const fs = require('fs'), H = require('./_harness');
const ctx = H.loadPage();
ctx.__raw = fs.readFileSync('signals.json', 'utf8');
const d = ctx.runInPage(`(() => {
  state.data = normalize(JSON.parse(__raw));
  const DEF = ["경기방어","금융"];
  const p = (strategyValidation()||{})._phaseRows || {};
  /* 그날 다중/강한다중이 실제로 붙은 (티커,날짜)를 모은다 — 화면과 같은 표본 */
  const day = {};
  const add = (src, key) => Object.values(src||{}).flat().forEach(x => {
    const o = day[x.date] || (day[x.date] = {multi:new Set(), strict:new Set()});
    o[key].add(x.ticker);
  });
  add(p.multi, "multi"); add(p.strict, "strict");
  const cat = {}; allStocks().forEach(s => cat[s.ticker] = s.category);
  const q = qqqBenchmarkStock();
  const qh = q ? (histStocks(q)||[]) : [];
  const qi = {}; qh.forEach((h,i) => qi[h.last_date] = i);
  const rows = [];
  Object.keys(day).sort().forEach(dt => {
    const o = day[dt];
    const defMulti  = [...o.multi ].filter(t => DEF.includes(cat[t]));
    const defStrict = [...o.strict].filter(t => DEF.includes(cat[t]));
    const i = qi[dt];
    if(i === undefined || !qh[i+1] || !has(qh[i+1].change_1d)) return;
    rows.push({ d:dt, def:defMulti.length, defS:defStrict.length,
                all:o.multi.size, ko:o.multi.has("KO")||o.strict.has("KO"),
                next:qh[i+1].change_1d, tks:defMulti });
  });
  return {rows, qDays:qh.length};
})()`);
const R = d.rows;
if(!R.length){ console.log('표본 없음'); process.exit(0); }
const up = a => a.length ? Math.round(a.filter(x=>x>0).length/a.length*100) : null;
const avg = a => a.length ? (a.reduce((p,c)=>p+c,0)/a.length).toFixed(2) : '-';
const show = (lab, sel) => console.log(
  `${lab.padEnd(26)} n=${String(sel.length).padStart(2)}  다음날 QQQ 상승 ${String(up(sel.map(x=>x.next))??'-').padStart(3)}%  평균 ${String(avg(sel.map(x=>x.next))).padStart(6)}%`);
console.log(`QQQ 이력 ${d.qDays}일 · 비교 가능한 신호일 ${R.length}일\n`);
show('전체 (기준선)', R);
[0,1,2,3].forEach(k => show(`방어군 다중 ${k}${k===3?'개 이상':'개'}`, R.filter(x => k===3 ? x.def>=3 : x.def===k)));
show('방어군 강한다중 1개+', R.filter(x=>x.defS>=1));
show('코카콜라 포함', R.filter(x=>x.ko));
console.log('\n날짜별 (방어군다중 / 전체다중 / 다음날 QQQ)');
R.forEach(x => console.log(`  ${x.d}  방어 ${x.def}(💡${x.defS}) / 전체 ${String(x.all).padStart(2)}  → ${x.next>=0?'+':''}${x.next.toFixed(2)}%  ${x.tks.join(',')}`));
