/**
 * ⭐ 연구 후보 정합성 검증 — 2026-11-09 사용자 지시.
 * ① 화면용 idStarEvents()(index.html)를 60일 모든 종목·날짜에 '그날 화면과 같은 5일 창'으로 돌린 결과와
 * ② 백테스트 경로(tools/intraday-candle-wide-lab.js 와 같은 5분 경계 루프: 확정 봉만 넣어 idMtf → idCandleFeat 대표패턴 · 하락 주의 새 진입)를
 * 사건(시각·패턴·방향) 단위로 비교한다. 둘 다 index.html 함수를 문자열로 추출(재구현 금지).
 * 결과 수익은 별 시점 기준(①: 다음 5분봉 시가)과 국장 20분 뒤 확인 기준(②)을 따로 낸다.
 * 사용: node tools/intraday-star-parity.js i5.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
vm.createContext(ctx);
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat','idStarEvents'].map(H.extractFunction).join('\n') + '\n'
  + H.extractConst('ID_STAR_CANDS').replace('(typeof window !== "undefined" && window.__ID_STAR_CANDS) ||', '') + '\nthis.SE = idStarEvents; this.mtf = idMtf; this.feat = idCandleFeat; this.C = ID_STAR_CANDS;', ctx);
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
/* --wide: 비교 경로 자체를 검증하려고 흔한 모양(일반 음봉·인사이드바·도지)으로 같은 규칙의 후보를 넓혀 본다(화면 후보 표는 그대로) */
const WIDE = process.argv.includes('--wide');
const CANDS = WIDE ? ['일반 음봉', '인사이드바', '도지', '잠자리 도지', '석별형'].map(p => ({ pat:p, dir:'down', when:'down', newState:true, match:'primary', hit:0, n:0, verified:false, why:'시험' })) : ctx.C;
/* --plus-up: 상승 ⭐ 후보 2종(2026-11-09 84칸 연구에서 61% 이상 관측 · 검증 실패)을 화면 표에 넣기 전에 같은 스냅샷으로 재는 용도 */
if (process.argv.includes('--plus-up')) for (const [pat, when] of [['장대양봉', 'down'], ['역망치형', 'wait']]) if (!CANDS.some(c => c.pat === pat && c.when === when)) CANDS.push({ pat, dir: 'up', when, newState: true, match: 'primary', hit: 0, n: 0, verified: false, why: '시험' });
const PATS = new Set(CANDS.map(c => c.pat));
let same = 0, onlyStar = 0, onlyLab = 0, lastBar = 0; const diffs = [], rows = [], SROWS = [];
for (const [t, D] of Object.entries(data)){
  const kr = /\.(KS|KQ)$/.test(t);
  const days = []; let cur = null;
  for (const b of D.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off:b[6], bars:[] }; days.push(cur); } cur.bars.push(b); }
  for (let di = 4; di < days.length; di++){
    const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300;
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    const d = { tz: kr ? 'Asia/Seoul' : 'America/New_York', gmtoffset: today.off, reg:{ start:t0, end }, lastTrade: end, price: B[B.length-1][4], bars: hist.concat(B.map(b => b.slice(0, 6))) };
    const star = new Map(ctx.SE(d, end, CANDS).flatMap(ev => ev.items.map(c => [`${ev.ts}|${c.pat}`, ev])));
    const lab = new Map(); let prev = null;
    for (let k = 1; k < B.length; k++){
      /* 판정 시각 = 그 봉이 끝난 시각(화면과 같음). 예전 연구 루프는 '다음 봉 시작'을 썼는데 봉이 빠진(거래 없는) 종목에서
         15·30분 봉 확정 시점이 달라져 어긋났다(2026-11-09 정합성 시험에서 발견) → 화면 기준으로 통일 */
      const tau = B[k-1][0] + 300;
      const A = ctx.mtf({ ...d, bars: hist.concat(B.slice(0, k).map(b => b.slice(0, 6))), lastTrade: tau }, tau);
      if (!A) continue;
      /* 2026-11-10: 후보마다 '그 후보의 상태에 새로 들어간 봉 + 대표패턴'으로 일반화(상승 ⭐ 후보도 같은 루프로 대조). 하락 후보 결과는 예전과 같다. */
      const L = A.tf[5].filter(r => r.done).pop(), pv = prev; prev = A.state;
      const hitC = CANDS.filter(c => c.when && A.state === c.when && (!c.newState || pv !== c.when));
      if (!hitC.length || !L) continue;
      const F = ctx.feat(A, L); if (!F) continue;
      for (const c of hitC) if ((c.match === 'primary' ? F.primary === c.pat : F.names.includes(c.pat))) lab.set(`${L.ts}|${c.pat}`, k);
    }
    const lastTs = B[B.length-1][0];
    for (const ev of ctx.SE(d, end, CANDS)){
      const k1 = B.findIndex(b => b[0] >= ev.ts + 300); if (k1 < 0) continue;
      const res = (k0) => { if (k0 < 0 || k0 >= B.length) return null; const e = B[k0][1], r = {}; for (const h of [5, 15, 30]){ const i = k0 + h/5 - 1; r[h] = i < B.length ? (ev.dir === 'down' ? (1 - B[i][4]/e) : (B[i][4]/e - 1))*100 : null; } return r; };
      const k2 = kr ? B.findIndex(b => b[0] >= ev.ts + 300 + 1200) : -1;
      for (const c of ev.items){ const sgn = c.dir === 'up' ? 1 : -1, rr = k0 => { if (k0 < 0 || k0 >= B.length) return null; const e = B[k0][1], r = {}; for (const h of [5, 15, 30]){ const i = k0 + h/5 - 1; r[h] = i < B.length ? sgn*(B[i][4]/e - 1)*100 : null; } return r; };
        SROWS.push({ t, kr, day: today.day, pat: c.pat, dir: c.dir, r1: rr(k1), r2: kr ? rr(k2) : null }); }
    }
    for (const [key, ev] of star){ if (ev.ts === lastTs){ lastBar++; continue; } if (lab.has(key)) same++; else { onlyStar++; diffs.push(`별만 ${t} ${key}`); } }
    for (const [key, k] of lab){ if (!star.has(key)){ onlyLab++; diffs.push(`백테스트만 ${t} ${key}`); continue; }
      const ev = star.get(key), pat = key.split('|')[1];
      const up = CANDS.find(c => c.pat === pat).dir === 'up';
      const res = (k0) => { if (k0 < 0 || k0 >= B.length) return null; const e = B[k0][1], r = {}; for (const h of [5, 15]){ const i = k0 + h/5 - 1; r[h] = i < B.length ? (up ? (B[i][4]/e - 1) : (1 - B[i][4]/e))*100 : null; } return r; };   // 후보 방향 기준: 맞으면 +
      const k2 = kr ? B.findIndex(b => b[0] === B[k][0] + 1200) : -1;
      rows.push({ t, kr, pat, dir: ev.dir, ts: ev.ts, r1: res(k), r2: kr ? res(k2) : null });
    }
  }
}
console.log(`\n=== ⭐ 정합성 — 화면 idStarEvents() vs 백테스트 루프 (60일 · 모든 종목·날짜 · 그날 5일 창) ===`);
console.log(`  일치 ${same} · 별에만 ${onlyStar} · 백테스트에만 ${onlyLab} · (그날 마지막 봉 별 ${lastBar}건 — 다음 봉이 없어 백테스트 결과 집계 대상 아님)`);
diffs.slice(0, 10).forEach(x => console.log('  불일치 ' + x));
console.log(onlyStar + onlyLab === 0 ? '  ✅ 발생 시각·패턴·방향 모두 일치' : '  ❌ 불일치 있음');
const st = (xs, h, k) => { const z = xs.map(e => e[k] && e[k][h]).filter(v => v != null); return z.length ? `${(z.filter(v => v > 0).length/z.length*100).toFixed(0)}% ${(z.reduce((a, b) => a + b, 0)/z.length).toFixed(3)}% n${z.length}` : '—'; };
console.log('\n  패턴별 결과 (후보 방향대로 가면 적중: ⚠️ 하락 · ⭐ 상승) — ① 별 시점 기준 다음 5분봉 시가 / ② 국장만 20분 뒤 확인');
for (const p of PATS){ const z = rows.filter(e => e.pat === p), zk = z.filter(e => e.kr), zu = z.filter(e => !e.kr);
  console.log(`  ${p}: 전체 n${z.length} · ① +5분 ${st(z, 5, 'r1')} · +15분 ${st(z, 15, 'r1')} | 미장 ① +15분 ${st(zu, 15, 'r1')} | 국장 ① +5분 ${st(zk, 5, 'r1')} +15분 ${st(zk, 15, 'r1')} · ② +5분 ${st(zk, 5, 'r2')} +15분 ${st(zk, 15, 'r2')}`); }

/* 화면 함수 사건 기준 성과 — 후보 규칙(+15분 ≥61% · n≥15)을 같은 정의로 다시 확인 */
console.log('\n  ■ 화면 함수(idStarEvents) 사건 기준 성과 — 후보 방향대로 가면 적중 · ① 별 시점 다음 5분봉 시가 / ② 국장 20분 뒤');
const pf = (xs, h, k) => { const z = xs.map(e => e[k] && e[k][h]).filter(v => v != null), g = z.filter(v => v > 0).reduce((a, b) => a + b, 0), l = -z.filter(v => v < 0).reduce((a, b) => a + b, 0); return l ? (g/l).toFixed(2) : '—'; };
for (const p of PATS){ const z = SROWS.filter(e => e.pat === p), z15 = z.map(e => e.r1 && e.r1[15]).filter(v => v != null), hit = z15.length ? z15.filter(v => v > 0).length/z15.length : NaN;
  console.log(`  ${p}: n${z.length} · ① +5분 ${st(z, 5, 'r1')} · +15분 ${st(z, 15, 'r1')} · +30분 ${st(z, 30, 'r1')} · 손익비15 ${pf(z, 15, 'r1')} · 순15(0.05%) ${z15.length ? (z15.reduce((a, b) => a + b, 0)/z15.length - 0.05).toFixed(3) : '—'}% | 미장 +15분 ${st(z.filter(e => !e.kr), 15, 'r1')} | 국장 ① +5분 ${st(z.filter(e => e.kr), 5, 'r1')} +15분 ${st(z.filter(e => e.kr), 15, 'r1')} · ② +5분 ${st(z.filter(e => e.kr), 5, 'r2')} +15분 ${st(z.filter(e => e.kr), 15, 'r2')} → 후보 규칙 ${z15.length >= 15 && hit >= 0.61 ? '충족' : '미충족'}`); }

/* 2026-11-10: 화면 후보 표(ID_STAR_CANDS)에 그대로 옮길 숫자 — 한 스냅샷에서 네 후보를 같은 정의로. 워크포워드는 3블록(학습 n≥15·≥61% 선택 → 검증 n≥10·≥55%). */
const days_ = [...new Set(SROWS.map(e => e.day))].sort(), n3 = Math.floor(days_.length/3), blk = [new Set(days_.slice(0, n3)), new Set(days_.slice(n3, 2*n3)), new Set(days_.slice(2*n3))];
const HS = (xs, h = 15, k = 'r1') => { const z = xs.map(e => e[k] && e[k][h]).filter(v => v != null); return { n: z.length, w: z.filter(v => v > 0).length, hit: z.length ? Math.round(z.filter(v => v > 0).length/z.length*100) : null, avg: z.length ? +(z.reduce((a, b) => a + b, 0)/z.length).toFixed(3) : null }; };
console.log('\n  ■ 화면 표용 요약(JSON) — 순수익 = 평균 − 비용 0.05%');
for (const c of CANDS){ const z = SROWS.filter(e => e.pat === c.pat), a = HS(z), a5 = HS(z, 5), us = HS(z.filter(e => !e.kr)), kr = HS(z.filter(e => e.kr)), kr2 = HS(z.filter(e => e.kr), 15, 'r2');
  const wf = [[[0], [1]], [[0, 1], [2]]].map(([tr, te]) => { const A = HS(z.filter(e => tr.some(b => blk[b].has(e.day)))), B2 = HS(z.filter(e => te.some(b => blk[b].has(e.day)))); return { train: `n${A.n} ${A.hit}%`, test: `n${B2.n} ${B2.hit}%`, sel: A.n >= 15 && A.hit >= 61, ok: A.n >= 15 && A.hit >= 61 && B2.n >= 10 && B2.hit >= 55 }; });
  console.log('  TABLE ' + JSON.stringify({ pat: c.pat, dir: c.dir, when: c.when, n: a.n, hit15: a.hit, wins15: a.w, avg15: a.avg, net15: a.avg == null ? null : +(a.avg - 0.05).toFixed(3), hit5: a5.hit, net5: a5.avg == null ? null : +(a5.avg - 0.05).toFixed(3), us: `${us.hit}% n${us.n}`, kr1: `${kr.hit}% n${kr.n}`, kr2: `${kr2.hit}% n${kr2.n}`, blocks: [0, 1, 2].map(b => { const x = HS(z.filter(e => blk[b].has(e.day))); return `n${x.n} ${x.hit}%`; }), wf })); }
