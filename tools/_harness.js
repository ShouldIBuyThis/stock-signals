/**
 * 공용 추출 하네스 — index.html의 산식을 문자열로 꺼내 vm에서 돌린다.
 *
 * 왜 있나: tools/*.js 18개가 똑같은 45줄짜리 추출기를 각자 복사해 갖고 있었다.
 * 새 도구를 만들 때마다 그걸 다시 쓰느라 토큰을 쓰고, 한쪽만 고쳐 어긋났다.
 * 산식은 index.html의 evaluate() 하나뿐이다 — 재구현 금지(방법론 §0).
 *
 * 사용:
 *   const H = require('./_harness');
 *   const ctx = H.buildContext();                    // 기본 함수 세트
 *   const ctx = H.buildContext({ extra:['tickerStrongRecord'], tail:'this.run = d => {...}' });
 *   ctx.run(JSON.parse(fs.readFileSync('signals.json','utf8')));
 *
 * 앵커가 사라지면 조용히 넘어가지 않고 즉시 죽는다 — 그래야 index.html이
 * 바뀐 걸 알아챈다.
 */
const fs = require('fs'), vm = require('vm');

const SRC_PATH = 'index.html';
let _src = null;
function src(){ return _src || (_src = fs.readFileSync(SRC_PATH, 'utf8')); }

function die(m){ console.error('[ERROR]', m); process.exit(1); }

/* 중괄호 깊이를 세어 함수 본문을 통째로 잘라낸다.
   문자열·주석 안의 중괄호에 속지 않도록 상태를 따라간다. */
function extractFunction(name){
  const s = src();
  const start = s.indexOf(`function ${name}(`);
  if(start < 0) die(`function ${name}() 없음 — index.html이 바뀌었다`);
  const brace = s.indexOf('{', start);
  let depth=0,q=null,esc=false,lc=false,bc=false;
  for(let i=brace;i<s.length;i++){
    const c=s[i],n=s[i+1];
    if(lc){ if(c==='\n')lc=false; continue; }
    if(bc){ if(c==='*'&&n==='/'){bc=false;i++;} continue; }
    if(q){ if(esc){esc=false;continue;} if(c==='\\'){esc=true;continue;} if(c===q)q=null; continue; }
    if(c==='/'&&n==='/'){ lc=true;i++;continue; }
    if(c==='/'&&n==='*'){ bc=true;i++;continue; }
    if(c==='"'||c==="'"||c==='`'){ q=c; continue; }
    if(c==='{') depth++;
    else if(c==='}'){ depth--; if(depth===0) return s.slice(start,i+1); }
  }
  die(`${name}() 끝을 못 찾았다`);
}

function extractConst(name){
  const s = src();
  const st = s.indexOf(`const ${name} =`);
  if(st < 0) die(`const ${name} 없음`);
  return s.slice(st, s.indexOf(';', st)+1);
}

function extractLine(re){
  const m = src().match(re);
  if(!m) die(`패턴 없음: ${re}`);
  return m[0];
}

/* evaluate()가 돌기 위해 필요한 최소 세트. 도구마다 다르게 쓰다 빠뜨려서
   "함수 없음"으로 죽는 일이 잦았으므로 여기 한 곳에 모아 둔다. */
const BASE_CONSTS = ['DEFENSE','HEALTH','FINANCE','INDUSTRIAL','MEM','GPU',
  'NAME_MAP','CAT_MAP','DEFENSIVE_CATS','LEVERAGED','RANK_NONE','HIST_FIELDS_DEFAULT'];
const BASE_FUNCS = ['evaluate','qqqRsiOn','washoutLevel','normalize','decorate',
  'histWindowDays','histFields','histRow','withPrev','histStocks','prevStock','allStocks'];

/**
 * @param {object} opts
 *   extra  추가로 추출할 함수 이름들 (예: ['tickerStrongRecord','earningsWindowsForValidation'])
 *   consts 추가 const 이름들
 *   tail   컨텍스트 마지막에 붙일 코드 문자열 (this.xxx = ... 로 진입점을 만든다)
 */
function buildContext(opts){
  const o = opts || {};
  const ctx = { console, Math, Number, Object, Array, Set, Map, String, JSON, Date };
  vm.createContext(ctx);
  vm.runInContext(`
${extractLine(/^const has = .*$/m)}
${extractLine(/^const r1 = .*$/m)}
${extractLine(/^const num = .*$/m)}
${extractLine(/^const isKR = .*$/m)}
${BASE_CONSTS.concat(o.consts||[]).map(extractConst).join('\n')}
const levX = tk => (LEVERAGED[tk] ? LEVERAGED[tk].x : 1);
var TICKER_BT = null;
var state = { data:null, overrides:{}, holdings:[], cart:[], hidden:[],
              market:'all', showHoldings:false, themeFilter:null };
${BASE_FUNCS.concat(o.extra||[]).map(extractFunction).join('\n')}
${o.tail || ''}
`, ctx);
  return ctx;
}

module.exports = { src, die, extractFunction, extractConst, extractLine,
                   buildContext, BASE_CONSTS, BASE_FUNCS };
