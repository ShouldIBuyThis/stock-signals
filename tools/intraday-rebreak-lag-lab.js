/**
 * 5분 재돌파(▲) 늦게 본 신호 · 과열 · 소진 · 재눌림 — docs/2026-11-10-rebreak-lag.md (결과 전 고정).
 * idMtf()는 index.html에서 추출(재구현 금지). 사용: node tools/intraday-rebreak-lag-lab.js i5.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal','idEma','idAgg','idMtf'].map(H.extractFunction).join('\n') + '\nthis.mtf = idMtf;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const DL = [0, 5, 10, 20, 30], COST = 0.05;
const EV = [], BASE = [];
const atIdx = (B, ts) => B.findIndex(b => b[0] >= ts);
const ret = (B, k, h) => { if (k < 0) return null; const i = k + h/5 - 1; return i < B.length ? (B[i][4]/B[k][1] - 1)*100 : null; };
for (const [t, D] of Object.entries(data)){
  const kr = /\.(KS|KQ)$/.test(t);
  const days = []; let cur = null;
  for (const b of D.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); } cur.bars.push(b); }
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300;
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    for (let k = 1; k < B.length; k += 3){ const r15 = ret(B, k, 15), r30 = ret(B, k, 30); if (r30 != null) BASE.push({ kr, day: today.day, r15, r30 }); }
    for (let k = 1; k < B.length; k++){
      const tau = B[k-1][0] + 300;
      const A = ctx.mtf({ tz: kr ? 'Asia/Seoul' : 'America/New_York', gmtoffset: today.off, reg: { start: t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k).map(b => b.slice(0, 6))) }, tau);
      if (!A) continue;
      const L = A.tf[5].filter(r => r.done).pop(); if (!L || L.ts !== B[k-1][0]) continue;
      if (!A.E.bars.some(z => z.ts === L.ts)) continue;            // ▲가 이 봉에 새로 생김
      const atr = A.P && A.P.atr, evEnd = L.ts + 300;
      const e = { t, kr, day: today.day, go: A.state === 'go', dvw: atr && L.vw != null ? (L.c - L.vw)/atr : null, de9: atr ? (L.c - L.e9)/atr : null, ent: {} };
      for (const d of DL){ const ki = atIdx(B, evEnd + d*60); e.ent[d] = ki < 0 ? null : { k: ki, p: B[ki][1], r15: ret(B, ki, 15), r30: ret(B, ki, 30) }; }
      /* 소진: 봉 끝부터 60분 */
      const k0 = atIdx(B, evEnd);
      if (k0 >= 0 && k0 + 11 < B.length){
        const w = B.slice(k0, k0 + 12), hi = Math.max(...w.map(b => b[2])), pk = w.findIndex(b => b[2] === hi);
        e.exh = pk < 4 && w[11][4] < B[k0][1]; e.run20 = (Math.max(...w.slice(0, 4).map(b => b[2]))/B[k0][1] - 1)*100;
      }
      /* 재눌림 지정가: 재돌파 봉의 9EMA(①) · VWAP(②), 본 시각부터 60분 */
      e.lim = {};
      for (const d of [0, 20]) for (const [nm, lv] of [['e9', L.e9], ['vw', L.vw]]){
        const ks = atIdx(B, evEnd + d*60); if (ks < 0 || lv == null){ e.lim[d + nm] = null; continue; }
        let fill = null; for (let i = ks; i < Math.min(B.length, ks + 12); i++){ if (B[i][3] <= lv){ fill = { i, p: Math.min(B[i][1], lv) }; break; } }
        if (!fill){ e.lim[d + nm] = { filled: false }; continue; }
        const j = fill.i + 5; e.lim[d + nm] = { filled: true, r30: j < B.length ? (B[j][4]/fill.p - 1)*100 : null };   // 체결 봉 시작부터 30분 뒤 종가(추격 +30분과 같은 잣대)
      }
      EV.push(e);
    }
  }
}
const dates = [...new Set(BASE.map(e => e.day))].sort(), half = new Set(dates.slice(0, dates.length >> 1));
const S = z => { z = z.filter(v => v != null && isFinite(v)); return { n: z.length, hit: z.length ? z.filter(v => v > 0).length/z.length : NaN, avg: z.length ? z.reduce((a, b) => a + b, 0)/z.length : NaN }; };
const pct = x => isFinite(x) ? (x*100).toFixed(0) + '%' : '—', sg = x => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '—';
const grade = n => n >= 50 ? '사용' : n >= 30 ? '방향' : n >= 15 ? '참고' : '불가';
const fmt = s => `n${s.n}(${grade(s.n)}) ${pct(s.hit)} ${sg(s.avg)}% 순 ${sg(s.avg - COST)}%`;
const med = a => { const s = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
console.log(`\n=== 5분 재돌파(▲) 늦게 본 신호 연구 — ${Object.keys(data).length}종목 · ${dates[0]}~${dates[dates.length-1]} · ▲ ${EV.length}건 (🟢 상태 ${EV.filter(e => e.go).length}) ===`);
for (const [mk, f] of [['미장', e => !e.kr], ['국장', e => e.kr]]){
  const ev = EV.filter(f), bs = BASE.filter(f);
  console.log(`\n■ ${mk} — ▲ ${ev.length}건 · 기준선 +15분 ${fmt(S(bs.map(e => e.r15)))} · +30분 ${fmt(S(bs.map(e => e.r30)))}`);
  console.log('  [1] 늦게 본 비용 (진입 = 봉 끝 + D분 뒤 첫 봉 시가)');
  for (const d of DL){ const z = ev.map(e => e.ent[d]).filter(Boolean), zg = ev.filter(e => e.go).map(e => e.ent[d]).filter(Boolean);
    const h1 = ev.filter(e => half.has(e.day)).map(e => e.ent[d]).filter(Boolean), h2 = ev.filter(e => !half.has(e.day)).map(e => e.ent[d]).filter(Boolean);
    console.log(`    D${String(d).padStart(2)}: +15분 ${fmt(S(z.map(x => x.r15)))} · +30분 ${fmt(S(z.map(x => x.r30)))} | 🟢만 +30분 ${fmt(S(zg.map(x => x.r30)))} | 반쪽 +30분 앞 ${sg(S(h1.map(x => x.r30)).avg)} · 뒤 ${sg(S(h2.map(x => x.r30)).avg)}`); }
  console.log('  [2] 과열 (재돌파 봉 종가 거리 ÷ 15분 ATR) — D0 / D20 +30분');
  for (const [nm, key] of [['VWAP 거리', 'dvw'], ['9EMA 거리', 'de9']]){
    for (const [lab, lo, hi] of [['<0.5', -Infinity, 0.5], ['0.5~1.5', 0.5, 1.5], ['≥1.5', 1.5, Infinity]]){
      const z = ev.filter(e => e[key] != null && e[key] >= lo && e[key] < hi), r = d => z.map(e => e.ent[d] && e.ent[d].r30);
      const hh = (d, inH) => sg(S(z.filter(e => half.has(e.day) === inH).map(e => e.ent[d] && e.ent[d].r30)).avg);
      console.log(`    ${nm} ${lab.padEnd(7)} D0 ${fmt(S(r(0)))} · D20 ${fmt(S(r(20)))} | 반쪽 D0 앞 ${hh(0, true)} 뒤 ${hh(0, false)} · D20 앞 ${hh(20, true)} 뒤 ${hh(20, false)}`); } }
  const ex = ev.filter(e => e.exh != null);
  console.log(`  [3] 소진: 60분 최고가가 첫 20분 안 + 60분 종가 < D0 진입가 = ${ex.filter(e => e.exh).length}/${ex.length} = ${pct(ex.filter(e => e.exh).length/ex.length)} · 첫 20분 최고가까지 상승 중앙값 ${sg(med(ex.map(e => e.run20)))}% (반쪽 앞 ${pct(ex.filter(e => half.has(e.day) && e.exh).length/ex.filter(e => half.has(e.day)).length)} · 뒤 ${pct(ex.filter(e => !half.has(e.day) && e.exh).length/ex.filter(e => !half.has(e.day)).length)})`);
  console.log('  [4] 재눌림 지정가 vs 같은 시각 추격 (+30분, 순 = 비용 0.05% 차감)');
  for (const d of [0, 20]) for (const nm of ['e9', 'vw']){
    const z = ev.filter(e => e.lim[d + nm]), f1 = z.filter(e => e.lim[d + nm].filled), nf = z.filter(e => !e.lim[d + nm].filled);
    const lim = S(f1.map(e => e.lim[d + nm].r30)), chase = S(z.map(e => e.ent[d] && e.ent[d].r30)), chaseF = S(f1.map(e => e.ent[d] && e.ent[d].r30)), miss = S(nf.map(e => e.ent[d] && e.ent[d].r30));
    const hh = inH => { const a = S(f1.filter(e => half.has(e.day) === inH).map(e => e.lim[d + nm].r30)), b = S(z.filter(e => half.has(e.day) === inH).map(e => e.ent[d] && e.ent[d].r30)); return `${sg(a.avg - b.avg)}`; };
    console.log(`    D${d} ${nm === 'e9' ? '9EMA' : 'VWAP'} 지정가: 체결 ${f1.length}/${z.length}=${pct(f1.length/z.length)} · 체결분 ${fmt(lim)} | 같은 D 추격 전체 ${fmt(chase)} · (체결된 건을 추격했다면 ${sg(chaseF.avg)}%) · 미체결 건 추격 ${sg(miss.avg)}% n${miss.n} | 지정가−추격 반쪽 앞 ${hh(true)} 뒤 ${hh(false)}`); }
}
