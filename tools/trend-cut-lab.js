#!/usr/bin/env node
/**
 * 추세 강한매수 컷 R8·R10 재검증 + R3(RSI≤35) 보조 표시 성적 (사전 등록 docs/2026-11-17-preregistered.md §3 · 읽기 전용)
 * 화면 evaluate()(v22)를 그대로 돌려 강한매수 사건을 모은다(caution-lab.js와 같은 수집). 컷은 강한매수를 지우기만 하므로 사후 필터 = 산식 변경.
 * '추세 강한매수에만' = 추세 경로(pullGrade 5)로만 강한매수가 된 사건. 반등 경로(revGrade 5)도 5면 반등 경로가 그대로 강한매수로 남긴다.
 * QQQ 20일 수익률 = 그날 미국 종목 행의 market_ret20(QQQ 20일). 한국 종목도 같은 날짜의 QQQ 값을 쓴다.
 * 승률 = 보합(±1%) 제외 · 실적 영향권 제외 — strategyValidation과 같은 규칙.
 * 사용: node tools/trend-cut-lab.js backtest/raw.json
 */
const fs = require('fs'), H = require('./_harness');
const raw = JSON.parse(fs.readFileSync(process.argv[2] || 'signals.json', 'utf8'));
const ctx = H.buildContext({
  extra: ['qqqRsiOn', 'washoutLevel', 'competitionRank', 'strategyOrdinalRank', 'volumeOrdinalRank', 'rankMapsFor', 'rankOf',
          'previousOverallGrade', 'earningsWindowsForValidation', 'validationWindowTouchesEarnings'],
  tail: `this.collect = d => {
    state.data = normalize(d); const out = [];
    allStocks().forEach(s => {
      const hs = histStocks(s); if (!hs || !hs.length) return;
      const ew = earningsWindowsForValidation(s, hs);
      hs.forEach((r, i) => {
        if (!r.last_date || !r.price) return;
        if (i > 0) withPrev(r, hs[i - 1]);
        r._prevOverallGrade = i > 0 ? evaluate(hs[i - 1]).grade : null;
        r.sig = evaluate(r);
        if (ew.blocked.has(r.last_date)) return;
        const rets = {};
        for (const h of [1, 3, 5, 10]) {
          if (i + h >= hs.length || !hs[i + h].price) continue;
          if (validationWindowTouchesEarnings(ew.affected, hs, i, h)) continue;
          rets[h] = (hs[i + h].price / r.price - 1) * 100;
        }
        out.push({ tk: s.ticker, d: r.last_date, ph: r.market_level || 'none', ret20: r.market_ret20,
                   g: r.sig.grade, pull: r.sig.pullGrade === 5, rev: r.sig.revGrade === 5, rets,
                   bb: r.bb_pos ?? null, pfh: r.pct_from_high ?? null, rsi: r.rsi ?? null });
      });
    });
    return out;
  };`
});
const rows = ctx.collect(raw);
const isKR = t => /\.(KS|KQ)$/.test(t);
const qRet = {}; rows.forEach(r => { if (!isKR(r.tk) && r.ret20 != null && qRet[r.d] == null) qRet[r.d] = r.ret20; });
const qPh = {}; rows.forEach(r => { if (!isKR(r.tk) && qPh[r.d] == null) qPh[r.d] = r.ph; });
rows.forEach(r => { r.q20 = qRet[r.d] ?? null; r.qph = qPh[r.d] ?? null; });
const dates = [...new Set(rows.map(r => r.d))].sort(), mid = dates[Math.floor(dates.length / 2)];
const SB = rows.filter(r => r.g === 5), trendOnly = r => r.pull && !r.rev;
const has = v => v != null && !Number.isNaN(v);
const R8 = (bb, q) => r => has(r.bb) && r.bb <= bb && has(r.q20) && r.q20 <= q;
const R10 = (p) => r => has(r.pfh) && r.pfh < p && r.qph !== 'strong';
// 사전 등록 안(조건을 '만족하지 못하는' 대상 강한매수를 지운다)
const V = {
  'R8 추세만':        { scope: trendOnly, keep: R8(40, 0) },
  'R10 추세만':       { scope: trendOnly, keep: R10(-20) },
  'R8 전체(비교)':    { scope: () => true, keep: R8(40, 0) },
  'R10 전체(비교)':   { scope: () => true, keep: R10(-20) },
};
const NB = {   // §3 이웃 문턱(추세만)
  'R8 볼밴≤30': R8(30, 0), 'R8 볼밴≤35': R8(35, 0), 'R8 볼밴≤45': R8(45, 0), 'R8 볼밴≤50': R8(50, 0),
  'R8 QQQ20≤−2': R8(40, -2), 'R8 QQQ20≤+2': R8(40, 2),
  'R10 고점<−15': R10(-15), 'R10 고점<−25': R10(-25),
};
const st = (L, h) => { const a = L.map(r => r.rets[h]).filter(x => x != null); const w = a.filter(x => x > 1).length, l = a.filter(x => x < -1).length;
  return { n: a.length, rate: (w + l) ? w / (w + l) : null, avg: a.length ? a.reduce((s, x) => s + x, 0) / a.length : null }; };
const byDay = {}; rows.forEach(r => (byDay[r.d] = byDay[r.d] || []).push(r));
const sameDay = (L, h) => st([...new Set(L.map(r => r.d))].flatMap(d => byDay[d]), h);   // 지워지는 표본이 뜬 날들의 아무 종목
const pc = x => x == null ? ' — ' : (x * 100).toFixed(0).padStart(3) + '%';
const f = s => `${pc(s.rate)}(${String(s.n).padStart(4)})${s.avg == null ? '' : ' ' + (s.avg >= 0 ? '+' : '') + s.avg.toFixed(2)}`;
const line = (nm, L) => `${nm.padEnd(30)} ` + [1, 3, 5].map(h => f(st(L, h))).join(' | ');
console.log(`백필 · 행 ${rows.length} · ${dates[0]}~${dates[dates.length - 1]} · 강한매수 ${SB.length}(추세만 ${SB.filter(trendOnly).length} · 반등 포함 ${SB.filter(r => r.rev).length}) · 앞/뒤 경계 ${mid}\n`);
console.log('                               +1일                 | +3일                 | +5일');
console.log(line('기준선(아무 종목)', rows)); console.log(line('현행 강한매수 전체', SB)); console.log(line('현행 추세 강한매수(추세만)', SB.filter(trendOnly)));
console.log(line('현행 반등 강한매수(반등 포함)', SB.filter(r => r.rev)));
const sb5 = st(SB, 5).rate;
const judge = (nm, scope, keep, show) => {
  const rm = SB.filter(r => scope(r) && !keep(r)), kp = SB.filter(r => !(scope(r) && !keep(r)));
  const half = [r => r.d < mid, r => r.d >= mid].map(sel => { const R = rm.filter(sel); return { rm: [3, 5].map(h => st(R, h)), sd: [3, 5].map(h => sameDay(R, h)) }; });
  const rmS = [3, 5].map(h => st(rm, h)), sdS = [3, 5].map(h => sameDay(rm, h));
  const c1 = [0, 1].every(k => rmS[k].rate != null && rmS[k].rate < sdS[k].rate);
  const c2 = st(kp, 5).rate >= sb5;
  const c3 = half.every(x => [0, 1].every(k => x.rm[k].rate != null && x.rm[k].rate < x.sd[k].rate));
  const c4 = rm.length >= 30;
  if (show) {
    console.log(`\n■ ${nm} — 지우는 ${rm.length}건 · 남는 강한매수 ${kp.length}건`);
    console.log(line('  지워지는 표본', rm) + `   vs 같은 날 아무 종목 +3/+5 ${pc(sdS[0].rate)}/${pc(sdS[1].rate)}`);
    console.log(line('  남는 강한매수 전체', kp));
    half.forEach((x, j) => console.log(`  ${j ? '뒤' : '앞'} 반 지워지는 +3/+5 ${f(x.rm[0])} / ${f(x.rm[1])}   vs 같은 날 ${pc(x.sd[0].rate)}/${pc(x.sd[1].rate)}`));
    console.log(`  ① 지워지는 < 같은 날 기준선 ${c1 ? '✓' : '✗'} · ② 남는 +5 ≥ 현행 ${c2 ? '✓' : '✗'} · ③ 앞/뒤 둘 다 ① ${c3 ? '✓' : '✗'} · ④ 30건↑ ${c4 ? '✓' : '✗'}`);
  }
  return { rm: rm.length, keep5: st(kp, 5).rate, ok: c1 && c2 && c3 && c4, c: [c1, c2, c3, c4] };
};
const res = {};
for (const [nm, v] of Object.entries(V)) res[nm] = judge(nm, v.scope, v.keep, true);
console.log('\n■ §3 이웃 문턱(추세만) — 고원이면 이웃도 ①~④가 같은 방향');
for (const [nm, keep] of Object.entries(NB)) { const x = judge(nm, trendOnly, keep, false); console.log(`  ${nm.padEnd(16)} 지우는 ${String(x.rm).padStart(4)} · 남는 +5 ${pc(x.keep5)} · ①${x.c[0] ? '✓' : '✗'} ②${x.c[1] ? '✓' : '✗'} ③${x.c[2] ? '✓' : '✗'} ④${x.c[3] ? '✓' : '✗'}`); res[nm] = x; }
const nbOk = pre => Object.keys(NB).filter(k => k.startsWith(pre) && res[k].ok).length;
console.log(`\n■ 판정(사전 등록): R8 추세만 ${res['R8 추세만'].ok ? '①~④ 통과' : '탈락'} · 이웃 통과 ${nbOk('R8 ')}/6(2개↑ 필요) | R10 추세만 ${res['R10 추세만'].ok ? '①~④ 통과' : '탈락'} · 이웃 통과 ${nbOk('R10 ')}/2(1개↑ 필요)`);
// R3 — 등급 불변 보조 표시: 강한매수 중 RSI≤35 vs 아님
const r3 = SB.filter(r => has(r.rsi) && r.rsi <= 35), r3n = SB.filter(r => !(has(r.rsi) && r.rsi <= 35));
console.log('\n■ R3 보조 표시(등급 불변) — 강한매수 중 종목 RSI ≤ 35');
console.log(line('  RSI ≤ 35', r3) + `   vs 같은 날 아무 종목 +3/+5 ${pc(sameDay(r3, 3).rate)}/${pc(sameDay(r3, 5).rate)}`);
console.log(line('  RSI > 35(나머지)', r3n));
[r => r.d < mid, r => r.d >= mid].forEach((sel, j) => { console.log(line(`  ${j ? '뒤' : '앞'} 반 RSI ≤ 35`, r3.filter(sel))); console.log(line(`  ${j ? '뒤' : '앞'} 반 나머지`, r3n.filter(sel))); });
{ const ok = [r => r.d < mid, r => r.d >= mid].every(sel => [3, 5].every(h => st(r3.filter(sel), h).rate > st(r3n.filter(sel), h).rate)) && st(r3, 5).n >= 30;
  console.log(`  판정(사전 등록 §3): ${ok ? '표시 가능' : '표시 불가'} — +3·+5일이 앞/뒤 반 둘 다 나머지보다 높음 ∧ +5 표본 30↑`); }
for (const t of [30, 40]) console.log(line(`  (이웃) RSI ≤ ${t}`, SB.filter(r => has(r.rsi) && r.rsi <= t)));
