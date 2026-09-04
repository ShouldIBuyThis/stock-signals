#!/usr/bin/env python3
"""반등 주도 순서 힌트 — SPY·QQQ·SOXX 중 누가 먼저·크게 오르나 (사용자 제공 방법 2026-09-04 · 측정 전용).

사용자 관찰: 하락 중 튀어오를 때 상승 폭이 SPY > QQQ > SOXX 순서(방어적 순서)면 하락이 끝난 게
아닐 때가 많고, 반도체(SOXX)가 가장 먼저·크게 오르는 '찐 상승' 순서(SOXX > QQQ > SPY)면 저점일 가능성이 높다.
일봉으로 근사: 20일 고점 대비 −3% 이상 빠진 상태에서 QQQ가 +1% 이상 오른 '반등일'을 모아
그날(또는 직전 2일 누적)의 순서를 판정하고, QQQ의 +3/+5/+10일 상승 확률과 '10일 안에 반등일 저가를 다시 깨는 비율'을 잰다.
산식 반영 없음. CI 전용(야후). 사용: python tools/leader-lab.py [--years 4]
"""
import argparse
import numpy as np, pandas as pd
import yfinance as yf

ap = argparse.ArgumentParser(); ap.add_argument("--years", type=int, default=4); args = ap.parse_args()
TK = ["SPY", "QQQ", "SOXX"]
px = yf.download(TK, period=f"{args.years}y", auto_adjust=True, progress=False)
C = px["Close"].dropna(); L = px["Low"].reindex(C.index)
n = len(C); print(f"■ 반등 주도 순서 — {C.index[0].date()} ~ {C.index[-1].date()} · {n}거래일")
r1 = C.pct_change() * 100
r2 = C.pct_change(2) * 100
hi20 = C["QQQ"].rolling(20).max(); dd = (C["QQQ"] / hi20 - 1) * 100
HZ = [1, 3, 5, 10]
fwd = {h: (C["QQQ"].shift(-h) / C["QQQ"] - 1) * 100 for h in HZ}
lowbreak = pd.Series([(L["QQQ"].iloc[i+1:i+11] < L["QQQ"].iloc[i]).any() if i + 11 <= n else np.nan for i in range(n)], index=C.index)

def order(s):
    """s: Series(SPY,QQQ,SOXX) 수익률 → 'risk_on'(SOXX>QQQ>SPY) / 'defensive'(SPY>QQQ>SOXX) / 'mixed'"""
    a, b, c = s["SPY"], s["QQQ"], s["SOXX"]
    if c > b > a: return "risk_on"
    if a > b > c: return "defensive"
    return "mixed"

def report(label, mask, extra=None):
    idx = C.index[mask & fwd[10].notna()]
    if len(idx) == 0: print(f"  {label:34}    0건"); return
    cells = " ".join(f"{(fwd[h][idx] > 0).mean()*100:3.0f}%" for h in HZ)
    lb = lowbreak[idx].dropna(); lbp = lb.mean() * 100 if len(lb) else float("nan")
    mid = C.index[n // 2]; a = [i for i in idx if i < mid]; b = [i for i in idx if i >= mid]
    ha = (fwd[5][a] > 0).mean() * 100 if a else float("nan"); hb = (fwd[5][b] > 0).mean() * 100 if b else float("nan")
    g = "" if len(idx) >= 50 else " ⚠방향만" if len(idx) >= 30 else " ⚠참고" if len(idx) >= 15 else " ✗신뢰불가"
    print(f"  {label:34} {len(idx):4d}건  QQQ 오를 확률 +1/+3/+5/+10 {cells}   10일 안 저가 재이탈 {lbp:3.0f}%   전반/후반(+5) {ha:3.0f}/{hb:3.0f}{g}")

base = fwd[10].notna()
print("  (기준선 = 아무 날이나)"); report("기준선", base.values)
reb = (dd.shift(1) <= -3) & (r1["QQQ"] >= 1.0) & base
print(f"\n  ① 반등일(20일 고점 −3% 이하에서 QQQ +1% 이상) {int(reb.sum())}건 — 당일 상승 폭 순서")
o1 = r1.apply(order, axis=1)
for k, lab in [("risk_on", "SOXX>QQQ>SPY (반도체 주도)"), ("defensive", "SPY>QQQ>SOXX (방어적 순서)"), ("mixed", "그 외")]:
    report("  " + lab, (reb & (o1 == k)).values)
print(f"\n  ② 같은 반등일 — 직전 2일 누적 상승 폭 순서")
o2 = r2.apply(order, axis=1)
for k, lab in [("risk_on", "SOXX>QQQ>SPY"), ("defensive", "SPY>QQQ>SOXX"), ("mixed", "그 외")]:
    report("  " + lab, (reb & (o2 == k)).values)
print(f"\n  ③ 반등일이 아니어도 — 아무 상승일(QQQ +0.5% 이상)의 당일 순서")
up = (r1["QQQ"] >= 0.5) & base
for k, lab in [("risk_on", "SOXX>QQQ>SPY"), ("defensive", "SPY>QQQ>SOXX"), ("mixed", "그 외")]:
    report("  " + lab, (up & (o1 == k)).values)
print(f"\n  ④ 강도 조건 — 반등일에 SOXX가 QQQ보다 1%p 이상 더 오른 날 vs SPY가 QQQ보다 많이 오른 날")
report("  SOXX − QQQ ≥ +1%p", (reb & ((r1["SOXX"] - r1["QQQ"]) >= 1.0)).values)
report("  SPY − QQQ > 0", (reb & ((r1["SPY"] - r1["QQQ"]) > 0)).values)
print("\n※ 일봉 근사(장중 저점 터치 순서는 못 봄). 두 순서의 +5/+10일 차이가 10%p 이상이고 전·후반 같은 방향이며 n≥30일 때만 '표시 후보'로 본다.")
