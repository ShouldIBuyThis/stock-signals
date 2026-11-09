/**
 * 장중 5분봉 캔들 패턴 광범위 연구 — docs/2026-11-09-intraday-candle-wide.md (결과 전 고정).
 * idMtf()·idCandleFeat()는 index.html에서 추출(재구현 금지). 사용: node tools/intraday-candle-wide-lab.js i5.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
vm.createContext(ctx);
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat'].map(H.extractFunction).join('\n') + '\nthis.idMtf = idMtf; this.feat = idCandleFeat;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const HZ = [5, 15, 30, 60], POP = { go: [], down: [], E: [] }, COST = [0.05, 0.10];
const outcome = (B, k, side) => {           // B[k]부터 진입(시가)
  if (k >= B.length) return null;
  const fut = B.slice(k), e = fut[0][1], r = {};
  for (const h of HZ){ const n = h/5; r[h] = fut.length >= n ? side*(fut[n-1][4]/e - 1)*100 : null; }
  const win = n => { const w = fut.slice(0, n); const hi = Math.max(...w.map(b => b[2])), lo = Math.min(...w.map(b => b[3]));
    return side > 0 ? [(hi/e - 1)*100, (lo/e - 1)*100] : [(1 - lo/e)*100, (1 - hi/e)*100]; };
  const [mfe15, mae15] = win(3), [mfe60, mae60] = win(12);
  return { r, mfe15, mae15, mfe60, mae60 };
};
for (const [t, D] of Object.entries(data)){
  const kr = /\.(KS|KQ)$/.test(t);
  const days = []; let cur = null;
  for (const b of D.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off:b[6], bars:[] }; days.push(cur); } cur.bars.push(b); }
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300;
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    let prev = null;
    for (let k = 1; k < B.length; k++){
      const tau = B[k][0];
      const A = ctx.idMtf({ gmtoffset: today.off, reg:{ start:t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k).map(b => b.slice(0, 6))) }, tau);
      if (!A) continue;
      const L = A.tf[5].filter(r => r.done).pop();
      const isE = !!A.E.bars.find(z => z.ts === L.ts), newGo = A.state === 'go' && prev !== 'go', newDown = A.state === 'down' && prev !== 'down';
      prev = A.state;
      if (!isE && !newGo && !newDown) continue;
      const F = ctx.feat(A, L); if (!F) continue;
      const mk = side => { const o1 = outcome(B, k, side); if (!o1) return null;
        const k2 = B.findIndex(b => b[0] === tau + 1200);
        return { t, kr, day: today.day, F, o1, o2: kr ? (k2 >= 0 ? outcome(B, k2, side) : 'na') : null, tod: B[k][0] - t0 < 3600 ? '장초반' : end - B[k][0] <= 3600 ? '마감전' : '장중' }; };
      if (newGo){ const x = mk(1); if (x) POP.go.push(x); }
      if (newDown){ const x = mk(-1); if (x) POP.down.push(x); }
      if (isE){ const x = mk(1); if (x) POP.E.push(x); }
    }
  }
}
/* ---------- 후보 필터 ---------- */
const bin = (v, cuts, labs) => v == null ? null : labs[cuts.findIndex(c => v < c) < 0 ? labs.length-1 : cuts.findIndex(c => v < c)];
const CAND = [];
const addCat = (name, get) => CAND.push({ name, get });
addCat('대표패턴', e => e.F.primary); addCat('1봉형태', e => e.F.single);
addCat('몸통', e => bin(e.F.f.body, [0.3, 0.6], ['<0.3','0.3~0.6','≥0.6']));
addCat('윗꼬리', e => bin(e.F.f.upper, [0.15, 0.4], ['<0.15','0.15~0.4','≥0.4']));
addCat('아랫꼬리', e => bin(e.F.f.lower, [0.15, 0.4], ['<0.15','0.15~0.4','≥0.4']));
addCat('종가위치CLV', e => bin(e.F.f.clv, [0.33, 0.67], ['하단','중간','상단']));
addCat('연속봉', e => bin(e.F.f.consec, [-2, 0, 1, 3], ['음봉3+','음봉1~2','보합','양봉1~2','양봉3+']));
addCat('갭', e => bin(e.F.f.gap, [-0.2, 0.2], ['아래','없음','위']));
addCat('거래량배수', e => bin(e.F.f.vr, [1, 2], ['<1','1~2','≥2']));
addCat('범위배수', e => bin(e.F.f.rngMult, [1, 1.5], ['<1','1~1.5','≥1.5']));
addCat('VWAP위치', e => bin(e.F.f.vwap, [-1, 0, 1], ['아래 멀리','아래','위','위 멀리']));
addCat('EMA', e => e.F.f.ema); addCat('당일시가', e => e.F.f.open);
addCat('저항거리ATR', e => e.F.f.toR == null ? '저항 없음' : bin(e.F.f.toR, [0.5, 1.5], ['<0.5','0.5~1.5','≥1.5']));
addCat('지지거리ATR', e => e.F.f.toS == null ? '지지 없음' : bin(e.F.f.toS, [0.5, 1.5], ['<0.5','0.5~1.5','≥1.5']));
addCat('15분추세', e => e.F.f.tr15); addCat('30분추세', e => e.F.f.tr30); addCat('직전30분', e => e.F.f.into);
/* ---------- 통계 ---------- */
const hitOf = (xs, h, o = 'o1') => { const z = xs.map(e => e[o] && e[o] !== 'na' ? e[o].r[h] : null).filter(v => v != null); return { n: z.length, hit: z.length ? z.filter(v => v > 0).length/z.length : NaN, avg: z.length ? z.reduce((a, b) => a + b, 0)/z.length : NaN }; };
const med = a => { const s = a.filter(x => isFinite(x)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const grade = n => n >= 50 ? '사용' : n >= 30 ? '방향' : n >= 15 ? '참고' : '불가';
const pct = x => isFinite(x) ? (x*100).toFixed(0) + '%' : '—', sg = (x, d = 3) => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : '—';
const fmtRow = (lab, xs, ref, o = 'o1') => {
  const c = HZ.map(h => { const s = hitOf(xs, h, o), r = ref ? hitOf(ref, h, o) : null; return `${h}분 ${pct(s.hit)}${r ? `(${sg((s.hit - r.hit)*100, 0)})` : ''} ${sg(s.avg)}`; });
  const m = k => med(xs.map(e => e[o] && e[o] !== 'na' ? e[o][k] : NaN));
  return `  ${lab.padEnd(20)} n=${String(xs.length).padStart(5)}(${grade(xs.length)}) ${c.join(' · ')} · MFE/MAE15 ${sg(m('mfe15'), 2)}/${sg(m('mae15'), 2)} · 60 ${sg(m('mfe60'), 2)}/${sg(m('mae60'), 2)}`;
};
const dates = [...new Set(POP.E.concat(POP.down).map(e => e.day))].sort(), n3 = Math.floor(dates.length/3);
const blk = [dates.slice(0, n3), dates.slice(n3, 2*n3), dates.slice(2*n3)].map(a => new Set(a));
const inB = (e, bs) => bs.some(b => blk[b].has(e.day));
console.log(`\n=== 장중 5분봉 캔들 패턴 광범위 연구 — ${Object.keys(data).length}종목 · ${dates[0]}~${dates[dates.length-1]} (${dates.length}일) ===`);
console.log('진입=다음 5분봉 시가 · 괄호=같은 신호 전체 대비 적중률 %p · 수익률은 신호 방향 기준(하락 주의는 하락=+) · 비용 미반영(워크포워드에서 반영)');
for (const [pk, lab] of [['go','🟢 5분 재돌파 확인(새 진입)'], ['down','🔵 하락 주의(새 진입)'], ['E','보조: 5분 진입 조건 충족 봉(추세 무관)']]){
  const P = POP[pk];
  console.log(`\n■ ${lab}`); console.log(fmtRow('신호 전체', P, null));
  for (const cat of ['대표패턴', '1봉형태']){
    const C = CAND.find(c => c.name === cat), g = {};
    P.forEach(e => { const v = C.get(e); if (v != null) (g[v] = g[v] || []).push(e); });
    console.log(`  [${cat}] — 한 사건은 한 칸에만`);
    Object.entries(g).sort((a, b) => b[1].length - a[1].length).forEach(([v, xs]) => console.log(fmtRow(v, xs, P)));
  }
}
/* ---------- 워크포워드 ---------- */
const WF = {};
const zOf = (k, n, p) => n ? (k - n*p)/Math.sqrt(n*p*(1 - p) || 1) : 0;
const avgNet = (xs, c) => { const s = hitOf(xs, 15); return s.avg - c; };
for (const [pk, lab] of [['go','🟢 5분 재돌파 확인'], ['down','🔵 하락 주의'], ['E','보조: E 충족 봉']]){
  const P = POP[pk]; let tested = 0; const res = {}; WF[pk] = res;
  for (const [fi, tr, te] of [[1, [0], [1]], [2, [0, 1], [2]]]){
    const TR = P.filter(e => inB(e, tr)), TE = P.filter(e => inB(e, te)), bT = hitOf(TR, 15), bV = hitOf(TE, 15);
    for (const C of CAND){
      const vals = [...new Set(P.map(C.get).filter(v => v != null))];
      for (const v of vals){
        tested += fi === 1 ? 1 : 0;
        const key = `${C.name}=${v}`, xs = TR.filter(e => C.get(e) === v), s = hitOf(xs, 15);
        const lift = s.hit - bT.hit, z = zOf(Math.round(s.hit*s.n), s.n, bT.hit);
        const sel = s.n >= 30 && Math.abs(z) >= 2 && Math.abs(lift) >= 0.03 ? Math.sign(lift) : 0;
        const ys = TE.filter(e => C.get(e) === v), sv = hitOf(ys, 15), lv = sv.hit - bV.hit;
        const ok = sel !== 0 && sv.n >= 20 && Math.sign(lv) === sel && Math.abs(lv) >= 0.02 && Math.sign(sv.avg - bV.avg) === sel;
        (res[key] = res[key] || []).push({ fi, sel, ok, trn: s.n, trl: lift, z, ten: sv.n, tel: lv, teAvg: sv.avg, base: bV, xs: ys, TE });
      }
    }
  }
  const sel1 = Object.values(res).filter(a => a[0] && a[0].sel !== 0).length;
  console.log(`\n■ 워크포워드 — ${lab}: 후보 ${tested}개 · 1차 학습에서 뽑힌 것 ${sel1}개 (우연 기대 ≈ ${(tested*0.046).toFixed(1)}개)`);
  const pass = Object.entries(res).filter(([, a]) => a.length === 2 && a.every(x => x.ok));
  const sel2 = Object.entries(res).filter(([, a]) => a.length === 2 && a.every(x => x.sel !== 0));
  console.log(`  두 번 모두 학습 선택 ${sel2.length}개 → 두 검증 모두 통과 ${pass.length}개`);
  for (const [k, a] of sel2){
    console.log(`   ${a.every(x => x.ok) ? '✅' : '❌'} ${k.padEnd(26)} ${a[0].sel > 0 ? '포함' : '제외'} · ` + a.map(x => `${x.fi}차 학습 n${x.trn} ${sg(x.trl*100, 1)}%p z${x.z.toFixed(1)} → 검증 n${x.ten} ${sg(x.tel*100, 1)}%p`).join(' | '));
  }
  for (const [k, a] of pass){
    const x = a[1], sel = a[0].sel, kept = sel > 0 ? x.xs : x.TE.filter(e => !x.xs.includes(e));
    const before = hitOf(x.TE, 15), after = hitOf(kept, 15), b5 = hitOf(x.TE, 5), a5 = hitOf(kept, 5);
    console.log(`   ▶ ${k} ${sel > 0 ? '만 남김' : '빼고'} (블록3 검증): 신호 단독 n${before.n} 15분 ${pct(before.hit)} 평균 ${sg(before.avg)}% → 결합 n${after.n} ${pct(after.hit)} ${sg(after.avg)}% · 5분 ${pct(b5.hit)}→${pct(a5.hit)} · 비용 차감 ${COST.map(c => `${sg(before.avg - c)}→${sg(after.avg - c)}`).join(' / ')}%`);
  }
}
/* ---------- 국장 지연 ---------- */
console.log('\n■ 국장: ① 봉 시각 vs ② +20분 확인 시각 (전체 기간)');
for (const [pk, lab] of [['go','🟢 재돌파'], ['down','🔵 하락 주의'], ['E','E 충족']]){
  const K = POP[pk].filter(e => e.kr);
  console.log(fmtRow(`${lab} ①`, K, null, 'o1')); console.log(fmtRow(`${lab} ②+20분`, K.filter(e => e.o2 !== 'na'), null, 'o2'));
  console.log(`  ${''.padEnd(20)} ②에서 장 종료로 미평가 ${K.filter(e => e.o2 === 'na').length}건`);
}

/* ---------- [7] 연구 후보 (15분 ≥60% · n≥15) — docs §7 ---------- */
const LAB = { go:'🟢 재돌파', down:'🔵 하락 주의', E:'E 충족' };
const pfOf = (xs, h) => { const z = xs.map(e => e.o1.r[h]).filter(v => v != null); const g = z.filter(v => v > 0).reduce((a, b) => a + b, 0), l = -z.filter(v => v < 0).reduce((a, b) => a + b, 0); return l ? g/l : (g ? Infinity : NaN); };
const half = (xs, h) => { const a = hitOf(xs.filter(e => e.day < mid2), 15), b = hitOf(xs.filter(e => e.day >= mid2), 15); return `앞 ${pct(a.hit)} n${a.n} / 뒤 ${pct(b.hit)} n${b.n}`; };
const mid2 = dates[Math.floor(dates.length/2)];
const wfTxt = (pk, key) => { const a = (WF[pk] || {})[key]; if (!a) return '워크포워드 대상 아님';
  return a.map(x => `${x.fi}차 학습 n${x.trn} ${sg(x.trl*100, 1)}%p ${x.sel ? '선택' : '미선택'} → 검증 n${x.ten} ${sg(x.tel*100, 1)}%p ${x.ok ? '통과' : '실패'}`).join(' | '); };
console.log('\n■ [7] 연구 후보 — 15분 적중 ≥60% · n≥15 (매매 추천 아님 · 검증 실패·표본 부족 표시)');
const CANDS = [];
for (const pk of ['go', 'down', 'E']) for (const cat of ['대표패턴', '1봉형태']){
  const C = CAND.find(c => c.name === cat), g = {};
  POP[pk].forEach(e => { const v = C.get(e); if (v != null) (g[v] = g[v] || []).push(e); });
  for (const [v, xs] of Object.entries(g)){ const s15 = hitOf(xs, 15); if (s15.n >= 15 && s15.hit >= 0.6) CANDS.push({ pk, cat, v, xs }); }
}
if (!CANDS.length) console.log('  해당 없음');
for (const c of CANDS){
  const s5 = hitOf(c.xs, 5), s15 = hitOf(c.xs, 15), s30 = hitOf(c.xs, 30), s60 = hitOf(c.xs, 60), base = hitOf(POP[c.pk], 15);
  const a = WF[c.pk] && WF[c.pk][`${c.cat}=${c.v}`], ver = a ? (a.every(x => x.ok) ? '✅ 검증 통과' : a.some(x => x.sel) ? '❌ 학습 선택됐으나 검증 실패' : '❌ 학습 선택 안 됨(기준 미달)') : '—';
  console.log(`  ${LAB[c.pk]} · ${c.cat} ${c.v} · 방향 ${c.pk === 'down' ? '하락(매도 쪽)' : '상승(매수 쪽)'} · n=${c.xs.length}(${grade(c.xs.length)}) · 종목 ${new Set(c.xs.map(e => e.t)).size} · 날짜 ${new Set(c.xs.map(e => e.day)).size}`);
  console.log(`     5분 ${pct(s5.hit)} ${sg(s5.avg)}% · 15분 ${pct(s15.hit)} ${sg(s15.avg)}% (신호 전체 ${pct(base.hit)}) · 순 ${sg(s15.avg - COST[0])}/${sg(s15.avg - COST[1])}% · PF ${isFinite(pfOf(c.xs, 15)) ? pfOf(c.xs, 15).toFixed(2) : '—'} · 30분 ${pct(s30.hit)} · 60분 ${pct(s60.hit)} · 반쪽 ${half(c.xs)}`);
  console.log(`     ${ver} · ${wfTxt(c.pk, `${c.cat}=${c.v}`)}`);
}
/* ---------- [8] 잠자리 도지 + 하락 주의 심층 — docs §7 H1~H5 ---------- */
console.log('\n■ [8] 잠자리 도지 + 하락 주의 심층');
const DN = POP.down;
for (const [lab, xs] of [['대표패턴=잠자리 도지', DN.filter(e => e.F.primary === '잠자리 도지')], ['1봉형태=잠자리 도지', DN.filter(e => e.F.single === '잠자리 도지')]]){
  const s = hitOf(xs, 15); console.log(`  ${lab} n=${xs.length} 15분 ${pct(s.hit)} ${sg(s.avg)}%`);
  const byT = {}; xs.forEach(e => byT[e.t] = (byT[e.t] || 0) + 1); const top = Object.entries(byT).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const byD = {}; xs.forEach(e => byD[e.day] = (byD[e.day] || 0) + 1); const maxDay = Math.max(...Object.values(byD));
  console.log(`   H1 집중: 종목 ${Object.keys(byT).length}개 · 상위3 ${top.map(([t, n]) => `${t} ${n}`).join(', ')} (${pct(top.reduce((a, [, n]) => a + n, 0)/xs.length)}) · 날짜 ${Object.keys(byD).length}일 · 같은 날 최대 ${maxDay}건 · 국장 ${xs.filter(e => e.kr).length}건`);
  const grp = (key, vals, get) => vals.map(v => { const z = xs.filter(e => (get ? get(e) : e[key]) === v), h = hitOf(z, 15); return `${v} ${pct(h.hit)} n${h.n}`; }).join(' · ');
  console.log(`   H2 시간대: ${grp('tod', ['장초반', '장중', '마감전'])}`);
  console.log(`   H3 위치: VWAP ${grp(null, ['아래 멀리', '아래', '위', '위 멀리'], e => bin(e.F.f.vwap, [-1, 0, 1], ['아래 멀리', '아래', '위', '위 멀리']))} · 30분 ${grp(null, ['up', 'flat', 'down'], e => e.F.f.tr30)} · 15분 ${grp(null, ['up', 'down'], e => e.F.f.tr15)} · 직전30분 ${grp(null, ['up', 'flat', 'down'], e => e.F.f.into)}`);
  console.log(`   H4 블록: ${[0, 1, 2].map(b => { const h = hitOf(xs.filter(e => blk[b].has(e.day)), 15); return `블록${b+1} ${pct(h.hit)} n${h.n}`; }).join(' · ')} · 미장/국장 ${grp(null, [false, true], e => e.kr)}`);
  const m = k => med(xs.map(e => e.o1[k])); console.log(`   경로: 5분 ${pct(hitOf(xs, 5).hit)} · 15분 ${pct(s.hit)} · 30분 ${pct(hitOf(xs, 30).hit)} · 60분 ${pct(hitOf(xs, 60).hit)} · MFE/MAE15 ${sg(m('mfe15'), 2)}/${sg(m('mae15'), 2)} · 60 ${sg(m('mfe60'), 2)}/${sg(m('mae60'), 2)}`);
}
console.log('   H5 비교(하락 주의 1봉형태): ' + ['잠자리 도지', '망치형', '도지', '장족 도지', '비석 도지', '일반 음봉'].map(v => { const h = hitOf(DN.filter(e => e.F.single === v), 15); return `${v} ${pct(h.hit)} n${h.n}`; }).join(' · '));
console.log('   같은 모양, 다른 신호: ' + ['go', 'E'].map(pk => { const h = hitOf(POP[pk].filter(e => e.F.single === '잠자리 도지'), 15); return `${LAB[pk]} ${pct(h.hit)} n${h.n}`; }).join(' · '));
