/**
 * 장중 상승 반전·지속 캔들 심층 연구 — docs/2026-11-09-intraday-bull.md (결과 전 고정).
 * idMtf()·idCandleFeat()는 index.html에서 추출(재구현 금지). 사용: node tools/intraday-bull-lab.js i5.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
vm.createContext(ctx);
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat'].map(H.extractFunction).join('\n') + '\nthis.idMtf = idMtf; this.feat = idCandleFeat;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let CAT = {}; try { JSON.parse(fs.readFileSync('signals.json', 'utf8')).stocks.forEach(s => CAT[s.ticker] = s.category || '기타'); } catch(e){}
const HZ = [5, 15, 30, 60], COST = [0.05, 0.10];
const BULL3 = ['샛별형', '십자샛별형', '적삼병', '상승 확인 잉태(3봉)', '상승 확인 장악(3봉)'];
const BULL2 = ['상승장악형', '상승잉태형', '관통형', '집게바닥', '저점 상승형'];
const BULL1 = ['망치형', '역망치형', '잠자리 도지', '긴 아랫꼬리 양봉', '양봉 마루보주'];
const BULL = [...BULL3, ...BULL2, ...BULL1];
const outcome = (B, k) => { if (k >= B.length) return null; const e = B[k][1], r = {};
  for (const h of HZ){ const i = k + h/5 - 1; r[h] = i < B.length ? (B[i][4]/e - 1)*100 : null; }
  const w = n => { const z = B.slice(k, k + n); return [(Math.max(...z.map(b => b[2]))/e - 1)*100, (Math.min(...z.map(b => b[3]))/e - 1)*100]; };
  const [mfe15, mae15] = w(3), [mfe60, mae60] = w(12); return { r, mfe15, mae15, mfe60, mae60 }; };
const BASE = [], EV = [], EE = [];
for (const [t, D] of Object.entries(data)){
  const kr = /\.(KS|KQ)$/.test(t), cat = CAT[t] || '기타';
  const days = []; let cur = null;
  for (const b of D.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off:b[6], bars:[] }; days.push(cur); } cur.bars.push(b); }
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300;
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    for (let k = 1; k < B.length; k++){
      const tau = B[k][0];
      const A = ctx.idMtf({ gmtoffset: today.off, reg:{ start:t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k).map(b => b.slice(0, 6))) }, tau);
      if (!A) continue;
      const tod = tau - t0 < 3600 ? '장초반' : end - tau <= 3600 ? '마감전' : '장중';
      const o1 = outcome(B, k); if (!o1) continue;
      const k2 = kr ? B.findIndex(b => b[0] === tau + 1200) : -1;
      const base = { t, kr, cat, day: today.day, tod, o1, o2: kr ? (k2 >= 0 ? outcome(B, k2) : 'na') : null };
      BASE.push(base);
      const L = A.tf[5].filter(r => r.done).pop();
      if (A.E.bars.find(z => z.ts === L.ts)) EE.push(base);
      const F = ctx.feat(A, L); if (!F) continue;
      const pats = F.names.filter(n => BULL.includes(n));
      const lo = F.f.lower, vr = F.f.vr, vw = L.vw, dep = vw ? (vw - L.l)/vw*100 : null;
      const dayOpen = B[0][1], S = A.P && A.P.S;
      const reclaim = { VWAP: vw != null && L.l < vw && L.c >= vw, 지지S: S != null && L.l < S && L.c >= S, 당일시가: L.l < dayOpen && L.c >= dayOpen };
      const T30 = A.T ? A.T.dir : null, into = F.f.into;
      const trend = T30 === 'down' ? '하락 반전' : (T30 === 'up' && into === 'down') ? '상승 눌림목' : '그 밖';
      const combo = lo >= 0.5 ? `아랫꼬리≥0.5·거래량${vr == null ? '—' : vr < 1 ? '<1' : vr < 2 ? '1~2' : '≥2'}·${Object.keys(reclaim).filter(k => reclaim[k]).join('+') || '회복없음'}` : null;
      if (!pats.length && !combo) continue;
      const prim = BULL3.find(n => pats.includes(n)) || BULL2.find(n => pats.includes(n)) || BULL1.find(n => pats.includes(n)) || null;
      EV.push({ ...base, pats, prim, combo, lo, vr, dep, reclaim, trend, E: !!A.E.bars.find(z => z.ts === L.ts) });
    }
  }
}
/* ---------- 통계 ---------- */
const S = (xs, h = 15, o = 'o1') => { const z = xs.map(e => e[o] && e[o] !== 'na' ? e[o].r[h] : null).filter(v => v != null); const g = z.filter(v => v > 0), l = z.filter(v => v < 0);
  return { n: z.length, hit: z.length ? g.length/z.length : NaN, avg: z.length ? z.reduce((a, b) => a + b, 0)/z.length : NaN, pf: l.length ? g.reduce((a, b) => a + b, 0)/-l.reduce((a, b) => a + b, 0) : NaN }; };
const med = a => { const s = a.filter(x => isFinite(x)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = x => isFinite(x) ? (x*100).toFixed(0) + '%' : '—', sg = (x, d = 3) => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—';
const grade = n => n >= 50 ? '사용' : n >= 30 ? '방향' : n >= 15 ? '참고' : '불가';
/* 같은 시장×시간대 기준선 — 사건 구성 비율로 가중 */
const cell = e => `${e.kr ? 'KR' : 'US'}|${e.tod}`;
const baseBy = {}; BASE.forEach(e => (baseBy[cell(e)] = baseBy[cell(e)] || []).push(e));
const baseCache = {};
const baseHit = (h, key) => (baseCache[key + h] ??= S(baseBy[key] || [], h).hit);
const matched = (xs, h = 15) => { if (!xs.length) return NaN; let s = 0, n = 0; xs.forEach(e => { const b = baseHit(h, cell(e)); if (isFinite(b)) { s += b; n++; } }); return n ? s/n : NaN; };
const row = (lab, xs, o = 'o1') => { const c = HZ.map(h => { const s = S(xs, h, o), b = matched(xs, h); return `${h}분 ${pct(s.hit)}(${isFinite(b) ? sg((s.hit - b)*100, 0) : '—'}) ${sg(s.avg)}`; });
  const s15 = S(xs, 15, o), m = k => med(xs.map(e => e[o] && e[o] !== 'na' ? e[o][k] : NaN));
  return `  ${lab.padEnd(30)} n=${String(xs.length).padStart(6)}(${grade(xs.length)}) ${c.join(' · ')} · 순15 ${sg(s15.avg - COST[0])}/${sg(s15.avg - COST[1])} · PF ${isFinite(s15.pf) ? s15.pf.toFixed(2) : '—'} · MFE/MAE15 ${sg(m('mfe15'), 2)}/${sg(m('mae15'), 2)}`; };
const dates = [...new Set(BASE.map(e => e.day))].sort(), n3 = Math.floor(dates.length/3);
const blk = [new Set(dates.slice(0, n3)), new Set(dates.slice(n3, 2*n3)), new Set(dates.slice(2*n3))];
const inB = (e, bs) => bs.some(b => blk[b].has(e.day));
const US = EV.filter(e => !e.kr), KR = EV.filter(e => e.kr);
console.log(`\n=== 장중 상승 캔들 심층 — ${Object.keys(data).length}종목 · ${dates[0]}~${dates[dates.length-1]} (${dates.length}일) · 괄호 = 같은 시장·시간대 기준선 대비 %p · 진입 다음 5분봉 시가 ===`);
console.log(row('기준선: 모든 5분 시점', BASE)); console.log(row('기존 E(5분 재돌파) 사건', EE));
console.log(row('아무 상승 패턴(1건=1거래)', EV.filter(e => e.pats.length)));
for (const [lab, P] of [['미장', US], ['국장', KR]]){
  console.log(`\n■ [1] 패턴별 — ${lab} (다중 소속: 한 봉이 여러 패턴이면 각 패턴에 들어감)`);
  for (const n of BULL) console.log(row(n, P.filter(e => e.pats.includes(n))));
  console.log(`  — 대표 패턴(1건=1칸, 3봉→2봉→1봉 우선)`);
  for (const n of BULL){ const z = P.filter(e => e.prim === n); if (z.length) console.log(row('대표 ' + n, z)); }
}
console.log('\n■ [2] VWAP 결합 (미장+국장, 봉 시각 기준)');
const dbin = d => d == null ? '—' : d <= 0 ? 'VWAP 위' : d < 0.1 ? '0~0.1%' : d < 0.3 ? '0.1~0.3%' : d < 0.5 ? '0.3~0.5%' : d < 1 ? '0.5~1%' : d < 2 ? '1~2%' : '≥2%';
for (const [lab, f] of [['긴 아랫꼬리(≥0.5)', e => e.lo >= 0.5], ['샛별·십자샛별', e => e.pats.some(n => n === '샛별형' || n === '십자샛별형')], ['상승장악형', e => e.pats.includes('상승장악형')], ['아무 상승 패턴', e => e.pats.length > 0]]){
  const X = EV.filter(f); console.log(`  ${lab} — 저가의 VWAP 아래 깊이별`);
  for (const b of ['VWAP 위', '0~0.1%', '0.1~0.3%', '0.3~0.5%', '0.5~1%', '1~2%', '≥2%']) { const z = X.filter(e => dbin(e.dep) === b); if (z.length) console.log(row('   ' + b, z)); }
}
console.log(row('긴 아랫꼬리 + VWAP 아래 반등(저가<VWAP)', EV.filter(e => e.lo >= 0.5 && e.dep > 0)));
console.log(row('샛별·십자샛별 + VWAP 아래', EV.filter(e => e.pats.some(n => n === '샛별형' || n === '십자샛별형') && e.dep > 0)));
console.log(row('상승장악형 + VWAP 재진입', EV.filter(e => e.pats.includes('상승장악형') && e.reclaim.VWAP)));
console.log('\n■ [3] 추세 맥락 · 시간대 (아무 상승 패턴 / 상승장악형 / 긴 아랫꼬리)');
for (const [lab, f] of [['아무 상승', e => e.pats.length > 0], ['상승장악형', e => e.pats.includes('상승장악형')], ['긴 아랫꼬리', e => e.lo >= 0.5]]){
  for (const tr of ['하락 반전', '상승 눌림목', '그 밖']) console.log(row(`${lab} · ${tr}`, EV.filter(e => f(e) && e.trend === tr)));
  for (const td of ['장초반', '장중', '마감전']) console.log(row(`${lab} · ${td}`, EV.filter(e => f(e) && e.tod === td)));
}
console.log('\n■ [4] 이름 없는 조합: 긴 아랫꼬리 × 거래량 × 지지 회복 (n≥15만)');
const cg = {}; EV.filter(e => e.combo).forEach(e => (cg[e.combo] = cg[e.combo] || []).push(e));
Object.entries(cg).filter(([, z]) => z.length >= 15).sort((a, b) => S(b[1]).hit - S(a[1]).hit).forEach(([k, z]) => console.log(row(k, z)));
console.log('\n■ [5] 종목 분류별 (아무 상승 패턴, n≥100)');
const byc = {}; EV.filter(e => e.pats.length).forEach(e => (byc[e.cat] = byc[e.cat] || []).push(e));
Object.entries(byc).filter(([, z]) => z.length >= 100).sort((a, b) => b[1].length - a[1].length).forEach(([c, z]) => console.log(row(c, z)));
/* ---------- 후보 정의 · 워크포워드 ---------- */
const CANDS = [];
for (const n of BULL) CANDS.push({ lab: n, f: e => e.pats.includes(n) });
for (const tr of ['하락 반전', '상승 눌림목']) for (const n of BULL) CANDS.push({ lab: `${n} · ${tr}`, f: e => e.pats.includes(n) && e.trend === tr });
CANDS.push({ lab: '긴 아랫꼬리 + VWAP 아래', f: e => e.lo >= 0.5 && e.dep > 0 }, { lab: '샛별·십자샛별 + VWAP 아래', f: e => e.pats.some(n => n === '샛별형' || n === '십자샛별형') && e.dep > 0 }, { lab: '상승장악형 + VWAP 재진입', f: e => e.pats.includes('상승장악형') && e.reclaim.VWAP });
for (const k of Object.keys(cg)) CANDS.push({ lab: k, f: e => e.combo === k });
const zOf = (k, n, p) => n ? (k - n*p)/Math.sqrt(n*p*(1 - p) || 1) : 0;
const wf = c => [[1, [0], [1]], [2, [0, 1], [2]]].map(([fi, tr, te]) => {
  const TR = EV.filter(e => inB(e, tr) && c.f(e)), TE = EV.filter(e => inB(e, te) && c.f(e));
  const a = S(TR), b = S(TE), ba = matched(TR), bb = matched(TE);
  const baseAvgTE = (() => { const z = BASE.filter(e => inB(e, te)); return S(z).avg; })();
  const sel = a.n >= 30 && a.hit - ba >= 0.03 && zOf(Math.round(a.hit*a.n), a.n, ba) >= 2;
  const ok = sel && b.n >= 20 && b.hit - bb >= 0.02 && b.avg - COST[0] > baseAvgTE - COST[0];
  return { fi, sel, ok, a, b, ba, bb };
});
console.log(`\n■ [6] 워크포워드 — 후보 ${CANDS.length}개 (|z|≥2 우연 기대 ≈ ${(CANDS.length*0.023).toFixed(1)}개, 한쪽 검정)`);
let s1 = 0; const res = CANDS.map(c => ({ c, w: wf(c) })); res.forEach(x => s1 += x.w[0].sel ? 1 : 0);
console.log(`  1차 학습 선택 ${s1}개 · 두 번 선택 ${res.filter(x => x.w.every(y => y.sel)).length}개 · 두 검증 통과 ${res.filter(x => x.w.every(y => y.ok)).length}개`);
for (const x of res.filter(x => x.w.some(y => y.sel))) console.log(`   ${x.w.every(y => y.ok) ? '✅' : '❌'} ${x.c.lab.padEnd(34)} ` + x.w.map(y => `${y.fi}차 학습 n${y.a.n} ${pct(y.a.hit)}(기준 ${pct(y.ba)}) ${y.sel ? '선택' : '미선택'} → 검증 n${y.b.n} ${pct(y.b.hit)}(기준 ${pct(y.bb)}) 순${sg(y.b.avg - COST[0])} ${y.ok ? '통과' : '실패'}`).join(' | '));
console.log('\n■ [7] 연구 후보 — 전체 기간 +15분 상승 ≥61% · n≥15 (매수 판정 아님)');
const cand = res.filter(x => { const s = S(EV.filter(x.c.f)); return s.n >= 15 && s.hit >= 0.61; });
if (!cand.length) console.log('  해당 없음');
for (const x of cand){ const z = EV.filter(x.c.f), s5 = S(z, 5), s15 = S(z), s30 = S(z, 30), us = S(z.filter(e => !e.kr)), kr = S(z.filter(e => e.kr));
  const half = [S(z.filter(e => inB(e, [0]))), S(z.filter(e => inB(e, [1]))), S(z.filter(e => inB(e, [2])))];
  console.log(`  ⭐후보 ${x.c.lab} · n=${z.length}(${grade(z.length)}) · 종목 ${new Set(z.map(e => e.t)).size} · 5분 ${pct(s5.hit)} · 15분 ${pct(s15.hit)} (기준 ${pct(matched(z))}) ${sg(s15.avg)}% · 순 ${sg(s15.avg - COST[0])}/${sg(s15.avg - COST[1])} · PF ${isFinite(s15.pf) ? s15.pf.toFixed(2) : '—'} · 30분 ${pct(s30.hit)} ${sg(s30.avg)} · 블록 ${half.map(h => pct(h.hit) + ' n' + h.n).join(' / ')} · 미장 ${pct(us.hit)} n${us.n} · 국장 ${pct(kr.hit)} n${kr.n} · ${x.w.every(y => y.ok) ? '✅ 검증 통과' : '❌ 미검증 연구 후보'}`); }
console.log('\n■ [8] 국장 ① 봉 시각 vs ② +20분 (아무 상승 패턴 · 상승장악형 · 긴 아랫꼬리)');
for (const [lab, f] of [['아무 상승', e => e.pats.length > 0], ['상승장악형', e => e.pats.includes('상승장악형')], ['긴 아랫꼬리', e => e.lo >= 0.5]]){
  const K = KR.filter(f); console.log(row(`${lab} ①`, K, 'o1')); console.log(row(`${lab} ②+20분`, K.filter(e => e.o2 !== 'na'), 'o2')); }
