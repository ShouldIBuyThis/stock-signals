/**
 * 하루 장중 신호 감사 — 2026-11-09 사용자 요청(국장 KODEX 200·코스닥150 오늘 성과). 결과 보기 전 정의 고정.
 *
 * ⚠ 실제 '화면 표시 기록'은 없다(사이트·Worker 모두 기록을 남기지 않는다). 이 도구는 그날 확정 5분봉을 시간순으로
 *   다시 넣어 화면과 같은 idMtf()(index.html에서 추출)로 **재계산**한 것이다 — 실제 표시 기록이 아니다.
 *   야후는 봉을 사후 수정할 수 있어, 그 시각 화면 값과 다를 수 있다.
 *
 * 정의
 * - 판정 시각 τ = 5분 경계마다. τ 이전에 끝난(시작+5분 ≤ τ) 봉만 넣는다(미래·미확정 봉 차단). lastTrade = τ.
 * - 신호 = 상태가 go(🟢 5분 재돌파 확인 → '매수 쪽') 또는 down(🔵 하락 주의 → '매도 쪽')으로 **새로 바뀐** 순간(같은 상태 지속은 중복으로 안 셈).
 * - ① 봉 시각 기준(지표 예측력): 진입 = τ에 시작하는 5분봉 시가.
 *   ② 사용자 확인 시각 기준(실전): 야후 국장 지연 D분(기본 20 — Worker 실측) 뒤 화면에 보인다고 보고, 진입 = τ+D에 시작하는 5분봉 시가.
 *     ②-보수: D+10(중계 서버 캐시 최대 10분)도 따로 본다.
 * - 평가: 진입 뒤 +5·+15·+30·+60분(그 시각에 끝나는 봉의 종가)과 장 마감(그날 마지막 봉 종가). 장이 끝나 그 시각이 없으면 '미평가'.
 *   방향 적중 = 매수 쪽은 상승, 매도 쪽은 하락. 수익률은 매수 = 상승분, 매도 = 하락분(공매도·회피 관점, 부호를 뒤집음).
 * - MFE/MAE = 진입부터 장 마감까지 신호 방향 기준 최대 유리/불리 폭(고가·저가).
 * - 거래비용: 왕복 0.05%(수수료+호가 1틱 근사, ETF 매도세 면제) 기본 · 0.10% 민감도.
 * 사용: node tools/intraday-day-audit.js i5.json [--day=YYYY-MM-DD] [--delay=20]
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
vm.createContext(ctx);
vm.runInContext(['idLocal','idEma','idAgg','idMtf'].map(H.extractFunction).join('\n') + '\nthis.idMtf = idMtf;', ctx);
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const D0 = +(arg('delay') || 20), COST = [0.05, 0.10], HZ = [5, 15, 30, 60, 'close'];
const NAME = { go:'매수 쪽 · 🟢 5분 재돌파 확인', down:'매도 쪽 · 🔵 하락 주의' };
const hm = (ts, off) => new Date((ts + off)*1000).toISOString().slice(11, 16);
const all = [];
for (const [t, Dt] of Object.entries(data)){
  const days = []; let cur = null;
  for (const b of Dt.bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off:b[6], bars:[] }; days.push(cur); } cur.bars.push(b); }
  const want = arg('day') || days[days.length-1].day, di = days.findIndex(x => x.day === want);
  if (di < 4){ console.log(`${t}: ${want} 자료 없음 또는 앞선 4거래일 부족`); continue; }
  const today = days[di], off = today.off, B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300;
  const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
  console.log(`\n■ ${t} ${want} · 5분봉 ${B.length}개 (${hm(t0, off)}~${hm(end, off)}) · 재계산(실제 표시 기록 아님)`);
  let prev = null; const counts = {};
  for (let tau = t0 + 300; tau <= end; tau += 300){
    const seen = B.filter(b => b[0] + 300 <= tau).map(b => b.slice(0, 6));
    const A = ctx.idMtf({ gmtoffset: off, reg:{ start:t0, end }, lastTrade: tau, bars: hist.concat(seen) }, tau);
    if (!A) continue;
    counts[A.state] = (counts[A.state] || 0) + 1;
    const isNew = A.state !== prev; prev = A.state;
    if (!isNew || !NAME[A.state]) continue;
    const side = A.state === 'go' ? 1 : -1, last = seen[seen.length-1];
    const ev = { t, side, kind: A.state, bar: `${hm(last[0], off)}~${hm(last[0] + 300, off)}`, tau, sig: last[4], basis:{} };
    for (const [bk, dly] of [['①봉시각', 0], [`②확인(+${D0}분)`, D0], [`②보수(+${D0+10}분)`, D0 + 10]]){
      const et = tau + dly*60, ei = B.findIndex(b => b[0] === et);
      if (ei < 0){ ev.basis[bk] = { show: hm(et, off), na: true }; continue; }
      const entry = B[ei][1], r = {};
      for (const h of HZ){
        let px = null;
        if (h === 'close') px = B[B.length-1][4];
        else { const k = B.findIndex(b => b[0] + 300 === et + h*60); px = k >= 0 ? B[k][4] : null; }
        r[h] = px == null ? null : side * (px/entry - 1) * 100;
      }
      const fut = B.slice(ei);
      const mfe = side > 0 ? (Math.max(...fut.map(b => b[2]))/entry - 1)*100 : (1 - Math.min(...fut.map(b => b[3]))/entry)*100;
      const mae = side > 0 ? (Math.min(...fut.map(b => b[3]))/entry - 1)*100 : (1 - Math.max(...fut.map(b => b[2]))/entry)*100;
      ev.basis[bk] = { show: hm(et, off), entry, r, mfe, mae };
    }
    all.push(ev);
    const f = x => x == null ? '미평가' : (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
    console.log(`  ${NAME[A.state]} · 데이터 봉 ${ev.bar} (판정 ${hm(tau, off)}) · 당시 가격 ${ev.sig.toFixed(0)}`);
    for (const [bk, z] of Object.entries(ev.basis)){
      if (z.na){ console.log(`     ${bk.padEnd(12)} 표시 ${z.show} → 장 종료 뒤라 미평가`); continue; }
      console.log(`     ${bk.padEnd(12)} 표시 ${z.show} 진입 ${z.entry.toFixed(0)} · ` + HZ.map(h => `${h === 'close' ? '마감' : '+' + h + '분'} ${f(z.r[h])}`).join(' · ') + ` · MFE ${f(z.mfe)} MAE ${f(z.mae)}`);
    }
  }
  console.log('  상태별 5분 판정 횟수: ' + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · '));
}
console.log('\n■ 요약 (두 종목 합산 · 신호 단위) — 표본이 아주 적어 통계적 의미 없음(방법론 §5-1: 15건 미만 신뢰 불가)');
for (const side of [1, -1]){
  const E = all.filter(e => e.side === side);
  console.log(`\n  [${side > 0 ? '매수 쪽(🟢 5분 재돌파 확인)' : '매도 쪽(🔵 하락 주의)'}] 신호 ${E.length}건`);
  if (!E.length) continue;
  for (const bk of Object.keys(E[0].basis)){
    const cells = HZ.map(h => {
      const xs = E.map(e => e.basis[bk]).filter(z => z && !z.na && z.r[h] != null).map(z => z.r[h]);
      if (!xs.length) return `${h === 'close' ? '마감' : '+' + h + '분'} 미평가`;
      const hit = xs.filter(x => x > 0).length, avg = xs.reduce((a, b) => a + b, 0)/xs.length;
      const g = xs.filter(x => x > 0).reduce((a, b) => a + b, 0), l = -xs.filter(x => x < 0).reduce((a, b) => a + b, 0);
      return `${h === 'close' ? '마감' : '+' + h + '분'} n${xs.length} 적중 ${hit}/${xs.length} 평균 ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}% 손익비 ${l > 0 ? (g/l).toFixed(2) : (g > 0 ? '∞' : '—')} 비용차감 ${COST.map(c => (avg - c >= 0 ? '+' : '') + (avg - c).toFixed(2)).join('/')}%`;
    });
    console.log(`   ${bk}\n     ` + cells.join('\n     '));
  }
}
