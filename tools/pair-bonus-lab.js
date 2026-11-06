#!/usr/bin/env node
/**
 * 🔀 페어 리버설을 산식에 가점으로 넣으면 — 강한매수·다중 승률이 어떻게 되나 (읽기 전용 · 반영 전 보고용)
 *
 * 왜 (2026-11-06 사용자: "페어리버설은 활용하고 산식에 다중 등 가점")
 * 전에 해 본 것: 점수 +0.3/+0.5/+1.0 (v13-lab M) → 새로 편입 0~4건, 효과 없음(방법론 §표 '가점 무효').
 * 그래서 이번엔 '가점'을 세 가지로 넣어 본다. 판정 함수는 화면 그대로(§0), 줄 하나씩만 바꾼다.
 *   V1 다중 편입   : 다중 후보 자격 = 강한매수(5) 또는 (페어 리버설 ∧ 매수관심(4))     — multiSignalRank eligible
 *   V2 강한매수 승격: 최종 등급 매수관심(4) ∧ 페어 리버설 → 강한매수(5)                — evaluate 마지막 등급
 *   V3 V1 + 다중 관문 통과 조건 그대로(generalMultiGate) — V1과 같고 V2와 다른 경로만 확인용으로 V1∩V2 합집합
 * 보는 것: 강한매수·다중 +1/+3/+5 승률·표본 · §2 앞/뒤 반 · 새로 들어온 표본의 성적 · 빠진 표본
 * 입력 backtest/raw.json (CI lab-quick years=3 days=690 · ext_pair는 main.py analyze()가 hist에 채운다)
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'signals.json';
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
const F = base.hist_fields, iD = F.indexOf('date'), iV = F.indexOf('market_vxn'), iP = F.indexOf('ext_pair'), VXN = ((base.macro || {}).vxn) || {};
for (const s of base.stocks) for (const r of s.hist || []) { while (r.length <= iV) r.push(null); if (r[iV] == null && VXN[r[iD]] != null) r[iV] = +VXN[r[iD]]; }
let pairN = 0; for (const s of base.stocks) for (const r of s.hist || []) if (r[iP] === 1) pairN++;
const RAW = JSON.stringify(base);
const ELIG = 'const eligible=list.filter(s=>s.sig.grade===5 && generalMultiGate(s));';
const GRADE = 'const g=themeDanger ? 3 : (buyGrade>=4 ? buyGrade : 3);';
function run(v) {
  const patch = [];
  if (v === 1 || v === 3) patch.push([ELIG, 'const eligible=list.filter(s=>(s.sig.grade===5 || (s.sig.grade===4 && s.ext_pair===1)) && generalMultiGate(s));']);
  if (v === 2 || v === 3) patch.push([GRADE, 'const g=themeDanger ? 3 : (buyGrade>=4 ? ((buyGrade===4 && s.ext_pair===1) ? 5 : buyGrade) : 3);']);
  const page = H.loadPage({ patch });
  page.runInPage(`this.__run = j => { state.data = normalize(JSON.parse(j)); const r = strategyValidation(); const o = {};
    ['strongBuy','multi'].forEach(k => { o[k] = {}; [1,3,5].forEach(h => o[k][h] = (r._phaseRows[k][h]||[]).map(x => ({t:x.ticker, d:x.date, ret:x.ret}))); });
    return JSON.stringify(o); };`);
  return JSON.parse(page.__run(RAW));
}
const st = a => { const w = a.filter(x => x.ret > 1).length, l = a.filter(x => x.ret < -1).length;
  return `${w + l ? Math.round(w / (w + l) * 100) : '—'}%(${a.length})`.padEnd(11); };
const key = x => x.t + '|' + x.d;
const B0 = run(0);
const dates = [...new Set(B0.strongBuy[1].map(x => x.d))].sort(); const mid = dates[Math.floor(dates.length / 2)];
console.log(`■ 페어 리버설 가점 후보 · 신호일 ${dates[0]}~${dates[dates.length - 1]} · 반쪽 경계 ${mid} · 원본 hist의 페어 리버설 ${pairN}칸`);
function show(nm, R) {
  for (const k of ['strongBuy', 'multi']) {
    const add = h => { const s0 = new Set(B0[k][h].map(key)); return R[k][h].filter(x => !s0.has(key(x))); };
    const rem = h => { const s1 = new Set(R[k][h].map(key)); return B0[k][h].filter(x => !s1.has(key(x))); };
    console.log(`   ${(nm + ' ' + (k === 'strongBuy' ? '강매' : '다중')).padEnd(18)} 전체 ${[1, 3, 5].map(h => st(R[k][h])).join('')}`
      + `| 앞 ${[3, 5].map(h => st(R[k][h].filter(x => x.d < mid))).join('')} 뒤 ${[3, 5].map(h => st(R[k][h].filter(x => x.d >= mid))).join('')}`
      + `| 추가 ${[1, 3, 5].map(h => st(add(h))).join('')} 빠짐 ${st(rem(5))}`);
  }
}
show('현행 v22', B0);
show('V1 다중 편입', run(1));
show('V2 강매 승격', run(2));
show('V3 둘 다', run(3));
