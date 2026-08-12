#!/usr/bin/env node
/**
 * 현행 산식 최근검증 v2
 * - 현재 index.html evaluate()/multiSignalRank() 직접 재사용
 * - 초기 raw seed + 매일 signals.json 최근 hist를 ticker/date로 병합해 ledger에 영구 누적
 * - +1/+3/+5, WIN > +1%, FLAT ±1%, LOSS < -1%
 * - BMO/AMC/UNKNOWN별 blocked signal / affected close를 구분
 * - 전략×기간 최근 유효 최대 100건
 */
const fs=require('fs'), vm=require('vm');
const INDEX='index.html', INPUT='validation100_input.json', SIGNALS='signals.json';
const HORIZONS=[1,3,5], MAX_N=100, FLAT=1.0, LEDGER_DAYS=80;
function die(x){console.error('[ERROR]',x);process.exit(1)}
for(const f of [INDEX,INPUT,SIGNALS]) if(!fs.existsSync(f)) die(`${f} 없음`);
const src=fs.readFileSync(INDEX,'utf8'), data=JSON.parse(fs.readFileSync(INPUT,'utf8')), signals=JSON.parse(fs.readFileSync(SIGNALS,'utf8'));
function extractFunction(src,name){const st=src.indexOf(`function ${name}(`);if(st<0)die(`${name} 없음`);const b=src.indexOf('{',st);let d=0,q=null,e=false,lc=false,bc=false;for(let i=b;i<src.length;i++){const c=src[i],n=src[i+1];if(lc){if(c==='\n')lc=false;continue}if(bc){if(c==='*'&&n==='/'){bc=false;i++}continue}if(q){if(e){e=false;continue}if(c==='\\'){e=true;continue}if(c===q)q=null;continue}if(c==='/'&&n==='/'){lc=true;i++;continue}if(c==='/'&&n==='*'){bc=true;i++;continue}if(c==='"'||c==="'"||c==='`'){q=c;continue}if(c==='{')d++;else if(c==='}'){d--;if(d===0)return src.slice(st,i+1)}}die(`${name} 끝 없음`)}
function extractConst(src,name){const st=src.indexOf(`const ${name} =`);if(st<0)die(`${name} 없음`);const semi=src.indexOf(';',st);return src.slice(st,semi+1)}
const ctx={console,Math,Number,Object,Array,Set,Map,String};vm.createContext(ctx);vm.runInContext(`const has=v=>v!==null&&v!==undefined&&!Number.isNaN(v);const r1=v=>has(v)?Math.round(v*10)/10:"—";${extractConst(src,'LEVERAGED')}const levX=tk=>(LEVERAGED[tk]?LEVERAGED[tk].x:1);${extractFunction(src,'evaluate')}${extractFunction(src,'multiSignalRank')}this.E=evaluate;this.M=multiSignalRank;`,ctx);
const evaluate=ctx.E, multiSignalRank=ctx.M;
const fields=signals.hist_fields||[];
const marketHist=new Map(((signals.market||{}).hist||[]).filter(x=>Array.isArray(x)&&x[0]).map(x=>[String(x[0]),{level:x[1]||'neutral',ret20:Number.isFinite(Number(x[3]))?Number(x[3]):null}]));
const currentStocks=signals.stocks||signals.items||[];
const stockMeta=new Map(currentStocks.map(s=>[s.ticker,s]));
function histObj(a){const o={};fields.forEach((k,i)=>o[k]=a?.[i]??null);return o}
function recentRow(s,a){const o=histObj(a), mh=marketHist.get(String(o.date));const kr=/\.(KS|KQ)$/.test(s.ticker);return {ticker:s.ticker,name:s.name,category:s.category,currency:s.currency,last_date:String(o.date||''),price:o.price,change_1d:o.change_1d,ma5:o.ma5,ma10:o.ma10,ma20:o.ma20,ma50:o.ma50,ma60:o.ma60,rsi:o.rsi,macd_hist:o.macd_hist,macd:o.macd_hist,macd_cross:o.macd_cross||'none',macd_zero:o.macd_zero||'above',bb_pos:o.bb_pos,stoch_k:o.stoch_k,stoch_d:o.stoch_d,stoch_cross:o.stoch_cross||'none',vol_ratio:o.vol_ratio,near_high:!!o.near_high,pct_from_high:o.pct_from_high,ma20_slope:o.ma20_slope,run5_max:o.run5_max,run3_sum:o.run3_sum,range3:o.range3,range10:o.range10,vol3_ratio:o.vol3_ratio,res_short:o.res_short,ret20:o.ret20,rs20:o.rs20,atr_pct:o.atr_pct,market_level:kr?'neutral':(mh?.level||s.market_level||'neutral'),market_weak:kr?false:['weak','caution'].includes(mh?.level||s.market_level),market_ret20:kr?null:(mh?.ret20??null),_source:'RECENT_HIST'}}
// ledger merge: recent hist wins for same ticker/date.
const ledger=new Map();for(const r of data.rows||[]){if(r?.ticker&&r?.last_date) ledger.set(`${r.ticker}|${r.last_date}`,{...r,_source:r._source||'BACKTEST'})}
for(const s of currentStocks) for(const a of s.hist||[]){const r=recentRow(s,a);if(r.last_date) ledger.set(`${r.ticker}|${r.last_date}`,r)}
// keep bounded by latest 80 distinct signal dates.
const dates=[...new Set([...ledger.values()].map(r=>r.last_date).filter(Boolean))].sort();const keepDates=new Set(dates.slice(-LEDGER_DAYS));let rows=[...ledger.values()].filter(r=>keepDates.has(r.last_date));
// prices: merge persisted map + latest hist prices.
const priceMap=new Map(Object.entries(data.prices||{}).map(([tk,a])=>[tk,new Map((a||[]).map(x=>[String(x[0]),Number(x[1])]))]));
for(const s of currentStocks){if(!priceMap.has(s.ticker))priceMap.set(s.ticker,new Map());const m=priceMap.get(s.ticker);for(const a of s.hist||[]){const o=histObj(a);if(o.date&&Number.isFinite(Number(o.price)))m.set(String(o.date),Number(o.price))}}
function sortedPrices(tk){return [...(priceMap.get(tk)||new Map())].filter(x=>Number.isFinite(x[1])).sort((a,b)=>a[0].localeCompare(b[0]))}
// earnings: merge fixed history + current signals event metadata. Never query external calendar here.
const earnDates=new Map(Object.entries(data.earnings_dates||{}).map(([tk,a])=>[tk,new Set((a||[]).map(String))]));const timing={...(data.earnings_timing||{})};
for(const s of currentStocks){const e=s.earnings;if(e?.date){if(!earnDates.has(s.ticker))earnDates.set(s.ticker,new Set());earnDates.get(s.ticker).add(String(e.date));timing[`${s.ticker}|${e.date}`]=(e.timing||'UNKNOWN').toUpperCase()}}
const frozenBlocked=new Map(), frozenAffected=new Map();for(const s of currentStocks){if(Array.isArray(s.validation_blocked_dates))frozenBlocked.set(s.ticker,new Set(s.validation_blocked_dates.map(String)));if(Array.isArray(s.validation_affected_dates))frozenAffected.set(s.ticker,new Set(s.validation_affected_dates.map(String)))}
function windows(tk){const ps=sortedPrices(tk), ds=ps.map(x=>x[0]), blocked=new Set(frozenBlocked.get(tk)||[]), affected=new Set(frozenAffected.get(tk)||[]);for(const ed of earnDates.get(tk)||[]){const i=ds.indexOf(ed);if(i<0)continue;const t=(timing[`${tk}|${ed}`]||'UNKNOWN').toUpperCase();if(i-1>=0)blocked.add(ds[i-1]);blocked.add(ds[i]);if(t==='BMO'){affected.add(ds[i])}else if(t==='AMC'){if(i+1<ds.length){blocked.add(ds[i+1]);affected.add(ds[i+1])}}else{affected.add(ds[i]);if(i+1<ds.length){blocked.add(ds[i+1]);affected.add(ds[i+1])}}}return {blocked,affected,prices:ps}}
const winCache=new Map();function W(tk){if(!winCache.has(tk))winCache.set(tk,windows(tk));return winCache.get(tk)}
const byTicker=new Map();for(const r of rows){if(!byTicker.has(r.ticker))byTicker.set(r.ticker,[]);byTicker.get(r.ticker).push(r)}
const byDate=new Map();for(const [tk,a] of byTicker){a.sort((x,y)=>x.last_date.localeCompare(y.last_date));for(let i=0;i<a.length;i++){const r=a[i],p=i?a[i-1]:null;for(const k of ['prev_change_1d','prev_vol_ratio','prev_macd_hist','prev_price','prev_ma5','prev_ma20'])delete r[k];if(p){r.prev_change_1d=p.change_1d;r.prev_vol_ratio=p.vol_ratio;r.prev_macd_hist=p.macd_hist??p.macd;r.prev_price=p.price;r.prev_ma5=p.ma5;r.prev_ma20=p.ma20}r.macd=r.macd_hist??r.macd;try{r.sig=evaluate(r)}catch(e){continue}if(!byDate.has(r.last_date))byDate.set(r.last_date,[]);byDate.get(r.last_date).push(r)}}
function endpoint(tk,d,h){const ps=W(tk).prices,i=ps.findIndex(x=>x[0]===d);return(i<0||i+h>=ps.length)?null:{date:ps[i+h][0],price:ps[i+h][1],i,ps}}
function touchesAffected(tk,i,h,ps){const a=W(tk).affected;for(let j=i+1;j<=Math.min(i+h,ps.length-1);j++)if(a.has(ps[j][0]))return true;return false}
function result(ret){return ret>FLAT?'WIN':ret<-FLAT?'LOSS':'FLAT'}
const coverage=new Map(Object.entries(data.earnings_coverage||{}));
function coverageOK(tk){if(/\.(KS|KQ)$/.test(tk))return true;const c=coverage.get(tk);return !!c && ['verified','not_applicable_etf'].includes(String(c.coverage||''))}
const samples=[];function add(st,r,h){if(!coverageOK(r.ticker))return;const w=W(r.ticker);if(w.blocked.has(r.last_date))return;const ep=endpoint(r.ticker,r.last_date,h);if(!ep)return;if(touchesAffected(r.ticker,ep.i,h,ep.ps))return;const ret=(ep.price/Number(r.price)-1)*100;samples.push({strategy:st,horizon:h,ticker:r.ticker,signal_date:r.last_date,end_date:ep.date,buy_price:Number(r.price),end_price:ep.price,return_pct:ret,result:result(ret),source:r._source||'BACKTEST'})}
for(const a of byTicker.values())for(const r of a)for(const h of HORIZONS){if((r.sig?.pullGrade||0)>=4)add('trend',r,h);if((r.sig?.revGrade||0)>=4)add('reversal',r,h)}
for(const [d,u0] of [...byDate].sort((a,b)=>a[0].localeCompare(b[0]))){const universe=u0.filter(r=>coverageOK(r.ticker)&&!W(r.ticker).blocked.has(d));for(const r of multiSignalRank(universe))if((r.sig?.grade||0)>=4)for(const h of HORIZONS)add('multi',r,h)}
const dedup=new Map();for(const x of samples){const k=[x.strategy,x.horizon,x.ticker,x.signal_date].join('|');const old=dedup.get(k);if(!old||x.source==='RECENT_HIST')dedup.set(k,x)}const all=[...dedup.values()];
const summary={generated_at:new Date().toISOString(),rule:{max_valid_samples:MAX_N,flat_band_pct:FLAT,horizons:HORIZONS,ledger_days:LEDGER_DAYS},strategies:{}};const selected=[];
for(const st of ['multi','trend','reversal']){summary.strategies[st]={};for(const h of HORIZONS){const a=all.filter(x=>x.strategy===st&&x.horizon===h).sort((x,y)=>y.end_date.localeCompare(x.end_date)||y.signal_date.localeCompare(x.signal_date)).slice(0,MAX_N);selected.push(...a);const win=a.filter(x=>x.result==='WIN').length,flat=a.filter(x=>x.result==='FLAT').length,loss=a.filter(x=>x.result==='LOSS').length,dec=win+loss;summary.strategies[st][h]={n:a.length,win,flat,loss,directional_rate:dec?Math.round(win/dec*1000)/10:null,avg_return:a.length?Math.round(a.reduce((z,x)=>z+x.return_pct,0)/a.length*100)/100:null,recent_hist:a.filter(x=>x.source==='RECENT_HIST').length,backtest:a.filter(x=>x.source!=='RECENT_HIST').length}}}
fs.writeFileSync('validation100_summary.json',JSON.stringify(summary,null,2));const csv=['strategy,horizon,ticker,signal_date,end_date,buy_price,end_price,return_pct,result,source'];for(const x of selected)csv.push([x.strategy,x.horizon,x.ticker,x.signal_date,x.end_date,x.buy_price,x.end_price,x.return_pct.toFixed(4),x.result,x.source].join(','));fs.writeFileSync('validation100_samples.csv',csv.join('\n')+'\n');
// Persist raw ledger/prices/events so future rows survive after signals.json 10-day hist rolls off.
data.rows=rows.map(({sig,...r})=>r);data.prices=Object.fromEntries([...priceMap].map(([tk,m])=>[tk,[...m].sort((a,b)=>a[0].localeCompare(b[0]))]));data.earnings_dates=Object.fromEntries([...earnDates].map(([tk,s])=>[tk,[...s].sort()]));data.earnings_timing=timing;data.last_ledger_update=new Date().toISOString();fs.writeFileSync(INPUT,JSON.stringify(data));
console.log(JSON.stringify(summary,null,2));
