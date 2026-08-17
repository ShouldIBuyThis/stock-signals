#!/usr/bin/env node
/**
 * PRIVATE 지수 예측 2차 — 새 축으로 다시 시도 (읽기 전용, 시험만)
 *
 * 1차(tools/index-predict.js)는 QQQ 자기 지표만 봤고 실패했다.
 * 표본이 30일뿐이라는 한계는 그대로지만, **재료를 바꾸면** 이야기가 달라질 수 있다.
 * 지수 하나가 아니라 **81개 종목이 그날 무슨 말을 했는지**(시장 폭)를 쓰면,
 * 같은 30일이라도 하루하루의 정보량이 훨씬 크다.
 *
 * 여기서 새로 쓰는 축:
 *   A. 시장 폭(breadth) — 그날 오른 종목 비율, MA20 위 종목 비율
 *   B. 신호 밀도 — 그날 강한매수/💡가 몇 개 떴는가
 *   C. SPY와의 관계 — 두 지수의 동조·괴리
 *   D. 위 축들의 조합
 *
 * ⚠ 표본은 여전히 최대 30일이다. §5-1 기준(15건)을 넘는 것만 후보로 보고,
 *   승률과 함께 **평균수익**을 반드시 같이 본다 — 승률 67%인데 평균 +0.24%면
 *   수수료 빼고 남는 게 없다(1차에서 실제로 나온 함정).
 *
 * 사용: node tools/index-breadth.js  [승률기준(기본 55)]
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const THRESH = Number(process.argv[2] || 55);

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

/* ── 신호 밀도를 얻기 위해 evaluate/multiSignalRank를 그대로 돌린다 ── */
const FUNCS = ['evaluate','qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks'];
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
/* 날짜별 시장 폭 + 신호 밀도 (미국 종목만 — QQQ를 설명하는 게 목적) */
this.daily = d => {
  state.data = normalize(d);
  const byDate = new Map();
  allStocks().forEach(s=>{
    if(isKR(s.ticker)) return;
    const hs = histStocks(s); if(!hs) return;
    hs.forEach((r,i)=>{
      if(!r.last_date || !r.price) return;
      if(i>0) withPrev(r, hs[i-1]);
      r._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null;
      r.sig = evaluate(r);
      if(!byDate.has(r.last_date)) byDate.set(r.last_date, []);
      byDate.get(r.last_date).push(r);
    });
  });
  const out = {};
  byDate.forEach((rows, date)=>{
    const ranked = multiSignalRank(rows);
    const bulbs = ranked.filter(x=>x._multiTier===1).length;
    const n = rows.length;
    const up = rows.filter(r=>has(r.change_1d) && r.change_1d/levX(r.ticker) > 0).length;
    const aboveMA20 = rows.filter(r=>has(r.price)&&has(r.ma20)&&r.price>r.ma20).length;
    const aboveMA5  = rows.filter(r=>has(r.price)&&has(r.ma5)&&r.price>r.ma5).length;
    const rsiAvg = (()=>{ const v=rows.filter(r=>has(r.rsi)).map(r=>r.rsi); return v.length? v.reduce((a,b)=>a+b,0)/v.length : null; })();
    const strong = rows.filter(r=>r.sig.grade===5).length;
    out[date] = {n, upPct:up/n*100, ma20Pct:aboveMA20/n*100, ma5Pct:aboveMA5/n*100, rsiAvg, strong, bulbs};
  });
  return out;
};
`, ctx);

const F = base.hist_fields, IX = {}; F.forEach((k,i)=>IX[k]=i);
const card = c => (c&&Array.isArray(c.hist)) ? c.hist.map(r=>{const o={};F.forEach((k,i)=>o[k]=r[i]);return o;}).filter(x=>x.date&&x.price) : [];
const Q = card(base.qqq_card), S = card(base.spy_card);
const spyBy = {}; S.forEach(r=>spyBy[String(r.date)]=r);
const D = ctx.daily(base);

/* 폭 지표의 '전일 대비 변화'도 재료로 쓴다 */
Q.forEach((r,i)=>{
  const d = D[String(r.date)], p = i>0 ? D[String(Q[i-1].date)] : null;
  r._b = d || null;
  r._bPrev = p || null;
});

const fwd = (i,h) => (i+h<Q.length && Q[i+h].price) ? (Q[i+h].price/Q[i].price-1)*100 : null;
const FLAT = Number(process.env.FLAT ?? 0);
const stat = a => {
  const v=a.filter(x=>x!==null);
  const w=v.filter(x=>x>FLAT).length, l=v.filter(x=>x<-FLAT).length;
  return {n:v.length, dir:w+l, rate:(w+l)?Math.round(w/(w+l)*100):null,
          avg:v.length?v.reduce((z,x)=>z+x,0)/v.length:null};
};
const fmt = s => s.rate===null ? '   —          ' :
  `${String(s.rate).padStart(3)}%(${String(s.dir).padStart(2)}) ${s.avg>=0?'+':''}${s.avg.toFixed(2)}%`;

console.log(`QQQ ${Q.length}거래일 · 미국 종목 ${(D[String(Q[Q.length-1].date)]||{}).n||'?'}개 · 보합밴드 ±${FLAT}%`);
console.log(`판정 기준: 승률 ${THRESH}% 이상 & 방향표본 15건 이상 & 평균수익 플러스\n`);

const BL = {}; [1,3,5].forEach(h=>BL[h]=stat(Q.map((_,i)=>fwd(i,h))));
console.log(`기준선(아무 날이나 QQQ 매수)  +1일 ${fmt(BL[1])}  +3일 ${fmt(BL[3])}  +5일 ${fmt(BL[5])}\n`);

const b = r => r._b, bp = r => r._bPrev;
const CONDS = [
  ['A 상승종목 <= 30%',        r=>b(r)&&b(r).upPct<=30],
  ['A 상승종목 <= 20%',        r=>b(r)&&b(r).upPct<=20],
  ['A 상승종목 >= 70%',        r=>b(r)&&b(r).upPct>=70],
  ['A MA20 위 <= 30%',         r=>b(r)&&b(r).ma20Pct<=30],
  ['A MA20 위 <= 40%',         r=>b(r)&&b(r).ma20Pct<=40],
  ['A MA20 위 >= 60%',         r=>b(r)&&b(r).ma20Pct>=60],
  ['A MA5 위 <= 25%',          r=>b(r)&&b(r).ma5Pct<=25],
  ['A 종목평균 RSI <= 40',     r=>b(r)&&b(r).rsiAvg!==null&&b(r).rsiAvg<=40],
  ['A 종목평균 RSI <= 45',     r=>b(r)&&b(r).rsiAvg!==null&&b(r).rsiAvg<=45],
  ['A 종목평균 RSI >= 55',     r=>b(r)&&b(r).rsiAvg!==null&&b(r).rsiAvg>=55],
  ['B 강한매수 0개',           r=>b(r)&&b(r).strong===0],
  ['B 강한매수 >= 3',          r=>b(r)&&b(r).strong>=3],
  ['B 강한매수 >= 5',          r=>b(r)&&b(r).strong>=5],
  ['B 💡 >= 1',                r=>b(r)&&b(r).bulbs>=1],
  ['B 💡 = 0',                 r=>b(r)&&b(r).bulbs===0],
  ['C SPY보다 QQQ 약함',       r=>{const s=spyBy[String(r.date)];return s&&has_(r.change_1d)&&has_(s.change_1d)&&r.change_1d<s.change_1d;}],
  ['C SPY보다 QQQ 강함',       r=>{const s=spyBy[String(r.date)];return s&&has_(r.change_1d)&&has_(s.change_1d)&&r.change_1d>s.change_1d;}],
  ['C 둘 다 MA20 아래',        r=>{const s=spyBy[String(r.date)];return s&&r.price<r.ma20&&s.price<s.ma20;}],
  ['C QQQ만 MA20 아래',        r=>{const s=spyBy[String(r.date)];return s&&r.price<r.ma20&&s.price>=s.ma20;}],
  ['D 폭 반전: 상승<=30 & 전일도<=30', r=>b(r)&&bp(r)&&b(r).upPct<=30&&bp(r).upPct<=30],
  ['D 폭 개선: 상승>=50 & 전일<=30',  r=>b(r)&&bp(r)&&b(r).upPct>=50&&bp(r).upPct<=30],
  ['D MA20위<=40 & 종목RSI<=45',      r=>b(r)&&b(r).ma20Pct<=40&&b(r).rsiAvg!==null&&b(r).rsiAvg<=45],
  ['D 상승<=30 & QQQ당일하락',        r=>b(r)&&b(r).upPct<=30&&has_(r.change_1d)&&r.change_1d<0],
  ['D 강한매수>=3 & MA20위>=50',      r=>b(r)&&b(r).strong>=3&&b(r).ma20Pct>=50],
  /* C축 정밀 — 'SPY 대비 QQQ 약세'가 유일한 통과 후보라 강도별로 쪼갠다 */
  ['C- QQQ가 SPY보다 0.3%p+ 약함', r=>{const s=spyBy[String(r.date)];return s&&has_(r.change_1d)&&has_(s.change_1d)&&(s.change_1d-r.change_1d)>=0.3;}],
  ['C- QQQ가 SPY보다 0.5%p+ 약함', r=>{const s=spyBy[String(r.date)];return s&&has_(r.change_1d)&&has_(s.change_1d)&&(s.change_1d-r.change_1d)>=0.5;}],
  ['C- QQQ가 SPY보다 1.0%p+ 약함', r=>{const s=spyBy[String(r.date)];return s&&has_(r.change_1d)&&has_(s.change_1d)&&(s.change_1d-r.change_1d)>=1.0;}],
  ['C- 약세 + QQQ 당일하락',       r=>{const s=spyBy[String(r.date)];return s&&has_(r.change_1d)&&has_(s.change_1d)&&r.change_1d<s.change_1d&&r.change_1d<0;}],
  ['C- 약세 + QQQ MA20 아래',      r=>{const s=spyBy[String(r.date)];return s&&has_(r.change_1d)&&has_(s.change_1d)&&r.change_1d<s.change_1d&&r.price<r.ma20;}],
];
function has_(v){ return v!==null && v!==undefined && !Number.isNaN(v); }

console.log(`${'조건'.padEnd(34)} ${'+1일'.padEnd(17)}${'+3일'.padEnd(17)}+5일`);
const hits = [];
for(const [name, pred] of CONDS){
  const idx = Q.map((r,i)=>[r,i]).filter(([r])=>{ try{ return !!pred(r); }catch(e){ return false; } }).map(([,i])=>i);
  if(!idx.length){ console.log(`  ${name.padEnd(32)} (해당 없음)`); continue; }
  const cols=[1,3,5].map(h=>stat(idx.map(i=>fwd(i,h))));
  console.log(`  ${name.padEnd(32)} ${fmt(cols[0]).padEnd(17)}${fmt(cols[1]).padEnd(17)}${fmt(cols[2])}`);
  cols.forEach((c,k)=>{ const h=[1,3,5][k];
    if(c.dir>=15 && c.rate!==null && c.rate>=THRESH && c.avg>0) hits.push({name,h,...c,edge:c.rate-BL[h].rate}); });
}

console.log(`\n■ 판정 — 승률 ${THRESH}%+ · 방향표본 15+ · 평균수익 플러스`);
if(!hits.length){
  console.log('  통과 없음.');
} else {
  hits.sort((a,b)=>b.rate-a.rate).forEach(h=>
    console.log(`  ✔ ${h.name} → +${h.h}일 ${h.rate}% (표본 ${h.dir}건, 평균 ${h.avg>=0?'+':''}${h.avg.toFixed(2)}%, 기준선 대비 ${h.edge>=0?'+':''}${h.edge}%p)`));
  console.log('\n  ⚠ 조건 24종을 훑은 결과다. 다음 사이클에서 재현되기 전에는 규칙으로 쓰지 않는다.');
}

/* 전·후반 분리 — 통과 후보만 (§2) */
if(hits.length){
  const MIDI = Math.floor(Q.length/2);
  console.log('\n■ 전·후반 분리 (§2) — 각 칸의 [기준]은 그 반기의 지수 기준선이다.');
  console.log('  QQQ 기준선 자체가 전반 33% ~ 후반 92%로 요동친다. 후반에만 좋은 규칙은');
  console.log('  실력이 아니라 그 시기에 지수가 그냥 올랐던 것이다.');
  const uniq=[...new Set(hits.map(h=>h.name))];
  for(const nm of uniq){
    const pred = CONDS.find(c=>c[0]===nm)[1];
    for(const [lab, lo, hi] of [['전반',0,MIDI],['후반',MIDI,Q.length]]){
      const idx=Q.map((r,i)=>[r,i]).filter(([r,i])=>i>=lo&&i<hi&&(()=>{try{return !!pred(r);}catch(e){return false;}})()).map(([,i])=>i);
      const c=[1,3,5].map(h=>stat(idx.map(i=>fwd(i,h))));
      const bl=[1,3,5].map(h=>stat(Q.map((_,i)=>(i>=lo&&i<hi)?fwd(i,h):null)));
      console.log(`  ${nm.slice(0,26).padEnd(28)}${lab} ${c.map((x,k)=>fmt(x)+`[기준 ${bl[k].rate===null?'—':bl[k].rate+'%'}]`).join('  ')}`);
    }
  }
}

/* §2 자동 판정 — 양쪽 반기에서 각각 그 반기 기준선을 넘어야 진짜 후보 */
if(hits.length){
  const MIDI2 = Math.floor(Q.length/2);
  console.log('\n■ 최종 판정 (§2 포함)');
  let survived = 0;
  for(const nm of [...new Set(hits.map(h=>h.name))]){
    const pred = CONDS.find(c=>c[0]===nm)[1];
    const half = (lo,hi,h)=>{
      const idx=Q.map((r,i)=>[r,i]).filter(([r,i])=>i>=lo&&i<hi&&(()=>{try{return !!pred(r);}catch(e){return false;}})()).map(([,i])=>i);
      const c=stat(idx.map(i=>fwd(i,h)));
      const bl=stat(Q.map((_,i)=>(i>=lo&&i<hi)?fwd(i,h):null));
      return (c.rate!==null&&bl.rate!==null)? c.rate-bl.rate : null;
    };
    const hs = hits.filter(h=>h.name===nm).map(h=>h.h);
    const ok = hs.some(h=>{
      const e1=half(0,MIDI2,h), e2=half(MIDI2,Q.length,h);
      return e1!==null && e2!==null && e1>0 && e2>0;
    });
    if(ok){ survived++; console.log(`  ✔ ${nm} — 양쪽 반기 모두 기준선 초과`); }
    else console.log(`  ✘ ${nm} — 한쪽 반기에서 기준선 미달 (국면 잔상)`);
  }
  if(!survived) console.log('\n  결론: 승률 55% 기준으로도 §2를 통과하는 지수 예측 규칙은 없다.');
}
