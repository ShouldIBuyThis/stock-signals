#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
장 초반 30~60분의 '기운'이 그날 종가를 예고하나 (읽기 전용 · 로그만)

사용자 제안(2026-08-22): "장 시작 30분~1시간 동안 기운을 느끼는 게 중요하다.
그 시간에 그날 힘의 방향이 거의 결정되고, 종가는 결국 그 방향으로 결정된다.
장의 힘이 좋은 날만 단타해야 한다. → 나스닥을 한국시간 23:00·23:30에 갱신해서
시간봉을 평가하는 기능을 넣으면 어떤가."

기능을 만들기 전에 전제부터 잰다. 세 가지를 따로 본다:
  ① 장 초반 수익률이 **남은 시간**을 예고하나 (초반과 종가가 같이 움직이는 건
     당연하다 — 초반이 이미 종가의 일부다. 그래서 '초반 이후 구간'만 따로 본다)
  ② 초반 방향과 종가 방향이 같은 비율은 얼마나 되나
  ③ **초반이 강한 날에 우리 신호가 더 잘 맞나** — 이게 실제로 쓸 수 있는 유일한 형태다
     (우리는 일봉 종가 시스템이라 장중에 새 신호를 내지 않는다)

⚠ 야후 60분봉은 730일까지만 준다. 30분봉은 60일뿐이라 60분봉을 주로 쓴다.
⚠ 아무 파일도 안 고친다. CI에서만 돈다.

사용: python tools/openrange-lab.py [--samples backtest/ticker-record-samples.json]
"""
import sys, json, os, argparse
import numpy as np
import pandas as pd
import yfinance as yf

ap = argparse.ArgumentParser()
ap.add_argument("--ticker", default="QQQ")
ap.add_argument("--samples", default="backtest/ticker-record-samples.json")
args = ap.parse_args()

print(f"■ 장 초반 기운 검증 — {args.ticker} 60분봉 (야후 상한 730일)")
h = yf.Ticker(args.ticker).history(period="730d", interval="60m", auto_adjust=True)
if h is None or h.empty:
    print("[ERROR] 60분봉을 못 받았다"); sys.exit(1)
try:
    h.index = h.index.tz_convert("America/New_York")
except Exception:
    pass

days = {}
for ts, r in h.iterrows():
    days.setdefault(str(ts.date()), []).append((ts, float(r["Close"]), float(r["Open"]), float(r["Volume"])))

rows = []
for d, bars in sorted(days.items()):
    bars.sort(key=lambda x: x[0])
    if len(bars) < 4:                       # 반장(조기 마감)은 뺀다
        continue
    op = bars[0][2]                          # 시가 (9:30)
    c1 = bars[0][1]                          # 첫 60분 종가 (10:30)
    c2 = bars[1][1] if len(bars) > 1 else None   # 두 번째 봉 종가 (11:30)
    cl = bars[-1][1]                         # 종가
    if not op or not c1 or not cl:
        continue
    rows.append({
        "d": d,
        "op1": (c1 / op - 1) * 100,          # 장 초반 1시간 등락
        "op2": (c2 / op - 1) * 100 if c2 else np.nan,   # 초반 2시간
        "rest": (cl / c1 - 1) * 100,         # 초반 이후 ~ 종가
        "day": (cl / op - 1) * 100,          # 시가 대비 종가
        "vol1": bars[0][3],
    })
df = pd.DataFrame(rows).dropna(subset=["op1", "rest"]).sort_values("d").reset_index(drop=True)
if df.empty:
    print("[ERROR] 일자별로 정리하지 못했다"); sys.exit(1)
vm = df.vol1.rolling(20).mean().shift(1)
df["volx"] = df.vol1 / vm
MID = df["d"].iloc[len(df) // 2]
print(f"  거래일 {len(df)}일 · {df.d.min()} ~ {df.d.max()} · 반쪽 기준 {MID}")


def grade(n):
    return "신뢰" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "일화" if n >= 5 else "불가"


def stat(a):
    a = [v for v in a if v == v]
    dec = [v for v in a if abs(v) > 0.3]      # 지수는 변동폭이 작아 보합폭을 ±0.3%로 둔다
    w = len([v for v in dec if v > 0.3])
    return {"n": len(a), "rate": round(w / len(dec) * 100) if dec else None,
            "avg": round(float(np.mean(a)), 2) if a else None}


REST = stat(df.rest)
print(f"\n── ① 장 초반 1시간 → **그 이후 종가까지** (초반은 빼고 잰다)")
print(f"  {'(전체 = 기준선)':<22} [{grade(len(df))}] 남은 시간 상승 {REST['rate']}%({REST['n']}) 평균 {REST['avg']:+.2f}%")


def line(label, mask):
    sub = df[mask]
    if len(sub) < 10:
        print(f"  {label:<22} 표본 {len(sub)}일 — 판단 보류"); return
    s = stat(sub.rest)
    e = "" if s["rate"] is None or REST["rate"] is None else f" ({s['rate']-REST['rate']:+d}%p)"
    same = (np.sign(sub.op1) == np.sign(sub.day)).mean() * 100
    print(f"  {label:<22} [{grade(len(sub))}] 남은 시간 상승 {s['rate']}%({s['n']}){e} "
          f"평균 {s['avg']:+.2f}% · 초반↔종가 방향 일치 {same:.0f}%")
    if len(sub) >= 30:
        for nm, part in (("전반", sub[sub.d < MID]), ("후반", sub[sub.d >= MID])):
            if len(part) >= 5:
                q = stat(part.rest)
                print(f"    · {nm:<18} {q['rate']}%({q['n']}) 평균 {q['avg']:+.2f}%")


line("초반 +1% 이상", df.op1 >= 1)
line("초반 +0.3~1%", (df.op1 >= 0.3) & (df.op1 < 1))
line("초반 보합 ±0.3%", df.op1.abs() < 0.3)
line("초반 -0.3~-1%", (df.op1 <= -0.3) & (df.op1 > -1))
line("초반 -1% 이하", df.op1 <= -1)
line("초반 강세 + 거래량 1.5배", (df.op1 >= 0.3) & (df.volx >= 1.5))

print("\n── ② 초반 방향이 종가 방향과 같은가 (사용자 주장의 핵심)")
for lab, mask in (("초반 상승(+0.3%↑)", df.op1 >= 0.3),
                  ("초반 하락(-0.3%↓)", df.op1 <= -0.3)):
    sub = df[mask]
    if not len(sub):
        continue
    same = (np.sign(sub.op1) == np.sign(sub.day)).mean() * 100
    keep = (np.sign(sub.op1) == np.sign(sub.rest)).mean() * 100
    print(f"  {lab:<22} {len(sub)}일 · 시가대비 종가 방향 일치 {same:.0f}% · "
          f"**초반 이후에도 같은 방향** {keep:.0f}%")
print("  → 앞의 '일치'는 초반이 종가에 이미 포함돼 있어 높게 나온다. 실제로 쓸 수 있는 건 뒤 숫자다.")

# ── ③ 초반이 강한 날에 우리 신호가 더 잘 맞나 ───────────────────────────
if os.path.exists(args.samples):
    smp = json.load(open(args.samples, encoding="utf-8")).get("samples") or []
    op1 = dict(zip(df.d, df.op1))
    print(f"\n── ③ '장 힘이 좋은 날'에만 매매하면 우리 신호 승률이 오르나 (표본 {len(smp)}건)")
    KN = {"strong": "🟢 강한매수", "multi": "🔵 다중신호", "strict": "💡 강한다중"}

    def sig_stat(rows_, h):
        a = [x["r"].get(str(h), x["r"].get(h)) for x in rows_]
        a = [v for v in a if v is not None]
        dec = [v for v in a if abs(v) > 1]
        w = len([v for v in dec if v > 1])
        return {"n": len(a), "rate": round(w / len(dec) * 100) if dec else None,
                "avg": round(float(np.mean(a)), 2) if a else None}

    for k in ("strong", "multi", "strict"):
        sel = [x for x in smp if x.get("k") == k and x["d"] in op1]
        if len(sel) < 20:
            print(f"  {KN[k]:<12} 대조 {len(sel)}건 — 판단 보류"); continue
        base = {h: sig_stat(sel, h) for h in (1, 3, 5)}
        print(f"  {KN[k]:<12} 전체 " + " ".join(
            f"+{h}일 {base[h]['rate']}%({base[h]['n']})" for h in (1, 3, 5)))
        for lab, pred in (("  └ 그날 초반 강세(+0.3%↑)", lambda v: v >= 0.3),
                          ("  └ 그날 초반 약세(-0.3%↓)", lambda v: v <= -0.3)):
            g = [x for x in sel if pred(op1[x["d"]])]
            if len(g) < 15:
                print(f"  {lab:<24} {len(g)}건 — 판단 보류"); continue
            out = []
            for h in (1, 3, 5):
                s = sig_stat(g, h)
                e = "" if s["rate"] is None or base[h]["rate"] is None else f"({s['rate']-base[h]['rate']:+d}%p)"
                out.append(f"+{h}일 {s['rate']}%({s['n']}){e}")
            print(f"  {lab:<24} " + " ".join(out))
    print("  ⚠ 우리 신호는 **그날 종가 확정 후** 나온다. 위 대조는 '신호 당일의 장 초반'이므로")
    print("    실제로 쓰려면 '전날 신호 + 다음날 장 초반 확인 후 진입' 형태로 다시 재야 한다.")
else:
    print(f"\n── ③ 건너뜀 — {args.samples} 없음")

print("\n※ 이 도구는 전제 검증용이다. 기능(장중 갱신)을 만들지 말지는 위 숫자로 정한다.")
print("  GitHub Actions 스케줄은 80~225분 지연·누락 이력이 있다(2026-08-11~13 KR 3일 연속 0건).")
print("  '장 시작 30분 뒤 정확히' 돌아야 하는 기능에는 구조적으로 안 맞는다는 점도 같이 본다.")
