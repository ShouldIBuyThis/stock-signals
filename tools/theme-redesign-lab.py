#!/usr/bin/env python3
"""앞설 테마 TOP3 산식 전면 재설계 연구 (사전 등록 docs/2026-11-18-theme-redesign.md · 읽기 전용 · 산식 불변)
입력: tools/theme-redesign-export.js 출력(화면 테마 행 · 현행 TOP3 · 종목 신호). 종목 일봉·주봉·월봉 지표 = 야후(auto_adjust · 그날까지 · 완성 봉만).
정답(성과)은 항상 화면 테마 행의 fwd(U0)로만 잰다. U1(대표 ETF 상위 보유종목 추가)은 지표 계산에만 쓴다.
사용: python tools/theme-redesign-lab.py /tmp/theme.json
"""
import json, sys, math, re
from itertools import combinations, product
import numpy as np, pandas as pd, yfinance as yf

sys.path.insert(0, "tools")
from mtf_feats import bars, tf_feats, rsi

X = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/theme.json"))
DATES = list(X["dates"]); DIX = pd.DatetimeIndex(pd.to_datetime(DATES))
TR_END, VA_END = "2022-01-01", "2024-01-01"
SPLIT = {d: ("train" if d < TR_END else "val" if d < VA_END else "test") for d in DATES}
ROWS = {d: [dict(zip(["name", "n", "m20", "br", "r5", "score", "f5", "f10", "c5", "c10"], r)) for r in X["rows"][d]] for d in DATES}
V0X = X["v0"]; MEM = X["members"]; SIG = X["sig"]
ETF = {"반도체·GPU": "SMH", "소프트웨어": "IGV", "빅테크": "MAGS", "금융": "XLF", "우주·UAM": "UFO", "데이터센터": "DTCR", "암호화폐": "WGMI", "양자컴퓨팅": "QTUM",
       "경기방어": "XLP", "헬스케어": "XLV", "산업재": "XLI", "에너지·원전": "NLR", "원자재·금": "GDX", "원자재·유가": "XLE", "원자재·희토류": "REMX", "방산·드론": "ITA",
       "주택": "ITB", "전기차·자율주행": "DRIV", "원자재·농산물": "MOO", "리츠": "VNQ"}

# ── 현행 themeMultiRank 재현(G 격자용) — 화면 결과와 날마다 같은지 확인한다 ──
SIGN_FN = [lambda r: None if r["score"] is None else -r["score"], lambda r: None if r["r5"] is None else -r["r5"],
           lambda r: None if r["m20"] is None else -r["m20"], lambda r: r["br"]]
def multirank(rows, w=(64, 58, 58, 58)):
    tops = []
    for k, fn in enumerate(SIGN_FN):
        if not w[k]: tops.append(set()); continue
        a = [(fn(r), r) for r in rows if fn(r) is not None]; a = sorted(a, key=lambda x: -x[0])[:3]; tops.append({x[1]["name"] for x in a})
    out = []
    for r in rows:
        hit = [k for k in range(4) if r["name"] in tops[k]]
        if hit: out.append((len(hit), sum(w[k] for k in hit), r["score"] if r["score"] is not None else 1e9, r["name"]))
    out.sort(key=lambda x: (-x[0], -x[1], x[2]))
    return [x[3] for x in out]
def wrank(rows, w):   # G: 가중 점수 = Σ w·[그 기준 TOP3] → 점수 → 추세 순위
    tops = []
    for k, fn in enumerate(SIGN_FN):
        a = [(fn(r), r) for r in rows if fn(r) is not None]; a = sorted(a, key=lambda x: -x[0])[:3]; tops.append({x[1]["name"] for x in a})
    sc = [(sum(w[k] for k in range(4) if r["name"] in tops[k]), r["score"] if r["score"] is not None else 1e9, r["name"]) for r in rows]
    sc = [x for x in sc if x[0] > 0]; sc.sort(key=lambda x: (-x[0], x[1])); return [x[2] for x in sc]
FULL0 = {d: multirank(ROWS[d]) for d in DATES}
par = [d for d in DATES if len(ROWS[d]) >= 5]
mism = [d for d in par if FULL0[d][:3] != V0X[d]]
print(f"기간 {DATES[0]}~{DATES[-1]} · {len(DATES)}일 · 학습 ~2021-12 {sum(SPLIT[d]=='train' for d in DATES)} · 검증 2022~23 {sum(SPLIT[d]=='val' for d in DATES)} · 최종 테스트 2024~ {sum(SPLIT[d]=='test' for d in DATES)}")
print(f"정합성: 현행 TOP3 파이썬 재현 {len(par) - len(mism)}/{len(par)}일 일치" + (f" · 불일치 예 {mism[:3]}" if mism else ""))

# ── 종목 지표(야후) ──
def fetch(t):
    try:
        df = yf.Ticker(t).history(period="max", interval="1d", auto_adjust=True)
        if df is None or len(df) < 260: return None
        df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
        df.index = pd.DatetimeIndex(pd.to_datetime([x.date() for x in df.index])).astype("datetime64[ns]")
        return df[df.index >= pd.Timestamp("2015-06-01")]
    except Exception: return None
def tk_feats(df):
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]; dv = c * v; F = pd.DataFrame(index=df.index)
    for n in (20, 50, 200): F[f"ab{n}"] = (c > c.rolling(n).mean()).astype(float).where(c.rolling(n).count() >= n)
    hh, ll = h.rolling(252, min_periods=252).max(), l.rolling(252, min_periods=252).min()
    F["hi52"] = (c >= hh * 0.99).astype(float).where(hh.notna()); F["lo52"] = (c <= ll * 1.01).astype(float).where(ll.notna())
    F["rsi"] = rsi(c.to_numpy()); m, sd = c.rolling(20).mean(), c.rolling(20).std(ddof=0); F["bb"] = ((c - (m - 2 * sd)) / (4 * sd)) * 100
    F["vr"] = v / v.shift(1).rolling(20).mean(); F["dvr"] = dv.rolling(5).sum() / (5 * dv.shift(5).rolling(20).mean())
    obv = (np.sign(c.diff().fillna(0)) * v).cumsum(); F["obvup"] = (obv > obv.shift(20)).astype(float)
    rng = (h - l).replace(0, np.nan); mfv = (((c - l) - (h - c)) / rng).fillna(0) * v; F["cmf"] = mfv.rolling(20).sum() / v.rolling(20).sum()
    F["up5"] = (c > c.shift(5)).astype(float)
    df2 = df.copy(); df2["DV"] = dv
    for rule, tf in (("W-FRI", "W"), ("ME", "M")):
        B = bars(df2, rule); fb = tf_feats(B, tf); cb = B["Close"].to_numpy(float); R = rsi(cb); ma = pd.Series(cb).rolling(20 if tf == "W" else 6).mean().to_numpy()
        T = pd.DataFrame({"last": pd.to_datetime(B["last"].to_numpy()).astype("datetime64[ns]"), f"{tf.lower()}_rsi50": (R > 50).astype(float), f"{tf.lower()}_trend": (cb > ma).astype(float),
                          f"{tf.lower()}_vspk": fb[f"{tf}_VSPK"].to_numpy(float), f"{tf.lower()}_flow": fb[f"{tf}_FLOW"].to_numpy(float), f"{tf.lower()}_rsidiv": fb[f"{tf}_RSIDIV"].to_numpy(float)})
        L = pd.DataFrame({"d": F.index}); L = pd.merge_asof(L, T.sort_values("last"), left_on="d", right_on="last", direction="backward")   # 그날까지 완성된 봉만
        for col in T.columns:
            if col != "last": F[col] = L[col].to_numpy()
    return F
TKF, START = {}, {}
def need(t):
    if t in TKF: return
    df = fetch(t); TKF[t] = tk_feats(df) if df is not None else None; START[t] = str(df.index[0].date()) if df is not None else None
U0 = {th: [m[0] for m in ms if not m[2] and m[1] == 1] for th, ms in MEM.items()}   # 미국 상장 · 레버리지 아님
for th, ts in U0.items():
    for t in ts: need(t)
U1, HOLD = {th: list(ts) for th, ts in U0.items()}, {}
for th, etf in ETF.items():
    if th not in U0: continue
    try:
        hd = yf.Ticker(etf).funds_data.top_holdings; syms = [s for s in list(hd.index) if re.fullmatch(r"[A-Z]{1,5}(-[A-Z])?", str(s))]
    except Exception as e: syms = []
    add = [s for s in syms if s not in U0[th]]; HOLD[th] = (etf, add)
    for s in add: need(s)
    U1[th] = U0[th] + [s for s in add if TKF.get(s) is not None]

# ── 자료 확보율(먼저 보고) ──
print("\n■ 0. 테마 구성·자료 확보율(U0 = 순위 계산 종목 중 미국 상장·레버리지 아님 · U1 = 대표 ETF 상위 보유종목 추가)")
yrs = list(range(2017, 2027))
for th in sorted(MEM, key=lambda k: -len(MEM[k])):
    allm = MEM[th]; ts = U0.get(th, [])
    cov = []
    for y in yrs:
        dd = [d for d in DIX if d.year == y]
        if not dd or not ts: cov.append("—"); continue
        have = np.mean([np.mean([1.0 if (TKF.get(t) is not None and d in TKF[t].index) else 0.0 for t in ts]) for d in dd[::20]]); cov.append(f"{have * 100:.0f}")
    late = [f"{t}({START.get(t, '?')[:4] if START.get(t) else '없음'})" for t in ts if not START.get(t) or START[t] > "2017-06-01"]
    e, add = HOLD.get(th, ("—", []))
    print(f"  {th:<10} 순위 종목 {len(allm)}(레버리지·한국 제외 {len(ts)}) · 연도별 자료 있음 % {' '.join(cov)} · 늦게 상장 {', '.join(late) or '없음'} · U1 {e} +{len([s for s in add if TKF.get(s) is not None])}")

# ── 테마 지표 패널 ──
FEATS_TK = ["ab20", "ab50", "ab200", "hi52", "lo52", "rsi", "bb", "vr", "dvr", "obvup", "cmf", "up5", "w_rsi50", "w_trend", "w_vspk", "w_flow", "w_rsidiv", "m_rsi50", "m_trend", "m_vspk", "m_flow", "m_rsidiv"]
def panel(U):
    P = {}
    for f in FEATS_TK:
        cols = {}
        for th, ts in U.items():
            fr = [TKF[t][f].reindex(DIX) for t in ts if TKF.get(t) is not None]
            if len(fr) >= 2: cols[th] = pd.concat(fr, axis=1).mean(axis=1, skipna=True).where(pd.concat(fr, axis=1).notna().sum(axis=1) >= 2)
        P[f] = pd.DataFrame(cols, index=DIX)
    hr, lr = P["hi52"], P["lo52"]; P["net"] = hr - lr
    hr5, lr5 = hr.rolling(5).mean(), lr.rolling(5).mean(); net5 = hr5 - lr5
    P.update({"hr5": hr5, "lr5": lr5, "net5": net5, "d3": net5 - net5.shift(3), "d5": net5 - net5.shift(5), "d10": net5 - net5.shift(10),
              "lrd5": lr5 - lr5.shift(5), "hrd5": hr5 - hr5.shift(5)})
    P["accel"] = P["d5"] - P["d5"].shift(5)
    nh = {}
    for th, ts in U.items():
        fr = [TKF[t]["hi52"].reindex(DIX).fillna(0) for t in ts if TKF.get(t) is not None]
        if fr: nh[th] = (pd.concat(fr, axis=1).rolling(5).max() > 0).sum(axis=1)
    NH = pd.DataFrame(nh, index=DIX)
    for k in (3, 5, 8): P[f"spread{k}"] = ((P["hrd5"] >= k / 100) & (NH >= 2) & (lr5 <= lr5.shift(5))).astype(float).where(hr5.notna())
    pk = lr5.shift(1).rolling(10).max(); P["lowstop"] = ((pk >= 0.10) & (lr5 <= pk - 0.05)).astype(float).where(lr5.notna())
    sb, tr = {}, {}
    for th, ms in MEM.items():
        s1 = [pd.Series({pd.Timestamp(d): v[0] for d, v in SIG.get(m[0], {}).items() if v[0] is not None}).reindex(DIX) for m in ms]
        s2 = [pd.Series({pd.Timestamp(d): v[1] for d, v in SIG.get(m[0], {}).items()}).reindex(DIX) for m in ms]
        if s1: sb[th] = pd.concat(s1, axis=1).mean(axis=1); tr[th] = pd.concat(s2, axis=1).mean(axis=1)
    P["sbfrac"], P["trimfrac"] = pd.DataFrame(sb, index=DIX), pd.DataFrame(tr, index=DIX)
    return P
P0 = panel(U0); P1 = panel(U1)
SITE = ["m20", "br", "r5", "negscore"]
CACHE = {}
def _dict(P):
    k = id(P)
    if k not in CACHE:
        CACHE[k] = {f: {ds: dict(zip(df.columns, row)) for ds, row in zip(DATES, df.to_numpy(float))} for f, df in P.items()}
    return CACHE[k]
RIX = {d: {r["name"]: r for r in ROWS[d]} for d in DATES}
def val(P, f, d, th):
    if f in SITE:
        r = RIX[d].get(th)
        if r is None: return np.nan
        v = -r["score"] if f == "negscore" else r[f]; return np.nan if v is None else v
    v = _dict(P).get(f, {}).get(d, {}).get(th, np.nan); return np.nan if v is None else float(v)
ALLF = SITE + FEATS_TK + ["net", "hr5", "lr5", "net5", "d3", "d5", "d10", "lrd5", "hrd5", "accel", "sbfrac", "trimfrac"]

# ── 산식 → 그날 TOP3 ──
EXCL = set()
def rows_of(d): return [r for r in ROWS[d] if r["name"] not in EXCL] if EXCL else ROWS[d]
def full_of(d): return multirank(rows_of(d)) if EXCL else FULL0[d]
def top3(d, kind, spec, P):
    rows = rows_of(d); names = [r["name"] for r in rows]; F0 = full_of(d); fill = F0 + [n for n in names if n not in F0]
    if len(rows) < 5: return None, 0
    if kind == "G": t = wrank(rows, spec); own = len(t[:3]); t = (t + [n for n in fill if n not in t])[:3]; return t, min(own, 3)
    if kind == "V0": return F0[:3], 3
    if kind in ("rank", "ranksum", "zsum"):
        terms = spec
        M = {th: [val(P, f, d, th) * sg for f, sg in terms] for th in names}
        ok = [th for th in names if all(np.isfinite(x) for x in M[th])]
        if kind == "rank": sc = {th: M[th][0] for th in ok}
        elif kind == "ranksum":
            sc = {th: 0.0 for th in ok}
            for k in range(len(terms)):
                order = sorted(ok, key=lambda th: -M[th][k])
                for i, th in enumerate(order): sc[th] -= i
        else:
            sc = {th: 0.0 for th in ok}
            for k in range(len(terms)):
                a = np.array([M[th][k] for th in ok]); mu, sd = (a.mean(), a.std()) if len(a) else (0, 1)
                for th in ok: sc[th] += (M[th][k] - mu) / (sd if sd > 0 else 1)
        t = sorted(ok, key=lambda th: (-sc[th], fill.index(th)))[:3]; own = len(t)
        return (t + [n for n in fill if n not in t])[:3], own
    if kind == "filter":   # spec = (조건 함수, 기준 지표)
        cond, base = spec; ok = [th for th in names if cond(P, d, th)]
        b = {th: val(P, base, d, th) for th in ok}; ok = sorted(ok, key=lambda th: (-(b[th] if np.isfinite(b[th]) else -9), fill.index(th)))[:3]
        return (ok + [n for n in fill if n not in ok])[:3], len(ok)
    raise ValueError(kind)

def judge(d, t, h):
    rows = rows_of(d); fk, ck = ("f5", "c5") if h == 5 else ("f10", "c10")
    if t is None or any(not r[ck] or r[fk] is None for r in rows): return None
    F = {r["name"]: r[fk] for r in rows}; v = sorted(F.values()); med = float(np.median(v)); m = float(np.mean([F[x] for x in t]))
    return (1 if m > med else 0, m - med, m)

CAND = [("V0 현행", "V0", None)]
for f in ALLF:
    CAND.append((f"단독 {f}↑", "rank", [(f, 1)])); CAND.append((f"단독 {f}↓", "rank", [(f, -1)]))
CAND += [("A 순신고가 강도", "rank", [("net5", 1)]),
         ("B 순위합 net5·신저가감소", "ranksum", [("net5", 1), ("lrd5", -1)]), ("B 가중합 net5·신저가감소", "zsum", [("net5", 1), ("lrd5", -1)]),
         ("C 순위합 net5·확산·신저가감소", "ranksum", [("net5", 1), ("hrd5", 1), ("lrd5", -1)]), ("C 가중합", "zsum", [("net5", 1), ("hrd5", 1), ("lrd5", -1)])]
for nmx, base in (("B", [("net5", 1), ("lrd5", -1)]), ("C", [("net5", 1), ("hrd5", 1), ("lrd5", -1)])):
    for kind in ("ranksum", "zsum"):
        CAND.append((f"D {nmx}+주봉 추세·거래대금 {kind}", kind, base + [("w_trend", 1), ("w_vspk", 1)]))
        CAND.append((f"E {nmx}+월봉 RSI·FLOW {kind}", kind, base + [("m_rsi50", 1), ("m_flow", 1)]))
for th_ in (0.4, 0.5, 0.6):
    CAND.append((f"F 일·주·월 상승 θ{th_}", "filter", (lambda P, d, th, q=th_: val(P, "ab20", d, th) >= q and val(P, "up5", d, th) >= 0.5 and val(P, "w_trend", d, th) >= q and val(P, "m_trend", d, th) >= q, "net5")))
for k in (3, 5, 8):
    CAND.append((f"C' 신고가 확산{k}%p 우선(net5)", "filter", (lambda P, d, th, k=k: val(P, f"spread{k}", d, th) == 1, "net5")))
CAND.append(("C' 신저가 둔화 우선(net5)", "filter", (lambda P, d, th: val(P, "lowstop", d, th) == 1, "net5")))
for w in product((0, 1, 2), repeat=4):
    if any(w): CAND.append((f"G 가중치 추세{w[0]}·5일{w[1]}·20일{w[2]}·폭{w[3]}", "G", w))
Hb = [("ab50", 1), ("up5", 1), ("net", 1), ("br", 1)]
CAND.append(("H 참여 종합(50일선·상승비율·net·폭)", "ranksum", Hb))
for sub in combinations(Hb, 3): CAND.append((f"H 참여 3개 {'·'.join(s[0] for s in sub)}", "ranksum", list(sub)))

def evalc(kind, spec, P, split, step=1):
    res = {5: [], 10: []}; own = []; dd = [d for d in DATES if SPLIT[d] == split][::step]
    for d in dd:
        t, o = top3(d, kind, spec, P)
        if t is None: continue
        own.append(o)
        for h in (5, 10):
            j = judge(d, t, h); z = judge(d, full_of(d)[:3], h)
            if j and z: res[h].append((d, j, z, t))
    return res, own
def summ(res, h):
    L = res[h]; n = len(L)
    if not n: return dict(n=0, hit=np.nan, hit0=np.nan, ex=np.nan, ret=np.nan, med=np.nan, d=np.nan)
    a = np.array([x[1][0] for x in L]); b = np.array([x[2][0] for x in L])
    return dict(n=n, hit=a.mean(), hit0=b.mean(), ex=np.mean([x[1][1] for x in L]), ret=np.mean([x[1][2] for x in L]), med=np.median([x[1][2] for x in L]),
                ret0=np.mean([x[2][2] for x in L]), d=a.mean() - b.mean(), diff=a - b)
rng = np.random.default_rng(7)
def boot(diff, B=10):
    if diff is None or len(diff) < 40: return (np.nan, np.nan)
    nb = len(diff) // B; out = []
    for _ in range(2000):
        idx = np.concatenate([np.arange(s, s + B) for s in rng.integers(0, len(diff) - B, nb)]); out.append(diff[idx].mean())
    return (float(np.percentile(out, 5)), float(np.percentile(out, 95)))

# 학습 → 검증 → (상위 10) 최종 테스트
print(f"\n■ 1. 탐색 — 산식 {len(CAND)}개(+전진 선택) · 학습에서 5일 현행 +2%p↑ ∧ 자기 점수로 TOP3를 2개↑ 채운 날 80%↑만 통과")
train = []
for nm, kind, spec in CAND:
    r, own = evalc(kind, spec, P0, "train"); s5 = summ(r, 5)
    cov = np.mean([o >= 2 for o in own]) if own else 0
    train.append((nm, kind, spec, s5, cov))
V0tr = next(x for x in train if x[0] == "V0 현행")[3]
# 전진 선택(학습만): z점수 합에 지표를 하나씩(방향 = 학습 단독 성적이 좋은 쪽)
single = {}
for nm, kind, spec, s5, cov in train:
    if nm.startswith("단독 ") and cov >= 0.8 and np.isfinite(s5["hit"]): f = spec[0]; single[(f[0], f[1])] = s5["hit"]
best_dir = {}
for (f, sg), h in single.items():
    if f not in best_dir or h > best_dir[f][1]: best_dir[f] = (sg, h)
sel, cur = [], None
for step in range(4):
    cand = []
    for f, (sg, _) in best_dir.items():
        if any(f == s[0] for s in sel): continue
        r, own = evalc("zsum", sel + [(f, sg)], P0, "train", step=2); cand.append((summ(r, 5)["hit"], f, sg))
    if not cand: break
    cand.sort(reverse=True); sel = sel + [(cand[0][1], cand[0][2])]
    CAND.append((f"전진선택 {len(sel)}개 z합 " + "·".join(f"{f}{'↑' if s > 0 else '↓'}" for f, s in sel), "zsum", list(sel)))
    r, own = evalc("zsum", sel, P0, "train"); train.append((CAND[-1][0], "zsum", list(sel), summ(r, 5), np.mean([o >= 2 for o in own])))
passed = [x for x in train if x[0] != "V0 현행" and x[4] >= 0.8 and np.isfinite(x[3]["hit"]) and x[3]["hit"] >= V0tr["hit"] + 0.02]
print(f"  현행 학습 5일 {V0tr['hit']*100:.1f}%({V0tr['n']}일) · 학습 통과 {len(passed)}개 / {len(train) - 1}")
val_ = []
for nm, kind, spec, s5tr, cov in passed:
    r, own = evalc(kind, spec, P0, "val"); a5, a10 = summ(r, 5), summ(r, 10)
    if a5["n"] and a5["d"] >= 0.02 and a10["hit"] >= a10["hit0"]: val_.append((a5["d"], nm, kind, spec, s5tr, a5, a10))
# 우연 기준: 무작위 순위 산식 200개의 검증 개선폭 최댓값
rnd = []
for k in range(200):
    seed = int(rng.integers(1e9)); rr = np.random.default_rng(seed); perm = {}
    def rk(d, rr=rr):
        nm_ = [r["name"] for r in ROWS[d]]; return list(rr.permutation(nm_))
    L = []
    for d in [x for x in DATES if SPLIT[x] == "val"]:
        if len(ROWS[d]) < 5: continue
        t = rk(d)[:3]; j = judge(d, t, 5); z = judge(d, FULL0[d][:3], 5)
        if j and z: L.append(j[0] - z[0])
    rnd.append(np.mean(L) if L else 0)
print(f"  검증 통과 {len(val_)}개 · 무작위 순위 200개의 검증 5일 개선폭: 중앙 {np.median(rnd)*100:+.1f}%p · 상위 5% {np.percentile(rnd, 95)*100:+.1f}%p · 최대 {max(rnd)*100:+.1f}%p")
val_.sort(key=lambda x: -x[0]); TOP = val_[:10]

PRE = ("A 순신고가 강도", "단독 net5↑")
print("\n■ 2. 최종 테스트(2024-01~ · 선정에 안 씀) — 상위 10 후보 vs 같은 날 현행 · 적중 = TOP3 평균 수익 > 그날 모든 테마 중앙값")
pc = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:.0f}%"; pp = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:+.1f}%p"; sg = lambda x: "—" if x is None or not np.isfinite(x) else f"{x:+.2f}%"
rt, _ = evalc("V0", None, P0, "test"); V5, V10 = summ(rt, 5), summ(rt, 10)
print(f"  현행: 5일 {pc(V5['hit'])}({V5['n']}) 평균 {sg(V5['ret'])} 중앙 {sg(V5['med'])} 초과 {sg(V5['ex'])} | 10일 {pc(V10['hit'])} 평균 {sg(V10['ret'])}")
YEARS = ("2024", "2025", "2026")
def regime(d):
    q = X["qqq"]; ds = sorted(q); i = ds.index(d) if d in ds else -1
    if i < 200: return None
    w = [q[x] for x in ds[i - 199:i + 1]]; ma = np.mean(w); r60 = q[d] / q[ds[i - 60]] - 1
    return "상승" if q[d] > ma and r60 > 0 else "하락" if q[d] < ma and r60 < 0 else "횡보"
for k, (dv, nm, kind, spec, s5tr, a5, a10) in enumerate(TOP, 1):
    r, own = evalc(kind, spec, P0, "test"); t5, t10 = summ(r, 5), summ(r, 10); lo, hi = boot(t5.get("diff"))
    picks = pd.Series([x for e in r[5] for x in e[3]]).value_counts(); topth = picks.index[0] if len(picks) else None
    EXCL.add(topth); rx, _ = evalc(kind, spec, P0, "test"); EXCL.clear(); exd = summ(rx, 5)["d"]
    nov = [e for i, e in enumerate(r[5]) if i % 5 == 0]; nvd = np.mean([e[1][0] - e[2][0] for e in nov]) if nov else np.nan
    yr = {y: [e[1][0] - e[2][0] for e in r[5] if e[0].startswith(y)] for y in YEARS}
    rg = {}
    for e in r[5]:
        g = regime(e[0])
        if g: rg.setdefault(g, []).append(e[1][0] - e[2][0])
    ok = (t5["hit"] >= 0.60 and t5["d"] >= 0.05 and np.isfinite(lo) and lo > 0 and t10["hit"] >= t10["hit0"] and t5["ret"] >= t5["ret0"]
          and np.isfinite(exd) and exd >= 0.03 and np.isfinite(nvd) and nvd >= 0.03 and all(len(yr[y]) >= 100 and np.mean(yr[y]) > 0 for y in YEARS))
    flag = " · ⚠ 사전 열람" if nm.startswith(PRE) else ""
    print(f"  {k:>2}. {'✅ 통과' if ok else '미통과'}{flag} · {nm}")
    print(f"      학습 5일 {pc(s5tr['hit'])}(현행 {pc(V0tr['hit'])}) · 검증 5/10일 {pc(a5['hit'])}/{pc(a10['hit'])}(현행 {pc(a5['hit0'])}/{pc(a10['hit0'])})")
    print(f"      테스트 5일 {pc(t5['hit'])}({t5['n']}일) 현행 대비 {pp(t5['d'])} [{pp(lo)}~{pp(hi)}] · 평균 {sg(t5['ret'])}(현행 {sg(t5['ret0'])}) 중앙 {sg(t5['med'])} 초과 {sg(t5['ex'])}"
          f" | 10일 {pc(t10['hit'])}(현행 {pc(t10['hit0'])}) 평균 {sg(t10['ret'])}(현행 {sg(t10['ret0'])})")
    print(f"      연도별 현행 대비 {' · '.join(f'{y} {pp(np.mean(yr[y]) if yr[y] else np.nan)}({len(yr[y])})' for y in YEARS)} · 국면 {' · '.join(f'{g} {pp(np.mean(v))}({len(v)})' for g, v in rg.items())}")
    print(f"      가장 많이 뽑힌 테마 {topth} {picks.iloc[0] / max(1, picks.sum()) * 100:.0f}% → 빼면 {pp(exd)} · 5일 간격 표본 {pp(nvd)}({len(nov)}) · 자기 점수로 채운 날 {np.mean([o >= 2 for o in own]) * 100:.0f}%")
    rU1, _ = evalc(kind, spec, P1, "test"); u5 = summ(rU1, 5)
    print(f"      U1(대표 ETF 보유종목 추가 · 생존 편향) 테스트 5일 {pc(u5['hit'])} 현행 대비 {pp(u5['d'])}")
print(f"\n※ 산식 {len(CAND)}개 탐색(G 격자 80 · 단독 {2 * len(ALLF)} 포함). 현재 관심종목 소급(생존 편향). 사이트 순위·매수·매도 산식은 바꾸지 않았다.")
