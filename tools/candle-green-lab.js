/**
 * '살 만함' 중 그날 캔들 색이 🟢인 것만 남기면? — tools/candle-green-dump.py 출력 분석.
 * 캔들 이름·색은 index.html의 todayShape()·CANDLE_LIGHT를 문자열로 꺼내 쓴다(재구현 금지).
 * 사용: node tools/candle-green-lab.js cg.json
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const ctx = { Math, Number, Array, Object, String };
vm.createContext(ctx);
vm.runInContext([H.extractLine(/^const has = .*$/m), H.extractConst('CANDLE_LIGHT'), H.extractFunction('todayShape'),
  'this.shape = todayShape; this.LIGHT = CANDLE_LIGHT;'].join('\n'), ctx);
const D = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const HS = D.hs;
for (const e of D.ev){ e.shape = ctx.shape({ ohlc60: e.ohlc, bb_pos: e.bb }) || '—'; e.light = ctx.LIGHT[e.shape] || '—'; }
const dates = D.ev.map(e => e.d).sort(), mid = dates[Math.floor(dates.length/2)];
const rate = (xs, k) => { const w = xs.filter(e => e.fw[k] > 1).length, l = xs.filter(e => e.fw[k] < -1).length; return w + l ? w/(w + l)*100 : NaN; };
const baseRate = (rows, j) => { let w = 0, l = 0; for (const r of rows){ if (r[j] > 1) w++; else if (r[j] < -1) l++; } return w/(w + l)*100; };
const bAll = HS.map((k, j) => D.base[k][0]/(D.base[k][0] + D.base[k][1])*100);
const bDays = Object.entries(D.baseDays);
const bHalf = h => HS.map((k, j) => baseRate(bDays.filter(([d]) => h ? d >= mid : d < mid).flatMap(([, x]) => x), j));
const grade = n => n >= 50 ? '사용 가능' : n >= 30 ? '방향만' : n >= 15 ? '참고' : '신뢰 불가';
const line = (lab, xs, b) => console.log(`  ${lab.padEnd(22)} n=${String(xs.length).padStart(5)} (${grade(xs.length)})  ` +
  HS.map((k, j) => { const r = rate(xs, k); return `${k}일 ${isFinite(r) ? r.toFixed(0) : '—'}%(${isFinite(r) ? (r - b[j] >= 0 ? '+' : '') + (r - b[j]).toFixed(0) : ''})`; }).join(' · ') +
  `  · 10일 평균 ${(xs.reduce((s, e) => s + e.fw[10], 0)/Math.max(1, xs.length)).toFixed(2)}%`);
const G = D.ev.filter(e => e.light === '🟢'), NG = D.ev.filter(e => e.light !== '🟢');
console.log(`\n=== '살 만함' 중 그날 캔들 🟢만 남기면 — ${dates[0]}~${dates[dates.length-1]} · 다음 날 시가 진입 · 보합 ±1% 제외 · 괄호 = 평소 대비 %p ===`);
console.log('  평소' + ' '.repeat(26) + HS.map((k, j) => `${k}일 ${bAll[j].toFixed(0)}%`).join(' · '));
line('살 만함 전체(지금)', D.ev, bAll);
line('🟢만 남김', G, bAll);
line('지워지는 쪽(🟢 아님)', NG, bAll);
console.log('\n  캔들 색별');
for (const L of ['🟢','🔵','⚪','🟠','🔴','—']) line(`색 ${L}`, D.ev.filter(e => e.light === L), bAll);
console.log('\n  🟢 안의 모양');
const byS = {}; G.forEach(e => (byS[e.shape] = byS[e.shape] || []).push(e));
Object.entries(byS).sort((a, b) => b[1].length - a[1].length).forEach(([s, xs]) => line(s, xs, bAll));
console.log(`\n  반쪽 (기준일 ${mid})`);
for (const [nm, h] of [['앞 반', false], ['뒤 반', true]]){
  const b = bHalf(h), f = e => h ? e.d >= mid : e.d < mid;
  console.log(`   ${nm} 평소 ` + HS.map((k, j) => `${k}일 ${b[j].toFixed(0)}%`).join(' · '));
  line(` ${nm} 전체`, D.ev.filter(f), b); line(` ${nm} 🟢만`, G.filter(f), b); line(` ${nm} 지워지는 쪽`, NG.filter(f), b);
}
const keep = ['COHR','NET','SNOW','SPCX','AAOI','IREN','GLD','SNDK','^KS11','^KQ11'];
const lost = D.ev.filter(e => keep.includes(e.t) && e.light !== '🟢').length, kept = D.ev.filter(e => keep.includes(e.t) && e.light === '🟢').length;
console.log(`\n  보존 사례 종목의 살 만함 사건: 🟢로 남는 ${kept}건 · 빠지는 ${lost}건`);
console.log(`  하루 평균 신호 수: 전체 ${(D.ev.length/new Set(dates).size).toFixed(2)} → 🟢만 ${(G.length/new Set(dates).size).toFixed(2)} (신호가 있는 날 기준)`);
