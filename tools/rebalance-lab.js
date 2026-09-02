#!/usr/bin/env node
/**
 * 강한매수 산식 재배정 후보 — 지지선 반등 가점 + 시장 4단계·공포지수(VXN) 보정 (읽기 전용)
 *
 * 사용자 지시(2026-08-25): "단기지지·중기지지를 크게 안 깨고 반등한 주식에 가산점 보정하고,
 * 시장별 4단계·공포지수 보정해서 강한매수 산식 재배정하면 승률 어떻게 되나 —
 * 승률 보정 후보군 시뮬레이션 후 보고."
 *
 * 세 축
 *   A 지지 반등 가점   — 최근 5봉 저점이 지지선(그 전 20/60봉 종가 저점)의 -2%~+3% 안에
 *                        머물렀고(안 깼고), 오늘 종가가 그 저점보다 +2% 이상 위(반등 확인).
 *                        ⚠ 원장에는 종가만 있어 지지선을 **종가 저점**으로 만든다.
 *                          main.py의 sup_short/sup_mid는 Low 기준이라 값이 조금 다르다.
 *   B 공포지수 가점    — 그날 VXN이 25(또는 28) 이상이면 가점. 189일 실측에서 VXN≥25일 때
 *                        강한매수가 62/67/72/73%로 그날 기준선(51/52/52/52)을 +11~+21%p 넘었다.
 *   C 국면 감점 보정   — 현행 산식은 weak -1.0 · caution -0.5 감점인데, 189일 실측에서
 *                        경계일 신호가 오히려 기준선보다 좋았다(regime-lab). 감점을 줄이거나
 *                        VXN이 높을 때만 푼다.
 *
 * 어떻게 재나 (§0)
 *   evaluate()의 점수 확정 두 줄과 국면 감점 두 줄만 문자열로 갈아끼운다.
 *   가점은 **어떤 날이 강한매수가 되는지 자체를 바꾸므로**, 검증표 변화뿐 아니라
 *   **새로 편입된 신호만의 성적**을 따로 찍는다 — 가점은 이기는 표본을 데려올 때만 정당하다.
 *   (갭 가산점이 정확히 이 검사에서 기각됐다.)
 *
 * 채택 관문
 *   ① 검증표가 P0보다 오르고  ② §2 전·후반 같은 방향  ③ 새로 편입된 신호가 기준선을 넘고
 *   ④ 평균수익이 내려가지 않을 것(§6)  ⑤ 표본 15+
 *
 * ⚠ 후보 12종을 훑는다(다중비교). 통과한 것도 다음 사이클 재확인 후에 쓴다.
 * ⚠ 아무 파일도 안 고친다. VXN은 raw.json의 macro.vxn — CI에서만 돈다.
 *
 * 사용: node tools/rebalance-lab.js [backtest/raw.json]
 */
const fs = require('fs'), H = require('./_harness');

const IN = process.argv[2] || 'backtest/raw.json';
if (!fs.existsSync(IN)) { console.error(`[ERROR] ${IN} 없음 — 워크플로우 안에서만 실행된다.`); process.exit(1); }
const RAW = fs.readFileSync(IN, 'utf8');
const base = JSON.parse(RAW);
const F = base.hist_fields;
const I = {}; ['date', 'price'].forEach(k => { I[k] = F.indexOf(k); });

/* ── A. 지지 반등 (티커|날짜) 집합 ──────────────────────────────────────── */
const SUP_S = new Set(), SUP_M = new Set();
function bounceSet(hs, i, n) {
  /* 지지선 = 최근 5봉을 뺀 그 전 n봉의 종가 저점. 최근 5봉을 빼지 않으면
     '지지선 근처까지 내려왔다'가 자기 자신을 가리키게 된다. */
  if (i - 6 < 0) return false;
  const lo = Math.max(0, i - 5 - n);
  let sup = Infinity; for (let j = lo; j <= i - 6; j++) sup = Math.min(sup, hs[j][I.price]);
  if (!(sup > 0) || sup === Infinity) return false;
  let rl = Infinity; for (let j = i - 5; j <= i; j++) rl = Math.min(rl, hs[j][I.price]);
  const c = hs[i][I.price], p = hs[i - 1][I.price];
  const touched = rl <= sup * 1.03, notBroken = rl >= sup * 0.98;
  const bounced = c >= rl * 1.02 && c > p;
  return touched && notBroken && bounced;
}
for (const s of base.stocks || []) {
  const hs = (s.hist || []).filter(r => r && r[I.date] && r[I.price] != null);
  for (let i = 0; i < hs.length; i++) {
    const k = s.ticker + '|' + String(hs[i][I.date]);
    if (bounceSet(hs, i, 20)) SUP_S.add(k);
    if (bounceSet(hs, i, 60)) SUP_M.add(k);
  }
}
const SUP_ANY = new Set([...SUP_S, ...SUP_M]);

/* ── B. VXN ─────────────────────────────────────────────────────────────── */
const VXN = ((base.macro || {}).vxn) || {};

/* ── 후보 ───────────────────────────────────────────────────────────────── */
/* sup: 가점을 줄 집합 · supB: 가점 · vxT: VXN 문턱 · vxB: 가점 ·
   weak/cau: 국면 감점(현행 1.0/0.5) · relax: VXN≥25면 국면 감점 0 */
const CANDS = [
  ['P0 현행',                          {}],
  ['A1 지지반등(단·중) +0.3',           { sup: 'any', supB: 0.3 }],
  ['A2 지지반등(단·중) +0.5',           { sup: 'any', supB: 0.5 }],
  ['A3 중기지지 반등만 +0.5',           { sup: 'mid', supB: 0.5 }],
  ['B1 VXN≥25 +0.3',                  { vxT: 25, vxB: 0.3 }],
  ['B2 VXN≥25 +0.5',                  { vxT: 25, vxB: 0.5 }],
  ['B3 VXN≥28 +0.5',                  { vxT: 28, vxB: 0.5 }],
  ['C1 caution 감점 해제(−0.5→0)',      { cau: 0 }],
  ['C2 weak 감점 절반(−1.0→−0.5)',     { weak: 0.5 }],
  ['C3 VXN≥25면 국면 감점 전부 해제',    { relax: true }],
  ['D1 A1 + B1',                      { sup: 'any', supB: 0.3, vxT: 25, vxB: 0.3 }],
  ['D2 A2 + B2 + C3 (전부)',           { sup: 'any', supB: 0.5, vxT: 25, vxB: 0.5, relax: true }],
  ['D3 A1 + C3',                      { sup: 'any', supB: 0.3, relax: true }],
  // 2026-09-02 사용자 승인으로 B3(v12)와 C3를 실제 적용했다 — 둘을 합친 성적은 따로 재야 한다.
  ['E1 B3 + C3 (v12 실제 적용)',       { vxT: 28, vxB: 0.5, relax: true }],
];

const SCORE_ANCHOR = `  const pullScore =Math.round((pPos+tNeg+cNeg)*10)/10;   // 📉 눌림목 — 최종 판정 축
  const revScore  =Math.round((rPos+rNeg+cNeg)*10)/10;   // 🔄 역추세 반등 — 최종 판정 축`;
const SCORE_PATCH = `  const _rbB = (typeof __RB !== 'undefined') ? __RB(s) : 0;
  const pullScore =Math.round((pPos+tNeg+cNeg+_rbB)*10)/10;
  const revScore  =Math.round((rPos+rNeg+cNeg+_rbB)*10)/10;`;
const WEAK_A = 'if (lv==="weak"){ cNeg-=1.0; tags.push({c:"t-warn",t:"⚠ 시장 약세"});';
const WEAK_B = 'if (lv==="weak"){ cNeg-=__WPEN(s); tags.push({c:"t-warn",t:"⚠ 시장 약세"});';
const CAU_A  = 'else if (lv==="caution"){ cNeg-=0.5; tags.push({c:"t-warn",t:"⚠ 시장 주의"});';
const CAU_B  = 'else if (lv==="caution"){ cNeg-=__CPEN(s); tags.push({c:"t-warn",t:"⚠ 시장 주의"});';
const BASEROW = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});';
const BASEROW2 = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date, ticker:row.ticker});';

function makePage(o) {
  const patch = [['result._diag=diag;', 'result._diag=diag; result._all=out;'], [BASEROW, BASEROW2]];
  const useScore = o.sup || o.vxT, usePen = o.cau !== undefined || o.weak !== undefined || o.relax;
  if (useScore) patch.push([SCORE_ANCHOR, SCORE_PATCH]);
  if (usePen) { patch.push([WEAK_A, WEAK_B]); patch.push([CAU_A, CAU_B]); }
  const page = H.loadPage({ patch });
  const supSet = o.sup === 'mid' ? SUP_M : o.sup === 'short' ? SUP_S : SUP_ANY;
  const vx = d => (VXN[d] == null ? null : Number(VXN[d]));
  page.__RB = s => {
    let b = 0;
    if (o.sup && supSet.has(s.ticker + '|' + s.last_date)) b += o.supB;
    if (o.vxT) { const v = vx(s.last_date); if (v != null && v >= o.vxT) b += o.vxB; }
    return b;
  };
  const hiVx = s => { const v = vx(s.last_date); return v != null && v >= 25; };
  page.__WPEN = s => (o.relax && hiVx(s)) ? 0 : (o.weak !== undefined ? o.weak : 1.0);
  page.__CPEN = s => (o.relax && hiVx(s)) ? 0 : (o.cau !== undefined ? o.cau : 0.5);
  page.runInPage('this.__run = j => { state.data = normalize(JSON.parse(j)); return strategyValidation(); };');
  return page;
}

const HZ = [1, 3, 5, 7];
const DAYS = [...new Set((base.stocks || []).flatMap(s => (s.hist || []).map(r => String(r[I.date]))))].sort();
const MID = DAYS[Math.floor(DAYS.length / 2)];
function clip(pred) {
  const d = JSON.parse(RAW);
  for (const s of d.stocks) s.hist = (s.hist || []).filter(r => pred(String(r[I.date])));
  return JSON.stringify(d);
}
const H1 = clip(d => d < MID), H2 = clip(d => d >= MID);

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
const pc = v => (v == null) ? '—' : `${v >= 0 ? '+' : ''}${(Math.round(v * 100) / 100).toFixed(2)}%`;
const key = x => x.ticker + '|' + x.date;

console.log(`■ 강한매수 재배정 후보 — 지지반등 가점 · VXN 가점 · 국면 감점 보정 · ${DAYS.length}거래일 · 반쪽 ${MID}`);
console.log(`  지지 반등 집합: 단기 ${SUP_S.size} · 중기 ${SUP_M.size} · 합집합 ${SUP_ANY.size} (티커|날짜) · VXN 일자 ${Object.keys(VXN).length}`);
console.log('  칸: 승률(표본) P0 대비%p · +1/+3/+5/+7일');

const ROWS = [['💡 강한다중', v => v._strict], ['🔵 다중', v => v.multi], ['🟢 강한매수', v => v._strongBuy],
              ['📈 추세 강매', v => v.pull], ['🔄 반등 강매', v => v.rev], ['기준선', v => v._baseline]];
const R = new Map();
for (const [nm, o] of CANDS) { const p = makePage(o); R.set(nm, { full: p.__run(RAW), h1: p.__run(H1), h2: p.__run(H2) }); }
const P0 = R.get(CANDS[0][0]);
const sb = (v, h) => v._phaseRows.strongBuy[h] || [];

/* 먼저 '지지 반등이 겹친 강한매수'가 실제로 더 좋은지 — 가점 이전에 정보가 있는가 */
console.log('\n── ⓪ 지지 반등이 겹친 P0 강한매수 (산식 무변경 · 가점 이전 검사)');
for (const [lab, set] of [['단기지지 반등', SUP_S], ['중기지지 반등', SUP_M]]) {
  const all = {}, inn = {}; HZ.forEach(h => { all[h] = stat(sb(P0.full, h).map(x => x.ret));
    inn[h] = stat(sb(P0.full, h).filter(x => set.has(key(x))).map(x => x.ret)); });
  console.log(`  ${lab.padEnd(14)}` + HZ.map(h => cell(inn[h], all[h]).padEnd(19)).join('') +
    '  평균 ' + HZ.map(h => pc(inn[h].avg)).join('/'));
}
console.log(`  ${'(강한매수 전체)'.padEnd(14)}` + HZ.map(h => cell(P0.full._strongBuy[h]).padEnd(19)).join(''));

for (const [nm] of CANDS) {
  const v = R.get(nm);
  console.log(`\n  ${nm}`);
  for (const [lab, get] of ROWS)
    console.log(`    ${lab.padEnd(14)}` + HZ.map(h => cell(get(v.full)[h], nm === CANDS[0][0] ? null : get(P0.full)[h]).padEnd(19)).join(''));
  console.log(`    ${'· 초록 전반'.padEnd(14)}` + HZ.map(h => cell(v.h1._strongBuy[h], nm === CANDS[0][0] ? null : P0.h1._strongBuy[h]).padEnd(19)).join(''));
  console.log(`    ${'· 초록 후반'.padEnd(14)}` + HZ.map(h => cell(v.h2._strongBuy[h], nm === CANDS[0][0] ? null : P0.h2._strongBuy[h]).padEnd(19)).join(''));
  console.log(`    ${'· 초록 평균수익'.padEnd(14)}` + HZ.map(h =>
    (pc(v.full._strongBuy[h].avg) + (nm === CANDS[0][0] ? '' : ` (P0 ${pc(P0.full._strongBuy[h].avg)})`)).padEnd(19)).join(''));
  if (nm !== CANDS[0][0]) {
    const add = HZ.map(h => { const p0 = new Set(sb(P0.full, h).map(key));
      const s = stat(sb(v.full, h).filter(x => !p0.has(key(x))).map(x => x.ret));
      return `${s.n}건${s.rate == null ? '' : ` ${s.rate}%·${pc(s.avg)}`}`.padEnd(19); });
    const gone = HZ.map(h => { const now = new Set(sb(v.full, h).map(key));
      const s = stat(sb(P0.full, h).filter(x => !now.has(key(x))).map(x => x.ret));
      return `${s.n}건${s.rate == null ? '' : ` ${s.rate}%·${pc(s.avg)}`}`.padEnd(19); });
    console.log(`    ${'· 새로 편입'.padEnd(14)}${add.join('')}`);
    console.log(`    ${'· 빠진 표본'.padEnd(14)}${gone.join('')}`);
  }
}

console.log(`\n※ 후보 ${CANDS.length}종(다중비교). 채택은 ① 검증표 상승 ② §2 같은 방향 ③ 새로 편입된 신호가`);
console.log('   기준선을 넘고 ④ 평균수익이 안 내려가고(§6) ⑤ 표본 15+, 다섯을 전부 넘은 것만.');
console.log('   지지선은 원장에 종가만 있어 종가 저점으로 만들었다 — main.py의 Low 기준 sup_*와 값이 조금 다르다.');
console.log('  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.');
