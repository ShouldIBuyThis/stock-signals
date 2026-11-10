#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
국장 전용 시장 국면 — docs/2026-11-10-kr-regime.md (결과 전 고정 · 읽기 전용 · 로그만 · CI 전용)
나스닥 전용 등급(tools/qqq-method-lab.py)의 '구조'만 빌리고 문턱은 국장 자기 분포로 정한다(절대값 복사 금지).
사용: python tools/kr-regime-lab.py [--years 3] [--signals site-signals.json]
"""
import sys, json, argparse
import numpy as np
import pandas as pd
import yfinance as yf

ap = argparse.ArgumentParser()
ap.add_argument("--years", type=int, default=3)
ap.add_argument("--signals", default="")
args = ap.parse_args()

KOSPI_BIG = ["005930", "000660", "373220", "207940", "005380", "000270", "068270", "005490", "035420", "105560", "055550", "012330", "028260",
             "006400", "051910", "035720", "003670", "066570", "086790", "032830", "011200", "015760", "033780", "017670", "096770", "034730",
             "003550", "018260", "009150", "010130"]
KOSDAQ_BIG = ["247540", "086520", "196170", "028300", "263750", "293490", "145020", "041510", "035900", "058470", "039030", "214150",
              "277810", "112040", "357780", "240810", "036930", "403870"]
PAIRS = [("코스피", "^KS11", "069500.KS", [t + ".KS" for t in KOSPI_BIG]), ("코스닥", "^KQ11", "229200.KS", [t + ".KQ" for t in KOSDAQ_BIG])]
VOLS = ["^VKOSPI", "VKOSPI.KS", "^KSVKOSPI"]
need = sorted({p[1] for p in PAIRS} | {p[2] for p in PAIRS} | {t for p in PAIRS for t in p[3]} | set(VOLS) | {"^VXN"})
print(f"■ 국장 전용 시장 국면 연구 · {args.years}년 · 받을 종목 {len(need)}개")
px = yf.download(need, period=f"{args.years}y", auto_adjust=True, progress=False, group_by="ticker", threads=True)

def col(tk, c="Close"):
    try:
        s = px[tk][c].dropna(); return s if len(s) else None
    except Exception:
        return None

vk, vkName = None, None
for v in VOLS:
    s = col(v)
    if s is not None and len(s) >= 500: vk, vkName = s, v; break
print(f"  VKOSPI: {'있음 ' + vkName + f' {len(vk)}일' if vk is not None else '야후에 없음(또는 500일 미만) → 실현 변동성만 쓴다'} · " + " · ".join(f"{v}={len(col(v)) if col(v) is not None else 0}" for v in VOLS))
vxn = col("^VXN")

SIGS = {}
if args.signals:
    try:
        raw = json.load(open(args.signals)); SIGS = {k: [tuple(x) for x in v] for k, v in raw.items()}
        print("  기존 사이트 신호: " + " · ".join(f"{k} {sum(1 for t, d in v if t in ('069500.KS', '229200.KS'))}건(국장)" for k, v in SIGS.items()))
    except Exception as e:
        print(f"  기존 사이트 신호를 못 읽었다: {e}")

def pct_rank_prev(s, w=250):
    """그날 값이 '직전 w일' 분포에서 몇 번째 백분위인가(그날 이전 값만)."""
    return s.rolling(w + 1, min_periods=120).apply(lambda a: (a[:-1] < a[-1]).mean() * 100, raw=True)

def grade(n): return "신뢰" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "일화" if n >= 5 else "불가"
HS = (1, 3, 5, 10)
allpass, cells = [], 0
for name, idx, etf, big in PAIRS:
    ic, ec = col(idx), col(etf)
    if ic is None or ec is None:
        print(f"\n[{name}] 지수/ETF를 못 받았다 — 건너뜀"); continue
    df = pd.DataFrame({"c": ic}).join(pd.DataFrame({"e": ec}), how="inner")
    d_ = df.c.diff(); g = d_.clip(lower=0).ewm(alpha=1/14, min_periods=14).mean(); l = (-d_.clip(upper=0)).ewm(alpha=1/14, min_periods=14).mean()
    df["rsi"] = 100 - 100/(1 + g/l)
    ma20, sd20 = df.c.rolling(20).mean(), df.c.rolling(20).std()
    df["ma20"] = ma20; df["bb"] = (df.c - (ma20 - 2*sd20))/(4*sd20)*100
    df["chg"] = df.c.pct_change()*100; df["ret5"] = (df.c/df.c.shift(5) - 1)*100
    df["dn1"] = df.chg < 0; df["dn2"] = df.dn1 & df.dn1.shift(1, fill_value=False); df["dn3"] = df.dn2 & df.dn1.shift(2, fill_value=False)
    sd60 = df.chg.rolling(60).std().shift(1)
    df["crash"] = df.chg <= -2*sd60
    df["crash5"] = df.ret5 <= df.ret5.rolling(250, min_periods=120).quantile(0.10).shift(1)
    dd = (df.c/df.c.rolling(60).max() - 1)*100
    df["ddDeep"] = dd <= dd.rolling(250, min_periods=120).quantile(0.20).shift(1)
    rv = df.chg.rolling(20).std(); df["rvP"] = pct_rank_prev(rv); df["rvDown"] = rv < rv.shift(1)
    if vk is not None:
        v = vk.reindex(df.index).ffill(); df["vk"] = v; df["vkP"] = pct_rank_prev(v); df["vkDown"] = v < v.shift(1); df["vkHot"] = v >= v.rolling(20).mean().shift(1)*1.15
    else:
        df["vk"] = np.nan; df["vkP"] = np.nan; df["vkDown"] = False; df["vkHot"] = False
    if vxn is not None:
        x = vxn.reindex(df.index).ffill(); df["vxnCopy"] = (x >= 28) & (x < x.shift(1))
    else:
        df["vxnCopy"] = False
    above = pd.DataFrame(index=df.index); got = 0
    for tk in big:
        c = col(tk)
        if c is None or len(c) < 120: continue
        c = c.reindex(df.index); above[tk] = (c > c.rolling(20).mean()).astype(float).where(c.notna()); got += 1
    df["br"] = above.mean(axis=1)*100; df["brN"] = above.notna().sum(axis=1)
    for h in HS: df[f"f{h}"] = (df.e.shift(-h)/df.e - 1)*100
    W = df.dropna(subset=["rsi", "f10", "rvP"]).copy(); W = W[W.brN >= 15]
    W["d"] = [str(x.date()) for x in W.index]; MID = W.d.iloc[len(W)//2]
    volHi = (W.vkP >= 80) if vk is not None else (W.rvP >= 80)
    volTurn = ((W.vkP >= 80) & W.vkDown) | ((W.rvP >= 80) & W.rvDown)
    volDown = (W.vkDown if vk is not None else W.rvDown)
    strong = [W.dn3, volTurn, (W.br < 30) & volDown]
    K1 = strong[0] | strong[1] | strong[2]
    M = [("2일 연속 하락", W.dn2), ("3일 연속 하락", W.dn3), ("급락(당일 ≤ −2σ)", W.crash), ("5일 급락(10백분위↓)", W.crash5),
         ("RSI ≤ 35", W.rsi <= 35), ("볼린저 %B ≤ 20", W.bb <= 20), ("60일 낙폭 깊음(80백분위)", W.ddDeep),
         ("바닥권 < 30%", W.br < 30), ("바닥권 < 25%", W.br < 25), ("바닥권 < 40%", W.br < 40),
         ("실현변동성 80백분위 & 꺾임", (W.rvP >= 80) & W.rvDown), ("VKOSPI 80백분위", W.vkP >= 80), ("VKOSPI 80백분위 & 꺾임", (W.vkP >= 80) & W.vkDown),
         ("VKOSPI 20일평균×1.15 & 꺾임", W.vkHot & W.vkDown),
         ("K1 3일하락∪변동성꺾임∪(바닥권&변동성↓)", K1), ("K2 K1 ∪ 2일 하락", K1 | W.dn2), ("K3 강한 축 2개 이상", sum(s.astype(int) for s in strong) >= 2),
         ("대조군: VXN≥28 & 꺾임 그대로 복사", W.vxnCopy)]
    def st(sub, h):
        a = sub[f"f{h}"].dropna(); return {"n": len(a), "r": round(float((a > 0).mean()*100)) if len(a) else None, "a": round(float(a.mean()), 2) if len(a) else None}
    B = {h: st(W, h) for h in HS}
    cellf = lambda s, ref=None: "  —      " if s["r"] is None else f"{s['r']:>3}%" + (f"({s['r']-ref['r']:+d})" if ref else "     ") + f" {s['a']:+.2f}%"
    print(f"\n━━ {name} ({idx} 지표 · {etf} 수익) · 유효 {len(W)}일 · {W.d.min()}~{W.d.max()} · 반쪽 기준 {MID} · 대형주 {got}/{len(big)}종목 · 바닥권<30% 날 {int((W.br < 30).sum())}일")
    print(f"  {'기준선(아무 날)':<34} [{grade(len(W))}] " + " ".join(cellf(B[h]) for h in HS) + "   (+1/+3/+5/+10일 상승비율(대비%p) 평균)")
    for nm, mask in M:
        m = mask.fillna(False).astype(bool); sub = W[m]; cells += 1
        if len(sub) < 5: print(f"  {nm:<34} 표본 {len(sub)}건 — 판단 불가"); continue
        f, b = sub[sub.d < MID], sub[sub.d >= MID]; s3, f3, b3 = st(sub, 3), st(f, 3), st(b, 3)
        ok = len(sub) >= 15 and s3["r"] - B[3]["r"] >= 5 and f3["r"] is not None and b3["r"] is not None and f3["r"] > B[3]["r"] and b3["r"] > B[3]["r"]
        if ok: allpass.append(f"{name} · {nm} ({len(sub)}건 · +3일 {s3['r']-B[3]['r']:+d}%p)")
        print(f"  {'✅' if ok else '  '}{nm:<32} [{grade(len(sub))}] " + " ".join(cellf(st(sub, h), B[h]) for h in HS) + f" | n{len(sub)} · 전반 +3일 {f3['r']}%(n{f3['n']}) · 후반 {b3['r']}%(n{b3['n']})")
    # ── 기존 국장 신호가 국면으로 나아지는가 ──
    if SIGS:
        print(f"  ▸ 기존 사이트 신호({etf})를 국장 국면으로 나눔 — +1/+3/+5일 상승비율 · 평균 (전체 대비 %p)")
        for k, lst in SIGS.items():
            ds = sorted({d for t, d in lst if t == etf}); idxs = [pd.Timestamp(d) for d in ds if pd.Timestamp(d) in W.index]
            if not idxs: print(f"    {k:<10} 이 기간 신호 0건"); continue
            S = W.loc[idxs]; base_s = {h: st(S, h) for h in (1, 3, 5)}
            row = f"    {k:<10} 전체 n{len(S)} " + " ".join(f"{base_s[h]['r']}%" for h in (1, 3, 5))
            for lab, mask in (("K1 안", K1), ("K2 안", K1 | W.dn2), ("바닥권<30 안", W.br < 30), ("변동성 꺾임 안", volTurn)):
                mm = mask.reindex(S.index).fillna(False).astype(bool); a, o = S[mm], S[~mm]
                if len(a): row += f" | {lab} n{len(a)} " + "/".join(f"{st(a, h)['r']}%({st(a, h)['r']-base_s[h]['r']:+d})" for h in (1, 3, 5))
                if len(o) and lab == "K2 안": row += f" · 밖 n{len(o)} " + "/".join(f"{st(o, h)['r']}%" for h in (1, 3, 5))
            print(row)
print(f"\n── 세 관문(+3일 +5%p · 전·후반 모두 기준선 위 · 15건+) 통과: {len(allpass)}칸 / 훑은 칸 {cells}칸")
for p in allpass: print("  ✅ " + p)
print("※ 칸이 많으면 우연히 한두 칸은 통과한다 — 다음 측정에서 같은 칸이 다시 통과해야 실전 후보. 화면 반영은 사용자 승인 뒤.")
