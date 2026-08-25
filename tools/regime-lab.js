#!/usr/bin/env node
/**
 * 시장 국면(market_level) 판정 후보 비교 — 측정 전용 · 아무 파일도 안 고친다
 *
 * 왜 만드나 (2026-08-25 사용자 지시: "국면판정부터 고쳐줘 측정하고 보고하고")
 *   8/13~8/21 나스닥이 밀리는 내내 국면이 'neutral'로 남아 있다가 8/24에야 'weak'가
 *   됐다. 그 9거래일 동안 방어섹터 게이트(sectorOK)가 한 번도 안 걸렸고,
 *   매수관심·반등이 +5일 33%(기준선 -20%p)까지 내려앉았다.
 *   원인은 현행 판정이 **"종가가 20일선을 깨야" 비로소 경계로 넘어가는** 구조라는 것:
 *
 *     p >= ma20 이면 아무리 20일선이 꺾여 있어도 최선이 neutral → 게이트가 안 걸린다.
 *
 * 무엇을 재나
 *   후보 국면 정의로 hist의 market_level/market_weak을 통째로 갈아끼우고
 *   화면 산식(strategyValidation)을 **그대로** 다시 돌린다(§0 — 재구현 금지).
 *   국면은 점수 ⑨(감점)와 방어섹터 게이트 두 곳에 동시에 작용하므로
 *   라벨만 바꿔도 어떤 날이 강한매수가 되는지 자체가 바뀐다.
 *
 * 방법론이 요구하는 것 (docs/승률-검증-방법론.md)
 *   §1 기준선 대비 %p로만 본다 — 국면이 바뀌면 기준선도 같이 움직인다
 *   §2 전·후반 반쪽에서 같은 방향인가
 *   §5-1 표본 등급
 *   §5-5 **지워지는 표본이 실제로 지는 표본인가** — 게이트는 그때만 정당하다
 *   §6 승률만 오르고 평균수익이 내려가면 기각
 *   다중비교: 후보를 몇 개 훑었는지 결과에 같이 적는다
 *
 * 입력  backtest/raw.json (180거래일 · CI에서만 생성) — 없으면 signals.json(30일)로
 *       돌아가되 표본이 §5-1 미달임을 명시한다.
 * 사용  node tools/regime-lab.js [backtest/raw.json]
 */
const fs = require('fs'), H = require('./_harness');

const IN = process.argv[2] || (fs.existsSync('backtest/raw.json') ? 'backtest/raw.json' : 'signals.json');
if (!fs.existsSync(IN)) { console.error(`[ERROR] ${IN} 없음`); process.exit(1); }
const RAW = fs.readFileSync(IN, 'utf8');
const base = JSON.parse(RAW);
const F = base.hist_fields || [];
const I = {}; ['date','price','ma5','ma20','ma50','ma60','rsi','ret20','market_level','market_weak']
  .forEach(k => { I[k] = F.indexOf(k); if (I[k] < 0) { console.error(`[ERROR] hist_fields에 ${k} 없음`); process.exit(1); } });

const SHORT = IN.endsWith('signals.json');
console.log(`■ 시장 국면 판정 후보 비교 — 입력 ${IN}${SHORT ? '  ⚠ 30거래일뿐 — §5-1 미달, 방향만' : ''}`);

/* ── ① QQQ 일별 지표 ────────────────────────────────────────────────
   qqq_card.hist는 종목과 같은 HIST_FIELDS 배열이다. 국면 후보는 전부
   '그날 종가까지의 값'만 쓴다 — 미래를 못 보게 한다. */
const qhist = ((base.qqq_card || {}).hist || []).filter(r => r && r[I.date]);
if (qhist.length < 25) { console.error(`[ERROR] qqq_card.hist ${qhist.length}행 — 너무 짧다`); process.exit(1); }
const Q = {
  d: qhist.map(r => String(r[I.date])),
  c: qhist.map(r => r[I.price]), ma5: qhist.map(r => r[I.ma5]),
  ma20: qhist.map(r => r[I.ma20]), ma60: qhist.map(r => r[I.ma60]),
  rsi: qhist.map(r => r[I.rsi]), ret20: qhist.map(r => r[I.ret20]),
};
const QI = new Map(Q.d.map((d, i) => [d, i]));

/* 저장된 국면(main.py market_state) — 현행 재현이 맞는지 대조용 + 일목 국면 */
const STORED = new Map(), ICHI = new Map();
for (const x of (base.market || {}).hist || []) {
  if (!Array.isArray(x) || !x[0]) continue;
  STORED.set(String(x[0]), x[1]);
  if (x.length >= 5 && x[4]) ICHI.set(String(x[0]), x[4]);
}

/* 화면 산식을 통째로 올린다 — 검증표 재실행과 상수 조회에 같은 컨텍스트를 쓴다.
   패치는 진단용 한 줄뿐이다(신호 원시 표본을 밖으로 빼낸다 — §5-5 계산용). */
const page = H.loadPage({ patch: [['result._diag=diag;', 'result._diag=diag; result._all=out;']] });
page.runInPage('this.__run = j => { state.data = normalize(JSON.parse(j)); return strategyValidation(); };');

/* breadth — 관심종목(미국·레버리지 제외) 중 20일선 위 비율. 외부 데이터가 필요 없다. */
const LEV = new Set(page.runInPage('Object.keys(LEVERAGED)'));
const isKR = t => /\.(KS|KQ)$/i.test(t || '') || /^\d{6}$/.test(t || '');
const brNum = new Map(), brDen = new Map();
for (const s of base.stocks || []) {
  if (isKR(s.ticker) || LEV.has(s.ticker)) continue;
  for (const h of s.hist || []) {
    const d = String(h[I.date]); const p = h[I.price], m = h[I.ma20];
    if (p == null || m == null) continue;
    brDen.set(d, (brDen.get(d) || 0) + 1);
    if (p > m) brNum.set(d, (brNum.get(d) || 0) + 1);
  }
}
const breadth = d => (brDen.get(d) >= 20 ? brNum.get(d) / brDen.get(d) * 100 : null);

const ok = v => v != null && !Number.isNaN(v);
const rising20 = i => (i >= 5 && ok(Q.ma20[i]) && ok(Q.ma20[i - 5])) ? Q.ma20[i] > Q.ma20[i - 5] : null;
const dd20 = i => {                       // 최근 20봉 고점 대비 낙폭 %
  if (i < 1) return null;
  let hi = -Infinity;
  for (let j = Math.max(0, i - 19); j <= i; j++) if (ok(Q.c[j])) hi = Math.max(hi, Q.c[j]);
  return hi > 0 && ok(Q.c[i]) ? (Q.c[i] / hi - 1) * 100 : null;
};
const down = i => (i >= 1 && ok(Q.c[i]) && ok(Q.c[i - 1])) ? Q.c[i] < Q.c[i - 1] : false;
const brDrop = i => {                     // 5거래일 전 대비 breadth 변화(%p)
  if (i < 5) return null;
  const a = breadth(Q.d[i]), b = breadth(Q.d[i - 5]);
  return (a == null || b == null) ? null : a - b;
};

/* 현행 판정 (main.py market_state.judge를 그대로 옮긴 것) */
function cur(i) {
  const p = Q.c[i], a20 = Q.ma20[i], a60 = Q.ma60[i], up = rising20(i);
  if (!ok(p) || !ok(a20) || !ok(a60) || up === null) return STORED.get(Q.d[i]) || null;
  if (p >= a20 && a20 >= a60 && up) return 'strong';
  if (p < a20 && p < a60) return 'weak';
  if (p < a20) return 'caution';
  return 'neutral';
}
/* 후보는 전부 '현행 + 경계 조기 발동'의 형태로 만든다.
   strong/weak의 정의는 건드리지 않는다 — 바꾸는 건 '언제부터 경계하나' 하나다.
   (전부를 한꺼번에 바꾸면 무엇이 효과를 냈는지 못 가린다.) */
const guardIf = fn => i => {
  const lv = cur(i);
  if (lv === 'weak' || lv === 'caution') return lv;
  const g = fn(i);
  return g === true ? 'caution' : lv;
};

const CANDS = [
  ['A 현행 (20일선을 깨야 경계)', cur],
  ['B +20일선 하락 중',           guardIf(i => rising20(i) === false)],
  ['C +5일선<20일선',             guardIf(i => ok(Q.ma5[i]) && ok(Q.ma20[i]) && Q.ma5[i] < Q.ma20[i])],
  ['D +QQQ 20일수익 <0',          guardIf(i => ok(Q.ret20[i]) && Q.ret20[i] < 0)],
  ['E +QQQ RSI<45',               guardIf(i => ok(Q.rsi[i]) && Q.rsi[i] < 45)],
  ['F +breadth<40%',              guardIf(i => { const b = breadth(Q.d[i]); return b != null && b < 40; })],
  ['G +20일고점 -3% 이하',        guardIf(i => { const v = dd20(i); return v != null && v <= -3; })],
  ['H +2일연속하락&20일선하락',   guardIf(i => down(i) && down(i - 1) && rising20(i) === false)],
  ['I 일목 국면 그대로',          i => ICHI.get(Q.d[i]) || cur(i)],
  ['J B∪F (20일선하락 또는 breadth)', guardIf(i => { const b = breadth(Q.d[i]); return rising20(i) === false || (b != null && b < 40); })],
  ['K 반대시험: caution 없앰',    i => { const lv = cur(i); return lv === 'caution' ? 'neutral' : lv; }],
  /* 아래 셋은 8월 타임라인을 보고 추가했다 — 지수는 20일선 위에서 버티는데
     20일선 위 종목 비율(breadth)만 81% → 52%로 무너진 구간이 있었다.
     지수만 보는 판정은 그걸 구조적으로 못 본다. 문턱(<40)은 그 구간에 한 번도
     안 걸렸으므로 문턱을 올린 것과 '급랭(속도)'을 따로 잰다. */
  ['L +breadth<55%',              guardIf(i => { const b = breadth(Q.d[i]); return b != null && b < 55; })],
  ['M +breadth 5일 -15%p 이하',   guardIf(i => brDrop(i) !== null && brDrop(i) <= -15)],
  ['N L∪M (폭 낮거나 급랭)',      guardIf(i => { const b = breadth(Q.d[i]); return (b != null && b < 55) || (brDrop(i) !== null && brDrop(i) <= -15); })],
];

/* ── 현행 재현 검증 — 여기가 어긋나면 아래 비교가 전부 의미 없다 ───────── */
let miss = 0, cmp = 0;
Q.d.forEach((d, i) => { const s = STORED.get(d); if (!s) return; cmp++; if (cur(i) !== s) miss++; });
console.log(`  현행 재현 대조: ${cmp}일 중 불일치 ${miss}일` +
  (miss > cmp * 0.03 ? '  ⚠ 재현이 어긋난다 — 아래 비교를 믿지 말 것' : '  (일치)'));

/* ── ② 국면 라벨별 분포 ────────────────────────────────────────────── */
const LVS = ['strong', 'neutral', 'caution', 'weak'];
const LVN = { strong: '강세', neutral: '중립', caution: '주의', weak: '약세' };
const maps = CANDS.map(([nm, fn]) => [nm, new Map(Q.d.map((d, i) => [d, fn(i)]))]);
console.log(`\n── ① 국면 분포 (${Q.d.length}거래일 · ${Q.d[0]} ~ ${Q.d[Q.d.length - 1]})`);
console.log(`  ${'후보'.padEnd(34)}` + LVS.map(l => LVN[l].padStart(8)).join('') + '     경계일 비율');
for (const [nm, m] of maps) {
  const cnt = {}; LVS.forEach(l => cnt[l] = 0);
  m.forEach(v => { if (cnt[v] !== undefined) cnt[v]++; });
  const g = cnt.caution + cnt.weak;
  console.log(`  ${nm.padEnd(34)}` + LVS.map(l => String(cnt[l]).padStart(8)).join('') +
    `     ${String(Math.round(g / Q.d.length * 100)).padStart(3)}%`);
}

/* ── ③ 라벨 자체의 예측력 ──────────────────────────────────────────────
   게이트를 논하기 전에 '경계로 찍은 날이 실제로 나쁜 날인가'부터 본다.
   두 가지로 잰다: QQQ 자신의 이후 수익, 그리고 전 종목 이후 수익(기준선). */
const HZ = [1, 3, 5, 7];
function fwdQ(i, h) { return (i + h < Q.c.length && ok(Q.c[i]) && ok(Q.c[i + h])) ? (Q.c[i + h] / Q.c[i] - 1) * 100 : null; }
/* 전 종목 일별 수익 — 국면은 미국 종목에만 적용되므로 미국·비레버리지만 센다 */
const STK = [];
for (const s of base.stocks || []) {
  if (isKR(s.ticker) || LEV.has(s.ticker)) continue;
  const hs = (s.hist || []).filter(r => r && r[I.date] && r[I.price] != null);
  hs.forEach((r, i) => {
    const o = { d: String(r[I.date]) };
    HZ.forEach(h => { o[h] = (i + h < hs.length) ? (hs[i + h][I.price] / r[I.price] - 1) * 100 : null; });
    STK.push(o);
  });
}
function stat(arr) {                      // 화면 stat()과 같은 규칙 (±1% 밖만 승패로 센다)
  const a = arr.filter(v => v != null && !Number.isNaN(v));
  const w = a.filter(v => v > 1).length, l = a.filter(v => v < -1).length;
  return { n: a.length, rate: (w + l) ? Math.round(w / (w + l) * 100) : null,
           avg: a.length ? Math.round(a.reduce((p, c) => p + c, 0) / a.length * 100) / 100 : null };
}
const cell = (s, b) => {
  if (!s || s.rate === null) return `  —(${String(s ? s.n : 0).padStart(4)})       `;
  const e = (b && b.rate !== null) ? `${s.rate - b.rate >= 0 ? '+' : ''}${s.rate - b.rate}`.padStart(4) + '%p' : '     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(4)})${e}`;
};
const BASE_STK = {}; HZ.forEach(h => BASE_STK[h] = stat(STK.map(x => x[h])));
const BASE_QQQ = {}; HZ.forEach(h => BASE_QQQ[h] = stat(Q.d.map((_, i) => fwdQ(i, h))));
console.log(`\n── ② '경계(주의·약세)로 찍은 날'이 실제로 나쁜 날인가 · ${HZ.map(h => '+' + h + '일').join(' ')}`);
console.log('     칸: 승률(표본) 기준선대비%p — 경계일은 기준선보다 **낮아야** 판정이 맞는 것');
console.log(`  ${'(아무 날이나 = 기준선)'.padEnd(34)}` + HZ.map(h => cell(BASE_STK[h]).padEnd(19)).join(''));
for (const [nm, m] of maps) {
  const gd = new Set(Q.d.filter(d => ['caution', 'weak'].includes(m.get(d))));
  const st = {}; HZ.forEach(h => st[h] = stat(STK.filter(x => gd.has(x.d)).map(x => x[h])));
  const qs = {}; HZ.forEach(h => qs[h] = stat(Q.d.map((d, i) => gd.has(d) ? fwdQ(i, h) : null)));
  console.log(`  ${nm.padEnd(34)}` + HZ.map(h => cell(st[h], BASE_STK[h]).padEnd(19)).join(''));
  console.log(`    ${'· 그날 QQQ 자신'.padEnd(32)}` + HZ.map(h => cell(qs[h], BASE_QQQ[h]).padEnd(19)).join(''));
}

/* ── ④ 화면 산식 재실행 ──────────────────────────────────────────────── */
function swap(levelByDate, pred) {
  const d = JSON.parse(RAW);
  const need = Math.max(I.market_level, I.market_weak);
  for (const s of d.stocks || []) {
    const kr = isKR(s.ticker);
    let hs = s.hist || [];
    if (pred) hs = hs.filter(r => pred(String(r[I.date])));
    s.hist = hs;
    for (const h of hs) {
      while (h.length <= need) h.push(null);
      const lv = kr ? 'neutral' : (levelByDate.get(String(h[I.date])) || null);
      h[I.market_level] = lv;
      h[I.market_weak] = kr ? false : (lv === 'weak' || lv === 'caution');
    }
    const lv = kr ? 'neutral' : (levelByDate.get(String(s.last_date)) || s.market_level);
    s.market_level = lv;
    s.market_weak = kr ? false : (lv === 'weak' || lv === 'caution');
  }
  return d;
}
const runWith = (m, pred) => page.__run(JSON.stringify(swap(m, pred)));

const DAYS = [...new Set((base.stocks || []).flatMap(s => (s.hist || []).map(r => String(r[I.date]))))].sort();
const MID = DAYS[Math.floor(DAYS.length / 2)];
const ROWS = [
  ['💡 강한다중', v => v._strict], ['🔵 다중', v => v.multi], ['🟢 강한매수', v => v._strongBuy],
  ['📈 추세 강매', v => v.pull], ['🔄 반등 강매', v => v.rev],
  ['📈 추세 관심', v => v._interest.pull], ['🔄 반등 관심', v => v._interest.rev],
  ['기준선', v => v._baseline],
];
const RES = new Map(), HALF = new Map();
for (const [nm, m] of maps) {
  RES.set(nm, runWith(m, null));
  HALF.set(nm, [runWith(m, d => d < MID), runWith(m, d => d >= MID)]);
}
const A = RES.get(CANDS[0][0]), AH = HALF.get(CANDS[0][0]);

console.log(`\n── ③ 화면 산식 재실행 — ${DAYS.length}거래일 · 반쪽 기준 ${MID}`);
console.log('     칸: 승률(표본) A(현행)대비%p. 기준선 행도 같이 움직인다는 점에 주의(§1)');
for (const [nm] of CANDS) {
  const v = RES.get(nm), [h1, h2] = HALF.get(nm);
  console.log(`\n  ${nm}`);
  for (const [lab, get] of ROWS) {
    const ref = nm === CANDS[0][0] ? null : get(A);
    console.log(`    ${lab.padEnd(14)}` + HZ.map(h => cell(get(v)[h], ref ? ref[h] : null).padEnd(19)).join(''));
  }
  const g = v._strongBuy, ga = A._strongBuy;
  console.log(`    ${'· 초록 전반'.padEnd(14)}` + HZ.map(h => cell(h1._strongBuy[h], AH[0]._strongBuy[h]).padEnd(19)).join(''));
  console.log(`    ${'· 초록 후반'.padEnd(14)}` + HZ.map(h => cell(h2._strongBuy[h], AH[1]._strongBuy[h]).padEnd(19)).join(''));
  const pc = v2 => v2 === null ? '—' : `${v2 >= 0 ? '+' : ''}${(Math.round(v2 * 100) / 100).toFixed(2)}%`;
  console.log(`    ${'· 초록 평균수익'.padEnd(14)}` + HZ.map(h =>
    (pc(g[h].avg) + (nm === CANDS[0][0] || ga[h].avg === null ? '' : ` (A ${pc(ga[h].avg)})`)).padEnd(19)).join(''));
}

/* ── ⑤ §5-5 지워지는 표본이 실제로 지는가 ───────────────────────────── */
const key = x => x.ticker + '|' + x.date;
function tierRows(v, tier, h) { return [].concat(v._all.pull[h] || [], v._all.rev[h] || []).filter(x => x.tier === tier); }
console.log(`\n── ④ §5-5 게이트가 **지우는** 표본이 실제로 지는가 (A 대비)`);
console.log('     지워진 표본의 승률이 기준선보다 높으면 그 게이트는 이기는 신호를 죽인 것이다.');
for (const [nm] of CANDS.slice(1)) {
  const v = RES.get(nm);
  const line = [];
  for (const tier of [5, 4]) {
    const parts = HZ.map(h => {
      const a = new Map(tierRows(A, tier, h).map(x => [key(x), x.ret]));
      const b = new Set(tierRows(v, tier, h).map(key));
      const gone = [...a].filter(([k]) => !b.has(k)).map(([, r]) => r);
      const add = tierRows(v, tier, h).filter(x => !a.has(key(x))).map(x => x.ret);
      const sg = stat(gone), sa = stat(add);
      return `+${h}일 지움 ${sg.n}건${sg.rate === null ? '' : `(${sg.rate}%·${sg.avg >= 0 ? '+' : ''}${sg.avg}%)`}` +
             (sa.n ? ` 새로 ${sa.n}건${sa.rate === null ? '' : `(${sa.rate}%)`}` : '');
    });
    line.push(`    ${(tier === 5 ? '· 강한매수' : '· 매수관심').padEnd(12)}${parts.join(' · ')}`);
  }
  console.log(`  ${nm}`);
  line.forEach(l => console.log(l));
}

/* ── ⑥ 최근 구간 타임라인 — '며칠 늦었나'를 눈으로 본다 ─────────────── */
const SHOWN = Math.min(45, Q.d.length);
const MARK = { strong: '강', neutral: '·', caution: '주', weak: '약' };
console.log(`\n── ⑤ 최근 ${SHOWN}거래일 국면 타임라인 (강=강세 ·=중립 주=주의 약=약세)`);
console.log(`  ${'날짜'.padEnd(12)}${'QQQ%'.padStart(7)}${'br%'.padStart(6)}  ` +
  CANDS.map(([nm]) => nm.slice(0, 1)).join(' '));
for (let i = Q.d.length - SHOWN; i < Q.d.length; i++) {
  const ch = (i >= 1 && ok(Q.c[i]) && ok(Q.c[i - 1])) ? (Q.c[i] / Q.c[i - 1] - 1) * 100 : null;
  const b = breadth(Q.d[i]);
  console.log(`  ${Q.d[i].padEnd(12)}${(ch === null ? '—' : (ch >= 0 ? '+' : '') + ch.toFixed(1)).padStart(7)}` +
    `${(b === null ? '—' : Math.round(b)).toString().padStart(6)}  ` +
    maps.map(([, m]) => MARK[m.get(Q.d[i])] || '?').join(' '));
}

console.log(`\n※ 후보 ${CANDS.length}종을 훑었다(다중비교). 채택 관문은 셋을 전부 넘는 것만:`);
console.log('   ① 경계일이 기준선보다 실제로 나쁠 것(②표)  ② 검증표에서 A보다 나을 것');
console.log('   ③ §2 전·후반 같은 방향 + §5-5 지워지는 표본이 지는 표본일 것');
console.log('  이 도구는 실험 전용이다. 산식 반영은 사용자 승인 후에만.');
