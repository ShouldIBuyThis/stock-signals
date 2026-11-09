/**
 * 장중 5분봉 캔들 신호등 시험 — docs/2026-11-09-intraday-candle.md §3 (결과 전 고정).
 * idMtf()·idCandle()은 index.html에서 추출(재구현 금지). 사용: node tools/intraday-candle-lab.js i5.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
vm.createContext(ctx);
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandle'].map(H.extractFunction).join('\n') + '\nthis.idMtf = idMtf; this.idCandle = idCandle;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const HZ = [5, 15, 30, 60], ev = [], base = [], ev2 = [];
for (const [t, D] of Object.entries(data)){
  const kr = /\.(KS|KQ)$/.test(t);
  const days = []; let cur = null;
  for (const b of D.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off:b[6], bars:[] }; days.push(cur); } cur.bars.push(b); }
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300;
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    for (let k = 1; k < B.length; k++){
      const tau = B[k][0];                       // B[k-1]이 막 확정된 시각
      const seen = B.slice(0, k).map(b => b.slice(0, 6));
      const A = ctx.idMtf({ gmtoffset: today.off, reg:{ start:t0, end }, lastTrade: tau, bars: hist.concat(seen) }, tau);
      if (!A) continue;
      const fut = B.slice(k), entry = fut[0][1];
      const out = { t, kr, day: today.day, r:{} };
      for (const h of HZ){ const n = h/5; out.r[h] = fut.length >= n ? (fut[n-1][4]/entry - 1)*100 : null; }
      const w = fut.slice(0, 12);
      out.mfe = (Math.max(...w.map(b => b[2]))/entry - 1)*100; out.mae = (Math.min(...w.map(b => b[3]))/entry - 1)*100;
      if (k % 3 === 0) base.push(out);           // 기준선은 15분 간격 표본(계산량 절약)
      const L = A.tf[5].filter(r => r.done).pop();
      const hit = A.E.bars.find(z => z.ts === L.ts);
      if (!hit){
        if (A.E.ok && A.E.hit && A.E.hit.ts < L.ts){ const C2 = ctx.idCandle(A, L); ev2.push({ ...out, go: A.state === 'go', shape: C2.shape, light: C2.light }); }
        continue;
      }
      const C = ctx.idCandle(A, L);
      ev.push({ ...out, go: A.state === 'go', shape: C.shape, light: C.light });
    }
  }
}
const dates = [...new Set(base.map(p => p.day))].sort(), mid = dates[Math.floor(dates.length/2)];
const grade = n => n >= 50 ? '사용 가능' : n >= 30 ? '방향만' : n >= 15 ? '참고' : '신뢰 불가';
const stat = (xs, h) => { const z = xs.map(o => o.r[h]).filter(v => v != null); if (!z.length) return null;
  return { n: z.length, hit: z.filter(v => v > 0).length/z.length*100, avg: z.reduce((a, b) => a + b, 0)/z.length }; };
const med = a => { const s = a.filter(x => isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length/2)] : NaN; };
const row = (lab, xs, ref) => console.log(`  ${lab.padEnd(18)} n=${String(xs.length).padStart(5)} (${grade(xs.length)}) ` + HZ.map(h => {
    const s = stat(xs, h), r = ref && stat(ref, h); if (!s) return `+${h}분 —`;
    return `+${h}분 ${s.hit.toFixed(0)}%${r ? `(${s.hit - r.hit >= 0 ? '+' : ''}${(s.hit - r.hit).toFixed(0)})` : ''} ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(3)}%`; }).join(' · ')
  + ` · MFE중앙 ${med(xs.map(o => o.mfe)).toFixed(2)} MAE중앙 ${med(xs.map(o => o.mae)).toFixed(2)}`);
console.log(`\n=== 장중 5분봉 캔들 신호등 시험 — ${Object.keys(data).length}종목 · ${dates[0]}~${dates[dates.length-1]} · 진입=다음 5분봉 시가 · 비용 미반영 · 괄호=E 전체 대비 %p ===`);
row('기준: 모든 시점', base); row('기준: E 사건 전체', ev, null);
console.log('\n[1] 신호등별 (E 사건)'); for (const L of ['🟢','🟡','🔴']) row(L, ev.filter(e => e.light === L), ev);
console.log('\n[2] 형태별 (E 사건)');
const shapes = [...new Set(ev.map(e => e.shape))];
shapes.map(s => [s, ev.filter(e => e.shape === s)]).sort((a, b) => b[1].length - a[1].length).forEach(([s, xs]) => row(s, xs, ev));
console.log('\n[3] 🟢 5분 재돌파 확인(go) 안에서');
const G = ev.filter(e => e.go); row('go 전체', G, ev); for (const L of ['🟢','🟡','🔴']) row(`go ${L}`, G.filter(e => e.light === L), G);
console.log(`\n[4] 반쪽·시장 (신호등, +15·+30분, E 전체 대비) 기준일 ${mid}`);
for (const [lab, f] of [['앞 반', e => e.day < mid], ['뒤 반', e => e.day >= mid], ['미장', e => !e.kr], ['국장', e => e.kr]]){
  const E = ev.filter(f); console.log(`  ${lab}: E 전체 n=${E.length}`);
  for (const L of ['🟢','🟡','🔴']) row(`  ${lab} ${L}`, E.filter(e => e.light === L), E);
}
console.log('\n[5] 재돌파 뒤 1·2번째 확정 봉(E 충족 표시 중) 최신 봉 신호등 — 기준 = 이 집합 전체');
row('전체', ev2, null); for (const L of ['🟢','🟡','🔴']) row(L, ev2.filter(e => e.light === L), ev2);
for (const [lab, f] of [['앞 반', e => e.day < mid], ['뒤 반', e => e.day >= mid]]){ const E = ev2.filter(f); for (const L of ['🟢','🔴']) row(`  ${lab} ${L}`, E.filter(e => e.light === L), E); }
