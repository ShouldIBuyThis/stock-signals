/**
 * 장중 신호 통합 연구 — 예측 시간 × 레버리지 모드. docs/2026-11-10-intraday-horizon-lev.md (결과 전 고정). 연구 전용.
 * V0 = 화면 idMtf()(index.html에서 추출). V1~V5 = docs/2026-11-10-kr-intraday-v.md 정의 그대로.
 * 사용: node tools/intraday-horizon-lev-lab.js i5.json [i5kr.json ...]
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal', 'idEma', 'idAgg', 'idMtf'].map(H.extractFunction).join('\n') + '\nthis.mtf = idMtf;', ctx);
const data = {}; for (const f of process.argv.slice(2)) Object.assign(data, JSON.parse(fs.readFileSync(f, 'utf8')));

/* ── 상품 분류 ── */
const PROD = {
  QQQ: ['나스닥100', 1], QLD: ['나스닥100', 2], TQQQ: ['나스닥100', 3], SQQQ: ['나스닥100', -3],
  SPY: ['S&P500', 1], SSO: ['S&P500', 2], SPXL: ['S&P500', 3], SPXS: ['S&P500', -3],
  SOXX: ['반도체', 1], SOXL: ['반도체', 3], SOXS: ['반도체', -3],
  '069500.KS': ['KOSPI200', 1], '122630.KS': ['KOSPI200', 2], '114800.KS': ['KOSPI200', -1], '252670.KS': ['KOSPI200', -2],
  '229200.KS': ['KOSDAQ150', 1], '233740.KQ': ['KOSDAQ150', 2], '233740.KS': ['KOSDAQ150', 2], '251340.KQ': ['KOSDAQ150', -1], '251340.KS': ['KOSDAQ150', -1],
  UYG: ['금융', 2], DUSL: ['산업재', 3], NAIL: ['주택건설', 3], GDXU: ['금광', 3],
};
const ONE = { '나스닥100': 'QQQ', 'S&P500': 'SPY', '반도체': 'SOXX', KOSPI200: '069500.KS', KOSDAQ150: '229200.KS' };
const isKR = t => /\.(KS|KQ)$/.test(t);
const ETF_OTHER = new Set(['0173Y0.KS', '0123G0.KS', '0183J0.KS', '453650.KS', 'GLD', 'SLV', 'USO', 'XLE', 'XLU', 'IBIT', 'ETHA', 'URA', 'XBI', 'ITA', 'IYR', 'DBA', 'REMX', 'UFO', 'QTUM']);
const lev = t => PROD[t] ? PROD[t][1] : 1;
const typeOf = (t, hv) => { const L = lev(t); if (L < 0) return '인버스'; if (L >= 3) return '3배'; if (L === 2) return '2배'; if (PROD[t] || ETF_OTHER.has(t)) return '1배 ETF'; return hv.has(t) ? '고변동 주식' : '일반 주식'; };
const tickKR = (t, p) => (PROD[t] || ETF_OTHER.has(t)) ? (p < 2000 ? 1 : 5) : p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
const isETFt = t => !!PROD[t] || ETF_OTHER.has(t);
/* 진입·청산 슬리피지(가격 단위) · 왕복 비용(%) */
const slip = (t, p) => isKR(t) ? tickKR(t, p) : p * (isETFt(t) ? 0.0002 : 0.0003);
const cost = t => isKR(t) ? (isETFt(t) ? 0.03 : 0.21) : 0;
const HS = [5, 15, 30, 60, 90, 'EOD'];
const UPF = new Set(['up', 'go', 'wait', 'pull']);
const sgn = x => x > 0 ? 1 : x < 0 ? -1 : 0;
const trendCls = (arr, j) => { if (j < 3) return 'N'; const x = arr[j], vok = x.vw == null; if ((vok || x.c > x.vw) && x.e9 > x.e20 && x.e20 >= arr[j-3].e20) return 'U'; if ((vok || x.c < x.vw) && x.e9 < x.e20) return 'D'; return 'N'; };

/* ── 1. 재생 ── */
const DAYS = {}; const order = Object.keys(data).sort((a, b) => (!!PROD[b] && lev(b) === 1) - (!!PROD[a] && lev(a) === 1) || (b === 'QQQ') - (a === 'QQQ'));
for (const t of order){
  const kr = isKR(t), tz = kr ? 'Asia/Seoul' : 'America/New_York', days = []; let cur = null;
  for (const b of data[t].bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); } cur.bars.push(b); }
  for (const x of days) x.bars = x.bars.filter(b => { const q = new Date((b[0] + x.off)*1000), m = q.getUTCHours()*60 + q.getUTCMinutes(); return kr ? m < 900 : m < 960; });
  const out = [];
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars; if (B.length < 24) continue;
    const t0 = B[0][0], end = t0 + 23400, hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    const info = [];
    for (let k = 0; k < B.length; k++){
      const tau = B[k][0] + 300;
      const A = ctx.mtf({ tz, gmtoffset: today.off, reg: { start: t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k + 1).map(b => b.slice(0, 6))) }, tau);
      const D5 = A ? A.tf[5].filter(r => r.done) : [], L = D5[D5.length-1];
      if (!L || L.ts !== B[k][0]){ info.push(null); continue; }
      const D15 = A.tf[15].filter(r => r.done), D30 = A.tf[30].filter(r => r.done), n5 = D5.length;
      let pb30 = null, upRise = false, loFall = false;
      if (D30.length >= 23){ const bb = j => { const s = D30.slice(j-19, j+1).map(r => r.c), m = s.reduce((a, b) => a + b, 0)/20, sd = Math.sqrt(s.reduce((a, b) => a + (b-m)**2, 0)/20); return { u: m + 2*sd, l: m - 2*sd }; };
        const j = D30.length-1, b0 = bb(j), b3 = bb(j-3); pb30 = b0.u > b0.l ? (D30[j].c - b0.l)/(b0.u - b0.l) : 0.5; upRise = b0.u > b3.u; loFall = b0.l < b3.l; }
      let atr = 0; for (let j = Math.max(1, n5-14); j < n5; j++){ const b = D5[j], pc = D5[j-1].c; atr += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); } atr /= Math.min(14, n5-1) || 1;
      const slope = n5 > 3 ? L.e20 - D5[n5-4].e20 : 0;
      info.push({ k, tau, c: L.c, h: L.h, l: L.l, st: A.state, rb: A.E.bars.some(z => z.ts === L.ts),
        v1: D15.length >= 23 ? trendCls(D15, D15.length-1) : 'N', v2: n5 >= 23 ? trendCls(D5, n5-1) : 'N',
        vwS: L.vw == null ? 0 : sgn(L.c - L.vw), e30: D30.length ? sgn(D30[D30.length-1].e9 - D30[D30.length-1].e20) : 0,
        slS: sgn(slope), slN: atr > 0 ? (slope/atr >= 0.1 ? 1 : slope/atr <= -0.1 ? -1 : 0) : 0,
        idx5: n5 >= 23 ? (L.c > L.e20 && slope > 0 ? 1 : L.c < L.e20 && slope < 0 ? -1 : 0) : 0, pb30, upRise, loFall, rng: L.h - L.l });
    }
    out.push({ day: today.day, off: today.off, B, info });
  }
  DAYS[t] = out;
}
const KEY = {}; for (const [t, XS] of Object.entries(DAYS)) for (const X of XS) for (const z of X.info) if (z) KEY[t + '|' + X.B[z.k][0]] = z;
const at = (t, X, k) => KEY[t + '|' + X.B[k][0]];
const allDays = [...new Set(Object.values(DAYS).flat().map(x => x.day))].sort(), n3 = Math.floor(allDays.length/3);
const blk = d => d < allDays[n3] ? 0 : d < allDays[2*n3] ? 1 : 2;
/* 고변동 주식: 학습 블록 일중 진폭(5분봉 범위 합/가격) 상위 1/3 */
const vol = {}; for (const [t, XS] of Object.entries(DAYS)){ if (isETFt(t)) continue; const v = XS.filter(X => blk(X.day) === 0).map(X => (Math.max(...X.B.map(b => b[2])) / Math.min(...X.B.map(b => b[3])) - 1)); if (v.length) vol[t] = v.reduce((a, b) => a + b, 0)/v.length; }
const vs = Object.entries(vol).sort((a, b) => b[1] - a[1]); const HV = new Set(vs.slice(0, Math.ceil(vs.length/3)).map(x => x[0]));
const TYPE = {}; for (const t of Object.keys(DAYS)) TYPE[t] = typeOf(t, HV);

/* ── 2. 판정 방식 → 사건 ── */
const V3s = (z, ix, norm) => z.vwS + z.e30 + (norm ? z.slN : z.slS) + ix + (z.pb30 == null ? 0 : Math.max(-1, Math.min(1, 2*(z.pb30 - 0.5))));
const EVC = new Map();
function events(t, X, mode){ const key = t + '|' + X.day + '|' + JSON.stringify(mode); let v = EVC.get(key); if (!v){ v = events0(t, X, mode); EVC.set(key, v); } return v; }
function events0(t, X, mode){
  const I = X.info, B = X.B, t0 = B[0][0], ev = []; let prev = null, run = 0, p5 = 'N';
  const idxT = isKR(t) ? ((t === '229200.KS' || /\.KQ$/.test(t)) ? '229200.KS' : '069500.KS') : 'QQQ';
  for (let k = 0; k < I.length; k++){
    const z = I[k]; if (!z){ continue; }
    let c = 'N';
    const st0 = UPF.has(z.st) ? 'U' : z.st === 'down' ? 'D' : 'N';
    const ixz = at(idxT, X, k), ix = ixz ? ixz.idx5 : 0;
    switch (mode.sig){
      case 'V0': c = st0; break;
      case 'V1': c = z.v1; break;
      case 'V2': c = z.v2; break;
      case 'V3': { const s = V3s(z, ix, mode.norm), bu = mode.bonusUp || 0, bd = mode.bonusDn || 0; c = s + bu >= mode.k ? 'U' : s - bd <= -mode.k ? 'D' : 'N'; break; }
      case 'V4': { const opp = (z.v2 === 'U' && st0 === 'D') || (z.v2 === 'D' && st0 === 'U'); run = opp ? run + 1 : 0; c = run >= 2 ? z.v2 : st0; break; }
      case 'V5': { c = st0; if (p5 === 'U' && c !== 'U' && z.pb30 != null && z.pb30 >= 0.8 && z.upRise) c = 'U'; else if (p5 === 'D' && c !== 'D' && z.pb30 != null && z.pb30 <= 0.2 && z.loFall) c = 'D'; p5 = c; break; }
      case 'SUB': { const u = ONE[PROD[t][0]], zz = at(u, X, k); if (!zz){ c = 'N'; break; } const s0 = UPF.has(zz.st) ? 'U' : zz.st === 'down' ? 'D' : 'N'; c = lev(t) < 0 ? (s0 === 'U' ? 'D' : s0 === 'D' ? 'U' : 'N') : s0; break; }
      case 'RB': if (z.rb && B[k][0] >= t0 + 1800) ev.push({ k, dir: 'U' }); continue;
      default: { const want = mode.sig; if (z.st === want && prev !== want && B[k][0] >= t0 + 1800) ev.push({ k, dir: want === 'down' ? 'D' : 'U' }); prev = z.st; continue; }
    }
    if ((c === 'U' || c === 'D') && c !== prev && B[k][0] >= t0 + 1800) ev.push({ k, dir: c });
    prev = c;
  }
  return ev;
}
/* ── 3. 결과 ── */
function outcome(t, X, k, dir, mode, D, h, mult){
  const B = X.B, z = X.info[k], s = dir === 'U' ? 1 : -1, last = B.length - 1;
  let k0, p0;
  if (mode === 'A'){ k0 = k + 1; p0 = z.c; }
  else { const obs = z.tau + D*60; k0 = B.findIndex(b => b[0] >= obs); if (k0 < 0) return null; p0 = B[k0][1]; }
  const ke = h === 'EOD' ? last : (mode === 'A' ? k + h/5 : k0 + h/5 - 1);
  if (ke > last || ke < k0 - (mode === 'A' ? 1 : 0)) return null;
  const pe = B[ke][4], raw = (pe/p0 - 1)*100*(mult || 1);
  const sl = mode === 'B' ? slip(t, p0) : 0;
  const net = mode === 'B' ? (s > 0 ? ((pe - sl)/(p0 + sl) - 1) : ((p0 - sl)/(pe + sl) - 1))*100*(mult || 1) - cost(t)*(mult || 1) : s*raw;
  let mae = 0, mfe = 0; for (let i = Math.max(k0, 0); i <= ke; i++){ const up = (B[i][2]/p0 - 1)*100*s, dn = (B[i][3]/p0 - 1)*100*s; mfe = Math.max(mfe, s > 0 ? up : dn); mae = Math.min(mae, s > 0 ? dn : up); }
  return { raw: s*raw, tie: pe === p0, net, mae, mfe };
}
/* 기준선: 시장·상품군·날·1시간대별 모든 봉을 같은 방향으로 샀다면 (B·D별·기간별) 상승/하락/보합 수 */
const BASE = {};
const bucket = (X, k) => Math.floor((X.B[k][0] - X.B[0][0])/3600);
function baseFill(D){
  for (const [t, XS] of Object.entries(DAYS)){ if (isKR(t) !== (D === 20)) continue; for (const X of XS) for (let k = 6; k < X.info.length; k++){ if (!X.info[k]) continue;
    for (const h of [5, 15, 30, 60]) for (const m of ['A', 'B']){ const o = outcome(t, X, k, 'U', m, D, h); if (!o) continue;
      const key = [isKR(t), TYPE[t], X.day, bucket(X, k), m, D, h].join('|'), b = BASE[key] || (BASE[key] = [0, 0, 0]);
      if (o.tie) b[2]++; else if (o.raw > 0) b[0]++; else b[1]++; } } }
}
const DUS = [0, 5];
for (const D of new Set([20, ...DUS])) baseFill(D);
function measure(t, X, ev, m, D, h, mult){
  const o = outcome(t, X, ev.k, ev.dir, m, D, h, mult); if (!o) return null;
  const b = BASE[[isKR(t), TYPE[t], X.day, bucket(X, ev.k), m, m === 'A' ? (isKR(t) ? 20 : 0) : D, h].join('|')], bh = b && b[0] + b[1] ? (ev.dir === 'U' ? b[0] : b[1])/(b[0] + b[1]) : null;
  return { ...o, hit: !o.tie && o.raw > 0, bh, t, day: X.day, dir: ev.dir, blk: blk(X.day), k: ev.k };
}
const run = (filter, mode, m, D, h, mult) => { const R = []; for (const [t, XS] of Object.entries(DAYS)){ if (!filter(t)) continue; const Dt = isKR(t) ? 20 : D;
  for (const X of XS) for (const e of events(t, X, mode)){ const r = measure(t, X, e, m, m === 'A' ? 0 : Dt, h, mult); if (r) R.push(r); } } return R; };
const mean = a => a.length ? a.reduce((s, v) => s + v, 0)/a.length : NaN, med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length/2)] : NaN; };
function S(R, dir){
  const z = dir ? R.filter(r => r.dir === dir) : R, nt = z.filter(r => !r.tie), w = z.filter(r => r.net > 0).map(r => r.net), l = z.filter(r => r.net <= 0).map(r => -r.net);
  const byDay = {}, byT = {}; z.forEach(r => { byDay[r.day] = (byDay[r.day] || 0) + 1; byT[r.t] = (byT[r.t] || 0) + 1; });
  return { n: z.length, hitT: z.length ? z.filter(r => r.hit).length/z.length : NaN, hitX: nt.length ? nt.filter(r => r.hit).length/nt.length : NaN, tie: z.length ? 1 - nt.length/z.length : NaN,
    base: mean(nt.filter(r => r.bh != null).map(r => r.bh)), net: mean(z.map(r => r.net)), mednet: med(z.map(r => r.net)), avgW: mean(w), avgL: mean(l), pr: l.length && w.length ? mean(w)/mean(l) : NaN,
    mae: med(z.map(r => r.mae)), mfe: med(z.map(r => r.mfe)), tks: Object.keys(byT).length, days: Object.keys(byDay).length,
    topDay: z.length ? Math.max(...Object.values(byDay))/z.length : NaN, topT: z.length ? Math.max(...Object.values(byT))/z.length : NaN };
}
const pc = x => isFinite(x) ? (x*100).toFixed(1) : '—', sg = (x, d = 3) => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—';
const cell = s => s.n ? `${pc(s.hitX)}(${sg((s.hitX - s.base)*100, 1)}) 보합${pc(s.tie)} 순${sg(s.net, 2)} n${s.n}` : '—';
const MODES = { RB: { sig: 'RB' }, '진입대기': { sig: 'wait' }, '눌림': { sig: 'pull' }, '상승흐름': { sig: 'up' }, '재돌파상태': { sig: 'go' }, '하락주의': { sig: 'down' },
  V0: { sig: 'V0' }, V1: { sig: 'V1' }, V2: { sig: 'V2' }, V3: { sig: 'V3', k: 2 }, V4: { sig: 'V4' }, V5: { sig: 'V5' } };
const MKT = { US: t => !isKR(t), KR: t => isKR(t) };

console.log(`\n=== 장중 신호 × 예측 시간 × 레버리지 — 종목 ${Object.keys(DAYS).length} · ${allDays[0]}~${allDays[allDays.length-1]} (${allDays.length}일) · 블록 학습~${allDays[n3-1]} · 검증~${allDays[2*n3-1]} · 시험~끝(이전 연구에 쓰인 기간 — 독립 아님) ===`);
const cnt = {}; for (const t of Object.keys(DAYS)) cnt[(isKR(t) ? 'KR ' : 'US ') + TYPE[t]] = (cnt[(isKR(t) ? 'KR ' : 'US ') + TYPE[t]] || []).concat(t);
console.log('상품군: ' + Object.entries(cnt).map(([k, v]) => `${k} ${v.length}(${v.slice(0, 8).join(',')}${v.length > 8 ? '…' : ''})`).join(' · '));
console.log('표기: 보합 제외 적중%(기준선 대비 %p) 보합% 순=비용·슬리피지 차감 평균% n — 기준선 = 같은 시장·상품군·날·1시간대 모든 봉');

/* ■1 신호 × 기간 (시장별, 전 상품 · 전 기간) — A vs B */
for (const mk of ['US', 'KR']){
  const Ds = mk === 'KR' ? [20] : DUS;
  console.log(`\n■1 ${mk} 신호별 · 기간별 (전 상품군 · 전 기간) — A(신호 봉 종가 기준) / B(표시 시각 기준${mk === 'KR' ? ' · 지연 20분' : ' · 지연 0분'})`);
  for (const [nm, mode] of Object.entries(MODES)){
    for (const dir of nm === 'RB' || ['진입대기', '눌림', '상승흐름', '재돌파상태'].includes(nm) ? ['U'] : nm === '하락주의' ? ['D'] : ['U', 'D']){
      const line = [5, 15, 30, 60].map(h => { const a = S(run(MKT[mk], mode, 'A', 0, h), dir), b = S(run(MKT[mk], mode, 'B', Ds[0], h), dir); return `+${h} A ${pc(a.hitX)}(${sg((a.hitX - a.base)*100, 1)}) B ${pc(b.hitX)}(${sg((b.hitX - b.base)*100, 1)}) 순${sg(b.net, 2)}`; });
      const b90 = S(run(MKT[mk], mode, 'B', Ds[0], 90), dir), beod = S(run(MKT[mk], mode, 'B', Ds[0], 'EOD'), dir);
      console.log(`  ${(nm + (dir === 'U' ? '↑' : '↓')).padEnd(8)} ` + line.join(' | ') + ` | 참고 +90 ${pc(b90.hitX)} · 마감 ${pc(beod.hitX)} | n(B60) ${S(run(MKT[mk], mode, 'B', Ds[0], 60), dir).n}`);
    }
  }
  if (mk === 'US'){ const a = S(run(MKT.US, MODES.V0, 'B', 5, 15), 'U'), b = S(run(MKT.US, MODES.V0, 'B', 5, 15), 'D'); console.log(`  (미장 지연 5분 가정 · V0 +15분: 상승 ${cell(a)} · 하락 ${cell(b)})`); }
}
/* ■2 상품군별 (B · 시험 블록 · V0·RB·V3) */
console.log('\n■2 상품군별 · B · 전 기간(괄호 안 시험 블록 보합 제외 적중) — +15 / +30 / +60');
for (const mk of ['US', 'KR']) for (const ty of ['일반 주식', '고변동 주식', '1배 ETF', '2배', '3배', '인버스']){
  const f = t => MKT[mk](t) && TYPE[t] === ty; if (!Object.keys(DAYS).some(f)) continue;
  for (const [nm, dir] of [['V0', 'U'], ['V0', 'D'], ['RB', 'U'], ['V3', 'U'], ['V3', 'D']]){
    const cells = [15, 30, 60].map(h => { const R = run(f, MODES[nm], 'B', mk === 'KR' ? 20 : 0, h), s = S(R, dir), te = S(R.filter(r => r.blk === 2), dir); return `${cell(s)} [시험 ${pc(te.hitX)} n${te.n}]`; });
    const s60 = S(run(f, MODES[nm], 'B', mk === 'KR' ? 20 : 0, 60), dir);
    console.log(`  ${mk} ${ty.padEnd(6)} ${(nm + (dir === 'U' ? '↑' : '↓')).padEnd(5)} ${cells.join(' | ')} | 종목 ${s60.tks}·날 ${s60.days}·최다 하루 ${pc(s60.topDay)}%·최다 종목 ${pc(s60.topT)}%`);
  }
}
/* ■3 같은 기초자산 묶음 비교 (B · +15/+60 · V0 결합) */
console.log('\n■3 같은 기초자산 묶음 — V0 결합 · B · +15 / +60 (상승↑ · 하락↓)');
for (const fam of ['나스닥100', 'S&P500', '반도체', 'KOSPI200', 'KOSDAQ150']){
  const ts = Object.keys(DAYS).filter(t => PROD[t] && PROD[t][0] === fam); if (!ts.length) continue;
  for (const t of ts.sort((a, b) => lev(a) - lev(b))){ const f = x => x === t, D = isKR(t) ? 20 : 0;
    const r15 = run(f, MODES.V0, 'B', D, 15), r60 = run(f, MODES.V0, 'B', D, 60);
    console.log(`  ${fam} ${t}(${lev(t)}배) ↑ +15 ${cell(S(r15, 'U'))} · +60 ${cell(S(r60, 'U'))} | ↓ +15 ${cell(S(r15, 'D'))} · +60 ${cell(S(r60, 'D'))}`); }
}
/* ■4 레버리지 모드 B·C·D (V3 기준 · B · +15/+60) */
console.log('\n■4 레버리지 모드 — 대상별 · B · +15 / +60 · 시험 블록 [ ]');
const LEVF = t => lev(t) !== 1, HVF = t => TYPE[t] === '고변동 주식', ALLS = t => !isETFt(t);
const show = (lab, f, mode, dirs = ['U', 'D']) => { for (const dir of dirs){ const cs = [15, 60].map(h => { const R = run(f, mode, 'B', 0, h), te = S(R.filter(r => r.blk === 2), dir); return `${cell(S(R, dir))} [${pc(te.hitX)} n${te.n}]`; }); console.log(`  ${lab.padEnd(30)} ${dir === 'U' ? '↑' : '↓'} ${cs.join(' | ')}`); } };
show('A 현행 V0 · 레버리지·인버스', LEVF, MODES.V0); show('A 현행 V3 · 레버리지·인버스', LEVF, MODES.V3);
show('B1 기초자산 1배 판정 대체 · 레버리지', t => LEVF(t) && PROD[t] && ONE[PROD[t][0]] && DAYS[ONE[PROD[t][0]]], { sig: 'SUB' });
show('B2 V3 기울기 ATR 정규화 · 레버리지', LEVF, { sig: 'V3', k: 2, norm: true });
for (const b of [0.25, 0.5, 1.0]){
  for (const [lab, key, dir] of [['C 상승 가산', 'bonusUp', 'U'], ['C 하락 가산', 'bonusDn', 'D']]){
    const base = {}, add = []; const mode = { sig: 'V3', k: 2, [key]: b };
    for (const [t, XS] of Object.entries(DAYS)){ if (!LEVF(t)) continue; for (const X of XS){ const e0 = new Set(events(t, X, MODES.V3).filter(e => e.dir === dir).map(e => e.k));
      for (const e of events(t, X, mode).filter(e => e.dir === dir)){ const r = measure(t, X, e, 'B', isKR(t) ? 20 : 0, 15); if (!r) continue; (e0.has(e.k) ? (base.r = base.r || []) : add).push(r); } } }
    const s0 = S(base.r || [], dir), s1 = S(add, dir);
    console.log(`  ${lab} +${b} · 레버리지 · +15  기존과 겹친 신호 ${cell(s0)} | 새로 추가된 신호 ${cell(s1)}`);
  }
}
console.log('  ※ V0(현행 화면 판정)는 점수가 아닌 상태 판정이라 가산점이 신호 발생·시점·순서를 바꾸지 못한다 → V0 가산점 실험은 의미 없음.');
show('D b2 ATR 정규화 · 고변동 주식', HVF, { sig: 'V3', k: 2, norm: true }); show('D 현행 V3 · 고변동 주식', HVF, MODES.V3);
show('D C+0.5 상승 · 고변동 주식', HVF, { sig: 'V3', k: 2, bonusUp: 0.5 }, ['U']); show('D C+0.5 상승 · 전 주식', ALLS, { sig: 'V3', k: 2, bonusUp: 0.5 }, ['U']);
for (const L of [2, 3]){ const f = t => lev(t) === 1 && !!PROD[t]; const R = run(f, MODES.V0, 'B', 0, 60, L); const s = S(R, 'U'); console.log(`  D 가상 ${L}배(1배 ETF 신호 수익×${L}) V0↑ +60  ${cell(s)} — 적중률은 1배와 같아야 정상(배수는 크기만 바꿈)`); }
/* ■5 후보 선택(학습→검증) → 시험 */
console.log('\n■5 후보 선택: 학습 블록 개선>0 → 검증 블록 상위 5 → 시험 블록 (B · 방향별) — BH 10%');
const cands = [];
for (const mk of ['US', 'KR']) for (const ty of ['일반 주식', '고변동 주식', '1배 ETF', '2배', '3배', '인버스', '전체']) for (const [nm, mode] of Object.entries({ ...MODES, 'B2 정규화': { sig: 'V3', k: 2, norm: true }, 'V3k1.5': { sig: 'V3', k: 1.5 }, 'V3k2.5': { sig: 'V3', k: 2.5 } })) for (const h of [5, 15, 30, 60]){
  const f = t => MKT[mk](t) && (ty === '전체' || TYPE[t] === ty); if (!Object.keys(DAYS).some(f)) continue;
  const R = run(f, mode, 'B', mk === 'KR' ? 20 : 0, h);
  for (const dir of ['U', 'D']){ const z = R.filter(r => r.dir === dir); if (!z.length) continue;
    const tr = S(z.filter(r => r.blk === 0)), va = S(z.filter(r => r.blk === 1)), te = S(z.filter(r => r.blk === 2));
    cands.push({ id: `${mk} ${ty} ${nm} +${h} ${dir === 'U' ? '↑' : '↓'}`, tr, va, te, all: S(z) }); }
}
const keep = cands.filter(c => c.tr.n >= 30 && c.tr.hitX - c.tr.base > 0 && c.va.n >= 30).sort((a, b) => (b.va.hitX - b.va.base) - (a.va.hitX - a.va.base)).slice(0, 5);
const z2p = (p, p0, n) => { const se = Math.sqrt(p0*(1-p0)/n), zz = (p - p0)/se, x = Math.abs(zz)/Math.SQRT2, tt = 1/(1 + 0.3275911*x); const erf = 1 - (((((1.061405429*tt - 1.453152027)*tt) + 1.421413741)*tt - 0.284496736)*tt + 0.254829592)*tt*Math.exp(-x*x); return 1 - erf; };
console.log(`  후보 ${cands.length}개 시험 · 학습 통과 ${cands.filter(c => c.tr.n >= 30 && c.tr.hitX - c.tr.base > 0).length}개`);
const pv = keep.map(c => z2p(c.te.hitX, c.te.base, Math.max(1, Math.round(c.te.n*(1 - c.te.tie)))));
const rank = pv.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]); const bhOk = new Set(); rank.forEach(([p, i], j) => { if (p <= 0.10*(j + 1)/cands.length) bhOk.add(i); });
keep.forEach((c, i) => console.log(`  ${c.id.padEnd(34)} 학습 ${pc(c.tr.hitX)}(${sg((c.tr.hitX - c.tr.base)*100, 1)}) · 검증 ${pc(c.va.hitX)}(${sg((c.va.hitX - c.va.base)*100, 1)}) · 시험 ${cell(c.te)} 손익비 ${c.te.pr.toFixed(2)} MAE ${sg(c.te.mae, 2)} MFE ${sg(c.te.mfe, 2)} 종목 ${c.te.tks}·날 ${c.te.days} · p ${pv[i].toFixed(3)} ${bhOk.has(i) ? 'BH 통과' : 'BH 탈락'}`));
const v0 = cands.filter(c => / 전체 V0 \+60 /.test(c.id)); v0.forEach(c => console.log(`  [대조] ${c.id} 시험 ${cell(c.te)} 손익비 ${c.te.pr.toFixed(2)}`));
/* ■6 국장 사이트 종목 ▲(재돌파 상태) 분해 */
console.log('\n■6 국장 5분 재돌파(go 상태 진입) 분해 — 사이트 국장 종목 · D0(다음 봉 시가, 이전 표와 같은 기준) / B(20분)');
const site = new Set(['069500.KS', '229200.KS', '453650.KS', '0173Y0.KS', '0123G0.KS', '0183J0.KS']);
for (const [lab, f] of [['사이트 6종목', t => site.has(t)], ['레버리지 ETF', t => isKR(t) && lev(t) !== 1], ['1배 ETF(069500·229200)', t => t === '069500.KS' || t === '229200.KS'], ['대형주', t => isKR(t) && !isETFt(t)]]){
  const R = []; for (const [t, XS] of Object.entries(DAYS)){ if (!f(t)) continue; for (const X of XS) for (const e of events(t, X, { sig: 'go' })){ const r0 = measure(t, X, e, 'B', 0, 60), r20 = measure(t, X, e, 'B', 20, 60); if (r0) R.push({ ...r0, r20 }); } }
  const s0 = S(R, 'U'), s20 = S(R.map(r => r.r20).filter(Boolean), 'U');
  const byT = {}; R.forEach(r => { byT[r.t] = byT[r.t] || [0, 0]; byT[r.t][0]++; byT[r.t][1] += r.hit; });
  const byB = [0, 1, 2].map(b => { const z = R.filter(r => r.blk === b); return `${z.length ? pc(z.filter(r => r.hit).length/z.length) : '—'}(${z.length})`; });
  console.log(`  ${lab.padEnd(18)} D0 +60 ${cell(s0)} · B20 +60 ${cell(s20)} · 블록별 D0 적중 ${byB.join('/')} · 날 ${s0.days} 최다 하루 ${pc(s0.topDay)}% · 종목별 ${Object.entries(byT).map(([t, v]) => `${t} ${v[1]}/${v[0]}`).join(' ')}`);
}
