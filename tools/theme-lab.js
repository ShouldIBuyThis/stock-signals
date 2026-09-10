#!/usr/bin/env node
/* 읽기 전용. index.html의 날짜·레버리지·구성종목·순위·검증 함수를 그대로 사용. */
const fs=require('fs'), H=require('./_harness');
const input=process.argv[2]||'backtest/raw.json';
const c=H.loadPage(); c.raw=JSON.parse(fs.readFileSync(input,'utf8'));
c.runInPage('state.data=normalize(raw)');
const result=c.runInPage(`(()=>{
  const stats=a=>({n:a.length,hit:a.filter(x=>x.hit).length,
    rate:a.length?100*a.filter(x=>x.hit).length/a.length:null,
    ex:a.length?a.reduce((s,x)=>s+x.ex,0)/a.length:null,
    ret:a.length?a.reduce((s,x)=>s+x.ret,0)/a.length:null});
  const ranks={current:themeMultiRank,low20:r=>r.slice().sort((a,b)=>a.m20-b.m20),
    low5:r=>r.slice().sort((a,b)=>a.r5-b.r5),
    equalVotes:r=>themeMultiRank(r).sort((a,b)=>b.cnt-a.cnt||a.score-b.score)};
  const out={};
  for(const h of [5,10]){
    const daily=themeDailyRows(themeStocks(),h),dates=daily.map(x=>x.d),mid=dates[Math.floor(dates.length/2)];
    out[h]={start:dates[0],end:dates.at(-1),days:dates.length,mid,methods:{}};
    for(const [name,rank] of Object.entries(ranks)){
      const rows=daily.map(d=>themeCheck(d,rank)).filter(Boolean);
      out[h].methods[name]={all:stats(rows),first:stats(rows.filter(x=>x.d<mid)),second:stats(rows.filter(x=>x.d>=mid)),
        nonoverlap:stats(rows.filter(x=>dates.indexOf(x.d)%h===0)),
        latest:daily.length?rank(daily.at(-1).rows).slice(0,3).map(x=>x.name):[]};
    }
  }
  return out;
})()`);
console.log('THEME_RESULT '+JSON.stringify({input,result}));
