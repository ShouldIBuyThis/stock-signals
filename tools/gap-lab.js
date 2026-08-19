#!/usr/bin/env node
/**
 * 갭(Gap) 매매 검증 — "안 메운 갭"이 우리 신호의 성과를 바꾸는가 (읽기 전용)
 *
 * 사용자 아이디어(2026-08-19): 갭상승 뒤 갭을 안 채우고 올라가는 종목이면
 * 주의 뱃지나 점수 보정을 붙이자.
 *
 * 검증 설계 — 우리가 정할 수 있는 건 "신호에 무엇을 더할까"뿐이므로,
 * 비교는 **신호 표본 안에서** 한다: 갭 조건에 해당하는 신호 vs 해당 없는 신호.
 * (지수·전 종목 기준선과 섞으면 다른 질문이 된다. 방법론 §1)
 *
 * 입력 backtest/ticker-record-samples.json — 188거래일 백테스트의 신호 단위 표본.
 *      각 표본에 gapD(당일 갭)·gapP(최근 갭 크기)·gapA(며칠 전)·gapV(갭일 거래량비)·
 *      gapF(메움률 0~100)가 실려 있다. 없으면 백테스트를 다시 돌려야 한다.
 *
 * ⚠ 이 숫자는 백테스트다 — 소급 적용·생존 편향. 원장 검증표와 직접 비교 금지.
 *
 * 사용: node tools/gap-lab.js [신호종류]   (기본 strong · multi · strict 도 가능)
 */
const fs = require('fs');
const IN = 'backtest/ticker-record-samples.json';
if (!fs.existsSync(IN)) { console.error(`[ERROR] ${IN} 없음 — 백테스트 워크플로우를 먼저 돌릴 것.`); process.exit(1); }
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
const ALL = base.samples || [];
const KIND = process.argv[2] || 'strong';
const HS = base.horizons || [1,3,5,7];

const rows = ALL.filter(x => x.k === KIND);
if (!rows.length) { console.error(`[ERROR] '${KIND}' 표본 없음`); process.exit(1); }
const hasGap = rows.some(x => x.gapF !== undefined && x.gapF !== null || x.gapP !== undefined && x.gapP !== null);
if (!hasGap) {
  console.error('[ERROR] 표본에 갭 필드가 없다. tools/ticker-record-build.js 확장 후 백테스트를 다시 돌릴 것.');
  process.exit(1);
}

/* 승률 규칙은 화면·검증표와 같다: ±1% 보합 제외. */
function stat(list, h) {
  const a = list.map(x => x.r[h]).filter(v => v !== undefined && v !== null);
  const dec = a.filter(v => Math.abs(v) > 1);
  const w = dec.filter(v => v > 1).length;
  return { n: a.length,
           rate: dec.length ? Math.round(w / dec.length * 100) : null,
           avg: a.length ? Math.round(a.reduce((p, c) => p + c, 0) / a.length * 100) / 100 : null };
}
const REF = {}; HS.forEach(h => REF[h] = stat(rows, h));

function cell(s, ref) {
  if (!s || s.rate === null) return `  —(${String(s ? s.n : 0).padStart(3)})        `;
  const e = (ref && ref.rate !== null) ? `${s.rate - ref.rate >= 0 ? '+' : ''}${s.rate - ref.rate}`.padStart(4) + '%p' : '     ';
  return `${String(s.rate).padStart(3)}%(${String(s.n).padStart(3)})${e} ${String(s.avg >= 0 ? '+' + s.avg : s.avg).padStart(6)}%`;
}
const grade = n => n >= 50 ? '신뢰' : n >= 30 ? '방향' : n >= 15 ? '참고' : n >= 5 ? '일화+' : '불가';

/* §2 반쪽 검증 — 날짜 중앙값으로 가른다. 한쪽만 좋으면 국면 산물이다. */
const days = [...new Set(rows.map(x => x.d))].sort();
const MID = days[Math.floor(days.length / 2)];

function line(label, pred) {
  const sel = rows.filter(pred);
  if (!sel.length) { console.log(`  ${label.padEnd(28)} 표본 없음`); return; }
  const g = grade(sel.length);
  console.log(`  ${label.padEnd(28)} [${g}] ` + HS.map(h => cell(stat(sel, h), REF[h])).join(' '));
  if (sel.length >= 10) {
    const f = sel.filter(x => x.d < MID), b = sel.filter(x => x.d >= MID);
    const half = (nm, arr) => arr.length
      ? `    ${nm} ` + HS.map(h => cell(stat(arr, h), REF[h])).join(' ')
      : `    ${nm} 표본 없음`;
    console.log(half('· 전반', f)); console.log(half('· 후반', b));
  }
}

const KLAB = { strong: '🟢 강한매수', multi: '🔵 다중신호', strict: '💡 강한다중' }[KIND] || KIND;
console.log(`■ 갭 검증 — ${KLAB} 신호 ${rows.length}건 (백테스트 ${(base.window || {}).days || '?'}거래일)`);
console.log(`  기준 = 이 신호 전체 평균. 칸: 승률(표본) 대비%p 평균수익 · 구간 ${HS.map(h => '+' + h + '일').join(' ')}`);
console.log('  ' + '─'.repeat(96));
console.log(`  ${'(전체 기준)'.padEnd(28)} [${grade(rows.length)}] ` + HS.map(h => cell(REF[h], null)).join(' '));
console.log('');

const un = x => x.gapF !== null && x.gapF !== undefined;      // 갭 기록이 있는 표본
console.log('── ① 아래에 안 메운 갭이 있나 (gapF = 메움률)');
line('갭 자체가 없음', x => x.gapP === null || x.gapP === undefined);
line('갭 있음(메움률 무관)', x => x.gapP !== null && x.gapP !== undefined);
line('거의 안 메움 (fill<=20)', x => un(x) && x.gapF <= 20);
line('절반 메움 (20<fill<=60)', x => un(x) && x.gapF > 20 && x.gapF <= 60);
line('대부분 메움 (fill>60)', x => un(x) && x.gapF > 60);

console.log('\n── ② 돌파갭 vs 보통갭 (갭일 거래량비 gapV)');
line('돌파갭형 (거래량 3배+)', x => un(x) && x.gapV !== null && x.gapV >= 3);
line('중간 (1.5~3배)', x => un(x) && x.gapV !== null && x.gapV >= 1.5 && x.gapV < 3);
line('보통갭형 (1.5배 미만)', x => un(x) && x.gapV !== null && x.gapV < 1.5);
line('돌파갭 & 미메움', x => un(x) && x.gapV !== null && x.gapV >= 3 && x.gapF <= 20);
line('보통갭 & 미메움', x => un(x) && x.gapV !== null && x.gapV < 1.5 && x.gapF <= 20);

console.log('\n── ③ 갭 크기 · 경과일');
line('큰 갭 (5%+)', x => x.gapP !== null && x.gapP !== undefined && x.gapP >= 5);
line('중간 갭 (3~5%)', x => x.gapP !== null && x.gapP !== undefined && x.gapP >= 3 && x.gapP < 5);
line('작은 갭 (2~3%)', x => x.gapP !== null && x.gapP !== undefined && x.gapP < 3);
line('갭 직후 (3일 이내)', x => x.gapA !== null && x.gapA !== undefined && x.gapA <= 3);
line('갭에서 멀어짐 (10일+)', x => x.gapA !== null && x.gapA !== undefined && x.gapA >= 10);

console.log('\n── ④ 신호 당일이 갭상승일 때 (gapD)');
line('당일 갭상승 2%+', x => x.gapD !== null && x.gapD !== undefined && x.gapD >= 2);
line('당일 갭하락 -2%↓', x => x.gapD !== null && x.gapD !== undefined && x.gapD <= -2);

console.log('\n※ 채택 기준(방법론): 전체 평균 대비 +%p · §2 전·후반 같은 방향 · 표본 15+(§5-1).');
console.log('  "지워지는 표본의 성적"도 같이 봐야 한다 — 감점 대상이 실제로 지는 표본이어야 정당하다.');
console.log('  이 도구는 실험 전용이다. 뱃지·보정 반영은 사용자 승인 후에만.');
