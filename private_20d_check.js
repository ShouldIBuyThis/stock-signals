#!/usr/bin/env node
/**
 * PRIVATE +20 거래일 검증기
 * ---------------------------------------------
 * - 배포 파일(main.py / index.html / signals.json / history/)을 수정하지 않습니다.
 * - 현재 index.html의 evaluate() / multiSignalRank()를 그대로 읽어 재사용합니다.
 * - history/us, history/kr 일자별 원장을 읽어 +20거래일 성과만 별도로 계산합니다.
 * - 결과는 private_20d_report.txt / private_20d_samples.csv 로만 저장합니다.
 *
 * 사용: 저장소 루트에서 `node private_20d_check.js`
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();
const INDEX = path.join(ROOT, 'index.html');
const SIGNALS = path.join(ROOT, 'signals.json');
const HORIZON = 20;

function die(msg){ console.error('\n[ERROR]', msg); process.exit(1); }
function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function exists(p){ return fs.existsSync(p); }
function num(v){ const n=Number(v); return Number.isFinite(n)?n:null; }

if(!exists(INDEX)) die('index.html이 없습니다. 저장소 루트에서 실행하세요.');
if(!exists(SIGNALS)) die('signals.json이 없습니다. 먼저 정상 갱신 후 실행하세요.');

const indexSrc = fs.readFileSync(INDEX, 'utf8');
const signals = readJson(SIGNALS);

// 중괄호 깊이를 세어 함수 하나를 원문 그대로 꺼낸다.
function extractFunction(src, name){
  const start = src.indexOf(`function ${name}(`);
  if(start < 0) die(`index.html에서 function ${name}()를 찾지 못했습니다.`);
  const brace = src.indexOf('{', start);
  if(brace < 0) die(`${name}() 시작 중괄호를 찾지 못했습니다.`);
  let depth=0, quote=null, esc=false, lineComment=false, blockComment=false;
  for(let i=brace;i<src.length;i++){
    const c=src[i], n=src[i+1];
    if(lineComment){ if(c==='\n') lineComment=false; continue; }
    if(blockComment){ if(c==='*'&&n==='/'){ blockComment=false; i++; } continue; }
    if(quote){
      if(esc){ esc=false; continue; }
      if(c==='\\'){ esc=true; continue; }
      if(c===quote) quote=null;
      continue;
    }
    if(c==='/'&&n==='/'){ lineComment=true; i++; continue; }
    if(c==='/'&&n==='*'){ blockComment=true; i++; continue; }
    if(c==='"'||c==="'"||c==='`'){ quote=c; continue; }
    if(c==='{') depth++;
    else if(c==='}'){
      depth--;
      if(depth===0) return src.slice(start, i+1);
    }
  }
  die(`${name}() 끝을 찾지 못했습니다.`);
}

function extractConstObject(src, name){
  const marker = `const ${name} =`;
  const start = src.indexOf(marker);
  if(start < 0) die(`index.html에서 ${marker} 를 찾지 못했습니다.`);
  const semi = src.indexOf(';', start);
  if(semi < 0) die(`${name} 선언 끝을 찾지 못했습니다.`);
  return src.slice(start, semi+1);
}

const evaluateSrc = extractFunction(indexSrc, 'evaluate');
const multiSrc = extractFunction(indexSrc, 'multiSignalRank');
const leveragedSrc = extractConstObject(indexSrc, 'LEVERAGED');

// 현재 index.html 산식을 직접 실행한다. 산식을 Python/별도 JS로 복제하지 않는다.
const ctx = { console, Math, Number, Object, Array, Set, Map, String };
vm.createContext(ctx);
vm.runInContext(`
  const has = v => v !== null && v !== undefined && !Number.isNaN(v);
  const r1 = v => has(v) ? Math.round(v*10)/10 : "—";
  ${leveragedSrc}
  const levX = tk => (LEVERAGED[tk] ? LEVERAGED[tk].x : 1);
  ${evaluateSrc}
  ${multiSrc}
  this.__evaluate = evaluate;
  this.__multiSignalRank = multiSignalRank;
`, ctx);
const evaluate = ctx.__evaluate;
const multiSignalRank = ctx.__multiSignalRank;

function listHistoryFiles(region){
  const dir = path.join(ROOT, 'history', region);
  if(!exists(dir)) return [];
  return fs.readdirSync(dir)
    .filter(x=>/^\d{4}-\d{2}-\d{2}\.json$/.test(x))
    .sort()
    .map(x=>path.join(dir,x));
}

const files = [...listHistoryFiles('us'), ...listHistoryFiles('kr')];
if(!files.length) die('history/us 또는 history/kr에 일자별 JSON이 없습니다.');

const earningsByTicker = new Map();
for(const s of (signals.stocks||[])) if(s && s.ticker && s.earnings) earningsByTicker.set(s.ticker, s.earnings);

// history snapshot -> 날짜/티커 원장
const byTicker = new Map();
const byDate = new Map();
const seen = new Set();
for(const f of files){
  let snap;
  try{ snap=readJson(f); }catch(e){ console.warn('[WARN] 읽기 실패:', f, e.message); continue; }
  for(const raw of (snap.stocks||[])){
    if(!raw || !raw.ticker || !raw.last_date || !num(raw.price)) continue;
    const key=`${raw.ticker}|${raw.last_date}`;
    if(seen.has(key)) continue;
    seen.add(key);
    const row={...raw, earnings: earningsByTicker.get(raw.ticker)||null};
    row.sig=evaluate(row);
    if(!byTicker.has(row.ticker)) byTicker.set(row.ticker,[]);
    byTicker.get(row.ticker).push(row);
    if(!byDate.has(row.last_date)) byDate.set(row.last_date,[]);
    byDate.get(row.last_date).push(row);
  }
}
for(const a of byTicker.values()) a.sort((a,b)=>String(a.last_date).localeCompare(String(b.last_date)));

// 현재 화면 검증의 earnings window 규칙을 +20에도 그대로 적용.
function earningsWindowsForValidation(s, hs){
  const blocked=new Set(), affected=new Set(), e=s.earnings||{};
  if(!e.date||!hs||!hs.length) return {blocked,affected};
  const metaB=Array.isArray(e.blocked_signal_dates)?e.blocked_signal_dates:[];
  const metaA=Array.isArray(e.affected_close_dates)?e.affected_close_dates:[];
  if(metaB.length||metaA.length){ metaB.forEach(d=>blocked.add(d)); metaA.forEach(d=>affected.add(d)); return {blocked,affected}; }
  const i=hs.findIndex(x=>x.last_date===e.date);
  if(i<0) return {blocked,affected};
  if(i-1>=0) blocked.add(hs[i-1].last_date);
  blocked.add(hs[i].last_date);
  if(e.timing==='BMO') affected.add(hs[i].last_date);
  else if(e.timing==='AMC'){
    if(i+1<hs.length){ blocked.add(hs[i+1].last_date); affected.add(hs[i+1].last_date); }
  }else{
    affected.add(hs[i].last_date);
    if(i+1<hs.length){ blocked.add(hs[i+1].last_date); affected.add(hs[i+1].last_date); }
  }
  return {blocked,affected};
}
function windowTouches(affected, hs, i, h){
  if(!affected || !affected.size) return false;
  const end=Math.min(i+h,hs.length-1);
  for(let j=i+1;j<=end;j++) if(affected.has(hs[j].last_date)) return true;
  return false;
}

const stats={
  multi:{label:'다중 신호',samples:[],pending:0,excluded:0,candidate:0},
  pull:{label:'추세',samples:[],pending:0,excluded:0,candidate:0},
  rev:{label:'반등',samples:[],pending:0,excluded:0,candidate:0}
};

// 티커별 추세/반등 +20
for(const [ticker,hs] of byTicker){
  const ew=earningsWindowsForValidation(hs[hs.length-1]||{},hs);
  for(let i=0;i<hs.length;i++){
    const row=hs[i];
    if(ew.blocked.has(row.last_date)) continue;
    for(const [kind,gradeKey] of [['pull','pullGrade'],['rev','revGrade']]){
      if((row.sig?.[gradeKey]||0)<4) continue;
      stats[kind].candidate++;
      if(i+HORIZON>=hs.length){ stats[kind].pending++; continue; }
      if(windowTouches(ew.affected,hs,i,HORIZON)){ stats[kind].excluded++; continue; }
      const end=hs[i+HORIZON];
      const ret=(Number(end.price)/Number(row.price)-1)*100;
      stats[kind].samples.push({kind,ticker,date:row.last_date,endDate:end.last_date,buyPrice:Number(row.price),endPrice:Number(end.price),ret,hit:ret>0});
    }
  }
}

// 날짜별 다중신호 선정 후 +20
for(const [date,universe0] of [...byDate.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
  // 신호일 자체가 실적 blocked인 종목은 현재 strategyValidation과 동일하게 universe에서 제외
  const universe=universe0.filter(row=>{
    const hs=byTicker.get(row.ticker)||[];
    const ew=earningsWindowsForValidation(row,hs);
    return !ew.blocked.has(date);
  });
  const ranked=multiSignalRank(universe);
  for(const sel of ranked){
    if((sel.sig?.grade||0)<4) continue;
    stats.multi.candidate++;
    const hs=byTicker.get(sel.ticker)||[];
    const i=hs.findIndex(x=>x.last_date===date);
    if(i<0 || i+HORIZON>=hs.length){ stats.multi.pending++; continue; }
    const ew=earningsWindowsForValidation(sel,hs);
    if(windowTouches(ew.affected,hs,i,HORIZON)){ stats.multi.excluded++; continue; }
    const end=hs[i+HORIZON];
    const ret=(Number(end.price)/Number(sel.price)-1)*100;
    stats.multi.samples.push({kind:'multi',ticker:sel.ticker,date,endDate:end.last_date,buyPrice:Number(sel.price),endPrice:Number(end.price),ret,hit:ret>0});
  }
}

function summarize(o){
  const n=o.samples.length, wins=o.samples.filter(x=>x.hit).length, losses=n-wins;
  const rate=n?Math.round(wins/n*100):null;
  const avg=n?o.samples.reduce((a,x)=>a+x.ret,0)/n:null;
  const med=n?[...o.samples].map(x=>x.ret).sort((a,b)=>a-b)[Math.floor((n-1)/2)]:null;
  return {...o,n,wins,losses,rate,avg,med};
}

const result={multi:summarize(stats.multi),pull:summarize(stats.pull),rev:summarize(stats.rev)};
const lines=[];
lines.push('PRIVATE +20 거래일 검증');
lines.push(`생성: ${new Date().toISOString()}`);
lines.push(`원장: ${files.length}개 파일 / ${byTicker.size}종목 / ${byDate.size}거래일 날짜`);
lines.push('현재 index.html의 evaluate() + multiSignalRank()를 직접 재사용 (배포 로직 수정 없음)');
lines.push('');
for(const k of ['multi','pull','rev']){
  const s=result[k];
  lines.push(`[${s.label}] +20거래일`);
  lines.push(`  승률: ${s.rate===null?'—':s.rate+'%'}  | 평균: ${s.avg===null?'—':(s.avg>=0?'+':'')+s.avg.toFixed(2)+'%'}  | 표본: ${s.n}건 (성공 ${s.wins} / 실패 ${s.losses})`);
  lines.push(`  전체 후보 ${s.candidate} · 아직 +20 미도래 ${s.pending} · 실적 영향권 제외 ${s.excluded}`);
  lines.push('');
}
lines.push('주의: history 원장이 20거래일 이상 쌓이기 전에는 표본이 0이거나 매우 적을 수 있습니다.');
lines.push('실적 제외는 현재 signals.json에 보존된 earnings 메타데이터가 커버하는 범위에서 적용됩니다.');

const report=lines.join('\n');
console.log('\n'+report+'\n');
fs.writeFileSync(path.join(ROOT,'private_20d_report.txt'), report+'\n', 'utf8');

const allSamples=[...result.multi.samples,...result.pull.samples,...result.rev.samples]
  .sort((a,b)=>a.date.localeCompare(b.date)||a.ticker.localeCompare(b.ticker));
const csv=['strategy,ticker,signal_date,end_date,buy_price,end_price,return_pct,result'];
const label={multi:'multi',pull:'trend',rev:'reversal'};
for(const x of allSamples){
  csv.push([label[x.kind],x.ticker,x.date,x.endDate,x.buyPrice,x.endPrice,x.ret.toFixed(4),x.hit?'WIN':'LOSS'].join(','));
}
fs.writeFileSync(path.join(ROOT,'private_20d_samples.csv'), csv.join('\n')+'\n','utf8');

console.log('[완료] private_20d_report.txt');
console.log('[완료] private_20d_samples.csv');
