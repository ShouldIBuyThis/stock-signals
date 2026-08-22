#!/usr/bin/env node
/**
 * 상위 시간대(주봉·월봉) 맥락을 붙이면 우리 신호의 승률이 오르나 (읽기 전용 · 로그만)
 *
 * 사용자 요청(2026-08-22): "주봉 월봉까지 보정값 포함해서 매수자리 보는 산식으로 하면
 * 승률 어케 돼 시뮬레이션".
 *
 * 검증 설계 — 산식은 index.html의 evaluate()/strategyValidation() 그대로 쓴다(§0).
 * 여기서 하는 일은 **이미 난 신호를 상위 시간대 상태로 갈라서 승률을 재는 것**뿐이다.
 * 재구현하지 않는다.
 *
 * 무엇으로 가르나 (main.py가 hist에 저장한 값 — 전부 '완성된' 상위봉만 참조)
 *   w_ma20_pos  현재가가 20주선 대비 몇 % 위/아래인가   → 주봉 추세
 *   w_rsi       완성된 마지막 주봉의 RSI(14)            → 주봉 힘
 *   w_streak    연속 주봉 방향 (+n 양봉 / -n 음봉)      → 주봉 관성
 *   m_ma6_pos   현재가가 6개월선 대비 몇 % 위/아래       → 월봉 추세
 *   m_streak    연속 월봉 방향
 *
 * ⚠ 백테스트다 — 소급 적용·생존 편향. 원장 검증표와 직접 비교 금지.
 * ⚠ 워밍업 구멍 주의: 20주선은 daily 100봉, 6개월선은 126봉이 필요하다.
 *   백테스트 창 앞부분은 값이 없다. 커버리지를 먼저 찍고, 없는 구간은 '판정 불가'로 센다.
 *
 * 사용: node tools/mtf-lab.js [backtest/raw.json]
 */
const fs = require('fs'), H = require('./_harness');

const IN = process.argv[2] || 'backtest/raw.json';
if (!fs.existsSync(IN)) {
  console.error(`[ERROR] ${IN} 없음 — 백테스트 워크플로우 안에서만 돌릴 수 있다.`);
  process.exit(1);
}
const raw = fs.readFileSync(IN, 'utf8');
const ctx = H.loadPage();
ctx.__raw = raw;

const res = ctx.runInPage(`(() => {
  state.data = normalize(JSON.parse(__raw));
  /* 상위 시간대 값을 (티커|날짜)로 미리 뽑아 둔다. 판정은 하지 않는다. */
  const meta = new Map();
  let have = { w:0, m:0, all:0 };
  allStocks().forEach(s => (histStocks(s)||[]).forEach(h => {
    if(!h.last_date) return;
    have.all++;
    if(has(h.w_ma20_pos)) have.w++;
    if(has(h.m_ma6_pos)) have.m++;
    meta.set(s.ticker+'|'+h.last_date, {
      wpos: num(h.w_ma20_pos), wrsi: num(h.w_rsi), wstk: num(h.w_streak),
      mpos: num(h.m_ma6_pos), mstk: num(h.m_streak) });
  }));
  const phase = (strategyValidation() || {})._phaseRows || {};
  const KINDS = [{k:'strong', src:'strongBuy'}, {k:'multi', src:'multi'}, {k:'strict', src:'strict'}];
  const HS = [1,3,5,7];
  const byId = new Map();
  KINDS.forEach(({k, src}) => HS.forEach(h => {
    ((phase[src] || {})[h] || []).forEach(x => {
      const id = k+'|'+x.ticker+'|'+x.date;
      let row = byId.get(id);
      if(!row){ row = Object.assign({k, t:x.ticker, d:x.date, r:{}}, meta.get(x.ticker+'|'+x.date) || {});
                byId.set(id, row); }
      row.r[h] = Math.round(x.ret*100)/100;
    });
  }));
  return { rows:[...byId.values()], have, keys:Object.keys(phase) };
})()`);

const ALL = res.rows;
if (!ALL.length) {
  console.error('[ERROR] 신호 표본이 비었다. _phaseRows 키:', res.keys.join(','));
  process.exit(1);
}
const HS = [1, 3, 5, 7];
const cov = res.have;
console.log('■ 주봉·월봉 맥락 검증 — 상위 시간대를 붙이면 승률이 오르나');
console.log(`  hist 행 ${cov.all}개 중 주봉값 있는 행 ${cov.w} (${Math.round(cov.w/cov.all*100)}%) · ` +
            `월봉값 ${cov.m} (${Math.round(cov.m/cov.all*100)}%)`);
console.log('  ※ 없는 구간은 워밍업(20주선 100봉·6개월선 126봉) 탓이다. 판정에서 제외한다.');

const grade = n => n >= 50 ? '신뢰' : n >= 30 ? '방향' : n >= 15 ? '참고' : n >= 5 ? '일화' : '불가';

/* 승률 규칙은 화면·검증표와 같다 — ±1% 보합 제외. */
function stat(list, h) {
  const a = list.map(x => x.r[h]).filter(v => v !== undefined && v !== null);
  const dec = a.filter(v => Math.abs(v) > 1);
  const w = dec.filter(v => v > 1).length;
  return { n: a.length,
           rate: dec.length ? Math.round(w / dec.length * 100) : null,
           avg: a.length ? Math.round(a.reduce((p, c) => p + c, 0) / a.length * 100) / 100 : null };
}
function cell(s, ref) {
  if (!s || s.rate === null) return `  —(${String(s ? s.n : 0).padStart(3)})        `;
  const e = (ref && ref.rate !== null) ? `${s.rate - ref.rate >= 0 ? '+' : ''}${s.rate - ref.rate}`.padStart(4) + '%p' : '     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(3)})${e} ${String(s.avg >= 0 ? '+' + s.avg : s.avg).padStart(6)}%`;
}

const KLAB = { strong: '🟢 강한매수', multi: '🔵 다중신호', strict: '💡 강한다중' };
const hasW = x => x.wpos !== null && x.wpos !== undefined && !Number.isNaN(x.wpos);
const hasM = x => x.mpos !== null && x.mpos !== undefined && !Number.isNaN(x.mpos);

for (const KIND of ['strong', 'multi', 'strict']) {
  const rows = ALL.filter(x => x.k === KIND);
  if (!rows.length) continue;
  /* 기준은 '주봉값이 있는 신호 전체'다. 워밍업 구멍이 있는 표본과 없는 표본을
     섞어 비교하면 시기 차이를 맥락 효과로 착각한다. */
  const base = rows.filter(hasW);
  const REF = {}; HS.forEach(h => REF[h] = stat(base, h));
  const days = [...new Set(base.map(x => x.d))].sort();
  const MID = days[Math.floor(days.length / 2)];

  console.log(`\n════ ${KLAB[KIND]} — 신호 ${rows.length}건 (주봉값 있는 ${base.length}건으로 비교)`);
  console.log(`  ${'(기준 = 주봉값 있는 전체)'.padEnd(30)} [${grade(base.length)}] ` +
              HS.map(h => cell(REF[h], null)).join(' '));

  const line = (label, pred, src) => {
    const sel = (src || base).filter(pred);
    if (!sel.length) { console.log(`  ${label.padEnd(30)} 표본 없음`); return; }
    console.log(`  ${label.padEnd(30)} [${grade(sel.length)}] ` + HS.map(h => cell(stat(sel, h), REF[h])).join(' '));
    if (sel.length >= 20) {
      const f = sel.filter(x => x.d < MID), b = sel.filter(x => x.d >= MID);
      const half = (nm, arr) => arr.length
        ? `    · ${nm.padEnd(26)} ` + HS.map(h => cell(stat(arr, h), REF[h])).join(' ')
        : `    · ${nm} 표본 없음`;
      console.log(half('전반', f)); console.log(half('후반', b));
    }
  };

  console.log('\n  ── ① 주봉 추세 (20주선 대비)');
  line('20주선 위', x => x.wpos > 0);
  line('20주선 아래', x => x.wpos <= 0);
  line('20주선 +10% 이상 위', x => x.wpos >= 10);
  line('20주선 -10% 이하', x => x.wpos <= -10);

  console.log('\n  ── ② 주봉 힘 (주봉 RSI)');
  line('주봉 RSI 50 이상', x => x.wrsi !== null && x.wrsi >= 50);
  line('주봉 RSI 40~50', x => x.wrsi !== null && x.wrsi >= 40 && x.wrsi < 50);
  line('주봉 RSI 40 미만', x => x.wrsi !== null && x.wrsi < 40);
  line('주봉 RSI 70 이상 (과열)', x => x.wrsi !== null && x.wrsi >= 70);

  console.log('\n  ── ③ 주봉 관성 (연속 주봉)');
  line('주봉 2주+ 연속 양봉', x => x.wstk !== null && x.wstk >= 2);
  line('주봉 1주 양봉', x => x.wstk === 1);
  line('주봉 1주 음봉', x => x.wstk === -1);
  line('주봉 2주+ 연속 음봉', x => x.wstk !== null && x.wstk <= -2);

  console.log('\n  ── ④ 월봉 (6개월선·연속 월봉)');
  const mbase = base.filter(hasM);
  line('6개월선 위', x => x.mpos > 0, mbase);
  line('6개월선 아래', x => x.mpos <= 0, mbase);
  line('월봉 연속 양봉 2개월+', x => x.mstk !== null && x.mstk >= 2, mbase);
  line('월봉 음봉 (하락 중)', x => x.mstk !== null && x.mstk <= -1, mbase);

  console.log('\n  ── ⑤ 게이트 후보 — 상위 시간대를 조건으로 걸면');
  const gates = [
    ['G1 주봉 20주선 위', x => x.wpos > 0],
    ['G2 주봉 20주선 위 + RSI50+', x => x.wpos > 0 && x.wrsi !== null && x.wrsi >= 50],
    ['G3 주봉 위 + 월봉 6개월선 위', x => x.wpos > 0 && hasM(x) && x.mpos > 0],
    ['G4 주봉 위 + 주봉 음봉(눌림)', x => x.wpos > 0 && x.wstk !== null && x.wstk <= -1],
    ['G5 주봉 RSI 40~60 (중립대)', x => x.wrsi !== null && x.wrsi >= 40 && x.wrsi <= 60]
  ];
  for (const [lab, pred] of gates) {
    const keep = base.filter(pred), drop = base.filter(x => !pred(x));
    const k3 = stat(keep, 3), d3 = stat(drop, 3), k5 = stat(keep, 5), d5 = stat(drop, 5);
    console.log(`  ${lab.padEnd(30)} 남김 ${String(keep.length).padStart(3)}건 ` +
      HS.map(h => cell(stat(keep, h), REF[h])).join(' '));
    /* 컷은 '실제로 지는 표본을 지울 때만' 정당하다(방법론 §5-5). */
    console.log(`    ↳ 지워지는 ${String(drop.length).padStart(3)}건의 성적  ` +
      `+3일 ${d3.rate === null ? '—' : d3.rate + '%'}(${d3.n}) ${d3.avg === null ? '' : (d3.avg >= 0 ? '+' : '') + d3.avg + '%'}` +
      ` · +5일 ${d5.rate === null ? '—' : d5.rate + '%'}(${d5.n}) ${d5.avg === null ? '' : (d5.avg >= 0 ? '+' : '') + d5.avg + '%'}` +
      `   [남긴 쪽 +3일 ${k3.rate === null ? '—' : k3.rate + '%'} · +5일 ${k5.rate === null ? '—' : k5.rate + '%'}]`);
  }
}

console.log('\n※ 채택 기준(방법론): ① 전체 승률이 오르고 ② §2 전·후반 같은 방향이며');
console.log('  ③ **지워지는 표본이 실제로 지는 표본**이어야 한다. 셋 중 하나라도 아니면 기각.');
console.log('  승률만 오르고 평균수익이 내려가는 것도 기각이다(§6).');
console.log('  이 도구는 실험 전용이다. 게이트·가점 반영은 사용자 승인 후에만.');
