# ============================================================
# main.py — 관심종목 시세·지표 계산 → signals.json 저장
# (GitHub Actions가 정해진 시각에 자동 실행)
# 종목을 바꾸려면 아래 WATCHLIST 딕셔너리만 고치세요.
# ============================================================
import yfinance as yf
import pandas as pd
import numpy as np
import json
from datetime import datetime, timedelta

PERIOD = "4mo"

# ── 관심종목 (카테고리: {티커: 이름}) ──────────────────────
WATCHLIST = {
    "반도체":      {"NVDA":"엔비디아", "SOXL":"반도체 3x", "MU":"마이크론"},
    "데이터센터":  {"APLD":"어플라이드디지털"},
    "전기차·자동차":{"TSLA":"테슬라"},
    "광통신":      {"AAOI":"어플라이드옵토", "GLW":"코닝", "LITE":"루멘텀", "CIEN":"시에나"},
    "양자":        {"IONQ":"아이온큐", "QBTS":"디웨이브", "INFQ":"인플렉션"},
    "우주":        {"RKLB":"로켓랩", "SPCX":"스피어우주"},
    "금광":        {"GDXU":"금광주 3x"},
    "빅테크":      {"MSFT":"마이크로소프트"},
    "헬스케어":    {"LLY":"일라이릴리"},
    "금융":        {"JPM":"JP모건"},
    "산업재":      {"CAT":"캐터필러"},
    "코스닥":      {"233740.KS":"KODEX 코스닥150레버리지"},
}

def safe(x, nd=2):
    try:
        if x is None or (isinstance(x, float) and (np.isnan(x) or np.isinf(x))): return None
        return round(float(x), nd)
    except Exception: return None

def wilder_rsi(close, period=14):
    d = close.diff(); g = d.clip(lower=0); l = -d.clip(upper=0)
    ag = g.ewm(alpha=1/period, min_periods=period).mean()
    al = l.ewm(alpha=1/period, min_periods=period).mean()
    return 100 - 100/(1+ag/al)

def cross_state(fast, slow, lookback=2):
    diff = (fast - slow).dropna()
    if len(diff) < lookback + 1: return "none"
    now = diff.iloc[-1]
    for i in range(2, lookback + 2):
        prev = diff.iloc[-i]
        if now > 0 and prev <= 0: return "golden"
        if now < 0 and prev >= 0: return "dead"
    return "none"

def analyze(ticker, name, category):
    df = yf.Ticker(ticker).history(period=PERIOD, interval="1d", auto_adjust=False)
    if df is None or len(df) < 30: raise ValueError("데이터 부족")
    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]
    ma5, ma20, ma60 = close.rolling(5).mean(), close.rolling(20).mean(), close.rolling(60).mean()
    rsi = wilder_rsi(close)
    ema12, ema26 = close.ewm(span=12, adjust=False).mean(), close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26; sig = macd.ewm(span=9, adjust=False).mean()
    std = close.rolling(20).std(); upper, lower = ma20 + 2*std, ma20 - 2*std
    bw = (upper - lower).iloc[-1]
    bb = ((close.iloc[-1] - lower.iloc[-1]) / bw * 100) if bw and bw > 0 else None
    ll, hh = low.rolling(14).min(), high.rolling(14).max()
    k = ((close - ll) / (hh - ll) * 100).rolling(3).mean(); d = k.rolling(3).mean()
    va = vol.rolling(20).mean().shift(1).iloc[-1]
    vr = (vol.iloc[-1] / va) if va and va > 0 else None
    chg = (close.iloc[-1] / close.iloc[-2] - 1) * 100 if len(close) >= 2 else None
    is_kr = ticker.endswith(".KS") or ticker.endswith(".KQ")
    nd = 0 if is_kr else 2
    return {
        "ticker": ticker, "name": name, "category": category,
        "currency": "KRW" if is_kr else "USD",
        "price": safe(close.iloc[-1], nd), "change_1d": safe(chg),
        "volume": int(vol.iloc[-1]) if not np.isnan(vol.iloc[-1]) else None,
        "vol_ratio": safe(vr),
        "ma5": safe(ma5.iloc[-1], nd), "ma20": safe(ma20.iloc[-1], nd), "ma60": safe(ma60.iloc[-1], nd),
        "rsi": safe(rsi.iloc[-1]),
        "macd": safe(macd.iloc[-1], 4), "macd_signal": safe(sig.iloc[-1], 4),
        "macd_cross": cross_state(macd, sig),
        "bb_pos": safe(bb),
        "stoch_k": safe(k.iloc[-1]), "stoch_d": safe(d.iloc[-1]),
        "stoch_cross": cross_state(k, d),
        "last_date": df.index[-1].strftime("%Y-%m-%d"),
    }

def main():
    results, failed = [], []
    for cat, items in WATCHLIST.items():
        for tk, nm in items.items():
            try:
                results.append(analyze(tk, nm, cat)); print("OK", tk)
            except Exception as e:
                failed.append(f"{tk} ({nm}) — {e}"); print("SKIP", tk, e)
    now_kst = datetime.utcnow() + timedelta(hours=9)
    payload = {
        "generated_at": now_kst.strftime("%Y-%m-%d %H:%M") + " KST",
        "note": "yfinance 무료 데이터 · 15~20분 지연 · 참고용",
        "stocks": results, "failed": failed,
    }
    with open("signals.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"저장 완료: 성공 {len(results)} / 실패 {len(failed)}")

if __name__ == "__main__":
    main()
