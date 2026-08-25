#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
반전 패턴 6종 승률 — 넥라인 돌파 진입 · 패턴 높이로 목표/손절 (읽기 전용 · 로그만)

사용자 요청(2026-08-25): 패턴 매매법을 적용한 승률 산식 시뮬레이션.
사용자가 짚은 대로 **패턴의 기준값은 지지선·저항선(넥라인)과 패턴 높이**로 만든다.

  쌍바닥 / 역헤드앤숄더 / 하락 쐐기   → 상승 반전 (매수)
  쌍봉  / 헤드앤숄더   / 상승 쐐기   → 하락 반전 (우리 신호와 겹치면 나쁜가)

진입·목표·손절 (그림의 정의 그대로)
  진입 = 넥라인(직전 고점/저점)을 종가로 0.5% 넘어선 첫날
  높이 = |넥라인 − 패턴의 머리(최저/최고)|
  목표 = 넥라인 ± 높이
  손절 = 패턴의 머리 (쌍바닥이면 두 바닥 중 낮은 쪽)

⚠ 승률만 보면 안 된다. 패턴 매매는 **목표가 먼저냐 손절이 먼저냐**가 본질이다.
   그래서 고정 구간(+5/+10/+20일) 성적과 **목표/손절 선착 판정**을 같이 낸다.
⚠ 리페인트 금지 — 스윙 피벗은 뒤로 CONFIRM봉이 지나야 확정된다. 확정된 피벗만 쓴다.
   (하모닉 검증과 같은 규칙. 이걸 안 지키면 승률이 가짜로 오른다.)
⚠ 아무 파일도 안 고친다. CI에서만 돈다.

사용: python tools/pattern-lab.py [--years 3] [--confirm 3]
"""
import sys, argparse
import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, ".")
import main as M

ap = argparse.ArgumentParser()
ap.add_argument("--years", type=int, default=3)
ap.add_argument("--confirm", type=int, default=3)
args = ap.parse_args()
K = args.confirm

UNIV = sorted({tk for d in M.WATCHLIST.values() for tk in d} - set(M.LEVERAGED))
print(f"■ 반전 패턴 6종 — {len(UNIV)}종목 · {args.years}년 · 피벗 확정 {K}봉(리페인트 금지)")

px = yf.download(UNIV, period=f"{args.years}y", auto_adjust=True,
                 progress=False, group_by="ticker", threads=True)

HS = (5, 10, 20)
TOL = 0.04            # '두 바닥이 비슷하다'의 허용 오차 (가격 대비 4%)
MAXW = 90             # 패턴 완성 후 넥라인 돌파를 기다리는 최대 봉 수
HORIZON = 40          # 목표/손절 선착 판정을 보는 최대 봉 수


def pivots(H, L, k):
    out = []
    for i in range(k, len(H) - k):
        if H[i] == max(H[i - k:i + k + 1]):
            out.append((i, float(H[i]), "H", i + k))
        elif L[i] == min(L[i - k:i + k + 1]):
            out.append((i, float(L[i]), "L", i + k))
    z = []
    for p in out:
        if z and z[-1][2] == p[2]:
            if (p[2] == "H" and p[1] > z[-1][1]) or (p[2] == "L" and p[1] < z[-1][1]):
                z[-1] = p
        else:
            z.append(p)
    return z


rows, base_rows = [], []
for tk in UNIV:
    try:
        d = px[tk][["High", "Low", "Close"]].dropna()
    except Exception:
        continue
    if len(d) < 250:
        continue
    H, L, C = (d[c].values.astype(float) for c in ("High", "Low", "Close"))
    dates = [str(x.date()) for x in d.index]
    Z = pivots(H, L, K)
    if len(Z) < 8:
        continue
    for i in range(K + 5, len(C) - max(HS)):
        base_rows.append({h: (C[i + h] / C[i] - 1) * 100 for h in HS})

    def scan(start_idx, neck, head, up, name, conf):
        """넥라인 돌파일을 찾아 한 건 기록한다. up=True면 상승 반전(매수)."""
        lim = min(len(C) - max(HS), start_idx + MAXW)
        for i in range(max(conf + 1, K + 5), lim):
            broke = C[i] > neck * 1.005 if up else C[i] < neck * 0.995
            if not broke:
                continue
            height = abs(neck - head)
            if height <= 0 or height / neck < 0.03:      # 3% 미만은 잡음
                return
            tgt = neck + height if up else neck - height
            stop = head
            entry = C[i]
            hit = None
            for q in range(i + 1, min(i + 1 + HORIZON, len(C))):
                if up:
                    if L[q] <= stop: hit = "손절"; break
                    if H[q] >= tgt:  hit = "목표"; break
                else:
                    if H[q] >= stop: hit = "손절"; break
                    if L[q] <= tgt:  hit = "목표"; break
            rr = abs(tgt - entry) / max(abs(entry - stop), 1e-9)
            rows.append({"tk": tk, "d": dates[i], "pat": name, "up": up, "hit": hit or "미결",
                         "rr": rr, "r": {h: (C[i + h] / C[i] - 1) * 100 for h in HS}})
            return

    for c in range(3, len(Z)):
        w = Z[c - 3:c + 1]
        kinds = "".join(x[2] for x in w)
        (i0, v0, _, _), (i1, v1, _, _), (i2, v2, _, _), (i3, v3, _, cf3) = w

        # ── 쌍바닥 : L H L  (두 바닥이 비슷, 넥라인 = 가운데 고점) ─────
        if kinds[:3] == "LHL" and abs(v2 - v0) / max(v0, 1e-9) < TOL and v1 > max(v0, v2) * 1.03:
            scan(i2, v1, min(v0, v2), True, "쌍바닥", w[2][3])
        # ── 쌍봉 : H L H ────────────────────────────────────────────
        if kinds[:3] == "HLH" and abs(v2 - v0) / max(v0, 1e-9) < TOL and v1 < min(v0, v2) * 0.97:
            scan(i2, v1, max(v0, v2), False, "쌍봉", w[2][3])
        # ── 역헤드앤숄더 : L H L H(넥) 에서 가운데 저점이 가장 낮음 ──
        if kinds == "LHLH" and v2 < v0 * 0.97:
            scan(i3, max(v1, v3), v2, True, "역헤드앤숄더", cf3)
        # ── 헤드앤숄더 : H L H L 에서 가운데 고점이 가장 높음 ────────
        if kinds == "HLHL" and v2 > v0 * 1.03:
            scan(i3, min(v1, v3), v2, False, "헤드앤숄더", cf3)
        # ── 하락 쐐기 : 고점·저점 모두 낮아지는데 폭이 줄어든다 ───────
        if kinds == "HLHL" and v2 < v0 and v3 < v1 and (v0 - v1) > (v2 - v3) > 0:
            scan(i3, v2, v3, True, "하락 쐐기", cf3)
        # ── 상승 쐐기 : 고점·저점 모두 높아지는데 폭이 줄어든다 ───────
        if kinds == "LHLH" and v2 > v0 and v3 > v1 and (v1 - v0) > (v3 - v2) > 0:
            scan(i3, v2, v3, False, "상승 쐐기", cf3)

BASE = pd.DataFrame(base_rows)
DF = pd.DataFrame(rows)
if BASE.empty or DF.empty:
    print(f"[ERROR] 표본을 못 모았다 — 기준 {len(BASE)} · 패턴 {len(DF)}")
    sys.exit(1)
DF = DF.sort_values("d").reset_index(drop=True)
MID = DF["d"].iloc[len(DF) // 2]
print(f"  일봉 기준선 {len(BASE):,}개 · 패턴 진입 {len(DF)}건 · 반쪽 기준 {MID}")


def grade(n):
    return "신뢰" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "일화" if n >= 5 else "불가"


def stat(vals):
    a = [v for v in vals if v is not None and v == v]
    dec = [v for v in a if abs(v) > 1]
    w = len([v for v in dec if v > 1])
    return {"n": len(a), "rate": round(w / len(dec) * 100) if dec else None,
            "avg": round(float(np.mean(a)), 2) if a else None}


B = {h: stat(BASE[h]) for h in HS}


def cell(s, ref=None):
    if s["rate"] is None:
        return f"  —({s['n']:>4})         "
    e = f"{s['rate']-ref['rate']:+d}".rjust(4) + "%p" if ref and ref["rate"] is not None else "     "
    return f"{s['rate']:>3}%({s['n']:>4}){e} {s['avg']:+.2f}%"


print("\n── ① 넥라인 돌파 진입 후 고정 구간 성적 · +5/+10/+20일")
print("     ※ 하락 반전(쌍봉·헤드앤숄더·상승 쐐기)은 **승률이 기준선보다 낮아야** 패턴이 맞는 것")
print("  " + "─" * 74)
print(f"  {'(아무 날이나 = 기준선)':<20} [{grade(len(BASE))}] " + " ".join(cell(B[h]) for h in HS))
ORDER = ["쌍바닥", "역헤드앤숄더", "하락 쐐기", "쌍봉", "헤드앤숄더", "상승 쐐기"]
for nm in ORDER:
    sub = DF[DF.pat == nm]
    if not len(sub):
        print(f"  {nm:<20} 0건"); continue
    print(f"  {nm:<20} [{grade(len(sub))}] " +
          " ".join(cell(stat(sub.r.map(lambda x, h=h: x[h])), B[h]) for h in HS))
    if len(sub) >= 30:
        for lab, part in (("전반", sub[sub.d < MID]), ("후반", sub[sub.d >= MID])):
            if len(part) >= 5:
                print(f"    · {lab:<16} " +
                      " ".join(cell(stat(part.r.map(lambda x, h=h: x[h])), B[h]) for h in HS))

print("\n── ② 목표 vs 손절, 어느 쪽이 먼저 오나 (패턴 매매의 본질)")
print(f"     목표 = 넥라인 ± 패턴 높이 · 손절 = 패턴의 머리 · {HORIZON}봉 안에서 판정")
for nm in ORDER:
    sub = DF[DF.pat == nm]
    if len(sub) < 5:
        continue
    tot = len(sub)
    t = int((sub.hit == "목표").sum()); s_ = int((sub.hit == "손절").sum()); u = int((sub.hit == "미결").sum())
    dec = t + s_
    win = round(t / dec * 100) if dec else None
    rr = round(float(sub.rr.mean()), 2)
    # 기대값 = 목표선착률 × R − 손절선착률 × 1 (손절폭을 1로 놓은 값)
    ev = (t / dec * rr - s_ / dec) if dec else None
    print(f"  {nm:<20} [{grade(tot)}] 목표 {t:>3} · 손절 {s_:>3} · 미결 {u:>3} · "
          f"목표선착 {('—' if win is None else str(win)+'%')} · 평균 손익비 {rr:.2f} · "
          f"기대값 {('—' if ev is None else f'{ev:+.2f}R')}")
print("  ※ 기대값이 0보다 커야 쓸 수 있다. 손절폭을 1로 놓고 계산한 값이다.")
print("    목표선착률이 50%를 밑돌아도 손익비가 크면 기대값은 플러스가 될 수 있다 —")
print("    반대로 승률이 높아도 손익비가 1 미만이면 결국 잃는다(§6과 같은 이야기).")

print("\n※ 채택 기준(방법론): 기준선 대비 +%p · §2 전·후반 같은 방향 · 표본 15+(§5-1).")
print("  캔들 16종·하모닉 4종이 이미 같은 문턱에서 전부 기각됐다 — 사전 확률은 낮다.")
print("  이 도구는 실험 전용이다. 화면 반영은 사용자 승인 후에만.")
