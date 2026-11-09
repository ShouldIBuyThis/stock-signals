/**
 * 오늘(마지막 거래일) 화면 ⭐ 확인 — 배포된 Worker 자료를 그대로 받아 화면과 같은 idStarEvents()로 계산(CI 전용).
 * 별이 왜 없는지도 보이도록 '하락 주의 새 진입' 시점의 대표 캔들을 함께 찍는다.
 * 사용: node tools/star-today.js 069500.KS 229200.KS
 */
const vm = require('vm'), H = require('./_harness');
const ctx = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
vm.createContext(ctx);
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat','idStarEvents','idHM'].map(H.extractFunction).join('\n') + '\n'
  + H.extractConst('ID_STAR_CANDS').replace('(typeof window !== "undefined" && window.__ID_STAR_CANDS) ||', '') + '\nthis.SE = idStarEvents; this.mtf = idMtf; this.feat = idCandleFeat; this.HM = idHM; this.C = ID_STAR_CANDS;', ctx);
const W = process.env.INTRADAY_WORKER || 'https://stock-intraday.zzz797911.workers.dev/';
(async () => {
  for (const t of process.argv.slice(2)){
    const d = await (await fetch(`${W}?t=${encodeURIComponent(t)}`, { headers: { Origin: 'https://shouldibuythis.github.io' } })).json();
    if (d.error){ console.log(t, '오류', d.error); continue; }
    const now = Math.floor(Date.now()/1000), A = ctx.mtf(d, now), ev = ctx.SE(d, now);
    const today = A.tf[5].filter(r => r.done && r.day === A.lastDay);
    let prev = null; const downs = [];
    for (const bar of today){ const tau = bar.ts + 300; const At = ctx.mtf({ ...d, bars: d.bars.filter(b => b[0] + 300 <= tau), lastTrade: tau }, tau); if (!At) continue;
      if (At.state === 'down' && prev !== 'down'){ const F = ctx.feat(At, At.tf[5].filter(r => r.done).pop()); downs.push(`${ctx.HM(bar.m)} ${F ? F.primary : '—'}`); } prev = At.state; }
    console.log(`\n■ ${t} · 마지막 거래일 ${A.lastDay} · 확정 5분봉 ${today.length}개 · 현재 판정 ${A.state}`);
    console.log(`  ⭐ 사건 ${ev.length}건 ${ev.map(e => ctx.HM(e.m) + ' ' + e.items.map(c => c.pat).join('·')).join(' / ')}`);
    console.log(`  하락 주의 새 진입 ${downs.length}번 — 그 봉의 대표 캔들: ${downs.join(' · ') || '없음'} (⭐ 조건: 잠자리 도지 또는 석별형)`);
  }
})();
