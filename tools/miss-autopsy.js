#!/usr/bin/env node
/**
 * PRIVATE 놓친 폭등일 부검 — 어느 관문에서 걸렸는지 한 줄씩 분해 (읽기 전용)
 *
 * "왜 못 잡았나"에 답하려면 점수만 봐서는 안 된다. 강한매수는 여러 관문의
 * AND 조건이라, **어느 관문 하나**가 막았는지 짚어야 고칠지 말지 판단할 수 있다.
 *
 * 여기서는 지정 종목의 '앞으로 N일 안에 크게 오른 날'을 찾아, 그날 우리 산식이
 * 준 등급과 **막힌 관문 목록**을 출력한다.
 *
 * 관문 (추세 강한매수 = 아래 5개 AND)
 *   ① pullSetup   실제 눌림·숨고르기·대량음봉 후 회복 중 하나
 *   ② pullScore   1.5점 이상
 *   ③ sectorOK    약세·주의장이면 방어섹터만
 *   ④ nearHighM   52주 고점 25% 이내 (미너비니 ④)
 *   ⑤ pullChase   3일누적(1배 환산) 5% 이하
 * 반등 강한매수 = revScore>=2.0 AND RSI<=50 AND sectorOK AND run3Eff<=3
 *
 * 사용: node tools/miss-autopsy.js [티커...]   (기본 SNDK AAOI CRDO NET)
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const TICKERS = process.argv.slice(2).length ? process.argv.slice(2) : ['SNDK','AAOI','CRDO','NET'];
const SURGE = 15;   // '폭등'으로 볼 최소 상승률(%) — 5거래일 내 최대

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

/* evaluate()가 관문 통과 여부를 밖으로 알려주도록 반환값에 진단을 덧붙인다.
   산식 자체는 한 글자도 바꾸지 않는다 — 이미 계산된 지역변수를 실어 보낼 뿐이다. */
const RET_ANCHOR = 'pullSetup, pullRelaxed, revStrong, cautionBadge, grade:g, type, line, tags, adj, overheat };';
function patchedEvaluate(){
  let e = extractFunction('evaluate');
  if(!e.includes(RET_ANCHOR)) die('evaluate 반환부 앵커를 못 찾음');
  return e.replace(RET_ANCHOR, RET_ANCHOR.replace('overheat };',
    'overheat, _gate:{pullSetup, pullScore, sectorOK, nearHighM, pullChase, ' +
    'revScore, rsi, run3Eff, marketGuarded, cat:s.category, mkt:s.market_level} };'));
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
this.scan = (d, tickers, horizon) => {
  state.data = normalize(d);
  const out = [];
  allStocks().filter(s=>tickers.includes(s.ticker)).forEach(s=>{
    const hs = histStocks(s); if(!hs) return;
    hs.forEach((r,i)=>{ if(i>0) withPrev(r,hs[i-1]); r._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null; r.sig = evaluate(r); });
    hs.forEach((r,i)=>{
      let best=null, bestDay=null;
      for(let k=1;k<=horizon;k++){
        if(i+k>=hs.length || !hs[i+k].price) break;
        const g=(hs[i+k].price/r.price-1)*100;
        if(best===null||g>best){ best=g; bestDay=k; }
      }
      out.push({tk:s.ticker, cat:s.category, date:r.last_date, best, bestDay,
                grade:r.sig.grade, pullGrade:r.sig.pullGrade, revGrade:r.sig.revGrade, g:r.sig._gate,
                px:{rsi:r.rsi, bb:r.bb_pos, run3:r.run3_sum, pfh:r.pct_from_high, vr:r.vol_ratio, chg:r.change_1d}});
    });
  });
  return out;
};
`, ctx);

const rows = ctx.scan(base, TICKERS, 5);
const f=(v,d=1)=>v===null||v===undefined?'—':Number(v).toFixed(d);

console.log(`■ 놓친 폭등일 부검 — 5거래일 내 +${SURGE}% 이상 오른 날`);
console.log('  "막힌 관문"이 그날 강한매수를 준 것을 실제로 무엇이 막았는지다.\n');

let total=0, caught=0;
const blockCount = {};
for(const tk of TICKERS){
  const mine = rows.filter(r=>r.tk===tk && r.best!==null && r.best>=SURGE)
                   .sort((a,b)=>b.best-a.best);
  console.log(`── ${tk} (${(rows.find(r=>r.tk===tk)||{}).cat||'?'}) — 폭등 시작일 ${mine.length}건`);
  if(!mine.length){ console.log('   (이 창에 해당 없음)\n'); continue; }
  for(const r of mine){
    total++;
    const ok = r.grade===5;
    if(ok) caught++;
    const g = r.g || {};
    const blocked = [];
    if(!g.pullSetup)  blocked.push('①눌림아님');
    else if(!(g.pullScore>=1.5)) blocked.push(`②추세점수 ${f(g.pullScore)}<1.5`);
    if(!g.sectorOK)   blocked.push(`③약세장 비방어섹터`);
    if(!g.nearHighM)  blocked.push(`④고점대비 ${f(g.pfh ?? r.px.pfh)}%<-25`);
    if(!g.pullChase)  blocked.push(`⑤3일누적 ${f(g.run3Eff)}%>5`);
    const revBlocked = [];
    if(!(g.revScore>=2.0)) revBlocked.push(`반등점수 ${f(g.revScore)}<2.0`);
    if(!(g.rsi<=50))       revBlocked.push(`RSI ${f(g.rsi)}>50`);
    if(!g.sectorOK)        revBlocked.push('약세장 비방어섹터');
    if(!(g.run3Eff===null||g.run3Eff<=3)) revBlocked.push(`3일누적 ${f(g.run3Eff)}%>3`);
    (ok?[]:blocked.concat(revBlocked)).forEach(b=>{ const k=b.split(' ')[0]; blockCount[k]=(blockCount[k]||0)+1; });
    console.log(`   ${r.date}  +${f(r.best)}% (${r.bestDay}일째)  등급 ${r.grade}${ok?' ✔ 잡음':' ✘ 놓침'}`);
    console.log(`      지표: RSI ${f(r.px.rsi)} · 볼린저 ${f(r.px.bb)} · 3일누적 ${f(r.px.run3)}% · 고점대비 ${f(r.px.pfh)}% · 거래량 ${f(r.px.vr,2)} · 시장 ${g.mkt}`);
    if(!ok){
      console.log(`      추세 막힌 곳: ${blocked.length?blocked.join(' / '):'(통과했으나 최종 등급 미달)'}`);
      console.log(`      반등 막힌 곳: ${revBlocked.length?revBlocked.join(' / '):'(통과했으나 최종 등급 미달)'}`);
    }
  }
  console.log('');
}

console.log(`■ 요약 — 폭등 시작일 ${total}건 중 ${caught}건 포착 (${total?Math.round(caught/total*100):0}%)`);
if(Object.keys(blockCount).length){
  console.log('  막은 관문 빈도 (놓친 건 기준):');
  Object.entries(blockCount).sort((a,b)=>b[1]-a[1])
    .forEach(([k,n])=>console.log(`    ${k.padEnd(18)} ${n}회`));
}
console.log('\n  ※ 여기서 "놓쳤다"는 것이 곧 "고쳐야 한다"는 뜻은 아니다.');
console.log('    관문을 풀면 그 관문이 막던 실패 사례도 같이 들어온다.');
console.log('    풀지 말지는 tools/condition-scan.js로 전체 승률을 재봐야 판단할 수 있다.');
