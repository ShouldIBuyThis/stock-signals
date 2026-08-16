#!/usr/bin/env node
/**
 * PRIVATE 보유기간 분석 — 며칠 들고 있는 게 최선인가 (읽기 전용)
 *
 * 검증표는 +1/+3/+5일만 본다. 그 사이와 그 뒤가 어떤지 몰라서
 * "+5일 승률이 +3일보다 낮다"의 원인을 못 가린다.
 * 여기서는 +1~+10일을 전부 재서 승률과 평균수익을 같이 본다.
 *
 * 판단 기준은 **승률이 아니라 평균수익**이다. 승률이 높아도 이긴 폭이
 * 작고 진 폭이 크면 손해다. 청산 시점 결정에는 평균수익이 맞는 잣대다.
 *
 * 산식은 index.html에서 추출해 그대로 쓴다(docs/승률-검증-방법론.md §0).
 *
 * 사용: 저장소 루트에서 `node tools/holding-period.js`
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));

function die(m){ console.error('[ERROR]', m); process.exit(1); }
function extractFunction(name){
  const start = src.indexOf(`function ${name}(`);
  if(start < 0) die(name);
  const brace = src.indexOf('{', start);
  let depth=0,q=null,esc=false,lc=false,bc=false;
  for(let i=brace;i<src.length;i++){
    const c=src[i],n=src[i+1];
    if(lc){if(c==='\n')lc=false;continue;} if(bc){if(c==='*'&&n==='/'){bc=false;i++;}continue;}
    if(q){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===q)q=null;continue;}
    if(c==='/'&&n==='/'){lc=true;i++;continue;} if(c==='/'&&n==='*'){bc=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){q=c;continue;}
    if(c==='{')depth++; else if(c==='}'){depth--;if(depth===0)return src.slice(start,i+1);}
  } die(name+' end');
}
function extractLine(re){ const m=src.match(re); if(!m) die(re); return m[0]; }
function extractConst(name){ const st=src.indexOf(`const ${name} =`); if(st<0) die(name); return src.slice(st, src.indexOf(';',st)+1); }

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
const levX = tk => (LEVERAGED[tk]?LEVERAGED[tk].x:1);
${extractConst('RANK_NONE')}
${extractConst('HIST_FIELDS_DEFAULT')}
var state = { data:null, overrides:{}, holdings:[], cart:[], hidden:[], market:'all', showHoldings:false, themeFilter:null };
${FUNCS.map(extractFunction).join('\n')}
/* 신호별로 +1~+MAXH일 수익을 한 번에 모은다. 실적 차단·제외 규칙은 검증표와 동일. */
this.collect = (d, MAXH) => {
  state.data = normalize(d);
  const packs = new Map();
  allStocks().forEach(s=>{
    const hs = histStocks(s); if(!hs||!hs.length) return;
    const ew = earningsWindowsForValidation(s, hs);
    hs.forEach((r,i)=>{ if(i>0) withPrev(r, hs[i-1]); r._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null; r.sig = evaluate(r); });
    packs.set(s.ticker, {hs, ew});
  });
  const byDate = new Map();
  packs.forEach(({hs,ew}, tk)=>{
    hs.forEach((r,i)=>{
      if(!r.last_date || !r.price) return;
      if(ew.blocked.has(r.last_date)) return;
      if(!byDate.has(r.last_date)) byDate.set(r.last_date, []);
      byDate.get(r.last_date).push({r,i,tk});
    });
  });
  const out = [];
  byDate.forEach(entries=>{
    const ranked = multiSignalRank(entries.map(x=>x.r));
    const tierOf = new Map();
    ranked.forEach(sel=>{ const e=entries.find(x=>x.tk===sel.ticker); if(e && e.r.sig.grade>=4) tierOf.set(sel.ticker, sel._multiTier); });
    entries.forEach(({r,i,tk})=>{
      const {hs, ew} = packs.get(tk);
      const kinds = [];
      if(tierOf.get(tk)===1) kinds.push('bulb');
      if(tierOf.get(tk)) kinds.push('multi');
      if(r.sig.pullGrade===5) kinds.push('pull');
      if(r.sig.revGrade===5) kinds.push('rev');
      if(r.sig.grade===5) kinds.push('strong');
      kinds.push('base');
      const rets = {};
      for(let h=1; h<=MAXH; h++){
        if(i+h>=hs.length || !hs[i+h].price) { rets[h]=null; continue; }
        if(validationWindowTouchesEarnings(ew.affected, hs, i, h)) { rets[h]=null; continue; }
        rets[h] = (hs[i+h].price/r.price-1)*100;
      }
      // 보유 중 최대·최저 (중간 반락 확인용)
      out.push({tk, date:r.last_date, kinds, rets});
    });
  });
  return out;
};
`, ctx);

const MAXH = 10;
const rows = ctx.collect(base, MAXH);
const stat = a => {
  const v = a.filter(x=>x!==null);
  const w = v.filter(x=>x>1).length, l = v.filter(x=>x<-1).length;
  return {n:v.length, rate:(w+l)?Math.round(w/(w+l)*100):null, avg:v.length?v.reduce((z,x)=>z+x,0)/v.length:null};
};
const KINDS = [['bulb','💡 강한다중'],['strong','🟢 최종 강한매수'],['pull','📈 추세 강매'],['rev','🔄 반등 강매'],['base','기준선(전 종목)']];

console.log('보유기간별 성과 — 신호 당일 종가 매수, N거래일 뒤 종가 매도');
console.log('승률은 ±1% 보합 제외 · 평균수익이 청산 시점 판단의 기준\n');

for(const [key, label] of KINDS){
  const sel = rows.filter(r=>r.kinds.includes(key));
  console.log(`■ ${label}`);
  let line1='  보유일 ', line2='  승률   ', line3='  평균%  ', line4='  표본   ';
  const per = [];
  for(let h=1; h<=MAXH; h++){
    const s = stat(sel.map(r=>r.rets[h]));
    per.push(s);
    line1 += String('+'+h).padStart(8);
    line2 += (s.rate===null?'—':s.rate+'%').padStart(8);
    line3 += (s.avg===null?'—':(s.avg>=0?'+':'')+s.avg.toFixed(2)).padStart(8);
    line4 += String(s.n).padStart(8);
  }
  console.log(line1); console.log(line2); console.log(line3); console.log(line4);
  /* 최적 보유일 = 평균수익이 가장 높은 지점 (표본 15건 이상 구간에서만) */
  let best=null;
  per.forEach((s,k)=>{ if(s.n>=15 && s.avg!==null && (!best || s.avg>best.avg)) best={h:k+1, ...s}; });
  if(best) console.log(`  → 평균수익 최고: +${best.h}일 ${best.avg>=0?'+':''}${best.avg.toFixed(2)}% (승률 ${best.rate}%, 표본 ${best.n}건)`);
  console.log('');
}

/* ── 💡 조기 청산 규칙 비교 ── */
console.log('■ 💡 청산 전략 비교 — 같은 신호를 어떻게 팔았을 때 총 수익이 최대인가');
const bulbs = rows.filter(r=>r.kinds.includes('bulb'));
function strategy(name, pick){
  const vals = bulbs.map(pick).filter(x=>x!==null);
  if(!vals.length) return;
  const w=vals.filter(x=>x>1).length, l=vals.filter(x=>x<-1).length;
  const avg=vals.reduce((z,x)=>z+x,0)/vals.length;
  console.log(`  ${name.padEnd(34)} 승률 ${((w+l)?Math.round(w/(w+l)*100):0)}%  평균 ${avg>=0?'+':''}${avg.toFixed(2)}%  표본 ${vals.length}건`);
}
strategy('3일 고정 보유', r=>r.rets[3]);
strategy('5일 고정 보유', r=>r.rets[5]);
strategy('10일 고정 보유', r=>r.rets[10]);
strategy('3일 뒤 이익이면 청산, 아니면 5일', r=>{
  if(r.rets[3]===null) return r.rets[5];
  return r.rets[3] > 1 ? r.rets[3] : (r.rets[5] ?? r.rets[3]);
});
strategy('5일 중 최고가 청산(이상적 상한)', r=>{
  const v=[1,2,3,4,5].map(h=>r.rets[h]).filter(x=>x!==null);
  return v.length? Math.max(...v) : null;
});
strategy('5일 중 최저가 청산(최악 하한)', r=>{
  const v=[1,2,3,4,5].map(h=>r.rets[h]).filter(x=>x!==null);
  return v.length? Math.min(...v) : null;
});
console.log('\n  ※ "최고가/최저가 청산"은 미래를 안다는 가정이라 실행 불가능한 상·하한이다.');
console.log('    실제 전략은 그 사이에 있고, 고정 보유가 그 범위 어디쯤인지 보는 용도다.');

/* ── 보유 중 반락 확인: +3일 이겼다가 +5일에 진 표본 ── */
console.log('\n■ 💡 "+3일엔 이겼는데 +5일에 진" 표본 (반락 확인)');
const flip = bulbs.filter(r=>r.rets[3]!==null && r.rets[5]!==null && r.rets[3]>1 && r.rets[5]<=1);
const keep = bulbs.filter(r=>r.rets[3]!==null && r.rets[5]!==null && r.rets[3]>1 && r.rets[5]>1);
console.log(`  +3일 승 → +5일 승 유지: ${keep.length}건`);
console.log(`  +3일 승 → +5일 반납  : ${flip.length}건`);
if(flip.length) flip.slice(0,10).forEach(r=>
  console.log(`    ${r.date} ${r.tk.padEnd(8)} +3일 ${r.rets[3].toFixed(1)}% → +5일 ${r.rets[5].toFixed(1)}%`));
