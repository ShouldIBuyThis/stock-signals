#!/usr/bin/env node
/**
 * 나스닥 전용 'VXN ≥28 꺾임' 변형 비교 (2026-11-11 사용자 지시 · 연구 전용 · 화면 변경 없음)
 * 계기: 11/10 VXN 28.97→28.57(−0.40)만으로 '강한 매수 우위'. 작은 꺾임과 큰 꺾임의 성과가 같은가?
 *   A  VXN ≥28 & 전일보다 하락 (현행)
 *   B  A + 하락폭 ≥ x pt (0.5·1·2·3 — 고원 확인) / 하락률 ≥ 3·5%
 *   C  A + QQQ 그날 종가 상승
 *   D  A + 일반 종목 산식(evaluate) QQQ 등급 ≥ 매수관심 / = 강한매수
 *   E  A + 5분봉 확인 — 5분봉은 60일뿐이라 3년 비교 불가(표본 1~5건) → 생략하고 이유만 적는다
 * 판정·데이터는 화면 코드를 그대로 쓴다(H.loadPage → normalize → qqqBenchmarkStock·histStocks·evaluate·breadthByDate).
 * 성과 = QQQ 종가 → n거래일 뒤 종가, 상승 = >0 (QQQ_FACTS와 같은 규칙). 지워지는 표본의 성적과 반쪽(§2)도 같이 찍는다.
 * 사용: node tools/qqq-vxn-variants-lab.js backtest/raw.json   (lab-quick years=3 days=690)
 */
const fs = require('fs'), H = require('./_harness');
const raw = fs.readFileSync(process.argv[2] || 'backtest/raw.json', 'utf8');
const page = H.loadPage();
page.runInPage(`this.__run = j => { const d = JSON.parse(j); state.data = normalize(d); const s = qqqBenchmarkStock(); const hs = histStocks(s) || [];
  const br = breadthByDate(); const vx = (d.macro && d.macro.vxn) || {};
  return hs.map(h => { const e = evaluate(h); return { d: h.last_date, p: h.price, g: e.grade, br: br[h.last_date] ?? null, vxn: vx[h.last_date] ?? null }; }); };`);
const R = page.__run(raw).filter(r => r.d && r.p);
R.forEach((r, i) => { const p = R[i-1]; r.vp = p ? p.vxn : null; r.chg = p ? (r.p/p.p - 1)*100 : null;
  r.f = {}; for (const h of [1, 3, 5, 10]) r.f[h] = R[i+h] ? (R[i+h].p/r.p - 1)*100 : null; });
const V = R.filter(r => r.vxn != null && r.vp != null && r.f[5] != null);
const MID = V[Math.floor(V.length/2)].d;
console.log(`QQQ ${R.length}일 (${R[0].d}~${R[R.length-1].d}) · VXN 있는 날 ${V.length} · 반쪽 경계 ${MID}`);
const st = (a, h) => { const x = a.map(r => r.f[h]).filter(v => v != null); return x.length ? { n: x.length, r: Math.round(x.filter(v => v > 0).length/x.length*100), m: x.reduce((s, v) => s + v, 0)/x.length } : { n: 0 }; };
const B = { 1: st(V, 1), 3: st(V, 3), 5: st(V, 5), 10: st(V, 10) };
const row = (nm, a, ref) => { const c = h => { const s = st(a, h); return s.n ? `${h}일 ${String(s.r).padStart(3)}% ${s.m >= 0 ? '+' : ''}${s.m.toFixed(2)}%${ref ? ` (${s.r - B[h].r >= 0 ? '+' : ''}${s.r - B[h].r}p)` : ''}` : `${h}일 —`; };
  const half = w => { const z = a.filter(r => (r.d < MID) === (w === 0)), s = st(z, 3); return s.n ? `${s.r}%(${s.n})` : '—'; };
  return `${nm.padEnd(30)} n${String(a.length).padStart(4)} | ${[1, 3, 5, 10].map(c).join(' | ')} | 3일 반쪽 ${half(0)}/${half(1)}`; };
console.log('상승 = 종가 기준 >0 · 괄호 = 기준선 대비 %p');
console.log(row('기준선(모든 날)', V, false));
const A = V.filter(r => r.vxn >= 28 && r.vxn < r.vp), drop = r => r.vp - r.vxn;
console.log(row('A 현행 VXN≥28 & 하락', A, true));
for (const x of [0.5, 1, 2, 3]){ console.log(row(`B 하락폭 ≥${x}pt`, A.filter(r => drop(r) >= x), true)); console.log(row(`  └ 지워지는 쪽 (<${x}pt)`, A.filter(r => drop(r) < x), true)); }
for (const q of [3, 5]){ console.log(row(`B' 하락률 ≥${q}%`, A.filter(r => drop(r)/r.vp*100 >= q), true)); console.log(row(`  └ 지워지는 쪽 (<${q}%)`, A.filter(r => drop(r)/r.vp*100 < q), true)); }
console.log(row('C A & QQQ 그날 상승', A.filter(r => r.chg > 0), true)); console.log(row('  └ 지워지는 쪽 (QQQ 하락·보합)', A.filter(r => !(r.chg > 0)), true));
console.log(row('D A & 일반 산식 매수관심+', A.filter(r => r.g >= 4), true)); console.log(row("D' A & 일반 산식 강한매수", A.filter(r => r.g === 5), true));
console.log(row('  └ A & 일반 산식 중립 이하', A.filter(r => r.g < 4), true));
console.log(row('참고: 일반 산식 강한매수(전체)', V.filter(r => r.g === 5), true));
const t = R.find(r => r.d === '2026-11-10'); if (t) console.log(`11/10: VXN ${t.vxn} (전일 ${t.vp}, 하락 ${t.vp != null && t.vxn != null ? (t.vp - t.vxn).toFixed(2) : '—'}pt) · QQQ ${t.chg != null ? t.chg.toFixed(2) : '—'}% · 일반 산식 등급 ${t.g}`);
console.log('E (A + 5분봉 VWAP·30분 추세): 5분봉 보존분이 60거래일뿐이라 3년 A 표본과 겹치는 날이 몇 건 안 돼 비교 불가 — 생략.');
