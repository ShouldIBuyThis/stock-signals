#!/usr/bin/env node
/**
 * 나스닥 전용 등급 후보 전수 스윕 — 188거래일 백테스트 (읽기 전용)
 *
 * 계기(사용자 지시 2026-08-19): QQQ는 랭킹 유니버스 밖이라 다중·강한다중이
 * 구조적으로 0회고, 강한매수도 40%대다. 개별주 산식은 지수에 안 맞는다(§5-2).
 * 그래서 지수 전용 재료(VXN·breadth·과매도·급락 반응·SPY 대비)로
 * "나스닥 한정 등급"이 될 규칙을 찾는다. 표본 5+ 필수(사용자 기준),
 * §5-1 등급(15+ 참고 / 50+ 신뢰)을 같이 적는다.
 *
 * 판정: 기준선 대비 %p → §2 반쪽 양쪽 같은 방향 → 이웃 값 고원.
 * SPY 대비 축은 macro.spy가 쌓인 뒤에만 계산된다(없으면 건너뜀).
 *
 * 사용: node tools/qqq-grade-lab.js
 */
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('backtest/ticker-record-samples.json', 'utf8'));
const Q = (d.qqq || []).filter(x => x.d && x.chg !== null && x.chg !== undefined);
const B = {}; (d.breadth || []).forEach(x => B[x.d] = x.pct);
const M = d.macro || {};
if(!Q.length){ console.error('QQQ 시계열 없음'); process.exit(1); }

const fwd = (i,k) => { const a=[]; for(let j=1;j<=k;j++){ const r=Q[i+j]; if(!r) return null; a.push(r.chg); }
  return a.reduce((p,c)=>p+c,0); };
const rows = Q.map((x,i)=>({ ...x, i, f1:fwd(i,1), f3:fwd(i,3),
  vxn:M.vxn?M.vxn[x.d]:null, spy:M.spy?M.spy[x.d]:null, br:B[x.d]??null }))
  .map((x,i,arr)=>({ ...x,
    vxnPrev:i>0?arr[i-1].vxn:null, spyPrev:i>0?arr[i-1].spy:null,
    chgPrev:i>0?arr[i-1].chg:null, rsiPrev:i>0?arr[i-1].rsi:null }));
// SPY는 종가 시계열일 수 있으므로 당일 등락률로 변환
rows.forEach(r=>{ r.spyChg = (r.spy!=null && r.spyPrev!=null && r.spyPrev>0)
  ? (r.spy/r.spyPrev-1)*100 : null; });

const mid = rows[Math.floor(rows.length/2)].d;
const up = a => a.length?Math.round(a.filter(v=>v>0).length/a.length*100):null;
const avg = a => a.length?a.reduce((p,c)=>p+c,0)/a.length:null;
const stat = sel => {
  const a1=sel.map(r=>r.f1).filter(v=>v!==null), a3=sel.map(r=>r.f3).filter(v=>v!==null);
  return {n:a1.length, u1:up(a1), u3:up(a3), m1:avg(a1), m3:avg(a3)};
};
const base = stat(rows);
console.log(`기준선(전 거래일 매수): n=${base.n} 다음날 ${base.u1}%·평균 ${base.m1.toFixed(2)}% / +3일 ${base.u3}%·평균 ${base.m3.toFixed(2)}%`);
console.log(`전·후반 분기: ${mid} · SPY 축: ${M.spy?'있음':'없음(다음 백테스트부터)'}\n`);

const has=v=>v!==null&&v!==undefined;
const C = [
  // ── 매수 우위 후보 ──
  ['VXN>=28 & 꺾임',        r=>has(r.vxn)&&has(r.vxnPrev)&&r.vxn>=28&&r.vxn<r.vxnPrev],
  ['VXN>=28',               r=>has(r.vxn)&&r.vxn>=28],
  ['VXN>=26',               r=>has(r.vxn)&&r.vxn>=26],
  ['VXN>=30',               r=>has(r.vxn)&&r.vxn>=30],
  ['breadth<30%',           r=>has(r.br)&&r.br<30],
  ['breadth<35%',           r=>has(r.br)&&r.br<35],
  ['breadth<40%',           r=>has(r.br)&&r.br<40],
  ['RSI<=35',               r=>has(r.rsi)&&r.rsi<=35],
  ['RSI<=40 & 당일하락',    r=>has(r.rsi)&&r.rsi<=40&&r.chg<0],
  ['볼린저<=10',            r=>has(r.bb)&&r.bb<=10],
  ['볼린저<=5',             r=>has(r.bb)&&r.bb<=5],
  ['당일 -1.5% 이상 급락',  r=>r.chg<=-1.5],
  ['당일 -2% 이상 급락',    r=>r.chg<=-2],
  ['2연속 하락 & VXN 상승', r=>r.chg<0&&has(r.chgPrev)&&r.chgPrev<0&&has(r.vxn)&&has(r.vxnPrev)&&r.vxn>r.vxnPrev],
  ['VXN 급등 15%+ 다음날',  r=>has(r.vxn)&&has(r.vxnPrev)&&r.vxnPrev>0&&r.vxn/r.vxnPrev>=1.15],
  // 합집합(표본 키우기) — 재료는 위에서 검증된 것만 조합
  ['합집합: 꺾임|바닥권',   r=>(has(r.vxn)&&has(r.vxnPrev)&&r.vxn>=28&&r.vxn<r.vxnPrev)||(has(r.br)&&r.br<30)],
  ['합집합: 꺾임|바닥권|RSI35', r=>(has(r.vxn)&&has(r.vxnPrev)&&r.vxn>=28&&r.vxn<r.vxnPrev)||(has(r.br)&&r.br<30)||(has(r.rsi)&&r.rsi<=35)],
  ['합집합: VXN28|바닥권',  r=>(has(r.vxn)&&r.vxn>=28)||(has(r.br)&&r.br<30)],
  // SPY 대비 (macro.spy 있어야 계산)
  ['SPY보다 약세 & 당일하락', r=>has(r.spyChg)&&r.chg<r.spyChg&&r.chg<0],
  // ── 관망(역방향) 후보 — 기준선보다 낮아야 신호 구실 ──
  ['[관망] RSI>=70',        r=>has(r.rsi)&&r.rsi>=70],
  ['[관망] 볼린저>=95',     r=>has(r.bb)&&r.bb>=95],
  ['[관망] VXN<16 & 3일+3%',r=>has(r.vxn)&&r.vxn<16&&has(r.chgPrev)&&(r.chg+r.chgPrev)>=2],
];

for(const [label, pred] of C){
  const sel = rows.filter(pred);
  const s = stat(sel);
  if(!s.n){ console.log(`■ ${label.padEnd(24)} 표본 없음 (SPY 축이면 정상)`); continue; }
  const A = stat(rows.filter(r=>r.d<mid).filter(pred));
  const Z = stat(rows.filter(r=>r.d>=mid).filter(pred));
  const tier = s.n>=50?'신뢰':s.n>=15?'참고':s.n>=5?'일화+':'무효';
  console.log(`■ ${label.padEnd(24)} n=${String(s.n).padStart(3)} [${tier}]  `+
    `다음날 ${s.u1}%(${s.u1-base.u1>=0?'+':''}${s.u1-base.u1}%p)·${s.m1.toFixed(2)}%  `+
    `+3일 ${s.u3}%(${s.u3-base.u3>=0?'+':''}${s.u3-base.u3}%p)·${s.m3.toFixed(2)}%`);
  console.log(`   §2 전반 n=${A.n} ${A.u1===null?'—':A.u1+'%/'+A.u3+'%'} · 후반 n=${Z.n} ${Z.u1===null?'—':Z.u1+'%/'+Z.u3+'%'}`);
}
console.log('\n※ 채택 기준: 기준선 대비 +, §2 양쪽 같은 방향, 표본 5+(사용자)·15+(§5-1 참고).');
console.log('  관망 후보는 반대로 기준선보다 낮아야 신호다. 채택해도 표시 전용 — 산식·랭킹 불변.');
