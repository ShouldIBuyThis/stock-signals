#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
피보나치 되돌림 · 하모닉 패턴(XABCD)이 실제로 맞는가 (읽기 전용 · 로그만)

사용자 질문(2026-08-23): 하모닉 패턴 스캐너를 우리도 만들 수 있나 / 의미가 있나.

하모닉(Gartley·Bat·Butterfly·Crab)의 모든 비율은 결국 **피보나치 되돌림이 지지로
작동한다**는 전제 위에 서 있다. 전제가 거짓이면 그 위에 쌓은 패턴도 무의미하다.
그래서 두 단계로 잰다:
  ① 순수 되돌림 — 확정된 상승 스윙(X→A) 뒤 0.382/0.5/0.618/0.786/0.886까지
     되돌린 자리에서 실제로 반등하나. (댓글의 "786 886은 의미있다" 주장 포함)
  ② 하모닉 4종  — X·A·B·C 비율이 맞고 가격이 PRZ(D 구간)에 도달한 날의 성적.

⚠ **리페인트 금지가 이 검증의 전부다.** 스윙 피벗은 뒤로 CONFIRM봉이 지나야
   "여기가 고점이었다"를 알 수 있다. 화면에 패턴이 뜨는 순간 그것은 이미 며칠 전에
   만들어져 있던 것이다. 백테스트에서 확정 전 피벗을 쓰면 미래를 보는 셈이고,
   하모닉 백테스트가 대부분 거짓이 되는 지점이 정확히 여기다.
   여기서는 **바 t 시점에 확정이 끝난 피벗만** 쓴다.

⚠ 아무 파일도 안 고친다. CI에서만 돈다(로컬은 야후가 프록시에 막힘).

사용: python tools/fib-lab.py [--years 3] [--confirm 3]
"""
import sys, argparse
import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, ".")
import main as M

ap = argparse.ArgumentParser()
ap.add_argument("--years", type=int, default=3)
ap.add_argument("--confirm", type=int, default=3, help="피벗 확정에 필요한 뒤쪽 봉 수")
args = ap.parse_args()
K = args.confirm

UNIV = sorted({tk for d in M.WATCHLIST.values() for tk in d} - set(M.LEVERAGED))
print(f"■ 피보나치 되돌림 · 하모닉 검증 — {len(UNIV)}종목 · {args.years}년 · 피벗 확정 {K}봉")
print(f"  ⚠ 피벗은 {K}봉 뒤에 확정된 것만 쓴다(리페인트 금지). 화면 스캐너가 '후행'인 이유가 이것이다.")

px = yf.download(UNIV, period=f"{args.years}y", auto_adjust=True,
                 progress=False, group_by="ticker", threads=True)

HS = (5, 10, 20)
TOL = 0.06                       # 비율 허용 오차 (교과서가 쓰는 ±5~7%)

# 하모닉 4종 — (XAB 범위, ABC 범위, BCD 범위, XAD 목표)
HARM = {
    "Gartley":   ((0.55, 0.68), (0.38, 0.89), (1.13, 1.62), 0.786),
    "Bat":       ((0.36, 0.52), (0.38, 0.89), (1.62, 2.62), 0.886),
    "Butterfly": ((0.72, 0.85), (0.38, 0.89), (1.62, 2.30), 1.270),
    "Crab":      ((0.36, 0.65), (0.38, 0.89), (2.24, 3.70), 1.618),
}


def pivots(H, L, k):
    """스윙 고·저점. (인덱스, 값, 'H'/'L', 확정된 바) — 확정 바는 i+k다."""
    out = []
    for i in range(k, len(H) - k):
        if H[i] == max(H[i - k:i + k + 1]):
            out.append((i, H[i], "H", i + k))
        elif L[i] == min(L[i - k:i + k + 1]):
            out.append((i, L[i], "L", i + k))
    # 같은 방향이 연달아 나오면 더 극단적인 것만 남긴다(지그재그)
    z = []
    for p in out:
        if z and z[-1][2] == p[2]:
            if (p[2] == "H" and p[1] > z[-1][1]) or (p[2] == "L" and p[1] < z[-1][1]):
                z[-1] = p
        else:
            z.append(p)
    return z


fib_rows, harm_rows, base_rows = [], [], []
LEVELS = [("0.382", 0.382), ("0.500", 0.500), ("0.618", 0.618),
          ("0.786", 0.786), ("0.886", 0.886), ("1.000+ (전저점 이탈)", 1.05)]

for tk in UNIV:
    try:
        d = px[tk][["High", "Low", "Close", "Volume"]].dropna()
    except Exception:
        continue
    if len(d) < 200:
        continue
    H, L, C = (d[c].values.astype(float) for c in ("High", "Low", "Close"))
    dates = [str(x.date()) for x in d.index]
    Z = pivots(H, L, K)
    if len(Z) < 6:
        continue

    # 기준선 — 같은 종목 같은 기간의 아무 날이나
    for i in range(K + 5, len(C) - max(HS)):
        base_rows.append({h: (C[i + h] / C[i] - 1) * 100 for h in HS})

    # ── ① 순수 되돌림 ────────────────────────────────────────────────
    # 확정된 저점 X → 확정된 고점 A 다음, 가격이 각 레벨에 처음 닿은 날.
    for a in range(1, len(Z)):
        if Z[a][2] != "H" or Z[a - 1][2] != "L":
            continue
        xi, xv = Z[a - 1][0], Z[a - 1][1]
        ai, av, conf = Z[a][0], Z[a][1], Z[a][3]
        rng = av - xv
        if rng <= 0 or av <= 0 or rng / av < 0.05:      # 5% 미만 스윙은 잡음
            continue
        hit = set()
        # 스캔은 A가 **확정된 뒤**부터. 그 전에는 A가 고점인 줄 모른다.
        for i in range(max(conf + 1, K + 5), min(len(C) - max(HS), ai + 120)):
            if C[i] > av:                                # 고점 돌파 = 되돌림 국면 끝
                break
            r = (av - L[i]) / rng                        # 저가 기준 되돌림 깊이
            for name, lv in LEVELS:
                if name in hit or r < lv:
                    continue
                hit.add(name)
                fib_rows.append({"tk": tk, "d": dates[i], "lv": name,
                                 "swing": rng / av * 100,
                                 "r": {h: (C[i + h] / C[i] - 1) * 100 for h in HS}})

    # ── ② 하모닉 4종 (상승형만 — 우리 사이트는 매수 쪽이다) ─────────
    # X(저) A(고) B(저) C(고) 가 확정돼 있고, 그 뒤 가격이 D(PRZ)에 닿는 날.
    for c in range(3, len(Z)):
        if Z[c][2] != "H":
            continue
        X, A, B, Cp = Z[c - 3], Z[c - 2], Z[c - 1], Z[c]
        if (X[2], A[2], B[2], Cp[2]) != ("L", "H", "L", "H"):
            continue
        xv, av, bv, cv = X[1], A[1], B[1], Cp[1]
        xa = av - xv
        ab = av - bv
        bc = cv - bv
        if xa <= 0 or ab <= 0 or bc <= 0 or xa / av < 0.05:
            continue
        xab, abc = ab / xa, bc / ab
        conf = Cp[3]                                     # C가 확정된 바
        for nm, (xr, ar, br, xad) in HARM.items():
            if not (xr[0] <= xab <= xr[1] and ar[0] <= abc <= ar[1]):
                continue
            dprice = av - xa * xad                       # XAD 비율이 지목하는 D
            if dprice <= 0:
                continue
            lo, hi = dprice * (1 - TOL / 2), dprice * (1 + TOL / 2)
            for i in range(max(conf + 1, K + 5), min(len(C) - max(HS), Cp[0] + 120)):
                if C[i] > cv:                            # C 위로 뚫으면 패턴 무효
                    break
                if L[i] <= hi and L[i] >= lo * 0.97:     # PRZ 도달
                    bcd = (cv - L[i]) / bc
                    if not (br[0] <= bcd <= br[1]):
                        break
                    harm_rows.append({"tk": tk, "d": dates[i], "pat": nm,
                                      "r": {h: (C[i + h] / C[i] - 1) * 100 for h in HS}})
                    break

BASE_DF = pd.DataFrame(base_rows)
FIB = pd.DataFrame(fib_rows)
HRM = pd.DataFrame(harm_rows)
if BASE_DF.empty or FIB.empty:
    print(f"[ERROR] 표본을 못 모았다 — 기준 {len(BASE_DF)} · 되돌림 {len(FIB)} · 하모닉 {len(HRM)}")
    sys.exit(1)
FIB = FIB.sort_values("d").reset_index(drop=True)
MID = FIB["d"].iloc[len(FIB) // 2]


def grade(n):
    return "신뢰" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "일화" if n >= 5 else "불가"


def stat(vals):
    a = [v for v in vals if v is not None and v == v]
    dec = [v for v in a if abs(v) > 1]
    w = len([v for v in dec if v > 1])
    return {"n": len(a), "rate": round(w / len(dec) * 100) if dec else None,
            "avg": round(float(np.mean(a)), 2) if a else None}


BASE = {h: stat(BASE_DF[h]) for h in HS}


def cell(s, ref=None):
    if s["rate"] is None:
        return f"  —({s['n']:>4})         "
    e = f"{s['rate']-ref['rate']:+d}".rjust(4) + "%p" if ref and ref["rate"] is not None else "     "
    return f"{s['rate']:>3}%({s['n']:>4}){e} {s['avg']:+.2f}%"


print(f"  일봉 기준선 {len(BASE_DF):,}개 · 되돌림 도달 {len(FIB):,}건 · 하모닉 완성 {len(HRM)}건")
print("\n── ① 피보나치 되돌림 — 그 레벨에 닿으면 실제로 반등하나 · +5/+10/+20일")
print("  " + "─" * 76)
print(f"  {'(아무 날이나 = 기준선)':<22} [{grade(len(BASE_DF))}] " + " ".join(cell(BASE[h]) for h in HS))
for name, _ in LEVELS:
    sub = FIB[FIB.lv == name]
    if not len(sub):
        print(f"  {name:<22} 표본 없음"); continue
    print(f"  {name:<22} [{grade(len(sub))}] " +
          " ".join(cell(stat(sub.r.map(lambda x, h=h: x[h])), BASE[h]) for h in HS))
    if len(sub) >= 40:
        for nm2, part in (("전반", sub[sub.d < MID]), ("후반", sub[sub.d >= MID])):
            if len(part):
                print(f"    · {nm2:<18} " +
                      " ".join(cell(stat(part.r.map(lambda x, h=h: x[h])), BASE[h]) for h in HS))
print("  → 하모닉의 모든 비율은 이 표 위에 서 있다. 여기서 +%p가 안 나오면 그 위는 볼 필요가 없다.")

print("\n── ② 큰 스윙(20%+)만 — 되돌림은 큰 파동에서만 유효하다는 주장 검증")
big = FIB[FIB.swing >= 20]
for name, _ in LEVELS:
    sub = big[big.lv == name]
    if len(sub) < 15:
        print(f"  {name:<22} 표본 {len(sub)}건 — 판단 보류"); continue
    print(f"  {name:<22} [{grade(len(sub))}] " +
          " ".join(cell(stat(sub.r.map(lambda x, h=h: x[h])), BASE[h]) for h in HS))

print("\n── ③ 하모닉 4종 — X·A·B·C 비율이 맞고 PRZ에 도달한 날")
if HRM.empty:
    print("  완성 패턴 0건 — 일봉에서는 이 비율 조합이 거의 안 나온다는 뜻이다.")
else:
    print(f"  {'전체 하모닉':<22} [{grade(len(HRM))}] " +
          " ".join(cell(stat(HRM.r.map(lambda x, h=h: x[h])), BASE[h]) for h in HS))
    for nm in HARM:
        sub = HRM[HRM.pat == nm]
        if not len(sub):
            print(f"  {nm:<22} 0건"); continue
        print(f"  {nm:<22} [{grade(len(sub))}] " +
              " ".join(cell(stat(sub.r.map(lambda x, h=h: x[h])), BASE[h]) for h in HS))

print("\n※ 이 숫자는 '패턴을 만들 수 있나'가 아니라 '만들 가치가 있나'에 답하는 것이다.")
print("  채택 기준(방법론): 기준선 대비 +%p · §2 전·후반 같은 방향 · 표본 15+(§5-1).")
print("  ±2%p 안쪽은 효과 없음으로 읽는다. 캔들 패턴 16종이 전부 이 문턱에서 기각됐다.")
print("  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.")
