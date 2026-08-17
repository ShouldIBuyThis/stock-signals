#!/usr/bin/env node
/**
 * PRIVATE 종목별 등급 변천사 — "예전엔 신호가 떴는데 지금은 왜 안 뜨나" (읽기 전용)
 *
 * 같은 데이터(현재 signals.json)에 **과거 index.html 버전들의 산식**을 하나씩
 * 물려서, 지정 종목의 날짜별 등급이 어느 커밋에서 바뀌었는지 찾는다.
 * 데이터를 고정하고 산식만 갈아끼우므로, 등급 변화의 원인이 산식이라는 게
 * 분리돼서 보인다.
 *
 * 사용: node tools/version-timeline.js [티커...]     (기본 IREN AAOI)
 *       node tools/version-timeline.js IREN --dates  (날짜별 상세)
 */
const fs = require('fs'), vm = require('vm'), cp = require('child_process');

const TICKERS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const SHOW_DATES = process.argv.includes('--dates');
const LIST = TICKERS.length ? TICKERS : ['IREN', 'AAOI'];

const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));

/* index.html을 건드린 커밋을 오래된 순으로 */
const commits = cp.execSync('git log --reverse --format=%h%x09%ad%x09%s --date=short -- index.html',
  { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n')
  .map(l => { const [h, d, ...s] = l.split('\t'); return { h, d, s: s.join(' ') }; });

/* ── 버전 하나를 샌드박스에 올린다. 없는 심볼은 조용히 건너뛴다 ── */
function build(src) {
  const die = m => { throw new Error(m); };
  function fn(name, optional) {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) { if (optional) return ''; die(`function ${name}() 없음`); }
    const brace = src.indexOf('{', start);
    let depth = 0, q = null, esc = false, lc = false, bc = false;
    for (let i = brace; i < src.length; i++) {
      const c = src[i], n = src[i + 1];
      if (lc) { if (c === '\n') lc = false; continue; }
      if (bc) { if (c === '*' && n === '/') { bc = false; i++; } continue; }
      if (q) { if (esc) { esc = false; continue; } if (c === '\\') { esc = true; continue; } if (c === q) q = null; continue; }
      if (c === '/' && n === '/') { lc = true; i++; continue; }
      if (c === '/' && n === '*') { bc = true; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
    }
    if (optional) return '';
    die(`${name}() 끝 없음`);
  }
  function line(re, optional) { const m = src.match(re); if (!m) { if (optional) return ''; die(String(re)); } return m[0]; }
  function cst(name, optional) {
    let st = src.indexOf(`const ${name} =`);
    if (st < 0) st = src.indexOf(`const ${name}=`);
    if (st < 0) { if (optional) return ''; die(`const ${name} 없음`); }
    return src.slice(st, src.indexOf(';', st) + 1);
  }

  const CONSTS = ['DEFENSE', 'HEALTH', 'FINANCE', 'INDUSTRIAL', 'MEM', 'GPU', 'NAME_MAP', 'CAT_MAP',
    'DEFENSIVE_CATS', 'LEVERAGED', 'RANK_NONE', 'HIST_FIELDS_DEFAULT'];
  const FNS = ['qqqRsiOn', 'washoutLevel', 'competitionRank', 'strategyOrdinalRank', 'volumeOrdinalRank',
    'rankMapsFor', 'rankOf', 'generalMultiGate', 'generalTierGate', 'strictMultiGate',
    'previousOverallGrade', 'multiSignalRank', 'evaluate', 'normalize', 'decorate',
    'histWindowDays', 'histFields', 'histRow', 'withPrev', 'histStocks', 'prevStock', 'allStocks'];

  const ctx = { console, Math, Number, Object, Array, Set, Map, String, JSON, Date, isNaN, parseFloat, parseInt };
  vm.createContext(ctx);
  vm.runInContext(`
${line(/^const has = .*$/m)}
${line(/^const r1 = .*$/m, true)}
${line(/^const num = .*$/m, true)}
${line(/^const isKR = .*$/m, true)}
${CONSTS.map(c => cst(c, true)).join('\n')}
${src.includes('LEVERAGED') ? 'const levX = tk => (typeof LEVERAGED!=="undefined" && LEVERAGED[tk] ? LEVERAGED[tk].x : 1);' : ''}
var state = { data:null, overrides:{}, holdings:[], cart:[], hidden:[], market:'all', showHoldings:false, themeFilter:null };
${FNS.map(f => fn(f, f !== 'evaluate' && f !== 'normalize')).join('\n')}
/* 화면(strategyValidation)이 만드는 것과 같은 방식으로 그날의 종목 우주를 만든다.
   다중 순위는 그날 전체 종목을 놓고 매기므로 한 종목만 평가하면 답이 달라진다. */
this.universe = d => {
  state.data = normalize(d);
  const byDate = {};
  allStocks().forEach(s => {
    const hs = histStocks(s); if(!hs || !hs.length) return;
    hs.forEach((h, i) => {
      if(!h.last_date) return;
      const row = Object.assign({}, s, h);
      if(i>0 && typeof withPrev==='function') withPrev(row, hs[i-1]);
      if(i>0) { try { row._prevOverallGrade = evaluate(hs[i-1]).grade; } catch(e){} }
      row.sig = evaluate(row);
      (byDate[h.last_date] = byDate[h.last_date] || []).push(row);
    });
  });
  const out = {};
  Object.keys(byDate).forEach(day => {
    const uni = byDate[day];
    const rank = {};
    if(typeof multiSignalRank==='function'){
      const r = multiSignalRank(uni) || [];
      (Array.isArray(r) ? r : []).forEach(x => { if(x && x.ticker) rank[x.ticker] = x; });
    }
    out[day] = { uni, rank };
  });
  return out;
};
`, ctx);
  return ctx;
}

/* hist 안의 날짜 목록 */
const F = base.hist_fields, I_D = F.indexOf('date');
const days = [...new Set(base.stocks.flatMap(s => (s.hist || []).map(r => String(r[I_D]))))].sort();

function gradeLabel(st, rank) {
  if (!st) return ' ';
  const g = st.sig ? st.sig.grade : st.grade;
  const r = rank && rank[st.ticker];
  if (r && (r._multiStrict || r._multiTier === 1)) return '@';   // 💡 강한다중
  if (r) return 'O';                                             // 🔵 일반다중
  if (g >= 5) return '#';                                        // 🟢 강한매수
  if (g === 4) return '+';                                       // △ 매수관심
  return '.';                                                    // 중립
}

console.log(`데이터 고정(현재 signals.json · ${days[0]}~${days[days.length - 1]}, ${days.length}거래일) · 산식만 커밋별로 교체`);
console.log('@ 💡강한다중   O 🔵일반다중   # 🟢강한매수   + △매수관심   . 중립   x 재현불가\n');

/* 커밋마다 전체 종목·전체 날짜를 한 번만 계산하고, 티커별로 잘라 쓴다 */
const perCommit = [];
for (const c of commits) {
  let src;
  try { src = cp.execSync(`git show ${c.h}:index.html`, { encoding: 'utf8', maxBuffer: 1 << 26 }); }
  catch { continue; }
  let uni = null, err = null;
  try { uni = build(src).universe(base); }
  catch (e) { err = e.message; }
  perCommit.push({ c, uni, err });
  if (process.env.DBG && err) console.error(c.h, 'BUILD', err);
}

for (const tk of LIST) {
  console.log(`\n═══ ${tk} ═══`);
  let prev = null;
  for (const { c, uni, err } of perCommit) {
    const cells = days.map(d => {
      if (err || !uni) return 'x';
      const slot = uni[d];
      if (!slot) return ' ';
      return gradeLabel(slot.uni.find(s => s.ticker === tk), slot.rank);
    });
    const sig = cells.join('');
    if (sig === prev) continue;
    prev = sig;
    const n = ch => cells.filter(x => x === ch).length;
    console.log(`\n${c.h} ${c.d}  ${c.s.slice(0, 54)}`);
    console.log(`  💡${n('@')} 🔵${n('O')} 🟢${n('#')} △${n('+')}   ${sig}`);
  }
  if (SHOW_DATES) console.log('\n  날짜: ' + days.map(d => d.slice(5)).join(' '));
}
