#!/usr/bin/env node
/**
 * PRIVATE 지수(QQQ·SPY) 자체 예측 탐색 (읽기 전용, 시험만)
 *
 * 목표: "QQQ가 앞으로 오를지"를 65% 이상 맞히는 규칙이 있는가.
 * 종목 신호와 완전히 별개다 — 여기서 맞히는 대상은 지수 자신의 종가다.
 *
 * ⚠ 표본 한계를 먼저 밝힌다: QQQ hist는 30거래일이라 어떤 규칙도 최대 n=30이고,
 *   조건을 걸면 n이 한 자릿수로 떨어진다. docs/승률-검증-방법론.md §5-1 기준
 *   (15건 미만 신뢰 불가)을 넘는 규칙만 '후보'로 부른다.
 *   또한 여러 조건을 훑어보고 이긴 것을 고르는 것 자체가 다중비교 함정이라,
 *   여기서 이긴 규칙도 다음 사이클 재현 전에는 적용하지 않는다.
 *
 * 사용: 저장소 루트에서 `node tools/index-predict.js`
 */
const fs = require('fs');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const F = base.hist_fields;
const I = {}; F.forEach((k,i)=>I[k]=i);

function loadCard(card){
  if(!card || !Array.isArray(card.hist)) return [];
  return card.hist.map(r=>{
    const o={}; F.forEach((k,i)=>o[k]=r[i]); return o;
  }).filter(x=>x.date && x.price);
}
const Q = loadCard(base.qqq_card);
const S = loadCard(base.spy_card);
const spyBy = {}; S.forEach(r=>spyBy[String(r.date)]=r);

/* 미래 수익 — 지수 자신의 종가 기준 */
function fwd(rows, i, h){
  return (i+h < rows.length && rows[i+h].price) ? (rows[i+h].price/rows[i].price-1)*100 : null;
}
/* 지수는 개별종목보다 변동이 작으므로 보합밴드를 ±0.5%로 둔다.
   (종목 검증의 ±1%를 그대로 쓰면 지수는 절반이 보합으로 빠진다) */
const FLAT = Number(process.env.FLAT ?? 0.5);
const stat = a => {
  const v = a.filter(x=>x!==null);
  const w = v.filter(x=>x>FLAT).length, l = v.filter(x=>x<-FLAT).length;
  return {n:v.length, dir:w+l, rate:(w+l)?Math.round(w/(w+l)*100):null,
          avg:v.length? v.reduce((z,x)=>z+x,0)/v.length : null, w, l};
};
const fmt = s => s.rate===null ? '   —        ' :
  `${String(s.rate).padStart(3)}%(${String(s.dir).padStart(2)}승패/${String(s.n).padStart(2)}일) ${s.avg>=0?'+':''}${s.avg.toFixed(2)}%`;

console.log(`QQQ ${Q.length}거래일 · SPY ${S.length}거래일 · 보합밴드 ±${FLAT}%`);
console.log('승률 = 상승 ÷ (상승+하락) · (승패/일) = 방향이 난 일수 / 조건 충족 일수\n');

/* ── 0. 무조건 매수 = 지수 기준선 ── */
console.log('■ 0. 기준선 — QQQ를 아무 날이나 산다면');
const BL = {};
for(const h of [1,3,5]){ BL[h] = stat(Q.map((_,i)=>fwd(Q,i,h))); }
console.log(`  +1일 ${fmt(BL[1])}   +3일 ${fmt(BL[3])}   +5일 ${fmt(BL[5])}\n`);

/* ── 1. 단일 조건 스캔 ── */
const COND = [
  ['RSI <= 35',              r=>r.rsi!=null && r.rsi<=35],
  ['RSI <= 40',              r=>r.rsi!=null && r.rsi<=40],
  ['RSI <= 45',              r=>r.rsi!=null && r.rsi<=45],
  ['RSI >= 60',              r=>r.rsi!=null && r.rsi>=60],
  ['볼린저 <= 5',            r=>r.bb_pos!=null && r.bb_pos<=5],
  ['볼린저 <= 25',           r=>r.bb_pos!=null && r.bb_pos<=25],
  ['볼린저 >= 75',           r=>r.bb_pos!=null && r.bb_pos>=75],
  ['ret20 <= -5',            r=>r.ret20!=null && r.ret20<=-5],
  ['ret20 <= -3',            r=>r.ret20!=null && r.ret20<=-3],
  ['ret20 >= 0',             r=>r.ret20!=null && r.ret20>=0],
  ['MA20 기울기 <= -1',      r=>r.ma20_slope!=null && r.ma20_slope<=-1],
  ['MA20 기울기 >= 0',       r=>r.ma20_slope!=null && r.ma20_slope>=0],
  ['가격 < MA20',            r=>r.price!=null && r.ma20!=null && r.price<r.ma20],
  ['가격 > MA20',            r=>r.price!=null && r.ma20!=null && r.price>r.ma20],
  ['3일누적 <= -3',          r=>r.run3_sum!=null && r.run3_sum<=-3],
  ['3일누적 >= 3',           r=>r.run3_sum!=null && r.run3_sum>=3],
  ['당일 하락',              r=>r.change_1d!=null && r.change_1d<0],
  ['당일 상승',              r=>r.change_1d!=null && r.change_1d>0],
  ['MACD 히스토 < 0',        r=>r.macd_hist!=null && r.macd_hist<0],
  ['스토캐스틱 K <= 20',     r=>r.stoch_k!=null && r.stoch_k<=20],
  ['고점대비 <= -5%',        r=>r.pct_from_high!=null && r.pct_from_high<=-5],
  /* 조합 — 단일 조건으로 안 되니 두 축을 겹쳐 본다 */
  ['MA20아래 + RSI<=45',     r=>r.price<r.ma20 && r.rsi!=null && r.rsi<=45],
  ['MA20아래 + 볼린저<=25',  r=>r.price<r.ma20 && r.bb_pos!=null && r.bb_pos<=25],
  ['MA20아래 + 당일하락',    r=>r.price<r.ma20 && r.change_1d!=null && r.change_1d<0],
  ['MA20위 + MACD>0',        r=>r.price>r.ma20 && r.macd_hist!=null && r.macd_hist>0],
  ['MA20위 + 기울기>=0',     r=>r.price>r.ma20 && r.ma20_slope!=null && r.ma20_slope>=0],
  ['ret20<0 + 당일하락',     r=>r.ret20!=null && r.ret20<0 && r.change_1d!=null && r.change_1d<0],
  ['ret20<0 + RSI<=50',      r=>r.ret20!=null && r.ret20<0 && r.rsi!=null && r.rsi<=50],
  ['기울기<0 + 볼린저<=40',  r=>r.ma20_slope!=null && r.ma20_slope<0 && r.bb_pos!=null && r.bb_pos<=40],
  ['3일누적<=0',             r=>r.run3_sum!=null && r.run3_sum<=0],
  ['3일누적<=0 + RSI<=50',   r=>r.run3_sum!=null && r.run3_sum<=0 && r.rsi!=null && r.rsi<=50],
];
function scan(rows, label, conds){
  console.log(`■ ${label}`);
  console.log(`  ${'조건'.padEnd(20)} ${'+1일'.padEnd(26)}${'+3일'.padEnd(26)}+5일`);
  const out=[];
  for(const [name,pred] of conds){
    const idx = rows.map((r,i)=>[r,i]).filter(([r])=>pred(r)).map(([,i])=>i);
    if(!idx.length) continue;
    const cols = [1,3,5].map(h=>stat(idx.map(i=>fwd(rows,i,h))));
    out.push({name, idx, cols});
    console.log(`  ${name.padEnd(20)} ${fmt(cols[0]).padEnd(26)}${fmt(cols[1]).padEnd(26)}${fmt(cols[2])}`);
  }
  console.log('');
  return out;
}
const qres = scan(Q, '1. QQQ 단일 조건 → QQQ 미래', COND);
if(S.length) scan(S, '2. SPY 단일 조건 → SPY 미래', COND);

/* ── 3. QQQ + SPY 동조/괴리 ── */
if(S.length){
  console.log('■ 3. QQQ·SPY 조합 — 두 지수가 같이 말할 때');
  const pair = [
    ['둘 다 RSI<=45',        (q,s)=>q.rsi<=45 && s && s.rsi<=45],
    ['둘 다 RSI>=55',        (q,s)=>q.rsi<=100 && q.rsi>=55 && s && s.rsi>=55],
    ['둘 다 MA20 위',        (q,s)=>q.price>q.ma20 && s && s.price>s.ma20],
    ['둘 다 MA20 아래',      (q,s)=>q.price<q.ma20 && s && s.price<s.ma20],
    ['괴리: QQQ<MA20 & SPY>MA20', (q,s)=>q.price<q.ma20 && s && s.price>s.ma20],
    ['괴리: QQQ>MA20 & SPY<MA20', (q,s)=>q.price>q.ma20 && s && s.price<s.ma20],
    ['둘 다 볼린저<=25',     (q,s)=>q.bb_pos!=null&&q.bb_pos<=25 && s && s.bb_pos!=null&&s.bb_pos<=25],
    ['둘 다 ret20<0',        (q,s)=>q.ret20!=null&&q.ret20<0 && s && s.ret20!=null&&s.ret20<0],
  ];
  console.log(`  ${'조건'.padEnd(28)} ${'+1일'.padEnd(26)}${'+3일'.padEnd(26)}+5일`);
  for(const [name,pred] of pair){
    const idx = Q.map((r,i)=>[r,i]).filter(([r])=>{
      const s = spyBy[String(r.date)];
      try { return pred(r, s); } catch(e){ return false; }
    }).map(([,i])=>i);
    if(!idx.length) continue;
    const cols=[1,3,5].map(h=>stat(idx.map(i=>fwd(Q,i,h))));
    console.log(`  ${name.padEnd(28)} ${fmt(cols[0]).padEnd(26)}${fmt(cols[1]).padEnd(26)}${fmt(cols[2])}`);
  }
  console.log('');
}

/* ── 4. 판정: §5-1 기준을 넘으면서 65%+ 인 것만 ── */
const THRESH_R = Number(process.env.THRESH_R || 65);
const THRESH_N = Number(process.env.THRESH_N || 15);
console.log(`■ 4. 판정 — 표본 ${THRESH_N}일 이상 & 승률 ${THRESH_R}% 이상`);
let found=0;
for(const {name, cols} of qres){
  [1,3,5].forEach((h,k)=>{
    const c=cols[k];
    if(c.dir>=THRESH_N && c.rate!==null && c.rate>=THRESH_R){
      console.log(`  ✔ QQQ ${name} → +${h}일 ${c.rate}% (승패 ${c.dir}건, 평균 ${c.avg.toFixed(2)}%)`);
      found++;
    }
  });
}
if(!found){
  console.log(`  없음. 표본 ${THRESH_N}건 이상이면서 ${THRESH_R}%를 넘는 지수 예측 규칙이 이 창에는 존재하지 않는다.`);
  const best = [];
  qres.forEach(({name,cols})=>[1,3,5].forEach((h,k)=>{
    if(cols[k].rate!==null && cols[k].dir>=8) best.push({name,h,...cols[k]});
  }));
  best.sort((a,b)=>b.rate-a.rate);
  console.log('\n  참고 — 표본 8건 이상 중 승률 상위 5개 (신뢰 불가, 관찰용):');
  best.slice(0,5).forEach(b=>console.log(`    ${b.name} +${b.h}일 ${b.rate}% (승패 ${b.dir}건, 평균 ${b.avg.toFixed(2)}%)`));
}
