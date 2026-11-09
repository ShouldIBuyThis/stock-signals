// 중계 서버 코드 시험 — Node에서 Worker의 fetch()를 그대로 불러 야후 조회·형식·오류 처리를 본다(Cloudflare 캐시는 Node에 없어 건너뜀).
import worker from "../cloudflare/intraday-worker.mjs";
const ctx = { waitUntil() {} }, O = { headers: { Origin: "https://shouldibuythis.github.io" } };
for (const t of ["NVDA", "005930.KS", "SOXL"]) {
  const r = await worker.fetch(new Request(`https://x.dev/?t=${t}`, O), {}, ctx); const j = await r.json();
  const last = j.bars ? j.bars[j.bars.length - 1] : null;
  console.log(t, r.status, r.headers.get("access-control-allow-origin"), j.error || `봉 ${j.bars.length} · 마지막 봉 ${new Date(last[0] * 1000).toISOString()} · 마지막 체결 ${new Date(j.lastTrade * 1000).toISOString()} · 정규장 ${new Date(j.reg.start * 1000).toISOString()}~${new Date(j.reg.end * 1000).toISOString()} · ${j.tz} · 응답 ${JSON.stringify(j).length}바이트`);
}
for (const bad of ["../x", ""]) { const r = await worker.fetch(new Request(`https://x.dev/?t=${bad}`, O), {}, ctx); console.log("잘못된 티커", JSON.stringify(bad), r.status, (await r.json()).error); }
const p = await worker.fetch(new Request("https://x.dev/?t=NVDA", { method: "OPTIONS", headers: { Origin: "https://shouldibuythis.github.io" } }), {}, ctx);
console.log("사전요청(OPTIONS)", p.status, p.headers.get("access-control-allow-methods"));
