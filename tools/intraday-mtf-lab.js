/**
 * 장중 다중 시간대 판정 과거 시험 — docs/2026-11-09-intraday-mtf.md §5 (결과 보기 전 사전 등록).
 * 판정은 index.html의 idMtf()를 문자열로 꺼내 그대로 쓴다(재구현 금지). 임계값은 바꾸지 않는다.
 * 사용: node tools/intraday-mtf-lab.js i5.json [--last-day]   (--last-day = 마지막 거래일만 · 종목별 시간표)
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
vm.createContext(ctx);
vm.runInContext(['idLocal','idEma','idAgg','idMtf'].map(H.extractFunction).join('\n') + '\nthis.idMtf = idMtf; this.idLocal = idLocal;', ctx);

const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const LAST = process.argv.includes('--last-day'), tl = {};
const pts = [], ev = [], bo = [];
const ORDER = ['hold','down','flat','up','pull','wait','go'];
for (const [t, D] of Object.entries(data)){
  const kr = /\.(KS|KQ)$/.test(t);
  const days = []; let cur = null;
  for (const b of D.bars){
    const day = new Date((b[0] + b[6]) * 1000).toISOString().slice(0, 10);
    if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); }
    cur.bars.push(b);
  }
  for (let di = LAST ? days.length-1 : 4; di < days.length; di++){
    const today = days[di], t0 = today.bars[0][0], end = today.bars[today.bars.length-1][0] + 300;
    const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
    let prev = null, prevBo = false;
    for (let tau = t0 + 1800; tau < end; tau += 900){
      const seen = today.bars.filter(b => b[0] + 300 <= tau).map(b => b.slice(0, 6));
      const A = ctx.idMtf({ gmtoffset: today.off, reg: { start: t0, end }, lastTrade: tau, bars: hist.concat(seen) }, tau);
      if (!A) continue;
      const fut = today.bars.filter(b => b[0] >= tau);
      if (!fut.length) continue;
      const entry = fut[0][1];
      const closeAt = s => { const z = fut.filter(b => b[0] + 300 <= s); return z.length ? z[z.length-1][4] : null; };
      const c30 = closeAt(tau + 1800 + 300), c60 = closeAt(tau + 3600 + 300), cE = fut[fut.length-1][4];
      const o = { t, kr, day: today.day, state: A.state,
        r30: c30 != null && fut.length >= 7 ? (c30/entry - 1)*100 : null,
        r60: c60 != null && fut.length >= 13 ? (c60/entry - 1)*100 : null,
        rE: (cE/entry - 1)*100,
        mfe: (Math.max(...fut.map(b => b[2]))/entry - 1)*100, mae: (Math.min(...fut.map(b => b[3]))/entry - 1)*100 };
      pts.push(o); if (LAST) (tl[t] = tl[t] || []).push(`${new Date((tau + today.off)*1000).toISOString().slice(11,16)} ${A.state.padEnd(4)} +30분 ${o.r30 == null ? '  —  ' : (o.r30 >= 0 ? '+' : '') + o.r30.toFixed(2) + '%'} · 종가까지 ${(o.rE >= 0 ? '+' : '') + o.rE.toFixed(2)}%`);
      if (A.state !== prev && A.state !== 'hold'){
        const e = { ...o };
        if (A.state === 'go' && A.E.hit){
          const nx = fut.slice(0, 6);
          e.fake = nx.length < 6 ? null : nx.some(b => b[4] < A.E.hit.low);
        }
        ev.push(e);
      }
      prev = A.state;
      const isBo = !!(A.P && A.P.breakout);
      if (isBo && !prevBo && fut.length >= 9){
        const c15 = [fut[2][4], fut[5][4], fut[8][4]];
        bo.push({ t, kr, day: today.day, fake: c15.some(c => c < A.P.R), rE: o.rE });
      }
      prevBo = isBo;
    }
  }
}
const dates = [...new Set(pts.map(p => p.day))].sort(), mid = dates[Math.floor(dates.length/2)];
const mean = a => a.length ? a.reduce((s, x) => s + x, 0)/a.length : NaN, med = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length/2)]; };
const f = (x, d = 2) => isFinite(x) ? (x > 0 ? '+' : '') + x.toFixed(d) : '—';
const pct = (a, k) => { const z = a.map(o => o[k]).filter(v => v != null); return z.length ? `${f(mean(z),3)}% (상승 ${(z.filter(v => v > 0).length/z.length*100).toFixed(0)}%)` : '—'; };
const grade = n => n >= 50 ? '사용 가능' : n >= 30 ? '방향만' : n >= 15 ? '참고' : '신뢰 불가';
const tdays = new Set(pts.map(p => p.t + p.day)).size;
console.log(`\n=== 장중 다중 시간대 과거 시험 — ${Object.keys(data).length}종목 · ${dates[0]}~${dates[dates.length-1]} (${dates.length}거래일) · 종목·날짜 ${tdays} · 판정 시점 ${pts.length} ===`);
console.log('진입 = 다음 5분봉 시가 · 수익률은 같은 날 안에서만 · 비용 미반영 · 승률 검증 아님\n');
const row = (lab, a) => console.log(`${lab.padEnd(14)} n=${String(a.length).padStart(6)}  +30분 ${pct(a,'r30').padEnd(22)} +60분 ${pct(a,'r60').padEnd(22)} 당일종가 ${pct(a,'rE').padEnd(22)} MFE중앙 ${f(med(a.map(o=>o.mfe)))} MAE중앙 ${f(med(a.map(o=>o.mae)))}`);
console.log('[1] 판정 시점 전체에서 각 상태가 차지한 비율 · 그 시점 이후 흐름');
row('기준선(전체)', pts);
for (const s of ORDER){ const a = pts.filter(p => p.state === s); console.log(`  ${s.padEnd(5)} 비율 ${(a.length/pts.length*100).toFixed(1)}%`); }
console.log('\n[2] 사건(상태에 새로 들어간 시점) — 빈도와 이후 흐름');
for (const s of ORDER.slice(1)){
  const a = ev.filter(e => e.state === s);
  row(`${s} (${grade(a.length)})`, a);
  console.log(`${''.padEnd(14)} 빈도 ${(a.length/tdays).toFixed(2)}회/종목·일`);
}
console.log('\n[3] 반쪽·시장별 (사건, +60분 평균 / 당일종가 평균 · 기준선 대비)');
const sub = (lab, P, E) => { console.log(`  ${lab}: 기준선 +60분 ${pct(P,'r60')} · 당일 ${pct(P,'rE')}`);
  for (const s of ['go','wait','pull','up','down']){ const a = E.filter(e => e.state === s); console.log(`     ${s.padEnd(5)} n=${String(a.length).padStart(5)} (${grade(a.length)})  +60분 ${pct(a,'r60').padEnd(22)} 당일 ${pct(a,'rE')}`); } };
sub(`앞 반 (~${mid})`, pts.filter(p => p.day < mid), ev.filter(e => e.day < mid));
sub(`뒤 반 (${mid}~)`, pts.filter(p => p.day >= mid), ev.filter(e => e.day >= mid));
sub('미장', pts.filter(p => !p.kr), ev.filter(e => !e.kr));
sub('국장', pts.filter(p => p.kr), ev.filter(e => e.kr));
console.log('\n[4] 가짜 돌파');
const g = ev.filter(e => e.state === 'go' && e.fake != null);
console.log(`  5분 재돌파 확인 뒤 30분 안에 재돌파 봉 저가 아래 마감: ${g.filter(e => e.fake).length}/${g.length} = ${(g.filter(e => e.fake).length/Math.max(1,g.length)*100).toFixed(0)}%`);
console.log(`  15분 저항 돌파 뒤 45분 안에 저항 아래 마감: ${bo.filter(b => b.fake).length}/${bo.length} = ${(bo.filter(b => b.fake).length/Math.max(1,bo.length)*100).toFixed(0)}%`);
console.log(`    앞 반 ${(()=>{const a=bo.filter(b=>b.day<mid);return `${a.filter(b=>b.fake).length}/${a.length}`})()} · 뒤 반 ${(()=>{const a=bo.filter(b=>b.day>=mid);return `${a.filter(b=>b.fake).length}/${a.length}`})()}`);
if (LAST){ console.log('\n[5] 마지막 거래일 종목별 시간표 (15분마다 판정 · 진입=다음 5분봉 시가)');
  for (const [t, a] of Object.entries(tl)){ console.log(`  ${t}`); a.forEach(x => console.log('    ' + x)); } }
