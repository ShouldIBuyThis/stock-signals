#!/usr/bin/env node
/**
 * 🔄 반등 '매수관심'(등급4) 문턱 올리기 — 후보 비교 (읽기 전용 · 로그만)
 *
 * 왜 (2026-08-25 사용자 지시: "반등 매수관심 문턱을 올려주고")
 *   189거래일 실측에서 반등 매수관심이 +1/+3/+5/+7일 47/46/39/38%로
 *   기준선(51/52/53/52%)을 -14%p까지 밑돌았다. 국면 판정 후보 14종 어느 것을
 *   써도 36~41%에서 안 움직인다 — 국면 문제가 아니라 이 계층 하나의 문제다.
 *
 *   현행 문턱은 원장 30거래일(표본 56/28/15건)에서 정해졌고 그때는
 *   66/74/79%였다. 표본이 6배로 늘자 무너진 전형적인 §5-1 사례다.
 *
 * 무엇을 재나
 *   evaluate()의 등급4 조건 한 줄만 문자열로 갈아끼우고 화면 산식을
 *   그대로 다시 돌린다(§0 — 재구현 금지). 나머지는 손대지 않는다.
 *
 *     const revGrade = revStrong ? 5 :
 *       (revScore>=2.0 && has(bb) && bb>=70 && run3Eff!==null && run3Eff<=10) ? 4 : 3;
 *
 * 채택 관문 (docs/승률-검증-방법론.md)
 *   ① 반등 관심이 기준선을 넘을 것 (§1 — 원승률이 아니라 대비 %p)
 *   ② §2 전·후반 양쪽에서 같은 방향
 *   ③ §5-5 **지워지는 표본이 실제로 지는 표본일 것** — 이기는 신호를 지우면 손해다
 *   ④ 💡·다중·강한매수에 부수 피해가 없을 것 (등급4를 조이면 상위 계층도 흔들릴 수 있다)
 *   ⑤ §3 고원 — 이웃 값도 같은 방향이어야 한다
 *   ⑥ §6 승률만 오르고 평균수익이 내려가면 기각
 *
 * ⚠ 문턱을 올리면 표본은 반드시 줄어든다. '표본이 줄어서 승률이 오른' 것과
 *   '지는 표본을 지워서 오른' 것을 ③으로 가른다.
 * ⚠ 아무 파일도 안 고친다. raw.json이 필요해 CI에서만 돈다.
 *
 * 사용: node tools/rev4-lab.js [backtest/raw.json]
 */
const fs = require('fs'), H = require('./_harness');

const IN = process.argv[2] || 'backtest/raw.json';
if (!fs.existsSync(IN)) { console.error(`[ERROR] ${IN} 없음 — 워크플로우 안에서만 실행된다.`); process.exit(1); }
const RAW = fs.readFileSync(IN, 'utf8');

/* 배포 소스의 등급4 조건. 여기 문자열이 index.html과 다르면 즉시 멈춘다. */
const BASE = '(revScore>=2.0 && has(bb) && bb>=70 && run3Eff!==null && run3Eff<=10) ? 4 : 3;';

/* 후보 — 전부 '현행 조건 + 추가 조건'이다. 조건을 빼는 방향은 시험하지 않는다
   (사용자 지시가 '문턱을 올려라'이고, 완화는 이미 표본만 늘리는 것으로 확인됐다).
   맨 마지막 X는 계층을 아예 없앤 참조값이다 — 채택 후보가 아니라 상한선 표시용. */
const VARIANTS = [
  ['V0 현행 (bb>=70 · run3<=10)', null],
  ['V1 볼밴 >=80',               'has(bb) && bb>=80'],
  ['V2 볼밴 >=85',               'has(bb) && bb>=85'],
  ['V3 볼밴 >=90',               'has(bb) && bb>=90'],
  ['V4 점수 >=2.5',              'revScore>=2.5'],
  ['V5 점수 >=3.0',              'revScore>=3.0'],
  ['V6 추격 run3<=6',            'run3Eff<=6'],
  ['V7 추격 run3<=3',            'run3Eff<=3'],
  ['V8 RSI 조건(강매와 동일)',    'has(rsi) && revRsiOK'],
  ['V9 20일선 위',               'revTrendOK'],
  ['VA 방어섹터 게이트 적용',      'sectorOK'],
  ['VB 추격 컷(강매와 동일)',      'revChase'],
  ['VC V8+VA (RSI+섹터)',        '(has(rsi) && revRsiOK) && sectorOK'],
  ['VD V8+V9 (RSI+20일선)',      '(has(rsi) && revRsiOK) && revTrendOK'],
  ['VE V1+V6 (볼밴80+추격6)',     'has(bb) && bb>=80 && run3Eff<=6'],
  ['VF V8+VB (RSI+추격컷)',       '(has(rsi) && revRsiOK) && revChase'],
  ['VG V8+VA+VB (셋 다)',         '(has(rsi) && revRsiOK) && sectorOK && revChase'],
  ['X  등급4 폐지 (참조값)',      'false'],
];

function run(extra) {
  const repl = extra === null ? BASE
    : `(revScore>=2.0 && has(bb) && bb>=70 && run3Eff!==null && run3Eff<=10 && (${extra})) ? 4 : 3;`;
  const patch = [['result._diag=diag;', 'result._diag=diag; result._all=out;']];
  if (extra !== null) patch.push([BASE, repl]);
  const page = H.loadPage({ patch });
  page.runInPage('this.__run = j => { state.data = normalize(JSON.parse(j)); return strategyValidation(); };');
  return j => page.__run(j);
}

const base = JSON.parse(RAW);
const F = base.hist_fields, I_D = F.indexOf('date');
const DAYS = [...new Set(base.stocks.flatMap(s => (s.hist || []).map(r => String(r[I_D]))))].sort();
const MID = DAYS[Math.floor(DAYS.length / 2)];
function clip(pred) {
  const d = JSON.parse(RAW);
  for (const s of d.stocks) s.hist = (s.hist || []).filter(r => pred(String(r[I_D])));
  return JSON.stringify(d);
}
const FULL = RAW, H1 = clip(d => d < MID), H2 = clip(d => d >= MID);

const HZ = [1, 3, 5, 7];
const cell = (s, b) => {
  if (!s || s.rate === null) return `  —(${String(s ? s.n : 0).padStart(4)})       `;
  const e = (b && b.rate !== null) ? `${s.rate - b.rate >= 0 ? '+' : ''}${s.rate - b.rate}`.padStart(4) + '%p' : '     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(4)})${e}`;
};
const pc = v => v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${(Math.round(v * 100) / 100).toFixed(2)}%`;
function stat(arr) {                       // 화면 stat()과 같은 규칙(±1% 밖만 승패)
  const a = arr.filter(v => v != null && !Number.isNaN(v));
  const w = a.filter(v => v > 1).length, l = a.filter(v => v < -1).length;
  return { n: a.length, rate: (w + l) ? Math.round(w / (w + l) * 100) : null,
           avg: a.length ? a.reduce((p, c) => p + c, 0) / a.length : null };
}
const key = x => x.ticker + '|' + x.date;
const rev4 = (v, h) => (v._all.rev[h] || []).filter(x => x.tier === 4);

console.log(`■ 🔄 반등 매수관심(등급4) 문턱 후보 — ${DAYS.length}거래일 (${DAYS[0]} ~ ${DAYS[DAYS.length-1]}) · 반쪽 ${MID}`);
console.log(`  칸: 승률(표본) 기준선대비%p · ${HZ.map(h => '+' + h + '일').join(' ')}`);

const R = new Map();
for (const [nm, ex] of VARIANTS) {
  const f = run(ex);
  R.set(nm, { full: f(FULL), h1: f(H1), h2: f(H2) });
}
const V0 = R.get(VARIANTS[0][0]);
const B = V0.full._baseline, B1 = V0.h1._baseline, B2 = V0.h2._baseline;

console.log(`\n  ${'(아무 날이나 = 기준선)'.padEnd(26)}` + HZ.map(h => cell(B[h]).padEnd(19)).join(''));
for (const [nm] of VARIANTS) {
  const v = R.get(nm), i = v.full._interest.rev;
  console.log(`\n  ${nm}`);
  console.log(`    ${'🔄 반등 관심'.padEnd(14)}` + HZ.map(h => cell(i[h], B[h]).padEnd(19)).join(''));
  console.log(`    ${'· 전반'.padEnd(14)}` + HZ.map(h => cell(v.h1._interest.rev[h], B1[h]).padEnd(19)).join(''));
  console.log(`    ${'· 후반'.padEnd(14)}` + HZ.map(h => cell(v.h2._interest.rev[h], B2[h]).padEnd(19)).join(''));
  console.log(`    ${'· 평균수익'.padEnd(14)}` + HZ.map(h => pc(i[h].avg).padEnd(19)).join(''));
  /* ③ §5-5 — 현행 대비 지워지는 등급4 표본이 실제로 지는가 */
  if (nm !== VARIANTS[0][0]) {
    const parts = HZ.map(h => {
      const a = new Map(rev4(V0.full, h).map(x => [key(x), x.ret]));
      const b = new Set(rev4(v.full, h).map(key));
      const gone = [...a].filter(([k]) => !b.has(k)).map(([, r]) => r);
      const s = stat(gone);
      return `+${h}일 ${s.n}건${s.rate === null ? '' : `(${s.rate}%·${pc(s.avg)})`}`;
    });
    console.log(`    ${'· 지워진 표본'.padEnd(14)}${parts.join(' · ')}`);
  }
  /* ④ 부수 피해 — 상위 계층이 흔들리면 문턱 조정이 아니라 사고다 */
  const dmg = [['💡', v.full._strict, V0.full._strict], ['🔵', v.full.multi, V0.full.multi],
               ['🟢', v.full._strongBuy, V0.full._strongBuy], ['🔄강매', v.full.rev, V0.full.rev]];
  console.log(`    ${'· 상위 계층'.padEnd(14)}` + dmg.map(([lab, a, b]) =>
    `${lab} ${HZ.map(h => `${a[h].rate === null ? '—' : a[h].rate}${a[h].rate !== null && b[h].rate !== null && a[h].rate !== b[h].rate ? `(${a[h].rate - b[h].rate >= 0 ? '+' : ''}${a[h].rate - b[h].rate})` : ''}`).join('/')}`).join('  '));
}

console.log(`\n※ 후보 ${VARIANTS.length}종을 훑었다(다중비교). 채택은 다섯을 전부 넘은 것만:`);
console.log('   ① 기준선 초과  ② §2 전·후반 같은 방향  ③ 지워진 표본이 실제로 지는 표본');
console.log('   ④ 💡·다중·강한매수·반등강매 무피해  ⑤ 이웃 값도 같은 방향(§3 고원)');
console.log('  표본이 줄어서 오른 것과 지는 표본을 지워서 오른 것은 ③으로만 갈린다.');
console.log('  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.');
