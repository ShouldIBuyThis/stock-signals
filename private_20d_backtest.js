#!/usr/bin/env node
/**
 * PRIVATE 과거 +20거래일 백테스트
 * 현재 index.html의 evaluate() / multiSignalRank()를 직접 재사용.
 * 사이트 배포 파일은 수정하지 않는다.
 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const ROOT=process.cwd();
const INDEX=path.join(ROOT,'index.html');
const INPUT=path.join(ROOT,'private_20d_backtest_input.json');
function die(x){console.error('[ERROR]',x);process.exit(1);}
if(!fs.existsSync(INDEX)||!fs.existsSync(INPUT)) die('index.html 또는 입력 JSON이 없습니다.');
const src=fs.readFileSync(INDEX,'utf8');
const data=JSON.parse(fs.readFileSync(INPUT,'utf8'));

function extractFunction(src,name){
  const start=src.indexOf(`function ${name}(`); if(start<0) die(`${name} 없음`);
  const brace=src.indexOf('{',start); let depth=0,quote=null,esc=false,lc=false,bc=false;
  for(let i=brace;i<src.length;i++){
    const c=src[i],n=src[i+1];
    if(lc){if(c==='\n')lc=false;continue;} if(bc){if(c==='*'&&n==='/'){bc=false;i++;}continue;}
    if(quote){if(esc){esc=false;continue;} if(c==='\\'){esc=true;continue;} if(c===quote)quote=null;continue;}
    if(c==='/'&&n==='/'){lc=true;i++;continue;} if(c==='/'&&n==='*'){bc=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{')depth++; else if(c==='}'){depth--;if(depth===0)return src.slice(start,i+1);}
  } die(`${name} 끝 없음`);
}
function extractConst(src,name){
  const st=src.indexOf(`const ${name} =`); if(st<0) die(`${name} 없음`);
  const semi=src.indexOf(';',st); return src.slice(st,semi+1);
}
const multiHelpers=[
  'competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','strictMultiGate','previousOverallGrade'
].map(name=>extractFunction(src,name)).join('\n');
const ctx={console,Math,Number,Object,Array,Set,Map,String}; vm.createContext(ctx);
vm.runInContext(`
const has=v=>v!==null&&v!==undefined&&!Number.isNaN(v);
const r1=v=>has(v)?Math.round(v*10)/10:"—";
${extractConst(src,'LEVERAGED')}
const levX=tk=>(LEVERAGED[tk]?LEVERAGED[tk].x:1);
${extractFunction(src,'evaluate')}
${extractConst(src,'RANK_NONE')}
${multiHelpers}
${extractFunction(src,'multiSignalRank')}
this.E=evaluate; this.M=multiSignalRank;
`,ctx);
const evaluate=ctx.E, multiSignalRank=ctx.M;

const byTicker=new Map(), byDate=new Map();
for(const r of data.rows||[]){
  if(!byTicker.has(r.ticker))byTicker.set(r.ticker,[]);
  byTicker.get(r.ticker).push(r);
}
for(const arr of byTicker.values()){
  arr.sort((a,b)=>a.last_date.localeCompare(b.last_date));
  for(let i=0;i<arr.length;i++){
    const r=arr[i], p=i?arr[i-1]:null;
    if(p){
      r.prev_change_1d=p.change_1d; r.prev_vol_ratio=p.vol_ratio; r.prev_macd_hist=p.macd_hist;
      r.prev_price=p.price; r.prev_ma5=p.ma5; r.prev_ma20=p.ma20;
    }
    r.sig=evaluate(r);
    r._prevOverallGrade=p ? (p.sig?.grade||0) : 0;
    if(!byDate.has(r.last_date))byDate.set(r.last_date,[]);
    byDate.get(r.last_date).push(r);
  }
}

const priceMap=new Map();
for(const [tk,arr] of Object.entries(data.prices||{})){
  priceMap.set(tk,arr);
}
const earnMap=new Map(Object.entries(data.earnings_dates||{}).map(([k,v])=>[k,new Set(v)]));
const coverageMap=new Map(Object.entries(data.earnings_coverage||{}));

function endpoint(tk,signalDate,h=20){
  const arr=priceMap.get(tk)||[];
  const i=arr.findIndex(x=>x[0]===signalDate);
  if(i<0||i+h>=arr.length)return null;
  return {date:arr[i+h][0], price:Number(arr[i+h][1])};
}
function earningsTouched(tk,signalDate,endDate){
  const s=earnMap.get(tk); if(!s||!s.size)return false;
  for(const d of s) if(d>=signalDate&&d<=endDate)return true;
  return false;
}

const out={
  multi:{label:'다중 신호',samples:[],candidate:0,excluded:0,pending:0},
  pull:{label:'추세',samples:[],candidate:0,excluded:0,pending:0},
  rev:{label:'반등',samples:[],candidate:0,excluded:0,pending:0},
};
function add(kind,row){
  out[kind].candidate++;
  const cov=coverageMap.get(row.ticker);
  const isKR=(row.ticker||'').endsWith('.KS')||(row.ticker||'').endsWith('.KQ');
  // 미국 기업 중 coverage 미확인 종목은 실적 없음으로 간주하지 않고 표본 자체를 제외.
  // ETF(not_applicable_etf)는 기업 실적이 없으므로 정상 포함.
  if(!isKR && (!cov || cov.coverage==='unverified')){out[kind].excluded++;return;}
  const ep=endpoint(row.ticker,row.last_date,20);
  if(!ep){out[kind].pending++;return;}
  if(earningsTouched(row.ticker,row.last_date,ep.date)){out[kind].excluded++;return;}
  const ret=(ep.price/Number(row.price)-1)*100;
  out[kind].samples.push({kind,ticker:row.ticker,date:row.last_date,endDate:ep.date,buyPrice:Number(row.price),endPrice:ep.price,ret,hit:ret>0});
}

for(const arr of byTicker.values()){
  for(const r of arr){
    if((r.sig?.pullGrade||0)>=4)add('pull',r);
    if((r.sig?.revGrade||0)>=4)add('rev',r);
  }
}
for(const [d,u] of [...byDate.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
  const ranked=multiSignalRank(u);
  for(const r of ranked) if((r.sig?.grade||0)>=4)add('multi',r);
}

function stat(o){
  const n=o.samples.length,w=o.samples.filter(x=>x.hit).length,l=n-w;
  const rate=n?Math.round(w/n*100):null;
  const avg=n?o.samples.reduce((a,x)=>a+x.ret,0)/n:null;
  const med=n?[...o.samples].map(x=>x.ret).sort((a,b)=>a-b)[Math.floor((n-1)/2)]:null;
  return {...o,n,w,l,rate,avg,med};
}
const R={multi:stat(out.multi),pull:stat(out.pull),rev:stat(out.rev)};
const lines=[];
lines.push('PRIVATE 과거 +20거래일 백테스트');
lines.push(`생성: ${new Date().toISOString()}`);
lines.push(`신호 구간: ${data.signal_date_from} ~ ${data.signal_date_to} · 현재 산식 소급 적용`);
lines.push(`현재 main.py 원시지표 + 현재 index.html evaluate()/multiSignalRank() 직접 재사용`);
lines.push(`고정 실적 CSV로 실적 영향권 제외 · 미검증 종목 표본 제외 · 자동배포/사이트 수정 없음`);
const ecVals=Object.values(data.earnings_coverage||{});
const ecVerified=ecVals.filter(x=>x.coverage==='verified').length;
const ecUnverified=ecVals.filter(x=>x.coverage==='unverified').length;
const ecETF=ecVals.filter(x=>x.coverage==='not_applicable_etf').length;
const ecDates=Object.values(data.earnings_dates||{}).reduce((a,v)=>a+(v?.length||0),0);
lines.push(`고정 실적 CSV: verified ${ecVerified} · unverified ${ecUnverified} · ETF ${ecETF} · 실적 이벤트 ${ecDates}건`);
lines.push('unverified 종목은 실적 없음으로 간주하지 않고 백테스트 표본 자체에서 제외');
lines.push('');
for(const k of ['multi','pull','rev']){
  const s=R[k];
  lines.push(`[${s.label}] +20거래일`);
  lines.push(`  승률: ${s.rate===null?'—':s.rate+'%'} | 평균: ${s.avg===null?'—':(s.avg>=0?'+':'')+s.avg.toFixed(2)+'%'} | 중앙값: ${s.med===null?'—':(s.med>=0?'+':'')+s.med.toFixed(2)+'%'} | 표본 ${s.n}건 (성공 ${s.w} / 실패 ${s.l})`);
  lines.push(`  전체 후보 ${s.candidate} · 실적/미검증 제외 ${s.excluded} · +20 가격 미도래/누락 ${s.pending}`);
  lines.push('');
}
lines.push('주의: 이것은 현재 산식을 과거 데이터에 소급 적용한 백테스트입니다. 실제 운영 이후 쌓이는 전향검증과 구분해 해석하세요.');
if(Object.keys(data.failed_fetch||{}).length) lines.push(`데이터 수집 실패 티커: ${Object.keys(data.failed_fetch).join(', ')}`);
const report=lines.join('\n');
console.log('\n'+report+'\n');
fs.writeFileSync('private_20d_backtest_report.txt',report+'\n','utf8');

const samples=[...R.multi.samples,...R.pull.samples,...R.rev.samples].sort((a,b)=>a.date.localeCompare(b.date)||a.ticker.localeCompare(b.ticker));
const csv=['strategy,ticker,signal_date,end_date,buy_price,end_price,return_pct,result'];
const label={multi:'multi',pull:'trend',rev:'reversal'};
for(const x of samples)csv.push([label[x.kind],x.ticker,x.date,x.endDate,x.buyPrice,x.endPrice,x.ret.toFixed(4),x.hit?'WIN':'LOSS'].join(','));
fs.writeFileSync('private_20d_backtest_samples.csv',csv.join('\n')+'\n','utf8');
