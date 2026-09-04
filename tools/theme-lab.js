#!/usr/bin/env node
/**
 * 테마 랭킹 예측 — 어떤 점수로 테마를 줄 세워야 다음 5·10일에 실제로 앞서는가 (읽기 전용)
 *
 * 사용자 지시(2026-09-03): "테마별 흐름에 테마 랭킹 3위까지 나오게 해서 어떤 테마가 오를 것
 * 같은지 예측도 넣어줘 — 30일 원장 흐름 검증 포함해서 데이터 기반으로."
 *
 * 재료는 원장에 있는 것만 쓴다(종가·20일선·거래량비·RS20·20일 수익률). 종목 등락은
 * 레버리지 1배로 환산한다(화면의 테마 흐름과 같은 자).
 *
 * 매일 d에 대해 테마별로 점수를 만들고 순위를 매긴 뒤, 그 테마 구성 종목의 +5/+10일
 * 평균 수익률(앞으로의 실제)을 본다. 판정:
 *   · TOP3 초과   = TOP3 테마의 앞으로 수익 평균 − 그날 전체 테마 중앙값 (%p)
 *   · TOP3 적중률 = TOP3 평균이 중앙값을 넘은 날의 비율 (50%가 동전 던지기)
 *   · 1위 적중률  = 1위 테마가 중앙값을 넘은 날의 비율
 *   · IC          = 점수 순위와 앞으로 수익 순위의 상관(스피어만) 일평균 — 0이면 정보 없음
 *   · §2 전·후반  = 두 반쪽에서 같은 방향인가
 *
 * 사용: node tools/theme-lab.js [backtest/raw.json | signals.json]
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'backtest/raw.json';
if (!fs.existsSync(IN)) { console.error(`[ERROR] ${IN} 없음`); process.exit(1); }
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
const F = base.hist_fields;
const I = {}; ['date', 'price', 'change_1d', 'vol_ratio', 'ma20', 'rs20', 'ret20'].forEach(k => { I[k] = F.indexOf(k); });
const num = v => (v == null || Number.isNaN(Number(v))) ? null : Number(v);
const LEV = H.extractConst('LEVERAGED');
const levX = tk => (LEV[tk] ? LEV[tk].x : 1);

/* 화면과 같은 테마 = category. 백테스트 원본에 category가 없으면 signals.json에서 가져온다. */
let CAT = {};
for (const s of base.stocks || []) if (s.category) CAT[s.ticker] = s.category;
if (!Object.keys(CAT).length && fs.existsSync('signals.json')) {
  for (const s of JSON.parse(fs.readFileSync('signals.json', 'utf8')).stocks || []) CAT[s.ticker] = s.category;
}
const KR = tk => /\.(KS|KQ)$/.test(tk);

/* 종목별 날짜 인덱스 */
const ST = [];
for (const s of base.stocks || []) {
  if (!CAT[s.ticker] || KR(s.ticker)) continue;      // 국장은 거래일이 달라 같은 날짜 축에 못 놓는다
  const hs = (s.hist || []).filter(r => r && r[I.date] && r[I.price] != null).sort((a, b) => String(a[I.date]) < String(b[I.date]) ? -1 : 1);
  const idx = new Map(hs.map((r, i) => [String(r[I.date]), i]));
  ST.push({ tk: s.ticker, cat: CAT[s.ticker], hs, idx, x: levX(s.ticker) });
}
const DAYS = [...new Set(ST.flatMap(s => s.hs.map(r => String(r[I.date]))))].sort();
const MID = DAYS[Math.floor(DAYS.length / 2)];
const HZ = [5, 10];

/* 날짜 d의 종목 s 지표 */
function feat(s, d) {
  const i = s.idx.get(d); if (i == null || i < 20) return null;
  const r = s.hs[i], c = r[I.price], x = s.x;
  const p5 = s.hs[i - 5][I.price], p20 = s.hs[i - 20][I.price];
  let up = 0; for (let j = i; j > 0 && s.hs[j][I.price] > s.hs[j - 1][I.price]; j--) up++;
  let inflow = 0; for (let j = Math.max(0, i - 4); j <= i; j++) { const chg = num(s.hs[j][I.change_1d]), vr = num(s.hs[j][I.vol_ratio]); if (chg != null && vr != null) inflow += Math.sign(chg) * Math.max(vr - 1, 0); }
  const m20 = num(r[I.ma20]);
  const fwd = {}; HZ.forEach(h => { const q = s.hs[i + h]; fwd[h] = q ? (q[I.price] / c - 1) * 100 / x : null; });
  return { chg1: num(r[I.change_1d]) != null ? num(r[I.change_1d]) / x : null, m5: (c / p5 - 1) * 100 / x, m20: (c / p20 - 1) * 100 / x,
    above20: m20 != null ? (c > m20 ? 1 : 0) : null, up2: up >= 2 ? 1 : 0, inflow, rs: num(r[I.rs20]), fwd };
}
const mean = a => { const b = a.filter(v => v != null && !Number.isNaN(v)); return b.length ? b.reduce((p, c) => p + c, 0) / b.length : null; };
const median = a => { const b = a.filter(v => v != null).sort((p, q) => p - q); if (!b.length) return null; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
function rankOf(arr) { // 큰 값이 1위
  const o = arr.map((v, i) => [v, i]).filter(x => x[0] != null).sort((a, b) => b[0] - a[0]);
  const r = new Array(arr.length).fill(null); o.forEach((x, k) => { r[x[1]] = k + 1; }); return r;
}
function spearman(a, b) {
  const pairs = a.map((v, i) => [v, b[i]]).filter(x => x[0] != null && x[1] != null);
  if (pairs.length < 4) return null;
  const ra = rankOf(pairs.map(x => x[0])), rb = rankOf(pairs.map(x => x[1]));
  const n = pairs.length; let d2 = 0; for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
  return 1 - 6 * d2 / (n * (n * n - 1));
}

/* 테마별 일일 집계 */
const DAILY = []; // {d, themes:[{name, n, chg1, m5, m20, br, up2, inflow, rs, fwd:{5,10}}]}
for (const d of DAYS) {
  const byCat = new Map();
  for (const s of ST) { const f = feat(s, d); if (!f) continue; if (!byCat.has(s.cat)) byCat.set(s.cat, []); byCat.get(s.cat).push(f); }
  const themes = [];
  for (const [name, fs_] of byCat) {
    if (fs_.length < 3) continue;
    const fwd = {}; HZ.forEach(h => { fwd[h] = mean(fs_.map(f => f.fwd[h])); });
    themes.push({ name, n: fs_.length, chg1: mean(fs_.map(f => f.chg1)), m5: mean(fs_.map(f => f.m5)), m20: mean(fs_.map(f => f.m20)),
      br: mean(fs_.map(f => f.above20)) * 100, up2: mean(fs_.map(f => f.up2)) * 100, inflow: mean(fs_.map(f => f.inflow)), rs: mean(fs_.map(f => f.rs)), fwd });
  }
  if (themes.length >= 5) DAILY.push({ d, themes });
}
console.log(`■ 테마 랭킹 예측 · ${IN} · ${DAYS.length}거래일(평가 가능 ${DAILY.length}일) · 테마 ${new Set(DAILY.flatMap(x => x.themes.map(t => t.name))).size}개 · 반쪽 ${MID}`);
console.log('  판정 자: TOP3 초과(%p) · TOP3 적중률 · 1위 적중률 · IC(스피어만) — 전부 그날 전체 테마 중앙값 대비');

/* 점수 후보 */
const rankSum = (t, keys, all) => { // 여러 지표의 순위 합(작을수록 좋음) → 음수로 돌려 '큰 값이 좋음'에 맞춘다
  let s = 0; for (const k of keys) { const r = rankOf(all.map(x => x[k]))[all.indexOf(t)]; if (r == null) return null; s += r; } return -s;
};
const SCORES = [
  ['S0 전일 등락(현행 화면 순서)',      (t) => t.chg1],
  ['S1 5일 수익률',                   (t) => t.m5],
  ['S2 20일 수익률',                  (t) => t.m20],
  ['S3 20일선 위 비율(테마 폭)',        (t) => t.br],
  ['S4 5일 자금유입',                  (t) => t.inflow],
  ['S5 2일+ 연속 상승 비율',            (t) => t.up2],
  ['S6 RS20 평균',                    (t) => t.rs],
  ['S7 합성 = 5일수익 + 폭 + 자금유입',  (t, all) => rankSum(t, ['m5', 'br', 'inflow'], all)],
  ['S8 합성 = 20일수익 + 폭',           (t, all) => rankSum(t, ['m20', 'br'], all)],
  ['S9 합성 = 폭 + 자금유입 + 연속상승',  (t, all) => rankSum(t, ['br', 'inflow', 'up2'], all)],
  ['S10 반전: 5일 수익률 낮은 순',       (t) => t.m5 == null ? null : -t.m5],
  ['S11 반전: 20일 수익률 낮은 순',      (t) => t.m20 == null ? null : -t.m20],
  /* 2026-09-03 사용자 지시 "다중신호처럼 해서 승률 가장 강한 TOP3" — 189일에서 통과한 네 점수
     (S8 64% · S10 58% · S11 58% · S3 58%, +5일 TOP3 적중률)의 TOP3에 겹친 횟수를 먼저 보고,
     같은 횟수면 겹친 점수들의 적중률 합이 큰 순. index.html themeMultiRank()와 같은 규칙. */
  ['S12 다중 = 통과 점수 4종 TOP3 겹침 × 적중률', (t, all) => themeMulti(t, all)],
  /* 2026-09-04 사용자 목표 "10번 중 7번 이상". 두 방향으로 시도한다.
     ① 점수 자체를 더 잘 고르기(S13~S16) ② 확신 있는 날만 발표하기(G1~G4 — gate). */
  ['S13 합성 = 20일수익 + 폭 + RS20',        (t, all) => rankSum(t, ['m20', 'br', 'rs'], all)],
  ['S14 합성 = 20일수익 + 폭 + 자금유입',      (t, all) => rankSum(t, ['m20', 'br', 'inflow'], all)],
  ['S15 하이브리드 = 20일수익 + 5일반전 + 폭',  (t, all) => rankSum(t, ['m20', 'm5neg', 'br'], all)],
  ['S16 합성 = 폭 + RS20',                   (t, all) => rankSum(t, ['br', 'rs'], all)],
];
/* 선택적 발표 — 조건이 맞는 날만 TOP3를 내고, 나머지 날은 '오늘은 안 고름'으로 둔다.
   [이름, 점수함수, 게이트(그날 테마들 → 발표할지)] · 발표일 비율(coverage)도 같이 찍는다. */
const GATED = [
  ['G1 다중(S12) — 겹침 2개 이상인 날만',   (t, all) => themeMulti(t, all),
    all => { const sc = all.map(t => themeMulti(t, all)); return Math.max(...sc.map(x => Math.floor((x || 0) / 1000))) >= 2; }],
  ['G2 다중(S12) — 겹침 3개 이상인 날만',   (t, all) => themeMulti(t, all),
    all => { const sc = all.map(t => themeMulti(t, all)); return Math.max(...sc.map(x => Math.floor((x || 0) / 1000))) >= 3; }],
  ['G3 S8 — 1위 테마 폭 50% 이상인 날만',   (t, all) => rankSum(t, ['m20', 'br'], all),
    all => { const sc = all.map(t => rankSum(t, ['m20', 'br'], all)), rk = rankOf(sc);
             const top = all[rk.findIndex(r => r === 1)]; return top && top.br != null && top.br >= 50; }],
  ['G4 S8 — 테마 간 격차가 큰 날만(1위 20일수익 − 중앙값 ≥ 3%p)', (t, all) => rankSum(t, ['m20', 'br'], all),
    all => { const sc = all.map(t => rankSum(t, ['m20', 'br'], all)), rk = rankOf(sc);
             const top = all[rk.findIndex(r => r === 1)]; const med = median(all.map(t => t.m20));
             return top && top.m20 != null && med != null && (top.m20 - med) >= 3; }],
  ['G5 다중 2개+ & 1위 폭 50%+',           (t, all) => themeMulti(t, all),
    all => { const sc = all.map(t => themeMulti(t, all)); if (Math.max(...sc.map(x => Math.floor((x || 0) / 1000))) < 2) return false;
             const rk = rankOf(sc); const top = all[rk.findIndex(r => r === 1)]; return top && top.br != null && top.br >= 50; }],
];
const MULTI_SIGS = [['S8', 64, (t, all) => rankSum(t, ['m20', 'br'], all)], ['S10', 58, t => t.m5 == null ? null : -t.m5],
                    ['S11', 58, t => t.m20 == null ? null : -t.m20], ['S3', 58, t => t.br]];
function themeMulti(t, all) {
  let cnt = 0, w = 0;
  for (const [, hit, fn] of MULTI_SIGS) {
    const sc = all.map(x => fn(x, all)), rk = rankOf(sc)[all.indexOf(t)];
    if (rk != null && rk <= 3) { cnt++; w += hit; }
  }
  const s8 = rankOf(all.map(x => MULTI_SIGS[0][2](x, all)))[all.indexOf(t)] || 99;
  return cnt * 1000 + w - s8 * 0.01;   // 겹침 수 → 적중률 합 → S8 순위로 동점 처리
}

function evalScore(fn, days, gate) {
  const out = {}; HZ.forEach(h => { out[h] = { ex3: [], hit3: 0, hit1: 0, ic: [], n: 0, skip: 0 }; });
  for (const day of days) {
    const all = day.themes;
    all.forEach(t => { if (t.m5neg === undefined) t.m5neg = (t.m5 == null ? null : -t.m5); });
    if (gate && !gate(all)) { HZ.forEach(h => out[h].skip++); continue; }
    const sc = all.map(t => fn(t, all)), rk = rankOf(sc);
    const order = all.map((t, i) => [rk[i], t]).filter(x => x[0] != null).sort((a, b) => a[0] - b[0]).map(x => x[1]);
    if (order.length < 5) continue;
    HZ.forEach(h => {
      const fw = all.map(t => t.fwd[h]); const med = median(fw); if (med == null) return;
      const top3 = mean(order.slice(0, 3).map(t => t.fwd[h])), top1 = order[0].fwd[h];
      if (top3 == null || top1 == null) return;
      const o = out[h]; o.n++; o.ex3.push(top3 - med); if (top3 > med) o.hit3++; if (top1 > med) o.hit1++;
      const ic = spearman(sc, fw); if (ic != null) o.ic.push(ic);
    });
  }
  return out;
}
const cov = o => (o.skip ? ` · 발표 ${Math.round(o.n / (o.n + o.skip) * 100)}%(${o.n}/${o.n + o.skip}일)` : '');
const fmt = o => o.n ? `초과 ${(mean(o.ex3) >= 0 ? '+' : '')}${mean(o.ex3).toFixed(2)}%p · TOP3 ${Math.round(o.hit3 / o.n * 100)}% · 1위 ${Math.round(o.hit1 / o.n * 100)}% · IC ${(mean(o.ic) ?? 0).toFixed(2)} (${o.n}일)${cov(o)}` : '표본 없음';
const H1 = DAILY.filter(x => x.d < MID), H2 = DAILY.filter(x => x.d >= MID);
for (const [nm, fn] of SCORES) {
  const a = evalScore(fn, DAILY), b1 = evalScore(fn, H1), b2 = evalScore(fn, H2);
  console.log(`\n  ${nm}`);
  HZ.forEach(h => {
    console.log(`    +${h}일  ${fmt(a[h])}`);
    console.log(`          전반 ${fmt(b1[h])}`);
    console.log(`          후반 ${fmt(b2[h])}`);
  });
}
/* 선택적 발표 후보 — '확신 있는 날만' 골라 10번 중 7번을 노린다. 발표일 비율이 너무 낮으면(30% 미만)
   실전에서 쓸모가 없으므로 같이 본다. */
console.log('\n══ 선택적 발표 후보 (조건이 맞는 날만 TOP3를 낸다)');
for (const [nm, fn, gate] of GATED) {
  const a = evalScore(fn, DAILY, gate), b1 = evalScore(fn, H1, gate), b2 = evalScore(fn, H2, gate);
  console.log(`\n  ${nm}`);
  HZ.forEach(h => {
    console.log(`    +${h}일  ${fmt(a[h])}`);
    console.log(`          전반 ${fmt(b1[h])}`);
    console.log(`          후반 ${fmt(b2[h])}`);
  });
}
console.log('\n  ※ 목표: TOP3 적중률 70%+ · 발표일 비율 30%+ · 전·후반 둘 다 65%+ (셋 다 되어야 채택).');

/* 오늘(마지막 날)의 순위 미리보기 — 화면에 붙일 모양 */
const last = DAILY[DAILY.length - 1];
if (last) {
  console.log(`\n── ${last.d} 기준 테마 순위 미리보기 (S7 합성)`);
  const all = last.themes, sc = all.map(t => SCORES[7][1](t, all)), rk = rankOf(sc);
  all.map((t, i) => [rk[i], t]).filter(x => x[0] != null).sort((a, b) => a[0] - b[0]).slice(0, 5)
    .forEach(([r, t]) => console.log(`  ${r}위 ${t.name.padEnd(12)} 5일 ${t.m5 >= 0 ? '+' : ''}${t.m5.toFixed(1)}% · 20일선 위 ${Math.round(t.br)}% · 자금유입 ${t.inflow.toFixed(2)} · ${t.n}종목`));
}
console.log(`\n※ 점수 ${SCORES.length}종 + 선택적 발표 ${GATED.length}종(다중비교). 채택은 +5·+10일 모두 TOP3 적중률 55%+ 이고 §2 전·후반 같은 방향이며 IC>0 인 것만.`);
console.log('  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.');
