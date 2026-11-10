/**
 * 국장 5분봉 조기 상승·하락 조짐 + 하락 판정 직후 반등 — docs/2026-11-10-kr-early.md (결과 전 고정).
 * 기존 판정 idMtf()·idUpEvidence()는 index.html에서 추출(재구현 금지). 조기 원자·조합은 연구 정의(문서 그대로).
 * 사용: node tools/kr-early-lab.js i5.json [--replay=229200.KS@2026-11-10]
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal', 'idEma', 'idAgg', 'idMtf', 'idCandleFeat', 'idUpEvidence'].map(H.extractFunction).join('\n') + '\nthis.mtf = idMtf; this.UE = idUpEvidence;', ctx);
const args = process.argv.slice(2), files = args.filter(a => !a.startsWith('--'));
const RP = (args.find(a => a.startsWith('--replay=')) || '--replay=229200.KS@2026-11-10').slice(9).split('@');
const data = {}; for (const f of files) Object.assign(data, JSON.parse(fs.readFileSync(f, 'utf8')));
const ETF = new Set(['069500.KS', '229200.KS']);
const idxEtf = t => (t === '229200.KS' || /\.KQ$/.test(t)) ? '229200.KS' : '069500.KS';
const tick = (t, p) => ETF.has(t) ? (p < 2000 ? 1 : 5) : p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
const cost = t => ETF.has(t) ? 0.03 : 0.21;
const UPF = new Set(['up', 'go', 'wait', 'pull']);
const stCls = s => UPF.has(s) ? 'U' : s === 'down' ? 'D' : s === 'flat' ? 'F' : 'H';
const HM = [5, 15, 30, 60];
const hhmm = (ts, off) => { const d = new Date((ts + off)*1000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
const FAM = { U1: 'E20', U2: 'E20', U3: 'E9', U4: 'VW', U5: 'ST', U6: 'SK', U7: 'CV', D1: 'E20', D2: 'E20', D3: 'E9', D4: 'VW', D5: 'ST', D7: 'SK', D6: 'CV' };
const NAME = { U1: 'EMA20 회복', U1f: 'EMA20 첫 회복(그날 첫)', U2: 'EMA20 첫 지지 반등', U3: 'EMA9 재돌파·기울기↑', U4: 'VWAP 회복', U5: '고점 돌파·저점 상승', U6: '스토캐스틱 GC·과매도 탈출', U7: '반등 캔들+거래량',
  D1: 'EMA20 이탈', D1f: 'EMA20 첫 이탈(그날 첫)', D2: 'EMA20 지지 실패', D3: 'EMA9 이탈·기울기↓', D4: 'VWAP 이탈', D5: '저점 붕괴·고점 하락', D6: '3연속 음봉+거래량', D7: '스토캐스틱 DC·과매수 이탈',
  K1: 'K1 EMA20+1계열', K2: 'K2 EMA20+2계열', K3: 'K3 3계열', K4: 'K4 EMA20+구조+VWAP 같은 쪽' };
const CELLS = { U: ['U1', 'U1f', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'K1', 'K2', 'K3', 'K4'], D: ['D1', 'D1f', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'K1', 'K2', 'K3', 'K4'] };

/* ── 1. 종목·날 재생 ─────────────────────────────────────────── */
const DAYS = {};   // t -> [{day, off, B, info, closeNext}]
let tkN = 0;
for (const [t, Dt] of Object.entries(data)){
  if (!/\.(KS|KQ)$/.test(t)) continue; tkN++;
  const days = []; let cur = null;
  for (const b of Dt.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); } cur.bars.push(b); }
  /* 국장 15:00 시작 · 거래량 0 종가 점 봉은 5분봉이 아니다 — 빼고 종가로만 쓴다 */
  for (const x of days){ const lb = x.bars[x.bars.length-1], m = new Date((lb[0] + x.off)*1000); if (m.getUTCHours()*60 + m.getUTCMinutes() >= 900){ x.closePx = lb[4]; x.bars = x.bars.filter(b => { const q = new Date((b[0] + x.off)*1000); return q.getUTCHours()*60 + q.getUTCMinutes() < 900; }); } else x.closePx = lb[4]; }
  const out = [];
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars; if (B.length < 12) continue;
    const t0 = B[0][0], end = t0 + 23400;
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    const info = [];
    for (let k = 0; k < B.length; k++){
      const tau = B[k][0] + 300;
      const A = ctx.mtf({ tz: 'Asia/Seoul', gmtoffset: today.off, reg: { start: t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k + 1).map(b => b.slice(0, 6))) }, tau);
      const D5 = A ? A.tf[5].filter(r => r.done) : [], n = D5.length, L = D5[n-1];
      if (!L || L.ts !== B[k][0]){ info.push(null); continue; }
      /* 5분봉 ATR14 · 거래량 비 · 스토캐스틱 14·3·3(idUpEvidence와 같은 식 — 하락 쪽 판정용) */
      let atr = 0; for (let j = Math.max(1, n-14); j < n; j++){ const b = D5[j], pc = D5[j-1].c; atr += Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); } atr /= Math.min(14, n-1) || 1;
      const pr = D5.slice(Math.max(0, n-21), n-1), av = pr.length ? pr.reduce((s, z) => s + z.v, 0)/pr.length : 0;
      let K1 = null, D1 = null, K0 = null, D0 = null;
      if (n >= 45){ const raw = i => { let hh = -Infinity, ll = Infinity; for (let j = i-13; j <= i; j++){ hh = Math.max(hh, D5[j].h); ll = Math.min(ll, D5[j].l); } return hh > ll ? (D5[i].c - ll)/(hh - ll)*100 : 50; };
        const K = i => (raw(i) + raw(i-1) + raw(i-2))/3, Dd = i => (K(i) + K(i-1) + K(i-2))/3; K1 = K(n-1); D1 = Dd(n-1); K0 = K(n-2); D0 = Dd(n-2); }
      let ue = []; try { ue = ctx.UE(A).map(e => e.k); } catch (e){}
      info.push({ k, tau, st: A.state, o: L.o, h: L.h, l: L.l, c: L.c, v: L.v, e9: L.e9, e20: L.e20, vw: L.vw, atr, vr: av > 0 ? L.v/av : null, K1, D1, K0, D0, ue });
    }
    out.push({ day: today.day, off: today.off, B, info, closeNext: di + 1 < days.length ? days[di+1].closePx : null, dayLow: Math.min(...B.map(b => b[3])), dayLowK: B.reduce((a, b, i) => b[3] < B[a][3] ? i : a, 0) });
  }
  DAYS[t] = out;
}

/* ── 2. 원자 · 조합 ─────────────────────────────────────────── */
function atoms(I, k){
  const L = I[k], P = I[k-1], Q = I[k-2], f = new Set();
  if (!L || !P || !Q || k < 2) return f;
  const a = L.atr || 0;
  if (Q.c <= Q.e20 && P.c <= P.e20 && L.c > L.e20) f.add('U1');
  if (P.c > P.e20 && Q.c > Q.e20 && L.l <= L.e20 + 0.1*a && L.c > L.e20 && L.c > L.o && !(P.l <= P.e20 + 0.1*a)) f.add('U2');
  if (P.c <= P.e9 && L.c > L.e9 && L.e9 > P.e9) f.add('U3');
  if (L.vw != null && P.vw != null && P.c <= P.vw && L.c > L.vw) f.add('U4');
  if (L.c > P.h && L.l > P.l) f.add('U5');
  if (L.ue.includes('S1') || L.ue.includes('S2')) f.add('U6');
  if (L.ue.some(x => ['C1', 'C2', 'C3', 'C4'].includes(x)) && L.vr >= 1.5) f.add('U7');
  if (Q.c >= Q.e20 && P.c >= P.e20 && L.c < L.e20) f.add('D1');
  if (P.c >= P.e20 && L.c < L.e20){ for (let j = Math.max(0, k-6); j < k; j++){ const z = I[j]; if (z && z.l <= z.e20 + 0.1*a && z.c >= z.e20){ f.add('D2'); break; } } }
  if (P.c >= P.e9 && L.c < L.e9 && L.e9 < P.e9) f.add('D3');
  if (L.vw != null && P.vw != null && P.c >= P.vw && L.c < L.vw) f.add('D4');
  if (L.c < P.l && L.h < P.h) f.add('D5');
  if (L.c < L.o && P.c < P.o && Q.c < Q.o && L.vr >= 1.5) f.add('D6');
  if (L.K1 != null && ((L.K0 >= L.D0 && L.K1 < L.D1 && Math.max(L.K0, L.D0) > 50) || (L.K0 > 80 && L.K1 <= 80))) f.add('D7');
  return f;
}
function cellsAt(I, k, AT, firstSeen){
  const res = { U: new Set(), D: new Set() };
  for (const dir of ['U', 'D']){
    const now = [...AT[k]].filter(x => x[0] === dir);
    for (const x of now) res[dir].add(x);
    const e20 = dir === 'U' ? ['U1', 'U2'] : ['D1', 'D2'];
    if (now.includes(e20[0]) && !firstSeen[dir]){ res[dir].add(e20[0] + 'f'); firstSeen[dir] = true; }
    const win = new Set(); for (let j = Math.max(0, k-2); j <= k; j++) for (const x of AT[j] || []) if (x[0] === dir) win.add(x);
    const fams = new Set([...win].map(x => FAM[x])), e20now = now.some(x => FAM[x] === 'E20'), e20win = [...win].some(x => FAM[x] === 'E20');
    const others = new Set([...win].filter(x => FAM[x] !== 'E20').map(x => FAM[x]));
    if (e20now && others.size >= 1) res[dir].add('K1');
    if (e20now && others.size >= 2) res[dir].add('K2');
    if (fams.size >= 3 && now.length) res[dir].add('K3');
    const L = I[k], side = L.vw == null ? false : dir === 'U' ? L.c > L.vw : L.c < L.vw;
    if (e20win && fams.has('ST') && side && now.length) res[dir].add('K4');
  }
  return res;
}

/* ── 3. 결과 측정 ─────────────────────────────────────────── */
const EV = [];   // {t, day, dir, cell, k, D, st, ...}
const RND = [];
const OLD = [];  // 기존 판정 → down 전환 사건
const FLIP = []; // 종목·일 번갈아 전환 수
const outc = (t, X, k, D, dir, sigL, sigH) => {
  const B = X.B, I = X.info, tau = I[k].tau, obs = tau + D*60, k0 = B.findIndex(b => b[0] >= obs);
  if (k0 < 0) return null;
  const p0raw = B[k0][1], tk = tick(t, p0raw), p0 = dir === 'U' ? p0raw + tk : p0raw;
  const r = { k0, obsTs: B[k0][0], p0: p0raw };
  for (const h of HM){ const i = k0 + h/5 - 1; r['m' + h] = i < B.length ? ((B[i][4] - (dir === 'U' ? tk : 0))/p0 - 1)*100 : null; }
  r.d1 = X.closeNext != null ? ((X.closeNext - (dir === 'U' ? tk : 0))/p0 - 1)*100 : null;
  let fl = false; for (let i = k0; i < Math.min(B.length, k0 + 6); i++){ if (dir === 'U' ? B[i][4] < sigL : B[i][4] > sigH){ fl = true; break; } } r.fals = k0 + 5 < B.length || fl ? fl : null;
  /* 지수 ETF 같은 시간 수익률(대형주 초과 수익용) */
  const ix = idxEtf(t); if (ix !== t && DAYS[ix]){ const Y = (DAYS[ix] || []).find(z => z.day === X.day); if (Y){ const j0 = Y.B.findIndex(b => b[0] >= obs), j1 = j0 >= 0 ? j0 + 5 : -1; if (j0 >= 0 && j1 < Y.B.length) r.ix30 = (Y.B[j1][4]/Y.B[j0][1] - 1)*100; } }
  else if (ix === t) r.ix30 = null;
  return r;
};
for (const [t, XS] of Object.entries(DAYS)) for (const X of XS){
  const I = X.info, B = X.B, AT = I.map((_, k) => atoms(I, k)), first = {}, last = {}, sigs = [];
  /* 번갈아 전환: 기존 판정 상승계 ↔ down */
  let flips = 0, prevC = null; for (const z of I){ if (!z) continue; const c = stCls(z.st); if ((c === 'U' || c === 'D') && prevC && prevC !== c && (prevC === 'U' || prevC === 'D')) flips++; if (c === 'U' || c === 'D') prevC = c; }
  FLIP.push({ t, day: X.day, flips });
  for (let k = 2; k < I.length; k++){
    if (!I[k] || !I[k-1] || !I[k-2]) continue;
    const C = cellsAt(I, k, AT, first);
    for (const dir of ['U', 'D']) for (const cell of C[dir]){
      const key = dir + cell; if (last[key] != null && k - last[key] < 6) continue; last[key] = k;
      sigs.push({ dir, cell, k });
    }
  }
  /* 취소: 30분 안에 반대 방향 EMA20 원자 또는 반대 K1 */
  const oppAt = (dir, k) => { for (let j = k + 1; j <= Math.min(I.length - 1, k + 6); j++){ const a = AT[j]; if (!a) continue; const o = dir === 'U' ? ['D1', 'D2'] : ['U1', 'U2']; if (o.some(x => a.has(x))) return true; if (sigs.some(s => s.k === j && s.dir !== dir && s.cell === 'K1')) return true; } return false; };
  for (const s of sigs){
    const L = I[s.k];
    /* 기존 판정과의 시간 차 */
    const want = s.dir === 'U' ? (z => UPF.has(z.st)) : (z => z.st === 'down');
    let lead = null, already = want(L); if (!already){ for (let j = s.k + 1; j < I.length; j++) if (I[j] && want(I[j])){ lead = (I[j].tau - L.tau)/60; break; } }
    for (const D of [20, 0]){ const r = outc(t, X, s.k, D, s.dir, L.l, L.h); if (!r) { EV.push({ t, day: X.day, dir: s.dir, cell: s.cell, D, late: 1 }); continue; }
      EV.push({ t, day: X.day, dir: s.dir, cell: s.cell, k: s.k, D, st: stCls(L.st), c: cost(t), already, lead, cancel: oppAt(s.dir, s.k), ...r }); }
  }
  /* 무작위: 09:30 이후 15분 간격 */
  for (let k = 6; k < I.length; k += 3){ const L = I[k]; if (!L) continue;
    for (const D of [20, 0]) for (const dir of ['U', 'D']){ const r = outc(t, X, k, D, dir, L.l, L.h); if (r) RND.push({ t, day: X.day, dir, D, st: stCls(L.st), c: cost(t), ...r }); } }
  /* 기존 down 전환 사건 */
  for (let k = 1; k < I.length; k++){
    const L = I[k]; if (!L || L.st !== 'down') continue;
    let j = k - 1; while (j >= 0 && !I[j]) j--; if (j < 0) continue;
    const pc = stCls(I[j].st); if (pc === 'D') continue;
    const r = outc(t, X, k, 20, 'D', L.l, L.h), r0 = outc(t, X, k, 0, 'D', L.l, L.h);
    const lowSoFar = Math.min(...B.slice(0, k + 1).map(b => b[3])), lowK = B.slice(0, k + 1).reduce((a, b, i) => b[3] < B[a][3] ? i : a, 0), hiSoFar = Math.max(...B.slice(0, k + 1).map(b => b[2]));
    let ext = null, reb = null; if (r){ let mn = Infinity, mi = r.k0; for (let i = r.k0; i < Math.min(B.length, r.k0 + 12); i++) if (B[i][3] < mn){ mn = B[i][3]; mi = i; }
      let mx = -Infinity; for (let i = mi; i < Math.min(B.length, r.k0 + 12); i++) mx = Math.max(mx, B[i][2]); ext = (mn/r.p0 - 1)*100; reb = (mx/mn - 1)*100; }
    const w3 = [k-2, k-1, k].filter(i => I[i]).some(i => { const z = I[i], rg = z.h - z.l, lw = Math.min(z.o, z.c) - z.l; return rg > 0 && lw >= 0.5*rg && z.vr >= 1.5; });
    const prevLow6 = Math.min(...[1, 2, 3, 4, 5, 6].map(q => I[k-q] ? I[k-q].l : Infinity));
    OLD.push({ t, day: X.day, k, from: pc, tau: L.tau, off: X.off, px: L.c, e9: L.e9, e20: L.e20, vw: L.vw, r, r0, ext, reb, minsSinceLow: (L.tau - (B[lowK][0] + 300))/60, done: hiSoFar > lowSoFar ? (hiSoFar - L.c)/(hiSoFar - lowSoFar) : null,
      afterDayLow: X.dayLowK < k, upAt: [k-3, k-2, k-1, k].filter(i => i >= 0 && AT[i]).flatMap(i => [...AT[i]].filter(x => x[0] === 'U').map(x => x + '@' + hhmm(I[i].tau, X.off))),
      f: { aboveE9: L.c > L.e9, kLow: L.K1 != null && L.K1 < 20, wick: w3, hl: L.l > prevLow6, bounce3: k - lowK >= 3, upAtom: [k-3, k-2, k-1, k].some(i => i >= 0 && AT[i] && [...AT[i]].some(x => x[0] === 'U')) } });
  }
}

/* ── 4. 집계 ─────────────────────────────────────────── */
const dates = [...new Set(EV.concat(RND).map(e => e.day))].sort(), n3 = Math.floor(dates.length/3);
const blk = [new Set(dates.slice(0, n3)), new Set(dates.slice(n3, 2*n3)), new Set(dates.slice(2*n3))];
const pc = x => isFinite(x) ? Math.round(x*100) + '%' : '—', sg = (x, d = 3) => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—';
const mean = a => a.length ? a.reduce((s, v) => s + v, 0)/a.length : NaN;
/* 상승: hit = 수익>0, val = 수익 − 비용 · 하락: hit = 수익<0, val = 수익(낮을수록 경고가 맞음) */
const stat = (xs, h, dir) => { const z = xs.filter(e => e[h] != null); const hit = z.filter(e => dir === 'U' ? e[h] > 0 : e[h] < 0).length;
  const val = mean(z.map(e => dir === 'U' ? e[h] - e.c : e[h])), fz = z.filter(e => e.fals != null);
  const byDay = {}; z.forEach(e => { (byDay[e.day] = byDay[e.day] || []).push(dir === 'U' ? e[h] > 0 : e[h] < 0); });
  return { n: z.length, hit: z.length ? hit/z.length : NaN, val, fals: fz.length ? fz.filter(e => e.fals).length/fz.length : NaN, days: Object.keys(byDay).length, tks: new Set(z.map(e => e.t)).size, dayHit: mean(Object.values(byDay).map(a => a.filter(Boolean).length/a.length)) }; };
const matched = (sig, rnd, h, dir) => { const w = {}; sig.filter(e => e[h] != null).forEach(e => { w[e.st] = (w[e.st] || 0) + 1; }); const N = Object.values(w).reduce((a, b) => a + b, 0);
  let hit = 0, val = 0, fals = 0, ok = 0; for (const [s, c] of Object.entries(w)){ const R = stat(rnd.filter(e => e.st === s), h, dir); if (!R.n) continue; hit += R.hit*c; val += R.val*c; fals += (isFinite(R.fals) ? R.fals : 0)*c; ok += c; }
  return ok ? { hit: hit/ok, val: val/ok, fals: fals/ok, cover: ok/N } : { hit: NaN, val: NaN, fals: NaN, cover: 0 }; };
const better = (S, M, dir) => S.hit >= M.hit + 0.05 && (dir === 'U' ? S.val > M.val : S.val < M.val);
const med = a => { const s = a.filter(v => v != null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length/2)] : NaN; };

console.log(`\n=== 국장 5분봉 조기 상승·하락 조짐 — ${tkN}종목 · ${dates[0]}~${dates[dates.length-1]} (${dates.length}거래일) · 기존 판정 idMtf · 반등 근거 idUpEvidence ===`);
console.log('읽는 법: 상승칸 = 상승 비율 · 평균 순수익(비용·호가 차감) / 하락칸 = 하락 비율 · 평균 수익률(낮을수록 경고가 맞음). "무작위" = 같은 기존 판정 상태로 가중한 무작위 시점.');
const RES = {};
for (const dir of ['U', 'D']){
  console.log(`\n■ ${dir === 'U' ? '🟢 조기 상승' : '🟠 조기 하락'} · D20(국장 현실: 봉 끝 + 20분 뒤 첫 시가) — 괄호 안 D0(지연 없음 참고)`);
  for (const cell of CELLS[dir]){
    const all = EV.filter(e => e.dir === dir && e.cell === cell), z = all.filter(e => e.D === 20 && !e.late), z0 = all.filter(e => e.D === 0 && !e.late);
    if (!z.length){ console.log(`  ${(NAME[cell.startsWith('K') ? cell : cell] || cell).padEnd(22)} 0건`); continue; }
    const rnd = RND.filter(e => e.dir === dir && e.D === 20), S30 = stat(z, 'm30', dir), M30 = matched(z, rnd, 'm30', dir), S0 = stat(z0, 'm30', dir);
    const S15 = stat(z, 'm15', dir), S60 = stat(z, 'm60', dir), Sd = stat(z, 'd1', dir), M15 = matched(z, rnd, 'm15', dir), M60 = matched(z, rnd, 'm60', dir);
    const wf = [[[0], [1]], [[0, 1], [2]]].map(([tr, te]) => { const inB = (e, bs) => bs.some(x => blk[x].has(e.day));
      const a = stat(z.filter(e => inB(e, tr)), 'm30', dir), am = matched(z.filter(e => inB(e, tr)), rnd.filter(e => inB(e, tr)), 'm30', dir);
      const b = stat(z.filter(e => inB(e, te)), 'm30', dir), bm = matched(z.filter(e => inB(e, te)), rnd.filter(e => inB(e, te)), 'm30', dir);
      return better(a, am, dir) && b.n >= 20 && better(b, bm, dir) ? '유지' : better(a, am, dir) ? '선택→실패' : '미선택'; });
    const late = all.filter(e => e.D === 20 && e.late).length, canc = mean(z.map(e => e.cancel ? 1 : 0)), alr = mean(z.map(e => e.already ? 1 : 0));
    const later = z.filter(e => !e.already && e.lead != null), never = z.filter(e => !e.already && e.lead == null).length;
    const pass = better(S30, M30, dir) && S30.fals < M30.fals && wf.every(w => w === '유지') && S30.n >= 100 && S30.days >= 20 && S30.tks >= 10;
    RES[dir + cell] = { pass, lead: med(later.map(e => e.lead)), S30 };
    console.log(`  ${(NAME[cell] || cell).padEnd(22)} n${String(S30.n).padStart(5)}(${S30.days}일·${S30.tks}종목) · +15분 ${pc(S15.hit)} ${sg(S15.val)} [무작위 ${pc(M15.hit)} ${sg(M15.val)}] · +30분 ${pc(S30.hit)} ${sg(S30.val)} [무작위 ${pc(M30.hit)} ${sg(M30.val)}] (D0 ${pc(S0.hit)} ${sg(S0.val)}) · +60분 ${pc(S60.hit)} ${sg(S60.val)} [${pc(M60.hit)}] · 다음날 ${pc(Sd.hit)} ${sg(Sd.val)}`);
    console.log(`  ${''.padEnd(22)} 날짜별 평균 적중 ${pc(S30.dayHit)} · 거짓 ${pc(S30.fals)} [무작위 ${pc(M30.fals)}] · 취소(30분 안 반대) ${pc(canc)} · 기존 판정: 이미 같은 방향 ${pc(alr)} · 그날 나중 ${later.length}건 중앙값 ${sg(med(later.map(e => e.lead)), 0)}분 먼저 · 그날 안 나옴 ${never}건 · 장 마감으로 관측 불가 ${late}건 | WF ${wf.join('·')} | ${pass ? '✅ 표시 후보' : '✗'}`);
  }
  const cand = Object.entries(RES).filter(([k, v]) => k[0] === dir && v.pass).sort((a, b) => (b[1].lead || 0) - (a[1].lead || 0));
  console.log(`  → 표시 후보(문서 판정 1~4 모두): ${cand.length ? cand.map(([k, v]) => `${NAME[k.slice(1)]}(앞선 중앙값 ${sg(v.lead, 0)}분)`).join(' · ') : '없음 — 이 방향 조짐은 띄우지 않는다'}`);
}
/* 무작위 상태별 기준 */
console.log('\n■ 무작위 기준(D20 · +30분) — 기존 판정 상태별: ' + ['U', 'D', 'F', 'H'].map(s => { const u = stat(RND.filter(e => e.dir === 'U' && e.D === 20 && e.st === s), 'm30', 'U'); return `${{ U: '상승계', D: '하락', F: '탐색', H: '보류' }[s]} n${u.n} 상승 ${pc(u.hit)} 순 ${sg(u.val)}`; }).join(' · '));

/* ── B. 기존 하락 판정 직후 반등 ─────────────────────────────── */
console.log(`\n■ 기존 30분 '하락 주의' 전환 직후 (관측 = 전환 봉 끝 + 20분 뒤 첫 시가)`);
const ob = OLD.filter(e => e.r && e.from !== 'H'), obH = OLD.filter(e => e.r && e.from === 'H');
const upR = (xs, h) => { const z = xs.filter(e => e.r && e.r[h] != null); return { n: z.length, up: z.length ? z.filter(e => e.r[h] > 0).length/z.length : NaN, avg: mean(z.map(e => e.r[h])) }; };
const rDown = RND.filter(e => e.dir === 'D' && e.D === 20 && e.st === 'D'), rAll = RND.filter(e => e.dir === 'D' && e.D === 20);
const rU = (xs, h) => { const z = xs.filter(e => e[h] != null); return { up: z.length ? z.filter(e => e[h] > 0).length/z.length : NaN, avg: mean(z.map(e => e[h])) }; };
console.log(`  사건 ${ob.length}건(${new Set(ob.map(e => e.day)).size}일·${new Set(ob.map(e => e.t)).size}종목) · 개장 직후 보류→하락 ${obH.length}건 따로 · 번갈아 전환(상승계↔하락) 종목·일 평균 ${sg(mean(FLIP.map(f => f.flips)), 2)}회 · 2회 이상 ${pc(mean(FLIP.map(f => f.flips >= 2 ? 1 : 0)))}`);
for (const h of ['m5', 'm15', 'm30', 'm60', 'd1']){ const a = upR(ob, h), b = rU(rDown, h), c = rU(rAll, h);
  console.log(`  ${h.padEnd(4)} 관측 뒤 상승 ${pc(a.up)} 평균 ${sg(a.avg)}% (n${a.n}) | 같은 하락 상태 무작위 ${pc(b.up)} ${sg(b.avg)} | 전체 무작위 ${pc(c.up)} ${sg(c.avg)}`); }
const ex = ob.filter(e => e.r.ix30 != null && e.r.m30 != null);
console.log(`  대형주 +30분 지수 ETF 대비 초과 평균 ${sg(mean(ex.map(e => e.r.m30 - e.r.ix30)))}%p (n${ex.length}) · 지수도 오른 경우 ${pc(mean(ex.map(e => e.r.ix30 > 0 ? 1 : 0)))}`);
console.log(`  관측 뒤 60분 추가 하락 중앙값 ${sg(med(ob.map(e => e.ext)), 2)}% · 그 저점 뒤 반등 중앙값 ${sg(med(ob.map(e => e.reb)), 2)}% · 판정 시점 '그때까지 장중 저점' 뒤 경과 중앙값 ${sg(med(ob.map(e => e.minsSinceLow)), 0)}분 · 그때까지 하락폭 중 진행 중앙값 ${pc(med(ob.map(e => e.done)))} · 그날 최종 저점이 판정보다 앞섬 ${pc(mean(ob.map(e => e.afterDayLow ? 1 : 0)))}`);
const wfB = [[0], [1], [2]].map(bs => { const z = ob.filter(e => bs.some(x => blk[x].has(e.day))), a = upR(z, 'm30'), b = rU(rDown.filter(e => bs.some(x => blk[x].has(e.day))), 'm30'); return `${pc(a.up)}/${pc(b.up)}(n${a.n})`; });
console.log(`  블록별 +30분 상승 비율 사건/하락 상태 무작위: ${wfB.join(' · ')}`);
console.log('  판정 시점 특징별 +30분 상승 비율(있음 / 없음):');
for (const [f, nm] of [['upAtom', '최근 20분 조기 상승 원자 있음'], ['aboveE9', 'EMA9 위로 이미 회복'], ['kLow', '%K<20 과매도'], ['wick', '최근 3봉 긴 아랫꼬리+거래량'], ['hl', '저점 상승(직전 6봉 최저 위)'], ['bounce3', '저점 뒤 3봉↑ 경과']]){
  const y = upR(ob.filter(e => e.f[f]), 'm30'), n = upR(ob.filter(e => !e.f[f]), 'm30'); console.log(`    ${nm.padEnd(22)} ${pc(y.up)} ${sg(y.avg)} (n${y.n}) / ${pc(n.up)} ${sg(n.avg)} (n${n.n})`); }
for (const cell of ['D1', 'K1']){ const z = EV.filter(e => e.dir === 'D' && e.cell === cell && e.D === 20 && !e.late && e.m30 != null);
  console.log(`  비교: 조기 ${NAME[cell]} 관측 뒤 +30분 상승 ${pc(mean(z.map(e => e.m30 > 0 ? 1 : 0)))} 평균 ${sg(mean(z.map(e => e.m30)))} (n${z.length})`); }

/* ── C. 11/10 재생 ─────────────────────────────────────────── */
const X = (DAYS[RP[0]] || []).find(z => z.day === RP[1]);
if (!X){ console.log(`\n■ 재생: ${RP[0]} ${RP[1]} 자료 없음`); }
else {
  const I = X.info, off = X.off, AT = I.map((_, k) => atoms(I, k)), first = {};
  const SN = { up: '상승 흐름', go: '5분 재돌파', wait: '진입 대기', pull: '눌림 관찰', down: '하락 주의', flat: '방향 탐색', hold: '보류' };
  console.log(`\n■ 재생 ${RP[0]} ${RP[1]} — 발생 = 봉 끝 · 확인 가능 = 발생 + 20분(야후 국장 지연) · 봉 ${X.B.length}개 · 장중 저가 ${X.dayLow} (${hhmm(X.B[X.dayLowK][0], off)} 봉)`);
  let prev = null; const firsts = {};
  for (let k = 0; k < I.length; k++){ const L = I[k]; if (!L) continue;
    const C = k >= 2 && I[k-1] && I[k-2] ? cellsAt(I, k, AT, first) : { U: new Set(), D: new Set() };
    const NA = '아직 관측 불가';
    const perf = (dir) => { const r = outc(RP[0], X, k, 20, dir, L.l, L.h); if (!r) return `확인 가능 시각에 봉 없음(${NA})`; return [15, 30, 60].map(h => `+${h}분 ${r['m' + h] == null ? NA : sg(r['m' + h], 2) + '%'}`).join(' · '); };
    const ev = [...C.U].map(x => '🟢' + x).concat([...C.D].map(x => '🟠' + x));
    const perfTxt = (C.U.size ? ' | 🟢 관측가 기준 ' + perf('U') : '') + (C.D.size ? ' | 🟠 관측가 기준 ' + perf('D') : '');
    const chg = prev !== L.st;
    for (const x of [...C.U].map(c => 'U' + c).concat([...C.D].map(c => 'D' + c))) if (!(x in firsts)) firsts[x] = k;
    if (chg) firsts['st:' + L.st] = firsts['st:' + L.st] ?? k;
    if (chg || ev.length) console.log(`  ${hhmm(X.B[k][0], off)}~${hhmm(L.tau, off)} 확인 ${hhmm(L.tau + 1200, off)} · 종가 ${L.c} · EMA9 ${Math.round(L.e9)} · EMA20 ${Math.round(L.e20)} · VWAP ${L.vw == null ? '—' : Math.round(L.vw)} · 기존 ${SN[L.st] || L.st}${chg ? '(전환)' : ''}${ev.length ? ' · ' + ev.join(' ') + perfTxt : ''}`);
    prev = L.st; }
  const T = k => k == null ? '없음' : `${hhmm(I[k].tau, off)} 발생 → ${hhmm(I[k].tau + 1200, off)} 확인 가능 (가격 ${I[k].c})`;
  const scan = (from, f) => { for (let k = Math.max(0, from); k < I.length; k++) if (I[k] && f(k)) return k; return null; };
  const eUpK = scan(2, k => AT[k].has('U1') || AT[k].has('U2'));
  const upOldK = scan(0, k => UPF.has(I[k].st));
  const peakFrom = Math.max(eUpK ?? 0, upOldK ?? 0) + 1;
  const eDnK = scan(peakFrom, k => AT[k].has('D1') || AT[k].has('D3'));
  const dnOldK = scan(peakFrom, k => I[k].st === 'down');
  console.log(`  요약 · 첫 EMA20 회복·지지: ${T(eUpK)} · 기존 상승 판정 첫 등장: ${T(upOldK)}${eUpK != null && upOldK != null ? ` · ${Math.round((I[upOldK].tau - I[eUpK].tau)/60)}분 차이` : ''}`);
  console.log(`         첫 EMA9·EMA20 이탈: ${T(eDnK)} · 기존 하락 판정 첫 등장: ${T(dnOldK)}${eDnK != null && dnOldK != null ? ` · ${Math.round((I[dnOldK].tau - I[eDnK].tau)/60)}분 차이` : ''}`);
  for (const o of OLD.filter(e => e.t === RP[0] && e.day === RP[1])){ console.log(`  기존 하락 전환 ${hhmm(o.tau, off)}(가격 ${o.px}) → 확인 가능 ${hhmm(o.tau + 1200, off)} 관측가 ${o.r ? o.r.p0 : '—'} · EMA9 ${Math.round(o.e9)} · EMA20 ${Math.round(o.e20)} · VWAP ${o.vw == null ? '—' : Math.round(o.vw)} · +5/15/30/60분 ${o.r ? HM.map(h => o.r['m' + h] == null ? '아직 관측 불가' : sg(o.r['m' + h], 2) + '%').join(' / ') : '확인 가능 시각에 봉 없음'} · 다음날 ${o.r && o.r.d1 != null ? sg(o.r.d1, 2) : '아직 관측 불가'} · 그때까지 저점 뒤 ${Math.round(o.minsSinceLow)}분 · 하락폭 진행 ${pc(o.done)} · 추가 하락 ${sg(o.ext, 2)}% · 반등 ${sg(o.reb, 2)}%`);
    console.log(`    그 순간 5분봉: 그날 최종 저점(${hhmm(X.B[X.dayLowK][0], off)} 봉)보다 ${X.dayLowK < o.k ? '뒤' : X.dayLowK === o.k ? '같은 봉' : '앞'} · EMA9 위 ${o.f.aboveE9 ? '예' : '아니오'} · 저점 상승 ${o.f.hl ? '예' : '아니오'} · 저점 뒤 3봉↑ ${o.f.bounce3 ? '예' : '아니오'} · %K<20 ${o.f.kLow ? '예' : '아니오'} · 긴 아랫꼬리+거래량 ${o.f.wick ? '예' : '아니오'} · 직전 20분 조기 상승 원자 ${o.upAt.length ? o.upAt.join(', ') : '없음'}`); }
}
