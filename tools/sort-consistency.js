#!/usr/bin/env node
/**
 * 다중순 vs 종합순 — 어느 나열이 승률 정합성이 좋은가 (읽기 전용)
 *
 * 질문: 위에 올라온 종목이 실제로 더 잘 갔는가. 순위가 좋을수록 성적이
 * 좋아야 '순위가 일한 것'이고, 뒤죽박죽이면 그 나열은 정보가 아니다.
 *
 * 방법: 과거 각 거래일의 유니버스를 그날 값으로 다시 만들고
 *   · 종합순 = currentOverallRanked()와 같은 규칙(등급 → 상대점수 z)
 *   · 다중순 = 다중신호 자격 종목만, 화면과 같은 multiSignalRank()
 * 로 세운 뒤 순위 구간별 +1/3/5일 성적을 본다.
 *
 * 편중 검사도 같이 한다 — 특정 섹터·종목이 상위를 독식하면 순위가
 * '좋은 신호'가 아니라 '그 섹터'를 재고 있는 것이다.
 *
 * 사용: node tools/sort-consistency.js
 */
const fs = require('fs'), H = require('./_harness');
const ctx = H.loadPage();
ctx.__raw = fs.readFileSync('signals.json', 'utf8');
const R = ctx.runInPage(`(() => {
  state.data = normalize(JSON.parse(__raw));
  const packs = new Map();
  allStocks().forEach(s => packs.set(s.ticker, {s, hs: histStocks(s) || []}));
  const dates = [...new Set([...packs.values()].flatMap(p => p.hs.map(h => h.last_date)))].filter(Boolean).sort();
  const out = [];
  dates.forEach(d => {
    const uni = [];
    packs.forEach(({s, hs}) => {
      const i = hs.findIndex(h => h.last_date === d);
      if(i < 0 || !has(hs[i].price) || !hs[i].price) return;
      const row = Object.assign({}, s, hs[i]);
      if(i>0) withPrev(row, hs[i-1]);
      row._prevOverallGrade = i>0 ? evaluate(hs[i-1]).grade : null;
      row.sig = evaluate(row);
      const f = {};
      [1,3,5].forEach(k => { const e = hs[i+k]; if(e && has(e.price)) f[k] = (e.price/hs[i].price-1)*100; });
      uni.push({tk:s.ticker, cat:s.category, sig:row.sig, f, row});
    });
    if(uni.length < 10) return;
    /* 종합순 — currentOverallRanked()와 같은 규칙 */
    const st = key => { const v = uni.map(x=>Number(x.sig[key])||0);
      const m = v.reduce((a,b)=>a+b,0)/v.length;
      return {m, sd: Math.sqrt(v.reduce((a,b)=>a+(b-m)*(b-m),0)/v.length) || 1}; };
    const P = st("pullScore"), V = st("revScore");
    const rel = x => { const p=((Number(x.sig.pullScore)||0)-P.m)/P.sd, r=((Number(x.sig.revScore)||0)-V.m)/V.sd;
      return {best:Math.max(p,r), other:Math.min(p,r)}; };
    const overall = uni.slice().sort((a,b)=>{ const A=rel(a),B=rel(b);
      return b.sig.grade-a.sig.grade || B.best-A.best || B.other-A.other || a.tk.localeCompare(b.tk); });
    /* 다중순 — 다중 자격(등급5 + 일반/엄격 관문) 종목만, 점수 높은 순 */
    const multi = uni.filter(x => x.sig.grade>=5 &&
        (strictMultiGate(x.row) || generalTierGate(x.row)))
      .sort((a,b)=> (strictMultiGate(b.row)?1:0)-(strictMultiGate(a.row)?1:0) ||
                    (Number(b.sig.buyScore)||0)-(Number(a.sig.buyScore)||0) || a.tk.localeCompare(b.tk));
    out.push({d, overall:overall.map(x=>({tk:x.tk,cat:x.cat,f:x.f,g:x.sig.grade})),
                 multi:multi.map(x=>({tk:x.tk,cat:x.cat,f:x.f,g:x.sig.grade}))});
  });
  return out;
})()`);

const rate = a => { const w=a.filter(x=>x>1).length, l=a.filter(x=>x<-1).length; return (w+l)?Math.round(w/(w+l)*100):null; };
const fmt = rows => [1,3,5].map(h => { const a = rows.map(x=>x.f[h]).filter(v=>v!==undefined);
  const av = a.length ? a.reduce((p,c)=>p+c,0)/a.length : null;
  return `+${h}일 ${String(rate(a)??'-').padStart(3)}%(${String(a.length).padStart(3)}) ${av===null?'':(av>=0?'+':'')+av.toFixed(2)+'%'}`; }).join('  ');
const slice = (key, from, to) => R.flatMap(d => d[key].slice(from, to));

console.log(`거래일 ${R.length}일 · 하루 평균 유니버스 ${Math.round(R.reduce((s,d)=>s+d.overall.length,0)/R.length)}종목\n`);
console.log('■ 종합순 — 위에 올라온 종목이 실제로 더 갔는가');
[[0,3,'1~3위'],[3,5,'4~5위'],[5,10,'6~10위'],[10,20,'11~20위'],[20,999,'21위 밖']].forEach(([a,b,l])=>{
  const s = slice('overall',a,b); if(s.length) console.log(`  ${l.padEnd(8)} ${fmt(s)}`); });
console.log('\n■ 다중순 (자격 종목만)');
[[0,3,'1~3위'],[3,5,'4~5위'],[5,10,'6~10위'],[10,999,'11위 밖']].forEach(([a,b,l])=>{
  const s = slice('multi',a,b); if(s.length) console.log(`  ${l.padEnd(8)} ${fmt(s)}`); });
console.log('\n■ 편중 검사 — 종합순 1~5위를 누가 차지했나');
const cnt = {}, cat = {};
R.forEach(d => d.overall.slice(0,5).forEach(x => { cnt[x.tk]=(cnt[x.tk]||0)+1; cat[x.cat]=(cat[x.cat]||0)+1; }));
const tot = R.length*5;
const top = o => Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,6)
  .map(([k,v])=>`${k} ${v}회(${Math.round(v/tot*100)}%)`).join(' · ');
console.log('  종목:', top(cnt));
console.log('  섹터:', top(cat));
