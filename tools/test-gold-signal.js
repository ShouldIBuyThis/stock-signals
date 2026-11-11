/* 🏆 황금신호 · 장바구니 ⏱ 장중 마지막 신호 브라우저 시험 — 가짜 중계 서버(합성 5분봉).
   사용: (저장소에서 python3 -m http.server 8765) node tools/test-gold-signal.js
   확인: 부제 문구 · 후보 = (강한매수|다중|💡) ∩ 상승 캔들패턴 · 장중 판정 = idMtf() 재생과 일치 · 일봉 날짜 뒤 봉은 안 씀 ·
         후보만 호출(≤20) · 🏆는 세 조건 충족 종목만 · 장바구니 ⏱ 줄 · 도움말 세 가지 · 페이지 오류 0 */
const { chromium } = require('playwright');
function gen(t, lastDay){
  const kr = /\.(KS|KQ)$/.test(t), off = kr ? 32400 : -18000;
  let s = 7; for (const ch of t) s = (s*131 + ch.charCodeAt(0)) % 2147483647;
  const r = () => { s = (s*16807) % 2147483647; return s/2147483647 - 0.5; };
  const base = Date.parse(lastDay + 'T00:00:00Z')/1000 + (kr ? 0 : 14.5*3600), bars = []; let p = 20 + Math.abs(r())*200;
  const drift = (s % 3 === 0) ? 0.0012 : 0;                       // 일부 종목은 꾸준히 오르게(30분 추세 위)
  for (let d = -4; d <= 1; d++) for (let i = 0; i < 78; i++){   // d=1: 일봉 날짜 다음 세션(쓰면 안 됨)
    const ts = base + d*86400 + i*300, o = p; p *= 1 + r()*0.006 + drift;
    if ([30, 44, 58].includes(i)) p = o*0.994; if ([31, 45, 59].includes(i)) p = o*1.009;
    let h = Math.max(o, p)*1.002, l = Math.min(o, p)*0.998, v = Math.round(1e4*(1 + Math.abs(r())*3));
    if ([31, 45, 59].includes(i)){ v = 9e4; h = p*1.0005; l = o*0.9995; }
    bars.push([ts, o, h, l, p, v]); }
  const last = bars[bars.length-1][0] + 300, st = base + 86400;
  return { t, tz: kr ? 'Asia/Seoul' : 'America/New_York', gmtoffset: off, reg: { start: st, end: st + (kr ? 21600 : 23400) }, lastTrade: last, price: p, fetchedAt: last + 30, bars };
}
(async () => {
  const b = await chromium.launch(); let fail = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) fail++; };
  const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const seen = [];
  await ctx.addInitScript(() => { window.__INTRADAY_API = 'https://fake.test/'; });
  let LD = {};
  await ctx.route('https://fake.test/**', async x => { const t = new URL(x.request().url()).searchParams.get('t'); seen.push(t);
    x.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gen(t, LD[t] || '2026-11-09')) }); });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('http://localhost:8765/index.html'); await pg.waitForTimeout(1500);
  LD = await pg.evaluate(() => Object.fromEntries(allStocks().map(s => [String(s.ticker).toUpperCase(), s.last_date])));
  /* 실제 원장 기준 후보 수(오늘 0일 수 있음)를 먼저 세고, 화면 모양 시험을 위해 패턴이 뜬 몇 종목을 '강한매수'로 가정한다(시험 안에서만) */
  const real = await pg.evaluate(() => SB_GOLD.cands.map(c => c.s.ticker + '(' + c.tier + ')'));
  console.log(`ℹ️ 실제 오늘 후보 ${real.length}종목 ${real.join(',')}`);
  await pg.evaluate(() => { const orig = window.sbDailyTier, pick = new Set(['APLD', 'AMAT', 'NOW', 'MU', 'MSFT', '069500.KS']);
    window.sbDailyTier = (s, mm) => pick.has(s.ticker) ? '강한매수' : orig(s, mm); SB_GOLD.m.clear(); render(); }); seen.length = 0;
  await pg.waitForFunction(() => !SB_GOLD.run && SB_GOLD.cands.every(c => SB_GOLD.m.has(sbGoldKey(c.s))), null, { timeout: 30000 });
  const sub = await pg.textContent('.sb-board .section-h .sub');
  ok(/일봉 종가 기준/.test(sub) && /강한매수와 캔들패턴/.test(sub) && /황금신호/.test(sub), `부제: ${sub}`);
  const R = await pg.evaluate(() => {
    let mm = new Map(currentMultiRanked().map(x => [x.ticker, x]));
    const list = allStocks().filter(s => (state.market === "all" || (state.market === "kr" ? s._kr : !s._kr)) && !state.hidden.includes(s.ticker));
    const exp = list.filter(s => sbDailyTier(s, mm)
      && sbItemsFor(s, {main:true}).some(x => !x.site && (x.kind === 'green' || x.kind === 'blue'))).map(s => s.ticker);
    const got = SB_GOLD.cands.map(c => c.s.ticker);
    /* 장중 판정 독립 재생: 일봉 날짜까지의 봉만 → 마지막 ▲ → 그 봉 끝 시점 idMtf().state */
    const chk = SB_GOLD.cands.map(c => { const t = String(c.s.ticker).toUpperCase(), d = ID.cache.get(t).d, day = c.s.last_date, off = d.gmtoffset;
      const bars = d.bars.filter(b => idLocal(b[0], off).day <= day), A = idMtf({ ...d, bars, lastTrade: bars[bars.length-1][0] + 300 }, Date.now()/1000);
      const rb = A.E.bars.slice(-1)[0], v = SB_GOLD.m.get(sbGoldKey(c.s));
      if (!rb) return { t, same: v.r.kind === 'none' && !v.ok, ok: false };
      const tau = rb.ts + 300, At = idMtf({ ...d, bars: bars.filter(b => b[0] + 300 <= tau), lastTrade: tau }, tau);
      return { t, same: v.r.kind === 'rb' && v.r.state === At.state && v.ok === true && v.r.m === rb.m && A.lastDay === day, ok: v.ok, st: At.state,
        future: d.bars.some(b => idLocal(b[0], off).day > day) }; });
    const gold = [...document.querySelectorAll('.sb-gold .sb-goldrow.on .sb-go')].map(e => e.dataset.rankgoto);
    return { exp, got, chk, gold, note: (document.querySelector('.sb-gold .sb-note') || {}).textContent || '' };
  });
  ok(R.got.length > 0 && JSON.stringify(R.exp.slice().sort()) === JSON.stringify(R.got.slice().sort()), `후보 ${R.got.length}종목 = (강한매수|다중|💡) ∩ 상승 캔들패턴 독립 계산: ${R.got.join(',')}`);
  ok(R.chk.every(c => c.same), `장중 마지막 ▲ 판정 = idMtf() 독립 재생과 일치 (${R.chk.map(c => c.t + ':' + (c.st || 'none')).join(' ')})`);
  ok(R.chk.every(c => c.future), `가짜 자료에 일봉 날짜 다음 세션이 있어도 그 봉은 쓰지 않음(lastDay = 일봉 날짜)`);
  ok(JSON.stringify(R.gold.slice().sort()) === JSON.stringify(R.chk.filter(c => c.ok).map(c => c.t).sort().map(t => R.got.find(g => g.toUpperCase() === t))), `🏆 표시 = 그날 ▲ 있는 종목만 (${R.gold.join(',') || '없음'} · 충족 ${R.chk.filter(c => c.ok).length})`);
  ok(new Set(seen).size === seen.length && seen.length === R.got.length && seen.length <= 20, `호출 = 후보 종목만 ${seen.length}건(중복 없음)`);
  ok(/55%\(20건\)/.test(R.note) && /매수 확정 신호가 아니/.test(R.note), `주의 문구: ${R.note.slice(0, 90)}…`);
  // 🏆 줄 그리기(강제로 1종목 충족시켜 모양 확인)
  const forced = await pg.evaluate(() => { const c = SB_GOLD.cands[0]; SB_GOLD.m.set(sbGoldKey(c.s), { r: { kind: 'rb', m: 600, n: 1, state: 'go', ok: true, t30: 'up', held15: true, broken15: false, e5: true }, ok: true }); sbGoldPaint();
    const row = document.querySelector('.sb-gold .sb-goldrow.on'); return row ? row.textContent.replace(/\s+/g, ' ') : ''; });
  ok(/🏆/.test(forced) && /일봉/.test(forced) && /🕯/.test(forced) && /5분 재돌파 ▲ .*30분 추세 위 ✓ · 15분 지지 ✓ — 참고.*▲ 있음 · 장중 조건 충족/.test(forced), `🏆 줄: ${forced.slice(0, 150)}`);
  const krGold = await pg.evaluate(() => { const c = SB_GOLD.cands.find(x => x.kr); if (!c) return null; SB_GOLD.m.set(sbGoldKey(c.s), { r: { kind: 'none' }, ok: false }); sbGoldPaint();
    const el = [...document.querySelectorAll('.sb-gold .sb-goldrow.on .sb-go')].find(e => e.dataset.rankgoto === c.s.ticker); return el ? el.closest('.sb-goldrow').textContent.replace(/\s+/g, ' ') : ''; });
  ok(krGold === null || /국장은 일봉 등급 ∩ 캔들만으로 황금/.test(krGold), `국장: 장중 ▲ 없어도 🏆 (${krGold === null ? '국장 후보 없음' : krGold.slice(0, 80)})`);
  if (process.env.SHOT_DIR){ await pg.setViewportSize({ width: 390, height: 844 }); await pg.evaluate(() => sbGoldPaint()); await pg.locator('.sb-gold').screenshot({ path: process.env.SHOT_DIR + '/gold.png' }); }
  // 장바구니
  await pg.evaluate(() => { SB_GOLD.m.clear(); state.cart = ['TSLA', 'APLD'].filter(t => allStocks().some(s => s.ticker === t)); openCartReview(); });
  await pg.waitForFunction(() => [...document.querySelectorAll('.cart-id')].every(e => !/확인 중/.test(e.textContent)), null, { timeout: 20000 });
  const cart = await pg.evaluate(() => [...document.querySelectorAll('.cart-id')].map(e => e.textContent.replace(/\s+/g, ' ')));
  ok(cart.length === 2 && cart.every(t => /장중 5분 재돌파\(\d+\/\d+\) 참고: /.test(t) && /(5분 재돌파 ▲|▲\(5분 재돌파\)가 한 번도)/.test(t)), `장바구니 ⏱ 줄 ${cart.length}개: ${cart[0]}`);
  ok(/참고만/.test(await pg.textContent('#modal')), `장바구니 설명에 '참고만'`);
  await pg.evaluate(() => { document.getElementById('modal').classList.remove('on'); state.tab = 'help'; render(); });
  const help = await pg.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
  ok(/오늘의 신호 — 세 가지를 같이 보세요/.test(help) && /일봉 판정/.test(help) && /캔들패턴/.test(help) && /장중 5분 재돌파/.test(help), `도움말: 세 가지 안내`);
  // 장중 상세 펼침: 전날 일봉 등급 + '보정 검증 중' 작은 안내 (두 모드)
  const prior = [];
  for (const mode of ['easy', 'pro']){
    await pg.evaluate(m => { state.tab = 'theme'; render(); try { localStorage.setItem('id_mode', m); } catch(e){} ID.mode = m; if (!ID.on) document.getElementById('idToggle').click(); idInput.value = 'APLD'; idQuery(false); }, mode);
    await pg.waitForFunction(() => document.querySelector('#idOut .id-big'), null, { timeout: 15000 });
    prior.push(await pg.evaluate(() => { const e = document.querySelector('#idOut .id-prior'); return e ? e.textContent.replace(/\s+/g, ' ') : ''; }));
  }
  ok(prior.every(t => /전날 일봉 종가\(\d+\/\d+\) 등급/.test(t) && /검증 진행 중/.test(t) && /반영하지 않았어요/.test(t)), `장중 상세(초보·전문가) 보정 안내: ${prior[0].slice(0, 90)}`);
  ok(!errs.length, `페이지 오류 ${errs.length}건 ${errs.slice(0, 2).join(' | ')}`);
  await b.close(); console.log(fail ? `실패 ${fail}` : '모두 통과'); process.exit(fail ? 1 : 0);
})();
