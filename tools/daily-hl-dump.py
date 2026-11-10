"""날짜별 '전일까지 확정된 52주 최고·최저(일봉 고가·저가 252봉)' — 52주 × 장중 연구용(CI 전용 · 아무것도 커밋 안 함).
사용: python tools/daily-hl-dump.py --out /tmp/hl.json [--tickers A,B]"""
import argparse, json, math
import yfinance as yf
ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--tickers", default=""); ap.add_argument("--signals", default="signals.json")
a = ap.parse_args()
tks = a.tickers.split(",") if a.tickers else [s["ticker"] for s in json.load(open(a.signals, encoding="utf-8"))["stocks"]]
out, miss = {}, []
for t in tks:
    try:
        df = yf.Ticker(t).history(period="2y", interval="1d", auto_adjust=False)
    except Exception:
        miss.append(t); continue
    if df is None or len(df) < 260: miss.append(t); continue
    hi = df["High"].rolling(252, min_periods=240).max().shift(1); lo = df["Low"].rolling(252, min_periods=240).min().shift(1)
    out[t] = {ts.strftime("%Y-%m-%d"): [float(h), float(l)] for ts, h, l in zip(df.index, hi, lo) if not (math.isnan(h) or math.isnan(l))}
json.dump(out, open(a.out, "w"))
print(f"52주 최고·최저 {len(out)}종목 · 빠짐 {len(miss)} {miss[:8]}")
