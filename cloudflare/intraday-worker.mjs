/**
 * 장중 차트 중계 서버 (Cloudflare Worker) — 야후 5분봉을 받아 사이트(shouldibuythis.github.io)에 넘겨준다.
 * 2026-11-09 사용자 지시: Worker 방식 · 5분봉 하나로 30분봉도 만든다(30분 합치기는 사이트에서) · 같은 티커 10분 캐시.
 *
 * 쓰는 법: Cloudflare 대시보드 → Workers & Pages → Create → Hello World → Deploy → Edit code → 이 파일 내용 전체 붙여넣기 → Deploy
 * 주소 예: https://stock-intraday.<계정이름>.workers.dev/?t=NVDA
 *
 * 응답(JSON): { t, tz, gmtoffset, reg:{start,end}(정규장 시각, 초), lastTrade(마지막 체결 시각, 초), price, fetchedAt, bars:[[시각초,시,고,저,종,거래량]...] }
 * ⚠ 야후 차트 주소는 공식 API가 아니다 — 예고 없이 막히거나 바뀔 수 있다. 실패하면 { error } 를 돌려주고 사이트는 안내만 띄운다.
 */
const ALLOW = ["https://shouldibuythis.github.io"];
const TTL = 600;   // 10분

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers } });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin") || "";
    const cors = { "Access-Control-Allow-Origin": ALLOW.includes(origin) ? origin : ALLOW[0], "Vary": "Origin", "Access-Control-Allow-Methods": "GET, OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "GET") return json({ error: "GET만 받아요" }, 405, cors);
    const t = (url.searchParams.get("t") || "").toUpperCase();
    if (!/^[A-Z0-9.\-^=]{1,15}$/.test(t)) return json({ error: "티커 형식이 올바르지 않아요" }, 400, cors);

    const cache = typeof caches !== "undefined" ? caches.default : null;
    const key = new Request(`https://intraday.cache/chart?t=${encodeURIComponent(t)}`);
    if (cache) {
      const hit = await cache.match(key);
      if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); r.headers.set("X-Cache", "HIT"); return r; }
    }
    let y;
    try {
      y = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=5m&range=5d&includePrePost=false`,
        { headers: { "User-Agent": "Mozilla/5.0" } });
    } catch (e) { return json({ error: "시세 서버에 연결하지 못했어요" }, 502, cors); }
    if (!y.ok) return json({ error: `시세 서버 응답 ${y.status}` }, 502, cors);
    let d; try { d = await y.json(); } catch (e) { return json({ error: "시세 응답 형식 오류" }, 502, cors); }
    const r = d && d.chart && d.chart.result && d.chart.result[0];
    if (!r || !r.timestamp) return json({ error: "장중 데이터가 없어요" }, 404, cors);
    const q = r.indicators.quote[0], ts = r.timestamp, bars = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
      if ([o, h, l, c].every(x => typeof x === "number")) bars.push([ts[i], o, h, l, c, v || 0]);
    }
    const m = r.meta || {}, tp = (m.currentTradingPeriod || {}).regular || {};
    const body = { t, tz: m.exchangeTimezoneName, gmtoffset: m.gmtoffset, reg: { start: tp.start, end: tp.end },
                   lastTrade: m.regularMarketTime, price: m.regularMarketPrice, fetchedAt: Math.floor(Date.now() / 1000), bars };
    const resp = json(body, 200, { ...cors, "Cache-Control": `public, max-age=${TTL}`, "X-Cache": "MISS" });
    if (cache) ctx.waitUntil(cache.put(key, resp.clone()));
    return resp;
  },
};
