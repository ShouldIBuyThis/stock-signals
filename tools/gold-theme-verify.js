#!/usr/bin/env node
/**
 * 황금 × 국면별 고적중 조합 — 화면 함수(gkRegime·gkThemeConds·gkGroupConds·gkMatch)를 실제 과거 날짜에 돌려 검사(2026-11-12 사용자 지시).
 * ① 원장 황금 사건(backtest/gold-cases.json · 실제로 화면에 뜬 날 포함)의 그날 국면·조건·일치 조합
 * ② 연구 도구가 고른 사건(국면별 예시)과 화면 함수 결과가 같은지
 * ③ 미래 누수: 그날 이후 자료를 잘라 낸 뒤 다시 계산해도 같은지(국면·테마·4그룹)
 * 강제로 넣은 값 없음 — 전부 원본 시세(백필)와 연구 JSON 그대로. 사용: node tools/gold-theme-verify.js backtest/raw.json
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8');
const page = H.loadPage();
page.raw = raw; page.gb = fs.readFileSync('backtest/group-breadth.json', 'utf8'); page.ap = fs.readFileSync('backtest/gold-theme-apply.json', 'utf8');
page.cases = fs.readFileSync('backtest/gold-cases.json', 'utf8');
const R = page.runInPage(`(() => { state.data = normalize(JSON.parse(raw)); GROUP_BR = JSON.parse(gb); GOLD_TH = JSON.parse(ap);
  const C = JSON.parse(cases).events || [], out = { ledger: [], research: [], leak: [] };
  const find = t => allStocks().find(x => x.ticker === t);
  const at = (s, d) => Object.assign({}, s, { last_date: d });
  // ① 원장 황금 사건
  C.forEach(e => { const s = find(e.ticker); if (!s) return; const kr = /\\.(KS|KQ)$/.test(e.ticker), x = at(s, e.date);
    const rg = gkRegime(e.date, kr), G = gkGroupConds(e.date, kr), I = gkThemeConds(s.category || '기타', e.date, null);
    out.ledger.push({ d: e.date, t: e.ticker, src: e.src, tier: e.tier, rg, G, I: I ? { T_AB20: I.T_AB20 } : null, match: gkMatch(x).map(a => a.key) }); });
  // ② 연구 예시(국면별 조합의 최근 사건 — 연구 로그 그대로)
  [['2026-03-31', ['V', 'FXO', 'NVDA', 'JOBY', 'GOOGL', 'BULZ'], '하락', ['I:G_DEF', 'I:G_SP', 'I:G_NDX']],
   ['2024-08-15', ['JPM'], '상승', ['I:T_AB20']], ['2025-12-02', ['JPM'], '상승', ['I:T_AB20']], ['2026-01-12', ['CIEN'], '상승', ['I:T_AB20']],
   ['2026-06-08', ['FXO'], '상승', ['I:T_AB20']], ['2026-10-23', ['PLTR'], '상승', ['I:T_AB20']], ['2026-01-09', ['FNGU'], '상승', ['I:T_AB20']]].forEach(([d, ts, rgx, keys]) =>
    ts.forEach(t => { const s = find(t); if (!s) { out.research.push({ d, t, err: '종목 없음' }); return; } const m = gkMatch(at(s, d)).map(a => a.key);
      out.research.push({ d, t, rg: gkRegime(d, false), want_rg: rgx, want: keys, got: m, ok: gkRegime(d, false) === rgx && keys.every(k => m.includes(k)) }); }));
  // ③ 누수: 그날 이후 원장 행을 잘라 내고 다시 계산
  const snap = state.data.stocks.map(s => s._hist), qh = state.data.qqq_card && state.data.qqq_card.hist, gbFull = JSON.parse(gb);
  const cutTo = d => { const F = histFields(), iD = F.indexOf('date'); state.data.stocks.forEach((s, k) => { s._hist = (snap[k] || []).filter(r => !Array.isArray(r) || String(r[iD]) <= d); });
    if (qh) state.data.qqq_card.hist = qh.filter(r => !Array.isArray(r) || String(r[iD]) <= d);
    const i = gbFull.dates.findIndex(x => x > d); const n = i < 0 ? gbFull.dates.length : i; GROUP_BR = JSON.parse(JSON.stringify(gbFull));
    GROUP_BR.dates = GROUP_BR.dates.slice(0, n); ['NDX', 'SP', 'DEF'].forEach(g => { const o = GROUP_BR.groups[g]; if (o) ['n', 'nh', 'nl', 'ok'].forEach(k => { if (o[k]) o[k] = o[k].slice(0, n); }); });
    if (GROUP_BR.state_series) Object.keys(GROUP_BR.state_series).forEach(k => { GROUP_BR.state_series[k] = GROUP_BR.state_series[k].filter(x => x <= d); }); };
  const restore = () => { state.data.stocks.forEach((s, k) => { s._hist = snap[k]; }); if (qh) state.data.qqq_card.hist = qh; GROUP_BR = gbFull; };
  const sample = out.ledger.concat(out.research.filter(r => !r.err)).slice(0, 60);
  sample.forEach(r => { const s = find(r.t), kr = /\\.(KS|KQ)$/.test(r.t);
    const full = { rg: gkRegime(r.d, kr), G: JSON.stringify(gkGroupConds(r.d, kr)), I: JSON.stringify(gkThemeConds(s.category || '기타', r.d, null)) };
    cutTo(r.d); const cut = { rg: gkRegime(r.d, kr), G: JSON.stringify(gkGroupConds(r.d, kr)), I: JSON.stringify(gkThemeConds(allStocks().find(x => x.ticker === r.t).category || '기타', r.d, null)) }; restore();
    out.leak.push({ d: r.d, t: r.t, same: full.rg === cut.rg && full.G === cut.G && full.I === cut.I, full, cut }); });
  return out; })()`);
console.log('■ ① 원장 황금 사건(gold-cases.json) — 그날 국면 · 4그룹 · 일치 조합');
R.ledger.forEach(x => console.log(`  ${x.d} ${x.t.padEnd(10)} ${x.src || ''} ${x.tier || ''} | 국면 ${x.rg ?? '모름'} | 4그룹 ${JSON.stringify(x.G)} | 테마 20일선 증가 ${x.I ? x.I.T_AB20 : '자료 부족'} | 조합 ${x.match.join(', ') || '없음'}`));
console.log('\n■ ② 연구 예시와 화면 함수 일치'); R.research.forEach(x => console.log(`  ${x.d} ${x.t} ${x.err || `국면 ${x.rg}(연구 ${x.want_rg}) · 화면 ${x.got.join(',') || '없음'} · 연구 ${x.want.join(',')} → ${x.ok ? '일치' : '불일치'}`}`));
console.log(`  일치 ${R.research.filter(x => x.ok).length} / ${R.research.filter(x => !x.err).length}`);
console.log(`\n■ ③ 미래 누수 점검(그날 뒤 자료 잘라 다시 계산): ${R.leak.filter(x => x.same).length} / ${R.leak.length} 같음`);
R.leak.filter(x => !x.same).slice(0, 8).forEach(x => console.log('  다름', x.d, x.t, JSON.stringify(x.full).slice(0, 200), '→', JSON.stringify(x.cut).slice(0, 200)));
