"""고점 위험 추가 연구 2 — docs/2026-11-10-peak-risk.md '추가 연구 2'(결과 전 고정). 정의는 pattern_flags 그대로. CI 전용."""
import importlib.util, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)
import pattern_flags as pf
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py"); bb = _load("bb", "bb-walk-lab.py")
BS = (0.8, 0.9, 0.95, 1.0); COOL = 5; SPLIT = "2023-01-01"
def rising(m):
    m = np.asarray(m, bool); prev = np.r_[False, m[:-1]]; return m & ~prev
def cool(idx):
    out, last = [], -10 ** 9
    for i in idx:
        if i - last >= COOL: out.append(i); last = i
    return out
def main():
    W = bb.wl_names()
    qq = tr.fetch("QQQ"); q200 = qq["Close"].rolling(200).mean()
    regime = {str(d.date()): ("up" if c >= m else "down") for d, c, m in zip(qq.index, qq["Close"], q200) if not np.isnan(m)}
    rows = []        # 사건: (cond, date, ticker, cat, reg, key, metrics...)
    ctrl = []        # 조건 없는 날 표본(매칭용): (date, cat, reg, key, metrics, active_conds)
    nv = None
    for t, (cat, nm) in W.items():
        df = tr.fetch(t)
        if df is None or len(df) < 300: continue
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        N = len(c); dates = np.array([str(d.date()) for d in df.index]); reg = np.array([regime.get(d, "") for d in dates])
        fs = pf.flag_series(o, h, l, c, v, t); estar = np.asarray(fs["X_ESTAR"], bool)
        base = pf.peak_risk_series(o, h, l, c, estar, 0.5, 1.0)
        upw, pbh = base["upw"], base["pb_hi"]
        o1 = np.r_[o[1:], np.nan]
        def fwd(n):
            r = np.full(N, np.nan); r[:-n] = c[n:] / o1[:-n] - 1; return r * 100
        def mae(n):
            r = np.full(N, np.nan)
            for i in range(N - n): r[i] = (np.min(l[i + 1:i + 1 + n]) / o1[i] - 1) * 100
            return r
        R = {3: fwd(3), 5: fwd(5), 10: fwd(10)}; M = {3: mae(3), 5: mae(5)}
        tr14 = np.maximum.reduce([h - l, np.abs(h - np.r_[np.nan, c[:-1]]), np.abs(l - np.r_[np.nan, c[:-1]])])
        atrp = pd.Series(tr14).rolling(14).mean().to_numpy() / c * 100
        ret5p = np.r_[np.full(5, np.nan), c[5:] / c[:-5] - 1] * 100
        pbin = np.digitize(np.nan_to_num(pbh, nan=-9), [0.8, 0.9, 0.95, 1.0, 1.1])
        ok = (np.arange(N) >= 260) & ~np.isnan(R[5]) & ~np.isnan(M[5])
        cnt = lambda m: pd.Series(np.asarray(m, float)).rolling(3, min_periods=3).sum().to_numpy() >= 2
        conds = {"W 윗꼬리 반복만": cnt(np.nan_to_num(upw) >= 0.5), "E 석별형 단독": estar}
        for b in BS:
            ps = pf.peak_risk_series(o, h, l, c, estar, 0.5, b)
            conds[f"N 상단 근처만 b{b}"] = cnt(np.nan_to_num(pbh) >= b)
            conds[f"NW 근처+윗꼬리 b{b}"] = ps["s1"]
            conds[f"NWE +석별형 b{b}"] = ps["s2"]
            conds[f"NW+S 지지 이탈 b{b}"] = ps["stage"] == 3
            # NWE+S: 석별형 경고일(s2) 뒤 10봉 안 종가 < 그날 고정한 지지
            s3e = np.zeros(N, bool); lw = -10 ** 9
            for i in range(N):
                if 0 < i - lw <= 10 and np.isfinite(ps["sup"][lw]) and c[i] < ps["sup"][lw]: s3e[i] = True
                if ps["s2"][i]: lw = i
            conds[f"NWE+S b{b}"] = s3e
        anyc = np.zeros(N, bool)
        for m in conds.values(): anyc |= pd.Series(np.asarray(m, float)).rolling(5, min_periods=1).max().to_numpy() > 0.5
        for i in np.nonzero(ok)[0]:
            key = (pbin[i], atrp[i], ret5p[i])
            met = (R[3][i], R[5][i], R[10][i], M[3][i], M[5][i])
            if not anyc[i]: ctrl.append((dates[i], cat, reg[i], key, met, t))
        for name, m in conds.items():
            for i in cool([i for i in np.nonzero(rising(m) & ok)[0]]):
                rows.append((name, dates[i], t, cat, reg[i], (pbin[i], atrp[i], ret5p[i]), (R[3][i], R[5][i], R[10][i], M[3][i], M[5][i])))
        if t == "NVDA": nv = (dates, o, h, l, c, upw, pbh, conds, R, M)
    # 변동성·직전 5일 3분위(전 표본)
    av = np.array([r[3][1] for r in ctrl], float); rv = np.array([r[3][2] for r in ctrl], float)
    qa = np.nanquantile(av, [1/3, 2/3]); qr = np.nanquantile(rv, [1/3, 2/3])
    mk = lambda k: (int(k[0]), int(np.digitize(k[1], qa)) if np.isfinite(k[1]) else -1, int(np.digitize(k[2], qr)) if np.isfinite(k[2]) else -1)
    def metr(ms):
        a = np.array(ms, float)
        if not len(a): return None
        r3, r5, r10, m3, m5 = a.T
        d = lambda r: ((r < -1).sum() / max(1, ((r < -1) | (r > 1)).sum()))
        return {"n": len(a), "c3<0": np.mean(r3 < 0), "c5<0": np.mean(r5 < 0), "c5<-1": np.mean(r5 < -1), "c5<-3": np.mean(r5 < -3), "c5flat": np.mean(np.abs(r5) <= 1),
                "c3<-1": np.mean(r3 < -1), "c3<-3": np.mean(r3 < -3), "dir5": d(r5), "avg3": np.mean(r3), "avg5": np.mean(r5), "avg10": np.nanmean(r10),
                "m3med": np.median(m3), "m5med": np.median(m5), "m3<-2": np.mean(m3 <= -2), "m3<-3": np.mean(m3 <= -3), "m5<-2": np.mean(m5 <= -2), "m5<-3": np.mean(m5 <= -3), "m5<-5": np.mean(m5 <= -5)}
    def ctrl_metrics(period):
        C = [r for r in ctrl if (r[0] < SPLIT) == (period == "탐색")]
        byk = {}; byr = {}
        for r in C: byk.setdefault(mk(r[3]), []).append(r[4]); byr.setdefault((r[1], r[2]), []).append(r[4])
        return {k: metr(v) for k, v in byk.items()}, {k: metr(v) for k, v in byr.items()}
    CT = {p: ctrl_metrics(p) for p in ("탐색", "보류")}
    def weighted(evs, table, keyf, f):
        w = {}
        for e in evs: w[keyf(e)] = w.get(keyf(e), 0) + 1
        num = den = 0
        for k, cn in w.items():
            m = table.get(k)
            if m: num += cn * m[f]; den += cn
        return num / den if den else np.nan
    pc = lambda x: "—" if x is None or not np.isfinite(x) else f"{x*100:.0f}%"
    print(f"\n=== 고점 위험 추가 연구 2 — 관심종목 {len(W)} · 탐색 ~2022 / 보류 2023~ · 진입 다음 날 시가 · 대조: 매칭(고가 %B 구간×변동성 3분위×직전 5일 3분위) / 국면(섹터×QQQ) ===")
    print("표기: 종가<0 · <−1% · <−3% · ±1% 안 · 방향비(−1%/(±1% 밖)) · 평균 | 5일 MAE 중앙 · MAE≤−2/−3/−5% | [매칭 대조 MAE≤−3% · 종가<0] 차이")
    sel = None
    for period in ("탐색", "보류"):
        print(f"\n■ {period} 기간 (NVDA 포함 전체)")
        names = sorted({r[0] for r in rows}, key=lambda s: (s.split(" b")[0], s))
        best = []
        for name in names:
            ev = [r for r in rows if r[0] == name and ((r[1] < SPLIT) == (period == "탐색"))]
            m = metr([r[6] for r in ev])
            if not m: print(f"  {name:22s} 0건"); continue
            mt, rt = CT[period]
            cm3 = weighted(ev, mt, lambda e: mk(e[5]), "m5<-3"); cc0 = weighted(ev, mt, lambda e: mk(e[5]), "c5<0"); rc0 = weighted(ev, rt, lambda e: (e[3], e[4]), "c5<0"); rm3 = weighted(ev, rt, lambda e: (e[3], e[4]), "m5<-3")
            nd = len({r[1] for r in ev})
            print(f"  {name:22s} n{m['n']:5d}(날 {nd}) · 3일 종가<0 {pc(m['c3<0'])} <−3% {pc(m['c3<-3'])} MAE≤−3% {pc(m['m3<-3'])} · 5일 종가<0 {pc(m['c5<0'])} <−1% {pc(m['c5<-1'])} <−3% {pc(m['c5<-3'])} ±1%안 {pc(m['c5flat'])} 방향비 {pc(m['dir5'])} 평균 {m['avg5']:+.2f}% · 5일 MAE 중앙 {m['m5med']:+.2f}% ≤−2 {pc(m['m5<-2'])} ≤−3 {pc(m['m5<-3'])} ≤−5 {pc(m['m5<-5'])} · 10일 평균 {m['avg10']:+.2f}% (참고) | 매칭 MAE≤−3 {pc(cm3)}({(m['m5<-3']-cm3)*100:+.1f}) 종가<0 {pc(cc0)}({(m['c5<0']-cc0)*100:+.1f}) · 국면 MAE≤−3 {pc(rm3)} 종가<0 {pc(rc0)}")
            if period == "탐색" and " b" in name:
                evx = [r for r in ev if r[2] != "NVDA"]; mx = metr([r[6] for r in evx])
                if mx and mx["n"] >= 100: best.append((mx["m5<-3"] - weighted(evx, mt, lambda e: mk(e[5]), "m5<-3"), name))
        if period == "탐색":
            for fam in ("N 상단 근처만", "NW 근처+윗꼬리", "NWE +석별형", "NW+S 지지 이탈", "NWE+S"):
                cand = [x for x in best if x[1].startswith(fam)]
                if cand: c_ = max(cand); print(f"  → 탐색(NVDA 제외)에서 고른 b: {c_[1]} (MAE≤−3% 매칭 대비 {c_[0]*100:+.1f}%p)")
    if nv:
        dates, o, h, l, c, upw, pbh, conds, R, M = nv
        print("\n■ NVDA 2026-09-22 ~ 10-14 날짜별 (경고 가능 여부 · 그날 확정 → 다음 날 시가 진입 3·5일 최저가 기준 최대 하락폭)")
        for i, d in enumerate(dates):
            if not ("2026-09-22" <= d <= "2026-10-14"): continue
            on = [n for n, m in conds.items() if m[i] and (n.startswith("NW") or n.startswith("N ") or n.startswith("W") or n.startswith("E"))]
            fr = [n for n, m in conds.items() if m[i] and not (i and m[i - 1])]
            print(f"  {d} 시{o[i]:.2f} 고{h[i]:.2f} 저{l[i]:.2f} 종{c[i]:.2f} · 윗꼬리 {upw[i]*100:.0f}% · 고가 %B {pbh[i]:.2f} · 3일 MAE {M[3][i]:+.2f}% · 5일 MAE {M[5][i]:+.2f}% · 5일 종가 {R[5][i]:+.2f}% · 처음 켜진 조건: {', '.join(fr) if fr else '없음'}")
if __name__ == "__main__":
    main()
