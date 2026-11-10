/* 배포 Worker 응답을 화면과 같은 함수(idMtf · idLag)로 계산해 모니터링 줄에 뜰 '체결 N분 전 · 확정봉 M분 전 (야후 + 서버 저장 + 브라우저)'을 찍는다. CI 전용.
   사용: node tools/kr-lag-page-check.js 069500.KS,229200.KS */
const vm = require('vm'), H = require('./_harness');
const ctx = vm.createContext({ Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite, ID: { cache: new Map() } });
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idLag'].map(H.extractFunction).join('\n') + '\n' + H.extractConst('ID_STALE') + '\nthis.mtf = idMtf; this.lag = idLag;', ctx);
const API = 'https://stock-intraday.zzz797911.workers.dev/';
(async () => {
  for (const t of (process.argv[2] || '069500.KS,229200.KS').split(',')){
    const r = await fetch(API + '?t=' + encodeURIComponent(t), { headers: { Origin: 'https://shouldibuythis.github.io' } }); const d = await r.json(), now = Date.now()/1000;
    ctx.ID.cache.set(t, { at: now, d });
    const A = ctx.mtf(d, now), L = ctx.lag(t, d, A, now);
    console.log(`  화면 계산 ${t}: 장중 ${A.open} · 체결 ${L.trade}분 전 · 확정봉 ${L.bar}분 전 · (${L.why}) · 오래된 자료(25분↑) ${L.stale} · 헤더 ${r.headers.get('cache-control')} · ${r.headers.get('x-cache')} · Age ${r.headers.get('age') || '—'}`);
  }
})();
