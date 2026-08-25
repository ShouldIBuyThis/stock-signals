#!/usr/bin/env node
/**
 * 나스닥 전용 등급의 재료를 개별주에 옮겨 본다 — 특히 🔄 반등 매수관심 (읽기 전용)
 *
 * 사용자 지시(2026-08-25): "나스닥에 쓰던 변동성 꺾임 등 지표를 개별주에도 일부
 * 적용해서 승률 시뮬레이션, 반등매수관심 등에."
 *
 * 왜 이 축인가
 *   반등 매수관심을 가르려고 문턱 18종(볼밴·점수·추격·RSI·섹터·추세)을 훑었지만
 *   전부 실패했다(tools/rev4-lab.js). 실패한 18개는 **전부 그 종목 자신의 지표**다.
 *   나스닥 전용 등급이 통과한 재료는 종류가 다르다 — **시장 변동성이 꺾였는가,
 *   지수가 며칠 내리 밀렸는가**. 그 축을 개별주 신호에 얹어 본다.
 *
 * 무엇을 재나 (산식은 한 줄도 안 건드린다)
 *   strategyValidation()을 한 번만 돌리고, 나온 신호 표본을 조건별로 가른다.
 *   조건이 걸린 날 자체가 좋은 날일 수 있으므로 **같은 조건이 걸린 날의 기준선**을
 *   나란히 찍는다. 신호가 좋아진 것인지 그냥 좋은 날을 고른 것인지는 그것으로만 갈린다.
 *
 * 채택 관문
 *   ① 조건이 걸린 신호가 **같은 날 기준선**보다 높을 것 (그냥 좋은 날 고르기가 아님)
 *   ② §2 전·후반 같은 방향   ③ 표본 15+ (§5-1)
 *   ④ 조건을 안 건 쪽이 실제로 나쁠 것 — 그래야 게이트로 쓸 수 있다
 *
 * ⚠ 조건 13종을 훑는다(다중비교). 통과한 것이 있어도 다음 사이클에서 다시
 *   통과해야 실전에 쓴다.
 * ⚠ VXN 과거값은 원장에 없고 backtest raw.json의 macro.vxn 에만 있다 —
 *   그래서 이 도구는 CI에서만 돈다. 화면에 쓰려면 main.py가 VXN을 hist에
 *   저장하도록 먼저 고쳐야 한다(꼬리 확장).
 *
 * 사용: node tools/vol-lab.js [backtest/raw.json]
 */
const fs = require('fs'), H = require('./_harness');

const IN = process.argv[2] || 'backtest/raw.json';
if (!fs.existsSync(IN)) { console.error(`[ERROR] ${IN} 없음 — 워크플로우 안에서만 실행된다.`); process.exit(1); }
const RAW = fs.readFileSync(IN, 'utf8');
const base = JSON.parse(RAW);
const F = base.hist_fields;
const I = {}; ['date', 'price', 'atr_pct', 'ma20'].forEach(k => { I[k] = F.indexOf(k); });
const isKR = t => /\.(KS|KQ)$/i.test(t || '') || /^\d{6}$/.test(t || '');

/* ── 시장 축 ──────────────────────────────────────────────────────────── */
const vxn = ((base.macro || {}).vxn) || {};
const qh = ((base.qqq_card || {}).hist || []).filter(r => r && r[I.date]);
const qd = qh.map(r => String(r[I.date])), qc = qh.map(r => r[I.price]);
const qStreak = new Map();
for (let i = 0; i < qd.length; i++) {
  let n = 0;
  for (let j = i; j > 0; j--) { if (!(qc[j] < qc[j - 1])) break; n++; }
  qStreak.set(qd[i], n);
}
/* breadth — 20일선 위 종목 비율(미국·비레버리지). 외부 데이터가 필요 없다. */
const brN = new Map(), brD = new Map();
for (const s of base.stocks || []) {
  if (isKR(s.ticker)) continue;
  for (const h of s.hist || []) {
    const d = String(h[I.date]), p = h[I.price], m = h[I.ma20];
    if (p == null || m == null) continue;
    brD.set(d, (brD.get(d) || 0) + 1);
    if (p > m) brN.set(d, (brN.get(d) || 0) + 1);
  }
}
const breadth = d => (brD.get(d) >= 20 ? brN.get(d) / brD.get(d) * 100 : null);
const VXN_DATES = Object.keys(vxn).sort();
/* 직전 거래일 VXN을 미리 접어 둔다 — 행마다 indexOf를 돌면 조건 13종 × 수천 행에서 느리다 */
const VXN_PREV = new Map();
VXN_DATES.forEach((d, i) => { if (i > 0) VXN_PREV.set(d, Number(vxn[VXN_DATES[i - 1]])); });
const vxnAt = d => (vxn[d] === undefined || vxn[d] === null ? null : Number(vxn[d]));
const vxnPrevAt = d => { const v = VXN_PREV.get(d); return v === undefined || v === null || Number.isNaN(v) ? null : v; };

/* ── 종목 축 ──────────────────────────────────────────────────────────── */
const sDown = new Map(), sAtrTurn = new Map(), sAtrDown = new Map();
for (const s of base.stocks || []) {
  const hs = (s.hist || []).filter(r => r && r[I.date] && r[I.price] != null);
  for (let i = 0; i < hs.length; i++) {
    const d = s.ticker + '|' + String(hs[i][I.date]);
    let n = 0;
    for (let j = i; j > 0; j--) { if (!(hs[j][I.price] < hs[j - 1][I.price])) break; n++; }
    sDown.set(d, n);
    const a = hs[i][I.atr_pct], p = i > 0 ? hs[i - 1][I.atr_pct] : null;
    if (a != null && p != null) {
      if (a < p) sAtrDown.set(d, true);
      /* '피크아웃' = 어제가 최근 10봉 중 최고였는데 오늘 꺾였다 */
      let mx = -Infinity;
      for (let j = Math.max(0, i - 10); j <= i - 1; j++) { const v = hs[j][I.atr_pct]; if (v != null) mx = Math.max(mx, v); }
      if (a < p && p >= mx) sAtrTurn.set(d, true);
    }
  }
}

const COND = [
  ['M1 VXN≥28 & 꺾임',        x => { const v = vxnAt(x.date), p = vxnPrevAt(x.date); return v != null && p != null && v >= 28 && v < p; }],
  ['M2 VXN≥25 & 꺾임',        x => { const v = vxnAt(x.date), p = vxnPrevAt(x.date); return v != null && p != null && v >= 25 && v < p; }],
  ['M3 VXN 전일보다 하락',      x => { const v = vxnAt(x.date), p = vxnPrevAt(x.date); return v != null && p != null && v < p; }],
  ['M4 VXN≥25 (꺾임 무관)',    x => { const v = vxnAt(x.date); return v != null && v >= 25; }],
  ['M5 QQQ 2일+ 연속 하락',    x => (qStreak.get(x.date) || 0) >= 2],
  ['M6 QQQ 3일+ 연속 하락',    x => (qStreak.get(x.date) || 0) >= 3],
  ['M7 breadth < 30%',       x => { const b = breadth(x.date); return b != null && b < 30; }],
  ['S1 종목 2일+ 연속 하락',    x => (sDown.get(x.ticker + '|' + x.date) || 0) >= 2],
  ['S2 종목 3일+ 연속 하락',    x => (sDown.get(x.ticker + '|' + x.date) || 0) >= 3],
  ['S3 종목 ATR 꺾임(피크아웃)', x => !!sAtrTurn.get(x.ticker + '|' + x.date)],
  ['S4 종목 ATR 전일보다 하락',  x => !!sAtrDown.get(x.ticker + '|' + x.date)],
  ['C1 M1 ∪ M6 (전용등급 그대로)', x => { const v = vxnAt(x.date), p = vxnPrevAt(x.date);
      return (v != null && p != null && v >= 28 && v < p) || (qStreak.get(x.date) || 0) >= 3; }],
  ['C2 S1 & M3 (종목 하락 + 변동성 꺾임)', x => (sDown.get(x.ticker + '|' + x.date) || 0) >= 2 &&
      (() => { const v = vxnAt(x.date), p = vxnPrevAt(x.date); return v != null && p != null && v < p; })()],
];

/* ── 화면 산식 한 번만 돌린다 ─────────────────────────────────────────── */
const page = H.loadPage({ patch: [
  ['result._diag=diag;', 'result._diag=diag; result._all=out;'],
  /* 기준선 행에는 ticker가 없다(화면은 날짜만 쓴다). 종목별 조건으로 기준선을
     가르려면 티커가 있어야 하므로 여기서만 덧붙인다 — 집계 규칙은 그대로다. */
  ['baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});', 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date, ticker:row.ticker});']] });
page.runInPage('this.__run = j => { state.data = normalize(JSON.parse(j)); return strategyValidation(); };');
const V = page.__run(RAW);

const HZ = [1, 3, 5, 7];
const DAYS = [...new Set((base.stocks || []).flatMap(s => (s.hist || []).map(r => String(r[I.date]))))].sort();
const MID = DAYS[Math.floor(DAYS.length / 2)];
function stat(arr) {
  const a = arr.filter(v => v != null && !Number.isNaN(v));
  const w = a.filter(v => v > 1).length, l = a.filter(v => v < -1).length;
  return { n: a.length, rate: (w + l) ? Math.round(w / (w + l) * 100) : null,
           avg: a.length ? a.reduce((p, c) => p + c, 0) / a.length : null };
}
const cell = (s, b) => {
  if (!s || s.rate === null) return `  —(${String(s ? s.n : 0).padStart(4)})       `;
  const e = (b && b.rate !== null) ? `${s.rate - b.rate >= 0 ? '+' : ''}${s.rate - b.rate}`.padStart(4) + '%p' : '     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(4)})${e}`;
};
const pc = v => (v === null || v === undefined) ? '—' : `${v >= 0 ? '+' : ''}${(Math.round(v * 100) / 100).toFixed(2)}%`;

const t4 = k => h => (V._all[k][h] || []).filter(x => x.tier === 4);
const t5 = k => h => (V._all[k][h] || []).filter(x => x.tier === 5);
const LAYERS = [
  ['🔄 반등 관심', t4('rev')], ['🔄 반등 강매', t5('rev')],
  ['📈 추세 관심', t4('pull')], ['📈 추세 강매', t5('pull')],
  ['🟢 강한매수', h => V._phaseRows.strongBuy[h] || []],
  ['💡 강한다중', h => V._phaseRows.strict[h] || []],
];
const BASEROWS = h => V._phaseRows.base[h] || [];

console.log(`■ 변동성·연속하락 축을 개별주 신호에 적용 — ${DAYS.length}거래일 (${DAYS[0]} ~ ${DAYS[DAYS.length-1]}) · 반쪽 ${MID}`);
console.log(`  VXN 일자 ${VXN_DATES.length}개 · 칸: 승률(표본) **같은 조건이 걸린 날의 기준선** 대비 %p`);
console.log('  ※ 조건이 그냥 좋은 날을 고르는 것인지 신호를 개선하는 것인지는 이 대비로만 갈린다.');

for (const [lab, get] of LAYERS) {
  const all = {}; HZ.forEach(h => all[h] = stat(get(h).map(x => x.ret)));
  const allBase = {}; HZ.forEach(h => allBase[h] = stat(BASEROWS(h).map(x => x.ret)));
  console.log(`\n── ${lab}  (전체 ${HZ.map(h => `${all[h].rate === null ? '—' : all[h].rate + '%'}(${all[h].n})`).join(' / ')}` +
              `  · 전체 기준선 ${HZ.map(h => `${allBase[h].rate}%`).join('/')})`);
  for (const [cn, fn] of COND) {
    const rows = {}, bs = {};
    HZ.forEach(h => {
      rows[h] = stat(get(h).filter(fn).map(x => x.ret));
      bs[h] = stat(BASEROWS(h).filter(fn).map(x => x.ret));
    });
    if (HZ.every(h => rows[h].n < 5)) continue;
    console.log(`  ${cn.padEnd(28)}` + HZ.map(h => cell(rows[h], bs[h]).padEnd(19)).join('') +
      '  평균 ' + HZ.map(h => pc(rows[h].avg)).join('/'));
    /* 조건이 걸린 날의 기준선 자체도 찍는다 — 이게 이미 높으면 조건은 '좋은 날 고르기'다 */
    console.log(`    ${'· 그날 기준선'.padEnd(26)}` + HZ.map(h => cell(bs[h], allBase[h]).padEnd(19)).join(''));
    if (HZ.some(h => rows[h].n >= 15)) {
      const f = {}, b2 = {};
      HZ.forEach(h => {
        f[h] = stat(get(h).filter(x => fn(x) && x.date < MID).map(x => x.ret));
        b2[h] = stat(get(h).filter(x => fn(x) && x.date >= MID).map(x => x.ret));
      });
      console.log(`    ${'· 전반/후반'.padEnd(26)}` + HZ.map(h =>
        `${f[h].rate === null ? '—' : f[h].rate + '%'}(${f[h].n}) / ${b2[h].rate === null ? '—' : b2[h].rate + '%'}(${b2[h].n})`.padEnd(19)).join(''));
    }
  }
}

console.log(`\n※ 조건 ${COND.length}종 × 계층 6개를 훑었다(다중비교 — 칸이 많다).`);
console.log('   채택은 ① 같은 날 기준선 초과 ② §2 같은 방향 ③ 표본 15+ ④ 조건 밖이 실제로 나쁨,');
console.log('   넷을 전부 넘고 다음 사이클에서 다시 통과한 것만.');
console.log('   VXN을 화면에서 쓰려면 main.py가 hist에 VXN을 저장해야 한다(현재는 백테스트 원본에만 있다).');
console.log('  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.');
