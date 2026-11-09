/**
 * 장중 VWAP 아래 눌림 깊이·반등 연구 — docs/2026-11-09-vwap-dip.md (결과 전 고정).
 * idMtf()·idCandleFeat()는 index.html에서 추출(재구현 금지). 사용: node tools/vwap-dip-lab.js i5.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
vm.createContext(ctx);
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat'].map(H.extractFunction).join('\n') + '\nthis.idMtf = idMtf; this.feat = idCandleFeat;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let CAT = {}; try { JSON.parse(fs.readFileSync('signals.json', 'utf8')).stocks.forEach(s => CAT[s.ticker] = s.category || '기타'); } catch(e){}
const HZ = [5, 15, 30, 60], COST = [0.05, 0.10], STOP = -0.5;
const DEFS = { 'p': [0.1, 0.3, 0.5, 1, 2], 'atr': [0.25, 0.5, 1, 1.5], 'rng': [1, 2, 3] };
const DEFN = { p: '%', atr: 'ATR', rng: '범위' };
const thrPct = (def, val, s) => def === 'p' ? val : def === 'atr' ? (s.atr ? val*s.atr/s.L.c*100 : null) : (s.medR ? val*s.medR/s.L.c*100 : null);
const med = a => { const s = a.filter(x => isFinite(x)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const q = (a, p) => { const s = a.filter(x => isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.min(s.length-1, Math.floor(p*s.length))] : NaN; };
const outcome = (B, k, px) => {
  const r = {}; for (const h of HZ){ const i = k + h/5 - 1; r[h] = i < B.length ? (B[i][4]/px - 1)*100 : null; }
  const w = n => { const z = B.slice(k, k + n); return [(Math.max(...z.map(b => b[2]))/px - 1)*100, (Math.min(...z.map(b => b[3]))/px - 1)*100]; };
  const [mfe15, mae15] = w(3), [mfe60, mae60] = w(12);
  return { r, mfe15, mae15, mfe60, mae60 };
};
const EN = [], EP = [];           // 진입 기록 · 에피소드 기록
for (const [t, D] of Object.entries(data)){
  const kr = /\.(KS|KQ)$/.test(t), cat = CAT[t] || '기타';
  const days = []; let cur = null;
  for (const b of D.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off:b[6], bars:[] }; days.push(cur); } cur.bars.push(b); }
  const dclose = days.map(x => x.bars[x.bars.length-1][4]);
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300, dayLen = end - t0;
    const reg5 = di >= 6 ? (dclose[di-1]/dclose[di-6] - 1 > 0.01 ? '상승장' : dclose[di-1]/dclose[di-6] - 1 < -0.01 ? '하락장' : '횡보장') : null;
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    const snaps = [];
    for (let k = 1; k < B.length; k++){
      const tau = B[k][0];
      const A = ctx.idMtf({ gmtoffset: today.off, reg:{ start:t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k).map(b => b.slice(0, 6))) }, tau);
      if (!A){ snaps.push(null); continue; }
      const D5 = A.tf[5].filter(r => r.done), L = D5[D5.length-1];
      const pr = D5.slice(-21, -1), medR = med(pr.map(r => r.h - r.l));
      const F = ctx.feat(A, L);
      snaps.push({ L, atr: A.P && A.P.atr || null, T: A.T ? A.T.dir : null, tr15: F && F.f.tr15, isE: !!A.E.bars.find(z => z.ts === L.ts), medR,
        single: F ? F.single : null, primary: F ? F.primary : null, vr: F ? F.f.vr : null, firstOfDay: L.ts === t0 });
    }
    const tod = k => (B[k][0] - t0 < 3600 ? '장초반' : end - B[k][0] <= 3600 ? '마감전' : '장중');
    const run = lag => {
      let ep = null, prev = null; const filled = {};
      const push = (method, def, val, thr, k, px, s) => {
        if (k >= B.length) return;
        EN.push({ t, cat, kr, day: today.day, lag, method, def, val, thr, k, px, tod: tod(k), T30: s.T, tr15: s.tr15, reg5, single: s.single, primary: s.primary, vr: s.vr, ...outcome(B, k, px) });
      };
      for (let k = 1 + lag; k < B.length; k++){
        const s = snaps[k - 1 - lag]; if (!s || s.L.vw == null) { prev = s; continue; }
        const L = s.L, below = L.c < L.vw, dep = (L.vw - L.l)/L.vw*100;
        if (k % 3 === 0) push('기준:모든시점', '-', 0, 0, k, B[k][1], s);
        if (s.isE) push('기준:E전체', '-', 0, 0, k, B[k][1], s);
        if (below && (!ep) && (!prev || !(prev.L.c < prev.L.vw) || s.firstOfDay)){
          ep = { startK: k, startTs: L.ts, max: 0, atr: s.atr, medR: s.medR, px: L.c, T: s.T, tod: tod(k), hit: {} };
          push('기준:에피소드시작', '-', 0, 0, k, B[k][1], s);
        }
        if (ep){
          ep.max = Math.max(ep.max, dep);
          for (const def of Object.keys(DEFS)) for (const val of DEFS[def]){
            const thr = thrPct(def, val, s); if (thr == null) continue; const key = def + val;
            if (ep.max >= thr && !ep.hit[key]) ep.hit[key] = k;
            if (ep.hit[key]){
              if (!ep['m2' + key] && L.c > L.o && prev && L.c > prev.L.h){ ep['m2' + key] = 1; push('M2 반등캔들', def, val, thr, k, B[k][1], s); }
              if (!ep['m4' + key] && s.isE){ ep['m4' + key] = 1; push('M4 눌림속E', def, val, thr, k, B[k][1], s); }
            }
          }
        }
        for (const def of Object.keys(DEFS)) for (const val of DEFS[def]){
          const thr = thrPct(def, val, s); if (thr == null) continue; const key = def + val;
          const lvl = L.vw*(1 - thr/100);
          if (!filled[key] && B[k][3] <= lvl){ filled[key] = 1; push('M1 지정가', def, val, thr, k, Math.min(lvl, B[k][1]), s); }
        }
        if (!below){
          for (const key of Object.keys(filled)) delete filled[key];
          if (ep){
            const rec = L.c >= L.vw;
            EP.push({ t, cat, kr, day: today.day, lag, max: ep.max, maxAtr: ep.atr ? ep.max/(ep.atr/ep.px*100) : null, rec, min: (L.ts - ep.startTs)/60, T: ep.T, tod: ep.tod, reg5 });
            for (const def of Object.keys(DEFS)) for (const val of DEFS[def]){ const key = def + val; if (ep.hit[key]) push('M3 VWAP회복', def, val, thrPct(def, val, s), k, B[k][1], s); }
            ep = null;
          }
        }
        prev = s;
      }
      if (ep) EP.push({ t, cat, kr, day: today.day, lag, max: ep.max, maxAtr: ep.atr ? ep.max/(ep.atr/ep.px*100) : null, rec: false, min: null, T: ep.T, tod: ep.tod, reg5 });
    };
    run(0); if (kr) run(4);
  }
}
/* ---------- 통계 도우미 ---------- */
const S = (xs, h = 15) => { const z = xs.map(e => e.r[h]).filter(v => v != null); const g = z.filter(v => v > 0), l = z.filter(v => v < 0);
  return { n: z.length, hit: z.length ? g.length/z.length : NaN, avg: z.length ? z.reduce((a, b) => a + b, 0)/z.length : NaN,
    pf: l.length ? g.reduce((a, b) => a + b, 0)/(-l.reduce((a, b) => a + b, 0)) : (g.length ? Infinity : NaN) }; };
const pct = x => isFinite(x) ? (x*100).toFixed(0) + '%' : '—', sg = (x, d = 3) => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : (x === Infinity ? '∞' : '—');
const grade = n => n >= 50 ? '사용' : n >= 30 ? '방향' : n >= 15 ? '참고' : '불가';
const line = (lab, xs) => { const s5 = S(xs, 5), s15 = S(xs, 15), s30 = S(xs, 30), s60 = S(xs, 60);
  const stop = xs.length ? xs.filter(e => e.mae15 <= STOP).length/xs.length : NaN;
  return `  ${lab.padEnd(22)} n=${String(xs.length).padStart(6)}(${grade(xs.length)}) 5분 ${pct(s5.hit)} ${sg(s5.avg)} · 15분 ${pct(s15.hit)} ${sg(s15.avg)} 순 ${sg(s15.avg - COST[0])}/${sg(s15.avg - COST[1])} PF ${isFinite(s15.pf) ? s15.pf.toFixed(2) : sg(s15.pf)} · 30분 ${pct(s30.hit)} ${sg(s30.avg)} · 60분 ${pct(s60.hit)} ${sg(s60.avg)} · MFE/MAE15 ${sg(med(xs.map(e => e.mfe15)), 2)}/${sg(med(xs.map(e => e.mae15)), 2)} · 손절률 ${pct(stop)}`; };
const L0 = EN.filter(e => e.lag === 0), EP0 = EP.filter(e => e.lag === 0);
const dates = [...new Set(L0.map(e => e.day))].sort(), n3 = Math.floor(dates.length/3);
const blk = [new Set(dates.slice(0, n3)), new Set(dates.slice(n3, 2*n3)), new Set(dates.slice(2*n3))];
const inB = (e, bs) => bs.some(b => blk[b].has(e.day));
const combos = []; for (const m of ['M1 지정가', 'M2 반등캔들', 'M3 VWAP회복', 'M4 눌림속E']) for (const def of Object.keys(DEFS)) for (const val of DEFS[def]) combos.push({ m, def, val, lab: `${m} ${val}${DEFN[def]}` });
const pick = (xs, c) => xs.filter(e => e.method === c.m && e.def === c.def && e.val === c.val);

console.log(`\n=== VWAP 눌림 깊이·반등 연구 — ${Object.keys(data).length}종목 · ${dates[0]}~${dates[dates.length-1]} (${dates.length}일) · 에피소드 ${EP0.length} · 진입=확인 봉 다음 5분봉 시가(M1은 지정가) · 수익률 % · 순 = 비용 0.05/0.10% 차감 ===`);
console.log('\n[1] 눌림 에피소드 — 깊이 분포와 회복');
console.log(`  최대 깊이(%) p50 ${q(EP0.map(e => e.max), .5).toFixed(2)} · p75 ${q(EP0.map(e => e.max), .75).toFixed(2)} · p90 ${q(EP0.map(e => e.max), .9).toFixed(2)} · ATR배 p50 ${q(EP0.map(e => e.maxAtr), .5).toFixed(2)} · 전체 회복률 ${pct(EP0.filter(e => e.rec).length/EP0.length)} · 회복 시간 중앙 ${med(EP0.filter(e => e.rec).map(e => e.min)).toFixed(0)}분`);
const buck = (v, cuts, labs) => labs[Math.max(0, cuts.findIndex(c => v < c) < 0 ? labs.length-1 : cuts.findIndex(c => v < c))];
for (const [lab, get, cuts, labs] of [['고정 % 구간', e => e.max, [0.1, 0.3, 0.5, 1, 2], ['<0.1','0.1~0.3','0.3~0.5','0.5~1','1~2','≥2']], ['ATR배 구간', e => e.maxAtr, [0.25, 0.5, 1, 1.5], ['<0.25','0.25~0.5','0.5~1','1~1.5','≥1.5']]]){
  console.log(`  ${lab}:`); const g = {}; EP0.forEach(e => { const v = get(e); if (v != null && isFinite(v)) (g[buck(v, cuts, labs)] = g[buck(v, cuts, labs)] || []).push(e); });
  for (const b of labs){ const xs = g[b] || []; if (!xs.length) continue; const rec = xs.filter(e => e.rec);
    console.log(`    ${b.padEnd(9)} n=${String(xs.length).padStart(5)} 회복 ${pct(rec.length/xs.length)} · 실패(당일 미회복) ${pct(1 - rec.length/xs.length)} · 회복 시간 중앙 ${med(rec.map(e => e.min)).toFixed(0)}분 · p75 ${q(rec.map(e => e.min), .75).toFixed(0)}분`); }
}
console.log('\n[2] 진입 방식 비교 (전체 · 봉 시각 기준)');
for (const b of ['기준:모든시점', '기준:에피소드시작', '기준:E전체']) console.log(line(b, L0.filter(e => e.method === b)));
for (const c of combos) console.log(line(c.lab, pick(L0, c)));
console.log('\n[3] 시간대 · 국면 (15분 적중 / 평균 / n) — E 전체와 고정 0.5% 방식');
const sub = (lab, xs, key, vals) => console.log(`  ${lab.padEnd(18)} ` + vals.map(v => { const z = xs.filter(e => e[key] === v), s = S(z); return `${v} ${pct(s.hit)} ${sg(s.avg)} n${s.n}`; }).join(' · '));
for (const [lab, xs] of [['E 전체', L0.filter(e => e.method === '기준:E전체')], ...['M1 지정가', 'M2 반등캔들', 'M3 VWAP회복', 'M4 눌림속E'].map(m => [m + ' 0.5%', pick(L0, { m, def: 'p', val: 0.5 })])]){
  sub(lab + ' 시간대', xs, 'tod', ['장초반', '장중', '마감전']); sub(lab + ' 30분추세', xs, 'T30', ['up', 'flat', 'down']); sub(lab + ' 5일국면', xs, 'reg5', ['상승장', '횡보장', '하락장']); }
console.log('\n[4] 조합 — 캔들 1봉 형태 · 거래량 · 15분/30분 추세 (15분 적중(평균) n · n<30 미검증)');
for (const [lab, xs] of [['E 전체', L0.filter(e => e.method === '기준:E전체')], ['M2 반등캔들 0.5%', pick(L0, { m: 'M2 반등캔들', def: 'p', val: 0.5 })], ['M3 VWAP회복 0.5%', pick(L0, { m: 'M3 VWAP회복', def: 'p', val: 0.5 })]]){
  const base = S(xs); console.log(`  ■ ${lab} 기준 15분 ${pct(base.hit)} ${sg(base.avg)} n${base.n}`);
  const g = {}; xs.forEach(e => (g[e.single] = g[e.single] || []).push(e));
  console.log('    1봉 형태: ' + Object.entries(g).sort((a, b) => b[1].length - a[1].length).slice(0, 7).map(([k, z]) => { const s = S(z); return `${k} ${pct(s.hit)}(${sg(s.avg)}) n${s.n}${s.n < 30 ? '※' : ''}`; }).join(' · '));
  const vb = e => e.vr == null ? '—' : e.vr < 1 ? '<1배' : e.vr < 2 ? '1~2배' : '≥2배';
  console.log('    거래량: ' + ['<1배', '1~2배', '≥2배'].map(v => { const s = S(xs.filter(e => vb(e) === v)); return `${v} ${pct(s.hit)}(${sg(s.avg)}) n${s.n}`; }).join(' · '));
  console.log('    15분 추세: ' + ['up', 'down'].map(v => { const s = S(xs.filter(e => e.tr15 === v)); return `${v} ${pct(s.hit)}(${sg(s.avg)}) n${s.n}`; }).join(' · ') + ' · 30분 추세: ' + ['up', 'flat', 'down'].map(v => { const s = S(xs.filter(e => e.T30 === v)); return `${v} ${pct(s.hit)}(${sg(s.avg)}) n${s.n}`; }).join(' · '));
}
console.log('\n[5] 워크포워드 — 기준 = 같은 기간 E 전체');
const res = {}; let tested = 0;
for (const [fi, tr, te] of [[1, [0], [1]], [2, [0, 1], [2]]]){
  const TR = L0.filter(e => inB(e, tr)), TE = L0.filter(e => inB(e, te));
  const eT = S(TR.filter(e => e.method === '기준:E전체')), eV = S(TE.filter(e => e.method === '기준:E전체'));
  for (const c of combos){
    if (fi === 1) tested++;
    const a = S(pick(TR, c)), b = S(pick(TE, c));
    const sel = a.n >= 30 && a.hit >= eT.hit + 0.03 && a.avg - COST[0] > eT.avg - COST[0] && a.pf >= 1.2;
    const ok = sel && b.n >= 20 && b.hit >= eV.hit + 0.02 && b.avg - COST[0] > eV.avg - COST[0];
    (res[c.lab] = res[c.lab] || []).push({ fi, sel, ok, a, b, eT, eV });
  }
}
const sel1 = Object.values(res).filter(a => a[0].sel).length, both = Object.entries(res).filter(([, a]) => a[0].sel && a[1].sel), pass = both.filter(([, a]) => a[0].ok && a[1].ok);
console.log(`  후보 ${tested}개 · 1차 학습 선택 ${sel1}개 · 두 번 모두 선택 ${both.length}개 · 두 검증 모두 통과 ${pass.length}개`);
for (const [k, a] of both) console.log(`   ${a.every(x => x.ok) ? '✅' : '❌'} ${k.padEnd(20)} ` + a.map(x => `${x.fi}차 학습 n${x.a.n} ${pct(x.a.hit)}(E ${pct(x.eT.hit)}) 순${sg(x.a.avg - COST[0])} PF${x.a.pf.toFixed(2)} → 검증 n${x.b.n} ${pct(x.b.hit)}(E ${pct(x.eV.hit)}) 순${sg(x.b.avg - COST[0])}(E ${sg(x.eV.avg - COST[0])})`).join(' | '));
console.log('\n[6] 종목별 — 에피소드 n · 깊이 p50/p90(%) · ATR배 p50 · 회복률(전체 / ≥0.5%) · 회복 중앙(분) · M2 0.5%: n 15분적중 순수익 · 최적 고정깊이(블록1+2 → 블록3)');
const best = (xs, c) => { let b = null; for (const val of DEFS.p){ const z = pick(xs, { m: 'M2 반등캔들', def: 'p', val }); const s = S(z); if (s.n >= 15 && (b === null || s.avg > b.avg)) b = { val, avg: s.avg, n: s.n }; } return b; };
const agree = { 일치: 0, 불일치: 0, '표본 부족': 0 }, byCat = {};
for (const t of Object.keys(data).sort((a, b) => (CAT[a] || '').localeCompare(CAT[b] || '') || a.localeCompare(b))){
  const E = EP0.filter(e => e.t === t), X = L0.filter(e => e.t === t);
  if (!E.length) continue;
  const deep = E.filter(e => e.max >= 0.5), m2 = pick(X, { m: 'M2 반등캔들', def: 'p', val: 0.5 }), s2 = S(m2);
  const b12 = best(X.filter(e => inB(e, [0, 1]))), b3 = best(X.filter(e => inB(e, [2])));
  const st = b12 && b3 ? (b12.val === b3.val ? '일치' : '불일치') : '표본 부족'; agree[st]++;
  (byCat[CAT[t] || '기타'] = byCat[CAT[t] || '기타'] || []).push(...E);
  console.log(`  ${(CAT[t] || '기타').padEnd(10)} ${t.padEnd(10)} n${String(E.length).padStart(4)} 깊이 ${q(E.map(e => e.max), .5).toFixed(2)}/${q(E.map(e => e.max), .9).toFixed(2)} ATR ${q(E.map(e => e.maxAtr), .5).toFixed(2)} 회복 ${pct(E.filter(e => e.rec).length/E.length)}/${deep.length ? pct(deep.filter(e => e.rec).length/deep.length) : '—'} ${med(E.filter(e => e.rec).map(e => e.min)).toFixed(0)}분 · M2 n${s2.n} ${pct(s2.hit)} ${sg(s2.avg - COST[0])} · 최적 ${b12 ? b12.val + '%' : '—'}→${b3 ? b3.val + '%' : '—'} ${st}`);
}
console.log(`  종목별 최적 깊이 재현: 일치 ${agree.일치} · 불일치 ${agree.불일치} · 표본 부족 ${agree['표본 부족']}`);
console.log('  분류별: ' + Object.entries(byCat).sort((a, b) => b[1].length - a[1].length).map(([c, E]) => `${c} n${E.length} 깊이p50 ${q(E.map(e => e.max), .5).toFixed(2)}% 회복 ${pct(E.filter(e => e.rec).length/E.length)}`).join(' · '));
console.log('\n[7] 국장 — ① 봉 시각 vs ② 20분 늦게 확인 (국장 종목만)');
for (const [lab, f] of [['E 전체', e => e.method === '기준:E전체'], ...['M1 지정가', 'M2 반등캔들', 'M3 VWAP회복'].flatMap(m => [0.5, 1].map(v => [`${m} ${v}%`, e => e.method === m && e.def === 'p' && e.val === v]))]){
  for (const lag of [0, 4]) console.log(line(`${lab} ${lag ? '②+20분' : '①'}`, EN.filter(e => e.kr && e.lag === lag && f(e))));
}
