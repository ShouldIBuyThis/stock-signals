#!/usr/bin/env node
/**
 * PRIVATE 시장국면별 승률 표 (읽기 전용)
 *
 * 신호일의 market_level(강세/중립/주의/약세)별로 각 전략의 승률과
 * 같은 국면 기준선(그 국면일에 전 종목 매수)·초과 %p를 찍는다.
 * 산식은 index.html에서 추출한 배포 원본 그대로 (§0).
 *
 * 사용: 저장소 루트에서 `node tools/phase-table.js`
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
const base = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'signals.json'), 'utf8'));

function die(m){ console.error('[ERROR]', m); process.exit(1); }
function extractFunction(name){
  const start = src.indexOf(`function ${name}(`);
  if(start < 0) die(`function ${name}() 없음`);
  const brace = src.indexOf('{', start);
  let depth=0, quote=null, esc=false, lc=false, bc=false;
  for(let i=brace;i<src.length;i++){
    const c=src[i], n=src[i+1];
    if(lc){ if(c==='\n') lc=false; continue; }
    if(bc){ if(c==='*'&&n==='/'){ bc=false; i++; } continue; }
    if(quote){ if(esc){esc=false;continue;} if(c==='\\'){esc=true;continue;} if(c===quote)quote=null; continue; }
    if(c==='/'&&n==='/'){ lc=true; i++; continue; }
    if(c==='/'&&n==='*'){ bc=true; i++; continue; }
    if(c==='"'||c==="'"||c==='`'){ quote=c; continue; }
    if(c==='{') depth++;
    else if(c==='}'){ depth--; if(depth===0) return src.slice(start,i+1); }
  }
  die(`${name}() 끝 없음`);
}
function extractLine(re){ const m = src.match(re); if(!m) die(`상수 없음 ${re}`); return m[0]; }
function extractConst(name){
  const st = src.indexOf(`const ${name} =`); if(st<0) die(`const ${name} 없음`);
  return src.slice(st, src.indexOf(';', st)+1);
}
const FUNCS = ['evaluate','qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings'];
const ctx = { console, Math, Number, Object, Array, Set, Map, String, JSON };
vm.createContext(ctx);
vm.runInContext(`
${extractLine(/^const has = .*$/m)}
${extractLine(/^const r1 = .*$/m)}
${extractLine(/^const num = .*$/m)}
${extractLine(/^const isKR = .*$/m)}
${['DEFENSE','HEALTH','FINANCE','INDUSTRIAL','MEM','GPU'].map(extractConst).join('\n')}
${extractConst('NAME_MAP')}
${extractConst('CAT_MAP')}
${extractConst('DEFENSIVE_CATS')}
${extractConst('LEVERAGED')}
const levX = tk => (LEVERAGED[tk] ? LEVERAGED[tk].x : 1);
${extractConst('RANK_NONE')}
${extractConst('HIST_FIELDS_DEFAULT')}
var state = { data:null, overrides:{}, holdings:[], cart:[], hidden:[], market:'all', showHoldings:false, themeFilter:null };
${FUNCS.map(extractFunction).join('\n')}
/* 국면별 표본: strategyValidation과 같은 규칙(실적 차단·보합 제외)로
   신호일 market_level별 수익률을 모은다. */
this.collect = d => {
  state.data = normalize(d);
  const out = [];   // {phase, kind, h, ret}
  const stockHist = new Map();
  allStocks().forEach(s=>{
    const hs = histStocks(s); if(!hs||!hs.length) return;
    const ew = earningsWindowsForValidation(s,hs);
    stockHist.set(s.ticker,{hs,ew});
  });
  const byDate = new Map();
  stockHist.forEach(({hs,ew},tk)=>{
    hs.forEach((r,i)=>{
      if(!r.last_date || !r.price) return;
      if(i>0) withPrev(r, hs[i-1]);
      r._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null;
      r.sig = evaluate(r);
      if(ew.blocked.has(r.last_date)) return;
      if(!byDate.has(r.last_date)) byDate.set(r.last_date, []);
      byDate.get(r.last_date).push({r, i, tk});
    });
  });
  byDate.forEach(entries=>{
    const universe = entries.map(x=>x.r);
    const ranked = multiSignalRank(universe);
    const multiSet = new Map();  // tk -> tier
    ranked.forEach(sel=>{ const e=entries.find(x=>x.tk===sel.ticker); if(e && e.r.sig.grade>=4) multiSet.set(sel.ticker, sel._multiTier); });
    entries.forEach(({r,i,tk})=>{
      const pack = stockHist.get(tk), hs = pack.hs, ew = pack.ew;
      const phase = r.market_level || 'none';
      for(const h of [1,3,5]){
        if(i+h>=hs.length || !hs[i+h].price) continue;
        if(validationWindowTouchesEarnings(ew.affected,hs,i,h)) continue;
        const ret = (hs[i+h].price/r.price-1)*100;
        out.push({phase, kind:'base', h, ret});
        if(r.sig.pullGrade===5) out.push({phase, kind:'pull', h, ret});
        if(r.sig.revGrade===5)  out.push({phase, kind:'rev',  h, ret});
        if(r.sig.grade===5)     out.push({phase, kind:'strong', h, ret});
        const tier = multiSet.get(tk);
        if(tier) out.push({phase, kind:'multi', h, ret});
        if(tier===1) out.push({phase, kind:'bulb', h, ret});
      }
    });
  });
  return out;
};
`, ctx);

const rows = ctx.collect(base);
const stat = a => {
  const w=a.filter(x=>x>1).length, l=a.filter(x=>x<-1).length;
  return {rate:(w+l)?Math.round(w/(w+l)*100):null, n:a.length};
};
const KINDS = [['bulb','💡 강한다중'],['multi','다중(전체)'],['pull','추세 강매'],['rev','반등 강매'],['strong','최종 강매'],['base','기준선']];
const PHASES = [['strong','강세장'],['neutral','중립장'],['caution','주의장'],['weak','약세장']];

console.log('신호일의 QQQ 국면(현재 4단계 분류)별 승률 · 보합(±1%) 제외 · 괄호 표본 · %p는 같은 국면 기준선 대비\n');
for(const [ph, phName] of PHASES){
  const bl = {};
  for(const h of [1,3,5]) bl[h] = stat(rows.filter(x=>x.phase===ph&&x.kind==='base'&&x.h===h).map(x=>x.ret));
  const dayN = null;
  console.log(`■ ${phName} (${ph})`);
  for(const [k, name] of KINDS){
    const cells = [1,3,5].map(h=>{
      const s = stat(rows.filter(x=>x.phase===ph&&x.kind===k&&x.h===h).map(x=>x.ret));
      if(s.rate===null) return `  —(${String(s.n).padStart(3)})       `;
      const b = bl[h];
      const e = (k!=='base'&&b.rate!==null) ? `${s.rate-b.rate>=0?'+':''}${s.rate-b.rate}`.padStart(4)+'%p' : '     ';
      return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(3)})${e}`;
    });
    console.log(`  ${name.padEnd(10)} ${cells.join('   ')}`);
  }
  console.log('');
}
