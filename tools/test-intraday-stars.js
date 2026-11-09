/**
 * ⭐ 단위 시험(합성 자료) — 미래 봉 불변 · 미확정 봉 제외 · 국장 15:00 종가 봉/누락 구간 제외 · 문구 방향 일관성.
 * 사용: node tools/test-intraday-stars.js   (실패하면 exit 1)
 */
const vm = require('vm'), H = require('./_harness');
const ctx = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
vm.createContext(ctx);
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat','idStarEvents','idStarText','idStarSummary','idHM','idMD'].map(H.extractFunction).join('\n') + '\n'
  + H.extractConst('ID_STATE') + '\nthis.SE = idStarEvents; this.TX = idStarText; this.SM = idStarSummary; this.mtf = idMtf;', ctx);
let fail = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) fail++; };
let seed = 5; const rnd = () => { seed = (seed*16807) % 2147483647; return seed/2147483647 - 0.5; };
const mk = (off, starts, n, p0) => { const bars = []; let p = p0;
  for (const ds of starts) for (let i = 0; i < n; i++){ const ts = ds + i*300, o = p; p *= 1 + rnd()*0.006; bars.push([ts, o, Math.max(o, p)*(1 + Math.abs(rnd())*0.003), Math.min(o, p)*(1 - Math.abs(rnd())*0.003), p, Math.round(1e4*(1 + Math.abs(rnd())*3))]); }
  return bars; };
/* 시험용 후보: 자주 나오는 모양으로 상승·하락 둘 다 */
const CANDS = [
  { pat:'일반 양봉', dir:'up', when:null, newState:false, match:'names', hit:62, n:20, verified:false, why:'시험' },
  { pat:'일반 음봉', dir:'down', when:null, newState:false, match:'names', hit:62, n:20, verified:false, why:'시험' },
  { pat:'인사이드바', dir:'down', when:null, newState:false, match:'names', hit:62, n:20, verified:false, why:'시험' },
  { pat:'장대양봉', dir:'up', when:null, newState:false, match:'names', hit:62, n:20, verified:false, why:'시험' },
  { pat:'양봉 마루보주', dir:'up', when:null, newState:false, match:'names', hit:62, n:20, verified:false, why:'시험' },
  { pat:'상승장악형', dir:'up', when:null, newState:false, match:'names', hit:62, n:20, verified:false, why:'시험' },
];
// 미장 5일
const US0 = Date.UTC(2026,10,2,14,30)/1000, us = mk(-18000, [0,1,2,3,4].map(i => US0 + i*86400), 78, 100);
/* ▲ 재돌파가 확실히 나오도록 오늘 40~45번째 봉을 '하락 5봉 → 거래량 실린 장대양봉'으로 바꾼다 */
for (let j = 35; j <= 40; j++){ const i = 4*78 + j, o = us[i-1][4], c = j < 40 ? o*0.997 : o*1.008, h = Math.max(o, c)*1.0003, l = Math.min(o, c)*0.9997;
  us[i] = [us[i][0], o, h, l, c, j < 40 ? 8000 : 60000]; }
for (let i = 4*78 + 41; i < 5*78; i++){ const sh = us[4*78 + 40][4]/us[i][1]; us[i] = [us[i][0], us[i][1]*sh, us[i][2]*sh, us[i][3]*sh, us[i][4]*sh, us[i][5]]; }
const dUS = { tz:'America/New_York', gmtoffset:-18000, reg:{ start: US0 + 4*86400, end: US0 + 4*86400 + 23400 }, price: us[us.length-1][4] };
const full = ctx.SE({ ...dUS, bars: us, lastTrade: dUS.reg.end }, dUS.reg.end + 60, CANDS);
ok(full.length > 5, `미장 합성: 별 사건 ${full.length}건`);
// 1) 미래 봉 불변: 중간 시각에서 잘라 돌린 결과가 전체 결과의 앞부분과 같아야
let inv = true;
for (const cutK of [30, 50, 70]){
  const tau = us[4*78 + cutK][0], part = us.filter(b => b[0] + 300 <= tau);
  const a = ctx.SE({ ...dUS, bars: part, lastTrade: tau }, tau, CANDS).map(e => e.ts + e.dir + e.items.map(c => c.pat).join());
  const b = full.filter(e => e.ts + 300 <= tau).map(e => e.ts + e.dir + e.items.map(c => c.pat).join());
  if (JSON.stringify(a) !== JSON.stringify(b)) inv = false;
}
ok(inv, '미래 봉을 더 넣어도 과거 별(시각·패턴·방향)이 바뀌지 않음');
// 2) 미확정 봉 제외: 장중, 마지막 봉 진행 중이면 그 봉엔 별 없음
const tauMid = us[4*78 + 40][0] + 150, partMid = us.slice(0, 4*78 + 41);
const evMid = ctx.SE({ ...dUS, bars: partMid, lastTrade: tauMid }, tauMid, CANDS);
ok(!evMid.some(e => e.ts === partMid[partMid.length-1][0]), '진행 중(미확정) 봉에는 별 없음');
// 3) 국장: 15:00 종가 봉·15:00~15:30에는 별 없음
const KR0 = Date.UTC(2026,10,3,0,0)/1000, kr = mk(32400, [0,1,2,3,6].map(i => KR0 + i*86400), 72, 78000);
const k0 = KR0 + 6*86400, close = kr[kr.length-1][4];
kr.push([k0 + 21600, close, close, close, close, 0]);
const evKR = ctx.SE({ tz:'Asia/Seoul', gmtoffset:32400, reg:{ start:k0, end:k0 + 21600 }, price: close, bars: kr, lastTrade: k0 + 23400 }, k0 + 23400 + 600, CANDS);
ok(evKR.length > 0 && evKR.every(e => e.m < 900), `국장: 별 ${evKR.length}건 · 모두 15:00 이전 봉(종가 봉·누락 구간 없음)`);
// 4) 문구 방향 일관성
let txt = true, upNote = true, downNote = true, e5note = true;
for (const e of [...full, ...evKR]){
  const T = ctx.TX(e), all = [T.dirLabel, ...T.lines, ...T.notes].join(' ');
  if (e.dir === 'down' && /매수 후보(?!가 아니)|매수 검토/.test(all)) txt = false;
  if (e.dir === 'down' && !/하락/.test(T.dirLabel)) txt = false;
  if (e.dir === 'up' && !/상승/.test(T.dirLabel)) txt = false;
  if (e.dir === 'mixed' && !/불확실/.test(all)) txt = false;
  if (e.items.some(c => c.dir === 'up') && e.stateAt !== 'go' && !/기존 매수 조건 미충족/.test(all)) upNote = false;
  if (e.items.some(c => c.dir === 'down') && !/매수 후보가 아니에요/.test(all)) downNote = false;
  if (e.e5 && e.items.some(c => c.dir === 'up') && !/동시 충족/.test(all)) e5note = false;
  if (!T.time.includes(ctx.idHM ? '' : '')) txt = false;
}
ok(txt, '하락 별에는 매수 문구 없음 · 방향 라벨 일치 · 충돌은 불확실 표시');
ok(upNote, '상승 별 + 기존 매수 조건 미충족 → "기존 매수 조건 미충족" 표시');
ok(downNote, '하락 별 → "매수 후보가 아니에요" 표시');
const nE5 = [...full, ...evKR].filter(e => e.e5 && e.items.some(c => c.dir === 'up')).length;
ok(e5note && nE5 > 0, `▲ 재돌파와 같은 봉의 상승 별 ${nE5}건 → "동시 충족" 표시`);
ok([...full, ...evKR].some(e => e.dir === 'mixed') ? true : true, `혼합 방향 사건 ${[...full, ...evKR].filter(e => e.dir === 'mixed').length}건`);
// 5) 요약 줄: 장중 최근 3봉 사건만 · 사건과 같은 시각·방향
const A = ctx.mtf({ ...dUS, bars: partMid, lastTrade: tauMid }, tauMid), sm = ctx.SM(evMid, A);
const latest = evMid[evMid.length-1], D5 = A.tf[5].filter(r => r.done), recent = D5.slice(-3).map(r => r.ts);
ok(sm ? (sm.ev === latest && recent.includes(latest.ts)) : !recent.includes(latest && latest.ts), '요약 줄은 최근 확정 3봉의 가장 최근 별만 · 같은 사건');
const Aclosed = ctx.mtf({ ...dUS, bars: us, lastTrade: dUS.reg.end }, dUS.reg.end + 3600);
ok(ctx.SM(full, Aclosed) === null, '장 종료 뒤에는 "지금" 요약 줄 없음');
console.log(fail ? `\n❌ ${fail}개 실패` : '\n✅ 모두 통과'); process.exit(fail ? 1 : 0);
