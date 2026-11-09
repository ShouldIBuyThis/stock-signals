"""국장 시세 제공처 지연·형식 실측 (조사 전용 · CI에서만 — 이 환경은 외부가 막혀 있다). 사이트 코드·Worker와 무관.

2026-11-09 사용자 요청: 증권사 API 없이 국장 지연 10분 이내 가능한 제공처 조사.
각 제공처에서 (a) 응답이 주는 '마지막 체결/봉 시각' (b) 받은 시각(이 러너의 시계) (c) 5분봉·거래량 형태 (d) 인증·헤더 필요 여부 (e) CORS 헤더를 찍는다.
⚠ 공식 API가 아닌 내부 엔드포인트가 많다 — 측정용으로 몇 번만 부른다(반복 수집 아님).
"""
import json, time, datetime as dt, urllib.request, urllib.error

KST = dt.timezone(dt.timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0"}
def get(url, headers=None, data=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})}, data=data)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = r.read(); h = dict(r.headers); code = r.status
    except urllib.error.HTTPError as e:
        return e.code, {}, e.read()[:300], time.time()
    except Exception as e:
        return None, {}, str(e).encode()[:300], time.time()
    return code, h, body, time.time()
def now_kst(ts): return dt.datetime.fromtimestamp(ts, KST).strftime("%H:%M:%S")
def lag(trade_dt, got):
    if trade_dt is None: return "—"
    return f"{(got - trade_dt.timestamp())/60:.1f}분"
def cors(h): return h.get("Access-Control-Allow-Origin") or h.get("access-control-allow-origin") or "없음"
def show(name, code, h, got, trade, extra=""):
    print(f"  {name:<34} HTTP {code} · 받은 {now_kst(got)} · 마지막 체결/봉 {trade.strftime('%m-%d %H:%M:%S') if trade else '—'} · 차이 {lag(trade, got)} · CORS {cors(h)} {extra}")

print(f"=== 실행 시각 {dt.datetime.now(KST):%Y-%m-%d %H:%M:%S} KST ===")
for code6, label in [("005930", "삼성전자"), ("069500", "KODEX 200"), ("229200", "KODEX 코스닥150")]:
    print(f"\n■ {code6} {label}")
    # 1) 야후(현재 사용) — 기준선
    c, h, b, got = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{code6}.KS?interval=5m&range=1d")
    try:
        m = json.loads(b)["chart"]["result"][0]; ts = m["timestamp"]
        show("야후 v8 5분봉(현재 사용)", c, h, got, dt.datetime.fromtimestamp(m["meta"]["regularMarketTime"], KST), f"· 5분봉 {len(ts)}개 · 마지막 봉 시작 {now_kst(ts[-1])} · 거래량 {'있음' if m['indicators']['quote'][0].get('volume') else '없음'}")
    except Exception as e: show("야후 v8", c, h, got, None, f"· 해석 실패 {str(e)[:60]}")
    # 2) 네이버 실시간 폴링(내부)
    c, h, b, got = get(f"https://polling.finance.naver.com/api/realtime/domestic/stock/{code6}")
    try:
        d0 = json.loads(b)["datas"][0]; tt = dt.datetime.fromisoformat(d0.get("localTradedAt"))
        over = d0.get("overMarketPriceInfo") or {}
        show("네이버 polling realtime(내부)", c, h, got, tt, f"· 현재가 {d0.get('closePrice')} · 상태 {d0.get('marketStatus')} · 시간외/NXT {over.get('tradingSessionType','')} {over.get('overPrice','')} {over.get('localTradedAt','')}")
    except Exception as e: show("네이버 polling realtime(내부)", c, h, got, None, f"· 해석 실패 {str(e)[:80]} {b[:120]!r}")
    # 3) 네이버 분봉(내부) — 오늘 1분봉
    day = dt.datetime.now(KST).strftime("%Y%m%d")
    c, h, b, got = get(f"https://api.stock.naver.com/chart/domestic/item/{code6}/minute?startDateTime={day}0900&endDateTime={day}2000")
    try:
        arr = json.loads(b); last = arr[-1]
        tt = dt.datetime.strptime(last["localDateTime"], "%Y%m%d%H%M%S").replace(tzinfo=KST)
        show("네이버 api.stock 분봉(내부)", c, h, got, tt, f"· 봉 {len(arr)}개 · 키 {sorted(last.keys())[:8]}")
    except Exception as e: show("네이버 api.stock 분봉(내부)", c, h, got, None, f"· 해석 실패 {str(e)[:60]} {b[:120]!r}")
    c, h, b, got = get(f"https://fchart.stock.naver.com/siseJson.nhn?symbol={code6}&requestType=1&startTime={day}&endTime={day}&timeframe=minute")
    try:
        rows = [r for r in json.loads(b.decode("utf-8", "ignore").replace("'", '"').strip()) if r and str(r[0]).isdigit()]
        tt = dt.datetime.strptime(str(rows[-1][0]), "%Y%m%d%H%M").replace(tzinfo=KST)
        show("네이버 fchart siseJson 분(내부)", c, h, got, tt, f"· 행 {len(rows)} · 예 {rows[-1]}")
    except Exception as e: show("네이버 fchart siseJson 분(내부)", c, h, got, None, f"· 해석 실패 {str(e)[:60]} {b[:120]!r}")
    # 4) 다음 금융(내부) — Referer 필요
    ref = {"Referer": f"https://finance.daum.net/quotes/A{code6}"}
    c, h, b, got = get(f"https://finance.daum.net/api/quotes/A{code6}?summary=false", ref)
    try:
        q = json.loads(b); tt = dt.datetime.strptime(f"{q.get('tradeDate','')}{q.get('tradeTime','')}", "%Y%m%d%H%M%S").replace(tzinfo=KST)
        show("다음 quotes(내부, Referer)", c, h, got, tt, f"· 현재가 {q.get('tradePrice')} · 상태 {q.get('marketStatus','')}")
    except Exception as e: show("다음 quotes(내부, Referer)", c, h, got, None, f"· 해석 실패 {str(e)[:60]} {b[:120]!r}")
    c, h, b, got = get(f"https://finance.daum.net/api/quotes/A{code6}?summary=false")
    print(f"  {'다음 quotes — Referer 없이':<34} HTTP {c}")
    c, h, b, got = get(f"https://finance.daum.net/api/charts/A{code6}/minutes?limit=10&adjusted=true", ref)
    try:
        dd = json.loads(b).get("data") or []; last = dd[-1]
        show("다음 분봉 charts(내부, Referer)", c, h, got, None, f"· 봉 {len(dd)} · 마지막 {last.get('date') or last.get('candleTime')} · 키 {sorted(last.keys())[:8]}")
    except Exception as e: show("다음 분봉 charts(내부, Referer)", c, h, got, None, f"· 해석 실패 {str(e)[:60]} {b[:120]!r}")
    # 5) TradingView 스캐너(내부) — update_mode가 지연 등급을 알려 준다
    body = json.dumps({"symbols": {"tickers": [f"KRX:{code6}"]}, "columns": ["close", "volume", "update_mode", "update_time"]}).encode()
    c, h, b, got = get("https://scanner.tradingview.com/korea/scan", {"Content-Type": "application/json"}, body)
    try:
        r0 = json.loads(b)["data"][0]["d"]
        show("TradingView scanner(내부)", c, h, got, None, f"· close {r0[0]} · volume {r0[1]} · update_mode {r0[2]} · update_time {r0[3]}")
    except Exception as e: show("TradingView scanner(내부)", c, h, got, None, f"· 해석 실패 {str(e)[:60]} {b[:120]!r}")
print("\n■ 지수 (보조 지표 후보)")
for idx in ["KOSPI", "KOSDAQ", "KPI200"]:
    c, h, b, got = get(f"https://polling.finance.naver.com/api/realtime/domestic/index/{idx}")
    try:
        d0 = json.loads(b)["datas"][0]; tt = dt.datetime.fromisoformat(d0.get("localTradedAt"))
        show(f"네이버 지수 {idx}(내부)", c, h, got, tt, f"· {d0.get('closePrice')} · 상태 {d0.get('marketStatus')}")
    except Exception as e: show(f"네이버 지수 {idx}(내부)", c, h, got, None, f"· 해석 실패 {str(e)[:60]} {b[:120]!r}")
for sym in ["^KS11", "^KQ11"]:
    c, h, b, got = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=5m&range=1d")
    try:
        m = json.loads(b)["chart"]["result"][0]
        show(f"야후 지수 {sym}", c, h, got, dt.datetime.fromtimestamp(m["meta"]["regularMarketTime"], KST))
    except Exception as e: show(f"야후 지수 {sym}", c, h, got, None, f"· 해석 실패 {str(e)[:60]}")
