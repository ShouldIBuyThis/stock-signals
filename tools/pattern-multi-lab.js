#!/usr/bin/env node
/**
 * 다중 신호를 '캔들·패턴 신호일'로 바꾸면 승률이 어떻게 되나 (읽기 전용 · 아무 파일도 안 고친다)
 *
 * 왜 (2026-11-06 사용자: "다중신호 산식을 캔들패턴 산식(오늘로 치면 구글·조비·코어위브가 신호네)으로
 *     신호일 하면 시뮬레이션 승률 얼마야 표본이랑")
 *
 * 방법 — multi-theme-lab.js와 같다. 화면 검증표의 strategyValidation()을 그대로 돌리고(§0)
 *   기준선 표본(아무 날)에 그날 원장 pat을 실어서, pat 코드가 뜬 날만 골라 같은 stat()으로 센다.
 *   승률 = (+1% 초과)/(+1% 초과 + −1% 미만), 보합 제외 · 실적 영향권 제외 · 종가→h일 뒤 종가 — 화면과 같다.
 *   후보: 오늘 뜬 B_MA5·B_STOCH / 과매도 반등 4종 / 🟢 보드 반등 6종 / 🔵 추세 5종 / 매수 쪽 전부.
 *   각 후보를 단독(=다중 대체) · 다중∩패턴(조이기)으로 보고, §2 앞/뒤 반으로 다시 찍는다.
 * ⚠ 여기 결과로 다중 산식을 바꾸지 않는다(사용자 지시: v21 매수 산식 임의 변경 금지).
 * 입력 backtest/raw.json (CI lab-quick.yml years=3 days=690)
 */
const fs = require('fs'), H = require('./_harness');
const IN = process.argv[2] || 'signals.json';
const base = JSON.parse(fs.readFileSync(IN, 'utf8'));
if (!(base.hist_fields || []).includes('pat')) H.die('hist_fields에 pat 없음');
const F = base.hist_fields, iD = F.indexOf('date'), iV = F.indexOf('market_vxn'), VXN = ((base.macro || {}).vxn) || {};
for (const s of base.stocks) for (const r of s.hist || []) { while (r.length <= iV) r.push(null); if (r[iV] == null && VXN[r[iD]] != null) r[iV] = +VXN[r[iD]]; }
const RAW_IN = JSON.stringify(base);

const BASEPUSH = 'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});';
const page = H.loadPage({ patch: [[BASEPUSH,
  'baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date, ticker:row.ticker, pat:row.pat, grade:row.sig&&row.sig.grade});']] });
page.runInPage(`this.__run = j => { state.data = normalize(JSON.parse(j)); const r = strategyValidation();
  const H=[1,3,5,10], o={base:{},multi:{}};
  H.forEach(h=>{ o.base[h]=(r._phaseRows.base[h]||[]).map(x=>({t:x.ticker,d:x.date,ret:x.ret,pat:x.pat||'',g:x.grade}));
                 o.multi[h]=(r._phaseRows.multi[h]||[]).map(x=>({t:x.ticker,d:x.date,ret:x.ret})); });
  return JSON.stringify(o); };`);
const R = JSON.parse(page.__run(RAW_IN));

const HS = [1, 3, 5, 10];
const codes = p => String(p || '').split(',').filter(Boolean);
const has = set => p => codes(p).some(c => set.has(c));
const BOUNCE = new Set(['B_STOCH', 'B_BBLO', 'B_MA5', 'B_G520']);
const GREEN = new Set(['B_DIVUP', 'B_ENGULF', 'B_HAMMER', 'B_MSTAR', 'B_VOLUP', 'B_SUPPORT']);
const BLUE = new Set(['U_MA20', 'U_BREAK', 'U_G520', 'U_G2060', 'U_PULL']);
const ALLBUY = new Set([...BOUNCE, ...GREEN, ...BLUE, 'M_SEMI', 'M_IND', 'M_HOUSE', 'M_QUANT', 'M_NVDA', 'M_TSLA', 'M_AMAT', 'R5_SEMI', 'R10_NVDA']);
const CANDS = [
  ['오늘 뜬 것: B_MA5∪B_STOCH', has(new Set(['B_MA5', 'B_STOCH']))],
  ['  B_MA5 (5일선 안착)', has(new Set(['B_MA5']))],
  ['  B_STOCH (스토캐스틱)', has(new Set(['B_STOCH']))],
  ['과매도 반등 4종', has(BOUNCE)],
  ['🟢 보드 반등 6종', has(GREEN)],
  ['🔵 추세 5종', has(BLUE)],
  ['매수 쪽 패턴 전부', has(ALLBUY)],
];
const st = a => { const w = a.filter(x => x.ret > 1).length, l = a.filter(x => x.ret < -1).length;
  return { n: a.length, rate: w + l ? Math.round(w / (w + l) * 100) : null, avg: a.length ? a.reduce((z, x) => z + x.ret, 0) / a.length : 0,
           tk: new Set(a.map(x => x.t)).size }; };
const fmt = s => s.n ? `${s.rate == null ? '—' : s.rate + '%'}(${s.n}) ${s.avg >= 0 ? '+' : ''}${s.avg.toFixed(1)}%`.padEnd(19) : '—(0)'.padEnd(19);
const dates = [...new Set(R.base[1].map(x => x.d))].sort(), mid = dates[Math.floor(dates.length / 2)];
console.log(`■ 다중 → 패턴 신호일 대체 시뮬레이션 · ${dates[0]}~${dates[dates.length - 1]} (${dates.length}거래일) · 반쪽 경계 ${mid}`);
console.log('  칸 = 승률(표본) 평균수익 · 보합(±1%) 제외 · 종가 기준 · 실적 영향권 제외 (화면 검증표와 같은 셈)');
function table(label, keep) {
  console.log(`\n  [${label}]`);
  console.log('    ' + ''.padEnd(30) + HS.map(h => `+${h}일`.padEnd(19)).join(''));
  const row = (nm, f) => console.log('    ' + nm.padEnd(30) + HS.map(h => fmt(st(f(h).filter(x => keep(x.d))))).join(''));
  row('기준선(아무 날)', h => R.base[h]);
  row('현행 다중', h => R.multi[h]);
  for (const [nm, f] of CANDS) row(nm, h => R.base[h].filter(x => f(x.pat)));
  console.log('    — 다중 ∩ 패턴(조이기) —');
  const patOf = h => { const m = new Map(); R.base[h].forEach(x => m.set(x.t + '|' + x.d, x.pat)); return m; };
  for (const [nm, f] of CANDS.slice(0, 1).concat(CANDS.slice(3))) row('다중∩' + nm.trim(), h => { const P = patOf(h); return R.multi[h].filter(x => f(P.get(x.t + '|' + x.d))); });
}
table('전체', () => true);
table('§2 앞 반', d => d < mid);
table('§2 뒤 반', d => d >= mid);
const s5 = st(R.base[5].filter(x => CANDS[0][1](x.pat)));
console.log(`\n  B_MA5∪B_STOCH +5일 표본 ${s5.n}건 · 종목 ${s5.tk}개 · 최근 60거래일 ${st(R.base[5].filter(x => CANDS[0][1](x.pat) && x.d >= dates[Math.max(0, dates.length - 65)])).n}건`);
