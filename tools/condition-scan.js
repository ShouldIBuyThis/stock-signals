#!/usr/bin/env node
/**
 * PRIVATE 조건 스캔 — 추세 강매·💡 관문에 조건 하나씩 얹어 전수 비교 (읽기 전용)
 *
 * ⚠ 이 도구는 다중비교 함정을 만드는 도구다. 수십 개 조건을 훑어보고
 *   이긴 것을 고르면, 표본이 작을수록 '우연히 이긴 것'이 반드시 섞인다.
 *   그래서 출력에 항상 아래를 같이 찍는다.
 *     · 표본 n (§5-1: 15 미만 신뢰 불가)
 *     · 전·후반 각각의 성적 (§2: 한쪽만 좋으면 국면 잔상)
 *     · 남는 종목 수 (§5: 2~3종목이면 그 종목 성적일 뿐)
 *   세 검사를 모두 통과한 것만 '후보'로 부른다. 나머지는 기록만 한다.
 *
 * 사용: node tools/condition-scan.js [pull|bulb]   (기본 pull)
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const MODE = (process.argv[2] || 'pull').toLowerCase();

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

const PULL_LINE = `const pullGrade = pullSetup && pullScore>=1.5 && sectorOK && nearHighM && pullChase ? 5 :
    (pullSetup && pullScore>=0.8 ? 4 : 3);`;
const STRICT_ANCHOR = 'const strict=previousOverallGrade(s)===3 && strictMultiGate(s) && fallbackStrict && strictChase;';

const OTHER = ['qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings'];
const VANCHOR = 'result._diag=diag;';

function build(cond){
  let ev = extractFunction('evaluate');
  let msr = extractFunction('multiSignalRank');
  if(MODE === 'pull'){
    if(!ev.includes(PULL_LINE)) die('추세 게이트 라인 없음');
    if(cond) ev = ev.replace(PULL_LINE,
      `const pullGrade = pullSetup && pullScore>=1.5 && sectorOK && nearHighM && pullChase && (${cond}) ? 5 :
    (pullSetup && pullScore>=0.8 ? 4 : 3);`);
  } else {
    if(!msr.includes(STRICT_ANCHOR)) die('💡 관문 라인 없음');
    if(cond) msr = msr.replace(STRICT_ANCHOR,
      `const strict=previousOverallGrade(s)===3 && strictMultiGate(s) && fallbackStrict && strictChase && (${cond});`);
  }
  let vs = extractFunction('strategyValidation');
  vs = vs.replace(VANCHOR, VANCHOR + '\n  result._rows={pull:out.pull, multi:out.multi};');
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
${msr}
${vs}
this.run = d => { state.data = normalize(d); return strategyValidation(); };
`, ctx);
  return ctx;
}

const F = base.hist_fields, I_D = F.indexOf('date');
const days = [...new Set(base.stocks.flatMap(s=>(s.hist||[]).map(r=>String(r[I_D]))))].sort();
const MID = days[Math.floor(days.length/2)];
const clip = pred => { const d=JSON.parse(JSON.stringify(base)); for(const s of d.stocks) s.hist=(s.hist||[]).filter(r=>pred(String(r[I_D]))); return d; };

/* 후보 조건 — evaluate()/multiSignalRank() 안에서 유효한 식만 쓴다.
   evaluate 안: p, ma20, ma60, rsi, bb, vr, pct, s.*  /  multiSignalRank 안: s.* 만 */
const IN_EVAL = [
  ['MACD 0선 위',            's.macd_zero==="above"'],
  ['MACD 히스토 > 0',        'has(s.macd)&&s.macd>0'],
  ['거래량비 >= 1.0',        'has(vr)&&vr>=1.0'],
  ['거래량비 <= 1.0',        'has(vr)&&vr<=1.0'],
  ['RSI 45~65',              'has(rsi)&&rsi>=45&&rsi<=65'],
  ['RSI <= 60',              'has(rsi)&&rsi<=60'],
  ['RSI >= 50',              'has(rsi)&&rsi>=50'],
  ['볼린저 <= 80',           'has(bb)&&bb<=80'],
  ['볼린저 40~85',           'has(bb)&&bb>=40&&bb<=85'],
  ['스토캐스틱 K <= 80',     'has(s.stoch_k)&&s.stoch_k<=80'],
  ['MA20 기울기 >= 0',       'has(s.ma20_slope)&&s.ma20_slope>=0'],
  ['MA20 기울기 >= 1',       'has(s.ma20_slope)&&s.ma20_slope>=1'],
  ['상대강도 rs20 >= 0',     'has(s.rs20)&&s.rs20>=0'],
  ['상대강도 rs20 >= 5',     'has(s.rs20)&&s.rs20>=5'],
  ['저항까지 3% 이상',       '!has(s.res_short)||!has(p)||p<=0||(s.res_short/p-1)*100>=3'],
  ['저항까지 5% 이상',       '!has(s.res_short)||!has(p)||p<=0||(s.res_short/p-1)*100>=5'],
  ['ATR <= 6%',              'has(s.atr_pct)&&s.atr_pct<=6'],
  ['변동폭 수축(range3<range10)', 'has(s.range3)&&has(s.range10)&&s.range10>0&&s.range3<s.range10'],
  ['시장 중립 이상',         's.market_level==="neutral"||s.market_level==="strong"'],
  ['고점대비 -15% 이내',     'has(s.pct_from_high)&&s.pct_from_high>=-15'],
  ['고점대비 -10% 이내',     'has(s.pct_from_high)&&s.pct_from_high>=-10'],
  ['3일누적 <= 5%',          '!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=5'],
  ['당일 상승',              'has(pct)&&pct>=0'],
  ['MA60 위',                'has(p)&&has(ma60)&&p>ma60'],
  /* §3 고원 확인 — 통과 조건의 이웃 값 */
  ['3일누적 <= 0%',          '!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=0'],
  ['3일누적 <= 1.5%',        '!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=1.5'],
  ['3일누적 <= 3%',          '!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=3'],
  ['3일누적 <= 4%',          '!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=4'],
  ['3일누적 <= 7%',          '!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=7'],
  ['3일누적 <= 10%',         '!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=10'],
  ['볼린저 <= 75',           'has(bb)&&bb<=75'],
  ['볼린저 <= 85',           'has(bb)&&bb<=85'],
  ['볼린저 <= 90',           'has(bb)&&bb<=90'],
  /* 조합 */
  ['[조합] 3일<=5 + 볼린저<=80', '(!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=5)&&has(bb)&&bb<=80'],
  ['[조합] 3일<=5 + MACD>0',    '(!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=5)&&has(s.macd)&&s.macd>0'],
  ['[조합] 볼린저<=80 + MACD>0', 'has(bb)&&bb<=80&&has(s.macd)&&s.macd>0'],
];
const IN_MULTI = IN_EVAL.map(([n,e])=>[n, e
  .replace(/\bhas\(rsi\)/g,'has(s.rsi)').replace(/\brsi\b(?!_)/g,'s.rsi')
  .replace(/\bhas\(bb\)/g,'has(s.bb_pos)').replace(/\bbb\b/g,'s.bb_pos')
  .replace(/\bhas\(vr\)/g,'has(s.vol_ratio)').replace(/\bvr\b/g,'s.vol_ratio')
  .replace(/\bhas\(pct\)&&pct\b/g,'has(s.change_1d)&&s.change_1d')
  .replace(/\bhas\(p\)/g,'has(s.price)').replace(/\bp\b(?![a-z_])/g,'s.price')
  .replace(/\bma60\b/g,'s.ma60')
]);
const CONDS = MODE==='pull' ? IN_EVAL : IN_MULTI;
const KEY = MODE==='pull' ? 'pull' : '_strict';
const LABEL = MODE==='pull' ? '추세 강한매수' : '💡 강한다중';

console.log(`■ ${LABEL} 관문에 조건 하나씩 추가 — 전수 비교`);
console.log(`표본 ${days[0]}~${days[days.length-1]} (${days.length}거래일) · 전후반 분기 ${MID}`);
console.log('⚠ 다중비교 함정: 조건 24개를 훑어보는 중이다. 이긴 것이 우연일 수 있어 세 검사를 같이 찍는다.\n');

const get = (v)=> KEY==='pull' ? v.pull : v._strict;
const rowsOf = (v)=> KEY==='pull' ? (v._rows.pull||{}) : (v._rows.multi||{});
const tickersAt = (v,h)=>{
  const rows=(rowsOf(v)[h]||[]).filter(x=>KEY==='pull' ? x.tier===5 : x.tier===1);
  return new Set(rows.map(x=>x.ticker)).size;
};

const BASEV = build(null).run(base);
const B = get(BASEV);
console.log(`대조군(현행): +1일 ${B[1].rate}%(${B[1].n})  +3일 ${B[3].rate}%(${B[3].n})  +5일 ${B[5].rate}%(${B[5].n})  종목 ${tickersAt(BASEV,3)}개\n`);

const results = [];
for(const [name, expr] of CONDS){
  let v;
  try { v = build(expr).run(base); } catch(e){ console.log(`  ${name.padEnd(24)} [실행오류] ${e.message.slice(0,40)}`); continue; }
  const g = get(v);
  results.push({name, expr, g, tick:tickersAt(v,3), v});
  const f=h=>`${g[h].rate===null?'—':g[h].rate+'%'}(${g[h].n})`.padStart(10);
  const d=h=>{const a=B[h].rate,b=g[h].rate; return (a===null||b===null)?'   —':`${b-a>=0?'+':''}${b-a}`.padStart(4)+'%p';};
  console.log(`  ${name.padEnd(26)}${f(1)}${d(1)} ${f(3)}${d(3)} ${f(5)}${d(5)}  종목${String(tickersAt(v,3)).padStart(3)}`);
}

/* ── 세 검사 통과분만 후보로 ── */
console.log('\n\n■ 후보 판정 — §5-1(표본 15+) · §5(종목 5+) · §2(전후반 양쪽 개선) 전부 통과');
const survivors = [];
for(const r of results){
  const gainAll = [1,3,5].filter(h=>r.g[h].rate!==null&&B[h].rate!==null&&r.g[h].rate>B[h].rate).length;
  if(gainAll < 2) continue;                       // 3칸 중 2칸 이상 개선
  if(r.g[3].n < 15 || r.tick < 5) continue;       // 표본·종목 최소치
  const H1 = build(r.expr).run(clip(d=>d<MID)), H2 = build(r.expr).run(clip(d=>d>=MID));
  const B1 = build(null).run(clip(d=>d<MID)),    B2 = build(null).run(clip(d=>d>=MID));
  const g1=get(H1), g2=get(H2), b1=get(B1), b2=get(B2);
  const ok1=[1,3,5].some(h=>g1[h].rate!==null&&b1[h].rate!==null&&g1[h].rate>=b1[h].rate);
  const ok2=[1,3,5].some(h=>g2[h].rate!==null&&b2[h].rate!==null&&g2[h].rate>=b2[h].rate);
  const pass = ok1 && ok2;
  survivors.push({...r, pass, g1, g2, b1, b2});
  const f=(g,h)=>`${g[h].rate===null?'—':g[h].rate+'%'}(${g[h].n})`.padStart(10);
  console.log(`\n  ${pass?'✔ 통과':'✘ 탈락'} ${r.name}`);
  console.log(`    전체 ${f(r.g,1)} ${f(r.g,3)} ${f(r.g,5)}   종목 ${r.tick}개`);
  console.log(`    전반 ${f(g1,1)} ${f(g1,3)} ${f(g1,5)}   (대조군 ${f(b1,1)} ${f(b1,3)} ${f(b1,5)})`);
  console.log(`    후반 ${f(g2,1)} ${f(g2,3)} ${f(g2,5)}   (대조군 ${f(b2,1)} ${f(b2,3)} ${f(b2,5)})`);
}
if(!survivors.some(s=>s.pass)) console.log('\n  통과한 조건 없음 — 이 창에서 얻은 개선은 전부 우연 가능성이 크다.');
