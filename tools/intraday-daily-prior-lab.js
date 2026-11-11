/**
 * 장중 신호 × 일봉 등급 보정 (2026-11-11 사용자 지시 "일봉 종가 기준 마지막 신호를 보정값으로 — 강한매수면 장중 신호에 가산점").
 * 장중 사건(▲·🟢·무작위)을 '전날 일봉 종가 등급'(장 시작 전에 이미 아는 값 — 미래 참조 없음)으로 나눠 성적 비교.
 * 종가 매수 → 다음 날 시가는 '그날 일봉 등급'(종가에 사는 시점에 아는 값)으로 나눈다.
 * 재생·비용은 tools/intraday-signal-nextopen-lab.js와 같다(idMtf 문자열 추출). 적중 = 보합 제외 상승 비율(사용자 기준 2026-11-11), 보합 비율은 따로.
 * 사용: node tools/intraday-daily-prior-lab.js /tmp/i5.json backtest/daily-grades.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal', 'idEma', 'idAgg', 'idMtf', 'idLastSignalOn'].map(H.extractFunction).join('\n') + '\nthis.mtf = idMtf; this.last = idLastSignalOn;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const DG = JSON.parse(fs.readFileSync(process.argv[3] || 'backtest/daily-grades.json', 'utf8'));
const SIG = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const HF = SIG.hist_fields, iD = HF.indexOf('date'), iP = HF.indexOf('price');
const CLOSE = {}; for (const s of SIG.stocks) for (const h of (s.hist || [])) CLOSE[s.ticker.toUpperCase() + '|' + h[iD]] = h[iP];

/* 비용 — tools/intraday-horizon-lev-lab.js와 같은 모델 */
const PRODS = new Set(['QQQ','QLD','TQQQ','SQQQ','SPY','SSO','SPXL','SPXS','SOXX','SOXL','SOXS','069500.KS','122630.KS','114800.KS','252670.KS','229200.KS','233740.KQ','233740.KS','251340.KQ','251340.KS','UYG','DUSL','NAIL','GDXU',
  '0173Y0.KS','0123G0.KS','0183J0.KS','453650.KS','GLD','SLV','USO','XLE','XLU','IBIT','ETHA','URA','XBI','ITA','IYR','DBA','REMX','UFO','QTUM']);
const isKR = t => /\.(KS|KQ)$/.test(t), isETF = t => PRODS.has(t);
const tickKR = (t, p) => isETF(t) ? (p < 2000 ? 1 : 5) : p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
const slip = (t, p) => isKR(t) ? tickKR(t, p) : p * (isETF(t) ? 0.0002 : 0.0003);
const cost = t => isKR(t) ? (isETF(t) ? 0.03 : 0.21) : 0;
const netOf = (t, p0, pe) => { const s = slip(t, p0); return ((pe - s)/(p0 + s) - 1)*100 - cost(t); };

/* ── 재생: 종목·날짜·5분봉 끝마다 idMtf() ── */
const DAYS = {};
for (const t of Object.keys(data)){
  const kr = isKR(t), tz = kr ? 'Asia/Seoul' : 'America/New_York', days = []; let cur = null;
  for (const b of data[t].bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); } cur.bars.push(b); }
  for (const x of days) x.bars = x.bars.filter(b => { const q = new Date((b[0] + x.off)*1000), m = q.getUTCHours()*60 + q.getUTCMinutes(); return kr ? m < 900 : m < 960; });
  const out = [];
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars; if (B.length < 24) continue;
    const t0 = B[0][0], hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    const ev = [];
    for (let k = 0; k < B.length; k++){
      const tau = B[k][0] + 300;
      const A = ctx.mtf({ tz, gmtoffset: today.off, reg: { start: t0, end: t0 + 23400 }, lastTrade: tau, bars: hist.concat(B.slice(0, k + 1).map(b => b.slice(0, 6))) }, tau);
      const D5 = A ? A.tf[5].filter(r => r.done) : [], L = D5[D5.length-1];
      if (!L || L.ts !== B[k][0]) { ev.push(null); continue; }
      ev.push({ k, tau, st: A.state, rb: A.E.bars.some(z => z.ts === L.ts), late: B[k][0] >= t0 + 1800 });
    }
    const nx = days[di+1] && days[di+1].bars.length ? days[di+1].bars[0][1] : null;
    out.push({ day: today.day, B, ev, nextOpen: nx, close: CLOSE[t.toUpperCase() + '|' + today.day] ?? null });
  }
  DAYS[t] = out;
}


const mean = a => a.length ? a.reduce((x, y) => x + y, 0)/a.length : null;
const sg = (v, d = 3) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d);
const allDays = [...new Set(Object.values(DAYS).flat().map(x => x.day))].sort(), MID = allDays[Math.floor(allDays.length/2)];
function summ(rows){ const n = rows.length; if (!n) return 'n    0';
  const up = rows.filter(r => r.raw > 0).length, dn = rows.filter(r => r.raw < 0).length, tie = n - up - dn;
  const half = w => { const z = rows.filter(r => (r.day < MID) === (w === 0)); const u = z.filter(r => r.raw > 0).length, d = z.filter(r => r.raw < 0).length; return u + d ? `${Math.round(u/(u+d)*100)}%(${z.length})` : '—'; };
  return `n ${String(n).padStart(5)} · 상승 ${up + dn ? Math.round(up/(up+dn)*100) : '—'}% (보합 ${Math.round(tie/n*100)}%) · 평균 ${sg(mean(rows.map(r => r.raw)))}% · 비용 뒤 ${sg(mean(rows.map(r => r.net)))}% · 반쪽 ${half(0)}/${half(1)}`; }
/* 등급 조회: 전날(그 종목의 직전 원장 날짜) / 그날 */
const GD = {}; for (const [t, m] of Object.entries(DG)) GD[t.toUpperCase()] = Object.keys(m).sort();
const gradeOn = (t, day) => { const m = DG[t] || DG[t.toUpperCase()]; return m && m[day] ? m[day] : null; };
const gradePrev = (t, day) => { const ds = GD[t.toUpperCase()]; if (!ds) return null; let p = null; for (const d of ds){ if (d < day) p = d; else break; } return p ? gradeOn(t, p) : null; };
const BK = [['💡 강한다중', g => g && g[0] === 5 && g[1] === 1], ['다중(💡 제외)', g => g && g[0] === 5 && g[1] === 2], ['강한매수 전체', g => g && g[0] === 5],
  ['매수관심', g => g && g[0] === 4], ['중립 이하', g => g && g[0] != null && g[0] <= 3]];
const KINDS = [['무작위', z => z.late], ['▲ 전부', z => z.late && z.rb], ['🟢 셋 다', z => z.late && z.rb && z.st === 'go']];
console.log(`=== 장중 신호 × 전날 일봉 등급 — ${Object.keys(DAYS).length}종목 · ${allDays[0]}~${allDays[allDays.length-1]} · 반쪽 ${MID} ===`);
console.log('상승 = 보합 제외 비율 · 등급은 전날 원장 종가 기준(장 시작 전에 아는 값)');
for (const [mn, mf, D] of [['미장 D0', t => !isKR(t), 0], ['국장 D20', isKR, 20]]){
  const T = Object.keys(DAYS).filter(mf);
  console.log(`\n■ ${mn}`);
  for (const h of [5, 15, 30]){
    console.log(`  +${h}분`);
    for (const [kn, kf] of KINDS) for (const [bn, bf] of [['(등급 무관)', () => true], ...BK]){
      const rows = [];
      for (const t of T) for (const X of DAYS[t]){ const g = gradePrev(t, X.day); if (bn !== '(등급 무관)' && !bf(g)) continue; if (bn === '(등급 무관)' && !g) continue;
        for (const z of X.ev){ if (!z || !kf(z)) continue;
          const k0 = X.B.findIndex(b => b[0] >= z.tau + D*60); if (k0 < 0) continue; const ke = k0 + h/5 - 1; if (ke >= X.B.length) continue;
          const p0 = X.B[k0][1], pe = X.B[ke][4]; rows.push({ raw: (pe/p0 - 1)*100, net: netOf(t, p0, pe), day: X.day }); } }
      if (bn === '(등급 무관)' || rows.length) console.log(`    ${kn.padEnd(7)} ${bn.padEnd(12)} ${summ(rows)}`);
    }
  }
  console.log('  그날 마지막 신호 → 다음 거래일 시가 (장중 매수: 전날 등급 / 종가 매수: 그날 등급)');
  for (const [kn, kf] of KINDS) for (const [bn, bf] of [['(등급 무관)', g => !!g], ...BK]){
    const intra = [], close = [];
    for (const t of T) for (const X of DAYS[t]){ if (X.nextOpen == null) continue; const zs = X.ev.filter(z => z && kf(z)); if (!zs.length) continue;
      const z = kn === '무작위' ? zs[Math.floor(zs.length/2)] : zs[zs.length-1];
      if (bf(gradePrev(t, X.day))){ const k0 = X.B.findIndex(b => b[0] >= z.tau + D*60); if (k0 >= 0){ const p0 = X.B[k0][1]; intra.push({ raw: (X.nextOpen/p0 - 1)*100, net: netOf(t, p0, X.nextOpen), day: X.day }); } }
      if (bf(gradeOn(t, X.day)) && X.close != null) close.push({ raw: (X.nextOpen/X.close - 1)*100, net: netOf(t, X.close, X.nextOpen), day: X.day }); }
    if (bn === '(등급 무관)' || intra.length || close.length){ console.log(`    ${kn.padEnd(7)} ${bn.padEnd(12)} 장중 매수 ${summ(intra)}`); console.log(`    ${''.padEnd(20)} 종가 매수 ${summ(close)}`); }
  }
}
