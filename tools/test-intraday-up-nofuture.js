/* idUpEvents() 미래 참조·리페인팅 시험 — 합성 자료. ① 장중 한 시점 뒤의 봉을 엉터리로 바꿔도 그 시점까지 결과 동일 ② 사건마다 그 봉 끝까지의 봉만 넣어 다시 계산해도 같은 근거(뒤 봉이 와도 안 바뀜) */
const vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat','idUpEvidence','idUpEvents'].map(H.extractFunction).join('\n') + '\nthis.UE = idUpEvents;', ctx);
const CANDS = [{ pat: '장대양봉', dir: 'up', when: 'down', newState: true, match: 'primary' }, { pat: '역망치형', dir: 'up', when: 'wait', newState: true, match: 'primary' }];
let fail = 0, checks = 0, nev = 0; const ok = (c, m) => { checks++; if (!c){ fail++; if (fail < 6) console.log('❌ ' + m); } };
const key = x => JSON.stringify(x.map(e => [e.ts, e.ev.map(v => v.k).sort(), e.winKeys.slice().sort(), e.epi, e.first]));
for (const [tz, off, d0, n, seed] of [['America/New_York', -18000, Date.UTC(2026, 10, 2, 14, 30)/1000, 78, 3], ['Asia/Seoul', 32400, Date.UTC(2026, 10, 2, 0, 0)/1000, 72, 11], ['America/New_York', -18000, Date.UTC(2026, 10, 2, 14, 30)/1000, 78, 29]]){
  let s = seed; const r = () => { s = (s*16807) % 2147483647; return s/2147483647 - 0.5; };
  const all = []; let p = 100;
  for (let d = 0; d < 7; d++){ if (d === 5) p *= 1.012; for (let i = 0; i < n; i++){ const o = p; p *= 1 + r()*0.008 + (d === 5 && i < 6 ? 0.001 : 0); all.push([d0 + d*86400 + i*300, o, Math.max(o, p)*(1 + Math.abs(r())*0.003), Math.min(o, p)*(1 - Math.abs(r())*0.003), p, Math.round(1e4*(1 + Math.abs(r())*3))]); } }
  for (let di = 4; di < 6; di++){
    const dayBars = all.slice(di*n, (di + 1)*n), hist = all.slice((di - 4)*n, di*n), t0 = dayBars[0][0], end = dayBars[n-1][0] + 300;
    const mk = (bars, e) => ({ tz, gmtoffset: off, reg: { start: t0, end }, lastTrade: e, price: bars[bars.length-1][4], bars });
    const base = ctx.UE(mk(hist.concat(dayBars), end), end, CANDS); nev += base.length;
    /* ① 장중 한 시점(40번째 봉 끝): 그 뒤 같은 날 봉이 자료에 섞여 있고 값이 엉터리여도, 그 시점까지의 결과는 같아야 한다 */
    const tauM = dayBars[39][0] + 300, cutM = hist.concat(dayBars.filter(b => b[0] + 300 <= tauM));
    const junk = cutM.concat(dayBars.filter(b => b[0] + 300 > tauM).map(b => [b[0], 1, 999, 0.5, 500, 9e9]));
    ok(key(ctx.UE(mk(cutM, tauM), tauM, CANDS)) === key(ctx.UE(mk(junk, tauM), tauM, CANDS)), `${tz} d${di} 같은 날 뒤 봉 변조에 결과 바뀜`);
    for (const e of base.filter((_, i) => i % 3 === 0)){
      const tau = e.ts + 300, cutBars = hist.concat(dayBars.filter(b => b[0] + 300 <= tau));
      const live = ctx.UE(mk(cutBars, tau), tau, CANDS), me = live.find(x => x.ts === e.ts);
      ok(me && key([me]) === key([e]), `${tz} d${di} ${e.m}분 사건이 그 시점 계산과 다름`);
      ok(key(live) === key(base.filter(x => x.ts <= e.ts)), `${tz} d${di} ${e.m}분까지의 사건 목록이 뒤 봉 때문에 달라짐(리페인팅)`);
    }
  }
}
console.log(`${fail ? '❌' : '✅'} idUpEvents 미래 참조·리페인팅 시험 ${checks}건 (사건 ${nev}개) · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
