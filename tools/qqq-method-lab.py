#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
나스닥(QQQ) 전용 등급 — 방법론 25종을 같은 판에서 비교 (읽기 전용 · 로그만)

사용자 지시(2026-08-23): "나스닥 개별 승률이 너무 낮은데 방법론 여러 개 비교해서
승률 최대화하되 나스닥은 개별종목과 다르게 등급 계산해줘."

왜 개별주 산식이 지수에 안 맞나(§5-2): 지수는 이미 100종목 분산이라 개별주에서
쓰는 '급락 후 반등'·'거래량 폭증' 같은 재료의 진폭이 눌린다. 실제로 QQQ의 개별
적중률은 강한매수 40%대이고 다중·강한다중은 유니버스 밖이라 0회다.

⚠ **다중비교가 이 검증의 최대 위험이다.** 25개를 훑으면 그중 한둘은 우연히 좋다.
   그래서 채택은 세 관문을 전부 통과한 것만 한다:
     ① 기준선 대비 +%p   ② §2 전·후반 같은 방향   ③ 표본 15+ (§5-1)
   그리고 몇 개를 훑었는지 결과에 같이 적는다. 숨기면 그게 조작이다.

⚠ 표본을 늘리려고 야후에서 3년을 새로 받는다(백테스트 파일은 180일뿐).
   breadth(20일선 위 비율)는 관심종목으로 직접 센다 — 외부 데이터가 필요 없다.
⚠ 아무 파일도 안 고친다. CI에서만 돈다.

사용: python tools/qqq-method-lab.py [--years 3]
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

UNIV = sorted({tk for d in M.WATCHLIST.values() for tk in d} - set(M.LEVERAGED))
NEED = ["QQQ", "^VXN", "SPY"]
print(f"■ 나스닥 전용 등급 — 방법론 비교 · {args.years}년 · breadth용 관심종목 {len(UNIV)}개")

px = yf.download(sorted(set(UNIV + NEED)), period=f"{args.years}y", auto_adjust=True,
                 progress=False, group_by="ticker", threads=True)


def close_of(tk):
    try:
        return px[tk]["Close"].dropna()
    except Exception:
        return None


q = close_of("QQQ")
if q is None or len(q) < 300:
    print("[ERROR] QQQ를 못 받았다"); sys.exit(1)

# ── QQQ 지표 (전부 그날 종가까지만 쓴다) ────────────────────────────────
df = pd.DataFrame({"c": q.values.astype(float)}, index=q.index)
d_ = df.c.diff()
gain = d_.clip(lower=0).ewm(alpha=1/14, min_periods=14).mean()
loss = (-d_.clip(upper=0)).ewm(alpha=1/14, min_periods=14).mean()
df["rsi"] = 100 - 100 / (1 + gain / loss)
df["ma20"] = df.c.rolling(20).mean()
df["ma50"] = df.c.rolling(50).mean()
df["ma200"] = df.c.rolling(200).mean()
sd = df.c.rolling(20).std()
df["bb"] = (df.c - (df.ma20 - 2 * sd)) / (4 * sd) * 100
df["chg"] = df.c.pct_change() * 100
df["ret5"] = (df.c / df.c.shift(5) - 1) * 100
df["ma20up"] = df.ma20 > df.ma20.shift(5)
df["down1"] = df.chg < 0
df["down2"] = df.down1 & df.down1.shift(1)
df["down3"] = df.down2 & df.down1.shift(2)

vx = close_of("^VXN")
df["vxn"] = vx.reindex(df.index).ffill() if vx is not None else np.nan
df["vxnPrev"] = df.vxn.shift(1)
sp = close_of("SPY")
spc = (sp.pct_change() * 100).reindex(df.index) if sp is not None else None
df["spyChg"] = spc if spc is not None else np.nan

# breadth — 관심종목 중 20일선 위 비율
above = pd.DataFrame(index=df.index)
for tk in UNIV:
    c = close_of(tk)
    if c is None or len(c) < 60:
        continue
    c = c.reindex(df.index)
    above[tk] = (c > c.rolling(20).mean()).astype(float).where(c.notna())
df["br"] = above.mean(axis=1) * 100
df["brN"] = above.notna().sum(axis=1)

HS = (1, 3, 5, 10)
for h in HS:
    df[f"f{h}"] = (df.c.shift(-h) / df.c - 1) * 100

W = df.dropna(subset=["rsi", "ma50", "br", "f10"]).copy()
W = W[W.brN >= 20]
if len(W) < 200:
    print(f"[ERROR] 유효 거래일 {len(W)}일 — 너무 적다"); sys.exit(1)
W["d"] = [str(x.date()) for x in W.index]
MID = W["d"].iloc[len(W) // 2]
print(f"  유효 거래일 {len(W)}일 · {W.d.min()} ~ {W.d.max()} · 반쪽 기준 {MID}")
print(f"  VXN {'있음' if W.vxn.notna().sum() > 100 else '부족'} · SPY {'있음' if W.spyChg.notna().sum() > 100 else '부족'}")


def grade(n):
    return "신뢰" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "일화" if n >= 5 else "불가"


def stat(sub, h):
    """지수는 변동폭이 작아 '오르면 승'(0 기준)으로 센다 — 기존 나스닥 등급 숫자와 같은 규칙."""
    a = sub[f"f{h}"].dropna()
    return {"n": len(a), "rate": round(float((a > 0).mean() * 100)) if len(a) else None,
            "avg": round(float(a.mean()), 2) if len(a) else None}


BASE = {h: stat(W, h) for h in HS}


def cell(s, ref=None):
    if s["rate"] is None:
        return f"  —({s['n']:>3})       "
    e = f"{s['rate']-ref['rate']:+d}".rjust(4) + "%p" if ref and ref["rate"] is not None else "     "
    return f"{s['rate']:>3}%({s['n']:>3}){e} {s['avg']:+.2f}%"


V = W  # 짧게
METHODS = [
    # ── 추세 계열 ──────────────────────────────────────────────
    ("T1 20일선 위",              V.c > V.ma20),
    ("T2 50일선 위",              V.c > V.ma50),
    ("T3 20일선 상승 중",          V.ma20up),
    ("T4 20일선 위 + 상승 중",      (V.c > V.ma20) & V.ma20up),
    ("T5 50일선 위 + 200일선 위",   (V.c > V.ma50) & (V.c > V.ma200)),
    # ── 평균회귀 계열 ──────────────────────────────────────────
    ("R1 RSI ≤ 35",             V.rsi <= 35),
    ("R2 RSI ≤ 40",             V.rsi <= 40),
    ("R3 RSI ≤ 45",             V.rsi <= 45),
    ("R4 볼린저 ≤ 20",           V.bb <= 20),
    ("R5 볼린저 ≤ 10",           V.bb <= 10),
    ("R6 당일 -1.5% 이하 급락",    V.chg <= -1.5),
    ("R7 2일 연속 하락",           V.down2),
    ("R8 3일 연속 하락",           V.down3),
    ("R9 5일 누적 -3% 이하",       V.ret5 <= -3),
    # ── 변동성 계열 ────────────────────────────────────────────
    ("V1 VXN ≥ 28",             V.vxn >= 28),
    ("V2 VXN ≥ 28 & 꺾임",       (V.vxn >= 28) & (V.vxn < V.vxnPrev)),
    ("V3 VXN ≥ 25 & 꺾임",       (V.vxn >= 25) & (V.vxn < V.vxnPrev)),
    ("V4 VXN 전일보다 하락",        V.vxn < V.vxnPrev),
    # ── 시장 폭 ────────────────────────────────────────────────
    ("B1 20일선 위 30% 미만",      V.br < 30),
    ("B2 20일선 위 40% 미만",      V.br < 40),
    ("B3 20일선 위 50% 미만",      V.br < 50),
    # ── 지수 간 ────────────────────────────────────────────────
    ("S1 QQQ 하락 & SPY 상승",     (V.chg < 0) & (V.spyChg > 0)),
    # ── 현행 + 조합 ────────────────────────────────────────────
    ("C0 현행 등급(V2∪B1∪R1)",    ((V.vxn >= 28) & (V.vxn < V.vxnPrev)) | (V.br < 30) | (V.rsi <= 35)),
    ("X1 RSI≤40 & 20일선 위",     (V.rsi <= 40) & (V.c > V.ma20)),
    ("X2 RSI≤45 & 50일선 위",     (V.rsi <= 45) & (V.c > V.ma50)),
    ("X3 2일 연속 하락 & 50일선 위", V.down2 & (V.c > V.ma50)),
    ("X4 볼린저≤20 & 50일선 위",    (V.bb <= 20) & (V.c > V.ma50)),
    ("X5 V2 ∪ B2 ∪ R2 (완화)",   ((V.vxn >= 28) & (V.vxn < V.vxnPrev)) | (V.br < 40) | (V.rsi <= 40)),
]

print(f"\n  기준 = 아무 날이나 산 경우. 칸: 상승비율(표본) 대비%p 평균수익 · +1/+3/+5/+10일")
print("  " + "─" * 84)
print(f"  {'(아무 날이나 = 기준선)':<26} [{grade(len(W))}] " + " ".join(cell(BASE[h]) for h in HS))

passed = []
print("\n── 방법론 25종 (표본 15건 미만은 §5-1 미달로 제외 표시)")
for name, mask in METHODS:
    m = mask.fillna(False)
    sub = V[m]
    if len(sub) < 5:
        print(f"  {name:<26} 표본 {len(sub)}건 — 판단 불가"); continue
    line = f"  {name:<26} [{grade(len(sub))}] " + " ".join(cell(stat(sub, h), BASE[h]) for h in HS)
    print(line)
    f, b = sub[sub.d < MID], sub[sub.d >= MID]
    if len(f) >= 5 and len(b) >= 5:
        print(f"    · 전반 " + " ".join(cell(stat(f, h), BASE[h]) for h in HS))
        print(f"    · 후반 " + " ".join(cell(stat(b, h), BASE[h]) for h in HS))
        # 채택 관문 — +3일 기준으로 ①②③ 전부 통과한 것만 모은다
        s3, f3, b3 = stat(sub, 3), stat(f, 3), stat(b, 3)
        if (len(sub) >= 15 and s3["rate"] is not None and BASE[3]["rate"] is not None
                and s3["rate"] - BASE[3]["rate"] >= 5
                and f3["rate"] is not None and b3["rate"] is not None
                and f3["rate"] > BASE[3]["rate"] and b3["rate"] > BASE[3]["rate"]):
            passed.append((name, len(sub), s3["rate"] - BASE[3]["rate"], s3["avg"]))

print(f"\n── 세 관문(+5%p · §2 양쪽 통과 · 표본 15+)을 모두 넘은 것")
if not passed:
    print("  없음 — 25종 중 하나도 통과하지 못했다. 지금 나스닥 전용 등급을 바꿀 근거가 없다.")
else:
    for nm, n, e, a in sorted(passed, key=lambda x: -x[2]):
        print(f"  ✅ {nm:<26} {n}건 · +3일 {e:+d}%p · 평균 {a:+.2f}%")
print(f"\n※ 방법론 {len(METHODS)}종을 훑었다. 25개를 훑으면 그중 한둘은 우연히 좋다 —")
print("  통과한 것이 있어도 다음 사이클에서 같은 조합이 다시 통과해야 실전에 쓴다(다중비교).")
print("  기준선 자체가 국면에 따라 뒤집히므로 '원승률'이 아니라 대비 %p로만 판단한다(§1).")
print("  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.")
