#!/usr/bin/env python3
"""장중 지연 진단(읽기 전용) — 중계 서버(Worker)와 야후 직접 응답을 같은 순간에 비교한다.
지금 − 마지막 체결(lastTrade) · 지금 − 마지막 '확정' 5분봉 끝 · Worker 저장 나이(지금 − fetchedAt) · 캐시 HIT/MISS · 야후 1분봉 마지막 시각.
사용: python tools/intraday-lag-probe.py [티커 ...]   (기본 QQQ NVDA AAPL 005930.KS)"""
import sys, time, json, urllib.request
W = "https://stock-intraday.zzz797911.workers.dev/?t="
T = sys.argv[1:] or ["QQQ", "NVDA", "AAPL", "005930.KS"]
def get(url, origin=False):
    rq = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", **({"Origin": "https://shouldibuythis.github.io"} if origin else {})})
    t0 = time.time()
    with urllib.request.urlopen(rq, timeout=20) as r: return json.loads(r.read()), dict(r.headers), time.time() - t0
mm = lambda s: f"{s / 60:.1f}분"
for rnd in range(3):
    now = time.time(); print(f"\n■ {rnd + 1}회 · UTC {time.strftime('%H:%M:%S', time.gmtime(now))}")
    for t in T:
        try:
            d, h, el = get(W + t, True); b = d.get("bars") or []; n2 = time.time()
            last = b[-1][0] if b else None; done = [x for x in b if x[0] + 300 <= (d.get("lastTrade") or n2)]
            lb = done[-1][0] + 300 if done else None
            print(f"  {t:<10} Worker {h.get('X-Cache', '?')} {el:.1f}초 · 체결 {mm(n2 - d['lastTrade']) if d.get('lastTrade') else '—'} 전 · 확정봉 끝 {mm(n2 - lb) if lb else '—'} 전"
                  f" · 진행 중 봉 시작 {mm(n2 - last) if last else '—'} 전 · Worker 저장 {mm(n2 - d['fetchedAt']) if d.get('fetchedAt') else '—'} 전 · 봉 {len(b)}")
        except Exception as e: print(f"  {t:<10} Worker 실패: {e}")
        for iv in ("5m", "1m"):
            try:
                y, _, el = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?interval={iv}&range=1d&includePrePost=false"); r = y["chart"]["result"][0]; n2 = time.time()
                ts = [x for x, c in zip(r.get("timestamp") or [], r["indicators"]["quote"][0]["close"]) if c is not None]
                print(f"  {'':<10} 야후 {iv} {el:.1f}초 · 체결 {mm(n2 - r['meta']['regularMarketTime'])} 전 · 마지막 봉 시작 {mm(n2 - ts[-1]) if ts else '—'} 전")
            except Exception as e: print(f"  {'':<10} 야후 {iv} 실패: {e}")
    if rnd < 2: time.sleep(45)
