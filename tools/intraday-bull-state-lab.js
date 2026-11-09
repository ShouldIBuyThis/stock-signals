/**
 * 장중 상승 ⭐ 후보 탐색 2차 — docs/2026-11-09-intraday-bull-state.md (결과 전 고정).
 * 화면 함수 idStarEvents()에 사전 등록된 84칸 후보표를 넣어 60일 모든 종목·날짜(그날 5일 창)로 돌린다.
 * 사용: node tools/intraday-bull-state-lab.js i5.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
vm.createContext(ctx);
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat','idStarEvents'].map(H.extractFunction).join('\n') + '\nthis.SE = idStarEvents; this.mtf = idMtf;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const STATES = ['go', 'wait', 'pull', 'up', 'flat', 'down'];
const PATS = ['망치형', '역망치형', '잠자리 도지', '양봉 마루보주', '장대양봉', '일반 양봉', '상승장악형', '상승잉태형', '관통형', '집게바닥', '샛별형', '적삼병', '상승 확인 잉태(3봉)'];
const C = [];
for (const st of STATES) for (const p of PATS) C.push({ key: `${p} + ${st} 새 진입`, pat: p, dir: 'up', when: st, newState: true, match: 'primary' });
for (const p of ['상승장악형', '망치형', '샛별형']) C.push({ key: `${p} + VWAP 아래 저가`, pat: p, dir: 'up', when: null, match: 'primary', vwap: 'below' });
C.push({ key: '긴 아랫꼬리 양봉 + VWAP 아래 저가', pat: '긴 아랫꼬리 양봉', dir: 'up', when: null, match: 'names', vwap: 'below' });
C.push({ key: '긴 아랫꼬리 양봉 + 30분 상승', pat: '긴 아랫꼬리 양봉', dir: 'up', when: null, match: 'names', tr30: 'up' });
C.push({ key: '긴 아랫꼬리 양봉 + 30분 하락', pat: '긴 아랫꼬리 양봉', dir: 'up', when: null, match: 'names', tr30: 'down' });
const ROWS = [], BASE = [];
for (const [t, D] of Object.entries(data)){
  const kr = /\.(KS|KQ)$/.test(t);
  const days = []; let cur = null;
  for (const b of D.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off:b[6], bars:[] }; days.push(cur); } cur.bars.push(b); }
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300;
    const d = { tz: kr ? 'Asia/Seoul' : 'America/New_York', gmtoffset: today.off, reg:{ start:t0, end }, lastTrade: end, price: B[B.length-1][4],
      bars: days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6))).concat(B.map(b => b.slice(0, 6))) };
    const res = k0 => { if (k0 < 0 || k0 >= B.length) return null; const e = B[k0][1], r = {}; for (const h of [5, 15, 30]){ const i = k0 + h/5 - 1; r[h] = i < B.length ? (B[i][4]/e - 1)*100 : null; } return r; };
    for (let k = 1; k < B.length; k += 3) BASE.push({ kr, day: today.day, r1: res(k) });
    for (const ev of ctx.SE(d, end, C)){
      const k1 = B.findIndex(b => b[0] >= ev.ts + 300); if (k1 < 0) continue;
      const k2 = kr ? B.findIndex(b => b[0] >= ev.ts + 300 + 1200) : -1;
      ROWS.push({ t, kr, day: today.day, keys: ev.items.map(c => c.key), r1: res(k1), r2: kr ? res(k2) : null });
    }
  }
}
const dates = [...new Set(BASE.map(e => e.day))].sort(), n3 = Math.floor(dates.length/3);
const blk = [new Set(dates.slice(0, n3)), new Set(dates.slice(n3, 2*n3)), new Set(dates.slice(2*n3))];
const inB = (e, bs) => bs.some(b => blk[b].has(e.day));
const S = (xs, h = 15, k = 'r1') => { const z = xs.map(e => e[k] && e[k][h]).filter(v => v != null); const g = z.filter(v => v > 0), l = z.filter(v => v < 0);
  return { n: z.length, hit: z.length ? g.length/z.length : NaN, avg: z.length ? z.reduce((a, b) => a + b, 0)/z.length : NaN, pf: l.length ? g.reduce((a, b) => a + b, 0)/-l.reduce((a, b) => a + b, 0) : NaN }; };
const pct = x => isFinite(x) ? (x*100).toFixed(0) + '%' : '—', sg = x => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '—';
const bAll = S(BASE), bUS = S(BASE.filter(e => !e.kr)), bKR = S(BASE.filter(e => e.kr));
console.log(`\n=== 상승 ⭐ 후보 탐색 2차 — ${Object.keys(data).length}종목 · ${dates[0]}~${dates[dates.length-1]} · 84칸 · 화면 함수 idStarEvents() 그대로 ===`);
console.log(`  기준선 +15분 상승: 전체 ${pct(bAll.hit)} · 미장 ${pct(bUS.hit)} · 국장 ${pct(bKR.hit)} · 상승 사건(1봉=1거래) ${ROWS.length}건`);
const out = C.map(c => { const z = ROWS.filter(e => e.keys.includes(c.key)), s = S(z);
  const wf = [[[0], [1]], [[0, 1], [2]]].map(([tr, te]) => { const a = S(z.filter(e => inB(e, tr))), b = S(z.filter(e => inB(e, te))), bb = S(BASE.filter(e => inB(e, te)));
    return { sel: a.n >= 15 && a.hit >= 0.61, ok: a.n >= 15 && a.hit >= 0.61 && b.n >= 10 && b.hit >= 0.55 && b.hit - bb.hit >= 0.03, a, b }; });
  return { c, z, s, wf }; });
console.log('\n  ■ 15건 이상 칸 — +15분 상승 적중 높은 순 (상위 20)');
out.filter(o => o.s.n >= 15).sort((a, b) => b.s.hit - a.s.hit).slice(0, 20).forEach(o => {
  const us = S(o.z.filter(e => !e.kr)), kr = S(o.z.filter(e => e.kr)), kr2 = S(o.z.filter(e => e.kr), 15, 'r2');
  console.log(`  ${o.s.hit >= 0.61 ? '★' : ' '} ${o.c.key.padEnd(30)} n${String(o.s.n).padStart(5)} · 5분 ${pct(S(o.z, 5).hit)} · 15분 ${pct(o.s.hit)} ${sg(o.s.avg)}% · 30분 ${pct(S(o.z, 30).hit)} · 순15 ${sg(o.s.avg - 0.05)} · PF ${isFinite(o.s.pf) ? o.s.pf.toFixed(2) : '—'} | 미장 ${pct(us.hit)} n${us.n} · 국장 ① ${pct(kr.hit)} n${kr.n} ② ${pct(kr2.hit)} n${kr2.n} | WF ${o.wf.map(w => (w.sel ? '선택' : '미선택') + '→' + (w.ok ? '통과' : '실패') + `(학습 n${w.a.n} ${pct(w.a.hit)} · 검증 n${w.b.n} ${pct(w.b.hit)})`).join(' / ')}`); });
const cands = out.filter(o => o.s.n >= 15 && o.s.hit >= 0.61), pass = cands.filter(o => o.wf.every(w => w.ok));
const n15 = out.filter(o => o.s.n >= 15).length;
console.log(`\n  15건 이상 칸 ${n15}개 중 61% 이상 ${cands.length}개 · 그중 워크포워드 두 번 통과 ${pass.length}개`);
console.log(`  15건 미만이라 판단 불가 칸 ${out.filter(o => o.s.n < 15).length}개`);

/* 2026-11-09 추가(결과 확인 뒤 '보고 항목'만 늘림 · 칸·기준·숫자 불변): 61% 이상 칸의 상세 — 사용자 요청 항목
   +5·+15분 평균과 비용 차감 순수익, 블록·반쪽별, 같은 상태 이웃 캔들·같은 캔들 다른 상태(§3 고원/절벽), 종목·날짜 쏠림,
   그리고 기준선만으로 우연히 61%를 넘을 기대 칸 수(이항). */
const binTail = (n, k, p) => { let s = 0, c = 1; for (let i = 0; i <= n; i++){ if (i > 0) c = c*(n - i + 1)/i; if (i >= k) s += c*Math.pow(p, i)*Math.pow(1 - p, n - i); } return s; };
const exp61 = out.filter(o => o.s.n >= 15).reduce((a, o) => a + binTail(o.s.n, Math.ceil(0.61*o.s.n), bAll.hit), 0);
console.log(`  기준선(${pct(bAll.hit)})만으로 15건 이상 칸 ${n15}개 중 우연히 61% 이상이 나올 기대 개수 ≈ ${exp61.toFixed(2)}개`);
for (const o of cands){
  const [st, pat] = [o.c.when, o.c.pat], s5 = S(o.z, 5);
  console.log(`\n  ◆ ${o.c.key} 상세`);
  console.log(`    +5분: 상승 ${pct(s5.hit)} · 평균 ${sg(s5.avg)}% · 순(0.05%) ${sg(s5.avg - 0.05)}% · 순(0.10%) ${sg(s5.avg - 0.10)}%`);
  console.log(`    +15분: 상승 ${pct(o.s.hit)} · 평균 ${sg(o.s.avg)}% · 순(0.05%) ${sg(o.s.avg - 0.05)}% · 순(0.10%) ${sg(o.s.avg - 0.10)}% · 이 n에서 우연히 이 이상 나올 확률 ${(binTail(o.s.n, Math.round(o.s.hit*o.s.n), bAll.hit)*100).toFixed(1)}%`);
  [0, 1, 2].forEach(b => { const x = S(o.z.filter(e => inB(e, [b]))), bb = S(BASE.filter(e => inB(e, [b]))); console.log(`    블록${b + 1}: n${x.n} ${pct(x.hit)} ${sg(x.avg)}% (같은 기간 기준선 ${pct(bb.hit)})`); });
  const half = new Set(dates.slice(0, dates.length >> 1)), h1 = S(o.z.filter(e => half.has(e.day))), h2 = S(o.z.filter(e => !half.has(e.day)));
  console.log(`    반쪽: 앞 n${h1.n} ${pct(h1.hit)} ${sg(h1.avg)}% · 뒤 n${h2.n} ${pct(h2.hit)} ${sg(h2.avg)}%`);
  const tk = {}; o.z.forEach(e => tk[e.t] = (tk[e.t] || 0) + 1); const top = Object.entries(tk).sort((a, b) => b[1] - a[1]);
  console.log(`    쏠림: ${top.length}종목 · ${new Set(o.z.map(e => e.day)).size}거래일 · 많은 종목 ${top.slice(0, 5).map(([t, n]) => t + ' ' + n).join(', ')}`);
  console.log(`    같은 캔들 다른 상태: ${out.filter(x => x.c.pat === pat && x.c.when && x !== o && !x.c.vwap && !x.c.tr30).map(x => `${x.c.when} ${pct(x.s.hit)} n${x.s.n}`).join(' · ')}`);
  console.log(`    같은 상태 다른 캔들: ${out.filter(x => x.c.when === st && x.c.pat !== pat && !x.c.vwap && !x.c.tr30).map(x => `${x.c.pat} ${pct(x.s.hit)} n${x.s.n}`).join(' · ')}`);
}
