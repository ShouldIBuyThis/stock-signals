/* index.html @ cdfdc7d (2026-11-09 07:16 UTC) 장중 함수 사본 — 석별형 64%(n28) 계산 당시 그대로. 비교 전용, 화면에 쓰지 않는다. */
function idLocal(ts, off){ const d = new Date((ts + (off||0)) * 1000); return { day: d.toISOString().slice(0,10), m: d.getUTCHours()*60 + d.getUTCMinutes() }; }
function idEma(rows, n){ const k = 2/(n+1); let e = null; return rows.map(r => (e = e === null ? r.c : r.c*k + e*(1-k))); }
function idAgg(b5, N, t0, lastDay, cut, off){
  const out = [], S = N*60;
  for (const b of b5){
    const k = Math.floor((b.ts - t0[b.day]) / S), st = t0[b.day] + k*S, L = out[out.length-1];
    if (L && L.day === b.day && L.k === k){ L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; L.v += b.v; L.vw = b.vw; }
    else out.push({ k, ts:st, o:b.o, h:b.h, l:b.l, c:b.c, v:b.v, vw:b.vw, day:b.day, m:idLocal(st, off).m });
  }
  out.forEach(r => { r.done = r.day !== lastDay || r.ts + S <= cut; });
  const e9 = idEma(out, 9), e20 = idEma(out, 20);
  out.forEach((r, i) => { r.e9 = e9[i]; r.e20 = e20[i]; });
  return out;
}
function idMtf(d, now){
  const off = d.gmtoffset || 0, reg = d.reg || {};
  /* 야후는 마지막 날에 정규장 끝 시각(미장 16:00)에 시작하는 봉을 하나 더 붙여 준다 — 정규장 밖이라 뺀다 */
  const endM = reg.end ? idLocal(reg.end, off).m : null;
  const b5 = d.bars.filter(b => !(reg.end && b[0] >= reg.end && b[0] < reg.end + 3600))
    .map(b => { const L = idLocal(b[0], off); return { ts:b[0], o:b[1], h:b[2], l:b[3], c:b[4], v:b[5]||0, day:L.day, m:L.m }; })
    .filter((b, i, a) => !(endM != null && b.m === endM && (i === a.length-1 || a[i+1].day !== b.day)));   // 지난 거래일의 마감 시각 봉도(장 종료 뒤 조회 시)
  if (!b5.length) return null;
  let day = null, pv = 0, vv = 0;
  b5.forEach(r => { if (r.day !== day){ day = r.day; pv = 0; vv = 0; } pv += (r.h + r.l + r.c)/3 * r.v; vv += r.v; r.vw = vv > 0 ? pv/vv : null; });
  const lastDay = b5[b5.length-1].day, lastTrade = d.lastTrade || (b5[b5.length-1].ts + 300);
  const open = !!(reg.start && reg.end && now >= reg.start && now <= reg.end && lastTrade >= reg.start);
  /* 마감 직후 — 국장처럼 시세가 늦게 오면 마감 뒤에도 마지막 봉이 덜 끝났을 수 있다.
     마감 30분이 지나거나 마지막 체결이 마감 1분 전까지 왔을 때만 그날 봉을 전부 확정으로 본다. */
  const settling = !open && !!(reg.end && now >= reg.end && now < reg.end + 1800 && lastTrade < reg.end - 60);
  const cut = open || settling ? lastTrade : Infinity;
  const t0 = {}; b5.forEach(b => { if (t0[b.day] === undefined) t0[b.day] = b.ts; });
  if (reg.start && idLocal(reg.start, off).day === lastDay && reg.start <= t0[lastDay]) t0[lastDay] = reg.start;
  const tf = { 5: idAgg(b5, 5, t0, lastDay, cut, off), 15: idAgg(b5, 15, t0, lastDay, cut, off), 30: idAgg(b5, 30, t0, lastDay, cut, off) };
  const D5 = tf[5].filter(r => r.done), D15 = tf[15].filter(r => r.done), D30 = tf[30].filter(r => r.done);
  const r = { open, settling, lastTrade, lastDay, t0: t0[lastDay], tf, T:null, P:{}, E:{ ok:false, bars:[] }, state:"hold" };
  const today15 = D15.filter(x => x.day === lastDay);
  if (!D5.length) return r;
  r.cref = D5[D5.length-1].c;
  /* T — 30분 추세 */
  if (D30.length >= 20){
    const j = D30.length-1, x = D30[j], vOk = x.vw == null;
    const up = (vOk || x.c > x.vw) && x.e9 > x.e20 && x.e20 >= D30[j-3].e20;
    const dn = (vOk || x.c < x.vw) && x.e9 < x.e20;
    r.T = { dir: up ? "up" : dn ? "down" : "flat", c:x.c, vw:x.vw, e9:x.e9, e20:x.e20, ts:x.ts };
  }
  /* P — 15분 지지·저항·눌림 */
  if (D15.length >= 15 && today15.length >= 1){
    const i = D15.length-1, x = D15[i], prv = D15[i-1];
    const trs = D15.slice(-14).map((b, k, a) => { const pc = k ? a[k-1].c : (D15[D15.length-15] || b).c; return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); });
    const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
    const cand = [["VWAP", x.vw], ["20EMA", x.e20]].filter(c => c[1] != null && c[1] < r.cref);
    const S = cand.length ? cand.reduce((a, b) => b[1] > a[1] ? b : a) : null;
    const before = today15.slice(0, -1);
    const R = before.length ? Math.max(...before.map(b => b.h)) : null;
    const hh6 = Math.max(...D15.slice(-6).map(b => b.h)), lowMin = Math.min(prv.l, x.l);
    const floor = Math.min(x.vw == null ? x.e20 : x.vw, x.e20);
    const broken = x.c < floor - 0.25*atr;
    const pull = hh6 - x.c >= 0.5*atr && hh6 - x.c <= 2.5*atr;
    const held = !!S && lowMin <= S[1] + 0.25*atr && x.c >= S[1] && hh6 - lowMin >= 0.5*atr;
    r.P = { atr, S: S ? S[1] : null, Sname: S ? S[0] : null, R, breakout: R != null && x.c > R, broken, pull, held, hh6, c:x.c, ts:x.ts };
  }
  /* E — 5분 진입 조건 (오늘, 장 시작 30분 이후) */
  const chk = j => {
    const a = D5[j-1], b = D5[j];
    if (!a || b.day !== lastDay || b.ts < t0[lastDay] + 1800) return null;
    const cross = a.c <= a.e9 && b.c > b.e9;
    const rng = b.h - b.l, body = Math.abs(b.c - b.o), lw = Math.min(b.o, b.c) - b.l;
    const candle = rng > 0 && ((b.c > b.o && body >= 0.5*rng) || (lw >= 2*body && lw >= 0.5*rng));
    const prior = D5.slice(Math.max(0, j-20), j), avg = prior.length ? prior.reduce((s, z) => s + z.v, 0) / prior.length : 0;
    const vr = avg > 0 ? b.v / avg : null, vol = vr != null && vr >= 1.2;
    return { j, ts:b.ts, m:b.m, cross, candle, vol, vr, low:b.l, ok: cross && candle && vol };
  };
  const todayIdx = []; D5.forEach((b, j) => { if (b.day === lastDay) todayIdx.push(j); });
  r.E.bars = todayIdx.map(chk).filter(z => z && z.ok);
  const last3 = [D5.length-3, D5.length-2, D5.length-1].filter(j => j >= 1).map(chk).filter(Boolean);
  r.E.early = !last3.length;
  r.E.ok = last3.some(z => z.ok);
  r.E.hit = last3.filter(z => z.ok).pop() || null;
  r.E.near = last3.filter(z => z.cross).pop() || null;
  r.E.last3 = last3;   // 화면 표시용(판정에는 안 씀)
  /* 종합 */
  if (today15.length < 2 || D30.length < 20 || !r.T || r.P.atr == null) r.state = "hold";
  else if (r.T.dir === "down" || r.P.broken) r.state = "down";
  else if (r.T.dir === "flat") r.state = "flat";
  else if (r.P.held && r.E.ok) r.state = "go";
  else if (r.P.held) r.state = "wait";
  else if (r.P.pull) r.state = "pull";
  else r.state = "up";
  return r;
}
function idCandleFeat(A, bar){
  const D5 = A.tf[5].filter(r => r.done), j = D5.findIndex(r => r.ts === bar.ts);
  if (j < 0) return null;
  const B = k => { const r = D5[j - k]; if (!r || r.day !== bar.day) return null; const rg = r.h - r.l;
    return { o:r.o, h:r.h, l:r.l, c:r.c, v:r.v, rg, b: rg > 0 ? Math.abs(r.c - r.o)/rg : 0, u: rg > 0 ? (r.h - Math.max(r.o, r.c))/rg : 0, lo: rg > 0 ? (Math.min(r.o, r.c) - r.l)/rg : 0, bull: r.c > r.o, bear: r.c < r.o }; };
  const t = B(0), p = B(1), q = B(2);
  const prior = D5.slice(Math.max(0, j - 20), j);
  const rs = prior.map(r => r.h - r.l).sort((a, b) => a - b), medR = rs.length ? rs[rs.length >> 1] : null;
  const avgV = prior.length ? prior.reduce((s, r) => s + r.v, 0)/prior.length : 0;
  const r6 = D5[j - 6], pc = D5[j - 1];
  const into = r6 && pc ? (pc.c > r6.c ? "up" : pc.c < r6.c ? "down" : "flat") : null;   // 이 봉 직전까지 30분 흐름
  const names = [], mid = x => (x.o + x.c)/2;
  if (q && p){
    if (q.bear && q.b >= 0.6 && p.b <= 0.3 && Math.max(p.o, p.c) <= q.c + 0.1*q.rg && t.bull && t.c > mid(q)) names.push("샛별형");
    if (q.bull && q.b >= 0.6 && p.b <= 0.3 && Math.min(p.o, p.c) >= q.c - 0.1*q.rg && t.bear && t.c < mid(q)) names.push("석별형");
    if ([q, p, t].every(x => x.bull && x.b >= 0.5) && p.c > q.c && t.c > p.c) names.push("적삼병");
    if ([q, p, t].every(x => x.bear && x.b >= 0.5) && p.c < q.c && t.c < p.c) names.push("흑삼병");
    if (q.bear && q.b >= 0.5 && p.bull && Math.max(p.o, p.c) <= q.o && Math.min(p.o, p.c) >= q.c && t.bull && t.c > q.o) names.push("상승 확인 잉태(3봉)");
    if (q.bull && q.b >= 0.5 && p.bear && Math.max(p.o, p.c) <= q.c && Math.min(p.o, p.c) >= q.o && t.bear && t.c < q.o) names.push("하락 확인 잉태(3봉)");
  }
  if (p){
    const pb = Math.abs(p.c - p.o), tb = Math.abs(t.c - t.o), tol = 0.1*(medR || t.rg || 1);
    if (p.bear && t.bull && t.o <= p.c && t.c >= p.o && tb > pb) names.push("상승장악형");
    if (p.bull && t.bear && t.o >= p.c && t.c <= p.o && tb > pb) names.push("하락장악형");
    if (p.bear && p.b >= 0.5 && t.bull && Math.max(t.o, t.c) <= p.o && Math.min(t.o, t.c) >= p.c && tb <= 0.5*pb) names.push("상승잉태형");
    if (p.bull && p.b >= 0.5 && t.bear && Math.max(t.o, t.c) <= p.c && Math.min(t.o, t.c) >= p.o && tb <= 0.5*pb) names.push("하락잉태형");
    if (p.bear && p.b >= 0.5 && t.bull && t.o < p.c && t.c > mid(p) && t.c < p.o) names.push("관통형");
    if (p.bull && p.b >= 0.5 && t.bear && t.o > p.c && t.c < mid(p) && t.c > p.o) names.push("먹구름형");
    if (p.bear && t.bull && Math.abs(t.l - p.l) <= tol) names.push("집게바닥");
    if (p.bull && t.bear && Math.abs(t.h - p.h) <= tol) names.push("집게천장");
    if (t.h <= p.h && t.l >= p.l) names.push("인사이드바");
    if (t.h > p.h && t.l < p.l) names.push("아웃사이드바");
  }
  let single;
  if (!(t.rg > 0)) single = "도지";
  else if (t.b <= 0.1) single = t.lo >= 0.6 && t.u <= 0.1 ? "잠자리 도지" : t.u >= 0.6 && t.lo <= 0.1 ? "비석 도지" : t.u >= 0.3 && t.lo >= 0.3 ? "장족 도지" : "도지";
  else if (t.lo >= 0.6 && t.b <= 0.3 && t.u <= 0.15) single = into === "up" ? "교수형" : "망치형";
  else if (t.u >= 0.6 && t.b <= 0.3 && t.lo <= 0.15) single = into === "up" ? "유성형" : "역망치형";
  else if (t.b <= 0.3 && t.u >= 0.25 && t.lo >= 0.25) single = "팽이";
  else if (t.b >= 0.9) single = t.bull ? "양봉 마루보주" : "음봉 마루보주";
  else if (t.b >= 0.7 && medR && t.rg >= 1.5*medR) single = t.bull ? "장대양봉" : "장대음봉";
  else single = t.bull ? "일반 양봉" : t.bear ? "일반 음봉" : "도지";
  names.push(single);
  let consec = 0; for (let k = 0; ; k++){ const x = B(k); if (!x || !(t.bull ? x.bull : t.bear ? x.bear : false)) break; consec++; }
  const dayRows = D5.filter(r => r.day === bar.day), dayOpen = dayRows.length ? dayRows[0].o : t.o;
  const L15 = A.tf[15].filter(r => r.done).pop();
  const atr = A.P && A.P.atr ? A.P.atr : null;
  return { names, primary: names[0], single,
    f: { body: t.b, upper: t.u, lower: t.lo, clv: t.rg > 0 ? (t.c - t.l)/t.rg : 0.5, consec: t.bull ? consec : -consec,
         gap: p && medR ? (t.o - p.c)/medR : 0, vr: avgV > 0 ? t.v/avgV : null, rngMult: medR ? t.rg/medR : null,
         vwap: bar.vw == null ? null : (t.c - bar.vw)/(medR || t.rg || 1), ema: t.c > bar.e9 ? (bar.e9 > bar.e20 ? "위·정배열" : "위·역배열") : (bar.e9 > bar.e20 ? "아래·정배열" : "아래·역배열"),
         open: t.c >= dayOpen ? "시가 위" : "시가 아래",
         toR: A.P && A.P.R != null && atr ? (A.P.R - t.c)/atr : null, toS: A.P && A.P.S != null && atr ? (t.c - A.P.S)/atr : null,
         tr15: L15 ? (L15.e9 > L15.e20 ? "up" : "down") : null, tr30: A.T ? A.T.dir : null, into } };
}
