#!/usr/bin/env node
/**
 * PRIVATE 산식 실험실 — 추세(미너비니) · 반등(추격 컷) 게이트 변형 비교 (읽기 전용)
 *
 * 배포 파일은 수정하지 않는다. index.html의 evaluate()를 문자열로 뽑아
 * 게이트 한 줄만 갈아끼운다 (docs/승률-검증-방법론.md §0).
 *
 * ── 추세 축: 마크 미너비니 2단계 조건을 저장된 지표로 번역 ──────────────
 *   원 조건                          여기서 쓸 수 있는 번역
 *   ① 50·150·200일선 정배열          price>ma50 && ma20>ma50 && ma50>ma60
 *                                    (150·200일선은 저장 안 함 — ma60이 최장)
 *   ② 200일선 상승세                 데이터 없음 — ①의 배열로 부분 대체
 *   ③ 52주 저점 대비 +25%            데이터 없음 (52주 저점 미저장) — 생략
 *   ④ 52주 고점 25% 이내             pct_from_high >= -25   (미너비니 원값)
 *   ⑤ 지수 대비 상대강도              rs20 >= 0              (자연 영점)
 *   ⑥ 베이스 돌파·VCP                range3<=range10 && vol3_ratio<=1
 *                                    (변동폭 수축 + 거래량 마름 — 새 상수 없음)
 *
 * ── 반등 축: 추격 컷 ────────────────────────────────────────────────
 *   전반 +1일 실패 9건 중 4건이 3일누적 +14~24% 급등 직후였다(GDXU·MSTR·BMNR).
 *   반등 매수관심에는 run3<=10 컷이 있는데 강한매수에는 없다 — 그 컷을 옮겨 단다.
 *   후보 컷 10/8은 각각 매수관심·강한다중이 이미 쓰는 값이라 새 매직넘버가 아니다.
 *
 * 사용: 저장소 루트에서 `node tools/formula-lab.js`
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

/* ── 게이트 패치 지점 (index.html의 실제 소스 문자열과 일치해야 한다) ── */
const PULL_LINE = `const pullGrade = pullSetup && pullScore>=1.5 && sectorOK && nearHighM ? 5 :
    (pullSetup && pullScore>=0.8 ? 4 : 3);`;
const REV_LINE = `const revStrong = revScore>=2.0 && has(rsi) && rsi<=50 && sectorOK &&
    (!has(s.run3_sum) || s.run3_sum<=8);`;

/* 미너비니 조건 표현식 — evaluate() 안 지역변수(p, ma20, ma60)와 s 필드 사용 */
const M = {
  stage2: '(has(p)&&has(s.ma50)&&has(ma20)&&has(ma60)&&p>s.ma50&&ma20>s.ma50&&s.ma50>ma60)',
  nearHi: '(has(s.pct_from_high)&&s.pct_from_high>=-25)',
  rsOK:   '(has(s.rs20)&&s.rs20>=0)',
  vcp:    '(has(s.range3)&&has(s.range10)&&s.range10>0&&s.range3<=s.range10&&has(s.vol3_ratio)&&s.vol3_ratio<=1)',
};

function patchedEvaluate(pullExtra, revExtra){
  let e = extractFunction('evaluate');
  if(!e.includes(PULL_LINE)) die('추세 게이트 라인을 못 찾음');
  if(!e.includes(REV_LINE))  die('반등 게이트 라인을 못 찾음');
  if(pullExtra){
    e = e.replace(PULL_LINE,
      `const pullGrade = pullSetup && pullScore>=1.5 && sectorOK && nearHighM && (${pullExtra}) ? 5 :
    (pullSetup && pullScore>=0.8 ? 4 : 3);`);
  }
  if(revExtra){
    e = e.replace(REV_LINE,
      `const revStrong = revScore>=2.0 && has(rsi) && rsi<=50 && sectorOK &&
    (!has(s.run3_sum) || s.run3_sum<=8) && (${revExtra});`);
  }
  return e;
}

const OTHER = ['competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings'];
const ANCHOR = 'result._diag=diag;';
function validationSrc(){
  let f = extractFunction('strategyValidation');
  if(!f.includes(ANCHOR)) die('strategyValidation 앵커 없음');
  return f.replace(ANCHOR, ANCHOR +
    '\n  result._general={}; horizons.forEach(h=>{ result._general[h]=stat(out.multi[h].filter(x=>x.tier===2)); });' +
    '\n  result._rows={multi:out.multi, pull:out.pull, rev:out.rev};');
}

function run(pullExtra, revExtra, data){
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
${patchedEvaluate(pullExtra, revExtra)}
${OTHER.map(extractFunction).join('\n')}
${validationSrc()}
this.run = d => { state.data = normalize(d); return strategyValidation(); };
`, ctx);
  return ctx.run(data);
}

/* ── 표본 창 ── */
const F = base.hist_fields, I_D = F.indexOf('date');
const days = [...new Set(base.stocks.flatMap(s => (s.hist||[]).map(r => String(r[I_D]))))].sort();
const MID = days[Math.floor(days.length/2)];
function clip(pred){
  const d = JSON.parse(JSON.stringify(base));
  for(const s of d.stocks) s.hist = (s.hist||[]).filter(r => pred(String(r[I_D])));
  return d;
}

function cell(s, b){
  if(!s || s.rate === null) return `  —(${String(s?s.n:0).padStart(3)})       `;
  const e = (b && b.rate !== null) ? `${s.rate-b.rate>=0?'+':''}${s.rate-b.rate}`.padStart(4)+'%p' : '     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(3)})${e} `;
}
const ROWS = [
  ['다중 (전체)', v=>v.multi], ['├ 💡', v=>v._strict], ['└ 일반', v=>v._general],
  ['추세 강매', v=>v.pull], ['반등 강매', v=>v.rev], ['최종 강매', v=>v._strongBuy],
];
function table(title, v){
  console.log(`\n■ ${title}`);
  console.log('  ' + '─'.repeat(70));
  for(const [lab, get] of ROWS){
    const s = get(v);
    console.log(`  ${lab.padEnd(12)}${cell(s[1],v._baseline[1]).padEnd(17)}${cell(s[3],v._baseline[3]).padEnd(17)}${cell(s[5],v._baseline[5])}`);
  }
  const b=v._baseline;
  console.log(`  ${'기준선'.padEnd(12)}${cell(b[1],null).padEnd(17)}${cell(b[3],null).padEnd(17)}${cell(b[5],null)}`);
}
function half(title, pullX, revX){
  const H1 = run(pullX, revX, clip(d=>d<MID)), H2 = run(pullX, revX, clip(d=>d>=MID));
  console.log(`  ${title} 전·후반 (추세/반등):`);
  for(const [lab,get] of [['추세',v=>v.pull],['반등',v=>v.rev],['💡',v=>v._strict]]){
    const f=v=>[1,3,5].map(h=>cell(get(v)[h],v._baseline[h]).padEnd(17)).join('');
    console.log(`    ${lab.padEnd(4)}전반 ${f(H1)}`);
    console.log(`    ${''.padEnd(4)}후반 ${f(H2)}`);
  }
}

/* ══════════ 실험 목록 ══════════ */
console.log(`표본 창 ${days[0]} ~ ${days[days.length-1]} (${days.length}거래일) · 전후반 분기 ${MID}`);
console.log('컷 +1%/-1% 보합 제외 승률 · 괄호 표본 · %p는 같은 구간 기준선 대비');

const EXP = [
  // ── 대조군 ──
  ['P0  현행 (대조군)',                     null, null],
  // ── 추세: 미너비니 단일 조건 ──
  ['P1  +정배열(①)',                        M.stage2, null],
  ['P2  +52주고점 25%이내(④)',              M.nearHi, null],
  ['P3  +상대강도 rs20>=0(⑤)',              M.rsOK, null],
  ['P4  +VCP 수축(⑥)',                      M.vcp, null],
  // ── 추세: 조합 ──
  ['P5  ①+④',                              `${M.stage2}&&${M.nearHi}`, null],
  ['P6  ①+④+⑤',                            `${M.stage2}&&${M.nearHi}&&${M.rsOK}`, null],
  ['P7  ④+⑤',                              `${M.nearHi}&&${M.rsOK}`, null],
  ['P8  ①+⑥',                              `${M.stage2}&&${M.vcp}`, null],
  // ── 반등: 추격 컷 ──
  ['R1  반등 +run3<=10',                    null, '!has(s.run3_sum)||s.run3_sum<=10'],
  ['R2  반등 +run3<=8',                     null, '!has(s.run3_sum)||s.run3_sum<=8'],
  // ── 최종 조합 ──
  ['C1  추세④ + 반등run3<=10',              M.nearHi, '!has(s.run3_sum)||s.run3_sum<=10'],
  ['C2  추세④ + 반등run3<=8',               M.nearHi, '!has(s.run3_sum)||s.run3_sum<=8'],
  // §3 고원 확인: ④의 이웃 값
  ['C3  추세 pct>=-20 + 반등run3<=8',        '(has(s.pct_from_high)&&s.pct_from_high>=-20)', '!has(s.run3_sum)||s.run3_sum<=8'],
  ['C4  추세 pct>=-30 + 반등run3<=8',        '(has(s.pct_from_high)&&s.pct_from_high>=-30)', '!has(s.run3_sum)||s.run3_sum<=8'],
];

const results = {};
for(const [name, px, rx] of EXP){
  const v = run(px, rx, base);
  results[name] = [v, px, rx];
  table(name, v);
}

/* 최종 후보 C2의 전·후반과 표본 독립성(§5) */
{
  const [v, px, rx] = results['C2  추세④ + 반등run3<=8'];
  console.log('\n\n■ C2 최종 점검');
  half('C2', px, rx);
  console.log('  표본 독립성:');
  for(const [lab,key,tier] of [['추세','pull',5],['반등','rev',5],['다중','multi',null]]){
    for(const h of [1,3,5]){
      const rows=(v._rows[key][h]||[]).filter(x=>tier===null?true:x.tier===tier);
      const t=new Set(rows.map(x=>x.ticker)), d=new Set(rows.map(x=>x.date));
      const top=[...t].map(tk=>[tk,rows.filter(x=>x.ticker===tk).length]).sort((a,b)=>b[1]-a[1])[0];
      console.log(`    ${lab} +${h}일 n=${String(rows.length).padStart(3)} 종목 ${String(t.size).padStart(2)} 날짜 ${String(d.size).padStart(2)}`+(top?` 최다 ${top[0]} ${top[1]}건(${Math.round(top[1]/rows.length*100)}%)`:''));
    }
  }
}

/* 전·후반은 유망한 것만 (전체에서 대조군을 이긴 변형) */
console.log('\n\n■ 전·후반 분리 — 유망 변형만 (§2: 한쪽만 좋으면 국면 잔상)');
console.log('─'.repeat(74));
const P0 = results['P0  현행 (대조군)'][0];
for(const [name, [v, px, rx]] of Object.entries(results)){
  if(name.startsWith('P0')) continue;
  const key = name.startsWith('R') ? 'rev' : 'pull';
  const better = [1,3,5].filter(h => v[key][h].rate !== null && P0[key][h].rate !== null &&
    v[key][h].rate >= P0[key][h].rate).length;
  if(better < 2) continue;
  console.log(`\n${name}`);
  half(name, px, rx);
}
