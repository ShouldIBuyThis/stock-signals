#!/usr/bin/env python3
"""정치인(의회) 거래 ETF로 시장·섹터를 예측할 수 있나 — 측정 전용 (2026-09-03 사용자 지시).

NANC(민주당 의원 거래)·GOP(공화당 의원 거래)는 의원들의 STOCK Act 공시(거래 뒤 최대 45일)를
따라 담는 ETF다. 그러니 이 ETF 가격에는 '의원들이 지금 사는 것'이 아니라 '한두 달 전에 산
바구니가 지금 잘 가는가'가 들어 있다. 여기서는 그 바구니의 상대 강도(지수 대비 초과수익)가
QQQ와 섹터의 앞날을 맞히는지를 3년 넘게(상장 2023-02) 잰다.

 - 산식·등급에는 아무것도 넣지 않는다. 결과가 좋아도 사용자 승인 후 별도 표시로만.
 - 판정: 기준선 대비 %p · §2 전반/후반 · 표본 등급(§5-1) · 이웃값(고원).
CI 전용(야후). 사용: python tools/politics-lab.py [--years 4]
"""
import sys, argparse
import numpy as np, pandas as pd
import yfinance as yf

ap = argparse.ArgumentParser()
ap.add_argument("--years", type=int, default=4)
args = ap.parse_args()

POL  = ["NANC", "GOP"]
IDX  = ["QQQ", "SPY"]
SECT = {"XLK": "기술", "XLE": "에너지", "XLF": "금융", "XLV": "헬스케어", "ITA": "방산", "XLI": "산업재", "XLU": "유틸리티"}
tks = POL + IDX + list(SECT)
px = yf.download(tks, period=f"{args.years}y", auto_adjust=True, progress=False, threads=True)
close = px["Close"] if isinstance(px.columns, pd.MultiIndex) else px[["Close"]]
close = close.dropna(subset=POL + IDX, how="any")
n_days = len(close)
print(f"■ 정치 ETF 예측력 측정 · {close.index[0].date()} ~ {close.index[-1].date()} · {n_days}거래일")
print("  주의: NANC·GOP는 공시(최대 45일 지연)를 따라 담는다 — '지금 사는 것'이 아니라 '한두 달 전 산 바구니'의 성적이다.\n")

def ret(tk, k): return close[tk] / close[tk].shift(k) - 1
def fwd(tk, h): return close[tk].shift(-h) / close[tk] - 1

HZ = [1, 3, 5, 10, 20]
rel = {tk: {k: ret(tk, k) - ret("QQQ", k) for k in (5, 20)} for tk in POL}
ng20 = ret("NANC", 20) - ret("GOP", 20)
ma20 = {tk: close[tk].rolling(20).mean() for tk in POL + ["QQQ"]}
above = {tk: close[tk] > ma20[tk] for tk in POL + ["QQQ"]}

SIG = [
    ("S1 NANC가 QQQ보다 20일 앞섬",            rel["NANC"][20] > 0),
    ("S2 GOP가 QQQ보다 20일 앞섬",             rel["GOP"][20] > 0),
    ("S3 둘 다 QQQ보다 앞섬",                  (rel["NANC"][20] > 0) & (rel["GOP"][20] > 0)),
    ("S4 둘 다 QQQ보다 뒤짐",                  (rel["NANC"][20] < 0) & (rel["GOP"][20] < 0)),
    ("S5 NANC가 GOP보다 20일 앞섬",            ng20 > 0),
    ("S6 GOP가 NANC보다 20일 앞섬",            ng20 < 0),
    ("S7 NANC 상대강도 반전(5일 전 ≤0 → >0)",   (rel["NANC"][20] > 0) & (rel["NANC"][20].shift(5) <= 0)),
    ("S8 GOP 상대강도 반전",                   (rel["GOP"][20] > 0) & (rel["GOP"][20].shift(5) <= 0)),
    ("S9 QQQ는 20일선 아래·NANC·GOP는 위",      (~above["QQQ"]) & above["NANC"] & above["GOP"]),
    ("S10 NANC 5일·20일 모두 앞섬",            (rel["NANC"][5] > 0) & (rel["NANC"][20] > 0)),
    ("S11 NANC 20일 +2%p 이상 앞섬",           rel["NANC"][20] > 0.02),
    ("S12 GOP 20일 +2%p 이상 앞섬",            rel["GOP"][20] > 0.02),
    ("S13 NANC 20일 −2%p 이상 뒤짐",           rel["NANC"][20] < -0.02),
    ("S14 GOP 20일 −2%p 이상 뒤짐",            rel["GOP"][20] < -0.02),
    ("S15 NANC 20일 +1%p 앞섬 (이웃값)",        rel["NANC"][20] > 0.01),
    ("S16 NANC 20일 +3%p 앞섬 (이웃값)",        rel["NANC"][20] > 0.03),
]

F = {h: fwd("QQQ", h) for h in HZ}
valid = pd.Series(True, index=close.index)
for h in HZ: valid &= F[h].notna()
valid &= rel["NANC"][20].notna() & rel["GOP"][20].notna()
mid = close.index[n_days // 2]
base = {h: (F[h][valid] > 0).mean() * 100 for h in HZ}
print("  QQQ가 h일 뒤 올라 있을 확률 (%, 기준선 = 아무 날이나) · 전반/후반은 +5일")
print(f"  {'신호':34} {'n':>5} " + " ".join(f"{'+%d' % h:>9}" for h in HZ) + "   전반/후반(+5)   평균 +5/+20")
print(f"  {'기준선(아무 날이나)':34} {int(valid.sum()):5d} " + " ".join(f"{base[h]:5.0f}%    " for h in HZ))
for name, cond in SIG:
    m = cond.fillna(False) & valid
    n = int(m.sum())
    if n == 0:
        print(f"  {name:34} {0:5d}  —"); continue
    cells = []
    for h in HZ:
        r = (F[h][m] > 0).mean() * 100
        cells.append(f"{r:3.0f}%{r - base[h]:+4.0f}p")
    a = m & (close.index < mid); b = m & (close.index >= mid)
    ha = (F[5][a] > 0).mean() * 100 if a.sum() else float("nan")
    hb = (F[5][b] > 0).mean() * 100 if b.sum() else float("nan")
    grade = "" if n >= 50 else " ⚠방향만" if n >= 30 else " ⚠참고" if n >= 15 else " ✗신뢰불가"
    print(f"  {name:34} {n:5d} " + " ".join(cells) +
          f"   {ha:3.0f}%({int(a.sum())})/{hb:3.0f}%({int(b.sum())})   {F[5][m].mean()*100:+.2f}/{F[20][m].mean()*100:+.2f}%{grade}")

# ── 어느 당 바구니가 앞서면 어느 섹터가 오르나 (+20일 SPY 대비 초과수익) ──
print("\n■ 섹터 회전 — 신호일로부터 +20일 섹터 ETF의 SPY 대비 초과수익 (평균 %p · 초과>0 비율)")
spy20 = fwd("SPY", 20)
cols = list(SECT)
print(f"  {'신호':34} {'n':>5} " + " ".join(f"{SECT[c]:>9}" for c in cols))
for name, cond in [("아무 날이나", valid), ("S5 NANC가 GOP보다 앞섬", ng20 > 0), ("S6 GOP가 NANC보다 앞섬", ng20 < 0),
                   ("S11 NANC +2%p 앞섬", rel["NANC"][20] > 0.02), ("S12 GOP +2%p 앞섬", rel["GOP"][20] > 0.02),
                   ("S3 둘 다 QQQ보다 앞섬", (rel["NANC"][20] > 0) & (rel["GOP"][20] > 0)),
                   ("S4 둘 다 QQQ보다 뒤짐", (rel["NANC"][20] < 0) & (rel["GOP"][20] < 0))]:
    m = cond.fillna(False) & valid & spy20.notna()
    n = int(m.sum())
    cells = []
    for c in cols:
        ex = (fwd(c, 20) - spy20)[m].dropna()
        cells.append(f"{ex.mean()*100:+5.1f}/{(ex > 0).mean()*100:3.0f}%" if len(ex) else "    —    ")
    print(f"  {name:34} {n:5d} " + " ".join(cells))

print("\n※ 후보 16종 + 섹터표 — 다중비교. 기준선 대비 +5%p 이상이고 전·후반 둘 다 기준선 위이며 n≥50인 것만 '있다'로 본다.")
print("   그것도 산식에는 넣지 않는다. 사용자 승인 후 QQQ 카드 참고 표시로만 쓴다.")
