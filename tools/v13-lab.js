#!/usr/bin/env node
/**
 * v13 후보 시뮬레이션 — 네 축을 같은 판(189거래일 백테스트)에서 잰다 (읽기 전용)
 *
 * 사용자 지시(2026-09-03):
 *   A 💡 강한다중 — '전일 중립 → 강한매수' 전환 조건을 풀고 다른 조건으로
 *   B 🔄 반등 매수관심(등급4) — 승률이 이상하다(189일 47/46/39/38%). 정의 자체를 바꿔 본다
 *   C 4단계 약세 감점 — VXN을 다른 방식으로 참고
 *   D 신규 지표 — 며칠째 연속 상승 · 큰손 자금 유입(거래량×방향) 등을 우리 데이터로 설계해
 *     '단독 신호'와 '강한매수 필터' 두 자리에서 잰다 (나박AI 참고 — 사이트는 프록시에 막혀
 *     산식은 못 봤고, 우리 원장에 있는 재료(종가·거래량비·RS20·ATR·VXN)로만 만든다)
 *
 * 어떻게 재나 (§0) — index.html의 세 줄만 문자열로 갈아끼운다:
 *   ① 강한다중 조건        `const strict=has(s.market_vxn) && s.market_vxn>=25 && …` (v13)
 *   ② 등급4 조건           `(revScore>=2.0 && has(bb) && bb<=40) ? 4 : 3;` (v13)
 *   ③ 국면 감점 세 줄       `const vxnFear = …` · `cNeg-=1.0;` · `cNeg-=0.5;`
 * 파생 집합(연속 상승·자금 유입·ATR 방향·20일 신고가 …)은 여기서 (티커|날짜)로 만들어
 * 페이지 컨텍스트에 함수로 넘긴다. 산식 재구현은 없다.
 *
 * 채택 관문(방법론): ① 기준선/현행 대비 %p ② §2 전·후반 같은 방향 ③ 새로 편입·지워진 표본의
 * 실제 성적 ④ 평균수익(§6) ⑤ 표본 15+. 다중비교 — 몇 개를 훑었는지 같이 찍는다.
 *
 * 사용: node tools/v13-lab.js [backtest/raw.json]
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'backtest/raw.json';
if (!fs.existsSync(IN)) { console.error(`[ERROR] ${IN} 없음`); process.exit(1); }
let RAW = fs.readFileSync(IN, 'utf8');
const base = JSON.parse(RAW);
const F = base.hist_fields;
const I = {}; ['date', 'price', 'change_1d', 'vol_ratio', 'atr_pct', 'rs20', 'ma20', 'rsi', 'market_vxn'].forEach(k => { I[k] = F.indexOf(k); });
const num = v => (v == null || Number.isNaN(Number(v))) ? null : Number(v);

/* ── VXN (macro.vxn → hist 행에 주입: v12 산식 입력) ─────────────────────── */
const VXN = ((base.macro || {}).vxn) || {};
const VDAYS = Object.keys(VXN).sort();
const vxnAt = d => (VXN[d] == null ? null : Number(VXN[d]));
const vxnPrevAt = d => { const i = VDAYS.indexOf(d); return i > 0 ? Number(VXN[VDAYS[i - 1]]) : null; };
const vxnAvg20 = d => { const i = VDAYS.indexOf(d); if (i < 19) return null;
  let s = 0; for (let j = i - 19; j <= i; j++) s += Number(VXN[VDAYS[j]]); return s / 20; };
{
  let filled = 0;
  if (I.market_vxn >= 0) for (const s of base.stocks || []) for (const r of s.hist || []) {
    if (!r || !r[I.date]) continue;
    while (r.length <= I.market_vxn) r.push(null);
    if (r[I.market_vxn] == null && VXN[String(r[I.date])] != null) { r[I.market_vxn] = Number(VXN[String(r[I.date])]); filled++; }
  }
  RAW = JSON.stringify(base);
  console.log(`  hist 행 market_vxn 주입: ${filled}칸`);
}
/* QQQ 연속 하락 일수(날짜별) — 기준카드 hist */
const QDOWN = {};
{
  const q = ((base.qqq_card || {}).hist) || [];
  const rows = q.filter(r => r && r[I.date] && r[I.price] != null).sort((a, b) => String(a[I.date]) < String(b[I.date]) ? -1 : 1);
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    n = (i > 0 && rows[i][I.price] < rows[i - 1][I.price]) ? n + 1 : 0;
    QDOWN[String(rows[i][I.date])] = n;
  }
}

/* ── 파생 집합 (티커|날짜) ───────────────────────────────────────────────── */
const UP = new Map();       // 연속 상승 일수
const INFLOW = new Map();   // 5일 자금 유입 점수 = Σ sign(등락)·max(거래량비-1, 0)
const VOLUP = new Set();    // 당일 거래량 1.5배+ 양봉
const ATRDN = new Set();    // ATR% 전일보다 하락
const HI20 = new Set();     // 20일 종가 신고가
const RSPOS = new Set();    // RS20 > 0
const ABOVE20 = new Set();  // 20일선 위
for (const s of base.stocks || []) {
  const hs = (s.hist || []).filter(r => r && r[I.date] && r[I.price] != null);
  let up = 0;
  for (let i = 0; i < hs.length; i++) {
    const r = hs[i], k = s.ticker + '|' + String(r[I.date]);
    const c = r[I.price], p = i > 0 ? hs[i - 1][I.price] : null;
    up = (p != null && c > p) ? up + 1 : 0; UP.set(k, up);
    let inflow = 0;
    for (let j = Math.max(0, i - 4); j <= i; j++) {
      const chg = num(hs[j][I.change_1d]), vr = num(hs[j][I.vol_ratio]);
      if (chg == null || vr == null) continue;
      inflow += Math.sign(chg) * Math.max(vr - 1, 0);
    }
    INFLOW.set(k, inflow);
    const vr = num(r[I.vol_ratio]), chg = num(r[I.change_1d]);
    if (vr != null && chg != null && vr >= 1.5 && chg > 0) VOLUP.add(k);
    const a = num(r[I.atr_pct]), ap = i > 0 ? num(hs[i - 1][I.atr_pct]) : null;
    if (a != null && ap != null && a < ap) ATRDN.add(k);
    if (i >= 20) { let mx = -Infinity; for (let j = i - 20; j < i; j++) mx = Math.max(mx, hs[j][I.price]); if (c >= mx) HI20.add(k); }
    const rs = num(r[I.rs20]); if (rs != null && rs > 0) RSPOS.add(k);
    const m = num(r[I.ma20]); if (m != null && c > m) ABOVE20.add(k);
  }
}
const K = s => s.ticker + '|' + s.last_date;

/* ── 앵커 ───────────────────────────────────────────────────────────────── */
/* v13(2026-09-03) 적용 후의 실제 줄에 맞춘 앵커 — 줄이 바뀌면 '앵커 없음'으로 죽는다. */
const STRICT_A = 'const strict=has(s.market_vxn) && s.market_vxn>=25 && strictMultiGate(s) && fallbackStrict && strictChase;';
const STRICT_B = 'const strict=__STRICT(s, previousOverallGrade(s)) && strictMultiGate(s) && fallbackStrict && strictChase;';
const REV4_A = '(revScore>=2.0 && has(bb) && bb<=40) ? 4 : 3;';
const REV4_B = '(__REV4(s, revScore, bb, run3Eff)) ? 4 : 3;';
const FEAR_A = 'const vxnFear = has(s.market_vxn) && s.market_vxn>=25;';
const FEAR_B = 'const vxnFear = __FEAR(s);';
const WP_A = 'else if (lv==="weak"){ cNeg-=1.0;';
const WP_B = 'else if (lv==="weak"){ cNeg-=__WP(s);';
const CP_A = 'else if (lv==="caution"){ cNeg-=0.5;';
const CP_B = 'else if (lv==="caution"){ cNeg-=__CP(s);';
const REVS_A = 'const revStrong = revScore>=2.0 && has(rsi) && revRsiOK && sectorOK && revChase;';
const REVS_B = 'const revStrong = __REVS(s, revScore) && has(rsi) && revRsiOK && sectorOK && revChase;';
const BASEROW = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});';
const BASEROW2 = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date, ticker:row.ticker});';

function makePage(o) {
  const patch = [['result._diag=diag;', 'result._diag=diag; result._all=out;'], [BASEROW, BASEROW2]];
  if (o.strict) patch.push([STRICT_A, STRICT_B]);
  if (o.rev4) patch.push([REV4_A, REV4_B]);
  if (o.revs) patch.push([REVS_A, REVS_B]);
  if (o.fear || o.wp || o.cp) { patch.push([FEAR_A, FEAR_B]); patch.push([WP_A, WP_B]); patch.push([CP_A, CP_B]); }
  const page = H.loadPage({ patch });
  page.__STRICT = o.strict || (s => s.market_vxn != null && Number(s.market_vxn) >= 25);   // v13 현행
  page.__REVS = o.revs || ((s, rev) => rev >= 2.0);
  page.__REV4 = o.rev4 || ((s, rev, bb) => rev >= 2.0 && bb != null && bb <= 40);   // v13 현행
  const vx = s => (s.market_vxn == null ? null : Number(s.market_vxn));
  page.__FEAR = o.fear || (s => { const v = vx(s); return v != null && v >= 25; });
  page.__WP = o.wp || (() => 1.0);
  page.__CP = o.cp || (() => 0.5);
  page.runInPage('this.__run = j => { state.data = normalize(JSON.parse(j)); return strategyValidation(); };');
  return page;
}

/* ── 집계 도구 ───────────────────────────────────────────────────────────── */
const ONLY = new Set(((process.argv.find(a => a.startsWith('--only=')) || '--only=A,B,C,D,E,F').split('=')[1]).split(','));
const HZ = [1, 3, 5, 7];
const DAYS = [...new Set((base.stocks || []).flatMap(s => (s.hist || []).map(r => String(r[I.date]))))].sort();
const MID = DAYS[Math.floor(DAYS.length / 2)];
function clip(pred) { const d = JSON.parse(RAW); for (const s of d.stocks) s.hist = (s.hist || []).filter(r => pred(String(r[I.date]))); return JSON.stringify(d); }
const H1 = clip(d => d < MID), H2 = clip(d => d >= MID);
function stat(arr) {
  const a = arr.filter(v => v != null && !Number.isNaN(v));
  const w = a.filter(v => v > 1).length, l = a.filter(v => v < -1).length;
  return { n: a.length, rate: (w + l) ? Math.round(w / (w + l) * 100) : null, avg: a.length ? a.reduce((p, c) => p + c, 0) / a.length : null };
}
const cell = (s, b) => {
  if (!s || s.rate === null) return `  —(${String(s ? s.n : 0).padStart(4)})       `;
  const e = (b && b.rate !== null) ? `${s.rate - b.rate >= 0 ? '+' : ''}${s.rate - b.rate}`.padStart(4) + '%p' : '     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(4)})${e}`;
};
const pc = v => (v == null) ? '—' : `${v >= 0 ? '+' : ''}${(Math.round(v * 100) / 100).toFixed(2)}%`;
const key = x => x.ticker + '|' + x.date;
const rowsOf = (v, layer, h) => {
  if (layer === 'strict') return (v._all.multi[h] || []).filter(x => x.tier === 1);
  if (layer === 'multi') return (v._all.multi[h] || []);
  if (layer === 'rev4') return (v._all.rev[h] || []).filter(x => x.tier === 4);
  if (layer === 'pull4') return (v._all.pull[h] || []).filter(x => x.tier === 4);
  if (layer === 'sb') return v._phaseRows.strongBuy[h] || [];
  if (layer === 'rev5') return v._phaseRows.rev[h] || [];
  if (layer === 'pull5') return v._phaseRows.pull[h] || [];
  if (layer === 'base') return v._phaseRows.base[h] || [];
  return [];
};
const st = (v, layer, h, f) => stat(rowsOf(v, layer, h).filter(f || (() => true)).map(x => x.ret));

function runSet(CANDS) { const R = new Map(); for (const [nm, o] of CANDS) { const p = makePage(o); R.set(nm, { full: p.__run(RAW), h1: p.__run(H1), h2: p.__run(H2) }); } return R; }

/* 한 후보의 어떤 계층을 P0와 비교해 찍는다: 검증표 · §2 · 평균수익 · 새로 편입 · 빠진 표본 */
function report(nm, v, P0, layer, label, extraRows) {
  const isP0 = !P0;
  console.log(`\n  ${nm}`);
  for (const [lab, ly] of extraRows) console.log(`    ${lab.padEnd(14)}` + HZ.map(h => cell(st(v.full, ly, h), isP0 ? null : st(P0.full, ly, h)).padEnd(19)).join(''));
  console.log(`    ${label.padEnd(14)}` + HZ.map(h => cell(st(v.full, layer, h), isP0 ? null : st(P0.full, layer, h)).padEnd(19)).join('') +
    '  평균 ' + HZ.map(h => pc(st(v.full, layer, h).avg)).join('/'));
  const half = (a, b) => `${a.rate ?? '—'}%(${a.n})/${b.rate ?? '—'}%(${b.n})`;
  console.log(`    ${'· 전반/후반'.padEnd(14)}` + HZ.map(h => half(st(v.h1, layer, h), st(v.h2, layer, h)).padEnd(19)).join(''));
  if (!isP0) {
    const add = HZ.map(h => { const p0 = new Set(rowsOf(P0.full, layer, h).map(key)); return stat(rowsOf(v.full, layer, h).filter(x => !p0.has(key(x))).map(x => x.ret)); });
    const gone = HZ.map(h => { const nw = new Set(rowsOf(v.full, layer, h).map(key)); return stat(rowsOf(P0.full, layer, h).filter(x => !nw.has(key(x))).map(x => x.ret)); });
    const fmt = s => `${s.n}건 ${s.rate ?? '—'}%·${pc(s.avg)}`;
    console.log(`    ${'· 새로 편입'.padEnd(14)}` + add.map(s => fmt(s).padEnd(19)).join(''));
    console.log(`    ${'· 빠진 표본'.padEnd(14)}` + gone.map(s => fmt(s).padEnd(19)).join(''));
  }
}

console.log(`■ v13 후보 시뮬레이션 · ${DAYS.length}거래일 · 반쪽 ${MID} · VXN 일자 ${VDAYS.length}`);
console.log(`  파생 집합: 연속상승2일+ ${[...UP.values()].filter(v => v >= 2).length} · 거래량1.5배 양봉 ${VOLUP.size} · ATR하락 ${ATRDN.size} · 20일 신고가 ${HI20.size} · RS20>0 ${RSPOS.size}`);
console.log('  칸: 승률(표본) 현행 대비%p · +1/+3/+5/+7일 · 승=+1% 초과, 패=-1% 미만');

if (ONLY.has('A')) {
/* ═══ A. 💡 강한다중 전환 조건 ═════════════════════════════════════════════ */
console.log('\n══ A. 💡 강한다중 — 전환 조건(전일 중립→강한매수) 대체 후보');
const volUp12 = s => { const vr = num(s.vol_ratio), c = num(s.change_1d); return vr != null && c != null && vr >= 1.2 && c > 0; };
const A = [
  ['M0 현행 v13 (VXN≥25)',                 {}],
  ['M0b v12 (전일 중립 → 강한매수)',        { strict: (s, p) => p === 3 }],
  ['M1 전환 조건 제거',                     { strict: () => true }],
  ['M2 첫날(전일 강한매수 아님)',            { strict: (s, p) => p !== 5 }],
  ['M3 반대시험: 전일도 강한매수(연속)',       { strict: (s, p) => p === 5 }],
  ['M4 M1 + 거래량 1.2배 양봉',             { strict: s => volUp12(s) }],
  ['M5 M1 + 2일+ 연속 상승',                { strict: s => (UP.get(K(s)) || 0) >= 2 }],
  ['M6 M1 + VXN≥25',                       { strict: s => s.market_vxn != null && s.market_vxn >= 25 }],
  ['M7 M1 + RS20>0',                       { strict: s => RSPOS.has(K(s)) }],
  ['M8 M1 + 5일 자금유입≥1',                { strict: s => (INFLOW.get(K(s)) || 0) >= 1 }],
  ['M9 M2 + 거래량 1.2배 양봉',             { strict: (s, p) => p !== 5 && volUp12(s) }],
  ['M10 M1 + 20일 신고가',                  { strict: s => HI20.has(K(s)) }],
  ['M11 M2 + 2일+ 연속 상승',               { strict: (s, p) => p !== 5 && (UP.get(K(s)) || 0) >= 2 }],
  ['M12 M2 + 5일 자금유입≥1',               { strict: (s, p) => p !== 5 && (INFLOW.get(K(s)) || 0) >= 1 }],
];
{
  const R = runSet(A); const P0 = R.get(A[0][0]);
  for (const [nm] of A) report(nm, R.get(nm), nm === A[0][0] ? null : P0, 'strict', '💡 강한다중', [['🔵 다중', 'multi'], ['🟢 강한매수', 'sb']]);
}


}
if (ONLY.has('B')) {
/* ═══ B. 🔄 반등 매수관심(등급4) 재정의 ═══════════════════════════════════ */
console.log('\n══ B. 🔄 반등 매수관심(등급4) — 정의 후보 (현행: 반등≥2.0 & 볼밴≥70 & 3일누적≤10)');
const B = [
  ['R0 현행 v13 (반등≥2.0 & 볼밴≤40)',        {}],
  ['R0b v12 (볼밴≥70 & 3일누적≤10)',         { rev4: (s, rev, bb, run3) => rev >= 2.0 && bb != null && bb >= 70 && run3 !== null && run3 <= 10 }],
  ['R1 반등≥2.0 & 볼밴≤40 (밴드 하단)',       { rev4: (s, rev, bb) => rev >= 2.0 && bb != null && bb <= 40 }],
  ['R2 반등≥2.0 & 볼밴 40~70',               { rev4: (s, rev, bb) => rev >= 2.0 && bb != null && bb > 40 && bb < 70 }],
  ['R3 반등≥2.0 & 2일+ 연속 상승',            { rev4: (s, rev) => rev >= 2.0 && (UP.get(K(s)) || 0) >= 2 }],
  ['R4 반등≥2.0 & 거래량 1.5배 양봉',          { rev4: (s, rev) => rev >= 2.0 && VOLUP.has(K(s)) }],
  ['R5 반등≥2.0 & ATR 상승(꺾이지 않음)',       { rev4: (s, rev) => rev >= 2.0 && !ATRDN.has(K(s)) }],
  ['R6 반등≥2.0 & VXN≥25',                   { rev4: (s, rev) => rev >= 2.0 && s.market_vxn != null && s.market_vxn >= 25 }],
  ['R7 반등≥2.0 & RS20>0',                   { rev4: (s, rev) => rev >= 2.0 && RSPOS.has(K(s)) }],
  ['R8 반등≥2.0 & 5일 자금유입≥1',            { rev4: (s, rev) => rev >= 2.0 && (INFLOW.get(K(s)) || 0) >= 1 }],
  ['R9 현행 & ATR 상승 (W3)',                 { rev4: (s, rev, bb, run3) => rev >= 2.0 && bb != null && bb >= 70 && run3 !== null && run3 <= 10 && !ATRDN.has(K(s)) }],
  ['R10 반등≥2.0 & 20일선 위 & 2일+ 연속 상승', { rev4: (s, rev) => rev >= 2.0 && ABOVE20.has(K(s)) && (UP.get(K(s)) || 0) >= 2 }],
  ['R11 반등≥2.5 & 볼밴≤50',                 { rev4: (s, rev, bb) => rev >= 2.5 && bb != null && bb <= 50 }],
  ['R12 폐지 (등급4 없음)',                   { rev4: () => false }],
];
{
  const R = runSet(B); const P0 = R.get(B[0][0]);
  for (const [nm] of B) report(nm, R.get(nm), nm === B[0][0] ? null : P0, 'rev4', '🔄 반등 관심', [['🟢 강한매수', 'sb'], ['📈 추세 관심', 'pull4']]);
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')} — 관심 계층은 이 위여야 의미가 있다)`);
}


}
if (ONLY.has('C')) {
/* ═══ C. 4단계 약세 감점 — VXN 참고 방식 ══════════════════════════════════ */
console.log('\n══ C. 국면 감점(약세 −1.0 · 주의 −0.5) — VXN 참고 방식 후보');
const vx = s => (s.market_vxn == null ? null : Number(s.market_vxn));
const rel20 = s => { const v = vx(s), a = vxnAvg20(s.last_date); return v != null && a != null && v >= a * 1.15; };
const falling = s => { const v = vx(s), p = vxnPrevAt(s.last_date); return v != null && p != null && v < p; };
const C = [
  ['V0 현행 v12 (VXN≥25면 해제)',            {}],
  ['V1 v11 (해제 없음)',                     { fear: () => false }],
  ['V2 VXN 단계 감점 (<20:전액 · 20~25:절반 · ≥25:0)', { fear: () => false,
     wp: s => { const v = vx(s); return v == null || v < 20 ? 1.0 : v < 25 ? 0.5 : 0; },
     cp: s => { const v = vx(s); return v == null || v < 20 ? 0.5 : v < 25 ? 0.25 : 0; } }],
  ['V3 해제 = VXN≥22 & 전일보다 꺾임',         { fear: s => { const v = vx(s); return v != null && v >= 22 && falling(s); } }],
  ['V4 해제 = VXN ≥ 20일평균×1.15 (상대 급등)', { fear: s => rel20(s) }],
  ['V5 해제 문턱 22',                         { fear: s => { const v = vx(s); return v != null && v >= 22; } }],
  ['V6 해제 문턱 28',                         { fear: s => { const v = vx(s); return v != null && v >= 28; } }],
  ['V7 v12 + 안일한 약세(VXN<18) 감점 1.5배',  { wp: s => { const v = vx(s); return v != null && v < 18 ? 1.5 : 1.0; } }],
  ['V8 반대시험: 해제 = VXN≥22 & 상승 중',     { fear: s => { const v = vx(s); return v != null && v >= 22 && !falling(s); } }],
  ['V9 v12 ∪ QQQ 3일+ 연속 하락',             { fear: s => { const v = vx(s); return (v != null && v >= 25) || (QDOWN[s.last_date] || 0) >= 3; } }],
];
{
  const R = runSet(C); const P0 = R.get(C[0][0]);
  for (const [nm] of C) report(nm, R.get(nm), nm === C[0][0] ? null : P0, 'sb', '🟢 강한매수', [['💡 강한다중', 'strict'], ['🔵 다중', 'multi'], ['🔄 반등 관심', 'rev4']]);
}


}
if (ONLY.has('D')) {
/* ═══ D. 신규 지표 — 단독 신호 & 강한매수 필터 ═══════════════════════════ */
console.log('\n══ D. 신규 지표 — 단독(그날 전 종목 중 조건 충족일) 과 강한매수 필터');
console.log('   칸: 조건 충족 표본 승률(표본) 그 계층 전체 대비%p');
{
  const P0 = makePage({}); const v = P0.__run(RAW), v1 = P0.__run(H1), v2 = P0.__run(H2);
  const D = [
    ['I1 2일+ 연속 상승',        x => (UP.get(key(x)) || 0) >= 2],
    ['I2 3일+ 연속 상승',        x => (UP.get(key(x)) || 0) >= 3],
    ['I3 4일+ 연속 상승',        x => (UP.get(key(x)) || 0) >= 4],
    ['I4 거래량 1.5배+ 양봉',     x => VOLUP.has(key(x))],
    ['I5 5일 자금유입 ≥1',       x => (INFLOW.get(key(x)) || 0) >= 1],
    ['I6 5일 자금유입 ≥2',       x => (INFLOW.get(key(x)) || 0) >= 2],
    ['I7 5일 자금유출 ≤-1',      x => (INFLOW.get(key(x)) || 0) <= -1],
    ['I8 20일 신고가',           x => HI20.has(key(x))],
    ['I9 RS20>0',               x => RSPOS.has(key(x))],
    ['I10 I5 & I1 (유입+연속상승)', x => (INFLOW.get(key(x)) || 0) >= 1 && (UP.get(key(x)) || 0) >= 2],
    ['I11 I4 & 20일선 위',        x => VOLUP.has(key(x)) && ABOVE20.has(key(x))],
    ['I12 반대: 1일 상승(연속 아님)', x => (UP.get(key(x)) || 0) === 1],
  ];
  const LAYERS = [['기준선(전 종목)', 'base'], ['🟢 강한매수', 'sb'], ['💡 강한다중', 'strict'], ['🔄 반등 관심', 'rev4']];
  for (const [nm, f] of D) {
    console.log(`\n  ${nm}`);
    for (const [lab, ly] of LAYERS) {
      const all = HZ.map(h => st(v, ly, h)), sub = HZ.map(h => st(v, ly, h, f));
      const f1 = HZ.map(h => st(v1, ly, h, f)), f2 = HZ.map(h => st(v2, ly, h, f));
      console.log(`    ${lab.padEnd(14)}` + HZ.map((h, i) => cell(sub[i], all[i]).padEnd(19)).join('') + '  평균 ' + HZ.map((h, i) => pc(sub[i].avg)).join('/'));
      console.log(`    ${'  · 전/후반'.padEnd(14)}` + HZ.map((h, i) => `${f1[i].rate ?? '—'}%(${f1[i].n})/${f2[i].rate ?? '—'}%(${f2[i].n})`.padEnd(19)).join(''));
    }
  }
}


}

/* ═══ E. 약세 감점 조절 — 신호 가뭄 대응 (2026-09-03 사용자 지시) ═══════════════
   09-02 실제: 미국 80종목 중 20일선 위 23개, 반등점수 2.0 이상 2개, 강한매수 1개.
   약세 감점(−1.0)은 추세·반등 두 축에 같이 걸린다. 반등은 하락장에서 쓰라고 만든 축이므로
   '반등 축만 감점 면제'를 따로 잰다. 감점을 줄이면 표본이 몇 % 늘고 승률이 어디로 가는지. */
if (ONLY.has('E')) {
  console.log('\n══ E. 약세 감점 조절 — 감점 절반/해제 · 반등 축만 면제');
  const REV_A = '  const revScore  =Math.round((rPos+rNeg+cNeg+vxnBonus)*10)/10;   // 🔄 역추세 반등 — 최종 판정 축';
  const REV_B = '  const revScore  =Math.round((rPos+rNeg+cNeg+vxnBonus+__REVB(s))*10)/10;';
  const fear = s => s.market_vxn != null && Number(s.market_vxn) >= 25;
  const back = (s, w, c) => fear(s) ? 0 : (s.market_level === 'weak' ? w : s.market_level === 'caution' ? c : 0);
  const E = [
    ['E0 현행 v13 (약세 −1.0 · 주의 −0.5, VXN≥25면 해제)', {}],
    ['E1 약세 감점 절반(−0.5)',                 { wp: () => 0.5 }],
    ['E2 약세 감점 0',                          { wp: () => 0 }],
    ['E3 약세·주의 감점 0',                      { wp: () => 0, cp: () => 0 }],
    ['E4 반등 축만 감점 면제 (추세 축 유지)',       { revb: s => back(s, 1.0, 0.5) }],
    ['E5 반등 축 면제 + 추세 축 절반',             { wp: () => 0.5, revb: s => back(s, 0.5, 0.25) }],
  ];
  const mk = o => {
    const patch = [['result._diag=diag;', 'result._diag=diag; result._all=out;'], [BASEROW, BASEROW2]];
    if (o.wp || o.cp) { patch.push([FEAR_A, FEAR_B]); patch.push([WP_A, WP_B]); patch.push([CP_A, CP_B]); }
    if (o.revb) patch.push([REV_A, REV_B]);
    const page = H.loadPage({ patch });
    page.__FEAR = s => fear(s); page.__WP = o.wp || (() => 1.0); page.__CP = o.cp || (() => 0.5); page.__REVB = o.revb || (() => 0);
    page.runInPage('this.__run = j => { state.data = normalize(JSON.parse(j)); return strategyValidation(); };');
    return page;
  };
  const R = new Map(); for (const [nm, o] of E) { const p = mk(o); R.set(nm, { full: p.__run(RAW), h1: p.__run(H1), h2: p.__run(H2) }); }
  const P0 = R.get(E[0][0]);
  for (const [nm] of E) {
    const v = R.get(nm), isP0 = nm === E[0][0];
    report(nm, v, isP0 ? null : P0, 'sb', '🟢 강한매수', [['💡 강한다중', 'strict'], ['🔵 다중', 'multi'], ['📈 추세 관심', 'pull4'], ['🔄 반등 관심', 'rev4']]);
    const days = new Set(rowsOf(v.full, 'sb', 1).map(x => x.date)).size;
    console.log(`    ${'· 강한매수 일수'.padEnd(14)}${days}일 / ${DAYS.length}일 · 하루 평균 ${(rowsOf(v.full, 'sb', 1).length / DAYS.length).toFixed(2)}건`);
  }
}

/* ═══ F. 🔄 반등형 강한매수 문턱 (2026-09-03 사용자 "반등형 강한매수 문턱 높여야") ═════
   현행 = 반등≥2.0 & RSI 게이트 & 섹터 & 추격. 189일에서 반등 강매 57/59/59/58 vs 추세 강매 54/58/64/63.
   문턱을 올리면 표본이 준다 — 지워지는 표본이 실제로 지는 표본일 때만(§5-5) 정당하다. */
if (ONLY.has('F')) {
  console.log('\n══ F. 🔄 반등형 강한매수 문턱 후보 (현행 반등≥2.0)');
  const F = [
    ['F0 현행 반등≥2.0',                    {}],
    ['F1 반등≥2.5',                         { revs: (s, rev) => rev >= 2.5 }],
    ['F2 반등≥3.0',                         { revs: (s, rev) => rev >= 3.0 }],
    ['F3 반등≥2.0 & 볼밴≤50',                { revs: (s, rev) => rev >= 2.0 && s.bb_pos != null && s.bb_pos <= 50 }],
    ['F4 반등≥2.0 & 볼밴≤35',                { revs: (s, rev) => rev >= 2.0 && s.bb_pos != null && s.bb_pos <= 35 }],
    ['F5 반등≥2.0 & 5일 자금유출≤−1 (매도 소진)', { revs: (s, rev) => rev >= 2.0 && (INFLOW.get(K(s)) ?? 0) <= -1 }],
    ['F6 반등≥2.0 & ATR 상승',                { revs: (s, rev) => rev >= 2.0 && !ATRDN.has(K(s)) }],
    ['F7 반등≥2.0 & 거래량 1.2배 양봉',         { revs: (s, rev) => rev >= 2.0 && s.vol_ratio != null && s.vol_ratio >= 1.2 && s.change_1d > 0 }],
    ['F8 반등≥2.0 & RSI≤45',                 { revs: (s, rev) => rev >= 2.0 && s.rsi != null && s.rsi <= 45 }],
    ['F9 반등≥2.0 & VXN≥25',                 { revs: (s, rev) => rev >= 2.0 && s.market_vxn != null && s.market_vxn >= 25 }],
    ['F10 반등≥2.0 & 연속 상승 2일 미만',       { revs: (s, rev) => rev >= 2.0 && (UP.get(K(s)) || 0) < 2 }],
    ['F11 반등≥2.5 & 매도 소진',               { revs: (s, rev) => rev >= 2.5 && (INFLOW.get(K(s)) ?? 0) <= -1 }],
    ['F12 반등≥2.0 & 5일 자금유입≥1 (반대시험)', { revs: (s, rev) => rev >= 2.0 && (INFLOW.get(K(s)) ?? 0) >= 1 }],
  ];
  const R = runSet(F); const P0 = R.get(F[0][0]);
  for (const [nm] of F) report(nm, R.get(nm), nm === F[0][0] ? null : P0, 'rev5', '🔄 반등 강매', [['🟢 강한매수', 'sb'], ['💡 강한다중', 'strict'], ['🔵 다중', 'multi'], ['📈 추세 강매', 'pull5']]);
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
}

console.log(`\n※ 후보 A 13종 · B 13종 · C 10종 · 지표 12종 · E 6종 · F 13종 — 다중비교. 통과한 것도 다음 사이클 재확인 후에 쓴다.`);
console.log('  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.');
