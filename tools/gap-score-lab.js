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

function makeCtx(bonus, data){
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
`, ctx);
  return ctx;
}
function run(bonus, data){ return makeCtx(bonus, data).run(data); }

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
console.log(`  ${'조합'.padEnd(46)} 5일메움(표본)  3일   10일   전반   후반   +5일평균`);
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

console.log('\n※ 채택 조건: ① 전체 승률이 P0보다 오르고 ② 전·후반 모두 같은 방향이며');
console.log('  ③ 새로 편입된 신호 자체가 기준선보다 잘 이길 것. 셋 중 하나라도 아니면 가점은 기각한다.');
