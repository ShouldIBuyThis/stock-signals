#!/usr/bin/env python3
"""테마별 '볼밴 밖 일부 매도 → 밴드 안 재진입 때 재매수' 검증 + 캔들형 + 테마별 추천 산식 (연구 전용).

2026-11-05 사용자 지시: "테마별로 어떤 산식이 좋을지 표본 5건만 넘어도 후보로 추천. 볼밴 찢으며 샛별형·윗꼬리·
아랫꼬리 캔들형도 잘 보고. 전부 매도가 아니라 볼밴 안으로 들어올 때까지 일부 매도하고 다시 진입."

매매 규칙(일부 매도 한 번)
  · 신호일 t: 종가가 볼밴 상단 밖(+돌파 강도) 이고 조건(RSI·캔들 등)을 만족 → 그날 종가에 일부 매도
  · 재매수: t 이후 종가가 처음으로 상단 이하로 들어온 날 종가. 20거래일 안에 안 들어오면 20일째 종가.
  · 한 번 밖에 나가 있는 동안(연속 구간)은 첫 신호 한 번만 센다(이미 팔았으니까).
  · 성과 = 판 가격 / 되산 가격 − 1 − 왕복비용 0.2%. 적중 = 성과 > 0 (되산 가격이 더 쌌다).
  · 비교 기준 = 같은 볼밴 설정에서 아무 조건 없이 '처음 밖으로 나간 날' 판 경우.
선정: 앞 80%(학습+검증)에서 표본 5건 이상, Wilson 하한으로 줄 세움 → 뒤 20%(테스트)에서 확인.
같은 테마 같은 날 여러 종목은 1건(그날 평균). 대조 실험: 종목별 일간 수익률 순서를 섞은 데이터로 같은 절차.
사용: python tools/theme-trim.py [--placebo N]   (CI lab-quick에서만)
"""
import importlib.util, sys, time, math
import numpy as np, pandas as pd

spec = importlib.util.spec_from_file_location("tr", __file__.replace("theme-trim.py", "theme-research.py"))
tr = importlib.util.module_from_spec(spec); spec.loader.exec_module(tr)
log, rsi, runlen, shift, gt, lt, wilson, binom_sf = tr.log, tr.rsi, tr.runlen, tr.shift, tr.gt, tr.lt, tr.wilson, tr.binom_sf
COST, MAXWAIT, MINN = 0.2, 20, 5
# --next-open: 신호(그날 종가로 확정) 다음 거래일 시가에 팔고, 재진입(종가로 확정) 다음 거래일 시가에 되산다 — 현실 체결 (2026-11-06 지적 반영)
NEXT_OPEN = "--next-open" in sys.argv
STARTS = {"QUBT": "2018-03-01"}   # 그 이전은 다른 사업 시절 시계열
SECTORS = tr.SECTORS
T0 = time.time()

# ── 종목별 지표 ─────────────────────────────────────────────────────────
def prep(df):
    o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
    s = pd.Series(c)
    X = {"o": o, "h": h, "l": l, "c": c, "dates": np.array([str(d.date()) for d in df.index])}
    for p in (7, 9, 14, 21):
        X[f"rsi{p}"] = rsi(c, p)
    for n in (10, 20, 30):
        X[f"ma{n}"], X[f"sd{n}"] = s.rolling(n).mean().to_numpy(), s.rolling(n).std(ddof=0).to_numpy()
    vs = pd.Series(v).rolling(20).mean().to_numpy()
    X["vr"] = np.where(vs > 0, v / np.where(vs > 0, vs, 1), np.nan)
    rng = np.where(h - l > 0, h - l, np.nan)
    X["upw"], X["loww"], X["body"] = (h - np.maximum(o, c)) / rng, (np.minimum(o, c) - l) / rng, np.abs(c - o) / rng
    tr_ = np.maximum(h - l, np.maximum(abs(h - shift(c)), abs(l - shift(c))))
    X["atr"] = pd.Series(tr_).rolling(14).mean().to_numpy()
    X["rng"] = h - l
    X["cmax20"] = pd.Series(c).shift(1).rolling(20).max().to_numpy()
    X["rmax20"] = pd.Series(X["rsi14"]).shift(1).rolling(20).max().to_numpy()
    return X

def candles(X):
    """캔들형 사전 — 전부 그날(과 그 전날)까지의 OHLC로 정의."""
    o, c, h, l = X["o"], X["c"], X["h"], X["l"]
    body, upw, loww = X["body"], X["upw"], X["loww"]
    o1, c1, b1, rng1, atr1 = shift(o), shift(c), shift(body), shift(X["rng"]), shift(X["atr"])
    o2, c2, b2 = shift(o, 2), shift(c, 2), shift(body, 2)
    big_up1 = gt(c1, o1) & gt(b1, 0.6 - 1e-9)
    star_today = lt(body, 0.3 + 1e-9) & gt(np.minimum(o, c), c1 * 0.995)      # 큰 양봉 다음 날 몸통 작은 별이 위에 뜸
    return [
        ("조건 없음", None),
        ("윗꼬리≥50%", gt(upw, 0.5 - 1e-9)),
        ("윗꼬리≥30%", gt(upw, 0.3 - 1e-9)),
        ("유성형(윗꼬리≥60·몸통≤30·아랫꼬리≤15)", gt(upw, 0.6 - 1e-9) & lt(body, 0.3 + 1e-9) & lt(loww, 0.15 + 1e-9)),
        ("아랫꼬리≥50%(교수형 포함)", gt(loww, 0.5 - 1e-9)),
        ("교수형(아랫꼬리≥60·몸통≤30·윗꼬리≤15)", gt(loww, 0.6 - 1e-9) & lt(body, 0.3 + 1e-9) & lt(upw, 0.15 + 1e-9)),
        ("도지·팽이(몸통≤30·양꼬리≥25)", lt(body, 0.3 + 1e-9) & gt(upw, 0.25 - 1e-9) & gt(loww, 0.25 - 1e-9)),
        ("샛별 형성(큰 양봉 다음 날 별)", big_up1 & star_today),
        ("샛별 완성(별 다음 날 음봉, 아직 밖)", gt(c2, o2) & gt(b2, 0.6 - 1e-9) & lt(b1, 0.3 + 1e-9) & lt(c, o) & lt(c, (o2 + c2) / 2)),
        ("음봉", lt(c, o)),
        ("장대양봉 다음 날 음봉", gt(c1, o1) & gt(b1, 0.6 - 1e-9) & gt(rng1, 1.5 * atr1) & lt(c, o)),
        ("RSI 약세 다이버전스", gt(c, X["cmax20"] - 1e-9) & lt(X["rsi14"], X["rmax20"])),
        ("거래량≥1.5배", gt(X["vr"], 1.5 - 1e-9)),
    ]

def band_trades(X, n, k):
    """상단 밖 여부, 연속 구간 번호, 각 날 일부매도 시 재매수 위치·성과."""
    c, ma, sd = X["c"], X[f"ma{n}"], X[f"sd{n}"]
    up = ma + k * sd
    outside = gt(c, up)
    N = len(c)
    nxt = np.full(N, -1)
    j = -1
    for t in range(N - 1, -1, -1):
        nxt[t] = j
        if not outside[t] and not np.isnan(up[t]):
            j = t
    reent = np.where((nxt > 0) & (nxt - np.arange(N) <= MAXWAIT), nxt, np.arange(N) + MAXWAIT)
    done = reent < N
    reent_c = np.where(done, reent, N - 1)
    if NEXT_OPEN:
        o = X["o"]; i1 = np.minimum(np.arange(N) + 1, N - 1); r1 = np.minimum(reent_c + 1, N - 1)
        ret = (o[i1] / o[r1] - 1) * 100 - COST
        done = done & (reent_c + 1 < N)
    else:
        ret = (c / c[reent_c] - 1) * 100 - COST
    ret[~done] = np.nan
    days = (reent_c - np.arange(N)).astype(float); days[~done] = np.nan
    # 되사기 전까지 더 오른 폭(역행)
    runid = np.cumsum(np.concatenate([[1], (outside[1:] & ~outside[:-1]).astype(int)])) * outside
    return dict(up=up, outside=outside, run=runid, ret=ret, days=days, reent=reent)

class Theme:
    def __init__(self, name, data):
        self.name = name
        self.tk = [t for t in SECTORS[name] if data.get(t) is not None and len(data[t]) > 120]
        self.X = {t: prep(data[t]) for t in self.tk}
        self.C = {t: candles(self.X[t]) for t in self.tk}
        self.bt = {}
        alld = sorted({d for t in self.tk for d in self.X[t]["dates"] if d >= tr.ANALYSIS_FROM})
        self.dates = alld
        self.didx = {d: i for i, d in enumerate(alld)}
        self.cut80 = alld[int(len(alld) * 0.8)] if alld else "9999"

    def trades(self, n, k):
        key = (n, k)
        if key not in self.bt:
            self.bt[key] = {t: band_trades(self.X[t], n, k) for t in self.tk}
        return self.bt[key]

    def events(self, n, k, x, rsi_p, rsi_t, ci, stay=1):
        """조건을 처음 만족한 날(밖 구간마다 한 번). 반환: [(date, ticker, ret, days)]"""
        out = []
        for t in self.tk:
            X, B = self.X[t], self.trades(n, k)[t]
            m = B["outside"] & gt(X["c"], B["up"] * (1 + x / 100))
            if stay > 1:
                m &= runlen(B["outside"]) >= stay
            if rsi_p:
                m &= gt(X[f"rsi{rsi_p}"], rsi_t - 1e-9)
            cm = self.C[t][ci][1]
            if cm is not None:
                m &= cm
            idx = np.nonzero(m & (X["dates"] >= tr.ANALYSIS_FROM))[0]
            if not len(idx):
                continue
            _, first = np.unique(B["run"][idx], return_index=True)
            for i in idx[first]:
                if not np.isnan(B["ret"][i]):
                    out.append((X["dates"][i], t, B["ret"][i], B["days"][i]))
        return out

def agg(ev, split=None, cut=None):
    """같은 날 = 1건. 반환 n, 적중률, 평균성과, 평균보유일, 최악."""
    if split == "early":
        ev = [e for e in ev if e[0] < cut]
    elif split == "late":
        ev = [e for e in ev if e[0] >= cut]
    if not ev:
        return dict(n=0, hit=float("nan"), mean=float("nan"), days=float("nan"), worst=float("nan"))
    by = {}
    for d, t, r, dd in ev:
        by.setdefault(d, []).append((r, dd))
    hits = [np.mean([r > 0 for r, _ in v]) for v in by.values()]
    rets = [np.mean([r for r, _ in v]) for v in by.values()]
    days = [np.mean([dd for _, dd in v]) for v in by.values()]
    return dict(n=len(by), hit=float(np.mean(hits)), mean=float(np.mean(rets)), days=float(np.mean(days)), worst=float(min(rets)))

def f(a):
    if a["n"] == 0:
        return "—(0)"
    return f"{round(a['hit']*100)}%({a['n']}) {a['mean']:+.1f}%"

GRID_BB = [(n, k, x) for n in (10, 20, 30) for k in (1.5, 2.0, 2.5, 3.0) for x in (0, 1, 3, 5)]
GRID_RSI = [(None, None)] + [(p, t) for p in (7, 9, 14, 21) for t in (65, 70, 75, 80)]

def search_trim(T):
    rows = []
    ncand = len(T.C[T.tk[0]]) if T.tk else 0
    for (n, k, x) in GRID_BB:
        for (rp, rt) in GRID_RSI:
            for ci in range(ncand):
                for stay in (1, 2, 3):
                    ev = T.events(n, k, x, rp, rt, ci, stay)
                    e = agg(ev, "early", T.cut80)
                    if e["n"] >= MINN:
                        rows.append(((n, k, x, rp, rt, ci, stay), e, ev))
    return rows

def name_rule(T, key):
    n, k, x, rp, rt, ci, stay = key
    parts = [f"BB{n}×{k} 상단{'+'+str(x)+'%' if x else ''} 밖{'' if stay == 1 else f' {stay}일째+'}"]
    if rp:
        parts.append(f"RSI{rp}≥{rt}")
    cname = T.C[T.tk[0]][ci][0]
    if cname != "조건 없음":
        parts.append(cname)
    return " ∧ ".join(parts)

def recommend(T, rows, top=3, quiet=False):
    """앞 80% Wilson 하한 순 → 뒤 20% 확인. 같은 볼밴의 '조건 없이 첫 이탈' 기준과 비교."""
    # 무작위 가격에서도 '밖에서 팔고 안에서 되사기'는 이익 비율이 50%를 넘는다(밴드가 가격을 따라온다).
    # 그래서 이익 비율만으로 고르지 않고, 앞 80% 평균 성과가 플러스인 후보만 받는다.
    scored = sorted([r for r in rows if r[1]["mean"] > 0], key=lambda r: -wilson(r[1]["hit"], r[1]["n"])[0])
    picked, seen = [], set()
    for key, e, ev in scored:
        sig = (key[0], key[1], key[5])           # 같은 볼밴·같은 캔들은 하나만(이웃 설정 중복 방지)
        if sig in seen:
            continue
        seen.add(sig)
        picked.append((key, e, ev))
        if len(picked) >= top:
            break
    out = []
    for key, e, ev in picked:
        l = agg(ev, "late", T.cut80)
        b = T.events(key[0], key[1], 0, None, None, 0, 1)
        be, bl = agg(b, "early", T.cut80), agg(b, "late", T.cut80)
        out.append((key, e, l, be, bl))
        if not quiet:
            lo = wilson(e["hit"], e["n"])[0]
            log(f"    · {name_rule(T, key)}")
            log(f"      앞 80% {f(e)} [하한 {round(lo*100)}%] 보유 {e['days']:.1f}일 · 기준(조건 없이 첫 이탈) {f(be)}")
            log(f"      뒤 20% {f(l)} · 기준 {f(bl)}{'' if l['n'] else ''}{' · 최악 '+format(l['worst'],'+.1f')+'%' if l['n'] else ''}")
    return out

# ── 캔들형 지도: 볼밴20×2 상단 밖에서 처음 나타난 캔들 → 재진입까지 일부매도 성과 (전 기간) ──
def candle_map(themes):
    log("\n■ 캔들형 지도 — 볼밴(20, 2σ) 상단 밖에서 그 캔들이 처음 나온 날 일부 매도 → 종가 밴드 재진입 때 재매수")
    log("  칸 = 이익 본 비율(건수) 평균 성과 · 전 기간 10년 · 같은 테마 같은 날 1건 · 성과는 비용 0.2% 차감")
    names = [c[0] for c in themes[0].C[themes[0].tk[0]]]
    log("  " + "캔들".ljust(30) + " | " + " | ".join(T.name for T in themes))
    emit = []
    for ci, nm in enumerate(names):
        aggs = [agg(T.events(20, 2.0, 0, None, None, ci, 1)) for T in themes]
        log(f"  {nm[:30].ljust(30)} | " + " | ".join(f(a) for a in aggs))
        for T, a in zip(themes, aggs):
            emit.append({"candle": nm, "theme": T.name, "n": int(a["n"]), "win": None if a["n"] == 0 else round(float(a["hit"]), 3),
                         "avg": None if a["n"] == 0 else round(float(a["mean"]), 2)})
    if "--emit-map" in sys.argv:
        import json
        json.dump({"next_open": NEXT_OPEN, "rows": emit}, open(sys.argv[sys.argv.index("--emit-map") + 1], "w", encoding="utf-8"), ensure_ascii=False)

# ── 고정 기간으로 본 상단 캔들 (밴드 안으로 들어온 날 포함) ─────────────
def candle_fixed(themes):
    log("\n■ 상단 근처 캔들의 10거래일 하락 확률 — 그날 또는 전날 종가가 볼밴(20, 2σ) 상단 밖 · 기준 = 같은 테마 아무 날")
    names = [c[0] for c in themes[0].C[themes[0].tk[0]]][1:]
    log("  " + "캔들".ljust(30) + " | " + " | ".join(T.name for T in themes))
    base_cells = []
    for T in themes:
        hs = []
        for t in T.tk:
            X = T.X[t]; c = X["c"]
            r10 = np.full(len(c), np.nan); r10[:-10] = c[10:] / c[:-10] - 1
            ok = (X["dates"] >= tr.ANALYSIS_FROM) & ~np.isnan(r10)
            hs += list(r10[ok] < 0)
        base_cells.append(f"{round(np.mean(hs)*100)}%" if hs else "—")
    log("  " + "기준(아무 날)".ljust(30) + " | " + " | ".join(base_cells))
    for ci, nm in enumerate(names, start=1):
        cells = []
        for T in themes:
            by = {}
            for t in T.tk:
                X, B = T.X[t], T.trades(20, 2.0)[t]
                c = X["c"]; r10 = np.full(len(c), np.nan); r10[:-10] = c[10:] / c[:-10] - 1
                near = B["outside"] | shift(B["outside"].astype(float), 1, 0).astype(bool)
                m = near & T.C[t][ci][1] & (X["dates"] >= tr.ANALYSIS_FROM) & ~np.isnan(r10)
                idx = np.nonzero(m)[0]
                last = -99
                for i in idx:
                    if i - last < 10:   # 10일 안 재신호는 첫 신호만
                        continue
                    last = i
                    by.setdefault(X["dates"][i], []).append(r10[i] < 0)
            hs = [np.mean(v) for v in by.values()]
            cells.append(f"{round(np.mean(hs)*100)}%({len(hs)})" if hs else "—(0)")
        log(f"  {nm[:30].ljust(30)} | " + " | ".join(cells))

# ── 매수 쪽 추천(표본 5건+) — theme-research의 조건 사전·통계를 그대로 쓴다 ──
def buy_recommend(G, h, quiet=False):
    R = tr.rsi_conds(G.X, "buy"); B = tr.bb_conds(G.X, "buy")
    F = tr.filter_conds(G.X, "buy", {hh: (G.earn_ok[hh] if not G.earn_missing else None) for hh in tr.HS})
    best = []
    ones = np.ones(G.N, dtype=bool)
    for ri, (rn, rm) in enumerate(R):
        for bi, (bn, bm) in enumerate(B):
            rb = ones if rm is None and bm is None else (rm if bm is None else (bm if rm is None else rm & bm))
            if rb.sum() < MINN:
                continue
            for fi, fv in enumerate(F):
                if len(fv) > 2 and fv[2] != h:
                    continue
                m = rb if fv[1] is None else rb & fv[1]
                if m.sum() < MINN:
                    continue
                st = G.stats(m, h, "buy")
                (n0, h0), (n1, h1) = st[0], st[1]
                ne = n0 + n1
                if ne < MINN:
                    continue
                he = ((h0 if n0 else 0) * n0 + (h1 if n1 else 0) * n1) / ne
                best.append((wilson(he, ne)[0], he, ne, (ri, bi, fi), st[2]))
    best.sort(key=lambda r: -r[0])
    b = G.base(h, "buy")
    early_base = (b[0] * 0.75 + b[1] * 0.25)
    res = []
    for lo, he, ne, key, (nt, ht) in best[:2]:
        name = f"{R[key[0]][0]} ∧ {B[key[1]][0]} ∧ {F[key[2]][0]}"
        res.append((name, he, ne, nt, ht, b[2]))
        if not quiet:
            log(f"    · {name}")
            log(f"      앞 80% {round(he*100)}%({ne}) [하한 {round(lo*100)}%] · 평소 상승 {round(early_base*100)}% → 뒤 20% {('—' if not nt else str(round(ht*100))+'%')}({nt}) · 평소 {round(b[2]*100)}%")
    return res

def current(themes):
    log("\n■ 2026-11-04 종가 기준 볼밴 상단 밖 종목 (볼밴 20, 2σ)")
    for T in themes:
        for t in T.tk:
            X, B = T.X[t], T.trades(20, 2.0)[t]
            if B["outside"][-1]:
                stay = runlen(B["outside"])[-1]
                cn = [nm for nm, cm in T.C[t][1:] if cm is not None and cm[-1]]
                log(f"  {T.name} {t}: 상단 대비 {(X['c'][-1]/B['up'][-1]-1)*100:+.1f}% · 밖 {stay}일째 · RSI14 {X['rsi14'][-1]:.0f} · 오늘 캔들 {', '.join(cn) or '해당 없음'}")

def run_all(data, quiet=False):
    themes = [Theme(nm, data) for nm in SECTORS]
    themes = [T for T in themes if T.tk]
    stars = tot = 0
    if not quiet:
        candle_map(themes)
        candle_fixed(themes)
        current(themes)
        log("\n■ 테마별 추천 — 앞 80% 기간에서 표본 5건+ 후보를 Wilson 하한으로 줄 세워 고르고, 뒤 20%에서 확인")
    for T in themes:
        if not quiet:
            log(f"\n  ▣ {T.name} ({', '.join(T.tk)}) · 앞 80% ~{T.cut80}")
            log("   [일부 매도 → 재진입 재매수] 상위 3")
        rows = search_trim(T)
        rec = recommend(T, rows, 3, quiet)
        for key, e, l, be, bl in rec[:1]:
            tot += 1
            if l["n"] >= MINN and l["hit"] >= 0.75:
                stars += 1
    return themes, stars, tot

def main():
    log(f"■ 테마별 일부 매도·재진입 검증 · 분석 {tr.ANALYSIS_FROM}~2026-11-04 · 비용 왕복 {COST}% · 재진입 최대 {MAXWAIT}일 · 후보 표본 {MINN}건+")
    tick = sorted({t for v in SECTORS.values() for t in v} | {"^VXN", "QQQ"})
    data = {}
    for t in tick:
        df = tr.fetch(t)
        if df is not None and t in STARTS:
            df = df[df.index >= STARTS[t]]
        data[t] = df
    themes, stars, tot = run_all(data)
    # 매수 추천(표본 5건+) — 같은 앞 80%/뒤 20%
    q = data["QQQ"].Close
    mkt = {"qqq_c": q, "qqq_ma20": q.rolling(20).mean(), "qqq_ma60": q.rolling(60).mean(), "vxn": data["^VXN"].Close}
    earn = {t: tr.earnings_days(t) for t in tick if t not in tr.NO_EARN and not t.startswith("^")}
    log("\n■ 테마별 매수(재진입·분할매수) 추천 — 표본 5건+ · 앞 80%(학습+검증)에서 고르고 뒤 20%(테스트) 확인")
    for nm in SECTORS:
        G = tr.Group(nm, data, mkt, earn)
        if not G.tickers or G.D < 200:
            continue
        for h in (5, 10):
            log(f"  ▣ {nm} · {h}거래일")
            buy_recommend(G, h)
    log(f"\n■ 일부 매도 1순위 규칙 중 뒤 20%에서 표본 5건+·이익 비율 75%+: {stars}/{tot}")
    if "--placebo" in sys.argv:
        k = int(sys.argv[sys.argv.index("--placebo") + 1])
        for s in range(k):
            rng = np.random.default_rng(2000 + s)
            pdata = {t: (tr.permuted(df, rng) if df is not None and not t.startswith("^V") else df) for t, df in data.items()}
            _, st, tt = run_all(pdata, quiet=True)
            log(f"  대조(수익률 섞기) {s+1}: {st}/{tt}")
    log(f"\n(총 {time.time()-T0:.0f}초)")

if __name__ == "__main__":
    main()
