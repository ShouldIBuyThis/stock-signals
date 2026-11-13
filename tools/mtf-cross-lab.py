#!/usr/bin/env python3
"""주봉·월봉 × 기존 신호 양방향 교집합 (사전 등록 docs/2026-11-13-mtf-cross.md · 읽기 전용 · 로그만)

입력: tools/mtf-export.js 출력(화면 함수로 낸 그날 신호 + 원장 종가 수익).
주봉·월봉: 야후 일봉(auto_adjust · 분할 보정) → 신호일 종가 시점에 완성된 봉만(그 주·달 마지막 거래일 ≤ 신호일).
거래량 = 거래대금(종가×거래량). 고점판독기 일봉 조건 = pattern_flags.peak_reader_flags(main.py와 같은 함수).
사용: python tools/mtf-cross-lab.py /tmp/mtf.json
"""
import json, sys, math
from itertools import combinations
import numpy as np, pandas as pd, yfinance as yf

sys.path.insert(0, ".")
import pattern_flags as PF

J = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "/tmp/mtf.json"))
R = pd.DataFrame(J["rows"], columns=J["fields"])
R["d"] = pd.to_datetime(R["d"]).astype("datetime64[ns]")
R = R.sort_values(["t", "d"]).reset_index(drop=True)
R["i"] = R.groupby("t").cumcount()
TICK = sorted(R["t"].unique())
SET = {t: ("A" if k % 2 == 0 else "B") for k, t in enumerate(TICK)}
R["set"] = R["t"].map(SET)
DATES = sorted(R["d"].unique()); MID = DATES[len(DATES) // 2]
R["half"] = np.where(R["d"] < MID, 0, 1)


def rsi(x, n=14):
    d = np.diff(x, prepend=np.nan); up = pd.Series(np.where(d > 0, d, 0.0)).ewm(alpha=1 / n, adjust=False).mean()
    dn = pd.Series(np.where(d < 0, -d, 0.0)).ewm(alpha=1 / n, adjust=False).mean()
    return (100 - 100 / (1 + up / dn.replace(0, np.nan))).to_numpy()


A_KEYS = ["VSPK", "VDRY", "VFADE", "SLOW", "HOLD", "DBOT", "RSIDIV", "FLOW", "REC"]
B_KEYS = ["VSPK", "VDRY", "RUNDRY", "UPSLOW", "WICK", "RSIHOT", "RSIBEAR", "FLOWWK", "BRK"]
KNM = {"VSPK": "거래대금 급증(2배)", "VDRY": "거래대금 고갈(0.6배)", "VFADE": "거래대금 3봉 연속 감소", "SLOW": "하락 둔화", "HOLD": "저점 유지",
       "DBOT": "쌍바닥", "RSIDIV": "RSI 상승 다이버전스", "FLOW": "OBV·CMF 개선", "REC": "추세 회복", "RUNDRY": "급등 뒤 거래대금 고갈",
       "UPSLOW": "상승 둔화", "WICK": "고점 윗꼬리", "RSIHOT": "RSI 70↑", "RSIBEAR": "RSI 하락 다이버전스", "FLOWWK": "OBV·CMF 약화", "BRK": "추세 이탈"}
TFN = {"W": "주봉", "M": "월봉"}


def bars(d, rule):
    B = d.resample(rule).agg({"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum", "DV": "sum"})
    B["last"] = d["Close"].resample(rule).apply(lambda s: s.index[-1] if len(s) else pd.NaT)
    return B.dropna(subset=["Close", "last"])


def tf_feats(B, tf):
    o, h, l, c, v, vol = (B[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "DV", "Volume"))
    n = len(c); k = 8 if tf == "W" else 6; R14 = rsi(c)
    ma = pd.Series(c).rolling(20 if tf == "W" else 6).mean().to_numpy()
    obv = np.cumsum(np.sign(np.r_[0, np.diff(c)]) * vol); rng = np.where(h - l > 0, h - l, np.nan)
    mfv = np.nan_to_num(((c - l) - (h - c)) / rng, nan=0) * vol
    hiwin = 52 if tf == "W" else 12; jmin = max(hiwin, 26 if tf == "W" else 14)
    out = {f"{tf}_{x}": np.zeros(n, bool) for x in set(A_KEYS + B_KEYS)}
    for j in range(jmin, n):
        ap = v[j - k:j].mean(); f = {}
        f["VSPK"] = ap > 0 and v[j] >= 2 * ap; f["VDRY"] = ap > 0 and v[j] <= 0.6 * ap
        f["VFADE"] = v[j] < v[j - 1] < v[j - 2]
        rl, rp = c[j] / c[j - 3] - 1, c[j - 3] / c[j - 6] - 1
        f["SLOW"] = rp < 0 and rl > rp
        f["HOLD"] = l[j - 1:j + 1].min() >= l[j - 5:j - 1].min()
        a0, a1, b0 = (j - 12, j - 3, j - 3) if tf == "W" else (j - 8, j - 2, j - 2)
        i1 = a0 + int(np.argmin(l[a0:a1])); L1 = l[i1]; i2 = b0 + int(np.argmin(l[b0:j + 1])); L2 = l[i2]
        mid = h[i1 + 1:i2].max() if i2 > i1 + 1 else 0
        f["DBOT"] = L1 > 0 and abs(L2 / L1 - 1) <= 0.03 and mid >= L1 * 1.10 and c[j] >= L2 * 1.03
        low6 = c[j] <= c[j - 5:j + 1].min() * 1.02
        f["RSIDIV"] = bool(low6 and np.isfinite(R14[j]) and R14[j] > np.nanmin(R14[j - 5:j]))
        cmf = mfv[j - 2:j + 1].sum() / max(vol[j - 2:j + 1].sum(), 1)
        f["FLOW"] = bool((low6 and obv[j] > obv[j - 5:j + 1].min()) or cmf > 0)
        w = 4 if tf == "W" else 3
        f["REC"] = bool(np.isfinite(ma[j]) and c[j] > ma[j] and np.any(c[j - w:j] <= ma[j - w:j]))
        f["RUNDRY"] = (c[j - 1] / c[j - 4] - 1) >= (0.20 if tf == "W" else 0.30) and ap > 0 and v[j] <= 0.7 * ap
        f["UPSLOW"] = rp >= 0.10 and rl < rp / 2
        hp = h[j - hiwin:j].max(); uw = (h[j] - max(o[j], c[j])) / rng[j] if np.isfinite(rng[j]) else 0
        f["WICK"] = bool(h[j] >= hp * 0.97 and uw >= 0.5)
        f["RSIHOT"] = bool(np.isfinite(R14[j]) and R14[j] >= 70)
        h12 = h[j - 12:j].max()
        f["RSIBEAR"] = bool(h[j] >= h12 and np.isfinite(R14[j]) and R14[j] < np.nanmax(R14[j - 12:j]) - 5)
        f["FLOWWK"] = bool((h[j] >= h12 * 0.97 and obv[j] < obv[j - 12:j].max()) or cmf < 0)
        f["BRK"] = bool(np.isfinite(ma[j]) and np.isfinite(ma[j - 1]) and c[j] < ma[j] and c[j - 1] >= ma[j - 1])
        for x, val in f.items(): out[f"{tf}_{x}"][j] = bool(val)
    F = pd.DataFrame(out); F["last"] = pd.to_datetime(B["last"].to_numpy()).astype("datetime64[ns]"); return F.dropna(subset=["last"])


FEAT_COLS = None; KIND = {}; SPLITS = {}
pieces = []
for t in TICK:
    sub = R[R["t"] == t]
    try:
        tk = yf.Ticker(t); df = tk.history(period="max", interval="1d", auto_adjust=True)
        try: KIND[t] = (tk.history_metadata or {}).get("instrumentType", "")
        except Exception: KIND[t] = ""
        try: SPLITS[t] = [(str(d.date()), float(r)) for d, r in tk.splits.items() if r and r != 1][-3:]
        except Exception: SPLITS[t] = []
    except Exception as e:
        print("  실패", t, e); continue
    if df is None or len(df) < 300: print("  건너뜀", t, 0 if df is None else len(df)); continue
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(); df.index = pd.DatetimeIndex(pd.to_datetime([x.date() for x in df.index])).astype("datetime64[ns]")
    df = df[df.index >= sub["d"].min() - pd.Timedelta(days=365 * 8)]
    df["DV"] = df["Close"] * df["Volume"]
    lev = float(sub["lev"].iloc[0] or 1)
    fl = PF.peak_reader_flags(df["Open"].values, df["High"].values, df["Low"].values, df["Close"].values, df["Volume"].values, lev=lev, ticker=t)
    rmx = lambda a, k=5: pd.Series(np.asarray(a, float)).rolling(k, min_periods=1).max().to_numpy() > 0.5
    anyc = np.zeros(len(df), bool)
    for code in PF.PR_GROUPS:
        if code in fl: anyc |= np.asarray(fl[code], bool)
    V = df["Volume"]
    with np.errstate(invalid="ignore", divide="ignore"):
        vr5 = (V.rolling(5).sum() / (5 * V.shift(5).rolling(20, min_periods=20).mean())).to_numpy()
    D = pd.DataFrame({"PR": rmx(fl["RUN"]) & rmx(anyc), "D_VBEAR": rmx(fl["VOL_BEAR"]), "D_VSTALL": rmx(fl["VOL_STALL"]),
                      "D_VR16": np.nan_to_num(vr5, nan=0) >= 1.6, "D_VDN": (V.rolling(5).mean() < V.rolling(20).mean()).to_numpy()}, index=df.index)
    D["PRV"] = D["PR"] & (D["D_VBEAR"] | D["D_VSTALL"] | D["D_VR16"])
    W = tf_feats(bars(df, "W-FRI"), "W"); M = tf_feats(bars(df, "ME"), "M")
    s2 = sub[["d"]].copy(); s2["_ix"] = sub.index
    s2 = pd.merge_asof(s2.sort_values("d"), W.sort_values("last"), left_on="d", right_on="last", direction="backward").drop(columns=["last"])
    s2 = pd.merge_asof(s2.sort_values("d"), M.sort_values("last"), left_on="d", right_on="last", direction="backward").drop(columns=["last"])
    s2 = s2.merge(D, left_on="d", right_index=True, how="left")
    pieces.append(s2.set_index("_ix").drop(columns=["d"]))
X = pd.concat(pieces)
R = R.join(X, how="inner")
for col in X.columns: R[col] = R[col].fillna(False).astype(bool)
R["grp"] = np.where(R["lev"] > 1, "레버리지", np.where(R["t"].map(KIND) == "ETF", "일반 ETF", "개별주"))
R["cau"] = R["cau"].astype(bool); R["ccz"] = (R["ph"] == "caution") & (R["kr"] == 0)
R["TRIM"] = R["trim"].fillna("") != ""
print(f"행 {len(R)} · 종목 {R['t'].nunique()} · {DATES[0].date()}~{DATES[-1].date()} · 앞/뒤 경계 {pd.Timestamp(MID).date()} · 분류 {R.groupby('grp')['t'].nunique().to_dict()}")
print("분할(최근 3건): " + " · ".join(f"{t} {s}" for t, s in SPLITS.items() if s))

FA = [f"{tf}_{k}" for tf in ("W", "M") for k in A_KEYS]; FB = [f"{tf}_{k}" for tf in ("W", "M") for k in B_KEYS]
nm = lambda c: f"{TFN[c[0]]} {KNM[c[2:]]}"
cols = {c: R[c].to_numpy(bool) for c in set(FA + FB + ["PR", "PRV", "D_VBEAR", "D_VSTALL", "D_VR16", "D_VDN", "TRIM", "cau"]) }
for k in ("sb", "rev", "gold"): cols[k] = R[k].to_numpy(bool)
cols["NONE"] = np.ones(len(R), bool)
ti, ii = R["t"].to_numpy(), R["i"].to_numpy()
fr = {h: R[f"f{h}"].to_numpy(float) for h in (3, 5, 10, 20, 60)}
SETA = (R["set"] == "A").to_numpy(); HALF = R["half"].to_numpy(); GRP = R["grp"].to_numpy(); CCZ = R["ccz"].to_numpy(); DD = R["d"].to_numpy()


def dedupe(mask):
    idx = np.flatnonzero(mask); keep = []; last = {}
    for j in idx:
        t = ti[j]
        if t in last and ii[j] - last[t] < 5: continue
        last[t] = ii[j]; keep.append(j)
    return np.array(keep, int)


def wr(ix, h):
    a = fr[h][ix]; a = a[np.isfinite(a)]; w = (a > 1).sum(); l = (a < -1).sum()
    return (w / (w + l) if w + l else np.nan), len(a), (a.mean() if len(a) else np.nan), w, w + l


def orr(ix):
    a3, a5, a10 = fr[3][ix], fr[5][ix], fr[10][ix]; ok = np.isfinite(a3) & np.isfinite(a5) & np.isfinite(a10)
    a3, a5, a10 = a3[ok], a5[ok], a10[ok]; hit = (a3 < -1) | (a5 < -1) | (a10 < -1)
    return (hit.mean() if len(hit) else np.nan), len(hit), int(hit.sum()), [((x < -1).mean() if len(x) else np.nan) for x in (a3, a5, a10)], [(x.mean() if len(x) else np.nan) for x in (a3, a5, a10)]


def score(ix, side):
    return wr(ix, 10)[0] if side == "A" else orr(ix)[0]


def nn(ix, side): return wr(ix, 10)[4] if side == "A" else orr(ix)[1]


def wilson(k, n, z=1.96):
    if not n: return (np.nan, np.nan)
    p = k / n; d = 1 + z * z / n; c = (p + z * z / (2 * n)) / d; m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - m, c + m


def ptail(n, p, thr):
    if n == 0 or not np.isfinite(p): return 0.0
    k0 = int(math.floor(n * thr)) + 1
    if k0 > n: return 0.0
    if p <= 0: return 0.0
    if p >= 1: return 1.0
    if n > 3000:   # 정규 근사(큰 표본)
        z = (k0 - 0.5 - n * p) / math.sqrt(n * p * (1 - p)); return 0.5 * math.erfc(z / math.sqrt(2))
    lp, lq, lg = math.log(p), math.log(1 - p), math.lgamma(n + 1); s = 0.0
    for k in range(k0, n + 1): s += math.exp(lg - math.lgamma(k + 1) - math.lgamma(n - k + 1) + k * lp + (n - k) * lq)
    return s


pc = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:.0f}%"
sg = lambda x: "—" if x is None or not np.isfinite(x) else f"{x:+.1f}%"
pp = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:+.0f}%p"
grade = lambda n: "사용 가능" if n >= 50 else "방향만" if n >= 30 else "참고" if n >= 15 else "신뢰 불가"


def evaluate(side, anchors, feats):
    res = []; chance = 0.0; hit10 = 0; tested = 0
    for an in anchors:
        base_ix = dedupe(cols[an]); bA, bB = base_ix[SETA[base_ix]], base_ix[~SETA[base_ix]]
        sA, sB = score(bA, side), score(bB, side); sH = [score(base_ix[HALF[base_ix] == k], side) for k in (0, 1)]
        for combo in [(f,) for f in feats] + list(combinations(feats, 2)):
            m = cols[an].copy()
            for f in combo: m &= cols[f]
            if m.sum() < 6: continue
            ix = dedupe(m); a_ix, b_ix = ix[SETA[ix]], ix[~SETA[ix]]
            nA = nn(a_ix, side)
            if nA < 3 and nn(b_ix, side) < 3: continue
            cA, cB = score(a_ix, side), score(b_ix, side); cH = [score(ix[HALF[ix] == k], side) for k in (0, 1)]
            tested += 1
            if nA >= 6 and np.isfinite(sA):
                chance += ptail(nA, sA, sA + 0.10)
                if np.isfinite(cA) and cA >= sA + 0.10: hit10 += 1
            res.append(dict(side=side, an=an, combo=combo, ix=ix, cA=cA, cB=cB, sA=sA, sB=sB, cH=cH, sH=sH, n=nn(ix, side), nA=nA, nB=nn(b_ix, side)))
    return res, tested, chance, hit10


def verdict(r):
    iA, iB = r["cA"] - r["sA"], r["cB"] - r["sB"]
    if not (np.isfinite(iB) and iB > 0): return "탈락"
    if not (np.isfinite(iA) and iA > 0): return "보류"
    ix = r["ix"]; tk = pd.Series(ti[ix]).value_counts(); mx = tk.iloc[0] / len(ix) if len(ix) else 1
    halves_ok = all(np.isfinite(c) and np.isfinite(s) and c >= s for c, s in zip(r["cH"], r["sH"]))
    if iA >= 0.05 and iB >= 0.05 and halves_ok and r["n"] >= 30 and mx <= 0.25: return "강력 후보"
    return "추가 검증"


ORDER = {"강력 후보": 0, "추가 검증": 1, "보류": 2, "탈락": 3}
ANM = {"sb": "강한매수", "rev": "반등형 강한매수", "gold": "황금신호(일봉)", "cau": "주의장 강한매수", "NONE": "앵커 없음", "TRIM": "일부익절", "PR": "고점판독기", "PRV": "고점판독기 거래량"}


def detail(r):
    ix = r["ix"]; side = r["side"]; tk = pd.Series(ti[ix]).value_counts(); dts = pd.Series(DD[ix]).value_counts()
    head = f"{ANM[r['an']]} ∩ " + " ∩ ".join(nm(c) for c in r["combo"])
    gr = " · ".join(f"{g} {pc(score(ix[GRP[ix] == g], side))}({nn(ix[GRP[ix] == g], side)})" for g in ("레버리지", "일반 ETF", "개별주") if (GRP[ix] == g).any())
    cz = f"주의장 {pc(score(ix[CCZ[ix]], side))}({nn(ix[CCZ[ix]], side)}) · 그 밖 {pc(score(ix[~CCZ[ix]], side))}({nn(ix[~CCZ[ix]], side)})"
    if side == "A":
        hz = " · ".join(f"+{h} {pc(wr(ix, h)[0])} {sg(wr(ix, h)[2])}" for h in (3, 5, 10, 20, 60)); k, n_ = wr(ix, 10)[3], wr(ix, 10)[4]
    else:
        o = orr(ix); hz = f"OR {pc(o[0])}({o[2]}/{o[1]}) · 시점별 하락 {'·'.join(pc(x) for x in o[3])} · 평균 {'·'.join(sg(x) for x in o[4])}"; k, n_ = o[2], o[1]
    lo, hi = wilson(k, n_)
    return (f"{head}\n      A {pc(r['cA'])}({r['nA']}) · B {pc(r['cB'])}({r['nB']}) · 앵커 단독 A {pc(r['sA'])} B {pc(r['sB'])} → 개선 {pp(r['cA'] - r['sA'])} / {pp(r['cB'] - r['sB'])}"
            f" · 앞/뒤 {pc(r['cH'][0])}/{pc(r['cH'][1])} (앵커 {pc(r['sH'][0])}/{pc(r['sH'][1])})\n"
            f"      {hz} · 95% Wilson {pc(lo)}~{pc(hi)} · 표본 {r['n']}({grade(r['n'])}) · {len(dts)}일 · {len(tk)}종목 · 최대 종목 {tk.index[0]} {tk.iloc[0] / len(ix) * 100:.0f}% · 최대 날짜 {dts.iloc[0] / len(ix) * 100:.0f}%"
            f" · 빈도 월 {len(ix) / max(1, len(DATES) / 21):.1f}회\n      {gr} | {cz}")


def report(title, res, anchors, top=10):
    sel = [r for r in res if r["an"] in anchors]
    for r in sel: r["v"] = verdict(r); r["iB"] = r["cB"] - r["sB"]
    sel.sort(key=lambda r: (ORDER[r["v"]], -(r["iB"] if np.isfinite(r["iB"]) else -9), -r["n"]))
    cnt = pd.Series([r["v"] for r in sel]).value_counts().to_dict() if sel else {}
    print(f"\n■ {title} — 조합 {len(sel)} · 판정 {cnt}")
    for k, r in enumerate(sel[:top], 1): print(f"  {k}. [{r['v']}] " + detail(r))
    return sel


def baselines(side, anchors):
    for an in anchors:
        ix = dedupe(cols[an]); s = score(ix, side)
        extra = " · ".join(f"+{h} {pc(wr(ix, h)[0])}" for h in (3, 5, 10, 20, 60)) if side == "A" else f"시점별 {'·'.join(pc(x) for x in orr(ix)[3])}"
        print(f"  {ANM[an]:<12} {pc(s)}({nn(ix, side)}) A {pc(score(ix[SETA[ix]], side))} B {pc(score(ix[~SETA[ix]], side))} · 앞/뒤 {pc(score(ix[HALF[ix] == 0], side))}/{pc(score(ix[HALF[ix] == 1], side))}"
              f" · 주의장 {pc(score(ix[CCZ[ix]], side))}({nn(ix[CCZ[ix]], side)}) · {extra}")


print("\n■ 기준선 — A 매수(주 판정 +10일 승률 · 승 >+1% 패 <−1% 보합 제외)"); baselines("A", ["NONE", "sb", "rev", "gold", "cau"])
print("■ 기준선 — B 매도(주 판정 3·5·10일 OR 하락)"); baselines("B", ["NONE", "TRIM", "PR", "PRV"])
resA, tA, chA, hA = evaluate("A", ["sb", "rev", "gold", "cau", "NONE"], FA)
resB, tB, chB, hB = evaluate("B", ["TRIM", "PR", "PRV", "NONE"], FB)
print(f"\n다중 비교: A 갈래 조합 {tA} — A(탐색)에서 앵커 +10%p↑ 실제 {hA} · 우연 기대 {chA:.1f} | B 갈래 조합 {tB} — 실제 {hB} · 우연 기대 {chB:.1f}")
report("매수 TOP 10 (강한매수·반등형·황금·주의장 강매 ∩ 주봉·월봉)", resA, ["sb", "rev", "gold", "cau"])
report("일부익절 TOP 10 (일부익절 ∩ 주봉·월봉)", resB, ["TRIM"])
report("고점판독기 개선 TOP 10 (고점판독기·거래량 ∩ 주봉·월봉)", resB, ["PR", "PRV"])
report("참고: 앵커 없이 주봉·월봉만(매수 쪽 상위 5)", resA, ["NONE"], 5)
report("참고: 앵커 없이 주봉·월봉만(매도 쪽 상위 5)", resB, ["NONE"], 5)

print("\n■ 고점판독기 거래량 — 일봉 조건 vs 주봉·월봉 조건 (3·5·10일 OR 하락)")
base = dedupe(cols["PR"]); sb_ = score(base, "B")
for lab, m in [("고점판독기 단독", cols["PR"]), ("∩ 대량 음봉(일봉 2배·5일 안)", cols["PR"] & cols["D_VBEAR"]), ("∩ 거래량 폭증 뒤 정체(일봉·5일 안)", cols["PR"] & cols["D_VSTALL"]),
               ("∩ 5일 누적 1.6배↑(일봉)", cols["PR"] & cols["D_VR16"]), ("∩ 5일<20일 평균(일봉 둔화)", cols["PR"] & cols["D_VDN"]),
               ("∩ 주봉 거래대금 급증", cols["PR"] & cols["W_VSPK"]), ("∩ 주봉 거래대금 고갈", cols["PR"] & cols["W_VDRY"]), ("∩ 주봉 급등 뒤 고갈", cols["PR"] & cols["W_RUNDRY"]),
               ("∩ 월봉 거래대금 급증", cols["PR"] & cols["M_VSPK"]), ("∩ 월봉 거래대금 고갈", cols["PR"] & cols["M_VDRY"]), ("∩ 월봉 급등 뒤 고갈", cols["PR"] & cols["M_RUNDRY"]),
               ("∩ 일봉 거래량 아무거나 ∩ 주·월 거래대금 아무거나", cols["PRV"] & (cols["W_VSPK"] | cols["W_VDRY"] | cols["W_RUNDRY"] | cols["M_VSPK"] | cols["M_VDRY"] | cols["M_RUNDRY"]))]:
    ix = dedupe(m); o = orr(ix)
    print(f"  {lab:<34} OR {pc(o[0])}({o[1]}) 개선 {pp(o[0] - sb_)} · A {pc(score(ix[SETA[ix]], 'B'))} B {pc(score(ix[~SETA[ix]], 'B'))} · 앞/뒤 {pc(score(ix[HALF[ix] == 0], 'B'))}/{pc(score(ix[HALF[ix] == 1], 'B'))} · 시점별 {'·'.join(pc(x) for x in o[3])} · 평균 {'·'.join(sg(x) for x in o[4])}")
print("\n※ OR 성공은 세 시점 중 한 번이라도 1% 초과 하락 — 매도 수익 증거가 아니다. B(미사용)를 본 뒤 조합을 바꾸지 않았다. 산식·화면 변경 없음.")
