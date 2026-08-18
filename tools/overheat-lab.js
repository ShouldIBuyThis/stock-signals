#!/usr/bin/env node
/**
 * 💡 강한다중에서 '과열 구간'을 빼면 승률이 오르는가 (읽기 전용)
 *
 * 사용자 아이디어: 이미 많이 올라 익절 구간에 들어간 종목은 전구(💡)에서 빼자.
 * 규칙을 만들기 전에 **빠지는 표본이 실제로 지는지** 먼저 잰다
 * (docs/승률-검증-방법론.md — '지워지는 표본의 성적').
 *
 * 판정 기준
 *   1) 남는 표본의 승률이 오르고
 *   2) 지워지는 표본이 실제로 기준선 아래이고
 *   3) 전반부·후반부 양쪽에서 같은 방향이어야(§2) 채택한다.
 * 하나라도 어긋나면 폐기한다.
 *
 * 사용: node tools/overheat-lab.js
 */
const fs = require('fs'), H = require('./_harness');
const HS = [1, 3, 5];

const ctx = H.buildContext({
  extra: ['strictMultiGate', 'generalTierGate', 'previousOverallGrade'],
  tail: `
this.go = d => {
  state.data = normalize(d);
  const out = [];
  allStocks().forEach(s => {
    const hs = histStocks(s) || [];
    hs.forEach((h, i) => {
      if(!h.last_date || !has(h.price) || !h.price) return;
      const row = Object.assign({}, s, h);
      if(i>0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null;
      const sig = evaluate(row);
      if(sig.grade < 5 || !strictMultiGate(row)) return;      // 💡 강한다중만
      const f = {}; [1,3,5].forEach(k => { const e = hs[i+k]; if(e && has(e.price)) f[k] = (e.price/h.price-1)*100; });
      out.push({ tk:s.ticker, date:h.last_date, f,
                 rsi:row.rsi, bb:row.bb_pos, run5:row.run5_max, run3:row.run3_sum,
                 ret20:row.ret20, pfh:row.pct_from_high });
    });
  });
  return out;
};`});

const rows = ctx.go(JSON.parse(fs.readFileSync('signals.json', 'utf8')));
const has_ = v => v !== null && v !== undefined && Number.isFinite(Number(v));
function rate(a){ const w=a.filter(x=>x>1).length, l=a.filter(x=>x<-1).length; return (w+l)?Math.round(w/(w+l)*100):null; }
function stat(sel, h){ const a = sel.map(r=>r.f[h]).filter(v=>v!==undefined);
  return { n:a.length, r:rate(a), avg:a.length?(a.reduce((p,c)=>p+c,0)/a.length):null }; }
function fmt(sel){ return HS.map(h => { const s = stat(sel, h);
  return `+${h}일 ${String(s.r??'-').padStart(3)}%(${String(s.n).padStart(2)}) ${s.avg===null?'':(s.avg>=0?'+':'')+s.avg.toFixed(2)+'%'}`; }).join('  '); }

const days = [...new Set(rows.map(r=>r.date))].sort();
const mid = days[Math.floor(days.length/2)];

console.log(`💡 강한다중 표본 ${rows.length}건 · ${days.length}일 (${days[0]} ~ ${days[days.length-1]})`);
console.log(`현행 전체     ${fmt(rows)}\n`);

/* 과열 후보 축. 하나씩 '이 조건이면 전구에서 뺀다'로 적용해 본다. */
const AXES = [
  ['RSI ≥ 70',      r => has_(r.rsi)  && r.rsi  >= 70],
  ['RSI ≥ 75',      r => has_(r.rsi)  && r.rsi  >= 75],
  ['볼밴 ≥ 70',      r => has_(r.bb)   && r.bb   >= 70],
  ['볼밴 ≥ 75',      r => has_(r.bb)   && r.bb   >= 75],
  ['3일합 ≥ 10%',    r => has_(r.run3) && r.run3 >= 10],
  ['3일합 ≥ 15%',    r => has_(r.run3) && r.run3 >= 15],
  ['5일최대 ≥ 12%',  r => has_(r.run5) && r.run5 >= 12],
  ['20일수익 ≥ 25%', r => has_(r.ret20)&& r.ret20>= 25],
  ['고점근접 ≤ 1%',  r => has_(r.pfh)  && r.pfh  >= -1],
];

console.log('조건            지워지는 표본                                           남는 표본');
console.log('─'.repeat(120));
AXES.forEach(([label, hot]) => {
  const gone = rows.filter(hot), keep = rows.filter(r => !hot(r));
  if(!gone.length){ console.log(`${label.padEnd(14)} 해당 없음`); return; }
  console.log(`${label.padEnd(14)} ${fmt(gone)}   │ ${fmt(keep)}`);
});

console.log('\n■ §2 반쪽 검증 — 위에서 후보가 된 조건만 의미가 있다');
console.log('─'.repeat(120));
AXES.forEach(([label, hot]) => {
  const g = rows.filter(hot); if(g.length < 4) return;
  const a = g.filter(r=>r.date <  mid), b = g.filter(r=>r.date >= mid);
  console.log(`${label.padEnd(14)} 전반 ${fmt(a)}\n${' '.repeat(14)} 후반 ${fmt(b)}`);
});
