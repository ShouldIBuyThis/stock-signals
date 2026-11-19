#!/usr/bin/env node
/**
 * 앞설 테마 재설계 연구용 내보내기(docs/2026-11-18-theme-redesign.md · 읽기 전용).
 * 화면 함수 그대로: themeStocks · themeDailyRows(5·10) · themeRowsAt · themeMultiRank(현행 TOP3) · evaluate · prTrimSrc.
 * 출력: {dates, rows:{d:[[name,n,m20,br,r5,score,f5,f10,c5,c10]...]}, v0:{d:[3]}, members:{theme:[[t,levX,kr]]}, sig:{t:{d:[sb,trim]}}, qqq:{d:price}, px:{t:{d:price}}(미국·레버리지 아님)}
 * 사용: node tools/theme-redesign-export.js backtest/raw.json /tmp/theme.json
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8'), outPath = process.argv[3] || '/tmp/theme.json';
const page = H.loadPage();
page.runInPage(`this.__x = j => { state.data = normalize(JSON.parse(j));
  const D5 = themeDailyRows(themeStocks(), 5), D10 = themeDailyRows(themeStocks(), 10), dates = D5.map(x => x.d);
  const rows = {}, v0 = {};
  D5.forEach((x, i) => { const m10 = new Map(D10[i].rows.map(r => [r.name, r]));
    rows[x.d] = x.rows.map(r => { const q = m10.get(r.name) || {}; return [r.name, r.n, r.m20, r.br, r.r5, r.score, has(r.fwd) ? r.fwd : null, has(q.fwd) ? q.fwd : null, r.complete ? 1 : 0, q.complete ? 1 : 0]; });
    v0[x.d] = x.rows.length >= 5 ? themeMultiRank(x.rows).slice(0, 3).map(t => t.name) : []; });
  const members = {}, sig = {};
  themeStocks().filter(s => !s._benchmark && !CONGRESS_TICKERS.has(s.ticker) && (!isKR(s.ticker) || THEME_ONLY_TICKERS.has(s.ticker))).forEach(s => {
    (members[s.category || '기타'] = members[s.category || '기타'] || []).push([s.ticker, levX(s.ticker), isKR(s.ticker) ? 1 : 0]);
    const hs = histStocks(s) || [], ew = earningsWindowsForValidation(s, hs), o = {};
    hs.forEach((h, i) => { if (!h.last_date || !has(h.price)) return; const row = Object.assign({}, s, h); if (i > 0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null; row.sig = evaluate(row); row.ext_pair = null;
      let tr = 0; try { tr = prTrimSrc(row).length ? 1 : 0; } catch(e){}
      o[String(h.last_date)] = [ew.blocked.has(h.last_date) ? null : (row.sig.grade === 5 ? 1 : 0), tr]; });
    sig[s.ticker] = o; });
  const px = {}; themeStocks().forEach(s => { if (s._benchmark || CONGRESS_TICKERS.has(s.ticker) || isKR(s.ticker) || LEVERAGED[s.ticker]) return;
    const o = {}; (histStocks(s) || []).forEach(h => { if (has(h.price)) o[String(h.last_date)] = h.price; }); px[s.ticker] = o; });   // 2026-11-19 TOP5 확률 연구: 테마 경로(+1% 도달)용
  const q = qqqBenchmarkStock(), qq = {}; ((q && histStocks(q)) || []).forEach(h => { if (has(h.price)) qq[String(h.last_date)] = h.price; });
  return JSON.stringify({ dates, rows, v0, members, sig, qqq: qq, px }); };`);
const s = page.__x(raw); fs.writeFileSync(outPath, s); const X = JSON.parse(s);
console.log(`내보냄 ${X.dates.length}일 (${X.dates[0]}~${X.dates[X.dates.length - 1]}) · 테마 ${Object.keys(X.members).length} · 종목 ${Object.values(X.members).flat().length} → ${outPath} (${(s.length / 1e6).toFixed(1)}MB)`);
