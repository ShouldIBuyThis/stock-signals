"""국장 15:00~15:30 누락 시험 — 야후 includePrePost 비교(조사 전용 · CI). Worker·사이트 무관."""
import json, urllib.request, datetime as dt
KST = dt.timezone(dt.timedelta(hours=9))
for t in ["069500.KS", "229200.KS", "005930.KS"]:
    for pp in ["false", "true"]:
        u = f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?interval=5m&range=1d&includePrePost={pp}"
        r = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=15).read())["chart"]["result"][0]
        ts, q, m = r["timestamp"], r["indicators"]["quote"][0], r["meta"]
        tp = m.get("currentTradingPeriod", {})
        f = lambda x: dt.datetime.fromtimestamp(x, KST).strftime("%H:%M")
        late = [(f(ts[i]), q["close"][i], q["volume"][i]) for i in range(len(ts)) if dt.datetime.fromtimestamp(ts[i], KST).hour * 60 + dt.datetime.fromtimestamp(ts[i], KST).minute >= 14 * 60 + 55]
        print(f"{t} includePrePost={pp}: 봉 {len(ts)} · {f(ts[0])}~{f(ts[-1])} · 정규장 {f(tp['regular']['start'])}~{f(tp['regular']['end'])} · post {f(tp['post']['start'])}~{f(tp['post']['end'])} · 마지막 체결 {f(m['regularMarketTime'])} 가격 {m['regularMarketPrice']}")
        print(f"   14:55 이후 봉: {late}")
