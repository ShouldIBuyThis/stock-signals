// Fixed, interpretable candidates. Never changes the production page.
const fs=require('fs'),zlib=require('zlib'),H=require('./_harness');
const bytes=fs.readFileSync(process.argv[2]);
const rows=JSON.parse(process.argv[2].endsWith('.gz')?zlib.gunzipSync(bytes).toString():bytes.toString()),orig=H.extractFunction('evaluate');
const c1=[['baseline',[]],
 ['hard_equal_soft',[['dumpRecovered ? 0.8 : 1.5','dumpRecovered ? 0.4 : 0.8']]],
 ['hard_1_0',[['dumpRecovered ? 0.8 : 1.5','dumpRecovered ? 0.4 : 1.0']]],
 ['hard_1_2',[['dumpRecovered ? 0.8 : 1.5','dumpRecovered ? 0.4 : 1.2']]],
 ['interest_band80',[['has(bb) && bb>70 &&','has(bb) && bb<=80 &&']]],
 ['interest_band75',[['has(bb) && bb>70 &&','has(bb) && bb<=75 &&']]],
 ['interest_band85',[['has(bb) && bb>70 &&','has(bb) && bb<=85 &&']]],
 ['no_fear_pull',[['(pPos+tNeg+cNeg+vxnBonus)','(pPos+tNeg+cNeg)']]],
 ['rising_required',[['const pullSetup = dipSoft || dipHard || resting || dumpRecovered;','const pullSetup = rising && (dipSoft || dipHard || resting || dumpRecovered);']]],
 ['strong_rs20',[['&& sectorOK && tickerOK && sectorTuneOK && nearHighM && pullChase && pullBandOK ? 5 :','&& (!has(s.rs20)||s.rs20>0) && sectorOK && tickerOK && sectorTuneOK && nearHighM && pullChase && pullBandOK ? 5 :']]],
 ];
const c2=[['baseline',[]],... [60,65,70].map(v=>['strong_buffer'+v,[['pullScore>=1.5 && has(bb) && bb<=55','pullScore>=1.5 && has(bb) && bb<='+v]]]),['interest80_hardsoft',[['has(bb) && bb>70 &&','has(bb) && bb<=80 &&'],['dumpRecovered ? 0.8 : 1.5','dumpRecovered ? 0.4 : 0.8']]]];
const anchor3='&& sectorOK && tickerOK && sectorTuneOK && nearHighM && pullChase && pullBandOK ? 5 :';
const c3=[['baseline',[]],...[0.85,0.9,1.0].map(v=>['volume'+v,[[anchor3,'&& (!has(vr)||vr<'+v+') '+anchor3]]]),['volume085_hardsoft',[[anchor3,'&& (!has(vr)||vr<0.85) '+anchor3],['dumpRecovered ? 0.8 : 1.5','dumpRecovered ? 0.4 : 0.8']]]];
const anchor4='pullSetup && (pullScore>=2.0 || (pullScore>=1.5 && has(bb) && bb<=55))';
const c4=[['baseline',[]],...[60,65,70].map(v=>['recovery_rsi'+v,[[anchor4,'bull && a20 && rising && !isRed && macdUp && has(rsi) && rsi<='+v]]]),['recovery_or_original',[[anchor4,'('+anchor4+' || (bull && a20 && rising && !isRed && macdUp && has(rsi) && rsi<=65))']]]];
const anchor5='&& sectorOK && tickerOK && sectorTuneOK && nearHighM && pullChase && pullBandOK ? 5 :';
const c5=[['baseline',[]],...[0,5,10].map(v=>['trend_sector_rs'+v,[[anchor5,'&& (sectorOK || (rising && has(s.rs20) && s.rs20>='+v+')) && tickerOK && sectorTuneOK && nearHighM && pullChase && pullBandOK ? 5 :']]]),['trend_sector_open',[[anchor5,'&& tickerOK && sectorTuneOK && nearHighM && pullChase && pullBandOK ? 5 :']]]];
const candidates=[...c1,...c2.slice(1),...c3.slice(1),...c4.slice(1),...c5.slice(1)];
const stat=a=>{let w=a.filter(x=>x.ret>1).length,l=a.filter(x=>x.ret< -1).length;return {n:a.length,w,l,rate:w+l?100*w/(w+l):null,avg:a.length?a.reduce((s,x)=>s+x.ret,0)/a.length:null,dates:new Set(a.map(x=>x.date)).size,tickers:new Set(a.map(x=>x.ticker)).size};};
const split=a=>Object.fromEntries([['all',a],['first',a.filter(x=>x.endDate<'2025-09-24')],['second',a.filter(x=>x.date>='2025-09-24')],['recent',a.filter(x=>x.date>='2026-08-10')]].map(([k,v])=>[k,stat(v)]));
const key=x=>x.ticker+'|'+x.date;let baseline;
for(const [name,changes] of candidates){
 let src=orig;for(const [a,b] of changes){if(!src.includes(a))throw Error(a);src=src.replace(a,b);}
 const c=H.loadPage({patch:[[orig,src]]}),ev=c.runInPage('evaluate'),cache=new Map(),all={};
 for(const h of [3,5,7]){
  all[h]={};for(const x of rows[h]){let k=key(x);if(!cache.has(k))cache.set(k,ev(x.row));}
  for(const [g,pred] of [['strong',s=>s.pullGrade===5],['interest',s=>s.pullGrade===4],['both',s=>s.pullGrade>=4]]){
   const a=rows[h].filter(x=>pred(cache.get(key(x))));
   const b=baseline?.[h]?.[g]||a,ak=new Set(a.map(key)),bk=new Set(b.map(key));
   all[h][g]=a;all[h][g+'Stats']={...split(a),added:split(a.filter(x=>!bk.has(key(x)))),removed:split(b.filter(x=>!ak.has(key(x))))};
  }
 }
 if(!baseline)baseline=all;
 console.log(JSON.stringify({name,results:Object.fromEntries([3,5,7].map(h=>[h,Object.fromEntries(['strong','interest','both'].map(g=>[g,all[h][g+'Stats']]))]))}));
}
