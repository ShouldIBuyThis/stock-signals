#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""코스닥 바닥권 추가 검증 — docs/2026-11-10-kosdaq-bottom.md (결과 전 고정 · 읽기 전용 · CI 전용)
사용: python tools/kosdaq-bottom-lab.py [--signals site-signals.json]"""
import sys, json, argparse
import numpy as np, pandas as pd, yfinance as yf
ap = argparse.ArgumentParser(); ap.add_argument("--signals", default=""); a = ap.parse_args()
BIG = [t + ".KQ" for t in ["247540", "086520", "196170", "028300", "263750", "293490", "145020", "041510", "035900", "058470", "039030", "214150",
                           "277810", "112040", "357780", "240810", "036930", "403870"]]
px = yf.download(sorted(BIG + ["^KQ11", "229200.KS"]), period="max", auto_adjust=True, progress=False, group_by="ticker", threads=True)
def col(t, c="Close"):
    try: s = px[t][c].dropna(); return s if len(s) else None
    except Exception: return None
e, el = col("229200.KS"), col("229200.KS", "Low")
df = pd.DataFrame({"e": e, "el": el}).dropna()
above, got = pd.DataFrame(index=df.index), []
for t in BIG:
    c = col(t)
    if c is None or len(c) < 60: continue
    c = c.reindex(df.index); above[t] = (c > c.rolling(20).mean()).astype(float).where(c.notna() & c.rolling(20).mean().notna()); got.append(t)
df["br"] = above.mean(axis=1)*100; df["brN"] = above.notna().sum(axis=1)
H = (1, 3, 5, 10)
for h in H:
    df[f"f{h}"] = (df.e.shift(-h)/df.e - 1)*100
    df[f"dd{h}"] = (df.el[::-1].rolling(h, min_periods=h).min()[::-1].shift(-1)/df.e - 1)*100     # 다음 날부터 h일 안 최저 저가
W = df[(df.brN >= 15)].dropna(subset=["f10"]).copy(); W["d"] = [str(x.date()) for x in W.index]
EXP0, MID, OLD_END = "2024-06-10", "2025-08-19", "2024-06-07"
print(f"■ 코스닥 바닥권 추가 검증 · 229200 {df.index[0].date()}~{df.index[-1].date()} · 대형주 받은 {len(got)}/18 · 15종목 이상 유효 날 {len(W)}일 ({W.d.min()}~{W.d.max()})")
print(f"  종목별 첫 자료일: " + " · ".join(f"{t.split('.')[0]} {col(t).index[0].date()}" for t in got))
SIG = {}
if a.signals:
    raw = json.load(open(a.signals)); SIG = {k: sorted({d for t, d in v if t == "229200.KS"}) for k, v in raw.items() if k in ("strongBuy", "rev", "multi")}
    print("  기존 사이트 신호(229200): " + " · ".join(f"{k} {len(v)}건 ({v[0] if v else '—'}~{v[-1] if v else '—'})" for k, v in SIG.items()))
def st(sub, h):
    a_ = sub[f"f{h}"].dropna(); dd = sub[f"dd{h}"].dropna()
    return (round(float((a_ > 0).mean()*100)) if len(a_) else None, round(float(a_.mean()), 2) if len(a_) else None, round(float(dd.mean()), 2) if len(dd) else None, len(a_))
def fmt(sub, ref=None):
    out = []
    for h in H:
        r, m, dd, n = st(sub, h)
        if r is None: out.append(f"+{h}일 —"); continue
        rr = st(ref, h)[0] if ref is not None else None
        out.append(f"+{h}일 {r}%{f'({r-rr:+d})' if rr is not None else ''} {m:+.2f}% 낙폭 {dd:+.2f}%")
    return " · ".join(out)
def episodes(mask_idx, all_idx):
    pos = {d: i for i, d in enumerate(all_idx)}; idx = sorted(pos[d] for d in mask_idx); ep, first = 0, []
    for k, i in enumerate(idx):
        if k == 0 or i - idx[k-1] > 2: ep += 1; first.append(all_idx[i])
    return ep, first
def period(name, P):
    print(f"\n━━ {name} · {P.d.min()}~{P.d.max()} · {len(P)}일 · 기준선 {fmt(P)}")
    for thr in (25, 30, 40):
        B = P[P.br < thr]; ep, first = episodes(list(B.index), list(P.index)); F = P.loc[first]
        tag = "핵심" if thr == 25 else "민감도"
        print(f"  [{tag}] 바닥권 < {thr}% : 서로 다른 날 {len(B)} · 에피소드 {ep}개 (평균 {len(B)/max(1, ep):.1f}일)")
        print(f"     모든 바닥권 날 : {fmt(B, P)}")
        print(f"     에피소드 첫날  : n{len(F)} · {fmt(F, P)}")
    return P
EXP = W[W.d >= EXP0]; OLD = W[W.d <= OLD_END]
period("탐색 구간(이미 본 구간)", EXP); period("  앞 반쪽", EXP[EXP.d < MID]); period("  뒤 반쪽", EXP[EXP.d >= MID])
if len(OLD) > 60: period("별도 기간(독립 · 아직 안 본 구간)", OLD)
else: print(f"\n━━ 별도 기간: 유효 날 {len(OLD)}일 — 대형주 15종목 이상인 과거 날이 부족해 판단 불가")
# 같은 바닥권 날, 아무 종목이나(대형주 각각 종가 진입)
print("\n■ 같은 바닥권(<25%) 날 · 대형주 아무 종목이나 산 경우 (종목·날짜 단위)")
for name, P in (("탐색", EXP), ("별도", OLD)):
    if len(P) < 60: continue
    days = P.index[P.br < 25]; rows = []; per = {}
    for t in got:
        c, lo = col(t).reindex(df.index), col(t, "Low").reindex(df.index)
        for h in (1, 3, 5, 10):
            pass
        f3 = (c.shift(-3)/c - 1)*100; f5 = (c.shift(-5)/c - 1)*100; f10 = (c.shift(-10)/c - 1)*100; f1 = (c.shift(-1)/c - 1)*100
        for d in days:
            if pd.notna(c.get(d)) and pd.notna(f10.get(d)): rows.append((t, f1[d], f3[d], f5[d], f10[d])); per[t] = per.get(t, 0) + 1
    R = pd.DataFrame(rows, columns=["t", "f1", "f3", "f5", "f10"])
    allr = []
    for t in got:
        c = col(t).reindex(P.index); allr.append(((c.shift(-3)/c - 1)*100).dropna())
    base3 = pd.concat(allr) if allr else pd.Series(dtype=float)
    if len(R): print(f"  {name}: n{len(R)}(날 {len(days)} · 종목 {R.t.nunique()}) · " + " · ".join(f"+{h}일 {round(float((R[f'f{h}'] > 0).mean()*100))}% {R[f'f{h}'].mean():+.2f}%" for h in (1, 3, 5, 10))
                 + f" | 같은 기간 대형주 아무 날 +3일 {round(float((base3 > 0).mean()*100))}% · 종목별 건수 " + ", ".join(f"{k.split('.')[0]} {v}" for k, v in sorted(per.items(), key=lambda x: -x[1])[:6]) + " …")
# 기존 신호 × 바닥권 — 신호 자체의 추가 예측력
if SIG:
    print("\n■ 기존 사이트 신호(229200) × 바닥권 — 신호 자료가 있는 기간만")
    for thr in (25, 30, 40):
        print(f"  바닥권 < {thr}%")
        for k, ds in SIG.items():
            idx = [pd.Timestamp(d) for d in ds if pd.Timestamp(d) in W.index]
            if not idx: print(f"    {k}: 0건"); continue
            S = W.loc[idx]; lo_, hi_ = S.d.min(), S.d.max(); P = W[(W.d >= lo_) & (W.d <= hi_)]
            inB, outB = S[S.br < thr], S[S.br >= thr]; Bno = P[(P.br < thr) & ~P.index.isin(idx)]
            mid = P.d.iloc[len(P)//2]
            half = lambda X: " / ".join(f"{st(X[X.d < mid], 3)[0]}%(n{st(X[X.d < mid], 3)[3]})·{st(X[X.d >= mid], 3)[0]}%(n{st(X[X.d >= mid], 3)[3]})" for _ in [0])
            ep, _ = episodes(list(inB.index), list(P.index))
            print(f"    {k:<9} 전체 n{len(S)} · {fmt(S)}")
            print(f"      바닥권 안 n{len(inB)}(서로 다른 날 {inB.d.nunique()} · 에피소드 {ep}) · {fmt(inB, S)} | 반쪽 +3일 {half(inB)}")
            print(f"      바닥권 밖 n{len(outB)} · {fmt(outB, S)}")
            print(f"      같은 바닥권 신호 없는 날 n{len(Bno)} · {fmt(Bno)} | 반쪽 +3일 {half(Bno)}")
print("\n※ 바닥권 25% 국면 판정·신호 추가 예측력 판정은 docs/2026-11-10-kosdaq-bottom.md 규칙대로. 화면 반영은 사용자 확인 뒤.")
