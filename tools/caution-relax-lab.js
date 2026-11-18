#!/usr/bin/env node
/**
 * 주의장 −2% 완화 경로 재검증 (사전 등록 docs/2026-11-18-caution-relax.md · 읽기 전용 · 산식 불변)
 * 같은 원본을 화면 함수로 두 번 판정한다: 현행 / 메모리 사본에서 완화만 끈 것(`market_ret20 >= -2` → 성립 불가). 재구현 없음.
 * R = 완화를 꺼도 강한매수 · X = 완화 때문에 강한매수(강등 등급 같이). 기준선 = 같은 날 주의장 아무 종목 · 같은 날 같은 섹터 · QQQ.
 * 사용: node tools/caution-relax-lab.js backtest/raw.json [--recent 756] [--since YYYY-MM-DD]
 */
const fs = require('fs'), H = require('./_harness');
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'signals.json', raw = fs.readFileSync(file, 'utf8');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const RECENT = +arg('--recent', 756), SINCE = arg('--since', '2026-11-14');
const ANCHOR = 's.market_ret20 >= -2)));';
const COLLECT = `this.__c = j => { state.data = normalize(JSON.parse(j)); const out = [];
  allStocks().forEach(s => { if (s._benchmark || isKR(s.ticker)) return; const hs = histStocks(s); if (!hs) return; const ew = earningsWindowsForValidation(s, hs);
    hs.forEach((h, i) => { if (!h.last_date || !has(h.price)) return; const row = Object.assign({}, s, h); if (i > 0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null; row.sig = evaluate(row); if (ew.blocked.has(h.last_date)) return;
      const rets = {}; [1, 3, 5, 10].forEach(n => { if (i + n < hs.length && has(hs[i+n].price) && !validationWindowTouchesEarnings(ew.affected, hs, i, n)) rets[n] = (hs[i+n].price / row.price - 1) * 100; });
      out.push([s.ticker, h.last_date, row.market_level || 'none', row.sig.grade, s.category || '기타', has(row.market_ret20) ? row.market_ret20 : null, rets, has(row.market_breadth) && row.market_breadth < 30 ? 1 : 0, DEFENSIVE_CATS.includes(s.category) ? 1 : 0]); }); });
  const q = qqqBenchmarkStock(), qh = (q && histStocks(q)) || [], qp = {}; qh.forEach((h, i) => { const r = {}; [1, 3, 5, 10].forEach(n => { if (i + n < qh.length && has(qh[i+n].price) && has(h.price)) r[n] = (qh[i+n].price / h.price - 1) * 100; }); qp[String(h.last_date)] = r; });
  return JSON.stringify({ out, qp }); };`;
const P0 = H.loadPage(); P0.runInPage(COLLECT); const A = JSON.parse(P0.__c(raw));
const P1 = H.loadPage({ patch: [[ANCHOR, 's.market_ret20 >= 1e9)));']] }); P1.runInPage(COLLECT); const B = JSON.parse(P1.__c(raw));
const g1 = new Map(B.out.map(r => [r[0] + '|' + r[1], r[3]]));
const rows = A.out.map(r => ({ t: r[0], d: r[1], ph: r[2], g: r[3], cat: r[4], nq: r[5], rets: r[6], bb: r[7], def: r[8], g1: g1.get(r[0] + '|' + r[1]) }));
const QP = A.qp, dates = [...new Set(rows.map(r => r.d))].sort(), CUT = dates[Math.max(0, dates.length - RECENT)];
const cau = rows.filter(r => r.ph === 'caution'), sb = cau.filter(r => r.g === 5), R = sb.filter(r => r.g1 === 5), X = sb.filter(r => r.g1 !== 5);
const TK = [...new Set(rows.map(r => r.t))].sort(), SET = Object.fromEntries(TK.map((t, k) => [t, k % 2 ? 'B' : 'A']));
const st = (L, h) => { const a = L.map(r => r.rets[h]).filter(x => x != null), w = a.filter(x => x > 1).length, l = a.filter(x => x < -1).length;
  return { n: a.length, rate: w + l ? w / (w + l) : null, avg: a.length ? a.reduce((s, x) => s + x, 0) / a.length : null }; };
const byDay = {}, byDayCat = {}; cau.forEach(r => { (byDay[r.d] = byDay[r.d] || []).push(r); (byDayCat[r.d + '|' + r.cat] = byDayCat[r.d + '|' + r.cat] || []).push(r); });
const sameDay = (L, h) => st([...new Set(L.map(r => r.d))].flatMap(d => byDay[d] || []), h);
const sameCat = (L, h) => { const a = [], seen = new Set(); L.forEach(r => { const k = r.d + '|' + r.cat; if (seen.has(k)) return; seen.add(k); (byDayCat[k] || []).forEach(z => { if (z.t !== r.t) a.push(z); }); }); return st(a, h); };
const exQ = (L, h) => { const v = L.map(r => r.rets[h] != null && QP[r.d] && QP[r.d][h] != null ? r.rets[h] - QP[r.d][h] : null).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const pc = x => x == null ? '  —' : String(Math.round(x * 100)).padStart(3) + '%', sg = x => x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2);
const cell = s => `${pc(s.rate)}(${String(s.n).padStart(4)}) ${sg(s.avg)}`;
const line = (nm, L) => `  ${nm.padEnd(30)} ${[1, 3, 5, 10].map(h => cell(st(L, h))).join(' | ')} · ${new Set(L.map(r => r.d)).size}일`;
const cmp = (nm, L) => { if (!L.length) return `  ${nm}: 0건`; const dd = {}; L.forEach(r => dd[r.d] = (dd[r.d] || 0) + 1); const mx = Math.max(...Object.values(dd));
  return `  ${nm.padEnd(30)} +3/+5 ${pc(st(L, 3).rate)}/${pc(st(L, 5).rate)} · 같은 날 주의장 ${pc(sameDay(L, 3).rate)}/${pc(sameDay(L, 5).rate)} · 같은 날 같은 섹터 ${pc(sameCat(L, 3).rate)}/${pc(sameCat(L, 5).rate)}`
    + ` · QQQ 초과 +5/+10 ${sg(exQ(L, 5))}/${sg(exQ(L, 10))} · A/B +5 ${pc(st(L.filter(r => SET[r.t] === 'A'), 5).rate)}/${pc(st(L.filter(r => SET[r.t] === 'B'), 5).rate)} · 최대 날짜 비중 ${Math.round(mx / L.length * 100)}%`; };
function block(tag, f) {
  const c = cau.filter(f), s = sb.filter(f), r = R.filter(f), x = X.filter(f), allSB = rows.filter(z => z.g === 5 && f(z)), keep = allSB.filter(z => !(z.ph === 'caution' && z.g1 !== 5));
  const ds = [...new Set(s.map(z => z.d))].sort(), mid = ds[Math.floor(ds.length / 2)];
  console.log(`\n■ ${tag} · 주의장(미국) 날 ${new Set(c.map(z => z.d)).size} · 강한매수 ${s.length} = R ${r.length} + X ${x.length} · +1 | +3 | +5 | +10 (승률(표본) 평균%)`);
  console.log(line('주의장 아무 종목', c)); console.log(line('주의장 강한매수 전체', s)); console.log(line('R 원래도 강한매수', r)); console.log(line('X 완화로 추가', x));
  console.log(`  R 이유: 바닥권(20일선 위 30% 미만) 해제 ${r.filter(z => z.bb).length} · 방어 섹터 ${r.filter(z => !z.bb && z.def).length} · 그 밖 ${r.filter(z => !z.bb && !z.def).length}`);
  console.log(cmp('R 원래도', r)); console.log(cmp('R 중 바닥권 해제', r.filter(z => z.bb))); console.log(cmp('X 완화로 추가', x));
  if (mid) { console.log(cmp(`X 앞 반(~${mid})`, x.filter(z => z.d < mid))); console.log(cmp('X 뒤 반', x.filter(z => z.d >= mid))); }
  const gd = {}; x.forEach(z => gd[z.g1] = (gd[z.g1] || 0) + 1); console.log(`  X를 완화 없이 판정하면 등급: ${JSON.stringify(gd)}`);
  [[-2, -1], [-1, 0], [0, 2], [2, 99]].forEach(([a, b]) => { const L = x.filter(z => z.nq != null && z.nq >= a && z.nq < b); console.log(cmp(`X 나스닥20일 ${a}~${b === 99 ? '' : b}%`, L)); });
  const cats = {}; x.forEach(z => (cats[z.cat] = cats[z.cat] || []).push(z));
  console.log('  X 섹터(5건↑): ' + Object.entries(cats).filter(([, L]) => L.length >= 5).sort((a, b) => b[1].length - a[1].length).map(([k, L]) => `${k} ${pc(st(L, 5).rate)}(${st(L, 5).n}) vs 같은 섹터 ${pc(sameCat(L, 5).rate)}`).join(' · '));
  console.log(`  철회 시뮬레이션: 강한매수 전체 +5 ${cell(st(allSB, 5))} → X 강등 뒤 ${cell(st(keep, 5))}`);
}
console.log(`${file} · ${dates[0]}~${dates[dates.length - 1]} · ${dates.length}거래일 · 최근 경계 ${CUT} · 완화 끈 사본 앵커 '${ANCHOR}'`);
block('전 기간', () => true);
if (dates.length > RECENT + 100) { block(`독립(~${CUT} 이전)`, z => z.d < CUT); block(`최근 ${RECENT}거래일`, z => z.d >= CUT); }
block(`미사용 전진(${SINCE}~)`, z => z.d >= SINCE);
