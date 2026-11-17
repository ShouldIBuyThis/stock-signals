#!/usr/bin/env node
/**
 * 🧪 주의장 보조 후보 1~10 추적 (docs/2026-11-13-caution-strongbuy.md §3 · 읽기 전용 · 표시 전용 신호의 사후 성적)
 * 판정은 index.html cautionAuxMatch()를 그대로 부른다(재구현 없음). 성공 기준 = n거래일 뒤 종가 > +1% 승 · < −1% 패 · ±1% 보합 제외.
 * 기준선은 주의장 내부(같은 기간 주의장 · 미국 아무 종목 / 주의장 강한매수 전체).
 * 사용: node tools/caution-aux-track.js [signals.json | backtest/raw.json] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
 *   --until: 그 날짜 전 행만 본다. 10년 백필로 연구 기간(2023-12~) 이전을 미사용 독립 표본으로 볼 때 쓴다(docs/2026-11-17-preregistered.md §2).
 *   backtest/raw.json으로 돌리면 연구(caution-lab --explore)의 후보별 +5일 표본 수와 같아야 한다(정합성 확인).
 */
const fs = require('fs'), H = require('./_harness');
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'signals.json';
const si = process.argv.indexOf('--since'), SINCE = si > 0 ? process.argv[si + 1] : '2026-11-14';   /* 사전 등록 다음 날부터 = 미사용 전진 표본 */
const ui = process.argv.indexOf('--until'), UNTIL = ui > 0 ? process.argv[ui + 1] : null;
const page = H.loadPage();
page.runInPage(`this.__trk = j => { state.data = normalize(JSON.parse(j)); const out = [];
  allStocks().forEach(s => { if (isKR(s.ticker)) return; const hs = histStocks(s); if (!hs) return; const ew = earningsWindowsForValidation(s, hs);
    hs.forEach((h, i) => { if (!h.last_date || !has(h.price)) return; const row = Object.assign({}, s, h); if (i > 0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null; row.sig = evaluate(row); row.earnings_hold = ew.blocked.has(h.last_date);
      if (row.earnings_hold || (row.market_level || '') !== 'caution') return;
      const rets = {}; [3, 5, 10].forEach(n => { if (i + n < hs.length && has(hs[i + n].price) && !validationWindowTouchesEarnings(ew.affected, hs, i, n)) rets[n] = (hs[i + n].price / row.price - 1) * 100; });
      const m = cautionAuxMatch(row); out.push({ tk: s.ticker, d: h.last_date, sb: row.sig.grade === 5, hits: m ? m.hits.map(c => c.id) : [], rets }); }); });
  return out; };`);
const rows = page.__trk(fs.readFileSync(file, 'utf8')).filter(r => !UNTIL || r.d < UNTIL);
const ids = page.runInPage('CAUTION_AUX.map(c => [c.id, c.nm, c.n])');
const st = (L, h) => { const a = L.map(r => r.rets[h]).filter(x => x != null), w = a.filter(x => x > 1).length, l = a.filter(x => x < -1).length;
  return { n: a.length, rate: w + l ? w / (w + l) : null, avg: a.length ? a.reduce((s, x) => s + x, 0) / a.length : null }; };
const f = s => `${s.rate == null ? ' —' : String(Math.round(s.rate * 100)).padStart(3) + '%'}(${String(s.n).padStart(3)})${s.avg == null ? '' : ' ' + (s.avg >= 0 ? '+' : '') + s.avg.toFixed(1)}`;
const line = (nm, L) => `${nm.padEnd(34)} ${[3, 5, 10].map(h => f(st(L, h))).join(' | ')} · ${new Set(L.map(r => r.d)).size}일`;
for (const [tag, R] of [['전 기간', rows], [`전진(${SINCE}~ · 미사용)`, rows.filter(r => r.d >= SINCE)]]) {
  const dd = [...new Set(R.map(r => r.d))].sort();
  console.log(`\n■ ${tag} · ${file} · 주의장(미국) ${dd[0] || '—'}~${dd[dd.length - 1] || '—'} · +3 | +5 | +10 (승률(표본) 평균%)`);
  console.log(line('주의장 아무 종목(기준선)', R)); console.log(line('주의장 강한매수 전체', R.filter(r => r.sb)));
  ids.forEach(([id, nm, n0]) => console.log(line(`#${id} ${nm}`.slice(0, 34), R.filter(r => r.hits.includes(id))) + (tag === '전 기간' ? ` · 연구 +5 표본 ${n0}` : '')));
  const any = R.filter(r => r.hits.length); console.log(line('후보 하나라도', any)); console.log(line('강한매수 중 후보 아님', R.filter(r => r.sb && !r.hits.length)));
  /* 적용 모의(사전 등록 §2): 묶음 안 후보에 걸린 주의장 강한매수만 남기고 나머지를 강등했을 때 — 남는 것 vs 지워지는 것 · 앞/뒤 반 */
  if (UNTIL && tag === '전 기간') { const dm = dd[Math.floor(dd.length / 2)];
    for (const [gn, g] of [['사용자 목록 #1~5', [1, 2, 3, 4, 5]], ['주봉 조합 #3·#5·#7', [3, 5, 7]], ['후보 전부 #1~10', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]]) {
      const keep = R.filter(r => r.sb && r.hits.some(h => g.includes(h))), rm = R.filter(r => r.sb && !r.hits.some(h => g.includes(h)));
      console.log(`  ▶ ${gn} 적용 모의 · 앞/뒤 경계 ${dm}`); console.log(line('    남는 주의장 강한매수', keep)); console.log(line('    강등되는 주의장 강한매수', rm));
      for (const [hn, sel] of [['앞', r => r.d < dm], ['뒤', r => r.d >= dm]]) console.log(line(`    ${hn} 반 남는 / 기준선 +5 ${f(st(R.filter(sel), 5))}`, keep.filter(sel)) + ' ‖ 강등 +5 ' + f(st(rm.filter(sel), 5)));
    } }
}
