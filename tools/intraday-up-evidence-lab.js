/**
 * ⭐ 종합 상승 근거 연구 — docs/2026-11-10-up-evidence.md (결과 전 고정 · 28칸).
 * 탐지는 index.html의 idUpEvents()/idUpEvidence()를 문자열로 추출해서만 한다(재구현 금지). 사용: node tools/intraday-up-evidence-lab.js i5.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite });
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat','idUpEvidence','idUpEvents'].map(H.extractFunction).join('\n') + '\nthis.UE = idUpEvents;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const A_CANDS = [{ pat: '장대양봉', dir: 'up', when: 'down', newState: true, match: 'primary' }, { pat: '역망치형', dir: 'up', when: 'wait', newState: true, match: 'primary' }];
const HZ = [5, 15, 30, 60], COST = 0.05, EV = [], BASE = []; let tkDays = 0, barsAll = 0;
for (const [t, D] of Object.entries(data)){
  const kr = /\.(KS|KQ)$/.test(t);
  const days = []; let cur = null;
  for (const b of D.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); } cur.bars.push(b); }
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300; tkDays++; barsAll += B.length;
    const d = { tz: kr ? 'Asia/Seoul' : 'America/New_York', gmtoffset: today.off, reg: { start: t0, end }, lastTrade: end, price: B[B.length-1][4],
      bars: days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6))).concat(B.map(b => b.slice(0, 6))) };
    const res = k0 => { if (k0 < 0 || k0 >= B.length) return null; const e = B[k0][1], r = {}; for (const h of HZ){ const i = k0 + h/5 - 1; r[h] = i < B.length ? (B[i][4]/e - 1)*100 : null; } return r; };
    for (let k = 1; k < B.length; k += 3) BASE.push({ kr, day: today.day, r1: res(k), r2: kr ? res(B.findIndex(b => b[0] >= B[k-1][0] + 300 + 1200)) : null });
    for (const ev of ctx.UE(d, end, A_CANDS)){
      const k1 = B.findIndex(b => b[0] >= ev.ts + 300); if (k1 < 0) continue;
      const k2 = kr ? B.findIndex(b => b[0] >= ev.ts + 300 + 1200) : -1, mins = (ev.ts - t0)/60, left = (end - ev.ts)/60;
      EV.push({ t, kr, day: today.day, keys: ev.ev.map(e => e.k), fams: ev.fams, winKeys: ev.winKeys, winFams: ev.winFams, first: ev.first, epi: `${t}|${today.day}|${ev.epi}`,
        tod: mins < 60 ? '초반' : left <= 65 ? '마감전' : '장중', r1: res(k1), r2: kr ? res(k2) : null });
    }
  }
}
const dates = [...new Set(BASE.map(e => e.day))].sort(), n3 = Math.floor(dates.length/3);
const blk = [new Set(dates.slice(0, n3)), new Set(dates.slice(n3, 2*n3)), new Set(dates.slice(2*n3))], half = new Set(dates.slice(0, dates.length >> 1));
const inB = (e, bs) => bs.some(b => blk[b].has(e.day));
const S = (xs, h = 15, k = 'r1') => { const z = xs.map(e => e[k] && e[k][h]).filter(v => v != null), g = z.filter(v => v > 0), l = z.filter(v => v < 0);
  return { n: z.length, hit: z.length ? g.length/z.length : NaN, avg: z.length ? z.reduce((a, b) => a + b, 0)/z.length : NaN, pf: l.length ? g.reduce((a, b) => a + b, 0)/-l.reduce((a, b) => a + b, 0) : NaN }; };
const pc = x => isFinite(x) ? Math.round(x*100) + '%' : '—', sg = x => isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(3) : '—';
const binTail = (n, k, p) => { let s = 0, lc = 0; for (let i = 0; i <= n; i++){ if (i > 0) lc += Math.log(n - i + 1) - Math.log(i); if (i >= k) s += Math.exp(lc + i*Math.log(p) + (n - i)*Math.log(1 - p)); } return s; };
const has = (e, ks) => ks.some(k => e.keys.includes(k)), win = (e, ks) => ks.some(k => e.winKeys.includes(k));
const CAN = ['C1', 'C2', 'C3', 'C4', 'A:장대양봉', 'A:역망치형'], STO = ['S1', 'S2', 'S3'], FIB = ['F38', 'F50', 'F62'], EW = ['E3a', 'E3b'], VW = ['V1', 'V2'];
/* 조합: 구성 근거가 최근 3봉 안에 모두 있고 그중 하나 이상이 이 봉에서 발생 */
const combo = (...gs) => e => gs.every(g => win(e, g)) && gs.some(g => has(e, g));
const same = (...gs) => e => gs.every(g => has(e, g));
const NAME = { C1: '샛별형', C2: '상승장악형', C3: '망치형', C4: '긴 아랫꼬리 양봉', 'A:장대양봉': 'A1 장대양봉+하락주의 새진입', 'A:역망치형': 'A2 역망치형+진입대기 새진입', S1: '스토캐스틱 골든크로스', S2: '스토캐스틱 과매도 탈출', S3: '스토캐스틱 다이버전스',
  F38: '피보 38.2%', F50: '피보 50%', F62: '피보 61.8%', E3a: '엘리어트 3파 시작', E3b: '엘리어트 1파 고점 돌파', V1: 'VWAP 첫 지지', V2: 'VWAP 눌림 회복', M1: '9EMA 재돌파', M2: '9·20 골든크로스', G1: '갭상승 첫 눌림 재상승' };
const CELLS = Object.keys(NAME).map(k => ({ key: NAME[k], f: e => e.keys.includes(k) }));
CELLS.push({ key: '피보 아무 수준', f: e => has(e, FIB) });
CELLS.push({ key: '조합 캔들+스토캐스틱', f: combo(CAN, STO), f1: same(CAN, STO) }, { key: '조합 피보+스토캐스틱', f: combo(FIB, STO), f1: same(FIB, STO) }, { key: '조합 엘리어트3파+VWAP', f: combo(EW, VW), f1: same(EW, VW) },
  { key: '조합 갭+피보', f: combo(['G1'], FIB), f1: same(['G1'], FIB) }, { key: '조합 캔들+피보+스토캐스틱', f: combo(CAN, FIB, STO), f1: same(CAN, FIB, STO) });
CELLS.push({ key: '계열 1개(같은 봉)', f: e => e.fams.length === 1, fw: e => e.winFams.length === 1 }, { key: '계열 2개(같은 봉)', f: e => e.fams.length === 2, fw: e => e.winFams.length === 2 }, { key: '계열 3개 이상(같은 봉)', f: e => e.fams.length >= 3, fw: e => e.winFams.length >= 3 });
const bU = S(BASE.filter(e => !e.kr)), bK = S(BASE.filter(e => e.kr)), bA = S(BASE), bK2 = S(BASE.filter(e => e.kr), 15, 'r2');
const epis = new Set(EV.map(e => e.epi)).size;
console.log(`\n=== ⭐ 종합 상승 근거 연구 — ${Object.keys(data).length}종목 · ${dates[0]}~${dates[dates.length-1]} · 종목·일 ${tkDays} · 화면 함수 idUpEvents() ===`);
console.log(`기준선 +15분 상승: 전체 ${pc(bA.hit)} ${sg(bA.avg)}% · 미장 ${pc(bU.hit)} · 국장 ① ${pc(bK.hit)} ② ${pc(bK2.hit)} | +5분 ${pc(S(BASE, 5).hit)} · +30분 ${pc(S(BASE, 30).hit)} · +60분 ${pc(S(BASE, 60).hit)}`);
console.log(`빈도: ⭐ 봉(근거 1개 이상) ${EV.length}건 = 종목·일당 ${(EV.length/tkDays).toFixed(1)}개 · 전체 확정 봉의 ${pc(EV.length/barsAll)} | 에피소드(15분 이내 묶음) ${epis}개 = 종목·일당 ${(epis/tkDays).toFixed(1)}개 | 첫 발생 ${EV.filter(e => e.first).length} · 반복 ${EV.filter(e => !e.first).length}`);
console.log('표: n(종목·일당) · +5분 상승%/순 · +15분 상승%/평균/순/손익비 · +30/+60분 상승% | 미장 · 국장①/② | 첫/반복 | 초반/장중/마감전 | 블록 | 반쪽 | 상위5종목 비중 | WF | ★=+15분≥61%·n≥15');
const out = CELLS.map(c => { const z = EV.filter(c.f), s = S(z);
  const wf = [[[0], [1]], [[0, 1], [2]]].map(([tr, te]) => { const a = S(z.filter(e => inB(e, tr))), b = S(z.filter(e => inB(e, te))), ba = S(BASE.filter(e => inB(e, tr))), bb = S(BASE.filter(e => inB(e, te)));
    const sel = a.n >= 30 && a.hit >= ba.hit + 0.03 && a.avg - COST > 0; return { sel, ok: sel && b.n >= 15 && b.hit >= bb.hit + 0.03 && b.avg - COST > 0, a, b }; });
  return { c, z, s, wf }; });
for (const o of out){ const z = o.z, s = o.s, s5 = S(z, 5), us = S(z.filter(e => !e.kr)), k1 = S(z.filter(e => e.kr)), k2 = S(z.filter(e => e.kr), 15, 'r2'), fi = S(z.filter(e => e.first)), re = S(z.filter(e => !e.first));
  const tk = {}; z.forEach(e => tk[e.t] = (tk[e.t] || 0) + 1); const top5 = Object.values(tk).sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0);
  const extra = o.c.f1 ? ` | 같은 봉만 n${EV.filter(o.c.f1).length} ${pc(S(EV.filter(o.c.f1)).hit)}` : o.c.fw ? ` | 3봉 창 기준 n${EV.filter(o.c.fw).length} ${pc(S(EV.filter(o.c.fw)).hit)} ${sg(S(EV.filter(o.c.fw)).avg - COST)}` : '';
  console.log(`${s.n >= 15 && s.hit >= 0.61 ? '★' : ' '} ${o.c.key} · n${z.length}(${(z.length/tkDays).toFixed(2)}) · 5분 ${pc(s5.hit)}/${sg(s5.avg - COST)} · 15분 ${pc(s.hit)}/${sg(s.avg)}/${sg(s.avg - COST)}/PF ${isFinite(s.pf) ? s.pf.toFixed(2) : '—'} · 30분 ${pc(S(z, 30).hit)} · 60분 ${pc(S(z, 60).hit)} | 미 ${pc(us.hit)} n${us.n} · 국 ${pc(k1.hit)}/${pc(k2.hit)} n${k1.n} ②순 ${sg(k2.avg - COST)} | 첫 ${pc(fi.hit)} n${fi.n} · 반복 ${pc(re.hit)} n${re.n} | ${['초반', '장중', '마감전'].map(x => pc(S(z.filter(e => e.tod === x)).hit)).join('/')} | ${[0, 1, 2].map(b => pc(S(z.filter(e => inB(e, [b]))).hit)).join('/')} | ${pc(S(z.filter(e => half.has(e.day))).hit)}/${pc(S(z.filter(e => !half.has(e.day))).hit)} | ${z.length ? pc(top5/z.length) : '—'} | ${o.wf.map(w => (w.sel ? '선택' : '미선택') + '→' + (w.ok ? '통과' : '실패')).join(' · ')}${extra}`); }
const big = out.filter(o => o.s.n >= 15), c61 = big.filter(o => o.s.hit >= 0.61), exp61 = big.reduce((a, o) => a + binTail(o.s.n, Math.ceil(0.61*o.s.n), bA.hit), 0);
console.log(`\n요약: ${CELLS.length}칸 중 15건 이상 ${big.length}칸 · +15분 61% 이상 ${c61.length}칸(${c61.map(o => o.c.key).join(', ') || '없음'}) · 기준선만으로 우연히 나올 기대 ${exp61.toFixed(2)}칸 · 워크포워드 두 번 통과 ${out.filter(o => o.wf.every(w => w.ok)).length}칸(${out.filter(o => o.wf.every(w => w.ok)).map(o => o.c.key).join(', ') || '없음'}) · 비용 뒤 +15분 순수익 > 0 인 칸 ${big.filter(o => o.s.avg - COST > 0).length}칸`);
const all = S(EV), fst = S(EV.filter(e => e.first));
console.log(`⭐ 전체(아무 근거): n${EV.length} · 15분 ${pc(all.hit)} 순 ${sg(all.avg - COST)}% | 에피소드 첫 봉만: n${fst.n} · ${pc(fst.hit)} 순 ${sg(fst.avg - COST)}%`);
