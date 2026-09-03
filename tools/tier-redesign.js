#!/usr/bin/env node
/**
 * PRIVATE 계층 재설계 실험실 — 추세 매수관심(등급4) · 💡 강한다중 관문 (읽기 전용)
 *
 * 두 문제를 같은 하네스에서 다룬다.
 *
 *  ① 추세 매수관심이 기준선과 같고 평균수익은 마이너스다.
 *     50/53/50% · 평균 −0.26/−0.27/−0.52%  (기준선 49/50/49% · +0.09/+0.34/+0.03%)
 *     구간 분해 결과 손실은 한 군데에 몰려 있다:
 *       볼린저 55~70  27%/33%/23%  평균 −1.84/−2.07/−4.32  (n=23/18/15, 14종)
 *       RSI 50~60    43%/35%/21%  평균 −0.95/−2.06/−4.07  (n=28/23/17, 18종)
 *     반대로 볼린저>70(58/60/61%)·RSI>60(56/61/61%)은 기준선을 넘는다.
 *     즉 이 계층에서 지는 건 '밴드 하단의 눌림'이 아니라 **식어가는 추세**다.
 *
 *  ② 💡(강한다중)이 일반다중보다 +5일 승률이 낮다 (85% vs 88%).
 *     strictMultiGate가 b||c 인데 c(RSI<=55 & 거래량>=0.8)에는 **볼린저 상한이 없다**.
 *     반면 일반다중은 bb<=68 && rsi<=60을 강제한다 — 상위 계층이 더 헐거운 역전이다.
 *       b만 통과   91%/83%/89%  평균 +1.58/+2.89/+4.60  (n=18)
 *       c만 통과   33%/75%/67%  평균 −0.10/+3.16/+1.38  (n= 6)  ← 유일한 약점
 *       b·c 둘 다  78%/100%/88% 평균 +3.13/+9.64/+15.48 (n= 9)
 *
 * ⚠ 두 축은 서로 얽혀 있다. 💡은 '전일 등급이 3(중립)'을 요구하므로, 매수관심(4)을
 *   중립(3)으로 떨어뜨리면 다음날 💡 후보가 늘어난다. 그래서 반드시 전체 검증표를
 *   같이 찍는다 — 한 축만 보고 판단하면 안 된다.
 *
 * 사용: node tools/tier-redesign.js [T|P|S|MIX]   (기본 전부)\n *   T 추세 강한매수 · P 추세 매수관심 · S 💡 관문 · MIX 조합+전후반
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const ONLY = (process.argv[2] || '').toUpperCase();

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
function extractLine(re){ const m=src.match(re); if(!m) die(String(re)); return m[0]; }
function extractConst(name){ const st=src.indexOf(`const ${name} =`); if(st<0) die(name); return src.slice(st, src.indexOf(';',st)+1); }

/* ── 배포 소스 앵커 ── */
const PULL_LINE = `const pullGrade = pullSetup && pullScore>=1.3 && sectorOK && nearHighM && pullChase && pullBandOK ? 5 :
    (pullSetup && pullScore>=0.8 && pullInterestOK ? 4 : 3);`;
/* v10에서 c 경로를 지웠다. 실험은 b·c를 다시 만들어 비교하므로 여기서
   두 갈래를 재구성한다 — 배포 소스에는 b만 남아 있다. */
const STRICT_FN = `function strictMultiGate(s){
  return has(s.bb_pos)&&s.bb_pos<=80 && has(s.change_1d)&&s.change_1d<=2;
}`;

/* opt = { pullInterest, pullStrong, pullSectorRel, strictBody } — 전부 생략 가능 */
function patchedEvaluate(opt){
  let e = extractFunction('evaluate');
  if(!e.includes(PULL_LINE)) die('추세 등급 라인 앵커를 못 찾음');
  const interest = opt.pullInterest ? `(${opt.pullInterest})` : 'pullInterestOK';
  const strong   = opt.pullStrong ? ` && (${opt.pullStrong})` : '';
  /* 섹터 게이트는 추세 경로에서만 조건부 해제한다 — 반등 쪽 검증표를 흔들지 않도록 */
  const sector   = opt.pullSectorRel ? `(sectorOK || (${opt.pullSectorRel}))` : 'sectorOK';
  /* pullBandOK(볼린저<=80)는 배포값이다. pullStrong으로 덮어쓰려면 band:false를 준다. */
  const band     = opt.band === false ? '' : ' && pullBandOK';
  e = e.replace(PULL_LINE,
    `const pullGrade = pullSetup && pullScore>=1.3 && ${sector} && nearHighM && pullChase${band}${strong} ? 5 :
    (pullSetup && pullScore>=0.8 && ${interest} ? 4 : 3);`);
  return e;
}
function patchedStrict(opt){
  if(!src.includes(STRICT_FN)) die('strictMultiGate 앵커를 못 찾음');
  if(!opt.strictBody) return extractFunction('strictMultiGate');   // 배포값 = b만
  return `function strictMultiGate(s){
  const b=has(s.bb_pos)&&s.bb_pos<=80 && has(s.change_1d)&&s.change_1d<=2;
  const c=has(s.rsi)&&s.rsi<=55 && has(s.vol_ratio)&&s.vol_ratio>=0.8;
  return ${opt.strictBody};
}`;
}

const OTHER = ['qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings'];
const ANCHOR = 'result._diag=diag;';
function validationSrc(){
  let f = extractFunction('strategyValidation');
  if(!f.includes(ANCHOR)) die('strategyValidation 앵커 없음');
  return f.replace(ANCHOR, ANCHOR +
    '\n  result._rows={multi:out.multi, pull:out.pull, rev:out.rev, strong:strongBuyOut};' +
    '\n  result._general={}; horizons.forEach(h=>{ result._general[h]=stat((out.multi[h]||[]).filter(x=>x.tier===2)); });');
}

function ctxFor(opt){
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
${patchedEvaluate(opt)}
${patchedStrict(opt)}
${OTHER.map(extractFunction).join('\n')}
${validationSrc()}
this.run = d => { state.data = normalize(d); return strategyValidation(); };
`, ctx);
  return ctx;
}
const cache = new Map();
function run(opt, data){
  const k = JSON.stringify(opt);
  if(data === base && cache.has(k)) return cache.get(k);
  const v = ctxFor(opt).run(data);
  if(data === base) cache.set(k, v);
  return v;
}

const F = base.hist_fields, I_D = F.indexOf('date');
const days = [...new Set(base.stocks.flatMap(s => (s.hist||[]).map(r => String(r[I_D]))))].sort();
const MID = days[Math.floor(days.length/2)];
const clip = pred => {
  const d = JSON.parse(JSON.stringify(base));
  for(const s of d.stocks) s.hist = (s.hist||[]).filter(r => pred(String(r[I_D])));
  return d;
};

const cell = s => (s && s.n) ? `${String(s.rate===null?'—':s.rate).padStart(3)}%(${String(s.n).padStart(3)}) ${(s.avg>=0?'+':'')+(Math.round(s.avg*100)/100)}%`.padEnd(19)
                             : '    —              ';
const P0 = run({}, base);
const B = P0._baseline;
console.log(`표본 창 ${days[0]} ~ ${days[days.length-1]} (${days.length}거래일) · 전후반 분기 ${MID}`);
console.log(`기준선  ${[1,3,5].map(h=>cell(B[h])).join('')}\n`);

/* ══════════ T. 추세 강한매수(등급5) 관문 후보 ══════════
   구간 분해 실측 (배포 v10, 추세 강매 tier5):
     볼린저 50~65   88%(11) +1.06%  88%( 9) +3.71%  88%( 8) +4.09%   7종
     볼린저 65~80   73%(26) +1.04%  72%(21) +1.32%  75%(16) +1.86%  11종
     볼린저 >80      0%(13) +0.06%  50%(12) -0.01%  63%(11) +0.87%   8종  ← 재앙
     3일누적 2.5~5  50%( 4) -0.15%  50%( 4) -0.29%   0%( 3) -1.15%   4종
     rs20>=10      56%(14) +0.01%  55%(12) -0.59%  60%( 9) +1.15%  10종
     당일 음봉      77%(37) +0.95%  74%(31) +1.89%  76%(24) +2.50%  16종
     당일 0~2      50%(13) +0.33%  60%(11) +0.23%  71%(11) +1.11%   7종
   +1일 0%(13건, 8종목)은 우연으로 보기 어렵다. 눌림목 전략인데 가격이 밴드
   상단을 뚫은 자리에서 산 것이라, '눌림'이라는 전제 자체가 깨진 표본이다. */
const TC = [
  ['T0  현행 (v11 · 볼린저<=80)',     {}],
  ['T-  볼린저 상한 없음 (v10)',      {band:false}],
  ['T1  +볼린저<=80',                 {pullStrong:'has(bb)&&bb<=80'}],
  ['T2  +볼린저<=75',                 {pullStrong:'has(bb)&&bb<=75'}],
  ['T3  +볼린저<=85',                 {pullStrong:'has(bb)&&bb<=85'}],
  ['T4  +당일 음봉(<=0)',             {pullStrong:'has(s.change_1d)&&s.change_1d<=0'}],
  ['T5  +추격 run3<=2.5',            {pullStrong:'!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=2.5'}],
  ['T6  +볼린저<=80 & 추격<=2.5',      {pullStrong:'(has(bb)&&bb<=80)&&(!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=2.5)'}],
  ['T7  +볼린저<=80 & 당일음봉',        {pullStrong:'(has(bb)&&bb<=80)&&(has(s.change_1d)&&s.change_1d<=0)'}],
  /* 섹터 게이트 조건부 해제 — 추세 경로만. SNOW 7/27이 여기 걸려 있다
     (약세장 · 소프트웨어 비방어 · 그런데 rs20 13.1 · 정배열 · 고점대비 -4.2%) */
  ['T8  섹터해제: rs20>=10 & 고점>=-10', {pullSectorRel:'(has(s.rs20)&&s.rs20>=10)&&(has(s.pct_from_high)&&s.pct_from_high>=-10)'}],
  ['T9  섹터해제: rs20>=10 & 정배열',    {pullSectorRel:'(has(s.rs20)&&s.rs20>=10)&&(has(ma20)&&has(s.ma50)&&has(ma60)&&ma20>s.ma50&&s.ma50>ma60)'}],
  ['T10 섹터해제: 고점>=-10 & 정배열',    {pullSectorRel:'(has(s.pct_from_high)&&s.pct_from_high>=-10)&&(has(ma20)&&has(s.ma50)&&has(ma60)&&ma20>s.ma50&&s.ma50>ma60)'}],
  ['T11 T1 + T8 (조이고 열기)',        {pullStrong:'has(bb)&&bb<=80', pullSectorRel:'(has(s.rs20)&&s.rs20>=10)&&(has(s.pct_from_high)&&s.pct_from_high>=-10)'}],
  ['T12 T7 + T8',                    {pullStrong:'(has(bb)&&bb<=80)&&(has(s.change_1d)&&s.change_1d<=0)', pullSectorRel:'(has(s.rs20)&&s.rs20>=10)&&(has(s.pct_from_high)&&s.pct_from_high>=-10)'}],
];
if(!ONLY || ONLY==='T'){
  console.log('■ T. 추세 강한매수 관문 후보 (초록뱃지·💡 동반 영향도 같이 찍는다)');
  console.log('  ' + '변형'.padEnd(30) + '추세강매 +1일'.padEnd(19) + '+3일'.padEnd(19) + '+5일'.padEnd(21) + '초록 +5일');
  console.log('  ' + '─'.repeat(112));
  for(const [lab, opt] of TC){
    const v = run(opt, base);
    console.log(`  ${lab.padEnd(30)}${[1,3,5].map(h=>cell(v.pull[h])).join('')}${cell(v._strongBuy[5])}`);
  }
  console.log('');
}

/* ══════════ P. 추세 매수관심 관문 후보 ══════════ */
const PC = [
  ['P0  현행 (배포값 = 볼린저>70)',  null],
  ['P1  볼린저>70 (=P0 재현 확인)',  'has(s.bb_pos)&&s.bb_pos>70'],
  ['P2  RSI>60',                 'has(s.rsi)&&s.rsi>60'],
  ['P3  볼린저>70 또는 RSI>60',    '(has(s.bb_pos)&&s.bb_pos>70)||(has(s.rsi)&&s.rsi>60)'],
  ['P4  볼린저>70 且 RSI>60',      '(has(s.bb_pos)&&s.bb_pos>70)&&(has(s.rsi)&&s.rsi>60)'],
  ['P5  고점대비>=-40',           'has(s.pct_from_high)&&s.pct_from_high>=-40'],
  ['P6  고점대비>=-25 (④ 확장)',   'has(s.pct_from_high)&&s.pct_from_high>=-25'],
  ['P7  볼린저>70 + 고점>=-25',    '(has(s.bb_pos)&&s.bb_pos>70)&&(has(s.pct_from_high)&&s.pct_from_high>=-25)'],
  ['P8  추격 run3<=5',            '!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=5'],
  ['P9  볼린저>70 + 추격<=5',      '(has(s.bb_pos)&&s.bb_pos>70)&&(!has(s.run3_sum)||s.run3_sum/levX(s.ticker)<=5)'],
  ['P10 볼린저 관문 없음 (v10 이전)', 'true'],
  ['P11 볼린저>70 + 약세 제외',    '(has(s.bb_pos)&&s.bb_pos>70)&&s.market_level!=="weak"'],
];
/* §3 고원 확인용 이웃값 */
const PN = [65,68,70,72,75].map(v => [`P1' 볼린저>${v}`, `has(s.bb_pos)&&s.bb_pos>${v}`]);

function pullRow(label, expr){
  const v = run({pullInterest:expr}, base);
  const i = v._interest.pull;
  return { v, line: `  ${label.padEnd(26)}${[1,3,5].map(h=>cell(i[h])).join('')}` };
}
if(!ONLY || ONLY==='P'){
  console.log('■ P. 추세 매수관심(등급4) 관문 후보 — 손실 구간(볼린저 55~70 · RSI 50~60)을 겨냥한다');
  console.log('  ' + '변형'.padEnd(24) + '+1일'.padEnd(19) + '+3일'.padEnd(19) + '+5일');
  console.log('  ' + '─'.repeat(82));
  for(const [lab, ex] of PC) console.log(pullRow(lab, ex).line);
  console.log('\n  §3 고원 확인 — 볼린저 컷 이웃값');
  for(const [lab, ex] of PN) console.log(pullRow(lab, ex).line);
  console.log('');
}

/* ══════════ S. 💡 strictMultiGate 후보 ══════════ */
const SC = [
  ['S0  현행 (배포값 = b만)',            null],
  ['S1  b||c (v10 이전 · 되돌림 확인)',  'b||c'],
  ['S2  b || (c 且 볼린저<=68)',         'b || (c && has(s.bb_pos)&&s.bb_pos<=68)'],
  ['S3  (b||c) 且 볼린저<=68',           '(b||c) && has(s.bb_pos)&&s.bb_pos<=68'],
  ['S4  (b||c) 且 볼린저<=72',           '(b||c) && has(s.bb_pos)&&s.bb_pos<=72'],
  ['S5  (b||c) 且 일반과 동일(68·60)',   '(b||c) && has(s.bb_pos)&&s.bb_pos<=68 && has(s.rsi)&&s.rsi<=60'],
  ['S6  b && c (둘 다 요구)',            'b && c'],
  /* c 경로가 왜 나쁜지 확인용: c는 '당일 상승률' 제한이 없다.
     볼린저>80 표본이 0건이므로, c만 통과 = **당일 2% 초과 급등**을 통과시킨 것이다. */
  ['S7  b || (c 且 당일<=2)  ≡ 당일 2% 컷',  'b || (c && has(s.change_1d)&&s.change_1d<=2)'],
  ['S8  b || (c 且 당일<=4)',              'b || (c && has(s.change_1d)&&s.change_1d<=4)'],
  ['S9  b || (c 且 당일<=6)',              'b || (c && has(s.change_1d)&&s.change_1d<=6)'],
  /* §3 고원: b의 당일 컷을 흔든다 */
  ['S10 당일<=1 (b 컷 조임)',               '(has(s.bb_pos)&&s.bb_pos<=80 && has(s.change_1d)&&s.change_1d<=1)'],
  ['S11 당일<=2 (=S1)',                    '(has(s.bb_pos)&&s.bb_pos<=80 && has(s.change_1d)&&s.change_1d<=2)'],
  ['S12 당일<=3',                          '(has(s.bb_pos)&&s.bb_pos<=80 && has(s.change_1d)&&s.change_1d<=3)'],
  ['S13 당일<=4',                          '(has(s.bb_pos)&&s.bb_pos<=80 && has(s.change_1d)&&s.change_1d<=4)'],
];
function strictRow(label, body, pullExpr){
  const v = run({strictBody:body, pullInterest:pullExpr||null}, base);
  return { v, line: `  ${label.padEnd(28)}${[1,3,5].map(h=>cell(v._strict[h])).join('')}| 일반 ${[1,3,5].map(h=>cell(v._general[h])).join('')}` };
}
if(!ONLY || ONLY==='S'){
  console.log('■ S. 💡 strictMultiGate 후보 — c 경로(RSI·거래량)에 볼린저 상한이 없는 게 원인');
  console.log('  ' + '변형'.padEnd(26) + '💡 +1일'.padEnd(19) + '+3일'.padEnd(19) + '+5일'.padEnd(21) + '일반다중 +1/+3/+5');
  console.log('  ' + '─'.repeat(130));
  for(const [lab, body] of SC) console.log(strictRow(lab, body).line);
  console.log('');
}

/* ══════════ MIX + §2 ══════════ */
if(!ONLY || ONLY==='MIX'){
  const BEST_P = 'has(s.bb_pos)&&s.bb_pos>70';
  const BEST_S = 'b';   // S1 — c 경로(당일 2% 초과 급등 통과) 제거
  console.log('■ MIX. 두 축 동시 적용 — 💡은 전일 등급 3을 요구하므로 매수관심 변경이 💡에 되먹임된다');
  console.log('  ' + '─'.repeat(96));
  const cases = [
    ['현행',              {}],
    ['추세관심만 (볼린저>70)', {pullInterest:BEST_P}],
    ['💡만 (S1)',          {strictBody:BEST_S}],
    ['둘 다',              {pullInterest:BEST_P, strictBody:BEST_S}],
  ];
  for(const [lab, opt] of cases){
    const v = run(opt, base);
    console.log(`\n  ${lab}`);
    for(const [nm, get] of [['💡',v=>v._strict],['일반다중',v=>v._general],['다중전체',v=>v.multi],
                            ['🟢초록',v=>v._strongBuy],['📈추세강매',v=>v.pull],['  추세관심',v=>v._interest.pull],
                            ['🔄반등강매',v=>v.rev],['  반등관심',v=>v._interest.rev]]){
      console.log(`    ${nm.padEnd(11)}${[1,3,5].map(h=>cell(get(v)[h])).join('')}`);
    }
  }
  console.log('\n■ §2 전·후반 (최종안: 추세관심 볼린저>70 + 💡 S1)');
  console.log('  ' + '─'.repeat(96));
  const opt = {pullInterest:BEST_P, strictBody:BEST_S};
  for(const [lab, data] of [['전반', clip(d=>d<MID)], ['후반', clip(d=>d>=MID)]]){
    const v0 = ctxFor({}).run(data), v1 = ctxFor(opt).run(data);
    for(const [nm, get] of [['💡',v=>v._strict],['추세관심',v=>v._interest.pull]]){
      const f = v => [1,3,5].map(h => {
        const s=get(v)[h], b=v._baseline[h];
        return `${s.n?(s.rate===null?'—':s.rate+'%'):'—'}(${s.n})${(s.n&&s.rate!==null&&b.rate!==null)?` ${s.rate-b.rate>=0?'+':''}${s.rate-b.rate}%p`:''}`.padEnd(18);
      }).join('');
      console.log(`  ${lab} ${nm.padEnd(9)} 현행 ${f(v0)}`);
      console.log(`  ${''.padEnd(2)} ${''.padEnd(9)} 변경 ${f(v1)}`);
    }
  }
}
