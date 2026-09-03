#!/usr/bin/env python3
"""외부 산식 후보 근사 측정 — 페어 리버설 · Root 타격 (docs/외부-산식-후보.md · 측정 전용).

원문은 분봉·추세선·수렴배율까지 쓰지만 우리는 일봉 OHLC뿐이다. 일봉으로 '흉내 낼 수 있는 만큼만'
정직하게 근사하고, 승률과 2R 기대값(원문이 목표 R=2.0 고정)을 같이 잰다. 산식·등급에는 넣지 않는다.

 페어 리버설(롱 근사): 최근 60봉 스윙고점 3개 이상을 지나는 하락 추세선(회귀, 터치 ±1.5%) +
   수평 넥라인(최근 40봉 고점, 2회 이상 반응) 을 같은 봉 또는 1봉 차로 함께 상향 돌파.
   수렴 = 두 선의 간격이 20봉 전 대비 절반 이하. 손절 = 직전 스윙저점, 목표 = 2R.
 Root 타격(롱 근사): 20봉 저점을 저가로 훑고 종가는 위로 복귀(스윕) → 이후 2봉 안에 몸통 ≥ 1×ATR
   양봉(변위) → 이후 5봉 안에 변위 봉 범위로 되돌림 뒤 그 중간값 위 종가(되돌림 확인) = 진입.
   레벨 중첩 = 진입가가 20·50일선 또는 60일 저점 ±1.5% 안 (+10점). 75점 / 85점.
CI 전용(야후). 사용: python tools/external-lab.py [--years 3]
"""
import sys, os, argparse
import numpy as np, pandas as pd
import yfinance as yf
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as M

ap = argparse.ArgumentParser(); ap.add_argument("--years", type=int, default=3); args = ap.parse_args()
UNIV = sorted({tk for d in M.WATCHLIST.values() for tk in d} - set(M.LEVERAGED) - {t for t in M.WATCHLIST.get("정치·의회 거래", {})})
px = yf.download(UNIV, period=f"{args.years}y", auto_adjust=True, progress=False, group_by="ticker", threads=True)
HZ = (1, 3, 5, 10); HORIZON = 40
print(f"■ 외부 산식 후보 근사 — {len(UNIV)}종목 · {args.years}년 · 일봉 근사(원문은 분봉·추세선)")

def swings(H, L, k=3):
    hi, lo = [], []
    for i in range(k, len(H) - k):
        if H[i] == max(H[i-k:i+k+1]): hi.append(i)
        if L[i] == min(L[i-k:i+k+1]): lo.append(i)
    return hi, lo

def rr_outcome(C, H, L, i, entry, stop, target):
    """i 다음 봉부터 HORIZON 안에 목표/손절 선착. 둘 다 없으면 마지막 종가로 R 환산."""
    risk = entry - stop
    if risk <= 0: return None
    for j in range(i + 1, min(i + 1 + HORIZON, len(C))):
        if L[j] <= stop: return -1.0
        if H[j] >= target: return (target - entry) / risk
    j = min(i + HORIZON, len(C) - 1)
    return (C[j] - entry) / risk

rows = {"pair": [], "pair_conv": [], "root75": [], "root85": [], "root_any": []}
base = []
for tk in UNIV:
    try: d = px[tk].dropna()
    except Exception: continue
    if len(d) < 120: continue
    C, H, L, O = d["Close"].values, d["High"].values, d["Low"].values, d["Open"].values
    n = len(C)
    tr = np.maximum(H[1:] - L[1:], np.maximum(abs(H[1:] - C[:-1]), abs(L[1:] - C[:-1])))
    atr = np.concatenate([[np.nan], pd.Series(tr).rolling(14).mean().values])
    ma20 = pd.Series(C).rolling(20).mean().values; ma50 = pd.Series(C).rolling(50).mean().values
    lo60 = pd.Series(L).rolling(60).min().values
    fwd = lambda i, h: (C[i+h] / C[i] - 1) * 100 if i + h < n else None
    for i in range(80, n - 11): base.append([fwd(i, h) for h in HZ])
    # ── 페어 리버설 근사 ──
    for i in range(80, n - 11):
        hi, lo = swings(H[i-60:i+1], L[i-60:i+1]); hi = [x + i - 60 for x in hi]; lo = [x + i - 60 for x in lo]
        hi = [x for x in hi if x < i - 2]
        if len(hi) < 3: continue
        xs, ys = np.array(hi[-3:]), H[hi[-3:]]
        a, b = np.polyfit(xs, ys, 1)
        if a >= 0: continue
        if any(abs(H[x] - (a*x + b)) / H[x] > 0.015 for x in hi[-3:]): continue
        tl = a * i + b; tl_prev = a * (i - 1) + b
        neck = max(H[i-40:i-1]); touches = sum(1 for x in range(i-40, i-1) if abs(H[x] - neck) / neck <= 0.015)
        if touches < 2: continue
        cross_tl = C[i] > tl and (C[i-1] <= tl_prev or C[i-2] <= a*(i-2)+b)
        cross_nk = C[i] > neck and (C[i-1] <= neck or C[i-2] <= neck)
        if not (cross_tl and cross_nk): continue
        gap_now = abs(tl - neck); gap_20 = abs((a*(i-20)+b) - neck)
        conv = gap_20 > 0 and gap_now <= gap_20 / 2
        stop = min(L[lo[-1]], L[i]) if lo else L[i]
        entry = C[i]; r = rr_outcome(C, H, L, i, entry, stop, entry + 2*(entry - stop))
        rec = {"tk": tk, "i": i, "f": [fwd(i, h) for h in HZ], "R": r}
        rows["pair"].append(rec)
        if conv: rows["pair_conv"].append(rec)
    # ── Root 타격 근사 ──
    for i in range(80, n - 11):
        prior_low = min(L[i-20:i])
        if not (L[i] < prior_low and C[i] > prior_low): continue          # 스윕 + 복귀
        disp = None
        for j in range(i, min(i + 3, n)):
            if C[j] > O[j] and (C[j] - O[j]) >= 1.0 * atr[j] and C[j] > H[i-1]: disp = j; break
        if disp is None: continue
        lo_d, hi_d = O[disp], C[disp]; mid = (lo_d + hi_d) / 2
        for k in range(disp + 1, min(disp + 6, n - 11)):
            if L[k] <= hi_d and C[k] >= mid and C[k] > 0:                    # 되돌림 확인
                entry, stop = C[k], L[i]
                overlap = any(abs(entry - lv) / entry <= 0.015 for lv in (ma20[k], ma50[k], lo60[k]) if not np.isnan(lv))
                r = rr_outcome(C, H, L, k, entry, stop, entry + 2*(entry - stop))
                rec = {"tk": tk, "i": k, "f": [fwd(k, h) for h in HZ], "R": r}
                rows["root_any"].append(rec); rows["root85" if overlap else "root75"].append(rec)
                break

def stats(recs):
    out = []
    for hi, h in enumerate(HZ):
        v = [r["f"][hi] for r in recs if r["f"][hi] is not None]
        out.append(f"{(np.mean([x > 0 for x in v])*100 if v else float('nan')):3.0f}%")
    Rs = [r["R"] for r in recs if r["R"] is not None]
    hit = np.mean([x > 0 for x in Rs]) * 100 if Rs else float("nan")
    return " ".join(out), (np.mean(Rs) if Rs else float("nan")), hit, len(Rs)

bv = [[x for x in col if x is not None] for col in zip(*base)]
print("  기준선(아무 날이나) 오를 확률 +1/+3/+5/+10: " + " ".join(f"{np.mean([x>0 for x in v])*100:3.0f}%" for v in bv))
print(f"  {'후보':28} {'n':>5}  오를 확률 +1/+3/+5/+10   2R 기대값   목표 선착률")
for k, lab in [("pair", "페어 리버설(동시 돌파)"), ("pair_conv", "  + 수렴(간격 절반 이하)"), ("root_any", "Root 타격(스윕·변위·되돌림)"),
               ("root75", "  75점(레벨 중첩 없음)"), ("root85", "  85점(레벨 중첩)")]:
    recs = rows[k]; s, er, hit, nR = stats(recs)
    grade = "" if len(recs) >= 50 else " ⚠방향만" if len(recs) >= 30 else " ⚠참고" if len(recs) >= 15 else " ✗신뢰불가"
    print(f"  {lab:28} {len(recs):5d}  {s}   {er:+.2f}R      {hit:3.0f}%{grade}")
half = None
for k, lab in [("pair", "페어 리버설"), ("root_any", "Root 타격")]:
    recs = sorted(rows[k], key=lambda r: r["i"]);
    if len(recs) < 10: continue
    m = len(recs) // 2
    a, b = recs[:m], recs[m:]
    sa, ra, _, _ = stats(a); sb, rb, _, _ = stats(b)
    print(f"  §2 {lab} 전반 {sa} ({ra:+.2f}R) / 후반 {sb} ({rb:+.2f}R)")
print("\n※ 일봉 근사다. 원문 요소(수렴 배율·상위프레임 매물대·분봉 변위)는 못 잰다. 산식 반영 없음 — 승률이 기준선 +5%p 이상이고 2R 기대값이 양수일 때만 '표시 후보'로 올린다.")
