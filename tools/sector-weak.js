#!/usr/bin/env node
/**
 * PRIVATE 약세·주의 국면 섹터 실측 (읽기 전용)
 *
 * `DEFENSIVE_CATS`(index.html)는 "약세·주의장에서 강한매수를 허용할 섹터" 목록이다.
 * 이 스크립트는 그 목록을 손대기 전에 **실제로 어느 섹터가 버텼는지**를 잰다.
 *
 * docs/승률-검증-방법론.md 의 검사를 그대로 적용한다.
 *   §1 원승률이 아니라 같은 구간 기준선 대비 초과(%p)로 본다
 *   §5 표본 수뿐 아니라 몇 종목 / 몇 날짜에서 나왔는지 같이 찍는다
 *
 * 게이트가 켜지는 날(= market_level이 weak 또는 caution)만 모아 섹터별로
 * 집계한다. 그 구간의 기준선은 "그날 전 종목을 그냥 샀을 때"이다.
 *
 * 사용: 저장소 루트에서 `node tools/sector-weak.js`
 */
const fs = require('fs'), path = require('path');
const base = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'signals.json'), 'utf8'));
const src = fs.readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');

const F = base.hist_fields;
const I_D = F.indexOf('date'), I_P = F.indexOf('price'), I_LVL = F.indexOf('market_level');
const HOR = [1, 3, 5];

/* index.html의 현행 방어섹터 목록을 그대로 읽는다 (하드코딩하면 어긋난다). */
const CUR_DEF = JSON.parse(
  src.slice(src.indexOf('const DEFENSIVE_CATS ='))
     .match(/\[[^\]]*\]/)[0].replace(/"/g, '"'));

/* ── 게이트가 켜지는 날 = market_level weak/caution ── */
const guarded = new Set(), open = new Set();
for (const r of base.market.hist) {
  const [d, lv] = [String(r[0]), r[1]];
  (lv === 'weak' || lv === 'caution' ? guarded : open).add(d);
}

/* ── 섹터별 표본 수집 ── */
function collect(dayFilter) {
  const bySector = new Map();
  const all = { 1: [], 3: [], 5: [] };
  for (const s of base.stocks) {
    const cat = s.category || '기타';
    const h = s.hist || [];
    for (let i = 0; i < h.length; i++) {
      const day = String(h[i][I_D]);
      if (!dayFilter(day)) continue;
      const p0 = h[i][I_P]; if (!p0) continue;
      for (const k of HOR) {
        if (i + k >= h.length) continue;
        const p1 = h[i + k][I_P]; if (!p1) continue;
        const ret = (p1 / p0 - 1) * 100;
        if (!bySector.has(cat))
          bySector.set(cat, { 1: [], 3: [], 5: [], tickers: new Set(), days: new Set() });
        const b = bySector.get(cat);
        b[k].push(ret); b.tickers.add(s.ticker); b.days.add(day);
        all[k].push(ret);
      }
    }
  }
  return { bySector, all };
}

const rate = a => {
  const w = a.filter(x => x > 1).length, l = a.filter(x => x < -1).length;
  return (w + l) ? Math.round(w / (w + l) * 100) : null;
};
const avg = a => a.length ? a.reduce((z, x) => z + x, 0) / a.length : null;

function table(title, dayFilter) {
  const { bySector, all } = collect(dayFilter);
  const bl = {}; for (const k of HOR) bl[k] = rate(all[k]);
  console.log(`\n${title}`);
  console.log(`기준선(전 종목 매수)  +1일 ${bl[1]}%  +3일 ${bl[3]}%  +5일 ${bl[5]}%   표본 ${all[5].length}`);
  console.log('─'.repeat(88));
  console.log(`${'섹터'.padEnd(14)}${'방어?'.padEnd(6)}${'종목'.padStart(3)} ${'일'.padStart(3)}   ` +
              `${'+1일'.padEnd(15)}${'+3일'.padEnd(15)}${'+5일'.padEnd(15)}${'평균%(+5)'.padStart(9)}`);
  const rows = [...bySector.entries()].map(([cat, b]) => {
    const cell = k => {
      const r = rate(b[k]);
      if (r === null) return '   —          ';
      const e = bl[k] === null ? '' : `${r - bl[k] >= 0 ? '+' : ''}${r - bl[k]}`.padStart(4) + '%p';
      return `${String(r).padStart(3)}%(${String(b[k].length).padStart(3)})${e} `;
    };
    return {
      cat, b,
      edge5: rate(b[5]) === null || bl[5] === null ? -999 : rate(b[5]) - bl[5],
      line: `${cat.padEnd(14)}${(CUR_DEF.includes(cat) ? '  ○  ' : '     ').padEnd(6)}` +
            `${String(b.tickers.size).padStart(3)} ${String(b.days.size).padStart(3)}   ` +
            `${cell(1)}${cell(3)}${cell(5)}${(avg(b[5]) ?? 0).toFixed(2).padStart(9)}`
    };
  }).sort((x, y) => y.edge5 - x.edge5);
  rows.forEach(r => console.log(r.line));
  return { bySector, bl };
}

console.log('현행 DEFENSIVE_CATS:', CUR_DEF.join(' · '));
console.log(`게이트 ON 일수 ${guarded.size} · OFF 일수 ${open.size}`);

const G = table(`■ 게이트 ON — 약세·주의 국면 ${guarded.size}일 (방어섹터만 강한매수가 나가는 구간)`,
                d => guarded.has(d));
const O = table(`■ 게이트 OFF — 중립·강세 국면 ${open.size}일 (참고: 여기선 게이트가 안 걸린다)`,
                d => open.has(d));

/* ── 현행 목록 대 실측이 지목하는 목록 ── */
console.log('\n\n■ 현행 방어섹터 목록 점검 (게이트 ON 구간, +5일 기준)');
console.log('─'.repeat(88));
const bl5 = G.bl[5];
const scored = [...G.bySector.entries()]
  .map(([cat, b]) => ({ cat, r: rate(b[5]), n: b[5].length, t: b.tickers.size, in: CUR_DEF.includes(cat) }))
  .filter(x => x.r !== null)
  .sort((a, b) => b.r - a.r);
const keep = scored.filter(x => x.in && x.r >= bl5);
const drop = scored.filter(x => x.in && x.r < bl5);
const add  = scored.filter(x => !x.in && x.r >= bl5);
const fmt = a => a.length ? a.map(x => `${x.cat}(${x.r}%·${x.t}종목·n${x.n})`).join(', ') : '없음';
console.log(`유지 후보 — 목록에 있고 기준선 ${bl5}% 이상: ${fmt(keep)}`);
console.log(`제외 후보 — 목록에 있는데 기준선 미달  : ${fmt(drop)}`);
console.log(`추가 후보 — 목록에 없는데 기준선 이상  : ${fmt(add)}`);

/* §5 표본 독립성 경고 */
console.log('\n■ 표본 독립성 (docs/승률-검증-방법론.md §5)');
console.log('─'.repeat(88));
const thin = scored.filter(x => x.t <= 2);
console.log(`종목 2개 이하로만 구성된 섹터: ${thin.map(x => `${x.cat}(${x.t})`).join(', ') || '없음'}`);
console.log('이 섹터들의 승률은 사실상 종목 1~2개의 성적이다. 목록 편입 근거로 쓰면 과적합이다.');
