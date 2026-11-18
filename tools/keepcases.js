#!/usr/bin/env node
/**
 * 보존 사례 회귀 검사 — "이 신호는 절대 잃지 마라" 목록 (읽기 전용)
 *
 * 사용자가 지목한 실제 성공 사례를 배포 산식이 지금도 잡는지 확인한다.
 * 컷·관문을 조일 때마다 이걸 돌려서, 승률 숫자를 올리려다 **잡아야 할 것을
 * 잃지 않았는지** 확인하는 게 목적이다. 승률표만 보면 이걸 놓친다.
 *
 * 판정
 *   ✅ 강한매수(등급5)로 잡힘        — 보존됨
 *   🔶 매수관심(등급4)까지만          — 부분 보존 (화면에는 뜨지만 초록뱃지 아님)
 *   ❌ 중립(등급3)                    — 놓침
 *
 * 사용: node tools/keepcases.js [--all]   (--all은 각 종목의 전 거래일 등급도 찍는다)
 */
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync('index.html', 'utf8');
const base = JSON.parse(fs.readFileSync('signals.json', 'utf8'));
const ALL = process.argv.includes('--all');

/* ── 보존 목록. 사용자가 직접 지목한 것만 넣는다 (임의 추가 금지) ──
   [티커, 날짜, 한 줄 설명] */
const KEEP = [
  ['COHR',      '2026-07-29', '7/29 종가 → +5일 +47.8% ($222.05→$328.22)'],
  ['NET',       '2026-07-02', '7/2 종가 → +3일 +12.8% ($242.41→$273.40) · 추세 사례'],
  ['SNOW',      '2026-07-27', '7/27 종가 → +5일 +12.7% ($272.92→$307.53) · 추세 사례'],
  ['SPCX',      '2026-08-06', '스페이스엑스 8/6 종가 매수 폭등'],
  ['AAOI',      '2026-08-07', '8/7 → 8/14 +10.8% (8/14 하루 +15.5% 폭등 전)'],
  ['IREN',      '2026-08-11', '8/11 → +3일 +10.8%'],
  ['SNDK',      '2026-08-06', '샌디스크 바닥 확인 후 첫 포착'],
  ['SNDK',      '2026-08-10', '샌디스크'],
  ['SNDK',      '2026-08-11', '샌디스크'],
  ['229200.KS', '2026-07-29', '코스닥150 항복 바닥'],
  ['229200.KS', '2026-07-30', '코스닥150'],
  ['069500.KS', '2026-07-30', '코스피200'],
  ['GLD',       '2026-07-21', '금 — 약세장 방어섹터 사례'],
];

/* ── 익절 보존 목록(2026-11-18 사용자 지시 "NAIL 익절 보존사례 등록") — 사용자가 지목한 것만 · 임의 추가 금지 ──
   [티커, 날짜, 반드시 떠야 하는 익절 신호 키(prTrimSrc k), 한 줄 설명]
   TAG_SPLIT = 🔥 과열 분할익절(evaluate 과열 태그) · OR_R_MA20 = 🟠 20일선 이격 +25%(오늘의 신호 · 고점판독기 일부익절) */
const KEEP_TRIM = [
  ['NAIL', '2026-11-02', 'TAG_SPLIT', '🔥 과열 분할익절 · 37.41 → 10일 −13.2%'],
  ['NAIL', '2026-11-04', 'TAG_SPLIT', '🔥 과열 분할익절 · 40.68 → 5일 −14.8%'],
  ['NAIL', '2026-11-05', 'TAG_SPLIT', '🔥 과열 분할익절 · 38.64 → 5일 −14.9%'],
  ['NAIL', '2026-11-05', 'OR_R_MA20', '🟠 20일선 이격 +25% · 38.64 → 5일 −14.9%'],
  ['NAIL', '2026-11-09', 'OR_R_MA20', '🟠 20일선 이격 +25% · 39.38 → 3일 −16.5%'],
];

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

const OTHER = ['qqqRsiOn','washoutLevel','competitionRank','strategyOrdinalRank','volumeOrdinalRank','rankMapsFor','rankOf',
  'generalMultiGate','generalTierGate','strictMultiGate','previousOverallGrade','multiSignalRank',
  'normalize','decorate','histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks'];
const ctx = { console, Math, Number, Object, Array, Set, Map, String, JSON };
vm.createContext(ctx);
vm.runInContext(`
${extractLine(/^const has = .*$/m)}
${extractLine(/^const r1 = .*$/m)}
${extractLine(/^const num = .*$/m)}
${extractLine(/^const isKR = .*$/m)}
${['DEFENSE','HEALTH','FINANCE','INDUSTRIAL','MEM','GPU'].map(extractConst).join('\n')}
${extractConst('THEME_ONLY_TICKERS')}
${extractConst('NAME_MAP')}
${extractConst('CAT_MAP')}
${extractConst('DEFENSIVE_CATS')}
${extractConst('LEVERAGED')}
const levX = tk => (LEVERAGED[tk] ? LEVERAGED[tk].x : 1);
${extractConst('RANK_NONE')}
${extractConst('HIST_FIELDS_DEFAULT')}
var state = { data:null, overrides:{}, holdings:[], cart:[], hidden:[], market:'all', showHoldings:false, themeFilter:null };
${extractFunction('evaluate')}
${OTHER.map(extractFunction).join('\n')}
/* 날짜별 종목 우주를 화면(strategyValidation)과 같은 방식으로 만든다.
   다중 순위는 그날 전체 종목을 놓고 매기므로 한 종목만 평가하면 답이 달라진다. */
this.snap = d => {
  state.data = normalize(d);
  const byDate = {};
  allStocks().forEach(s => {
    const hs = histStocks(s) || [];
    hs.forEach((h,i) => {
      if(!h.last_date) return;
      const row = Object.assign({}, s, h);
      if(i>0) withPrev(row, hs[i-1]);
      if(i>0) row._prevOverallGrade = evaluate(hs[i-1]).grade;
      row.sig = evaluate(row);
      (byDate[h.last_date] = byDate[h.last_date] || []).push(row);
    });
  });
  const out = {};
  Object.keys(byDate).forEach(day => {
    const uni = byDate[day], rank = {};
    (multiSignalRank(uni) || []).forEach(x => { if(x && x.ticker) rank[x.ticker] = x; });
    out[day] = { uni, rank };
  });
  return out;
};`, ctx);

const snap = ctx.snap(base);
const F = base.hist_fields, I_D = F.indexOf('date'), I_P = F.indexOf('price');
const fwd = (tk, date) => {
  const s = base.stocks.find(x => x.ticker === tk); if(!s) return {};
  const h = s.hist || [], i = h.findIndex(r => String(r[I_D]) === String(date));
  if(i < 0) return {};
  const p0 = h[i][I_P]; if(!p0) return {};
  const o = {};
  for(const k of [1,3,5]){ const q = h[i+k] && h[i+k][I_P]; if(q) o[k] = (q/p0-1)*100; }
  return o;
};
function verdict(row, rank){
  if(!row) return ['❔', '데이터 없음', ''];
  const g = row.sig.grade;
  const r = rank[row.ticker];
  const tag = r ? (r._multiStrict || r._multiTier===1 ? '💡 강한다중' : '🔵 일반다중')
                : (g>=5 ? '🟢 강한매수' : g===4 ? '△ 매수관심' : '· 중립');
  const which = [row.sig.pullGrade===5 ? '추세' : null, row.sig.revGrade===5 ? '반등' : null].filter(Boolean).join('+')
             || (row.sig.pullGrade===4 ? '추세관심' : row.sig.revGrade===4 ? '반등관심' : '—');
  return [g>=5 ? '✅' : g===4 ? '🔶' : '❌', tag, which];
}

console.log('보존 사례 회귀 검사 — 배포 산식이 지금도 잡는가');
console.log('✅ 강한매수(등급5) · 🔶 매수관심(등급4)까지만 · ❌ 중립\n');
console.log('     티커        날짜         판정          경로       +1일    +3일    +5일   설명');
console.log('  ' + '─'.repeat(112));
let ok=0, part=0, miss=0, gone=0;
for(const [tk, date, note] of KEEP){
  const slot = snap[date];
  const row = slot && slot.uni.find(x => x.ticker === tk);
  const [mark, tag, which] = verdict(row, (slot&&slot.rank)||{});
  if(mark==='✅') ok++; else if(mark==='🔶') part++; else if(mark==='❔') gone++; else miss++;
  const f = fwd(tk, date);
  const n = k => (f[k]===undefined ? '    —' : `${f[k]>=0?'+':''}${f[k].toFixed(1)}%`.padStart(7));
  console.log(`  ${mark} ${tk.padEnd(11)}${date}  ${tag.padEnd(12)}${which.padEnd(10)}${n(1)} ${n(3)} ${n(5)}  ${note}`);
}
console.log('  ' + '─'.repeat(112));
console.log(`  보존 ${ok} · 부분 ${part} · 놓침 ${miss} · 창 밖 ${gone}  (총 ${KEEP.length}건)`);
if(gone) console.log(`  ❔ '창 밖'은 원장 창(최대 60거래일, history/ 스냅샷이 있는 8/10부터) 밖이라 hist에 그 날짜가 없는 것이다.
     산식 회귀가 아니므로 '놓침'과 구분해 센다. 오래된 사례는 시간이 지나면 전부 여기로 간다.`);

if(ALL){
  const days = Object.keys(snap).sort();
  const tks = [...new Set(KEEP.map(k => k[0]))];
  console.log('\n\n■ 지목 종목의 전 거래일 등급 (@ 💡 · O 🔵 · # 🟢 · + △ · . 중립)');
  console.log('  ' + days.map(d => d.slice(5).replace('-','')).join(' '));
  for(const tk of tks){
    const line = days.map(d => {
      const slot = snap[d], row = slot && slot.uni.find(x => x.ticker === tk);
      if(!row) return '  . ';
      const r = slot.rank[tk], g = row.sig.grade;
      return r ? ((r._multiStrict||r._multiTier===1) ? '  @ ' : '  O ')
               : g>=5 ? '  # ' : g===4 ? '  + ' : '  . ';
    }).join('');
    console.log(`  ${tk.padEnd(10)}${line}`);
  }
}


/* ── 익절 보존 검사 — 화면 함수 그대로(tools/_harness · prTrimSrc). 그날 원장 행을 지금 산식으로 다시 판정해 그 신호가 뜨는지 본다. ── */
{
  const H = require('./_harness'), page = H.loadPage();
  page.runInPage(`this.__trimKeep = (j, list) => { state.data = normalize(JSON.parse(j)); return list.map(([tk, d, key]) => {
    const s = allStocks().find(x => x.ticker === tk); const hs = s ? (histStocks(s) || []) : []; const i = hs.findIndex(h => String(h.last_date) === d);
    if (i < 0) return { gone: true };
    const row = Object.assign({}, s, hs[i]); if (i > 0) withPrev(row, hs[i-1]); row._prevOverallGrade = i > 0 ? evaluate(hs[i-1]).grade : null;
    row.sig = evaluate(row); row.ext_pair = null; let src = []; try { src = prTrimSrc(row); } catch(e){}
    return { on: src.some(x => x.k === key), all: src.map(x => x.t) }; }); };`);
  const res = page.__trimKeep(fs.readFileSync('signals.json', 'utf8'), KEEP_TRIM);
  let ko = 0, kmiss = 0, kgone = 0;
  console.log('\n익절 보존 사례 — 지금 산식이 그날 그 익절 신호를 다시 띄우는가 (✅ 뜸 · ❌ 안 뜸 · ❔ 원장 창 밖)');
  console.log('  ' + '─'.repeat(112));
  KEEP_TRIM.forEach(([tk, d, key, note], k) => { const r = res[k]; const m = r.gone ? '❔' : r.on ? '✅' : '❌';
    if (r.gone) kgone++; else if (r.on) ko++; else kmiss++;
    console.log(`  ${m} ${tk.padEnd(6)}${d}  ${key.padEnd(10)} ${note}${r.all ? '  | 그날 신호: ' + (r.all.join(' / ') || '없음') : ''}`); });
  console.log('  ' + '─'.repeat(112));
  console.log(`  익절 보존 ${ko} · 놓침 ${kmiss} · 창 밖 ${kgone}  (총 ${KEEP_TRIM.length}건)`);
}
