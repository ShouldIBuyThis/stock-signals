#!/usr/bin/env python3
"""앞설 테마 TOP5 + 3·5·10거래일 +1% 도달 확률 모델 (사전 등록 docs/2026-11-19-theme-top5-prob.md · 읽기 전용)
지표 패널(야후 252봉 52주 · 200일선)은 tools/theme-redesign-lab.py 준비 부분을 그대로 쓴다(재구현 없음).
정답 = 화면 원장 가격(px)으로 만든 테마 경로(미국 · 레버리지 아님 · 동일가중) — tools/theme-lowdown-lab.js의 '+1% 도달'과 같은 규칙.
사용: python tools/theme-prob-lab.py /tmp/theme.json
마지막 줄 MODEL_JSON = 화면에 옮길 계수·보정·부트스트랩 표본(선택 모델).
"""
import json, math
import numpy as np, pandas as pd

SRC = open("tools/theme-redesign-lab.py", encoding="utf-8").read()
CUT = SRC.index('CAND = [("V0 현행", "V0", None)]')
NS = {"__name__": "theme_lib", "__file__": "tools/theme-redesign-lab.py"}
exec(compile(SRC[:CUT], "tools/theme-redesign-lab.py", "exec"), NS)
X, DATES, SPLIT, RIX, ROWS, P0, FULL0, U0, SIGN_FN = (NS[k] for k in ("X", "DATES", "SPLIT", "RIX", "ROWS", "P0", "FULL0", "U0", "SIGN_FN"))
T = len(DATES); SP = ("train", "val", "test"); PER = {"train": "학습 2017~21", "val": "검증 2022~23", "test": "재확인 2024~26"}
HS = (3, 5, 10); WTS = (64, 58, 58, 58); RNG = np.random.default_rng(7)
print("\n※ 학습·검증·재확인 모두 이전 연구에서 이미 본 기간 — 독립 검증 아님. 최종 검증 = 2026-11-20 이후 실전 원장.")

# ── 지표(정의 = 기존 연구) ──
lr, lr5, lrd5 = P0["lo52"], P0["lr5"], P0["lrd5"]; lr5b = lr5.shift(5); okb = lr5.notna() & lr5b.notna()
FD = {"ab200": P0["ab200"], "net5": P0["net5"], "d5": P0["d5"],
      "D": ((lr5b > 0) & (lrd5 < 0)).astype(float).where(okb),
      "L2": ((lr5b >= 0.05) & (lrd5 <= -0.05)).astype(float).where(okb),
      "L3": ((lr5b > 0) & (lr == 0)).astype(float).where(lr5b.notna() & lr.notna())}
FEATS = ["ab200", "net5", "d5", "D", "L2", "L3", "v0w"]
FA = {f: {th: df[th].to_numpy(float) for th in df.columns} for f, df in FD.items()}
PX = X.get("px", {}); PXA = {t: np.array([PX.get(t, {}).get(d, np.nan) for d in DATES], float) for t in PX}
print(f"원장 가격 종목 {len(PXA)}개 (미국·레버리지 아님)")

def v0w(rows):
    w = {r["name"]: 0 for r in rows}
    for k, fn in enumerate(SIGN_FN):
        a = [(fn(r), r) for r in rows if fn(r) is not None]; a = sorted(a, key=lambda x: -x[0])[:3]
        for _, r in a: w[r["name"]] += WTS[k]
    return {k: v / sum(WTS) for k, v in w.items()}
def path(th, i, h):
    if i + h >= T: return None, 0
    use = [PXA[t] for t in U0.get(th, []) if t in PXA and np.isfinite(PXA[t][i]) and np.all(np.isfinite(PXA[t][i + 1:i + h + 1]))]
    if len(use) < 2: return None, len(use)
    return np.mean([m[i + 1:i + h + 1] / m[i] for m in use], axis=0) - 1, len(use)

REC = []   # 테마·날 한 행
for i, d in enumerate(DATES):
    rows = ROWS[d]
    if len(rows) < 5: continue
    W = v0w(rows); F0 = FULL0[d]; fill = F0 + [r["name"] for r in rows if r["name"] not in F0]
    for th in fill:
        r = {"i": i, "d": d, "sp": SPLIT[d], "th": th, "pos": fill.index(th), "nmem": len([t for t in U0.get(th, []) if t in PXA and np.isfinite(PXA[t][i])]),
             "v0w": W.get(th, 0.0)}
        for f in FD: a = FA[f].get(th); r[f] = float(a[i]) if a is not None and np.isfinite(a[i]) else np.nan
        for h in HS:
            V, _ = path(th, i, h)
            r[f"y{h}"] = None if V is None else int(np.any(V >= 0.01 - 1e-12)); r[f"c{h}"] = None if V is None else int(V[-1] > 0.01); r[f"r{h}"] = None if V is None else float(V[-1]) * 100
        REC.append(r)
DF = pd.DataFrame(REC)
print(f"테마·날 {len(DF):,}행 · 날 {DF['d'].nunique():,}")

# ── 자료 점검 ──
print("\n■ 0. 자료 점검")
cmp_ = DF[["ab200", "net5", "d5", "D", "L2", "L3"]].notna().all(axis=1)
for sp in SP:
    m = DF["sp"] == sp; days = DF[m]["d"].nunique(); ok = DF[m & cmp_].groupby("d").size()
    print(f"  {PER[sp]}: 테마·날 {m.sum():,} · 지표 완비 {cmp_[m].mean() * 100:.0f}% · 5일 정답 있음 {DF[m]['y5'].notna().mean() * 100:.0f}% · "
          f"예측 가능 테마 5개 미만인 날(=추천 없음) {(days - (ok >= 5).sum())}/{days}일 · 평균 구성종목 {DF[m]['nmem'].mean():.1f}")
cov = DF.assign(ok=cmp_).groupby(["th", "sp"])["ok"].mean().unstack().reindex(columns=list(SP))
low = cov[(cov < 0.5).any(axis=1)]
print("  자료 부족 테마(어느 기간이든 지표 완비 50% 미만): " + (" · ".join(f"{th} {' '.join(f'{v * 100:.0f}' if pd.notna(v) else '—' for v in row)}%" for th, row in low.iterrows()) or "없음"))
print("  시점 누수: 지표는 그날까지의 봉(rolling·merge_asof backward) · 표준화 평균·표준편차는 학습만 · λ·보정은 검증만 · 재확인은 어디에도 안 씀")
print("  겹침: 같은 날 테마끼리 · 연속 날짜끼리 결과가 겹친다 → 차이의 구간은 10거래일 블록 부트스트랩 · 5거래일 간격 표본을 같이 본다")
tr = DF[(DF["sp"] == "train") & cmp_]
C = tr[FEATS].corr()
print("  학습 상관(|r|≥0.3): " + " · ".join(f"{a}~{b} {C.loc[a, b]:+.2f}" for k, a in enumerate(FEATS) for b in FEATS[k + 1:] if abs(C.loc[a, b]) >= 0.3))
Z = (tr[FEATS] - tr[FEATS].mean()) / tr[FEATS].std(ddof=0)
vif = {}
for f in FEATS:
    o = [g for g in FEATS if g != f]; A = np.c_[np.ones(len(Z)), Z[o].to_numpy()]; b, *_ = np.linalg.lstsq(A, Z[f].to_numpy(), rcond=None)
    r2 = 1 - np.var(Z[f].to_numpy() - A @ b) / np.var(Z[f].to_numpy()); vif[f] = 1 / max(1e-9, 1 - r2)
print("  VIF: " + " · ".join(f"{f} {v:.1f}" for f, v in vif.items()))
for h in HS:
    print(f"  기준률(도달 {h}일): " + " · ".join(f"{PER[sp]} {DF[(DF['sp'] == sp)][f'y{h}'].dropna().mean() * 100:.0f}%" for sp in SP))

# ── 모델 ──
sig = lambda z: 1 / (1 + np.exp(-np.clip(z, -30, 30)))
def fit(A, y, lam):
    k = A.shape[1]; b = np.zeros(k); m = np.clip(y.mean(), 1e-4, 1 - 1e-4); b[0] = math.log(m / (1 - m)); R = lam * np.diag([0] + [1] * (k - 1))
    for _ in range(60):
        p = sig(A @ b); g = A.T @ (y - p) - R @ b; H = (A * (p * (1 - p))[:, None]).T @ A + R
        s = np.linalg.solve(H + 1e-9 * np.eye(k), g); b += s
        if np.max(np.abs(s)) < 1e-9: break
    return b
ll = lambda p, y: float(-np.mean(y * np.log(np.clip(p, 1e-9, 1)) + (1 - y) * np.log(np.clip(1 - p, 1e-9, 1))))
br = lambda p, y: float(np.mean((p - y) ** 2))
MODELS = {"기준(절편)": [], "①200일선": ["ab200"], "②순신고가": ["net5", "d5"], "③신저가 둔화": ["D", "L2", "L3"], "④기존 점수": ["v0w"], "⑤전체 결합": FEATS}
NEED = {"ab200", "net5", "d5", "D", "L2", "L3"}
MU = tr[FEATS].mean(); SD = tr[FEATS].std(ddof=0).replace(0, 1)
def design(df, fs): return np.c_[np.ones(len(df)), ((df[fs] - MU[fs]) / SD[fs]).to_numpy()] if fs else np.ones((len(df), 1))
def sub(sp, h, fs):
    m = (DF["sp"] == sp) & DF[f"y{h}"].notna()
    need = [f for f in fs if f in NEED] or []
    for f in need: m &= DF[f].notna()
    return DF[m]
FIT = {}
for nm, fs in MODELS.items():
    for h in HS:
        a, v = sub("train", h, fs), sub("val", h, fs)
        best = None
        for lam in ((0.0,) if not fs else (0.0, 1.0, 10.0, 100.0, 1000.0)):
            b = fit(design(a, fs), a[f"y{h}"].to_numpy(float), lam); s = ll(sig(design(v, fs) @ b), v[f"y{h}"].to_numpy(float))
            if best is None or s < best[0] - 1e-12: best = (s, lam, b)
        s, lam, b = best; zv = design(v, fs) @ b; pa = fit(np.c_[np.ones(len(zv)), zv], v[f"y{h}"].to_numpy(float), 0.0)
        FIT[(nm, h)] = dict(fs=fs, lam=lam, b=b, platt=pa, llv=s)
def prob(nm, h, df):
    F = FIT[(nm, h)]; z = design(df, F["fs"]) @ F["b"]; return sig(F["platt"][0] + F["platt"][1] * z)
def auc_day(df, p, y):
    out = []
    for _, g in df.assign(p=p, y=y).groupby("d"):
        pos, neg = g[g.y == 1].p.to_numpy(), g[g.y == 0].p.to_numpy()
        if len(pos) and len(neg): out.append((np.mean([(x > neg).mean() + 0.5 * (x == neg).mean() for x in pos])))
    return float(np.mean(out)) if out else np.nan
BINS = [0, .3, .4, .5, .6, .7, .8, 1.0001]
def rel(p, y):
    o = []
    for lo, hi in zip(BINS[:-1], BINS[1:]):
        m = (p >= lo) & (p < hi)
        if m.sum(): o.append((lo, hi, int(m.sum()), float(p[m].mean()), float(y[m].mean())))
    return o
def ece(p, y): return sum(n * abs(pm - ym) for _, _, n, pm, ym in rel(p, y)) / max(1, len(p))

print("\n■ 1. 모델 비교 (보정 후 · 검증은 λ·보정에 쓴 기간 · 재확인은 안 쓴 기간)")
SEL = {}
for nm, fs in MODELS.items():
    line = []
    for h in HS:
        F = FIT[(nm, h)]; base = sub("train", h, [])[f"y{h}"].mean()
        for sp in ("val", "test"):
            df = sub(sp, h, fs); y = df[f"y{h}"].to_numpy(float); p = prob(nm, h, df)
            bs, b0 = br(p, y), br(np.full(len(y), base), y)
            line.append(f"{h}일·{'검' if sp == 'val' else '재'} LL {ll(p, y):.4f} Brier {bs:.4f}(개선 {(1 - bs / b0) * 100:+.1f}%) AUC {auc_day(df, p, y):.3f} ECE {ece(p, y) * 100:.1f}%p")
    SEL[nm] = np.mean([FIT[(nm, h)]["llv"] for h in HS])
    print(f"  {nm} [{', '.join(fs) or '—'}] λ " + "/".join(str(FIT[(nm, h)]['lam']) for h in HS) + f" · 검증 LL(보정 전 평균) {SEL[nm]:.4f}")
    for k in range(0, len(line), 2): print("     " + " | ".join(line[k:k + 2]))
cands = [n for n in MODELS if n != "기준(절편)"]
bestll = min(SEL[n] for n in cands)
CHO = sorted([n for n in cands if SEL[n] <= bestll + 0.0005], key=lambda n: (len(MODELS[n]), SEL[n]))[0]
print(f"\n  ▶ 화면 모델(사전 규칙: 검증 LL 최저 · 0.0005 안이면 지표 적은 쪽) = {CHO}")
for h in HS:
    F = FIT[(CHO, h)]; print(f"     {h}일 계수(표준화): " + " · ".join(f"{f} {c:+.3f}" for f, c in zip(["절편"] + F["fs"], F["b"])) + f" · 보정 a {F['platt'][0]:+.3f} b {F['platt'][1]:.3f}")
for h in HS:
    for sp in ("val", "test"):
        df = sub(sp, h, MODELS[CHO]); y = df[f"y{h}"].to_numpy(float); p = prob(CHO, h, df)
        print(f"     구간별 실제({h}일·{PER[sp]}): " + " · ".join(f"{lo * 100:.0f}~{min(hi, 1) * 100:.0f}% 예측 {pm * 100:.0f}→실제 {ym * 100:.0f}% ({n})" for lo, hi, n, pm, ym in rel(p, y)))

# ── 2. TOP5 비교 ──
for nm in MODELS:
    for h in HS:
        m = pd.Series(True, index=DF.index)
        for f in [f for f in MODELS[nm] if f in NEED]: m &= DF[f].notna()
        DF.loc[m, f"p{h}_{nm}"] = prob(nm, h, DF[m])
METH = [("기존 TOP3", None, 3), ("기존 TOP5", None, 5), ("200일선 TOP5", "①200일선", 5), ("순신고가 TOP5", "②순신고가", 5),
        ("신저가 둔화 TOP5", "③신저가 둔화", 5), ("전체 결합 TOP5", "⑤전체 결합", 5)]
if CHO not in ("①200일선", "②순신고가", "③신저가 둔화", "⑤전체 결합"): METH.append((f"화면 모델({CHO}) TOP5", CHO, 5))
G = {d: g for d, g in DF.groupby("d")}
def picks(d, mdl, k):
    g = G[d]
    if mdl is None: return g.sort_values("pos").head(k), (g.sort_values("pos").head(k)[[f"p{h}_④기존 점수" for h in HS]].to_numpy() if True else None)
    c = g[g[f"p5_{mdl}"].notna()]
    if len(c) < 5: return None, None
    c = c.sort_values([f"p5_{mdl}", "pos"], ascending=[False, True]).head(k); return c, c[[f"p{h}_{mdl}" for h in HS]].to_numpy()
def daystat(d, mdl, k):
    P, pr = picks(d, mdl, k)
    if P is None: return None
    g = G[d]; o = {"d": d}
    for j, h in enumerate(HS):
        ok = P[f"y{h}"].notna()
        if ok.sum() == 0: o[h] = None; continue
        rr = P.loc[ok, f"r{h}"].to_numpy(); med = np.median(g[f"r{h}"].dropna().to_numpy()); pp_ = pr[ok.to_numpy(), j]
        o[h] = dict(y=P.loc[ok, f"y{h}"].mean(), c=P.loc[ok, f"c{h}"].mean(), ret=rr.mean(), pos=float(rr.mean() > 0), hit=float(rr.mean() > med),
                    br=float(np.nanmean((pp_ - P.loc[ok, f"y{h}"].to_numpy()) ** 2)) if np.isfinite(pp_).any() else np.nan, bias=float(np.nanmean(pp_) - P.loc[ok, f"y{h}"].mean()))
    return o
def boot(diff, B=10, R=2000):
    diff = np.asarray(diff, float)
    if len(diff) < 40: return (np.nan, np.nan)
    nb = len(diff) // B; out = [diff[np.concatenate([np.arange(s, s + B) for s in RNG.integers(0, len(diff) - B, nb)])].mean() for _ in range(R)]
    return float(np.percentile(out, 5)), float(np.percentile(out, 95))
pc = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:.0f}%"
sg = lambda x: "—" if x is None or not np.isfinite(x) else f"{x:+.2f}%"
print("\n■ 2. TOP 비교 (도달 = h일 안 +1% · 적중 = 추천 평균 수익 > 그날 모든 테마 중앙값 · 플러스 = 추천 평균 수익 > 0 · 보정 오차 = 예측 평균 − 실제)")
DS = {}
for lab, mdl, k in METH:
    for sp in SP:
        DS[(lab, sp)] = [x for x in (daystat(d, mdl, k) for d in DATES if SPLIT[d] == sp and d in G) for _ in [0] if x]
for sp in SP:
    alld = sum(1 for d in DATES if SPLIT[d] == sp)
    print(f"  [{PER[sp]}]")
    for lab, mdl, k in METH:
        L = DS[(lab, sp)]; s = []
        for h in HS:
            V = [x[h] for x in L if x.get(h)]
            if not V: s.append(f"{h}일 —"); continue
            f = lambda key: float(np.nanmean([v[key] for v in V]))
            s.append(f"{h}일 도달 {pc(f('y'))} 종가+1% {pc(f('c'))} 적중 {pc(f('hit'))} 평균 {sg(f('ret'))} 플러스 {pc(f('pos'))} Brier {f('br'):.3f} 오차 {f('bias') * 100:+.1f}%p")
        print(f"    {lab:<16} 추천일 {len(L)}/{alld} ({len(L) / max(1, alld) * 100:.0f}%) · " + " | ".join(s))
print("\n■ 3. 같은 날 기존 TOP5 대비 5일 도달 Δ (%p · 90% 블록 구간) · 5거래일 간격 · 연도별 Δ")
for lab, mdl, k in METH[2:]:
    out = []
    for sp in SP:
        A = {x["d"]: x[5]["y"] for x in DS[(lab, sp)] if x.get(5)}; B = {x["d"]: x[5]["y"] for x in DS[("기존 TOP5", sp)] if x.get(5)}
        dd = sorted(set(A) & set(B)); diff = [A[d] - B[d] for d in dd]; lo, hi = boot(diff); sp5 = dd[::5]
        out.append(f"{PER[sp]} {np.mean(diff) * 100:+.1f} [{lo * 100:+.1f}~{hi * 100:+.1f}] (간격 {np.mean([A[d] - B[d] for d in sp5]) * 100:+.1f})")
    yr = {}
    for sp in SP:
        A = {x["d"]: x[5]["y"] for x in DS[(lab, sp)] if x.get(5)}; B = {x["d"]: x[5]["y"] for x in DS[("기존 TOP5", sp)] if x.get(5)}
        for d in set(A) & set(B): yr.setdefault(d[:4], []).append(A[d] - B[d])
    print(f"  {lab}: " + " · ".join(out) + "\n     연도별 " + " ".join(f"{y} {np.mean(v) * 100:+.0f}" for y, v in sorted(yr.items())))
yr = {}
for sp in SP:
    for x in DS[("기존 TOP5", sp)]:
        if x.get(5): yr.setdefault(x["d"][:4], []).append(x[5]["y"])
print("  (참고) 기존 TOP5 연도별 5일 도달: " + " ".join(f"{y} {np.mean(v) * 100:.0f}%" for y, v in sorted(yr.items())))

# ── 4. 적용 판정 · 화면 모델 내보내기 ──
cl = [lab for lab, mdl, k in METH if mdl == CHO][0]
dv = {sp: np.nanmean([x[5]["y"] for x in DS[(cl, sp)] if x.get(5)]) - np.nanmean([x[5]["y"] for x in DS[("기존 TOP5", sp)] if x.get(5)]) for sp in ("val", "test")}
stop = dv["val"] <= -0.02 and dv["test"] <= -0.02
print(f"\n■ 4. 적용 판정: 화면 모델 {CHO} TOP5 − 기존 TOP5 (5일 도달) 검증 {dv['val'] * 100:+.1f}%p · 재확인 {dv['test'] * 100:+.1f}%p → "
      + ("적용 중단(두 기간 모두 2%p↑ 낮음)" if stop else "적용 가능(중단 조건 아님)"))
DRAW = {h: [] for h in HS}
fs = MODELS[CHO]; dtr = sorted({d for d in DATES if SPLIT[d] == "train"}); dva = sorted({d for d in DATES if SPLIT[d] == "val"})
def blk(ds, B=20):
    nb = len(ds) // B; st = RNG.integers(0, len(ds) - B, nb); return [ds[s + j] for s in st for j in range(B)]
for h in HS:
    a0, v0 = sub("train", h, fs), sub("val", h, fs); ga, gv = {d: g for d, g in a0.groupby("d")}, {d: g for d, g in v0.groupby("d")}
    for _ in range(100):
        a = pd.concat([ga[d] for d in blk(dtr) if d in ga]); v = pd.concat([gv[d] for d in blk(dva) if d in gv])
        b = fit(design(a, fs), a[f"y{h}"].to_numpy(float), FIT[(CHO, h)]["lam"]); z = design(v, fs) @ b
        pa = fit(np.c_[np.ones(len(z)), z], v[f"y{h}"].to_numpy(float), 0.0); DRAW[h].append([round(float(x), 5) for x in list(b) + list(pa)])
REL = {}
for h in HS:
    df = pd.concat([sub("val", h, fs), sub("test", h, fs)]); REL[h] = [[round(lo, 2), round(min(hi, 1), 2), n, round(pm, 4), round(ym, 4)] for lo, hi, n, pm, ym in rel(prob(CHO, h, df), df[f"y{h}"].to_numpy(float))]
last = DATES[-1]; g = DF[DF["d"] == last]
print(f"\n■ 5. 최신 {last} 테마별 지표·확률(화면 대조용)")
for _, r in g.iterrows():
    ps = " ".join(f"{h}일 {r.get(f'p{h}_{CHO}', np.nan) * 100:.0f}%" if pd.notna(r.get(f'p{h}_{CHO}', np.nan)) else f"{h}일 —" for h in HS)
    print(f"  {r['th']:<10} ab200 {r['ab200']:.2f} net5 {r['net5']:+.3f} Δ5 {r['d5']:+.3f} D {r['D']:.0f} L2 {r['L2']:.0f} L3 {r['L3']:.0f} v0w {r['v0w']:.3f} · {ps}") if pd.notna(r["ab200"]) and pd.notna(r["net5"]) and pd.notna(r["d5"]) and pd.notna(r["D"]) else print(f"  {r['th']:<10} 지표 부족(구성종목 {r['nmem']})")
MJ = dict(model=CHO, feats=fs, mu=[round(float(MU[f]), 6) for f in fs], sd=[round(float(SD[f]), 6) for f in fs],
          h={str(h): dict(b=[round(float(x), 6) for x in FIT[(CHO, h)]["b"]], platt=[round(float(x), 6) for x in FIT[(CHO, h)]["platt"]], lam=FIT[(CHO, h)]["lam"],
                          base=round(float(sub("train", h, [])[f"y{h}"].mean()), 4), draws=DRAW[h], rel=REL[h]) for h in HS},
          trained=f"{dtr[0]}~{dtr[-1]}", calibrated=f"{dva[0]}~{dva[-1]}", stop=bool(stop))
print("MODEL_JSON " + json.dumps(MJ, ensure_ascii=False, separators=(",", ":")))
