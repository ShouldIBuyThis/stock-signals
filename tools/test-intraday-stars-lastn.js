
const vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat','idStarEvents'].map(H.extractFunction).join('\n') + '\nthis.SE = idStarEvents;', ctx);
const C = ['일반 음봉','인사이드바','도지'].map(p => ({ pat:p, dir:'down', when:'down', newState:true, match:'primary' })).concat(['일반 양봉','상승장악형'].map(p => ({ pat:p, dir:'up', when:'wait', newState:true, match:'primary' })), [{ pat:'일반 양봉', dir:'up', when:null, match:'names' }]);
let fail = 0, n = 0, ev = 0;
for (let seed = 1; seed <= 12; seed++){ let s = seed*7919; const r = () => { s = (s*16807) % 2147483647; return s/2147483647 - 0.5; };
  const d0 = Date.UTC(2026,10,2,14,30)/1000, bars = []; let p = 100; for (let d = 0; d < 5; d++) for (let i = 0; i < 78; i++){ if (d === 4 && i > 20 + seed*4) break; const o = p; p *= 1 + r()*0.007; bars.push([d0 + d*86400 + i*300, o, Math.max(o,p)*1.002, Math.min(o,p)*0.998, p, Math.round(1e4*(1+Math.abs(r())*3))]); }
  const st = d0 + 4*86400, now = bars[bars.length-1][0] + 300, d = { tz:'America/New_York', gmtoffset:-18000, reg:{ start:st, end:st+23400 }, lastTrade: now, price:p, bars };
  const full = ctx.SE(d, now, C);
  for (const N of [3, 12, 500]){ const part = ctx.SE(d, now, C, N), todayN = new Set(bars.filter(b => b[0] >= st).slice(-N).map(b => b[0]));
    const want = JSON.stringify(full.filter(e => todayN.has(e.ts)).map(e => [e.ts, e.dir, e.items.map(c => c.pat)])), got = JSON.stringify(part.map(e => [e.ts, e.dir, e.items.map(c => c.pat)]));
    n++; ev += part.length; if (want !== got){ fail++; console.log('❌ seed', seed, 'N', N); } } }
console.log(`${fail ? '❌' : '✅'} idStarEvents 최근 N봉 = 전체 계산의 마지막 N봉 — ${n}건 비교(사건 ${ev}개) · 실패 ${fail}`);
