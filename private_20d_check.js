#!/usr/bin/env node
/**
 * PRIVATE +20 거래일 검증기 v2
 * ------------------------------------------------------------
 * 읽기 전용. 배포 파일(main.py/index.html/signals.json/history/) 수정 없음.
 *
 * v2 핵심:
 * 1) signals.json 안의 각 종목 최근 hist(최대 약 10거래일)를 먼저 원장으로 사용
 * 2) history/us, history/kr 일자별 스냅샷을 합침
 * 3) ticker+date 중복은 history 스냅샷을 우선해 덮어씀
 * 4) 현재 index.html의 evaluate() / multiSignalRank()를 그대로 읽어 재사용
 * 5) +20거래일 결과만 private_20d_report.txt / private_20d_samples.csv 로 생성
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
const rankNoneSrc = extractConstObject(indexSrc, 'RANK_NONE');
const multiHelpers = [
  'competitionRank', 'strategyOrdinalRank', 'volumeOrdinalRank', 'rankMapsFor', 'rankOf',
  'generalMultiGate', 'strictMultiGate', 'previousOverallGrade'
].map(name => extractFunction(indexSrc, name)).join('\n');

const ctx = { console, Math, Number, Object, Array, Set, Map, String };
vm.createContext(ctx);
vm.runInContext(`
  const has = v => v !== null && v !== undefined && !Number.isNaN(v);
  const r1 = v => has(v) ? Math.round(v*10)/10 : "—";
  ${leveragedSrc}
  const levX = tk => (LEVERAGED[tk] ? LEVERAGED[tk].x : 1);
  ${evaluateSrc}
  ${rankNoneSrc}
  ${multiHelpers}
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

const historyFiles = [...listHistoryFiles('us'), ...listHistoryFiles('kr')];
const histFields = Array.isArray(signals.hist_fields) ? signals.hist_fields : [];
const marketHist = Array.isArray(signals.market?.hist) ? signals.market.hist : [];

function marketForDate(date, fallbackLevel='neutral'){
  const md = marketHist.find(x=>Array.isArray(x) && String(x[0])===String(date));
  if(Array.isArray(md)){
    return {
      level: md.length>=2 ? (md[1]||fallbackLevel) : fallbackLevel,
      ret20: md.length>=4 ? num(md[3]) : num(signals.market?.ret20)
    };
  }
  return {level:fallbackLevel, ret20:num(signals.market?.ret20)};
}

// ticker|date -> row. signals hist를 먼저 넣고 history snapshot이 있으면 나중에 덮어쓴다.
const rowsByKey = new Map();
const earningsByTicker = new Map();
for(const s of (signals.stocks||[])){
  if(!s?.ticker) continue;
  if(s.earnings) earningsByTicker.set(s.ticker, s.earnings);

  const h = Array.isArray(s.hist) ? s.hist : [];
  if(!h.length || !histFields.length) continue;

  const decoded=[];
  for(const arr of h){
    if(!Array.isArray(arr)) continue;
    const o={}; histFields.forEach((k,i)=>o[k]=arr[i]);
    const date=o.date || o.last_date;
    const price=num(o.price);
    if(!date || price===null || price===0) continue;
    const mk=marketForDate(date, s.market_level||signals.market?.level||'neutral');
    decoded.push({
      ticker:s.ticker, name:s.name, category:s.category,
      last_date:String(date), price,
      change_1d:num(o.change_1d), volume:num(o.volume), vol_ratio:num(o.vol_ratio),
      ma5:num(o.ma5), ma10:num(o.ma10), ma20:num(o.ma20), ma50:num(o.ma50), ma60:num(o.ma60),
      rsi:num(o.rsi), macd_hist:num(o.macd_hist), macd:num(o.macd_hist),
      macd_cross:o.macd_cross||'none', macd_zero:o.macd_zero||'above',
      bb_pos:num(o.bb_pos), stoch_k:num(o.stoch_k), stoch_d:num(o.stoch_d), stoch_cross:o.stoch_cross||'none',
      near_high:!!o.near_high, pct_from_high:num(o.pct_from_high), atr_pct:num(o.atr_pct),
      ma20_slope:num(o.ma20_slope), run5_max:num(o.run5_max), run3_sum:num(o.run3_sum),
      range3:num(o.range3), range10:num(o.range10), vol3_ratio:num(o.vol3_ratio),
      res_short:num(o.res_short), ret20:num(o.ret20), rs20:num(o.rs20),
      market_level: s.ticker.endsWith('.KS')||s.ticker.endsWith('.KQ') ? 'neutral' : mk.level,
      market_weak: !(s.ticker.endsWith('.KS')||s.ticker.endsWith('.KQ')) && (mk.level==='weak'||mk.level==='caution'),
      market_ret20: mk.ret20,
      earnings:s.earnings||null,
      __source:'signals.hist'
    });
  }

  // 현재 화면 withPrev()와 같은 전일 보조값을 붙인다.
  decoded.sort((a,b)=>a.last_date.localeCompare(b.last_date));
  for(let i=0;i<decoded.length;i++){
    const row=decoded[i], prev=i?decoded[i-1]:null;
    if(prev){
      row.prev_change_1d=prev.change_1d;
      row.prev_vol_ratio=prev.vol_ratio;
      row.prev_macd_hist=prev.macd_hist;
      row.prev_price=prev.price;
      row.prev_ma5=prev.ma5;
      row.prev_ma20=prev.ma20;
    }
    rowsByKey.set(`${row.ticker}|${row.last_date}`, row);
  }
}

const signalHistRowCount = rowsByKey.size;

// 일자별 history 스냅샷을 합친다. 같은 ticker/date면 이쪽이 당시 저장된 원장이므로 우선.
let snapshotRows=0;
for(const f of historyFiles){
  let snap;
  try{ snap=readJson(f); }catch(e){ console.warn('[WARN] 읽기 실패:', f, e.message); continue; }
  for(const raw of (snap.stocks||[])){
    if(!raw?.ticker || !raw?.last_date || num(raw.price)===null || num(raw.price)===0) continue;
    const row={...raw};
    row.price=num(row.price);
    row.macd = num(row.macd_hist ?? row.macd);
    row.earnings = earningsByTicker.get(row.ticker)||row.earnings||null;
    row.__source='history.snapshot';
    rowsByKey.set(`${row.ticker}|${row.last_date}`, row);
    snapshotRows++;
  }
}

const byTicker = new Map(), byDate = new Map();
for(const row of rowsByKey.values()){
  try{ row.sig=evaluate(row); }
  catch(e){ console.warn('[WARN] evaluate 실패:', row.ticker, row.last_date, e.message); continue; }
  if(!byTicker.has(row.ticker)) byTicker.set(row.ticker,[]);
  byTicker.get(row.ticker).push(row);
  if(!byDate.has(row.last_date)) byDate.set(row.last_date,[]);
  byDate.get(row.last_date).push(row);
}
for(const a of byTicker.values()){
  a.sort((x,y)=>x.last_date.localeCompare(y.last_date));
  // previousOverallGrade()가 브라우저 histStocks()에 의존하지 않도록
  // 같은 원장의 직전 거래일 등급을 명시적으로 고정한다.
  for(let i=0;i<a.length;i++) a[i]._prevOverallGrade=i ? (a[i-1].sig?.grade||0) : 0;
}

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

for(const [ticker,hs] of byTicker){
  for(let i=0;i<hs.length;i++){
    const row=hs[i];
    const ew=earningsWindowsForValidation(row,hs);
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

for(const [date,universe0] of [...byDate.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
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
  return {...o,n,wins,losses,rate,avg};
}
const result={multi:summarize(stats.multi),pull:summarize(stats.pull),rev:summarize(stats.rev)};

const dates=[...byDate.keys()].sort();
const lines=[];
lines.push('PRIVATE +20 거래일 검증 v2');
lines.push(`생성: ${new Date().toISOString()}`);
lines.push(`통합 원장: ${byTicker.size}종목 / ${byDate.size}거래일 날짜 (${dates[0]||'—'} ~ ${dates[dates.length-1]||'—'})`);
lines.push(`signals.json hist 기반 ${signalHistRowCount}개 ticker-date + history snapshot ${snapshotRows}행 병합`);
lines.push(`history 파일: ${historyFiles.length}개 · 중복 ticker-date는 history snapshot 우선`);
lines.push('현재 index.html의 evaluate() + multiSignalRank() 직접 재사용 (배포 로직 수정 없음)');
lines.push('');
for(const k of ['multi','pull','rev']){
  const s=result[k];
  lines.push(`[${s.label}] +20거래일`);
  lines.push(`  승률: ${s.rate===null?'—':s.rate+'%'}  | 평균: ${s.avg===null?'—':(s.avg>=0?'+':'')+s.avg.toFixed(2)+'%'}  | 표본: ${s.n}건 (성공 ${s.wins} / 실패 ${s.losses})`);
  lines.push(`  전체 후보 ${s.candidate} · 아직 +20 미도래 ${s.pending} · 실적 영향권 제외 ${s.excluded}`);
  lines.push('');
}
lines.push('주의: 기존 10거래일 hist를 활용하므로 v1보다 과거 후보를 더 빨리 확보합니다.');
lines.push('다만 +20 결과는 신호일 이후 실제 20거래일 종가가 존재해야 확정됩니다.');
lines.push('실적 제외는 현재 signals.json의 earnings 메타데이터가 커버하는 범위에서 적용됩니다.');

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
