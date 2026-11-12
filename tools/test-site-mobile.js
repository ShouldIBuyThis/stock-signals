#!/usr/bin/env node
/**
 * 사이트 표시 점검(모바일·PC) — 브라우저에서 실제로 열어 본다. 금융 판정은 보지 않고 '깨지지 않는지'만 본다.
 * - 페이지 스크립트 오류 0 · 가로 넘침 없음 · 신호판·도움말 탭 · 보유 패널 → 고점판독기 · 장바구니 모의점검이 열림
 * - 고점판독기: 검증 조합 파일을 읽고 prHlMatch가 '최근 3거래일'만 보는지(오래된 기록 무시)
 * 사용: (저장소 루트에서) python3 -m http.server 8765 & node tools/test-site-mobile.js [http://localhost:8765/index.html]
 */
const { chromium, devices } = require('playwright');
const URL = process.argv[2] || 'http://localhost:8765/index.html';
(async () => {
  const b = await chromium.launch(); let fail = 0;
  for (const mode of ['mobile', 'pc']) {
    const ctx = await b.newContext(mode === 'mobile' ? { ...devices['iPhone 13'] } : { viewport: { width: 1280, height: 900 } });
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.route(u => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.href), r => r.abort());   // 외부(장중 Worker·폰트 등)는 끊고 저장소 파일만으로 본다
    await pg.goto(URL); await pg.waitForFunction(() => typeof state !== 'undefined' && state.data && allStocks().length > 0, null, { timeout: 60000 });
    const r = {};
    for (const tab of ['all', 'help', 'theme']) { const t = await pg.$(`#tabs [data-tab="${tab}"]`); if (t) { await t.click(); await pg.waitForTimeout(200); } }
    await pg.evaluate(() => { state.holdings = allStocks().slice(0, 3).map(s => s.ticker); state.cart = allStocks().slice(0, 2).map(s => s.ticker); render(); });
    await pg.click('#btnHold'); await pg.waitForTimeout(200); await pg.click('#holdPanel .pr-btn');
    await pg.waitForFunction(() => typeof PR_DATA !== 'undefined' && PR_DATA, null, { timeout: 30000 }).catch(() => { r.prData = 'peak-reader.json 못 읽음'; });
    await pg.waitForTimeout(500);
    r.prItems = await pg.evaluate(() => document.querySelectorAll('.pr-item').length);
    r.hl = await pg.evaluate(() => { if (!PR_HL) return 'peak-highlights.json 못 읽음';
      const s = allStocks()[0], D = prLastDays(s, 6); if (D.length < 6) return 'ok(날짜 부족)';
      const h = PR_HL.highlights.find(x => x.live && !x.combo.some(b => ['P_NEAR', 'P_RT5', 'C_FB'].includes(b))); const keep = s.peak_reader;
      s.peak_reader = Object.assign({}, keep || {}, { blk: { days: { [D[0]]: h.combo }, na: [] } }); const old = prHlMatch(s).length;
      s.peak_reader.blk = { days: { [D[5]]: h.combo }, na: [] }; const now = prHlMatch(s).length; s.peak_reader = keep;
      return old === 0 && now > 0 ? 'ok' : `최근 3거래일 판정 오류(old ${old} · now ${now})`; });
    await pg.click('#btnCart'); await pg.waitForTimeout(200); const rv = await pg.$('[data-review]'); if (rv) { await rv.click(); await pg.waitForTimeout(400); }
    r.cart = await pg.evaluate(() => !!(document.getElementById('modalBox') && document.getElementById('modalBox').innerText.length > 50));
    r.sw = await pg.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    r.errs = errs;
    const bad = errs.length || r.sw[0] > r.sw[1] + 1 || !r.prItems || r.hl !== 'ok' && !String(r.hl).startsWith('ok') || !r.cart || r.prData;
    console.log(`${bad ? '✗' : '✓'} ${mode}`, JSON.stringify(r)); if (bad) fail++;
    await ctx.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
