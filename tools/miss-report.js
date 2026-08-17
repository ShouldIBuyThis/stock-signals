#!/usr/bin/env node
/**
 * 실패 학습 리포트 — "중립이었는데 곧바로 올라버린 종목" 자동 부검 (읽기 전용)
 *
 * 사용자 지시(2026-08-17): 매 업데이트마다, 5% 이상(1배 환산) 상승했는데
 * 그 직전 1~3일에 우리 산식이 '중립'을 줬던 종목을 리포트로 남긴다.
 * 목적은 자책이 아니라 학습이다 — 어떤 관문이 막았는지 통계를 쌓아서,
 * 같은 관문이 반복해서 "이기는 종목"을 막고 있으면 그때 완화를 시험한다.
 *
 * ⚠ 읽는 규칙 (docs/승률-검증-방법론.md §5-3):
 *   "놓쳤다"가 곧 "고쳐야 한다"는 뜻이 아니다. 관문을 풀면 그 관문이 막던
 *   실패 사례도 같이 들어온다. 완화는 반드시 tools/strict-lab.js 류의
 *   전수 재검증으로 전·후반 모두 개선될 때만 채택한다.
 *
 * 사용: node tools/miss-report.js  (stdout으로 마크다운 출력)
 * 워크플로우가 reports/실패학습.md 로 저장·커밋한다.
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const SURGE = 5;        // 1배 환산 최소 상승률(%)
const FWD = 3;          // 며칠 안의 상승을 보나
const RECENT = 10;      // 최근 며칠의 중립일만 리포트하나 (관문 통계는 전 구간)

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

const RET_ANCHOR = 'pullSetup, pullRelaxed, revStrong, cautionBadge, grade:g, type, line, tags, adj, overheat };';
function patchedEvaluate(){
  let e = extractFunction('evaluate');
  if(!e.includes(RET_ANCHOR)) die('evaluate 반환부 앵커를 못 찾음');
  return e.replace(RET_ANCHOR, RET_ANCHOR.replace('overheat };',
    'overheat, _gate:{pullSetup, pullScore, sectorOK, nearHighM, pullChase, revScore, rsi, run3Eff} };'));
}

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
const levX = tk => (LEVERAGED[tk]?LEVERAGED[tk].x:1);
${extractConst('RANK_NONE')}
${extractConst('HIST_FIELDS_DEFAULT')}
var state = { data:null, overrides:{}, holdings:[], cart:[], hidden:[], market:'all', showHoldings:false, themeFilter:null };
${patchedEvaluate()}
${OTHER.map(extractFunction).join('\n')}
this.levXf = tk => levX(tk);
this.scan = (d) => {
  state.data = normalize(d);
  const out = [];
  allStocks().forEach(s=>{
    const hs = histStocks(s); if(!hs) return;
    hs.forEach((r,i)=>{ if(i>0) withPrev(r,hs[i-1]); r._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null; r.sig = evaluate(r); });
    hs.forEach((r,i)=>{
      if(r.sig.grade!==3) return;                       // 중립만
      let best=null, bestDay=null;
      for(let k=1;k<=${FWD};k++){
        if(i+k>=hs.length || !hs[i+k].price) break;
        const g=(hs[i+k].price/r.price-1)*100;
        if(best===null||g>best){ best=g; bestDay=k; }
      }
      if(best===null) return;
      out.push({tk:s.ticker, name:s.name, cat:s.category, date:r.last_date,
                idxFromEnd: hs.length-1-i, best, bestDay, lev:levX(s.ticker),
                g:r.sig._gate, px:{rsi:r.rsi, bb:r.bb_pos, run3:r.run3_sum, pfh:r.pct_from_high}});
    });
  });
  return out;
};
`, ctx);

const rows = ctx.scan(base);
const missed = rows.filter(r => r.best/r.lev >= SURGE);
const recent = missed.filter(r => r.idxFromEnd < RECENT)
                     .sort((a,b)=> b.date.localeCompare(a.date) || (b.best/b.lev)-(a.best/a.lev));
const f=(v,d=1)=>v===null||v===undefined?'—':Number(v).toFixed(d);

function blockers(r){
  const g=r.g||{}, out=[];
  if(!g.pullSetup) out.push('눌림아님');
  else if(!(g.pullScore>=1.5)) out.push('추세점수');
  if(!g.sectorOK) out.push('약세장섹터');
  if(!g.nearHighM) out.push(`고점대비 ${f(r.px.pfh,0)}%`);
  if(!g.pullChase) out.push(`추격 ${f(g.run3Eff,0)}%`);
  if(!(g.revScore>=2.0)) out.push('반등점수');
  if(g.revScore>=2.0 && !(g.rsi<=50)) out.push(`RSI ${f(g.rsi,0)}`);
  if(g.revScore>=2.0 && !(g.run3Eff===null||g.run3Eff<=3)) out.push('반등추격');
  return out;
}

console.log('# 실패 학습 리포트');
console.log('');
console.log(`갱신: ${base.generated_at || '?'} · 기준: 중립 판정 후 ${FWD}거래일 내 +${SURGE}% 이상(레버리지 1배 환산)`);
console.log('');
console.log('> "놓쳤다 ≠ 고쳐야 한다" (방법론 §5-3). 관문을 풀면 그 관문이 막던 실패도 같이 들어온다.');
console.log('> 이 리포트는 완화 실험의 후보 수집용이다. 채택은 전수 재검증(전·후반 모두 개선)으로만.');
console.log('');
console.log(`## 최근 ${RECENT}거래일의 놓친 상승 — ${recent.length}건`);
console.log('');
if(!recent.length){
  console.log('(해당 없음 — 최근 중립 판정 중 곧바로 급등한 종목이 없다)');
} else {
  console.log('| 중립 판정일 | 종목 | 이후 상승 | 그날 막은 관문 |');
  console.log('|---|---|---|---|');
  for(const r of recent.slice(0,25)){
    const eff = r.lev>1 ? ` (1배 환산 +${f(r.best/r.lev)}%)` : '';
    console.log(`| ${r.date} | ${r.tk} ${r.name||''} | +${f(r.best)}% (${r.bestDay}일)${eff} | ${blockers(r).join(' · ')||'점수 미달'} |`);
  }
  if(recent.length>25) console.log(`\n(외 ${recent.length-25}건 생략)`);
}
console.log('');
console.log(`## 관문별 누적 빈도 — 전 구간 놓친 상승 ${missed.length}건 기준`);
console.log('');
const cnt={};
missed.forEach(r=>blockers(r).forEach(b=>{ const k=b.split(' ')[0]; cnt[k]=(cnt[k]||0)+1; }));
console.log('| 관문 | 막은 횟수 |');
console.log('|---|---|');
Object.entries(cnt).sort((a,b)=>b[1]-a[1]).forEach(([k,n])=>console.log(`| ${k} | ${n} |`));
console.log('');
console.log('같은 관문이 계속 상위에 있고 표본이 쌓이면 tools/strict-lab.js 로 완화를 시험한다.');
