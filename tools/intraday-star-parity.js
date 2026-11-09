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
      const L = A.tf[5].filter(r => r.done).pop(), nd = A.state === 'down' && prev !== 'down'; prev = A.state;
      if (!nd) continue;
      const F = ctx.feat(A, L); if (F && PATS.has(F.primary)) lab.set(`${L.ts}|${F.primary}`, k);
    }
    const lastTs = B[B.length-1][0];
    for (const ev of ctx.SE(d, end, CANDS)){
      const k1 = B.findIndex(b => b[0] >= ev.ts + 300); if (k1 < 0) continue;
      const res = (k0) => { if (k0 < 0 || k0 >= B.length) return null; const e = B[k0][1], r = {}; for (const h of [5, 15, 30]){ const i = k0 + h/5 - 1; r[h] = i < B.length ? (ev.dir === 'down' ? (1 - B[i][4]/e) : (B[i][4]/e - 1))*100 : null; } return r; };
      const k2 = kr ? B.findIndex(b => b[0] >= ev.ts + 300 + 1200) : -1;
      for (const c of ev.items) SROWS.push({ t, kr, pat: c.pat, dir: ev.dir, r1: res(k1), r2: kr ? res(k2) : null });
    }
    for (const [key, ev] of star){ if (ev.ts === lastTs){ lastBar++; continue; } if (lab.has(key)) same++; else { onlyStar++; diffs.push(`별만 ${t} ${key}`); } }
    for (const [key, k] of lab){ if (!star.has(key)){ onlyLab++; diffs.push(`백테스트만 ${t} ${key}`); continue; }
      const ev = star.get(key), pat = key.split('|')[1];
      const res = (k0) => { if (k0 < 0 || k0 >= B.length) return null; const e = B[k0][1], r = {}; for (const h of [5, 15]){ const i = k0 + h/5 - 1; r[h] = i < B.length ? (1 - B[i][4]/e)*100 : null; } return r; };   // 하락 쪽: 하락 = +
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
console.log('\n  패턴별 결과 (하락 쪽: 내려가면 적중) — ① 별 시점 기준 다음 5분봉 시가 / ② 국장만 20분 뒤 확인');
for (const p of PATS){ const z = rows.filter(e => e.pat === p), zk = z.filter(e => e.kr), zu = z.filter(e => !e.kr);
  console.log(`  ${p}: 전체 n${z.length} · ① +5분 ${st(z, 5, 'r1')} · +15분 ${st(z, 15, 'r1')} | 미장 ① +15분 ${st(zu, 15, 'r1')} | 국장 ① +5분 ${st(zk, 5, 'r1')} +15분 ${st(zk, 15, 'r1')} · ② +5분 ${st(zk, 5, 'r2')} +15분 ${st(zk, 15, 'r2')}`); }

/* 화면 함수 사건 기준 성과 — 후보 규칙(+15분 ≥61% · n≥15)을 같은 정의로 다시 확인 */
console.log('\n  ■ 화면 함수(idStarEvents) 사건 기준 성과 — 하락 쪽은 내려가면 적중 · ① 별 시점 다음 5분봉 시가 / ② 국장 20분 뒤');
const pf = (xs, h, k) => { const z = xs.map(e => e[k] && e[k][h]).filter(v => v != null), g = z.filter(v => v > 0).reduce((a, b) => a + b, 0), l = -z.filter(v => v < 0).reduce((a, b) => a + b, 0); return l ? (g/l).toFixed(2) : '—'; };
for (const p of PATS){ const z = SROWS.filter(e => e.pat === p), z15 = z.map(e => e.r1 && e.r1[15]).filter(v => v != null), hit = z15.length ? z15.filter(v => v > 0).length/z15.length : NaN;
  console.log(`  ${p}: n${z.length} · ① +5분 ${st(z, 5, 'r1')} · +15분 ${st(z, 15, 'r1')} · +30분 ${st(z, 30, 'r1')} · 손익비15 ${pf(z, 15, 'r1')} · 순15(0.05%) ${z15.length ? (z15.reduce((a, b) => a + b, 0)/z15.length - 0.05).toFixed(3) : '—'}% | 미장 +15분 ${st(z.filter(e => !e.kr), 15, 'r1')} | 국장 ① +5분 ${st(z.filter(e => e.kr), 5, 'r1')} +15분 ${st(z.filter(e => e.kr), 15, 'r1')} · ② +5분 ${st(z.filter(e => e.kr), 5, 'r2')} +15분 ${st(z.filter(e => e.kr), 15, 'r2')} → 후보 규칙 ${z15.length >= 15 && hit >= 0.61 ? '충족' : '미충족'}`); }
