#!/usr/bin/env python3
"""화면용 주봉·월봉 플래그 — 관심종목마다 '마지막 완성 주봉·월봉'의 매도 쪽 조건(docs/2026-11-13-mtf-cross.md §3 B).
연구(tools/mtf-cross-lab.py)와 같은 함수(tools/mtf_feats.py)로 계산한다. 진행 중인 주·달의 봉은 쓰지 않는다(미래 자료·미완성 봉 금지).
완성 판정: 주봉 = 마지막 거래일이 금요일이거나, 그 주 금요일이 시장 시각 오늘보다 과거.
           월봉 = 그 달이 시장 시각 오늘보다 과거이거나, 마지막 거래일이 그 달 마지막 영업일(BMonthEnd)이고 시장 시각으로 장 마감(16:00) 뒤.
출력: backtest/mtf-flags.json {generated, tickers:{T:{w_last, m_last, W_*, M_*}}} — 화면은 신호일과 완성 봉 날짜가 맞을 때만 쓴다.
사용: python tools/mtf-flags.py [signals.json] [out.json]
"""
import json, sys, datetime as dt
import pandas as pd, yfinance as yf
from zoneinfo import ZoneInfo

sys.path.insert(0, "tools")
from mtf_feats import bars, tf_feats, B_KEYS

src = sys.argv[1] if len(sys.argv) > 1 else "signals.json"
out = sys.argv[2] if len(sys.argv) > 2 else "backtest/mtf-flags.json"
S = json.load(open(src))
tickers = sorted({s["ticker"] for s in S.get("stocks", []) if s.get("ticker")})
now_utc = dt.datetime.now(dt.timezone.utc)
res, fail = {}, []
for t in tickers:
    kr = t.endswith(".KS") or t.endswith(".KQ")
    now = now_utc.astimezone(ZoneInfo("Asia/Seoul" if kr else "America/New_York"))
    today, after_close = now.date(), now.hour >= (16 if kr else 16)
    try:
        df = yf.Ticker(t).history(period="max", interval="1d", auto_adjust=True)
    except Exception as e:
        fail.append(t); continue
    if df is None or len(df) < 300: fail.append(t); continue
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
    df.index = pd.DatetimeIndex(pd.to_datetime([x.date() for x in df.index])).astype("datetime64[ns]")
    if df.index[-1].date() == today and not after_close: df = df.iloc[:-1]          # 장중 미완성 일봉 제거
    df = df[df.index >= df.index[-1] - pd.Timedelta(days=365 * 12)]
    df["DV"] = df["Close"] * df["Volume"]
    W, M = bars(df, "W-FRI"), bars(df, "ME")
    wl = W["last"].iloc[-1].date(); fri = wl + dt.timedelta(days=(4 - wl.weekday()) % 7)
    if not (wl.weekday() == 4 or fri < today): W = W.iloc[:-1]
    ml = M["last"].iloc[-1].date(); bme = (pd.Timestamp(ml) + pd.offsets.BMonthEnd(0)).date()
    if not ((ml.year, ml.month) < (today.year, today.month) or (ml == bme and (ml < today or after_close))): M = M.iloc[:-1]
    FW, FM = tf_feats(W, "W"), tf_feats(M, "M")
    if not len(FW) or not len(FM): fail.append(t); continue
    a, b = FW.iloc[-1], FM.iloc[-1]
    row = {"w_last": str(a["last"].date()), "m_last": str(b["last"].date())}
    for k in B_KEYS:
        row[f"W_{k}"] = bool(a[f"W_{k}"]); row[f"M_{k}"] = bool(b[f"M_{k}"])
    res[t] = row
json.dump({"generated": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"), "doc": "docs/2026-11-13-mtf-cross.md", "keys": B_KEYS, "tickers": res, "failed": fail},
          open(out, "w"), ensure_ascii=False, separators=(",", ":"))
on = {k: sum(1 for r in res.values() if r.get(k)) for k in ("M_VSPK", "M_RSIBEAR", "M_FLOWWK", "W_RSIBEAR")}
print(f"mtf-flags: {len(res)}종목 · 실패 {len(fail)} {fail[:8]} · 켜진 수 {on} → {out}")
