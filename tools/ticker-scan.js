#!/usr/bin/env node
/**
 * PRIVATE 종목별 신호 성적 — "썩은 이" 찾기 (읽기 전용)
 *
 * 어떤 종목은 강한매수가 떠도 계속 떨어진다. 체력(펀더멘털)이 무너진 종목은
 * 기술적 신호가 잘 작동하지 않기 때문이다. 감으로 빼면 안 되므로, 종목별로
 * **신호가 떴을 때의 성적**을 재서 줄세운다.
 *
 * 두 가지를 같이 본다.
 *   ① 신호 성적   — 그 종목에 강한매수(등급5)가 떴을 때 실제 결과
 *   ② 자체 기준선 — 그 종목을 아무 날이나 샀을 때 결과
 * ①이 ②보다 낮으면 "신호가 이 종목에서는 작동하지 않는다"는 뜻이다.
 * ①만 낮은 건 그냥 약세 종목일 수 있어서 ②와 비교해야 판단이 선다.
 *
 * ⚠ 표본 경고: 종목당 30거래일이라 신호 표본이 한 자릿수인 경우가 많다.
 *   §5-1대로 5건 미만은 결론 금지, 15건 미만은 참고만. 그래서 출력에
 *   표본 수를 항상 같이 찍고, 제외 후보는 **섹터 단위로도 확인**한다.
 *
 * 사용: node tools/ticker-scan.js            # 종목별 (신호 표본 많은 순)
 *       node tools/ticker-scan.js --sector   # 섹터별 집계
 *       node tools/ticker-scan.js --worst    # 제외 후보만
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const MODE = process.argv.includes('--sector') ? 'sector'
           : process.argv.includes('--worst') ? 'worst' : 'ticker';

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

const OTHER = ['qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks'];
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
this.grades = d => {
  state.data = normalize(d);
  const out = {};
  allStocks().forEach(s => {
    const hs = histStocks(s) || [];
    out[s.ticker] = { cat: s.category, rows: hs.map((h,i) => {
      const row = Object.assign({}, s, h);
      if(i>0) withPrev(row, hs[i-1]);
      if(i>0) row._prevOverallGrade = evaluate(hs[i-1]).grade;
      const sig = evaluate(row);
      return { d:h.last_date, g:sig.grade, pull:sig.pullGrade===5, rev:sig.revGrade===5 };
    })};
  });
  return out;
};`, ctx);

const G = ctx.grades(base);
const F = base.hist_fields, I_D = F.indexOf('date'), I_P = F.indexOf('price');
/* 신호일로부터 +1/+3/+5일 수익률 */
function fwd(tk){
  const s = base.stocks.find(x => x.ticker === tk); if(!s) return {};
  const h = s.hist || [], m = {};
  h.forEach((r,i) => {
    const p0 = r[I_P]; if(!p0) return;
    const o = {};
    for(const k of [1,3,5]){ const q = h[i+k] && h[i+k][I_P]; if(q) o[k] = (q/p0-1)*100; }
    m[String(r[I_D])] = o;
  });
  return m;
}
const RET = {}; Object.keys(G).forEach(tk => RET[tk] = fwd(tk));

const stat = arr => {
  const w = arr.filter(v => v>1).length, l = arr.filter(v => v<-1).length;
  return { n: arr.length, rate: (w+l) ? Math.round(w/(w+l)*100) : null,
           avg: arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*100)/100 : null };
};
/* 종목별: 강한매수일의 성적 vs 그 종목 자체 기준선(모든 날) */
const rec = [];
for(const [tk, o] of Object.entries(G)){
  const sig = {1:[],3:[],5:[]}, all = {1:[],3:[],5:[]};
  for(const r of o.rows){
    const f = RET[tk][r.d] || {};
    for(const k of [1,3,5]){
      if(f[k]===undefined) continue;
      all[k].push(f[k]);
      if(r.g>=5) sig[k].push(f[k]);
    }
  }
  rec.push({ tk, cat:o.cat,
    sig: {1:stat(sig[1]),3:stat(sig[3]),5:stat(sig[5])},
    self:{1:stat(all[1]),3:stat(all[3]),5:stat(all[5])} });
}

const cell = s => (s && s.n) ? `${String(s.rate===null?'—':s.rate).padStart(3)}%(${String(s.n).padStart(2)})${((s.avg>=0?'+':'')+s.avg+'%').padStart(8)}` : '      —        ';
const V = base.stocks.reduce((m,s)=>(m[s.ticker]=s.name||s.ticker,m),{});

if(MODE === 'ticker' || MODE === 'worst'){
  const B = { 1:49, 3:50, 5:49 };   // 전체 기준선 (참고용 표시)
  console.log('종목별 강한매수 성적 — 신호가 이 종목에서 작동하는가');
  console.log('신호 = 등급5가 뜬 날 / 자체 = 그 종목 전 거래일 (같은 종목 안에서 비교해야 뜻이 있다)');
  console.log(`전체 기준선 참고: +1일 ${B[1]}% · +3일 ${B[3]}% · +5일 ${B[5]}%\n`);
  let list = rec.filter(r => r.sig[3].n > 0);
  if(MODE === 'worst'){
    /* 제외 후보: 신호 3건 이상 & +3일·+5일 평균수익이 모두 마이너스 & 자체 기준선보다도 나쁨 */
    list = list.filter(r => r.sig[3].n >= 3 &&
      r.sig[3].avg < 0 && r.sig[5].avg < 0 &&
      r.sig[3].avg < r.self[3].avg && r.sig[5].avg < r.self[5].avg);
    console.log('■ 제외 후보 — 신호 3건 이상 · +3일·+5일 평균수익 모두 마이너스 · 자체 기준선보다도 나쁨\n');
  }
  list.sort((a,b) => (a.sig[5].avg??99) - (b.sig[5].avg??99));
  console.log('티커'.padEnd(11)+'섹터'.padEnd(15)+'신호 +3일'.padEnd(16)+'신호 +5일'.padEnd(16)+'자체 +3일'.padEnd(16)+'자체 +5일');
  console.log('─'.repeat(92));
  for(const r of list){
    console.log(`${r.tk.padEnd(11)}${(r.cat||'').padEnd(13)}${cell(r.sig[3])}${cell(r.sig[5])}${cell(r.self[3])}${cell(r.self[5])}`);
  }
  console.log(`\n총 ${list.length}종목`);
}

if(MODE === 'sector'){
  console.log('섹터별 강한매수 성적 (방어섹터에 ★)');
  console.log('전체 기준선: +1일 49% +0.09% · +3일 50% +0.34% · +5일 49% +0.03%\n');
  const DEF = ['금융','원자재·금','원자재·유가','주택'];
  const byCat = {};
  for(const [tk,o] of Object.entries(G)){
    const c = o.cat || '기타';
    (byCat[c] = byCat[c] || {sig:{1:[],3:[],5:[]}, all:{1:[],3:[],5:[]}, tks:new Set()});
    byCat[c].tks.add(tk);
    for(const r of o.rows){
      const f = RET[tk][r.d] || {};
      for(const k of [1,3,5]){
        if(f[k]===undefined) continue;
        byCat[c].all[k].push(f[k]);
        if(r.g>=5) byCat[c].sig[k].push(f[k]);
      }
    }
  }
  const rows = Object.entries(byCat).map(([c,o]) => ({c, tks:o.tks.size,
    sig:{1:stat(o.sig[1]),3:stat(o.sig[3]),5:stat(o.sig[5])},
    self:{3:stat(o.all[3]),5:stat(o.all[5])}}));
  rows.sort((a,b)=>(b.sig[5].avg??-99)-(a.sig[5].avg??-99));
  console.log('섹터'.padEnd(17)+'신호 +1일'.padEnd(16)+'신호 +3일'.padEnd(16)+'신호 +5일'.padEnd(16)+'자체 +5일'.padEnd(16)+'종목');
  console.log('─'.repeat(96));
  for(const r of rows){
    console.log(`${((DEF.includes(r.c)?'★ ':'  ')+r.c).padEnd(15)}${cell(r.sig[1])}${cell(r.sig[3])}${cell(r.sig[5])}${cell(r.self[5])}${String(r.tks).padStart(3)}종`);
  }
}
