/**
 * 장중 신호 적중률(+5·+15·+30분) · 마지막 신호 → 다음 날 시가(장중 매수/종가 매수) · 최근 20거래일 황금신호 장중 확인.
 * 정의: docs/2026-11-11-intraday-signal-nextopen.md (결과 전 고정). 연구 전용.
 * 판정은 index.html idMtf()·idLastSignalOn()을 문자열로 꺼내 쓴다(재구현 없음).
 * 사용: node tools/intraday-signal-nextopen-lab.js /tmp/i5.json [backtest/gold-cands.json]
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal', 'idEma', 'idAgg', 'idMtf', 'idLastSignalOn'].map(H.extractFunction).join('\n') + '\nthis.mtf = idMtf; this.last = idLastSignalOn;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const GC = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
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
const allDays = [...new Set(Object.values(DAYS).flat().map(x => x.day))].sort(), MID = allDays[Math.floor(allDays.length/2)];

/* ── 집계 ── */
const pct = (a, b) => b ? Math.round(a/b*100) : null;
const mean = a => a.length ? a.reduce((x, y) => x + y, 0)/a.length : null;
const sg = (v, d = 3) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d);
function summ(rows){   // rows: {raw, net, day}
  const n = rows.length; if (!n) return { n: 0 };
  const up = rows.filter(r => r.raw > 0).length, tie = rows.filter(r => r.raw === 0).length;
  const u1 = rows.filter(r => r.raw > 1).length, d1 = rows.filter(r => r.raw < -1).length;
  const half = w => { const z = rows.filter(r => (r.day < MID) === (w === 0)); return z.length ? `${pct(z.filter(r => r.raw > 0).length, z.length)}%(${z.length})` : '—'; };
  return { n, hit: pct(up, n), tie: pct(tie, n), m: mean(rows.map(r => r.raw)), net: mean(rows.map(r => r.net)), dir1: u1 + d1 ? pct(u1, u1 + d1) : null, h1: half(0), h2: half(1) };
}
const fmt = (s, dir) => !s.n ? 'n 0' : `n ${String(s.n).padStart(5)} · 상승 ${s.hit}% (보합 ${s.tie}%) · 평균 ${sg(s.m)}% · 비용 뒤 ${sg(s.net)}% · 반쪽 ${s.h1}/${s.h2}${dir ? ` · ±1% 방향 ${s.dir1 ?? '—'}%` : ''}`;

const MK = [['미장', t => !isKR(t), 0], ['국장 D20', isKR, 20], ['국장 D0(참고)', isKR, 0]];
const KINDS = [['기준선(무작위)', z => z.late], ['▲ 5분 재돌파 전부', z => z.late && z.rb], ['🟢 ▲ + 5·15·30 세 조건', z => z.late && z.rb && z.st === 'go']];
console.log(`=== 장중 신호 적중률 · 다음 날 시가 — ${Object.keys(DAYS).length}종목 · ${allDays[0]}~${allDays[allDays.length-1]} (${allDays.length}거래일) · 반쪽 경계 ${MID} ===`);
console.log('판정: 상승 = 수익 > 0 · 보합(정확히 0)은 실패 · ±1% 밴드 없음(장중). 다음 날 시가는 ±1% 방향 비율도 참고로.');
for (const [mn, mf, D] of MK){
  const T = Object.keys(DAYS).filter(mf);
  console.log(`\n■ ${mn} (${T.length}종목${D ? ` · 신호 뒤 ${D}분 지연 진입` : ''})`);
  console.log('  [1] 장중: 진입 = 신호 봉 끝+지연 뒤 첫 5분봉 시가');
  for (const [kn, kf] of KINDS){
    for (const h of [5, 15, 30]){
      const rows = [];
      for (const t of T) for (const X of DAYS[t]) for (const z of X.ev){ if (!z || !kf(z)) continue;
        const k0 = X.B.findIndex(b => b[0] >= z.tau + D*60); if (k0 < 0) continue; const ke = k0 + h/5 - 1; if (ke >= X.B.length) continue;
        const p0 = X.B[k0][1], pe = X.B[ke][4]; rows.push({ raw: (pe/p0 - 1)*100, net: netOf(t, p0, pe), day: X.day }); }
      console.log(`    ${kn.padEnd(18)} +${String(h).padStart(2)}분 ${fmt(summ(rows))}`);
    }
  }
  console.log('  [2] 그날 마지막 신호 → 다음 거래일 시가 (데이마켓 아님 — 야후에 없음 · 정규장 첫 5분봉 시가)');
  for (const [kn, kf] of KINDS){
    const intra = [], close = []; let noClose = 0;
    for (const t of T) for (const X of DAYS[t]){ if (X.nextOpen == null) continue;
      const zs = X.ev.filter(z => z && kf(z)); if (!zs.length) continue;
      const pickZ = kn.startsWith('기준선') ? zs[Math.floor(zs.length/2)] : zs[zs.length-1];   // 기준선은 그날 한가운데 시점 하나
      const k0 = X.B.findIndex(b => b[0] >= pickZ.tau + D*60);
      if (k0 >= 0){ const p0 = X.B[k0][1]; intra.push({ raw: (X.nextOpen/p0 - 1)*100, net: netOf(t, p0, X.nextOpen), day: X.day }); }
      if (X.close != null) close.push({ raw: (X.nextOpen/X.close - 1)*100, net: netOf(t, X.close, X.nextOpen), day: X.day }); else noClose++;
    }
    console.log(`    ${kn.padEnd(18)} 장중 매수 → 다음 날 시가  ${fmt(summ(intra), true)}`);
    if (D === 20 || mn === '미장') console.log(`    ${''.padEnd(18)} 종가 매수 → 다음 날 시가  ${fmt(summ(close), true)}${noClose ? ` · 원장 종가 없음 ${noClose}건 제외` : ''}`);
  }
}
/* 기준선 2: 모든 종목·날짜 종가 → 다음 날 시가 (신호 무관) */
for (const [mn, mf] of [['미장', t => !isKR(t)], ['국장', isKR]]){
  const rows = []; for (const t of Object.keys(DAYS).filter(mf)) for (const X of DAYS[t]) if (X.nextOpen != null && X.close != null) rows.push({ raw: (X.nextOpen/X.close - 1)*100, net: netOf(t, X.close, X.nextOpen), day: X.day });
  console.log(`\n기준선 ${mn} 모든 종목·날짜 종가 → 다음 날 시가: ${fmt(summ(rows), true)}`);
}

/* ── 최근 20거래일 황금신호: 일봉 후보(gold-cands.json) × 그날 장중 마지막 ▲(idLastSignalOn) ── */
if (GC){
  console.log(`\n■ 최근 20거래일 황금신호 — 일봉 후보 ${GC.cands.length}건(${GC.dates.us[0]}~ 미장 · ${GC.dates.kr[0]}~ 국장) × 그날 장중 마지막 ▲`);
  const g = []; let par = 0, parN = 0;
  for (const c of GC.cands){
    const t = c.ticker.toUpperCase(), src = data[t] || data[c.ticker];
    if (!src){ console.log(`  ${c.date} ${c.ticker} · 5분봉 없음`); continue; }
    const day = c.date, bars = src.bars.filter(b => new Date((b[0] + b[6])*1000).toISOString().slice(0, 10) <= day);
    const dayBars = bars.filter(b => new Date((b[0] + b[6])*1000).toISOString().slice(0, 10) === day);
    if (!dayBars.length){ console.log(`  ${day} ${c.ticker} · 그날 5분봉 없음`); continue; }
    const off = dayBars[0][6], kr = isKR(t);
    const d = { tz: kr ? 'Asia/Seoul' : 'America/New_York', gmtoffset: off, reg: {}, bars: bars.slice(-78*6).map(b => b.slice(0, 6)) };
    const r = ctx.last(d, day);
    const X = (DAYS[t] || DAYS[c.ticker] || []).find(x => x.day === day);
    const hm = m => String(Math.floor((m + 5)/60)).padStart(2, '0') + ':' + String((m + 5)%60).padStart(2, '0');
    const ok = v => v ? '✓' : '✗';
    const line = r.kind === 'rb' ? `마지막 ▲ ${hm(r.m)} · 30분 ${ok(r.t30 === 'up')} 15분 ${ok(r.held15 && !r.broken15)} 5분 ${ok(r.e5)} → ${r.ok ? '🏆 세 조건 충족' : '일부만'}` : r.kind === 'none' ? '그날 ▲ 없음' : '그날 자료 없음';
    let perf = '';
    if (X && X.nextOpen != null){ const cl = X.close; perf = cl != null ? ` · 종가→다음 날 시가 ${sg((X.nextOpen/cl - 1)*100, 2)}%` : ''; }
    if (r.ok) g.push(c);
    if (X && r.kind === 'rb'){ const zr = X.ev.filter(z => z && z.rb && z.late).pop(); parN++; if (zr && zr.st === r.state) par++; }   // 화면 함수 ↔ 하루 재생 교차 확인
    console.log(`  ${r.ok ? '🏆' : '  '} ${day} ${c.ticker.padEnd(9)} 일봉 ${c.tier} · 🕯 ${c.pats.slice(0, 2).join(', ')}${c.red ? ' · 🔴 위험 패턴도' : ''} | ${line}${perf}`);
  }
  console.log(`  교차 확인: idLastSignalOn() 판정 = 하루 재생의 마지막 ▲ 판정 ${par}/${parN}`);
  console.log(`  → 황금신호(셋 다) ${g.length}건: ${g.map(c => c.date + ' ' + c.ticker).join(' · ') || '없음'}`);
}
