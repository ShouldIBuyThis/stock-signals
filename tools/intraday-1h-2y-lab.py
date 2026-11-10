"""장중 '큰 흐름' 판정 2년 검증(60분봉 근사) — docs/2026-11-10-intraday-2y.md (결과 전 고정). CI 전용 · 읽기만.
사용: python tools/intraday-1h-2y-lab.py
"""
import ast, sys
import numpy as np, pandas as pd, yfinance as yf
ROOT = __file__.rsplit("/", 2)[0]

def watchlist():
    src = open(f"{ROOT}/main.py", encoding="utf-8").read()
    i = src.index("WATCHLIST = {"); j = src.index("\n}\n", i) + 2
    wl = ast.literal_eval(src[i + len("WATCHLIST = "):j])
    return [t for g in wl.values() for t in g]

def regime(sym):
    d = yf.Ticker(sym).history(period="4y", interval="1d", auto_adjust=True)["Close"]
    ma = d.rolling(200).mean(); prev = (d > ma).shift(1)          # 전날 종가 기준
    return {str(k.date()): ("상승장" if v else "하락장") for k, v in prev.items() if pd.notna(ma.shift(1).get(k)) and v == v}

def ema(x, n):
    return pd.Series(x).ewm(span=n, adjust=False).mean().to_numpy()

def main():
    tks = watchlist()
    REG = {"US": regime("QQQ"), "KR": regime("^KS11")}
    rows = []
    for t in tks:
        kr = t.endswith((".KS", ".KQ"))
        try:
            df = yf.Ticker(t).history(period="730d", interval="60m", prepost=False, auto_adjust=False)
        except Exception as e:
            print("skip", t, e); continue
        if df is None or len(df) < 300: print("skip", t, "봉 부족", 0 if df is None else len(df)); continue
        df = df.dropna(subset=["Open", "High", "Low", "Close"])
        idx = df.index.tz_convert("Asia/Seoul" if kr else "America/New_York")
        day = np.array([str(x.date()) for x in idx])
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        e9, e20 = ema(c, 9), ema(c, 20)
        tp = (h + l + c) / 3 * v; vw = np.full(len(c), np.nan); pv = vv = 0.0
        for i in range(len(c)):
            if i == 0 or day[i] != day[i - 1]: pv = vv = 0.0
            pv += tp[i]; vv += v[i]; vw[i] = pv / vv if vv > 0 else np.nan
        last_of_day = {}
        for i, d in enumerate(day): last_of_day[d] = i
        days = sorted(last_of_day); nxt = {days[k]: days[k + 1] for k in range(len(days) - 1)}
        R = REG["KR" if kr else "US"]
        for i in range(25, len(c) - 1):
            if day[i + 1] != day[i]: continue                     # 다음 봉이 같은 날일 때만(장 마감 봉 제외)
            vok = np.isnan(vw[i])
            up = (vok or c[i] > vw[i]) and e9[i] > e20[i] and e20[i] >= e20[i - 3]
            dn = (vok or c[i] < vw[i]) and e9[i] < e20[i]
            st = "상승" if up else "하락" if dn else "중립"
            p0 = o[i + 1]
            r1 = c[i + 1] / p0 - 1
            r2 = c[i + 2] / p0 - 1 if i + 2 < len(c) and day[i + 2] == day[i] else np.nan
            reod = c[last_of_day[day[i]]] / p0 - 1
            nd = nxt.get(day[i]); rnd = c[last_of_day[nd]] / p0 - 1 if nd else np.nan
            rows.append((t, "KR" if kr else "US", day[i], st, R.get(day[i], "?"), r1, r2, reod, rnd))
    df = pd.DataFrame(rows, columns=["t", "mkt", "day", "st", "reg", "r1", "r2", "eod", "nd"])
    ds = sorted(df.day.unique()); q = [ds[int(len(ds) * k / 4)] for k in range(1, 4)]
    df["blk"] = np.select([df.day < q[0], df.day < q[1], df.day < q[2]], ["B1", "B2", "B3"], "B4")
    print(f"=== 60분봉 2년 근사 — {df.t.nunique()}종목 · {ds[0]}~{ds[-1]} · 봉 {len(df)} · 블록 경계 {q} ===")
    def ur(s, down=False):
        s = s.dropna(); return (s < 0).mean() if down else (s > 0).mean()
    for mkt in ("US", "KR"):
        M = df[df.mkt == mkt]
        if not len(M): continue
        print(f"\n■ {mkt} · 종목 {M.t.nunique()} · 상승장 날 {M[M.reg=='상승장'].day.nunique()} · 하락장 날 {M[M.reg=='하락장'].day.nunique()}")
        for reg in ("전체", "상승장", "하락장"):
            G = M if reg == "전체" else M[M.reg == reg]
            if not len(G): continue
            base = {k: (ur(G[k]), ur(G[k], True), G[k].mean() * 100) for k in ("r1", "r2", "eod", "nd")}
            print(f"  [{reg}] 무작위(모든 봉) n{len(G)} · +1봉 상승 {base['r1'][0]:.1%} · +2봉 {base['r2'][0]:.1%} · 그날 종가 {base['eod'][0]:.1%} · 다음날 {base['nd'][0]:.1%}")
            for st in ("상승", "하락", "중립"):
                S = G[G.st == st]
                if not len(S): continue
                dn = st == "하락"
                cells = []
                for k, nm in (("r1", "+1봉"), ("r2", "+2봉"), ("eod", "그날 종가"), ("nd", "다음날")):
                    a = ur(S[k], dn); b = base[k][1] if dn else base[k][0]
                    cells.append(f"{nm} {a:.1%}({(a-b)*100:+.1f}%p) 평균 {S[k].mean()*100:+.3f}%")
                bl = []
                for B in ("B1", "B2", "B3", "B4"):
                    Sb, Gb = S[S.blk == B], G[G.blk == B]
                    if len(Sb) < 30: bl.append("—"); continue
                    bl.append(f"{(ur(Sb.r2, dn) - ur(Gb.r2, dn))*100:+.1f}")
                print(f"    {st}{'(하락 비율)' if dn else '(상승 비율)'} n{len(S)} · " + " · ".join(cells) + f" | 블록별 +2봉 차이(%p) {' / '.join(bl)}")

if __name__ == "__main__":
    main()
