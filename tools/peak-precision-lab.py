"""🔬 고점판독기 4차 — 고정밀 소수 신호. docs/2026-11-12-peak-precision.md 사전 등록(5f95c3a) 그대로. CI 전용(야후·위키백과).
후보 13개(S0~S3 · A · B · C · D · K · B∩D · C∩D · B∩MK4 · C∩MK4) · 묶음 E/T/X(재사용)·Z(미사용)·L(레버리지 따로) · 판정은 Z.
사용: python tools/peak-precision-lab.py --emit backtest/peak-precision.json
"""
import argparse, hashlib, importlib.util, json, math, pickle, sys, time
from datetime import datetime, timezone
import numpy as np, pandas as pd, yfinance as yf
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)
import pattern_flags as pf


def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m


bb = _load("bb", "bb-walk-lab.py"); gb = _load("gb", "group-breadth-lab.py")
EXTRA = ["QUBT", "SMCI", "MSTR", "COIN", "ARM", "CVNA", "UPST", "AFRM", "SOUN", "HOOD", "RIVN", "PLUG", "ENPH", "ZM", "PTON", "MRNA"]          # 2차 연구 EXTRA 중 미국
NEW = ("NFLX SHOP ROKU TTD TWLO OKTA CRSP SE MELI SNAP PINS SPOT TDOC W CHWY RBLX DOCU DKNG U SOFI PATH ENVX RUN FSLR SEDG CELH NVAX BNTX "
       "NIO XPEV LI GME AMC OPEN BYND FUBO LCID TQQQ TECL").split()                                                                       # 2차 연구 NEW 중 미국
LEV = {"SOXL": 3, "GDXU": 3, "NAIL": 3, "UYG": 2, "DUSL": 3, "FNGU": 3, "BULZ": 3, "TQQQ": 3, "TECL": 3}
DUP = {"GOOG", "FOX", "NWS"}
START, T_END, EXP_START = "2007-01-01", "2016-01-01", "2016-02-01"
H = (1, 3, 5, 7); COOL = 5; COST = 0.0015; CORR = 0.05; MIN_N = 4
CANDS = ["S0", "S1", "S2", "S3", "A", "B", "C", "D", "K", "B∩D", "C∩D", "B∩MK4", "C∩MK4"]
NAMES = {"S0": "종가 고점권(52주 고가 5% 안 ∩ %B 80↑)", "S1": "터치 후 밀림(5일 안 터치 ∩ 5봉 고가 −3%↓)", "S2": "터치 후 첫 약세 전환(전일 저가 이탈 음봉)",
         "S3": "약세 전환 뒤 20일선 이탈", "A": "고점권 상승 지속(거래량 유지 ∩ 테마 참여 증가) — 반대 가설", "B": "상승 동력 약화(5일 안 터치 ∩ 윗꼬리·돌파 실패 ∩ 모멘텀 약화)",
         "C": "추세 이탈 확인(B 뒤 5일 안 전일 저가·5일선 이탈)", "D": "테마 참여도 약화(고점권 ∩ 테마 약화 ∩ 상대강도 약화)", "K": "이탈 단독(B 없이 전일 저가·5일선 이탈)",
         "B∩D": "B ∩ 테마 약화 ∩ 상대강도 약화", "C∩D": "C ∩ 테마 약화 ∩ 상대강도 약화", "B∩MK4": "B ∩ 시장 내부 약화(4그룹)", "C∩MK4": "C ∩ 시장 내부 약화(4그룹)"}
NEED_GROUP = {"A", "D", "B∩D", "C∩D"}; NEED_MK = {"B∩MK4", "C∩MK4"}


def download(tickers):
    out = {}
    for i in range(0, len(tickers), 60):
        chunk = tickers[i:i + 60]; df = None
        for _ in range(3):
            try:
                df = yf.download(chunk, start=START, auto_adjust=True, group_by="ticker", threads=True, progress=False); break
            except Exception as e:
                print(f"  재시도 {i}: {e}"); time.sleep(3)
        if df is None: continue
        for t in chunk:
            try:
                d = df[t][["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Open", "High", "Low", "Close"])
                d = d[(d.Close > 0) & (d.High > 0) & (d.Low > 0)]
                d.index = pd.to_datetime([x.date() for x in d.index]); d = d[~d.index.duplicated(keep="last")]
                if len(d) >= 300: out[t] = d
            except Exception:
                pass
    return out


def rmax(a, k):
    return pd.Series(np.asarray(a, float)).rolling(k, min_periods=1).max().to_numpy() > 0.5


def sh(a, k=1):
    return pd.Series(np.asarray(a, float)).shift(k).to_numpy()


def flags(t, o, h, l, c, v, lev, TW, GUP, RSW, MK):
    """후보 13개의 봉별 bool. TW·GUP·RSW·MK는 같은 길이의 외부(테마·시장) 배열(None이면 계산 불가 → 전부 False)."""
    n = len(c); z = np.zeros(n, bool)
    fl = pf.peak_reader_flags(o, h, l, c, v, lev=lev, ticker=t)
    _, pb, _ = pf.risk_candle_flags(o, h, l, c, v, t)
    h52p = pd.Series(h).shift(1).rolling(251, min_periods=251).max().to_numpy(); ok = np.isfinite(h52p)
    with np.errstate(invalid="ignore", divide="ignore"):
        hi52 = np.fmax(h52p, h)
        TOUCH = ok & (h >= h52p * 0.99)
        RT5, RT10 = rmax(TOUCH, 5), rmax(TOUCH, 10)
        rng = np.where(h - l > 0, h - l, np.nan); W = np.nan_to_num((h - np.maximum(o, c)) / rng, nan=0) >= 0.5
        FB = ok & (h >= h52p) & (c < h52p)
        M3 = rmax(np.asarray(fl["RSI_DIV"], bool) | np.asarray(fl["MACD_FADE"], bool) | np.asarray(fl["STOCH_DEAD"], bool), 3)
        near = ok & (c >= hi52 * 0.95)
        S0 = near & (np.nan_to_num(pb, nan=-9) >= 0.8)
        hh5 = pd.Series(h).rolling(5).max().to_numpy()
        S1 = RT5 & (c <= hh5 * 0.97)
        lowp = sh(l); weak = (c < lowp) & (c < o)
        ma5, ma20 = pd.Series(c).rolling(5).mean().to_numpy(), pd.Series(c).rolling(20).mean().to_numpy()
        brk = (c < lowp) & (c < ma5)
        cross20 = (c < ma20) & (sh(c) >= sh(ma20))
        v5, v20 = pd.Series(v).rolling(5).mean().to_numpy(), pd.Series(v).rolling(20).mean().to_numpy()
        B = RT5 & (W | FB) & M3
    S2 = z.copy(); armed = False
    for i in range(n):
        if TOUCH[i]: armed = True
        if armed and RT5[i] and weak[i]: S2[i] = True; armed = False
        if not RT5[i]: armed = False
    S3 = rmax(sh(S2), 5) & cross20
    C = z.copy(); lastB = -99
    for i in range(n):
        if lastB >= 0 and 1 <= i - lastB <= 5 and brk[i]: C[i] = True; lastB = -99
        if B[i]: lastB = i
    Bprev = rmax(sh(B), 5)
    K = RT10 & brk & ~Bprev
    g = TW is not None
    DT = (TW & RSW) if g else z
    out = {"S0": S0, "S1": S1, "S2": S2, "S3": S3, "A": (S0 & (v5 >= v20) & GUP) if g else z, "B": B, "C": C, "D": near & DT, "K": K,
           "B∩D": B & DT, "C∩D": C & DT, "B∩MK4": (B & MK) if MK is not None else z, "C∩MK4": (C & MK) if MK is not None else z}
    return {k: np.asarray(a, bool) for k, a in out.items()}, RT10


def wilson_lo(k, n, zc=1.645):
    if not n: return None
    p = k / n; d = 1 + zc * zc / n
    return (p + zc * zc / (2 * n) - zc * math.sqrt(p * (1 - p) / n + zc * zc / (4 * n * n))) / d


def rate(v):
    v = np.asarray(v, float); v = v[np.isfinite(v)]
    dn, up = int((v < -0.01).sum()), int((v > 0.01).sum())
    return (dn / (dn + up) if dn + up else None), dn, up, (float(v.mean()) if len(v) else None)


def wrate(dates, v):
    v = np.asarray(v, float); okm = np.isfinite(v) & (np.abs(v) > 0.01)
    if not okm.any(): return None
    d = np.asarray(dates)[okm]; x = (v[okm] < 0).astype(float)
    _, inv, cnt = np.unique(d, return_inverse=True, return_counts=True); w = 1.0 / cnt[inv]
    return float((w * x).sum() / w.sum())


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--emit", default=""); ap.add_argument("--cache", default=""); a = ap.parse_args()
    Wl = bb.wl_names(); is_kr = lambda t: t.endswith(".KS") or t.endswith(".KQ")
    orig = [t for t in list(Wl) + [x for x in EXTRA if x not in Wl] if not is_kr(t)]
    newx = [t for t in NEW if t not in orig]
    sp = next(t for t in gb.wiki_tables("List of S&P 500 companies") if {"Symbol", "GICS Sector"} <= set(map(str, t.columns)))
    sector = {gb.ysym(s): str(sec) for s, sec in zip(sp["Symbol"], sp["GICS Sector"])}
    G, _ = gb.constituents()
    zset = [t for t in dict.fromkeys(list(G["SP"]) + list(G["NDX"])) if t not in orig and t not in newx and t not in DUP]
    allt = list(dict.fromkeys(orig + newx + zset + list(G["SP"]) + ["QQQ"]))
    print(f"종목: 관심·추가(E/T) {len(orig)} · 새 종목(X) {len(newx)} · 미사용(Z) {len(zset)} · 내려받기 {len(allt)}")
    data = download(allt)
    print(f"시세 확보 {len(data)} / {len(allt)}")
    # 재현성(2026-11-12 점검 #9): 받은 시세 전체의 해시와 마지막 날짜를 결과에 남긴다 — 같은 해시면 같은 입력이다.
    hh = hashlib.sha256()
    for t in sorted(data):
        df = data[t]; hh.update(t.encode()); hh.update(np.asarray([x.value for x in df.index], dtype=np.int64).tobytes())
        hh.update(np.round(df[["Open", "High", "Low", "Close", "Volume"]].to_numpy(float), 6).tobytes())
    data_hash = hh.hexdigest()[:16]; data_last = str(max(df.index[-1] for df in data.values()).date())
    print(f"입력 시세 해시 {data_hash} · 마지막 날짜 {data_last}")
    if a.cache:   # 5차 도구(peak-combo-lab.py)가 같은 시세·구성으로 돌도록 넘긴다(다시 내려받지 않음)
        pickle.dump({"data_hash": data_hash, "data_last": data_last, "data": data, "orig": orig, "newx": newx, "zset": zset, "sector": sector, "SP": list(G["SP"]), "Wl": Wl}, open(a.cache, "wb"))
    cal = pd.DatetimeIndex(sorted(set().union(*[set(d.index) for d in data.values()])))
    qq = data["QQQ"]["Close"].reindex(cal).ffill()
    q5, q10 = (qq / qq.shift(5) - 1), (qq / qq.shift(10) - 1); bull = (qq > qq.rolling(200).mean())
    try:
        gj = json.load(open(f"{ROOT}/backtest/group-breadth.json", encoding="utf-8")); ss = gj["state_series"]
        mkd = set(ss.get("R_DEF", [])) | set(ss.get("H_NDX", [])) | set(ss.get("H_SP", [])) | set(ss.get("ALL_DN", []))
        mk_from = gj["research"]["period"][0]; MKs = pd.Series([str(d.date()) in mkd for d in cal], index=cal)
        print(f"시장 내부 약화(MK4) {len(mkd)}일 · {mk_from}~ (group-breadth.json {gj['generated']})")
    except Exception as e:
        MKs, mk_from = None, None; print(f"MK4 자료 없음: {e}")

    # ── 테마 참여도(자기 종목 제외) — E·T: 관심종목 테마 / Z: S&P500 GICS 섹터 ──
    nhs, oks = {}, {}
    for t, d in data.items():
        hh = d["High"].rolling(252, min_periods=252).max()
        oks[t] = hh.notna().reindex(cal, fill_value=False); nhs[t] = ((d["Close"] >= hh * 0.99) & hh.notna()).reindex(cal, fill_value=False)
    groups = {}
    for t in orig:
        if t in Wl and t not in LEV and t in data: groups.setdefault("W:" + Wl[t][0], []).append(t)
    for t in G["SP"]:
        if t in data and t in sector and t not in DUP: groups.setdefault("S:" + sector[t], []).append(t)
    gsum = {g: (sum(oks[t].astype(int) for t in ms), sum(nhs[t].astype(int) for t in ms)) for g, ms in groups.items()}
    def gof(t):
        if t in orig: return ("W:" + Wl[t][0]) if (t in Wl and t not in LEV) else None
        return ("S:" + sector[t]) if (t in sector and t in G["SP"]) else None
    def gser(t, upto=None):
        g = gof(t)
        if g is None or g not in gsum or t not in groups[g]: return None
        N, NH = gsum[g]
        if upto is not None:   # 누수 점검용: 그날까지로 잘라 다시 계산
            ms = groups[g]; N = sum(oks[x].loc[:upto].astype(int) for x in ms); NH = sum(nhs[x].loc[:upto].astype(int) for x in ms)
            okt, nht = oks[t].loc[:upto], nhs[t].loc[:upto]
        else: okt, nht = oks[t], nhs[t]
        n_ex = N - okt.astype(int); hr = ((NH - nht.astype(int)) / n_ex.where(n_ex > 0)).where(N >= MIN_N)
        hr5 = hr.rolling(5).mean(); d5 = hr5 - hr5.shift(5)
        return ((d5 <= -0.05) & (hr5.shift(5) > 0)), (d5 > 0)

    PARTS = ("E", "T", "X", "Z", "L")
    ev = {c: {p: [] for p in PARTS} for c in CANDS}                 # 사건 dict 목록
    raw_n = {c: {p: 0 for p in PARTS} for c in CANDS}               # 쿨다운 전 켜진 날 수
    ctrl = {p: {"d": [], **{f"f{k}": [] for k in H}} for p in PARTS}
    s0all = {p: {"d": [], "f5": []} for p in PARTS}
    tyears = {p: 0.0 for p in PARTS}; store = {}
    def part_of(t, ds):
        if t in LEV: return np.array(["L"] * len(ds))
        if t in zset: return np.array(["Z"] * len(ds))
        if t in newx: return np.array(["X"] * len(ds))
        return np.where(ds >= EXP_START, "E", np.where(ds < T_END, "T", ""))
    for t in [x for x in orig + newx + zset if x in data]:
        d = data[t]; o, h, l, c, v = (d[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume")); n = len(c)
        ds = np.array([str(x.date()) for x in d.index]); lev = LEV.get(t, 1)
        gs = gser(t)
        TW = gs[0].reindex(d.index).fillna(False).to_numpy(bool) if gs else None; GUP = gs[1].reindex(d.index).fillna(False).to_numpy(bool) if gs else None
        r5, r10 = c / sh(c, 5) - 1, c / sh(c, 10) - 1
        with np.errstate(invalid="ignore"):
            RSW = (r5 < q5.reindex(d.index).to_numpy()) & (r10 < q10.reindex(d.index).to_numpy())
        MK = MKs.reindex(d.index).fillna(False).to_numpy(bool) if MKs is not None else None
        F, RT10 = flags(t, o, h, l, c, v, lev, TW, GUP, RSW, MK)
        store[t] = (d.index, o, h, l, c, v, lev, TW, GUP, RSW, MK, F)
        P = part_of(t, ds); bl = bull.reindex(d.index).fillna(False).to_numpy(bool)
        f = {k: np.concatenate([c[k:] / c[:-k] - 1, np.full(k, np.nan)]) for k in H}
        valid = np.arange(n) + 7 < n
        for p in set(P) - {""}:
            pm = P == p; tyears[p] += pm.sum() / 252.0
            cm = pm & RT10 & valid
            ctrl[p]["d"] += list(ds[cm])
            for k in H: ctrl[p][f"f{k}"] += list(f[k][cm])
            sm = pm & F["S0"] & valid; s0all[p]["d"] += list(ds[sm]); s0all[p]["f5"] += list(f[5][sm])
        thr = CORR * lev
        for cd in CANDS:
            last = -99
            for i in np.nonzero(F[cd])[0]:
                p = P[i]
                if not p: continue
                raw_n[cd][p] += 1
                if i - last <= COOL: continue
                last = i
                if i < 10 or i + 7 >= n: continue
                e = {"t": t, "d": ds[i], "p": p, "bull": bool(bl[i])}
                Pn = o[i + 1]
                for k in H: e[f"f{k}"] = float(f[k][i]); e[f"fo{k}"] = float(c[i + k] / Pn - 1)
                for N_ in (3, 5, 7):
                    jc = next((j for j in range(i + 1, i + 1 + N_) if l[j] <= Pn * (1 - thr)), None); ju = next((j for j in range(i + 1, i + 1 + N_) if h[j] >= Pn * (1 + thr)), None)
                    e[f"k{N_}"] = "none" if jc is None and ju is None else "corr" if ju is None or (jc is not None and jc < ju) else "run" if jc is None or ju < jc else "both"
                    sold = Pn * (1 - COST) / c[i] - 1
                    e[f"tr{N_}"] = sold / 3 + 2 * e[f"f{N_}"] / 3
                    lows = l[i + 1:i + 1 + N_] / c[i] - 1
                    e[f"mh{N_}"] = float(min(0.0, lows.min())); e[f"mt{N_}"] = float(min(0.0, (sold / 3 + 2 * lows / 3).min()))
                e["mfe"] = float(h[i + 1:i + 8].max() / c[i] - 1); e["mae"] = float(l[i + 1:i + 8].min() / c[i] - 1)
                w = h[i - 9:i + 1]; pk = i - 9 + int(len(w) - 1 - np.argmax(w[::-1]))
                e["lag"] = int(i - pk); e["drop"] = float(c[i] / h[pk] - 1); e["early"] = bool(e["lag"] <= 5 and e["drop"] >= -0.08 * lev)
                top = i - 10 + int(np.argmax(c[i - 10:i + 11])); e["lead"] = int(top - i); e["already"] = float(c[i] / c[top] - 1) if top < i else 0.0
                ev[cd][p].append(e)

    # ── 자료 누수 점검: 그날까지로 잘라 다시 계산한 값 = 전체 계산값 ──
    rs = np.random.default_rng(20261112); keys = list(store); mism = 0; checked = 0
    for _ in range(200):
        t = keys[rs.integers(len(keys))]; idx, o, h, l, c, v, lev, TW, GUP, RSW, MK, F = store[t]
        if len(c) < 400: continue
        i = int(rs.integers(300, len(c))); cut = slice(0, i + 1)
        gs = gser(t, upto=idx[i]) if checked % 5 == 0 else None     # 다섯 번에 한 번은 테마 배열도 그날까지로 다시 계산
        tw = gs[0].reindex(idx[cut]).fillna(False).to_numpy(bool) if gs else (TW[cut] if TW is not None else None)
        gu = gs[1].reindex(idx[cut]).fillna(False).to_numpy(bool) if gs else (GUP[cut] if GUP is not None else None)
        F2, _ = flags(t, o[cut], h[cut], l[cut], c[cut], v[cut], lev, tw, gu, RSW[cut], MK[cut] if MK is not None else None)
        checked += 1; mism += sum(bool(F2[k][i]) != bool(F[k][i]) for k in CANDS)
    print(f"\n■ 자료 누수 점검: {checked}쌍 × 후보 {len(CANDS)}개 — 불일치 {mism}건")

    # ── 집계 ──
    def boot(sd, sv, cd_, cv):
        """5일 하락 비율 차이(S − CTRL)의 날짜 군집 부트스트랩 90% 구간."""
        def agg(dd, vv):
            vv = np.asarray(vv, float); m = np.isfinite(vv) & (np.abs(vv) > 0.01); return pd.DataFrame({"d": np.asarray(dd)[m], "w": (vv[m] < 0).astype(float), "n": 1.0}).groupby("d").sum()
        A, Bc = agg(sd, sv), agg(cd_, cv)
        if not len(A) or not len(Bc): return [None, None]
        alld = sorted(set(A.index) | set(Bc.index)); A = A.reindex(alld, fill_value=0.0).to_numpy(); Bc = Bc.reindex(alld, fill_value=0.0).to_numpy()
        r = np.random.default_rng(7); D = len(alld); out = []
        for _ in range(2000):
            w = np.bincount(r.integers(0, D, D), minlength=D).astype(float)
            a_n, b_n = (w * A[:, 1]).sum(), (w * Bc[:, 1]).sum()
            if a_n and b_n: out.append((w * A[:, 0]).sum() / a_n - (w * Bc[:, 0]).sum() / b_n)
        return [float(np.percentile(out, 5)), float(np.percentile(out, 95))] if out else [None, None]
    CT = {}
    for p in PARTS:
        z = {"n": len(ctrl[p]["d"]), "dates": len(set(ctrl[p]["d"]))}
        for k in H:
            r_, _, _, avg = rate(ctrl[p][f"f{k}"]); z[f"dn{k}"] = r_; z[f"avg{k}"] = avg; z[f"dnw{k}"] = wrate(ctrl[p]["d"], ctrl[p][f"f{k}"])
        z["s0_dn5"] = rate(s0all[p]["f5"])[0]; z["s0_n"] = len(s0all[p]["d"]); CT[p] = z
    zd = sorted(ctrl["Z"]["d"]); zmid = zd[len(zd) // 2] if zd else None
    RES = {}
    for cd in CANDS:
        RES[cd] = {}
        for p in PARTS:
            E_ = ev[cd][p]
            if cd in NEED_MK and mk_from: cdm = [i for i, d_ in enumerate(ctrl[p]["d"]) if d_ >= mk_from]
            else: cdm = None
            z = {"n": len(E_), "raw_days": raw_n[cd][p], "tickers": len({e["t"] for e in E_}), "dates": len({e["d"] for e in E_}),
                 "per_ticker_year": round(len(E_) / tyears[p], 3) if tyears[p] else None}
            if not E_: RES[cd][p] = z; continue
            dts = [e["d"] for e in E_]
            for k in H:
                r_, dn, up, avg = rate([e[f"f{k}"] for e in E_]); z[f"dn{k}"] = r_; z[f"avg{k}"] = avg; z[f"dnw{k}"] = wrate(dts, [e[f"f{k}"] for e in E_])
                z[f"dno{k}"] = rate([e[f"fo{k}"] for e in E_])[0]
                if k == 5: z["wl5"] = wilson_lo(dn, dn + up); z["dec5"] = dn + up
            for N_ in (3, 5, 7):
                ks = [e[f"k{N_}"] for e in E_]; z[f"prac{N_}"] = {q: round(ks.count(q) / len(ks), 4) for q in ("corr", "run", "both", "none")}
                hold = np.array([e[f"f{N_}"] for e in E_]); trim = np.array([e[f"tr{N_}"] for e in E_])
                z[f"st{N_}"] = {"hold": float(hold.mean()), "trim": float(trim.mean()), "win": float((trim > hold).mean()), "mdd_hold": float(np.mean([e[f"mh{N_}"] for e in E_])), "mdd_trim": float(np.mean([e[f"mt{N_}"] for e in E_]))}
            z["mfe"] = float(np.mean([e["mfe"] for e in E_])); z["mae"] = float(np.mean([e["mae"] for e in E_]))
            z["lag_med"] = float(np.median([e["lag"] for e in E_])); z["drop_med"] = float(np.median([e["drop"] for e in E_])); z["early"] = float(np.mean([e["early"] for e in E_]))
            z["lead_med"] = float(np.median([e["lead"] for e in E_])); z["before_top"] = float(np.mean([e["lead"] >= 0 for e in E_])); z["already_med"] = float(np.median([e["already"] for e in E_]))
            tc = pd.Series([e["t"] for e in E_]).value_counts(); yc = pd.Series([e["d"][:4] for e in E_]).value_counts()
            z["max_ticker"] = [tc.index[0], round(float(tc.iloc[0] / len(E_)), 3)]; z["max_year"] = [yc.index[0], round(float(yc.iloc[0] / len(E_)), 3)]
            if zmid: z["half5"] = [rate([e["f5"] for e in E_ if e["d"] < zmid])[0], rate([e["f5"] for e in E_ if e["d"] >= zmid])[0]]
            bl_ = [e["f5"] for e in E_ if e["bull"]]; z["bull5"] = rate(bl_)[0]; z["bull_n"] = len(bl_)
            cdts = ctrl[p]["d"] if cdm is None else [ctrl[p]["d"][i] for i in cdm]
            cv = {k: (ctrl[p][f"f{k}"] if cdm is None else [ctrl[p][f"f{k}"][i] for i in cdm]) for k in H}
            cr = {k: rate(cv[k]) for k in H}; cw5 = wrate(cdts, cv[5])
            z["ctrl"] = {**{f"dn{k}": cr[k][0] for k in H}, "avg5": cr[5][3], "dnw5": cw5, "n": len(cdts)}
            z["diff"] = {str(k): (None if z[f"dn{k}"] is None or cr[k][0] is None else z[f"dn{k}"] - cr[k][0]) for k in H}
            z["diffw5"] = None if z["dnw5"] is None or cw5 is None else z["dnw5"] - cw5
            z["ci5"] = boot(dts, [e["f5"] for e in E_], cdts, cv[5])
            z["recent"] = [{"t": e["t"], "d": e["d"], "f3": round(e["f3"], 4), "f5": round(e["f5"], 4), "f7": round(e["f7"], 4), "lag": e["lag"], "drop": round(e["drop"], 4)} for e in sorted(E_, key=lambda e: e["d"])[-8:]]
            RES[cd][p] = z

    # ── 판정(사전 등록 §4) — Z 일반 주식 ──
    VER = {}
    ge = lambda x, y: x is not None and x >= y
    for cd in CANDS:
        z = RES[cd]["Z"]; n = z["n"]; fails = []
        if cd == "A":
            ups = {k: (None if z.get(f"dn{k}") is None else 1 - z[f"dn{k}"]) - (1 - z["ctrl"][f"dn{k}"]) for k in (3, 5, 7)} if n else {}
            ok = n >= 30 and all(ge(ups.get(k), 0.10) for k in (3, 5, 7)) and z["ci5"][1] is not None and z["ci5"][1] < 0 and all(x is not None and x < z["ctrl"]["dn5"] for x in z.get("half5", [None]))
            VER[cd] = {"verdict": "지속 확인" if ok else ("사례 참고" if n < 10 else "미확인"), "fails": []}; continue
        if n < 10: VER[cd] = {"verdict": "사례 참고", "fails": ["Z 사건 10건 미만"]}; continue
        t70 = all(ge(z.get(f"dn{k}"), 0.70) and ge(z.get(f"dnw{k}"), 0.70) for k in (3, 5, 7))
        if n < 30:
            VER[cd] = {"verdict": "소표본 참고" if (t70 and z["avg5"] is not None and z["avg5"] < 0) else "실패", "fails": ["Z 사건 30건 미만"] + ([] if t70 else ["3·5·7일 70% 미달"])}; continue
        chk = [
            ("1 사건 30↑·종목 15↑·날 20↑", n >= 30 and z["tickers"] >= 15 and z["dates"] >= 20),
            ("2 3·5·7일 모두 70%↑(사건 단위·날짜 가중 모두)", t70),
            ("3 5일 윌슨 90% 하한 60%↑", ge(z.get("wl5"), 0.60)),
            ("4 CTRL 대비 +15%p ∧ 하한>0", ge(z["diff"]["5"], 0.15) and ge(z.get("diffw5"), 0.15) and z["ci5"][0] is not None and z["ci5"][0] > 0),
            ("5 5일 평균 수익 <0 ∧ CTRL보다 낮음", z["avg5"] is not None and z["avg5"] < 0 and z["avg5"] < z["ctrl"]["avg5"]),
            ("6 1/3 익절 > 보유(5일) ∧ 조정 먼저 > 급등 먼저", z["st5"]["trim"] > z["st5"]["hold"] and z["prac5"]["corr"] > z["prac5"]["run"]),
            ("7 조기 경고 인정 50%↑", z["early"] >= 0.5),
            ("8 한 종목 ≤20% ∧ 한 해 ≤40%", z["max_ticker"][1] <= 0.20 and z["max_year"][1] <= 0.40),
            ("9 전·후반 60%↑ ∧ 상승 국면 60%↑", all(ge(x, 0.60) for x in z.get("half5", [None])) and (z["bull_n"] < 10 or ge(z["bull5"], 0.60))),
            ("10 재사용 E·T·X 무너지지 않음", all((RES[cd][p]["n"] < 30) or ge(RES[cd][p]["diff"]["5"], 0.05) for p in ("E", "T", "X"))),
        ]
        fails = [nm for nm, ok in chk if not ok]
        note = "개선은 있으나 목표 미달" if (fails and ge(z["diff"]["5"], 0.10) and z["ci5"][0] is not None and z["ci5"][0] > 0) else ""
        VER[cd] = {"verdict": "통과" if not fails else "실패", "fails": fails, "note": note}

    pc = lambda x: "—" if x is None else f"{x * 100:.0f}"; pr = lambda x: "—" if x is None else f"{x * 100:+.1f}"
    print("\n■ 대조군 CTRL(최근 10거래일 안 52주 고가 터치한 모든 종목·날) — 1·3·5·7일 하락 %")
    for p in PARTS: print(f"  {p}: {CT[p]['n']:>7,}종목·날 · {pc(CT[p]['dn1'])}·{pc(CT[p]['dn3'])}·{pc(CT[p]['dn5'])}·{pc(CT[p]['dn7'])} · 5일 평균 {pr(CT[p]['avg5'])}% · (S0 전체 5일 {pc(CT[p]['s0_dn5'])}%)")
    for cd in CANDS:
        print(f"\n▶ {cd} — {NAMES[cd]} → {VER[cd]['verdict']}{' · ' + VER[cd].get('note', '') if VER[cd].get('note') else ''}{' | 미달: ' + ' / '.join(VER[cd]['fails']) if VER[cd]['fails'] else ''}")
        for p in PARTS:
            z = RES[cd][p]
            if not z["n"]: print(f"   {p}: 사건 0"); continue
            ci = z["ci5"]
            print(f"   {p}: {z['n']:>5}건({z['tickers']}종목·{z['dates']}일 · 종목당 연 {z['per_ticker_year']}) 하락 {pc(z['dn1'])}·{pc(z['dn3'])}·{pc(z['dn5'])}·{pc(z['dn7'])}% (날짜가중 5일 {pc(z['dnw5'])}) · CTRL 대비 5일 {pr(z['diff']['5'])}%p [{pr(ci[0])}~{pr(ci[1])}] · 평균 {pr(z['avg3'])}·{pr(z['avg5'])}·{pr(z['avg7'])}% · "
                  f"조정먼저/급등먼저 5일 {pc(z['prac5']['corr'])}/{pc(z['prac5']['run'])}% · 5일 보유 {pr(z['st5']['hold'])} 익절 {pr(z['st5']['trim'])} · 늦음 {z['lag_med']:.0f}일·이미 {pr(z['drop_med'])}% · 조기 {pc(z['early'])}%")
    if a.emit:
        out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "kind": "research", "doc": "docs/2026-11-12-peak-precision.md", "prereg": "5f95c3a",
               "names": NAMES, "parts": {"E": "탐색(이미 본 자료) 2016-02~", "T": "재사용 검증 2008~2015", "X": "재사용 검증 새 종목", "Z": "미사용 S&P500∪나스닥100(E·T·X 제외)", "L": "레버리지(따로)"},
               "universe": {"orig": len([t for t in orig if t in data]), "x": len([t for t in newx if t in data]), "z": len([t for t in zset if t in data])},
               "period": [str(cal[0].date()), str(cal[-1].date())], "zmid": zmid, "mk_from": mk_from, "ticker_years": {p: round(v, 1) for p, v in tyears.items()},
               "leak_check": {"pairs": checked, "mismatch": int(mism)}, "data_hash": data_hash, "data_last": data_last, "ctrl": CT, "res": RES, "verdict": VER}
        json.dump(out, open(a.emit, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"\n→ {a.emit} 저장")


if __name__ == "__main__":
    main()
