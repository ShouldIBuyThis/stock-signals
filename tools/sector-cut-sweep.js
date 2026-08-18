#!/usr/bin/env node
/**
 * 섹터별 강한매수 문턱 상향 — 188거래일 백테스트 표본으로 스윕 (읽기 전용)
 *
 * 원장 30거래일로는 빅테크 표본이 6건이라 §5-1 기준으로 판단이 불가능했다.
 * backtest/ticker-record-samples.json(신호 1건당 점수·수익률·날짜)을 읽어
 * '그 섹터에만 buyScore 하한을 걸면' 무엇이 지워지고 전체가 어떻게 되는지 잰다.
 *
 * 반드시 같이 본다(docs/승률-검증-방법론.md)
 *   · 지워지는 표본이 실제로 지는가 — 이기는 표본을 지우면 그냥 손해다
 *   · 남는 전체가 오르는가
 *   · §2 반쪽 — 양쪽 반에서 같은 방향인가
 *   · §5 표본 독립성 — 몇 종목에서 나온 숫자인가
 *
 * ⚠ 백테스트다. 생존 편향이 있어 절대 수준은 위로 부풀려져 있다.
 *   여기서 보는 건 절대 승률이 아니라 '컷 전후의 차이'다.
 *
 * 사용: node tools/sector-cut-sweep.js [섹터 ...]
 */
const fs = require('fs');
const F = 'backtest/ticker-record-samples.json';
const HS = ['1','3','5'];
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['빅테크','전기차·자율주행'];

if(!fs.existsSync(F)){ console.error(`[ERROR] ${F} 없음 — 백테스트 워크플로우를 먼저 돌릴 것.`); process.exit(1); }
const doc = JSON.parse(fs.readFileSync(F,'utf8'));
const all = doc.samples.filter(s => s.k === 'strong');
const scored = all.filter(s => s.buy !== undefined && s.buy !== null);

function rate(a){ const w=a.filter(x=>x>1).length, l=a.filter(x=>x<-1).length; return (w+l)?Math.round(w/(w+l)*100):null; }
function fmt(sel){ return HS.map(h => { const a = sel.map(r=>r.r[h]).filter(v=>v!==undefined);
  const av = a.length ? a.reduce((p,c)=>p+c,0)/a.length : null;
  return `+${h}일 ${String(rate(a)??'-').padStart(3)}%(${String(a.length).padStart(3)}) ${av===null?'':(av>=0?'+':'')+av.toFixed(2)+'%'}`; }).join('  '); }
const tks = sel => new Set(sel.map(x=>x.t)).size;

console.log(`백테스트 ${doc.window.days}거래일 (${doc.window.from} ~ ${doc.window.to}) · 강한매수 ${all.length}건`);
if(scored.length < all.length)
  console.log(`⚠ 점수가 실린 표본 ${scored.length}/${all.length}건 — 옛 형식 파일이면 워크플로우를 다시 돌릴 것`);
console.log(`전체              ${fmt(all)}\n`);

console.log('■ 대상 섹터 자체');
console.log('─'.repeat(104));
WANT.forEach(c => { const sel = all.filter(x=>x.c===c);
  console.log(`${c.padEnd(14)}(${tks(sel)}종목) ${sel.length ? fmt(sel) : '표본 없음'}`); });
const tgt = all.filter(x=>WANT.includes(x.c));
console.log(`${'대상 합계'.padEnd(14)}(${tks(tgt)}종목) ${fmt(tgt)}`);
console.log(`${'나머지'.padEnd(14)}(${tks(all.filter(x=>!WANT.includes(x.c)))}종목) ${fmt(all.filter(x=>!WANT.includes(x.c)))}`);

const days=[...new Set(all.map(x=>x.d))].sort(), mid=days[Math.floor(days.length/2)];
console.log('\n■ §2 반쪽 — 대상 섹터');
console.log('─'.repeat(104));
console.log(`  전반 ${fmt(tgt.filter(x=>x.d <  mid))}`);
console.log(`  후반 ${fmt(tgt.filter(x=>x.d >= mid))}`);

if(!scored.length) process.exit(0);
console.log('\n■ 문턱 스윕 — 대상 섹터에만 buyScore 하한');
console.log('─'.repeat(104));
console.log('하한    지워지는 표본                                             남는 전체');
const cuts=[...new Set(scored.map(x=>x.buy))].sort((a,b)=>a-b).filter(v=>v>0);
[...new Set([0,...cuts])].forEach(cut => {
  const gone = tgt.filter(x => x.buy < cut);
  const keep = all.filter(x => !WANT.includes(x.c) || x.buy >= cut);
  if(!gone.length) return;
  console.log(`${String(cut).padEnd(7)} ${fmt(gone)}  │ ${fmt(keep)}`);
});
console.log('\n■ 지워지는 표본의 §2 반쪽 (하한별)');
console.log('─'.repeat(104));
[...new Set([0,...cuts])].forEach(cut => {
  const gone = tgt.filter(x => x.buy < cut);
  if(gone.length < 8) return;
  console.log(`${String(cut).padEnd(7)} 전반 ${fmt(gone.filter(x=>x.d<mid))}`);
  console.log(`${' '.repeat(7)} 후반 ${fmt(gone.filter(x=>x.d>=mid))}`);
});
