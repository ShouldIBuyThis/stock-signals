#!/usr/bin/env node
/**
 * 바닥권 해제(v21) 경로 재검증 (사전 등록 docs/2026-11-18-bottom-relief.md · 읽기 전용 · 산식 불변)
 * 같은 원본을 화면 함수로 네 번 판정: 현행 / K0 둘 다 끔 / K1 관문만 끔 / K2 감점만 끔(메모리 사본 patch만 · 재구현 없음).
 * X = 현행만 강한매수(그 해제로 들어온 표본) · R = 나머지 강한매수. 대상 국면: 주의장(미국) · 약세장(미국).
 * 사용: node tools/bottom-relief-lab.js backtest/raw.json [--recent 756] [--since YYYY-MM-DD]
 */
const fs = require('fs'), H = require('./_harness');
const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'signals.json', raw = fs.readFileSync(file, 'utf8');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const RECENT = +arg('--recent', 756), SINCE = arg('--since', '2026-11-14');
const A_BB = 'const bottomBreadth = has(s.market_breadth) && s.market_breadth < 30;', A_MG = 'const marketGuarded = !bottomBreadth && (', A_FR = 'const fearRelief = vxnFear || bottomBreadth;';
const A_R2 = 's.market_ret20 >= -2)));';
const VAR = { K0: [[A_BB, 'const bottomBreadth = false;']], K1: [[A_MG, 'const marketGuarded = (']], K2: [[A_FR, 'const fearRelief = vxnFear;']],
  K3: [[A_BB, 'const bottomBreadth = false;'], [A_R2, 's.market_ret20 >= 1e9)));']], K4: [[A_MG, 'const marketGuarded = ('], [A_R2, 's.market_ret20 >= 1e9)));']] };
const VNM = { K0: '바닥권 해제 둘 다 끔', K1: '바닥권 관문 해제만 끔', K2: '바닥권 감점 해제만 끔', K3: '바닥권 해제 + −2% 완화 모두 끔', K4: '관문 완전 복원(바닥권 관문 + −2% 완화 끔 · 감점 해제는 유지)' };
const COLLECT = `this.__c = j => { state.data = normalize(JSON.parse(j)); const out = [], BR = breadthByDate();
  allStocks().forEach(s => { if (s._benchmark || isKR(s.ticker)) return; const hs = histStocks(s); if (!hs) return; const ew = earningsWindowsForValidation(s, hs);
    hs.forEach((h, i) => { if (!h.last_date || !has(h.price)) return; const row = Object.assign({}, s, h); if (i > 0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null; row.sig = evaluate(row); if (ew.blocked.has(h.last_date)) return;
      const rets = {}; [1, 3, 5, 10].forEach(n => { if (i + n < hs.length && has(hs[i+n].price) && !validationWindowTouchesEarnings(ew.affected, hs, i, n)) rets[n] = (hs[i+n].price / row.price - 1) * 100; });
      out.push([s.ticker, h.last_date, row.market_level || 'none', row.sig.grade, s.category || '기타', has(row.market_ret20) ? row.market_ret20 : null, rets,
        has(row.market_breadth) ? row.market_breadth : null, has(row.market_vxn) ? row.market_vxn : null]); }); });
  const q = qqqBenchmarkStock(), qh = (q && histStocks(q)) || [], qp = {}; qh.forEach((h, i) => { const r = {}; [1, 3, 5, 10].forEach(n => { if (i + n < qh.length && has(qh[i+n].price) && has(h.price)) r[n] = (qh[i+n].price / h.price - 1) * 100; }); qp[String(h.last_date)] = r; });
  return JSON.stringify({ out, qp, br: BR }); };`;
const run = patch => { const P = H.loadPage({ patch }); P.runInPage(COLLECT); return JSON.parse(P.__c(raw)); };
const A = run([]), G = {}; Object.entries(VAR).forEach(([k, p]) => { const B = run(p); G[k] = new Map(B.out.map(r => [r[0] + '|' + r[1], r[3]])); });
const rows = A.out.map(r => ({ t: r[0], d: r[1], ph: r[2], g: r[3], cat: r[4], nq: r[5], rets: r[6], br: r[7], vx: r[8], k: Object.fromEntries(Object.keys(VAR).map(k => [k, G[k].get(r[0] + '|' + r[1])])) }));
const QP = A.qp, BRD = A.br || {}, dates = [...new Set(rows.map(r => r.d))].sort(), CUT = dates[Math.max(0, dates.length - RECENT)];
const bd = Object.keys(BRD).sort(), brChg = d => { const i = bd.indexOf(d); return i >= 5 && BRD[bd[i]] != null && BRD[bd[i - 5]] != null ? BRD[bd[i]] - BRD[bd[i - 5]] : null; };
const TK = [...new Set(rows.map(r => r.t))].sort(), SET = Object.fromEntries(TK.map((t, k) => [t, k % 2 ? 'B' : 'A']));
const st = (L, h) => { const a = L.map(r => r.rets[h]).filter(x => x != null), w = a.filter(x => x > 1).length, l = a.filter(x => x < -1).length; return { n: a.length, rate: w + l ? w / (w + l) : null, avg: a.length ? a.reduce((s, x) => s + x, 0) / a.length : null }; };
const dw = (L, h) => { const by = {}; L.forEach(r => { const x = r.rets[h]; if (x == null || (x <= 1 && x >= -1)) return; (by[r.d] = by[r.d] || []).push(x > 1 ? 1 : 0); }); const v = Object.values(by).map(a => a.reduce((s, x) => s + x, 0) / a.length); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const pc = x => x == null ? '  —' : String(Math.round(x * 100)).padStart(3) + '%', sg = x => x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(2);
function cmp(nm, L, base, byDayCat) {
  if (!L.length) return `  ${nm}: 0건`;
  const ds = [...new Set(L.map(r => r.d))], sd = h => st(ds.flatMap(d => base[d] || []), h), sdw = dw(ds.flatMap(d => base[d] || []), 5);
  const sc = h => { const a = [], seen = new Set(); L.forEach(r => { const k = r.d + '|' + r.cat; if (seen.has(k)) return; seen.add(k); (byDayCat[k] || []).forEach(z => { if (z.t !== r.t) a.push(z); }); }); return st(a, h); };
  const ex = h => { const v = L.map(r => r.rets[h] != null && QP[r.d] && QP[r.d][h] != null ? r.rets[h] - QP[r.d][h] : null).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const dd = {}; L.forEach(r => dd[r.d] = (dd[r.d] || 0) + 1);
  return `  ${nm.padEnd(26)} +3/+5 ${pc(st(L, 3).rate)}/${pc(st(L, 5).rate)}(${st(L, 5).n}) 날짜가중 ${pc(dw(L, 5))} · 같은 날 ${pc(sd(3).rate)}/${pc(sd(5).rate)} 날짜가중 ${pc(sdw)} · 같은 섹터 ${pc(sc(3).rate)}/${pc(sc(5).rate)}`
    + ` · QQQ 초과 +5/+10 ${sg(ex(5))}/${sg(ex(10))} · A/B ${pc(st(L.filter(r => SET[r.t] === 'A'), 5).rate)}/${pc(st(L.filter(r => SET[r.t] === 'B'), 5).rate)} · ${ds.length}일 최대 ${Math.round(Math.max(...Object.values(dd)) / L.length * 100)}%`;
}
function block(tag, f) {
  for (const ph of ['caution', 'weak']) {
    const all = rows.filter(z => f(z) && z.ph === ph), sb = all.filter(z => z.g === 5), base = {}, bdc = {};
    all.forEach(r => { (base[r.d] = base[r.d] || []).push(r); (bdc[r.d + '|' + r.cat] = bdc[r.d + '|' + r.cat] || []).push(r); });
    const allSB = rows.filter(z => f(z) && z.g === 5);
    console.log(`\n■ ${tag} · ${ph === 'caution' ? '주의장' : '약세장'}(미국) 날 ${Object.keys(base).length} · 강한매수 ${sb.length} · 아무 종목 +3/+5 ${pc(st(all, 3).rate)}/${pc(st(all, 5).rate)}(${st(all, 5).n})`);
    for (const k of Object.keys(VAR)) {
      const X = sb.filter(z => z.k[k] !== 5), R = sb.filter(z => z.k[k] === 5), dsx = [...new Set(X.map(z => z.d))].sort(), mid = dsx[Math.floor(dsx.length / 2)];
      const keep = allSB.filter(z => !(z.ph === ph && z.k[k] !== 5)), gd = {}; X.forEach(z => gd[z.k[k]] = (gd[z.k[k]] || 0) + 1);
      console.log(`  ── ${k} ${VNM[k]}: X ${X.length} · R ${R.length} · X 강등 등급 ${JSON.stringify(gd)} · 철회 시 강한매수 전체 +5 ${pc(st(allSB, 5).rate)}(${st(allSB, 5).n}) → ${pc(st(keep, 5).rate)}(${st(keep, 5).n})`);
      console.log(cmp('X 해제로 들어온 것', X, base, bdc)); console.log(cmp('R 나머지', R, base, bdc));
      if (mid) { console.log(cmp(`X 앞 반(~${mid})`, X.filter(z => z.d < mid), base, bdc)); console.log(cmp('X 뒤 반', X.filter(z => z.d >= mid), base, bdc)); }
      if (k === 'K3') {
        [[0, 20], [20, 25], [25, 30]].forEach(([a, b]) => console.log(cmp(`진단 X 폭 ${a}~${b}%`, X.filter(z => z.br != null && z.br >= a && z.br < b), base, bdc)));
        console.log(cmp('진단 X 폭 5일 늘어남(바닥 확인)', X.filter(z => (brChg(z.d) ?? 0) > 0), base, bdc));
        console.log(cmp('진단 X 폭 5일 줄어듦(추락 중)', X.filter(z => (brChg(z.d) ?? 0) < 0), base, bdc));
        console.log(cmp('진단 X VXN≥25 동반', X.filter(z => z.vx != null && z.vx >= 25), base, bdc));
        console.log(cmp('진단 X VXN<25', X.filter(z => !(z.vx != null && z.vx >= 25)), base, bdc));
        console.log(cmp('진단 X 나스닥20일 < −5%', X.filter(z => z.nq != null && z.nq < -5), base, bdc));
        console.log(cmp('진단 X 나스닥20일 ≥ −5%', X.filter(z => z.nq != null && z.nq >= -5), base, bdc));
      }
    }
  }
}
console.log(`${file} · ${dates[0]}~${dates[dates.length - 1]} · ${dates.length}거래일 · 최근 경계 ${CUT}`);
if (dates.length > RECENT + 100) { block(`독립(~${CUT} 이전)`, z => z.d < CUT); block(`최근 ${RECENT}거래일`, z => z.d >= CUT); } else block('전 기간', () => true);
block(`미사용 전진(${SINCE}~)`, z => z.d >= SINCE);
