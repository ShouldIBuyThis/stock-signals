"""국장 야후 '15:00 거래량 0 봉' = 공식 종가인지 교차 검증 (조사 전용 · CI). 사이트·Worker 무관.

비교 대상 (날짜·종목별):
  A = v8 5분봉(range=60d) 중 그날 15:00 KST에 시작하는 봉의 종가 · 그 봉의 시/고/저/거래량 원값도 찍는다
  B = v8 일봉(range=3mo) 그날 종가
  C = 우리 원장 history/kr/날짜.json 의 price (yfinance 일봉 종가, 당시 그대로 고정)
  D = 오늘은 regularMarketPrice
또 배포된 Worker가 그 봉을 넘기는지(현재 사이트가 받는 형태)도 확인한다.
"""
import json, sys, os, glob, urllib.request, datetime as dt
KST = dt.timezone(dt.timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0"}
def get(u):
    return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=20).read())
T = ["069500.KS", "229200.KS", "005930.KS", "453650.KS", "0173Y0.KS", "0123G0.KS", "0183J0.KS"]
ledger = {}
for f in glob.glob("history/kr/*.json"):
    day = os.path.basename(f)[:10]
    try:
        d = json.load(open(f, encoding="utf-8")); rows = d.get("stocks", d) if isinstance(d, dict) else d
        for s in rows:
            if isinstance(s, dict) and "ticker" in s: ledger[(s["ticker"], day)] = s.get("price")
    except Exception: pass
tot = ok = bad = nodaily = 0; vol_nonzero = 0; ohl_present = 0; mism = []
for t in T:
    try:
        r = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?interval=5m&range=60d&includePrePost=false")["chart"]["result"][0]
        dd = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?interval=1d&range=3mo")["chart"]["result"][0]
    except Exception as e:
        print(t, "조회 실패", e); continue
    daily = {dt.datetime.fromtimestamp(ts, KST).strftime("%Y-%m-%d"): c for ts, c in zip(dd["timestamp"], dd["indicators"]["quote"][0]["close"]) if c is not None}
    q = r["indicators"]["quote"][0]; ts = r["timestamp"]
    bydays = {}
    for i, x in enumerate(ts):
        k = dt.datetime.fromtimestamp(x, KST); bydays.setdefault(k.strftime("%Y-%m-%d"), []).append((k, q["open"][i], q["high"][i], q["low"][i], q["close"][i], q["volume"][i]))
    print(f"\n■ {t} · 5분봉 {len(ts)}개 · {len(bydays)}거래일 · 오늘 regularMarketPrice {r['meta'].get('regularMarketPrice')} · 정규장 메타 {dt.datetime.fromtimestamp(r['meta']['currentTradingPeriod']['regular']['end'], KST):%H:%M}")
    shown = 0
    for day, bars in sorted(bydays.items()):
        last = bars[-1]; k = last[0]
        has15 = k.hour == 15 and k.minute == 0
        tot += 1
        if not has15:
            print(f"  {day} 마지막 봉 {k:%H:%M} — 15:00 봉 없음 (봉 {len(bars)}개)"); continue
        o, h, l, c, v = last[1:]
        if v: vol_nonzero += 1
        if o is not None or h is not None or l is not None: ohl_present += 1
        B = daily.get(day); C = ledger.get((t, day))
        if B is None: nodaily += 1
        same = (B is not None and c is not None and abs(c - B) < 1e-6)
        ok += same; bad += (B is not None and not same)
        if not same and B is not None: mism.append((t, day, c, B, C))
        if shown < 4 or not same:
            print(f"  {day} 15:00봉 o/h/l/c/v = {o}/{h}/{l}/{c}/{v} · 일봉 종가 {B} · 원장 {C} · {'일치' if same else '불일치'} · 14:55봉 종가 {bars[-2][4] if len(bars) > 1 else '—'}")
            shown += 1
print(f"\n=== 요약: 거래일 {tot} · 15:00봉 종가 = 일봉 종가 일치 {ok} · 불일치 {bad} · 일봉 없음 {nodaily} · 15:00봉 거래량≠0 {vol_nonzero} · 시/고/저 있음 {ohl_present}")
for m in mism[:20]: print("  불일치:", m)
# 배포 Worker가 넘기는 형태
try:
    w = get("https://stock-intraday.zzz797911.workers.dev/?t=069500.KS")
    days = {}
    for b in w["bars"]:
        k = dt.datetime.fromtimestamp(b[0], KST); days.setdefault(k.strftime("%m-%d"), []).append((k.strftime("%H:%M"), b))
    print("\n■ 배포 Worker 069500.KS · 날짜별 마지막 봉:", {d: (v[-1][0], v[-1][1][5], len(v)) for d, v in days.items()}, "· fetchedAt", dt.datetime.fromtimestamp(w["fetchedAt"], KST).strftime("%H:%M:%S"), "· lastTrade", dt.datetime.fromtimestamp(w["lastTrade"], KST).strftime("%H:%M"), "· reg", {k: dt.datetime.fromtimestamp(v, KST).strftime("%H:%M") for k, v in w["reg"].items()})
except Exception as e: print("Worker 확인 실패", e)
