#!/usr/bin/env node
/**
 * 🟡 일부익절 신호의 1·3·5거래일 뒤 '익절 적중률' — 2026-11-12 사용자 지시("일부익절은 1 3 5거래일뒤 승률로").
 * 고점판독기의 🟡 일부익절 불과 같은 출처를 화면 함수 그대로 쓴다(재구현 없음, H.loadPage):
 *   TAG_SPLIT  evaluate() 태그 "🔥 과열 분할익절" · TAG_CAUTION "⚠ 과열 — 익절 구간 주의"
 *   PAT_TRIM   patternBadges()의 "🟡 일부 익절 후보" · 오렌지 코드별(sbItemsFor kind==="orange": O_RSI·O_EXT·O_TURN·O_VOLSTALL·T_*·R_MA20·R_MA200)
 *   ANY        위 중 하나라도(화면의 불이 켜지는 조건)
 * 적중 = n거래일 뒤 종가가 신호일 종가보다 1% 넘게 낮음(익절이 맞음) · 1% 넘게 높으면 빗나감 · ±1% 안은 보합으로 뺀다(사이트 규칙).
 * 같은 종목·같은 출처는 3거래일 안 재발생 제외. 비교 = 같은 기간 모든 종목·날(평소에 1% 넘게 내린 비율).
 * 사용: node tools/trim-lab.js backtest/raw.json backtest/trim-stats.json   (backfill years=3)
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8'), outPath = process.argv[3] || '';
const page = H.loadPage();
page.runInPage(`this.__run = j => { const RAW = JSON.parse(j); state.data = normalize(RAW); const out = [];
  allStocks().forEach(s => { const hs = histStocks(s); if (!hs) return; const ew = earningsWindowsForValidation(s, hs);
    hs.forEach((h, i) => { if (!h.last_date || !has(h.price) || ew.blocked.has(h.last_date)) return;
      const row = Object.assign({}, s, h); if (i > 0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null; row.sig = evaluate(row); row.earnings_hold = false; row.ext_pair = null;
      const src = [];
      (row.sig.tags || []).forEach(t => { if (/분할익절/.test(t.t || "")) src.push("TAG_SPLIT"); else if (/익절/.test(t.t || "")) src.push("TAG_CAUTION"); });
      try { patternBadges(row).forEach(b => { if (b.key === "🟡 일부 익절 후보") src.push("PAT_TRIM"); }); } catch(e){}
      try { sbItemsFor(row, {main:true}).forEach(x => { if (x.kind === "orange") src.push("OR_" + x.code); }); } catch(e){}
      const f = n => hs[i+n] && has(hs[i+n].price) ? (hs[i+n].price / row.price - 1) * 100 : null;
      out.push({ t: s.ticker, d: h.last_date, i, src: [...new Set(src)], f1: f(1), f3: f(3), f5: f(5) }); }); });
  return out; };`);
const R = page.__run(raw);
const days = [...new Set(R.map(r => r.d))].sort(), MID = days[Math.floor(days.length / 2)];
const stat = rows => { const z = { n: rows.length, dates: new Set(rows.map(r => r.d)).size };
  for (const k of [1, 3, 5]) { const v = rows.map(r => r['f' + k]).filter(x => x != null), w = v.filter(x => x < -1).length, l = v.filter(x => x > 1).length;
    z['win' + k] = w + l ? Math.round(w / (w + l) * 1000) / 10 : null; z['avg' + k] = v.length ? Math.round(v.reduce((a, x) => a + x, 0) / v.length * 100) / 100 : null; z['tie' + k] = v.length ? Math.round((v.length - w - l) / v.length * 100) : null; }
  return z; };
const dedupe = key => { const last = {}, out = []; R.forEach(r => { if (!r.src.includes(key) && !(key === 'ANY' && r.src.length)) return; const k = r.t; if (last[k] != null && r.i - last[k] <= 3) return; last[k] = r.i; out.push(r); }); return out; };
const keys = ['ANY', 'TAG_SPLIT', 'TAG_CAUTION', 'PAT_TRIM', ...[...new Set(R.flatMap(r => r.src.filter(s => s.startsWith('OR_'))))].sort()];
const base = stat(R), res = { generated: new Date().toISOString().slice(0, 10), kind: 'research', period: [days[0], days[days.length - 1]], split: MID,
  rule: '적중 = n거래일 뒤 종가가 신호일 종가보다 1% 넘게 낮음 · ±1% 안 보합 제외 · 같은 종목·출처 3거래일 안 재발생 제외 · 실적 영향권 신호일 제외', base, src: {} };
console.log(`${days[0]}~${days[days.length - 1]} · ${days.length}거래일 · 종목·날 ${R.length} · 평소 1·3·5일 하락 ${base.win1}·${base.win3}·${base.win5}% (평균 ${base.avg1}·${base.avg3}·${base.avg5}%)`);
console.log('출처 | 사건(날) | 1·3·5일 익절 적중(하락) | 평소 대비 | 평균 수익 | 반쪽 5일 앞/뒤');
for (const k of keys) {
  const rows = dedupe(k); if (!rows.length) continue;
  const z = stat(rows), a = stat(rows.filter(r => r.d < MID)), b = stat(rows.filter(r => r.d >= MID));
  z.half5 = [a.win5, b.win5]; res.src[k] = z;
  const d = x => z['win' + x] == null || base['win' + x] == null ? '—' : `${z['win' + x] - base['win' + x] >= 0 ? '+' : ''}${(z['win' + x] - base['win' + x]).toFixed(1)}`;
  console.log(`  ${k.padEnd(14)} ${String(z.n).padStart(5)}(${String(z.dates).padStart(4)}) | ${z.win1}·${z.win3}·${z.win5}% | ${d(1)}·${d(3)}·${d(5)}%p | ${z.avg1}·${z.avg3}·${z.avg5}% | ${a.win5}/${b.win5}%`);
}
if (outPath) { fs.writeFileSync(outPath, JSON.stringify(res)); console.log('→ ' + outPath); }
