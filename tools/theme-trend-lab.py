#!/usr/bin/env python3
"""앞설 테마 '상승 주도' 순위 — 일봉 200선 vs 주봉 120선·40선 (사전 등록 docs/2026-11-20-theme-trend-lead.md · 읽기 전용)
테마·날 자료(DF: 지표·수익·V0 순서)는 tools/theme-prob-lab.py 준비 부분을 그대로 쓴다(재구현 없음).
주봉 이동평균만 야후 전체 기간 일봉으로 새로 만든다(그날까지 완성된 주봉만).
사용: python tools/theme-trend-lab.py /tmp/theme.json
마지막 줄 STATS_JSON = 화면 상세에 옮길 순위별 과거 승률·표본 수.
"""
import json, re, sys
import numpy as np, pandas as pd
import yfinance as yf

SRC = open("tools/theme-prob-lab.py", encoding="utf-8").read()
CUT = SRC.index("# ── 자료 점검 ──")
NS = {"__name__": "prob_lib", "__file__": "tools/theme-prob-lab.py"}
exec(compile(SRC[:CUT], "tools/theme-prob-lab.py", "exec"), NS)
DF, DATES, U0, SPLIT = NS["DF"], NS["DATES"], NS["U0"], NS["SPLIT"]
HS = (3, 5, 10); SP = ("train", "val", "test"); PER = {"train": "학습 2017~21", "val": "검증 2022~23", "test": "재확인 2024~26"}
RNG = np.random.default_rng(31)
print("\n※ 세 기간 모두 이전 연구에서 이미 본 기간 — 독립 검증 아님.")

# ── 주봉 이동평균(그날까지 완성된 주봉만) ──
MEMB = sorted({t for ts in U0.values() for t in ts})
DIX = pd.DatetimeIndex(pd.to_datetime(DATES)).astype("datetime64[ns]")
WK = {}
for t in MEMB:
    try:
        df = yf.Ticker(t).history(period="max", interval="1d", auto_adjust=True)[["Close"]].dropna()
    except Exception:
        continue
    if len(df) < 60: continue
    df.index = pd.DatetimeIndex(pd.to_datetime([x.date() for x in df.index])).astype("datetime64[ns]")
    c = df["Close"]; per = c.index.to_period("W-FRI")
    wc = c.groupby(per).last(); wd = c.index.to_series().groupby(per).max()
    T = pd.DataFrame({"last": pd.DatetimeIndex(wd.to_numpy()).astype("datetime64[ns]")})
    for n in (40, 120):
        ma = wc.rolling(n, min_periods=n).mean()
        T[f"ma{n}"] = ma.to_numpy(); T[f"up{n}"] = (ma > ma.shift(4)).astype(float).where(ma.shift(4).notna()).to_numpy()
    L = pd.merge_asof(pd.DataFrame({"d": DIX}), T.sort_values("last"), left_on="d", right_on="last", direction="backward")
    cd = c.reindex(DIX).to_numpy()
    o = {}
    for n in (40, 120):
        ma = L[f"ma{n}"].to_numpy(); o[f"a{n}"] = np.where(np.isfinite(ma) & np.isfinite(cd), (cd > ma).astype(float), np.nan)
        o[f"s{n}"] = np.where(np.isfinite(ma) & np.isfinite(cd), L[f"up{n}"].to_numpy(), np.nan)
    WK[t] = o
print(f"주봉 이동평균 종목 {len(WK)}/{len(MEMB)}")

def theme_w(th, i, key):
    v = [WK[t][key][i] for t in U0.get(th, []) if t in WK and np.isfinite(WK[t][key][i])]
    return (float(np.mean(v)) if len(v) >= 2 else np.nan), len(v)
for key in ("a120", "s120", "a40", "s40"):
    vals = [theme_w(th, i, key) for th, i in zip(DF.th, DF.i)]
    DF[key] = [v for v, _ in vals]
    if key in ("a120", "a40"): DF["n" + key[1:]] = [n for _, n in vals]

# ── 결과 칸: 종가 상승 · 상대 강도(그날 모든 테마 중앙값 초과) ──
for h in HS:
    med = DF.groupby("d")[f"r{h}"].transform("median")
    ok = DF[f"r{h}"].notna()
    DF[f"up{h}"] = np.where(ok, (DF[f"r{h}"] > 0).astype(float), np.nan)
    DF[f"rs{h}"] = np.where(ok, (DF[f"r{h}"] > med).astype(float), np.nan)

# ── 자료 점검: 주봉 120선 계산 가능 종목 ──
print("\n■ 0. 주봉 이동평균 계산 가능 종목(테마 구성종목 대비 · 연도 평균)")
DF["yr"] = DF.d.str[:4]; DF["nall"] = [len(U0.get(th, [])) for th in DF.th]
for th, g in DF.groupby("th"):
    s = " ".join(f"{y[2:]}:{r.n120.mean():.1f}/{r.nall.iloc[0]}" for y, r in g.groupby("yr"))
    print(f"  {th:<9} 주봉120 {s}")
day_ok = DF.groupby("d").apply(lambda g: int(g.a120.notna().sum() >= 5))
print("  주봉120 값 있는 테마 5개↑인 날(연도별): " + " ".join(f"{y} {int(day_ok[[d for d in day_ok.index if d[:4] == y]].sum())}/{sum(1 for d in day_ok.index if d[:4] == y)}" for y in sorted({d[:4] for d in day_ok.index})))
print("  상관(학습): " + " · ".join(f"{a}~{b} {DF[DF.sp == 'train'][[a, b]].corr().iloc[0, 1]:+.2f}" for a, b in (("ab200", "a120"), ("ab200", "a40"), ("a40", "a120"), ("ab200", "net5"))))

# ── 후보 ──
CAND = {"T0 기존 순위": None, "T1 200선": lambda g: g.ab200, "T2 200선×주120": lambda g: g.ab200 * g.a120, "T3 200선+주120기울기": lambda g: g.ab200 + g.s120,
        "T4 200선×주40": lambda g: g.ab200 * g.a40, "T5 200선+주40기울기": lambda g: g.ab200 + g.s40, "T6 주120 단독": lambda g: g.a120,
        "T7 주40 단독": lambda g: g.a40, "T8 200선+순신고가": lambda g: g.ab200 + g.net5}
# 단기 반등 = 화면에 배포된 모델(index.html THEME_PROB) 그대로
html = open("index.html", encoding="utf-8").read()
MJ = json.loads(re.search(r"const THEME_PROB = (\{.*?\});\n", html).group(1))
def pmodel(g, h):
    z = np.full(len(g), MJ["h"][str(h)]["b"][0], float)
    for j, f in enumerate(MJ["feats"]): z = z + MJ["h"][str(h)]["b"][j + 1] * (g[f].to_numpy(float) - MJ["mu"][j]) / MJ["sd"][j]
    a, b = MJ["h"][str(h)]["platt"]; return 1 / (1 + np.exp(-(a + b * z)))
for h in HS: DF[f"p{h}"] = pmodel(DF, h)
G = {d: g for d, g in DF.groupby("d")}

def top(g, key, k=5):
    if key == "단기 반등":
        c = g[np.isfinite(g.p5)]
        return c.sort_values(["p5", "pos"], ascending=[False, True]).head(k) if len(c) >= 5 else None
    fn = CAND[key]
    if fn is None: return g.sort_values("pos").head(k)
    s = fn(g); c = g.assign(_s=s)[np.isfinite(s)]
    return c.sort_values(["_s", "pos"], ascending=[False, True]).head(k) if len(c) >= 5 else None

COMMON = [d for d in DATES if d in G and all(top(G[d], k) is not None for k in CAND)]
print(f"\n■ 1. 후보 비교 — 모든 후보가 계산되는 날만 {len(COMMON)}일 (" + " · ".join(f"{PER[sp]} {sum(SPLIT[d] == sp for d in COMMON)}일" for sp in SP) + ")")
def picks(days, key):
    out = []
    for d in days:
        t = top(G[d], key)
        if t is None: continue
        t = t.assign(rk=np.arange(1, len(t) + 1)); out.append(t)
    return pd.concat(out) if out else pd.DataFrame()
def dayser(P, col):
    return P.groupby("d")[col].mean()
def bci(diff, B=10, R=2000):
    x = np.asarray(diff, float); x = x[np.isfinite(x)]
    if len(x) < 40: return (np.nan, np.nan)
    nb = len(x) // B; o = [x[np.concatenate([np.arange(s, s + B) for s in RNG.integers(0, len(x) - B, nb)])].mean() for _ in range(R)]
    return float(np.percentile(o, 5) * 100), float(np.percentile(o, 95) * 100)
pc = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:.0f}%"
sg = lambda x: "—" if x is None or not np.isfinite(x) else f"{x:+.2f}%"
RES = {}
for key in CAND:
    for sp in SP:
        days = [d for d in COMMON if SPLIT[d] == sp]; P = picks(days, key); RES[(key, sp)] = P
for sp in SP:
    print(f"  [{PER[sp]}]")
    B1 = RES[("T1 200선", sp)]
    for key in CAND:
        P = RES[(key, sp)]
        if not len(P): continue
        s = " | ".join(f"{h}일 상승 {pc(P[f'up{h}'].mean())} 상대강도 {pc(P[f'rs{h}'].mean())} 평균 {sg(P[f'r{h}'].mean())}" for h in HS)
        dd = (dayser(P, "rs5") - dayser(B1, "rs5")).dropna(); lo, hi = bci(dd.to_numpy())
        print(f"    {key:<14} n={len(P):5d} · {s} · 5일 상대강도 Δ vs T1 {dd.mean() * 100:+.1f}%p [{lo:+.1f}~{hi:+.1f}]")

# ── 판정 ──
print("\n■ 2. 판정(사전 등록 §3)")
win = []
for key in CAND:
    if key in ("T0 기존 순위", "T1 200선"): continue
    D = {}
    for sp in SP:
        P, B1 = RES[(key, sp)], RES[("T1 200선", sp)]
        dd = (dayser(P, "rs5") - dayser(B1, "rs5")).dropna(); D[sp] = (dd.mean() * 100, bci(dd.to_numpy()))
    tv = pd.concat([RES[(key, "train")], RES[(key, "val")]]); tv1 = pd.concat([RES[("T1 200선", "train")], RES[("T1 200선", "val")]])
    why = []
    if not (D["train"][0] >= 2 and D["val"][0] >= 2): why.append("학습·검증 +2%p 미달")
    if not (np.isfinite(D["val"][1][0]) and D["val"][1][0] > 0): why.append("검증 하한 ≤ 0")
    if not D["test"][0] >= 0: why.append("재확인 뒤집힘")
    if not tv.r5.mean() >= tv1.r5.mean(): why.append("평균 수익 T1 미만")
    print(f"  {key:<14} Δ 학습 {D['train'][0]:+.1f} · 검증 {D['val'][0]:+.1f} [{D['val'][1][0]:+.1f}~{D['val'][1][1]:+.1f}] · 재확인 {D['test'][0]:+.1f}%p → {'통과' if not why else '미달: ' + ' · '.join(why)}")
    if not why: win.append((D["val"][0], key))
pick = max(win)[1] if win else "T1 200선"
print(f"  ■ 상승 주도 화면 순위 = {pick}" + (" (주봉 지표 — 원장에 주봉 120/40선 자료가 없어 화면 반영은 사용자 결정)" if pick not in ("T1 200선", "T8 200선+순신고가") else ""))
for a, b in (("T2 200선×주120", "T4 200선×주40"), ("T3 200선+주120기울기", "T5 200선+주40기울기")):
    da = (dayser(pd.concat([RES[(a, s)] for s in SP]), "rs5") - dayser(pd.concat([RES[("T1 200선", s)] for s in SP]), "rs5")).mean() * 100
    db = (dayser(pd.concat([RES[(b, s)] for s in SP]), "rs5") - dayser(pd.concat([RES[("T1 200선", s)] for s in SP]), "rs5")).mean() * 100
    print(f"  기간 대조: {a} 전체 Δ {da:+.1f}%p vs {b} {db:+.1f}%p")

# ── 화면용 순위별 과거 승률(T1 전체 날 · 단기 반등 전체 날) ──
print("\n■ 3. 화면 상세용 순위별 과거 실적")
STATS = {}
for mode, key in (("lead", "T1 200선"), ("rebound", "단기 반등")):
    allP = picks([d for d in DATES if d in G], key)
    S = {}
    for per, P in (("all", allP), ("test", allP[allP.sp == "test"])):
        o = {}
        for rk in ("1", "2", "3", "4", "5", "top5"):
            Q = P if rk == "top5" else P[P.rk == int(rk)]
            e = {"n": int(Q.d.nunique()) if rk != "top5" else int(len(Q))}
            for h in HS:
                q = Q[Q[f"r{h}"].notna()]
                e[f"n{h}"] = int(len(q)); e[f"up{h}"] = round(float(q[f"up{h}"].mean()), 4) if len(q) else None
                e[f"rs{h}"] = round(float(q[f"rs{h}"].mean()), 4) if len(q) else None
                yy = q[f"y{h}"].dropna(); e[f"y{h}"] = round(float(yy.mean()), 4) if len(yy) else None
                e[f"r{h}"] = round(float(q[f"r{h}"].mean()), 3) if len(q) else None
            o[rk] = e
        S[per] = o
        x = o["top5"]; print(f"  {mode} {per}: TOP5 {x['n5']}건 · 5일 상승 {pc(x['up5'])} 상대강도 {pc(x['rs5'])} +1%도달 {pc(x['y5'])} 평균 {sg(x['r5'])} · 1위 5일 상승 {pc(o['1']['up5'])} ({o['1']['n5']}건)")
    S["period"] = {"all": f"{allP.d.min()}~{allP.d.max()}", "test": f"{allP[allP.sp == 'test'].d.min()}~{allP[allP.sp == 'test'].d.max()}"}
    STATS[mode] = S
print("STATS_JSON " + json.dumps(STATS, ensure_ascii=False, separators=(",", ":")))
