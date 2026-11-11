#!/usr/bin/env node
/**
 * 장 시작 60분 × 전날 일봉 등급 (2026-11-11 사용자 지적 "시가에는 장 시작 60분까지 일봉 종가 신호가 반영돼야 하지 않나").
 * 기존 장중 연구는 장 시작 30분을 뺐다(화면 판정이 초반 30분을 '흔들림'으로 제외). 여기서는 판정 없이 가격만 본다:
 *   진입 = 시가(첫 5분봉 시가) · +30분(7번째 봉 시가) · +60분(13번째 봉 시가) / 국장은 20분 지연이라 시가 대신 +20분부터
 *   청산 = +30분 · +60분 · 그날 공식 종가(원장) · 다음 날 시가
 * 묶음 = 전날 원장 일봉 등급(장 시작 전에 아는 값): 💡 강한다중 / 다중 / 강한매수 전체 / 매수관심 / 중립 이하 / 전체.
 * 상승 = 보합 제외 비율. 평균 = 비용 전. 연구 전용 · 화면 변경 없음.
 * 사용: node tools/open-hour-prior-lab.js /tmp/i5.json backtest/daily-grades.json
 */
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const DG = JSON.parse(fs.readFileSync(process.argv[3] || 'backtest/daily-grades.json', 'utf8'));
const SIG = JSON.parse(fs.readFileSync('signals.json', 'utf8')), F = SIG.hist_fields, iD = F.indexOf('date'), iP = F.indexOf('price');
const CLOSE = {}; for (const s of SIG.stocks) for (const h of (s.hist || [])) CLOSE[s.ticker.toUpperCase() + '|' + h[iD]] = h[iP];
const isKR = t => /\.(KS|KQ)$/.test(t);
const prevG = (t, day) => { const m = DG[t]; if (!m) return null; let p = null; for (const d of Object.keys(m).sort()){ if (d < day) p = d; else break; } return p ? m[p] : null; };
const rows = [];
for (const t of Object.keys(data)){
  const kr = isKR(t), days = []; let cur = null;
  for (const b of data[t].bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, bars: [] }; days.push(cur); } cur.bars.push(b); }
  days.forEach((X, i) => { const B = X.bars; if (B.length < 20) return; const g = prevG(t, X.day); if (!g) return;
    const nx = days[i+1] && days[i+1].bars.length ? days[i+1].bars[0][1] : null, cl = CLOSE[t.toUpperCase() + '|' + X.day] ?? null;
    const P = { open: kr ? null : B[0][1], m20: kr ? B[4][1] : null, m30: B[6] ? B[6][1] : null, m60: B[12] ? B[12][1] : null,
      x30: B[5] ? B[5][4] : null, x60: B[11] ? B[11][4] : null, close: cl, next: nx };
    rows.push({ t, kr, day: X.day, g, P }); });
}
const days = [...new Set(rows.map(r => r.day))].sort(), MID = days[Math.floor(days.length/2)];
const BK = [['전체', () => true], ['💡 강한다중', g => g[0] === 5 && g[1] === 1], ['다중(💡 제외)', g => g[0] === 5 && g[1] === 2], ['강한매수 전체', g => g[0] === 5], ['매수관심', g => g[0] === 4], ['중립 이하', g => g[0] != null && g[0] <= 3]];
const cell = (a, e, x) => { const v = a.map(r => r.P[e] && r.P[x] ? (r.P[x]/r.P[e] - 1)*100 : null).filter(z => z != null); if (v.length < 5) return `${'—'.padStart(16)}`;
  const u = v.filter(z => z > 0).length, d = v.filter(z => z < 0).length, m = v.reduce((s, z) => s + z, 0)/v.length;
  return `${String(Math.round(u/(u+d)*100)).padStart(3)}% ${(m >= 0 ? '+' : '') + m.toFixed(2)}%(${v.length})`.padStart(16); };
const PAIRS = [['open', 'x30'], ['open', 'x60'], ['open', 'close'], ['open', 'next'], ['m20', 'x60'], ['m20', 'close'], ['m20', 'next'], ['m30', 'close'], ['m30', 'next'], ['m60', 'close'], ['m60', 'next']];
const NAME = { open: '시가', m20: '+20분', m30: '+30분', m60: '+60분', x30: '+30분', x60: '+60분', close: '종가', next: '다음날시가' };
console.log(`=== 장 시작 60분 × 전날 일봉 등급 · ${days[0]}~${days[days.length-1]} · 종목·날 ${rows.length} · 반쪽 ${MID} ===  (상승=보합 제외 · 평균 비용 전 · (n))`);
for (const [mn, mf] of [['미장', r => !r.kr], ['국장(20분 지연 → +20분부터)', r => r.kr]]){
  const A = rows.filter(mf); console.log(`\n■ ${mn}`);
  const pairs = PAIRS.filter(([e]) => mn.startsWith('미장') ? e !== 'm20' : e !== 'open');
  console.log('진입→청산'.padEnd(16) + BK.map(([b]) => b.padStart(16)).join(''));
  for (const [e, x] of pairs) console.log(`${NAME[e]}→${NAME[x]}`.padEnd(16) + BK.map(([, f]) => cell(A.filter(r => f(r.g)), e, x)).join(''));
  const S = A.filter(r => r.g[0] === 5); const half = w => cell(S.filter(r => (r.day < MID) === (w === 0)), mn.startsWith('미장') ? 'open' : 'm20', 'close');
  console.log(`  강한매수 전체 ${mn.startsWith('미장') ? '시가' : '+20분'}→종가 반쪽: ${half(0).trim()} / ${half(1).trim()}`);
}
