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
const REVS_A = 'const revStrong = revScore>=2.0 && has(rsi) && revRsiOK && sectorOK && tickerOK && revChase;';
const RS_A   = REVS_A;
const MG_A   = 'const marketGuarded = s.market_level==="weak" || s.market_level==="caution";';
const REVS_B = 'const revStrong = __REVS(s, revScore) && has(rsi) && revRsiOK && sectorOK && revChase;';
const BASEROW = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});';
const BASEROW2 = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date, ticker:row.ticker});';

function makePage(o) {
  const patch = [['result._diag=diag;', 'result._diag=diag; result._all=out;'], [BASEROW, BASEROW2]];
  if (o.strict) patch.push([STRICT_A, STRICT_B]);
  if (o.rev4) patch.push([REV4_A, REV4_B]);
  if (o.revs) patch.push([REVS_A, REVS_B]);
  if (o.fear || o.wp || o.cp) { patch.push([FEAR_A, FEAR_B]); patch.push([WP_A, WP_B]); patch.push([CP_A, CP_B]); }
  if (o.extra) for (const pr of o.extra) patch.push(pr);
  const page = H.loadPage({ patch });
  page.__INF = s => (INFLOW.get(K(s)) ?? null);
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

/* ═══ G. 🔄 반등 강매 볼밴 하단 + 상단 돌파 예외 (2026-09-03) ═════
   F4(볼밴≤35)가 가장 셌지만 keepcases에서 AAOI 8/7(볼밴 93·RSI 57, 상단 돌파 경로)과
   IREN 8/11(볼밴 64·RSI 49)을 잃어 적용하지 못했다. 하단만 남기되 이미 있는
   '밴드 상단 돌파' 예외(revRsiOK의 rsi≤60 & bb≥80)를 살리는 꼴을 잰다. */
if (ONLY.has('G')) {
  console.log('\n══ G. 🔄 반등 강매 — 볼밴 하단 + 상단 돌파 예외 (현행 반등≥2.0)');
  const bbOf = s => (s.bb_pos == null ? null : s.bb_pos);
  const G = [
    ['G0 현행 반등≥2.0',                        {}],
    ['G1 볼밴≤35 (F4 재확인)',                   { revs: (s, rev) => rev >= 2.0 && bbOf(s) != null && bbOf(s) <= 35 }],
    ['G2 볼밴≤35 또는 ≥80 (상단 돌파 예외)',        { revs: (s, rev) => rev >= 2.0 && bbOf(s) != null && (bbOf(s) <= 35 || bbOf(s) >= 80) }],
    ['G3 볼밴≤35 또는 ≥60',                     { revs: (s, rev) => rev >= 2.0 && bbOf(s) != null && (bbOf(s) <= 35 || bbOf(s) >= 60) }],
    ['G4 볼밴≤50 또는 ≥80',                     { revs: (s, rev) => rev >= 2.0 && bbOf(s) != null && (bbOf(s) <= 50 || bbOf(s) >= 80) }],
    ['G5 볼밴 35~80 사이만 제외 (= G2, RSI 게이트 그대로)', { revs: (s, rev) => rev >= 2.0 && bbOf(s) != null && !(bbOf(s) > 35 && bbOf(s) < 80) }],
    ['G6 볼밴≤35 또는 (≥80 & 당일 +2% 이하)',       { revs: (s, rev) => rev >= 2.0 && bbOf(s) != null && (bbOf(s) <= 35 || (bbOf(s) >= 80 && s.change_1d != null && s.change_1d <= 2)) }],
  ];
  const R = runSet(G); const P0 = R.get(G[0][0]);
  for (const [nm] of G) report(nm, R.get(nm), nm === G[0][0] ? null : P0, 'rev5', '🔄 반등 강매', [['🟢 강한매수', 'sb'], ['💡 강한다중', 'strict'], ['🔵 다중', 'multi'], ['📈 추세 강매', 'pull5']]);
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
  console.log('  ※ 적용 전 반드시 node tools/keepcases.js — AAOI 8/7 · IREN 8/11 · SNDK 8/10·8/11이 남는지 본다.');
}

/* ═══ H. G2의 하단 문턱 이웃값 (2026-09-03 사용자 "재보고 통과하면 적용") ═════
   G2(≤35 ∨ ≥80)는 통계 통과지만 SNDK 8/11(볼밴 38.7)이 강매→관심으로 내려간다.
   하단을 40으로 올린 꼴과 그 이웃(45)을 재서 고원인지 본다. */
if (ONLY.has('H')) {
  console.log('\n══ H. 🔄 반등 강매 — 볼밴 하단 40/45 + 상단 80 예외 (현행 반등≥2.0)');
  const bbOf = s => (s.bb_pos == null ? null : s.bb_pos);
  const Hc = [
    ['H0 현행 반등≥2.0',                 {}],
    ['H1 볼밴≤40 또는 ≥80',              { revs: (s, rev) => rev >= 2.0 && bbOf(s) != null && (bbOf(s) <= 40 || bbOf(s) >= 80) }],
    ['H2 볼밴≤45 또는 ≥80 (이웃값)',       { revs: (s, rev) => rev >= 2.0 && bbOf(s) != null && (bbOf(s) <= 45 || bbOf(s) >= 80) }],
    ['H3 볼밴≤35 또는 ≥80 (G2 재확인)',    { revs: (s, rev) => rev >= 2.0 && bbOf(s) != null && (bbOf(s) <= 35 || bbOf(s) >= 80) }],
  ];
  const R = runSet(Hc); const P0 = R.get(Hc[0][0]);
  for (const [nm] of Hc) report(nm, R.get(nm), nm === Hc[0][0] ? null : P0, 'rev5', '🔄 반등 강매', [['🟢 강한매수', 'sb'], ['💡 강한다중', 'strict'], ['🔵 다중', 'multi'], ['📈 추세 강매', 'pull5']]);
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
}

/* ═══ L. 표본 늘리고 승률 유지 (2026-09-03 사용자 "오늘 매수신호가 없는데 너무 박해진 건 아닌지") ═════
   진단: 2026-09-03 미국 80종목 중 반등≥2.0·RSI·추격 통과 3종목이 전부 sectorOK(약세·주의 국면이면
   방어섹터만 강한매수)에 막혔다. VXN 21이라 v12 감점 해제도 안 걸린다. 감점(E)이 아니라 이 하드
   게이트가 가뭄의 원인이므로 게이트를 푸는 꼴을 여러 개 잰다. 새로 편입되는 표본의 승률이
   현행 강한매수(57/59/62/61)보다 낮으면 '표본만 늘고 승률은 깎이는' 것이라 기각. */
const SECT_A = 'const sectorOK = !marketGuarded || DEFENSIVE_CATS.includes(s.category);';
const RSI_A  = 'const revRsiOK    = rsi<=50 || (rsi<=60 && revBandHigh);';
const NH_A   = 'const nearHighM = has(s.pct_from_high) && s.pct_from_high >= -25;';
const PCH_A  = 'const pullChase = run3Eff===null || run3Eff<=5;';
const RCH_A  = 'const revChase    = run3Eff===null || run3Eff<=3 || (run3Eff<=6 && revTrendOK);';
const PG_A   = 'const pullGrade = pullSetup && pullScore>=2.0 && sectorOK && tickerOK && nearHighM && pullChase && pullBandOK ? 5 :';
if (ONLY.has('L')) {
  console.log('\n══ L. 표본 늘리고 승률 유지 — 약세·주의 국면 섹터 게이트 완화 등 (현행 v13)');
  const vx = 'has(s.market_vxn) && s.market_vxn';
  const L = [
    ['L0 현행 v13',                                  {}],
    ['L1 섹터 게이트 해제 (약세·주의에도 강매 허용)',        { extra: [[SECT_A, 'const sectorOK = true;']] }],
    ['L2 VXN≥22면 섹터 게이트 해제',                    { extra: [[SECT_A, `const sectorOK = !marketGuarded || DEFENSIVE_CATS.includes(s.category) || (${vx}>=22);`]] }],
    ['L3 VXN≥20면 섹터 게이트 해제 (이웃값)',             { extra: [[SECT_A, `const sectorOK = !marketGuarded || DEFENSIVE_CATS.includes(s.category) || (${vx}>=20);`]] }],
    ['L4 종목이 20일선 위면 게이트 해제',                  { extra: [[SECT_A, 'const sectorOK = !marketGuarded || DEFENSIVE_CATS.includes(s.category) || (has(p) && has(ma20) && p>ma20);']] }],
    ['L5 주의(caution)만 해제 · 약세는 유지',              { extra: [[SECT_A, 'const sectorOK = s.market_level!=="weak" || DEFENSIVE_CATS.includes(s.category);']] }],
    ['L6 반등 축만 게이트 해제 (추세 축 유지)',             { extra: [[REVS_A, 'const revStrong = revScore>=2.0 && has(rsi) && revRsiOK && revChase;']] }],
    ['L7 반등 RSI 50→55',                             { extra: [[RSI_A, 'const revRsiOK    = rsi<=55 || (rsi<=60 && revBandHigh);']] }],
    ['L8 추세 52주고점 −25%→−35%',                      { extra: [[NH_A, 'const nearHighM = has(s.pct_from_high) && s.pct_from_high >= -35;']] }],
    ['L9 추격 완화 (추세 run3≤7 · 반등 run3≤5)',         { extra: [[PCH_A, 'const pullChase = run3Eff===null || run3Eff<=7;'], [RCH_A, 'const revChase    = run3Eff===null || run3Eff<=5 || (run3Eff<=8 && revTrendOK);']] }],
    ['L10 추세 강매 점수 2.0→1.3 (v14에서 철회한 방향)',   { extra: [[PG_A, 'const pullGrade = pullSetup && pullScore>=1.3 && sectorOK && nearHighM && pullChase && pullBandOK ? 5 :']] }],
    ['L11 반등 강매 점수 2.0→1.5',                      { revs: (s, rev) => rev >= 1.5 }],
  ];
  const R = runSet(L); const P0 = R.get(L[0][0]);
  for (const [nm] of L) {
    const v = R.get(nm);
    report(nm, v, nm === L[0][0] ? null : P0, 'sb', '🟢 강한매수', [['💡 강한다중', 'strict'], ['🔵 다중', 'multi'], ['📈 추세 강매', 'pull5'], ['🔄 반등 강매', 'rev5']]);
    const days = new Set(rowsOf(v.full, 'sb', 1).map(x => x.date)).size;
    console.log(`    ${'· 강한매수 일수'.padEnd(14)}${days}일 / ${DAYS.length}일 · 하루 평균 ${(rowsOf(v.full, 'sb', 1).length / DAYS.length).toFixed(2)}건`);
  }
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
  console.log('  ※ 판정: 새로 편입 표본의 +3/+5일이 현행 강한매수(59/62) 이상이고 전·후반 둘 다 기준선 위일 때만 통과.');
}

/* ═══ M. 외부 산식 근사 가점 (2026-09-03 사용자 "유의미하면 승률에도 반영 — 가점으로?") ═════
   external-lab 단독 승률은 통과했지만, 우리 산식에 가점으로 얹으면 '새로 들어오는 표본'이
   현행 강한매수(57/59/62/61)보다 나은지는 별개다. raw.json hist에 ext_pair·ext_root(main.py snap)가
   있어야 한다 — 없으면 전부 0건으로 나온다. */
const VXNB_A = '  let vxnBonus=0;';
if (ONLY.has('M')) {
  console.log('\n══ M. 🔀 페어 리버설 · 🎯 Root 타격 가점 후보 (현행 v13 = 가점 없음)');
  const ext = expr => [[VXNB_A, `  let vxnBonus=(${expr});`]];
  const Mc = [
    ['M0 현행 (가점 없음)',                       {}],
    ['M1 페어 리버설 +0.5',                       { extra: ext('s.ext_pair===1?0.5:0') }],
    ['M2 Root 타격 +0.5',                        { extra: ext('s.ext_root===1?0.5:0') }],
    ['M3 둘 중 하나 +0.5',                        { extra: ext('(s.ext_pair===1||s.ext_root===1)?0.5:0') }],
    ['M4 둘 중 하나 +1.0',                        { extra: ext('(s.ext_pair===1||s.ext_root===1)?1.0:0') }],
    ['M5 둘 중 하나 +0.3 (이웃값)',                { extra: ext('(s.ext_pair===1||s.ext_root===1)?0.3:0') }],
  ];
  const R = runSet(Mc); const P0 = R.get(Mc[0][0]);
  const n = RAW ? (JSON.parse(RAW).stocks || []).reduce((a, x) => a + (x.hist || []).filter(h => h[(JSON.parse(RAW).hist_fields || []).indexOf('ext_pair')] === 1).length, 0) : 0;
  console.log(`  (raw.json에 ext_pair=1인 hist 행 ${n}개 — 0이면 main.py 갱신 전 원본이다)`);
  for (const [nm] of Mc) report(nm, R.get(nm), nm === Mc[0][0] ? null : P0, 'sb', '🟢 강한매수', [['💡 강한다중', 'strict'], ['🔵 다중', 'multi'], ['📈 추세 강매', 'pull5'], ['🔄 반등 강매', 'rev5']]);
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
}

/* ═══ N. 적중률 하위 종목 맞춤 필터 (2026-09-03 사용자 "AIT·애플·인텔·포엣은 그 종목만 다른 필터") ═════
   전례: 빅테크·전기차 밴드 상한 55(BAND_CAP_CATS) — 점수 문턱이 아니라 '자리'로 잘랐다.
   여기서는 지목된 4종목에만 조건을 얹어 그 종목들의 강한매수(등급5) 승률이 어떻게 바뀌는지
   종목별로 센다. 표본이 종목당 10~40건이라 §5-1 '참고~방향만'이다 — 넷을 합쳐서도 본다. */
const BCAP_A = '  const buyGrade=Math.min(Math.max(pullGrade,revGrade), bandCapOK ? 5 : 4);';
const N_TK = ['AIT', 'AAPL', 'INTC', 'POET'];
if (ONLY.has('N')) {
  console.log('\n══ N. 적중률 하위 4종목(AIT·AAPL·INTC·POET) 맞춤 필터 — 그 종목의 강한매수만 바뀐다');
  const tkCond = expr => [[BCAP_A, `  const __nt = ${JSON.stringify(N_TK)}.includes(s.ticker);\n  const buyGrade=Math.min(Math.max(pullGrade,revGrade), (bandCapOK && (!__nt || (${expr}))) ? 5 : 4);`]];
  const Nc = [
    ['N0 현행',                              {}],
    ['N1 볼밴≤55 (빅테크식 상한)',              { extra: tkCond('has(bb) && bb<=55') }],
    ['N2 볼밴≤40',                          { extra: tkCond('has(bb) && bb<=40') }],
    ['N3 RSI≤45',                           { extra: tkCond('has(rsi) && rsi<=45') }],
    ['N4 20일선 위',                          { extra: tkCond('has(p) && has(ma20) && p>ma20') }],
    ['N5 50일선 위',                          { extra: tkCond('has(p) && has(s.ma50) && p>s.ma50') }],
    ['N6 거래량 1.2배 이상',                    { extra: tkCond('has(vr) && vr>=1.2') }],
    ['N7 반등 축만 (추세 강매 금지)',             { extra: tkCond('revGrade===5') }],
    ['N8 추세 축만 (반등 강매 금지)',             { extra: tkCond('pullGrade===5') }],
    ['N9 강한매수 금지 (관심까지만)',              { extra: tkCond('false') }],
    ['N10 볼밴≤55 & RSI≤50',                 { extra: tkCond('has(bb) && bb<=55 && has(rsi) && rsi<=50') }],
  ];
  const R = runSet(Nc); const P0 = R.get(Nc[0][0]);
  const per = (v) => { const out = {}; for (const h of HZ) { const rows = rowsOf(v.full, 'sb', h); for (const tk of N_TK.concat(['ALL4'])) { const r = rows.filter(x => tk === 'ALL4' ? N_TK.includes(x.ticker) : x.ticker === tk); const w = r.filter(x => x.ret > 1).length, l = r.filter(x => x.ret < -1).length; out[tk] = out[tk] || {}; out[tk][h] = { n: r.length, rate: (w + l) ? Math.round(w / (w + l) * 100) : null }; } } return out; };
  const base = per(P0);
  for (const [nm] of Nc) {
    const v = R.get(nm); const t = per(v);
    console.log(`\n  ${nm}`);
    for (const tk of N_TK.concat(['ALL4'])) {
      const cells = HZ.map(h => { const c = t[tk][h], b = base[tk][h]; const d = (c.rate != null && b.rate != null && nm !== Nc[0][0]) ? ` ${c.rate - b.rate >= 0 ? '+' : ''}${c.rate - b.rate}p` : ''; return `${c.rate == null ? ' —' : String(c.rate).padStart(3) + '%'}(${String(c.n).padStart(3)})${d}`.padEnd(14); });
      console.log(`    ${tk.padEnd(6)} ${cells.join(' ')}`);
    }
  }
  const b = P0.full._baseline; console.log(`\n  (기준선 전 종목 ${HZ.map(h => `${b[h].rate}%`).join('/')}) · 칸 = 승률(표본) 현행 대비 · +1/+3/+5/+7일`);
  console.log('  ※ 종목당 표본이 15건 미만이면 신뢰 불가(§5-1). ALL4(넷 합산) 30건 이상일 때만 방향으로 본다.');
}

/* ═══ P. 추세 강매 점수 문턱의 이웃값 — §3 고원 검사 (v15에서 2.0 채택) ═════ */
if (ONLY.has('P')) {
  console.log('\n══ P. 📈 추세 강매 점수 문턱 이웃값 (현행 2.0 — v15)');
  const pg = v => ({ extra: [[PG_A, `const pullGrade = pullSetup && pullScore>=${v} && sectorOK && tickerOK && nearHighM && pullChase && pullBandOK ? 5 :`]] });
  /* 2026-09-04: 내리는 쪽(1.0~1.4)은 v14에서 철회했다. 올리는 쪽을 재서 2.0을 채택(v15).
     P0가 현행(2.0)이므로 아래 이웃값은 v15 기준의 위·아래다. */
  const Pc = [['P0 현행 2.0', {}], ['P1 1.5 (v13 옛 문턱)', pg(1.5)], ['P2 1.8', pg(1.8)], ['P3 2.2', pg(2.2)], ['P4 2.5', pg(2.5)], ['P5 3.0', pg(3.0)]];
  const R = runSet(Pc); const P0 = R.get(Pc[0][0]);
  for (const [nm] of Pc) {
    const v = R.get(nm);
    report(nm, v, nm === Pc[0][0] ? null : P0, 'sb', '🟢 강한매수', [['💡 강한다중', 'strict'], ['🔵 다중', 'multi'], ['📈 추세 강매', 'pull5'], ['🔄 반등 강매', 'rev5']]);
    const days = new Set(rowsOf(v.full, 'sb', 1).map(x => x.date)).size;
    console.log(`    ${'· 강한매수 일수'.padEnd(14)}${days}일 / ${DAYS.length}일 · 하루 평균 ${(rowsOf(v.full, 'sb', 1).length / DAYS.length).toFixed(2)}건`);
  }
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
}

/* ═══ Q. 📈 추세 매수관심(등급4) 승률 올리기 — 다양한 데이터로 (2026-09-03 사용자 지시) ═════
   현행 등급4 = pullSetup & 점수≥0.8 & 볼밴>70. 189일 485건 52/50/55/59로 기준선(51/52/53/52)과 거의 같다 —
   '관심'이 정보가 없다는 뜻이다. 주봉·월봉·상대강도·자금흐름·갭·외부 산식·VXN 등을 하나씩 얹어
   지워지는 표본이 지는 표본인지, 남는 표본이 기준선을 넘는지 본다. */
const PIO_A = 'const pullInterestOK = has(bb) && bb>70 && (!has(s.rs20) || s.rs20>0);';
if (ONLY.has('Q')) {
  console.log('\n══ Q. 📈 추세 매수관심(등급4) 게이트 변형 — 현행 볼밴>70');
  const q = expr => ({ extra: [[PIO_A, `const pullInterestOK = has(bb) && bb>70 && (!has(s.rs20) || s.rs20>0) && (${expr});`]] });
  const Qc = [
    ['Q0 현행',                                   {}],
    ['Q1 + 주봉 20주선 위 (w_ma20_pos>0)',           q('has(s.w_ma20_pos) && s.w_ma20_pos>0')],
    ['Q2 + 주봉 양봉 연속 (w_streak>=1)',             q('has(s.w_streak) && s.w_streak>=1')],
    ['Q3 + 주봉 RSI 50 이상',                        q('has(s.w_rsi) && s.w_rsi>=50')],
    ['Q4 + 월봉 6개월선 위 (m_ma6_pos>0)',           q('has(s.m_ma6_pos) && s.m_ma6_pos>0')],
    ['Q5 + 시장 대비 강함 (rs20>0)',                 q('has(s.rs20) && s.rs20>0')],
    ['Q6 + 5일 자금유입≥0',                          q('(__INF(s) ?? 0) >= 0')],
    ['Q7 + 미메움 갭 있음 (gap20_fill<50)',           q('has(s.gap20_fill) && s.gap20_fill<50')],
    ['Q8 + 거래량 1배 이상',                          q('has(vr) && vr>=1.0')],
    ['Q9 + 점수 1.0 이상',                           q('pullScore>=1.0')],
    ['Q10 + VXN 25 미만 (평온한 날만)',               q('has(s.market_vxn) && s.market_vxn<25')],
    ['Q11 + 52주고점 −10% 이내',                     q('has(s.pct_from_high) && s.pct_from_high>=-10')],
    ['Q12 + 외부 산식(페어·Root) 표시 있음',           q('s.ext_pair===1 || s.ext_root===1')],
    ['Q13 + 주봉 20주선 위 & rs20>0',                 q('has(s.w_ma20_pos) && s.w_ma20_pos>0 && has(s.rs20) && s.rs20>0')],
    ['Q14 볼밴>70 대신 >60 (완화·반대시험)',          { extra: [[PIO_A, 'const pullInterestOK = has(bb) && bb>60;']] }],
  ];
  const R = runSet(Qc); const P0 = R.get(Qc[0][0]);
  for (const [nm] of Qc) report(nm, R.get(nm), nm === Qc[0][0] ? null : P0, 'pull4', '📈 추세 관심', [['🟢 강한매수', 'sb'], ['🔵 다중', 'multi'], ['💡 강한다중', 'strict']]);
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
  console.log('  ※ 판정: 남는 표본이 기준선 +5%p 이상 · 지워지는 표본이 기준선 이하 · 전·후반 통과 · n≥50.');
}

/* ═══ R. 🔀🎯 외부 산식을 '매수관심(등급4)' 출처로 (2026-09-03 사용자 "적중률 좋은데 반영해야") ═════
   가점(M)은 새 표본 0~4건이라 무효였다. 점수를 거치지 않고 신호 자체를 등급4로 올리면
   어떤 표본이 들어오는지 본다. rev4 계층에 얹는다(반등 관심 = 볼밴≤40 또는 외부 산식). */
if (ONLY.has('R')) {
  console.log('\n══ R. 외부 산식 신호를 매수관심(등급4)으로 — rev4 계층');
  const base = (s, rev, bb) => rev >= 2.0 && bb != null && bb <= 40;
  const Rc = [
    ['R0 현행 (볼밴≤40)',                       {}],
    ['R1 + 페어 리버설 또는 Root 타격이면 관심',    { rev4: (s, rev, bb) => base(s, rev, bb) || s.ext_pair === 1 || s.ext_root === 1 }],
    ['R2 + 페어 리버설만',                        { rev4: (s, rev, bb) => base(s, rev, bb) || s.ext_pair === 1 }],
    ['R3 + Root 타격만',                          { rev4: (s, rev, bb) => base(s, rev, bb) || s.ext_root === 1 }],
    ['R4 외부 산식 & 반등≥1.0 (점수 최소 요건)',      { rev4: (s, rev, bb) => base(s, rev, bb) || ((s.ext_pair === 1 || s.ext_root === 1) && rev >= 1.0) }],
  ];
  const R = runSet(Rc); const P0 = R.get(Rc[0][0]);
  for (const [nm] of Rc) report(nm, R.get(nm), nm === Rc[0][0] ? null : P0, 'rev4', '🔄 반등 관심', [['🟢 강한매수', 'sb'], ['🔵 다중', 'multi'], ['📈 추세 관심', 'pull4']]);
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
}

const PS_A = 'const pullSetup = dipSoft || dipHard || resting || dumpRecovered;';
const CAT = new Map((base.stocks || []).map(x => [x.ticker, x.category || '']));
/* 계층별 표본을 티커 그룹으로 갈라 본다(섹터·개별주 보정용). */
function byGroup(v, layer, pick) {
  const out = {};
  for (const h of HZ) for (const r of rowsOf(v.full, layer, h)) {
    const g = pick(r.ticker); if (!g) continue;
    (out[g] = out[g] || {})[h] = (out[g][h] || []); out[g][h].push(r);
  }
  return out;
}
const rateOf = rows => { const w = rows.filter(x => x.ret > 1).length, l = rows.filter(x => x.ret < -1).length; return { rate: (w + l) ? Math.round(w / (w + l) * 100) : null, n: rows.length, wl: w + l }; };
/* 윌슨 95% 신뢰구간 — 표본이 작을 때 '70%'가 실제로 얼마나 넓은 구간인지 같이 보여준다(§5-10).
   예: 10건 7승 3패 → 70% [39~90]. 이 폭을 감추면 우연을 실력으로 읽게 된다. */
function wilson(rows) {
  const w = rows.filter(x => x.ret > 1).length, l = rows.filter(x => x.ret < -1).length, n = w + l;
  if (!n) return null;
  const z = 1.96, p = w / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [Math.round(Math.max(0, c - h) * 100), Math.round(Math.min(1, c + h) * 100)];
}
function groupLine(label, v, layer, pick, keys, baseG) {
  const g = byGroup(v, layer, pick);
  for (const k of keys) {
    const raw = HZ.map(h => (g[k] || {})[h] || []);
    const cells = HZ.map((h, i) => {
      const c = rateOf(raw[i]); const b = baseG ? rateOf((baseG[k] || {})[h] || []) : null;
      const d = (b && c.rate != null && b.rate != null) ? ` ${c.rate - b.rate >= 0 ? '+' : ''}${c.rate - b.rate}p` : '';
      return `${c.rate == null ? '  —' : String(c.rate).padStart(3) + '%'}(${String(c.n).padStart(3)})${d}`.padEnd(14);
    });
    console.log(`    ${k.padEnd(14)} ${cells.join(' ')}`);
    /* 표본이 50건 미만이면(§5-1 '사용 가능' 미만) 신뢰구간을 한 줄 더 찍는다. */
    if (raw.some(r => rateOf(r).wl && rateOf(r).wl < 50)) {
      const ci = raw.map(r => { const x = wilson(r); return (x ? `[${x[0]}~${x[1]}]` : '   —   ').padEnd(14); });
      console.log(`    ${'  ↳ 95% 구간'.padEnd(14)} ${ci.join(' ')}`);
    }
  }
  return g;
}

/* ═══ S. 📈 추세 강한매수(pull5) 승률 올리기 — 다양한 방식 (2026-09-04 사용자 지시) ═════
   현행 189일 395건 54/58/65/64(기준선 51/52/53/52). 게이트를 하나씩 얹어 '지워지는 표본이
   지는 표본인가'(§5-5)와 남는 표본의 개선폭을 본다. */
if (ONLY.has('S')) {
  console.log('\n══ S. 📈 추세 강한매수 게이트 변형 (현행 = 눌림셋업 & 점수≥2.0 & 섹터 & 52주고점-25% & 추격 & 볼밴≤80 — v15)');
  const pg = expr => ({ extra: [[PG_A, `const pullGrade = pullSetup && pullScore>=2.0 && sectorOK && tickerOK && nearHighM && pullChase && pullBandOK && (${expr}) ? 5 :`]] });
  const Sc = [
    ['S0 현행',                          {}],
    ['S1 볼밴≤65',                       pg('has(bb) && bb<=65')],
    ['S2 볼밴≤55',                       pg('has(bb) && bb<=55')],
    ['S3 RSI≤65',                        pg('has(rsi) && rsi<=65')],
    ['S4 시장 대비 강함 rs20>0',           pg('!has(s.rs20) || s.rs20>0')],
    ['S5 주봉 20주선 위',                  pg('has(s.w_ma20_pos) && s.w_ma20_pos>0')],
    ['S6 조용한 눌림(거래량 1.2배 이하)',    pg('has(vr) && vr<=1.2')],
    ['S7 20일선 기울기 상승',              pg('has(s.ma20_slope) && s.ma20_slope>0')],
    ['S8 52주고점 −10% 이내',              pg('has(s.pct_from_high) && s.pct_from_high>=-10')],
    ['S9 매도 소진(5일 자금유입≤0)',        pg('(__INF(s) ?? 0) <= 0')],
    ['S10 점수 2.5 이상 (v15 채택분의 한 칸 위)', pg('pullScore>=2.5')],
    ['S11 쉬어가기(resting) 제외',          { extra: [[PS_A, 'const pullSetup = dipSoft || dipHard || dumpRecovered;']] }],
    ['S12 200일선 위',                     pg('has(p) && has(s.ma200) && p>s.ma200')],
    ['S13 rs20>0 & 볼밴≤65',               pg('(!has(s.rs20) || s.rs20>0) && has(bb) && bb<=65')],
    ['S14 주봉 위 & 20일선 기울기 상승',     pg('has(s.w_ma20_pos) && s.w_ma20_pos>0 && has(s.ma20_slope) && s.ma20_slope>0')],
  ];
  const R = runSet(Sc); const P0 = R.get(Sc[0][0]);
  for (const [nm] of Sc) report(nm, R.get(nm), nm === Sc[0][0] ? null : P0, 'pull5', '📈 추세 강매', [['🟢 강한매수', 'sb'], ['💡 강한다중', 'strict'], ['🔵 다중', 'multi'], ['📈 추세 관심', 'pull4']]);
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
  console.log('  ※ 판정: 남는 표본 +5%p 이상 · 지워지는 표본이 기준선 이하 · 전·후반 통과 · n≥50 · 30일 원장 사전 확인.');
}

/* ═══ T. 🚀 우주·UAM 섹터 전용 보정 (2026-09-04 사용자 "우주섹터 승률 낮은데 특수성 고려") ═════
   빅테크·전기차 밴드 상한(BAND_CAP_CATS) 전례처럼 '점수'가 아니라 '자리'로 자른다.
   우주주는 뉴스·발사 일정에 튀는 고변동군이라 눌림/반등 산식이 잘 안 듣는다는 가설. */
const T_CAT = '우주·UAM';
if (ONLY.has('T')) {
  console.log(`\n══ T. 🚀 ${T_CAT} 섹터 전용 보정 — 그 섹터의 강한매수만 바뀐다`);
  const sp = expr => ({ extra: [[BCAP_A, `  const __sp = (s.category === ${JSON.stringify(T_CAT)});\n  const buyGrade=Math.min(Math.max(pullGrade,revGrade), (bandCapOK && (!__sp || (${expr}))) ? 5 : 4);`]] });
  const Tc = [
    ['T0 현행',                         {}],
    ['T1 강한매수 금지(관심까지)',         sp('false')],
    ['T2 볼밴≤55',                      sp('has(bb) && bb<=55')],
    ['T3 볼밴≤40',                      sp('has(bb) && bb<=40')],
    ['T4 RSI≤50',                       sp('has(rsi) && rsi<=50')],
    ['T5 반등 축만',                     sp('revGrade===5')],
    ['T6 추세 축만',                     sp('pullGrade===5')],
    ['T7 20일선 위',                     sp('has(p) && has(ma20) && p>ma20')],
    ['T8 거래량 1.5배 & 양봉',            sp('has(vr) && vr>=1.5 && has(s.change_1d) && s.change_1d>0')],
    ['T9 저변동(ATR% ≤ 6)',              sp('has(s.atr_pct) && s.atr_pct<=6')],
    ['T10 rs20>0',                      sp('has(s.rs20) && s.rs20>0')],
    ['T11 볼밴≤55 & rs20>0',             sp('has(bb) && bb<=55 && has(s.rs20) && s.rs20>0')],
  ];
  const R = runSet(Tc); const P0 = R.get(Tc[0][0]);
  const pick = tk => CAT.get(tk) === T_CAT ? T_CAT : '그 외';
  const base0 = byGroup(P0, 'sb', pick);
  for (const [nm] of Tc) {
    console.log(`\n  ${nm}`);
    groupLine(nm, R.get(nm), 'sb', pick, [T_CAT, '그 외'], base0);
  }
  const b = P0.full._baseline; console.log(`\n  (기준선 전 종목 ${HZ.map(h => `${b[h].rate}%`).join('/')}) · 칸 = 강한매수 승률(표본) 현행 대비 · +1/+3/+5/+7일`);
  console.log('  ※ 우주 섹터 표본이 30건 미만이면 방향만, 15건 미만이면 판단하지 않는다.');
}

/* ═══ U. 🎯 개별주 맞춤 보정 — POET·INTC·AAPL (2026-09-04 사용자 지시) ═════
   N(4종목)에서 표본 부족이었다. 이번엔 --years 3 원본으로 돌려 표본을 3~4배로 늘려 다시 본다. */
const U_TK = ['POET', 'INTC', 'AAPL'];
if (ONLY.has('U')) {
  console.log(`\n══ U. 🎯 개별주 맞춤 보정 (${U_TK.join('·')}) — 그 종목의 강한매수만 바뀐다`);
  const ut = expr => ({ extra: [[BCAP_A, `  const __ut = ${JSON.stringify(U_TK)}.includes(s.ticker);\n  const buyGrade=Math.min(Math.max(pullGrade,revGrade), (bandCapOK && (!__ut || (${expr}))) ? 5 : 4);`]] });
  const Uc = [
    ['U0 현행',                         {}],
    ['U1 볼밴≤55',                      ut('has(bb) && bb<=55')],
    ['U2 볼밴≤40',                      ut('has(bb) && bb<=40')],
    ['U3 RSI≤45',                       ut('has(rsi) && rsi<=45')],
    ['U4 20일선 위',                     ut('has(p) && has(ma20) && p>ma20')],
    ['U5 거래량 1.2배 & 양봉',            ut('has(vr) && vr>=1.2 && has(s.change_1d) && s.change_1d>0')],
    ['U6 반등 축만',                     ut('revGrade===5')],
    ['U7 추세 축만',                     ut('pullGrade===5')],
    ['U8 rs20>0',                       ut('has(s.rs20) && s.rs20>0')],
    ['U9 강한매수 금지',                  ut('false')],
    ['U10 볼밴≤55 & rs20>0',             ut('has(bb) && bb<=55 && has(s.rs20) && s.rs20>0')],
    ['U11 매도 소진(자금유입≤0)',          ut('(__INF(s) ?? 0) <= 0')],
  ];
  const R = runSet(Uc); const P0 = R.get(Uc[0][0]);
  const pick = tk => U_TK.includes(tk) ? tk : null;
  const pickAll = tk => U_TK.includes(tk) ? '3종합산' : null;
  const b0 = byGroup(P0, 'sb', pick), b0a = byGroup(P0, 'sb', pickAll);
  for (const [nm] of Uc) {
    console.log(`\n  ${nm}`);
    groupLine(nm, R.get(nm), 'sb', pick, U_TK, b0);
    groupLine(nm, R.get(nm), 'sb', pickAll, ['3종합산'], b0a);
  }
  const b = P0.full._baseline; console.log(`\n  (기준선 전 종목 ${HZ.map(h => `${b[h].rate}%`).join('/')}) · 칸 = 강한매수 승률(표본) 현행 대비`);
}


/* ═══ V. 🚧 국면 섹터 게이트 완충대 — 0.006% 차이로 신호가 사라지는 절벽 (2026-09-04) ═════
   2026-09-04 실측: QQQ 717.67 vs 20일선 717.71(−0.0056%)로 국면이 caution이 되어
   82종 중 73종이 강한매수에서 원천 차단됐다(반등점수 2.0 이상 9종목 전원 탈락, 강한매수 0건).
   §3(고원 vs 절벽) 기준으로 판정이 칼날 위에 서 있다. 게이트를 '푸는' 게 아니라
   '완충대를 다는' 쪽으로 후보를 만든다. 관심 계층(4등급)도 같이 찍어 §5-7 역전을 본다. */
if (ONLY.has('V')) {
  console.log('\n══ V. 🚧 국면 섹터 게이트 완충대 (현행 = weak·caution이면 방어섹터만 강한매수)');
  const mg = expr => ({ extra: [[MG_A, `const marketGuarded = ${expr};`]] });
  const Vc = [
    ['V0 현행 (weak·caution 둘 다 게이트)', {}],
    ['V1 weak만 게이트 (caution 해제)',      mg('s.market_level==="weak"')],
    ['V2 caution은 20일수익 0% 이상이면 해제', mg('s.market_level==="weak" || (s.market_level==="caution" && !(has(s.market_ret20) && s.market_ret20>=0))')],
    ['V3 caution은 20일수익 −2% 이상이면 해제', mg('s.market_level==="weak" || (s.market_level==="caution" && !(has(s.market_ret20) && s.market_ret20>=-2))')],
    ['V4 weak도 20일수익 −5% 밑일 때만 게이트', mg('(s.market_level==="weak" && has(s.market_ret20) && s.market_ret20<-5)')],
    ['V5 게이트 전면 해제 (대조군)',           mg('false')],
    /* 게이트를 풀면 질이 떨어지는지 — 푸는 대신 볼밴 하단만 허용하는 절충안 */
    ['V6 caution 해제 + 볼밴≤55만',          { extra: [[MG_A, 'const marketGuarded = s.market_level==="weak";'],
      ['const sectorOK = !marketGuarded || DEFENSIVE_CATS.includes(s.category);',
       'const sectorOK = (!marketGuarded || DEFENSIVE_CATS.includes(s.category)) && (s.market_level!=="caution" || (has(bb) && bb<=55));']] }],
  ];
  const R = runSet(Vc); const P0 = R.get(Vc[0][0]);
  const LAYERS = [['💡 강한다중','strict'],['🔵 다중','multi'],['📈 추세 강매','pull5'],['🔄 반등 강매','rev5'],
                  ['📈 추세 관심','pull4'],['🔄 반등 관심','rev4']];
  for (const [nm] of Vc) {
    const v = R.get(nm);
    report(nm, v, nm === Vc[0][0] ? null : P0, 'sb', '🟢 강한매수', LAYERS);
    const days = new Set(rowsOf(v.full, 'sb', 1).map(x => x.date)).size;
    console.log(`    ${'· 강한매수 일수'.padEnd(14)}${days}일 / ${DAYS.length}일 · 하루 평균 ${(rowsOf(v.full, 'sb', 1).length / DAYS.length).toFixed(2)}건`);
  }
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
  console.log('  ※ 판정: 새로 편입되는 표본이 현행 강한매수 이상 · 💡/🔵 안 무너짐 · §2 전·후반 통과 · 30일 원장 사전 확인.');
}

/* ═══ W. 🔄 관심 계층(4등급)이 강한매수(5등급)보다 나은가 — §5-7 계층 역전 검사 ═════
   2026-09-04 사용자 지적: 화면 30일 원장에서 반등 매수관심 +5일 89%(41건) vs
   반등 강한매수 56%(85건). 등급이 뒤집혀 있다. 30일은 한 국면이므로 189일에서 확인한다. */
if (ONLY.has('W')) {
  console.log('\n══ W. 🔄 계층 역전 검사 — 관심(4등급) vs 강한매수(5등급)');
  const R = runSet([['W0 현행', {}]]); const v = R.get('W0 현행');
  const rows = [['🟢 강한매수','sb'],['💡 강한다중','strict'],['🔵 다중','multi'],
                ['📈 추세 강매','pull5'],['📈 추세 관심','pull4'],
                ['🔄 반등 강매','rev5'],['🔄 반등 관심','rev4'],['기준선','base']];
  console.log('    ' + '층'.padEnd(14) + HZ.map(h => `+${h}일`.padStart(14)).join(''));
  for (const [lbl, layer] of rows) {
    const cells = HZ.map(h => { const x = st(v.full, layer, h); return cell(x, null); });
    console.log(`    ${lbl.padEnd(14)}${cells.join('')}`);
    const cis = HZ.map(h => { const arr = rowsOf(v.full, layer, h); const x = wilson(arr); return (x ? `[${x[0]}~${x[1]}]` : '   —   ').padStart(14); });
    console.log(`    ${'  ↳ 95% 구간'.padEnd(14)}${cis.join('')}`);
    const a = HZ.map(h => { const x = st(v.h1, layer, h), y = st(v.h2, layer, h);
      return `${x.rate==null?'—':x.rate}/${y.rate==null?'—':y.rate}`.padStart(14); });
    console.log(`    ${'  ↳ 전반/후반'.padEnd(14)}${a.join('')}`);
  }
  console.log('\n  ※ 관심이 강매보다 높고 그게 전·후반 둘 다이며 신뢰구간이 안 겹치면 계층을 손봐야 한다(§5-7).');
}


/* ═══ Y. 🔄 반등 강한매수를 고친다 — 강한매수 전체를 끌어내리는 유일한 축 (2026-09-04) ═════
   사용자 지적 둘이 같은 곳을 가리킨다:
     ① "강한매수 +5일 59%는 심각하다, 70%는 넘어야지"
     ② "반등 강매와 반등 관심이 차이 안 나는 건 해결됐나"
   189일 실측: 추세 강매 252건 68%[62~74] · 반등 강매 522건 60%[56~65] · 반등 관심 247건 59%[53~65].
   강한매수 748건의 70%가 반등이라 전체가 63%로 끌려간다. 그리고 반등은 4등급과 5등급이
   신뢰구간이 완전히 겹쳐 '등급이 정보를 안 준다'. 두 문제의 범인이 같다 — 반등 축이다.
   목표: 반등 강매 +5일 70%+ 를 만들되 ① 지워지는 표본이 실제로 지고 ② 전·후반 둘 다
   ③ 신호 수를 얼마나 잃는지 같이 찍는다. 신호가 반토막 나면 통과여도 사용자 결정 사항이다. */
if (ONLY.has('Y')) {
  console.log('\n══ Y. 🔄 반등 강한매수 게이트 변형 (현행 = 반등점수≥2.0 & RSI조건 & 섹터 & 종목보정 & 추격아님)');
  const rt = v => ({ extra: [[RS_A, `const revStrong = revScore>=${v} && has(rsi) && revRsiOK && sectorOK && tickerOK && revChase;`]] });
  const ry = expr => ({ extra: [[RS_A, `const revStrong = revScore>=2.0 && has(rsi) && revRsiOK && sectorOK && tickerOK && revChase && (${expr});`]] });
  const both = (v, expr) => ({ extra: [[RS_A, `const revStrong = revScore>=${v} && has(rsi) && revRsiOK && sectorOK && tickerOK && revChase && (${expr});`]] });
  const Yc = [
    ['Y0 현행',                            {}],
    ['Y1 반등점수 ≥2.5',                    rt(2.5)],
    ['Y2 반등점수 ≥3.0',                    rt(3.0)],
    ['Y3 + 볼밴 ≤35 (밴드 바닥)',            ry('has(bb) && bb<=35')],
    ['Y4 + 볼밴 ≤50',                       ry('has(bb) && bb<=50')],
    ['Y5 + RSI ≤40',                        ry('has(rsi) && rsi<=40')],
    ['Y6 + 시장보다 강함 rs20>0',            ry('!has(s.rs20) || s.rs20>0')],
    ['Y7 + 20일선 위 (추세 살아있는 반등)',    ry('has(p) && has(ma20) && p>ma20')],
    ['Y8 + 60일선 위',                       ry('has(p) && has(ma60) && p>ma60')],
    ['Y9 + 52주고점 −25% 이내',              ry('has(s.pct_from_high) && s.pct_from_high>=-25')],
    ['Y10 + 거래량 1.2배 이상',              ry('has(vr) && vr>=1.2')],
    ['Y11 + 공포 구간 VXN ≥25',              ry('has(s.market_vxn) && s.market_vxn>=25')],
    ['Y12 + 국면 strong·neutral',            ry('s.market_level==="strong" || s.market_level==="neutral"')],
    ['Y13 + 매도 소진(5일 자금유입 ≤0)',      ry('(__INF(s) ?? 0) <= 0')],
    ['Y14 ≥2.5 & 볼밴≤50',                  both(2.5, 'has(bb) && bb<=50')],
    ['Y15 ≥2.5 & 20일선 위',                both(2.5, 'has(p) && has(ma20) && p>ma20')],
    ['Y16 ≥2.5 & rs20>0',                   both(2.5, '!has(s.rs20) || s.rs20>0')],
  ];
  const R = runSet(Yc); const P0 = R.get(Yc[0][0]);
  for (const [nm] of Yc) {
    const v = R.get(nm);
    report(nm, v, nm === Yc[0][0] ? null : P0, 'rev5', '🔄 반등 강매',
      [['🟢 강한매수 전체', 'sb'], ['🔄 반등 관심', 'rev4'], ['💡 강한다중', 'strict'], ['🔵 다중', 'multi']]);
    const n = rowsOf(v.full, 'rev5', 5).length, n0 = rowsOf(P0.full, 'rev5', 5).length;
    console.log(`    ${'· 반등 강매 수'.padEnd(14)}${n}건 (현행 ${n0}건 대비 ${n0 ? Math.round(n / n0 * 100) : 0}%) · 하루 평균 ${(rowsOf(v.full, 'rev5', 1).length / DAYS.length).toFixed(2)}건`);
  }
  const b = P0.full._baseline; console.log(`\n  (기준선 ${HZ.map(h => `${b[h].rate}%`).join('/')})`);
  console.log('  ※ 목표 +5일 70%+. 판정: 지워지는 표본이 기준선 이하 · 전·후반 둘 다 70% 근처 · n≥50 · 30일 원장 사전 확인.');
  console.log('    신호 수가 반토막 이하로 줄면 통계가 통과해도 사용자 결정 사항으로 넘긴다.');
}

console.log(`\n※ 후보 A 13종 · B 13종 · C 10종 · 지표 12종 · E 6종 · F 13종 · G 7종 · H 3종 · L 11종 · M 5종 · N 10종 · P 4종 · Q 14종 · R 4종 · S 15종 · T 12종 · U 12종 · V 7종 · W 1종 · Y 17종 — 다중비교. 통과한 것도 다음 사이클 재확인 후에 쓴다.`);
console.log('  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.');
