#!/usr/bin/env node
/* 사용자 승인 후보만 in-memory patch. 운영 파일·frozen 원장은 절대 쓰지 않는다. */
const fs=require('fs'), H=require('./_harness');
const input=process.argv[2]||'signals.json',raw=JSON.parse(fs.readFileSync(input,'utf8'));
const fields=raw.hist_fields,di=fields.indexOf('date'),vi=fields.indexOf('market_vxn');
let missingVxn=0,filledVxn=0;
for(const s of raw.stocks||[]) for(const r of s.hist||[]){
  if(vi>=0 && r[vi]==null && raw.kind==='backtest'){
    const v=raw.macro?.vxn?.[r[di]];
    if(v!=null){while(r.length<=vi)r.push(null);r[vi]=Number(v);filledVxn++;}
    else if(!/\.(KS|KQ)$/.test(s.ticker))missingVxn++;
  }
}
const dates=[...new Set(raw.stocks.flatMap(s=>(s.hist||[]).map(r=>r[di])))].sort(),mid=dates[Math.floor(dates.length/2)];
const stat=a=>{const w=a.filter(x=>x.ret>1).length,l=a.filter(x=>x.ret< -1).length;return {
  n:a.length,dir:w+l,rate:w+l?100*w/(w+l):null,avg:a.length?a.reduce((s,x)=>s+x.ret,0)/a.length:null,
  dates:new Set(a.map(x=>x.date)).size,tickers:new Set(a.map(x=>x.ticker).filter(Boolean)).size};};
const split=a=>({all:stat(a),first:stat(a.filter(x=>x.date<mid)),second:stat(a.filter(x=>x.date>=mid))});
const key=x=>x.ticker+'|'+x.date;
const anchor='else if (lv==="caution"){ cNeg-=0.5;';
let baseline;
for(const penalty of [0.5,0.4,0.35,0.3,0.25,0.2,0]){
  const c=H.loadPage({patch:penalty===0.5?[]:[[anchor,anchor.replace('0.5',String(penalty))]]});
  c.raw=raw; c.runInPage('state.data=normalize(raw)');
  const rows=c.runInPage('strategyValidation()._phaseRows');
  if(!baseline)baseline=rows;
  const groups={};
  for(const group of ['strongBuy','pull','rev','multi','strict','base']){
    groups[group]={};
    for(const h of [1,3,5,7]){
      const a=rows[group][h],b=baseline[group][h],bk=new Set(b.map(key)),ak=new Set(a.map(key));
      groups[group][h]={...split(a),added:split(a.filter(x=>!bk.has(key(x)))),removed:split(b.filter(x=>!ak.has(key(x))))};
    }
  }
  const today=c.runInPage('allStocks().filter(s=>s.sig.grade>=4).map(s=>({ticker:s.ticker,grade:s.sig.grade,pull:s.sig.pullScore,rev:s.sig.revScore}))');
  console.log('CAUTION_RESULT '+JSON.stringify({input,penalty,days:dates.length,start:dates[0],end:dates.at(-1),mid,missingVxn,filledVxn,today,groups}));
}
