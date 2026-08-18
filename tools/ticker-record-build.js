#!/usr/bin/env node
/**
 * 종목별 예측 적중률 표를 만든다 — 사이트가 읽을 작은 파일로.
 *
 * 입력  backtest/raw.json            (tools/backfill_backtest.py가 만든 장기 원본, ~5MB)
 * 출력  backtest/ticker-record.json  (종목당 신호 3종 × 4구간, 수십 KB)
 *
 * 원본을 그대로 사이트에 올리면 5MB를 매번 받아야 한다. 표는 숫자 몇 개뿐이므로
 * 여기서 미리 접어 둔다.
 *
 * 산식은 index.html을 **통째로 vm에 올려서** 화면과 같은 함수를 그대로 호출한다
 * (tools/_harness.js loadPage). 예전에는 evaluate()만 문자열로 꺼내 쓰느라
 * 강한매수 한 줄밖에 못 만들었는데, 다중·강한다중은 그날 유니버스 전체를 봐야
 * 정해지므로 부분 추출로는 재현할 수 없다. 재구현은 금지다(방법론 §0).
 *
 * ⚠ 이 숫자는 백테스트다. frozen 원장(signals.json)과 다른 주장이다:
 *    · 지금 산식을 과거에 소급 적용한 것 — 그날 실제로 본 신호가 아니다
 *    · 관심종목을 현재 시점에서 골랐으므로 생존 편향으로 위로 부풀려진다
 *    · 시장 국면·항복 바닥(K2)·실적 영향권 제외는 운영과 같게 적용된다
 *   그래서 검증표(30거래일 원장)와 직접 비교하면 안 되고, 화면에도 그렇게 적는다.
 *
 * 사용: node tools/ticker-record-build.js [입력] [출력]
 */
const fs = require('fs'), path = require('path'), H = require('./_harness');

const IN  = process.argv[2] || 'backtest/raw.json';
const OUT = process.argv[3] || 'backtest/ticker-record.json';

if (!fs.existsSync(IN)) {
  console.error(`[ERROR] ${IN} 이 없다. 먼저 python tools/backfill_backtest.py 를 돌릴 것.`);
  process.exit(1);
}
const raw = fs.readFileSync(IN, 'utf8');
const base = JSON.parse(raw);

const ctx = H.loadPage();
ctx.__raw = raw;
const res = ctx.runInPage(`(() => {
  state.data = normalize(JSON.parse(__raw));
  const recs = tickerSignalRecords();
  /* 화면이 쓰는 모양 그대로 저장한다. 여기서 키를 바꾸면 화면이 다시 변환해야 하고
     그 변환이 두 번째 산식이 된다. */
  const out = {};
  Object.keys(recs).forEach(tk => {
    const r = recs[tk], o = {};
    TICKER_KINDS.forEach(({k}) => {
      const g = r[k] || {}, c = { signals: g.signals || 0 };
      TICKER_HS.forEach(h => { const x = g[h] || {n:0,rate:null,avg:null};
        c[h] = { n:x.n||0, rate:x.rate===undefined?null:x.rate, avg:x.avg===undefined?null:x.avg }; });
      o[k] = c;
    });
    out[tk] = o;
  });
  const days = [...new Set(allStocks().flatMap(s => (histStocks(s)||[]).map(h => h.last_date)))]
                 .filter(Boolean).sort();
  /* 신호 단위 표본도 같이 뽑는다. 종목별 요약만으로는 §2 반쪽 검증도, 섹터별
     컷 스윕도 못 한다 — 날짜가 없으면 반으로 자를 수 없고, 점수가 없으면
     '문턱을 올리면 어떻게 되나'를 잴 수 없기 때문이다. 원장 30일로 재면
     표본이 6건짜리가 나와 판단이 불가능하다. */
  const cat = {}; allStocks().forEach(s => cat[s.ticker] = s.category);
  /* 신호일의 점수·핵심 입력을 (티커|날짜)로 미리 뽑아 둔다. _phaseRows에는
     수익률과 등급만 있어서 '문턱을 올리면 뭐가 지워지나'를 잴 수 없었다.
     evaluate()를 한 번 더 도는 것뿐이고, 판정은 여기서 하지 않는다. */
  const meta = new Map();
  allStocks().forEach(s => {
    const hs = histStocks(s) || [];
    hs.forEach((h, i) => {
      if(!h.last_date || !has(h.price)) return;
      const row = Object.assign({}, s, h);
      if(i>0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null;
      const g = evaluate(row);
      meta.set(s.ticker+'|'+h.last_date, {
        buy:g.buyScore, pull:g.pullScore, rev:g.revScore, brk:g.breakScore,
        rsi:has(row.rsi)?Math.round(row.rsi*10)/10:null,
        bb:has(row.bb_pos)?Math.round(row.bb_pos*10)/10:null,
        lvl:h.market_level||null });
    });
  });
  const phase = (strategyValidation() || {})._phaseRows || {};
  const byId = new Map();
  TICKER_KINDS.forEach(({k, src:key}) => {
    TICKER_HS.forEach(h => {
      ((phase[key] || {})[h] || []).forEach(x => {
        const id = k+'|'+x.ticker+'|'+x.date;
        let row = byId.get(id);
        if(!row){ row = Object.assign({k, t:x.ticker, c:cat[x.ticker]||"", d:x.date, r:{}},
                                       meta.get(x.ticker+'|'+x.date) || {}); byId.set(id, row); }
        row.r[h] = Math.round(x.ret*100)/100;
      });
    });
  });
  const samples = [...byId.values()];
  return { records: out, days, samples, kinds: TICKER_KINDS.map(x=>x.k), horizons: TICKER_HS };
})()`);

const days = res.days;
const payload = {
  kind: 'backtest',
  note: '현재 산식을 과거 데이터에 소급 적용한 백테스트. signals.json의 frozen 원장(그날 실제로 본 신호)과 다른 주장이다.',
  survivorship_warning: '관심종목을 현재 시점에서 골랐으므로 과거 성적은 위로 편향된다.',
  earnings_excluded: base.earnings_excluded === true,
  built_at: new Date().toISOString().slice(0,16).replace('T',' ') + ' UTC',
  window: days.length ? { from: days[0], to: days[days.length-1], days: days.length } : null,
  kinds: res.kinds,
  horizons: res.horizons,
  records: res.records,
};
/* 신호 단위 표본은 별도 파일로 낸다 — 사이트는 요약만 받으면 되고,
   이건 도구(§2 반쪽·섹터 컷 스윕)가 읽는다. */
const SOUT = OUT.replace(/\.json$/, '') + '-samples.json';
fs.writeFileSync(SOUT, JSON.stringify({
  kind:'backtest', note:payload.note, window:payload.window,
  horizons:res.horizons, samples:res.samples }));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload));

const tks = Object.keys(payload.records);
console.log(`실적 제외: ${payload.earnings_excluded ? '적용' : '미적용'} · QQQ 기준카드(K2): ${base.qqq_card ? '있음' : '없음'}`);
console.log(`저장: ${OUT} (${(fs.statSync(OUT).size/1024).toFixed(0)}KB) · ${tks.length}종목 · ` +
  `창 ${payload.window ? payload.window.from+'~'+payload.window.to+' ('+payload.window.days+'일)' : '없음'}`);
console.log(`신호 표본: ${SOUT} (${(fs.statSync(SOUT).size/1024).toFixed(0)}KB) · ${res.samples.length}건`);
res.kinds.forEach(k => {
  const n3 = tks.map(t => payload.records[t][k][3].n).sort((a,b)=>a-b);
  if(n3.length) console.log(`  ${k.padEnd(7)} +3일 표본 최소 ${n3[0]} · 중앙 ${n3[Math.floor(n3.length/2)]} · 최대 ${n3[n3.length-1]} · 5건+ ${n3.filter(x=>x>=5).length}/${n3.length}`);
});
