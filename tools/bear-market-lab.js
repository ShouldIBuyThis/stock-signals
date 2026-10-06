#!/usr/bin/env node
/**
 * 약세 구간 승률 원인 분석 + 산식 후보 비교 (읽기 전용 · 아무 파일도 안 고친다)
 *
 * 왜 만드나 (2026-10-06 사용자 지시: "최근 약세장으로 승률이 너무 떨어졌는데 원인분석 후
 *   나스닥 전용 산식과 비교해서 보고, 테마별 산식도 경우의 수로")
 *
 * 입력  history/us/YYYY-MM-DD.json (append-only 원장, 2026-08-10~) 을 메모리에서
 *       signals.json 모양(hist 배열)으로 다시 묶는다. 원장 파일은 읽기만 한다.
 *       --signals 를 주면 signals.json(30일 롤링 창)으로 돈다.
 * 산식  index.html의 evaluate()·strategyValidation()을 그대로 올려(§0) 후보는
 *       evaluate() 문자열 치환으로만 만든다.
 * 파생  날짜별 유니버스 폭(MA20 위 %)·중위 rs20·테마 폭·테마 중위 ret20·QQQ 연속하락을
 *       hist 꼬리에 메모리에서만 덧붙이고 histRow 화이트리스트도 패치한다.
 *
 * 사용  node tools/bear-market-lab.js            # 원인 분해표 + 후보 비교
 *       node tools/bear-market-lab.js --signals  # 30일 창(화면과 같은 표본)
 *       node tools/bear-market-lab.js --detail NAME   # 후보 하나의 추가/제거 표본 목록
 */
const fs = require('fs'), path = require('path'), H = require('./_harness');
const ARGS = process.argv.slice(2);
const USE_SIGNALS = ARGS.includes('--signals');
const DETAIL = ARGS.includes('--detail') ? ARGS[ARGS.indexOf('--detail') + 1] : null;

/* ── 원장 → hist 재조립 ─────────────────────────────────────────── */
function assembleLedger(){
  const d = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
  if (USE_SIGNALS) return d;
  const F = d.hist_fields;
  const dir = path.join('history', 'us');
  const byTk = new Map();
  for (const f of fs.readdirSync(dir).filter(x => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()){
    const day = f.slice(0, 10);
    const pay = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const rows = new Map();
    for (const r of pay.stocks || []) if (r.ticker && r.last_date === day) rows.set(r.ticker, r);
    const sub = path.join(dir, day);                       // 보충 원장(main.py frozen_day_rows와 같은 규칙)
    if (fs.existsSync(sub)) for (const g of fs.readdirSync(sub).sort()){
      const r = JSON.parse(fs.readFileSync(path.join(sub, g), 'utf8'));
      if (r.last_date === day && r.ticker) rows.set(r.ticker, r);
    }
    rows.forEach((r, tk) => { if (!byTk.has(tk)) byTk.set(tk, new Map()); byTk.get(tk).set(day, r); });
  }
  const toArr = r => F.map(k => k === 'date' ? r.last_date : (r[k] === undefined ? null : r[k]));
  let n = 0;
  for (const s of d.stocks){
    if (s.currency !== 'USD' || !byTk.has(s.ticker)) continue;
    const m = byTk.get(s.ticker);
    s.hist = [...m.keys()].sort().map(k => toArr(m.get(k))); n++;
  }
  const days = new Set(); byTk.forEach(m => m.forEach((_, k) => days.add(k)));
  const ds = [...days].sort();
  console.log(`원장 재조립: ${n}종목 · ${ds.length}거래일 ${ds[0]}~${ds[ds.length-1]}`);
  return d;
}

/* ── 파생 필드 주입(메모리) ─────────────────────────────────────── */
const X_FIELDS = ['x_breadth', 'x_medrs', 'x_tbreadth', 'x_tret20', 'x_tn', 'x_qstreak'];
function inject(d){
  const F = d.hist_fields, iD = F.indexOf('date'), iP = F.indexOf('price'), iM = F.indexOf('ma20'), iRS = F.indexOf('rs20'), iR = F.indexOf('ret20');
  const us = d.stocks.filter(s => s.currency === 'USD');
  const byd = {}, byc = {};
  us.forEach(s => (s.hist || []).forEach(r => { const dt = r[iD]; if (!dt) return; (byd[dt] = byd[dt] || []).push(r); const k = dt + '|' + s.category; (byc[k] = byc[k] || []).push(r); }));
  const med = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const stat = rs => ({ br: Math.round(100 * rs.filter(r => r[iP] != null && r[iM] != null && r[iP] > r[iM]).length / rs.length),
    rs: med(rs.map(r => r[iRS]).filter(v => v != null)), r20: med(rs.map(r => r[iR]).filter(v => v != null)), n: rs.length });
  const U = {}, T = {};
  Object.keys(byd).forEach(dt => U[dt] = stat(byd[dt]));
  Object.keys(byc).forEach(k => T[k] = stat(byc[k]));
  const QS = {}; (d.qqq_signal_hist || []).forEach(q => QS[q.date] = q.streak);
  d.hist_fields = F.concat(X_FIELDS);
  d.stocks.forEach(s => (s.hist || []).forEach(r => { const dt = r[iD], u = U[dt] || {}, t = T[dt + '|' + s.category] || {};
    r.push(u.br ?? null, u.rs ?? null, t.br ?? null, t.r20 ?? null, t.n ?? null, QS[dt] ?? null); }));
  return { data: d, U };
}

/* ── 후보 산식 (evaluate 문자열 치환) ─────────────────────────────── */
const GUARD  = 'const marketGuarded = s.market_level==="weak" ||';
const GUARD2 = '(s.market_level==="caution" && !(has(s.market_ret20) && s.market_ret20 >= -2));';
const FEAR   = 'const vxnFear = has(s.market_vxn) && s.market_vxn>=25;';
const SECTOR = 'const sectorOK = !marketGuarded || DEFENSIVE_CATS.includes(s.category);';
const BONUS  = 'else if (lv==="strong"){ bPos+=0.3; pPos+=0.3; }';
const PULL5  = '&& sectorOK && tickerOK && sectorTuneOK && nearHighM && pullChase && pullBandOK ? 5 :';
const REV5   = 'const revStrong = revScore>=2.0 && has(rsi) && revRsiOK && sectorOK && tickerOK && sectorTuneOK';
const relief = cond => [[GUARD, `const marketGuarded = !(${cond}) && (s.market_level==="weak" ||`], [GUARD2, GUARD2.slice(0, -1) + ');']];
const V = { '현행': [] };
/* A. 유니버스 바닥(폭<T) — 나스닥 전용 산식의 '바닥권' 축(30)을 종목 관문에 옮긴다. 게이트만 / 게이트+감점 */
for (const T of [25, 30, 35, 40]){
  const c = `has(s.x_breadth) && s.x_breadth<${T}`;
  V['A_gate' + T] = relief(c);
  V['A_full' + T] = [...relief(c), [FEAR, `const vxnFear = (has(s.market_vxn) && s.market_vxn>=25) || (${c});`]];
}
/* B. QQQ strong인데 유니버스 중위 rs20이 -T 아래(지수만 오르는 장) — 강세 가점 대신 주의 감점 / 하드 차단 */
for (const T of [1, 2, 3]) V['B_lag' + T] = [[BONUS, `else if (lv==="strong"){ if(has(s.x_medrs) && s.x_medrs < -${T}){ cNeg-=0.5; } else { bPos+=0.3; pPos+=0.3; } }`]];
V['B_block2'] = [[PULL5, '&& !(lv==="strong" && has(s.x_medrs) && s.x_medrs < -2) ' + PULL5], [REV5, REV5 + ' && !(lv==="strong" && has(s.x_medrs) && s.x_medrs < -2)']];
V['B_rs2'] = [[PULL5, '&& (!(lv==="strong" && has(s.x_medrs) && s.x_medrs < -2) || (has(s.rs20) && s.rs20>0)) ' + PULL5], [REV5, REV5 + ' && (!(lv==="strong" && has(s.x_medrs) && s.x_medrs < -2) || (has(s.rs20) && s.rs20>0))']];
/* C. 테마 국면 — 테마 폭(MA20 위 %) 또는 테마 중위 ret20 이 나쁘면 강한매수 금지 (테마 종목 3개 이상일 때만) */
for (const T of [25, 34, 50]) V['C_tbr' + T] = [[SECTOR, `const sectorOK = (!marketGuarded || DEFENSIVE_CATS.includes(s.category)) && !(has(s.x_tbreadth) && has(s.x_tn) && s.x_tn>=3 && s.x_tbreadth<${T});`]];
for (const T of [5, 8]) V['C_tret' + T] = [[SECTOR, `const sectorOK = (!marketGuarded || DEFENSIVE_CATS.includes(s.category)) && !(has(s.x_tret20) && has(s.x_tn) && s.x_tn>=3 && s.x_tret20< -${T});`]];
/* E. 나스닥 전용 산식의 '연속 하락' 축 / 기존 VXN 해제 문턱 완화 — A와의 대조군 */
V['E_qstreak2'] = [...relief('has(s.x_qstreak) && s.x_qstreak>=2'), [FEAR, 'const vxnFear = (has(s.market_vxn) && s.market_vxn>=25) || (has(s.x_qstreak) && s.x_qstreak>=2);']];
V['E_vxn22'] = [[FEAR, 'const vxnFear = has(s.market_vxn) && s.market_vxn>=22;'], ...relief('has(s.market_vxn) && s.market_vxn>=22')];
/* D. 조합 */
V['D_full30_lag2'] = [...V['A_full30'], ...V['B_lag2']];

/* ── 실행 ─────────────────────────────────────────────────────── */
const orig = H.extractFunction('evaluate');
const { data, U } = inject(assembleLedger());
const RAW = JSON.stringify(data);
function run(changes){
  let src = orig;
  for (const [a, b] of changes){ if (!src.includes(a)) H.die('앵커 없음: ' + a.slice(0, 60)); src = src.replace(a, b); }
  const page = H.loadPage({ patch: [[orig, src],
    ['market_vxn: num(o.market_vxn),', 'market_vxn: num(o.market_vxn), ' + X_FIELDS.map(k => `${k}: num(o.${k}),`).join(' ')],
    ['baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});',
     'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date, ticker:row.ticker});']] });
  page.runInPage('this.__run = j => { state.data = normalize(JSON.parse(j)); const r = strategyValidation(); return { rows: r._phaseRows, cat: Object.fromEntries(allStocks().map(s=>[s.ticker,s.category])) }; };');
  return page.__run(RAW);
}
const stat = a => { const w = a.filter(x => x.ret > 1).length, l = a.filter(x => x.ret < -1).length; return { n: a.length, rate: w + l ? Math.round(100 * w / (w + l)) : null, avg: a.length ? a.reduce((s, x) => s + x.ret, 0) / a.length : 0 }; };
const fmt = s => `${s.rate === null ? '  —' : String(s.rate).padStart(3) + '%'}(${String(s.n).padStart(3)})${(s.avg >= 0 ? '+' : '') + s.avg.toFixed(2)}`;
const key = x => x.ticker + '|' + x.date;

const base = run([]);
const rows = base.rows;
const dates = [...new Set(rows.base[3].map(x => x.date))].sort(), mid = dates[Math.floor(dates.length / 2)];

/* ① 원인 분해 — 날짜별 폭·국면·기준선 */
console.log(`\n■ ① 날짜별: QQQ 국면 vs 유니버스 폭(MA20 위 %)·중위 rs20 vs 그날 기준선(+3일) vs 강한매수 건수`);
const bd = {}, sd = {}; rows.base[3].forEach(x => (bd[x.date] = bd[x.date] || []).push(x)); rows.strongBuy[3].forEach(x => (sd[x.date] = sd[x.date] || []).push(x));
const lvlOf = {}; data.stocks.filter(s => s.currency === 'USD').forEach(s => (s.hist || []).forEach(r => { if (r[0]) lvlOf[r[0]] = r[data.hist_fields.indexOf('market_level')]; }));
for (const d of dates){ const u = U[d] || {}; const b = stat(bd[d] || []), s = stat(sd[d] || []);
  console.log(`  ${d} ${String(lvlOf[d]).padEnd(8)} 폭 ${String(u.br ?? '—').padStart(3)}%  중위rs20 ${String(u.rs ?? '—').padStart(5)} | 기준선 ${fmt(b)} | 강한매수 ${fmt(s)}`); }

/* ② 폭 구간별 기준선·강한매수 */
console.log(`\n■ ② 유니버스 폭 구간별 (+3일 | +5일) — 기준선 vs 강한매수`);
const bucket = p => p == null ? '—' : p < 30 ? '<30' : p < 50 ? '30-50' : p < 70 ? '50-70' : '>=70';
for (const b of ['<30', '30-50', '50-70', '>=70']){
  const sel = k => h => rows[k][h].filter(x => bucket((U[x.date] || {}).br) === b);
  console.log(`  ${b.padEnd(6)} 기준선 ${fmt(stat(sel('base')(3)))} ${fmt(stat(sel('base')(5)))} | 강한매수 ${fmt(stat(sel('strongBuy')(3)))} ${fmt(stat(sel('strongBuy')(5)))}`);
}

/* ③ 테마별 */
console.log(`\n■ ③ 테마별 강한매수 vs 같은 테마 기준선 (+3일 | +5일) · 표본 2건 이상`);
const cats = [...new Set(Object.values(base.cat))];
cats.map(c => ({ c, s3: stat(rows.strongBuy[3].filter(x => base.cat[x.ticker] === c)), b3: stat(rows.base[3].filter(x => base.cat[x.ticker] === c)),
                 s5: stat(rows.strongBuy[5].filter(x => base.cat[x.ticker] === c)), b5: stat(rows.base[5].filter(x => base.cat[x.ticker] === c)) }))
  .filter(o => o.s3.n >= 2).sort((a, b) => b.s3.n - a.s3.n)
  .forEach(o => console.log(`  ${o.c.padEnd(9)} ${fmt(o.s3)} vs ${fmt(o.b3)} | ${fmt(o.s5)} vs ${fmt(o.b5)}`));

/* ④ 후보 비교 */
console.log(`\n■ ④ 후보 비교 — 강한매수(초록) · 반쪽 경계 ${mid} · 기준선 +3 ${fmt(stat(rows.base[3]))} +5 ${fmt(stat(rows.base[5]))}`);
console.log(`  ${'후보'.padEnd(14)} ${'+3 전체'.padStart(16)} ${'+5 전체'.padStart(16)} | ${'+3 전반'.padStart(16)} ${'+3 후반'.padStart(16)} | ${'+5 전반'.padStart(16)} ${'+5 후반'.padStart(16)} | ${'추가 +3'.padStart(16)} ${'추가 +5'.padStart(16)} | ${'제거 +3'.padStart(16)} ${'제거 +5'.padStart(16)}`);
const results = {};
for (const [name, ch] of Object.entries(V)){
  const r = name === '현행' ? base : run(ch); results[name] = r; const sb = r.rows.strongBuy;
  const half = (h, p) => fmt(stat(sb[h].filter(p)));
  const diff = h => { const bk = new Set(rows.strongBuy[h].map(key)), vk = new Set(sb[h].map(key));
    return [fmt(stat(sb[h].filter(x => !bk.has(key(x))))), fmt(stat(rows.strongBuy[h].filter(x => !vk.has(key(x)))))]; };
  const [a3, r3] = diff(3), [a5, r5] = diff(5);
  console.log(`  ${name.padEnd(14)} ${fmt(stat(sb[3]))} ${fmt(stat(sb[5]))} | ${half(3, x => x.date < mid)} ${half(3, x => x.date >= mid)} | ${half(5, x => x.date < mid)} ${half(5, x => x.date >= mid)} | ${a3} ${a5} | ${r3} ${r5}`);
}
if (DETAIL && results[DETAIL]){
  const sb = results[DETAIL].rows.strongBuy, bk = new Set(rows.strongBuy[3].map(key)), vk = new Set(sb[3].map(key));
  const r5 = Object.fromEntries(sb[5].map(x => [key(x), x.ret])), b5 = Object.fromEntries(rows.strongBuy[5].map(x => [key(x), x.ret]));
  console.log(`\n■ ${DETAIL} 추가 표본`); sb[3].filter(x => !bk.has(key(x))).sort((a, b) => a.date.localeCompare(b.date)).forEach(x => console.log(`  ${x.date} ${x.ticker.padEnd(6)} ${base.cat[x.ticker].padEnd(8)} +3 ${x.ret.toFixed(1).padStart(6)}  +5 ${(r5[key(x)] ?? NaN).toFixed(1).padStart(6)}`));
  console.log(`■ ${DETAIL} 제거 표본`); rows.strongBuy[3].filter(x => !vk.has(key(x))).sort((a, b) => a.date.localeCompare(b.date)).forEach(x => console.log(`  ${x.date} ${x.ticker.padEnd(6)} ${base.cat[x.ticker].padEnd(8)} +3 ${x.ret.toFixed(1).padStart(6)}  +5 ${(b5[key(x)] ?? NaN).toFixed(1).padStart(6)}`));
}
console.log(`\n판독 규칙: §1 기준선 대비 · §2 전·후반 같은 방향 · §3 이웃 문턱 · §5-1 표본 등급 · §5-5 제거 표본이 실제로 지는가. 표본은 종목×날짜라 독립 표본은 더 적다(§5).`);
