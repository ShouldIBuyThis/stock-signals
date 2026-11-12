/* 🏆 황금신호 과거 후보 — 일봉 쪽 두 조건(강한매수·다중·💡 ∩ 상승 캔들패턴)을 원장(hist)으로 날짜별 재현한다.
   화면 함수를 그대로 쓴다(재구현 없음): strategyValidation()과 같은 방식으로 날짜별 행을 만들고
   evaluate() 등급 · multiSignalRank() 다중 등급 · sbDailyTier() · sbItemsFor(row,{main:true}) 상승 패턴.
   실적 영향권(blocked) 날은 화면처럼 뺀다. 장중 조건(세 시간봉)은 5분봉이 필요해 CI의 tools/intraday-gold-lab.js가 본다.
   국장은 2026-11-11부터 상승 캔들 대신 볼밴 %B≤10(band:true)도 후보로 본다.
   사용: (저장소에서 python3 -m http.server 8765) node tools/gold-history-cands.js [거래일수=20] [pat.json] > backtest/gold-cands.json
   pat.json(선택) = tools/pat-recompute.py의 PATJSON — 원장 pat이 비어 있는 날(2026-11-05 이전)만 이 소급 값으로 채우고 src:"소급"으로 표시한다. */
const { chromium } = require('playwright');
const N = +(process.argv[2] || 20);
const PATX = process.argv[3] ? JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8')) : null;
(async () => {
  const b = await chromium.launch(), pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route(/workers\.dev/, r => r.abort());
  await pg.goto('http://localhost:8765/index.html'); await pg.waitForFunction(() => state.data && allStocks().length > 0, null, { timeout: 30000 });
  const out = await pg.evaluate(([N, PATX]) => {
    const byDate = new Map();
    allStocks().forEach(s => {
      const hs = histStocks(s); if (!hs || !hs.length) return;
      const ew = earningsWindowsForValidation(s, hs);
      hs.forEach((h, i) => {
        if (!h.last_date || !has(h.price) || !h.price || ew.blocked.has(h.last_date)) return;
        const row = Object.assign({}, s, h);
        if (i > 0) withPrev(row, hs[i-1]);
        row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null;
        row.sig = evaluate(row);
        const raw = (s._hist || [])[i] || {};
        row.ext_pair = raw.ext_pair ?? null; row.earnings_hold = false;   // 그날 값만(오늘 값이 섞이지 않게)
        row._src = '원장';
        if (row.pat == null){ const px = PATX && PATX[s.ticker] ? (PATX[s.ticker][h.last_date] || '') : null; if (px != null){ row.pat = px; row._src = '소급'; } }
        (byDate.get(h.last_date) || byDate.set(h.last_date, []).get(h.last_date)).push(row);
      });
    });
    const res = [], mk = r => r._kr || /\.(KS|KQ)$/.test(r.ticker) ? 'kr' : 'us';
    for (const m of ['us', 'kr']){
      const dates = [...byDate.keys()].filter(d => byDate.get(d).some(r => mk(r) === m)).sort().slice(-N);
      dates.forEach(d => {
        const uni = byDate.get(d);   // 다중 순위는 화면 검증과 같은 날짜 전체 유니버스
        const mm = new Map(multiSignalRank(uni).map(x => [x.ticker, x]));
        uni.filter(r => mk(r) === m).forEach(r => {
          const tier = sbDailyTier(r, mm); if (!tier) return;
          const items = sbItemsFor(r, {main:true}), pats = items.filter(x => !x.site && !x.noGold && (x.kind === 'green' || x.kind === 'blue'));
          /* 국장(2026-11-11 사용자 결정): 상승 캔들 또는 볼밴 %B≤10(화면 goldKrBand 그대로) */
          const band = m === 'kr' && typeof goldKrBand === 'function' && goldKrBand(r);
          res.push({ m, date: d, ticker: r.ticker, name: r.name || '', tier, src: r._src, pats: [...new Set(pats.map(x => x.name))], band: !pats.length && band, bb: has(r.bb_pos) ? +r.bb_pos.toFixed(2) : null, red: items.some(x => x.kind === 'red'), price: r.price });
        });
      });
      res.push({ m, _dates: dates });
    }
    return res;
  }, [N, PATX]);
  const dates = out.filter(x => x._dates), rows = out.filter(x => !x._dates);
  const both = rows.filter(r => r.pats.length || r.band);
  console.log(JSON.stringify({ generated: new Date().toISOString(), days: N, dates: Object.fromEntries(dates.map(x => [x.m, x._dates])),
    daily_only: rows.length, cands: both }, null, 1));
  console.error(`일봉 등급(강한매수·다중·💡) ${rows.length}건 → 상승 캔들패턴까지 ${both.length}건 · 페이지 오류 ${errs.length}`);
  await b.close();
})();
