/**
 * 국장 장중 판정 개선(빈도 유지) — docs/2026-11-10-kr-intraday-v.md (결과 전 고정).
 * V0 = 화면 idMtf()(index.html에서 추출 · 재구현 금지). V1~V5는 연구용 판정 규칙(문서 정의 그대로).
 * 사용: node tools/kr-intraday-v-lab.js i5kr.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal', 'idEma', 'idAgg', 'idMtf'].map(H.extractFunction).join('\n') + '\nthis.mtf = idMtf;', ctx);
const data = {}; for (const f of process.argv.slice(2)) Object.assign(data, JSON.parse(fs.readFileSync(f, 'utf8')));
const ETF = new Set(['069500.KS', '229200.KS']);
const idxOf = t => (t === '229200.KS' || /\.KQ$/.test(t)) ? '229200.KS' : '069500.KS';
const tick = (t, p) => ETF.has(t) ? (p < 2000 ? 1 : 5) : p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
const cost = t => ETF.has(t) ? 0.03 : 0.21;
const UPF = new Set(['up', 'go', 'wait', 'pull']);
const V = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5'];
const VN = { V0: '기존(화면)', V1: '15분 추세', V2: '5분 추세', V3: '점수형', V4: '반전 가속', V5: '밴드 워크 유지' };
const K3 = [1, 1.5, 2, 2.5, 3];
const sgn = x => x > 0 ? 1 : x < 0 ? -1 : 0;
const trendCls = (arr, j) => { if (j < 3) return 'N'; const x = arr[j], vok = x.vw == null; if ((vok || x.c > x.vw) && x.e9 > x.e20 && x.e20 >= arr[j - 3].e20) return 'U'; if ((vok || x.c < x.vw) && x.e9 < x.e20) return 'D'; return 'N'; };

/* ── 1. 재생: 종목·일마다 각 5분봉 끝 시각의 특징 ── */
const DAYS = {};
const tickers = Object.keys(data).filter(t => /\.(KS|KQ)$/.test(t)).sort((a, b) => ETF.has(b) - ETF.has(a));   // ETF 먼저(지수 상태용)
for (const t of tickers){
  const Dt = data[t], days = []; let cur = null;
  for (const b of Dt.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); } cur.bars.push(b); }
  for (const x of days){ x.closePx = x.bars[x.bars.length-1][4]; x.bars = x.bars.filter(b => { const q = new Date((b[0] + x.off)*1000); return q.getUTCHours()*60 + q.getUTCMinutes() < 900; }); }
  const out = [];
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars; if (B.length < 24) continue;
    const t0 = B[0][0], end = t0 + 23400, hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    const prevClose = days.slice(Math.max(0, di-20), di).map(x => x.closePx);
    const info = [];
    for (let k = 0; k < B.length; k++){
      const tau = B[k][0] + 300;
      const A = ctx.mtf({ tz: 'Asia/Seoul', gmtoffset: today.off, reg: { start: t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k + 1).map(b => b.slice(0, 6))) }, tau);
      const D5 = A ? A.tf[5].filter(r => r.done) : [], L = D5[D5.length-1];
      if (!L || L.ts !== B[k][0]){ info.push(null); continue; }
      const D15 = A.tf[15].filter(r => r.done), D30 = A.tf[30].filter(r => r.done);
      let pb30 = null, upRise = false, loFall = false;
      if (D30.length >= 23){
        const bb = j => { const s = D30.slice(j-19, j+1).map(r => r.c), m = s.reduce((a, b) => a + b, 0)/20, sd = Math.sqrt(s.reduce((a, b) => a + (b-m)**2, 0)/20); return { m, u: m + 2*sd, l: m - 2*sd }; };
        const j = D30.length-1, b0 = bb(j), b3 = bb(j-3);
        pb30 = b0.u > b0.l ? (D30[j].c - b0.l)/(b0.u - b0.l) : 0.5; upRise = b0.u > b3.u; loFall = b0.l < b3.l;
      }
      const n5 = D5.length;
      info.push({ k, tau, c: L.c, h: L.h, l: L.l, st0: UPF.has(A.state) ? 'U' : A.state === 'down' ? 'D' : 'N',
        v1: D15.length >= 23 ? trendCls(D15, D15.length-1) : 'N', v2: n5 >= 23 ? trendCls(D5, n5-1) : 'N',
        vwS: L.vw == null ? 0 : sgn(L.c - L.vw), e30: D30.length ? sgn(D30[D30.length-1].e9 - D30[D30.length-1].e20) : 0,
        e5slope: n5 > 3 ? sgn(L.e20 - D5[n5-4].e20) : 0, idx5: n5 >= 23 ? (L.c > L.e20 && L.e20 > D5[n5-4].e20 ? 1 : L.c < L.e20 && L.e20 < D5[n5-4].e20 ? -1 : 0) : 0,
        pb30, upRise, loFall });
    }
    const dayTrend = prevClose.length >= 20 ? (prevClose[prevClose.length-1] > prevClose.reduce((a, b) => a + b, 0)/prevClose.length ? '위' : '아래') : '?';
    out.push({ day: today.day, off: today.off, B, info, closeNext: di + 1 < days.length ? days[di+1].closePx : null, dayTrend });
  }
  DAYS[t] = out;
}
/* 지수 상태 조회표: (ETF, 날, 봉 시작 ts) → idx5 */
const IDX = {}; for (const e of ETF) for (const X of DAYS[e] || []) for (const z of X.info) if (z) IDX[e + X.day + X.B[z.k][0]] = z.idx5;

/* ── 2. 판정 방식별 상태열 → 신호 ── */
function classes(X, t, k3){
  const I = X.info, out = Object.fromEntries(V.map(v => [v, []])); let p4 = 'N', run = 0, p5 = 'N';
  for (let k = 0; k < I.length; k++){
    const z = I[k]; if (!z){ for (const v of V) out[v].push(null); continue; }
    const ix = ETF.has(t) ? z.idx5 : (IDX[idxOf(t) + X.day + X.B[k][0]] || 0);
    out.V0.push(z.st0); out.V1.push(z.v1); out.V2.push(z.v2);
    const s = z.vwS + z.e30 + z.e5slope + ix + (z.pb30 == null ? 0 : Math.max(-1, Math.min(1, 2*(z.pb30 - 0.5))));
    out.V3.push(s >= k3 ? 'U' : s <= -k3 ? 'D' : 'N');
    /* V4: V2가 V0와 반대(U↔D) 2봉 연속이면 V2 */
    const opp = (z.v2 === 'U' && z.st0 === 'D') || (z.v2 === 'D' && z.st0 === 'U'); run = opp ? run + 1 : 0;
    out.V4.push(run >= 2 ? z.v2 : z.st0);
    /* V5: 밴드 워크 유지 */
    let c5 = z.st0;
    if (p5 === 'U' && c5 !== 'U' && z.pb30 != null && z.pb30 >= 0.8 && z.upRise) c5 = 'U';
    else if (p5 === 'D' && c5 !== 'D' && z.pb30 != null && z.pb30 <= 0.2 && z.loFall) c5 = 'D';
    out.V5.push(c5); p5 = c5;
  }
  return out;
}
function events(X, t, cls){
  const I = X.info, B = X.B, t0 = B[0][0], ev = []; let prev = null;
  for (let k = 0; k < I.length; k++){
    const c = cls[k]; if (c == null) continue;
    if ((c === 'U' || c === 'D') && c !== prev && B[k][0] >= t0 + 1800) ev.push({ k, dir: c });
    prev = c;
  }
  return ev;
}
function outcome(X, t, k, dir, D){
  const B = X.B, I = X.info, obs = I[k].tau + D*60, k0 = B.findIndex(b => b[0] >= obs);
  if (k0 < 0 || k0 + 11 >= B.length) return null;
  const p0 = B[k0][1], tk = tick(t, p0), p60 = B[k0 + 11][4];
  const raw = (p60/p0 - 1)*100, hit = dir === 'U' ? raw > 0 : raw < 0;
  const net = dir === 'U' ? ((p60 - tk)/(p0 + tk) - 1)*100 - cost(t) : ((p0 - tk)/(p60 + tk) - 1)*100 - cost(t);
  let fals = false; for (let i = k0; i < Math.min(B.length, k0 + 6); i++) if (dir === 'U' ? B[i][4] < I[k].l : B[i][4] > I[k].h){ fals = true; break; }
  const pre = k >= 12 && I[k-12] ? (I[k].c/I[k-12].c - 1)*100 : null;
  const m = new Date((B[k][0] + X.off)*1000), mm = m.getUTCHours()*60 + m.getUTCMinutes();
  return { hit, net, raw, fals, late: pre == null ? null : (dir === 'U' ? pre > 1 : pre < -1), tod: mm < 630 ? '09:30~10:30' : mm < 780 ? '10:30~13:00' : '13:00~15:00' };
}

/* ── 3. 집계 ── */
const allDays = [...new Set(Object.values(DAYS).flat().map(x => x.day))].sort(), n3 = Math.floor(allDays.length/3);
const blkOf = d => d < allDays[n3] ? 0 : d < allDays[2*n3] ? 1 : 2;
const pc = x => isFinite(x) ? (x*100).toFixed(1) + '%' : '—', sg = x => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '—';
const mean = a => a.length ? a.reduce((s, v) => s + v, 0)/a.length : NaN;
function run(v, k3, blocks, D){
  const R = [], perTk = {}; let tkDays = 0, unobs = 0;
  for (const [t, XS] of Object.entries(DAYS)) for (const X of XS){
    if (!blocks.includes(blkOf(X.day))) continue; tkDays++;
    const cls = classes(X, t, k3)[v], ev = events(X, t, cls);
    perTk[t] = (perTk[t] || 0) + ev.length;
    for (const e of ev){ const o = outcome(X, t, e.k, e.dir, D); if (!o){ unobs++; continue; }
      const ix = ETF.has(t) ? null : (IDX[idxOf(t) + X.day + X.B[e.k][0]] || 0);
      R.push({ t, day: X.day, dir: e.dir, ...o, idxOpp: ix == null ? null : (e.dir === 'U' ? ix < 0 : ix > 0), dayTrend: X.dayTrend }); }
  }
  return { R, perTk, tkDays, unobs };
}
const summ = (R, dir) => { const z = dir ? R.filter(r => r.dir === dir) : R, w = z.filter(r => r.net > 0).map(r => r.net), l = z.filter(r => r.net <= 0).map(r => -r.net);
  return { n: z.length, hit: z.length ? z.filter(r => r.hit).length/z.length : NaN, net: mean(z.map(r => r.net)), pr: l.length && w.length ? mean(w)/mean(l) : NaN, fals: z.length ? z.filter(r => r.fals).length/z.length : NaN }; };
const freq = (o, dir) => o.R.filter(r => !dir || r.dir === dir).length / Math.max(1, o.tkDays);

console.log(`\n=== 국장 장중 판정 개선(빈도 유지) — ${Object.keys(DAYS).length}종목 · ${allDays[0]}~${allDays[allDays.length-1]} (${allDays.length}거래일) · 블록 경계 ${allDays[n3]} · ${allDays[2*n3]} ===`);
console.log('신호 = 상승(U)/하락(D)으로 바뀐 봉(09:30 이후) · 적중 = +60분 방향 · 기대 = 비용·호가 차감 평균% · 손익비 = 이긴 평균/진 평균 · 거짓 = 관측 뒤 30분 안 신호 봉 저가(고가) 이탈');
/* V3 k 선택: 학습 블록 V0 빈도 이상인 k 중 적중 최고 */
const pickK = tr => { const f0 = freq(run('V0', 2, tr, 20)); let best = null;
  for (const k of K3){ const o = run('V3', k, tr, 20), s = summ(o.R); if (freq(o) >= f0 && (!best || s.hit > best.s.hit)) best = { k, s }; }
  return best ? best.k : K3[0]; };
const kB = pickK([0]), kC = pickK([0, 1]);
console.log(`V3 k 선택: 블록1 학습 → 블록2 k=${kB} · 블록1+2 학습 → 블록3 k=${kC}`);
const RES = {};
for (const D of [20, 0]){
  console.log(`\n■ ${D === 20 ? 'D20 (국장 현실: 봉 끝 + 20분 뒤 첫 시가)' : 'D0 (지연 없음 — 참고)'} · 시험 블록 2·3 합산`);
  for (const v of V){
    const o2 = run(v, kB, [1], D), o3 = run(v, kC, [2], D);
    const R = o2.R.concat(o3.R), tkDays = o2.tkDays + o3.tkDays, o = { R, tkDays };
    const a = summ(R), u = summ(R, 'U'), d = summ(R, 'D'), b2 = summ(o2.R), b3 = summ(o3.R);
    const per = {}; for (const src of [o2.perTk, o3.perTk]) for (const [t, n] of Object.entries(src)) per[t] = (per[t] || 0) + n;
    const pv = Object.values(per).sort((x, y) => x - y), days = new Set(R.map(r => r.day)).size;
    RES[v + D] = { a, u, d, b2, b3, fU: freq(o, 'U'), fD: freq(o, 'D') };
    console.log(`  ${(v + ' ' + VN[v]).padEnd(14)} 빈도 종목·일당 상승 ${freq(o, 'U').toFixed(2)} · 하락 ${freq(o, 'D').toFixed(2)} · 하루 전체 ${(R.length/Math.max(1, days)).toFixed(1)} · 종목별 ${pv[0]}/${pv[Math.floor(pv.length/2)]}/${pv[pv.length-1]}(최소/중앙/최대) · +60분 관측 불가 ${o2.unobs + o3.unobs}`);
    console.log(`  ${''.padEnd(14)} 합산 적중 ${pc(a.hit)} 기대 ${sg(a.net)} 손익비 ${a.pr.toFixed(2)} 거짓 ${pc(a.fals)} (n${a.n}) | 상승 ${pc(u.hit)} 기대 ${sg(u.net)} 손익비 ${u.pr.toFixed(2)} 거짓 ${pc(u.fals)} (n${u.n}) | 하락 ${pc(d.hit)} 기대 ${sg(d.net)} 손익비 ${d.pr.toFixed(2)} 거짓 ${pc(d.fals)} (n${d.n}) | 블록2 ${pc(b2.hit)} · 블록3 ${pc(b3.hit)}`);
  }
}
/* 합격 판정 (D20) */
console.log('\n■ 합격 판정(D20 · 시험 블록) — 1 빈도 ≥ V0 · 2 합산 +2%p ∧ 상승·하락 각각 −2%p 이내 · 3 기대 악화 없음 · 4 블록 2·3 각각 ≥ V0');
const b = RES.V020;
for (const v of V.slice(1)){
  const r = RES[v + '20'], c1 = r.fU >= b.fU && r.fD >= b.fD, c2 = r.a.hit >= b.a.hit + 0.02 && r.u.hit >= b.u.hit - 0.02 && r.d.hit >= b.d.hit - 0.02,
    c3 = r.u.net >= b.u.net && r.d.net >= b.d.net, c4 = r.b2.hit >= b.b2.hit && r.b3.hit >= b.b3.hit;
  console.log(`  ${v} ${VN[v]}: 1 ${c1 ? '✓' : '✗'} · 2 ${c2 ? '✓' : '✗'}(${sg((r.a.hit - b.a.hit)*100)}%p · 상승 ${sg((r.u.hit - b.u.hit)*100)} · 하락 ${sg((r.d.hit - b.d.hit)*100)}) · 3 ${c3 ? '✓' : '✗'} · 4 ${c4 ? '✓' : '✗'} → ${c1 && c2 && c3 && c4 ? '✅ 합격' : '✗'} · 60% ${r.a.hit >= 0.6 ? '달성' : '미달'}`);
}
/* 오답 원인(V0 · D20 · 전 블록) */
const o0 = run('V0', 2, [0, 1, 2], 20).R;
console.log(`\n■ V0 오답 원인 (D20 · +60분 · 전 블록 n${o0.length}) — 칸별 적중률(건수)`);
for (const dir of ['U', 'D']){
  const z = o0.filter(r => r.dir === dir), f = (fn) => { const a = z.filter(fn); return `${pc(a.length ? a.filter(r => r.hit).length/a.length : NaN)}(${a.length})`; };
  console.log(`  ${dir === 'U' ? '상승' : '하락'} 전체 ${f(() => true)} · 늦은 신호(직전 60분 이미 ±1%↑) ${f(r => r.late === true)} vs 아님 ${f(r => r.late === false)} · 지수 역행 ${f(r => r.idxOpp === true)} vs 아님 ${f(r => r.idxOpp === false)}`);
  console.log(`       시간대 ${['09:30~10:30', '10:30~13:00', '13:00~15:00'].map(s => s + ' ' + f(r => r.tod === s)).join(' · ')} · 지수 ETF 20일선 ${['위', '아래'].map(s => s + ' ' + f(r => r.dayTrend === s)).join(' · ')}`);
}
