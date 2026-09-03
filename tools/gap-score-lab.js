#!/usr/bin/env node
/**
 * 갭 점수 보정 시뮬레이션 — "가점을 주면 승률이 실제로 오르나" (읽기 전용)
 *
 * 사용자 결정 기준(2026-08-19): "승률 보고 결정해서 점수 보정 여부 보고 싶어."
 * 그래서 뱃지 논의가 아니라 **점수에 실제로 가점을 걸고 검증표를 다시 잰다.**
 *
 * 왜 백테스트 원본이 필요한가 — 가점은 어떤 날이 '강한매수'가 되는지 자체를
 * 바꾼다. 신호 표본만 있으면 새로 편입되는 날을 만들 수 없어서, 매일치 지표가
 * 전부 있는 backtest/raw.json 위에서 evaluate()를 다시 돌려야 한다.
 * raw.json은 커밋하지 않으므로 이 스크립트는 **워크플로우 안에서만** 돈다.
 *
 * 판정 규칙(방법론)
 *   §1 전체 승률이 기준(P0)보다 올라야 한다 — 표본이 늘고 승률이 그대로면 무의미
 *   §2 전·후반 양쪽에서 같은 방향
 *   추가 표본 감사: **새로 편입된 신호가 실제로 이기는지** 따로 찍는다.
 *      가점은 그것이 이기는 표본을 데려올 때만 정당하다.
 *
 * 사용: node tools/gap-score-lab.js [backtest/raw.json]
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const IN = process.argv[2] || 'backtest/raw.json';
if (!fs.existsSync(IN)) { console.error(`[ERROR] ${IN} 없음 — 워크플로우 안에서만 실행된다.`); process.exit(1); }
const src = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
const raw = fs.readFileSync(IN, 'utf8');

function die(m){ console.error('[ERROR]', m); process.exit(1); }
function extractFunction(name){
  const start = src.indexOf(`function ${name}(`);
  if(start < 0) die(`function ${name}() 없음`);
  const brace = src.indexOf('{', start);
  let depth=0,q=null,esc=false,lc=false,bc=false;
  for(let i=brace;i<src.length;i++){
    const c=src[i], n=src[i+1];
    if(lc){ if(c==='\n') lc=false; continue; }
    if(bc){ if(c==='*'&&n==='/'){ bc=false; i++; } continue; }
    if(q){ if(esc){esc=false;continue;} if(c==='\\'){esc=true;continue;} if(c===q)q=null; continue; }
    if(c==='/'&&n==='/'){ lc=true; i++; continue; }
    if(c==='/'&&n==='*'){ bc=true; i++; continue; }
    if(c==='"'||c==="'"||c==='`'){ q=c; continue; }
    if(c==='{') depth++; else if(c==='}'){ depth--; if(depth===0) return src.slice(start,i+1); }
  } die(`${name}() 끝 없음`);
}
function extractLine(re){ const m=src.match(re); if(!m) die(`상수 없음 ${re}`); return m[0]; }
function extractConst(name){ const st=src.indexOf(`const ${name} =`); if(st<0) die(`const ${name} 없음`); return src.slice(st, src.indexOf(';',st)+1); }

/* 배포 소스의 점수 확정 두 줄. 여기 문자열이 index.html과 다르면 즉시 멈춘다. */
const SCORE_ANCHOR = `  const pullScore =Math.round((pPos+tNeg+cNeg)*10)/10;   // 📉 눌림목 — 최종 판정 축
  const revScore  =Math.round((rPos+rNeg+cNeg)*10)/10;   // 🔄 역추세 반등 — 최종 판정 축`;

function patchedEvaluate(bonus){
  let e = extractFunction('evaluate');
  if(!e.includes(SCORE_ANCHOR)) die('점수 확정 라인 앵커를 못 찾음 — index.html이 바뀌었다');
  if(!bonus) return e;
  /* 미메움 갭(메움률 20% 이하)에만 가점. 갭이 없거나 이미 메운 종목은 그대로. */
  return e.replace(SCORE_ANCHOR,
`  const _gapUnfilled = has(s.gap20_pct) && has(s.gap20_fill) && s.gap20_fill <= 20;
  const _gapB = _gapUnfilled ? ${bonus} : 0;
  const pullScore =Math.round((pPos+tNeg+cNeg+_gapB)*10)/10;
  const revScore  =Math.round((rPos+rNeg+cNeg+_gapB)*10)/10;`);
}

const OTHER = ['qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings'];
const ANCHOR = 'result._diag=diag;';
function validationSrc(){
  let f = extractFunction('strategyValidation');
  if(!f.includes(ANCHOR)) die('strategyValidation 앵커 없음');
  return f.replace(ANCHOR, ANCHOR + '\n  result._rows=out; result._sb=strongBuyOut;');
}

function progSrc(bonus){
  return `
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
${patchedEvaluate(bonus)}
${OTHER.map(extractFunction).join('\n')}
${validationSrc()}
this.run = d => { state.data = normalize(d); return strategyValidation(); };
this.rows = d => { state.data = normalize(d);
  /* 종목별 hist 행에 그날 등급을 붙여 돌려준다 — 갭 메움(하락) 예측 분석용 */
  return allStocks().map(s => {
    const hs = histStocks(s) || [];
    hs.forEach((r,i)=>{ if(i>0) withPrev(r,hs[i-1]);
      r._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null; r._g = evaluate(r).grade; });
    return { tk:s.ticker, cat:s.category, hs: hs.map(r=>({
      d:r.last_date, px:r.price, g:r._g, rsi:r.rsi, bb:r.bb_pos, vr:r.vol_ratio,
      lvl:r.market_level, gP:r.gap20_pct, gA:r.gap20_ago, gV:r.gap20_vol, gF:r.gap20_fill,
      ma20:r.ma20, m200s:r.ma200_slope, ma50:r.ma50, ma120:r.ma120, ma200:r.ma200, pfl:r.pct_from_low })) };
  });
};
`;
}
const PROG_SRC = progSrc(0);
function makeCtx(bonus, data){
  const ctx = { console, Math, Number, Object, Array, Set, Map, String, JSON };
  vm.createContext(ctx);
  vm.runInContext(progSrc(bonus), ctx);
  return ctx;
}
function run(bonus, data){ return makeCtx(bonus, data).run(data); }
/* 프로그램 문자열 전체에 [찾을것, 바꿀것] 패치를 걸고 돌린다 — 💡 게이트 변형용 */
function runProg(patches, data){
  const ctx = { console, Math, Number, Object, Array, Set, Map, String, JSON };
  vm.createContext(ctx);
  let prog = PROG_SRC;
  for(const [f, r] of (patches||[])){
    if(!prog.includes(f)) die('패치 앵커 못 찾음: ' + f.slice(0, 60));
    prog = prog.split(f).join(r);
  }
  vm.runInContext(prog, ctx);
  return ctx.run(data);
}

const base = JSON.parse(raw);
const F = base.hist_fields, I_D = F.indexOf('date');
const days = [...new Set(base.stocks.flatMap(s => (s.hist||[]).map(r => String(r[I_D]))))].sort();
const MID = days[Math.floor(days.length/2)];
function clip(pred){
  const d = JSON.parse(raw);
  for(const s of d.stocks) s.hist = (s.hist||[]).filter(r => pred(String(r[I_D])));
  return d;
}

const HS = [1,3,5,7];
const cell = (s,b) => {
  if(!s || s.rate === null) return `  —(${String(s?s.n:0).padStart(4)})      `;
  const e = (b && b.rate !== null) ? `${s.rate-b.rate>=0?'+':''}${s.rate-b.rate}`.padStart(4)+'%p' : '     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(4)})${e}`;
};
const ROWS = [['💡 강한다중', v=>v._strict], ['🔵 다중', v=>v.multi], ['🟢 강한매수', v=>v._strongBuy],
              ['📈 추세', v=>v.pull], ['🔄 반등', v=>v.rev]];

const P0 = run(0, base);
const P0h1 = run(0, clip(d=>d<MID)), P0h2 = run(0, clip(d=>d>=MID));

function table(title, v, ref){
  console.log(`\n■ ${title}`);
  for(const [lab,get] of ROWS){
    console.log(`  ${lab.padEnd(12)}` + HS.map(h=>cell(get(v)[h], ref?get(ref)[h]:null).padEnd(19)).join(''));
  }
  console.log(`  ${'기준선'.padEnd(12)}` + HS.map(h=>cell(v._baseline[h], null).padEnd(19)).join(''));
}
/* 가점으로 '새로 들어온 신호'만 따로 센다 — 이기는 표본을 데려와야 정당하다. */
function addedOnly(v, h){
  const key = x => x.ticker+'|'+x.date;
  const p0 = new Set((P0._sb[h]||[]).map(key));
  const add = (v._sb[h]||[]).filter(x => !p0.has(key(x)));
  const dec = add.filter(x => Math.abs(x.ret) > 1);
  const w = dec.filter(x => x.ret > 1).length;
  return { n: add.length, rate: dec.length ? Math.round(w/dec.length*100) : null,
           avg: add.length ? Math.round(add.reduce((p,c)=>p+c.ret,0)/add.length*100)/100 : null };
}

console.log(`■ 갭 가점 시뮬레이션 — 백테스트 ${days.length}거래일 (${days[0]}~${days[days.length-1]})`);
console.log('  대상: 미메움 갭(gap20_fill <= 20)에만 눌림·반등 점수 가점');
console.log('  칸: 승률(표본) · P0 대비 %p · 구간 ' + HS.map(h=>'+'+h+'일').join(' '));
table('P0 현행 (가점 0)', P0, null);

for(const b of [0.3, 0.5, 0.8]){
  const v = run(b, base);
  table(`가점 +${b}`, v, P0);
  const h1 = run(b, clip(d=>d<MID)), h2 = run(b, clip(d=>d>=MID));
  const half = (nm, vv, rr) => `  ${nm.padEnd(12)}` +
    HS.map(h=>cell(vv._strongBuy[h], rr._strongBuy[h]).padEnd(19)).join('');
  console.log(half('· 초록 전반', h1, P0h1));
  console.log(half('· 초록 후반', h2, P0h2));
  const add = HS.map(h=>{ const a = addedOnly(v,h);
    return `+${h}일 ${a.rate===null?'—':a.rate+'%'}(${a.n}건, 평균 ${a.avg>=0?'+':''}${a.avg}%)`; }).join(' · ');
  console.log(`  ↳ 새로 편입된 신호만: ${add}`);
}

/* ══════════ B. 미너비니 ①②③ — ma120/ma200이 화면에 닿게 된 뒤 첫 측정 ══════════
   그동안 "데이터 대기"였던 게 아니라 histRow 화이트리스트에 막혀 값이 안 보였다.
   추세(눌림) 강한매수 게이트에 조건을 하나씩 더해 승률 변화를 본다. */
const PULL_ANCHOR = 'const pullGrade = pullSetup && pullScore>=1.5 && sectorOK && nearHighM && pullChase && pullBandOK ? 5 :';
function runPull(extra, data){
  const ctx = { console, Math, Number, Object, Array, Set, Map, String, JSON };
  vm.createContext(ctx);
  let e = extractFunction('evaluate');
  if(!e.includes(PULL_ANCHOR)) die('추세 게이트 앵커를 못 찾음');
  if(extra) e = e.replace(PULL_ANCHOR, PULL_ANCHOR.replace('pullBandOK ?', `pullBandOK && (${extra}) ?`));
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
${e}
${OTHER.map(extractFunction).join('\n')}
${validationSrc()}
this.run = d => { state.data = normalize(d); return strategyValidation(); };
`, ctx);
  return ctx.run(data);
}
const MIN_TESTS = [
  ['① 장기 정배열 (ma50>ma120>ma200)', '(has(s.ma50)&&has(s.ma120)&&has(s.ma200)&&s.ma50>s.ma120&&s.ma120>s.ma200)'],
  ['② 200일선 상승 (slope>0)',        '(has(s.ma200_slope)&&s.ma200_slope>0)'],
  ['③ 52주저점 +25% 이상',            '(has(s.pct_from_low)&&s.pct_from_low>=25)'],
  ['①+②',                            '(has(s.ma50)&&has(s.ma120)&&has(s.ma200)&&s.ma50>s.ma120&&s.ma120>s.ma200&&has(s.ma200_slope)&&s.ma200_slope>0)'],
];
console.log('\n\n══════ B. 미너비니 조건 (추세 강한매수 게이트에 추가) ══════');
console.log(`  ${'추세 강매'.padEnd(30)}` + HS.map(h=>('+'+h+'일').padEnd(19)).join(''));
console.log(`  ${'P0 현행'.padEnd(30)}` + HS.map(h=>cell(P0.pull[h], null).padEnd(19)).join(''));
for(const [lab, ex] of MIN_TESTS){
  const v = runPull(ex, base);
  const h1 = runPull(ex, clip(d=>d<MID)), h2 = runPull(ex, clip(d=>d>=MID));
  console.log(`  ${lab.padEnd(30)}` + HS.map(h=>cell(v.pull[h], P0.pull[h]).padEnd(19)).join(''));
  console.log(`    ${'· 전반'.padEnd(28)}` + HS.map(h=>cell(h1.pull[h], P0h1.pull[h]).padEnd(19)).join(''));
  console.log(`    ${'· 후반'.padEnd(28)}` + HS.map(h=>cell(h2.pull[h], P0h2.pull[h]).padEnd(19)).join(''));
}

/* ══════════ C. 갭을 채우러 내려가는가 — 사전 예측 ══════════
   질문: "안 메운 갭이 아래 있는 종목이, 앞으로 그 갭을 메우러 내려갈지 미리 알 수 있나?"
   측정: 미메움(fill<=20) 상태인 날에서 +5거래일 안에 **같은 갭**의 메움률이 60%를
   넘어가면 '갭 메우러 내려갔다'로 센다. 같은 갭인지는 gap20_ago가 날짜만큼
   늘어났는지로 확인한다(새 갭이 생기면 비교 대상이 바뀌므로 제외).
   그 다음 '그날의 조건'별로 발생률을 갈라 사전 예측력이 있는지 본다. */
const RAW = makeCtx(0, base).rows(base);
const FWD = 5, FILLED = 60, MAXH = 10;
const cases = [];
for(const s of RAW){
  const hs = s.hs;
  for(let i=0;i<hs.length;i++){
    const r = hs[i];
    if(r.gF === null || r.gF === undefined || r.gF > 20) continue;   // 미메움 상태만
    if(r.gA === null || r.gA === undefined) continue;
    /* 같은 갭을 며칠까지 따라갈 수 있었는지(tracked)와 언제 메웠는지(filledAt)를 나눠 센다.
       새 갭이 생기면 비교 대상이 바뀌므로 거기서 추적을 끊는다. */
    let filledAt = null, tracked = 0;
    for(let k=1;k<=MAXH;k++){
      const n = hs[i+k]; if(!n) break;
      if(n.gA !== r.gA + k) break;
      tracked = k;
      if(n.gF !== null && n.gF !== undefined && n.gF >= FILLED){ filledAt = k; break; }
    }
    const last = hs[Math.min(i+FWD, hs.length-1)];
    const moved = (last && last.px && r.px) ? (last.px/r.px - 1)*100 : null;
    if(hs[i+FWD]) cases.push({ ...r, filled: filledAt !== null && filledAt <= FWD,
                               filledAt, tracked, moved });
  }
}
/* 메움률은 두 기준으로 낸다. 어느 쪽을 쓰느냐로 숫자가 크게 달라지기 때문이다.
   ⚠ 추적이 끊기는 유일한 이유는 '그 사이 새 갭상승이 또 떴다'는 것이고, 그건
   주가가 다시 위로 갔다는 뜻이다 — 즉 안 메운 사례다. 그래서 그것을 분모에서
   빼면 메움률이 크게 부풀려진다(전체 24% → 44%). 보수적 기준을 주(主)로 쓴다.
     cons : 새 갭 발생 = '안 메움' (보수적 · 기본)
     opt  : 새 갭 발생 = 판정 제외 (낙관적 · 참고) */
function fillAt(list, H){
  const done = list.filter(x => x.tracked >= H || x.filledAt !== null);
  const f = list.filter(x => x.filledAt !== null && x.filledAt <= H).length;
  const optOk = list.filter(x => (x.filledAt !== null && x.filledAt <= H) || x.tracked >= H);
  const optF = optOk.filter(x => x.filledAt !== null && x.filledAt <= H).length;
  return { n: list.length, rate: list.length ? Math.round(f/list.length*100) : null,
           optN: optOk.length, optRate: optOk.length ? Math.round(optF/optOk.length*100) : null };
}
function fillRate(label, pred){
  const sel = cases.filter(pred);
  if(!sel.length){ console.log(`  ${label.padEnd(30)} 표본 없음`); return; }
  const f = sel.filter(x=>x.filled).length;
  const avg = sel.reduce((p,c)=>p+(c.moved||0),0)/sel.length;
  console.log(`  ${label.padEnd(30)} 갭 메우러 내려감 ${String(Math.round(f/sel.length*100)).padStart(3)}% (${String(sel.length).padStart(4)}건) · +5일 평균 ${(avg>=0?'+':'')+avg.toFixed(2)}%`);
}
console.log('\n\n══════ C. 안 메운 갭이 아래 있을 때 — 5일 안에 메우러 내려가나 ══════');
console.log(`  대상: 미메움(fill<=20) 상태인 날 ${cases.length}건 · '메움'은 같은 갭의 메움률이 ${FILLED}%를 넘는 것`);
fillRate('전체', () => true);
fillRate('RSI 70 이상 (과열)', x => x.rsi !== null && x.rsi >= 70);
fillRate('RSI 50 미만', x => x.rsi !== null && x.rsi < 50);
fillRate('볼린저 90 이상', x => x.bb !== null && x.bb >= 90);
fillRate('볼린저 50 이하', x => x.bb !== null && x.bb <= 50);
fillRate('거래량 1.5배 이상', x => x.vr !== null && x.vr >= 1.5);
fillRate('거래량 0.8배 미만 (마름)', x => x.vr !== null && x.vr < 0.8);
fillRate('갭 큼 (5%+)', x => x.gP !== null && x.gP >= 5);
fillRate('갭 작음 (2~3%)', x => x.gP !== null && x.gP < 3);
fillRate('갭일 거래량 3배+ (돌파갭)', x => x.gV !== null && x.gV >= 3);
fillRate('갭일 거래량 1.5배 미만', x => x.gV !== null && x.gV < 1.5);
fillRate('갭 직후 1~2일', x => x.gA !== null && x.gA <= 2);
fillRate('갭 5일 이상 지남', x => x.gA !== null && x.gA >= 5);
fillRate('20일선 아래', x => x.ma20 && x.px && x.px < x.ma20);
fillRate('시장 약세·주의', x => x.lvl === 'weak' || x.lvl === 'caution');
fillRate('우리 신호 강한매수', x => x.g === 5);
fillRate('우리 신호 중립', x => x.g === 3);

/* ══════════ D. 갭 메움(하락) 60%+ 조합 전수 탐색 ══════════
   사용자 질문: "갭 메울 확률이 60% 넘는 경우의 수가 있나?"
   단일 조건 최고가 44%였으므로 2~3개 조합을 전부 돌린다.
   ⚠ 조합을 수십 개 훑으면 그중 몇 개는 **우연히** 60%를 넘는다(다중비교 함정).
      그래서 ① 표본 30건 이상 ② 전·후반 양쪽 모두 55% 이상을 같이 요구하고,
      몇 개를 훑었는지도 같이 찍는다. */
const CONDS = [
  ['20일선아래',      x => x.ma20 && x.px && x.px < x.ma20],
  ['RSI45미만',       x => x.rsi !== null && x.rsi < 45],
  ['보통갭(갭일량<1.5)', x => x.gV !== null && x.gV < 1.5],
  ['시장약세·주의',    x => x.lvl === 'weak' || x.lvl === 'caution'],
  ['당일거래량<0.8',   x => x.vr !== null && x.vr < 0.8],
  ['갭직후1~2일',     x => x.gA !== null && x.gA <= 2],
  ['갭작음<3%',       x => x.gP !== null && x.gP < 3],
  ['중립등급',        x => x.g === 3],
  ['볼린저30이하',     x => x.bb !== null && x.bb <= 30],
];
const CMID = (()=>{ const ds=[...new Set(cases.map(x=>x.d))].sort(); return ds[Math.floor(ds.length/2)]; })();
const combos = [];
for(let a=0;a<CONDS.length;a++){
  for(let b=a+1;b<CONDS.length;b++){
    combos.push([[a,b]]);
    for(let c=b+1;c<CONDS.length;c++) combos.push([[a,b,c]]);
  }
}
const results = [];
for(const [idx] of combos){
  const pred = x => idx.every(i => CONDS[i][1](x));
  const sel = cases.filter(pred);
  if(sel.length < 30) continue;
  const r5 = fillAt(sel, 5);
  const h1 = fillAt(sel.filter(x=>x.d < CMID), 5), h2 = fillAt(sel.filter(x=>x.d >= CMID), 5);
  results.push({ lab: idx.map(i=>CONDS[i][0]).join(' + '), r5,
                 r3: fillAt(sel,3), r10: fillAt(sel,10), h1, h2,
                 avg: sel.reduce((p,c)=>p+(c.moved||0),0)/sel.length });
}
results.sort((a,b)=> b.r5.rate - a.r5.rate);
console.log('\n\n══════ D. 갭 메움 60%+ 조합 탐색 (5일 기준) ══════');
console.log(`  조합 ${combos.length}개 중 표본 30건 이상인 ${results.length}개를 줄세웠다. 전체 평균 메움률 ${fillAt(cases,5).rate}%`);
console.log(`  ${'조합'.padEnd(46)} 5일메움(표본)  낙관   3일   10일   전반    후반    +5일평균`);
for(const r of results.slice(0, 14)){
  const flag = (r.r5.rate >= 60 && r.h1.rate >= 55 && r.h2.rate >= 55) ? ' ★통과' : '';
  console.log(`  ${r.lab.padEnd(46)} ${String(r.r5.rate).padStart(3)}%(${String(r.r5.n).padStart(3)})` +
              `  ${String(r.r5.optRate).padStart(3)}%  ${String(r.r3.rate).padStart(3)}%  ${String(r.r10.rate).padStart(3)}%` +
              `  ${String(r.h1.rate).padStart(3)}%(${String(r.h1.n).padStart(3)})  ${String(r.h2.rate).padStart(3)}%(${String(r.h2.n).padStart(3)})` +
              `  ${(r.avg>=0?'+':'')+r.avg.toFixed(2)}%${flag}`);
}
const pass = results.filter(r => r.r5.rate >= 60 && r.h1.rate >= 55 && r.h2.rate >= 55);
console.log(`\n  ★ 60%+ 이면서 전·후반 모두 55%+ : ${pass.length}개`);
if(!pass.length) console.log('  → 60%를 넘기면서 반쪽 검증까지 통과하는 조합은 없다. 갭 메움은 "확률을 높이는 정도"까지가 한계다.');
console.log('\n※ 다중비교 주의: 위는 ' + combos.length + '개를 훑은 결과다. 하나가 60%를 넘었다고 바로 규칙이 되지 않는다.');
console.log('  실전에 쓰려면 다음 사이클에서 같은 조합이 다시 통과하는지 확인해야 한다.');

/* ══════════ E. 신규 티커 A/B — 넣으면 전체 승률이 내려가나 ══════════
   사용자 지시: "모더나·화이자 추가해서 승률 시뮬레이션(떨어지면 폐기)".
   같은 창·같은 산식에서 **유니버스만 다르게** 두 번 돌린다. 날짜가 다른 두 실행을
   비교하면 종목 효과와 장세 효과가 섞여 판단이 불가능하다. */
/* 신규 티커 A/B — 유니버스만 바꿔 검증표가 어떻게 움직이는지 본다.
   MRNA·PFE는 이 A/B에서 전 신호 0~-2%p가 나와 폐기했다(2026-08-20).
   2026-08-24 교체: 테라울프·허트8(비트코인 채굴→AI 데이터센터), 웰타워(헬스케어 리츠). */
const NEW_TK = ['WULF','HUT','WELL'];
const present = NEW_TK.filter(t => base.stocks.some(s => s.ticker === t));
console.log('\n\n══════ E. 신규 티커 A/B (' + NEW_TK.join('·') + ') ══════');
if(!present.length){
  console.log('  아직 백테스트 원본에 없다 — main.py에 추가한 뒤 이 워크플로우를 다시 돌려야 한다.');
} else {
  const dropped = JSON.parse(raw); dropped.stocks = dropped.stocks.filter(s => !NEW_TK.includes(s.ticker));
  const vOut = run(0, dropped);
  console.log(`  포함 ${present.join('·')} · 유니버스 ${base.stocks.length}종목 → 제외 시 ${dropped.stocks.length}종목`);
  console.log(`  ${'신호'.padEnd(12)}` + HS.map(h=>('+'+h+'일').padEnd(19)).join(''));
  for(const [lab,get] of ROWS){
    console.log(`  ${(lab+' 제외').padEnd(12)}` + HS.map(h=>cell(get(vOut)[h], null).padEnd(19)).join(''));
    console.log(`  ${(lab+' 포함').padEnd(12)}` + HS.map(h=>cell(get(P0)[h], get(vOut)[h]).padEnd(19)).join(''));
  }
  /* 신규 티커 자신의 성적도 따로 — 전체가 안 내려가도 그 종목이 지면 담을 이유가 없다 */
  for(const tk of present){
    const line = HS.map(h=>{
      const a = (P0._sb[h]||[]).filter(x => x.ticker === tk);
      const dec = a.filter(x=>Math.abs(x.ret)>1), w = dec.filter(x=>x.ret>1).length;
      const avg = a.length ? (a.reduce((p,c)=>p+c.ret,0)/a.length).toFixed(2) : '—';
      return `+${h}일 ${dec.length?Math.round(w/dec.length*100)+'%':'—'}(${a.length}건, ${avg}%)`;
    }).join(' · ');
    console.log(`  ↳ ${tk} 강한매수만: ${line}`);
  }
}

/* ══════════ F. 회피 뱃지 시뮬레이션 ══════════
   사용자 지시: 갭 메움 조건이 승률로는 60%를 못 넘겼지만 +5일 평균수익이 -2~-4%였으니
   '회피 신호'로 쓸 수 있는지 본다. 질문은 하나다 —
   **우리 신호 중 이 조건에 걸린 것이 실제로 더 나쁜가?**
   나쁘지 않으면 뱃지는 사용자를 겁주기만 하는 장식이므로 붙이지 않는다. */
const META = new Map();
for(const s of RAW) for(const r of s.hs) META.set(s.tk + '|' + r.d, r);
const AVOID = [
  ['A1 미메움갭+20일선아래+거래량마름', r => r.gF !== null && r.gF <= 20 && r.ma20 && r.px < r.ma20 && r.vr !== null && r.vr < 0.8],
  ['A2 미메움갭+RSI45미만+거래량마름',  r => r.gF !== null && r.gF <= 20 && r.rsi !== null && r.rsi < 45 && r.vr !== null && r.vr < 0.8],
  ['A3 미메움갭+보통갭+거래량마름',     r => r.gF !== null && r.gF <= 20 && r.gV !== null && r.gV < 1.5 && r.vr !== null && r.vr < 0.8],
  ['A4 20일선아래+거래량마름 (갭무관)',  r => r.ma20 && r.px < r.ma20 && r.vr !== null && r.vr < 0.8],
  ['A5 미메움갭+20일선아래',           r => r.gF !== null && r.gF <= 20 && r.ma20 && r.px < r.ma20],
  ['A6 거래량마름 단독',               r => r.vr !== null && r.vr < 0.8],
];
console.log('\n\n══════ F. 회피 뱃지 — 우리 신호 중 이 조건에 걸린 것이 더 나쁜가 ══════');
console.log('  기준 = 🟢 강한매수 전체. 칸: 승률(표본) 대비%p · 아래줄은 평균수익 비교');
for(const [lab, pred] of AVOID){
  const line = [], avgs = [];
  let halfOK = true;
  for(const h of HS){
    const all = P0._sb[h] || [];
    const hit = all.filter(x => { const m = META.get(x.ticker+'|'+x.date); return m && pred(m); });
    const dec = hit.filter(x=>Math.abs(x.ret)>1), w = dec.filter(x=>x.ret>1).length;
    const rate = dec.length ? Math.round(w/dec.length*100) : null;
    const refDec = all.filter(x=>Math.abs(x.ret)>1), refW = refDec.filter(x=>x.ret>1).length;
    const ref = refDec.length ? Math.round(refW/refDec.length*100) : null;
    line.push(`${rate===null?'—':rate+'%'}(${String(hit.length).padStart(3)})${rate!==null&&ref!==null?(rate-ref>=0?'+':'')+(rate-ref)+'%p':''}`.padEnd(19));
    const avgHit = hit.length ? hit.reduce((p,c)=>p+c.ret,0)/hit.length : null;
    const avgAll = all.length ? all.reduce((p,c)=>p+c.ret,0)/all.length : null;
    avgs.push(`${avgHit===null?'—':(avgHit>=0?'+':'')+avgHit.toFixed(2)+'%'} vs ${avgAll===null?'—':(avgAll>=0?'+':'')+avgAll.toFixed(2)+'%'}`.padEnd(19));
    if(h===5 && (rate === null || ref === null || rate >= ref)) halfOK = false;
  }
  console.log(`  ${lab.padEnd(30)}` + line.join(''));
  console.log(`  ${''.padEnd(30)}` + avgs.join(''));
}
console.log('  → 뱃지는 "걸린 신호가 실제로 더 나쁠 때"만 정당하다. 표본 15건 미만이면 판단 보류.');

/* ══════════ G. 💡 강한다중이 일반다중보다 낮은 이유 + 전환 조건 변형 ══════════
   사용자 지적: "강한다중 승률이 일반다중보다 낮다."
   먼저 두 집단이 무엇이 다른지 지표로 보고(왜), 그 다음 전환 요건을 바꿔 본다(어떻게). */
const STRICT_ANCHOR = 'const strict=previousOverallGrade(s)===3 && strictMultiGate(s) && fallbackStrict && strictChase;';
function tierStat(v, h, tier){
  const a = (v._rows.multi[h] || []).filter(x => x.tier === tier);
  const dec = a.filter(x => Math.abs(x.ret) > 1), w = dec.filter(x => x.ret > 1).length;
  return { n: a.length, rate: dec.length ? Math.round(w/dec.length*100) : null,
           avg: a.length ? Math.round(a.reduce((p,c)=>p+c.ret,0)/a.length*100)/100 : null, list: a };
}
console.log('\n\n══════ G-1. 💡(전환 초기) vs 일반다중 — 무엇이 다른가 ══════');
console.log(`  ${'구분'.padEnd(14)}` + HS.map(h=>('+'+h+'일 승률/평균').padEnd(24)).join(''));
for(const [lab, t] of [['💡 강한다중', 1], ['일반 다중', 2]]){
  console.log(`  ${lab.padEnd(14)}` + HS.map(h=>{ const x = tierStat(P0, h, t);
    return `${x.rate===null?'—':x.rate+'%'}(${String(x.n).padStart(3)}) ${(x.avg>=0?'+':'')+x.avg}%`.padEnd(24); }).join(''));
}
/* 신호일 지표 평균 — 왜 다른지의 실마리 */
const avgOf = (list, key) => { const v = list.map(x => { const m = META.get(x.ticker+'|'+x.date); return m ? m[key] : null; })
  .filter(x => x !== null && x !== undefined); return v.length ? (v.reduce((p,c)=>p+c,0)/v.length).toFixed(1) : '—'; };
console.log('\n  신호일 지표 평균 (+3일 표본 기준)');
for(const [lab, t] of [['💡 강한다중', 1], ['일반 다중', 2]]){
  const L = tierStat(P0, 3, t).list;
  console.log(`  ${lab.padEnd(14)} RSI ${avgOf(L,'rsi')} · 볼린저 ${avgOf(L,'bb')} · 거래량비 ${avgOf(L,'vr')} · 갭메움률 ${avgOf(L,'gF')}`);
}
/* 수익 분포 — 승률이 낮아도 평균이 높으면 '변동성이 큰 초기 신호'라는 뜻이다 */
console.log('\n  +5일 수익 분포 (크게 이김 5%+ / 크게 짐 -5%↓)');
for(const [lab, t] of [['💡 강한다중', 1], ['일반 다중', 2]]){
  const L = tierStat(P0, 5, t).list;
  const big = L.filter(x=>x.ret>=5).length, bad = L.filter(x=>x.ret<=-5).length;
  console.log(`  ${lab.padEnd(14)} 크게이김 ${big}건(${L.length?Math.round(big/L.length*100):0}%) · 크게짐 ${bad}건(${L.length?Math.round(bad/L.length*100):0}%) · 표본 ${L.length}`);
}

console.log('\n══════ G-2. 전환 요건 변형 — 💡 승률을 올릴 수 있나 ══════');
const GVAR = [
  ['G0 현행 (전일 중립)', null],
  ['G1 전일 중립 or 매수관심', STRICT_ANCHOR.replace('previousOverallGrade(s)===3', 'previousOverallGrade(s)<=4')],
  ['G2 전환 요건 제거',      STRICT_ANCHOR.replace('previousOverallGrade(s)===3 && ', '')],
  ['G3 전일·전전일 모두 중립', STRICT_ANCHOR.replace('previousOverallGrade(s)===3',
     '(previousOverallGrade(s)===3 && (function(){const hs=histStocks(s)||[]; if(hs.length<3) return false; return evaluate(hs[hs.length-3]).grade===3;})())')],
  ['G4 전환 + 거래량 1.2배+', STRICT_ANCHOR.replace('strictChase;', 'strictChase && has(s.vol_ratio) && s.vol_ratio>=1.2;')],
  ['G5 전환 + 20일선 위',    STRICT_ANCHOR.replace('strictChase;', 'strictChase && has(s.ma20) && has(s.price) && s.price>=s.ma20;')],
];
console.log(`  ${'변형'.padEnd(24)}` + HS.map(h=>('+'+h+'일 승률/평균').padEnd(24)).join(''));
for(const [lab, patched] of GVAR){
  const v = patched ? runProg([[STRICT_ANCHOR, patched]], base) : P0;
  console.log(`  ${lab.padEnd(24)}` + HS.map(h=>{ const x = tierStat(v, h, 1);
    return `${x.rate===null?'—':x.rate+'%'}(${String(x.n).padStart(3)}) ${(x.avg>=0?'+':'')+x.avg}%`.padEnd(24); }).join(''));
  if(patched){
    const h1 = runProg([[STRICT_ANCHOR, patched]], clip(d=>d<MID)), h2 = runProg([[STRICT_ANCHOR, patched]], clip(d=>d>=MID));
    const f = vv => HS.map(h=>{ const x = tierStat(vv, h, 1); return `${x.rate===null?'—':x.rate+'%'}(${String(x.n).padStart(3)})`.padEnd(24); }).join('');
    console.log(`    ${'· 전반'.padEnd(22)}` + f(h1));
    console.log(`    ${'· 후반'.padEnd(22)}` + f(h2));
  }
}
console.log('  → 승률만 오르고 평균수익이 내려가면 채택하지 않는다(§6). 전·후반 둘 다 올라야 한다.');

console.log('\n※ 채택 조건: ① 전체 승률이 P0보다 오르고 ② 전·후반 모두 같은 방향이며');
console.log('  ③ 새로 편입된 신호 자체가 기준선보다 잘 이길 것. 셋 중 하나라도 아니면 가점은 기각한다.');
