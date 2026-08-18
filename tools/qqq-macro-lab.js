#!/usr/bin/env node
/**
 * 나스닥(QQQ) 예측 축 검증 — 188거래일 백테스트 표본 (읽기 전용)
 *
 * 사용자가 제시한 네 축을 잰다.
 *   ① NQ 선물 · NQ/QQQ 괴리   ② VXN 피크아웃   ③ breadth 괴리   ④ 10년물 금리 급등
 *
 * 판정은 방법론 그대로다 — 기준선 대비 몇 %p인지, §2 반쪽 양쪽에서 같은 방향인지,
 * 표본이 몇 건인지(§5-1). 하나라도 어긋나면 채택하지 않는다.
 *
 * ⚠ 백테스트다. 절대 수준이 아니라 '기준선과의 차이'만 본다.
 *
 * 사용: node tools/qqq-macro-lab.js
 */
const fs = require('fs');
const F = 'backtest/ticker-record-samples.json';
const d = JSON.parse(fs.readFileSync(F, 'utf8'));
const Q = (d.qqq || []).filter(x => x.d && x.chg !== null && x.chg !== undefined);
const B = {}; (d.breadth || []).forEach(x => B[x.d] = x.pct);
const M = d.macro || {};
if(!Q.length){ console.error('QQQ 시계열 없음 — 백테스트를 다시 돌릴 것'); process.exit(1); }

const idx = {}; Q.forEach((x,i) => idx[x.d] = i);
const fwd = (i,k) => { const a=[]; for(let j=1;j<=k;j++){ const r=Q[i+j]; if(!r) return null; a.push(r.chg); }
  return a.reduce((p,c)=>p+c,0); };   // 누적 등락률(근사)
const up = a => a.length ? Math.round(a.filter(x=>x>0).length/a.length*100) : null;
const avg = a => a.length ? (a.reduce((p,c)=>p+c,0)/a.length) : null;

const rows = Q.map((x,i) => ({
  ...x, i,
  f1: fwd(i,1), f3: fwd(i,3),
  vxn: M.vxn ? M.vxn[x.d] : null, tnx: M.tnx ? M.tnx[x.d] : null,
  nq: M.nq ? M.nq[x.d] : null, br: B[x.d] ?? null,
})).map((x,i,arr) => ({ ...x,
  vxnPrev: i>0 ? arr[i-1].vxn : null, tnxPrev: i>0 ? arr[i-1].tnx : null,
  brPrev:  i>0 ? arr[i-1].br  : null, nqPrev: i>0 ? arr[i-1].nq : null }));

const days = rows.map(r=>r.d); const mid = days[Math.floor(days.length/2)];
function show(label, sel, base){
  const a1 = sel.map(r=>r.f1).filter(v=>v!==null), a3 = sel.map(r=>r.f3).filter(v=>v!==null);
  if(!a1.length){ console.log(`  ${label.padEnd(28)} 표본 없음`); return null; }
  const e1 = base ? up(a1)-base.u1 : 0, e3 = base ? up(a3)-base.u3 : 0;
  console.log(`  ${label.padEnd(28)} n=${String(a1.length).padStart(3)}  +1일 ${String(up(a1)).padStart(3)}%${base?` (${e1>=0?'+':''}${e1}%p)`:''} 평균 ${avg(a1).toFixed(2)}%  ` +
              `+3일 ${String(up(a3)).padStart(3)}%${base?` (${e3>=0?'+':''}${e3}%p)`:''} 평균 ${avg(a3).toFixed(2)}%`);
  return {u1:up(a1), u3:up(a3), n:a1.length};
}
function half(label, pred){
  const A = rows.filter(r=>r.d<mid && pred(r)), Z = rows.filter(r=>r.d>=mid && pred(r));
  if(A.length<4 && Z.length<4) return;
  console.log(`    §2 ${label}`);
  show('     전반', A); show('     후반', Z);
}

console.log(`QQQ ${Q.length}거래일 (${Q[0].d} ~ ${Q[Q.length-1].d}) · breadth ${Object.keys(B).length}일`);
console.log(`거시: ${Object.entries(M).map(([k,v])=>`${k} ${Object.keys(v).length}일`).join(' · ')}\n`);
const base = show('기준선 (전체)', rows);

console.log('\n■ ② VXN 피크아웃 — 고변동에서 꺾이면 반등하는가');
if(M.vxn){
  [25,28,30].forEach(t=>{
    show(`VXN≥${t} 이면서 전일보다 하락`, rows.filter(r=>r.vxn!==null&&r.vxnPrev!==null&&r.vxn>=t&&r.vxn<r.vxnPrev), base);
    show(`VXN≥${t} (꺾임 무관)`, rows.filter(r=>r.vxn!==null&&r.vxn>=t), base);
  });
  half('VXN≥28 & 꺾임', r=>r.vxn!==null&&r.vxnPrev!==null&&r.vxn>=28&&r.vxn<r.vxnPrev);
} else console.log('  VXN 데이터 없음');

console.log('\n■ ③ breadth 괴리 — QQQ는 오르는데 20일선 위 비율이 줄면');
[0,-1,-3].forEach(t=>{
  show(`QQQ 상승 & breadth 변화 ≤ ${t}%p`, rows.filter(r=>r.chg>0&&r.br!==null&&r.brPrev!==null&&(r.br-r.brPrev)<=t), base);
});
show('QQQ 상승 & breadth 증가', rows.filter(r=>r.chg>0&&r.br!==null&&r.brPrev!==null&&(r.br-r.brPrev)>0), base);
show('breadth 30% 미만 (바닥권)', rows.filter(r=>r.br!==null&&r.br<30), base);
half('QQQ상승 & breadth 감소', r=>r.chg>0&&r.br!==null&&r.brPrev!==null&&(r.br-r.brPrev)<=0);

console.log('\n■ ④ 10년물 금리 급등');
/* ^TNX가 짧으면 같은 금리를 보는 대체 티커 중 가장 긴 것을 쓴다.
   IEF·TLT는 채권 가격이라 금리와 반대로 움직인다 — 부호를 뒤집어 맞춘다. */
const RATE = [["tnx",1,"^TNX 금리"],["zn",-1,"ZN=F 선물(역)"],["ief",-1,"IEF(역)"],["tlt",-1,"TLT(역)"]]
  .filter(([k])=>M[k]).sort((a,b)=>Object.keys(M[b[0]]).length-Object.keys(M[a[0]]).length)[0];
if(RATE){
  const [key, sign, label] = RATE;
  console.log(`  사용 지표: ${label} (${Object.keys(M[key]).length}일)`);
  const R2 = rows.map((r,i,arr)=>({...r, rv:M[key][r.d]??null, rvPrev:i>0?(M[key][arr[i-1].d]??null):null}));
  const chg = r => (r.rv!==null&&r.rvPrev!==null&&r.rvPrev) ? sign*((r.rv/r.rvPrev-1)*100) : null;
  [0.3,0.6,1.0].forEach(t=>{
    show(`금리 전일 대비 +${t}% 이상 급등`, R2.filter(r=>{const c=chg(r);return c!==null&&c>=t;}), base);
  });
  show('금리 하락일', R2.filter(r=>{const c=chg(r);return c!==null&&c<0;}), base);
  const A=R2.filter(r=>r.d<mid&&(chg(r)??-9)>=0.6), Z=R2.filter(r=>r.d>=mid&&(chg(r)??-9)>=0.6);
  if(A.length>=4||Z.length>=4){ console.log('    §2 금리 +0.6% 이상'); show('     전반',A); show('     후반',Z); }
}
if(M.tnx && false){
  [0.05,0.08,0.12].forEach(t=>{
    show(`TNX 전일 대비 +${t} 이상`, rows.filter(r=>r.tnx!==null&&r.tnxPrev!==null&&(r.tnx-r.tnxPrev)>=t), base);
  });
  show('TNX 하락일', rows.filter(r=>r.tnx!==null&&r.tnxPrev!==null&&(r.tnx-r.tnxPrev)<0), base);
  half('TNX +0.08 이상', r=>r.tnx!==null&&r.tnxPrev!==null&&(r.tnx-r.tnxPrev)>=0.08);
} else console.log('  TNX 데이터 없음');

console.log('\n■ ① NQ 선물 / QQQ 괴리');
if(M.nq){
  const gap = r => (r.nq!==null&&r.nqPrev!==null) ? ((r.nq/r.nqPrev-1)*100 - r.chg) : null;
  [0.3,0.5].forEach(t=>{
    show(`선물이 QQQ보다 +${t}%p 이상 강함`, rows.filter(r=>{const g=gap(r);return g!==null&&g>=t;}), base);
    show(`선물이 QQQ보다 -${t}%p 이상 약함`, rows.filter(r=>{const g=gap(r);return g!==null&&g<=-t;}), base);
  });
} else console.log('  NQ 데이터 없음');
