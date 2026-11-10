/**
 * 52주 신고가·신저가 × 장중 5분봉 — docs/2026-11-10-52w-intraday.md (결과 전 고정).
 * idMtf()·idUpEvidence()는 index.html에서 추출(재구현 금지). 사용: node tools/intraday-52w-lab.js hl.json i5.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat','idUpEvidence'].map(H.extractFunction).join('\n') + '\nthis.mtf = idMtf; this.UE = idUpEvidence;', ctx);
const HL = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), data = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const THEME = new Set(['0173Y0.KS', '0123G0.KS', '453650.KS', '0183J0.KS', 'NANC', 'GOP', 'MAGA']), ETF = new Set(['069500.KS', '229200.KS']);
const isKr = t => /\.(KS|KQ)$/.test(t);
const tick = (t, p) => ETF.has(t) ? (p < 2000 ? 1 : 5) : p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
const slip = (t, p) => isKr(t) ? tick(t, p) : p*0.0002, cost = t => isKr(t) ? (ETF.has(t) ? 0.03 : 0.21) : 0.05;
const EVN = ['N1 신고가 돌파', 'N2 신고가 근접(98%↑)', 'N3 신저가 근접(102%↓)', 'N4 신저가 이탈 뒤 회복'], OVN = ['단독', '+EMA9 위', '+VWAP 위', '+스토캐스틱 GC(3봉)', '+캔들 반등', '+거래량 1.5배'];
const HM = [15, 30, 60], HD = [1, 3, 5], T = [], BASE = []; let tkDays = { us: 0, kr: 0 };
for (const [t, Dt] of Object.entries(data)){
  if (THEME.has(t) || !HL[t]) continue;
  const kr = isKr(t), D = kr ? 20 : 0, mk = kr ? 'kr' : 'us';
  const days = []; let cur = null;
  for (const b of Dt.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); } cur.bars.push(b); }
  const closeOf = days.map(x => x.bars[x.bars.length-1][4]);
  for (let di = 4; di < days.length; di++){
    const today = days[di], hl = HL[t][today.day]; if (!hl) continue;
    const [H52, L52] = hl, B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300; tkDays[mk]++;
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    const outc = (k0, p0) => { const r = {}; for (const h of HM){ const i = k0 + h/5 - 1; r['m' + h] = i < B.length ? ((B[i][4] - slip(t, B[i][4]))/p0 - 1)*100 : null; }
      for (const h of HD){ const j = di + h; r['d' + h] = j < days.length ? ((closeOf[j] - slip(t, closeOf[j]))/p0 - 1)*100 : null; } return r; };
    for (let k = 6; k < B.length; k += 3) BASE.push({ t, mk, day: today.day, c: cost(t), ...outc(k, B[k][1] + slip(t, B[k][1])) });
    const seen = [false, false, false, false]; let maxH = -Infinity, minL = Infinity;
    for (let k = 0; k < B.length; k++){
      const tau = B[k][0] + 300; maxH = Math.max(maxH, B[k][2]); const prevMinL = minL; minL = Math.min(minL, B[k][3]);
      const c = B[k][4], cand = [c > H52, c >= H52*0.98 && c <= H52 && maxH <= H52, c <= L52*1.02 && c >= L52 && minL >= L52, prevMinL < L52 && c > L52];
      if (!cand.some((v, i) => v && !seen[i])) { continue; }
      const A = ctx.mtf({ tz: kr ? 'Asia/Seoul' : 'America/New_York', gmtoffset: today.off, reg: { start: t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k + 1).map(b => b.slice(0, 6))) }, tau);
      const L = A && A.tf[5].filter(r => r.done).pop(); if (!L || L.ts !== B[k][0]) continue;
      const D5 = A.tf[5].filter(r => r.done), prior = D5.slice(-21, -1), avgV = prior.length ? prior.reduce((s, r) => s + r.v, 0)/prior.length : 0;
      let ev = []; try { ev = ctx.UE(A).map(e => e.k); } catch(e){}
      /* 최근 3봉 안 스토캐스틱 GC — 앞 두 봉도 '그 봉 끝 시점' idMtf로 다시 계산해 같은 함수로 본다(사건 봉에서만 하므로 가볍다) */
      const gcAt = kk => { if (kk < 0) return false; const tt = B[kk][0] + 300, Ak = ctx.mtf({ tz: kr ? 'Asia/Seoul' : 'America/New_York', gmtoffset: today.off, reg: { start: t0, end }, lastTrade: tt, bars: hist.concat(B.slice(0, kk + 1).map(b => b.slice(0, 6))) }, tt);
        try { return !!Ak && ctx.UE(Ak).some(e => e.k === 'S1'); } catch(e){ return false; } };
      const gcNow = ev.includes('S1') || gcAt(k - 1) || gcAt(k - 2);
      const ov = [true, L.c > L.e9, L.vw != null && L.c > L.vw, gcNow, ev.some(x => ['C1', 'C2', 'C3', 'C4'].includes(x)), avgV > 0 && L.v >= 1.5*avgV];
      const k0 = B.findIndex(b => b[0] >= tau + D*60);
      for (let i = 0; i < 4; i++){ if (!cand[i] || seen[i]) continue; seen[i] = true;
        if (k0 < 0) continue; const p0 = B[k0][1] + slip(t, B[k0][1]);
        T.push({ t, mk, day: today.day, ev: i, ov, c: cost(t), ...outc(k0, p0) }); }
    }
  }
}
const dates = [...new Set(BASE.map(e => e.day))].sort(), n3 = Math.floor(dates.length/3), blk = [new Set(dates.slice(0, n3)), new Set(dates.slice(n3, 2*n3)), new Set(dates.slice(2*n3))];
const S = (xs, k) => { const v = xs.filter(e => e[k] != null); return { n: v.length, hit: v.length ? v.filter(e => e[k] > 0).length/v.length : NaN, net: v.length ? v.reduce((a, e) => a + e[k] - e.c, 0)/v.length : NaN, days: new Set(v.map(e => e.day)).size, tks: new Set(v.map(e => e.t)).size }; };
const pc = x => isFinite(x) ? Math.round(x*100) + '%' : '—', sg = x => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '—';
console.log(`\n=== 52주 신고가·신저가 × 장중 — ${dates[0]}~${dates[dates.length-1]} (${dates.length}거래일) · 종목·일 미장 ${tkDays.us} · 국장 ${tkDays.kr} · 미장 지연 0 · 국장 20분 ===`);
console.log('칸: n(서로 다른 날·종목) · 상승비율(슬리피지 포함 가격) / 순수익(비용 차감) — +15·30·60분 · +1·3·5일 | 워크포워드(+60분 · +3일)');
let cells = 0, pass = [];
for (const mk of ['us', 'kr']){
  const bs = BASE.filter(e => e.mk === mk), b = k => S(bs, k);
  console.log(`\n■ ${mk === 'us' ? '미장' : '국장'} 기준선: ` + [...HM.map(h => 'm' + h), ...HD.map(h => 'd' + h)].map(k => `${k.replace('m', '+').replace('d', '+')}${k[0] === 'm' ? '분' : '일'} ${pc(b(k).hit)} ${sg(b(k).net)}`).join(' · '));
  for (let i = 0; i < 4; i++) for (let o = 0; o < 6; o++){
    const z = T.filter(e => e.mk === mk && e.ev === i && e.ov[o]); cells++;
    if (z.length < 5){ console.log(`  ${EVN[i]} ${OVN[o]} — ${z.length}건(판단 불가)`); continue; }
    const wf = ['m60', 'd3'].map(k => [[[0], [1]], [[0, 1], [2]]].map(([tr, te]) => { const inB = (e, q) => q.some(x => blk[x].has(e.day));
      const A = S(z.filter(e => inB(e, tr)), k), Bt = S(z.filter(e => inB(e, te)), k), RA = S(bs.filter(e => inB(e, tr)), k), RB = S(bs.filter(e => inB(e, te)), k);
      const sel = A.days >= 10 && A.net > 0 && A.hit >= RA.hit + 0.03; return sel && Bt.days >= 5 && Bt.net > 0 && Bt.hit >= RB.hit + 0.03 ? '통과' : sel ? '선택→실패' : '미선택'; }));
    const ok = wf.some(w => w.every(x => x === '통과')); if (ok) pass.push(`${mk} ${EVN[i]} ${OVN[o]}`);
    const s15 = S(z, 'm15'), s60 = S(z, 'm60'), s3 = S(z, 'd3');
    console.log(`  ${ok ? '✅' : '  '}${EVN[i]} ${OVN[o].padEnd(14)} n${String(s15.n).padStart(4)}(${s15.days}일·${s15.tks}종목) · ` + [...HM.map(h => 'm' + h), ...HD.map(h => 'd' + h)].map(k => { const s = S(z, k); return `${k.replace('m', '+').replace('d', '+')}${k[0] === 'm' ? '분' : '일'} ${pc(s.hit)} ${sg(s.net)}`; }).join(' · ') + ` | +3일 n${s3.n}·${s3.days}일 | WF +60분 ${wf[0].join('/')} · +3일 ${wf[1].join('/')}`);
  }
}
console.log(`\n요약: ${cells}칸 · 워크포워드 두 번 통과(+60분 또는 +3일) ${pass.length}칸 ${pass.join(', ')}`);
