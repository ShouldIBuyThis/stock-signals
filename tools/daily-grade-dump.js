/* 원장 날짜별 일봉 등급 덤프 — 장중 신호에 '전날 일봉 등급'을 붙여 보는 연구용(2026-11-11 사용자 지시).
   화면 함수 그대로: strategyValidation()과 같은 방식으로 날짜별 행 → evaluate().grade · multiSignalRank() _multiTier.
   출력: {"TICKER": {"YYYY-MM-DD": [grade, multiTier]}} (multiTier 1=💡 강한다중 · 2=다중 · 0=없음). 실적 영향권 날은 null 등급.
   사용: (저장소에서 python3 -m http.server 8765) node tools/daily-grade-dump.js > backtest/daily-grades.json */
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), pg = await b.newPage();
  await pg.route(/workers\.dev/, r => r.abort());
  await pg.goto('http://localhost:8765/index.html'); await pg.waitForFunction(() => state.data && allStocks().length > 0, null, { timeout: 30000 });
  const out = await pg.evaluate(() => {
    const byDate = new Map(), res = {};
    allStocks().forEach(s => { const hs = histStocks(s); if (!hs) return; const ew = earningsWindowsForValidation(s, hs);
      hs.forEach((h, i) => { if (!h.last_date || !has(h.price)) return;
        const row = Object.assign({}, s, h); if (i > 0) withPrev(row, hs[i-1]);
        row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null; row.sig = evaluate(row); row.earnings_hold = false;
        (res[s.ticker] = res[s.ticker] || {})[h.last_date] = [ew.blocked.has(h.last_date) ? null : row.sig.grade, 0];
        if (!ew.blocked.has(h.last_date)) (byDate.get(h.last_date) || byDate.set(h.last_date, []).get(h.last_date)).push(row); }); });
    byDate.forEach((uni, d) => multiSignalRank(uni).forEach(x => { if (res[x.ticker] && res[x.ticker][d]) res[x.ticker][d][1] = x._multiTier || 0; }));
    return res;
  });
  console.log(JSON.stringify(out)); await b.close();
})();
