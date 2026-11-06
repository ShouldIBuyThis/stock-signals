#!/usr/bin/env python3
"""섹터(테마)별 기술적 신호 장기 백테스트 — 연구 전용 · 아무 파일도 안 고친다.

2026-11-05 사용자 인수인계 프롬프트 '섹터별 기술적 지표 최적화'의 1차 실행.
화면 산식(evaluate)을 바꾸는 도구가 아니다. 새 지표 설정(RSI 기간·볼밴 배수 등)을 탐색하므로
OHLC에서 직접 계산한다 — 화면 산식을 재구현하는 것이 아니다(방법론 §0과 충돌하지 않음).

설계 (사용자 프롬프트 §5~§6 그대로)
  · 야후 일봉 최대 10년(조정 OHLC). 지표는 그날 종가까지의 값만 쓴다.
  · 섹터마다 자기 데이터 기간을 시간순 60/20/20(학습/검증/테스트)으로 나눈다.
  · 하락(익절) 신호 적중 = h거래일 뒤 종가 < 신호일 종가. 상승(매수) 신호 적중 = 반대.
  · 같은 종목의 신호가 h일 안에 다시 나오면 첫 신호만 센다(관찰 기간 겹침 제거).
  · 같은 섹터에서 같은 날 여러 종목이 신호를 내면 그날 하루 = 1건(적중은 그날 종목 평균).
    QQQ·TQQQ·나스닥100처럼 같은 지수를 세 번 세지 않으려고.
  · 조건 선정은 학습·검증만 쓴다. 테스트는 선정된 규칙 하나와 고정 규칙 하나에만 한 번 연다.
  · 다중검정: 후보 수를 같이 찍고, 테스트 p값은 비교 묶음 수로 Bonferroni 보정한 기준과 같이 본다.
사용: python tools/theme-research.py   (CI lab-quick.yml에서만 — 이 환경은 야후가 막혀 있다)
"""
import math, sys, time
import numpy as np
import pandas as pd
import yfinance as yf

T0 = time.time()
END = "2026-11-05"            # 이 날 전까지 (11/4 종가까지)
START = "2015-09-01"          # 지표 워밍업 포함
ANALYSIS_FROM = "2016-11-04"  # 분석 시작 (10년)
COST = 0.2                    # 왕복 거래비용 가정 %
HS = (5, 10)
PAD = 12

SECTORS = {
    "나스닥": ["QQQ", "TQQQ", "^NDX"],
    "반도체": ["^SOX", "SOXX", "SOXL"],
    "다우·산업재": ["DIA", "XLI", "CAT", "AIT"],
    "주택건설": ["NAIL", "ITB"],
    "양자컴퓨팅": ["IONQ", "INFQ", "RGTI", "QUBT", "QBTS"],
    "소프트웨어": ["MSFT", "NOW"],
    "엔비디아": ["NVDA"],
    "테슬라": ["TSLA"],
    "데이터센터": ["APLD", "CRWV", "IREN"],   # NBIS는 2024 이전이 얀덱스 시계열이라 제외
}
LEVERAGED = {"TQQQ", "SOXL", "NAIL"}
NO_EARN = {"QQQ", "TQQQ", "^NDX", "^SOX", "SOXX", "SOXL", "DIA", "XLI", "NAIL", "ITB"}
ONE_YEAR = ["NAIL", "QQQ", "SOXX", "DIA", "XLI", "CAT", "IONQ", "INFQ", "RGTI", "MSFT", "NOW", "TSLA", "NVDA"]

def log(*a):
    print(*a, flush=True)

# ── 데이터 ─────────────────────────────────────────────────────────────
def fetch(t, adjust=True):
    for _ in range(3):
        try:
            df = yf.Ticker(t).history(start=START, end=END, auto_adjust=adjust)
            if df is not None and len(df):
                df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
                df.index = pd.to_datetime([d.date() for d in df.index])
                df = df[(df.Close > 0) & (df.High > 0) & (df.Low > 0)].dropna(subset=["Close", "High", "Low", "Open"])
                return df[~df.index.duplicated(keep="last")]
        except Exception as e:
            log(f"  조회 재시도 {t}: {e}")
            time.sleep(2)
    return None

def earnings_days(t):
    if t in NO_EARN:
        return set()
    try:
        ed = yf.Ticker(t).get_earnings_dates(limit=60)
        return {pd.Timestamp(d.date()) for d in ed.index} if ed is not None else set()
    except Exception as e:
        log(f"  실적일 조회 실패 {t}: {e}")
        return None

# ── 지표 (모두 그날까지의 값) ──────────────────────────────────────────
def rsi(c, p):
    out = np.full(len(c), np.nan)
    d = np.diff(c)
    if len(d) < p + 1:
        return out
    g, l = np.clip(d, 0, None), np.clip(-d, 0, None)
    ag, al = g[:p].mean(), l[:p].mean()
    out[p] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    for i in range(p, len(d)):
        ag = (ag * (p - 1) + g[i]) / p
        al = (al * (p - 1) + l[i]) / p
        out[i + 1] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out

def runlen(cond):
    r = np.zeros(len(cond), dtype=np.int32)
    n = 0
    for i, v in enumerate(cond):
        n = n + 1 if v else 0
        r[i] = n
    return r

def shift(a, k=1, fill=np.nan):
    out = np.empty_like(a, dtype=float)
    out[:k] = fill
    out[k:] = a[:-k]
    return out

def indicators(df, mkt):
    o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
    s = pd.Series(c)
    X = {"o": o, "h": h, "l": l, "c": c}
    for p in (7, 9, 14, 21):
        X[f"rsi{p}"] = rsi(c, p)
    for n in (10, 20, 30):
        ma, sd = s.rolling(n).mean().to_numpy(), s.rolling(n).std(ddof=0).to_numpy()
        X[f"ma{n}"], X[f"sd{n}"] = ma, sd
    for n in (5, 60):
        X[f"ma{n}"] = s.rolling(n).mean().to_numpy()
    hh, ll = pd.Series(h).rolling(14).max().to_numpy(), pd.Series(l).rolling(14).min().to_numpy()
    k = np.where(hh > ll, (c - ll) / (hh - ll) * 100, np.nan)
    d = pd.Series(k).rolling(3).mean().to_numpy()
    X["k"], X["d"] = k, d
    e12, e26 = s.ewm(span=12, adjust=False).mean(), s.ewm(span=26, adjust=False).mean()
    macd = e12 - e26
    sig = macd.ewm(span=9, adjust=False).mean()
    X["macd"], X["msig"], X["mh"] = macd.to_numpy(), sig.to_numpy(), (macd - sig).to_numpy()
    vs = pd.Series(v).rolling(20).mean().to_numpy()
    X["vr"] = np.where(vs > 0, v / vs, np.nan)
    tr = np.maximum(h - l, np.maximum(abs(h - shift(c)), abs(l - shift(c))))
    X["atr"] = pd.Series(tr).rolling(14).mean().to_numpy()
    rng = np.where(h - l > 0, h - l, np.nan)
    X["upw"] = (h - np.maximum(o, c)) / rng
    X["loww"] = (np.minimum(o, c) - l) / rng
    X["body"] = np.abs(c - o) / rng
    X["rng"] = h - l
    # 시장 입력(같은 날짜)
    X["qqq_c"] = mkt["qqq_c"].reindex(df.index).to_numpy()
    X["qqq_ma20"] = mkt["qqq_ma20"].reindex(df.index).to_numpy()
    X["qqq_ma60"] = mkt["qqq_ma60"].reindex(df.index).to_numpy()
    X["vxn"] = mkt["vxn"].reindex(df.index).to_numpy()
    return X

# ── 조건 사전 ─────────────────────────────────────────────────────────
def gt(a, b):
    with np.errstate(invalid="ignore"):
        return np.nan_to_num(a, nan=-1e18) > np.nan_to_num(b, nan=1e18)

def lt(a, b):
    with np.errstate(invalid="ignore"):
        return np.nan_to_num(a, nan=1e18) < np.nan_to_num(b, nan=-1e18)

def rsi_conds(X, side):
    out = [("RSI 조건 없음", None)]
    thr = (65, 70, 75, 80) if side == "sell" else (20, 25, 30, 35)
    for p in (7, 9, 14, 21):
        r, r1 = X[f"rsi{p}"], shift(X[f"rsi{p}"])
        for t in thr:
            if side == "sell":
                m = gt(np.fmax(r, r1), t - 1e-9)
                out.append((f"RSI{p}≥{t}", m))
            else:
                m = lt(np.fmin(r, r1), t + 1e-9)
                out.append((f"RSI{p}≤{t}", m))
    return out

def bb_conds(X, side):
    out = [("볼밴 조건 없음", None)]
    c = X["c"]
    for n in (10, 20, 30):
        ma, sd = X[f"ma{n}"], X[f"sd{n}"]
        for kk in (1.5, 2.0, 2.5, 3.0):
            band = ma + kk * sd if side == "sell" else ma - kk * sd
            outside = gt(c, band) if side == "sell" else lt(c, band)
            run = runlen(outside)
            prev_run = np.concatenate([[0], run[:-1]])
            for x in (0, 1, 3, 5):
                strong = gt(c, band * (1 + x / 100)) if side == "sell" else lt(c, band * (1 - x / 100))
                for st in (1, 2, 3, 5):
                    out.append((f"BB{n}×{kk}{'상단' if side=='sell' else '하단'} {'+' if side=='sell' else '-'}{x}% {st}일+", strong & (run >= st)))
            for st in (1, 2, 3, 5):
                out.append((f"BB{n}×{kk} 밖 {st}일+ 후 재진입", (~outside) & (prev_run >= st)))
    return out

def filter_conds(X, side, earn_ok):
    c, o, h, l = X["c"], X["o"], X["h"], X["l"]
    c1, h1, l1, o1 = shift(c), shift(h), shift(l), shift(o)
    k, d, k1, d1 = X["k"], X["d"], shift(X["k"]), shift(X["d"])
    mh, mh1 = X["mh"], shift(X["mh"])
    macd, msig, macd1, msig1 = X["macd"], X["msig"], shift(X["macd"]), shift(X["msig"])
    ma5, ma20, ma60 = X["ma5"], X["ma20"], X["ma60"]
    r14 = X["rsi14"]
    cmax20 = pd.Series(c).shift(1).rolling(20).max().to_numpy()
    cmin20 = pd.Series(c).shift(1).rolling(20).min().to_numpy()
    rmax20 = pd.Series(r14).shift(1).rolling(20).max().to_numpy()
    rmin20 = pd.Series(r14).shift(1).rolling(20).min().to_numpy()
    vxn, vxn1 = X["vxn"], shift(X["vxn"])
    vxn_max5 = pd.Series(vxn).shift(1).rolling(5).max().to_numpy()
    F = [("필터 없음", None)]
    qqq_weak = lt(X["qqq_c"], X["qqq_ma20"])
    qqq_up = gt(X["qqq_c"], X["qqq_ma60"])
    if side == "sell":
        body2, c2, o2 = shift(X["body"], 2), shift(c, 2), shift(o, 2)
        body1 = shift(X["body"])
        F += [
            ("윗꼬리≥50%", gt(X["upw"], 0.5 - 1e-9)),
            ("도지·팽이(몸통≤30%·양꼬리≥25%)", lt(X["body"], 0.3 + 1e-9) & gt(X["upw"], 0.25 - 1e-9) & gt(X["loww"], 0.25 - 1e-9)),
            ("유성형", gt(X["upw"], 0.6 - 1e-9) & lt(X["body"], 0.3 + 1e-9) & lt(X["loww"], 0.15 + 1e-9)),
            ("샛별형(evening star)", gt(c2, o2) & gt(body2, 0.6 - 1e-9) & lt(body1, 0.3 + 1e-9) & lt(c, o) & lt(c, (o2 + c2) / 2)),
            ("음봉", lt(c, o)),
            ("장대양봉 후 음봉", gt(c1, o1) & gt(shift(X["body"]), 0.6 - 1e-9) & gt(shift(X["rng"]), 1.5 * shift(X["atr"])) & lt(c, o)),
            ("직전 저점 이탈", lt(c, l1)),
            ("5일선 이탈", lt(c, ma5) & ~lt(c1, shift(ma5))),
            ("스토캐스틱 데드(K≥70)", gt(k1, d1 - 1e-9) & lt(k, d) & gt(k1, 70 - 1e-9)),
            ("MACD 히스토 둔화", gt(mh1, 0) & lt(mh, mh1)),
            ("MACD 데드", gt(macd1, msig1 - 1e-9) & lt(macd, msig)),
            ("RSI 약세 다이버전스", gt(c, cmax20 - 1e-9) & lt(r14, rmax20)),
            ("거래량≥1.5배", gt(X["vr"], 1.5 - 1e-9)),
            ("60일선 위(추세 유지)", gt(c, ma60)),
            ("60일선 아래", lt(c, ma60)),
            ("QQQ 20일선 아래", qqq_weak),
            ("VXN 상승", gt(vxn, vxn1)),
        ]
    else:
        F += [
            ("RSI 상승 전환", gt(r14, shift(r14))),
            ("스토캐스틱 골든(K≤30)", lt(k1, d1 + 1e-9) & gt(k, d) & lt(k1, 30 + 1e-9)),
            ("5일선 회복", gt(c, ma5) & ~gt(c1, shift(ma5))),
            ("20일선 회복", gt(c, ma20) & ~gt(c1, shift(ma20))),
            ("MACD 히스토 개선", lt(mh1, 0) & gt(mh, mh1)),
            ("RSI 상승 다이버전스", lt(c, cmin20 + 1e-9) & gt(r14, rmin20)),
            ("거래량≥1.5배 양봉", gt(X["vr"], 1.5 - 1e-9) & gt(c, o)),
            ("양봉", gt(c, o)),
            ("아랫꼬리≥50%", gt(X["loww"], 0.5 - 1e-9)),
            ("VXN 고점 후 하락", gt(vxn1, vxn_max5 - 1e-9) & lt(vxn, vxn1)),
            ("QQQ 60일선 위", qqq_up),
            ("60일선 위", gt(c, ma60)),
            ("60일선 아래", lt(c, ma60)),
        ]
    for hh in HS:
        if earn_ok[hh] is not None:
            F.append((f"실적 전후 제외({hh}일)", earn_ok[hh], hh))
    return F

# ── 통계 ───────────────────────────────────────────────────────────────
def wilson(p, n, z=1.96):
    if n <= 0:
        return (0.0, 1.0)
    den = 1 + z * z / n
    cen = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, cen - half), min(1.0, cen + half))

def binom_sf(k, n, p):
    if n == 0:
        return 1.0
    if p <= 0:
        return 0.0 if k > 0 else 1.0
    if p >= 1:
        return 1.0
    s = 0.0
    for i in range(k, n + 1):
        s += math.exp(math.lgamma(n + 1) - math.lgamma(i + 1) - math.lgamma(n - i + 1) + i * math.log(p) + (n - i) * math.log(1 - p))
    return min(1.0, s)

# ── 섹터 묶음 ─────────────────────────────────────────────────────────
class Group:
    def __init__(self, name, data, mkt, earn):
        self.name = name
        self.tickers = [t for t in SECTORS[name] if data.get(t) is not None]
        frames = []
        for t in self.tickers:
            X = indicators(data[t], mkt)
            frames.append((t, data[t].index, X))
        all_dates = sorted({d for _, idx, _ in frames for d in idx if str(d.date()) >= ANALYSIS_FROM})
        self.dates = np.array(all_dates, dtype="datetime64[ns]")
        dpos = {d: i for i, d in enumerate(all_dates)}
        cols = {}
        didx, tick, fwd, mfe, mae = [], [], {h: [] for h in HS}, {h: [] for h in HS}, {h: [] for h in HS}
        self.earn_ok = {h: [] for h in HS}
        self.X = {}
        for t, idx, X in frames:
            n = len(idx)
            c, hi, lo = X["c"], X["h"], X["l"]
            di = np.array([dpos.get(d, -1) for d in idx])
            for h in HS:
                f = np.full(n, np.nan); up = np.full(n, np.nan); dn = np.full(n, np.nan)
                if n > h:
                    f[:-h] = (c[h:] / c[:-h] - 1) * 100
                    hmax = pd.Series(hi[::-1]).rolling(h).max().to_numpy()[::-1]
                    lmin = pd.Series(lo[::-1]).rolling(h).min().to_numpy()[::-1]
                    up[:-h] = (hmax[1:n - h + 1] / c[:-h] - 1) * 100
                    dn[:-h] = (lmin[1:n - h + 1] / c[:-h] - 1) * 100
                fwd[h].append(np.concatenate([f, np.full(PAD, np.nan)]))
                mfe[h].append(np.concatenate([up, np.full(PAD, np.nan)]))
                mae[h].append(np.concatenate([dn, np.full(PAD, np.nan)]))
                ed = earn.get(t)
                if t in NO_EARN or ed is None:
                    ok = np.ones(n, dtype=bool) if t in NO_EARN else np.ones(n, dtype=bool)
                else:
                    e = np.zeros(n, dtype=bool)
                    dl = list(idx)
                    for d0 in ed:
                        j = np.searchsorted(idx.values, np.datetime64(d0))
                        if j < n:
                            e[j] = True
                    cs = np.concatenate([[0], np.cumsum(e)])
                    ii = np.arange(n)
                    ok = (cs[np.minimum(ii + h + 1, n)] - cs[ii]) == 0
                self.earn_ok[h].append(np.concatenate([ok, np.zeros(PAD, dtype=bool)]))
            didx.append(np.concatenate([di, np.full(PAD, -1)]))
            tick += [t] * n + [""] * PAD
            for k2, arr in X.items():
                cols.setdefault(k2, []).append(np.concatenate([np.asarray(arr, float), np.full(PAD, np.nan)]))
        self.X = {k2: np.concatenate(v) for k2, v in cols.items()}
        self.didx = np.concatenate(didx)
        self.tick = np.array(tick)
        self.fwd = {h: np.concatenate(fwd[h]) for h in HS}
        self.mfe = {h: np.concatenate(mfe[h]) for h in HS}
        self.mae = {h: np.concatenate(mae[h]) for h in HS}
        self.earn_ok = {h: np.concatenate(self.earn_ok[h]) for h in HS}
        self.earn_missing = [t for t in self.tickers if t not in NO_EARN and earn.get(t) is None]
        self.N = len(self.didx)
        self.D = len(self.dates)
        # 기간 분할: 10일 성적이 있는 날짜 기준 60/20/20
        valid10 = (self.didx >= 0) & ~np.isnan(self.fwd[10])
        ud = np.unique(self.didx[valid10])
        self.cut60 = ud[int(len(ud) * 0.6)] if len(ud) else 0
        self.cut80 = ud[int(len(ud) * 0.8)] if len(ud) else 0
        self.split_of_date = np.where(np.arange(self.D) < self.cut60, 0, np.where(np.arange(self.D) < self.cut80, 1, 2))
        self.valid = {h: (self.didx >= 0) & ~np.isnan(self.fwd[h]) for h in HS}
        self.ii = np.arange(self.N)

    def label(self, d):
        return str(self.dates[d])[:10]

    def events(self, mask, h):
        cs = np.concatenate([[0], np.cumsum(mask)])
        prev = cs[self.ii] - cs[np.maximum(self.ii - h, 0)]
        return mask & (prev == 0) & self.valid[h]

    def stats(self, mask, h, side, splits=(0, 1)):
        ev = self.events(mask, h)
        d = self.didx[ev]
        if len(d) == 0:
            return [(0, float("nan"))] * 3
        f = self.fwd[h][ev]
        hit = (f < 0) if side == "sell" else (f > 0)
        cnt = np.bincount(d, minlength=self.D)
        sm = np.bincount(d, weights=hit.astype(float), minlength=self.D)
        pres = cnt > 0
        frac = sm[pres] / cnt[pres]
        sp = self.split_of_date[pres]
        n = np.bincount(sp, minlength=3)
        hs = np.bincount(sp, weights=frac, minlength=3)
        return [(int(n[s]), hs[s] / n[s] if n[s] else float("nan")) for s in range(3)]

    def base(self, h, side):
        m = self.valid[h]
        d = self.didx[m]
        f = self.fwd[h][m]
        hit = (f < 0) if side == "sell" else (f > 0)
        cnt = np.bincount(d, minlength=self.D)
        sm = np.bincount(d, weights=hit.astype(float), minlength=self.D)
        pres = cnt > 0
        frac = sm[pres] / cnt[pres]
        sp = self.split_of_date[pres]
        n = np.bincount(sp, minlength=3)
        return [np.bincount(sp, weights=frac, minlength=3)[s] / n[s] if n[s] else float("nan") for s in range(3)]

    def detail(self, mask, h, side, split):
        ev = self.events(mask, h) & (self.didx >= 0)
        ev &= (self.split_of_date[np.maximum(self.didx, 0)] == split)
        idx = np.nonzero(ev)[0]
        f = self.fwd[h][idx]
        adv = self.mfe[h][idx] if side == "sell" else self.mae[h][idx]
        gain = -f if side == "sell" else f
        return idx, f, adv, gain

# ── 탐색 ───────────────────────────────────────────────────────────────
def search(G, side):
    R = rsi_conds(G.X, side)
    B = bb_conds(G.X, side)
    F = filter_conds(G.X, side, {h: (G.earn_ok[h] if not G.earn_missing else None) for h in HS})
    res = {h: [] for h in HS}
    ones = np.ones(G.N, dtype=bool)
    for ri, (rn, rm) in enumerate(R):
        for bi, (bn, bm) in enumerate(B):
            rb = ones if rm is None and bm is None else (rm if bm is None else (bm if rm is None else rm & bm))
            if rb.sum() < 15:
                continue
            for fi, fv in enumerate(F):
                fn, fm = fv[0], fv[1]
                only_h = fv[2] if len(fv) > 2 else None
                m = rb if fm is None else rb & fm
                if m.sum() < 15:
                    continue
                for h in HS:
                    if only_h and only_h != h:
                        continue
                    st = G.stats(m, h, side)
                    (ntr, htr), (nva, hva) = st[0], st[1]
                    if ntr >= 15:
                        res[h].append((ri, bi, fi, ntr, htr, nva, hva))
    return R, B, F, res

def build_mask(G, R, B, F, key):
    ri, bi, fi = key
    m = np.ones(G.N, dtype=bool)
    for part in (R[ri][1], B[bi][1], F[fi][1]):
        if part is not None:
            m &= part
    return m

def fmt(n, p):
    return f"{'—' if n == 0 or p != p else str(round(p * 100))}%({n})"

def tier(v):
    """2026-11-06 사용자 지시 — 검증·테스트 모두 75%↑일 때 테스트 표본으로 등급: 10+ 반복 검증 후보 / 5~9 희귀 고적중 후보(소표본) / ≤4 참고용."""
    if not (v["va"][1] >= 0.75 and v["te"][1] == v["te"][1] and v["te"][1] >= 0.75):
        return ""
    n = v["te"][0]
    return "반복 검증 후보" if n >= 10 else "희귀 고적중 후보(소표본)" if n >= 5 else "참고용(4건 이하)"

def report(G, side, R, B, F, res, ntests):
    word = "매도·익절(하락 적중)" if side == "sell" else "매수(상승 적중)"
    fixed_key = None
    if side == "sell":
        fr = [i for i, x in enumerate(R) if x[0] == "RSI14≥65"][0]
        fb = [i for i, x in enumerate(B) if x[0] == "BB20×2.0상단 +0% 1일+"][0]
    else:
        fr = [i for i, x in enumerate(R) if x[0] == "RSI14≤30"][0]
        fb = [i for i, x in enumerate(B) if x[0] == "BB20×2.0하단 -0% 1일+"][0]
    fixed_key = (fr, fb, 0)
    out = {}
    for h in HS:
        rows = res[h]
        b = G.base(h, side)
        log(f"\n  ── {word} · {h}거래일 ── 기준 확률 학습 {round(b[0]*100)}% · 검증 {round(b[1]*100)}% · 테스트 {round(b[2]*100)}%")
        fm = build_mask(G, R, B, F, fixed_key)
        fs = G.stats(fm, h, side)
        log(f"    고정 규칙 [{R[fr][0]} ∧ {B[fb][0]}] 학습 {fmt(*fs[0])} · 검증 {fmt(*fs[1])} · 테스트 {fmt(*fs[2])}")
        if not rows:
            log("    학습 표본 15건 이상인 후보 없음 — 탐색 불가")
            continue
        arr = np.array([r[3:] for r in rows], dtype=float)
        lb_tr = np.array([wilson(p, n)[0] for n, p in arr[:, 0:2]])
        order = np.argsort(-lb_tr)[:40]
        cand = []
        for j in order:
            nva, hva = arr[j, 2], arr[j, 3]
            if nva >= 8 and hva == hva:
                cand.append((wilson(hva, nva)[0], j))
        n75 = sum(1 for j in order if arr[j, 2] >= 10 and arr[j, 3] >= 0.75)
        top1 = order[0]
        r0 = rows[top1]
        log(f"    후보 {len(rows):,}개(학습 표본 15+) · 학습 1위 [{R[r0[0]][0]} ∧ {B[r0[1]][0]} ∧ {F[r0[2]][0]}] 학습 {fmt(int(r0[3]), r0[4])} → 검증 {fmt(int(r0[5]), r0[6])}")
        log(f"    학습 상위 40개 중 검증 75%↑(표본 10+): {n75}개")
        if not cand:
            log("    검증 표본 8건 이상 후보 없음 — 선정 불가")
            continue
        cand.sort(reverse=True)
        j = cand[0][1]
        key = rows[j][:3]
        m = build_mask(G, R, B, F, key)
        st = G.stats(m, h, side)
        name = f"{R[key[0]][0]} ∧ {B[key[1]][0]} ∧ {F[key[2]][0]}"
        nte, hte = st[2]
        lo, hi = wilson(hte if hte == hte else 0, nte)
        k = int(round((hte if hte == hte else 0) * nte))
        p = binom_sf(k, nte, b[2]) if nte else 1.0
        idx, f, adv, gain = G.detail(m, h, side, 2)
        mean_g = float(np.mean(gain)) if len(gain) else float("nan")
        med_g = float(np.median(gain)) if len(gain) else float("nan")
        adv_med = float(np.median(adv)) if len(adv) else float("nan")
        adv_worst = (float(np.max(adv)) if side == "sell" else float(np.min(adv))) if len(adv) else float("nan")
        verdict = ("우수 후보" if (st[1][1] >= 0.75 and hte >= 0.75 and nte >= 10) else
                   "탐색적(테스트 10건 미만)" if nte < 10 else
                   "추가 검증 필요" if nte < 30 else "통계 검정 대상")
        log(f"    ▶ 선정 [{name}]")
        log(f"       학습 {fmt(*st[0])} · 검증 {fmt(*st[1])} · 테스트 {fmt(nte, hte)} [95% {round(lo*100)}~{round(hi*100)}] · 기준 대비 {'+' if (hte-b[2])>=0 else ''}{round((hte-b[2])*100) if hte==hte else '—'}%p")
        log(f"       테스트 p={p:.3g} (Bonferroni 기준 {0.05/ntests:.2g}{' 통과' if p < 0.05/ntests else ' 미통과'}) · 판정: {verdict}")
        log(f"       테스트 {'하락폭' if side=='sell' else '수익'} 평균 {mean_g:+.2f}% · 중앙 {med_g:+.2f}% · 비용 {COST}% 후 평균 {mean_g-COST:+.2f}% · {'최대 역행(상승)' if side=='sell' else '최대 역행(하락)'} 중앙 {adv_med:+.1f}% · 최악 {adv_worst:+.1f}%")
        per = {}
        for i in idx:
            t = G.tick[i]
            hit = (G.fwd[h][i] < 0) if side == "sell" else (G.fwd[h][i] > 0)
            a = per.setdefault(t, [0, 0]); a[0] += 1; a[1] += int(hit)
        log("       테스트 종목별 " + " · ".join(f"{t} {v[1]}/{v[0]}" for t, v in per.items()))
        last = sorted(idx, key=lambda i: G.didx[i])[-4:]
        log("       최근 사례 " + " · ".join(f"{G.label(G.didx[i])} {G.tick[i]} {G.fwd[h][i]:+.1f}%{'✓' if ((G.fwd[h][i]<0) if side=='sell' else (G.fwd[h][i]>0)) else '✗'}" for i in last))
        # 오늘(마지막 날) 발동 종목 — 사후 성적이 없으니 valid와 무관하게 본다
        lastd = G.D - 1
        now = [G.tick[i] for i in np.nonzero(m & (G.didx == lastd))[0]]
        nowf = [G.tick[i] for i in np.nonzero(fm & (G.didx == lastd))[0]]
        log(f"       {G.label(lastd)} 발동: 선정 규칙 {', '.join(now) or '없음'} · 고정 규칙 {', '.join(nowf) or '없음'}")
        out[h] = dict(rule=name, tr=st[0], va=st[1], te=(nte, hte), base=b, p=p, mean=mean_g, adv_med=adv_med, adv_worst=adv_worst)
    return out

# ── 1년 재검산 (사용자 표 §3·§4) ────────────────────────────────────────
def one_year():
    log("\n■ 1년 재검산 — RSI14(Wilder)≥65 ∧ 종가>볼밴(20, 2σ 모표준편차) 상단 · 2025-11-06~2026-11-04 · 원종가(배당 미조정)")
    log("  사례 = 상단 밖 연속 마감 구간 1개 = 1건(구간 첫 신호일) · 10거래일 뒤 종가 대비 · 기준 = 같은 기간 아무 날 10일 하락 확률")
    for t in ONE_YEAR:
        df = fetch(t, adjust=False)
        if df is None or len(df) < 40:
            log(f"  {t:5} 데이터 없음"); continue
        c = df.Close.to_numpy(float)
        r = rsi(c, 14)
        s = pd.Series(c)
        up = (s.rolling(20).mean() + 2 * s.rolling(20).std(ddof=0)).to_numpy()
        above = gt(c, up)
        ev = above & gt(r, 65 - 1e-9)
        dates = [str(d.date()) for d in df.index]
        win = [i for i, d in enumerate(dates) if "2025-11-06" <= d <= "2026-11-04"]
        if not win:
            continue
        w0, w1 = win[0], win[-1]
        eps, i = [], w0
        while i <= w1:
            if above[i]:
                j = i
                while j + 1 <= w1 and above[j + 1]:
                    j += 1
                firsts = [k for k in range(i, j + 1) if ev[k]]
                if firsts:
                    eps.append((firsts[0], j - i + 1))
                i = j + 1
            else:
                i += 1
        done = [(k, stay) for k, stay in eps if k + 10 < len(c) and k + 10 <= w1 + 10 and dates[min(k+10, len(c)-1)] <= "2026-11-04"]
        r10 = [(c[k + 10] / c[k] - 1) * 100 for k, _ in done]
        base = [(c[k + 10] / c[k] - 1) * 100 for k in range(w0, w1 + 1) if k + 10 < len(c) and dates[k + 10] <= "2026-11-04"]
        bd = np.mean([x < 0 for x in base]) * 100 if base else float("nan")
        hit = np.mean([x < 0 for x in r10]) * 100 if r10 else float("nan")
        lst = " · ".join(f"{dates[k]}({stay}일){'' if k+10>=len(c) or dates[min(k+10,len(c)-1)]>'2026-11-04' else f' {(c[k+10]/c[k]-1)*100:+.1f}%'}" for k, stay in eps)
        log(f"  {t:5} 완료 {len(r10):2}건 · 10일 하락 {('—' if hit!=hit else f'{hit:.0f}%'):>4} · 평균 {(np.mean(r10) if r10 else float('nan')):+6.1f}% · 기준 하락 {bd:.0f}% · {lst}")
        if t == "NAIL":
            k = len(c) - 1
            log(f"  NAIL {dates[k]} 종가 {c[k]:.2f} · RSI14 {r[k]:.1f} · 상단 대비 {(c[k]/up[k]-1)*100:+.1f}% · 최근 3일 상단 밖: " +
                ", ".join(f"{dates[i]} {'밖' if above[i] else '안'}" for i in range(k - 2, k + 1)))

# ── 대조 실험(placebo) ────────────────────────────────────────────────
def permuted(df, rng):
    """일간 종가 수익률의 순서만 섞는다 — 변동성 분포는 그대로, 예측력은 0.
    그날의 시가·고가·저가는 종가 대비 비율을 그대로 옮긴다."""
    c = df.Close.to_numpy(float)
    r = np.diff(np.log(c))
    r = rng.permutation(r)
    nc = c[0] * np.exp(np.concatenate([[0], np.cumsum(r)]))
    perm = np.concatenate([[0], rng.permutation(np.arange(1, len(c)))])
    out = df.copy()
    for k in ("Open", "High", "Low"):
        out[k] = nc * (df[k].to_numpy(float) / c)[perm]
    out["Close"] = nc
    out["High"] = np.maximum(out["High"], np.maximum(out["Open"], out["Close"]))
    out["Low"] = np.minimum(out["Low"], np.minimum(out["Open"], out["Close"]))
    return out

def count_stars(data, mkt, earn, quiet=True):
    global log
    keep = log
    if quiet:
        log = lambda *a, **k: None
    stars = total = rare = 0
    try:
        for name in SECTORS:
            G = Group(name, data, mkt, earn)
            if not G.tickers or G.D < 200:
                continue
            for side in ("sell", "buy"):
                R, B, F, res = search(G, side)
                for h, v in report(G, side, R, B, F, res, len(SECTORS) * 2 * len(HS)).items():
                    total += 1
                    t_ = tier(v)
                    if t_ == "반복 검증 후보":
                        stars += 1
                    elif t_.startswith("희귀"):
                        rare += 1
    finally:
        log = keep
    return stars, total, rare

# ── 실행 ───────────────────────────────────────────────────────────────
def main():
    log(f"■ 섹터별 기술적 신호 장기 백테스트 · 분석 {ANALYSIS_FROM}~{END} 전날 · 비용 가정 왕복 {COST}%")
    tick = sorted({t for v in SECTORS.values() for t in v} | {"^VXN", "QQQ"})
    data = {}
    for t in tick:
        data[t] = fetch(t)
        df = data[t]
        log(f"  {t:6} {('없음' if df is None else f'{len(df)}봉 {str(df.index[0].date())}~{str(df.index[-1].date())}')}")
    q = data["QQQ"].Close
    mkt = {"qqq_c": q, "qqq_ma20": q.rolling(20).mean(), "qqq_ma60": q.rolling(60).mean(),
           "vxn": data["^VXN"].Close if data.get("^VXN") is not None else pd.Series(dtype=float)}
    earn = {}
    for t in tick:
        if t not in NO_EARN and not t.startswith("^"):
            earn[t] = earnings_days(t)
            log(f"  실적일 {t}: {'조회 실패' if earn[t] is None else str(len(earn[t]))+'개'}")
    one_year()
    ntests = len(SECTORS) * 2 * len(HS)
    summary = []
    for name in SECTORS:
        G = Group(name, data, mkt, earn)
        if not G.tickers or G.D < 200:
            log(f"\n■ {name} — 데이터 부족"); continue
        log(f"\n■ {name} ({', '.join(G.tickers)}{' · 3배 레버리지 포함' if set(G.tickers)&LEVERAGED else ''}) · {G.label(0)}~{G.label(G.D-1)} · "
            f"학습 ~{G.label(G.cut60-1)} · 검증 ~{G.label(G.cut80-1)} · 테스트 ~{G.label(G.D-1)}"
            + (f" · 실적일 없음: {','.join(G.earn_missing)}" if G.earn_missing else ""))
        for side in ("sell", "buy"):
            t1 = time.time()
            R, B, F, res = search(G, side)
            o = report(G, side, R, B, F, res, ntests)
            for h, v in o.items():
                summary.append((name, side, h, v))
            log(f"    ({time.time()-t1:.0f}초)")
    log("\n■ 요약 — 검증·테스트 둘 다 75%↑일 때 테스트 표본으로 등급: ★ 10건+ 반복 검증 후보 · ☆ 5~9건 희귀 고적중 후보(소표본) · · 4건 이하 참고용")
    for name, side, h, v in summary:
        t_ = tier(v)
        star = "★" if t_ == "반복 검증 후보" else "☆" if t_.startswith("희귀") else "·" if t_ else " "
        log(f"  {star} {name:7} {'매도' if side=='sell' else '매수'} {h:2}일 · 학습 {fmt(*v['tr'])} 검증 {fmt(*v['va'])} 테스트 {fmt(*v['te'])} · 기준 {round(v['base'][2]*100)}% · p={v['p']:.2g} · {v['rule']}")
        if t_:
            lift = (v["te"][1] - v["base"][2]) * 100
            log(f"      └ {t_} · 테스트 평균 {'하락폭' if side=='sell' else '수익'} {v['mean']:+.2f}% · 최대 불리 중앙 {v['adv_med']:+.1f}% / 최악 {v['adv_worst']:+.1f}% · 평소 대비 {lift:+.0f}%p")
    real_stars = sum(1 for _, _, _, v in summary if tier(v) == "반복 검증 후보")
    real_rare = sum(1 for _, _, _, v in summary if tier(v).startswith("희귀"))
    if "--placebo" in sys.argv:
        k = int(sys.argv[sys.argv.index("--placebo") + 1])
        log(f"\n■ 대조 실험 — 종목별 일간 수익률 순서를 섞어(예측력 0) 같은 절차를 {k}번 반복")
        for s in range(k):
            rng = np.random.default_rng(1000 + s)
            pdata = {t: (permuted(df, rng) if df is not None and not t.startswith("^V") else df) for t, df in data.items()}
            st, tot, ra = count_stars(pdata, mkt, earn)
            log(f"  섞은 데이터 {s+1}: 선정 규칙 {tot}개 중 ★ {st}개 · ☆ {ra}개")
        log(f"  실제 데이터: 선정 규칙 {len(summary)}개 중 ★ {real_stars}개 · ☆ {real_rare}개 — 섞은 데이터의 수와 비슷하면 우연과 구별되지 않는다")
    log(f"\n(총 {time.time()-T0:.0f}초)")

if __name__ == "__main__":
    main()
