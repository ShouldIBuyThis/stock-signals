/* 📡 전체종목 모니터링 브라우저 시험 — 가짜 중계 서버(합성 5분봉). 사용: (저장소에서 python3 -m http.server 8765) node tools/test-intraday-scan.js
   확인: 패널을 열기만 하면 호출 0 · 버튼 1번 = 종목당 1호출 · 동시 요청 ≤ 4 · 진행률 · 실패 모음과 재시도 · 90초 캐시 · 줄을 누르면 기존 상세 화면 · 목록 복귀는 재호출 없음 · 국장 지연 표시 · 목록 = 계산 결과 */
const { chromium, devices } = require('playwright');
const OUT = process.env.SHOT_DIR || '';
function mk(t, nowBase){ const kr = /\.(KS|KQ)$/.test(t), off = kr ? 32400 : -18000; let s = 1; for (const ch of t) s = (s*131 + ch.charCodeAt(0)) % 2147483647;
  const r = () => { s = (s*16807) % 2147483647; return s/2147483647 - 0.5; };
  const nb = kr ? 72 : 78, st = nowBase.usStart, bars = []; let p = 50 + Math.abs(r())*200;
  for (let d = 4; d >= 0; d--) for (let i = 0; i < nb; i++){ const ts = st - d*86400 + i*300; if (d === 0 && i > 50) break; const o = p; p *= 1 + r()*0.006;
    if (d === 0 && [39, 45, 49].includes(i)) p = o*0.993; if (d === 0 && [40, 46, 50].includes(i)) p = o*1.01;
    let h = Math.max(o, p)*1.002, l = Math.min(o, p)*0.998, v = Math.round(1e4*(1 + Math.abs(r())*3)); if (d === 0 && [40, 46, 50].includes(i)){ v = 9e4; h = p*1.0005; l = o*0.9995; }
    bars.push([ts, o, h, l, p, v]); }
  const last = bars[bars.length-1][0] + 300;
  if (kr) return { t, tz: 'Asia/Seoul', gmtoffset: off, reg: { start: st + 86400, end: st + 86400 + 21600 }, lastTrade: last - 86400*0, price: p, bars: bars.slice(0, bars.length - 51), _closed: true };   // 국장: 장 종료 상태
  return { t, tz: 'America/New_York', gmtoffset: off, reg: { start: st, end: st + 23400 }, lastTrade: last, price: p, fetchedAt: last + 20, bars };
}
(async () => {
  const b = await chromium.launch(); let fail = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) fail++; };
  for (const [nm, dev] of [['mobile', devices['iPhone 13']], ['desktop', { viewport: { width: 1100, height: 900 } }]]){
    const usStart = Date.UTC(2026, 10, 9, 14, 30)/1000, now = usStart + 51*300 + 90;     // 미장 장중(51번째 봉 끝 + 90초)
    const ctx = await b.newContext(dev); let calls = 0, cur = 0, maxCur = 0; const failSet = new Set(), seen = [];
    await ctx.addInitScript(([n]) => { window.__INTRADAY_API = 'https://fake.test/'; const RD = Date; const F = function(...a){ return a.length ? new RD(...a) : new RD(n*1000 + (RD.now() - F.t0)); }; F.t0 = RD.now(); F.now = () => n*1000 + (RD.now() - F.t0); F.UTC = RD.UTC; F.parse = RD.parse; F.prototype = RD.prototype; window.Date = F; }, [now]);
    await ctx.route('https://fake.test/**', async x => { const t = new URL(x.request().url()).searchParams.get('t'); calls++; cur++; maxCur = Math.max(maxCur, cur); seen.push(t);
      await new Promise(r => setTimeout(r, 25)); cur--;
      if (failSet.has(t)) return x.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: '야후 응답 502' }) });
      x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mk(t, { usStart })) }); });
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('http://localhost:8765/index.html'); await pg.waitForTimeout(1600);
    const N = await pg.evaluate(() => new Set(allStocks().map(s => s.ticker.toUpperCase())).size);
    ok(/전체종목 장중 모니터링\(실험실\)/.test(await pg.textContent('#idBar')), `[${nm}] 바 제목 '📡 전체종목 장중 모니터링(실험실)'`);
    await pg.click('#idToggle'); await pg.waitForTimeout(300);
    ok(calls === 0, `[${nm}] 패널을 열기만 하면 호출 0건`);
    ok(await pg.isVisible('#idScan') && await pg.isVisible('#idInput') && !(await pg.isVisible('.id-iv')), `[${nm}] 큰 버튼 + 작은 검색창 · 봉 간격 버튼은 종목을 열기 전 숨김`);
    const tks = await pg.evaluate(() => [...new Set(allStocks().map(s => s.ticker.toUpperCase()))]); failSet.add(tks[3]); failSet.add(tks[10]);
    await pg.click('#idScan');
    await pg.waitForTimeout(120); const mid = await pg.evaluate(() => ({ btn: document.getElementById('idScan').textContent, dis: document.getElementById('idScan').disabled, prog: !!document.querySelector('.id-prog') }));
    ok(mid.dis && /조회 중/.test(mid.btn) && mid.prog, `[${nm}] 진행 중: 버튼 "${mid.btn}" · 진행 막대`);
    await pg.waitForFunction(() => !ID.scan.running, null, { timeout: 60000 });
    ok(calls === N && maxCur <= 4 && new Set(seen).size === N, `[${nm}] 종목 ${N}개 = 호출 ${calls}건(종목당 1번) · 동시 요청 최대 ${maxCur}`);
    const r1 = await pg.evaluate(() => { const S = ID.scan, h = document.querySelector('.id-shead'); const rows = [...document.querySelectorAll('.id-srow')].map(e => ({ t: e.dataset.idopen, kind: e.dataset.kind, ts: +e.dataset.ts, text: e.textContent.replace(/\s+/g, ' ') }));
      const hits = S.rows.filter(r => r.kind === 'hit'); return { total: +h.dataset.scanTotal, hit: +h.dataset.scanHit, failN: +h.dataset.scanFail, head: h.textContent, rows, hits: hits.map(r => ({ t: r.t, dir: r.dir, ts: r.ts })), failTxt: (document.querySelector('.id-sfail') || {}).textContent || '', kinds: S.rows.reduce((a, r) => (a[r.kind] = (a[r.kind] || 0) + 1, a), {}) }; });
    ok(r1.failN === 2 && /조회 실패 2종목/.test(r1.failTxt) && r1.failTxt.includes(tks[3]), `[${nm}] 일부 실패: ${r1.failTxt.slice(0, 60)}`);
    ok(r1.rows.length === r1.hits.length && r1.rows.length > 0 && r1.rows.every(x => r1.hits.some(h => h.t === x.t && h.dir === x.kind && h.ts === x.ts)), `[${nm}] 목록 ${r1.rows.length}줄 = 계산 결과 ${r1.hits.length}건(티커·종류·시각 일치) · 분류 ${JSON.stringify(r1.kinds)}`);
    const ord = r1.rows.map(x => [x.kind === 'rb' ? 1 : 0, -x.ts]); ok(ord.every((v, i) => !i || ord[i-1][0] < v[0] || (ord[i-1][0] === v[0] && ord[i-1][1] <= v[1])), `[${nm}] 순서: ⭐·⚠️ 먼저 → ▲, 그 안에서 최근 발생 순`);
    ok(r1.rows.every(x => !/강한 매수|매수 추천|매수 확정/.test(x.text)) && /매매 신호 아님/.test(await pg.textContent('.id-stitle')), `[${nm}] '강한 매수' 표현 없음 · '매매 신호 아님' 표기`);
    ok(/장 종료 \d+/.test(r1.head) && /미장 지연/.test(r1.head), `[${nm}] 요약: ${r1.head.replace(/\s+/g, ' ').slice(0, 90)}`);
    if (OUT) await pg.locator('#idPanel').screenshot({ path: `${OUT}/scan-${nm}.png` });
    // 재시도(실패 종목만)
    failSet.clear(); const c0 = calls; await pg.click('[data-idretry]'); await pg.waitForFunction(() => !ID.scan.running, null, { timeout: 30000 });
    ok(calls - c0 === 2 && await pg.evaluate(() => ID.scan.fail.length === 0 && ID.scan.rows.length === ID.scan.total), `[${nm}] 실패 종목만 다시 조회 = 추가 호출 ${calls - c0}건 · 실패 0`);
    // 줄 → 기존 상세 화면 → 목록 복귀
    const c1 = calls, first = await pg.getAttribute('.id-srow', 'data-idopen'); await pg.click('.id-srow'); await pg.waitForSelector('#idChart', { timeout: 8000 }); await pg.waitForTimeout(300);
    ok(calls === c1 && await pg.evaluate(t => ID.t === t && !!document.querySelector('.id-card') && !!document.querySelector('[data-idback]') && !document.querySelector('.id-iv').hidden, first), `[${nm}] ${first} 줄 클릭 → 기존 차트·상세 화면(추가 호출 0) · 봉 간격 버튼 표시`);
    if (OUT) await pg.locator('#idPanel').screenshot({ path: `${OUT}/scan-open-${nm}.png` });
    await pg.click('[data-idback]'); await pg.waitForTimeout(200);
    ok(calls === c1 && await pg.evaluate(() => document.querySelectorAll('.id-srow').length > 0 && ID.t === null), `[${nm}] ← 목록으로: 다시 부르지 않고 목록 복귀`);
    // 90초 캐시
    await pg.click('#idScan'); await pg.waitForFunction(() => !ID.scan.running, null, { timeout: 30000 });
    ok(calls === c1 && /방금 받은 자료/.test(await pg.textContent('#idMsg')), `[${nm}] 90초 안 재조회 = 추가 호출 0 · 안내 문구`);
    // 개별 검색 유지
    await pg.fill('#idInput', tks[0]); await pg.click('#idGo'); await pg.waitForSelector('#idChart', { timeout: 8000 });
    ok(await pg.evaluate(t => ID.t === t, tks[0]), `[${nm}] 작은 검색창으로 개별 종목 열기 유지`);
    // 끄면 초기화 · 자동 조회 없음
    const c2 = calls; await pg.click('#idClose'); await pg.waitForTimeout(1500);
    ok(calls === c2 && await pg.evaluate(() => !ID.on && ID.scan.rows.length === 0 && document.getElementById('idOut').innerHTML === ''), `[${nm}] 닫으면 초기화 · 그 뒤 호출 0`);
    ok(!errs.length, `[${nm}] 페이지 오류 ${errs.length}건 ${errs[0] || ''}`);
    await ctx.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
