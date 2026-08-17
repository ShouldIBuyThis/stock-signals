#!/usr/bin/env node
/**
 * PRIVATE 게이트 실험실 2 — 2026-08-17 사용자 지시 실험 묶음 (읽기 전용)
 *
 * formula-lab.js와 같은 방식: index.html에서 함수를 문자열로 뽑아
 * 지정한 한 줄만 갈아끼운 뒤 strategyValidation()을 그대로 돌린다.
 * 배포 파일은 절대 수정하지 않는다 (docs/승률-검증-방법론.md §0).
 *
 * 실험 목록 (전부 "시험·보고"용 — 적용은 사용자 승인 후):
 *   E1  💡에서 과열(RSI>=70 또는 BB>=95) 신호 제외
 *   E3  💡의 "전일 중립" 전환 요건 해제
 *   E4  추세 추격 컷을 변동성(ATR) 상대화 — run3<=max(5, atr*k)
 *   E5  미너비니 ④(고점 -25%) 완화 스윕 — -30/-35/-40/-50
 *   E6  항복 바닥 직접 진입 — 반등 강매 OR 경로(BB·RSI 과매도 + 비추격)
 *
 * `node tools/strict-lab.js comp` → E2: 💡가 추세/반등 어느 쪽에서 오는지 구성 분해
 *
 * 판정 규칙(방법론): 기준선 대비 %p / 전·후반 둘 다 개선 / §5-1 표본 / 봉우리 금지.
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

/* ── 패치 앵커: index.html의 실제 소스와 한 글자까지 같아야 한다 ── */
const A_NEARHI = 'const nearHighM = has(s.pct_from_high) && s.pct_from_high >= -25;';
const A_CHASE  = 'const pullChase = run3Eff===null || run3Eff<=5;';
const A_STRICT = 'const strict=previousOverallGrade(s)===3 && strictMultiGate(s) && fallbackStrict && strictChase;';
const A_REV    = 'const revStrong = revScore>=2.0 && has(rsi) && revRsiOK && sectorOK && revChase;';

const OTHER = ['qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings'];
const ANCHOR = 'result._diag=diag;';
function validationSrc(){
  let f = extractFunction('strategyValidation');
  if(!f.includes(ANCHOR)) die('strategyValidation 앵커 없음');
  return f.replace(ANCHOR, ANCHOR +
    '\n  result._general={}; horizons.forEach(h=>{ result._general[h]=stat(out.multi[h].filter(x=>x.tier===2)); });');
}

function program(patches){
  let body = `
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
${extractFunction('evaluate')}
${OTHER.map(extractFunction).join('\n')}
${validationSrc()}
this.run = d => { state.data = normalize(d); return strategyValidation(); };
`;
  for(const [find, repl] of (patches||[])){
    if(!body.includes(find)) die('패치 앵커 못 찾음: '+find.slice(0,60));
    body = body.split(find).join(repl);
  }
  return body;
}
function run(patches, data){
  const ctx = { console, Math, Number, Object, Array, Set, Map, String, JSON };
  vm.createContext(ctx);
  vm.runInContext(program(patches), ctx);
  return ctx.run(data);
}

/* ── 표본 창 / 전·후반 ── */
const F = base.hist_fields, I_D = F.indexOf('date');
const days = [...new Set(base.stocks.flatMap(s => (s.hist||[]).map(r => String(r[I_D]))))].sort();
const MID = days[Math.floor(days.length/2)];
function clip(pred){
  const d = JSON.parse(JSON.stringify(base));
  for(const s of d.stocks) s.hist = (s.hist||[]).filter(r => pred(String(r[I_D])));
  return d;
}

const cell=(s,b)=>{
  if(!s || s.rate===null) return `  —(${String(s?s.n:0).padStart(3)})      `;
  const e=(b&&b.rate!==null)?`${s.rate-b.rate>=0?'+':''}${s.rate-b.rate}`.padStart(4)+'%p':'      ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(3)})${e}`;
};
function report(title, patches, rows){
  const v = run(patches, base);
  console.log(`\n■ ${title}`);
  for(const [lab,get] of rows){
    const s=get(v); if(!s) continue;
    console.log(`  ${lab.padEnd(10)}`+[1,3,5].map(h=>cell(s[h],v._baseline[h]).padEnd(17)).join(''));
  }
  // 전·후반 (핵심 행만)
  const H1=run(patches,clip(d=>d<MID)), H2=run(patches,clip(d=>d>=MID));
  const key=rows[0];
  const f=v=>[1,3,5].map(h=>cell(key[1](v)[h],v._baseline[h]).padEnd(17)).join('');
  console.log(`  ${'· 전반'.padEnd(9)}${f(H1)}`);
  console.log(`  ${'· 후반'.padEnd(9)}${f(H2)}`);
  return v;
}

const R_STRICT=[['💡',v=>v._strict],['다중',v=>v.multi],['초록',v=>v._strongBuy]];
const R_PULL=[['추세',v=>v.pull],['💡',v=>v._strict],['초록',v=>v._strongBuy]];
const R_REV=[['반등',v=>v.rev],['💡',v=>v._strict],['초록',v=>v._strongBuy]];

/* ══════════ E2: 💡 구성 분해 모드 ══════════ */
if(process.argv[2]==='comp'){
  // 다중 검증 표본에 "어느 전략이 강매를 만들었나"를 붙이고 원시 표본을 내보낸다.
  const patches=[
    ["tier:sel._multiTier});",
     "tier:sel._multiTier,_drv:(ent.row.sig.pullGrade===5&&ent.row.sig.revGrade===5)?'both':(ent.row.sig.pullGrade===5?'pull':'rev')});"],
    ["result._strict={};",
     "result._multiSamples=out.multi; result._strict={};"]
  ];
  const v=run(patches, base);
  const show=(label,filter)=>{
    const line=[1,3,5].map(h=>{
      const xs=((v._multiSamples&&v._multiSamples[h])||[]).filter(filter);
      const dec=xs.filter(x=>Math.abs(x.ret)>1);
      const w=dec.filter(x=>x.ret>1).length;
      const rate=dec.length?Math.round(w/dec.length*100)+'%':'—';
      const avg=xs.length?(xs.reduce((a,x)=>a+x.ret,0)/xs.length).toFixed(2):'—';
      return `${rate}(${String(xs.length).padStart(3)}) 평균${avg}%`;
    }).join('   ');
    console.log(`  ${label.padEnd(12)}${line}`);
  };
  console.log('■ E2 💡(강한다중) 구성 분해 — 표본이 어느 전략에서 왔나 (+1/+3/+5)');
  show('💡 추세발', x=>x.tier===1&&x._drv==='pull');
  show('💡 반등발', x=>x.tier===1&&x._drv==='rev');
  show('💡 양쪽',   x=>x.tier===1&&x._drv==='both');
  console.log('■ 초록뱃지 전략별 (배포 산식이 이미 집계)');
  const GS=v._strongByStrategy||{};
  for(const k of ['pull','rev']){
    const line=[1,3,5].map(h=>{
      const s=(GS[k]||{})[h]; return s?`${s.rate===null?'—':s.rate+'%'}(${String(s.n).padStart(3)})`:'—';
    }).join('   ');
    console.log(`  ${(k==='pull'?'추세발':'반등발').padEnd(12)}${line}`);
  }
  process.exit(0);
}

/* ══════════ 대조군 ══════════ */
report('P0 현행 (대조군)', [], R_STRICT);

/* ══════════ E1: 💡 과열 제외 ══════════ */
report('E1 💡에서 과열(RSI>=70 또는 BB>=95) 제외', [[
  A_STRICT,
  "const strict=previousOverallGrade(s)===3 && strictMultiGate(s) && fallbackStrict && strictChase && !(s.sig&&s.sig.overheat);"
]], R_STRICT);

/* ══════════ E3: 💡 전일 중립 요건 해제 ══════════ */
report('E3 💡 "전일 중립" 전환 요건 해제', [[
  A_STRICT,
  "const strict=strictMultiGate(s) && fallbackStrict && strictChase;"
]], R_STRICT);

/* ══════════ E4: 추세 추격 컷 ATR 상대화 ══════════ */
for(const k of [2,3]){
  report(`E4 추세 추격 컷 run3<=max(5, ATR*${k}) (1배 환산)`, [[
    A_CHASE,
    `const pullChase = run3Eff===null || run3Eff<=Math.max(5,(has(s.atr_pct)?s.atr_pct/levMul:0)*${k});`
  ]], R_PULL);
}

/* ══════════ E5: 미너비니 ④ 완화 스윕 ══════════ */
for(const t of [30,35,40,50]){
  report(`E5 고점대비 컷 -25 → -${t}`, [[
    A_NEARHI,
    `const nearHighM = has(s.pct_from_high) && s.pct_from_high >= -${t};`
  ]], R_PULL);
}

/* ══════════ E6: 항복 바닥 직접 진입 (반등 OR 경로) ══════════ */
for(const [bb,rsi] of [[10,35],[15,38]]){
  report(`E6 반등 강매 OR: BB<=${bb} & RSI<=${rsi} & run3<=0 (항복 바닥)`, [[
    A_REV,
    `const revStrong = (revScore>=2.0 && has(rsi) && revRsiOK && sectorOK && revChase) || (has(bb)&&bb<=${bb}&&has(rsi)&&rsi<=${rsi}&&sectorOK&&run3Eff!==null&&run3Eff<=0);`
  ]], R_REV);
}

console.log('\n※ 판정은 방법론 §1·§2·§5-1 순서로: 기준선 %p → 전·후반 모두 개선 → 표본 15+.');
console.log('  이 파일은 실험 전용이다. 결과가 좋아도 배포 반영은 사용자 승인 후에만 한다.');
