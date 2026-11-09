/**
 * 2026-11-09 사용자 확인 요청 두 가지 — 결과만 찍는다(화면·판정 변경 없음).
 *
 * --part=a  석별형 + 하락 주의: 예전 64%(n28) → 지금 69%(n26)가 왜 달라졌나.
 *   같은 원본(--keep-extra로 받은, 정규봉 필터 전 자료)으로 단계마다 한 가지씩만 바꿔 사건 목록을 비교한다.
 *     V0 예전 함수(tools/fixtures/intraday-fns-cdfdc7d.js) · 예전 판정 시각(다음 봉 시작) · 필터 전 원본  ← 64% n28 계산 당시
 *     V1 지금 함수 · 예전 판정 시각 · 필터 전 원본                         (국장 15:30 처리 반영 효과)
 *     V2 지금 함수 · 예전 판정 시각 · 정규봉 필터(국장 15:00·미장 16:00 봉 제거) (원본 정리 효과)
 *     V3 지금 함수 · 봉 끝 판정 시각(화면과 같음) · 정규봉 필터                (판정 시각 효과)
 *     V4 화면 함수 idStarEvents() 그대로                                     (V3과 같아야 함)
 *   바뀐 사건마다 종목·날짜·시각·두 판정 시각의 상태·대표패턴·빠진 봉 여부를 찍는다.
 *
 * --part=b  Worker range=5d 그대로 '최근 5거래일' ⭐·⚠️를 다시 계산하면 백테스트와 같은가.
 *   백테스트(=오늘 화면)는 그날 + 앞 4거래일로 지표를 데운다. 5일 자료에서 k일 전 날은 앞 날이 4−k일뿐이다.
 *   그래서 날마다 앞 날 수 w=0..3으로 idStarEvents()를 돌려 w=4(백테스트)와 사건이 같은지 센다.
 *   미래 봉은 넣지 않는다(그날 끝까지의 봉만).
 *
 * 사용: python tools/intraday-fetch.py --keep-extra --out /tmp/raw.json && node tools/intraday-star-window-check.js /tmp/raw.json --part=a
 */
const fs = require('fs'), vm = require('vm'), H = require('./_harness');
const PART = (process.argv.find(a => a.startsWith('--part=')) || '--part=a').slice(7);
const base = { Math, Date, Number, Array, Object, Set, Map, String, Infinity, isFinite };
const NEW = vm.createContext({ ...base });
vm.runInContext(['idLocal','idEma','idAgg','idMtf','idCandleFeat','idStarEvents'].map(H.extractFunction).join('\n')
  + '\n' + H.extractConst('ID_STAR_CANDS').replace('(typeof window !== "undefined" && window.__ID_STAR_CANDS) ||', '')
  + '\nthis.mtf = idMtf; this.feat = idCandleFeat; this.SE = idStarEvents; this.C = ID_STAR_CANDS;', NEW);
const OLD = vm.createContext({ ...base });
vm.runInContext(fs.readFileSync(__dirname + '/fixtures/intraday-fns-cdfdc7d.js', 'utf8') + '\nthis.mtf = idMtf; this.feat = idCandleFeat;', OLD);

const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const isKr = t => /\.(KS|KQ)$/.test(t);
const regular = (t, b) => { const m = Math.floor(((b[0] + b[6]) % 86400) / 60); return isKr(t) ? m < 900 : m < 960; };
const split = bars => { const days = []; let cur = null;
  for (const b of bars){ const day = new Date((b[0] + b[6])*1000).toISOString().slice(0, 10); if (!cur || cur.day !== day){ cur = { day, off: b[6], bars: [] }; days.push(cur); } cur.bars.push(b); }
  return days; };
const hm = (ts, off) => { const m = Math.floor(((ts + off) % 86400) / 60); return String(Math.floor(m/60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const r15 = (B, Lts) => { const e = B.findIndex(b => b[0] >= Lts + 300); if (e < 0) return { e: null, r: null };
  return { e, r: e + 2 < B.length ? (1 - B[e+2][4]/B[e][1])*100 : null }; };   // 하락 쪽: 내려가면 +

if (PART === 'a'){
  const PAT = '석별형';
  /* 백테스트 루프(예전 intraday-candle-wide-lab.js와 같은 모양) — 하락 주의 새 진입 + 대표패턴 */
  const labLoop = (C, D, t, timing) => { const out = new Map(), days = split(D);
    for (let di = 4; di < days.length; di++){
      const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300;
      const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
      let prev = null;
      for (let k = 1; k < B.length; k++){
        const tau = timing === 'next' ? B[k][0] : B[k-1][0] + 300;
        const A = C.mtf({ gmtoffset: today.off, reg: { start: t0, end }, lastTrade: tau, bars: hist.concat(B.slice(0, k).map(b => b.slice(0, 6))) }, tau);
        if (!A) continue;
        const L = A.tf[5].filter(r => r.done).pop(), nd = A.state === 'down' && prev !== 'down', ps = prev; prev = A.state;
        if (!nd || !L) continue;
        const F = C.feat(A, L); if (!F || F.primary !== PAT) continue;
        const x = r15(B, L.ts);
        out.set(`${t}|${today.day}|${hm(L.ts, today.off)}`, { t, day: today.day, at: hm(L.ts, today.off), r: x.r, k, tau: hm(tau, today.off), gap: B[k][0] - B[k-1][0] > 300, prevState: ps, Lts: L.ts });
      }
    }
    return out; };
  const starLoop = (D, t) => { const out = new Map(), days = split(D), cand = NEW.C.filter(c => c.pat === PAT);
    for (let di = 4; di < days.length; di++){
      const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300;
      const hist = days.slice(di-4, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
      const d = { tz: isKr(t) ? 'Asia/Seoul' : 'America/New_York', gmtoffset: today.off, reg: { start: t0, end }, lastTrade: end, price: B[B.length-1][4], bars: hist.concat(B.map(b => b.slice(0, 6))) };
      for (const ev of NEW.SE(d, end, cand)){ const x = r15(B, ev.ts);
        if (x.e == null) continue;                       // 그날 마지막 봉: 다음 봉이 없어 결과 없음(백테스트도 집계 안 함)
        out.set(`${t}|${today.day}|${hm(ev.ts, today.off)}`, { t, day: today.day, at: hm(ev.ts, today.off), r: x.r }); }
    }
    return out; };
  const V = { V0: new Map(), V1: new Map(), V2: new Map(), V3: new Map(), V4: new Map() };
  const raws = {}, extra = { kr: 0, us: 0 };
  for (const [t, D] of Object.entries(raw)){
    const all = D.bars, reg = all.filter(b => regular(t, b)); extra[isKr(t) ? 'kr' : 'us'] += all.length - reg.length; raws[t] = { all, reg };
    for (const [k, v] of labLoop(OLD, all, t, 'next')) V.V0.set(k, v);
    for (const [k, v] of labLoop(NEW, all, t, 'next')) V.V1.set(k, v);
    for (const [k, v] of labLoop(NEW, reg, t, 'next')) V.V2.set(k, v);
    for (const [k, v] of labLoop(NEW, reg, t, 'end')) V.V3.set(k, v);
    for (const [k, v] of starLoop(reg, t)) V.V4.set(k, v);
  }
  const days = [...new Set([...V.V0.values()].map(e => e.day))].sort();
  console.log(`\n=== 석별형 + 🔵 하락 주의(새 진입) — 64%(n28) → 69%(n26) 차이 분해 · ${Object.keys(raw).length}종목 ===`);
  console.log(`  원본에서 정규봉 필터로 지워지는 봉: 국장 ${extra.kr}개 · 미장 ${extra.us}개 (국장 15:00 거래량0 종가 봉 · 미장 16:00 종가 체결 봉)`);
  const stat = m => { const z = [...m.values()].map(e => e.r).filter(v => v != null); return `n${m.size} · +15분 결과 있는 것 ${z.length} · 적중(하락) ${z.length ? (z.filter(v => v > 0).length/z.length*100).toFixed(0) : '—'}% · 평균 ${z.length ? (z.reduce((a, b) => a + b, 0)/z.length).toFixed(3) : '—'}%`; };
  const NAME = { V0: '예전 함수·다음 봉 시작·필터 전 (64% 당시)', V1: '지금 함수·다음 봉 시작·필터 전', V2: '지금 함수·다음 봉 시작·정규봉 필터', V3: '지금 함수·봉 끝(화면과 같음)·정규봉 필터', V4: '화면 함수 idStarEvents()' };
  for (const k of Object.keys(V)) console.log(`  ${k} ${NAME[k].padEnd(34)} ${stat(V[k])}`);
  const why = (e, t) => {
    if (!e) return '';
    const R = raws[e.t]; const extraBars = R.all.filter(b => !regular(e.t, b) && new Date((b[0] + b[6])*1000).toISOString().slice(0, 10) === e.day);
    return `판정 시각 ${e.tau} · 앞 봉과 사이 빈 봉 ${e.gap ? '있음' : '없음'} · 직전 상태 ${e.prevState} · 그날 비정규 봉 ${extraBars.map(b => hm(b[0], b[6]) + (b[5] ? '' : '(거래량0)')).join(',') || '없음'}`; };
  const pairs = [['V0', 'V1'], ['V1', 'V2'], ['V2', 'V3'], ['V3', 'V4']];
  for (const [a, b] of pairs){
    const A = V[a], B = V[b], gone = [...A.keys()].filter(k => !B.has(k)), added = [...B.keys()].filter(k => !A.has(k));
    console.log(`\n  ${a} → ${b}: 빠짐 ${gone.length} · 생김 ${added.length}`);
    for (const k of gone) console.log(`    − ${k} (+15분 ${A.get(k).r == null ? '결과 없음' : A.get(k).r.toFixed(3) + '%'}) ${why(A.get(k))}`);
    for (const k of added) console.log(`    + ${k} (+15분 ${B.get(k).r == null ? '결과 없음' : B.get(k).r.toFixed(3) + '%'}) ${why(B.get(k))}`);
  }
  const g = [...V.V0.keys()].filter(k => !V.V4.has(k)), ad = [...V.V4.keys()].filter(k => !V.V0.has(k));
  console.log(`\n  종합 V0(64% 당시) → V4(화면): 빠짐 ${g.length} · 생김 ${ad.length} · 공통 ${[...V.V0.keys()].filter(k => V.V4.has(k)).length}`);
  console.log(`  V3(백테스트 루프) vs V4(화면 함수): ${[...V.V3.keys()].every(k => V.V4.has(k)) && [...V.V4.keys()].every(k => V.V3.has(k)) ? '✅ 사건 완전 일치' : '❌ 불일치'} (${V.V3.size} / ${V.V4.size})`);
  console.log(`  자료 기간: ${days[0]} ~ ${days[days.length-1]}`);
}

if (PART === 'b'){
  /* 비교 후보: 화면 후보(하락 2종) + 경로 검증용으로 넓힌 하락 3종 + 상승 시험 3종(같은 규칙 · 화면 표는 그대로) */
  const CANDS = NEW.C.concat(['일반 음봉', '인사이드바', '도지'].map(p => ({ pat: p, dir: 'down', when: 'down', newState: true, match: 'primary', hit: 0, n: 0, verified: false, why: '시험' })))
    .concat(['일반 양봉', '상승장악형', '망치형'].map(p => ({ pat: p, dir: 'up', when: 'go', newState: true, match: 'primary', hit: 0, n: 0, verified: false, why: '시험' })));
  const REAL = new Set(NEW.C.map(c => c.pat));
  const W = [0, 1, 2, 3], agg = {};
  for (const w of W) agg[w] = { days: 0, sameDay: 0, base: 0, got: 0, miss: 0, extra: 0, realBase: 0, realMiss: 0, realExtra: 0, ex: [] };
  let nTk = 0;
  for (const [t, D] of Object.entries(raw)){
    const days = split(D.bars.filter(b => regular(t, b))); nTk++;
    for (let di = 4; di < days.length; di++){
      const today = days[di], B = today.bars, t0 = B[0][0], end = B[B.length-1][0] + 300;
      const mk = w => { const hist = days.slice(di - w, di).flatMap(x => x.bars.map(b => b.slice(0, 6)));
        const d = { tz: isKr(t) ? 'Asia/Seoul' : 'America/New_York', gmtoffset: today.off, reg: { start: t0, end }, lastTrade: end, price: B[B.length-1][4], bars: hist.concat(B.map(b => b.slice(0, 6))) };
        return new Set(NEW.SE(d, end, CANDS).flatMap(ev => ev.items.map(c => `${hm(ev.ts, today.off)}|${c.pat}|${c.dir}`))); };
      const base = mk(4);
      for (const w of W){
        const s = mk(w), a = agg[w]; a.days++;
        const miss = [...base].filter(k => !s.has(k)), extra = [...s].filter(k => !base.has(k));
        a.base += base.size; a.got += [...base].filter(k => s.has(k)).length; a.miss += miss.length; a.extra += extra.length;
        const real = k => REAL.has(k.split('|')[1]);
        a.realBase += [...base].filter(real).length; a.realMiss += miss.filter(real).length; a.realExtra += extra.filter(real).length;
        if (!miss.length && !extra.length) a.sameDay++;
        else if (a.ex.length < 3) a.ex.push(`${t} ${today.day} 빠짐[${miss.slice(0, 3).join(' ')}] 생김[${extra.slice(0, 3).join(' ')}]`);
      }
    }
  }
  console.log(`\n=== Worker range=5d 그대로 과거 날 ⭐·⚠️ 재계산 — 앞 날 w일로 데운 결과 vs 백테스트(앞 날 4일) · ${nTk}종목 ===`);
  console.log('  5일 창에서: 오늘=앞 4일(w4, 백테스트와 같음) · 1일 전=w3 · 2일 전=w2 · 3일 전=w1 · 4일 전=w0');
  for (const w of W){ const a = agg[w];
    console.log(`  w=${w} (${4 - w}일 전 날): 종목·날짜 ${a.days} 중 사건 완전 일치 ${(a.sameDay/a.days*100).toFixed(1)}% · 백테스트 사건 ${a.base} 중 재현 ${a.base ? (a.got/a.base*100).toFixed(1) : '—'}% · 빠짐 ${a.miss} · 엉뚱하게 생김 ${a.extra} | 화면 후보(잠자리 도지·석별형)만: 백테스트 ${a.realBase} · 빠짐 ${a.realMiss} · 생김 ${a.realExtra}`);
    a.ex.forEach(x => console.log('      예) ' + x)); }
}
