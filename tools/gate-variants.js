#!/usr/bin/env node
/**
 * PRIVATE 방어섹터 게이트 후보 비교 (읽기 전용)
 *
 * `DEFENSIVE_CATS`를 바꿔가며 전체 검증표를 다시 계산한다.
 * 배포 파일은 수정하지 않는다 — index.html에서 함수를 문자열로 뽑아
 * `vm` 안에서 목록만 갈아끼운다 (docs/승률-검증-방법론.md §0).
 *
 * 출력 규칙
 *   §1 모든 행에 같은 구간 기준선 대비 초과(%p)를 같이 찍는다
 *   §2 전·후반으로 갈라 양쪽 다 찍는다 (한쪽만 좋으면 국면 잔상)
 *   §5 표본 n과 함께 몇 종목에서 나왔는지 찍는다
 *
 * 사용: 저장소 루트에서 `node tools/gate-variants.js`
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = process.cwd();
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'signals.json'), 'utf8'));

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

const CUR_DEF = JSON.parse(extractConst('DEFENSIVE_CATS').match(/\[[^\]]*\]/)[0]);

/* strategyValidation()이 일반다중(tier 2)도 따로 내놓게 한 줄 덧붙인다.
   집계 함수 stat()은 그대로 쓰므로 다른 행과 기준이 어긋나지 않는다. */
const ANCHOR = 'result._diag=diag;';
function validationSrc(){
  let f = extractFunction('strategyValidation');
  if(!f.includes(ANCHOR)) die('strategyValidation 앵커를 못 찾음');
  return f.replace(ANCHOR, ANCHOR +
    '\n  result._general={}; horizons.forEach(h=>{ result._general[h]=stat(out.multi[h].filter(x=>x.tier===2)); });' +
    '\n  result._rows={multi:out.multi, pull:out.pull, rev:out.rev};');
}

const OTHER = ['evaluate','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings'];

/** cats=null 이면 게이트 자체를 끈다(bb58bc2 이전 상태). */
function run(cats, data){
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
const DEFENSIVE_CATS = ${JSON.stringify(cats || [])};
const GATE_OFF = ${cats === null};
${extractConst('LEVERAGED')}
const levX = tk => (LEVERAGED[tk] ? LEVERAGED[tk].x : 1);
${extractConst('RANK_NONE')}
${extractConst('HIST_FIELDS_DEFAULT')}
var state = { data:null, overrides:{}, holdings:[], cart:[], hidden:[], market:'all', showHoldings:false, themeFilter:null };
${OTHER.map(extractFunction).join('\n')}
${validationSrc()}
this.run = d => { state.data = normalize(d); return strategyValidation(); };
`.replace('const sectorOK = !marketGuarded || DEFENSIVE_CATS.includes(s.category);',
          'const sectorOK = GATE_OFF || !marketGuarded || DEFENSIVE_CATS.includes(s.category);'), ctx);
  return ctx.run(data);
}

/* ── 표본 창 ── */
const F = base.hist_fields, I_D = F.indexOf('date'), I_P = F.indexOf('price');
const days = [...new Set(base.stocks.flatMap(s => (s.hist||[]).map(r => String(r[I_D]))))].sort();
const MID = days[Math.floor(days.length/2)];

function clip(pred){
  const d = JSON.parse(JSON.stringify(base));
  for(const s of d.stocks) s.hist = (s.hist||[]).filter(r => pred(String(r[I_D])));
  return d;
}

/* ── 표시 ── */
const ROWS = [
  ['다중 (전체)',      v => v.multi],
  ['├ 💡 강한다중',    v => v._strict],
  ['└ 일반다중',       v => v._general],
  ['추세 강한매수',     v => v.pull],
  ['└ 추세 매수관심',   v => v._interest.pull],
  ['반등 강한매수',     v => v.rev],
  ['└ 반등 매수관심',   v => v._interest.rev],
  ['최종 강한매수(초록)', v => v._strongBuy],
];
function cell(s, b){
  if(!s || s.rate === null) return `    —(${String(s?s.n:0).padStart(3)})      `;
  const e = (b && b.rate !== null) ? `${s.rate-b.rate>=0?'+':''}${s.rate-b.rate}`.padStart(4)+'%p' : '     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(3)})${e} `;
}
function print2(title, v){
  console.log(`\n${title}`);
  console.log('  ' + '─'.repeat(72));
  console.log(`  ${'구분'.padEnd(19)}${'+1일'.padEnd(17)}${'+3일'.padEnd(17)}+5일`);
  for(const [lab, get] of ROWS){
    const s = get(v);
    console.log(`  ${lab.padEnd(19)}${cell(s[1],v._baseline[1]).padEnd(17)}${cell(s[3],v._baseline[3]).padEnd(17)}${cell(s[5],v._baseline[5])}`);
  }
  const b = v._baseline;
  console.log(`  ${'기준선(전 종목)'.padEnd(19)}${cell(b[1],null).padEnd(17)}${cell(b[3],null).padEnd(17)}${cell(b[5],null)}`);
}

const VARIANTS = [
  ['D0 현행',            CUR_DEF],
  ['D1 게이트 제거',      null],
  ['D2 실측 유지분만',    ['금융','원자재·금','원자재·유가','주택']],
  ['D3 D2 + 소프트웨어',  ['금융','원자재·금','원자재·유가','주택','소프트웨어']],
  ['D4 실측 상회 전부',   ['금융','원자재·금','원자재·유가','주택','암호화폐','전기차·자율주행','소프트웨어','데이터센터','양자컴퓨팅','반도체·GPU','에너지·원전']],
  ['D5 3종목 이상만',     ['소프트웨어','암호화폐','데이터센터','양자컴퓨팅','반도체·GPU','에너지·원전','방산·드론']],
  /* §3 고원/절벽 확인 — D2 경계를 한 칸씩 좁히고 넓혀 본다 */
  ['D6 D2−주택',         ['금융','원자재·금','원자재·유가']],
  ['D7 D2−주택−유가',     ['금융','원자재·금']],
  ['D8 D2+암호화폐',      ['금융','원자재·금','원자재·유가','주택','암호화폐']],
  ['D9 D2+방산 복원',     ['금융','원자재·금','원자재·유가','주택','방산·드론']],
];

console.log('현행 DEFENSIVE_CATS:', CUR_DEF.join(' · '));
console.log(`표본 창 ${days[0]} ~ ${days[days.length-1]} (${days.length}거래일) · 전후반 분기 ${MID}`);

const full = {};
for(const [name, cats] of VARIANTS){
  const v = run(cats, base);
  full[name] = v;
  print2(`■ ${name}${cats ? '  [' + cats.join('·') + ']' : '  [약세장에도 전 섹터 강한매수 허용]'}`, v);
}

/* ── §2 split-half ── */
console.log('\n\n■ 전·후반 분리 (docs/승률-검증-방법론.md §2) — 한쪽만 좋으면 국면 잔상');
console.log('─'.repeat(74));
for(const [name, cats] of VARIANTS){
  const H1 = run(cats, clip(d => d < MID));
  const H2 = run(cats, clip(d => d >= MID));
  console.log(`\n${name}`);
  for(const [lab, get] of [['다중', v=>v.multi], ['💡', v=>v._strict], ['추세', v=>v.pull], ['반등', v=>v.rev]]){
    const f = v => [1,3,5].map(h => cell(get(v)[h], v._baseline[h]).padEnd(17)).join('');
    console.log(`  ${lab.padEnd(6)}전반 ${f(H1)}`);
    console.log(`  ${''.padEnd(6)}후반 ${f(H2)}`);
  }
}

/* ── §5 표본 독립성 ── */
console.log('\n\n■ 표본 독립성 (§5) — 현행 D0 기준, 신호별 몇 종목/며칠에서 나왔나');
console.log('─'.repeat(74));
{
  const v = full['D0 현행'];
  for(const [lab, key] of [['다중','multi'],['추세','pull'],['반등','rev']]){
    for(const h of [1,3,5]){
      const rows = (v._rows[key][h]||[]).filter(x => key==='multi' ? true : x.tier===5);
      const t = new Set(rows.map(x=>x.ticker)), d = new Set(rows.map(x=>x.date));
      const top = [...t].map(tk => [tk, rows.filter(x=>x.ticker===tk).length]).sort((a,b)=>b[1]-a[1])[0];
      console.log(`  ${lab} +${h}일  n=${String(rows.length).padStart(3)}  종목 ${String(t.size).padStart(2)}  날짜 ${String(d.size).padStart(2)}` +
        (top ? `  최다종목 ${top[0]} ${top[1]}건(${Math.round(top[1]/rows.length*100)}%)` : ''));
    }
  }
}
