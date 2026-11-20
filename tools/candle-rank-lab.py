#!/usr/bin/env python3
"""캔들 순위(앞설 테마 TOP5 세 번째 탭) 연구 — 사전 등록 docs/2026-11-20-candle-rank.md · 읽기 전용
패턴 정의 = candle_patterns.py(유일한 정의). 테마·날 자료(DF·V0 순서·T1 상승 주도 TOP5·테마 경로)는
tools/theme-trend-lab.py 준비 부분을 그대로 쓴다(재구현 없음). 종목 일봉 OHLCV는 야후 전체 기간.
사용: python tools/candle-rank-lab.py /tmp/theme.json      (CI)
      python tools/candle-rank-lab.py --mock [--plant]     (모의 자료 — 문법·귀무 확인)
마지막 줄 CANDLE_JSON = 통과 패턴·선택 산식·화면 상세용 순위 과거 실적(통과한 경우만).
"""
import sys, json, math, time
import numpy as np, pandas as pd
sys.path.insert(0, ".")
import candle_patterns as CP

MOCK = "--mock" in sys.argv; PLANT = "--plant" in sys.argv
RNG = np.random.default_rng(20261120)
SPN = ("train", "val", "test"); SPK = {"train": "학습", "val": "검증", "test": "재확인"}
# 시간봉별 결과 기간(거래일) — 1차 지표는 굵게: 일 5일 · 주 4주(20) · 월 1개월(21). 보조 = 같은 표 다음 칸.
HZ = {"D": (3, 5, 10), "W": (10, 20, 40), "M": (21, 63)}
PRIM = {"D": 5, "W": 20, "M": 21}; SEC = {"D": 10, "W": 40, "M": 63}
SHORT = (3, 5, 10)
TFN = {"D": "일봉", "W": "주봉", "M": "월봉"}
TFARG = {"D": (200, 252), "W": (40, 52), "M": (10, 12)}
STOCK_START = "2012-01-01"      # 종목 단위 패턴 검증 시작(학습 2012~21 · 검증 2022~23 · 재확인 2024~)
pc = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:.0f}%"
pp = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:+.1f}"
sg = lambda x: "—" if x is None or not np.isfinite(x) else f"{x:+.2f}%"
def split_of(d):
    return "train" if d < "2022-01-01" else "val" if d < "2024-01-01" else "test"

# ═════════════════════════ 자료 ═════════════════════════
if not MOCK:
    import yfinance as yf
    SRC = open("tools/theme-trend-lab.py", encoding="utf-8").read()
    CUT = SRC.index("COMMON = [")
    TL = {"__name__": "trend_lib", "__file__": "tools/theme-trend-lab.py"}
    exec(compile(SRC[:CUT], "tools/theme-trend-lab.py", "exec"), TL)
    DF, DATES, U0, SPLIT, top0, PNS = TL["DF"], TL["DATES"], TL["U0"], TL["SPLIT"], TL["top"], TL["NS"]
    MEMB = sorted({t for ts in U0.values() for t in ts})
    OH = {}
    for t in MEMB:
        try:
            df = yf.Ticker(t).history(period="max", interval="1d", auto_adjust=True)[["Open", "High", "Low", "Close", "Volume"]].dropna()
        except Exception:
            continue
        if len(df) < 300: continue
        df.index = pd.DatetimeIndex(pd.to_datetime([x.date() for x in df.index])).astype("datetime64[ns]")
        df = df[~df.index.duplicated(keep="last")]
        df = df[(df.index <= pd.Timestamp(DATES[-1])) & (df.index >= pd.Timestamp("2010-01-01"))]
        OH[t] = df
        time.sleep(0.05)
    print(f"\n■ 캔들 연구 · 종목 일봉 {len(OH)}/{len(MEMB)} · 테마·날 {len(DF):,}행 · {DATES[0]}~{DATES[-1]}")
    _path = PNS["path"]
    def tpath(th, i, h): return _path(th, i, h)[0]
else:
    # 모의: 기하 랜덤워크 OHLCV (캔들 정보 없음). --plant면 일봉 상승 장악형 뒤 5봉 동안 +0.3%/봉을 심는다.
    NS_, NT = 60, 3700
    dts = pd.bdate_range("2012-01-02", periods=NT)
    OH = {}
    for k in range(NS_):
        r = RNG.normal(0.0003, 0.02, NT); C = 100 * np.exp(np.cumsum(r))
        O = np.r_[C[0], C[:-1]] * np.exp(RNG.normal(0, 0.006, NT))
        H = np.maximum(O, C) * np.exp(np.abs(RNG.normal(0, 0.008, NT))); L = np.minimum(O, C) * np.exp(-np.abs(RNG.normal(0, 0.008, NT)))
        if PLANT:
            P = CP.detect(O, H, L, C)["ENG_BULL"]
            mult = np.ones(NT)
            for t in np.where(P)[0]:
                for j in range(1, 6):
                    if t + j < NT: mult[t + j:] *= 1.003
            O, H, L, C = O * mult, H * mult, L * mult, C * mult
        OH[f"S{k:02d}"] = pd.DataFrame({"Open": O, "High": H, "Low": L, "Close": C, "Volume": RNG.integers(1e5, 1e6, NT).astype(float)}, index=dts)
    names = list(OH)
    U0 = {f"테마{j:02d}": names[j * 4:(j + 1) * 4] for j in range(15)}
    DATES = [d.strftime("%Y-%m-%d") for d in dts[-2450:]]
    SPLIT = {d: split_of(d) for d in DATES}
    PXA = {t: OH[t]["Close"].reindex(pd.to_datetime(DATES)).to_numpy(float) for t in OH}
    T_ = len(DATES)
    def tpath(th, i, h):
        if i + h >= T_: return None
        use = [PXA[t] for t in U0[th] if np.isfinite(PXA[t][i]) and np.all(np.isfinite(PXA[t][i + 1:i + h + 1]))]
        if len(use) < 2: return None
        return np.mean([m[i + 1:i + h + 1] / m[i] for m in use], axis=0) - 1
    rec = []
    for i, d in enumerate(DATES):
        for p, th in enumerate(U0):
            a = [PXA[t] for t in U0[th]]
            ab = np.mean([float(m[i] > np.nanmean(m[max(0, i - 199):i + 1])) for m in a]) if i >= 199 else np.nan
            r = {"i": i, "d": d, "sp": SPLIT[d], "th": th, "pos": p, "ab200": ab}
            for h in SHORT:
                V = tpath(th, i, h); r[f"r{h}"] = None if V is None else float(V[-1]) * 100
            rec.append(r)
    DF = pd.DataFrame(rec)
    for h in SHORT:
        med = DF.groupby("d")[f"r{h}"].transform("median"); ok = DF[f"r{h}"].notna()
        DF[f"up{h}"] = np.where(ok, (DF[f"r{h}"] > 0).astype(float), np.nan); DF[f"rs{h}"] = np.where(ok, (DF[f"r{h}"] > med).astype(float), np.nan)
    def top0(g, key, k=5):
        c = g[np.isfinite(g.ab200)]
        return c.sort_values(["ab200", "pos"], ascending=[False, True]).head(k) if len(c) >= 5 else None
    print(f"\n■ 모의 자료 · 종목 {len(OH)} · 테마 {len(U0)} · {'심은 효과 있음(상승 장악형 일봉)' if PLANT else '캔들 정보 없음(귀무)'}")

print("※ 학습·검증·재확인 모두 이전 연구에서 이미 본 기간 — 독립 검증 아님. 최종 검증 = 화면 반영 뒤 실전 원장.")
print("※ 테마 구성 = 지금 관심종목 → 생존 편향. 늦게 상장한 종목은 상장 뒤부터.")

# ═════════════════════════ 1. 시간봉 · 패턴 · 위치 ═════════════════════════
def resample(df, rule):
    per = df.index.to_period(rule)
    g = df.groupby(per)
    b = pd.DataFrame({"Open": g["Open"].first(), "High": g["High"].max(), "Low": g["Low"].min(), "Close": g["Close"].last(), "Volume": g["Volume"].sum()})
    b["end"] = df.index.to_series().groupby(per).max().to_numpy()
    # 마지막 봉: 기간(금요일·월말)이 자료 마지막 날보다 뒤면 진행 중 봉 → 버린다(확정 봉만)
    last = df.index[-1]
    if per[-1].end_time.normalize() > last: b = b.iloc[:-1]
    return b

ALLD = sorted(set().union(*[set(df.index) for df in OH.values()]))
DIX = pd.DatetimeIndex(ALLD); DPOS = {d: i for i, d in enumerate(DIX)}
CL = np.full((len(DIX), len(OH)), np.nan); TK = list(OH)
for j, t in enumerate(TK): CL[[DPOS[d] for d in OH[t].index], j] = OH[t]["Close"].to_numpy()
HALL = sorted({h for v in HZ.values() for h in v} | set(SHORT))
def HS_(tf): return tuple(dict.fromkeys(HZ[tf] + SHORT))
FWD = {}; MED = {}
for h in HALL:
    f = np.full_like(CL, np.nan); f[:-h] = CL[h:] / CL[:-h] - 1
    FWD[h] = f
    with np.errstate(all="ignore"): MED[h] = np.nanmedian(f, axis=1)

TFB = {}     # tf → ticker → dict(bars, P, ctx)
for tf, rule in (("D", None), ("W", "W-FRI"), ("M", "M")):
    TFB[tf] = {}
    for t, df in OH.items():
        b = df.assign(end=df.index) if rule is None else resample(df, rule)
        if len(b) < TFARG[tf][1] + 12: continue
        O, H, L, C, V = (b[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        ctx = CP.context(O, H, L, C, V, *TFARG[tf])
        P = {s: CP.detect(O, H, L, C, scale=s) for s in (1.0, 0.8, 1.25)}
        TFB[tf][t] = dict(end=pd.DatetimeIndex(b["end"]).astype("datetime64[ns]"), O=O, H=H, L=L, C=C, P=P, ctx=ctx,
                          cell={k: CP.trend_cell(ctx["z"](k), ctx["pos52"], ctx["above"]) for k in (1, 2, 3, 5)})
    print(f"  {TFN[tf]} 종목 {len(TFB[tf])} · 평균 봉 {np.mean([len(v['C']) for v in TFB[tf].values()]):.0f}")

# 사건표: 시간봉 tf의 모든 확정 봉 × (결과 · 칸 · 패턴)
def build_events(tf):
    rows = []
    for j, t in enumerate(TK):
        if t not in TFB[tf]: continue
        B = TFB[tf][t]; ix = np.array([DPOS.get(pd.Timestamp(e), -1) for e in B["end"]])
        ok = (ix >= 0) & (B["end"] >= np.datetime64(STOCK_START))
        for b in np.where(ok)[0]:
            r = {"t": t, "b": b, "di": ix[b], "d": str(B["end"][b])[:10]}
            for h in HS_(tf):
                v = FWD[h][ix[b], j]; r[f"r{h}"] = v; r[f"rs{h}"] = np.nan if not np.isfinite(v) or not np.isfinite(MED[h][ix[b]]) else float(v > MED[h][ix[b]])
            rows.append(r)
    E = pd.DataFrame(rows); E["sp"] = E.d.map(split_of); E["mon"] = E.d.str[:7]
    return E
EV = {tf: build_events(tf) for tf in TFB}
for tf in EV: print(f"  {TFN[tf]} 확정 봉 {len(EV[tf]):,} ({STOCK_START[:4]}~) · 학습 {sum(EV[tf].sp == 'train'):,} · 검증 {sum(EV[tf].sp == 'val'):,} · 재확인 {sum(EV[tf].sp == 'test'):,}")

def col(tf, fn):
    """사건표 순서대로 종목 배열 값을 꺼낸다."""
    out = np.empty(len(EV[tf]), dtype=object); E = EV[tf]
    for t, g in E.groupby("t"):
        out[g.index.to_numpy()] = list(fn(TFB[tf][t])[g.b.to_numpy()])
    return out

def boot(vals, mon, R=1000):
    """월 단위 군집 부트스트랩 → (평균, 5%, 95%, 양측 p)."""
    v = np.asarray(vals, float); ok = np.isfinite(v); v, m = v[ok], np.asarray(mon)[ok]
    if len(v) < 10: return (np.nan,) * 4
    u, inv = np.unique(m, return_inverse=True); S = np.bincount(inv, v); N = np.bincount(inv).astype(float)
    W = np.stack([np.bincount(RNG.integers(0, len(u), len(u)), minlength=len(u)) for _ in range(R)]).astype(float)
    bm = (W @ S) / np.maximum(W @ N, 1)
    p = 2 * min((bm <= 0).mean(), (bm >= 0).mean())
    return float(v.mean()), float(np.percentile(bm, 5)), float(np.percentile(bm, 95)), max(p, 1 / R)

# ── 기준선: 같은 시간봉·같은 기간·같은 위치 칸(18칸)의 모든 봉 ──
BASE = {}
for tf in EV:
    E = EV[tf]; E["spi"] = E.sp.map({"train": 0, "val": 1, "test": 2}).astype(int)
    for k in (1, 2, 3, 5):
        E[f"cell{k}"] = col(tf, lambda B, k=k: B["cell"][k]).astype(int)
        for h in HS_(tf):
            gb = E[E[f"cell{k}"] >= 0].groupby(["spi", f"cell{k}"])[[f"rs{h}", f"r{h}"]].mean()
            ars = np.full(3 * 18, np.nan); ar = np.full(3 * 18, np.nan)
            for (a, c), v in gb.iterrows(): ars[a * 18 + c] = v[f"rs{h}"]; ar[a * 18 + c] = v[f"r{h}"]
            BASE[(tf, k, h)] = (ars, ar)
    E["z1"] = col(tf, lambda B: B["ctx"]["z"](1)).astype(float); E["pos"] = col(tf, lambda B: B["ctx"]["pos52"]).astype(float)
    E["above"] = col(tf, lambda B: B["ctx"]["above"]).astype(float); E["volr"] = col(tf, lambda B: B["ctx"].get("vol_r", np.full(len(B["C"]), np.nan))).astype(float)
    E["sup"] = col(tf, lambda B: B["ctx"]["sup"]).astype(float); E["res"] = col(tf, lambda B: B["ctx"]["res"]).astype(float)
    E["dist"] = col(tf, lambda B: B["ctx"]["dist"]).astype(float)
    nxt = col(tf, lambda B: np.r_[B["C"][1:], np.nan]).astype(float); cur = col(tf, lambda B: B["C"]).astype(float)
    E["conf_up"] = np.where(np.isfinite(nxt), (nxt > cur).astype(float), np.nan); E["conf_dn"] = np.where(np.isfinite(nxt), (nxt < cur).astype(float), np.nan)

def excess(tf, idx, k, h):
    """사건 idx의 결과 − 같은 기간·같은 칸 기준선 → (rs 초과, 수익 초과 %p)."""
    E = EV[tf].loc[idx]; ars, ar = BASE[(tf, k, h)]
    key = E.spi.to_numpy() * 18 + E[f"cell{k}"].to_numpy()
    br = ars[key]; bm = ar[key]
    return E[f"rs{h}"].to_numpy(float) - br, (E[f"r{h}"].to_numpy(float) - bm) * 100

# ── 검정 칸(사전 고정) ──
def cells_for(code):
    nm, k, dr, kind = CP.PATTERNS[code]
    cs = [("ALL", "모든 위치", lambda E: np.ones(len(E), bool))]
    if code in ("HAMMER_SHAPE", "INVHAM_SHAPE"):
        cs += [("DN", "하락 뒤(" + CP.NAMES_BY_TREND[code]["down"] + ")", lambda E: E[f"zk"] <= -1), ("UP", "상승 뒤(" + CP.NAMES_BY_TREND[code]["up"] + ")", lambda E: E["zk"] >= 1)]
    elif dr == 0:
        cs += [("HI", "상승 뒤 52주 고점권", lambda E: (E["zk"] >= 1) & (E["pos"] >= 0.8)), ("LO", "하락 뒤 52주 저점권", lambda E: (E["zk"] <= -1) & (E["pos"] <= 0.2))]
    elif kind == "rev":
        cs += [("EXP", "하락 뒤" if dr > 0 else "상승 뒤", (lambda E: E["zk"] <= -1) if dr > 0 else (lambda E: E["zk"] >= 1))]
    else:
        cs += [("EXP", "상승 중" if dr > 0 else "하락 중", (lambda E: E["zk"] >= 1) if dr > 0 else (lambda E: E["zk"] <= -1))]
    if code == "LONG_W": cs += [("BELOW", "장기선 아래(일봉 200선·주봉 40선·월봉 10선)", lambda E: E["above"] == 0)]
    if code == "LONG_B": cs += [("ABOVE", "장기선 위", lambda E: E["above"] == 1)]
    return cs

TESTS = []
for tf in EV:
    E = EV[tf]
    for code, (nm, k, dr, kind) in CP.PATTERNS.items():
        kk = k if k in (1, 2, 3, 5) else 3
        E["zk"] = col(tf, lambda B, kk=kk: B["ctx"]["z"](kk)).astype(float) if kk != 1 else E["z1"]
        for s in (1.0, 0.8, 1.25):
            pat = col(tf, lambda B, s=s, code=code: B["P"][s][code]).astype(bool)
            for cid, cnm, fn in cells_for(code):
                m = pat & np.asarray(fn(E), bool) & (E[f"cell{kk}"].to_numpy() >= 0)
                idx = E.index[m]
                rec = dict(tf=tf, code=code, cell=cid, cname=cnm, k=kk, scale=s, idx=idx)
                TESTS.append(rec)
print(f"\n■ 1. 패턴 검정 칸 {sum(1 for x in TESTS if x['scale'] == 1.0)}개(이웃 임계 0.8·1.25배는 고원 확인용)")

def eval_test(x):
    tf, k = x["tf"], x["k"]; idx = x["idx"]; E = EV[tf].loc[idx]; out = {"n": {sp: int((E.sp == sp).sum()) for sp in SPN}}
    for h in HS_(tf):
        ex_rs, ex_r = excess(tf, idx, k, h)
        o = {}
        for sp in SPN:
            mm = (E.sp == sp).to_numpy()
            o[sp] = (np.nanmean(ex_rs[mm]) if mm.sum() else np.nan, np.nanmean(ex_r[mm]) if mm.sum() else np.nan,
                     np.nanmean(E[f"rs{h}"].to_numpy(float)[mm]) if mm.sum() else np.nan, np.nanmean(E[f"r{h}"].to_numpy(float)[mm]) * 100 if mm.sum() else np.nan)
        tv = (E.sp != "test").to_numpy()
        o["tv"] = boot(ex_rs[tv], E.mon.to_numpy()[tv]) if h == PRIM[tf] else (np.nanmean(ex_rs[tv]) if tv.sum() else np.nan,)
        o["tv_r"] = np.nanmean(ex_r[tv]) if tv.sum() else np.nan
        out[h] = o
    return out

t0 = time.time()
for x in TESTS: x["res"] = eval_test(x) if len(x["idx"]) >= 10 else None
print(f"  계산 {time.time() - t0:.0f}초")

# ── 판정(사전 고정 §4) ──
def bh(ps, q=0.10):
    ps = np.asarray(ps, float); n = len(ps); o = np.argsort(ps); thr = q * np.arange(1, n + 1) / n
    ok = ps[o] <= thr; kmax = np.where(ok)[0].max() + 1 if ok.any() else 0
    res = np.zeros(n, bool); res[o[:kmax]] = True; return res
MAIN = [x for x in TESTS if x["scale"] == 1.0]
NB = {(x["tf"], x["code"], x["cell"], x["scale"]): x for x in TESTS}
pv = [x["res"][PRIM[x["tf"]]]["tv"][3] if x["res"] and np.isfinite(x["res"][PRIM[x["tf"]]]["tv"][3]) else 1.0 for x in MAIN]
fdr = bh(pv)
for x, ok, p in zip(MAIN, fdr, pv):
    x["p"] = p; x["fdr"] = bool(ok); R_ = x["res"]; why = []
    if R_ is None: x["pass"] = False; x["why"] = ["표본 10 미만"]; continue
    tf = x["tf"]; h = PRIM[tf]; n = R_["n"]
    dtr, dva, dte = R_[h]["train"][0], R_[h]["val"][0], R_[h]["test"][0]
    sgn = np.sign(dtr) if np.isfinite(dtr) else 0
    if n["train"] < 30 or n["val"] < 15 or n["train"] + n["val"] < 50: why.append("표본 부족")
    if not (np.isfinite(dtr) and np.isfinite(dva) and abs(dtr) >= 0.03 and abs(dva) >= 0.03 and np.sign(dva) == sgn): why.append("학습·검증 ±3%p 같은 방향 미달")
    if not ok: why.append(f"다중검정(FDR 10%) 탈락 p={p:.3f}")
    if not (np.isfinite(dte) and dte * sgn >= 0): why.append("재확인 뒤집힘")
    for s in (0.8, 1.25):
        y = NB.get((tf, x["code"], x["cell"], s))
        v = y["res"][h]["tv"][0] if y and y["res"] else np.nan
        if not (np.isfinite(v) and v * sgn >= 0.015): why.append(f"이웃 임계 {s}배 약함"); break
    s2 = R_[SEC[tf]]
    if not (np.isfinite(s2["train"][0]) and np.isfinite(s2["val"][0]) and s2["train"][0] * sgn > 0 and s2["val"][0] * sgn > 0): why.append("보조 기간 방향 다름")
    if not (np.isfinite(R_[h]["tv_r"]) and R_[h]["tv_r"] * sgn > 0): why.append("평균 수익 방향 다름")
    x["pass"] = not why; x["why"] = why; x["sgn"] = int(sgn)

def line(x):
    R_ = x["res"]; tf = x["tf"]; h = PRIM[tf]; nm, k, dr, kind = CP.PATTERNS[x["code"]]
    if R_ is None: return f"  {TFN[tf]} {nm[:16]:16} {x['cname'][:18]:18} n<10"
    n = R_["n"]; tv = R_[h]["tv"]
    hs = " ".join(f"{hh}일 {pp(R_[hh]['train'][0])}/{pp(R_[hh]['val'][0])}/{pp(R_[hh]['test'][0])}" for hh in (HS_(tf)))
    tag = "✅통과" if x["pass"] else "—"
    flip = " ⚠교과서와 반대" if x["pass"] and dr != 0 and x["sgn"] != dr else ""
    return (f"  {tag} {TFN[tf]} {nm[:18]:18} {x['cname'][:20]:20} n {n['train']}/{n['val']}/{n['test']} · {h}일 상대강도 초과 학+검 {pp(tv[0])}%p [{pp(tv[1])}~{pp(tv[2])}] p={x['p']:.3f}"
            f" · 수익 초과 {x['res'][h]['tv_r']:+.2f}%p · (학/검/재 %p) {hs}{flip}" + ("" if x["pass"] else f" · {'·'.join(x['why'][:2])}"))

print("\n■ 1-1. 패턴별 결과 — 상대 강도 승률(같은 날 전 종목 가운데값보다 더 오름)의 '같은 위치 칸 기준선 대비 초과'(%p) · 학습/검증/재확인")
print("   기준선 = 같은 시간봉·같은 기간·같은 위치 칸(직전 추세 3 × 52주 위치 3 × 장기선 위/아래 2 = 18칸)의 모든 봉. 캔들 모양이 위치 이상으로 더해 주는 몫만 잰다.")
for tf in ("D", "W", "M"):
    xs = [x for x in MAIN if x["tf"] == tf]
    print(f"\n  [{TFN[tf]} · 1차 {PRIM[tf]}거래일 · 보조 {SEC[tf]}거래일] 검정 {len(xs)}칸 · 통과 {sum(x['pass'] for x in xs)}")
    for x in sorted(xs, key=lambda x: (not x["pass"], -(abs(x["res"][PRIM[tf]]["tv"][0]) if x["res"] and np.isfinite(x["res"][PRIM[tf]]["tv"][0]) else 0))):
        print(line(x))
PASSED = [x for x in MAIN if x["pass"]]
print(f"\n  통과 합계 {len(PASSED)} / {len(MAIN)}칸 (FDR 통과 {sum(x['fdr'] for x in MAIN)})")

# ── 1-2. 통과 칸의 보조 조건(설명용 · 점수 미사용) ──
if PASSED:
    print("\n■ 1-2. 통과 칸 보조 조건(설명용 · 점수에 안 씀) — 조건 있음/없음 각각의 학습+검증 초과 %p (n)")
    for x in PASSED:
        tf = x["tf"]; h = PRIM[tf]; idx = x["idx"]; E = EV[tf].loc[idx]; ex, _ = excess(tf, idx, x["k"], h); tv = (E.sp != "test").to_numpy()
        conds = {"거래량 1.5배↑": E.volr >= 1.5, "지지선 근접(20봉 저점 1ATR)": E.sup == 1, "저항선 근접(20봉 고점 1ATR)": E.res == 1,
                 "다음 봉 확인(상승)": E.conf_up == 1, "다음 봉 확인(하락)": E.conf_dn == 1, "장기선 위": E.above == 1, "장기선 이격 +10%↑": E.dist >= 10, "장기선 이격 −10%↓": E.dist <= -10}
        s = []
        for cn, cm in conds.items():
            cm = cm.to_numpy(bool); a = ex[tv & cm]; b = ex[tv & ~cm]
            if np.isfinite(a).sum() >= 15: s.append(f"{cn} {pp(np.nanmean(a))}({np.isfinite(a).sum()}) vs {pp(np.nanmean(b))}({np.isfinite(b).sum()})")
        print(f"  {TFN[tf]} {CP.PATTERNS[x['code']][0]} · {x['cname']}: " + " · ".join(s))
    print("  ※ '다음 봉 확인'은 다음 봉 종가를 본 뒤라 진입 시점이 한 봉 늦다 — 같은 진입 기준 비교가 아님(설명용).")

# ═════════════════════════ 2. 종목 점수 → 테마 집계 ═════════════════════════
# 종목 점수(시간봉 tf, 봉 b) = 그 봉에서 완성된 통과 칸 중 상승 쪽 최대 가중 + 하락 쪽 최소 가중(중복 계산 방지).
# 가중 = 학습 기간만의 1차 초과(%p/100) — 검증·재확인 성적을 가중에 쓰지 않는다.
SC = {tf: {} for tf in TFB}
for tf in TFB:
    for t, B in TFB[tf].items():
        n = len(B["C"]); pos_ = np.zeros(n); neg_ = np.zeros(n); ev_ = [[] for _ in range(n)]
        zz = {k: B["ctx"]["z"](k) for k in (1, 2, 3, 5)}
        for x in PASSED:
            if x["tf"] != tf: continue
            w = x["res"][PRIM[tf]]["train"][0]
            m = B["P"][1.0][x["code"]] & (B["cell"][x["k"]] >= 0)
            Ez = pd.DataFrame({"zk": zz[x["k"]], "pos": B["ctx"]["pos52"], "above": B["ctx"]["above"]})
            fn = dict((c, f) for c, _, f in cells_for(x["code"]))[x["cell"]]
            m = m & np.asarray(fn(Ez), bool)
            for b in np.where(m)[0]:
                ev_[b].append((x["code"], x["cell"], w))
                if w > 0: pos_[b] = max(pos_[b], w)
                else: neg_[b] = min(neg_[b], w)
        ok = (B["cell"][1] >= 0)
        SC[tf][t] = dict(end=B["end"], s=np.where(ok, pos_ + neg_, np.nan), ev=ev_)

# 날짜별 '그날 확정된 마지막 봉' 점수: 일봉 = 그날 봉 · 주봉/월봉 = 그날까지 끝난 마지막 봉(그날이 끝 날이면 그 봉)
DD = pd.DatetimeIndex(pd.to_datetime(DATES)).astype("datetime64[ns]")
STK = {tf: {} for tf in TFB}
for tf in TFB:
    for t, S in SC[tf].items():
        pos = np.searchsorted(S["end"], DD.to_numpy(), side="right") - 1
        v = np.where(pos >= 0, S["s"][np.maximum(pos, 0)], np.nan)
        if tf == "D": v = np.where(S["end"][np.maximum(pos, 0)] == DD.to_numpy(), v, np.nan)
        else:
            # 확정 봉이 너무 오래됐으면(자료 끊김) 안 씀: 주 10일 · 월 31거래일
            gap = np.array([DPOS.get(pd.Timestamp(d), 0) for d in DD]) - np.array([DPOS.get(pd.Timestamp(S["end"][max(p, 0)]), 0) for p in pos])
            v = np.where(gap <= (10 if tf == "W" else 31), v, np.nan)
        STK[tf][t] = v
TI = {d: i for i, d in enumerate(DATES)}
def theme_score(tf, th, i, mode="sum"):
    v = [STK[tf][t][i] for t in U0.get(th, []) if t in STK[tf] and np.isfinite(STK[tf][t][i])]
    if len(v) < 2: return np.nan, len(v), 0, 0
    v = np.array(v)
    return float(v.sum() / (len(v) + 2)), len(v), int((v > 0).sum()), int((v < 0).sum())
for tf in TFB:
    vals = [theme_score(tf, th, i) for th, i in zip(DF.th, DF.i)]
    DF[f"S{tf}"] = [a for a, _, _, _ in vals]; DF[f"n{tf}"] = [b for _, b, _, _ in vals]
    DF[f"bu{tf}"] = [c for _, _, c, _ in vals]; DF[f"be{tf}"] = [d for _, _, _, d in vals]
def align(th, i):
    v = []
    for t in U0.get(th, []):
        a = [STK[tf][t][i] if t in STK[tf] else np.nan for tf in ("D", "W", "M")]
        if all(np.isfinite(a)): v.append(a)
    if len(v) < 2: return np.nan
    v = np.array(v); return float(((v > 0).all(1).sum() - (v < 0).all(1).sum()) / (len(v) + 2))
DF["AL"] = [align(th, i) for th, i in zip(DF.th, DF.i)]
TR = DF.sp == "train"
SD = {tf: float(DF.loc[TR, f"S{tf}"].std()) or 1.0 for tf in TFB}
print(f"\n■ 2. 테마 집계 — 테마 점수 = 구성종목 점수 합 ÷ (계산 가능 종목 수 + 2)  (한 종목이 좌우하지 않게 0 두 개를 더함)")
for tf in TFB:
    a = DF[f"S{tf}"]; print(f"  {TFN[tf]}: 계산 가능 테마·날 {a.notna().mean() * 100:.0f}% · 0이 아닌 비율 {((a != 0) & a.notna()).mean() * 100:.0f}% · 학습 표준편차 {SD[tf]:.4f} · 평균 계산 종목 {DF[f'n{tf}'].mean():.1f}")

# 테마 경로(3·5·10 + 시간봉 고유 기간) · 상승 · 상대 강도 · −3% · 최대 불리
HTH = sorted(set(SHORT) | set(HZ["W"]) | set(HZ["M"]))
PCACHE = {}
def tp(th, i, h):
    k = (th, i, h)
    if k not in PCACHE:
        V = tpath(th, i, h); PCACHE[k] = None if V is None else (float(V[-1]) * 100, float(np.min(V)) * 100)
    return PCACHE[k]
for h in HTH:
    if f"r{h}" in DF and h in SHORT: continue
    DF[f"r{h}"] = [None if tp(th, i, h) is None else tp(th, i, h)[0] for th, i in zip(DF.th, DF.i)]
    med = DF.groupby("d")[f"r{h}"].transform("median"); ok = DF[f"r{h}"].notna()
    DF[f"up{h}"] = np.where(ok, (DF[f"r{h}"] > 0).astype(float), np.nan); DF[f"rs{h}"] = np.where(ok, (DF[f"r{h}"] > med).astype(float), np.nan)
for h in HTH:
    DF[f"mae{h}"] = [None if tp(th, i, h) is None else tp(th, i, h)[1] for th, i in zip(DF.th, DF.i)]
    DF[f"dn{h}"] = np.where(DF[f"r{h}"].notna(), (DF[f"r{h}"].astype(float) <= -3).astype(float), np.nan)
DF["mom20"] = [np.nan if i < 20 or tp(th, i - 20, 20) is None else tp(th, i - 20, 20)[0] for th, i in zip(DF.th, DF.i)]
G = {d: g for d, g in DF.groupby("d")}

# ── 후보(사전 고정): 시간봉 가중 격자(0·¼·½·¾·1, 합 1) 15개 + 일치 비율 + 확산 ──
GRID = [(a / 4, b / 4, (4 - a - b) / 4) for a in range(5) for b in range(5 - a)]
# 통과 패턴이 하나도 없는 시간봉(점수 전부 0)은 가중을 줄 수 없다 → 그 시간봉에 가중이 있는 격자는 뺀다(같은 순위가 이름만 달리 반복되는 것 방지)
ACT = [tf for tf in ("D", "W", "M") if (DF[f"S{tf}"].fillna(0) != 0).any()]
GRID = [w for w in GRID if all(w[j] == 0 or tf in ACT for j, tf in enumerate(("D", "W", "M")))] or GRID[:0]
print(f"  점수가 있는 시간봉: {', '.join(TFN[t] for t in ACT) or '없음'} → 가중 격자 {len(GRID)}개")
def cand_fn(key):
    if key == "AL": return lambda g: g["AL"]
    if key == "BR": return lambda g: (g.buD + g.buW + g.buM - g.beD - g.beW - g.beM) / (g.nD.clip(lower=0) + 2)
    wd, ww, wm = key
    def f(g):
        s = 0
        for w, tf in ((wd, "D"), (ww, "W"), (wm, "M")):
            if w > 0: s = s + w * g[f"S{tf}"] / SD[tf]
        return s
    return f
CANDS = {f"일{a:.2g}·주{b:.2g}·월{c:.2g}": (a, b, c) for a, b, c in GRID}
if len(ACT) == 3: CANDS["시간봉 일치(세 봉 모두 상승 − 모두 하락)"] = "AL"
if ACT: CANDS["확산(상승 패턴 종목 − 하락 패턴 종목)"] = "BR"
if not CANDS: CANDS["점수 없음(통과 패턴 0)"] = (1, 0, 0)
def topc(g, key, k=5):
    s = cand_fn(CANDS[key])(g); c = g.assign(_s=s)[np.isfinite(s)]
    if len(c) < 5: return None, 0
    t = c.sort_values(["_s", "pos"], ascending=[False, True]).head(k)
    return t, int((t._s == 0).sum())
def top_rand_mean(g): return g     # 무작위 TOP5 기대값 = 그날 모든 테마 평균
def top_trend(g, k=5):
    c = g[np.isfinite(g.mom20)]
    return c.sort_values(["mom20", "pos"], ascending=[False, True]).head(k) if len(c) >= 5 else None

COMMON = [d for d in DATES if d in G and topc(G[d], list(CANDS)[0])[0] is not None and top0(G[d], "T1 200선") is not None]
print(f"\n■ 3. 테마 순위 비교 — 모든 후보가 계산되는 날 {len(COMMON)}일 (" + " · ".join(f"{SPK[sp]} {sum(SPLIT[d] == sp for d in COMMON)}" for sp in SPN) + ")")
MET = lambda h: [f"up{h}", f"rs{h}", f"r{h}", f"dn{h}", f"mae{h}"]
def dayrows(days, kind, key=None):
    out = []; ties = 0; slots = 0
    for d in days:
        g = G[d]
        if kind == "cand": t, z = topc(g, key); ties += z; slots += 5
        elif kind == "T1": t = top0(g, "T1 200선")
        elif kind == "trend": t = top_trend(g)
        else: t = g
        if t is None: continue
        out.append(t.assign(rk=np.arange(1, len(t) + 1)) if kind != "rand" else t.assign(rk=0))
    P = pd.concat(out) if out else pd.DataFrame()
    return P, (ties / slots if slots else np.nan)
def summ(P, h):
    if not len(P) or f"r{h}" not in P: return {}
    r = P[f"r{h}"].astype(float)
    return dict(n=int(r.notna().sum()), up=float(np.nanmean(P[f"up{h}"])), rs=float(np.nanmean(P[f"rs{h}"])), r=float(np.nanmean(r)), med=float(np.nanmedian(r)),
                dn=float(np.nanmean(P[f"dn{h}"])), mae=float(np.nanmean(P[f"mae{h}"].astype(float))))
def dayser(P, colm): return P.groupby("d")[colm].mean()
def bci(diff, B=20, R=2000):
    x = np.asarray(diff, float); x = x[np.isfinite(x)]
    if len(x) < 60: return (np.nan, np.nan)
    nb = len(x) // B; o = [x[np.concatenate([np.arange(s, s + B) for s in RNG.integers(0, len(x) - B, nb)])].mean() for _ in range(R)]
    return float(np.percentile(o, 5)), float(np.percentile(o, 95))

RES = {}
for sp in SPN:
    days = [d for d in COMMON if SPLIT[d] == sp]
    RES[("rand", sp)] = dayrows(days, "rand"); RES[("T1", sp)] = dayrows(days, "T1"); RES[("trend", sp)] = dayrows(days, "trend")
    for key in CANDS: RES[(key, sp)] = dayrows(days, "cand", key)
def fmt(P, h):
    s = summ(P, h)
    return "—" if not s else f"상승 {pc(s['up'])} 상대강도 {pc(s['rs'])} 평균 {sg(s['r'])} 중앙 {sg(s['med'])} −3%↓ {pc(s['dn'])} 최대불리 {sg(s['mae'])}"
def delta(key, ref, sp, h, m="rs"):
    a = dayser(RES[(key, sp)][0], f"{m}{h}"); b = dayser(RES[(ref, sp)][0], f"{m}{h}"); j = a.index.intersection(b.index)
    return (a[j] - b[j])
for sp in SPN:
    print(f"\n  [{SPK[sp]}] (5일 기준 · 동률=기존 순위 점수로 채운 자리 비율)")
    for key in ["rand", "T1", "trend"] + list(CANDS):
        P, tie = RES[(key, sp)]
        lab = {"rand": "무작위 TOP5(기대값=전체 평균)", "T1": "상승 주도 T1(200선)", "trend": "단순 추세(테마 20일 수익)"}.get(key, key)
        print(f"    {lab[:34]:34} {fmt(P, 5)}" + ("" if not np.isfinite(tie) else f" · 동률 채움 {tie * 100:.0f}%"))

# 선택: 학습 기간 5일 상대 강도가 가장 높은 후보(검증·재확인은 고르는 데 안 씀)
def rs5(key, sp): s = summ(RES[(key, sp)][0], 5); return s.get("rs", np.nan)
CHO = max(CANDS, key=lambda k: (rs5(k, "train") if np.isfinite(rs5(k, "train")) else -1))
print(f"\n■ 4. 선택(학습 5일 상대 강도 최고) = {CHO}")
GATE = {}
for ref, lab in (("rand", "무작위"), ("T1", "상승 주도 T1"), ("trend", "단순 추세")):
    d = {sp: delta(CHO, ref, sp, 5) for sp in SPN}
    m = {sp: float(d[sp].mean()) if len(d[sp]) else np.nan for sp in SPN}; ci = bci(d["val"].to_numpy())
    dr = {sp: float(delta(CHO, ref, sp, 5, "r").mean()) for sp in SPN}
    GATE[ref] = dict(m=m, ci=ci, dr=dr)
    print(f"  vs {lab}: 5일 상대강도 Δ 학습 {pp(m['train'])} · 검증 {pp(m['val'])} [{pp(ci[0])}~{pp(ci[1])}] · 재확인 {pp(m['test'])}%p · 5일 평균 수익 Δ {dr['train']:+.2f}/{dr['val']:+.2f}/{dr['test']:+.2f}%p")
g = GATE["rand"]
why = []
if not (g["m"]["train"] >= 0.02 and g["m"]["val"] >= 0.02): why.append("학습·검증 +2%p 미달(무작위 대비)")
if not (np.isfinite(g["ci"][0]) and g["ci"][0] > 0): why.append("검증 90% 구간 하한 ≤ 0")
if not (g["m"]["test"] >= 0): why.append("재확인 뒤집힘")
if not (g["dr"]["train"] >= 0 and g["dr"]["val"] >= 0): why.append("평균 수익이 무작위보다 낮음")
if not PASSED: why.insert(0, "통과한 패턴 칸 없음(점수 전부 0)")
APPLY = not why
print(f"  ■ 판정: {'적용 — 캔들 순위 = ' + CHO if APPLY else '적용 안 함 — ' + ' · '.join(why)}")

# 시간봉 고유 기간 성적(선택 후보 · 무작위 대비)
print("\n■ 5. 시간봉 고유 기간 — 선택 후보와 단독 후보의 2·4·8주(10·20·40일) · 1·3개월(21·63일) 상대 강도 Δ vs 무작위(학습/검증/재확인 %p)")
for key in [CHO, "일1·주0·월0", "일0·주1·월0", "일0·주0·월1"]:
    if key not in CANDS: continue
    s = " · ".join(f"{h}일 " + "/".join(pp(float(delta(key, 'rand', sp, h).mean())) for sp in SPN) for h in HTH)
    print(f"  {key}: {s}")

# 상충·일치(종목 단위 · 설명용): 그날 일봉 점수와 주·월봉 점수 방향
print("\n■ 6. 시간봉 일치·상충(종목 단위 · 설명용) — 그 종목 5일 상대 강도(같은 날 전 종목 가운데값 대비) · 학습+검증")
rows = []
for t in TK:
    if not all(t in STK[tf] for tf in TFB) or t not in OH: continue
    j = TK.index(t)
    for i, d in enumerate(DATES):
        a = [STK[tf][t][i] for tf in ("D", "W", "M")]
        if not all(np.isfinite(a)) or a == [0, 0, 0] or SPLIT[d] == "test": continue
        di = DPOS.get(pd.Timestamp(d))
        if di is None or not np.isfinite(FWD[5][di, j]): continue
        rows.append((np.sign(a[0]), np.sign(a[1]), np.sign(a[2]), float(FWD[5][di, j] > MED[5][di])))
if rows:
    X = pd.DataFrame(rows, columns=["d", "w", "m", "rs"])
    for lab, m in (("세 봉 모두 상승", (X.d > 0) & (X.w > 0) & (X.m > 0)), ("세 봉 모두 하락", (X.d < 0) & (X.w < 0) & (X.m < 0)),
                   ("일봉 상승 · 주/월 하락", (X.d > 0) & ((X.w < 0) | (X.m < 0))), ("일봉 하락 · 주/월 상승", (X.d < 0) & ((X.w > 0) | (X.m > 0))),
                   ("일봉만 상승(주·월 0)", (X.d > 0) & (X.w == 0) & (X.m == 0)), ("주·월만 상승(일 0)", (X.d == 0) & ((X.w > 0) | (X.m > 0)) & (X.w >= 0) & (X.m >= 0))):
        print(f"  {lab}: 5일 상대 강도 {pc(X.rs[m].mean())} ({int(m.sum())}건)")
else:
    print("  통과 패턴이 없어 해당 없음")

# ── 진행 중 봉(별도 · 참고 · 미사용): 주봉은 수요일 종가, 월봉은 10번째 거래일 종가까지의 미완성 봉으로 단일봉 모양 ──
print("\n■ 7. 진행 중 봉(참고 · 점수 미사용) — 통과한 주·월봉 단일봉 패턴을 미완성 봉에서 잡으면 같은 방향인가")
pw = [x for x in PASSED if x["tf"] in ("W", "M") and CP.PATTERNS[x["code"]][1] == 1]
if not pw: print("  해당 통과 패턴 없음 — 생략")
else:
    for x in pw:
        tf = x["tf"]; vals = []
        for t, df in OH.items():
            if t not in TFB[tf]: continue
            B = TFB[tf][t]; per = df.index.to_period("W-FRI" if tf == "W" else "M")
            for p, g in df.groupby(per):
                if len(g) < (3 if tf == "W" else 10) or str(g.index[0])[:10] < STOCK_START: continue
                part = g.iloc[:3] if tf == "W" else g.iloc[:10]
                prev = np.searchsorted(B["end"], np.datetime64(g.index[0]), side="left")
                if prev < 30: continue
                w0 = prev - 30      # ATR 14봉 + 패턴에 충분한 최근 30봉만
                O = np.r_[B["O"][w0:prev], part.Open.iloc[0]]; H = np.r_[B["H"][w0:prev], part.High.max()]; L = np.r_[B["L"][w0:prev], part.Low.min()]; C = np.r_[B["C"][w0:prev], part.Close.iloc[-1]]
                if not CP.detect(O, H, L, C)[x["code"]][-1]: continue
                di = DPOS[part.index[-1]]; j = TK.index(t); h = PRIM[tf]
                if np.isfinite(FWD[h][di, j]): vals.append((split_of(str(part.index[-1])[:10]), float(FWD[h][di, j] > MED[h][di])))
        V = pd.DataFrame(vals, columns=["sp", "rs"])
        print(f"  {TFN[tf]} {CP.PATTERNS[x['code']][0]}(진행 중): " + " · ".join(f"{SPK[sp]} {pc(V.rs[V.sp == sp].mean())}({int((V.sp == sp).sum())})" for sp in SPN) + " — 기준선 대비가 아닌 단순 상대 강도")

# ── 화면용 내보내기 ──
OUT = {"apply": APPLY, "why": why, "choice": CHO if APPLY else None, "weights": CANDS[CHO] if APPLY and isinstance(CANDS[CHO], tuple) else None,
       "sd": {tf: round(SD[tf], 6) for tf in SD}, "shrink": 2,
       "patterns": [dict(tf=x["tf"], code=x["code"], name=CP.PATTERNS[x["code"]][0], cell=x["cell"], cname=x["cname"], w=round(x["res"][PRIM[x["tf"]]]["train"][0], 4),
                         sgn=x["sgn"], textbook=CP.PATTERNS[x["code"]][2], n=x["res"]["n"],
                         h={str(h): {sp: [None if not np.isfinite(v) else round(float(v), 4) for v in x["res"][h][sp]] for sp in SPN} for h in (HS_(x["tf"]))})
                    for x in PASSED]}
if APPLY:
    st = {}
    for nm, days in (("all", COMMON), ("test", [d for d in COMMON if SPLIT[d] == "test"])):
        P, _ = dayrows(days, "cand", CHO); st[nm] = {}
        for rk in (1, 2, 3, 4, 5, "top5"):
            q = P if rk == "top5" else P[P.rk == rk]; e = {"n": int(len(q))}
            for h in SHORT:
                s = summ(q, h)
                if s: e.update({f"n{h}": s["n"], f"up{h}": round(s["up"], 4), f"rs{h}": round(s["rs"], 4), f"r{h}": round(s["r"], 3), f"med{h}": round(s["med"], 3), f"dn{h}": round(s["dn"], 4)})
            st[nm][str(rk)] = e
        st["period"] = st.get("period", {}); st["period"][nm] = f"{days[0]}~{days[-1]}" if days else ""
    OUT["stats"] = st
print("CANDLE_JSON " + json.dumps(OUT, ensure_ascii=False, separators=(",", ":")))
