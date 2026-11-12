"""🔬 고점판독기 2차 연구 — docs/2026-11-12-peak-reader.md '2차 연구' 사전 등록 그대로. CI 전용(야후).
(A) EXT 변동성 vs 붕괴 · (B) 52주 위치 × %B × 위험 캔들 · (C) 경고 누적. 조건 정의는 pattern_flags 한 곳.
사용: python tools/peak-reader-lab2.py --emit backtest/peak-reader2.json
"""
import argparse, importlib.util, json, sys, time
from datetime import datetime, timezone
import numpy as np, pandas as pd, yfinance as yf
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)
import pattern_flags as pf


def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m


bb = _load("bb", "bb-walk-lab.py")
EXTRA = ["QUBT", "000660.KS", "0023B0.KS", "SMCI", "MSTR", "COIN", "ARM", "CVNA", "UPST", "AFRM", "SOUN", "HOOD", "RIVN", "PLUG", "ENPH", "ZM", "PTON", "MRNA"]
NEW = ("NFLX SHOP ROKU TTD TWLO OKTA CRSP SE MELI SNAP PINS SPOT TDOC W CHWY RBLX DOCU DKNG U SOFI PATH ENVX RUN FSLR SEDG CELH NVAX BNTX "
       "NIO XPEV LI GME AMC OPEN BYND FUBO LCID 005930.KS 035420.KS 035720.KS 042700.KS 012450.KS 086520.KQ 247540.KQ 196170.KQ TQQQ TECL").split()
LEV = {"SOXL": 3, "GDXU": 3, "NAIL": 3, "UYG": 2, "DUSL": 3, "FNGU": 3, "BULZ": 3, "TQQQ": 3, "TECL": 3}
START, END, T_END, EXP_START = "2007-01-01", "2026-11-05", "2016-01-01", "2016-02-01"
STARTS = {"QUBT": "2018-03-01"}
THRS = (0.15, 0.20, 0.25, 0.30, 0.35)
NS, XS, US = (10, 20, 40, 60), (0.10, 0.15, 0.25, 0.35), (0.10, 0.20, 0.30)
B_PR = ["RSI_DIV", "MACD_FADE", "MACD_DEAD", "STOCH_DEAD"]
B_SIGS = ["ESTAR", "SHOOTS", "HANGS", "TOP", "UPW", "BIGBEAR"] + B_PR
PARTS = ("E", "T", "X")


def fetch(t):
    for _ in range(3):
        try:
            df = yf.Ticker(t).history(start=START, end=END, auto_adjust=True)
            if df is not None and len(df):
                df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
                df.index = pd.to_datetime([d.date() for d in df.index])
                df = df[(df.Close > 0) & (df.High > 0) & (df.Low > 0)].dropna(subset=["Close", "High", "Low", "Open"])
                return df[~df.index.duplicated(keep="last")]
        except Exception as e:
            print(f"  조회 재시도 {t}: {e}"); time.sleep(2)
    return None


def theme_of(t, cat):
    if t in LEV: return "레버리지"
    if cat == "양자컴퓨팅" or t in ("QUBT", "0023B0.KS"): return "양자"
    if cat == "우주·UAM": return "우주"
    if cat and cat.startswith("반도체") or t in ("000660.KS", "SMCI", "ARM", "042700.KS", "005930.KS"): return "반도체"
    if cat in ("데이터센터", "광통신"): return "AI인프라"
    return "그 밖"


def episodes(mask, cool=10):
    """조건이 cool봉 이상 꺼졌다가 처음 켜진 날만(같은 종목 연속 신호 1건)."""
    out = []; last = -10 ** 9
    for i in np.nonzero(mask)[0]:
        if i - last > cool: out.append(i)
        last = i
    return out


def wrate(dates, vals):
    """날짜 가중 비율/평균 — 같은 날 사건 수로 나눈 가중."""
    vals = np.asarray(vals, dtype=float); ok = np.isfinite(vals)
    if not ok.any(): return None
    d = np.asarray(dates)[ok]; v = vals[ok]
    _, inv, cnt = np.unique(d, return_inverse=True, return_counts=True); w = 1.0 / cnt[inv]
    return float((w * v).sum() / w.sum())


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--emit", default=""); a = ap.parse_args()
    W = bb.wl_names(); wl = set(W)
    orig = list(W) + [t for t in EXTRA if t not in wl]
    data = {}
    for t in orig + NEW:
        df = fetch(t)
        if df is None or len(df) < 260: print(f"  · {t} 제외({0 if df is None else len(df)})"); continue
        if t in STARTS: df = df[df.index >= STARTS[t]]
        data[t] = df
    print(f"종목 {len(data)} (원래 {sum(t in data for t in orig)} · 새 {sum(t in data for t in NEW)})")

    def part(t, d):
        if t in NEW: return "X"
        return "T" if d < T_END else ("E" if d >= EXP_START else None)

    # ── 종목별 계산 ──
    A_ev, A_ctl, C_rows, B_rows, peaks = [], [], [], [], []
    for t, df in data.items():
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        dates = [str(x.date()) for x in df.index]; n = len(c)
        cat = W.get(t, (None, None))[0]; th = theme_of(t, cat)
        fl = pf.peak_reader_flags(o, h, l, c, v, lev=LEV.get(t, 1), ticker=t); ax = fl["_aux"]
        tr_ = np.maximum(h - l, np.maximum(abs(h - np.r_[np.nan, c[:-1]]), abs(l - np.r_[np.nan, c[:-1]])))
        atr = pd.Series(tr_).rolling(20).mean().to_numpy() / c
        ext = (c / ax["ma20"] - 1) / max(LEV.get(t, 1), 1)
        # 미래 성과(평가 전용): 종가 진입 / 다음 날 시가 진입
        def outc(i, base):
            r = {}
            for N in NS:
                if i + N >= n: r[f"r{N}"] = np.nan; continue
                seg = c[i + 1:i + N + 1]
                r[f"r{N}"] = c[i + N] / base - 1; r[f"mn{N}"] = seg.min() / base - 1; r[f"mx{N}"] = seg.max() / base - 1
            for k in (3, 5, 7, 10):
                r[f"f{k}"] = c[i + k] / base - 1 if i + k < n else np.nan
            return r
        run = fl["RUN"]
        for thr in THRS:
            m = run & np.nan_to_num(ext >= thr - 1e-12, nan=False)
            for i in episodes(m):
                p = part(t, dates[i])
                if p is None or i + 1 >= n: continue
                A_ev.append({"t": t, "d": dates[i], "p": p, "thr": thr, "th": th, "atr": atr[i], "c": outc(i, c[i]), "o": outc(i, o[i + 1])})
        # 대조: RUN ∧ 최근 10일 EXT(25%) 없음 — 5봉 간격 표본
        e25 = np.nan_to_num(ext >= 0.25 - 1e-12, nan=False)
        rec = pd.Series(e25.astype(float)).rolling(11, min_periods=1).max().to_numpy() > 0.5
        for i in range(0, n, 5):
            if run[i] and not rec[i] and i + 1 < n:
                p = part(t, dates[i])
                if p: A_ctl.append({"t": t, "d": dates[i], "p": p, "th": th, "atr": atr[i], "c": outc(i, c[i]), "o": outc(i, o[i + 1])})
        # (C) 경고 누적: RUN 날 · 5봉 간격 · 최근 5일 켜진 조건 수
        on5 = np.zeros(n)
        for cd in pf.PR_GROUPS:
            on5 += pd.Series(np.asarray(fl[cd], dtype=float)).rolling(5, min_periods=1).max().to_numpy()
        for i in range(0, n, 5):
            if run[i]:
                p = part(t, dates[i])
                if p: C_rows.append({"d": dates[i], "p": p, "k": int(min(on5[i], 5)), "c": outc(i, c[i])})
        # (B) 교집합(52주 0~5% ∧ %B 상단) — 날마다 위치·신호·누적 기록(평가는 아래에서)
        rc, pb, p52 = pf.risk_candle_flags(o, h, l, c, v, t)
        sig = {k: np.asarray(rc[k], dtype=bool) for k in pf.RC_NAMES}
        for k in B_PR: sig[k] = np.asarray(fl[k], dtype=bool)
        evm = {}
        for k, arr in sig.items():
            m_ = np.zeros(n, bool); last_ = -99
            for i in np.nonzero(arr)[0]:
                if i - last_ > 3: m_[i] = True
                last_ = i
            evm[k] = m_
        k3 = np.zeros(n)
        for k, arr in sig.items(): k3 += pd.Series(arr.astype(float)).rolling(3, min_periods=1).max().to_numpy()
        for i in range(0, n - 10):
            if not (np.isfinite(p52[i]) and np.isfinite(pb[i])): continue
            p = part(t, dates[i])
            if not p: continue
            bits = sum(1 << j for j, k in enumerate(B_SIGS) if evm[k][i])
            B_rows.append((p, dates[i], pf.pos52_bucket(p52[i]), float(pb[i]), int(k3[i]), bits, i % 3 == 0,
                           c[i + 3] / c[i] - 1, c[i + 5] / c[i] - 1, c[i + 7] / c[i] - 1, c[i + 10] / c[i] - 1,
                           (c[i + 10] / o[i + 1] - 1) if i + 1 < n else np.nan))
        # 사례 단위: 국소 고점
        lo120 = pd.Series(c).rolling(120, min_periods=120).min().to_numpy(); last = -99
        for P in range(140, n - 60):
            if P - last < 20 or h[P] < h[P - 20:P + 21].max() or not (np.isfinite(lo120[P]) and c[P] >= lo120[P] * 1.5): continue
            last = P; pp = part(t, dates[P])
            if not pp: continue
            Dd = next((j for j in range(P + 1, min(n, P + 61)) if c[j] <= c[P] * 0.9), None)
            end = min(P + 10, (Dd - 1) if Dd else P + 10)
            hit = {thr: bool(np.any(np.nan_to_num(ext[max(0, P - 10):end + 1] >= thr - 1e-12, nan=False))) for thr in THRS}
            dd = {N: c[P + 1:P + N + 1].min() / c[P] - 1 for N in NS}
            peaks.append({"p": pp, "d": dates[P], "t": t, "th": th, "hit": hit, "dd": dd})

    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "kind": "research", "doc": "docs/2026-11-12-peak-reader.md#2차-연구",
           "parts": {"E": "탐색 2016-02~(이미 본 자료)", "T": "독립 T 2008~2015 같은 종목", "X": "독립 X 새 종목 2008~"}}

    # ── (A) EXT ──
    def agg(rows, key, fn):
        return wrate([r["d"] for r in rows], [fn(r[key]) for r in rows])
    def prof(rows, key="c"):
        z = {"n": len(rows), "dates": len({r["d"] for r in rows})}
        if not rows: return z
        for N in NS:
            for X in XS: z[f"dn{int(X*100)}_{N}"] = agg(rows, key, lambda q: np.nan if not np.isfinite(q.get(f"r{N}", np.nan)) else float(q[f"mn{N}"] <= -X))
            for U in US: z[f"up{int(U*100)}_{N}"] = agg(rows, key, lambda q: np.nan if not np.isfinite(q.get(f"r{N}", np.nan)) else float(q[f"mx{N}"] >= U))
            z[f"avg{N}"] = agg(rows, key, lambda q: q.get(f"r{N}", np.nan))
        return z
    def matched(ev, ctl, key="c"):
        """변동성 맞춤 대조: 묶음 RUN 대조 날의 ATR 5분위 × 사건 분포 가중."""
        allatr = np.array([r["atr"] for r in ctl if np.isfinite(r["atr"])])
        if len(allatr) < 50 or not ev: return None
        qs = np.quantile(allatr, [0.2, 0.4, 0.6, 0.8])
        b = lambda x: int(np.searchsorted(qs, x)) if np.isfinite(x) else -1
        evb = [b(r["atr"]) for r in ev]; z = {}
        keys = None
        for k in range(5):
            share = sum(1 for x in evb if x == k) / len(evb)
            if share == 0: continue
            pk = prof([r for r in ctl if b(r["atr"]) == k], key)
            if keys is None: keys = [x for x in pk if x not in ("n", "dates")]
            for kk in keys:
                if pk.get(kk) is not None: z[kk] = z.get(kk, 0) + share * pk[kk]
        return z
    A = {}
    print("\n■ (A) 이격 과열(EXT) — 날짜 가중 · 사건=10봉 쿨다운 · 종가 진입(괄호: 다음 날 시가)")
    print("  묶음 문턱 | 사건(날) | 40일 −25% 도달 · 맞춤대조 · 평소 | 40일 +20% 도달 · 맞춤 · 평소 | 20일 평균 · 맞춤 · 평소 | (시가 진입 40일 −25%)")
    for P in PARTS:
        ctl = [r for r in A_ctl if r["p"] == P]; base = prof(ctl)
        for thr in THRS:
            ev = [r for r in A_ev if r["p"] == P and r["thr"] == thr]
            pe, pm, po = prof(ev), matched(ev, ctl), prof(ev, "o")
            # 같은 종목 대조
            tks = {}
            for r in ev: tks[r["t"]] = tks.get(r["t"], 0) + 1
            same = {}
            for tk, wgt in tks.items():
                q = prof([r for r in ctl if r["t"] == tk])
                for kk in ("dn25_40", "up20_40", "avg20"):
                    if q.get(kk) is not None: same.setdefault(kk, []).append((wgt, q[kk]))
            pt = {kk: sum(w * x for w, x in v_) / sum(w for w, _ in v_) for kk, v_ in same.items()}
            A[f"{P}|{int(thr*100)}"] = {"ev": pe, "matched": pm, "base": base, "same_ticker": pt, "open": po}
            f = lambda x: "—" if x is None else f"{x*100:5.1f}"
            if pe["n"]:
                print(f"  {P} {int(thr*100):>2}% | {pe['n']:>4}({pe['dates']:>4}) | {f(pe.get('dn25_40'))} · {f(pm and pm.get('dn25_40'))} · {f(base.get('dn25_40'))} | {f(pe.get('up20_40'))} · {f(pm and pm.get('up20_40'))} · {f(base.get('up20_40'))} | {f(pe.get('avg20'))} · {f(pm and pm.get('avg20'))} · {f(base.get('avg20'))} | ({f(po.get('dn25_40'))})")
    # 25% 상세 격자(독립 T·X)
    for P in ("T", "X"):
        e = A.get(f"{P}|25")
        if not e or not e["ev"]["n"]: continue
        print(f"  {P} 25% 격자 — 하락 도달(EXT/맞춤): " + " · ".join(f"{N}일 −{int(X*100)}% {e['ev'].get(f'dn{int(X*100)}_{N}', 0)*100:.0f}/{(e['matched'] or {}).get(f'dn{int(X*100)}_{N}', 0)*100:.0f}" for N in NS for X in XS))
        print(f"  {P} 25% 격자 — 추가 상승(EXT/맞춤): " + " · ".join(f"{N}일 +{int(U*100)}% {e['ev'].get(f'up{int(U*100)}_{N}', 0)*100:.0f}/{(e['matched'] or {}).get(f'up{int(U*100)}_{N}', 0)*100:.0f}" for N in (20, 40, 60) for U in US))
        print(f"  {P} 25% 같은 종목 대조: 40일 −25% {pt_fmt(e['same_ticker'], 'dn25_40')} · 40일 +20% {pt_fmt(e['same_ticker'], 'up20_40')} · 20일 평균 {pt_fmt(e['same_ticker'], 'avg20')}")
    # 테마
    TH = {}
    print("  테마(EXT 25% · 전 묶음 합산 · 사건 수) — 40일 −25% / +20% / 20일 평균  vs 테마 평소")
    for th in ("양자", "우주", "반도체", "AI인프라", "레버리지", "그 밖"):
        ev = [r for r in A_ev if r["thr"] == 0.25 and r["th"] == th]; ct = [r for r in A_ctl if r["th"] == th]
        pe, pc = prof(ev), prof(ct); TH[th] = {"ev": pe, "base": pc}
        if pe["n"]: print(f"    {th:<6} {pe['n']:>4}건 | {pe['dn25_40']*100:.0f}% / {pe['up20_40']*100:.0f}% / {pe['avg20']*100:+.1f}%  vs {pc.get('dn25_40', 0)*100:.0f}% / {pc.get('up20_40', 0)*100:.0f}% / {(pc.get('avg20') or 0)*100:+.1f}%")
    # 사례 단위 격자
    CASE = {}
    print("  사례 단위(고점 → N일 안 −X% 도달 vs 미도달 고점의 EXT 포착률, 문턱 25%) — 묶음별")
    for P in PARTS:
        pk = [q for q in peaks if q["p"] == P]; row = []
        for N in NS:
            for X in XS:
                yes = [q for q in pk if q["dd"][N] <= -X]; no = [q for q in pk if q["dd"][N] > -X]
                cy = np.mean([q["hit"][0.25] for q in yes]) if yes else None; cn = np.mean([q["hit"][0.25] for q in no]) if no else None
                CASE[f"{P}|{N}|{int(X*100)}"] = {"yes": len(yes), "no": len(no), "cap": cy, "flag_no": cn}
                if (N, X) in ((20, 0.15), (40, 0.25), (60, 0.35)): row.append(f"{N}일 −{int(X*100)}%: {cy*100 if cy is not None else float('nan'):.0f}%({len(yes)}) vs {cn*100 if cn is not None else float('nan'):.0f}%({len(no)})")
        print(f"    {P} 고점 {len(pk)} · " + " · ".join(row))
    out["A"] = {"by_part": A, "theme": TH, "cases": CASE}

    # 판정
    def verdict():
        res = {}
        for P in ("T", "X"):
            r = {}
            for thr in (0.20, 0.25, 0.30):
                e = A.get(f"{P}|{int(thr*100)}"); m = e and e["matched"]; ev = e and e["ev"]; bs = e and e["base"]
                if not e or not m or not ev.get("n"): r[thr] = None; continue
                r[thr] = {"dD": ev["dn25_40"] - m["dn25_40"], "dR": ev["avg20"] - m["avg20"], "dU": ev["up20_40"] - m["up20_40"],
                          "bD": ev["dn25_40"] - bs["dn25_40"], "bU": ev["up20_40"] - bs["up20_40"], "n": ev["n"]}
            res[P] = r
        def bubble(P):
            x = res[P].get(0.25)
            if not x: return False
            same = all(res[P].get(t_) and res[P][t_]["dD"] > 0 and res[P][t_]["dR"] < 0 for t_ in (0.20, 0.30))
            return x["dD"] >= 0.08 and x["dR"] <= -0.02 and x["dU"] <= 0.03 and same
        def vol(P):
            x = res[P].get(0.25)
            return bool(x) and x["bD"] >= 0.08 and x["bU"] >= 0.05
        if all(bubble(P) for P in ("T", "X")): v = "버블 붕괴 조기 경고에 유효"
        elif all(vol(P) for P in ("T", "X")): v = "급격한 변동성 확대 경고에만 유효"
        else: v = "실전 활용 근거 부족"
        return v, res
    v, vres = verdict()
    out["A"]["verdict"] = v; out["A"]["verdict_detail"] = {P: {str(k): x for k, x in d.items()} for P, d in vres.items()}
    for P, d in vres.items():
        for thr, x in d.items():
            if x: print(f"  판정 재료 {P} {int(thr*100)}%: 맞춤 대비 40일−25% {x['dD']*100:+.1f}%p · 20일평균 {x['dR']*100:+.1f}%p · 40일+20% {x['dU']*100:+.1f}%p | 평소 대비 −25% {x['bD']*100:+.1f}%p · +20% {x['bU']*100:+.1f}%p (n{x['n']})")
    print(f"  ▶ EXT 판정: {v}")

    # ── (B) 교집합 분석 ──
    R = {"p": np.array([r[0] for r in B_rows]), "d": np.array([r[1] for r in B_rows]), "bk": np.array([str(r[2]) for r in B_rows]),
         "pb": np.array([r[3] for r in B_rows]), "k3": np.array([r[4] for r in B_rows]), "bits": np.array([r[5] for r in B_rows], dtype=np.int64),
         "smp": np.array([r[6] for r in B_rows]), "f3": np.array([r[7] for r in B_rows]), "f5": np.array([r[8] for r in B_rows]),
         "f7": np.array([r[9] for r in B_rows]), "f10": np.array([r[10] for r in B_rows]), "f10o": np.array([r[11] for r in B_rows])}
    print(f"\n■ (B) 52주 고점 0~5% ∧ 볼밴 상단 교집합 — 날 {len(B_rows):,} (252봉 미만 제외) · 10일 하락 비율(±1% 보합 제외, 날짜 가중)")
    def st(mask):
        d = R["d"][mask]; z = {"n": int(mask.sum()), "dates": int(len(set(d)))}
        for k in (3, 5, 7, 10):
            f = R[f"f{k}"][mask]; ind = np.where(f < -0.01, 1.0, np.where(f > 0.01, 0.0, np.nan))
            z[f"dn{k}"] = wrate(d, ind); z[f"avg{k}"] = wrate(d, f)
        fo = R["f10o"][mask]; z["dn10_open"] = wrate(d, np.where(fo < -0.01, 1.0, np.where(fo > 0.01, 0.0, np.nan)))
        return z
    GR = lambda L: {"교집합(0~5%∧%B)": (R["bk"] == "0~5") & (R["pb"] >= L), "5~10%∧%B": (R["bk"] == "5~10") & (R["pb"] >= L),
                    "10~20%∧%B": (R["bk"] == "10~20") & (R["pb"] >= L), "%B만": R["pb"] >= L, "52주만(0~5%)": R["bk"] == "0~5", "전체": np.ones(len(R["d"]), bool)}
    Bout = {"signals": B_SIGS, "names": {**pf.RC_NAMES, **{k: pf.PR_NAMES[k] for k in B_PR}}, "levels": {}}
    f_ = lambda x: "—" if x is None else f"{x*100:.0f}"
    for L in (0.8, 0.9, 1.0):
        Lk = str(int(L * 100)); G = GR(L); lv = {"groups": {}, "signals": {}, "stack": {}}
        print(f"  ── %B ≥ {L:.1f} ──  [묶음 E/T/X: 10일 하락%(사건·표본)]")
        for gname, gm in G.items():
            e = {P: st(gm & R["smp"] & (R["p"] == P)) for P in PARTS}; lv["groups"][gname] = e
            print(f"    기준선 {gname:<14} " + " / ".join(f"{f_(e[P]['dn10'])}({e[P]['n']})" for P in PARTS) + "  · 5일 " + " / ".join(f_(e[P]["dn5"]) for P in PARTS))
        INT = G["교집합(0~5%∧%B)"]; base = lv["groups"]["교집합(0~5%∧%B)"]
        inc = all((base[P]["dn10"] or 0) - (lv["groups"]["%B만"][P]["dn10"] or 0) >= 0.03 and (base[P]["dn10"] or 0) - (lv["groups"]["52주만(0~5%)"][P]["dn10"] or 0) >= 0.03 for P in PARTS)
        lv["intersection_adds"] = bool(inc)
        print(f"    교집합 추가 예측력(%B만·52주만 대비 +3%p, 세 묶음): {'있음' if inc else '없음'}")
        for j, k in enumerate(B_SIGS):
            m = INT & ((R["bits"] >> j) & 1).astype(bool)
            e = {P: st(m & (R["p"] == P)) for P in PARTS}
            ok = all(e[P]["n"] >= 50 and e[P]["dn10"] is not None and base[P]["dn10"] is not None and e[P]["dn10"] - base[P]["dn10"] >= 0.05
                     and e[P]["dn5"] is not None and base[P]["dn5"] is not None and e[P]["dn5"] - base[P]["dn5"] >= 0.03 for P in PARTS)
            # 단독(교집합 무관) 통계
            ea = {P: st(((R["bits"] >> j) & 1).astype(bool) & (R["p"] == P)) for P in PARTS}
            lv["signals"][k] = {"in": e, "alone": ea, "pass": bool(ok)}
            if L == 0.9 or ok:
                print(f"    {Bout['names'][k]:<16} 교집합 " + " / ".join(f"{f_(e[P]['dn10'])}({((e[P]['dn10'] or 0)-(base[P]['dn10'] or 0))*100:+.0f})·{e[P]['n']}" for P in PARTS)
                      + f" | 3·5·7일(E) {f_(e['E']['dn3'])}·{f_(e['E']['dn5'])}·{f_(e['E']['dn7'])} | 단독 " + " / ".join(f"{f_(ea[P]['dn10'])}·{ea[P]['n']}" for P in PARTS) + (" ✅" if ok else ""))
        seqs = {}
        for P in PARTS:
            sq = []
            for kk in range(5):
                m = INT & R["smp"] & (R["p"] == P) & ((R["k3"] == kk) if kk < 4 else (R["k3"] >= 4))
                z = st(m); lv["stack"][f"{P}|{kk}"] = z; sq.append(z["dn10"])
            seqs[P] = sq
            print(f"    누적 {P}: " + " | ".join(f"{kk}{'+' if kk == 4 else ''}개 {f_(lv['stack'][f'{P}|{kk}']['dn10'])}% 평균{(lv['stack'][f'{P}|{kk}']['avg10'] or 0)*100:+.1f}·{lv['stack'][f'{P}|{kk}']['n']}" for kk in range(5)))
        def mono(sq):
            s_ = [x for x in sq if x is not None]
            return len(s_) == 5 and sum(1 for i_ in range(1, 5) if s_[i_] < s_[i_ - 1]) <= 1 and s_[4] - s_[0] >= 0.05
        lv["stack_pass"] = bool(all(mono(seqs[P]) for P in PARTS))
        print(f"    ▶ 누적할수록 하락 증가: {'예' if lv['stack_pass'] else '아니오'} · 통과 신호: {', '.join(Bout['names'][k] for k in B_SIGS if lv['signals'][k]['pass']) or '없음'}")
        Bout["levels"][Lk] = lv
    out["B"] = Bout

    # ── (C) 경고 누적 ──
    print("\n■ (C) 경고 누적(최근 5일 켜진 조건 수) — 10일 하락 · 20일 −15% · 10일 평균 · 40일 +20% · 표본  [묶음별]")
    C = {}
    mono = {}
    for P in PARTS:
        seq = []
        for k in range(6):
            rows = [r for r in C_rows if r["p"] == P and r["k"] == k]
            d10 = wrate([r["d"] for r in rows], [np.nan if not np.isfinite(r["c"].get("r10", np.nan)) else (1.0 if r["c"]["r10"] < -0.01 else (0.0 if r["c"]["r10"] > 0.01 else np.nan)) for r in rows])
            b15 = wrate([r["d"] for r in rows], [np.nan if not np.isfinite(r["c"].get("r20", np.nan)) else float(r["c"]["mn20"] <= -0.15) for r in rows])
            a10 = wrate([r["d"] for r in rows], [r["c"].get("r10", np.nan) for r in rows])
            u20 = wrate([r["d"] for r in rows], [np.nan if not np.isfinite(r["c"].get("r40", np.nan)) else float(r["c"]["mx40"] >= 0.20) for r in rows])
            C[f"{P}|{k}"] = {"n": len(rows), "dn10": d10, "big15_20": b15, "avg10": a10, "up20_40": u20}; seq.append(d10)
        s4 = [x for x in seq[:5] if x is not None]
        flips = sum(1 for i_ in range(1, len(s4)) if s4[i_] < s4[i_ - 1])
        mono[P] = bool(len(s4) == 5 and flips <= 1 and seq[4] is not None and seq[0] is not None and seq[4] - seq[0] >= 0.05)
        f = lambda x: "—" if x is None else f"{x*100:.0f}"
        print(f"  {P}: " + " | ".join(f"{k}{'+' if k == 5 else ''}개 {f(C[f'{P}|{k}']['dn10'])}/{f(C[f'{P}|{k}']['big15_20'])}/{(C[f'{P}|{k}']['avg10'] or 0)*100:+.1f}/{f(C[f'{P}|{k}']['up20_40'])}·{C[f'{P}|{k}']['n']}" for k in range(6)))
    stack_ok = all(mono.values())
    print(f"  ▶ 겹칠수록 커짐: {'예' if stack_ok else '아니오'} ({', '.join(f'{k}:{v_}' for k, v_ in mono.items())})")
    out["C"] = {"rows": C, "monotonic": mono, "pass": stack_ok}

    if a.emit:
        json.dump(out, open(a.emit, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"), default=lambda x: None if x is None or (isinstance(x, float) and not np.isfinite(x)) else (float(x) if isinstance(x, (np.floating,)) else (bool(x) if isinstance(x, np.bool_) else str(x))))
        print(f"→ {a.emit} 저장")


def pt_fmt(d, k):
    return "—" if d.get(k) is None else f"{d[k]*100:.1f}{'%' if k != 'avg20' else '%'}"



if __name__ == "__main__":
    main()
