#!/usr/bin/env node
/**
 * PRIVATE 게이트 해제 실험실 — "지표가 압도적일 때만 컷을 풀어준다" (읽기 전용)
 *
 * K2(약세장이라도 QQQ RSI<=35면 방어섹터 게이트 해제)가 유일한 조건부 해제인데
 * 발동일이 7/29 하루뿐이라 검증이 안 된다. 그래서 해제 조건 후보를 여러 개
 * 만들어 같은 잣대로 줄세운다.
 *
 * 세 축을 따로, 그리고 조합해서 시험한다.
 *   A 반등 추격 컷   run3Eff<=3      → 조건 만족 시 더 높은 값까지 허용
 *   B 방어섹터 게이트 sectorOK        → 조건 만족 시 비방어섹터도 강한매수 허용
 *   C 반등 RSI 컷    rsi<=50         → 조건 만족 시 60까지 허용
 *
 * 채택 자격 (docs/승률-검증-방법론.md):
 *   ① 늘어나는 표본만의 성적이 같은 구간 기준선을 넘을 것 (§'하지 않는 것')
 *   ② 전·후반 양쪽에서 기준선을 넘을 것 (§2)
 *   ③ 표본 15건 이상, 종목 3개 이상 (§5-1, §5)
 *   ④ 전체 검증표(💡·초록)를 크게 깎지 않을 것
 * 넷 다 통과한 것만 '후보'로 부른다. 하나라도 걸리면 기록만 한다.
 *
 * 사용: node tools/relief-lab.js [A|B|C|MIX]   (기본 전부)
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const ONLY = (process.argv[2] || '').toUpperCase();

function die(m){ console.error('[ERROR]', m); process.exit(1); }
function extractFunction(name){
  const start = src.indexOf(`function ${name}(`);
  if(start < 0) die(name);
  const brace = src.indexOf('{', start);
  let depth=0,q=null,esc=false,lc=false,bc=false;
  for(let i=brace;i<src.length;i++){
    const c=src[i],n=src[i+1];
    if(lc){if(c==='\n')lc=false;continue;} if(bc){if(c==='*'&&n==='/'){bc=false;i++;}continue;}
    if(q){if(esc){esc=false;continue;}if(c==='\\'){esc=true;continue;}if(c===q)q=null;continue;}
    if(c==='/'&&n==='/'){lc=true;i++;continue;} if(c==='/'&&n==='*'){bc=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){q=c;continue;}
    if(c==='{')depth++; else if(c==='}'){depth--;if(depth===0)return src.slice(start,i+1);}
  } die(name+' end');
}
function extractLine(re){ const m=src.match(re); if(!m) die(String(re)); return m[0]; }
function extractConst(name){ const st=src.indexOf(`const ${name} =`); if(st<0) die(name); return src.slice(st, src.indexOf(';',st)+1); }

/* ── 배포 소스의 세 앵커. 한 글자라도 다르면 즉시 죽는다 (조용한 오작동 방지) ── */
const SECTOR_LINE = `const sectorOK = !marketGuarded || DEFENSIVE_CATS.includes(s.category);`;
const REV_LINE = `const revStrong = revScore>=2.0 && has(rsi) && rsi<=50 && sectorOK &&
    (run3Eff===null || run3Eff<=3);`;

/* evaluate() 안에서 쓸 수 있는 지역변수: p, rsi, bb, ma20, ma60, run3Eff, revScore,
   pullScore, breakScore, s.*  — 새 상수는 만들지 않고 이미 있는 값만 조합한다. */
function patchedEvaluate(opt){
  const chaseHi   = opt.chaseHi   || null;   // {expr, upto}
  const sectorRel = opt.sectorRel || null;   // expr
  const rsiHi     = opt.rsiHi     || null;   // {expr, upto}
  let e = extractFunction('evaluate');
  if(!e.includes(SECTOR_LINE)) die('방어섹터 게이트 앵커를 못 찾음');
  if(!e.includes(REV_LINE))    die('반등 강매 게이트 앵커를 못 찾음');

  if(sectorRel){
    e = e.replace(SECTOR_LINE,
      `const sectorOK = !marketGuarded || DEFENSIVE_CATS.includes(s.category) || (${sectorRel});`);
  }
  const rsiPart = rsiHi
    ? `(rsi<=50 || (rsi<=${rsiHi.upto} && (${rsiHi.expr})))`
    : `rsi<=50`;
  const chasePart = chaseHi
    ? `(run3Eff===null || run3Eff<=3 || (run3Eff<=${chaseHi.upto} && (${chaseHi.expr})))`
    : `(run3Eff===null || run3Eff<=3)`;
  e = e.replace(REV_LINE,
    `const revStrong = revScore>=2.0 && has(rsi) && ${rsiPart} && sectorOK &&
    ${chasePart};`);
  return e;
}

const OTHER = ['qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks',
  'earningsWindowsForValidation','validationWindowTouchesEarnings'];
const ANCHOR = 'result._diag=diag;';
function validationSrc(){
  let f = extractFunction('strategyValidation');
  if(!f.includes(ANCHOR)) die('strategyValidation 앵커 없음');
  return f.replace(ANCHOR, ANCHOR +
    '\n  result._rows={multi:out.multi, pull:out.pull, rev:out.rev, strong:strongBuyOut};');
}

function ctxFor(opt){
  const ctx = { console, Math, Number, Object, Array, Set, Map, String, JSON };
  vm.createContext(ctx);
  vm.runInContext(`
${extractLine(/^const has = .*$/m)}
${extractLine(/^const r1 = .*$/m)}
${extractLine(/^const num = .*$/m)}
${extractLine(/^const isKR = .*$/m)}
${['DEFENSE','HEALTH','FINANCE','INDUSTRIAL','MEM','GPU'].map(extractConst).join('\n')}
${extractConst('NAME_MAP')}
${extractConst('CAT_MAP')}
${extractConst('DEFENSIVE_CATS')}
${extractConst('LEVERAGED')}
const levX = tk => (LEVERAGED[tk] ? LEVERAGED[tk].x : 1);
${extractConst('RANK_NONE')}
${extractConst('HIST_FIELDS_DEFAULT')}
var state = { data:null, overrides:{}, holdings:[], cart:[], hidden:[], market:'all', showHoldings:false, themeFilter:null };
${patchedEvaluate(opt)}
${OTHER.map(extractFunction).join('\n')}
${validationSrc()}
this.run = d => { state.data = normalize(d); return strategyValidation(); };
/* 지정한 티커·날짜가 강한매수로 풀렸는지 확인한다 */
this.check = (d, want) => {
  state.data = normalize(d);
  const hit = {};
  allStocks().forEach(s => {
    const hs = histStocks(s) || [];
    hs.forEach((h,i) => {
      const k = s.ticker + '|' + h.last_date;
      if(!want.includes(k)) return;
      const row = Object.assign({}, s, h);
      if(i>0) withPrev(row, hs[i-1]);
      if(i>0) row._prevOverallGrade = evaluate(hs[i-1]).grade;
      hit[k] = evaluate(row).grade;
    });
  });
  return hit;
};`, ctx);
  return ctx;
}
const cache = new Map();
function run(opt, data, tag){
  const k = (tag||'') + '|' + JSON.stringify(opt);
  if(data === base && cache.has(k)) return cache.get(k);
  const v = ctxFor(opt).run(data);
  if(data === base) cache.set(k, v);
  return v;
}

/* ── 표본 창 ── */
const F = base.hist_fields, I_D = F.indexOf('date');
const days = [...new Set(base.stocks.flatMap(s => (s.hist||[]).map(r => String(r[I_D]))))].sort();
const MID = days[Math.floor(days.length/2)];
const clip = pred => {
  const d = JSON.parse(JSON.stringify(base));
  for(const s of d.stocks) s.hist = (s.hist||[]).filter(r => pred(String(r[I_D])));
  return d;
};

const key = r => `${r.ticker}|${r.date||r.last_date}`;
const rate = rows => { const w=rows.filter(r=>r.ret>1).length, l=rows.filter(r=>r.ret<-1).length; return (w+l)?Math.round(w/(w+l)*100):null; };
const avg  = rows => rows.length ? Math.round(rows.reduce((a,r)=>a+r.ret,0)/rows.length*100)/100 : null;
const revRows = (v,h) => (v._rows.rev[h]||[]).filter(x => x.tier===5);

/* 사용자가 지목한 사례 — 이게 풀리는지가 실험의 출발점이다 */
const CASES = ['IREN|2026-07-30','IREN|2026-07-31','IREN|2026-08-04','IREN|2026-08-11',
               'AAOI|2026-08-07','AAOI|2026-08-11','AAOI|2026-08-12'];

const P0 = run({}, base);
const B = P0._baseline;
console.log(`표본 창 ${days[0]} ~ ${days[days.length-1]} (${days.length}거래일) · 전후반 분기 ${MID}`);
console.log(`기준선  +1일 ${B[1].rate}%(평균 ${B[1].avg>=0?'+':''}${Math.round(B[1].avg*100)/100}%)  +3일 ${B[3].rate}%(${Math.round(B[3].avg*100)/100}%)  +5일 ${B[5].rate}%(${Math.round(B[5].avg*100)/100}%)`);
console.log(`대조군  반등강매 ${P0.rev[1].rate}%(${P0.rev[1].n}) ${P0.rev[3].rate}%(${P0.rev[3].n}) ${P0.rev[5].rate}%(${P0.rev[5].n}) · 💡 ${P0._strict[3].rate}%(${P0._strict[3].n}) · 초록 ${P0._strongBuy[3].rate}%(${P0._strongBuy[3].n})\n`);

/* ── 해제 조건 후보. 전부 기존 저장 지표만 쓴다 (새 상수 금지) ── */
const S = {
  rev25:   ['반등점수>=2.5',        'revScore>=2.5'],
  rev30:   ['반등점수>=3.0',        'revScore>=3.0'],
  rsiLow:  ['RSI<=40 (바닥권)',      'has(rsi)&&rsi<=40'],
  rsiLow35:['RSI<=35 (투매)',        'has(rsi)&&rsi<=35'],
  bbLow:   ['볼린저<=25 (밴드하단)',  'has(bb)&&bb<=25'],
  bbHi:    ['볼린저>=80 (밴드상단)',  'has(bb)&&bb>=80'],
  rs20:    ['상대강도 rs20>=0',      'has(s.rs20)&&s.rs20>=0'],
  rs20hi:  ['상대강도 rs20>=15',     'has(s.rs20)&&s.rs20>=15'],
  vol:     ['거래량>=1.5배',         'has(s.vol_ratio)&&s.vol_ratio>=1.5'],
  volLow:  ['거래량<=0.8 (마른)',    'has(s.vol_ratio)&&s.vol_ratio<=0.8'],
  macd:    ['MACD 히스토 양전',      'has(s.macd_hist)&&s.macd_hist>0'],
  stoch:   ['스토캐스틱 골든',        's.stoch_cross==="golden"'],
  ma20up:  ['20일선 상승',           'has(s.ma20_slope)&&s.ma20_slope>0'],
  aboveMa20:['20일선 위',            'has(p)&&has(ma20)&&p>ma20'],
  washout: ['3일누적<=-10 (투매후)',  'run3Eff!==null&&run3Eff<=-10'],
};

function newRows(v, h){
  const cur = new Set(revRows(P0,h).map(key));
  return revRows(v,h).filter(x => !cur.has(key(x)));
}
function summarize(label, opt){
  const v = run(opt, base);
  const cells = [1,3,5].map(h => {
    const s = v.rev[h];
    return `${s.rate===null?'—':s.rate+'%'}(${s.n})`.padStart(10);
  }).join('');
  const nu = [1,3,5].map(h => {
    const n = newRows(v, h);
    if(!n.length) return '     —    ';
    const r = rate(n), d = (r!==null) ? `${r-B[h].rate>=0?'+':''}${r-B[h].rate}` : '';
    return `${r===null?'—':r+'%'}(${n.length})${d}`.padStart(13);
  }).join('');
  const n3 = newRows(v,3), tks = new Set(n3.map(x=>x.ticker));
  const hit = ctxFor(opt).check(base, CASES);
  const freed = CASES.filter(c => hit[c]===5 && !(ctxFor({}).check(base,[c])[c]===5));
  return { v, label, cells, nu, tks, n3, freed,
    line: `  ${label.padEnd(30)}${cells}  |${nu}  ${String(tks.size).padStart(2)}종  ${freed.map(f=>f.replace('|2026-','·')).join(' ')}` };
}

const CASE0 = ctxFor({}).check(base, CASES);
console.log('사용자 지목 사례 — 현행 등급: ' + CASES.map(c=>`${c.replace('|2026-','·')}=${CASE0[c]}`).join('  '));
console.log('(5=강한매수 4=매수관심 3=중립)\n');

const HEAD = '  ' + '변형'.padEnd(30) + '  반등 +1     +3      +5   |   신규 +1일      +3일      +5일   종목  풀린 사례';
const RULE = '  ' + '─'.repeat(112);

/* ══════════ A. 반등 추격 컷 ══════════ */
const results = [];
if(!ONLY || ONLY==='A'){
  console.log('■ A. 반등 추격 컷 — 3 초과분을 조건부로 허용 (IREN 8/11은 run3Eff 4.8)');
  console.log(HEAD); console.log(RULE);
  console.log(summarize('A0  현행 (무조건 <=3)', {}).line);
  for(const [k, upto] of [['fix5',5],['fix6',6],['fix8',8]]){
    console.log(summarize(`A-  무조건 <=${upto} (조건없음)`, {chaseHi:{expr:'true', upto}}).line);
  }
  for(const k of ['rev25','rev30','rsiLow','bbLow','rs20','vol','volLow','macd','stoch','aboveMa20']){
    const r = summarize(`A   <=6 단 ${S[k][0]}`, {chaseHi:{expr:S[k][1], upto:6}});
    results.push(['A', k, r]); console.log(r.line);
  }
  console.log('');
}

/* ══════════ B. 방어섹터 게이트 ══════════ */
if(!ONLY || ONLY==='B'){
  console.log('■ B. 방어섹터 게이트 — 약세·주의장 비방어섹터를 조건부로 해제 (K2 외 추가 해제조건)');
  console.log(HEAD); console.log(RULE);
  console.log(summarize('B0  현행 (K2만)', {}).line);
  for(const k of ['rev30','rev25','rsiLow35','rsiLow','bbLow','rs20hi','vol','washout','stoch','macd']){
    const r = summarize(`B   해제: ${S[k][0]}`, {sectorRel:S[k][1]});
    results.push(['B', k, r]); console.log(r.line);
  }
  /* 두 조건 AND — 하나만으로는 너무 헐거울 때 */
  for(const [a,b] of [['rev30','rsiLow'],['rev25','bbLow'],['rev30','washout'],['rsiLow','vol']]){
    const r = summarize(`B   해제: ${S[a][0]}＋${S[b][0]}`, {sectorRel:`(${S[a][1]})&&(${S[b][1]})`});
    results.push(['B', a+'+'+b, r]); console.log(r.line);
  }
  console.log('');
}

/* ══════════ C. 반등 RSI 컷 ══════════ */
if(!ONLY || ONLY==='C'){
  console.log('■ C. 반등 RSI 컷 — 50 초과 60까지를 조건부로 허용 (AAOI 8/07~8/12는 RSI 55~57)');
  console.log(HEAD); console.log(RULE);
  console.log(summarize('C0  현행 (무조건 <=50)', {}).line);
  console.log(summarize('C-  무조건 <=60 (조건없음)', {rsiHi:{expr:'true', upto:60}}).line);
  for(const k of ['rev25','rev30','bbHi','rs20hi','vol','macd','stoch','ma20up','aboveMa20']){
    const r = summarize(`C   <=60 단 ${S[k][0]}`, {rsiHi:{expr:S[k][1], upto:60}});
    results.push(['C', k, r]); console.log(r.line);
  }
  console.log('');
}

/* ══════════ MIX. 두 축 동시 해제 ══════════
   IREN 7/30·7/31은 섹터 게이트와 추격 컷에 **둘 다** 걸려 있다(run3Eff 5.4·8.5).
   그래서 한쪽만 풀면 사례가 안 풀린다 — 조합을 따로 시험해야 한다. */
const MIXES = [
  ['M1 섹터:스토캐 골든 + 추격<=6:20일선위', {sectorRel:S.stoch[1], chaseHi:{expr:S.aboveMa20[1], upto:6}}],
  ['M2 섹터:RSI<=40 + 추격<=6:20일선위',    {sectorRel:S.rsiLow[1], chaseHi:{expr:S.aboveMa20[1], upto:6}}],
  ['M3 섹터:RSI<=40 + 추격<=6:반등2.5',     {sectorRel:S.rsiLow[1], chaseHi:{expr:S.rev25[1], upto:6}}],
  ['M4 섹터:반등2.5 + 추격<=8:반등2.5',      {sectorRel:S.rev25[1], chaseHi:{expr:S.rev25[1], upto:8}}],
  ['M5 섹터:반등3.0 + 추격<=10:반등3.0',     {sectorRel:S.rev30[1], chaseHi:{expr:S.rev30[1], upto:10}}],
  ['M6 RSI<=60:볼밴상단 + 추격<=6:20일선위', {rsiHi:{expr:S.bbHi[1], upto:60}, chaseHi:{expr:S.aboveMa20[1], upto:6}}],
];
if(!ONLY || ONLY==='MIX'){
  console.log('■ MIX. 두 축 동시 해제 — IREN 7/30·7/31은 섹터+추격에 둘 다 걸려 한쪽만 풀면 안 나온다');
  console.log(HEAD); console.log(RULE);
  console.log(summarize('M0 현행', {}).line);
  for(const [lab, opt] of MIXES){
    const r = summarize(lab, opt);
    results.push(['MIX', lab, r, opt]);
    console.log(r.line);
    const vv = r.v;
    console.log(`  ${''.padEnd(30)}→ 💡 +3일 ${vv._strict[3].rate}%(${vv._strict[3].n})  초록 +3일 ${vv._strongBuy[3].rate}%(${vv._strongBuy[3].n})  초록 +5일 ${vv._strongBuy[5].rate}%(${vv._strongBuy[5].n})`);
  }
  console.log('');
}

/* ══════════ 후보 선별 + §2 전·후반 ══════════ */
console.log('■ 후보 선별 (§: 신규표본이 기준선 초과 · n>=15 · 종목>=3)');
console.log('  ' + '─'.repeat(96));
const CAND = results.filter(([ax,k,r]) => {
  const ok = [3,5].every(h => { const n=newRows(r.v,h); const w=rate(n); return n.length>=10 && w!==null && w>=B[h].rate; });
  return ok && r.n3.length>=15 && r.tks.size>=3;
});
if(!CAND.length) console.log('  통과 없음 — 어떤 해제 조건도 늘어나는 표본이 기준선을 넘지 못했다.');
/* 전·후반은 후보만 (느리다) */
for(const [ax,k,r,mixOpt] of CAND){
  const opt = mixOpt ? mixOpt
            : ax==='A' ? {chaseHi:{expr:S[k]?S[k][1]:'true', upto:6}}
            : ax==='B' ? {sectorRel:S[k]?S[k][1]:'true'}
            : {rsiHi:{expr:S[k]?S[k][1]:'true', upto:60}};
  if(!mixOpt && !S[k]) continue;
  const H1 = ctxFor(opt).run(clip(d=>d<MID)), H2 = ctxFor(opt).run(clip(d=>d>=MID));
  const f = v => [1,3,5].map(h => {
    const s=v.rev[h], b=v._baseline[h];
    return `${s.rate===null?'—':s.rate+'%'}(${s.n})${(s.rate!==null&&b.rate!==null)?` ${s.rate-b.rate>=0?'+':''}${s.rate-b.rate}%p`:''}`.padEnd(18);
  }).join('');
  console.log(`\n  ${r.label}`);
  console.log(`    전반 ${f(H1)}`);
  console.log(`    후반 ${f(H2)}`);
  const vv = run(opt, base);
  console.log(`    전체 검증표: 💡 +3일 ${vv._strict[3].rate}%(${vv._strict[3].n})  초록 +3일 ${vv._strongBuy[3].rate}%(${vv._strongBuy[3].n})  초록 +5일 ${vv._strongBuy[5].rate}%(${vv._strongBuy[5].n})`);
  console.log(`    (대조군: 💡 ${P0._strict[3].rate}%(${P0._strict[3].n})  초록 ${P0._strongBuy[3].rate}%(${P0._strongBuy[3].n})  ${P0._strongBuy[5].rate}%(${P0._strongBuy[5].n}))`);
}
