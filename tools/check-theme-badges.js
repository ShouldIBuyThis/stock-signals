#!/usr/bin/env node
const assert=require('node:assert/strict'),fs=require('fs'),H=require('./_harness');
const c=H.loadPage();c.raw=JSON.parse(fs.readFileSync('signals.json','utf8'));c.assert=assert;
c.runInPage(`
state.data=normalize(raw);
for(const [key,stocks] of badgeIndex()){
  assert.equal(new Set(stocks.map(s=>s.ticker)).size,stocks.length);
  assert.equal(visible().filter(s=>badgeMatches(s,key)).length,stocks.length);
}
for(const s of allStocks()){
  for(const b of flowBadges(s)){assert.ok(stockBadgeKeys(s).includes(b.key));assert.ok(flowTagsHtml(s).includes(b.text));}
  assert.equal(flowBadges(Object.assign({},s,{earnings_hold:true})).length,0);
}
assert.ok(!badgeIndex().some(([k])=>k==='⚠ 시장 주의'));
const rootFixture=Object.assign({},allStocks().find(s=>(s._hist||[]).length>=3),{ext_root:1,earnings_hold:false});
assert.ok(stockBadgeKeys(rootFixture).includes('🎯 Root 타격 되돌림'));
const stocks=themeStocks(),days=themeDailyRows(stocks,5),i=10;
const before=JSON.stringify(days[i].rows.map(({fwd,complete,...r})=>r));
const fields=histFields(),di=fields.indexOf('date'),pi=fields.indexOf('price');
const cloned=stocks.map(s=>Object.assign({},s,{_hist:s._hist.map(r=>r.slice())}));
for(const s of cloned)for(const r of s._hist)if(String(r[di])>days[i].d)r[pi]*=3;
assert.equal(JSON.stringify(themeDailyRows(cloned,5)[i].rows.map(({fwd,complete,...r})=>r)),before,'future prices changed earlier features');
const mature=days.find(d=>themeCheck(d,themeMultiRank));assert.ok(mature);
const incomplete={d:mature.d,rows:mature.rows.map((r,i)=>i? r:Object.assign({},r,{complete:false}))};
assert.equal(themeCheck(incomplete,themeMultiRank),null,'partial constituent returns were accepted');
const kr=cloned.find(s=>THEME_ONLY_TICKERS.has(s.ticker));assert.ok(kr);
const krDate=kr._hist.find(r=>String(r[di])>days[i].d);assert.ok(krDate);
// 한국의 다음 날짜를 급등시켜도 이전 미국 날짜의 입력은 바뀌면 안 된다.
krDate[pi]*=10;
assert.equal(JSON.stringify(themeDailyRows(cloned,5)[i].rows.map(({fwd,complete,...r})=>r)),before);
assert.equal(levX('SOXL'),3);
assert.ok(themeForecastHtml().includes('최근'));
`);
console.log('PASS: badge count/filter/card parity, earnings, future/KR causality, complete outcomes, leverage, rendering');
