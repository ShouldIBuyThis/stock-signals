#!/usr/bin/env node
/**
 * PRIVATE 일목 국면 vs 현재 4단계 국면 — 승률 재계산 (읽기 전용)
 * 2단계 비교 검증. a65fefc에서 기록만 해 둔 일목 국면을 실제 판정에 넣었을 때
 * 승률이 어떻게 변하는지 같은 표본에서 잰다. 배포 파일은 수정하지 않는다.
 *
 * 일목 국면이 evaluate()에 들어가는 경로는 정확히 두 개다.
 *   ① 시장 필터 점수 (index.html `const lv = s.market_level`)
 *        weak −1.0 · caution −0.5 · strong +0.3
 *   ② 방어섹터 게이트 (index.html `marketGuarded`)
 *        weak/caution 이면 방어섹터만 강한매수
 * 두 경로를 따로 갈아끼워 어느 쪽이 승률을 움직였는지 분리한다.
 *
 * A  현재 4단계 (대조군, 배포 중)
 * B1 ①만 일목      — 점수 감점만 일목, 게이트는 현행
 * B2 ②만 일목      — 게이트만 일목, 점수는 현행
 * B3 ①②모두 일목  — 전면 대체
 * C1 게이트 합집합  — 현재 OR 일목 (둘 중 하나만 경고여도 방어)
 * C2 게이트 교집합  — 현재 AND 일목 (둘 다 경고일 때만 방어)
 *
 * 산식은 재구현하지 않고 index.html의 evaluate()/multiSignalRank()/
 * strategyValidation()을 그대로 추출해 쓴다. 두 곳에 두면 반드시 어긋난다.
 * 시나리오 A가 화면 검증표를 재현하는지가 이 하네스의 자체 검사다.
 *
 * 사용: 저장소 루트에서 `node tools/ichi-compare.js`
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

/* ── 일목 국면 원장 (market.hist: [date,cur,below20,ret20,ichi,pos,tk,cloud]) ── */
const ICHI = {}, CUR = {};
for(const r of base.market.hist){
  if(!Array.isArray(r) || r.length < 8) continue;
  CUR[String(r[0])] = r[1]; ICHI[String(r[0])] = r[4];
}

/* ── evaluate()에 일목 국면을 채널별로 주입 ── */
const SCORE_LINE = 'const lv = s.market_level;';
const GATE_LINE  = 'const marketGuarded = s.market_level==="weak" || s.market_level==="caution";';
const GATE_EXPR = {
  cur:  's.market_level==="weak" || s.market_level==="caution"',
  ichi: 's.ichi_level==="weak" || s.ichi_level==="caution"',
  or:   '(s.market_level==="weak"||s.market_level==="caution") || (s.ichi_level==="weak"||s.ichi_level==="caution")',
  and:  '(s.market_level==="weak"||s.market_level==="caution") && (s.ichi_level==="weak"||s.ichi_level==="caution")',
};
function evalSrc(useIchiScore, useIchiGate){
  let e = extractFunction('evaluate');
  if(!e.includes(SCORE_LINE)) die('시장필터 점수 라인을 못 찾음');
  if(!e.includes(GATE_LINE))  die('방어섹터 게이트 라인을 못 찾음');
  if(useIchiScore) e = e.replace(SCORE_LINE, 'const lv = s.ichi_level;');
  const mode = useIchiGate === true ? 'ichi' : (useIchiGate || 'cur');
  e = e.replace(GATE_LINE, `const marketGuarded = ${GATE_EXPR[mode]};`);
  return e;
}

/* histRow()가 만드는 행에 ichi_level을 함께 실어준다.
   KR·벤치마크는 market_level과 같은 규칙으로 neutral 고정. */
const HISTROW_TAIL = 'market_events: Array.isArray(o.market_events) ? o.market_events : []';
function histRowSrc(){
  let f = extractFunction('histRow');
  if(!f.includes(HISTROW_TAIL)) die('histRow 말미를 못 찾음');
  return f.replace(HISTROW_TAIL,
    HISTROW_TAIL + ',\n    ichi_level: (s._kr || s._benchmark) ? "neutral" : (ICHI_MAP[o.date] || null)');
}

const OTHER = ['competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings','strategyValidation'];

function makeCtx(useIchiScore, useIchiGate){
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
const ICHI_MAP = ${JSON.stringify(ICHI)};
var state = { data:null, overrides:{}, holdings:[], cart:[], hidden:[], market:'all', showHoldings:false, themeFilter:null };
${evalSrc(useIchiScore, useIchiGate)}
${histRowSrc()}
${OTHER.map(extractFunction).join('\n')}
this.run = d => { state.data = normalize(d); return strategyValidation(); };
`, ctx);
  return ctx;
}

/* 일목 라벨이 존재하는 창으로 잘라 동일 표본에서 비교한다.
   market.hist는 30거래일(2026-07-06~)인데 종목 hist는 6/30까지 있어,
   자르지 않으면 일목 시나리오에서만 앞 4일이 '시장필터 없음'으로 처리돼
   대조군과 표본이 달라진다. */
const ICHI_FIRST = Object.keys(ICHI).sort()[0];
const F0 = base.hist_fields, ID0 = F0.indexOf('date');
const clipped = JSON.parse(JSON.stringify(base));
let dropped = 0;
for(const s of clipped.stocks){
  const before = (s.hist||[]).length;
  s.hist = (s.hist||[]).filter(r => String(r[ID0]) >= ICHI_FIRST);
  dropped += before - s.hist.length;
}
console.log(`일목 라벨 시작일 ${ICHI_FIRST} 이전 행 ${dropped}개 제외 — 두 시나리오 동일 표본`);

const scenarios = [
  ['A  현재 4단계 (대조군)',            false, false],
  ['B1 시장필터 점수만 일목',            true,  false],
  ['B2 방어섹터 게이트만 일목',          false, true ],
  ['B3 전면 일목 대체',                  true,  true ],
  ['C1 게이트 합집합 (현재 OR 일목)',     false, 'or' ],
  ['C2 게이트 교집합 (현재 AND 일목)',    false, 'and'],
];

const pct = v => (v===null||v===undefined) ? ' —' : String(v).padStart(3)+'%';
function row(label, s, b){
  const cell = h => {
    const x = s[h], bb = b ? b[h] : null;
    const e = (x.rate!==null && bb && bb.rate!==null) ? `${x.rate-bb.rate>=0?'+':''}${x.rate-bb.rate}`.padStart(4)+'%p' : '     ';
    return `${pct(x.rate)}(${String(x.n).padStart(4)})${e}`;
  };
  return `  ${label.padEnd(7)}${cell(1)}  ${cell(3)}  ${cell(5)}`;
}

const results = [];
for(const [name, sc, gt] of scenarios){
  const v = makeCtx(sc, gt).run(clipped);
  results.push([name, v]);
  console.log('\n' + name);
  console.log('  ' + '─'.repeat(62));
  console.log(row('다중', v.multi, v._baseline));
  console.log(row('추세', v.pull,  v._baseline));
  console.log(row('반등', v.rev,   v._baseline));
  console.log(row('💡',  v._strict, v._baseline));
  console.log(row('기준선', v._baseline, null));
}

/* ── 요약: 대조군 대비 증감 ── */
console.log('\n\n대조군(A) 대비 승률 증감 (%p)');
console.log('─'.repeat(62));
console.log(`${''.padEnd(26)} +1일   +3일   +5일`);
const A = results[0][1];
for(const [name, v] of results.slice(1)){
  for(const [k, lab] of [['multi','다중'],['pull','추세'],['rev','반등'],['_strict','💡']]){
    const d = h => {
      const a = A[k][h].rate, b = v[k][h].rate;
      if(a===null||b===null) return '   —  ';
      const x = b-a;
      return `${x>=0?'+':''}${x}`.padStart(5)+' ';
    };
    console.log(`${(name.slice(0,3)+' '+lab).padEnd(26)}${d(1)} ${d(3)} ${d(5)}`);
  }
  console.log('');
}

/* ── 표본 창 전·후반 분리: '급락장 기준선 34%' 전제 재확인 ── */
const F = base.hist_fields, I_D = F.indexOf('date'), I_P = F.indexOf('price');
const days = [...new Set(clipped.stocks.flatMap(s => (s.hist||[]).map(r => String(r[I_D]))))].sort();
const mid = days[Math.floor(days.length/2)];
function halfBaseline(pred, label){
  const acc = {1:[],3:[],5:[]};
  for(const s of clipped.stocks){
    const h = s.hist || [];
    for(let i=0;i<h.length;i++){
      if(!pred(String(h[i][I_D]))) continue;
      const p0 = h[i][I_P]; if(!p0) continue;
      for(const k of [1,3,5]){
        if(i+k>=h.length) continue;
        const p1 = h[i+k][I_P]; if(!p1) continue;
        acc[k].push((p1/p0-1)*100);
      }
    }
  }
  const c = k => { const a=acc[k], w=a.filter(x=>x>1).length, l=a.filter(x=>x<-1).length;
    return `${(w+l)?Math.round(w/(w+l)*100):'—'}%(${a.length})`.padEnd(12); };
  console.log(`  ${label.padEnd(24)} ${c(1)} ${c(3)} ${c(5)}`);
}
console.log('\n표본 창 전·후반 기준선 (전 종목 매수) — 분기점 ' + mid);
console.log('─'.repeat(62));
halfBaseline(d => d < mid,  `전반 ${days[0]}~`);
halfBaseline(d => d >= mid, `후반 ${mid}~${days[days.length-1]}`);
halfBaseline(() => true,    '전체');

console.log('\n국면별 기준선 (일수 · 표본)');
console.log('─'.repeat(62));
for(const [MAP, nm] of [[CUR,'현재 4단계'],[ICHI,'일목       ']]){
  for(const lv of ['strong','neutral','caution','weak']){
    const set = new Set(Object.keys(MAP).filter(d => MAP[d]===lv));
    if(!set.size) continue;
    halfBaseline(d => set.has(d), `${nm} ${lv.padEnd(8)}(${String(set.size).padStart(2)}일)`);
  }
}
