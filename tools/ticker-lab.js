#!/usr/bin/env node
/**
 * 종목별 개별 산식 탐색 — 한 종목 안에서 "언제 사면 나았나"를 찾는다 (읽기 전용)
 *
 * 왜 따로 만들었나 (2026-09-04 사용자 지시 "포엣 인텔 애플 각 종목별로 더 승률 높은
 * 개별산식 만들어, 표본은 5개만 넘어도 되니까 표기하면 되지"):
 *   v13-lab의 U 섹션은 '그 종목의 강한매수'만 건드려서 표본이 4~7건에서 멈춘다.
 *   여기서는 등급을 거치지 않고 그 종목의 189일 전부를 훑어 진입 규칙 자체를 찾는다.
 *   같은 종목의 '아무 날이나'를 기준선으로 쓰므로 종목 성격(추세주/역추세주)이 상쇄된다.
 *
 * 산식은 재구현하지 않는다(§0) — 점수·등급은 index.html의 evaluate()에서 그대로 받아 쓰고,
 * 규칙은 그 출력값과 원장 지표(RSI·볼밴·거래량비·rs20·이격도…)의 조합으로만 만든다.
 *
 * 표기 원칙: 승률만 적지 않는다. **표본 수와 윌슨 95% 신뢰구간을 항상 같이 찍는다**(§5-10).
 *   10건 7승은 70%가 아니라 "70% [40~89]"다. 사용자가 그 폭을 보고 판단한다.
 *
 * 사용: node tools/ticker-lab.js [backtest/raw.json] [--tickers=POET,INTC,AAPL] [--min=5]
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv.find(a => !a.startsWith('--') && a.endsWith('.json')) || 'backtest/raw.json';
if (!fs.existsSync(IN)) { console.error(`[ERROR] ${IN} 없음`); process.exit(1); }
const arg = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : null; };
const TK = (arg('tickers') || 'POET,INTC,AAPL').split(',').map(s => s.trim()).filter(Boolean);
const MIN = Number(arg('min') || 5);
const HZ = [1, 3, 5, 7];

const RAW = fs.readFileSync(IN, 'utf8');
const ctx = H.loadPage({});
ctx.runInPage(`state.data = normalize(${RAW});`);
const WANT = JSON.stringify(TK);
const rows = JSON.parse(ctx.runInPage(`(()=>{
  const want = new Set(${WANT}), out = [];
  allStocks().forEach(s => {
    if (!want.has(s.ticker)) return;
    const hs = histStocks(s) || [];
    hs.forEach((h, i) => {
      if (!h.last_date || !has(h.price) || !h.price) return;
      const row = Object.assign({}, s, h);
      if (i > 0) withPrev(row, hs[i-1]);
      const e = evaluate(row);
      const fwd = {};
      [1,3,5,7].forEach(k => { const q = hs[i+k]; fwd[k] = (q && has(q.price)) ? (q.price/h.price - 1)*100 : null; });
      out.push({ tk:s.ticker, d:h.last_date, g:e.grade, pg:e.pullGrade, rg:e.revGrade,
        ps:e.pullScore, rv:e.revScore, rsi:row.rsi, bb:row.bb_pos, vr:row.vol_ratio, rs20:row.rs20,
        price:row.price, ma20:row.ma20, ma60:row.ma60, ma200:row.ma200, ret20:row.ret20,
        atr:row.atr_pct, lvl:row.market_level, vxn:row.market_vxn, pfh:row.pct_from_high,
        c1:row.change_1d, fwd });
    });
  });
  return JSON.stringify(out);
})()`));

const has = v => v != null && !Number.isNaN(Number(v));
/* 윌슨 95% 신뢰구간 — 작은 표본에서 '70%'가 실제로 얼마나 넓은지 (§5-10) */
function wilson(w, n) {
  if (!n) return null;
  const z = 1.96, p = w / n, d = 1 + z*z/n;
  const c = (p + z*z/(2*n)) / d, h = z * Math.sqrt(p*(1-p)/n + z*z/(4*n*n)) / d;
  return [Math.round(Math.max(0, c-h)*100), Math.round(Math.min(1, c+h)*100)];
}
function stat(list, h) {
  const a = list.map(x => x.fwd[h]).filter(v => v != null);
  const w = a.filter(v => v > 1).length, l = a.filter(v => v < -1).length, n = w + l;
  return { n: a.length, wl: n, rate: n ? Math.round(w/n*100) : null, ci: wilson(w, n),
           avg: a.length ? a.reduce((p, c) => p + c, 0)/a.length : null };
}

/* 후보 규칙 — 그 종목의 어느 날 사면 나았나. 등급을 거치지 않는다. */
const R = [
  ['A0 아무 날이나 (그 종목 기준선)', () => true],
  ['A1 RSI ≤ 35',                    x => has(x.rsi) && x.rsi <= 35],
  ['A2 RSI ≤ 45',                    x => has(x.rsi) && x.rsi <= 45],
  ['A3 RSI ≥ 60',                    x => has(x.rsi) && x.rsi >= 60],
  ['A4 볼밴 ≤ 25 (하단)',             x => has(x.bb) && x.bb <= 25],
  ['A5 볼밴 ≤ 50',                    x => has(x.bb) && x.bb <= 50],
  ['A6 볼밴 ≥ 75 (상단·모멘텀)',       x => has(x.bb) && x.bb >= 75],
  ['A7 20일선 위',                    x => has(x.price) && has(x.ma20) && x.price > x.ma20],
  ['A8 20일선 아래',                  x => has(x.price) && has(x.ma20) && x.price < x.ma20],
  ['A9 60일선 위',                    x => has(x.price) && has(x.ma60) && x.price > x.ma60],
  ['A10 시장보다 강함 rs20>0',         x => has(x.rs20) && x.rs20 > 0],
  ['A11 시장보다 약함 rs20<0',         x => has(x.rs20) && x.rs20 < 0],
  ['A12 거래량 1.5배 이상',            x => has(x.vr) && x.vr >= 1.5],
  ['A13 거래량 0.8배 이하 (조용)',      x => has(x.vr) && x.vr <= 0.8],
  ['A14 전일 −3% 이하 (급락 다음날)',   x => has(x.c1) && x.c1 <= -3],
  ['A15 전일 +3% 이상 (급등 다음날)',   x => has(x.c1) && x.c1 >= 3],
  ['A16 52주고점 −10% 이내',           x => has(x.pfh) && x.pfh >= -10],
  ['A17 52주고점 −30% 밖',             x => has(x.pfh) && x.pfh < -30],
  ['A18 20일 수익률 ≤ −10%',           x => has(x.ret20) && x.ret20 <= -10],
  ['A19 20일 수익률 ≥ +10%',           x => has(x.ret20) && x.ret20 >= 10],
  ['A20 VXN ≥ 25 (공포)',              x => has(x.vxn) && x.vxn >= 25],
  ['A21 국면 strong·neutral',          x => x.lvl === 'strong' || x.lvl === 'neutral'],
  ['A22 국면 weak·caution',            x => x.lvl === 'weak' || x.lvl === 'caution'],
  /* 지금 산식이 그 종목에 주는 등급 — 비교용 */
  ['B1 현행 강한매수(등급5)',           x => x.g === 5],
  ['B2 현행 매수관심(등급4)',           x => x.g === 4],
  ['B3 현행 추세 점수 ≥ 1.5',           x => has(x.ps) && x.ps >= 1.5],
  ['B4 현행 반등 점수 ≥ 2.0',           x => has(x.rv) && x.rv >= 2.0],
  /* 겹침 — 위에서 잘 나온 축을 둘씩 묶는다 */
  ['C1 RSI≤45 & 볼밴≤50',              x => has(x.rsi) && x.rsi <= 45 && has(x.bb) && x.bb <= 50],
  ['C2 RSI≤45 & 20일선 위',            x => has(x.rsi) && x.rsi <= 45 && has(x.price) && has(x.ma20) && x.price > x.ma20],
  ['C3 볼밴≤50 & rs20>0',              x => has(x.bb) && x.bb <= 50 && has(x.rs20) && x.rs20 > 0],
  ['C4 볼밴≤50 & 거래량 1.5배',         x => has(x.bb) && x.bb <= 50 && has(x.vr) && x.vr >= 1.5],
  ['C5 급락 다음날 & 20일선 위',         x => has(x.c1) && x.c1 <= -3 && has(x.price) && has(x.ma20) && x.price > x.ma20],
];

console.log(`■ 종목별 개별 산식 탐색 · ${IN} · 대상 ${TK.join(' · ')} · 표본 ${MIN}건 이상만 표기`);
console.log(`  칸 = 승률(표본) · 아랫줄 = 윌슨 95% 신뢰구간. 구간이 그 종목 기준선을 품으면 '구별 안 됨'이다.`);

for (const tk of TK) {
  const all = rows.filter(x => x.tk === tk).sort((a, b) => a.d < b.d ? -1 : 1);
  if (!all.length) { console.log(`\n[${tk}] 원장에 행이 없다`); continue; }
  const mid = all[Math.floor(all.length/2)].d;
  const base = HZ.map(h => stat(all, h));
  console.log(`\n══ ${tk} · ${all.length}거래일 (${all[0].d} ~ ${all[all.length-1].d}) · 반쪽 ${mid}`);
  console.log(`   ${'규칙'.padEnd(26)}` + HZ.map(h => `+${h}일`.padStart(15)).join('') + '   전반/후반(+5)');
  for (const [nm, f] of R) {
    const sel = all.filter(f);
    const cells = HZ.map((h, i) => {
      const s = stat(sel, h);
      if (s.rate == null || s.wl < MIN) return `  —(${String(s.n).padStart(3)})     `.padEnd(15);
      const b = base[i];
      const d = (b.rate != null) ? `${s.rate - b.rate >= 0 ? '+' : ''}${s.rate - b.rate}p` : '';
      return `${String(s.rate).padStart(3)}%(${String(s.wl).padStart(3)})${d.padStart(5)}`.padEnd(15);
    });
    const anyShown = HZ.some((h, i) => { const s = stat(sel, h); return s.rate != null && s.wl >= MIN; });
    if (!anyShown) continue;
    const a = sel.filter(x => x.d < mid), b = sel.filter(x => x.d >= mid);
    const sa = stat(a, 5), sb = stat(b, 5);
    console.log(`   ${nm.padEnd(26)}${cells.join('')}   ${sa.rate == null ? '—' : sa.rate + '%(' + sa.wl + ')'}/${sb.rate == null ? '—' : sb.rate + '%(' + sb.wl + ')'}`);
    const ci = HZ.map(h => { const s = stat(sel, h); return (s.ci && s.wl >= MIN ? `[${s.ci[0]}~${s.ci[1]}]` : '').padEnd(15); });
    console.log(`   ${'  ↳ 95% 구간'.padEnd(26)}${ci.join('')}`);
  }
}
console.log(`\n※ 후보 ${R.length - 1}종 × 종목 ${TK.length}개 = ${(R.length - 1) * TK.length}번의 비교다(다중비교).`);
console.log(`  표본 ${MIN}건짜리 규칙은 우연히 좋아 보이기 쉽다 — 채택하려면 ① 신뢰구간 하한이 그 종목 기준선 위`);
console.log(`  ② 전·후반 둘 다 같은 방향 ③ 이웃값(문턱 ±)도 같은 방향, 셋을 다 봐야 한다.`);
console.log(`  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.`);
