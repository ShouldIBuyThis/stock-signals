#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
와인스타인 4단계 + '장기선 눌림 매수' 검증 (읽기 전용 · 로그만)

사용자 질문(2026-08-22):
  ① 스테이지 분석 + 오닐 CANSLIM 매매법은 추세인가 반등인가 — 그리고 승률은?
  ② "장기 빗각에서 하락할 때 매수하고 수익 나면 판다"는 확률이 괜찮은가?

두 질문은 같은 판 위에서만 비교가 된다. 그래서 한 도구에서 **같은 종목·같은 기간·
같은 승률 규칙**으로 두 진입을 나란히 잰다:
  B) 스테이지 2 돌파 매수 — 30주선 위로 올라서고 30주선이 상승 전환한 첫날 (추세)
  C) 장기선 눌림 매수     — 30주선이 상승 중인데 종가가 그 아래로 내려간 첫날 (반등)
B가 오닐·와인스타인이 말하는 자리이고, C가 사용자가 말한 자리다.

⚠ CANSLIM의 C·A·I(분기이익·연간이익·기관수급)는 우리가 수집하지 않는 데이터다.
   여기서 재는 것은 **차트 쪽 절반**뿐이다 — 그 사실을 결과에 같이 적는다.
⚠ 우리 원장 hist는 30행뿐이라 30주선(150봉)을 만들 수 없다. 야후에서 새로 받는다.
⚠ 아무 파일도 안 고친다. CI에서만 돈다(로컬은 야후가 프록시에 막힘).

사용: python tools/stage-lab.py [--years 3]
"""
import sys, json, os, argparse
import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, ".")
import main as M

ap = argparse.ArgumentParser()
ap.add_argument("--years", type=int, default=3)
ap.add_argument("--samples", default="backtest/ticker-record-samples.json")
args = ap.parse_args()

UNIV = sorted({tk for d in M.WATCHLIST.values() for tk in d} - set(M.LEVERAGED))
print(f"■ 와인스타인 4단계 · 장기선 눌림 검증 — {len(UNIV)}종목 · {args.years}년 (레버리지 ETF 제외)")

px = yf.download(UNIV, period=f"{args.years}y", auto_adjust=True,
                 progress=False, group_by="ticker", threads=True)

HS = (5, 10, 20)          # 추세 매매는 며칠짜리로 판단하면 안 된다(§6) — 길게 본다
STOP = -8.0               # 오닐 손절 규칙 7~8%. 아래쪽을 쓴다.

# ── 단계 판정 규칙 ───────────────────────────────────────────────────────
# MA30W = 30주 이동평균(주봉 종가). 기울기는 4주 전 대비 %.
#   2단계 = 종가 > MA30W & 기울기 > +0.5%      (상승 추세)
#   4단계 = 종가 < MA30W & 기울기 < -0.5%      (하락 추세)
#   1단계 = 기울기 평평(±0.5%) & 종가 <= MA30W (바닥 다지기)
#   3단계 = 기울기 평평(±0.5%) & 종가 >  MA30W (천장)
#   그 외(방향과 위치가 엇갈림) = 전환 중 → '기타'
FLAT = 0.5


def stage_of(c, ma, slope):
    if any(x is None or (isinstance(x, float) and np.isnan(x)) for x in (c, ma, slope)):
        return None
    if c > ma and slope > FLAT:
        return 2
    if c < ma and slope < -FLAT:
        return 4
    if abs(slope) <= FLAT:
        return 3 if c > ma else 1
    return 0                                   # 전환 중


rows, stage_days = [], []
for tk in UNIV:
    try:
        d = px[tk][["Open", "High", "Low", "Close", "Volume"]].dropna()
    except Exception:
        continue
    if len(d) < 200:
        continue
    C = d["Close"].values.astype(float)
    V = d["Volume"].values.astype(float)
    vma = pd.Series(V).rolling(20).mean().shift(1).values
    dates = [str(x.date()) for x in d.index]

    # 주봉 30주선 — 완성된 주만 쓴다(진행 중인 주를 쓰면 미래를 본다)
    wk = d["Close"].resample("W-FRI").last().dropna()
    if len(wk) < 40:
        continue
    wma = wk.rolling(30).mean()
    wslope = (wma / wma.shift(4) - 1) * 100
    wends = [pd.Timestamp(x).normalize() for x in wk.index]
    wma_v, wsl_v = wma.values, wslope.values

    # 각 일봉 → 그 날짜보다 먼저 끝난 마지막 주봉의 인덱스
    j, wj = -1, []
    for t in d.index:
        day = pd.Timestamp(t).normalize()
        while j + 1 < len(wends) and wends[j + 1] < day:
            j += 1
        wj.append(j)

    prev_stage, prev_above = None, None
    for i in range(1, len(C) - max(HS)):
        k = wj[i]
        if k is None or k < 0:
            continue
        ma, sl = wma_v[k], wsl_v[k]
        st = stage_of(C[i], ma, sl)
        if st is None:
            prev_stage, prev_above = None, None
            continue
        above = C[i] > ma
        stage_days.append({"tk": tk, "d": dates[i], "st": st,
                           "f": {h: (C[i + h] / C[i] - 1) * 100 for h in HS}})

        volx = float(V[i] / vma[i]) if vma[i] == vma[i] and vma[i] > 0 else float("nan")
        # 손절(-8%)을 적용한 결과도 같이 만든다. 종가 기준으로만 판정한다.
        def with_stop(h):
            for q in range(1, h + 1):
                r = (C[i + q] / C[i] - 1) * 100
                if r <= STOP:
                    return r
            return (C[i + h] / C[i] - 1) * 100

        base = {"tk": tk, "d": dates[i], "volx": volx, "slope": float(sl),
                "raw": {h: (C[i + h] / C[i] - 1) * 100 for h in HS},
                "stp": {h: with_stop(h) for h in HS}}

        # B) 2단계 돌파 — 어제까진 30주선 아래(또는 2단계 아님)였다가 오늘 올라섬
        if st == 2 and prev_above is False:
            rows.append(dict(base, kind="B"))
        # C) 장기선 눌림 — 30주선이 상승 중(기울기 +)인데 종가가 그 아래로 내려간 첫날
        if sl > FLAT and (not above) and prev_above is True:
            rows.append(dict(base, kind="C"))
        prev_stage, prev_above = st, above

SD = pd.DataFrame(stage_days)
DF = pd.DataFrame(rows)
if SD.empty or DF.empty:
    print("[ERROR] 표본을 못 모았다 — 야후 응답 확인")
    sys.exit(1)
DF = DF.sort_values("d").reset_index(drop=True)
MID = DF["d"].iloc[len(DF) // 2]
print(f"  일봉 {len(SD):,}개 · 종목 {SD.tk.nunique()}개 · {SD.d.min()} ~ {SD.d.max()} · 반쪽 기준 {MID}")


def grade(n):
    return "신뢰" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "일화" if n >= 5 else "불가"


def stat(vals):
    """승률 규칙은 화면·검증표와 같다 — ±1% 보합 제외."""
    a = [v for v in vals if v == v]
    dec = [v for v in a if abs(v) > 1]
    w = len([v for v in dec if v > 1])
    return {"n": len(a),
            "rate": round(w / len(dec) * 100) if dec else None,
            "avg": round(float(np.mean(a)), 2) if a else None}


def cell(s, ref=None):
    if s["rate"] is None:
        return f"  —({s['n']:>4})         "
    e = f"{s['rate']-ref['rate']:+d}".rjust(4) + "%p" if ref and ref["rate"] is not None else "     "
    return f"{s['rate']:>3}%({s['n']:>4}){e} {s['avg']:+.2f}%"


# ── ① 단계별 '그냥 그 자리에 있으면' ────────────────────────────────────
BASE = {h: stat(SD.f.map(lambda x, h=h: x[h])) for h in HS}
print("\n── ① 단계별 기본 성적 (그 단계에 있던 아무 날이나) · +5/+10/+20일")
print("  " + "─" * 78)
print(f"  {'(전체 = 기준선)':<20} [{grade(len(SD))}] " + " ".join(cell(BASE[h]) for h in HS))
LAB = {1: "1단계 바닥다지기", 2: "2단계 상승", 3: "3단계 천장", 4: "4단계 하락", 0: "전환 중"}
for st in (1, 2, 3, 4, 0):
    sub = SD[SD.st == st]
    if not len(sub):
        continue
    print(f"  {LAB[st]:<20} [{grade(len(sub))}] " +
          " ".join(cell(stat(sub.f.map(lambda x, h=h: x[h])), BASE[h]) for h in HS))
print("  → 와인스타인 주장('돈은 2단계에서 벌고 4단계에서 잃는다')이 실제로 나오나 확인하는 줄이다.")

# ── ② 두 진입 비교 — B(추세) vs C(반등) ─────────────────────────────────
print("\n── ② 진입 비교 — B 2단계 돌파(추세) vs C 장기선 눌림(반등)")
print("     칸: 승률(표본) 기준선대비 평균수익 · 손절 -8% 적용 결과도 같이")
KL = {"B": "B 2단계 돌파(추세)", "C": "C 장기선 눌림(반등)"}
for kind in ("B", "C"):
    sub = DF[DF.kind == kind]
    if not len(sub):
        print(f"  {KL[kind]:<24} 표본 없음"); continue
    print(f"  {KL[kind]:<24} [{grade(len(sub))}] " +
          " ".join(cell(stat(sub.raw.map(lambda x, h=h: x[h])), BASE[h]) for h in HS))
    print(f"  {'  └ 손절 -8% 적용':<24}      " +
          " ".join(cell(stat(sub.stp.map(lambda x, h=h: x[h])), BASE[h]) for h in HS))
    for nm, part in (("전반", sub[sub.d < MID]), ("후반", sub[sub.d >= MID])):
        if len(part):
            print(f"  {'  · ' + nm:<24}      " +
                  " ".join(cell(stat(part.raw.map(lambda x, h=h: x[h])), BASE[h]) for h in HS))

# ── ③ 조건을 붙이면 (거래량 · 기울기) ───────────────────────────────────
print("\n── ③ 조건을 붙이면 — 거래량 실린 돌파 / 기울기가 가파른 자리")
for kind in ("B", "C"):
    sub = DF[DF.kind == kind]
    for lab, mask in (("거래량 1.5배+", sub.volx >= 1.5),
                      ("거래량 보통", sub.volx < 1.5),
                      ("30주선 기울기 +2%↑", sub.slope >= 2)):
        s2 = sub[mask.fillna(False)]
        if len(s2) < 15:
            print(f"  {kind} · {lab:<20} 표본 {len(s2)}건 — 판단 보류"); continue
        print(f"  {kind} · {lab:<20} [{grade(len(s2))}] " +
              " ".join(cell(stat(s2.raw.map(lambda x, h=h: x[h])), BASE[h]) for h in HS))

# ── ④ 우리 신호는 어느 단계에서 나오나 ──────────────────────────────────
if os.path.exists(args.samples):
    smp = json.load(open(args.samples, encoding="utf-8")).get("samples") or []
    stmap = {(r["tk"], r["d"]): r["st"] for r in stage_days}
    print(f"\n── ④ 우리 신호는 어느 단계에서 뜨나 (백테스트 표본 {len(smp)}건과 대조)")
    KN = {"strong": "🟢 강한매수", "multi": "🔵 다중신호", "strict": "💡 강한다중"}
    for k in ("strong", "multi", "strict"):
        sel = [x for x in smp if x.get("k") == k]
        got = [(stmap.get((x["t"], x["d"])), x) for x in sel]
        got = [(st, x) for st, x in got if st is not None]
        if not got:
            print(f"  {KN[k]:<12} 대조 실패 — 날짜가 안 맞는다"); continue
        tot = len(got)
        parts = []
        for st in (1, 2, 3, 4, 0):
            g = [x for s, x in got if s == st]
            if not g:
                continue
            r3 = stat([x["r"].get("3") if isinstance(x["r"], dict) else None for x in g])
            parts.append(f"{LAB[st]} {len(g)}건({round(len(g)/tot*100)}%)"
                         f"{'' if r3['rate'] is None else ' +3일 ' + str(r3['rate']) + '%'}")
        print(f"  {KN[k]:<12} 대조 {tot}건 · " + " · ".join(parts))
    print("  → 우리 신호가 주로 어느 단계에서 나오는지가 '우리는 추세인가 반등인가'의 답이다.")
else:
    print(f"\n── ④ 건너뜀 — {args.samples} 없음 (백테스트 워크플로우를 먼저 돌릴 것)")

print("\n※ CANSLIM의 C·A·I(분기이익·연간이익·기관수급)는 우리가 수집하지 않는다.")
print("  여기서 잰 것은 차트 쪽 절반(N 신고가·L 상대강도·M 시장방향)뿐이다.")
print("  채택 기준(방법론): 기준선 대비 +%p · §2 전·후반 같은 방향 · 표본 15+(§5-1).")
print("  이 도구는 실험 전용이다. 산식 반영은 사용자 승인 후에만.")
