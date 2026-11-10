const { chromium } = require('playwright');
function kr(nowKstMin){ const off=32400; let s=5; const r=()=>{s=(s*16807)%2147483647;return s/2147483647-0.5};
  const d0=Date.UTC(2026,10,3,0,0)/1000, bars=[]; let p=40000;
  for(let d=0;d<5;d++) for(let i=0;i<72;i++){const o=p;p*=1+r()*0.004;bars.push([d0+d*86400+i*300,o,Math.max(o,p)*1.001,Math.min(o,p)*0.999,p,Math.round(1e4*(1+Math.abs(r())*3))]);}
  const st=d0+7*86400; // 오늘(11/10) 09:00 — 오늘 봉 없음
  const now=st+(nowKstMin-540)*60;
  return {t:'069500.KS',tz:'Asia/Seoul',gmtoffset:off,reg:{start:st,end:st+21600},lastTrade:bars[bars.length-1][0]+300,price:p,fetchedAt:now-30,bars,_now:now}; }
(async()=>{ const b=await chromium.launch(); let fail=0;
  for (const [lab,min,expect] of [['09:15',555,/장은 열렸어요/],['08:40',520,/장 시작 전/],['16:10',970,/장 종료/]]){
    const D=kr(min); const ctx=await b.newContext({viewport:{width:420,height:900}});
    await ctx.addInitScript(([fakeNow])=>{window.__INTRADAY_API='https://fake.test/'; const RD=Date; const F=function(...a){return a.length?new RD(...a):new RD(fakeNow*1000)}; F.now=()=>fakeNow*1000; F.UTC=RD.UTC; F.parse=RD.parse; F.prototype=RD.prototype; window.Date=F;}, [D._now]);
    await ctx.route('https://fake.test/**',x=>x.fulfill({status:200,contentType:'application/json',body:JSON.stringify(D)}));
    const pg=await ctx.newPage(); const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
    await pg.goto('http://localhost:8765/index.html'); await pg.waitForTimeout(1500);
    await pg.click('#idToggle'); await pg.fill('#idInput','069500.KS'); await pg.click('#idGo'); await pg.waitForTimeout(700);
    const txt=await pg.evaluate(()=>{const e=document.querySelector('.id-big'); const p=document.querySelector('.id-pill'); return (p?p.textContent:'')+' | '+(e?e.textContent:'');});
    const ok=expect.test(txt)&&!errs.length; if(!ok) fail++; console.log((ok?'✅ ':'❌ ')+lab+' KST → '+txt.slice(0,170)+(errs.length?' ERR '+errs[0]:''));
    if (lab==='09:15') await (await pg.$('.id-card')).screenshot({path:'/tmp/claude-0/-home-user-stock-signals/44897d7e-d377-5521-a287-9de9da5feee5/scratchpad/kr-wait.png'});
    await ctx.close(); }
  await b.close(); process.exit(fail?1:0); })();
