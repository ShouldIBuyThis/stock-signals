"""🔬 5차 — 고정밀 교집합 통합 연구. docs/2026-11-12-peak-combo.md 사전 등록(59d32c7 · f58e5fc) 그대로. CI 전용.
🟡 일부익절(주 평가 5일) · 🔴 고점판독(주 평가 10일) 따로 · 조합 전수 계산 · 탐색 = E·T·X+ZA · 봉인 검증 = ZB · NVDA 2026-10 진단.
사용: python tools/peak-combo-lab.py --cache <peak-precision-lab이 만든 pickle> --emit backtest/peak-combo.json
"""
import argparse, importlib.util, itertools, json, math, pickle, sys
from datetime import datetime, timezone
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)
import pattern_flags as pf


def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m


pp = _load("pp", "peak-precision-lab.py")
LEV, rmax, sh = pp.LEV, pp.rmax, pp.sh
T_END, EXP_START, MIN_N, COST = pp.T_END, pp.EXP_START, 4, 0.0015
ROLES = {"P": ["P_NEAR", "P_RT5", "P_H60"], "O": ["O_BB", "O_BBX", "O_RSI", "O_EXT"], "C": ["C_W", "C_SHOOT", "C_ESTAR", "C_BEAR", "C_FB"],
         "I": ["I_RSID", "I_MACD", "I_STO", "I_VST", "I_VDN"], "K": ["K_5", "K_20", "K_SUP"], "X": ["X_T", "X_MK", "X_BR", "X_RS"]}
NB = {"P_NEAR": ["P_NEAR93", "P_NEAR97"], "O_BB": ["O_BB70", "O_BB90"], "C_W": ["C_W40", "C_W60"], "P_RT5": ["P_RT3", "P_RT7"]}
BN = {"P_NEAR": "52주 고가 5% 안", "P_RT5": "5일 안 52주 고가 터치", "P_H60": "60일 고가 3% 안", "O_BB": "%B 80↑", "O_BBX": "볼밴 상단 이탈", "O_RSI": "RSI 75↑(3일 안)", "O_EXT": "이격 25%↑(3일 안)",
      "C_W": "윗꼬리 50%↑", "C_SHOOT": "유성형", "C_ESTAR": "석별형", "C_BEAR": "장대음봉", "C_FB": "신고가 돌파 실패", "I_RSID": "RSI 약세 다이버전스", "I_MACD": "MACD 약화", "I_STO": "스토캐스틱 과열권 데드",
      "I_VST": "거래량 폭증 뒤 정체", "I_VDN": "거래량 감소(5일<20일)", "K_5": "전일 저가·5일선 이탈", "K_20": "20일선 이탈", "K_SUP": "지지선 붕괴", "X_T": "테마 약화", "X_MK": "시장 내부 약화(4그룹)",
      "X_BR": "S&P500 신고가 참여 감소", "X_RS": "상대강도 약화"}
ALLB = [b for r in ROLES.values() for b in r] + [x for v in NB.values() for x in v]
HA, HB, PA, PB_, DA, DB = (1, 3, 5, 7), (3, 5, 7, 10, 20), 5, 10, 5, 7      # 평가 기간 · 주 평가 · 🟣 지정 기간
FH = (1, 3, 5, 7, 10, 20); GAP = 25


def blocks(t, o, h, l, c, v, lev, TW, MK, BR, RSW):
    n = len(c); z = np.zeros(n, bool)
    fl = pf.peak_reader_flags(o, h, l, c, v, lev=lev, ticker=t); rc, pb, _ = pf.risk_candle_flags(o, h, l, c, v, t)
    h52p = pd.Series(h).shift(1).rolling(251, min_periods=251).max().to_numpy(); ok = np.isfinite(h52p)
    s = pd.Series(c); ma20 = s.rolling(20).mean().to_numpy(); up = ma20 + 2 * s.rolling(20).std(ddof=0).to_numpy(); ma5 = s.rolling(5).mean().to_numpy()
    hh60 = pd.Series(h).rolling(60).max().to_numpy(); v5, v20 = pd.Series(v).rolling(5).mean().to_numpy(), pd.Series(v).rolling(20).mean().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        hi52 = np.fmax(h52p, h); TOUCH = ok & (h >= h52p * 0.99)
        rng = np.where(h - l > 0, h - l, np.nan); upw = np.nan_to_num((h - np.maximum(o, c)) / rng, nan=0); pbz = np.nan_to_num(pb, nan=-9)
        B = {"P_NEAR": ok & (c >= hi52 * 0.95), "P_NEAR93": ok & (c >= hi52 * 0.93), "P_NEAR97": ok & (c >= hi52 * 0.97),
             "P_RT5": rmax(TOUCH, 5), "P_RT3": rmax(TOUCH, 3), "P_RT7": rmax(TOUCH, 7), "P_H60": np.isfinite(hh60) & (h >= hh60 * 0.97),
             "O_BB": pbz >= 0.8, "O_BB70": pbz >= 0.7, "O_BB90": pbz >= 0.9, "O_BBX": np.isfinite(up) & (h > up),
             "O_RSI": rmax(fl["RSI_HOT"], 3), "O_EXT": rmax(fl["EXT"], 3),
             "C_W": upw >= 0.5, "C_W40": upw >= 0.4, "C_W60": upw >= 0.6, "C_SHOOT": np.asarray(rc["SHOOTS"], bool), "C_ESTAR": np.asarray(rc["ESTAR"], bool),
             "C_BEAR": np.asarray(rc["BIGBEAR"], bool), "C_FB": ok & (h >= h52p) & (c < h52p),
             "I_RSID": rmax(fl["RSI_DIV"], 3), "I_MACD": rmax(np.asarray(fl["MACD_FADE"], bool) | np.asarray(fl["MACD_DEAD"], bool), 3), "I_STO": rmax(fl["STOCH_DEAD"], 3),
             "I_VST": rmax(fl["VOL_STALL"], 3), "I_VDN": v5 < v20,
             "K_5": (c < sh(l)) & (c < ma5), "K_20": np.asarray(fl["MA20_BRK"], bool), "K_SUP": np.asarray(fl["SUP_BRK"], bool),
             "X_T": TW if TW is not None else z, "X_MK": MK if MK is not None else z, "X_BR": BR, "X_RS": RSW}
    return {k: np.asarray(a, bool) for k, a in B.items()}, fl, rc


def outcomes(o, h, l, c, lev):
    n = len(c); pc = sh(c)
    tr = np.fmax(h - l, np.fmax(np.abs(h - pc), np.abs(l - pc))); atr = pd.Series(tr).rolling(14).mean().to_numpy() / c
    nxt = lambda a, j: np.concatenate([a[j:], np.full(j, np.nan)])
    out = {"atr": atr}
    with np.errstate(invalid="ignore"):
        P = nxt(o, 1); bA = 1.5 * atr; fd = np.full(n, 99); fu = np.full(n, 99)
        for j in range(7, 0, -1):
            fd = np.where(nxt(l, j) <= P * (1 - bA), j, fd); fu = np.where(nxt(h, j) >= P * (1 + bA), j, fu)
        for N in HA: out[f"A{N}"] = (fd <= N) & (fd < fu)
        out["A_fd"], out["A_fu"] = fd, fu
        D = np.fmax(0.06, 3 * atr); gd = np.full(n, 99); gu = np.full(n, 99)
        for j in range(20, 0, -1):
            gd = np.where(nxt(l, j) <= c * (1 - D), j, gd); gu = np.where(nxt(h, j) >= c * (1 + D), j, gu)
        for N in HB: out[f"B{N}"] = (gd <= N) & (gd < gu)
        out["B_gd"], out["B_gu"] = gd, gu
        for N in FH: out[f"f{N}"] = nxt(c, N) / c - 1
        sold = P * (1 - COST) / c - 1
        for N in (3, 5, 7): out[f"tr{N}"] = sold / 3 + 2 * out[f"f{N}"] / 3
        hh10 = pd.Series(h).rolling(10).max().to_numpy(); lag = np.full(n, 9)
        for k in range(9, -1, -1): lag = np.where(sh(h, k) == hh10 if k else h == hh10, k, lag)
        drop = c / hh10 - 1
    i = np.arange(n)
    out["vA"] = (i + 7 < n) & np.isfinite(atr) & np.isfinite(P); out["vB"] = (i + 20 < n) & np.isfinite(atr)
    out["lag"] = lag; out["drop"] = drop; out["early"] = (lag <= 5) & (drop >= -0.08 * lev)
    return out


def wilson_lo(k, n, zc=1.645):
    if not n: return None
    p = k / n; d = 1 + zc * zc / n
    return (p + zc * zc / (2 * n) - zc * math.sqrt(p * (1 - p) / n + zc * zc / (4 * n * n))) / d


def binom_tail_gt(n, p, thr):
    """P(X/n > thr), X~Bin(n,p)."""
    if not (0 < p < 1) or n <= 0: return 0.0
    if n > 300:   # 큰 n은 정규 근사(오버플로 방지)
        return 0.5 * math.erfc(((thr * n + 0.5) - n * p) / math.sqrt(n * p * (1 - p)) / math.sqrt(2))
    k0 = int(math.floor(thr * n)) + 1; lp, lq = math.log(p), math.log(1 - p)
    return sum(math.exp(math.lgamma(n + 1) - math.lgamma(k + 1) - math.lgamma(n - k + 1) + k * lp + (n - k) * lq) for k in range(k0, n + 1))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--emit", default=""); ap.add_argument("--cache", required=True); a = ap.parse_args()
    Z = pickle.load(open(a.cache, "rb")); data, orig, newx, zset, sector, SP, Wl = (Z[k] for k in ("data", "orig", "newx", "zset", "sector", "SP", "Wl"))
    zs = sorted(t for t in zset if t in data); ZA, ZB = set(zs[0::2]), set(zs[1::2])
    cal = pd.DatetimeIndex(sorted(set().union(*[set(d.index) for d in data.values()]))); cald = np.array([str(x.date()) for x in cal]); cpos = {d: i for i, d in enumerate(cal)}
    qq = data["QQQ"]["Close"].reindex(cal).ffill(); q5, q10 = qq / qq.shift(5) - 1, qq / qq.shift(10) - 1; bull = (qq > qq.rolling(200).mean())
    try:
        gj = json.load(open(f"{ROOT}/backtest/group-breadth.json", encoding="utf-8")); ss = gj["state_series"]
        mkd = set(ss.get("R_DEF", [])) | set(ss.get("H_NDX", [])) | set(ss.get("H_SP", [])) | set(ss.get("ALL_DN", [])); MKs = pd.Series([d in mkd for d in cald], index=cal)
    except Exception as e:
        MKs = None; print(f"MK4 자료 없음: {e}")
    nhs, oks = {}, {}
    for t, d in data.items():
        hh = d["High"].rolling(252, min_periods=252).max(); oks[t] = hh.notna().reindex(cal, fill_value=False); nhs[t] = ((d["Close"] >= hh * 0.99) & hh.notna()).reindex(cal, fill_value=False)
    spm = [t for t in SP if t in data and t not in pp.DUP]
    spN = sum(oks[t].astype(int) for t in spm); spH = sum(nhs[t].astype(int) for t in spm); sphr5 = (spH / spN.where(spN > 0)).rolling(5).mean()
    BRs = ((sphr5 - sphr5.shift(5)) <= -0.02)
    groups = {}
    for t in orig:
        if t in Wl and t not in LEV and t in data: groups.setdefault("W:" + Wl[t][0], []).append(t)
    for t in spm:
        if t in sector: groups.setdefault("S:" + sector[t], []).append(t)
    gsum = {g: (sum(oks[t].astype(int) for t in ms), sum(nhs[t].astype(int) for t in ms)) for g, ms in groups.items()}
    def gof(t):
        if t in orig: return ("W:" + Wl[t][0]) if (t in Wl and t not in LEV) else None
        return ("S:" + sector[t]) if (t in sector and t in spm) else None
    def tw_of(t):
        g = gof(t)
        if g is None or g not in gsum or t not in groups[g]: return None
        N, NH = gsum[g]; n_ex = N - oks[t].astype(int); hr = ((NH - nhs[t].astype(int)) / n_ex.where(n_ex > 0)).where(N >= MIN_N)
        hr5 = hr.rolling(5).mean(); d5 = hr5 - hr5.shift(5); return (d5 <= -0.05) & (hr5.shift(5) > 0)

    # ── 종목별 블록·성과를 한 줄로 이어 붙인다(종목 사이 GAP칸 비움) ──
    tick = [t for t in orig + newx + zs if t in data]
    cols = {b: [] for b in ALLB}; OUT = {}; meta = {k: [] for k in ("tk", "di", "part", "sub", "bull", "lev")}; per = {}
    def push(d_, key, arr, fill): d_.setdefault(key, []).append(np.concatenate([arr, np.full(GAP, fill, dtype=np.asarray(arr).dtype)]))
    for ti, t in enumerate(tick):
        d = data[t]; o, h, l, c, v = (d[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume")); n = len(c); lev = LEV.get(t, 1)
        tw = tw_of(t); TW = tw.reindex(d.index).fillna(False).to_numpy(bool) if tw is not None else None
        MK = MKs.reindex(d.index).fillna(False).to_numpy(bool) if MKs is not None else None; BR = BRs.reindex(d.index).fillna(False).to_numpy(bool)
        r5, r10 = c / sh(c, 5) - 1, c / sh(c, 10) - 1
        with np.errstate(invalid="ignore"): RSW = (r5 < q5.reindex(d.index).to_numpy()) & (r10 < q10.reindex(d.index).to_numpy())
        B, fl, rc = blocks(t, o, h, l, c, v, lev, TW, MK, BR, RSW); oc = outcomes(o, h, l, c, lev)
        per[t] = (d.index, o, h, l, c, v, lev, TW, MK, BR, RSW, B, fl, rc, oc)
        for b in ALLB: push(cols, b, B[b], False)
        for k, arr in oc.items(): push(OUT, k, np.asarray(arr, float) if arr.dtype != bool else arr, (False if arr.dtype == bool else np.nan))
        ds = np.array([str(x.date()) for x in d.index])
        if t in LEV: part = np.full(n, 3); sub = np.full(n, "L", dtype=object)
        elif t in ZB: part = np.full(n, 2); sub = np.full(n, "ZB", dtype=object)
        elif t in ZA: part = np.full(n, 1); sub = np.full(n, "ZA", dtype=object)
        elif t in newx: part = np.full(n, 1); sub = np.full(n, "X", dtype=object)
        else:
            sub = np.where(ds >= EXP_START, "E", np.where(ds < T_END, "T", "")).astype(object); part = np.where(sub == "", 0, 1)
        push(meta, "tk", np.full(n, ti), -1); push(meta, "di", np.array([cpos[x] for x in d.index]), -1); push(meta, "part", part, 0); push(meta, "sub", sub, "")
        push(meta, "bull", bull.reindex(d.index).fillna(False).to_numpy(bool), False); push(meta, "lev", np.full(n, lev), 1)
    M = {b: np.concatenate(cols[b]) for b in ALLB}; O_ = {k: np.concatenate(v_) for k, v_ in OUT.items()}; MT = {k: np.concatenate(v_) for k, v_ in meta.items()}
    for k in list(O_):
        if k[0] in "AB" and k[1:].isdigit() or k in ("vA", "vB", "early"): O_[k] = O_[k].astype(bool)
    NT = len(MT["tk"]); print(f"종목 {len(tick)} (탐색 E·T·X {sum(t not in ZA and t not in ZB for t in tick)} · ZA {len(ZA)} · ZB {len(ZB)}) · 이어 붙인 봉 {NT:,}")
    part = MT["part"]; di = MT["di"]
    def events(mask):
        cs = np.concatenate([[0], np.cumsum(mask)]); i = np.arange(NT); prev = (cs[i] - cs[np.maximum(i - 5, 0)]) > 0
        return np.nonzero(mask & ~prev)[0]
    def rate(idx, hit):
        """(사건 수, 독립 날짜 수, 날짜 가중 적중률, 사건 단위 적중률, 적중 건수)"""
        if not len(idx): return 0, 0, None, None, 0
        hv = hit[idx].astype(float); u, inv, cnt = np.unique(di[idx], return_inverse=True, return_counts=True)
        return len(idx), len(u), float((hv / cnt[inv]).sum() / len(u)), float(hv.mean()), int(hv.sum())
    RD = {"A": {"roles": ["O", "C", "I", "X"], "H": HA, "prim": PA, "des": DA, "valid": O_["vA"], "name": "🟡 일부익절"},
          "B": {"roles": ["C", "I", "K", "X"], "H": HB, "prim": PB_, "des": DB, "valid": O_["vB"], "name": "🔴 고점판독"}}
    SPEC = {"U1 고점권∩볼밴상단∩RSI다이버전스∩윗꼬리": lambda m: m["P_NEAR"] & m["O_BB"] & m["I_RSID"] & m["C_W"],
            "U2 고점터치∩MACD약화∩거래량감소∩이탈": lambda m: m["P_RT5"] & m["I_MACD"] & m["I_VDN"] & m["K_5"],
            "U3 RSI과열∩볼밴이탈∩유성형∩테마약화": lambda m: m["O_RSI"] & m["O_BBX"] & m["C_SHOOT"] & m["X_T"],
            "U4 돌파실패∩스토캐스틱데드∩시장참여감소": lambda m: m["C_FB"] & m["I_STO"] & m["X_BR"],
            "U5 고점터치∩장대음봉∩RSI다이버전스∩테마약화∩시장약화": lambda m: m["P_RT5"] & m["C_BEAR"] & m["I_RSID"] & m["X_T"] & (m["X_MK"] | m["X_BR"])}
    SPEC_P = {"U1": "P_NEAR", "U2": "P_RT5", "U3": None, "U4": "P_RT5", "U5": "P_RT5"}
    RES = {}
    for rd, R in RD.items():
        valid = R["valid"]; prim = O_[f"{rd}{R['prim']}"]; ex = (part == 1) & valid; zb = (part == 2) & valid; lv_ = (part == 3) & valid
        base = {}
        for pb_ in ROLES["P"] + [None]:
            m = M[pb_] if pb_ else np.ones(NT, bool)
            base[pb_ or "ALL"] = {"ex": {N: rate(np.nonzero(m & ex)[0], O_[f"{rd}{N}"])[2] for N in R["H"]}, "zb": {N: rate(np.nonzero(m & zb)[0], O_[f"{rd}{N}"])[2] for N in R["H"]}}
        combos = []
        for k in range(1, 5):
            for rs in itertools.combinations(R["roles"], k):
                for pk in ROLES["P"]:
                    for pick in itertools.product(*[ROLES[r] for r in rs]): combos.append((pk,) + pick)
        combos = [(c_, None) for c_ in combos] + [((nm,), fn) for nm, fn in SPEC.items()]
        print(f"\n■ {R['name']} — 조합 {len(combos):,}개(사용자 지정 5개 포함) · 주 평가 {R['prim']}일")
        rows = []; rare = []; bysize = {}
        for cid, (cb, fn) in enumerate(combos):
            mask = fn(M) if fn else np.logical_and.reduce([M[b] for b in cb])
            ev = events(mask); ev = ev[valid[ev]]
            e1, e2 = ev[part[ev] == 1], ev[part[ev] == 2]
            n1, i1, w1, r1, k1 = rate(e1, prim); n2, i2, w2, r2, k2 = rate(e2, prim)
            pk = SPEC_P.get(cb[0][:2]) if fn else cb[0]; p0 = base[pk or "ALL"]["ex"][R["prim"]]
            rows.append((cid, len(cb) if not fn else 0, i1, w1, i2, w2, p0))
            if not fn and i1 >= 6: bysize.setdefault(len(cb), []).append((w1, i1))
            if (i1 >= 6 and w1 is not None and w1 > 0.65) or fn:
                rare.append((cid, cb, fn, ev, e1, e2, pk))
        tested6 = [r for r in rows if r[2] >= 6]; hi = [r for r in tested6 if r[3] is not None and r[3] > 0.65 and r[1] > 0]
        exp_chance = sum(binom_tail_gt(r[2], r[6], 0.65) for r in tested6 if r[6] is not None and r[1] > 0)
        zb6 = [r for r in rows if r[4] >= 6 and r[1] > 0]; zbhi = [r for r in zb6 if r[5] is not None and r[5] > 0.65]
        print(f"  탐색 독립 사건 6↑ 조합 {len(tested6):,} · 그중 65% 초과 {len(hi):,} (우연 기대 {exp_chance:.1f}) | ZB 6↑ {len(zb6):,} 중 65% 초과 {len(zbhi):,}(선별에 쓰지 않음 · 분포 참고)")
        for k in sorted(bysize): 
            ws = np.array([x[0] for x in bysize[k]]); ns = np.array([x[1] for x in bysize[k]])
            print(f"   {k}중 교집합: 조합 {len(ws):,} · 적중률 중앙 {np.median(ws)*100:.0f}% · 독립 사건 중앙 {np.median(ns):.0f} · 65% 초과 {(ws > 0.65).mean()*100:.1f}%")
        def detail(cb, fn, ev, pk):
            dz = {"combo": list(cb), "name": (cb[0] if fn else " ∩ ".join(BN[b] for b in cb)), "k": (None if fn else len(cb)), "parts": {}}
            for pn, pm in (("ex", 1), ("zb", 2), ("lev", 3)):
                e = ev[part[ev] == pm]; z = {}
                for N in R["H"]:
                    n_, i_, w_, r_, k_ = rate(e, O_[f"{rd}{N}"]); z[str(N)] = {"w": w_, "r": r_, "hit": k_, "miss": n_ - k_}
                    fr = O_[f"f{N}"][e]; fr = fr[np.isfinite(fr)]; dn, up_ = int((fr < -0.01).sum()), int((fr > 0.01).sum())
                    z[str(N)]["dn"] = dn / (dn + up_) if dn + up_ else None; z[str(N)]["avg"] = float(fr.mean()) if len(fr) else None
                z["n"] = len(e); z["ind"] = len(np.unique(di[e])); z["tickers"] = len(np.unique(MT["tk"][e]))
                if len(e):
                    hp = O_[f"{rd}{R['prim']}"][e]; z["wl"] = wilson_lo(int(hp.sum()), len(e)); b0 = base[pk or "ALL"][pn if pn != "lev" else "ex"][R["prim"]]
                    z["base"] = b0; z["imp"] = None if b0 is None or z[str(R['prim'])]["w"] is None else z[str(R['prim'])]["w"] - b0
                    z["bull"] = [int(hp[MT["bull"][e]].sum()), int(MT["bull"][e].sum())]; z["bear"] = [int(hp[~MT["bull"][e]].sum()), int((~MT["bull"][e]).sum())]
                    tc = pd.Series(MT["tk"][e]).value_counts(); yc = pd.Series([cald[x][:4] for x in di[e]]).value_counts()
                    z["max_ticker"] = [tick[int(tc.index[0])], round(float(tc.iloc[0] / len(e)), 3)]; z["max_year"] = [yc.index[0], round(float(yc.iloc[0] / len(e)), 3)]
                    z["early"] = float(O_["early"][e].mean()); z["lag_med"] = float(np.median(O_["lag"][e])); z["drop_med"] = float(np.nanmedian(O_["drop"][e]))
                    if rd == "A":
                        fd, fu = O_["A_fd"][e], O_["A_fu"][e]; N = R["prim"]
                        z["split"] = {"corr": float(((fd <= N) & (fd < fu)).mean()), "run": float(((fu <= N) & (fu < fd)).mean()), "both": float(((fd <= N) & (fd == fu)).mean()), "none": float(((fd > N) & (fu > N)).mean())}
                        z["trim5"] = float(np.nanmean(O_["tr5"][e])); z["hold5"] = float(np.nanmean(O_["f5"][e])); z["trim_win5"] = float(np.nanmean(O_["tr5"][e] > O_["f5"][e]))
                    else:
                        z["avg10"] = float(np.nanmean(O_["f10"][e]))
                    if pn == "zb" and z["ind"] >= 6:   # 날짜 군집 부트스트랩: 조합 − 같은 위치의 모든 날
                        u, inv = np.unique(di[e], return_inverse=True); dw = np.array([hp[inv == j].mean() for j in range(len(u))]); r_ = np.random.default_rng(7)
                        bs = [dw[r_.integers(0, len(dw), len(dw))].mean() for _ in range(2000)]; z["ci"] = [float(np.percentile(bs, 5)) - (b0 or 0), float(np.percentile(bs, 95)) - (b0 or 0)]
                    if z["ind"] <= 29 or pn == "zb":
                        z["events"] = [[tick[int(MT["tk"][x])], cald[di[x]], MT["sub"][x], int(O_[f"{rd}{R['prim']}"][x]), int(O_[f"{rd}{R['des']}"][x])] + [None if not np.isfinite(O_[f"f{N}"][x]) else round(float(O_[f"f{N}"][x]) * 100, 1) for N in (3, 5, 7)] for x in e[np.argsort(di[e])][:60]]
                dz["parts"][pn] = z
            exz, zbz = dz["parts"]["ex"], dz["parts"]["zb"]; P = str(R["prim"]); Dk = str(R["des"])
            dz["tier"] = "극소표본(6~9)" if exz["ind"] < 10 else "소표본(10~29)" if exz["ind"] < 30 else "검증 검토(30↑)"
            dz["rare"] = bool(exz["ind"] >= 6 and exz[P]["w"] is not None and exz[P]["w"] > 0.65)
            dz["replicate"] = "재현 확인 불가(ZB 6건 미만)" if zbz["ind"] < 6 else ("재현" if zbz[P]["w"] > 0.65 else "재현 실패")
            dz["purple_ex"] = bool(exz["ind"] >= 6 and exz[Dk]["w"] is not None and exz[Dk]["w"] >= 0.85); dz["purple_zb"] = bool(zbz["ind"] >= 6 and zbz[Dk]["w"] is not None and zbz[Dk]["w"] >= 0.85)
            ok = (zbz["ind"] >= 30 and zbz[P]["w"] >= 0.65 and zbz[P]["r"] >= 0.65 and (zbz.get("wl") or 0) >= 0.55 and (zbz.get("imp") or 0) >= 0.15 and zbz.get("ci", [None])[0] is not None and zbz["ci"][0] > 0
                  and zbz["max_ticker"][1] <= 0.20 and zbz["max_year"][1] <= 0.40 and ((zbz["trim5"] > zbz["hold5"]) if rd == "A" else (zbz["early"] >= 0.5 and zbz["avg10"] < 0)))
            dz["verdict"] = "검증 통과" if ok else ("미통과" if not dz["rare"] and not (zbz["ind"] >= 5 and zbz[P]["w"] is not None and zbz[P]["w"] >= 0.65) else
                             ("소표본 참고" if dz["replicate"] == "재현" else "미통과"))
            if not fn and (dz["replicate"] == "재현" or dz["purple_ex"]):   # 이웃 문턱
                nbz = {}
                for b in cb:
                    for alt in NB.get(b, []):
                        m2 = np.logical_and.reduce([M[alt if x == b else x] for x in cb]); e2_ = events(m2); e2_ = e2_[valid[e2_]]
                        nbz[alt] = {"ex": rate(e2_[part[e2_] == 1], prim)[1:3], "zb": rate(e2_[part[e2_] == 2], prim)[1:3]}
                dz["neighbors"] = nbz
            return dz
        det = [detail(cb, fn, ev, pk) for cid, cb, fn, ev, e1, e2, pk in rare]
        cand = [d_ for d_ in det if d_["rare"]]; rep_ = [d_ for d_ in cand if d_["replicate"] == "재현"]; nochk = [d_ for d_ in cand if d_["replicate"].startswith("재현 확인 불가")]
        shr = [d_["parts"]["ex"][str(R["prim"])]["w"] - d_["parts"]["zb"][str(R["prim"])]["w"] for d_ in cand if d_["parts"]["zb"]["ind"] >= 6]
        summ = {"combos": len(combos), "tested6": len(tested6), "gt65": len(hi), "chance": round(exp_chance, 1), "tiers": {t_: sum(d_["tier"].startswith(t_) for d_ in cand) for t_ in ("극소표본", "소표본", "검증 검토")},
                "replicated": len(rep_), "not_checkable": len(nochk), "rep_fail": len(cand) - len(rep_) - len(nochk), "passed": sum(d_["verdict"] == "검증 통과" for d_ in det),
                "purple_ex": sum(d_["purple_ex"] for d_ in det), "purple_both": sum(d_["purple_ex"] and d_["purple_zb"] for d_ in det), "shrink_mean": float(np.mean(shr)) if shr else None,
                "zb_gt65_any": len(zbhi), "zb_tested6": len(zb6),
                "by_size": {str(k): {"n": len(v_), "med_rate": float(np.median([x[0] for x in v_])), "med_ind": float(np.median([x[1] for x in v_])), "gt65": float(np.mean([x[0] > 0.65 for x in v_]))} for k, v_ in bysize.items()}}
        print(f"  ▶ 희귀 고적중 연구 후보(탐색 6건↑ ∧ 65% 초과) {len(cand)}개: 극소 {summ['tiers']['극소표본']} · 소 {summ['tiers']['소표본']} · 30↑ {summ['tiers']['검증 검토']} | ZB 재현 {len(rep_)} · 재현 실패 {summ['rep_fail']} · 확인 불가 {len(nochk)} | 검증 통과 {summ['passed']} | 🟣 탐색 {summ['purple_ex']} · ZB도 {summ['purple_both']} | 탐색→ZB 평균 하락 {'' if summ['shrink_mean'] is None else format(summ['shrink_mean']*100, '+.0f')}%p")
        pc = lambda x: "—" if x is None else f"{x * 100:.0f}"
        for d_ in sorted(det, key=lambda d_: (d_["k"] is not None, -(d_["parts"]["zb"]["ind"] >= 6), -(d_["parts"]["zb"].get(str(R["prim"]), {}).get("w") or 0)))[:45]:
            exz, zbz = d_["parts"]["ex"], d_["parts"]["zb"]; P = str(R["prim"])
            print(f"   {d_['name'][:70]:<70} | 탐색 {pc(exz[P]['w'])}% ({exz[P]['hit']}/{exz['n']} · 독립 {exz['ind']}) | ZB {pc(zbz[P]['w'])}% ({zbz[P]['hit']}/{zbz['n']} · 독립 {zbz['ind']}) | {d_['replicate']} · {d_['verdict']}{' · 🟣' if d_['purple_ex'] else ''}")
        det.sort(key=lambda d_: (-(d_["parts"]["zb"]["ind"] >= 6 and (d_["parts"]["zb"][str(R["prim"])]["w"] or 0) > 0.65), -(d_["parts"]["ex"][str(R["prim"])]["w"] or 0)))
        RES[rd] = {"name": R["name"], "prim": R["prim"], "des": R["des"], "horizons": list(R["H"]), "base": {k: {q: {str(n_): v_ for n_, v_ in w.items()} for q, w in b.items()} for k, b in base.items()}, "summary": summ,
                   "user5": [d_ for d_ in det if d_["k"] is None], "cands": [d_ for d_ in det if d_["k"] is not None][:400], "cands_total": len(cand)}

    # ── 자료 누수 점검 ──
    rs = np.random.default_rng(20261112); mism = chk = 0
    for _ in range(200):
        t = tick[rs.integers(len(tick))]; idx, o, h, l, c, v, lev, TW, MK, BR, RSW, B, fl, rc, oc = per[t]
        if len(c) < 400: continue
        i = int(rs.integers(300, len(c))); s_ = slice(0, i + 1)
        B2, _, _ = blocks(t, o[s_], h[s_], l[s_], c[s_], v[s_], lev, TW[s_] if TW is not None else None, MK[s_] if MK is not None else None, BR[s_], RSW[s_])
        chk += 1; mism += sum(bool(B2[b][i]) != bool(B[b][i]) for b in ALLB)
    print(f"\n■ 자료 누수 점검: {chk}쌍 × 블록 {len(ALLB)}개 — 불일치 {mism}건")

    # ── NVDA 2026-10 고점 진단(검증 표본 아님) ──
    nv = None
    if "NVDA" in per:
        idx, o, h, l, c, v, lev, TW, MK, BR, RSW, B, fl, rc, oc = per["NVDA"]; ds = [str(x.date()) for x in idx]
        win = [i for i, d_ in enumerate(ds) if "2026-09-20" <= d_ <= "2026-10-25"]
        if win:
            pk = max(win, key=lambda i: h[i]); fs = pf.flag_series(o, h, l, c, v, "NVDA"); ps = pf.peak_risk_series(o, h, l, c, fs["X_ESTAR"])
            rng = np.where(h - l > 0, h - l, np.nan); body = np.abs(c - o) / rng; v20 = pd.Series(v).rolling(20).mean().to_numpy(); hh60 = pd.Series(h).rolling(60).max().to_numpy()
            ma5, ma20 = pd.Series(c).rolling(5).mean().to_numpy(), pd.Series(c).rolling(20).mean().to_numpy(); rows = []
            for i in range(max(2, pk - 10), min(len(c), pk + 11)):
                es = {"첫 봉 양봉": bool(c[i-2] > o[i-2]), "첫 봉 몸통 60%↑": bool(body[i-2] >= 0.6), "별 몸통 30%↓": bool(body[i-1] <= 0.3), "별이 첫 봉 종가 근처 위": bool(min(o[i-1], c[i-1]) > c[i-2] * 0.995),
                      "셋째 봉 음봉": bool(c[i] < o[i]), "첫 봉 몸통 중간 아래 마감": bool(c[i] < (o[i-2] + c[i-2]) / 2), "첫 봉 고가가 60일 고점 3% 안": bool(h[i-2] > hh60[i-2] * 0.97)}
                like = bool(c[i-2] > o[i-2] and h[i-1] >= h[i-2] and body[i-1] <= 0.3 and c[i] < o[i] and c[i] < (o[i-2] + c[i-2]) / 2)
                fw = {str(N): (None if i + N >= len(c) else round(float(c[i + N] / c[i] - 1) * 100, 1)) for N in (3, 5, 7, 10)}
                rows.append({"d": ds[i], "rel": i - pk, "o": round(float(o[i]), 2), "h": round(float(h[i]), 2), "l": round(float(l[i]), 2), "c": round(float(c[i]), 2), "from_peak": round(float(c[i] / h[pk] - 1) * 100, 1),
                             "vol_x": round(float(v[i] / v20[i]), 2), "rsi": round(float(fl["_aux"]["rsi"][i]), 1), "on": [b for b in ALLB if b not in sum(NB.values(), []) and B[b][i]],
                             "estar": bool(fs["X_ESTAR"][i]), "estar_parts": es, "estar_like": like, "stage": int(ps["stage"][i]), "below_ma5": bool(c[i] < ma5[i]), "below_ma20": bool(c[i] < ma20[i]),
                             "rsi_div": bool(fl["RSI_DIV"][i]), "macd_fade": bool(fl["MACD_FADE"][i]), "macd_dead": bool(fl["MACD_DEAD"][i]), "fail_high": bool(fl["FAIL_HIGH"][i]), "fwd": fw})
            lowi = pk + int(np.argmin(l[pk:min(len(c), pk + 31)]))
            nv = {"peak": ds[pk], "peak_high": round(float(h[pk]), 2), "low_after": [ds[lowi], round(float(l[lowi]), 2), round(float(l[lowi] / h[pk] - 1) * 100, 1)], "rows": rows, "note": "수정주가 기준이라 사용자 제시 가격과 조금 다를 수 있음"}
            print(f"\n■ NVDA 진단 — 고점 {nv['peak']} 고가 {nv['peak_high']} → 이후 저점 {nv['low_after']}")
            for r_ in rows: print(f"   {r_['d']} ({r_['rel']:+d}) 종 {r_['c']} 고점대비 {r_['from_peak']}% 거래량 {r_['vol_x']}x RSI {r_['rsi']} | 단계 {r_['stage']} 석별 {int(r_['estar'])} 유사 {int(r_['estar_like'])} | {' '.join(r_['on'])} | 뒤 3·5·7·10일 {r_['fwd']['3']}·{r_['fwd']['5']}·{r_['fwd']['7']}·{r_['fwd']['10']}")
    if a.emit:
        out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "kind": "research", "doc": "docs/2026-11-12-peak-combo.md", "prereg": ["59d32c7", "f58e5fc"], "blocks": BN,
               "universe": {"explore_etx": sum(t not in ZA and t not in ZB and t not in LEV for t in tick), "za": len(ZA), "zb": len(ZB), "lev": sum(t in LEV for t in tick)},
               "period": [cald[0], cald[-1]], "leak_check": {"pairs": chk, "mismatch": int(mism)}, "readers": RES, "nvda": nv}
        json.dump(out, open(a.emit, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"), default=lambda x: x.item() if hasattr(x, "item") else str(x))
        print(f"\n→ {a.emit} 저장")


if __name__ == "__main__":
    main()
