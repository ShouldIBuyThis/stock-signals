#!/usr/bin/env node
/**
 * 현행 산식 최근검증: +1/+3/+5, WIN/FLAT/LOSS, 전략×기간 최근 유효 최대 100건
 * - 현재 index.html evaluate()/multiSignalRank() 직접 재사용
 * - 과거 원시지표는 validation100_prepare.py가 현재 main.py analyze()로 재현
 * - signals.json 최근 hist(최대 10거래일)를 우선 병합해 최신 데이터를 사용
 * - 실적 영향권/미검증 미국기업은 유효표본에서 제외
 * - 결과 판정: > +1% WIN, -1%~+1% FLAT, < -1% LOSS
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const ROOT=process.cwd();
const INDEX=path.join(ROOT,'index.html');
const INPUT=path.join(ROOT,'validation100_input.json');
const SIGNALS=path.join(ROOT,'signals.json');
const HORIZONS=[1,3,5], MAX_N=100, FLAT_BAND=1.0;
function die(x){console.error('[ERROR]',x);process.exit(1)}
if(!fs.existsSync(INDEX)||!fs.existsSync(INPUT)||!fs.existsSync(SIGNALS)) die('index.html / validation100_input.json / signals.json 필요');
const src=fs.readFileSync(INDEX,'utf8');
const data=JSON.parse(fs.readFileSync(INPUT,'utf8'));
const signals=JSON.parse(fs.readFileSync(SIGNALS,'utf8'));
function extractFunction(src,name){const st=src.indexOf(`function ${name}(`);if(st<0)die(`${name} 없음`);const b=src.indexOf('{',st);let d=0,q=null,e=false,lc=false,bc=false;for(let i=b;i<src.length;i++){const c=src[i],n=src[i+1];if(lc){if(c==='\n')lc=false;continue}if(bc){if(c==='*'&&n==='/'){bc=false;i++}continue}if(q){if(e){e=false;continue}if(c==='\\'){e=true;continue}if(c===q)q=null;continue}if(c==='/'&&n==='/'){lc=true;i++;continue}if(c==='/'&&n==='*'){bc=true;i++;continue}if(c==='"'||c==="'"||c==='`'){q=c;continue}if(c==='{')d++;else if(c==='}'){d--;if(d===0)return src.slice(st,i+1)}}die(`${name} 끝 없음`)}
function extractConst(src,name){const st=src.indexOf(`const ${name} =`);if(st<0)die(`${name} 없음`);const semi=src.indexOf(';',st);return src.slice(st,semi+1)}
const ctx={console,Math,Number,Object,Array,Set,Map,String};vm.createContext(ctx);vm.runInContext(`const has=v=>v!==null&&v!==undefined&&!Number.isNaN(v);const r1=v=>has(v)?Math.round(v*10)/10:"—";${extractConst(src,'LEVERAGED')}const levX=tk=>(LEVERAGED[tk]?LEVERAGED[tk].x:1);${extractFunction(src,'evaluate')}${extractFunction(src,'multiSignalRank')}this.E=evaluate;this.M=multiSignalRank;`,ctx);
const evaluate=ctx.E,multiSignalRank=ctx.M;
const fields=signals.hist_fields||[];
const histObj=(a)=>{const o={};fields.forEach((k,i)=>o[k]=a?.[i]??null);o.last_date=o.date;return o};
const baseByTicker=new Map();
for(const r of data.rows||[]){if(!baseByTicker.has(r.ticker))baseByTicker.set(r.ticker,[]);baseByTicker.get(r.ticker).push({...r,_source:'BACKTEST'})}
// 최근 hist를 ticker+date 기준으로 우선 덮어쓴다.
for(const s of signals.items||[]){for(const a of s.hist||[]){const h=histObj(a);if(!h.last_date)continue;const row={...s,...h,ticker:s.ticker,name:s.name,category:s.category,currency:s.currency,market_level:s.market_level,market_weak:s.market_weak,_source:'RECENT_HIST'};delete row.hist;if(!baseByTicker.has(s.ticker))baseByTicker.set(s.ticker,[]);const arr=baseByTicker.get(s.ticker);const i=arr.findIndex(x=>x.last_date===h.last_date);if(i>=0)arr[i]=row;else arr.push(row)}}
const byDate=new Map();
for(const arr of baseByTicker.values()){arr.sort((a,b)=>a.last_date.localeCompare(b.last_date));for(let i=0;i<arr.length;i++){const r=arr[i],p=i?arr[i-1]:null;for(const k of ['prev_change_1d','prev_vol_ratio','prev_macd_hist','prev_price','prev_ma5','prev_ma20']) delete r[k];if(p){r.prev_change_1d=p.change_1d;r.prev_vol_ratio=p.vol_ratio;r.prev_macd_hist=p.macd_hist;r.prev_price=p.price;r.prev_ma5=p.ma5;r.prev_ma20=p.ma20}r.sig=evaluate(r);if(!byDate.has(r.last_date))byDate.set(r.last_date,[]);byDate.get(r.last_date).push(r)}}
const priceMap=new Map(Object.entries(data.prices||{}));
// signals hist의 최신 가격도 priceMap에 우선 병합
for(const s of signals.items||[]){let arr=(priceMap.get(s.ticker)||[]).map(x=>[x[0],Number(x[1])]);const m=new Map(arr.map(x=>[x[0],x[1]]));for(const a of s.hist||[]){const h=histObj(a);if(h.date&&Number.isFinite(Number(h.price)))m.set(h.date,Number(h.price))}priceMap.set(s.ticker,[...m].sort((a,b)=>a[0].localeCompare(b[0])))}
const earnMap=new Map(Object.entries(data.earnings_dates||{}).map(([k,v])=>[k,new Set(v)]));
const timing=data.earnings_timing||{}, coverage=new Map(Object.entries(data.earnings_coverage||{}));
function endpoint(tk,d,h){const a=priceMap.get(tk)||[],i=a.findIndex(x=>x[0]===d);return (i<0||i+h>=a.length)?null:{date:a[i+h][0],price:Number(a[i+h][1])}}
function earningsAffected(tk,signalDate,endDate){const es=earnMap.get(tk);if(!es)return false;for(const d of es){const t=timing[`${tk}|${d}`]||'UNKNOWN';// BMO: 당일 종가부터 영향, AMC/UNKNOWN: 다음 거래일 종가부터 영향. 보수적으로 신호~평가창 내 발표는 제외.
if(d>=signalDate&&d<=endDate)return true;}return false}
function label(ret){return ret>FLAT_BAND?'WIN':ret<-FLAT_BAND?'LOSS':'FLAT'}
const samples=[];
function add(kind,row,h){const isKR=row.ticker.endsWith('.KS')||row.ticker.endsWith('.KQ');const cov=coverage.get(row.ticker);if(!isKR&&(!cov||cov.coverage==='unverified'))return;const ep=endpoint(row.ticker,row.last_date,h);if(!ep)return;if(earningsAffected(row.ticker,row.last_date,ep.date))return;const ret=(ep.price/Number(row.price)-1)*100;samples.push({strategy:kind,horizon:h,ticker:row.ticker,signal_date:row.last_date,end_date:ep.date,buy_price:Number(row.price),end_price:ep.price,return_pct:ret,result:label(ret),source:row._source||'BACKTEST'})}
for(const arr of baseByTicker.values())for(const r of arr)for(const h of HORIZONS){if((r.sig?.pullGrade||0)>=4)add('trend',r,h);if((r.sig?.revGrade||0)>=4)add('reversal',r,h)}
for(const [d,u0] of [...byDate.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){const u=u0.filter(r=>true), ranked=multiSignalRank(u);for(const r of ranked)if((r.sig?.grade||0)>=4)for(const h of HORIZONS)add('multi',r,h)}
// 중복 제거: 같은 전략/기간/티커/신호일이면 RECENT_HIST 우선
const dedup=new Map();for(const x of samples){const k=[x.strategy,x.horizon,x.ticker,x.signal_date].join('|');const old=dedup.get(k);if(!old||x.source==='RECENT_HIST')dedup.set(k,x)}
const all=[...dedup.values()];
const summary={generated_at:new Date().toISOString(),rule:{max_valid_samples:MAX_N,flat_band_pct:FLAT_BAND,horizons:HORIZONS},strategies:{}};
for(const st of ['multi','trend','reversal']){summary.strategies[st]={};for(const h of HORIZONS){const a=all.filter(x=>x.strategy===st&&x.horizon===h).sort((x,y)=>y.end_date.localeCompare(x.end_date)||y.signal_date.localeCompare(x.signal_date)).slice(0,MAX_N);const win=a.filter(x=>x.result==='WIN').length,flat=a.filter(x=>x.result==='FLAT').length,loss=a.filter(x=>x.result==='LOSS').length;const decisive=win+loss;summary.strategies[st][h]={n:a.length,win,flat,loss,directional_rate:decisive?Math.round(win/decisive*1000)/10:null,avg_return:a.length?Math.round(a.reduce((z,x)=>z+x.return_pct,0)/a.length*100)/100:null,recent_hist:a.filter(x=>x.source==='RECENT_HIST').length,backtest:a.filter(x=>x.source==='BACKTEST').length};}}
fs.writeFileSync('validation100_summary.json',JSON.stringify(summary,null,2),'utf8');
const selected=[];for(const st of ['multi','trend','reversal'])for(const h of HORIZONS){selected.push(...all.filter(x=>x.strategy===st&&x.horizon===h).sort((x,y)=>y.end_date.localeCompare(x.end_date)||y.signal_date.localeCompare(x.signal_date)).slice(0,MAX_N))}
const csv=['strategy,horizon,ticker,signal_date,end_date,buy_price,end_price,return_pct,result,source'];for(const x of selected)csv.push([x.strategy,x.horizon,x.ticker,x.signal_date,x.end_date,x.buy_price,x.end_price,x.return_pct.toFixed(4),x.result,x.source].join(','));fs.writeFileSync('validation100_samples.csv',csv.join('\n')+'\n','utf8');
console.log(JSON.stringify(summary,null,2));
