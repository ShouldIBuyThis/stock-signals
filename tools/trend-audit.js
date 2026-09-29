// Read-only extraction: production validation supplies eligibility and returns.
const fs=require('fs'),zlib=require('zlib'),H=require('./_harness');
const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),F=raw.hist_fields,di=F.indexOf('date'),vi=F.indexOf('market_vxn');
for(const s of raw.stocks) s.hist=s.hist.filter(r=>r[di]>='2024-09-25').map(r=>{if(r[vi]==null&&raw.macro?.vxn?.[r[di]]!=null)r[vi]=Number(raw.macro.vxn[r[di]]);return r;});
const orig=H.extractFunction('evaluate');
const enriched=orig.replace('return { score, buyScore,','return { audit:{dipSoft,dipHard,resting,dumpRecovered,dry,rising,pPos,tNeg,cNeg,pullChase,pullBandOK,sectorOK,tickerOK,sectorTuneOK,nearHighM}, score, buyScore,');
const c=H.loadPage({patch:[[orig,enriched],['// 초록 강한매수(최종 grade 5) 성과.', 'return {_phaseRows:{base:baseOut}}; // 초록 강한매수(최종 grade 5) 성과.'],['baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date});','if(h===3||h===5||h===7) baseOut[h].push({ret:(hs[i+h].price/row.price-1)*100, date:row.last_date,endDate:hs[i+h].last_date,ticker:row.ticker,row:Object.fromEntries(Object.entries(row).filter(([k,v])=>k==="sig"||v===null||["number","string","boolean"].includes(typeof v)))});']]});
c.raw=raw;c.runInPage('state.data=normalize(raw)');
const v=c.runInPage('strategyValidation()');
if(!process.argv[3]?.endsWith('.gz')) throw Error('output must end in .gz (large temporary rows)');
fs.writeFileSync(process.argv[3],zlib.gzipSync(JSON.stringify(v._phaseRows.base)));
console.log('saved audit rows',Object.fromEntries([3,5,7].map(h=>[h,v._phaseRows.base[h].length])));
