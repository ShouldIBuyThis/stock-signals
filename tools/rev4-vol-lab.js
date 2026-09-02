#!/usr/bin/env node
/**
 * 🔄 반등 매수관심(등급4) 문턱 — 변동성·연속하락 축으로 조인다 (읽기 전용)
 *
 * 사용자 지시(2026-08-25): "지금까지 데이터 토대로 반등 매수관심 변동성 활용해서
 * 승률 문턱 높여봐."
 *
 * 왜 '빼는' 방향인가
 *   앞선 두 실험이 방향을 정해 줬다.
 *     · 문턱 18종(rev4-lab): 그 종목 자신의 지표로는 못 가른다 — 전부 미달.
 *     · 변동성 13종(vol-lab): 등급4는 **시장이 밀린 날일수록 더 나쁘다.**
 *       QQQ 2일+ 연속하락일 때 41/37/29/28%(그날 기준선 대비 -11/-20/-30/-33%p),
 *       종목 ATR이 꺾인 날 44/44/33/31%(-6/-7/-17/-19%p).
 *       같은 날 🔄 반등 강매는 +11~+34%p로 오르는데 등급4만 반대로 간다.
 *   그러니 문턱은 '점수를 더 요구'가 아니라 **'그런 날엔 등급4를 주지 않는다'**로
 *   거는 게 맞다. 지는 구간을 직접 도려내는 것이라 §5-5를 정면으로 만족한다.
 *
 * 어떻게 재나
 *   evaluate()의 등급4 조건 한 줄만 문자열로 갈아끼워, 조건이 걸린 (티커|날짜)면
 *   4가 아니라 3(중립)을 주게 한다. 나머지 산식은 손대지 않는다(§0).
 *
 *     const revGrade = revStrong ? 5 :
 *       (revScore>=2.0 && ... ) ? (__BLOCK.has(키) ? 3 : 4) : 3;
 *
 * 채택 관문
 *   ① 남는 등급4가 기준선을 넘거나 최소한 근접할 것
 *   ② §2 전·후반 같은 방향
 *   ③ **지워진 표본이 실제로 지는 표본일 것** (§5-5) — 이게 핵심이다
 *   ④ 상위 계층(💡·다중·강한매수·반등강매) 무피해
 *   ⑤ 실전 적용 가능성 — 조건이 원장에 있는 값으로 계산되는가
 *
 * ⚠ VXN 과거값은 raw.json의 macro.vxn 에만 있다(원장에는 2026-08-25부터 쌓인다).
 *   QQQ 연속 하락일 수는 아직 원장에 없다 — 채택되면 hist에 꼬리 확장이 필요하다.
 * ⚠ 아무 파일도 안 고친다. CI에서만 돈다.
 *
 * 사용: node tools/rev4-vol-lab.js [backtest/raw.json]
 */
const fs = require('fs'), H = require('./_harness');

const IN = process.argv[2] || 'backtest/raw.json';
if (!fs.existsSync(IN)) { console.error(`[ERROR] ${IN} 없음 — 워크플로우 안에서만 실행된다.`); process.exit(1); }
const RAW = fs.readFileSync(IN, 'utf8');
const base = JSON.parse(RAW);
const F = base.hist_fields;
const I = {}; ['date', 'price', 'atr_pct'].forEach(k => { I[k] = F.indexOf(k); });

/* ── 조건 재료 (vol-lab과 같은 정의) ─────────────────────────────────── */
const vxn = ((base.macro || {}).vxn) || {};
const VD = Object.keys(vxn).sort();
const VPREV = new Map(); VD.forEach((d, i) => { if (i > 0) VPREV.set(d, Number(vxn[VD[i - 1]])); });
const vAt = d => (vxn[d] == null ? null : Number(vxn[d]));
const vPrev = d => { const v = VPREV.get(d); return (v == null || Number.isNaN(v)) ? null : v; };

const qh = ((base.qqq_card || {}).hist || []).filter(r => r && r[I.date]);
const qd = qh.map(r => String(r[I.date])), qc = qh.map(r => r[I.price]);
const qStreak = new Map();
for (let i = 0; i < qd.length; i++) { let n = 0; for (let j = i; j > 0; j--) { if (!(qc[j] < qc[j - 1])) break; n++; } qStreak.set(qd[i], n); }

const atrDown = new Set(), atrTurn = new Set(), dnStreak = new Map();
for (const s of base.stocks || []) {
  const hs = (s.hist || []).filter(r => r && r[I.date] && r[I.price] != null);
  for (let i = 0; i < hs.length; i++) {
    const k = s.ticker + '|' + String(hs[i][I.date]);
    let n = 0; for (let j = i; j > 0; j--) { if (!(hs[j][I.price] < hs[j - 1][I.price])) break; n++; }
    dnStreak.set(k, n);
    const a = hs[i][I.atr_pct], p = i > 0 ? hs[i - 1][I.atr_pct] : null;
    if (a != null && p != null && a < p) {
      atrDown.add(k);
      let mx = -Infinity;
      for (let j = Math.max(0, i - 10); j <= i - 1; j++) { const v = hs[j][I.atr_pct]; if (v != null) mx = Math.max(mx, v); }
      if (p >= mx) atrTurn.add(k);
    }
  }
}

/* 후보 = '이 조건이면 등급4를 주지 않는다'. 마지막 둘은 반대 시험이다. */
const ALLKEYS = [];
for (const s of base.stocks || []) for (const h of s.hist || []) if (h && h[I.date]) ALLKEYS.push(s.ticker + '|' + String(h[I.date]));
const mkSet = fn => { const o = new Set(); for (const k of ALLKEYS) { const i = k.lastIndexOf('|'); if (fn(k.slice(0, i), k.slice(i + 1), k)) o.add(k); } return o; };

const CANDS = [
  ['W0 현행 (아무것도 안 뺌)', null],
  ['W1 QQQ 2일+ 연속하락이면 제외', mkSet((t, d) => (qStreak.get(d) || 0) >= 2)],
  ['W2 QQQ 3일+ 연속하락이면 제외', mkSet((t, d) => (qStreak.get(d) || 0) >= 3)],
  ['W3 종목 ATR 하락이면 제외',     mkSet((t, d, k) => atrDown.has(k))],
  ['W4 종목 ATR 피크아웃이면 제외',  mkSet((t, d, k) => atrTurn.has(k))],
  ['W5 VXN≥25이면 제외',           mkSet((t, d) => { const v = vAt(d); return v != null && v >= 25; })],
  ['W6 VXN 전일보다 상승이면 제외',  mkSet((t, d) => { const v = vAt(d), p = vPrev(d); return v != null && p != null && v > p; })],
  ['W7 W1 ∪ W3',                  mkSet((t, d, k) => (qStreak.get(d) || 0) >= 2 || atrDown.has(k))],
  ['W8 W1 ∪ W3 ∪ W6',             mkSet((t, d, k) => { const v = vAt(d), p = vPrev(d);
      return (qStreak.get(d) || 0) >= 2 || atrDown.has(k) || (v != null && p != null && v > p); })],
  ['W9 종목 2일+ 연속하락이면 제외', mkSet((t, d, k) => (dnStreak.get(k) || 0) >= 2)],
  ['X  반대시험: VXN<25이면 제외',   mkSet((t, d) => { const v = vAt(d); return v == null || v < 25; })],
];

/* ── 산식 재실행 ──────────────────────────────────────────────────────── */
const BASE4 = '(revScore>=2.0 && has(bb) && bb>=70 && run3Eff!==null && run3Eff<=10) ? 4 : 3;';
const BLOCK4 = "(revScore>=2.0 && has(bb) && bb>=70 && run3Eff!==null && run3Eff<=10) ? ((typeof __BLOCK !== 'undefined' && __BLOCK.has(s.ticker + '|' + s.last_date)) ? 3 : 4) : 3;";
const BASEROW = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});';
const BASEROW2 = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date, ticker:row.ticker});';

function makePage(blockSet) {
  const patch = [['result._diag=diag;', 'result._diag=diag; result._all=out;'], [BASEROW, BASEROW2]];
  if (blockSet) patch.push([BASE4, BLOCK4]);
  const page = H.loadPage({ patch });
  page.__BLOCK = blockSet || new Set();
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
const rev4 = (v, h) => (v._all.rev[h] || []).filter(x => x.tier === 4);

console.log(`■ 🔄 반등 매수관심 문턱 — 변동성·연속하락으로 '지는 날'을 빼 본다 · ${DAYS.length}거래일 · 반쪽 ${MID}`);
console.log('  칸: 승률(표본) 기준선대비%p · +1/+3/+5/+7일');
console.log('  ※ 문턱을 올리는 방향이 아니라 **지는 구간을 도려내는** 방향이다 — §5-5를 정면으로 본다.');

const R = new Map();
for (const [nm, set] of CANDS) { const p = makePage(set); R.set(nm, { full: p.__run(RAW), h1: p.__run(H1), h2: p.__run(H2) }); }
const W0 = R.get(CANDS[0][0]);
const B = W0.full._baseline, B1 = W0.h1._baseline, B2 = W0.h2._baseline;

console.log(`\n  ${'(아무 날이나 = 기준선)'.padEnd(30)}` + HZ.map(h => cell(B[h]).padEnd(19)).join(''));
for (const [nm] of CANDS) {
  const v = R.get(nm), i4 = v.full._interest.rev;
  console.log(`\n  ${nm}`);
  console.log(`    ${'🔄 반등 관심'.padEnd(16)}` + HZ.map(h => cell(i4[h], B[h]).padEnd(19)).join('') +
    '  평균 ' + HZ.map(h => pc(i4[h].avg)).join('/'));
  console.log(`    ${'· 전반/후반'.padEnd(16)}` + HZ.map(h => {
    const a = v.h1._interest.rev[h], b = v.h2._interest.rev[h];
    return `${a.rate == null ? '—' : a.rate + '%'}(${a.n}) / ${b.rate == null ? '—' : b.rate + '%'}(${b.n})`.padEnd(19);
  }).join(''));
  if (nm !== CANDS[0][0]) {
    console.log(`    ${'· 지워진 표본'.padEnd(16)}` + HZ.map(h => {
      const a = new Map(rev4(W0.full, h).map(x => [key(x), x.ret]));
      const keep = new Set(rev4(v.full, h).map(key));
      const gone = [...a].filter(([k]) => !keep.has(k)).map(([, r]) => r);
      const s = stat(gone);
      return `${s.n}건${s.rate == null ? '' : ` ${s.rate}%·${pc(s.avg)}`}`.padEnd(19);
    }).join(''));
  }
  const dmg = [['💡', v.full._strict], ['🔵', v.full.multi], ['🟢', v.full._strongBuy], ['🔄강매', v.full.rev]];
  console.log(`    ${'· 상위 계층'.padEnd(16)}` + dmg.map(([lab, a]) =>
    `${lab} ${HZ.map(h => a[h].rate == null ? '—' : a[h].rate).join('/')}`).join('  '));
}

console.log(`\n※ 후보 ${CANDS.length}종(다중비교). 채택은 ① 남는 표본이 기준선에 닿고`);
console.log('   ② §2 같은 방향 ③ **지워진 표본이 실제로 지는 표본** ④ 상위 무피해 ⑤ 원장으로 계산 가능,');
console.log('   다섯을 전부 넘은 것만. 상위 계층 숫자가 흔들리면 문턱 조정이 아니라 사고다.');
console.log('   ⚠ QQQ 연속하락일 수는 아직 원장에 없다 — 채택되면 hist 꼬리 확장이 필요하다.');
console.log('     VXN은 2026-08-25부터 원장에 쌓기 시작했다(그 전 날짜는 백테스트 원본에만 있다).');
console.log('  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.');
