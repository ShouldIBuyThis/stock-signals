#!/usr/bin/env python3
"""
PRIVATE 현행산식 최근검증 준비기 (+1/+3/+5, rolling 100)
- 읽기 전용: main.py / index.html / signals.json / history/를 수정하지 않음
- yfinance에서 수동 실행 시에만 약 2년 일봉을 1회 수집
- 현재 main.py의 analyze() / market_state()를 직접 재사용해 과거 날짜별 원시 신호 입력을 재현
- 실제 점수/등급 계산은 다음 단계(Node)가 현재 index.html evaluate()를 직접 재사용
"""
import json, os, sys, time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf

ROOT = Path.cwd()
if not (ROOT/"main.py").exists():
    raise SystemExit("main.py가 없습니다. 저장소 루트에서 실행하세요.")

import main as app

LOOKBACK_PERIOD = "2y"
BACKTEST_DAYS = 60
MAX_WORKERS = 8

watch = [(cat, tk, nm) for cat, items in app.WATCHLIST.items() for tk, nm in items.items()]
tickers = [tk for _, tk, _ in watch]
fetch_tickers = sorted(set(tickers + [app.MARKET_TICKER]))

print(f"[1/4] 과거 일봉 수집 시작: {len(fetch_tickers)}티커 · {LOOKBACK_PERIOD} · 수동 백테스트 전용")

def fetch_one(tk):
    last_err = None
    for attempt in range(2):
        try:
            df = yf.Ticker(tk).history(period=LOOKBACK_PERIOD, interval="1d", auto_adjust=False)
            if df is not None and len(df) >= 80:
                df = df.copy()
                # timezone은 날짜 비교를 단순화하기 위해 제거
                try:
                    if df.index.tz is not None:
                        df.index = df.index.tz_localize(None)
                except Exception:
                    pass
                return tk, df, None
            last_err = f"데이터 부족({0 if df is None else len(df)})"
        except Exception as e:
            last_err = str(e)
        time.sleep(2)
    return tk, None, last_err

cache = {}
failed_fetch = {}
with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
    futs = {ex.submit(fetch_one, tk): tk for tk in fetch_tickers}
    done = 0
    for fut in as_completed(futs):
        tk, df, err = fut.result()
        done += 1
        if df is not None:
            cache[tk] = df
        else:
            failed_fetch[tk] = err
        if done % 10 == 0 or done == len(futs):
            print(f"  수집 {done}/{len(futs)} · 성공 {len(cache)} · 실패 {len(failed_fetch)}")

if app.MARKET_TICKER not in cache:
    raise SystemExit(f"QQQ 데이터 수집 실패: {failed_fetch.get(app.MARKET_TICKER)}")

# 과거 실적일 best-effort 수집. 검증 오염 방지용이며 실패해도 백테스트는 계속한다.
print("[2/4] 고정 실적 CSV 읽기 — 외부 earnings API 호출 없음")
earnings_csv = ROOT / "private_earnings_history.csv"
coverage_csv = ROOT / "private_earnings_coverage.csv"
if not earnings_csv.exists() or not coverage_csv.exists():
    raise SystemExit("private_earnings_history.csv / private_earnings_coverage.csv가 저장소 루트에 없습니다.")

import csv
earnings_dates = {}
earnings_timing = {}
with earnings_csv.open(encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f):
        tk=(r.get("ticker") or "").strip().upper()
        d=(r.get("earnings_date") or "").strip()
        timing=(r.get("timing") or "UNKNOWN").strip().upper()
        if not tk or not d:
            continue
        earnings_dates.setdefault(tk, []).append(d)
        earnings_timing[f"{tk}|{d}"] = timing
for tk in earnings_dates:
    earnings_dates[tk] = sorted(set(earnings_dates[tk]))

earnings_coverage = {}
with coverage_csv.open(encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f):
        tk=(r.get("ticker") or "").strip().upper()
        if tk:
            earnings_coverage[tk] = {
                "coverage": (r.get("coverage") or "unverified").strip(),
                "verified_from": (r.get("verified_from") or "").strip(),
                "verified_to": (r.get("verified_to") or "").strip(),
                "note": (r.get("note") or "").strip(),
            }

verified_count=sum(1 for x in earnings_coverage.values() if x.get("coverage")=="verified")
unverified_count=sum(1 for x in earnings_coverage.values() if x.get("coverage")=="unverified")
etf_count=sum(1 for x in earnings_coverage.values() if x.get("coverage")=="not_applicable_etf")
print(f"  CSV 실적 이벤트 {sum(len(v) for v in earnings_dates.values())}건 · verified {verified_count} · unverified {unverified_count} · ETF {etf_count}")

# main.py가 네트워크를 다시 부르지 않도록 Ticker.history만 캐시 데이터로 교체
CURRENT_CUTOFF = None
class FakeTicker:
    def __init__(self, ticker):
        self.ticker = ticker
    def history(self, *args, **kwargs):
        df = cache.get(self.ticker)
        if df is None or CURRENT_CUTOFF is None:
            return pd.DataFrame()
        cut = pd.Timestamp(CURRENT_CUTOFF)
        return df.loc[df.index.normalize() <= cut.normalize()].copy()

orig_ticker = app.yf.Ticker
app.yf.Ticker = FakeTicker

qqq_dates = [pd.Timestamp(x).strftime("%Y-%m-%d") for x in cache[app.MARKET_TICKER].index]
if len(qqq_dates) < 100:
    raise SystemExit("QQQ 거래일이 부족합니다.")

# 초기 seed는 최근 60개 완료 신호일만 만든다. +1/+3/+5 중 가장 긴 +5 결과가 존재하는 날짜까지만.
eligible_qqq = qqq_dates[:-5]
signal_dates = eligible_qqq[-BACKTEST_DAYS:]
if not signal_dates:
    raise SystemExit("백테스트 가능한 날짜가 없습니다.")

print(f"[3/4] 현재 main.py 원시지표 로직 재현: {signal_dates[0]} ~ {signal_dates[-1]}")

# 각 티커 거래일 set
date_sets = {
    tk: {pd.Timestamp(x).strftime("%Y-%m-%d") for x in df.index}
    for tk, df in cache.items()
}

rows = []
market_by_date = {}
errors = []
for di, day in enumerate(signal_dates, 1):
    CURRENT_CUTOFF = day
    try:
        mkt = app.market_state(app.MARKET_TICKER)
    except Exception as e:
        errors.append(f"QQQ {day}: {e}")
        continue
    market_by_date[day] = {
        "level": mkt.get("level","neutral"),
        "ret20": mkt.get("ret20"),
        "below_ma20": mkt.get("below_ma20",False),
    }
    for cat, tk, nm in watch:
        if tk not in cache or day not in date_sets.get(tk,set()):
            continue
        try:
            row = app.analyze(tk, nm, cat)
            is_kr = app.is_kr_ticker(tk)
            row["market_level"] = "neutral" if is_kr else mkt.get("level","neutral")
            row["market_weak"] = bool((not is_kr) and mkt.get("level") in ("weak","caution"))
            row["market_ret20"] = None if is_kr else mkt.get("ret20")
            if (not is_kr) and row.get("ret20") is not None and mkt.get("ret20") is not None:
                row["rs20"] = round(float(row["ret20"]) - float(mkt["ret20"]), 2)
            else:
                row["rs20"] = None
            # hist는 백테스트 행마다 필요 없고 파일만 커지므로 제거
            row.pop("hist", None)
            rows.append(row)
        except Exception as e:
            errors.append(f"{tk} {day}: {e}")
    if di % 25 == 0 or di == len(signal_dates):
        print(f"  재현 {di}/{len(signal_dates)}일 · 행 {len(rows)}")

# +1/+3/+5 평가 종가 조회용 가격 캘린더를 함께 저장
prices = {}
for tk, df in cache.items():
    if tk == app.MARKET_TICKER:
        continue
    prices[tk] = [
        [pd.Timestamp(idx).strftime("%Y-%m-%d"), float(val)]
        for idx, val in zip(df.index, df["Close"])
        if pd.notna(val)
    ]

payload = {
    "generated_at": datetime.utcnow().isoformat()+"Z",
    "backtest_days": BACKTEST_DAYS,
    "horizons": [1,3,5],
    "signal_date_from": signal_dates[0],
    "signal_date_to": signal_dates[-1],
    "rows": rows,
    "prices": prices,
    "earnings_dates": earnings_dates,
    "earnings_timing": earnings_timing,
    "earnings_coverage": earnings_coverage,
    "failed_fetch": failed_fetch,
    "errors_sample": errors[:100],
}
with open("validation100_input.json","w",encoding="utf-8") as f:
    json.dump(payload,f,ensure_ascii=False)

app.yf.Ticker = orig_ticker
print(f"[4/4] 준비 완료 · 신호 입력행 {len(rows)} · 고정 실적 CSV {sum(len(v) for v in earnings_dates.values())}건 · verified {verified_count} · unverified {unverified_count} · ETF {etf_count} · 가격수집실패 {len(failed_fetch)}종목")
