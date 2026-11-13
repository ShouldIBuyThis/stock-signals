#!/usr/bin/env node
/**
 * 주봉·월봉 × 기존 신호 교집합 연구용 — 그날 화면 신호 내보내기 (docs/2026-11-13-mtf-cross.md · 읽기 전용)
 * 화면 코드 그대로(H.loadPage → normalize → histStocks·evaluate·multiSignalRank·sbDailyTier·sbItemsFor·prTrimSrc). 재구현 없음.
 * 나스닥 💡(날짜별)·VXN 채우기는 tools/gold-3y-lab.js와 같은 방식. 장중 5분 ▲는 3년에 걸 수 없어 황금신호는 '일봉 부분'만.
 * 출력: {fields, rows:[[t,d,ph,sb,rev,cau,gold,trim,lev,cat,kr,f3,f5,f10,f20,f60]...]} — 실적 영향권 날은 뺀다.
 * 사용: node tools/mtf-export.js backtest/raw.json /tmp/mtf.json
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8'), outPath = process.argv[3] || '/tmp/mtf.json';
const page = H.loadPage();
page.runInPage(`this.__run = j => { const RAW = JSON.parse(j); state.data = normalize(RAW); const byDate = new Map(), out = [];
  const QT = {}; try { const q = qqqBenchmarkStock(), qh = histStocks(q) || [], vx = (RAW.macro && RAW.macro.vxn) || {}, br = breadthByDate();
    let streak = 0; qh.forEach((h, i) => { const p = i ? qh[i-1] : null; streak = p && has(h.price) && has(p.price) && h.price < p.price ? streak + 1 : 0;
      const g = qqqTierRule(streak, num(vx[h.last_date]), p ? num(vx[p.last_date]) : null, br[h.last_date] ?? null); QT[h.last_date] = g.bulb ? 3 : g.tier; }); } catch(e){}
  allStocks().forEach(s => { if (s._benchmark) return; const hs = histStocks(s); if (!hs) return; const ew = earningsWindowsForValidation(s, hs);
    hs.forEach((h, i) => { if (!h.last_date || !has(h.price) || ew.blocked.has(h.last_date)) return;
      const row = Object.assign({}, s, h); if (i > 0) withPrev(row, hs[i-1]);
      if (!has(row.market_vxn) && !/\\.(KS|KQ)$/.test(s.ticker)){ const v = num(((RAW.macro && RAW.macro.vxn) || {})[h.last_date]); if (has(v)) row.market_vxn = v; }
      row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null; row.sig = evaluate(row); row.earnings_hold = false; row.ext_pair = null; row._i = i; row._hs = hs;
      (byDate.get(h.last_date) || byDate.set(h.last_date, []).get(h.last_date)).push(row); }); });
  byDate.forEach((uni, d) => { const mm = new Map(multiSignalRank(uni).map(x => [x.ticker, x]));
    uni.forEach(r => { const hs = r._hs, i = r._i, kr = /\\.(KS|KQ)$/.test(r.ticker);
      const f = n => hs[i+n] && has(hs[i+n].price) ? +((hs[i+n].price / r.price - 1) * 100).toFixed(3) : null;
      const tier = sbDailyTier(r, mm); let bull = false; try { bull = sbItemsFor(r, {main:true}).some(x => !x.site && !x.noGold && (x.kind === 'green' || x.kind === 'blue')); } catch(e){}
      const gold = !!tier && bull && (kr ? (has(r.bb_pos) && r.bb_pos <= 10) : (QT[d] === 3 || tier === '💡 강한다중'));
      let trim = []; try { trim = [...new Set(prTrimSrc(r).map(x => x.k))]; } catch(e){}
      const ph = r.market_level || 'none', g5 = r.sig.grade === 5;
      out.push([r.ticker, d, ph, g5 ? 1 : 0, g5 && r.sig.revGrade === 5 ? 1 : 0, g5 && ph === 'caution' && !kr ? 1 : 0, gold ? 1 : 0, trim.join('|'),
        num(LEVERAGED[r.ticker]) || (LEVERAGED[r.ticker] ? 3 : 1), r.category || '기타', kr ? 1 : 0, f(3), f(5), f(10), f(20), f(60)]); }); });
  return out; };`);
const rows = page.__run(raw);
fs.writeFileSync(outPath, JSON.stringify({ fields: ['t', 'd', 'ph', 'sb', 'rev', 'cau', 'gold', 'trim', 'lev', 'cat', 'kr', 'f3', 'f5', 'f10', 'f20', 'f60'], rows }));
const c = k => rows.filter(r => r[k]).length;
console.log(`내보냄 ${rows.length}행 · 종목 ${new Set(rows.map(r => r[0])).size} · 강한매수 ${c(3)} · 반등형 ${c(4)} · 주의장 강매 ${c(5)} · 황금(일봉) ${c(6)} · 일부익절 ${rows.filter(r => r[7]).length} → ${outPath}`);
