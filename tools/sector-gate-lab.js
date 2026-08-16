#!/usr/bin/env node
/**
 * PRIVATE 약세장 섹터 게이트 해제 시험 (읽기 전용)
 *
 * 현재 산식은 약세·주의 국면(30일 중 16일)에서 DEFENSIVE_CATS가 아닌 섹터의
 * 강한매수를 **무조건** 막는다(index.html의 sectorOK). 기술주는 그 날 전부 차단된다.
 * 이 스크립트는 그 차단을 풀거나 완화하는 변형을 같은 표본에서 비교한다.
 *
 * 규칙(docs/승률-검증-방법론.md):
 *   §1 같은 구간 기준선 대비 초과 %p로 본다
 *   §2 전·후반 갈라 양쪽 다 봐야 채택
 *   §5 표본 n과 종목 수를 같이 본다
 *
 * 사용: 저장소 루트에서 `node tools/sector-gate-lab.js`
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));

function die(m){ console.error('[ERROR]', m); process.exit(1); }
function extractFunction(name){
  const start = src.indexOf(`function ${name}(`);
  if(start < 0) die(`function ${name}() 없음`);
  const brace = src.indexOf('{', start);
  let depth=0,q=null,esc=false,lc=false,bc=false;
  for(let i=brace;i<src.length;i++){
    const c=src[i],n=src[i+1];
    if(lc){if(c==='\n')lc=false;continue;} if(bc){if(c==='*'&&n==='/'){bc=false;i++;}continue;}
    if(q){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===q)q=null;continue;}
    if(c==='/'&&n==='/'){lc=true;i++;continue;} if(c==='/'&&n==='*'){bc=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){q=c;continue;}
    if(c==='{')depth++; else if(c==='}'){depth--;if(depth===0)return src.slice(start,i+1);}
  } die(`${name}() 끝 없음`);
}
function extractLine(re){ const m=src.match(re); if(!m) die(`상수 없음 ${re}`); return m[0]; }
function extractConst(name){ const st=src.indexOf(`const ${name} =`); if(st<0) die(`const ${name} 없음`); return src.slice(st, src.indexOf(';',st)+1); }

const GATE = 'const sectorOK = !marketGuarded || DEFENSIVE_CATS.includes(s.category);';
const OTHER = ['qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings'];
const ANCHOR = 'result._diag=diag;';
function validationSrc(){
  let f = extractFunction('strategyValidation');
  if(!f.includes(ANCHOR)) die('앵커 없음');
  return f.replace(ANCHOR, ANCHOR +
    '\n  result._rows={multi:out.multi, pull:out.pull, rev:out.rev, strong:strongBuyOut};');
}

function run(gateExpr, data){
  let ev = extractFunction('evaluate');
  if(!ev.includes(GATE)) die('sectorOK 라인을 못 찾음');
  if(gateExpr) ev = ev.replace(GATE, `const sectorOK = ${gateExpr};`);
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
${ev}
${OTHER.map(extractFunction).join('\n')}
${validationSrc()}
this.run = d => { state.data = normalize(d); return strategyValidation(); };
`, ctx);
  return ctx.run(data);
}

const F = base.hist_fields, I_D = F.indexOf('date');
const days = [...new Set(base.stocks.flatMap(s=>(s.hist||[]).map(r=>String(r[I_D]))))].sort();
const MID = days[Math.floor(days.length/2)];
const clip = pred => { const d=JSON.parse(JSON.stringify(base)); for(const s of d.stocks) s.hist=(s.hist||[]).filter(r=>pred(String(r[I_D]))); return d; };

const cell=(s,b)=>{
  if(!s||s.rate===null) return `  —(${String(s?s.n:0).padStart(3)})       `;
  const e=(b&&b.rate!==null)?`${s.rate-b.rate>=0?'+':''}${s.rate-b.rate}`.padStart(4)+'%p':'     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(3)})${e} `;
};
const ROWS=[['💡',v=>v._strict],['다중',v=>v.multi],['추세',v=>v.pull],['반등',v=>v.rev],['최종강매',v=>v._strongBuy]];

const BASE='!marketGuarded || DEFENSIVE_CATS.includes(s.category)';
/* 후보 — 기술주 차단을 푸는 여러 강도 */
const VARIANTS = [
  ['G0 현행 (기술주 전면 차단)', null],
  ['G1 게이트 완전 제거',        'true'],
  ['G2 주의장만 해제(약세는 유지)', 's.market_level!=="weak" || DEFENSIVE_CATS.includes(s.category)'],
  ['G3 방어섹터 OR 신고가25%이내', `${BASE} || (has(s.pct_from_high)&&s.pct_from_high>=-25)`],
  ['G4 방어섹터 OR 상대강도 rs20>=0', `${BASE} || (has(s.rs20)&&s.rs20>=0)`],
  ['G5 방어섹터 OR 정배열+MA20위', `${BASE} || (bull && a20)`],
  ['G6 방어섹터 OR (정배열+신고가25%)', `${BASE} || (bull && has(s.pct_from_high) && s.pct_from_high>=-25)`],
];

console.log(`표본 ${days[0]} ~ ${days[days.length-1]} (${days.length}거래일) · 전후반 분기 ${MID}`);
console.log('보합(±1%) 제외 승률 · 괄호 표본 · %p는 같은 구간 기준선 대비\n');

const results={};
for(const [name, gate] of VARIANTS){
  const v = run(gate, base);
  results[name]=[v,gate];
  console.log(`■ ${name}`);
  for(const [lab,get] of ROWS){
    const s=get(v);
    console.log(`  ${lab.padEnd(7)}${cell(s[1],v._baseline[1]).padEnd(17)}${cell(s[3],v._baseline[3]).padEnd(17)}${cell(s[5],v._baseline[5])}`);
  }
  console.log(`  ${'기준선'.padEnd(7)}${cell(v._baseline[1],null).padEnd(17)}${cell(v._baseline[3],null).padEnd(17)}${cell(v._baseline[5],null)}\n`);
}

/* 대조군 대비 증감 요약 */
console.log('\n■ 현행(G0) 대비 증감 (%p) — + 면 해제가 이득');
console.log(`${''.padEnd(30)}${'+1일'.padStart(6)}${'+3일'.padStart(7)}${'+5일'.padStart(7)}   표본변화(💡/최종강매)`);
const G0=results['G0 현행 (기술주 전면 차단)'][0];
for(const [name,[v]] of Object.entries(results)){
  if(name.startsWith('G0')) continue;
  for(const [lab,get] of ROWS){
    const d=h=>{const a=G0[lab==='💡'?'_strict':'']; const A=get(G0)[h].rate, B=get(v)[h].rate;
      return (A===null||B===null)?'    —':`${B-A>=0?'+':''}${B-A}`.padStart(5)+' ';};
    const extra = lab==='💡' ? `  ${G0._strict[3].n}→${v._strict[3].n}` : (lab==='최종강매'? `  ${G0._strongBuy[3].n}→${v._strongBuy[3].n}`:'');
    console.log(`${(name.slice(0,2)+' '+lab).padEnd(30)}${d(1)}${d(3)}${d(5)}${extra}`);
  }
  console.log('');
}

/* 유망 변형 전·후반 */
console.log('\n■ 전·후반 분리 (§2) — 대조군을 한 칸이라도 이긴 변형만');
for(const [name,[v,gate]] of Object.entries(results)){
  if(name.startsWith('G0')) continue;
  const better=[1,3,5].some(h=>v._strict[h].rate!==null&&G0._strict[h].rate!==null&&v._strict[h].rate>G0._strict[h].rate)
    || [1,3,5].some(h=>v._strongBuy[h].rate!==null&&G0._strongBuy[h].rate!==null&&v._strongBuy[h].rate>G0._strongBuy[h].rate);
  if(!better) continue;
  const H1=run(gate, clip(d=>d<MID)), H2=run(gate, clip(d=>d>=MID));
  console.log(`\n${name}`);
  for(const [lab,get] of [['💡',v=>v._strict],['최종강매',v=>v._strongBuy]]){
    const f=x=>[1,3,5].map(h=>cell(get(x)[h],x._baseline[h]).padEnd(17)).join('');
    console.log(`  ${lab.padEnd(6)}전반 ${f(H1)}`);
    console.log(`  ${''.padEnd(6)}후반 ${f(H2)}`);
  }
}

/* 게이트 ON 구간에서 기술주가 실제로 어땠는지 (해제 판단의 직접 근거) */
console.log('\n\n■ 게이트 ON 구간(약세·주의)에서 차단된 신호들의 실제 성적');
{
  const v=run('true', base);   // 게이트 없는 세계
  const rows=(v._rows.strong[3]||[]);
  const mkLv={};
  for(const r of base.market.hist) mkLv[String(r[0])]=r[1];
  const qr={}; for(const r of base.qqq_card.hist) qr[String(r[F.indexOf('date')])]=r[F.indexOf('rsi')];
  const eff=d=>{ const lv=mkLv[d]; const x=qr[d]; return (lv==='weak'&&x!==null&&x!==undefined&&x<=35)?'neutral':lv; };
  const DEF=JSON.parse(extractConst('DEFENSIVE_CATS').match(/\[[^\]]*\]/)[0]);
  const catOf={}; base.stocks.forEach(s=>catOf[s.ticker]=s.category);
  const guardedBlocked=rows.filter(x=>{
    const lv=eff(x.date); return (lv==='weak'||lv==='caution') && !DEF.includes(catOf[x.ticker]);
  });
  const st=a=>{const w=a.filter(x=>x.ret>1).length,l=a.filter(x=>x.ret<-1).length;
    return `${(w+l)?Math.round(w/(w+l)*100):'—'}%(${a.length}건) 평균 ${a.length?(a.reduce((z,x)=>z+x.ret,0)/a.length).toFixed(2):'—'}%`;};
  console.log(`  차단된 강한매수 +3일: ${st(guardedBlocked)}`);
  const bl3=(v._baseline[3]);
  console.log(`  같은 기간 전체 기준선 +3일: ${bl3.rate}% (${bl3.n}건)`);
  const byCat={};
  guardedBlocked.forEach(x=>{ (byCat[catOf[x.ticker]] ||= []).push(x); });
  console.log('  섹터별:');
  Object.entries(byCat).sort((a,b)=>b[1].length-a[1].length).slice(0,8)
    .forEach(([c,a])=>console.log(`    ${c.padEnd(14)} ${st(a)}`));
}
