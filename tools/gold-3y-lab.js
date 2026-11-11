#!/usr/bin/env node
/**
 * 🏆 황금신호의 '일봉 쪽'(강한매수·다중·💡 ∩ 상승 캔들패턴) 3년 백테스트 — 2026-11-11 사용자 질문
 * "3년치 황금은 훨씬 높을 것 같은데, 다중이 70% 넘는데 교집합이 그것뿐이냐".
 * 장중 5분 ▲ 조건은 야후 5분봉이 60일뿐이라 3년에 걸 수 없다 → 여기서는 일봉 두 조건만 본다(장중은 60일 결과로 따로).
 * 화면 코드 그대로(H.loadPage → normalize → histStocks·evaluate·multiSignalRank·sbDailyTier·sbItemsFor). pat은 backfill hist의 그날 값.
 * 성과: 신호일 종가 확정 → 다음 날 시가 진입 → n거래일 뒤 종가. 상승 = 보합(정확히 0) 제외 비율, ±1% 방향 비율 병기.
 * 비교: 기준선(모든 종목·날) · 강한매수 전체 · 다중(💡 포함) · 💡 · 캔들패턴만(등급 무관) · 교집합. 반쪽(§2) 같이.
 * 사용: node tools/gold-3y-lab.js backtest/raw.json   (lab-quick years=3 days=690)
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8');
const page = H.loadPage();
page.runInPage(`this.__run = j => { const RAW = JSON.parse(j); state.data = normalize(RAW); const byDate = new Map(), out = [];
  /* 나스닥 전용 등급(날짜별) — 화면 qqqTierRule() 그대로: 연속 하락(QQQ 종가) · VXN(그날·전날, backfill macro) · 바닥권(breadthByDate) */
  const QT = {}; try { const q = qqqBenchmarkStock(), qh = histStocks(q) || [], vx = (RAW.macro && RAW.macro.vxn) || {}, br = breadthByDate();
    let streak = 0; qh.forEach((h, i) => { const p = i ? qh[i-1] : null; streak = p && has(h.price) && has(p.price) && h.price < p.price ? streak + 1 : 0;
      const g = qqqTierRule(streak, num(vx[h.last_date]), p ? num(vx[p.last_date]) : null, br[h.last_date] ?? null); QT[h.last_date] = g.bulb ? 3 : g.tier; }); } catch(e){}
  allStocks().forEach(s => { const hs = histStocks(s); if (!hs) return; const ew = earningsWindowsForValidation(s, hs);
    hs.forEach((h, i) => { if (!h.last_date || !has(h.price)) return;
      const row = Object.assign({}, s, h); if (i > 0) withPrev(row, hs[i-1]); row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null;
      row.sig = evaluate(row); row.earnings_hold = false; row.ext_pair = null; row._i = i; row._hs = hs; row._blk = ew.blocked.has(h.last_date);
      (byDate.get(h.last_date) || byDate.set(h.last_date, []).get(h.last_date)).push(row); }); });
  byDate.forEach((uni, d) => { const ok = uni.filter(r => !r._blk); const mm = new Map(multiSignalRank(ok).map(x => [x.ticker, x]));
    uni.forEach(r => { const hs = r._hs, i = r._i, o1 = hs[i+1] && has(hs[i+1].open) ? hs[i+1].open : null;
      const f = n => o1 && hs[i+n] && has(hs[i+n].price) ? (hs[i+n].price/o1 - 1)*100 : null;
      let tier = null, bull = false; if (!r._blk){ tier = sbDailyTier(r, mm); try { bull = sbItemsFor(r, {main:true}).some(x => !x.site && (x.kind === 'green' || x.kind === 'blue')); } catch(e){} }
      out.push({ d, t: r.ticker, kr: /\\.(KS|KQ)$/.test(r.ticker), blk: r._blk, g: r.sig.grade, tier, bull, qt: QT[d] ?? null, f3: f(3), f5: f(5), f10: f(10) }); }); });
  return out; };`);
const R = page.__run(raw);
const days = [...new Set(R.map(r => r.d))].sort(), MID = days[Math.floor(days.length/2)];
const hasOpen = R.filter(r => r.f3 != null).length;
console.log(`${days[0]}~${days[days.length-1]} · ${days.length}거래일 · 종목·날 ${R.length} · 다음날 시가 있는 행 ${hasOpen} · 반쪽 ${MID}`);
if (!hasOpen) { console.log('⚠ hist에 open 열이 없어 다음 날 시가 진입을 계산할 수 없음'); process.exit(0); }
const st = (a, k) => { const v = a.map(r => r[k]).filter(x => x != null); if (!v.length) return '—'; const u = v.filter(x => x > 0).length, dn = v.filter(x => x < 0).length, u1 = v.filter(x => x > 1).length, d1 = v.filter(x => x < -1).length;
  return `${String(Math.round(u/(u+dn)*100)).padStart(3)}% [±1% ${u1 + d1 ? Math.round(u1/(u1+d1)*100) : '—'}%] ${(v.reduce((s, x) => s + x, 0)/v.length).toFixed(2).padStart(6)}% (${v.length})`; };
const row = (nm, a) => { const half = w => { const z = a.filter(r => (r.d < MID) === (w === 0)), v = z.map(r => r.f3).filter(x => x != null), u = v.filter(x => x > 0).length, dn = v.filter(x => x < 0).length; return u + dn ? `${Math.round(u/(u+dn)*100)}%(${v.length})` : '—'; };
  console.log(`${nm.padEnd(26)} 3일 ${st(a, 'f3')} | 5일 ${st(a, 'f5')} | 10일 ${st(a, 'f10')} | 3일 반쪽 ${half(0)}/${half(1)}`); };
for (const [mn, mf] of [['전체', () => true], ['미장', r => !r.kr], ['국장', r => r.kr]]){
  const A = R.filter(r => !r.blk && mf(r)); console.log(`\n■ ${mn}  (상승 = 보합 제외 · [±1% 방향] · 평균 · (n))`);
  row('기준선(모든 날)', A); row('캔들패턴만(상승 🟢🔵)', A.filter(r => r.bull));
  row('강한매수 전체', A.filter(r => r.g === 5)); row('다중(💡 포함)', A.filter(r => r.tier === '다중신호' || r.tier === '💡 강한다중')); row('💡 강한다중', A.filter(r => r.tier === '💡 강한다중'));
  row('일봉 등급(셋 중 하나)', A.filter(r => r.tier)); row('🏆 일봉 ∩ 캔들 (황금 일봉 쪽)', A.filter(r => r.tier && r.bull));
  row('  └ 등급만, 캔들 없음', A.filter(r => r.tier && !r.bull));
  if (mn === '미장'){
    const Q = A.filter(r => r.qt != null), qn = k => Q.filter(r => r.qt >= k);
    console.log(`  · 나스닥 전용 등급 있는 행 ${Q.length} (강한 매수 우위 이상 날 ${new Set(qn(2).map(r => r.d)).size}일 · 💡 ${new Set(Q.filter(r => r.qt === 3).map(r => r.d)).size}일)`);
    row('나스닥 강한우위+ 날 기준선', qn(2)); row('나스닥 매수우위+ 날 기준선', qn(1));
    row('등급 ∩ 나스닥 강한우위+', qn(2).filter(r => r.tier));
    row('🏆 등급∩캔들∩나스닥 강한우위+', qn(2).filter(r => r.tier && r.bull));
    row('  └ 같은 조합, 나스닥 매수우위+', qn(1).filter(r => r.tier && r.bull));
    row('  └ 같은 조합, 나스닥 💡만', Q.filter(r => r.qt === 3 && r.tier && r.bull));
    row('  └ 지워지는 쪽 (나스닥 중립)', Q.filter(r => r.qt === 0 && r.tier && r.bull));
  }
}
