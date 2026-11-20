#!/usr/bin/env python3
"""파동(엘리어트) 연구 — 조정 파동(ABC)·끝 대각으로 끝난 하락은 임펄스보다 빨리 전부 되돌리나
사전 등록: docs/2026-11-20-elliott-wave-lab.md · 읽기 전용(아무 파일도 안 고침) · CI에서만(야후).
사용: python tools/wave-lab.py            (WAVE_MOCK=1 이면 가짜 자료로 문법만 확인)
"""
import os, sys, bisect
import numpy as np
import pandas as pd

sys.path.insert(0, ".")
import main as M

RNG = np.random.default_rng(20)
ETF = ["QQQ", "SPY", "SOXX", "SMH", "IWM", "DIA", "XLK"]
M7 = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA"]
IDX = set(ETF + M7 + ["069500.KS", "229200.KS"])
UNIV = sorted(({t for d in M.WATCHLIST.values() for t in d} - set(M.LEVERAGED)) | set(ETF))
HS = (1, 5, 10, 20)
CLS = ["1다리", "ABC", "임펄스", "대각", "5파기타", "복합"]
SPLIT_D = "2021-07-01"


def load(interval, period):
    if os.environ.get("WAVE_MOCK"):
        out = {}
        n = 2500 if interval == "1d" else 3000
        for tk in UNIV[:12] + ETF[:3]:
            r = RNG.normal(0.0004, 0.02, n); c = 100 * np.exp(np.cumsum(r))
            h = c * (1 + np.abs(RNG.normal(0, 0.008, n))); l = c * (1 - np.abs(RNG.normal(0, 0.008, n)))
            idx = pd.date_range("2016-01-01", periods=n, freq="B" if interval == "1d" else "h")
            out[tk] = pd.DataFrame({"High": h, "Low": l, "Close": c}, index=idx)
        return out
    import yfinance as yf
    px = yf.download(UNIV, period=period, interval=interval, auto_adjust=True, progress=False, group_by="ticker", threads=True)
    out = {}
    for tk in UNIV:
        try:
            d = px[tk][["High", "Low", "Close"]].dropna()
        except Exception:
            continue
        d = d[(d["High"] >= d["Low"]) & (d["Close"] > 0)]
        if len(d) >= 300: out[tk] = d
    return out


def atr(H, L, C, n=14):
    pc = np.r_[C[0], C[:-1]]
    tr = np.maximum(H - L, np.maximum(np.abs(H - pc), np.abs(L - pc)))
    return pd.Series(tr).rolling(n, min_periods=n).mean().to_numpy()


def zigzag(H, L, C, A, th):
    """확정 피벗 [(idx, 'H'/'L', 확정봉)] — 종가가 극값에서 th·ATR(극값 봉) 이상 반대로 가면 확정."""
    P = []; d = 0; hi = lo = None
    for i in range(len(C)):
        if not np.isfinite(A[i]): continue
        if hi is None: hi = lo = i; continue
        if d == 0:
            if H[i] > H[hi]: hi = i
            if L[i] < L[lo]: lo = i
            if hi < i and C[i] <= H[hi] - th * A[hi]:
                P.append((hi, "H", i)); d = -1; lo = hi + 1 + int(np.argmin(L[hi + 1:i + 1])); continue
            if lo < i and C[i] >= L[lo] + th * A[lo]:
                P.append((lo, "L", i)); d = 1; hi = lo + 1 + int(np.argmax(H[lo + 1:i + 1])); continue
        elif d == 1:
            if H[i] > H[hi]: hi = i
            elif C[i] <= H[hi] - th * A[hi]:
                P.append((hi, "H", i)); d = -1; lo = hi + 1 + int(np.argmin(L[hi + 1:i + 1]))
        else:
            if L[i] < L[lo]: lo = i
            elif C[i] >= L[lo] + th * A[lo]:
                P.append((lo, "L", i)); d = 1; hi = lo + 1 + int(np.argmax(H[lo + 1:i + 1]))
    return P


def events(H, L, C, A, big, small, thB, down=True):
    """하락(down) 또는 상승 쪽 사건. 반환: (신호봉 pc, 극값 pi, 시작 h0, 다리 수 k, 분류, 파동 값들)."""
    if not down:
        H, L, C = -L, -H, -C
        big = [(i, "L" if t == "H" else "H", c) for i, t, c in big]
        small = [(i, "L" if t == "H" else "H", c) for i, t, c in small]
    out = []
    bc = [c for _, _, c in big]; sidx = [i for i, _, _ in small]
    for si, (pi, t, pc) in enumerate(small):
        if t != "L": continue
        j = int(np.searchsorted(bc, pc, side="right")) - 1          # pc까지 확정된 마지막 큰 피벗
        if j < 0 or big[j][1] != "H": continue
        h0 = big[j][0]
        if pi <= h0 or L[pi] > L[h0:pi + 1].min(): continue
        if H[h0] - L[pi] < thB * A[h0]: continue
        seq = small[bisect.bisect_right(sidx, h0):si + 1]
        if not seq or seq[-1][0] != pi: continue
        ok = all(seq[x][1] == ("L" if x % 2 == 0 else "H") for x in range(len(seq)))
        if not ok: continue
        k = len(seq)
        v = [H[h0]] + [L[p[0]] if p[1] == "L" else H[p[0]] for p in seq]
        if k == 1: c = "1다리"
        elif k == 3: c = "ABC"
        elif k == 5:
            w1, w3, w5 = v[0] - v[1], v[2] - v[3], v[4] - v[5]
            if v[4] >= v[1]: c = "대각"
            elif w3 > min(w1, w5) or (w3 >= w1 and w3 >= w5): c = "임펄스"
            else: c = "5파기타"
        else: c = "복합"
        out.append((pc, pi, h0, k, c, v))
    return out, (H, L, C)


def outcome(H, L, C, pc, pi, h0, n):
    T = max(1, pi - h0)
    if pc + max(T, 20) >= n: return None
    top, bot = H[h0], L[pi]
    fw = lambda m: (H[pc + 1:pc + 1 + m].max() >= top)
    o = dict(full=float(fw(T)), full10=float(fw(10)), full20=float(fw(20)),
             half=float(H[pc + 1:pc + 1 + T].max() >= bot + 0.5 * (top - bot)),
             brk=float(L[pc + 1:pc + 1 + T].min() < bot), T=T)
    for h in HS: o[f"r{h}"] = (C[pc + h] / C[pc] - 1) * 100
    return o


def run(data, thB, thS, label_tf, keep_detail):
    rows, base = [], []
    for tk, d in data.items():
        H0, L0, C0 = (d[c].to_numpy(float) for c in ("High", "Low", "Close"))
        A = atr(H0, L0, C0)
        big, small = zigzag(H0, L0, C0, A, thB), zigzag(H0, L0, C0, A, thS)
        dates = d.index
        grp = "지수·대형" if tk in IDX else "개별·소형"
        if keep_detail:
            for i in range(20, len(C0) - 20, 3):
                base.append(dict(g=grp, r10=(C0[i + 10] / C0[i] - 1) * 100, r5=(C0[i + 5] / C0[i] - 1) * 100))
        for down in (True, False):
            ev, (H, L, C) = events(H0, L0, C0, A, big, small, thB, down)
            for pc, pi, h0, k, c, v in ev:
                o = outcome(H, L, C, pc, pi, h0, len(C))
                if o is None: continue
                if not down:
                    for h in HS: o[f"r{h}"] = -o[f"r{h}"]       # 상승 쪽: 수익 부호를 뒤집어 '되돌림 쪽 = +'
                dt = dates[pc]
                o.update(tk=tk, g=grp, cls=c, k=k, down=down, d=str(dt)[:10], m=str(dt)[:7], dep=(H[h0] - L[pi]) / A[h0])
                if c == "ABC" and down:
                    # 기술용: 앞 상승 대비 하락 깊이 · flat(B가 A를 90%↑ 되돌림) 여부
                    o["flat"] = float((v[2] - v[1]) >= 0.9 * (v[0] - v[1]))
                rows.append(o)
    return pd.DataFrame(rows), pd.DataFrame(base)


def cboot(df, a, b, col="full", R=1000):
    """월 단위 군집 부트스트랩 Δ(a − b) 90% 구간."""
    sub = df[df.cls.isin([a, b])]
    if (sub.cls == a).sum() < 15 or (sub.cls == b).sum() < 15: return (np.nan, np.nan)
    ms = sub.m.unique(); G = {m: g for m, g in sub.groupby("m")}; out = []
    for _ in range(R):
        s = pd.concat([G[m] for m in RNG.choice(ms, len(ms))])
        x, y = s[s.cls == a][col], s[s.cls == b][col]
        if len(x) and len(y): out.append(x.mean() - y.mean())
    return (np.percentile(out, 5) * 100, np.percentile(out, 95) * 100) if out else (np.nan, np.nan)


pc_ = lambda x: "—" if not np.isfinite(x) else f"{x * 100:.0f}%"
sg = lambda x: "—" if not np.isfinite(x) else f"{x:+.2f}%"
grade = lambda n: "사용" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "불가"


def table(df, title):
    print(f"  {title}")
    for c in CLS:
        s = df[df.cls == c]
        if not len(s): continue
        print(f"    {c:5s} n={len(s):5d}({grade(len(s))}) · T봉 안 전부 {pc_(s.full.mean())} · 10봉 {pc_(s.full10.mean())} · 20봉 {pc_(s.full20.mean())}"
              f" · 절반 {pc_(s.half.mean())} · 저점 이탈 {pc_(s.brk.mean())} · 수익 1/5/10/20 {sg(s.r1.mean())} {sg(s.r5.mean())} {sg(s.r10.mean())} {sg(s.r20.mean())} · 중앙 T {s['T'].median():.0f}")


def verdict(df, a, b, split, tag):
    d = df.copy(); d["half_"] = np.where(d.d < split, "앞", "뒤")
    res = {}
    for hf in ("앞", "뒤"):
        s = d[d.half_ == hf]; x, y = s[s.cls == a], s[s.cls == b]
        res[hf] = dict(na=len(x), nb=len(y), dfull=(x.full.mean() - y.full.mean()) * 100 if len(x) and len(y) else np.nan,
                       dr10=x.r10.mean() - y.r10.mean() if len(x) and len(y) else np.nan)
    lo, hi = cboot(df, a, b)
    x, y = df[df.cls == a], df[df.cls == b]
    dall = (x.full.mean() - y.full.mean()) * 100 if len(x) and len(y) else np.nan
    print(f"  ▶ {tag} {a} − {b}: 전체 Δ {dall:+.1f}%p [{lo:+.1f}~{hi:+.1f}] (n {len(x)}/{len(y)}) · "
          + " · ".join(f"{hf} Δ {r['dfull']:+.1f}%p 10봉 수익 Δ {r['dr10']:+.2f}%p (n {r['na']}/{r['nb']})" for hf, r in res.items()))
    ok = (all(np.isfinite(r["dfull"]) and r["dfull"] >= 5 for r in res.values()) and np.isfinite(lo) and lo > 0
          and all(np.isfinite(r["dr10"]) and r["dr10"] >= 0 for r in res.values()) and all(r["na"] >= 50 and r["nb"] >= 50 for r in res.values()))
    return ok, dall


def surrogate(data, seed):
    """귀무 대조: 봉 단위(종가 수익·고가/종가·저가/종가)를 함께 무작위로 섞는다 → 순서 구조(파동)가 없는 가격."""
    g = np.random.default_rng(seed); out = {}
    for tk, d in data.items():
        C = d["Close"].to_numpy(float); r = np.diff(np.log(C)); hu = np.log(d["High"].to_numpy(float) / C); ld = np.log(d["Low"].to_numpy(float) / C)
        p = g.permutation(len(r)); c = C[0] * np.exp(np.r_[0, np.cumsum(r[p])]); q = np.r_[0, p + 1]
        out[tk] = pd.DataFrame({"High": c * np.exp(hu[q]), "Low": c * np.exp(ld[q]), "Close": c}, index=d.index)
    return out


def dfull(s, a, b):
    x, y = s[s.cls == a].full, s[s.cls == b].full
    return (x.mean() - y.mean()) * 100 if len(x) and len(y) else np.nan


DEPB = [3, 5, 8, 12, 1e9]
def dmatch(s, a, b):
    """하락 깊이(ATR 배수) 칸별 Δ의 가중 평균(가중 = na·nb/(na+nb))."""
    num = den = 0.0
    for lo, hi in zip(DEPB[:-1], DEPB[1:]):
        t = s[(s.dep >= lo) & (s.dep < hi)]; x, y = t[t.cls == a].full, t[t.cls == b].full
        if len(x) >= 5 and len(y) >= 5:
            w = len(x) * len(y) / (len(x) + len(y)); num += w * (x.mean() - y.mean()); den += w
    return num / den * 100 if den else np.nan


NSUR = int(os.environ.get("WAVE_NSUR", "20"))


def main():
    TF = [("일봉", "1d", "10y"), ("60분봉", "60m", "730d")]
    for name, iv, per in TF:
        data = load(iv, per)
        if not data: print(f"■ {name}: 자료 없음"); continue
        alld = sorted({str(x)[:10] for d in data.values() for x in d.index})
        split = SPLIT_D if iv == "1d" else alld[len(alld) // 2]
        print(f"\n■ {name} · {len(data)}종목 · {alld[0]}~{alld[-1]} · 절반 경계 {split} · 지수·대형 {sum(t in IDX for t in data)}종목")
        main_df, base = run(data, 3.0, 1.0, name, True)
        for g in ("지수·대형", "개별·소형"):
            b = base[base.g == g]
            if len(b): print(f"  기준선({g} 모든 봉 · 3봉 간격) 5봉 {sg(b.r5.mean())} 10봉 {sg(b.r10.mean())} · 10봉 플러스 {pc_((b.r10 > 0).mean())}")
        dn, up = main_df[main_df.down], main_df[~main_df.down]
        print(" [하락 쪽 — 저점 확정 봉 종가 진입 · '전부' = 하락 시작점 H0까지]")
        table(dn, "전체")
        for g in ("지수·대형", "개별·소형"): table(dn[dn.g == g], g)
        print(" [상승 쪽(H4) — 고점 확정 봉 종가 · '전부' = 상승 출발점까지 되돌림 · 수익은 부호 뒤집음(+ = 하락)]")
        table(up, "전체")
        for g in ("지수·대형", "개별·소형"): table(up[up.g == g], g)

        print(" [판정 — 사전 등록 §4]")
        h1, _ = verdict(dn, "ABC", "임펄스", split, "H1")
        h2, _ = verdict(dn, "대각", "임펄스", split, "H2")
        h4, _ = verdict(up, "대각", "임펄스", split, "H4(상승)")
        gd = {}
        for g in ("지수·대형", "개별·소형"):
            s = dn[dn.g == g]; x, y = s[s.cls == "ABC"], s[s.cls == "임펄스"]
            gd[g] = (x.full.mean() - y.full.mean()) * 100 if len(x) and len(y) else np.nan
        # H3: 그룹 차이의 군집 부트스트랩
        sub = dn[dn.cls.isin(["ABC", "임펄스"])]; ms = sub.m.unique(); G = {m: g for m, g in sub.groupby("m")}; out = []
        for _ in range(1000):
            s = pd.concat([G[m] for m in RNG.choice(ms, len(ms))]); v = []
            for g in ("지수·대형", "개별·소형"):
                t = s[s.g == g]; x, y = t[t.cls == "ABC"].full, t[t.cls == "임펄스"].full
                v.append(x.mean() - y.mean() if len(x) and len(y) else np.nan)
            if np.isfinite(v).all(): out.append((v[0] - v[1]) * 100)
        lo3 = np.percentile(out, 5) if out else np.nan; hi3 = np.percentile(out, 95) if out else np.nan
        print(f"  ▶ H3 ABC−임펄스 Δ: 지수·대형 {gd['지수·대형']:+.1f}%p · 개별·소형 {gd['개별·소형']:+.1f}%p · 차이 90% [{lo3:+.1f}~{hi3:+.1f}]")
        # 귀무 대조(순서 섞은 가격 NSUR회) · 깊이 맞춤 Δ
        NUL = {"h1": [], "h2": [], "h4": [], "h3": []}
        for k_ in range(NSUR):
            dfn, _ = run(surrogate(data, 1000 + k_), 3.0, 1.0, name, False); dn_, up_ = dfn[dfn.down], dfn[~dfn.down]
            NUL["h1"].append(dfull(dn_, "ABC", "임펄스")); NUL["h2"].append(dfull(dn_, "대각", "임펄스")); NUL["h4"].append(dfull(up_, "대각", "임펄스"))
            NUL["h3"].append(dfull(dn_[dn_.g == "지수·대형"], "ABC", "임펄스") - dfull(dn_[dn_.g == "개별·소형"], "ABC", "임펄스"))
        real = {"h1": dfull(dn, "ABC", "임펄스"), "h2": dfull(dn, "대각", "임펄스"), "h4": dfull(up, "대각", "임펄스"),
                "h3": gd["지수·대형"] - gd["개별·소형"]}
        DM = {"h1": dmatch(dn, "ABC", "임펄스"), "h2": dmatch(dn, "대각", "임펄스"), "h4": dmatch(up, "대각", "임펄스"), "h3": np.nan}
        beat = {}
        for key in ("h1", "h2", "h4", "h3"):
            v = np.array([x for x in NUL[key] if np.isfinite(x)])
            p95 = np.percentile(v, 95) if len(v) else np.nan; beat[key] = np.isfinite(p95) and real[key] > p95
            print(f"  귀무 대조 {key.upper()}: 실제 Δ {real[key]:+.1f}%p · 순서 섞은 가격 {len(v)}회 평균 {v.mean() if len(v) else np.nan:+.1f}%p · 95% {p95:+.1f}%p"
                  f" → {'넘음' if beat[key] else '못 넘음'} · 깊이 맞춤 Δ {DM[key]:+.1f}%p")
        # 고원: 이웃 θ
        plats = []
        for tb, ts in ((2.0, 2 / 3), (4.0, 4 / 3), (3.0, 1.5)):
            df2, _ = run(data, tb, ts, name, False); d2 = df2[df2.down]; u2 = df2[~df2.down]
            f = lambda s, a, b: (s[s.cls == a].full.mean() - s[s.cls == b].full.mean()) * 100
            r = dict(h1=f(d2, "ABC", "임펄스"), h2=f(d2, "대각", "임펄스"), h4=f(u2, "대각", "임펄스"),
                     n=(int((d2.cls == "ABC").sum()), int((d2.cls == "임펄스").sum()), int((d2.cls == "대각").sum())))
            plats.append(((tb, ts), r))
            print(f"  이웃 θB {tb:g}·θS {ts:.2f}: H1 Δ {r['h1']:+.1f}%p · H2 Δ {r['h2']:+.1f}%p · H4 Δ {r['h4']:+.1f}%p · n ABC/임펄스/대각 {r['n']}")
        pl = lambda key: all(np.isfinite(r[key]) and r[key] > 0 for (tb, _), r in plats if tb in (2.0, 4.0))
        okd = lambda key: np.isfinite(DM[key]) and DM[key] >= 5
        print(f"  ■ {name} 판정: H1 {'성립' if h1 and pl('h1') and beat['h1'] and okd('h1') else '불성립'} · H2 {'성립' if h2 and pl('h2') and beat['h2'] and okd('h2') else '불성립'}"
              f" · H3 {'성립' if np.isfinite(lo3) and lo3 > 0 and beat['h3'] else '불성립'} · H4 {'성립' if h4 and pl('h4') and beat['h4'] and okd('h4') else '불성립'}")
        print(f"     (조건별: H1 절반·구간·수익·표본 {h1} 고원 {pl('h1')} 귀무 {beat['h1']} 깊이 {okd('h1')} | H2 {h2}/{pl('h2')}/{beat['h2']}/{okd('h2')} | H4 {h4}/{pl('h4')}/{beat['h4']}/{okd('h4')})")
        # 기술: flat · zigzag(ABC 하락)
        a = dn[dn.cls == "ABC"]
        if "flat" in a:
            for nm, s in (("flat(B ≥ 0.9A)", a[a.flat == 1]), ("zigzag 등", a[a.flat == 0])):
                if len(s): print(f"  (기술) ABC {nm}: n={len(s)} · T봉 안 전부 {pc_(s.full.mean())} · 10봉 수익 {sg(s.r10.mean())}")
        # 연도별 H1 Δ (일봉만)
        if iv == "1d":
            yrs = []
            for y in sorted({x[:4] for x in dn.d}):
                s = dn[dn.d.str[:4] == y]; x, z = s[s.cls == "ABC"], s[s.cls == "임펄스"]
                if len(x) >= 10 and len(z) >= 10: yrs.append(f"{y} {(x.full.mean() - z.full.mean()) * 100:+.0f}({len(x)}/{len(z)})")
            print("  연도별 H1 Δ%p(n ABC/임펄스): " + " ".join(yrs))
        # 최근 사례(지수·대형 ABC 하락)
        r = dn[(dn.g == "지수·대형") & (dn.cls == "ABC")].sort_values("d").tail(6)
        print("  최근 지수·대형 ABC 하락 사례: " + " · ".join(f"{x.tk} {x.d} 전부{'✓' if x.full else '✗'} 10봉 {x.r10:+.1f}%" for x in r.itertuples()))


if __name__ == "__main__":
    main()
