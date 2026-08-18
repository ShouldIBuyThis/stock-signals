#!/usr/bin/env node
/**
 * 방어섹터 후보 §2 반쪽 검증 (읽기 전용)
 *
 * DEFENSIVE_CATS에 섹터를 넣기 전 마지막 관문이다. sector-weak.js가 "게이트 ON
 * 구간 전체"의 성적을 보여준다면, 여기서는 그 구간을 **날짜로 반으로 잘라**
 * 양쪽 반에서 모두 기준선을 넘는지 본다(docs/승률-검증-방법론.md §2).
 *
 * 기준선 자체가 국면에 따라 뒤집히므로, 한쪽 반에서만 좋은 섹터는 국면 산물이고
 * 편입하면 다음 국면에서 무너진다. 원승률이 아니라 **같은 구간 기준선 대비 %p**로 본다.
 *
 * 사용: node tools/defensive-split.js [섹터명 ...]   (기본: 경기방어)
 */
const fs = require('fs'), H = require('./_harness');
const HS = [1, 3, 5];
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['경기방어'];

const ctx = H.buildContext({ tail: `
this.rows = d => {
  state.data = normalize(d);
  const out = [];
  allStocks().forEach(s => {
    const hs = histStocks(s) || [];
    hs.forEach((h, i) => {
      if(!h.last_date || !has(h.price) || !h.price) return;
      const fwd = {};
      HS.forEach(k => { const e = hs[i+k]; if(e && has(e.price)) fwd[k] = (e.price/h.price-1)*100; });
      out.push({ date:h.last_date, cat:s.category, lvl:h.market_level, fwd });
    });
  });
  return out;
};`.replace('HS', JSON.stringify(HS)) });

const rows = ctx.rows(JSON.parse(fs.readFileSync('signals.json', 'utf8')))
  .filter(r => r.lvl === 'weak' || r.lvl === 'caution');       // 게이트가 켜지는 날만
const days = [...new Set(rows.map(r => r.date))].sort();
if (days.length < 6) { console.log(`게이트 ON 일수 ${days.length}일 — 반으로 자를 수 없다.`); process.exit(0); }
const mid = days[Math.floor(days.length/2)];

/* 승/패는 ±1% 보합을 뺀 뒤 센다 — 화면 실측표와 같은 규칙 */
function rate(arr){ const w=arr.filter(x=>x>1).length, l=arr.filter(x=>x<-1).length;
  return (w+l) ? Math.round(w/(w+l)*100) : null; }
function agg(sel, h){ return sel.map(r=>r.fwd[h]).filter(x=>x!==undefined); }

function report(label, sub){
  const base = {}, line = [];
  HS.forEach(h => base[h] = rate(agg(sub, h)));
  WANT.forEach(cat => {
    const mine = sub.filter(r => r.cat === cat);
    const cells = HS.map(h => {
      const a = agg(mine, h), r = rate(a), b = base[h];
      if(r === null || b === null) return `+${h}일    –      `;
      const d = r - b;
      return `+${h}일 ${String(r).padStart(3)}%(${String(a.length).padStart(3)}) ${d>=0?'+':''}${d}%p`;
    });
    line.push(`  ${cat.padEnd(6)} ${cells.join('  ')}`);
  });
  console.log(`\n${label}  ·  ${sub.length}표본`);
  console.log(`  기준선(전 종목) ` + HS.map(h=>`+${h}일 ${base[h]}%`).join(' · '));
  console.log(line.join('\n'));
}

console.log(`게이트 ON ${days.length}일 (${days[0]} ~ ${days[days.length-1]}) · 분할 기준 ${mid}`);
report('■ 전체',      rows);
report('■ 전반부',    rows.filter(r => r.date <  mid));
report('■ 후반부',    rows.filter(r => r.date >= mid));

console.log(`\n※ 판정: 전반부·후반부 **양쪽 모두** 기준선 이상이어야 편입 후보다(§2).`);
console.log(`   한쪽만 좋으면 국면 산물이므로 넣지 않는다.`);
