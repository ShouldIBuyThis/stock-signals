#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
캔들(봉) 모양으로 매매 신호를 잡는 기법의 실제 승률 (읽기 전용 · 로그만)

사용자 질문(2026-08-20): "종가 캔들 모양으로 시그널 분석하는 기법 승률도 분석".

교과서 패턴 16종을 그대로 코드로 옮겨 우리 관심종목 전 구간에서 잰다.
비교 기준은 **같은 종목·같은 기간의 아무 날이나**(전체 봉)다 — 이걸 안 깔면
"망치형 다음날 55% 상승"이 좋아 보이지만 그냥 아무 날이나 55%인 장이었을 수 있다(§1).

⚠ 우리 원장 hist에는 종가만 있고 시가·고가·저가가 없다. 그래서 이 도구는
   야후에서 OHLC를 새로 받아 쓴다 — 원장·백테스트와 별개의 독립 측정이다.
⚠ 아무 파일도 안 고친다. CI에서만 돈다(로컬은 야후가 프록시에 막힘).

사용: python tools/candle-lab.py [--years 3]
"""
import sys, argparse
import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, ".")
import main as M

ap = argparse.ArgumentParser()
ap.add_argument("--years", type=int, default=3)
args = ap.parse_args()

# 레버리지 ETF는 3배로 증폭돼 평균수익을 부풀린다 — 뺀다.
UNIV = sorted({tk for d in M.WATCHLIST.values() for tk in d} - set(M.LEVERAGED))
print(f"■ 캔들 패턴 승률 — 대상 {len(UNIV)}종목 · {args.years}년 (레버리지 ETF 제외)")

px = yf.download(UNIV, period=f"{args.years}y", auto_adjust=True,
                 progress=False, group_by="ticker", threads=True)

HS = (1, 3, 5)
rows = []
for tk in UNIV:
    try:
        d = px[tk][["Open", "High", "Low", "Close", "Volume"]].dropna()
    except Exception:
        continue
    if len(d) < 80:
        continue
    O, H, L, C = (d[k].values.astype(float) for k in ("Open", "High", "Low", "Close"))
    V = d["Volume"].values.astype(float)
    ma20 = pd.Series(C).rolling(20).mean().values
    vma = pd.Series(V).rolling(20).mean().values
    body = np.abs(C - O)
    rng = np.maximum(H - L, 1e-9)
    up = C > O
    upper = H - np.maximum(O, C)
    lower = np.minimum(O, C) - L
    dates = [str(x.date()) for x in d.index]

    for i in range(25, len(C) - max(HS)):
        b, rg = body[i], rng[i]
        if rg <= 0:
            continue
        # 추세 맥락 — 교과서는 "무슨 자리에서 나왔나"로 같은 모양의 의미를 뒤집는다
        downtrend = C[i - 1] < C[i - 6]
        uptrend = C[i - 1] > C[i - 6]
        pb, pu = body[i - 1], up[i - 1]
        pat = []

        # ── 한 봉짜리 ──────────────────────────────────────────────
        if b <= rg * 0.1:
            pat.append("도지")
        if lower[i] >= 2 * b and upper[i] <= b and b > 0:
            pat.append("망치형(하락 뒤)" if downtrend else "교수형(상승 뒤)")
        if upper[i] >= 2 * b and lower[i] <= b and b > 0:
            pat.append("역망치(하락 뒤)" if downtrend else "유성형(상승 뒤)")
        if b >= rg * 0.9:
            pat.append("양봉 마루보즈" if up[i] else "음봉 마루보즈")

        # ── 두 봉짜리 ──────────────────────────────────────────────
        if not pu and up[i] and O[i] <= C[i - 1] and C[i] >= O[i - 1] and b > pb:
            pat.append("상승장악형")
        if pu and not up[i] and O[i] >= C[i - 1] and C[i] <= O[i - 1] and b > pb:
            pat.append("하락장악형")
        if not pu and up[i] and O[i] < L[i - 1] and C[i] > (O[i - 1] + C[i - 1]) / 2 and C[i] < O[i - 1]:
            pat.append("관통형")
        if pu and not up[i] and O[i] > H[i - 1] and C[i] < (O[i - 1] + C[i - 1]) / 2 and C[i] > O[i - 1]:
            pat.append("흑운형")
        if pb > 0 and b < pb * 0.6 and max(O[i], C[i]) < max(O[i - 1], C[i - 1]) \
           and min(O[i], C[i]) > min(O[i - 1], C[i - 1]):
            pat.append("상승잉태형" if not pu else "하락잉태형")

        # ── 세 봉짜리 ──────────────────────────────────────────────
        if not up[i - 2] and body[i - 2] > rng[i - 2] * 0.5 and body[i - 1] < body[i - 2] * 0.4 \
           and up[i] and C[i] > (O[i - 2] + C[i - 2]) / 2:
            pat.append("샛별형")
        if up[i - 2] and body[i - 2] > rng[i - 2] * 0.5 and body[i - 1] < body[i - 2] * 0.4 \
           and not up[i] and C[i] < (O[i - 2] + C[i - 2]) / 2:
            pat.append("저녁별형")
        if all(up[i - k] for k in (0, 1, 2)) and C[i] > C[i - 1] > C[i - 2] \
           and all(body[i - k] > rng[i - k] * 0.5 for k in (0, 1, 2)):
            pat.append("적삼병")
        if all(not up[i - k] for k in (0, 1, 2)) and C[i] < C[i - 1] < C[i - 2] \
           and all(body[i - k] > rng[i - k] * 0.5 for k in (0, 1, 2)):
            pat.append("흑삼병")

        rec = {"tk": tk, "d": dates[i],
               "above20": bool(ma20[i] == ma20[i] and C[i] > ma20[i]),
               "volx": float(V[i] / vma[i]) if vma[i] == vma[i] and vma[i] > 0 else float("nan")}
        for h in HS:
            rec[f"r{h}"] = (C[i + h] / C[i] - 1) * 100
        rec["pat"] = pat
        rows.append(rec)

df = pd.DataFrame(rows)
if df.empty:
    print("[ERROR] 봉을 하나도 못 모았다 — 야후 응답 확인")
    sys.exit(1)
df = df.sort_values("d").reset_index(drop=True)
MID = df["d"].iloc[len(df) // 2]
print(f"  전체 봉 {len(df):,}개 · 종목 {df.tk.nunique()}개 · {df.d.min()} ~ {df.d.max()} · 반쪽 기준 {MID}")


def grade(n):
    return "신뢰" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "일화" if n >= 5 else "불가"


def stat(sub, col):
    """승률 규칙은 화면·검증표와 같다 — ±1% 보합 제외."""
    a = sub[col].dropna()
    dec = a[a.abs() > 1]
    w = int((dec > 1).sum())
    return {"n": len(a),
            "rate": round(w / len(dec) * 100) if len(dec) else None,
            "avg": round(float(a.mean()), 2) if len(a) else None}


BASE = {h: stat(df, f"r{h}") for h in HS}


def cell(s, b):
    if s["rate"] is None:
        return f"  —({s['n']:>4})          "
    e = f"{s['rate']-b['rate']:+d}".rjust(4) + "%p" if b and b["rate"] is not None else "     "
    return f"{s['rate']:>3}%({s['n']:>4}){e} {s['avg']:+.2f}%"


def line(label, sub, halves=True):
    if len(sub) == 0:
        print(f"  {label:<22} 표본 없음")
        return
    print(f"  {label:<22} [{grade(len(sub))}] " + " ".join(cell(stat(sub, f"r{h}"), BASE[h]) for h in HS))
    if halves and len(sub) >= 40:
        for nm, part in (("전반", sub[sub.d < MID]), ("후반", sub[sub.d >= MID])):
            if len(part):
                print(f"    · {nm:<18}      " + " ".join(cell(stat(part, f"r{h}"), BASE[h]) for h in HS))


print("\n  기준 = 같은 종목·같은 기간의 '아무 날이나'. 칸: 승률(표본) 대비%p 평균수익 · +1/+3/+5일")
print("  " + "─" * 92)
print(f"  {'(아무 날이나 = 기준선)':<22} [{grade(len(df))}] " + " ".join(cell(BASE[h], None) for h in HS))

PATS = ["망치형(하락 뒤)", "역망치(하락 뒤)", "상승장악형", "관통형", "샛별형", "상승잉태형",
        "적삼병", "양봉 마루보즈", "도지",
        "교수형(상승 뒤)", "유성형(상승 뒤)", "하락장악형", "흑운형", "저녁별형", "하락잉태형",
        "흑삼병", "음봉 마루보즈"]
has = {p: df[df.pat.apply(lambda x, p=p: p in x)] for p in PATS}

print("\n── ① 매수(상승 반전) 계열 — 교과서가 '오른다'고 하는 모양")
for p in PATS[:9]:
    line(p, has[p])

print("\n── ② 매도(하락 반전) 계열 — 교과서가 '내린다'고 하는 모양")
print("     ※ 여기서 승률이 기준선보다 낮아야 패턴이 맞는 것이다")
for p in PATS[9:]:
    line(p, has[p])

print("\n── ③ 맥락을 붙이면 달라지나 (20일선 위/아래)")
for p in ["망치형(하락 뒤)", "상승장악형", "적삼병", "역망치(하락 뒤)"]:
    s = has[p]
    if len(s) < 30:
        continue
    line(p + " · 20일선↑", s[s.above20], halves=False)
    line(p + " · 20일선↓", s[~s.above20], halves=False)

print("\n── ④ 거래량을 붙이면 달라지나 (당일 거래량 1.5배 이상)")
for p in ["망치형(하락 뒤)", "상승장악형", "샛별형", "적삼병"]:
    s = has[p]
    if len(s) < 30:
        continue
    line(p + " · 거래량 1.5배+", s[s.volx >= 1.5], halves=False)
    line(p + " · 거래량 보통", s[s.volx < 1.5], halves=False)

print("\n※ 채택 기준(방법론): 기준선 대비 +%p · §2 전·후반 같은 방향 · 표본 15+(§5-1).")
print("  ±2%p 안쪽은 '효과 없음'으로 읽는다 — 봉 하나로 다음날을 맞히는 도구가 아니다.")
print("  이 도구는 실험 전용이다. 뱃지·점수 반영은 사용자 승인 후에만.")
