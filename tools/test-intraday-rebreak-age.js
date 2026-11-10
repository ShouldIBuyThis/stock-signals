// ▲ 경과 표시 시험: 발생 시각·현재·경과(분)가 E.bars 마지막 ▲와 같은지, 5분 초과 시 추격 주의, 장 종료 땐 경과 없음
const { chromium } = require('playwright');
function us(seed, cutI, lagMin){ const off=-18000; let s=seed; const r=()=>{s=(s*16807)%2147483647;return s/2147483647-0.5};
  const d0=Date.UTC(2026,10,2,14,30)/1000, bars=[]; let p=100;
  for(let d=0;d<5;d++) for(let i=0;i<78;i++){ if(d===4 && i>cutI) break; const ts=d0+d*86400+i*300; const o=p; p*=1+r()*0.006;
    if (d===4 && [39,40,51,52,63,64].includes(i)){ if ([39,51,63].includes(i)) p=o*0.994; else p=o*1.009; }
    let h=Math.max(o,p)*1.002, l=Math.min(o,p)*0.998, v=Math.round(1e4*(1+Math.abs(r())*3)); if (d===4 && [40,52,64].includes(i)){ v=8e4; h=p*1.0005; l=o*0.9995; }
    bars.push([ts,o,h,l,p,v]); }
  const st=d0+4*86400, last=bars[bars.length-1][0]; const now = cutI<77 ? last+300+lagMin*60 : st+23400+3600;
  return {t:'NVDA',tz:'America/New_York',gmtoffset:off,reg:{start:st,end:st+23400},lastTrade: cutI<77 ? last+300 : st+23400,price:p,fetchedAt:now-10,bars,_now:now}; }
(async()=>{ const b=await chromium.launch(); let fail=0, seen=0; const ok=(c,m)=>{console.log((c?'✅ ':'❌ ')+m); if(!c) fail++;};
  for (const [seed,cut,lag] of [[7,60,0],[11,60,0],[13,55,12],[17,70,25],[19,77,0],[23,50,3],[29,65,18]]){
    const D=us(seed,cut,lag); const ctx=await b.newContext({viewport:{width:420,height:1000}});
    await ctx.addInitScript(([n])=>{window.__INTRADAY_API='https://fake.test/'; const RD=Date; const F=function(...a){return a.length?new RD(...a):new RD(n*1000)}; F.now=()=>n*1000; F.UTC=RD.UTC; F.parse=RD.parse; F.prototype=RD.prototype; window.Date=F;}, [D._now]);
    await ctx.route('https://fake.test/**',x=>x.fulfill({status:200,contentType:'application/json',body:JSON.stringify(D)}));
    const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
    await pg.goto('http://localhost:8765/index.html'); await pg.waitForTimeout(1300);
    await pg.click('#idToggle'); await pg.fill('#idInput','NVDA'); await pg.click('#idGo'); await pg.waitForTimeout(600);
    for (const mode of ['easy','pro']){ await pg.click(`.id-mode [data-mode="${mode}"]`); await pg.waitForTimeout(250);
      const r=await pg.evaluate(()=>{ const c=ID.cache.get(ID.t), A=idMtf(c.d, Date.now()/1000); const eb=A.E.bars; const el=document.querySelector('.id-rbline');
        return { open:A.open, state:A.state, n:eb.length, lastTs: eb.length? eb[eb.length-1].ts:null, now:Date.now()/1000, line: el? {ts:+el.dataset.rbts, age:el.dataset.rbage, text:el.textContent, stale:el.classList.contains('stale')}:null,
          warn: !!document.querySelector('.id-rbwarn'), tri: document.querySelectorAll('#idChart .id-rb').length }; });
      if (!r.n){ ok(r.line===null && !r.warn, `[seed${seed}/${mode}] ▲ 없음 → 경과 줄 없음`); continue; }
      seen++;
      const age=Math.round((r.now-(r.lastTs+300))/60);
      ok(r.line && r.line.ts===r.lastTs && r.tri===r.n, `[seed${seed}/${mode}] 경과 줄 = 마지막 ▲(${r.n}개, 차트 ▲ ${r.tri}개)`);
      if (r.open){ ok(+r.line.age===age && r.line.text.includes(`신호 경과 ${age}분`) && r.line.stale===(age>5) && /추격 주의/.test(r.line.text)===(age>5), `[seed${seed}/${mode}] 장중 · 경과 ${age}분 → ${age>5?'추격 주의':'방금 확정'} | ${r.line.text.slice(0,70)}`);
        ok(r.warn===(age>5 && r.state==='go'), `[seed${seed}/${mode}] 상태 ${r.state} · 경고 상자 ${r.warn}`); }
      else ok(!/경과/.test(r.line.text) && /지난 사건/.test(r.line.text) && !r.warn, `[seed${seed}/${mode}] 장 종료 → 경과 없이 '지난 사건' | ${r.line.text.slice(0,50)}`);
    }
    ok(!errs.length, `[seed${seed}] 페이지 오류 ${errs.length} ${errs[0]||''}`); await ctx.close(); }
  console.log(`▲ 있는 경우 ${seen}건 시험`); await b.close(); process.exit(fail||!seen?1:0); })();
