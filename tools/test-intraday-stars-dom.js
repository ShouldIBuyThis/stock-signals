const { chromium, devices } = require('playwright');
const OUT='/tmp/claude-0/-home-user-stock-signals/44897d7e-d377-5521-a287-9de9da5feee5/scratchpad/';
const CANDS=[{pat:'일반 양봉',dir:'up',when:null,newState:false,match:'names',hit:62,n:20,verified:false,why:'시험'},
             {pat:'인사이드바',dir:'down',when:null,newState:false,match:'names',hit:62,n:20,verified:false,why:'시험'}];
function usData(openNow){ const off=-18000; let s=7; const r=()=>{s=(s*16807)%2147483647;return s/2147483647-0.5};
  const d0=Date.UTC(2026,10,2,14,30)/1000, bars=[]; let p=100;
  for(let d=0;d<5;d++) for(let i=0;i<78;i++){const ts=d0+d*86400+i*300; if(openNow && d===4 && i>50) break; const o=p;p*=1+r()*0.006;bars.push([ts,o,Math.max(o,p)*1.002,Math.min(o,p)*0.998,p,Math.round(1e4*(1+Math.abs(r())*3))]);}
  const st=d0+4*86400; const lt = openNow? bars[bars.length-1][0]+300 : st+23400;
  return {t:'NVDA',tz:'America/New_York',gmtoffset:off,reg:{start:st,end:st+23400},lastTrade:lt,price:p,fetchedAt:lt+30,bars,_now:lt+60}; }
(async()=>{
  const b=await chromium.launch(); const errs=[]; let fail=0; const ok=(c,m)=>{console.log((c?'✅ ':'❌ ')+m); if(!c) fail++;};
  for (const [nm,openNow,dev] of [['open',true,devices['iPhone 13']],['closed',false,{viewport:{width:1100,height:900}}]]){
    const D=usData(openNow);
    const ctx=await b.newContext(dev);
    await ctx.addInitScript(([fakeNow,c])=>{window.__INTRADAY_API='https://fake.test/'; window.__ID_STAR_CANDS=c; const RD=Date; const F=function(...a){return a.length?new RD(...a):new RD(fakeNow*1000)}; F.now=()=>fakeNow*1000; F.UTC=RD.UTC; F.parse=RD.parse; F.prototype=RD.prototype; window.Date=F;}, [D._now, CANDS]);
    await ctx.route('https://fake.test/**',x=>x.fulfill({status:200,contentType:'application/json',body:JSON.stringify(D)}));
    const pg=await ctx.newPage(); pg.on('pageerror',e=>errs.push(e.message));
    await pg.goto('http://localhost:8765/index.html'); await pg.waitForTimeout(1800);
    await pg.click('#idToggle'); await pg.fill('#idInput','NVDA'); await pg.click('#idGo'); await pg.waitForTimeout(700);
    for (const mode of ['easy','pro']){
      await pg.click(`.id-mode [data-mode="${mode}"]`); await pg.waitForTimeout(400);
      const r = await pg.evaluate(()=>{ const c=ID.cache.get(ID.t); const evs=c.stars.map(e=>({ts:e.ts,dir:e.dir,m:e.m,e5:e.e5})); 
        const stars=[...document.querySelectorAll('#idChart .id-star')].map(g=>({ts:+g.dataset.ts,dir:g.dataset.dir,glyph:g.dataset.glyph}));
        const dl=document.querySelector('.id-starday'); const day=dl?{up:+dl.dataset.up,down:+dl.dataset.down,text:dl.textContent}:null;
        const arrows=[...document.querySelectorAll('#idChart text')].filter(t=>t.textContent==='▲').length;
        const sum=document.querySelector('.id-starline'); return {evs,stars,arrows,day,sum: sum?{ts:+sum.dataset.starsum,dir:sum.dataset.stardir,text:sum.textContent}:null}; });
      const same = JSON.stringify(r.evs.map(e=>[e.ts,e.dir]))===JSON.stringify(r.stars.map(s=>[s.ts,s.dir]));
      ok(same && r.stars.length>0, `[${nm}/${mode}] 차트 별 ${r.stars.length}개 = 사건 ${r.evs.length}개 (시각·방향 일치) · ▲ ${r.arrows}개 · 같은 봉 ▲+⭐ ${r.evs.filter(e=>e.e5).length}건`);
      const gOk=r.stars.every(s=>s.glyph===(s.dir==='up'?'star':s.dir==='down'?'warn':'both'));
      ok(gOk, `[${nm}/${mode}] 마커 모양: 상승=★ ${r.stars.filter(s=>s.glyph==='star').length} · 하락=⚠️ ${r.stars.filter(s=>s.glyph==='warn').length} · 충돌=둘 다 ${r.stars.filter(s=>s.glyph==='both').length}`);
      const nu=r.evs.filter(e=>e.dir!=='down').length, nd=r.evs.filter(e=>e.dir!=='up').length;
      ok(r.day && r.day.up===nu && r.day.down===nd && (nu? !/상승 연구 후보 없음/.test(r.day.text) : /상승 연구 후보 없음/.test(r.day.text)) && (nd? !/하락 주의 연구 후보 없음/.test(r.day.text) : /하락 주의 연구 후보 없음/.test(r.day.text)), `[${nm}/${mode}] 하루 요약 줄 상승 ${r.day&&r.day.up}/${nu} · 하락 ${r.day&&r.day.down}/${nd}: ${r.day&&r.day.text.slice(0,80)}`);
      if (nm==='open'){ const last=r.evs[r.evs.length-1]; ok(r.sum ? (r.sum.ts===last.ts && r.sum.dir===last.dir) : true, `[${nm}/${mode}] 요약 줄 ${r.sum? r.sum.text.slice(0,60):'없음(최근 3봉에 별 없음)'} → 마지막 사건과 같은 시각·방향`);
        if (r.sum && r.sum.dir==='down') ok(!/매수 후보(?! 아님)/.test(r.sum.text) || /매수 후보 아님/.test(r.sum.text), `[${nm}/${mode}] 하락 요약에 매수 안내 없음`); }
      else ok(r.sum===null, `[${nm}/${mode}] 장 종료 → 요약 줄 없음`);
      // 별 클릭 → 말풍선이 같은 사건
      const n = Math.min(r.stars.length, 6); let popOk=true;
      for (let i=0;i<n;i++){ { const bx = await pg.locator('#idChart .id-star').nth(i).locator('rect').boundingBox(); await pg.mouse.click(bx.x + bx.width/2, bx.y + bx.height/2); } await pg.waitForTimeout(80);
        const p = await pg.evaluate(()=>{const p=document.querySelector('#idChart .id-pop'); return {hidden:p.hidden, ts:+p.dataset.ts, dir:p.dataset.dir, text:p.textContent};});
        const ev=r.evs[i]; const hm=String(Math.floor(ev.m/60)).padStart(2,'0')+':'+String(ev.m%60).padStart(2,'0');
        if (p.hidden || p.ts!==ev.ts || p.dir!==ev.dir || !p.text.includes(hm)) { popOk=false; if(!global.__shown){ global.__shown=1; console.log('   상세', JSON.stringify({i, hidden:p.hidden, pts:p.ts, ets:ev.ts, pdir:p.dir, edir:ev.dir, hm, text:p.text.slice(0,120)})); } }
        if (ev.dir==='down' && !/매수 후보가 아니에요/.test(p.text)) popOk=false;
        if (ev.dir==='up' && !/상승 연구 후보/.test(p.text)) popOk=false;
        if (ev.dir==='mixed' && !/불확실/.test(p.text)) popOk=false; }
      ok(popOk, `[${nm}/${mode}] 별 ${n}개 클릭 → 말풍선 시각·방향·문구가 같은 사건`);
    }
    await pg.click('.id-mode [data-mode="easy"]'); await pg.waitForTimeout(300);
    await pg.locator('#idChart .id-star').first().click({force:true}); await pg.waitForTimeout(120);
    await (await pg.$('.id-card')).screenshot({path:OUT+`star-${nm}.png`});
    // 15분봉 보기에선 별 없음(5분봉 전용)
    await pg.click('.id-iv [data-iv="15"]'); await pg.waitForTimeout(250);
    ok(await pg.evaluate(()=>document.querySelectorAll('#idChart .id-star').length)===0, `[${nm}] 15분봉 보기에는 별 없음(5분봉 확정 봉 전용)`);
    await ctx.close();
  }
  ok(errs.length===0, `페이지 오류 ${errs.length}건 ${errs.slice(0,2)}`);
  await b.close(); process.exit(fail?1:0);
})();
