#!/usr/bin/env node
/**
 * 🧪 주의장 보조 후보 1~10 추적 (docs/2026-11-13-caution-strongbuy.md §3 · 읽기 전용 · 표시 전용 신호의 사후 성적)
 * 판정은 index.html cautionAuxMatch()를 그대로 부른다(재구현 없음). 성공 기준 = n거래일 뒤 종가 > +1% 승 · < −1% 패 · ±1% 보합 제외.
 * 기준선은 주의장 내부(같은 기간 주의장 · 미국 아무 종목 / 주의장 강한매수 전체).
 * 사용: node tools/caution-aux-track.js [signals.json | backtest/raw.json] [--since YYYY-MM-DD]
 *   backtest/raw.json으로 돌리면 연구(caution-lab --explore)의 후보별 +5일 표본 수와 같아야 한다(정합성 확인).
 */
const fs = require('fs'), H = require('./_harness');
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'signals.json';
const si = process.argv.indexOf('--since'), SINCE = si > 0 ? process.argv[si + 1] : '2026-11-14';   /* 사전 등록 다음 날부터 = 미사용 전진 표본 */
const page = H.loadPage();
page.runInPage(`this.__trk = j => { state.data = normalize(JSON.parse(j)); const out = [];
  allStocks().forEach(s => { if (isKR(s.ticker)) return; const hs = histStocks(s); if (!hs) return; const ew = earningsWindowsForValidation(s, hs);
    hs.forEach((h, i) => { if (!h.last_date || !has(h.price)) return; const row = Object.assign({}, s, h); if (i > 0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null; row.sig = evaluate(row); row.earnings_hold = ew.blocked.has(h.last_date);
      if (row.earnings_hold || (row.market_level || '') !== 'caution') return;
      const rets = {}; [3, 5, 10].forEach(n => { if (i + n < hs.length && has(hs[i + n].price) && !validationWindowTouchesEarnings(ew.affected, hs, i, n)) rets[n] = (hs[i + n].price / row.price - 1) * 100; });
      const m = cautionAuxMatch(row); out.push({ tk: s.ticker, d: h.last_date, sb: row.sig.grade === 5, hits: m ? m.hits.map(c => c.id) : [], rets }); }); });
  return out; };`);
const rows = page.__trk(fs.readFileSync(file, 'utf8'));
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
}
