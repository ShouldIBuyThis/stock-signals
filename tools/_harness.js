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
/* index.html이 모듈 스코프에 두는 캐시 슬롯들. 함수만 추출하면 이 선언이 빠져
   ReferenceError가 난다 — var로 미리 잡아 둔다(호이스팅되므로 순서 무관). */
var _hitRanks = null, _hitRanksFor = null, _hitRanksBt = null;
var state = { data:null, overrides:{}, holdings:[], cart:[], hidden:[],
              market:'all', showHoldings:false, themeFilter:null };
${BASE_FUNCS.concat(o.extra||[]).map(extractFunction).join('\n')}
${o.tail || ''}
`, ctx);
  return ctx;
}

/* ── 페이지 통째로 올리기 ──────────────────────────────────────────────
   extractFunction()은 함수를 하나씩 꺼내므로 의존 함수가 많은 것
   (strategyValidation → rankMaps → decorateMultiFlags → …)에는 쓸 수 없다.
   그럴 때는 index.html의 <script>를 통째로 vm에 올리고 그 안에서 호출한다.
   화면과 완전히 같은 코드가 도는 것이 보장된다 — 부분 추출보다 안전하다.

   최상위 let/const(state, evaluate 등)는 컨텍스트 객체에 안 붙으므로
   반드시 runInPage()로 코드 문자열을 넣어 호출한다. */
/**
 * @param {object} opts
 *   patch  [[찾을 문자열, 바꿀 문자열], ...] — 페이지를 올리기 전에 코드를 고친다.
 *          진단용으로 내부 값을 밖으로 빼낼 때만 쓴다(예: result._rows=out).
 *          찾는 문자열이 없으면 즉시 죽는다 — 조용히 원본이 도는 걸 막는다.
 */
function loadPage(opts){
  let code = /<script[^>]*>([\s\S]*?)<\/script>/.exec(src())[1];
  ((opts && opts.patch) || []).forEach(([from, to]) => {
    if(!code.includes(from)) die(`loadPage patch 앵커 없음: ${from.slice(0,60)}`);
    code = code.replace(from, to);
  });
  const noop = () => {};
  const el = () => ({ style:{}, dataset:{}, children:[],
    classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},
    addEventListener:noop, appendChild:noop, setAttribute:noop, removeAttribute:noop,
    querySelector:()=>null, querySelectorAll:()=>[], closest:()=>null,
    get innerHTML(){return "";}, set innerHTML(v){},
    get textContent(){return "";}, set textContent(v){},
    remove:noop, focus:noop, scrollIntoView:noop });
  const ctx = { console, Math, Number, Object, Array, Set, Map, String, JSON, Date, RegExp,
    Boolean, Error, isNaN, parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
    Promise, Symbol,
    document:{ getElementById:()=>el(), querySelector:()=>el(), querySelectorAll:()=>[],
      createElement:()=>el(), addEventListener:noop, body:el(), documentElement:el(),
      head:el(), readyState:"loading", cookie:"" },
    navigator:{userAgent:"node"}, location:{href:"file:///x/",protocol:"file:",search:""},
    localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
    setTimeout:()=>0, clearTimeout:noop, setInterval:()=>0, clearInterval:noop,
    requestAnimationFrame:()=>0, fetch:()=>Promise.reject(new Error("no net")),
    matchMedia:()=>({matches:false,addEventListener:noop}), alert:noop,
    history:{replaceState:noop},
    addEventListener:noop, removeEventListener:noop, dispatchEvent:noop,
    scrollTo:noop, innerWidth:1200, innerHeight:800 };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, {filename:'index.html'});
  ctx.runInPage = expr => vm.runInContext(expr, ctx);
  return ctx;
}

module.exports = { src, die, extractFunction, extractConst, extractLine,
                   buildContext, loadPage, BASE_CONSTS, BASE_FUNCS };
