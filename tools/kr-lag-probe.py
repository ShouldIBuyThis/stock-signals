"""국장 시세 지연 분해 실측 (CI 전용 · 아무것도 저장 안 함). 배포된 Worker와 야후 원본을 같은 순간에 비교한다.
각 종목: 지금(KST) · 야후 regularMarketTime(마지막 체결) · 야후 마지막 5분봉 시작/종료 · Worker lastTrade · Worker fetchedAt(=Worker가 야후에서 받은 시각)
· Worker 응답 헤더(Cache-Control max-age, Age, X-Cache) → 지연을 '야후 자체' / 'Worker 캐시' / '봉 확정 대기'로 나눈다.
사용: python tools/kr-lag-probe.py [반복횟수=3] [간격초=40]"""
import json, sys, time, datetime as dt, urllib.request
KST = dt.timezone(dt.timedelta(hours=9))
W = "https://stock-intraday.zzz797911.workers.dev/"
TK = ["069500.KS", "229200.KS", "005930.KS", "000660.KS", "035420.KS"]
def get(url, hdr=None):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", **(hdr or {})}); t0 = time.time()
    with urllib.request.urlopen(req, timeout=20) as r: body = r.read(); h = {k.lower(): v for k, v in r.headers.items()}
    return json.loads(body), h, t0, time.time()
f = lambda x: dt.datetime.fromtimestamp(x, KST).strftime("%H:%M:%S") if x else "—"
m = lambda a, b: f"{(a - b)/60:5.1f}분" if a and b else "  —  "
N = int(sys.argv[1]) if len(sys.argv) > 1 else 3; GAP = int(sys.argv[2]) if len(sys.argv) > 2 else 40
for rnd in range(N):
    print(f"\n=== {rnd+1}회차 · 지금 {f(time.time())} KST ===")
    print("  종목       | 야후 원본: 마지막 체결 · 지연 · 마지막 봉(시작~끝) · 마지막 확정봉 끝 지연 | Worker: 마지막 체결 · 지연 · 받은 시각(fetchedAt) · 캐시 나이 · max-age · X-Cache · Age")
    for t in TK:
        try:
            y, yh, _, ynow = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?interval=5m&range=5d&includePrePost=false")
            r = y["chart"]["result"][0]; mt = r["meta"].get("regularMarketTime"); ts = r.get("timestamp") or []
            lb = ts[-1] if ts else None; done = [x for x in ts if x + 300 <= ynow]; lde = done[-1] + 300 if done else None
            ys = f"{f(mt)} · {m(ynow, mt)} · {f(lb)}~{f(lb + 300 if lb else None)} · {m(ynow, lde)}"
        except Exception as e:
            ys = f"실패 {e}"
        try:
            w, wh, _, wnow = get(W + "?t=" + t, {"Origin": "https://shouldibuythis.github.io"})
            ws = f"{f(w.get('lastTrade'))} · {m(wnow, w.get('lastTrade'))} · {f(w.get('fetchedAt'))} · {m(wnow, w.get('fetchedAt'))} · {wh.get('cache-control', '—')} · {wh.get('x-cache', '—')} · Age {wh.get('age', '—')}"
        except Exception as e:
            ws = f"실패 {e}"
        print(f"  {t:<10} | {ys} | {ws}")
    if rnd < N - 1: time.sleep(GAP)
