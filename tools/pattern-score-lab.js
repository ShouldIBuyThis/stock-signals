#!/usr/bin/env node
/**
 * 역헤드앤숄더·쌍바닥 — 뱃지로 값이 있나, 가산점을 주면 승률이 오르나 (읽기 전용)
 *
 * 사용자 지시(2026-08-25): "역헤숄 쌍바닥은 뱃지도 달아주고 가산점 한다면 승률은?"
 *
 * 왜 두 단계로 나누나
 *   ① 뱃지는 '그 사실이 정보를 갖는가'만 물으면 된다 — 산식을 안 건드리므로
 *      우리 신호를 패턴 겹침 여부로 갈라 성적을 비교하면 끝이다.
 *   ② 가산점은 다르다. 점수를 올리면 **어떤 날이 강한매수가 되는지 자체가 바뀐다.**
 *      그래서 실제로 가점을 걸고 검증표를 다시 뽑고, **새로 편입된 신호만의
 *      성적**을 따로 본다. 가점은 그것이 이기는 표본을 데려올 때만 정당하다
 *      (갭 가산점이 정확히 이 검사에서 기각됐다).
 *
 * 입력
 *   backtest/raw.json                  매일치 원본 (CI에서만 생성)
 *   backtest/pattern-entries.json      tools/pattern-lab.py --emit 산출물
 *
 * ⚠ 패턴 판정은 High/Low가 필요한데 원장에는 종가만 있다. 그래서 파이썬 쪽에서
 *   야후 OHLC로 확정 피벗(리페인트 금지)을 잡아 진입일 목록을 만들고,
 *   여기서는 그 날짜만 받아 쓴다. 산식은 index.html 것을 그대로 쓴다(§0).
 * ⚠ 아무 파일도 안 고친다.
 *
 * 사용: node tools/pattern-score-lab.js [raw.json] [pattern-entries.json]
 */
const fs = require('fs'), H = require('./_harness');

const IN = process.argv[2] || 'backtest/raw.json';
const PAT = process.argv[3] || 'backtest/pattern-entries.json';
for (const f of [IN, PAT]) if (!fs.existsSync(f)) { console.error(`[ERROR] ${f} 없음 — 워크플로우 안에서만 실행된다.`); process.exit(1); }
const RAW = fs.readFileSync(IN, 'utf8');
const base = JSON.parse(RAW);
const F = base.hist_fields, I_D = F.indexOf('date');
const entries = JSON.parse(fs.readFileSync(PAT, 'utf8')).entries || [];

/* ── 진입일 → '패턴 유효 창' 으로 넓힌다 ────────────────────────────────
   카드에 뱃지를 다는 상황은 '오늘이 정확히 넥라인 돌파일'이 아니라
   '최근에 돌파가 있었다'이다. 그래서 진입일부터 WIN 거래일까지를 창으로 본다.
   창을 넓힐수록 표본은 늘고 정보는 묽어진다 — 0봉(당일만)도 같이 잰다. */
const WIN = 5;
const dayList = new Map();                    // 티커별 거래일(원장 기준)
for (const s of base.stocks || []) dayList.set(s.ticker, (s.hist || []).map(r => String(r[I_D])));

function windowSet(pats, win) {
  const out = new Set();
  const byTk = new Map();
  for (const e of entries) {
    if (!pats.includes(e.pat)) continue;
    if (!byTk.has(e.tk)) byTk.set(e.tk, []);
    byTk.get(e.tk).push(e.d);
  }
  for (const [tk, ds] of byTk) {
    const days = dayList.get(tk); if (!days) continue;
    const idx = new Map(days.map((d, i) => [d, i]));
    for (const d of ds) {
      /* 진입일이 원장 창 밖(3년 중 대부분)이면 그 티커의 첫 거래일 이후만 유효 */
      const i = idx.get(d); if (i === undefined) continue;
      for (let k = 0; k <= win && i + k < days.length; k++) out.add(tk + '|' + days[i + k]);
    }
  }
  return out;
}
const IHS = ['역헤드앤숄더'], DB = ['쌍바닥'], BOTH = ['역헤드앤숄더', '쌍바닥'];
const SETS = {
  '역헤숄 당일':   windowSet(IHS, 0),   '역헤숄 5봉':   windowSet(IHS, WIN),
  '쌍바닥 당일':   windowSet(DB, 0),    '쌍바닥 5봉':   windowSet(DB, WIN),
  '둘 다 5봉':     windowSet(BOTH, WIN),
};

const HZ = [1, 3, 5, 7];
const DAYS = [...new Set((base.stocks || []).flatMap(s => (s.hist || []).map(r => String(r[I_D]))))].sort();
const MID = DAYS[Math.floor(DAYS.length / 2)];
function clip(pred) {
  const d = JSON.parse(RAW);
  for (const s of d.stocks) s.hist = (s.hist || []).filter(r => pred(String(r[I_D])));
  return JSON.stringify(d);
}
const H1 = clip(d => d < MID), H2 = clip(d => d >= MID);

const SCORE_ANCHOR = `  const pullScore =Math.round((pPos+tNeg+cNeg)*10)/10;   // 📉 눌림목 — 최종 판정 축
  const revScore  =Math.round((rPos+rNeg+cNeg)*10)/10;   // 🔄 역추세 반등 — 최종 판정 축`;
const PATCHED = `  const _patB = (typeof __PAT !== 'undefined' && __PAT.has(s.ticker + '|' + s.last_date)) ? __BONUS : 0;
  const pullScore =Math.round((pPos+tNeg+cNeg+_patB)*10)/10;
  const revScore  =Math.round((rPos+rNeg+cNeg+_patB)*10)/10;`;

function makePage(bonus, set) {
  const patch = [['result._diag=diag;', 'result._diag=diag; result._all=out;'],
    /* 기준선 행에는 ticker가 없다(화면은 날짜만 쓴다). 종목별 조건으로 기준선을
       가르려면 티커가 있어야 하므로 여기서만 덧붙인다 — 집계 규칙은 그대로다. */
    ['baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});', 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date, ticker:row.ticker});']];
  if (bonus) patch.push([SCORE_ANCHOR, PATCHED]);
  const page = H.loadPage({ patch });
  page.__PAT = set || new Set();
  page.__BONUS = bonus || 0;
  page.runInPage('this.__run = j => { state.data = normalize(JSON.parse(j)); return strategyValidation(); };');
  return page;
}

const cell = (s, b) => {
  if (!s || s.rate === null) return `  —(${String(s ? s.n : 0).padStart(4)})       `;
  const e = (b && b.rate !== null) ? `${s.rate - b.rate >= 0 ? '+' : ''}${s.rate - b.rate}`.padStart(4) + '%p' : '     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(4)})${e}`;
};
const pc = v => (v === null || v === undefined) ? '—' : `${v >= 0 ? '+' : ''}${(Math.round(v * 100) / 100).toFixed(2)}%`;
function stat(arr) {
  const a = arr.filter(v => v != null && !Number.isNaN(v));
  const w = a.filter(v => v > 1).length, l = a.filter(v => v < -1).length;
  return { n: a.length, rate: (w + l) ? Math.round(w / (w + l) * 100) : null,
           avg: a.length ? a.reduce((p, c) => p + c, 0) / a.length : null };
}
const key = x => x.ticker + '|' + x.date;

console.log(`■ 역헤숄·쌍바닥 — 뱃지 가치 + 가산점 시뮬레이션 · ${DAYS.length}거래일 (${DAYS[0]} ~ ${DAYS[DAYS.length-1]})`);
console.log(`  패턴 진입 원본 ${entries.length}건(3년) · 그중 이 창 안에서 유효한 (티커|날짜):`);
Object.entries(SETS).forEach(([k, v]) => console.log(`    ${k.padEnd(12)} ${String(v.size).padStart(5)}일`));

/* ══════════ ① 뱃지 — 패턴이 겹친 신호가 실제로 더 좋은가 ══════════
   산식을 전혀 안 건드린 상태에서 우리 신호를 갈라 본다. */
const P0 = makePage(0, null);
const V0 = P0.__run(RAW);
console.log('\n── ① 뱃지 가치 (산식 무변경 · 우리 신호를 패턴 겹침으로 가른 것)');
console.log('     칸: 승률(표본) 대비%p · +1/+3/+5/+7일. 기준은 같은 계층의 전체 성적이다.');
const LAYERS = [['🟢 강한매수', V0._phaseRows.strongBuy], ['💡 강한다중', V0._phaseRows.strict],
                ['🔵 다중', V0._phaseRows.multi], ['(기준선)', V0._phaseRows.base]];
for (const [lab, rows] of LAYERS) {
  const all = {}; HZ.forEach(h => all[h] = stat((rows[h] || []).map(x => x.ret)));
  console.log(`\n  ${lab}`);
  console.log(`    ${'전체'.padEnd(14)}` + HZ.map(h => cell(all[h]).padEnd(19)).join('') +
    '  평균 ' + HZ.map(h => pc(all[h].avg)).join(' / '));
  for (const [nm, set] of Object.entries(SETS)) {
    const inn = {}, out = {};
    HZ.forEach(h => {
      inn[h] = stat((rows[h] || []).filter(x => set.has(key(x))).map(x => x.ret));
      out[h] = stat((rows[h] || []).filter(x => !set.has(key(x))).map(x => x.ret));
    });
    if (HZ.every(h => inn[h].n < 5)) { console.log(`    ${('· ' + nm).padEnd(14)}표본 부족(${inn[HZ[0]].n}건)`); continue; }
    console.log(`    ${('· ' + nm + ' 겹침').padEnd(14)}` + HZ.map(h => cell(inn[h], all[h]).padEnd(19)).join('') +
      '  평균 ' + HZ.map(h => pc(inn[h].avg)).join(' / '));
    console.log(`    ${('  (안 겹침)').padEnd(14)}` + HZ.map(h => cell(out[h], all[h]).padEnd(19)).join(''));
  }
}

/* ══════════ ② 가산점 — 실제로 점수를 올려 검증표를 다시 뽑는다 ══════════ */
console.log('\n\n── ② 가산점 시뮬레이션 (눌림·반등 점수에 직접 가점)');
console.log(`     반쪽 기준 ${MID} · 칸: 승률(표본) P0 대비%p`);
const ROWS = [['💡 강한다중', v => v._strict], ['🔵 다중', v => v.multi], ['🟢 강한매수', v => v._strongBuy],
              ['📈 추세 강매', v => v.pull], ['🔄 반등 강매', v => v.rev], ['기준선', v => v._baseline]];
const P0h1 = P0.__run(H1), P0h2 = P0.__run(H2);
const V0sb = h => V0._phaseRows.strongBuy[h] || [];

console.log(`\n  P0 현행 (가점 0)`);
for (const [lab, get] of ROWS) console.log(`    ${lab.padEnd(14)}` + HZ.map(h => cell(get(V0)[h]).padEnd(19)).join(''));

const TARGETS = [['역헤숄 5봉', SETS['역헤숄 5봉']], ['쌍바닥 5봉', SETS['쌍바닥 5봉']], ['둘 다 5봉', SETS['둘 다 5봉']]];
for (const [tn, set] of TARGETS) {
  for (const b of [0.3, 0.5]) {
    const pg = makePage(b, set);
    const v = pg.__run(RAW), h1 = pg.__run(H1), h2 = pg.__run(H2);
    console.log(`\n  ${tn} · 가점 +${b}`);
    for (const [lab, get] of ROWS) console.log(`    ${lab.padEnd(14)}` + HZ.map(h => cell(get(v)[h], get(V0)[h]).padEnd(19)).join(''));
    console.log(`    ${'· 초록 전반'.padEnd(14)}` + HZ.map(h => cell(h1._strongBuy[h], P0h1._strongBuy[h]).padEnd(19)).join(''));
    console.log(`    ${'· 초록 후반'.padEnd(14)}` + HZ.map(h => cell(h2._strongBuy[h], P0h2._strongBuy[h]).padEnd(19)).join(''));
    console.log(`    ${'· 초록 평균수익'.padEnd(14)}` + HZ.map(h =>
      `${pc(v._strongBuy[h].avg)} (P0 ${pc(V0._strongBuy[h].avg)})`.padEnd(19)).join(''));
    /* 새로 편입된 신호만 — 가점이 이기는 표본을 데려왔나 */
    const add = HZ.map(h => {
      const p0 = new Set(V0sb(h).map(key));
      const a = (v._phaseRows.strongBuy[h] || []).filter(x => !p0.has(key(x))).map(x => x.ret);
      const s = stat(a);
      return `+${h}일 ${s.n}건${s.rate === null ? '' : `(${s.rate}%·${pc(s.avg)})`}`;
    });
    console.log(`    ${'· 새로 편입'.padEnd(14)}${add.join(' · ')}`);
  }
}

console.log('\n※ 채택 관문: ① 뱃지는 겹친 쪽이 안 겹친 쪽보다 확실히 좋아야 하고,');
console.log('   ② 가산점은 검증표가 오르면서 **새로 편입된 신호 자체가 기준선을 넘어야** 한다.');
console.log('   둘 중 ②가 훨씬 까다롭다 — 갭 가산점이 여기서 기각됐다.');
console.log('  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.');
