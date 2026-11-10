/**
 * 국장 시장 국면 × 장중 진입 · 20분 지연 실전성 — docs/2026-11-10-kr-intraday-regime.md (결과 전 고정).
 * idMtf()·idUpEvidence()·idCandleFeat()는 index.html에서 추출(재구현 금지). 국면은 tools/kr-regime-lab.py --dump 결과(d−1 종가 기준만 붙인다).
 * 사용: node tools/kr-intraday-regime-lab.js regime.json i5-site.json [i5-krbig.json ...]
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat','idUpEvidence'].map(H.extractFunction).join('\n') + '\nthis.mtf = idMtf; this.UE = idUpEvidence;', ctx);
const REG = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const data = {}; for (const f of process.argv.slice(3)) Object.assign(data, JSON.parse(fs.readFileSync(f, 'utf8')));
const THEME = new Set(['0173Y0.KS', '0123G0.KS', '453650.KS', '0183J0.KS']), ETF = new Set(['069500.KS', '229200.KS']);
const idxOf = t => (t === '229200.KS' || /\.KQ$/.test(t)) ? '코스닥' : '코스피';
const tick = (t, p) => ETF.has(t) ? (p < 2000 ? 1 : 5) : p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
const cost = t => ETF.has(t) ? 0.03 : 0.21;      // 왕복 수수료(+주식 매도세) %
const REGS = { G0: () => true, G1: r => r.dn3, G2: r => r.volHi, G3: r => r.crashCool, G4: r => r.bottom, G5: r => r.vxnTurn, G6: r => r.crashCool || r.bottom };
const RNAME = { G0: '전체', G1: '3일 연속 하락 직후', G2: '변동성 높음', G3: '급락 뒤 공포 꺾임', G4: '바닥권', G5: '미국 VXN 전일 하락 전환', G6: 'G3∪G4' };
const SIG = ['E1 EMA9 첫 눌림', 'E2 VWAP 회복', 'E3 스토캐스틱 GC', 'E4 캔들 반등', 'E5 피보 지지', '▲ 기존 재돌파', '무작위'];
const HM = [5, 15, 30, 60], HD = [1, 3, 5];
const T = []; const dayRegCount = {}; let tkN = 0, tkDays = 0;
const prevReg = (ix, day) => { const m = REG[ix] || {}; let best = null; for (const d of Object.keys(m)) if (d < day && (!best || d > best)) best = d; return best ? m[best] : null; };
for (const D of [20, 0]) for (const [t, Dt] of Object.entries(data)){
  if (!/\.(KS|KQ)$/.test(t) || THEME.has(t)) continue;
  if (D === 20) tkN++;
  const days = []; let cur = null;
  for (const b of Dt.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); } cur.bars.push(b); }
  const closeOf = days.map(x => x.bars[x.bars.length-1][4]);
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300, ix = idxOf(t);
    const rg = prevReg(ix, today.day); if (!rg) continue;
    if (D === 20){ tkDays++; for (const g of Object.keys(REGS)) if (REGS[g](rg)) { dayRegCount[ix + g] = dayRegCount[ix + g] || new Set(); dayRegCount[ix + g].add(today.day); } }
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    const info = [];
    for (let k = 0; k < B.length; k++){
      const tau = B[k][0] + 300;
      const A = ctx.mtf({ tz: 'Asia/Seoul', gmtoffset: today.off, reg: { start: t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k + 1).map(b => b.slice(0, 6))) }, tau);
      const L = A && A.tf[5].filter(r => r.done).pop();
      if (!L || L.ts !== B[k][0]){ info.push(null); continue; }
      let ev = []; try { ev = ctx.UE(A).map(e => e.k); } catch(e){}
      info.push({ end: tau, c: L.c, e9: L.e9, rb: A.E.bars.some(z => z.ts === L.ts), ev });
    }
    /* 2026-11-10 기준 정정: 방향 적중은 원가(r_* 키 · 슬리피지 없음), 순수익은 기존 키(호가·비용 차감) */
    const outc = (k0, p0) => { const tk = tick(t, p0), r = {}, pr = Math.abs(p0 - (B[k0][1] + tick(t, B[k0][1]))) < 1e-9 ? B[k0][1] : p0;
      for (const h of HM){ const i = k0 + h/5 - 1; r['m' + h] = i < B.length ? ((B[i][4] - tk)/p0 - 1)*100 : null; r['r_m' + h] = i < B.length ? (B[i][4]/pr - 1)*100 : null; }
      for (const h of HD){ const j = di + h; r['d' + h] = j < days.length ? ((closeOf[j] - tick(t, closeOf[j]))/p0 - 1)*100 : null; r['r_d' + h] = j < days.length ? (closeOf[j]/pr - 1)*100 : null; }
      return r; };
    const push = (sig, k0, p0, extra) => { if (k0 < 0 || k0 >= B.length || B[k0][0] < t0 + 1800) return; T.push({ t, ix, day: today.day, D, sig, rg, c: cost(t), ...outc(k0, p0), ...(extra || {}) }); };
    const firstAt = ts => B.findIndex(b => b[0] >= ts);
    /* 이벤트 신호: 봉 끝 + D 뒤 첫 봉 시가 + 1호가 */
    for (let j = 0; j < B.length; j++){ const I = info[j]; if (!I) continue;
      const k0 = firstAt(I.end + D*60); if (k0 < 0) continue; const p0 = B[k0][1] + tick(t, B[k0][1]);
      if (I.ev.includes('V2')) push(1, k0, p0);
      if (I.ev.includes('S1')) push(2, k0, p0);
      if (I.ev.some(k => ['C1', 'C2', 'C3', 'C4'].includes(k))) push(3, k0, p0);
      if (I.ev.some(k => ['F38', 'F50', 'F62'].includes(k))) push(4, k0, p0);
      if (I.rb) push(5, k0, p0); }
    /* 무작위: 15분 간격 봉 시가 + 1호가 */
    for (let k = 6; k < B.length; k += 3) push(6, k, B[k][1] + tick(t, B[k][1]));
    /* E1 EMA9 첫 눌림 지정가: 호가 내림 · 저가가 1호가 이상 아래여야 체결 · 그날 첫 체결만 */
    let tried = 0;
    for (let k = 1; k < B.length; k++){
      if (B[k][0] < t0 + 1800) continue;
      let j = -1; for (let q = k - 1; q >= 0; q--) if (info[q] && info[q].end <= B[k][0] - D*60){ j = q; break; }
      if (j < 0 || !(info[j].c > info[j].e9)) continue;
      const tk = tick(t, info[j].e9), lim = Math.floor(info[j].e9/tk)*tk; tried++;
      if (B[k][3] <= lim - tk){ push(0, k, Math.min(B[k][1], lim)); break; }
    }
    if (tried) T.push({ t, ix, day: today.day, D, sig: -1, rg, tried: 1, filled: T.some(x => x.t === t && x.day === today.day && x.D === D && x.sig === 0) });
  }
}
const dates = [...new Set(T.map(e => e.day))].sort(), n3 = Math.floor(dates.length/3), blk = [new Set(dates.slice(0, n3)), new Set(dates.slice(n3, 2*n3)), new Set(dates.slice(2*n3))];
const S = (xs, k) => { const z = xs.map(e => e[k] == null ? null : e[k] - (k[0] === 'm' || k[0] === 'd' ? e.c : 0)).filter(v => v != null), g = xs.map(e => e['r_' + k]).filter(v => v != null);
  return { n: z.length, hit: g.length ? g.filter(v => v > 0).length/g.length : NaN, net: z.length ? z.reduce((a, b) => a + b, 0)/z.length : NaN, days: new Set(xs.filter(e => e[k] != null).map(e => e.day)).size, tks: new Set(xs.filter(e => e[k] != null).map(e => e.t)).size }; };
const pc = x => isFinite(x) ? Math.round(x*100) + '%' : '—', sg = x => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '—';
console.log(`\n=== 국장 국면 × 장중 진입 — 국장 ${tkN}종목 · ${dates[0]}~${dates[dates.length-1]} (${dates.length}거래일) · 종목·일 ${tkDays} · 화면 함수 idMtf·idUpEvidence ===`);
console.log('국면 하루치(d−1 종가 기준) 서로 다른 날 수: ' + Object.entries(dayRegCount).map(([k, v]) => `${k} ${v.size}`).join(' · '));
const fills = T.filter(e => e.sig === -1 && e.D === 20); console.log(`E1 지정가 체결률(D20): 시도한 종목·일 ${fills.length} 중 체결 ${fills.filter(e => e.filled).length} (${pc(fills.filter(e => e.filled).length/Math.max(1, fills.length))})`);
console.log('칸: n(서로 다른 날·종목) · 상승비율(호가 슬리피지 포함 가격 기준) / 순수익(비용 차감 평균) — +15분 · +60분 · +3일 | 같은 국면 무작위 순수익(+15분/+3일) | 워크포워드(+15분 기준)');
for (const D of [20, 0]) for (const ix of ['코스피', '코스닥']){
  console.log(`\n■ ${ix} · 지연 ${D}분${D === 20 ? '(국장 현실)' : '(참고)'}`);
  for (const g of Object.keys(REGS)){
    const inG = T.filter(e => e.D === D && e.ix === ix && e.sig >= 0 && REGS[g](e.rg)), rnd = inG.filter(e => e.sig === 6), r15 = S(rnd, 'm15'), r3 = S(rnd, 'd3');
    const gd = (dayRegCount[ix + g] || new Set()).size, blocks = [0, 1, 2].filter(b => [...(dayRegCount[ix + g] || [])].filter(d => blk[b].has(d)).length >= 3).length;
    console.log(`  ─ ${g} ${RNAME[g]} · 국면 날 ${gd}일 · 3블록 중 ${blocks}블록에 3일 이상${gd < 10 ? ' · ⚠ 10일 미만 — 판단 불가' : ''} · 무작위 +15분 ${pc(r15.hit)} ${sg(r15.net)} · +3일 ${pc(r3.hit)} ${sg(r3.net)}`);
    for (let si = 0; si < 6; si++){
      const z = inG.filter(e => e.sig === si); if (!z.length){ console.log(`    ${SIG[si].padEnd(16)} 0건`); continue; }
      const a = S(z, 'm15'), b = S(z, 'm60'), c = S(z, 'd3'), c1 = S(z, 'd1'), c5 = S(z, 'd5'), a5 = S(z, 'm5'), a30 = S(z, 'm30');
      const wf = [[[0], [1]], [[0, 1], [2]]].map(([tr, te]) => { const inB = (e, bs) => bs.some(x => blk[x].has(e.day));
        const A = S(z.filter(e => inB(e, tr)), 'm15'), Bt = S(z.filter(e => inB(e, te)), 'm15'), RA = S(rnd.filter(e => inB(e, tr)), 'm15'), RB = S(rnd.filter(e => inB(e, te)), 'm15');
        const sel = A.days >= 10 && A.net > 0 && A.net > RA.net; return sel && Bt.days >= 5 && Bt.net > 0 && Bt.net > RB.net ? '통과' : sel ? '선택→실패' : '미선택'; });
      console.log(`    ${SIG[si].padEnd(16)} n${String(a.n).padStart(4)}(${a.days}일·${a.tks}종목) · +5분 ${sg(a5.net)} · +15분 ${pc(a.hit)} ${sg(a.net)} · +30분 ${sg(a30.net)} · +60분 ${pc(b.hit)} ${sg(b.net)} · +1일 ${sg(c1.net)} · +3일 ${pc(c.hit)} ${sg(c.net)} (n${c.n}·${c.days}일) · +5일 ${sg(c5.net)} | vs 무작위 +15분 ${sg(a.net - r15.net)}%p · +3일 ${sg(c.net - r3.net)}%p | WF ${wf.join(' · ')}`);
    }
  }
}
/* 핵심 질문: 급락 뒤 공포 꺾임(G3)에서 EMA9 눌림이 평소(G0)보다 유리한가 */
for (const ix of ['코스피', '코스닥']){ const z = g => T.filter(e => e.D === 20 && e.ix === ix && e.sig === 0 && REGS[g](e.rg)), a = S(z('G0'), 'm15'), b = S(z('G3'), 'm15'), a3 = S(z('G0'), 'd3'), b3 = S(z('G3'), 'd3');
  console.log(`\n★ ${ix} EMA9 첫 눌림(D20): 평소 +15분 순 ${sg(a.net)}(n${a.n}·${a.days}일) vs 급락 뒤 공포 꺾임 ${sg(b.net)}(n${b.n}·${b.days}일) · +3일 ${sg(a3.net)} vs ${sg(b3.net)}`); }
