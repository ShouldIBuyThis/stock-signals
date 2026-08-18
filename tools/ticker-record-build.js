#!/usr/bin/env node
/**
 * 종목별 강한매수 실측 표를 만든다 — 사이트가 읽을 작은 파일로.
 *
 * 입력  backtest/raw.json      (tools/backfill_backtest.py가 만든 장기 백테스트 원본, ~5MB)
 * 출력  backtest/ticker-record.json  (종목당 4칸짜리 요약, 수십 KB)
 *
 * 원본을 그대로 사이트에 올리면 5MB를 매번 받아야 한다. 승률 표는 종목당
 * 4개 구간의 숫자 몇 개뿐이므로 여기서 미리 접어 둔다.
 *
 * 산식은 index.html의 evaluate()를 문자열로 추출해 쓴다 — 재구현 금지
 * (docs/승률-검증-방법론.md §0). 여기서 다시 짜면 화면과 반드시 어긋난다.
 *
 * ⚠ 이 숫자는 백테스트다. frozen 원장(signals.json)과 다른 주장이다:
 *    · 지금 산식을 과거에 소급 적용한 것 — 그날 실제로 본 신호가 아니다
 *    · 관심종목을 현재 시점에서 골랐으므로 생존 편향으로 위로 부풀려진다
 *    · 시장 국면·항복 바닥(K2)·실적 영향권 제외는 운영과 같게 적용된다
 *   그래서 검증표(30거래일 원장)와 직접 비교하면 안 되고, 화면에도 그렇게 적는다.
 *
 * 사용: node tools/ticker-record-build.js [입력] [출력]
 */
const fs = require('fs'), vm = require('vm');

const IN  = process.argv[2] || 'backtest/raw.json';
const OUT = process.argv[3] || 'backtest/ticker-record.json';
const HS  = [1, 3, 5, 7];

const src = fs.readFileSync('index.html', 'utf8');
if (!fs.existsSync(IN)) {
  console.error(`[ERROR] ${IN} 이 없다. 먼저 python tools/backfill_backtest.py 를 돌릴 것.`);
  process.exit(1);
}
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));

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
function extractLine(re){ const m=src.match(re); if(!m) die(String(re)); return m[0]; }
function extractConst(name){ const st=src.indexOf(`const ${name} =`); if(st<0) die(name); return src.slice(st, src.indexOf(';',st)+1); }

const OTHER = ['qqqRsiOn','washoutLevel','normalize','decorate','histWindowDays','histFields',
  'histRow','withPrev','histStocks','prevStock','allStocks','earningsWindowsForValidation'];
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
${extractFunction('evaluate')}
${OTHER.map(extractFunction).join('\n')}
/* 종목별로 '강한매수(등급5)가 뜬 날'만 모아 앞으로 N거래일 수익률을 낸다.
   화면의 tickerStrongRecord()와 한 줄씩 같은 규칙이다 — 보합 ±1% 제외,
   실적 영향권(신호일·종가) 제외. 실적 창은 backfill_backtest.py가
   validation_blocked_dates에 담아 주고, 여기서는 그것을 그대로 읽는다. */
this.build = (d, HS) => {
  state.data = normalize(d);
  const out = {};
  let blockedDays = 0;
  allStocks().forEach(s => {
    const hs = histStocks(s) || [];
    if(hs.length < 2) return;
    const blocked = earningsWindowsForValidation(s, hs).blocked;
    blockedDays += blocked.size;
    const buckets = {}; HS.forEach(h => buckets[h] = []);
    let signals = 0;
    hs.forEach((h, i) => {
      if(!h.last_date || !has(h.price) || !h.price) return;
      if(blocked.has(h.last_date)) return;               // 실적 영향권 신호는 제외
      const row = Object.assign({}, s, h);
      if(i>0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null;
      if(evaluate(row).grade < 5) return;
      HS.forEach(k => {
        const end = hs[i+k];
        if(!end || !has(end.price) || blocked.has(end.last_date)) return;
        buckets[k].push((end.price/h.price-1)*100);
        /* 화면(tickerStrongRecord)은 첫 구간 표본이 생긴 날만 '신호'로 센다.
           창 끝의 앞날 가격 없는 날을 여기서만 세면 같은 숫자가 두 값이 된다. */
        if(k === HS[0]) signals++;
      });
    });
    if(!signals) return;
    const rec = { signals };
    HS.forEach(h => {
      const a = buckets[h];
      const w = a.filter(x=>x>1).length, l = a.filter(x=>x<-1).length;
      rec[h] = { n:a.length,
                 rate:(w+l) ? Math.round(w/(w+l)*100) : null,
                 avg:a.length ? Math.round(a.reduce((p,c)=>p+c,0)/a.length*100)/100 : null };
    });
    out[s.ticker] = rec;
  });
  this.blockedDays = blockedDays;
  return out;
};`, ctx);

const records = ctx.build(base, HS);
const days = [...new Set(base.stocks.flatMap(s => (s.hist||[]).map(r => r[base.hist_fields.indexOf('date')])))].sort();
const payload = {
  kind: 'backtest',
  note: '현재 산식을 과거 데이터에 소급 적용한 백테스트. signals.json의 frozen 원장(그날 실제로 본 신호)과 다른 주장이다.',
  survivorship_warning: '관심종목을 현재 시점에서 골랐으므로 과거 성적은 위로 편향된다.',
  earnings_excluded: base.earnings_excluded === true,
  built_at: new Date().toISOString().slice(0,16).replace('T',' ') + ' UTC',
  window: days.length ? { from: days[0], to: days[days.length-1], days: days.length } : null,
  horizons: HS,
  records,
};
fs.mkdirSync(require('path').dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload));

const tks = Object.keys(records);
const kb = fs.statSync(OUT).size / 1024;
console.log(`실적 제외: ${payload.earnings_excluded ? '적용' : '미적용'} · 금지 세션 ${ctx.blockedDays||0}일 · ` +
  `QQQ 기준카드(K2): ${base.qqq_card ? '있음' : '없음'}`);
console.log(`저장: ${OUT} (${kb.toFixed(0)}KB) · ${tks.length}종목 · 창 ${payload.window ? payload.window.from+'~'+payload.window.to+' ('+payload.window.days+'일)' : '없음'}`);
const n3 = tks.map(t => records[t][3].n).sort((a,b)=>a-b);
if(n3.length) console.log(`+3일 표본: 최소 ${n3[0]} · 중앙 ${n3[Math.floor(n3.length/2)]} · 최대 ${n3[n3.length-1]} · 5건 이상인 종목 ${n3.filter(x=>x>=5).length}/${n3.length}`);
