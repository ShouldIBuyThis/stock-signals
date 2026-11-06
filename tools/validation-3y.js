#!/usr/bin/env node
/**
 * 도움말 승률표(💡 강한다중 · 🔵 다중 · 🟢 강한매수 · 기준선)를 3년 백테스트로 만든다.
 *
 * 왜 (2026-11-06 사용자: "도움말에 있는 승률 전시를 3년치 백테스트로 교체해줘")
 * 방법 — 화면과 같은 strategyValidation()을 backtest/raw.json(야후 3년, 현재 산식으로 소급)에 돌린다(§0).
 *   표의 칸은 화면 stat()의 반환값을 그대로 옮긴다. 다시 세지 않는다.
 *   §2 반쪽(앞/뒤 반)은 _phaseRows 표본으로 같은 규칙(±1% 보합 제외)으로 세서 docs용으로만 남긴다.
 * ⚠ 백테스트는 원장이 아니다 — 지금 관심종목으로 과거를 돌린 것이라 생존 편향이 있다(CLAUDE.md §1).
 * 입력 backtest/raw.json  출력 backtest/validation-3y.json
 * 사용 node tools/validation-3y.js backtest/raw.json backtest/validation-3y.json
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'backtest/raw.json', OUT = process.argv[3] || 'backtest/validation-3y.json';
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
/* VXN 주입 — raw.json은 macro.vxn에만 있다(multi-theme-lab.js와 같은 처리). 빠지면 💡 강한다중이 0건이 된다. */
const F = base.hist_fields, iD = F.indexOf('date'), iV = F.indexOf('market_vxn'), VXN = ((base.macro || {}).vxn) || {};
if (iV >= 0) for (const s of base.stocks) for (const r of s.hist || []) { while (r.length <= iV) r.push(null); if (r[iV] == null && VXN[r[iD]] != null) r[iV] = +VXN[r[iD]]; }
const page = H.loadPage({});
page.runInPage(`this.__run = j => { state.data = normalize(JSON.parse(j)); const v = strategyValidation();
  const pick = o => { const r = {}; [1,3,5].forEach(h => { const x = (o||{})[h] || {n:0}; r[h] = {n:x.n, rate:x.rate, avg:x.avg==null?null:Math.round(x.avg*100)/100, wins:x.wins||0, flats:x.flats||0, losses:x.losses||0}; }); return r; };
  const rows = k => { const r = {}; [1,3,5].forEach(h => r[h] = ((v._phaseRows[k]||{})[h]||[]).map(x => [x.date, x.ret])); return r; };
  return JSON.stringify({ table:{strict:pick(v._strict), multi:pick(v.multi), strongBuy:pick(v._strongBuy), baseline:pick(v._baseline)},
    rows:{strict:rows('strict'), multi:rows('multi'), strongBuy:rows('strongBuy'), baseline:rows('base')} }); };`);
const R = JSON.parse(page.__run(JSON.stringify(base)));
const dates = [...new Set(R.rows.baseline[1].map(x => x[0]))].sort();
if (!dates.length) H.die('기준선 표본 0 — raw.json 확인');
const mid = dates[Math.floor(dates.length / 2)];
const st = a => { const w = a.filter(x => x[1] > 1).length, l = a.filter(x => x[1] < -1).length; return { n: a.length, rate: w + l ? Math.round(w / (w + l) * 100) : null }; };
const halves = {};
for (const k of Object.keys(R.rows)) { halves[k] = {}; for (const h of [1, 3, 5]) { const a = R.rows[k][h];
  halves[k][h] = { front: st(a.filter(x => x[0] < mid)), back: st(a.filter(x => x[0] >= mid)) }; } }
const out = { generated: new Date().toISOString(), logic_version: page.runInPage('typeof LOGIC_VERSION!=="undefined"?LOGIC_VERSION:null'),
  from: dates[0], to: dates[dates.length - 1], days: dates.length, tickers: base.stocks.length, mid,
  note: '현재 관심종목·현재 산식으로 과거를 소급한 백테스트(생존 편향). 원장 아님.', table: R.table, halves };
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const f = o => `${o.rate == null ? '—' : o.rate + '%'}(${o.n})`;
console.log(`■ 3년 백테스트 승률표 ${out.from}~${out.to} (${out.days}거래일 · ${out.tickers}종목 · ${out.logic_version}) → ${OUT}`);
for (const k of ['strict', 'multi', 'strongBuy', 'baseline'])
  console.log('  ' + k.padEnd(10) + [1, 3, 5].map(h => `+${h} ${f(R.table[k][h])} [앞 ${f(halves[k][h].front)} · 뒤 ${f(halves[k][h].back)}]`).join('  '));
