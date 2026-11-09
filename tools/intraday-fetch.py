"""장중 5분봉 60일 수집 (과거 시험용 · CI 전용 — 이 환경은 야후가 막혀 있다).

docs/2026-11-09-intraday-mtf.md §5. 대상 = signals.json의 사이트 종목 전부(현재 관심종목 → 생존 편향 있음).
출력: {ticker: {"tz": ..., "bars": [[ts, o, h, l, c, v, gmtoffset], ...]}}  (ts = 봉 시작, 초)
"""
import argparse, json, math
import yfinance as yf

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--signals", default="signals.json")
ap.add_argument("--tickers", default="", help="쉼표 구분 — 주면 signals.json 대신 이 목록")
ap.add_argument("--period", default="60d")
a = ap.parse_args()

tickers = a.tickers.split(",") if a.tickers else [s["ticker"] for s in json.load(open(a.signals, encoding="utf-8"))["stocks"]]
out, miss = {}, []
for t in tickers:
    try:
        df = yf.Ticker(t).history(period=a.period, interval="5m", prepost=False, auto_adjust=False)
    except Exception as e:
        miss.append(t); continue
    if df is None or df.empty:
        miss.append(t); continue
    bars = []
    for ts, r in df.iterrows():
        o, h, l, c, v = (float(r[k]) for k in ("Open", "High", "Low", "Close", "Volume"))
        if any(math.isnan(x) for x in (o, h, l, c)):
            continue
        bars.append([int(ts.timestamp()), o, h, l, c, 0 if math.isnan(v) else v, int(ts.utcoffset().total_seconds())])
    # 정규 5분봉이 아닌 봉 제거: 국장은 15:00 KST 이후(야후는 마감 뒤 '15:00 시작·거래량 0·공식 종가' 봉을 당일에만 붙인다 — 2026-11-09 교차 검증),
    # 미장은 16:00 ET 이후(종가 체결 봉). 15:00~15:30 구간은 채우지 않는다.
    def regular(b):
        m = ((b[0] + b[6]) % 86400) // 60
        return m < 900 if t.endswith((".KS", ".KQ")) else m < 960
    bars = [b for b in bars if regular(b)]
    # 공식 종가(일봉) — '장 마감까지' 평가용. 5분봉에서 만들지 않는다.
    daily = {}
    try:
        dd = yf.Ticker(t).history(period="4mo", interval="1d", auto_adjust=False)
        for ts, r in dd.iterrows():
            if not math.isnan(float(r["Close"])): daily[ts.strftime("%Y-%m-%d")] = float(r["Close"])
    except Exception:
        pass
    if len(bars) > 300:
        out[t] = {"tz": str(df.index.tz), "bars": bars, "daily": daily}
    else:
        miss.append(t)
json.dump(out, open(a.out, "w"))
print(f"수집 {len(out)}종목 · 빠짐 {len(miss)} {miss[:12]}")
