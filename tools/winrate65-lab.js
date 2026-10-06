#!/usr/bin/env node
/**
 * 강한매수 승률 65% 경우의 수 탐색 (읽기 전용 · 아무 파일도 안 고친다)
 *
 * 왜 (2026-10-06 사용자 지시: "승률 최근 1년 기준 65%는 넘기는 경우의 수 탐색")
 *
 * 방법
 *   1. index.html을 통째로 올려(§0) strategyValidation()의 기준선 표본(실적 제외 규칙 적용 후
 *      전 종목×날짜)을 행 단위로 꺼낸다. evaluate() 반환값에 내부 관문 값(_f)만 덧붙인다 —
 *      판정 자체는 화면 산식 그대로다.
 *   2. 바탕(base) = 현행 강한매수(grade 5) / 추세만 / 반등만 / 바닥권 해제 변형(A_full30).
 *      바탕 위에 조건 1~2개를 AND로 얹는 조합을 전수로 센다.
 *   3. 다중비교 방어: 시간순으로 앞 2/3(탐색)에서 고르고 뒤 1/3(확인)에서 다시 잰다.
 *      확인 구간은 탐색에 쓰지 않는다. 몇 개를 훑었고 몇 개가 확인을 통과했는지 같이 찍는다.
 *   4. 판정: 탐색·확인 모두 +3·+5일 ≥65%, 표본 탐색 40+·확인 20+, 평균수익이 현행 이상,
 *      §2 전·후반(1년을 반으로) 모두 기준선 초과, §3 이웃 문턱도 ≥62%, 하루 신호 수.
 *
 * 승률 = (+1% 초과) / (+1% 초과 + −1% 미만). 보합 제외 — 화면 stat()과 같다.
 * 입력  backtest/raw.json (CI: lab-quick.yml years=2 days=252) · 로컬 시험은 signals.json
 * 사용  node tools/winrate65-lab.js backtest/raw.json [--top 40]
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'signals.json';
const TOP = process.argv.includes('--top') ? +process.argv[process.argv.indexOf('--top') + 1] : 40;
const t0 = Date.now();
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
const F = base.hist_fields;
const ix = k => { const i = F.indexOf(k); if (i < 0) H.die(`hist_fields에 ${k} 없음`); return i; };
const iD = ix('date'), iP = ix('price'), iM20 = ix('ma20'), iRS = ix('rs20'), iV = ix('market_vxn');

/* ── VXN 주입 (raw.json은 macro.vxn에만 있다 — rebalance-lab.js와 같은 처리) ── */
const VXN = ((base.macro || {}).vxn) || {};
let vfill = 0;
for (const s of base.stocks) for (const r of s.hist || []) {
  while (r.length <= iV) r.push(null);
  if (r[iV] == null && VXN[r[iD]] != null) { r[iV] = +VXN[r[iD]]; vfill++; }
}

/* ── 파생: 유니버스 폭(MA20 위 %) · 중위 rs20 · QQQ 연속 하락 (그날 종가까지의 값만) ── */
const us = base.stocks.filter(s => s.currency === 'USD' || !/\.K[SQ]$/.test(s.ticker || ''));
const byd = {};
us.forEach(s => (s.hist || []).forEach(r => { if (r[iD]) (byd[r[iD]] = byd[r[iD]] || []).push(r); }));
const med = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const U = {};
for (const [d, rs] of Object.entries(byd)) {
  const v = rs.filter(r => r[iP] != null && r[iM20] != null);
  U[d] = { br: v.length >= 20 ? Math.round(100 * v.filter(r => r[iP] > r[iM20]).length / v.length) : null,
           rs: med(rs.map(r => r[iRS]).filter(x => x != null)) };
}
const QS = {};
{ const qh = ((base.qqq_card || {}).hist || []).filter(r => r && r[iD]);
  let n = 0; qh.forEach((r, i) => { n = (i && r[iP] < qh[i - 1][iP]) ? n + 1 : 0; QS[r[iD]] = n; }); }
const XF = ['x_breadth', 'x_medrs', 'x_qstreak'];
base.hist_fields = F.concat(XF);
base.stocks.forEach(s => (s.hist || []).forEach(r => { while (r.length < F.length) r.push(null);
  const u = U[r[iD]] || {}; r.push(u.br ?? null, u.rs ?? null, QS[r[iD]] ?? null); }));
const RAW = JSON.stringify(base);

/* ── 산식 변형 (evaluate 문자열 치환 — 바탕 집합용) ── */
const GUARD = 'const marketGuarded = s.market_level==="weak" ||';
const GUARD2 = '(s.market_level==="caution" && !(has(s.market_ret20) && s.market_ret20 >= -2));';
const FEAR = 'const vxnFear = has(s.market_vxn) && s.market_vxn>=25;';
const VARIANTS = {
  '현행': [],
  'A30': [[GUARD, 'const marketGuarded = !(has(s.x_breadth) && s.x_breadth<30) && (s.market_level==="weak" ||'], [GUARD2, GUARD2.slice(0, -1) + ');'],
          [FEAR, 'const vxnFear = (has(s.market_vxn) && s.market_vxn>=25) || (has(s.x_breadth) && s.x_breadth<30);']],
};
/* evaluate 반환에 내부 관문 값을 덧붙인다(판정은 그대로). */
const RET = 'return { score, buyScore, trendScore, breakScore, pullScore, revScore, breakGrade, pullGrade, revGrade,';
const RET_X = 'return { _f:{ sectorOK, marketGuarded, pullSetup, dipSoft, dipHard, resting, bull, a20, a60, rising, breakout, vxnFear, nearHighM, pullChase, pullBandOK, revRsiOK, revChase, bandCapOK }, score, buyScore, trendScore, breakScore, pullScore, revScore, breakGrade, pullGrade, revGrade,';
const BASEPUSH = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});';
const orig = H.extractFunction('evaluate');

function collect(changes) {
  let src = orig;
  for (const [a, b] of changes.concat([[RET, RET_X]])) { if (!src.includes(a)) H.die('앵커 없음: ' + a.slice(0, 60)); src = src.replace(a, b); }
  const page = H.loadPage({ patch: [[orig, src],
    ['market_vxn: num(o.market_vxn),', 'market_vxn: num(o.market_vxn), ' + XF.map(k => `${k}: num(o.${k}),`).join(' ')],
    [BASEPUSH, 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date, row});']] });
  page.runInPage(`this.__run = j => { state.data = normalize(JSON.parse(j)); const r = strategyValidation();
    const recs = new Map();
    [1,3,5].forEach(h => (r._phaseRows.base[h]||[]).forEach(x => { const w = x.row, k = w.ticker+'|'+x.date;
      if (!recs.has(k)) recs.set(k, { t:w.ticker, d:x.date, c:w.category, s:w.sig, w, r:{} }); recs.get(k).r[h] = x.ret; }));
    return [...recs.values()].map(o => { const w=o.w, s=o.s; return { t:o.t, d:o.d, c:o.c, r:o.r,
      g:s.grade, pg:s.pullGrade, rg:s.revGrade, ps:s.pullScore, rsc:s.revScore, f:s._f,
      rsi:w.rsi, bb:w.bb_pos, rs20:w.rs20, ret20:w.ret20, pfh:w.pct_from_high, vr:w.vol_ratio, atr:w.atr_pct,
      chg:w.change_1d, run3:w.run3_sum, sk:w.stoch_k, macd:w.macd, p:w.price, ma20:w.ma20, ma50:w.ma50, ma200:w.ma200, ma200s:w.ma200_slope,
      wrsi:w.w_rsi, wpos:w.w_ma20_pos, mpos:w.m_ma6_pos, slope:w.ma20_slope, gap:w.gap_pct, pfl:w.pct_from_low,
      lvl:w.market_level, mret:w.market_ret20, vxn:w.market_vxn, br:w.x_breadth, mrs:w.x_medrs, qs:w.x_qstreak }; }); };`);
  return page.__run(RAW);
}

/* ── 통계 ── */
const st = (a, h) => { let w = 0, l = 0, s = 0, n = 0; for (const x of a) { const v = x.r[h]; if (v == null) continue; n++; s += v; if (v > 1) w++; else if (v < -1) l++; }
  return { n, rate: w + l ? 100 * w / (w + l) : null, avg: n ? s / n : null }; };
const f1 = s => s.n ? `${s.rate == null ? ' —' : Math.round(s.rate).toString().padStart(3)}%(${String(s.n).padStart(4)})${(s.avg >= 0 ? '+' : '') + s.avg.toFixed(2)}` : '   —(   0)     ';

const recsByVar = {};
for (const [k, ch] of Object.entries(VARIANTS)) recsByVar[k] = collect(ch);
const ALL = recsByVar['현행'];
const dates = [...new Set(ALL.map(x => x.d))].sort();
const cut = dates[Math.floor(dates.length * 2 / 3)], mid = dates[Math.floor(dates.length / 2)];
const nDays = dates.length;
console.log(`■ 입력 ${IN} · 신호일 ${dates[0]}~${dates[nDays - 1]} (${nDays}일) · VXN 주입 ${vfill}칸 · 탐색 <${cut} | 확인 ≥${cut} · 반쪽 경계 ${mid}`);
const BL = { all: ALL, tr: ALL.filter(x => x.d < cut), te: ALL.filter(x => x.d >= cut), h1: ALL.filter(x => x.d < mid), h2: ALL.filter(x => x.d >= mid) };
console.log(`  기준선(전 종목) +1 ${f1(st(ALL, 1))} · +3 ${f1(st(ALL, 3))} · +5 ${f1(st(ALL, 5))} | 탐색 +3 ${f1(st(BL.tr, 3))} · 확인 +3 ${f1(st(BL.te, 3))} | 전반 +3 ${f1(st(BL.h1, 3))} · 후반 +3 ${f1(st(BL.h2, 3))}`);

/* ── 바탕 집합 ── */
const BASES = {
  '강매(현행)': recsByVar['현행'].filter(x => x.g === 5),
  '추세강매': recsByVar['현행'].filter(x => x.pg === 5),
  '반등강매': recsByVar['현행'].filter(x => x.rg === 5),
  '강매+A30': recsByVar['A30'].filter(x => x.g === 5),
  '관심이상(4+)': recsByVar['현행'].filter(x => x.g >= 4),
};
console.log(`\n■ 바탕 집합 — 1년 · +1 | +3 | +5 · 전반/후반 +5 · 하루 평균 신호`);
for (const [k, a] of Object.entries(BASES))
  console.log(`  ${k.padEnd(12)} ${f1(st(a, 1))} | ${f1(st(a, 3))} | ${f1(st(a, 5))} | 전반 ${f1(st(a.filter(x => x.d < mid), 5))} 후반 ${f1(st(a.filter(x => x.d >= mid), 5))} | ${(a.length / nDays).toFixed(2)}건/일`);

/* ── --rules: 후보 고정 검증 모드 ─────────────────────────────────────
   1년 탐색으로 고른 후보를 **바꾸지 않고** 그 이전 1년(탐색에 안 쓴 구간)에서 다시 잰다.
   CI에서 years=3 days=504로 받으면 앞 1년이 미사용 구간이 된다. 후보 목록은 2026-10-06
   1년 탐색 결과를 보고 미리 적어 둔 것이다 — 이전 구간 결과를 보고 고치지 않는다. */
if (process.argv.includes('--rules')) {
  const has = v => v !== null && v !== undefined && !Number.isNaN(v);
  const cur = recsByVar['현행'], a30 = recsByVar['A30'];
  const G5 = x => x.g === 5, G4 = x => x.g >= 4, RV5 = x => x.rg === 5;
  const notStrong = x => x.lvl !== 'strong';
  const R = [
    ['R0  현행 강한매수', cur, G5],
    ['R1  강매 ∧ 국면≠strong', cur, x => G5(x) && notStrong(x)],
    ['R2  강매 ∧ 국면 neutral', cur, x => G5(x) && x.lvl === 'neutral'],
    ['R3  강매 ∧ RSI≤35', cur, x => G5(x) && has(x.rsi) && x.rsi <= 35],
    ['R4  강매+A30 ∧ RSI≤35', a30, x => G5(x) && has(x.rsi) && x.rsi <= 35],
    ['R5  강매 ∧ QQQ 3일+ 연속하락', cur, x => G5(x) && has(x.qs) && x.qs >= 3],
    ['R6  강매 ∧ QQQ 2일+ 연속하락 ∧ QQQ20≤3%', cur, x => G5(x) && has(x.qs) && x.qs >= 2 && has(x.mret) && x.mret <= 3],
    ['R7  관심이상 ∧ 스토K≤20', cur, x => G4(x) && has(x.sk) && x.sk <= 20],
    ['R8  강매 ∧ 볼밴≤40 ∧ QQQ20≤0%', cur, x => G5(x) && has(x.bb) && x.bb <= 40 && has(x.mret) && x.mret <= 0],
    ['R9  강매+A30 ∧ rs20<5 ∧ 3일누적≤0%', a30, x => G5(x) && has(x.rs20) && x.rs20 < 5 && has(x.run3) && x.run3 <= 0],
    ['R10 강매 ∧ 고점대비<-20% ∧ 국면≠strong', cur, x => G5(x) && has(x.pfh) && x.pfh < -20 && notStrong(x)],
    ['R11 강매+A30 ∧ 3일누적≤0% ∧ VXN≥22', a30, x => G5(x) && has(x.run3) && x.run3 <= 0 && has(x.vxn) && x.vxn >= 22],
    ['R12 강매 ∧ 3일누적≤0%', cur, x => G5(x) && has(x.run3) && x.run3 <= 0],
    ['R13 반등강매 ∧ QQQ 2일+ 연속하락', cur, x => RV5(x) && has(x.qs) && x.qs >= 2],
    ['R14 강매 ∧ (국면≠strong ∨ RSI≤35)', cur, x => G5(x) && (notStrong(x) || (has(x.rsi) && x.rsi <= 35))],
    ['R15 강매+A30 ∧ 국면≠strong', a30, x => G5(x) && notStrong(x)],
  ];
  const last = new Date(dates[nDays - 1]); const y1 = new Date(last); y1.setFullYear(y1.getFullYear() - 1);
  const Y = y1.toISOString().slice(0, 10);
  const older = x => x.d < Y, recent = x => x.d >= Y;
  const dset = rows => new Set(rows.map(x => x.d));
  const sameDay = rows => { const ds = dset(rows); return ALL.filter(x => ds.has(x.d)); };
  const cell = (rows, h) => f1(st(rows, h));
  console.log(`\n■ 후보 고정 검증 — 이전 1년(<${Y}, 탐색 미사용) vs 최근 1년(≥${Y}) · 각 칸 +1 | +3 | +5 · [같은 날 기준선 +5] · 신호일 %`);
  const bo = ALL.filter(older), br = ALL.filter(recent), dO = new Set(bo.map(x => x.d)).size, dR = new Set(br.map(x => x.d)).size;
  console.log(`  기준선     이전 ${cell(bo, 1)} | ${cell(bo, 3)} | ${cell(bo, 5)} (${dO}일)   최근 ${cell(br, 1)} | ${cell(br, 3)} | ${cell(br, 5)} (${dR}일)`);
  for (const [nm, pool, fn] of R) {
    const a = pool.filter(fn), o = a.filter(older), r = a.filter(recent);
    console.log(`  ${nm}`);
    console.log(`     이전 ${cell(o, 1)} | ${cell(o, 3)} | ${cell(o, 5)} [같은날 ${Math.round(st(sameDay(o), 5).rate ?? 0)}%] ${Math.round(100 * dset(o).size / dO)}%일`);
    console.log(`     최근 ${cell(r, 1)} | ${cell(r, 3)} | ${cell(r, 5)} [같은날 ${Math.round(st(sameDay(r), 5).rate ?? 0)}%] ${Math.round(100 * dset(r).size / dR)}%일`);
    /* §5-5: 같은 풀의 강한매수 중 이 규칙이 지우는 표본 — 실제로 지는 표본이어야 한다 */
    if (nm.startsWith('R0')) continue;
    const keep = new Set(a.map(x => x.t + '|' + x.d));
    const rm = pool.filter(x => G5(x) && !keep.has(x.t + '|' + x.d));
    if (!rm.length) continue;
    const ro = rm.filter(older), rr = rm.filter(recent);
    console.log(`     └ 지우는 강매  이전 ${cell(ro, 1)} | ${cell(ro, 3)} | ${cell(ro, 5)} [같은날 ${Math.round(st(sameDay(ro), 5).rate ?? 0)}%]   최근 ${cell(rr, 1)} | ${cell(rr, 3)} | ${cell(rr, 5)} [같은날 ${Math.round(st(sameDay(rr), 5).rate ?? 0)}%]`);
  }
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)}초)`);
  process.exit(0);
}

/* ── 조건 사전 (이름, 판정, 이웃 그룹·순서) ── */
const C = [];
const add = (fam, val, name, fn) => C.push({ fam, val, name, fn });
const has = v => v !== null && v !== undefined && !Number.isNaN(v);
for (const v of [35, 40, 45, 50, 55, 60, 65]) add('rsi≤', v, `RSI≤${v}`, x => has(x.rsi) && x.rsi <= v);
for (const v of [40, 45, 50, 55]) add('rsi≥', v, `RSI≥${v}`, x => has(x.rsi) && x.rsi >= v);
for (const v of [20, 30, 40, 50, 60, 70, 80]) add('bb≤', v, `볼밴≤${v}`, x => has(x.bb) && x.bb <= v);
for (const v of [30, 50, 70]) add('bb≥', v, `볼밴≥${v}`, x => has(x.bb) && x.bb >= v);
for (const v of [-10, -5, 0, 5, 10]) add('rs20>', v, `rs20>${v}`, x => has(x.rs20) && x.rs20 > v);
for (const v of [0, 5]) add('rs20<', v, `rs20<${v}`, x => has(x.rs20) && x.rs20 < v);
for (const v of [-10, -15, -20, -30]) add('고점≥', v, `고점대비≥${v}%`, x => has(x.pfh) && x.pfh >= v);
for (const v of [-20, -30, -40]) add('고점<', v, `고점대비<${v}%`, x => has(x.pfh) && x.pfh < v);
for (const v of [0.8, 1.0, 1.2, 1.5]) add('vr≥', v, `거래량≥${v}배`, x => has(x.vr) && x.vr >= v);
for (const v of [0.8, 1.0, 1.2]) add('vr≤', v, `거래량≤${v}배`, x => has(x.vr) && x.vr <= v);
for (const v of [2, 3, 4, 5]) add('atr≤', v, `ATR≤${v}%`, x => has(x.atr) && x.atr <= v);
for (const v of [3, 5]) add('atr≥', v, `ATR≥${v}%`, x => has(x.atr) && x.atr >= v);
for (const v of [-2, 0, 2]) add('chg≤', v, `당일≤${v}%`, x => has(x.chg) && x.chg <= v);
for (const v of [0, 2]) add('chg≥', v, `당일≥${v}%`, x => has(x.chg) && x.chg >= v);
for (const v of [0, 3, 6]) add('run3≤', v, `3일누적≤${v}%`, x => has(x.run3) && x.run3 <= v);
for (const v of [-5, 0]) add('run3>', v, `3일누적>${v}%`, x => has(x.run3) && x.run3 > v);
for (const v of [20, 40, 60]) add('stoch≤', v, `스토K≤${v}`, x => has(x.sk) && x.sk <= v);
add('macd', 1, 'MACD>0', x => has(x.macd) && x.macd > 0);
add('macd', -1, 'MACD<0', x => has(x.macd) && x.macd < 0);
add('ma200', 1, '200일선 위', x => has(x.p) && has(x.ma200) && x.p > x.ma200);
add('ma200', -1, '200일선 아래', x => has(x.p) && has(x.ma200) && x.p <= x.ma200);
add('ma200s', 1, '200일선 상승', x => has(x.ma200s) && x.ma200s > 0);
add('ma50', 1, '50일선 위', x => has(x.p) && has(x.ma50) && x.p > x.ma50);
add('ma20', 1, '20일선 위', x => has(x.p) && has(x.ma20) && x.p > x.ma20);
add('ma20', -1, '20일선 아래', x => has(x.p) && has(x.ma20) && x.p <= x.ma20);
add('slope', 1, '20일선 상승', x => has(x.slope) && x.slope > 0);
for (const v of [-10, -5, 0, 5]) add('wpos>', v, `20주선 대비>${v}%`, x => has(x.wpos) && x.wpos > v);
for (const v of [40, 50, 60]) add('wrsi≥', v, `주봉RSI≥${v}`, x => has(x.wrsi) && x.wrsi >= v);
for (const v of [50, 60]) add('wrsi≤', v, `주봉RSI≤${v}`, x => has(x.wrsi) && x.wrsi <= v);
for (const v of [0, 10]) add('mpos>', v, `6개월선 대비>${v}%`, x => has(x.mpos) && x.mpos > v);
add('lvl', 'strong', '국면 strong', x => x.lvl === 'strong');
add('lvl', 'neutral', '국면 neutral', x => x.lvl === 'neutral');
add('lvl', '!strong', '국면≠strong', x => x.lvl !== 'strong');
add('lvl', 'weakish', '국면 caution/weak', x => x.lvl === 'caution' || x.lvl === 'weak');
for (const v of [-3, 0, 3, 6]) add('mret>', v, `QQQ 20일>${v}%`, x => has(x.mret) && x.mret > v);
for (const v of [0, 3]) add('mret≤', v, `QQQ 20일≤${v}%`, x => has(x.mret) && x.mret <= v);
for (const v of [18, 20, 22, 25]) add('vxn≥', v, `VXN≥${v}`, x => has(x.vxn) && x.vxn >= v);
for (const v of [20, 25]) add('vxn<', v, `VXN<${v}`, x => has(x.vxn) && x.vxn < v);
for (const v of [30, 40, 50, 60]) add('br<', v, `폭<${v}%`, x => has(x.br) && x.br < v);
for (const v of [40, 50, 60, 70]) add('br≥', v, `폭≥${v}%`, x => has(x.br) && x.br >= v);
for (const v of [-3, -2, -1, 0]) add('mrs≥', v, `유니버스rs20≥${v}`, x => has(x.mrs) && x.mrs >= v);
for (const v of [1, 2, 3]) add('qs≥', v, `QQQ ${v}일+ 연속하락`, x => has(x.qs) && x.qs >= v);
add('qs=0', 0, 'QQQ 연속하락 없음', x => x.qs === 0);
for (const v of [2.0, 2.5, 3.0]) add('ps≥', v, `추세점수≥${v}`, x => has(x.ps) && x.ps >= v);
for (const v of [2.5, 3.0, 3.5]) add('rsc≥', v, `반등점수≥${v}`, x => has(x.rsc) && x.rsc >= v);
add('setup', 'dipHard', '강한 눌림', x => x.f && x.f.dipHard);
add('setup', 'dipSoft', '정배열 눌림', x => x.f && x.f.dipSoft);
add('setup', 'resting', '5일선 숨고르기', x => x.f && x.f.resting);
add('bull', 1, '정배열', x => x.f && x.f.bull);
add('bull', 0, '정배열 아님', x => x.f && !x.f.bull);
add('brk', 1, '돌파 동반', x => x.f && x.f.breakout);
add('brk', 0, '돌파 아님', x => x.f && !x.f.breakout);
/* 테마 제외 — 탐색 구간에서 그 바탕 기준으로 가장 나쁜 테마만 고른다(확인 구간 미사용) */
const catNames = [...new Set(ALL.map(x => x.c))];

/* ── 탐색 ── */
const TGT = +(process.env.TGT || 65), NEIGH = TGT - 3;
const pass = (a, nMin) => { nMin = Math.min(nMin, +(process.env.NMIN || nMin)); const s3 = st(a, 3), s5 = st(a, 5); return s3.n >= nMin && s5.n >= nMin && s3.rate >= TGT && s5.rate >= TGT ? { s3, s5 } : null; };
const out = [];
let tried = 0, trainPass = 0;
for (const [bname, bset] of Object.entries(BASES)) {
  const btr = bset.filter(x => x.d < cut);
  /* 탐색 구간에서 승률이 바탕보다 10%p 이상 낮은 테마(표본 10+) — 제외 후보 */
  const bt5 = st(btr, 5).rate;
  const badCats = catNames.filter(c => { const s = st(btr.filter(x => x.c === c), 5); return s.n >= 10 && s.rate <= bt5 - 10; });
  const conds = C.slice();
  if (badCats.length) conds.push({ fam: 'cat', val: 'bad', name: `테마제외[${badCats.join(',')}]`, fn: x => !badCats.includes(x.c) });
  const sets = [[]];
  for (let i = 0; i < conds.length; i++) { sets.push([i]); for (let j = i + 1; j < conds.length; j++) if (conds[i].fam !== conds[j].fam) sets.push([i, j]); }
  for (const s of sets) {
    tried++;
    const fn = x => s.every(k => conds[k].fn(x));
    const tr = btr.filter(fn);
    const p = pass(tr, 40); if (!p) continue;
    trainPass++;
    const all = bset.filter(fn), te = all.filter(x => x.d >= cut);
    const q = pass(te, 20);
    out.push({ base: bname, conds: s.map(k => conds[k]), all, tr: p, te: q, teRaw: { s3: st(te, 3), s5: st(te, 5) }, sIdx: s, condList: conds, bset });
  }
}
const confirmed = out.filter(o => o.te);
console.log(`\n■ 탐색: 조합 ${tried}개 · 탐색 구간 통과(+3·+5 ≥${TGT}%, n≥40) ${trainPass}개 · 그중 확인 구간도 통과(n≥20) ${confirmed.length}개`);
console.log(`  ⚠ 탐색 통과 대비 확인 통과율 ${trainPass ? Math.round(100 * confirmed.length / trainPass) : 0}% — 낮을수록 탐색 결과가 우연이었다는 뜻이다.`);

/* ── 확인 통과 조합 평가: §2 반쪽 · §3 이웃 · 평균수익 · 신호 수 ── */
const neighborOK = o => o.sIdx.every(k => {
  const c = o.condList[k];
  const fam = o.condList.map((x, i) => [x, i]).filter(([x]) => x.fam === c.fam && typeof x.val === 'number');
  if (fam.length < 2 || typeof c.val !== 'number') return true;
  const sorted = fam.sort((a, b) => a[0].val - b[0].val), pos = sorted.findIndex(([, i]) => i === k);
  return [sorted[pos - 1], sorted[pos + 1]].filter(Boolean).every(([, ni]) => {
    const alt = o.sIdx.map(z => z === k ? ni : z), a = o.bset.filter(x => alt.every(z => o.condList[z].fn(x)));
    const s3 = st(a, 3), s5 = st(a, 5); return s3.rate >= NEIGH && s5.rate >= NEIGH;
  });
});
const blH = h => [st(BL.h1, h).rate, st(BL.h2, h).rate];
const scored = confirmed.map(o => {
  const a = o.all, h1 = a.filter(x => x.d < mid), h2 = a.filter(x => x.d >= mid);
  const halves = [st(h1, 5), st(h2, 5)], hb = blH(5);
  const halfOK = halves[0].n >= 15 && halves[1].n >= 15 && halves[0].rate > hb[0] && halves[1].rate > hb[1] && halves[0].rate >= TGT && halves[1].rate >= TGT;
  const nb = neighborOK(o);
  const baseAvg = st(o.bset, 5).avg, avgOK = st(a, 5).avg >= baseAvg;
  return { ...o, halves, halfOK, nb, avgOK, perDay: a.length / nDays, tk: new Set(a.map(x => x.t)).size, dt: new Set(a.map(x => x.d)).size };
}).sort((x, y) => (y.halfOK + y.nb + y.avgOK) - (x.halfOK + x.nb + x.avgOK) || st(y.all, 5).n - st(x.all, 5).n);

const name = o => `${o.base} ∧ ${o.conds.length ? o.conds.map(c => c.name).join(' ∧ ') : '(조건 없음)'}`;
/* §1 기준선 두 개를 같이 잰다.
   ① 같은 날 기준선: 신호가 뜬 날짜들에 전 종목을 샀다면 — 국면만으로 얻는 승률
   ② 같은 조건 기준선: 등급과 무관하게 조건만 만족한 전 종목 — 산식(등급)이 더해 주는 몫 */
const byDate = new Map(); ALL.forEach(x => { if (!byDate.has(x.d)) byDate.set(x.d, []); byDate.get(x.d).push(x); });
const recIdx = new Map(); for (const [k, rs] of Object.entries(recsByVar)) recIdx.set(k, rs);
const baseUniverse = b => b === '강매+A30' ? recsByVar['A30'] : ALL;
const enrich = o => {
  const ds = new Set(o.all.map(x => x.d));
  const sameDay = [].concat(...[...ds].map(d => byDate.get(d) || []));
  const condOnly = baseUniverse(o.base).filter(x => o.sIdx.every(k => o.condList[k].fn(x)));
  const s3 = st(o.all, 3), s5 = st(o.all, 5), d3 = st(sameDay, 3), d5 = st(sameDay, 5), c3 = st(condOnly, 3), c5 = st(condOnly, 5);
  return { ...o, s3, s5, d3, d5, c3, c5, exDay: Math.min(s3.rate - d3.rate, s5.rate - d5.rate), exCond: Math.min(s3.rate - c3.rate, s5.rate - c5.rate), cover: ds.size / nDays,
    keys: new Set(o.all.map(x => x.t + '|' + x.d)) };
};
const jac = (a, b) => { let i = 0; for (const k of a) if (b.has(k)) i++; return i / (a.size + b.size - i); };
const show = (title, list, top) => {
  console.log(`\n■ ${title}`);
  console.log(`  각 줄: 1년 +1 | +3 | +5 · 탐색/확인 +5 · 전반/후반 +5 · [같은날 기준선 +3/+5 → 초과] · [조건만 +3/+5 → 초과] · 신호 있는 날 % · 건/일`);
  const picked = [];
  for (const o of list) { if (picked.length >= top) break; if (picked.some(p => jac(p.keys, o.keys) > 0.6)) continue; picked.push(o); }
  for (const o of picked) {
    console.log(`  ${name(o)}  ${o.halfOK ? '§2✓' : '§2✗'} ${o.nb ? '§3✓' : '§3✗'} ${o.avgOK ? '평균✓' : '평균✗'}`);
    console.log(`     ${f1(st(o.all, 1))} | ${f1(o.s3)} | ${f1(o.s5)} · ${f1(o.tr.s5)}/${f1(o.te.s5)} · ${f1(o.halves[0])}/${f1(o.halves[1])}`);
    console.log(`     같은날 ${Math.round(o.d3.rate)}/${Math.round(o.d5.rate)}% → ${o.exDay >= 0 ? '+' : ''}${Math.round(o.exDay)}%p · 조건만 ${Math.round(o.c3.rate)}/${Math.round(o.c5.rate)}%(${o.c5.n}) → ${o.exCond >= 0 ? '+' : ''}${Math.round(o.exCond)}%p · 신호일 ${Math.round(o.cover * 100)}% · ${o.perDay.toFixed(2)}건/일 · ${o.tk}종목`);
  }
  return picked;
};
const E = scored.filter(o => o.halfOK && o.nb && o.avgOK).map(enrich);
const good = E.filter(o => o.exDay >= 5 && o.exCond >= 3);
console.log(`\n■ 전 관문 통과(§2·§3·평균수익): ${E.length}개 · 그중 §1(같은 날 기준선 +5%p↑ · 조건만 기준선 +3%p↑): ${good.length}개`);
const order = (a, b) => a.conds.length - b.conds.length || b.s5.n - a.s5.n;
show('§1까지 통과 — 조건 수 적은 순 · 표본 많은 순 · 겹침 60% 넘는 조합은 생략', good.slice().sort(order), TOP);
show('현행 강한매수(A30 없이)만 바탕 — 산식 변경이 가장 작은 쪽', good.filter(o => o.base === '강매(현행)').sort(order), 12);
show('신호가 있는 날 50% 이상 — 평소에도 신호가 나오는 쪽', good.filter(o => o.cover >= 0.5).sort(order), 12);
show('참고: §1 미달(국면만으로 설명되는 조합) — 표본 많은 순', E.filter(o => !(o.exDay >= 5 && o.exCond >= 3)).sort((a, b) => b.s5.n - a.s5.n), 8);
/* 확인 구간에서 탈락한 것 중 탐색 성적이 가장 좋았던 것 — 과적합 사례로 같이 보여준다 */
const failed = out.filter(o => !o.te).sort((a, b) => b.tr.s5.rate - a.tr.s5.rate).slice(0, 8);
console.log(`\n■ 참고: 탐색에서 가장 좋았지만 확인 구간에서 무너진 조합 (과적합 사례)`);
for (const o of failed) console.log(`  ${name(o)} · 탐색 +5 ${f1(o.tr.s5)} → 확인 +3 ${f1(o.teRaw.s3)} +5 ${f1(o.teRaw.s5)}`);
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(0)}초)`);
