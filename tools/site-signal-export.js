#!/usr/bin/env node
/**
 * 사이트 신호 표본 내보내기 — 화면과 같은 strategyValidation()의 강한매수·반등·추세·다중 신호일(종목·날짜)만 JSON으로 (읽기 전용)
 * 왜 (2026-11-08 시장 폭 보조지표 연구): 신호 판정은 화면 산식 그대로 쓰고(§0), 결과·시장 폭은 tools/breadth-aux-lab.py가 가격으로 잰다.
 * 사용: node tools/site-signal-export.js backtest/raw.json out.json
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'signals.json', OUT = process.argv[3] || 'site-signals.json';
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
const F = base.hist_fields, iD = F.indexOf('date'), iV = F.indexOf('market_vxn'), VXN = ((base.macro || {}).vxn) || {};
if (iV >= 0) for (const s of base.stocks) for (const r of s.hist || []) { while (r.length <= iV) r.push(null); if (r[iV] == null && VXN[r[iD]] != null) r[iV] = +VXN[r[iD]]; }
const page = H.loadPage({});
page.runInPage(`this.__run = j => { state.data = normalize(JSON.parse(j)); const r = strategyValidation(); const o = {};
  ['strongBuy','rev','pull','multi'].forEach(k => { const seen = new Set(); o[k] = [];
    Object.values(r._phaseRows[k] || {}).forEach(list => (list||[]).forEach(x => { const key = x.ticker+'|'+x.date; if (!seen.has(key)) { seen.add(key); o[k].push([x.ticker, x.date]); } })); });
  return JSON.stringify(o); };`);
const out = JSON.parse(page.__run(JSON.stringify(base)));
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('사이트 신호 내보냄:', Object.entries(out).map(([k, v]) => `${k} ${v.length}`).join(' · '));
