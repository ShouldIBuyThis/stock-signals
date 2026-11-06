#!/usr/bin/env node
/**
 * 시장 폭(52주 신고가 − 신저가) — 시장 국면·테마 흐름에 쓸 수 있나 (읽기 전용)
 *
 * 왜 (2026-11-06 사용자: 커뮤니티 글의 'NYSE 52주 신고가·신저가 종목 수' 그래프 — "시장국면분석·테마흐름 분석에 활용 가능한가")
 * NYSE 전체 집계는 야후에 없어서, 우리 관심종목(미국) 안에서 같은 값을 만든다:
 *   신고가권 = 종가가 52주 최고가의 1% 안(pct_from_high ≥ −1) · 신저가권 = 52주 최저가의 1% 안(pct_from_low ≤ 1)
 *   순신고가 = (신고가권 − 신저가권) / 종목 수 · 10일 변화
 * 검사
 *   A. 나스닥(QQQ) 5·10·20일 뒤 하락 비율·평균 — 순신고가 부호 / 10일 하락 중 / '지수는 고점권인데 순신고가는 줄어듦'(글쓴이가 말한 다이버전스)
 *   B. 사이트 강한매수·다중 +3·+5일 승률을 같은 구분으로 나눠 본다(화면 strategyValidation 표본 그대로)
 *   C. 테마별 순신고가(테마 안 종목) 부호 → 그 테마 평균 10일 수익
 * ⚠ 관심종목은 지금 고른 종목이라 생존 편향이 있다. 우리 유니버스 ≠ NYSE 전체.
 * 입력 backtest/raw.json (lab-quick years=3 days=690)
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'signals.json';
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
const F = base.hist_fields, ix = k => F.indexOf(k);
const iD = ix('date'), iP = ix('price'), iH = ix('pct_from_high'), iL = ix('pct_from_low'), iV = ix('market_vxn');
const VXN = ((base.macro || {}).vxn) || {};
for (const s of base.stocks) for (const r of s.hist || []) { while (r.length <= iV) r.push(null); if (r[iV] == null && VXN[r[iD]] != null) r[iV] = +VXN[r[iD]]; }
const us = base.stocks.filter(s => !/\.K[SQ]$/.test(s.ticker || ''));

/* ── 날짜별 순신고가 ── */
const day = new Map();
for (const s of us) for (const r of s.hist || []) {
  const d = r[iD]; if (!d || r[iH] == null || r[iL] == null) continue;
  const o = day.get(d) || { n: 0, nh: 0, nl: 0, cat: {} }; o.n++;
  if (r[iH] >= -1) o.nh++; if (r[iL] <= 1) o.nl++;
  const c = s.category || '기타'; const oc = o.cat[c] || (o.cat[c] = { n: 0, nh: 0, nl: 0 }); oc.n++;
  if (r[iH] >= -1) oc.nh++; if (r[iL] <= 1) oc.nl++;
  day.set(d, o);
}
const dates = [...day.keys()].sort();
const net = new Map(dates.map(d => { const o = day.get(d); return [d, o.n >= 20 ? (o.nh - o.nl) / o.n : null]; }));
const net10 = new Map(dates.map((d, i) => [d, i >= 10 && net.get(d) != null && net.get(dates[i - 10]) != null ? net.get(d) - net.get(dates[i - 10]) : null]));

/* ── QQQ ── */
const q = (base.qqq_card && base.qqq_card.hist) || [];
const qp = new Map(q.map(r => [r[iD], r[iP]])); const qd = q.map(r => r[iD]);
const qfwd = (d, h) => { const i = qd.indexOf(d); return i >= 0 && i + h < qd.length ? (qp.get(qd[i + h]) / qp.get(d) - 1) * 100 : null; };
const qhi60 = d => { const i = qd.indexOf(d); if (i < 60) return null; const mx = Math.max(...qd.slice(i - 60, i + 1).map(x => qp.get(x))); return qp.get(d) / mx - 1; };

const state = d => {
  const n = net.get(d), c = net10.get(d), hi = qhi60(d);
  return { pos: n != null ? n > 0 : null, fall: c != null ? c < -0.05 : null,
           div: (hi != null && c != null) ? (hi > -0.03 && c < -0.05) : null };
};
const fmtQ = (ds, h) => { const v = ds.map(d => qfwd(d, h)).filter(x => x != null);
  return v.length ? `하락 ${Math.round(v.filter(x => x < 0).length / v.length * 100)}% 평균 ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}% (${v.length})`.padEnd(30) : '—'.padEnd(30); };

const mid = dates[Math.floor(dates.length / 2)];
console.log(`■ 시장 폭(관심종목 미국 ${us.length}개 · 52주 신고가권 − 신저가권) · ${dates[0]}~${dates[dates.length - 1]} · 반쪽 경계 ${mid}`);
const nets = dates.map(d => net.get(d)).filter(x => x != null);
console.log(`  순신고가 분포: 평균 ${(nets.reduce((a, b) => a + b, 0) / nets.length * 100).toFixed(0)}%p · 플러스인 날 ${Math.round(nets.filter(x => x > 0).length / nets.length * 100)}%`);

console.log('\n  [A] 나스닥(QQQ) n일 뒤                  5일                           10일                          20일');
const rowsA = [
  ['아무 날', d => true],
  ['순신고가 플러스(신고가 > 신저가)', d => state(d).pos === true],
  ['순신고가 마이너스(신저가 > 신고가)', d => state(d).pos === false],
  ['순신고가 10일 −5%p 이상 감소', d => state(d).fall === true],
  ['다이버전스: QQQ 고점권인데 순신고가 감소', d => state(d).div === true],
];
for (const half of [['전체', d => true], ['앞 반', d => d < mid], ['뒤 반', d => d >= mid]]) {
  console.log(`   (${half[0]})`);
  for (const [nm, f] of rowsA) { const ds = dates.filter(d => half[1](d) && f(d)); console.log('    ' + nm.padEnd(34) + [5, 10, 20].map(h => fmtQ(ds, h)).join('')); }
}

/* ── B. 사이트 신호 승률 ── */
const page = H.loadPage();
page.runInPage(`this.__run = j => { state.data = normalize(JSON.parse(j)); const r = strategyValidation(); const o = {};
  ['strongBuy','multi'].forEach(k => { o[k] = {}; [3,5].forEach(h => o[k][h] = (r._phaseRows[k][h]||[]).map(x => ({d:x.date, ret:x.ret}))); }); return JSON.stringify(o); };`);
const R = JSON.parse(page.__run(JSON.stringify(base)));
const wr = a => { const w = a.filter(x => x.ret > 1).length, l = a.filter(x => x.ret < -1).length; return `${w + l ? Math.round(w / (w + l) * 100) : '—'}%(${a.length})`.padEnd(12); };
console.log('\n  [B] 사이트 신호 승률(±1% 보합 제외)        강한매수 +3 · +5           다중 +3 · +5');
for (const [nm, f] of rowsA) {
  const pick = (k, h) => R[k][h].filter(x => f(x.d));
  console.log('    ' + nm.padEnd(34) + wr(pick('strongBuy', 3)) + wr(pick('strongBuy', 5)) + '   ' + wr(pick('multi', 3)) + wr(pick('multi', 5)));
}

/* ── C. 테마별 ── */
console.log('\n  [C] 테마 안 순신고가 부호 → 그 테마 종목 평균 10일 수익(같은 날 평균)');
const cats = {}; us.forEach(s => (cats[s.category || '기타'] = cats[s.category || '기타'] || []).push(s));
for (const [c, ss] of Object.entries(cats)) {
  if (ss.length < 3) continue;
  const fw = new Map();
  for (const s of ss) { const h = s.hist || []; for (let i = 0; i + 10 < h.length; i++) { const d = h[i][iD]; if (h[i][iP] && h[i + 10][iP]) (fw.get(d) || fw.set(d, []).get(d)).push((h[i + 10][iP] / h[i][iP] - 1) * 100); } }
  const pos = [], neg = [];
  for (const [d, v] of fw) { const o = day.get(d); const oc = o && o.cat[c]; if (!oc || oc.n < 3) continue; const m = v.reduce((a, b) => a + b, 0) / v.length; ((oc.nh - oc.nl) > 0 ? pos : (oc.nh - oc.nl) < 0 ? neg : []).push(m); }
  const f = a => a.length ? `${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)}% 하락 ${Math.round(a.filter(x => x < 0).length / a.length * 100)}% (${a.length}일)` : '—';
  console.log(`    ${c.padEnd(14)} 플러스 ${f(pos).padEnd(28)} 마이너스 ${f(neg)}`);
}
