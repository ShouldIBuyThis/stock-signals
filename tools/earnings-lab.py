#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
실적 발표 전 주가 흐름 → 발표 결과·발표 후 반응 (읽기 전용 · 로그만)

사용자 가설(2026-08-20):
  A) 실적 발표 1~2주 전에 주가를 의도적으로 누르는 '연속 음봉'이 나오면
     발표에서 어닝 서프라이즈가 나온다.
  B) 그 반대 — 발표 전에 미리 올려놨으면 발표는 실망(또는 뉴스에 팔아라).

측정 대상은 두 가지를 **따로** 본다. 섞으면 안 된다:
  ① 실제 EPS 서프라이즈(%)  — 야후가 주는 Reported vs Estimate. 회사의 실적 자체.
  ② 발표 후 주가 반응(%)     — 우리가 실제로 먹거나 잃는 값.
①이 좋아도 ②가 나쁠 수 있고(이미 반영), 그 반대도 있다. 사용자 가설은 문자 그대로는
①에 대한 것이지만, 사이트에 쓸 수 있는 건 ②다.

⚠ 이건 원장도 백테스트 산출물도 아니다. 로그로만 남기고 아무 파일도 안 고친다.
⚠ 야후가 프록시에 막힌 로컬에서는 안 돈다 — CI(workflow)에서만 실행된다.

사용: python tools/earnings-lab.py [--years 3]
"""
import sys, math, time, argparse
from datetime import datetime

import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, ".")
import main as M

ap = argparse.ArgumentParser()
ap.add_argument("--years", type=int, default=3, help="주가 수집 기간(년)")
args = ap.parse_args()

# ── 유니버스: 실적이 존재할 수 있는 종목만 (ETF 제외) ──────────────────────
UNIV = []
for cat, d in M.WATCHLIST.items():
    for tk in d:
        if tk in M.NO_EARNINGS_TICKERS:
            continue
        UNIV.append(tk)
UNIV = sorted(set(UNIV))
print(f"■ 실적 발표 전 흐름 검증 — 대상 {len(UNIV)}종목 · 주가 {args.years}년")

# ── 주가 ────────────────────────────────────────────────────────────────
px = yf.download(UNIV, period=f"{args.years}y", auto_adjust=True,
                 progress=False, group_by="ticker", threads=True)


def dnorm(t):
    """tz가 붙어 있든 아니든 '날짜'로 맞춘다. 야후는 주가는 naive, 실적은 뉴욕 tz로 준다."""
    t = pd.Timestamp(t)
    if t.tzinfo is not None:
        t = t.tz_localize(None)
    return t.normalize()


def closes(tk):
    try:
        c = px[tk]["Close"].dropna()
        v = px[tk]["Volume"].dropna()
    except Exception:
        return None, None
    return (c, v) if len(c) > 60 else (None, None)


# ── 이벤트 수집 ──────────────────────────────────────────────────────────
# 발표 시각으로 '마지막 미공개 종가(d0)'를 정한다.
#   장마감 후 발표(AMC, 16시 이후) → d0 = 발표일 종가, 반응일 = 다음 거래일
#   장전 발표(BMO, 9:30 이전)      → d0 = 전 거래일 종가, 반응일 = 발표일
# 시각을 모르면 미국은 AMC가 다수라 AMC로 두되 개수를 따로 센다(그 사실을 보고한다).
rows, unknown_timing, no_cal = [], 0, []
for tk in UNIV:
    c, v = closes(tk)
    if c is None:
        no_cal.append(tk + "(주가없음)")
        continue
    try:
        ed = yf.Ticker(tk).get_earnings_dates(limit=24)
    except Exception:
        ed = None
    time.sleep(0.3)                                    # 티커별 호출 — 레이트리밋 회피
    if ed is None or ed.empty:
        no_cal.append(tk)
        continue
    idx = list(c.index)
    days_idx = [dnorm(d) for d in idx]
    for ts, r in ed.iterrows():
        try:
            hour = ts.hour
        except Exception:
            continue
        day = dnorm(ts)
        bmo = hour < 12
        if hour == 0:
            unknown_timing += 1
            bmo = False
        # d0 = 발표 반영 전 마지막 종가
        prior = [i for i, d in enumerate(days_idx) if d < day] if bmo \
            else [i for i, d in enumerate(days_idx) if d <= day]
        if not prior:
            continue
        i0 = prior[-1]
        if i0 < 25 or i0 + 5 >= len(idx):
            continue                                   # 앞 20봉·뒤 5봉이 있어야 잰다
        cl = c.values
        p0 = float(cl[i0])
        pre5 = (p0 / float(cl[i0 - 5]) - 1) * 100
        pre10 = (p0 / float(cl[i0 - 10]) - 1) * 100
        # 직전 10봉 음봉 수 · d0까지 이어진 연속 음봉
        downs = sum(1 for j in range(i0 - 9, i0 + 1) if cl[j] < cl[j - 1])
        streak = 0
        j = i0
        while j > 0 and cl[j] < cl[j - 1]:
            streak += 1
            j -= 1
        # '조용히 누른다'의 대리 변수: 최근 5봉 거래량 / 그 앞 15봉 거래량
        try:
            vv = v.reindex(c.index).values
            q = float(np.nanmean(vv[i0 - 4:i0 + 1]) / np.nanmean(vv[i0 - 19:i0 - 4]))
        except Exception:
            q = float("nan")
        sur = r.get("Surprise(%)")
        try:
            sur = float(sur)
            if math.isnan(sur):
                sur = None
        except Exception:
            sur = None
        rows.append({
            "tk": tk, "d": str(idx[i0].date()), "bmo": bmo,
            "pre5": pre5, "pre10": pre10, "downs": downs, "streak": streak, "volq": q,
            "sur": sur,
            "r1": (float(cl[i0 + 1]) / p0 - 1) * 100,
            "r3": (float(cl[i0 + 3]) / p0 - 1) * 100,
            "r5": (float(cl[i0 + 5]) / p0 - 1) * 100,
        })

df = pd.DataFrame(rows)
if df.empty:
    print("[ERROR] 이벤트를 하나도 못 모았다 — 야후 응답 확인 필요")
    sys.exit(1)
df = df.sort_values("d").reset_index(drop=True)
df["sur"] = pd.to_numeric(df["sur"], errors="coerce")   # None 섞인 object → 실수
MID = df["d"].iloc[len(df) // 2]

print(f"  이벤트 {len(df)}건 · 종목 {df.tk.nunique()}개 · {df.d.min()} ~ {df.d.max()}")
print(f"  발표시각 불명 {unknown_timing}건은 장마감 후(AMC)로 간주 · 캘린더 없음 {len(no_cal)}종목")
print(f"  EPS 서프라이즈 값이 있는 이벤트 {int(df.sur.notna().sum())}건")
print("  ⚠ ①EPS 서프라이즈와 ②발표 후 주가는 다른 값이다. 둘을 따로 본다.")


def grade(n):
    return "신뢰" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "일화" if n >= 5 else "불가"


def stat(sub, col):
    """승률은 화면과 같은 규칙 — ±1% 보합 제외."""
    a = sub[col].dropna()
    dec = a[a.abs() > 1]
    w = (dec > 1).sum()
    return {"n": len(a),
            "rate": round(w / len(dec) * 100) if len(dec) else None,
            "avg": round(float(a.mean()), 2) if len(a) else None}


BASE = {c: stat(df, c) for c in ("r1", "r3", "r5")}
base_sur = df.sur.dropna()
BASE_SUR = (round(float(base_sur.mean()), 2), round(float((base_sur > 0).mean() * 100)), len(base_sur))


def cell(s, b):
    if not s or s["rate"] is None:
        return f"  —({s['n']:>3})        "
    e = f"{s['rate']-b['rate']:+d}".rjust(4) + "%p" if b and b["rate"] is not None else "     "
    av = f"{s['avg']:+.2f}" if s["avg"] is not None else "—"
    return f"{s['rate']:>3}%({s['n']:>3}){e} {av:>7}%"


def line(label, mask):
    sub = df[mask]
    if len(sub) == 0:
        print(f"  {label:<26} 표본 없음")
        return
    su = sub.sur.dropna()
    stxt = (f"{su.mean():+.1f}% / 상회 {int((su>0).mean()*100):>3}% ({len(su):>3})") if len(su) else "     —      "
    print(f"  {label:<26} [{grade(len(sub))}] EPS {stxt} │ " +
          " ".join(cell(stat(sub, c), BASE[c]) for c in ("r1", "r3", "r5")))
    if len(sub) >= 20:                                  # §2 반쪽
        for nm, part in (("전반", sub[sub.d < MID]), ("후반", sub[sub.d >= MID])):
            if len(part) == 0:
                continue
            print(f"    · {nm:<22}      " + " " * 30 +
                  " ".join(cell(stat(part, c), BASE[c]) for c in ("r1", "r3", "r5")))


print("\n  기준 = 전체 실적 이벤트 평균. 칸: 승률(표본) 대비%p 평균 · 구간 +1/+3/+5일")
print("  " + "─" * 100)
print(f"  {'(전체 기준)':<26} [{grade(len(df))}] EPS {BASE_SUR[0]:+.1f}% / 상회 {BASE_SUR[1]:>3}% ({BASE_SUR[2]:>3}) │ " +
      " ".join(cell(BASE[c], None) for c in ("r1", "r3", "r5")))

print("\n── ① 가설 A — 발표 직전 '연속 음봉'이면 서프라이즈가 나오나")
line("연속음봉 0일(양봉 마감)", df.streak == 0)
line("연속음봉 1일", df.streak == 1)
line("연속음봉 2일", df.streak == 2)
line("연속음봉 3일+", df.streak >= 3)
line("연속음봉 4일+", df.streak >= 4)

print("\n── ② 발표 전 2주 흐름 (10거래일 누적)")
line("많이 눌림 (-5%↓)", df.pre10 <= -5)
line("눌림 (-5~-2%)", (df.pre10 > -5) & (df.pre10 <= -2))
line("보합 (-2~+2%)", (df.pre10 > -2) & (df.pre10 < 2))
line("올림 (+2~+5%)", (df.pre10 >= 2) & (df.pre10 < 5))
line("많이 올림 (+5%↑)", df.pre10 >= 5)

print("\n── ③ 발표 전 1주 흐름 (5거래일 누적)")
line("많이 눌림 (-5%↓)", df.pre5 <= -5)
line("눌림 (-2~-5%)", (df.pre5 > -5) & (df.pre5 <= -2))
line("올림 (+2~+5%)", (df.pre5 >= 2) & (df.pre5 < 5))
line("많이 올림 (+5%↑)", df.pre5 >= 5)

print("\n── ④ '의도적으로 누른다'의 대리 변수 — 조용한 하락 (거래량 안 늘고 음봉)")
line("음봉 6일+ & 거래량 <1배", (df.downs >= 6) & (df.volq < 1))
line("음봉 6일+ & 거래량 1배+", (df.downs >= 6) & (df.volq >= 1))
line("10봉 중 음봉 7일+", df.downs >= 7)
line("10봉 중 음봉 3일-", df.downs <= 3)

print("\n── ⑤ 발표 전 흐름과 EPS 서프라이즈의 상관 (있으면 가설 A가 성립)")
sub = df.dropna(subset=["sur"])
for col, nm in (("pre5", "1주 수익률"), ("pre10", "2주 수익률"), ("streak", "연속음봉"), ("downs", "음봉일수")):
    if len(sub) >= 10:
        pr = float(np.corrcoef(sub[col], sub.sur)[0, 1])
        sp = float(sub[col].rank().corr(sub.sur.rank()))
        print(f"  {nm:<12} 피어슨 {pr:+.3f} · 스피어만 {sp:+.3f}")
print("  ※ ±0.1 미만이면 사실상 무관계다. 표본이 커도 상관이 0이면 가설은 기각된다.")

print("\n── ⑥ 반대 방향 확인 — 서프라이즈가 컸던 이벤트는 발표 전에 눌려 있었나")
if len(sub) >= 20:
    for nm, mask in (("서프라이즈 +10%↑", sub.sur >= 10),
                     ("서프라이즈 0~+10%", (sub.sur >= 0) & (sub.sur < 10)),
                     ("서프라이즈 마이너스", sub.sur < 0)):
        s = sub[mask]
        if len(s) == 0:
            print(f"  {nm:<20} 표본 없음"); continue
        print(f"  {nm:<20} [{grade(len(s))}] 발표 전 1주 {s.pre5.mean():+.2f}% · "
              f"2주 {s.pre10.mean():+.2f}% · 연속음봉 평균 {s.streak.mean():.2f}일 · "
              f"발표 후 +1일 {s.r1.mean():+.2f}%")

print("\n※ 채택 기준(방법론): 전체 대비 +%p · §2 전·후반 같은 방향 · 표본 15+(§5-1).")
print("  이 도구는 실험 전용이다. 뱃지·점수 반영은 사용자 승인 후에만.")
