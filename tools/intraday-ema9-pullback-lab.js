/**
 * 9EMA 눌림 지정가 매수 모의 연구 — docs/2026-11-10-ema9-pullback.md (결과 전 고정).
 * idMtf()는 index.html에서 추출(재구현 금지). 사용: node tools/intraday-ema9-pullback-lab.js i5.json [--day=YYYY-MM-DD]
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal','idEma','idAgg','idMtf'].map(H.extractFunction).join('\n') + '\nthis.mtf = idMtf;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ONLY = (process.argv.find(a => a.startsWith('--day=')) || '').slice(6) || null;
const DL = [0, 5, 20], FL = ['F0 없음', 'F1 30분 상승', 'F2 9>20·VWAP 위', 'F3 F1+F2'], COST = 0.05;
const TR = [], BASE = []; let tkDays = 0; const tkM = { us: 0, kr: 0 };
for (const [t, D] of Object.entries(data)){
  const kr = /\.(KS|KQ)$/.test(t);
  const days = []; let cur = null;
  for (const b of D.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); } cur.bars.push(b); }
  for (let di = 4; di < days.length; di++){
    const today = days[di]; if (ONLY && today.day !== ONLY) continue;
    const B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300; tkDays++; tkM[kr ? 'kr' : 'us']++;
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    for (let k = 1; k < B.length; k += 3){ const i = k + 2; if (i < B.length) BASE.push({ kr, day: today.day, r15: (B[i][4]/B[k][1] - 1)*100 }); }
    /* 봉마다 그 봉 끝 시각 정보(그 시점 idMtf) */
    const info = [];
    for (let k = 0; k < B.length; k++){
      const tau = B[k][0] + 300;
      const A = ctx.mtf({ tz: kr ? 'Asia/Seoul' : 'America/New_York', gmtoffset: today.off, reg: { start: t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k + 1).map(b => b.slice(0, 6))) }, tau);
      const L = A && A.tf[5].filter(r => r.done).pop();
      info.push(L && L.ts === B[k][0] ? { end: tau, c: L.c, e9: L.e9, e20: L.e20, vw: L.vw, up30: !!(A.T && A.T.dir === 'up') } : null);
    }
    for (const d of DL){
      let lastFillInfo = -1;
      for (let k = 1; k < B.length; k++){
        if (B[k][0] < t0 + 1800) continue;
        let j = -1; for (let q = k - 1; q >= 0; q--) if (info[q] && info[q].end <= B[k][0] - d*60){ j = q; break; }
        if (j < 0 || j <= lastFillInfo) continue;
        const I = info[j]; if (!(I.c > I.e9)) continue;
        /* 체결 뒤 재무장: 마지막 체결에 쓴 정보 봉 이후에 '종가 > 9EMA' 봉이 새로 있어야 한다 — j > lastFillInfo 이고 I가 그 봉 */
        const lim = I.e9; if (!(B[k][3] <= lim)) continue;
        const deep = B[k][3] <= lim*(1 - 0.0005);   // 민감도: 저가가 지정가보다 0.05% 이상 아래(줄 서 있다 체결 못 하는 경우를 뺀 '확실 체결')
        const p = Math.min(B[k][1], lim), r = h => { const i = k + h/5 - 1; return i < B.length ? (B[i][4]/p - 1)*100 : null; };
        const mae = Math.min(...B.slice(k, k + 3).map(b => b[3]))/p*100 - 100;
        const f = [true, I.up30, I.e9 > I.e20 && I.vw != null && I.c > I.vw]; f.push(f[1] && f[2]);
        TR.push({ t, kr, day: today.day, d, f, deep, r5: r(5), r15: r(15), r30: r(30), mae });
        lastFillInfo = j;
      }
    }
  }
}
const dates = [...new Set(BASE.map(e => e.day))].sort(), n3 = Math.floor(dates.length/3);
const blk = [new Set(dates.slice(0, n3)), new Set(dates.slice(n3, 2*n3)), new Set(dates.slice(2*n3))], half = new Set(dates.slice(0, dates.length >> 1));
const S = (xs, k = 'r15') => { const z = xs.map(e => e[k]).filter(v => v != null), g = z.filter(v => v > 0), l = z.filter(v => v < 0);
  return { n: z.length, hit: z.length ? g.length/z.length : NaN, avg: z.length ? z.reduce((a, b) => a + b, 0)/z.length : NaN, pf: l.length ? g.reduce((a, b) => a + b, 0)/-l.reduce((a, b) => a + b, 0) : NaN }; };
const pc = x => isFinite(x) ? Math.round(x*100) + '%' : '—', sg = x => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '—';
const med = a => { a = a.filter(x => isFinite(x)).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; };
const binTail = (n, k, p) => { let s = 0, lc = 0; for (let i = 0; i <= n; i++){ if (i > 0) lc += Math.log(n - i + 1) - Math.log(i); if (i >= k) s += Math.exp(lc + i*Math.log(p) + (n - i)*Math.log(1 - p)); } return s; };
console.log(`\n=== 9EMA 눌림 지정가 모의 — ${Object.keys(data).length}종목 · ${ONLY || dates[0] + '~' + dates[dates.length-1]} · 종목·일 ${tkDays} · 화면 함수 idMtf() ===`);
let cells = 0, pass = 0;
for (const [mk, fm, nd] of [['미장', e => !e.kr, tkM.us], ['국장', e => e.kr, tkM.kr]]){
  const bs = S(BASE.filter(fm));
  console.log(`\n■ ${mk} — 기준선 +15분 ${pc(bs.hit)} ${sg(bs.avg)}% (n${bs.n})`);
  for (const d of DL) for (let fi = 0; fi < 4; fi++){
    const z = TR.filter(e => fm(e) && e.d === d && e.f[fi]), s5 = S(z, 'r5'), s = S(z), s30 = S(z, 'r30');
    const wf = [[[0], [1]], [[0, 1], [2]]].map(([tr, te]) => { const inB = (e, bs2) => bs2.some(b => blk[b].has(e.day));
      const a = S(z.filter(e => inB(e, tr))), b = S(z.filter(e => inB(e, te))), ba = S(BASE.filter(e => fm(e) && inB(e, tr))), bb = S(BASE.filter(e => fm(e) && inB(e, te)));
      const sel = a.n >= 30 && a.avg - COST > 0 && a.hit >= ba.hit + 0.03; return sel && b.n >= 15 && b.avg - COST > 0 && b.hit >= bb.hit + 0.03 ? '통과' : sel ? '선택→실패' : '미선택'; });
    cells++; if (wf.every(w => w === '통과')) pass++;
    console.log(`  D${String(d).padStart(2)} ${FL[fi].padEnd(14)} n${String(s.n).padStart(5)} (종목·일당 ${(z.length/Math.max(1, nd)).toFixed(2)}) · +5분 ${pc(s5.hit)} ${sg(s5.avg - COST)} · +15분 ${pc(s.hit)} ${sg(s.avg)} 순 ${sg(s.avg - COST)} / 0.10% ${sg(s.avg - 0.10)} · PF ${isFinite(s.pf) ? s.pf.toFixed(2) : '—'} · +30분 ${pc(s30.hit)} 순 ${sg(s30.avg - COST)} · MAE15 중앙 ${sg(med(z.map(e => e.mae)))} · 확실 체결만 +15분 ${pc(S(z.filter(e => e.deep)).hit)} 순 ${sg(S(z.filter(e => e.deep)).avg - COST)} n${S(z.filter(e => e.deep)).n} | 반쪽 ${pc(S(z.filter(e => half.has(e.day))).hit)}/${pc(S(z.filter(e => !half.has(e.day))).hit)} · 블록 ${[0, 1, 2].map(b => pc(S(z.filter(e => blk[b].has(e.day))).hit)).join('/')} | WF ${wf.join(' · ')}`);
  }
}
console.log(`\n요약: ${cells}칸 · 워크포워드 두 번 통과 ${pass}칸`);
