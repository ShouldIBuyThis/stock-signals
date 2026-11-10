"""볼린저밴드 상단 돌파: 밴드 워크형 vs 상승 소진형 — docs/2026-11-10-bb-walk.md (결과 전 고정). 읽기 전용 · CI lab-quick.
사용: python tools/bb-walk-lab.py
"""
import ast, importlib.util, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)

def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py")
H, COOL = (3, 5, 10, 20), 5
FOCUS = ["MSFT", "NVDA", "TSLA", "NAIL", "SOXL"]

def rsi(c, n=14):
    d = np.diff(c, prepend=c[0]); up = np.clip(d, 0, None); dn = np.clip(-d, 0, None)
    au = pd.Series(up).ewm(alpha=1 / n, adjust=False).mean().to_numpy(); ad = pd.Series(dn).ewm(alpha=1 / n, adjust=False).mean().to_numpy()
    return 100 - 100 / (1 + au / np.where(ad == 0, np.nan, ad))

def wl_names():
    src = open(f"{ROOT}/main.py", encoding="utf-8").read()
    i = src.index("WATCHLIST = {"); j = src.index("\n}\n", i) + 2
    wl = ast.literal_eval(src[i + len("WATCHLIST = "):j])
    return {t: (cat, nm) for cat, g in wl.items() for t, nm in g.items()}

LEVK = ("3배", "2배", "레버리지", "3X", "2X", "Bull 3", "Ultra")

def lag(a, k):
    out = np.full(len(a), np.nan); out[k:] = a[:-k]; return out

def main():
    W = wl_names()
    lev = sorted(t for t, (_, nm) in W.items() if any(k.lower() in nm.lower() for k in LEVK) or t in ("SOXL", "NAIL", "TQQQ", "TECL", "UPRO", "SPXL", "FNGU", "LABU", "TNA", "FAS"))
    print("레버리지(이름·티커 기준):", ", ".join(lev) or "없음")
    qq = tr.fetch("QQQ"); q200 = qq["Close"].rolling(200).mean()
    regime = {str(d.date()): ("up" if c >= m else "down") for d, c, m in zip(qq.index, qq["Close"], q200) if not np.isnan(m)}
    ev = {}; base = {}
    variants = {"W": (1.5, 3), "W·BW1.3": (1.3, 3), "W·BW1.7": (1.7, 3), "W·%B2/5": (1.5, 2), "W·%B4/5": (1.5, 4)}
    for t, (cat, nm) in W.items():
        df = tr.fetch(t)
        if df is None or len(df) < 300: continue
        o, h, l, c = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close"))
        N = len(c); dates = np.array([str(d.date()) for d in df.index]); reg = np.array([regime.get(d, "") for d in dates])
        s = pd.Series(c); ma = s.rolling(20).mean().to_numpy(); sd = s.rolling(20).std(ddof=0).to_numpy()
        up, lo = ma + 2 * sd, ma - 2 * sd
        pb = (c - lo) / np.where(up - lo > 0, up - lo, np.nan); bw = (up - lo) / ma; R = rsi(c)
        ma5 = s.rolling(5).mean().to_numpy()
        r = h - l; uw = (h - np.maximum(o, c)) / np.where(r > 0, r, np.nan)
        o1 = np.full(N, np.nan); o1[:-1] = o[1:]
        fw = {}
        for n in H:
            f = np.full(N, np.nan); f[:-n] = (c[n:] / o1[:-n] - 1) * 100; fw[n] = f
        lmin = pd.Series(l[::-1]).rolling(10).min().to_numpy()[::-1]; hmax = pd.Series(h[::-1]).rolling(10).max().to_numpy()[::-1]
        mae = np.full(N, np.nan); mae[:-10] = (lmin[1:N - 9] / o1[:-10] - 1) * 100
        mfe = np.full(N, np.nan); mfe[:-10] = (hmax[1:N - 9] / o1[:-10] - 1) * 100
        ok = (np.arange(N) >= 260) & ~np.isnan(fw[3])
        for i in np.nonzero(ok)[0]:
            b = base.setdefault((cat, reg[i]), np.zeros((len(H), 2)))
            for j, n in enumerate(H):
                v = fw[n][i]
                if not np.isnan(v): b[j, 0] += v > 1; b[j, 1] += v < -1
        brk = (c > up) & (lag(c, 1) <= lag(up, 1))
        pbh = np.nan_to_num(pb) >= 0.8
        cnt5 = pd.Series(pbh.astype(float)).rolling(5).sum().to_numpy()
        bwr = bw / lag(bw, 5)
        maup = ma > lag(ma, 5); upup = up > lag(up, 5)
        lowrise = l > pd.Series(l).shift(1).rolling(5).min().to_numpy()
        hi20 = c >= pd.Series(c).rolling(20).max().to_numpy()
        rmax_prev = pd.Series(R).shift(1).rolling(20).max().to_numpy()
        div = hi20 & (R < rmax_prev)
        X = brk & (div | (np.nan_to_num(uw) >= 0.5) | (np.nan_to_num(bwr) > 1.5))
        masks = {"B0": brk, "OH": brk & (np.nan_to_num(pb) >= 0.9) & (np.nan_to_num(R) >= 70), "X": X}
        for k, (bth, need) in variants.items():
            masks[k] = brk & maup & upup & (np.nan_to_num(cnt5) >= need) & (np.nan_to_num(bwr) > 1.0) & (np.nan_to_num(bwr) <= bth) & lowrise
        masks["W∧RSI70"] = masks["W"] & (np.nan_to_num(R) >= 70)
        w2 = np.zeros(N, bool)
        for bi in np.nonzero(brk)[0]:
            if bi + 2 < N and pbh[bi + 1] and pbh[bi + 2] and l[bi + 2] >= l[bi + 1]: w2[bi + 2] = True
        masks["W2"] = w2
        rin = (lag(c, 1) > lag(up, 1)) & (c <= up)
        masks["R"] = rin; masks["R−S"] = rin & (c < ma5)
        grp = "레버리지" if t in lev else "일반"
        for k, m in masks.items():
            last = -10 ** 9
            for i in np.nonzero(m & ok)[0]:
                if i - last < COOL: continue
                last = i
                rec = (dates[i], cat, reg[i], t, grp) + tuple(fw[n][i] for n in H) + (mae[i], mfe[i])
                ev.setdefault(k, []).append(rec)

    def rate(vals):
        v = np.array([x for x in vals if not np.isnan(x)]); u, d = (v > 1).sum(), (v < -1).sum()
        return (u / (u + d) if u + d else np.nan), (v.mean() if len(v) else np.nan), len(v)
    def bline(rows, j):
        w = {}
        for r in rows: w[(r[1], r[2])] = w.get((r[1], r[2]), 0) + 1
        num = den = 0
        for key, cnt in w.items():
            b = base.get(key)
            if b is None or b[j].sum() == 0: continue
            num += cnt * b[j, 0] / b[j].sum(); den += cnt
        return num / den if den else np.nan
    allrows = [r for v in ev.values() for r in v]; ds = sorted({r[0] for r in allrows})
    mid = ds[len(ds) // 2]; test0 = ds[int(len(ds) * 0.7)]
    pc = lambda x: "—" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x*100:.0f}%"
    sg = lambda x: "—" if np.isnan(x) else f"{x:+.2f}"
    def line(k, rows, label=None):
        if not rows: print(f"  {label or k:10s} 0건"); return None
        parts = []; res = {}
        for j, n in enumerate(H[:3]):
            u, m, cnt = rate([r[5 + j] for r in rows]); bl = bline(rows, j); res[n] = u
            parts.append(f"+{n}일 {pc(u)}(기준 {pc(bl)}) 평균 {sg(m)}%")
        h1 = [r for r in rows if r[0] < mid]; h2 = [r for r in rows if r[0] >= mid]; te = [r for r in rows if r[0] >= test0]
        hh = " / ".join(pc(rate([r[6] for r in z])[0]) for z in (h1, h2, te))
        mae = np.nanmedian([r[9] for r in rows]); mfe = np.nanmedian([r[10] for r in rows])
        nd = len({r[0] for r in rows}); nt = len({r[3] for r in rows})
        print(f"  {label or k:10s} n{len(rows):5d}(날 {nd}·종목 {nt}) · " + " · ".join(parts) + f" | +5일 앞/뒤 반쪽/뒤30% {hh} | 10일 MAE 중앙 {sg(mae)}% · 더 오른 폭(MFE) 중앙 {sg(mfe)}%")
        return res
    print(f"\n=== 볼밴 상단 돌파: 밴드 워크 vs 소진 — 관심종목 {len(W)} · {ds[0]}~{ds[-1]} · 진입 다음 날 시가 · 반쪽 기준일 {mid} · 시험 구간 {test0}~ ===")
    print("상승 비율 = +1% 초과/(+1% 초과 + −1% 미만) · 기준 = 같은 섹터×QQQ 국면 평소 · OH는 화면 과열 감점 조건의 근사")
    order = ["B0", "OH", "W", "W∧RSI70", "X", "W2", "R", "R−S", "W·BW1.3", "W·BW1.7", "W·%B2/5", "W·%B4/5"]
    for g in ("전체", "일반", "레버리지"):
        print(f"\n■ {g}")
        for k in order:
            rows = [r for r in ev.get(k, []) if g == "전체" or r[4] == g]
            line(k, rows)
    print("\n■ 종목별(참고 — 표본 작음)")
    for t in FOCUS:
        print(f"  [{t}]")
        for k in ("B0", "W", "X", "W2", "R−S"):
            line(k, [r for r in ev.get(k, []) if r[3] == t], label="   " + k)

if __name__ == "__main__":
    main()
