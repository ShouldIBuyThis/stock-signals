#!/usr/bin/env node
/**
 * PRIVATE 컷 민감도 스윕 — "관문을 너무 빡빡하게 잡은 건 아닌가" (읽기 전용)
 *
 * 반등 강한매수의 두 컷(RSI 상한 · 3일누적 추격 상한)을 격자로 훑으면서,
 * 방법론 문서가 요구하는 네 가지를 한 화면에 같이 찍는다.
 *
 *   ① 승률과 표본 (§5-1)          — 표본이 줄어서 오른 승률인지 구분
 *   ② 늘어나는 표본만의 성적       — 컷을 풀면 들어오는 신호가 실제로 이겼나 (§'하지 않는 것')
 *   ③ 전·후반 각각 (§2)           — 한쪽 국면 잔상인지
 *   ④ 종목 수 (§5)                — 두세 종목 성적이 전부인지
 *
 * 컷을 푸는 쪽이 ②에서 기준선을 못 넘으면, 그 컷은 빡빡한 게 아니라 제 일을
 * 한 것이다. ②가 기준선을 크게 넘으면 그때만 완화를 후보로 올린다.
 *
 * 사용: node tools/cut-sweep.js          # 반등 컷 격자
 *       node tools/cut-sweep.js --full   # 전·후반까지 (느림)
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const FULL = process.argv.includes('--full');

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

/* v9 지표압도 해제 후의 배포 소스. 컴포넌트 3줄로 쪼개져 있다. */
const REV_RSI_LINE   = `const revRsiOK    = rsi<=50 || (rsi<=60 && revBandHigh);`;
const REV_CHASE_LINE = `const revChase    = run3Eff===null || run3Eff<=3 || (run3Eff<=6 && revTrendOK);`;
const REV_LINE = `const revStrong = revScore>=2.0 && has(rsi) && revRsiOK && sectorOK && revChase;`;

function patchedEvaluate(rsiCut, chaseCut){
  let e = extractFunction('evaluate');
  if(!e.includes(REV_LINE)) die('반등 강매 게이트 라인을 못 찾음 — index.html이 바뀌었다');
  return e.replace(REV_LINE,
    `const revStrong = revScore>=2.0 && has(rsi) && rsi<=${rsiCut} && sectorOK &&
    (run3Eff===null || run3Eff<=${chaseCut});`);
}

const OTHER = ['qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings'];
const ANCHOR = 'result._diag=diag;';
function validationSrc(){
  let f = extractFunction('strategyValidation');
  if(!f.includes(ANCHOR)) die('strategyValidation 앵커 없음');
  return f.replace(ANCHOR, ANCHOR +
    '\n  result._rows={multi:out.multi, pull:out.pull, rev:out.rev, strong:strongBuyOut};');
}

function run(rsiCut, chaseCut, data){
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
${patchedEvaluate(rsiCut, chaseCut)}
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

/* 행 하나를 식별하는 키 — 컷을 바꿨을 때 '새로 들어온 표본'을 잡는 데 쓴다 */
const key = r => `${r.ticker}|${r.date||r.last_date}`;
/* 승률: 컷 ±1% 보합 제외. strategyValidation의 stat()과 같은 규칙 */
function rate(rows){
  const w = rows.filter(r => r.ret > 1).length, l = rows.filter(r => r.ret < -1).length;
  return (w+l) ? Math.round(w/(w+l)*100) : null;
}
const avg = rows => rows.length ? Math.round(rows.reduce((a,r)=>a+r.ret,0)/rows.length*100)/100 : null;

const CUR = { rsi: 50, chase: 3 };
const P0 = run(CUR.rsi, CUR.chase, base);
const revRows = v => h => (v._rows.rev[h]||[]).filter(x => x.tier===5);

console.log(`표본 창 ${days[0]} ~ ${days[days.length-1]} (${days.length}거래일) · 전후반 분기 ${MID}`);
console.log(`현행 배포값: 반등 강매 = 반등점수>=2.0 · RSI<=${CUR.rsi} · 섹터OK · 3일누적(1배)<=${CUR.chase}`);
console.log(`기준선: +1일 ${P0._baseline[1].rate}%  +3일 ${P0._baseline[3].rate}%  +5일 ${P0._baseline[5].rate}%\n`);

const RSIS   = [50, 52, 55, 58, 60];
const CHASES = [3, 5, 8, 10, 999];

console.log('■ 반등 강한매수 — 컷 격자 (승률%(표본), +3일 기준)');
console.log('  ' + '─'.repeat(64));
console.log('  RSI\\추격 ' + CHASES.map(c => (c===999?'없음':`<=${c}`).padStart(12)).join(''));
const grid = {};
for(const r of RSIS){
  const cells = [];
  for(const c of CHASES){
    const v = run(r, c, base);
    grid[`${r}|${c}`] = v;
    const s = v.rev[3];
    cells.push(`${s.rate===null?'—':s.rate+'%'}(${s.n})`.padStart(12));
  }
  console.log(`  <=${String(r).padEnd(6)}` + cells.join(''));
}

console.log('\n■ 컷을 풀면 새로 들어오는 표본만의 성적 (현행 RSI<=50·추격<=3 대비)');
console.log('  ← 이게 기준선을 못 넘으면 그 컷은 빡빡한 게 아니라 제 일을 한 것이다');
console.log('  ' + '─'.repeat(76));
console.log('  ' + '변형'.padEnd(24) + '+1일 신규        +3일 신규        +5일 신규        종목');
for(const [lab, r, c] of [
  ['RSI 55로 완화',        55, 3],
  ['RSI 58로 완화',        58, 3],
  ['RSI 60로 완화',        60, 3],
  ['추격 5로 완화',        50, 5],
  ['추격 8로 완화',        50, 8],
  ['추격 10으로 되돌림',   50, 10],
  ['추격 컷 제거',         50, 999],
  ['RSI 55 + 추격 8',      55, 8],
  ['RSI 58 + 추격 10',     58, 10],
  ['둘 다 제거',           60, 999],
]){
  const v = grid[`${r}|${c}`] || run(r, c, base);
  const cells = [1,3,5].map(h => {
    const cur = new Set(revRows(P0)(h).map(key));
    const neu = revRows(v)(h).filter(x => !cur.has(key(x)));
    if(!neu.length) return '없음'.padEnd(17);
    const b = P0._baseline[h].rate, w = rate(neu);
    const d = (w!==null && b!==null) ? `${w-b>=0?'+':''}${w-b}%p` : '';
    return `${w===null?'—':w+'%'}(${neu.length}) ${d}`.padEnd(17);
  });
  const neu3 = revRows(v)(3).filter(x => !new Set(revRows(P0)(3).map(key)).has(key(x)));
  const tk = new Set(neu3.map(x=>x.ticker));
  console.log('  ' + lab.padEnd(24) + cells.join('') + String(tk.size).padStart(3) + '종');
}

console.log('\n■ 반대 방향 — 현행 컷이 지운 표본은 실제로 졌나 (평균수익 포함)');
console.log('  ' + '─'.repeat(76));
for(const [lab, r, c] of [['추격 10 → 3이 지운 표본', 50, 10], ['RSI 60 → 50이 지운 표본', 60, 3]]){
  const v = grid[`${r}|${c}`] || run(r, c, base);
  for(const h of [1,3,5]){
    const cur = new Set(revRows(P0)(h).map(key));
    const gone = revRows(v)(h).filter(x => !cur.has(key(x)));
    if(!gone.length) continue;
    const b = P0._baseline[h];
    console.log(`  ${lab} +${h}일: ${rate(gone)}%(${gone.length}) 평균 ${avg(gone)>=0?'+':''}${avg(gone)}%` +
      `   ← 같은 구간 기준선 ${b.rate}% / 평균 ${b.avg>=0?'+':''}${b.avg}%`);
  }
}

console.log('\n■ 전체 검증표에 미치는 영향 (💡 · 최종 초록뱃지)');
console.log('  ' + '─'.repeat(70));
console.log('  ' + '변형'.padEnd(22) + '💡 +3일       초록 +3일      초록 +5일');
for(const [lab, r, c] of [['P0 현행 (50 / 3)',50,3],['RSI 55',55,3],['RSI 58',58,3],['추격 8',50,8],['추격 10',50,10],['RSI 55 + 추격 8',55,8]]){
  const v = grid[`${r}|${c}`] || run(r, c, base);
  const f = (s,h) => `${s.rate===null?'—':s.rate+'%'}(${s.n})`.padEnd(14);
  console.log('  ' + lab.padEnd(22) + f(v._strict[3]) + f(v._strongBuy[3]) + f(v._strongBuy[5]));
}

if(FULL){
  console.log('\n■ 전·후반 분리 (§2) — 완화 후보만');
  console.log('  ' + '─'.repeat(70));
  for(const [lab, r, c] of [['P0 현행 (50 / 3)',50,3],['RSI 55',55,3],['추격 8',50,8],['RSI 55 + 추격 8',55,8]]){
    const H1 = run(r, c, clip(d=>d<MID)), H2 = run(r, c, clip(d=>d>=MID));
    const f = v => [1,3,5].map(h => {
      const s=v.rev[h], b=v._baseline[h];
      return `${s.rate===null?'—':s.rate+'%'}(${s.n})${b.rate!==null&&s.rate!==null?` ${s.rate-b.rate>=0?'+':''}${s.rate-b.rate}%p`:''}`.padEnd(18);
    }).join('');
    console.log(`  ${lab.padEnd(18)} 전반 ${f(H1)}`);
    console.log(`  ${''.padEnd(18)} 후반 ${f(H2)}`);
  }
}
