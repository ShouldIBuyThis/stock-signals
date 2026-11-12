/**
 * 🏆 황금신호 × 테마 52주 흐름 — 국면별 교집합 탐색(집계). docs/2026-11-12-gold-theme.md 사전 등록 그대로.
 * gold-3y-lab.js(GTHEME=1)가 화면 함수로 만든 행(R)과 종목별 52주 원장 값(mem)을 받는다. 판정·순위 재구현 없음.
 */
const fs = require('fs');
const COND_T = ['T_HRUP', 'T_LRDN', 'T_NET3', 'T_NET5', 'T_NET10', 'T_LOWSTOP', 'T_HIGHBACK', 'T_SPREAD', 'T_AB20'];
const COND_G = ['G_NDX', 'G_SP', 'G_DEF', 'G_ALLUP'];
const NM = { T_HRUP: '테마 신고가 참여 증가', T_LRDN: '테마 신저가 감소', T_NET3: '순신고가 3일 개선', T_NET5: '순신고가 5일 개선', T_NET10: '순신고가 10일 개선', T_LOWSTOP: '신저가 증가 멈춤',
  T_HIGHBACK: '신고가 재등장', T_SPREAD: '신고가 확산', T_AB20: '20일선 위 비율 증가', G_NDX: '나스닥100 신고가 강도↑', G_SP: 'S&P500 신고가 강도↑', G_DEF: '경기방어 신고가 강도↑', G_ALLUP: '4그룹 전 그룹 확산' };

function run(R, mem, GB, outPath) {
  const kr = t => /\.(KS|KQ)$/.test(t);
  /* 진입 기준(2026-11-12 사용자 정정): 주 = 신호일 정규장 종가(애프터마켓 종가 지정가 · 체결 보장 아님) · 보조 = 다음 날 시가.
     GENTRY=close면 종가 경로(pxc)를 주 기준으로 쓴다. 사전 등록 원래 실험(다음 날 시가)은 GENTRY 없이 그대로 재현된다. */
  const CLOSE = process.env.GENTRY === 'close';
  if (CLOSE) R.forEach(r => { r.pxo = r.px; r.px = r.pxc; });
  console.log(`진입 기준: ${CLOSE ? '신호일 종가(주 · 체결 보장 아님) — 보조로 다음 날 시가 5일 +1%를 괄호에 병기' : '다음 날 시가(원래 사전 등록)'}`);
  // ── 테마 구성(레버리지·벤치마크 제외) · 테마별 날짜 색인 ──
  const byCat = {}; mem.forEach(s => { if (s.lev || s.bench) return; (byCat[s.cat] = byCat[s.cat] || []).push(s); });
  const catDates = {}; for (const [c, ms] of Object.entries(byCat)) { const ds = [...new Set(ms.flatMap(s => Object.keys(s.m)))].sort(); catDates[c] = { ds, ix: new Map(ds.map((d, i) => [d, i])) }; }
  const cache = new Map();
  function themeConds(cat, d, ex) {
    const key = cat + '|' + d + '|' + (ex || ''); if (cache.has(key)) return cache.get(key);
    const ms = byCat[cat], cd = catDates[cat]; let res = null;
    if (ms && cd && cd.ix.has(d)) {
      const di = cd.ix.get(d), lo = Math.max(0, di - 31), day = [];
      for (let j = lo; j <= di; j++) { const dd = cd.ds[j]; let k = 0, h = 0, l = 0, a = 0; const nh = new Set();
        for (const s of ms) { if (s.t === ex) continue; const r = s.m[dd]; if (!r) continue; k++; if (r[0] >= -1) { h++; nh.add(s.t); } if (r[1] <= 1) l++; a += r[2]; }
        day.push(k >= 4 ? { hr: h / k, lr: l / k, ab: a / k, nh } : null); }
      const J = day.length - 1;
      if (day[J]) {
        const m5 = (key, j) => { if (j < 4) return null; let s = 0; for (let q = j - 4; q <= j; q++) { if (!day[q]) return null; s += day[q][key]; } return s / 5; };
        const hr5 = j => m5('hr', j), lr5 = j => m5('lr', j), net5 = j => { const a = hr5(j), b = lr5(j); return a == null || b == null ? null : a - b; };
        const dlt = (f, j, k) => { const a = f(j), b = f(j - k); return a == null || b == null ? null : a - b; };
        const nh5 = (() => { const u = new Set(); for (let q = Math.max(0, J - 4); q <= J; q++) if (day[q]) day[q].nh.forEach(t => u.add(t)); return u.size; })();
        const lrPrev = []; for (let q = J - 10; q < J; q++) { const v = lr5(q); if (v != null) lrPrev.push(v); }
        const hrPrev20 = [], lrPrev20 = []; for (let q = J - 20; q < J; q++) { const a = hr5(q), b = lr5(q); if (a != null) hrPrev20.push(a); if (b != null) lrPrev20.push(b); }
        const c = {};
        c.T_HRUP = (dlt(hr5, J, 5) ?? -1) > 0;
        c.T_LRDN = (lr5(J - 5) ?? 0) > 0 && (dlt(lr5, J, 5) ?? 1) < 0;
        c.T_NET3 = (dlt(net5, J, 3) ?? -1) > 0; c.T_NET5 = (dlt(net5, J, 5) ?? -1) > 0; c.T_NET10 = (dlt(net5, J, 10) ?? -1) > 0;
        c.T_LOWSTOP = lrPrev.length > 0 && Math.max(...lrPrev) >= 0.10 && lr5(J) != null && lr5(J) <= Math.max(...lrPrev) - 0.05;
        c.T_HIGHBACK = (hr5(J) ?? 0) > 0 && hrPrev20.length >= 15 && hrPrev20.every(x => x === 0) && lrPrev20.length > 0 && Math.max(...lrPrev20) >= 0.10;
        c.T_SPREAD = (dlt(hr5, J, 5) ?? -1) >= 0.05 && nh5 >= 2 && lr5(J) != null && lr5(J - 5) != null && lr5(J) <= lr5(J - 5);
        c.T_AB20 = (dlt(j => day[j] ? day[j].ab : null, J, 5) ?? -1) > 0;
        res = c;
      }
    }
    cache.set(key, res); return res;
  }
  // ── 4그룹 ──
  const gser = {}, GD = GB && GB.dates ? GB.dates : [];
  if (GB && GB.groups) for (const g of ['NDX', 'SP', 'DEF']) { const o = GB.groups[g]; if (!o) continue;
    const net = GD.map((_, i) => o.n[i] ? (o.nh[i] - o.nl[i]) / o.n[i] : null), n5 = net.map((_, i) => { if (i < 4) return null; const w = net.slice(i - 4, i + 1); return w.some(x => x == null) ? null : w.reduce((a, b) => a + b, 0) / 5; });
    gser[g] = new Map(GD.map((d, i) => [d, i >= 5 && n5[i] != null && n5[i - 5] != null ? n5[i] - n5[i - 5] : null])); }
  const allup = new Set((GB && GB.state_series && GB.state_series.ALL_UP) || []), ssStart = GB && GB.state_series && GB.state_series.ALL_UP ? GB.state_series.ALL_UP[0] : null;
  const gdLast = (d, strict) => { let lo = 0, hi = GD.length - 1, ans = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (strict ? GD[m] < d : GD[m] <= d) { ans = GD[m]; lo = m + 1; } else hi = m - 1; } return ans; };
  function groupConds(d, isKr) { const gd = gdLast(d, isKr);   // 국장은 같은 달력 날짜의 미국 종가를 아직 모른다 → 그 전날까지
    const c = {}; for (const g of ['NDX', 'SP', 'DEF']) { const v = gd && gser[g] ? gser[g].get(gd) : null; c['G_' + g] = v == null ? null : v > 0; }
    c.G_ALLUP = ssStart && gd && gd >= ssStart ? allup.has(gd) : null; return c; }

  // ── 황금 사건 · 기준선 ──
  const dates = [...new Set(R.map(r => r.d))].sort(), DI = new Map(dates.map((d, i) => [d, i]));
  const cut3 = dates[Math.max(0, dates.length - 756)], cut1 = dates[Math.max(0, dates.length - 252)];
  const per = d => d >= cut1 ? ['1y', '3y'] : d >= cut3 ? ['3y'] : ['old'];
  const okRow = r => !r.blk && r.rg && r.px && r.px[9] != null && r.px.every(x => x != null);
  const isGold = r => r.tier && (r.kr ? (r.bull || (r.bbp != null && r.bbp <= 10)) : r.bull);
  const last = new Map(), G = [];
  R.filter(r => okRow(r) && isGold(r)).sort((a, b) => a.d < b.d ? -1 : 1).forEach(r => { const p = last.get(r.t); if (p != null && DI.get(r.d) - p <= 5) return; last.set(r.t, DI.get(r.d)); G.push(r); });
  G.forEach(r => { r.tcI = themeConds(r.cat, r.d, null); r.tcX = themeConds(r.cat, r.d, r.t); r.gc = groupConds(r.d, r.kr); });
  const BASE = R.filter(r => okRow(r));
  console.log(`황금 사건 ${G.length}(같은 종목 5거래일 안 제외) · 테마 자료 있음(자기 포함) ${G.filter(r => r.tcI).length} · 기준선 종목·날 ${BASE.length} · 기간 ${dates[0]}~${dates[dates.length - 1]} · 3년 시작 ${cut3} · 1년 시작 ${cut1}`);
  // ── 지표 ──
  const reach = (r, x, N) => { for (let k = 0; k < N; k++) if (r.px[k] >= x - 1e-12) return k + 1; return null; };
  const stat = E => { if (!E.length) return null; const z = { n: E.length, dates: new Set(E.map(r => r.d)).size };
    for (const N of [3, 5, 7, 10]) { for (const x of [0.01, 0.02, 0.03]) z[`h${N}_${x * 100}`] = E.filter(r => reach(r, x, N)).length / E.length; z[`r${N}`] = E.reduce((a, r) => a + r.px[N - 1], 0) / E.length; }
    z.win5 = E.filter(r => reach(r, 0.01, 5)).length; z.loss5 = E.length - z.win5;
    if (E[0].pxo) { const o = E.filter(r => r.pxo && r.pxo.every(x => x != null)); z.open_h5_1 = o.length ? o.filter(r => { for (let k = 0; k < 5; k++) if (r.pxo[k] >= 0.01 - 1e-12) return true; return false; }).length / o.length : null; z.open_r5 = o.length ? o.reduce((a, r) => a + r.pxo[4], 0) / o.length : null; }
    const dd = E.map(r => { const k = reach(r, 0.01, 5) || 5; return Math.min(0, ...r.px.slice(0, k)); }).sort((a, b) => a - b); z.dd_med = dd[dd.length >> 1];
    z.worst5 = Math.min(...E.map(r => r.px[4]));
    const tc = {}, cc = {}; E.forEach(r => { tc[r.t] = (tc[r.t] || 0) + 1; cc[r.cat] = (cc[r.cat] || 0) + 1; });
    const mt = Object.entries(tc).sort((a, b) => b[1] - a[1])[0], mc = Object.entries(cc).sort((a, b) => b[1] - a[1])[0];
    z.top_t = [mt[0], mt[1] / E.length]; z.top_c = [mc[0], mc[1] / E.length]; z.tier = E.length < 3 ? '표본 부족' : E.length < 5 ? '초소표본(3~4)' : E.length < 10 ? '극소표본' : E.length < 30 ? '소표본' : '추가 검증 후보'; return z; };
  // ── 조합 ──
  const combos = []; const single = (v, k) => k.startsWith('G_') ? r => r.gc[k] === true : r => { const c = v === 'X' ? r.tcX : r.tcI; return !!(c && c[k]); };
  const lab = (v, k) => (k.startsWith('G_') ? '' : (v === 'X' ? '[자기 제외] ' : '')) + NM[k];
  for (const v of ['I', 'X']) { const K = COND_T.concat(v === 'I' ? COND_G : []);
    K.forEach(k => combos.push({ key: v + ':' + k, name: lab(v, k), f: single(v, k), v }));
    for (let a = 0; a < K.length; a++) for (let b = a + 1; b < K.length; b++) { const fa = single(v, K[a]), fb = single(v, K[b]); combos.push({ key: v + ':' + K[a] + '+' + K[b], name: lab(v, K[a]) + ' ∩ ' + NM[K[b]], f: r => fa(r) && fb(r), v }); } }
  const tdata = (r, v) => v === 'X' ? !!r.tcX : !!r.tcI;   // 테마 4종목 미만 = 자료 부족(조합 판정에서 뺌)
  const binomTail = (n, p, thr) => { if (!(p > 0 && p < 1)) return 0; let s = 0; const k0 = Math.ceil(thr * n - 1e-9); for (let k = k0; k <= n; k++) { let lc = 0; for (let i = 0; i < k; i++) lc += Math.log(n - i) - Math.log(i + 1); s += Math.exp(lc + k * Math.log(p) + (n - k) * Math.log(1 - p)); } return s; };
  const pc = x => x == null ? '—' : Math.round(x * 100) + '%', pr = x => x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
  const OUT = { cut3, cut1, n_combos: combos.length, markets: {} };
  const MID = dates[Math.floor(dates.length / 2)];
  for (const [mn, mf] of [['미장', r => !r.kr], ['국장', r => r.kr]]) for (const rg of ['상승', '횡보', '하락']) {
    const Gm = G.filter(r => mf(r) && r.rg === rg), Bm = BASE.filter(r => mf(r) && r.rg === rg);
    /* 국장(§7): 탐색 = 10년 전체('3y' 자리) · 재현 = 전반('old' 자리 대신 반쪽 둘) — 미장은 그대로 */
    const KR10 = mn === '국장';
    const P = KR10 ? { '1y': r => per(r.d).includes('1y'), '3y': () => true, old: r => r.d < MID, h2: r => r.d >= MID }
                   : { '1y': r => per(r.d).includes('1y'), '3y': r => per(r.d).includes('3y'), old: r => per(r.d).includes('old') };
    const gold = {}, base = {}; for (const [pk, pf] of Object.entries(P)) { gold[pk] = stat(Gm.filter(pf)); base[pk] = stat(Bm.filter(pf)); }
    const g3 = gold['3y'];
    if (KR10) console.log(`\n(국장 §7: 아래 '3년'은 10년 전체 · '이전'은 전반 5년(${dates[0]}~${MID}) · '후반'을 따로 적는다)`);
    console.log(`\n■ ${mn} · ${rg}장 — 황금 전체: 3년 ${g3 ? `${g3.n}건 5일+1% ${pc(g3.h5_1)}(${g3.win5}승 ${g3.loss5}패) 5일 수익 ${pr(g3.r5)}` : '0건'} · 1년 ${gold['1y'] ? `${gold['1y'].n}건 ${pc(gold['1y'].h5_1)}` : '0건'} · 이전 ${gold.old ? `${gold.old.n}건 ${pc(gold.old.h5_1)}` : '0건'} | 평소 3년 5일+1% ${base['3y'] ? pc(base['3y'].h5_1) : '—'}`);
    const rows = [];
    const MINN = KR10 ? 3 : 5;   /* §8: 국장은 3건부터 */
    for (const c of combos) { const E3 = Gm.filter(r => P['3y'](r) && tdata(r, c.v) && c.f(r)); if (E3.length < MINN) continue;
      const z3 = stat(E3), rest3 = stat(Gm.filter(r => P['3y'](r) && tdata(r, c.v) && !c.f(r)));
      const Eo = Gm.filter(r => P.old(r) && tdata(r, c.v) && c.f(r)), zo = stat(Eo), resto = stat(Gm.filter(r => P.old(r) && tdata(r, c.v) && !c.f(r)));
      const E1 = Gm.filter(r => P['1y'](r) && tdata(r, c.v) && c.f(r)), z1 = stat(E1);
      const zh2 = P.h2 ? stat(Gm.filter(r => P.h2(r) && tdata(r, c.v) && c.f(r))) : null;
      rows.push({ key: c.key, name: c.name, z3, rest3, zo, resto, z1, zh2, ex: E3.slice(-6).map(r => `${r.d.slice(2)} ${r.t} ${reach(r, 0.01, 5) ? '✓' : '✗'}`) }); }
    const n80 = rows.filter(x => x.z3.h5_1 >= 0.8).length, chance = g3 ? rows.reduce((a, x) => a + binomTail(x.z3.n, g3.h5_1, 0.8), 0) : null;
    const repl = KR10
      ? rows.filter(x => { const a = x.zo, b = x.zh2; return x.z3.h5_1 >= 0.8 && a && b && a.n >= 5 && b.n >= 5 && a.h5_1 >= 0.8 && b.h5_1 >= 0.8 && gold.old && gold.h2 && a.h5_1 - gold.old.h5_1 >= 0.05 && b.h5_1 - gold.h2.h5_1 >= 0.05; })
      : rows.filter(x => x.z3.h5_1 >= 0.8 && x.zo && x.zo.n >= 10 && x.zo.h5_1 >= 0.8 && gold.old && x.zo.h5_1 - gold.old.h5_1 >= 0.05);
    rows.sort((a, b) => b.z3.h5_1 - a.z3.h5_1 || b.z3.n - a.z3.n);
    console.log(`  조합 ${combos.length}개 중 3년 사건 5↑ ${rows.length}개 · 그중 5일+1% ≥80% ${n80}개(우연 기대 ${chance == null ? '—' : chance.toFixed(1)}) · 이전 기간에서도 재현(10건↑·80%↑·황금 대비 +5%p) ${repl.length}개`);
    rows.slice(0, 10).forEach((x, i) => { const z = x.z3, o = x.zo;
      console.log(`  ${String(i + 1).padStart(2)}. ${x.name.slice(0, 46).padEnd(46)} | 3년 ${z.n}건(${z.dates}일·${z.tier}) 5일+1% ${pc(z.h5_1)}(${z.win5}승 ${z.loss5}패) 3·7·10일 ${pc(z.h3_1)}·${pc(z.h7_1)}·${pc(z.h10_1)} +2/+3% ${pc(z.h5_2)}/${pc(z.h5_3)} 5일 수익 ${pr(z.r5)}${z.open_h5_1 != null ? ` [시가 진입 ${pc(z.open_h5_1)} · ${pr(z.open_r5)}]` : ''} 낙폭 ${pr(z.dd_med)} 최악 ${pr(z.worst5)} 집중 ${z.top_t[0]} ${pc(z.top_t[1])}·${z.top_c[0]} ${pc(z.top_c[1])}`
        + ` | 황금∖조합 ${x.rest3 ? pc(x.rest3.h5_1) : '—'} · 황금 대비 ${g3 ? ((z.h5_1 - g3.h5_1) * 100).toFixed(0) + '%p' : '—'} · 1년 ${x.z1 ? `${x.z1.n}건 ${pc(x.z1.h5_1)}` : '0건'} · 이전 ${o ? `${o.n}건 ${pc(o.h5_1)} 5일 수익 ${pr(o.r5)}` : '0건'}${KR10 ? ` · 후반 ${x.zh2 ? `${x.zh2.n}건 ${pc(x.zh2.h5_1)} 5일 수익 ${pr(x.zh2.r5)}` : '0건'}` : ''} | ${x.ex.join(' · ')}`); });
    if (KR10) { const app = rows.filter(x => x.z3.n >= 3 && x.z3.h5_1 >= 0.8 && (!g3 || x.z3.h5_1 >= g3.h5_1)).map(x => ({ key: x.key, name: x.name, rg, n: x.z3.n, dates: x.z3.dates, win: x.z3.win5, loss: x.z3.loss5,
        h5: x.z3.h5_1, r5: x.z3.r5, gold_h5: g3 ? g3.h5_1 : null, h1: x.zo ? [x.zo.n, x.zo.h5_1] : null, h2: x.zh2 ? [x.zh2.n, x.zh2.h5_1] : null, half_rep: repl.some(y => y.key === x.key), ex: x.ex }));
      console.log('GOLDKR_JSON ' + JSON.stringify({ rg, gold: g3 ? { n: g3.n, h5: g3.h5_1, r5: g3.r5 } : null, app })); }
    OUT.markets[mn + '|' + rg] = { gold, base, n_rows: rows.length, n80, chance, replicated: repl.map(x => x.name), top: rows.slice(0, 10).map(({ key, name, z3, rest3, zo, resto, z1, ex }) => ({ key, name, z3, rest3, zo, resto, z1, ex })) };
  }
  if (outPath) { fs.writeFileSync(outPath, JSON.stringify(OUT)); console.log('→ ' + outPath); }
}
module.exports = { run };
