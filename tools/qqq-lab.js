#!/usr/bin/env node
/**
 * PRIVATE QQQ 단독 예측력 + 국면 분류 후보 시험 (읽기 전용, 시험만 — 적용 없음)
 *
 * 1) QQQ 카드가 말하는 국면이 QQQ 자신의 다음날을 얼마나 맞히는가
 * 2) QQQ 지표 밴드별(RSI·볼린저·ret20) QQQ 자기 예측력
 * 3) 국면 분류 후보를 종목 검증 전체에 갈아끼웠을 때 (ichi-compare 방식)
 *
 * ⚠ 후보 분류는 이 30거래일을 보고 설계한 것이라 in-sample이다.
 *   여기서 이겨도 "다음 사이클 검증 전 적용 금지"가 원칙이다 (§2·§3).
 *
 * 사용: 저장소 루트에서 `node tools/qqq-lab.js`
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

/* ── QQQ 일자별 지표 로드 ── */
const F = base.hist_fields;
const ix = {}; ['date','price','change_1d','rsi','bb_pos','ret20','ma20_slope','run3_sum','ma5','ma20','ma60'].forEach(k=>ix[k]=F.indexOf(k));
const qh = base.qqq_card.hist.map(r => {
  const o = {}; Object.entries(ix).forEach(([k,i])=>o[k]=r[i]); return o;
});
const CUR = {}, ICHI = {};
for(const r of base.market.hist){ CUR[String(r[0])]=r[1]; ICHI[String(r[0])]=r[4]; }

const qFwd = i => [1,3,5].map(h => (i+h<qh.length && qh[i+h].price) ? (qh[i+h].price/qh[i].price-1)*100 : null);
const wr = a => {
  const v=a.filter(x=>x!==null); if(!v.length) return {r:null,n:0,avg:null};
  const w=v.filter(x=>x>0).length;
  return {r:Math.round(w/v.length*100), n:v.length, avg:v.reduce((z,x)=>z+x,0)/v.length};
};
const fmt = s => s.r===null ? '   —      ' : `${String(s.r).padStart(3)}%(${String(s.n).padStart(2)}) ${s.avg>=0?'+':''}${s.avg.toFixed(1)}%`;

/* ── 1) 국면별 QQQ 자기 예측 ── */
console.log('■ 1. QQQ 카드 국면 → QQQ 자신의 미래 (승률=상승확률, 보합밴드 없음 · 평균수익)');
console.log('   ※ 국면 일수가 1~16일이라 통계가 아니라 관찰 기록에 가깝다\n');
for(const [MAP, nm] of [[CUR,'현재 4단계'],[ICHI,'일목      ']]){
  console.log(`  ${nm}`);
  for(const lv of ['strong','neutral','caution','weak']){
    const idx = qh.map((r,i)=>[String(r.date),i]).filter(([d])=>MAP[d]===lv).map(([,i])=>i);
    if(!idx.length) continue;
    const cols = [0,1,2].map(k => wr(idx.map(i=>qFwd(i)[k])));
    console.log(`    ${lv.padEnd(8)} ${String(idx.length).padStart(2)}일  +1일 ${fmt(cols[0])}  +3일 ${fmt(cols[1])}  +5일 ${fmt(cols[2])}`);
  }
}

/* ── 2) QQQ 지표 밴드별 자기 예측 ── */
console.log('\n■ 2. QQQ 지표 밴드 → QQQ 자신의 미래 (in-sample 관찰 — 규칙 아님)');
const BANDS = [
  ['RSI<=40 (낙폭과대)',   r=>r.rsi!==null&&r.rsi<=40],
  ['RSI 40~50',            r=>r.rsi!==null&&r.rsi>40&&r.rsi<=50],
  ['RSI>50',               r=>r.rsi!==null&&r.rsi>50],
  ['볼린저<=10',           r=>r.bb_pos!==null&&r.bb_pos<=10],
  ['ret20<=-5 (낙폭큼)',   r=>r.ret20!==null&&r.ret20<=-5],
  ['ret20 -5~0 (하락중)',  r=>r.ret20!==null&&r.ret20>-5&&r.ret20<0],
  ['ret20>=0',             r=>r.ret20!==null&&r.ret20>=0],
  ['20일선기울기<=-1',     r=>r.ma20_slope!==null&&r.ma20_slope<=-1],
];
for(const [name, pred] of BANDS){
  const idx = qh.map((r,i)=>[r,i]).filter(([r])=>pred(r)).map(([,i])=>i);
  const cols = [0,1,2].map(k => wr(idx.map(i=>qFwd(i)[k])));
  console.log(`  ${name.padEnd(22)} ${String(idx.length).padStart(2)}일  +1일 ${fmt(cols[0])}  +3일 ${fmt(cols[1])}  +5일 ${fmt(cols[2])}`);
}

/* ── 3) 국면 분류 후보를 종목 검증에 삽입 ── */
/* 후보 정의 (모두 QQQ 일자별 지표만 사용):
   K0 현재 4단계 (배포 중)
   K1 낙폭과대 구제: 현재 weak인데 QQQ RSI<=40이면 게이트 해제(neutral 취급)
   K2 낙폭과대 구제(엄격): RSI<=35
   K3 하락초입 확장: 현재 caution인데 ret20>-5(아직 덜 빠짐)이면 weak로 강등  */
const K = {
  K0: d => CUR[d],
  K1: d => { const lv=CUR[d]; const r=qh.find(x=>String(x.date)===d); return (lv==='weak'&&r&&r.rsi!==null&&r.rsi<=40)?'neutral':lv; },
  K2: d => { const lv=CUR[d]; const r=qh.find(x=>String(x.date)===d); return (lv==='weak'&&r&&r.rsi!==null&&r.rsi<=35)?'neutral':lv; },
  K3: d => { const lv=CUR[d]; const r=qh.find(x=>String(x.date)===d); return (lv==='caution'&&r&&r.ret20!==null&&r.ret20>-5)?'weak':lv; },
};

const FUNCS = ['evaluate','qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings','strategyValidation'];
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
this.run = d => { state.data = normalize(d); return strategyValidation(); };
`, ctx);

const I_D = F.indexOf('date'), I_LVL = F.indexOf('market_level'), I_WEAK = F.indexOf('market_weak');
function withLevels(mapper){
  const d = JSON.parse(JSON.stringify(base));
  for(const s of d.stocks){
    for(const row of (s.hist||[])){
      const lv = mapper(String(row[I_D]));
      if(lv === undefined || lv === null) continue;
      row[I_LVL] = lv;
      row[I_WEAK] = (lv==='weak'||lv==='caution');
    }
  }
  return d;
}
const cell=(s,b)=>{
  if(!s||s.rate===null) return `  —(${String(s?s.n:0).padStart(3)})       `;
  const e=(b&&b.rate!==null)?`${s.rate-b.rate>=0?'+':''}${s.rate-b.rate}`.padStart(4)+'%p':'     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(3)})${e} `;
};
console.log('\n■ 3. 국면 분류 후보 → 종목 검증 전체 재계산 (in-sample 시험 — 적용 아님)');
const DESC = {
  K0:'현재 4단계 (배포 중)',
  K1:'weak인데 QQQ RSI<=40이면 게이트 해제',
  K2:'weak인데 QQQ RSI<=35이면 게이트 해제',
  K3:'caution인데 ret20>-5면 weak로 강등',
};
for(const [name, mapper] of Object.entries(K)){
  const v = ctx.run(withLevels(mapper));
  console.log(`\n  ${name} — ${DESC[name]}`);
  for(const [lab,get] of [['다중',v=>v.multi],['💡',v=>v._strict],['추세',v=>v.pull],['반등',v=>v.rev],['최종강매',v=>v._strongBuy]]){
    const s=get(v);
    console.log(`    ${lab.padEnd(7)}${cell(s[1],v._baseline[1]).padEnd(17)}${cell(s[3],v._baseline[3]).padEnd(17)}${cell(s[5],v._baseline[5])}`);
  }
}
