"""전체종목 모니터링 설계용 실측 (조사 전용 · CI에서만). 배포된 장중 Worker에 관심종목 전체를 한 바퀴 조회해
호출 수 · 소요 시간 · 응답 크기 · 캐시 적중 · 실패를 잰다. 사이트 코드·원장과 무관, 아무것도 저장하지 않는다.
사용: python tools/intraday-scan-probe.py [동시요청수 ...]   (기본 6 6 3)
"""
import json, sys, time, gzip, urllib.request, urllib.error, statistics as st
from concurrent.futures import ThreadPoolExecutor
API = "https://stock-intraday.zzz797911.workers.dev/"
tickers = [s["ticker"] for s in json.load(open("signals.json", encoding="utf-8"))["stocks"]]
def one(t):
    t0 = time.time()
    req = urllib.request.Request(API + "?t=" + urllib.parse.quote(t), headers={"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip", "Origin": "https://shouldibuythis.github.io"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read(); enc = r.headers.get("Content-Encoding", ""); body = gzip.decompress(raw) if enc == "gzip" else raw
            d = json.loads(body); now = time.time()
            return dict(t=t, ok=True, code=r.status, ms=(now - t0)*1000, wire=len(raw), size=len(body), cache=r.headers.get("X-Cache", r.headers.get("cf-cache-status", "?")),
                        bars=len(d.get("bars") or []), lag=(now - d["lastTrade"])/60 if d.get("lastTrade") else None, err=d.get("error"))
    except urllib.error.HTTPError as e:
        return dict(t=t, ok=False, code=e.code, ms=(time.time() - t0)*1000, wire=0, size=0, cache="-", bars=0, lag=None, err=e.read()[:80].decode("utf-8", "replace"))
    except Exception as e:
        return dict(t=t, ok=False, code=None, ms=(time.time() - t0)*1000, wire=0, size=0, cache="-", bars=0, lag=None, err=str(e)[:80])
import urllib.parse
print(f"관심종목 {len(tickers)}개 · Worker {API}")
for i, conc in enumerate([int(x) for x in sys.argv[1:]] or [6, 6, 3]):
    t0 = time.time()
    with ThreadPoolExecutor(conc) as ex: rs = list(ex.map(one, tickers))
    wall = time.time() - t0; ok = [r for r in rs if r["ok"] and r["bars"]]; bad = [r for r in rs if not (r["ok"] and r["bars"])]
    ms = sorted(r["ms"] for r in rs); caches = {}
    for r in rs: caches[r["cache"]] = caches.get(r["cache"], 0) + 1
    kr = [r["lag"] for r in ok if r["t"].endswith((".KS", ".KQ")) and r["lag"] is not None]; us = [r["lag"] for r in ok if not r["t"].endswith((".KS", ".KQ")) and r["lag"] is not None]
    print(f"\n[{i+1}바퀴 · 동시 {conc}] 전체 {wall:.1f}초 · 성공 {len(ok)}/{len(rs)} · 요청당 중앙값 {st.median(ms):.0f}ms · 90% {ms[int(len(ms)*0.9)]:.0f}ms · 최대 {ms[-1]:.0f}ms")
    print(f"  캐시 {caches} · 전송량 합 {sum(r['wire'] for r in rs)/1024:.0f}KB(압축) / {sum(r['size'] for r in rs)/1024:.0f}KB(원본) · 종목당 원본 중앙값 {st.median([r['size'] for r in ok])/1024 if ok else 0:.1f}KB · 봉 수 중앙값 {st.median([r['bars'] for r in ok]) if ok else 0:.0f}")
    print(f"  마지막 체결 지연(분) 국장 n{len(kr)} 중앙값 {st.median(kr) if kr else float('nan'):.1f} · 미장 n{len(us)} 중앙값 {st.median(us) if us else float('nan'):.1f} (미장은 지금 장 밖이면 큰 값)")
    for r in bad[:8]: print(f"  실패 {r['t']} HTTP {r['code']} {r['ms']:.0f}ms {r['err']}")
    if len(bad) > 8: print(f"  … 실패 {len(bad)}건")
