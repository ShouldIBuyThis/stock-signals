#!/usr/bin/env node
// Read-only: fixed candidate tiers, production evaluate/strategyValidation only.
const fs=require('fs'),H=require('./_harness');
const input=process.argv[2],raw=JSON.parse(fs.readFileSync(input,'utf8'));
const F=raw.hist_fields,di=F.indexOf('date'),vi=F.indexOf('market_vxn');
const end=(raw.stocks||[]).filter(s=>!s.ticker.endsWith('.KS')).flatMap(s=>(s.hist||[]).map(r=>r[di])).sort().at(-1);
const start=String(Number(end.slice(0,4))-2)+end.slice(4);
let missingVxn=0;
for(const s of raw.stocks||[]){
  s.hist=(s.hist||[]).filter(r=>r[di]>=start&&r[di]<=end);
  if(raw.kind==='backtest')for(const r of s.hist){
    if(r[vi]==null&&raw.macro?.vxn?.[r[di]]!=null){while(r.length<=vi)r.push(null);r[vi]=Number(raw.macro.vxn[r[di]]);}
    if(!/\.(KS|KQ)$/.test(s.ticker)&&r[vi]==null)missingVxn++;
  }
}
const dates=[...new Set(raw.stocks.flatMap(s=>s.hist.map(r=>r[di])))].sort(),mid=dates[Math.floor(dates.length/2)];
const stat=a=>{const w=a.filter(x=>x.ret>1).length,l=a.filter(x=>x.ret< -1).length;return {n:a.length,w,l,dir:w+l,
  rate:w+l?100*w/(w+l):null,avg:a.length?a.reduce((s,x)=>s+x.ret,0)/a.length:null,
  dates:new Set(a.map(x=>x.date)).size,tickers:new Set(a.map(x=>x.ticker).filter(Boolean)).size};};
// Purge outcomes crossing the split; second half is separated by signal date.
const split=a=>({all:stat(a),first:stat(a.filter(x=>x.date<mid&&(x.endDate||x.date)<mid)),second:stat(a.filter(x=>x.date>=mid))});
const key=x=>x.ticker+'|'+x.date;
let base,baseInterest;
const outAnchor='result._diag=diag;';
const original=H.extractFunction('evaluate');
for(const [label,interest,strong] of [['baseline',null,null],['neighbor_low',1,2],['requested',1.5,2.5],['neighbor_high',2,3]]){
  const patch=[[outAnchor,outAnchor+' result._labOut=out;']];
  if(strong!==null){
    const candidate=original.replace('const pullGrade = pullSetup','const basePullGrade = pullSetup');
    if(candidate===original)throw Error('pull grade anchor missing');
    const anchor='(pullSetup && pullScore>=0.8 && pullInterestOK ? 4 : 3);';
    if(!candidate.includes(anchor))throw Error('grade end anchor missing');
    const code=anchor+`\n  const labRoom=has(s.res_short)&&has(p)&&p>0&&has(s.atr_pct)&&s.atr_pct>0?(s.res_short/p-1)*100/s.atr_pct:null;\n  const pullGrade=basePullGrade>=4 && labRoom!==null && labRoom>=${interest} ? (basePullGrade===5 && labRoom>=${strong}?5:4):3;`;
    patch.push([original,candidate.replace(anchor,code)]);
  }
  const c=H.loadPage({patch});c.raw=raw;c.runInPage('state.data=normalize(raw)');
  const v=c.runInPage('strategyValidation()'),rows=v._phaseRows;
  rows.interest={};for(const h of [1,3,5,7])rows.interest[h]=v._labOut.pull[h].filter(x=>x.tier===4);
  if(!base){base=rows;baseInterest=rows.interest;}
  const groups={};
  for(const g of ['pull','interest','strongBuy','rev','multi','strict','base']){
    groups[g]={};for(const h of [1,3,5,7]){
      const a=rows[g][h],b=base[g][h],ak=new Set(a.map(key)),bk=new Set(b.map(key));
      groups[g][h]={...split(a),added:split(a.filter(x=>!bk.has(key(x)))),removed:split(b.filter(x=>!ak.has(key(x))))};
    }
  }
  const today=c.runInPage('allStocks().filter(s=>s.sig.pullGrade>=4).map(s=>({ticker:s.ticker,grade:s.sig.pullGrade}))');
  const output={input,label,start,end,days:dates.length,mid,missingVxn,groups,today};
  console.log('RESISTANCE_RESULT '+JSON.stringify(output));
}
