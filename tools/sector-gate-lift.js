#!/usr/bin/env node
/**
 * "기술적 지표가 잘 안 듣는 섹터는 강한매수 문턱을 높이면 어떨까" 실측
 *
 * 사용자 가설: 빅테크·양자컴퓨팅·암호화폐는 기술신호가 자주 틀린다.
 * 그 섹터만 컷을 올리면 전체 승률이 오르는가?
 *
 * 방법론이 요구하는 것을 그대로 본다.
 *   · 지워지는 표본이 **실제로 지는지** (지지 않는 표본을 지우면 그냥 손해다)
 *   · 남는 표본이 오르는지
 *   · §2 반쪽 — 양쪽 반에서 같은 방향인지
 *   · §5 표본 독립성 — 몇 종목에서 나온 숫자인지
 *
 * 문턱은 '그 섹터에서만 buyScore를 N만큼 더 요구한다'로 모형화한다.
 * 산식은 건드리지 않고, evaluate() 결과 위에서 걸러 본다.
 *
 * 사용: node tools/sector-gate-lift.js [섹터 ...]
 */
const fs = require('fs'), H = require('./_harness');
const WANT = process.argv.slice(2).length ? process.argv.slice(2)
           : ['빅테크', '양자컴퓨팅', '암호화폐'];
const HS = [1, 3, 5];

const ctx = H.loadPage();
ctx.__raw = fs.readFileSync('signals.json', 'utf8');
const rows = ctx.runInPage(`(() => {
  state.data = normalize(JSON.parse(__raw));
  const out = [];
  allStocks().forEach(s => {
    const hs = histStocks(s) || [];
    hs.forEach((h, i) => {
      if(!h.last_date || !has(h.price) || !h.price) return;
      const row = Object.assign({}, s, h);
      if(i>0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null;
      const sig = evaluate(row);
      if(sig.grade < 5) return;
      const f = {};
      [1,3,5].forEach(k => { const e = hs[i+k]; if(e && has(e.price)) f[k] = (e.price/h.price-1)*100; });
      out.push({ tk:s.ticker, cat:s.category, date:h.last_date, f,
                 buy:sig.buyScore, pull:sig.pullScore, rev:sig.revScore });
    });
  });
  return out;
})()`);

function rate(a){ const w=a.filter(x=>x>1).length, l=a.filter(x=>x<-1).length; return (w+l)?Math.round(w/(w+l)*100):null; }
function fmt(sel){ return HS.map(h => { const a = sel.map(r=>r.f[h]).filter(v=>v!==undefined);
  const av = a.length ? a.reduce((p,c)=>p+c,0)/a.length : null;
  return `+${h}일 ${String(rate(a)??'-').padStart(3)}%(${String(a.length).padStart(3)}) ${av===null?'':(av>=0?'+':'')+av.toFixed(2)+'%'}`; }).join('  '); }

const days = [...new Set(rows.map(r=>r.date))].sort();
const mid = days[Math.floor(days.length/2)];
console.log(`강한매수 ${rows.length}건 · ${days.length}일 (${days[0]} ~ ${days[days.length-1]})`);
console.log(`전체            ${fmt(rows)}\n`);

console.log('■ 대상 섹터가 실제로 나쁜가');
console.log('─'.repeat(104));
const tgt = rows.filter(r => WANT.includes(r.cat));
const rest = rows.filter(r => !WANT.includes(r.cat));
WANT.forEach(cat => {
  const sel = rows.filter(r => r.cat === cat);
  const tks = new Set(sel.map(r=>r.tk)).size;
  console.log(`${cat.padEnd(8)}(${tks}종목) ${sel.length ? fmt(sel) : '표본 없음'}`);
});
console.log(`${'대상 합계'.padEnd(8)}        ${tgt.length ? fmt(tgt) : '표본 없음'}`);
console.log(`${'나머지'.padEnd(8)}        ${fmt(rest)}`);

console.log('\n■ 문턱을 올리면 — 대상 섹터에만 buyScore 하한을 건다');
console.log('─'.repeat(104));
console.log('하한   지워지는 표본                                            남는 전체');
[2.0, 2.5, 3.0, 3.5, 4.0].forEach(cut => {
  const gone = tgt.filter(r => r.buy < cut);
  const keep = rows.filter(r => !WANT.includes(r.cat) || r.buy >= cut);
  console.log(`${String(cut).padEnd(6)} ${gone.length ? fmt(gone) : '해당 없음'.padEnd(56)}  │ ${fmt(keep)}`);
});

console.log('\n■ §2 반쪽 — 대상 섹터 자체');
console.log('─'.repeat(104));
console.log(`  전반 ${tgt.filter(r=>r.date <  mid).length ? fmt(tgt.filter(r=>r.date <  mid)) : '표본 없음'}`);
console.log(`  후반 ${tgt.filter(r=>r.date >= mid).length ? fmt(tgt.filter(r=>r.date >= mid)) : '표본 없음'}`);
