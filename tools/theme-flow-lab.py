"""테마 52주 신고가 흐름 × 고점권 교집합 조합 × 1·3·5·7일 일부익절 — docs/2026-11-12-theme-flow.md §1~5 사전 등록 그대로(탐색 연구). CI 전용.
조건 정의는 pattern_flags 재사용. 현재 관심종목 고정 유니버스 소급(생존 편향). 미국·한국 분리 · 레버리지 제외 · 252봉 미만 제외.
사용: python tools/theme-flow-lab.py --breadth backtest/theme-breadth.json --emit backtest/theme-flow.json [--groups backtest/group-breadth.json]
"""
import argparse, importlib.util, json, os, sys, time
from datetime import datetime, timezone
import numpy as np, pandas as pd, yfinance as yf
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)
import pattern_flags as pf


def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m


bb = _load("bb", "bb-walk-lab.py")
LEV = {"SOXL", "GDXU", "NAIL", "UYG", "DUSL", "FNGU", "BULZ"}
START = "2015-01-01"
H = (1, 3, 5, 7)
MIN_N = 4
WEAK, SPREAD, NEIGH = -0.05, 0.05, (0.03, 0.08)
COST = 0.0015
is_kr = lambda t: t.endswith(".KS") or t.endswith(".KQ")


def fetch(t):
    for _ in range(3):
        try:
            df = yf.Ticker(t).history(start=START, auto_adjust=True)
            if df is not None and len(df):
                df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
                df.index = pd.to_datetime([d.date() for d in df.index])
                df = df[(df.Close > 0) & (df.High > 0) & (df.Low > 0)].dropna(subset=["Close", "High", "Low", "Open"])
                return df[~df.index.duplicated(keep="last")]
        except Exception as e:
            print(f"  조회 재시도 {t}: {e}"); time.sleep(2)
    return None


def r5(x):
    return pd.Series(x).rolling(5, min_periods=5).mean().to_numpy()


def sh(x, k):
    return np.r_[np.full(k, np.nan), x[:-k]]


def rmax(b, k):
    return pd.Series(np.asarray(b, float)).rolling(k, min_periods=1).max().to_numpy() > 0.5


def cooldown(mask, cool):
    out, last = [], -10 ** 9
    for i in np.nonzero(mask)[0]:
        if i - last > cool: out.append(i)
        last = i
    return out


# ── 날짜 가중 통계 ──
def drate(dates, x, sign=-1):
    """sign=-1: 하락 비율(−1% 미만 / ±1% 밖) · +1: 상승 비율. 날짜 가중."""
    x = np.asarray(x, float); d = np.asarray(dates); ok = np.isfinite(x) & (np.abs(x) > 0.01)
    if not ok.any(): return None
    hit = ((x[ok] < -0.01) if sign < 0 else (x[ok] > 0.01)).astype(float)
    _, inv, cnt = np.unique(d[ok], return_inverse=True, return_counts=True); w = 1.0 / cnt[inv]
    return float((w * hit).sum() / w.sum())


def dmean(dates, x):
    x = np.asarray(x, float); d = np.asarray(dates); ok = np.isfinite(x)
    if not ok.any(): return None
    _, inv, cnt = np.unique(d[ok], return_inverse=True, return_counts=True); w = 1.0 / cnt[inv]
    return float((w * x[ok]).sum() / w.sum())


def stats(ev):
    if not ev: return {"n": 0, "dates": 0}
    D = [e["d"] for e in ev]; g = lambda k: [e.get(k, np.nan) for e in ev]
    z = {"n": len(ev), "dates": len(set(D))}
    for h in H:
        z[f"dn{h}"] = drate(D, g(f"f{h}")); z[f"up{h}"] = drate(D, g(f"f{h}"), +1); z[f"avg{h}"] = dmean(D, g(f"f{h}"))
        z[f"dno{h}"] = drate(D, g(f"fo{h}")); z[f"avgo{h}"] = dmean(D, g(f"fo{h}"))
    z["mfe7"], z["mae7"] = dmean(D, g("mfe7")), dmean(D, g("mae7"))
    pk = np.array(g("peak"), float); pk = pk[np.isfinite(pk)]
    z["peak_med"] = float(np.median(pk)) if len(pk) else None; z["peak_le1"] = float((pk <= 1).mean()) if len(pk) else None
    z["miss5"] = dmean(D, g("miss5"))
    for h in (3, 5, 7):
        hold = np.array(g(f"fo{h}"), float); trim = hold * 2 / 3 - COST / 3
        z[f"hold{h}"], z[f"trim{h}"] = dmean(D, hold), dmean(D, trim)
        z[f"trimwin{h}"] = dmean(D, np.where(np.isfinite(hold), (trim > hold).astype(float), np.nan))
        md = np.array(g(f"mdd{h}"), float); z[f"mddhold{h}"], z[f"mddtrim{h}"] = dmean(D, md), dmean(D, md * 2 / 3)
    return z


RNG = np.random.default_rng(20261112)


def compare(S, C, key="f5", sign=-1, mid=None):
    """부분집합 S 대 나머지 C — 5일 하락(또는 상승) 비율 차이 · 날짜 군집 부트스트랩 90% CI · 반쪽 · 통과 판정."""
    s, c = stats(S), stats(C); k = "dn" if sign < 0 else "up"
    out = {"S": s, "C": c}
    if not S or not C or s.get(f"{k}5") is None or c.get(f"{k}5") is None:
        out.update({"diff5": None, "ci": [None, None], "verdict": "표본 부족"}); return out
    diff = {h: (None if s.get(f"{k}{h}") is None or c.get(f"{k}{h}") is None else s[f"{k}{h}"] - c[f"{k}{h}"]) for h in H}
    # 부트스트랩: 날짜별 (적중 수, 유효 수)
    def per_date(ev):
        m = {}
        for e in ev:
            x = e.get(key, np.nan)
            if not np.isfinite(x) or abs(x) <= 0.01: continue
            a = m.setdefault(e["d"], [0, 0]); a[1] += 1; a[0] += int((x < -0.01) if sign < 0 else (x > 0.01))
        return m
    ms, mc = per_date(S), per_date(C); dates = sorted(set(ms) | set(mc)); nd = len(dates)
    rs = np.array([ms[d][0] / ms[d][1] if d in ms else np.nan for d in dates]); rc = np.array([mc[d][0] / mc[d][1] if d in mc else np.nan for d in dates])
    bs = []
    for _ in range(2000):
        ix = RNG.integers(0, nd, nd); a, b = rs[ix], rc[ix]
        if np.isfinite(a).sum() and np.isfinite(b).sum(): bs.append(np.nanmean(a) - np.nanmean(b))
    ci = [float(np.quantile(bs, 0.05)), float(np.quantile(bs, 0.95))] if len(bs) > 200 else [None, None]
    halves = []
    for lo in (True, False):
        s_ = [e for e in S if (e["d"] < mid) == lo]; c_ = [e for e in C if (e["d"] < mid) == lo]
        a, b = drate([e["d"] for e in s_], [e.get(key, np.nan) for e in s_], sign), drate([e["d"] for e in c_], [e.get(key, np.nan) for e in c_], sign)
        halves.append(None if a is None or b is None else a - b)
    enough = s["n"] >= 50 and s["dates"] >= 30
    same = all(diff[h] is not None and diff[h] > 0 for h in (3, 7))
    avg_ok = s.get("avg5") is not None and c.get("avg5") is not None and ((s["avg5"] < c["avg5"]) if sign < 0 else (s["avg5"] > c["avg5"]))
    hv = all(x is not None and x > 0 for x in halves)
    ok = enough and diff[5] is not None and diff[5] >= 0.05 and same and avg_ok and ci[0] is not None and ci[0] > 0 and hv
    out.update({"diff": {str(h): diff[h] for h in H}, "diff5": diff[5], "ci": ci, "halves": halves,
                "verdict": "탐색 통과" if ok else ("표본 부족" if not enough else "미통과")})
    return out


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--emit", default=""); ap.add_argument("--breadth", default=""); ap.add_argument("--groups", default=""); a = ap.parse_args()
    W = bb.wl_names()
    data = {}
    for t in list(W) + ["QQQ"]:
        df = fetch(t)
        if df is None or len(df) < 30: print(f"  · {t} 제외({0 if df is None else len(df)})"); continue
        data[t] = df
    mk4 = None
    if a.groups and os.path.exists(a.groups):
        gj = json.load(open(a.groups, encoding="utf-8")); ss = gj.get("state_series", {})
        mk4 = set().union(*[set(ss.get(k, [])) for k in ("R_DEF", "H_NDX", "H_SP", "ALL_DN")])
        print(f"4그룹 상태(MK4) 날짜 {len(mk4)}일 불러옴")

    def build(market):
        """시장별 마스터 날짜축에 종목 상태를 정렬하고 테마 집계를 만든다."""
        base_t = "QQQ" if market == "us" else "069500.KS"
        if base_t not in data: return None
        idx = data[base_t].index; N = len(idx); dates = [str(d.date()) for d in idx]
        tk = [t for t in W if t in data and is_kr(t) == (market == "kr") and t not in LEV]
        T = {}
        for t in tk:
            df = data[t]; df = df[df.index.isin(idx)]
            if len(df) < 30: continue
            o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
            pos_ = idx.get_indexer(df.index); n = len(c)
            hh = pd.Series(h).rolling(252, min_periods=252).max().to_numpy(); ll = pd.Series(l).rolling(252, min_periods=252).min().to_numpy()
            ok = np.isfinite(hh)
            T[t] = {"o": o, "h": h, "l": l, "c": c, "v": v, "pos": pos_, "ok": ok, "nh": ok & (c >= hh * 0.99), "nl": ok & (c <= ll * 1.01), "p52": c / hh - 1,
                    "first_ok": (str(df.index[np.argmax(ok)].date()) if ok.any() else None)}
        def on_master(t, key, fill=False):
            x = np.full(N, fill, dtype=bool); x[T[t]["pos"]] = T[t][key]; return x
        M = {t: {k: on_master(t, k) for k in ("ok", "nh", "nl")} for t in T}
        cats = {}
        for t in T: cats.setdefault(W[t][0], []).append(t)
        return {"idx": idx, "N": N, "dates": dates, "T": T, "M": M, "cats": cats}

    US = build("us"); KR = build("kr")
    N, dates, T, M, cats = US["N"], US["dates"], US["T"], US["M"], US["cats"]
    print(f"미국 종목 {len(T)}(레버리지 제외) · 테마 {len(cats)} · n≥{MIN_N} 가능한 테마 {sum(len(v) >= MIN_N for v in cats.values())} · 기간 {dates[0]}~{dates[-1]}")

    def agg(members, skip=None):
        ms = [t for t in members if t != skip]
        nn = np.sum([M[t]["ok"] for t in ms], axis=0); nh = np.sum([M[t]["nh"] for t in ms], axis=0); nl = np.sum([M[t]["nl"] for t in ms], axis=0)
        d5n = np.sum([rmax(M[t]["nh"], 5) for t in ms], axis=0)
        return nn.astype(float), nh.astype(float), nl.astype(float), d5n

    def derive(nn, nh, nl, min_n):
        ok = nn >= min_n
        hr = np.where(ok, nh / np.maximum(nn, 1), np.nan); lr = np.where(ok, nl / np.maximum(nn, 1), np.nan)
        hr5, lr5 = r5(hr), r5(lr); net5 = hr5 - lr5
        return {"ok": ok, "hr": hr, "lr": lr, "hr5": hr5, "lr5": lr5, "net5": net5, "d5": net5 - sh(net5, 5), "d3": net5 - sh(net5, 3), "d10": net5 - sh(net5, 10)}

    # 시장 확인 MK: 미국 전체(레버리지 제외)
    un, uh, ul, _ = agg(list(T)); UNI = derive(un, uh, ul, 20)
    MK = np.nan_to_num(UNI["d5"], nan=0) < 0
    MK4 = np.array([d in mk4 for d in dates]) if mk4 is not None else None
    q = data["QQQ"]["Close"].to_numpy(float); ma200 = pd.Series(q).rolling(200).mean().to_numpy(); r60 = q / sh(q, 60) - 1
    regime = np.where((q > ma200) & (r60 > 0.05), "상승", np.where(q < ma200, "하락", "횡보")).astype(object); regime[~np.isfinite(ma200)] = ""

    # ── 종목별 조건(자기 봉) → 사건 ──
    parents = {"A": [], "O": [], "P5": [], "P5W": [], "OH": [], "IB": []}
    theme_of = {t: c for c, ms in cats.items() for t in ms}
    for cat, ms in cats.items():
        if len(ms) < MIN_N: continue                                   # 종목 수가 최소 표본 미만인 테마는 연구 대상 아님
        full = agg(ms)
        for t in ms:
            X = T[t]; n = len(X["c"]); pos_ = X["pos"]
            if n < 300: continue
            ln, lh, ll_, ld5 = agg(ms, skip=t); L = derive(ln, lh, ll_, MIN_N - 1)
            valid = (full[0] >= MIN_N)[pos_]                              # 테마 n≥4(자기 포함)인 날만 연구 대상
            def tw(thr): return (np.nan_to_num(L["d5"], nan=0) <= thr) & (np.nan_to_num(sh(L["hr5"], 5), nan=0) > 0)
            def ts(thr): return (np.nan_to_num(L["d5"], nan=0) >= thr) & (ld5 >= 2) & (np.nan_to_num(L["lr5"], nan=9) <= np.nan_to_num(sh(L["lr5"], 5), nan=-9))
            TW, TS = tw(WEAK)[pos_], ts(SPREAD)[pos_]
            TWn = {str(x): tw(-x)[pos_] for x in NEIGH}
            NARROW = X["nh"] & (ld5[pos_] == 0)
            o, h, l, c, v = X["o"], X["h"], X["l"], X["c"], X["v"]
            rc, pb, p52 = pf.risk_candle_flags(o, h, l, c, v, t)
            fl = pf.peak_reader_flags(o, h, l, c, v, lev=1, ticker=t); fs = pf.flag_series(o, h, l, c, v, t)
            RC = np.any([np.asarray(rc[k], bool) for k in pf.RC_NAMES], axis=0)
            M3 = rmax(np.asarray(fl["RSI_DIV"], bool) | np.asarray(fl["MACD_FADE"], bool) | np.asarray(fl["STOCH_DEAD"], bool), 3)
            I = np.nan_to_num(p52, nan=-9) >= -0.05
            I8 = I & (np.nan_to_num(pb, nan=-9) >= 0.8)
            Oc = np.any([np.asarray(fs[k], bool) for k in ("O_RSI", "O_EXT", "O_TURN", "O_VOLSTALL")], axis=0)
            ret5 = c / sh(c, 5) - 1
            rng_ = np.where(h - l > 0, h - l, np.nan); upw = (h - np.maximum(o, c)) / rng_
            v5 = pd.Series(v).rolling(5).mean().to_numpy(); v20 = pd.Series(v).rolling(20).mean().to_numpy()
            WK = (np.nan_to_num(upw, nan=0) >= 0.5) | rmax(np.asarray(fl["RSI_DIV"], bool), 3) | (np.nan_to_num(v5, nan=9e18) < np.nan_to_num(v20, nan=0))
            P5 = I & (np.nan_to_num(ret5, nan=-9) > 0)
            OH = X["nh"] & (np.nan_to_num(fl["_aux"]["rsi"], nan=0) >= 70)
            mkm, mk4m = MK[pos_], (MK4[pos_] if MK4 is not None else None); rg = regime[pos_]

            def outc(i):
                e = {"t": t, "d": dates[pos_[i]], "cat": cat, "tn": int(full[0][pos_[i]]), "tw": bool(TW[i]), "ts": bool(TS[i]), "narrow": bool(NARROW[i]), "m3": bool(M3[i]),
                     "mk": bool(mkm[i]), "mk4": (bool(mk4m[i]) if mk4m is not None else None), "rg": rg[i], "rc": bool(RC[i]), "pb9": bool(np.nan_to_num(pb[i], nan=-9) >= 0.9),
                     "tw3": bool(TWn["0.03"][i]), "tw8": bool(TWn["0.08"][i])}
                if i + 1 >= n: return None
                ent = o[i + 1]
                for hh_ in H:
                    e[f"f{hh_}"] = c[i + hh_] / c[i] - 1 if i + hh_ < n else np.nan
                    e[f"fo{hh_}"] = c[i + hh_] / ent - 1 if i + hh_ < n else np.nan
                if i + 7 < n:
                    e["mfe7"] = h[i + 1:i + 8].max() / c[i] - 1; e["mae7"] = l[i + 1:i + 8].min() / c[i] - 1
                    e["miss5"] = float(c[i + 1:i + 8].max() >= ent * 1.05)
                if i + 10 < n: e["peak"] = int(np.argmax(c[i:i + 11]))
                for hh_ in (3, 5, 7):
                    e[f"mdd{hh_}"] = l[i + 1:i + hh_ + 1].min() / ent - 1 if i + hh_ < n else np.nan
                return e
            for name, mask, cool in (("A", I8 & RC & valid, 5), ("O", Oc & valid, 5), ("P5", P5 & valid, 5), ("P5W", P5 & WK & valid, 5), ("OH", OH & valid, 5)):
                for i in cooldown(mask, cool):
                    e = outc(i)
                    if e: parents[name].append(e)
            for i in np.nonzero(I8 & ~RC & valid)[0][::3]:                 # 기준선: 기본 교집합인데 위험 캔들 없는 날(3봉 간격 표본)
                e = outc(i)
                if e: parents["IB"].append(e)

    allE = sorted({e["d"] for v_ in parents.values() for e in v_}); mid = allE[len(allE) // 2] if allE else "2021-01-01"
    f_ = lambda x: "—" if x is None else f"{x*100:.0f}"
    p1 = lambda x: "—" if x is None else f"{x*100:+.1f}"
    def line(nm, z):
        return (f"  {nm:<26} {z['n']:>5}건({z['dates']:>4}일) | 하락 {f_(z.get('dn1'))}·{f_(z.get('dn3'))}·{f_(z.get('dn5'))}·{f_(z.get('dn7'))}% | 상승 {f_(z.get('up1'))}·{f_(z.get('up3'))}·{f_(z.get('up5'))}·{f_(z.get('up7'))}% | 평균 {p1(z.get('avg1'))}·{p1(z.get('avg3'))}·{p1(z.get('avg5'))}·{p1(z.get('avg7'))}% | "
                f"7일 최대상승 {p1(z.get('mfe7'))} 최대하락 {p1(z.get('mae7'))} | 고점까지 중앙 {z.get('peak_med')}일(0~1일 {f_(z.get('peak_le1'))}%) | 놓침 {f_(z.get('miss5'))}% | 시가진입 5일 하락 {f_(z.get('dno5'))}%") if z["n"] else f"  {nm:<26} 0건"
    def cline(nm, r):
        ci = "—" if r["ci"][0] is None else f"{r['ci'][0]*100:+.0f}~{r['ci'][1]*100:+.0f}"
        hv = "/".join("—" if x is None else f"{x*100:+.0f}" for x in r.get("halves", [None, None]))
        d = r.get("diff") or {}
        return f"  ▷ {nm}: 5일 차 {p1(r['diff5'])}%p (1·3·7일 {p1(d.get('1'))}·{p1(d.get('3'))}·{p1(d.get('7'))}) · 90% CI {ci}%p · 전/후반 {hv}%p · {r['verdict']}"

    R = {"sets": {}, "compare": {}, "strategy": {}, "break": {}}
    print(f"\n■ 개별 신호 묶음 성적 (테마 n≥{MIN_N}인 날 · 날짜 가중 · 신호일 종가 기준 1·3·5·7일)")
    A, O = parents["A"], parents["O"]
    sets = {"IB 기본 교집합(캔들 없음 · 기준선)": parents["IB"], "A 교집합∩위험캔들": A,
            "A+M 모멘텀 약화": [e for e in A if e["m3"]], "A+T 테마 약화": [e for e in A if e["tw"]], "A+T+MK 시장 확인": [e for e in A if e["tw"] and e["mk"]],
            "O 과열(🟠 코드)": O, "O+T": [e for e in O if e["tw"]], "O+T+MK": [e for e in O if e["tw"] and e["mk"]],
            "DV 다이버전스": [e for e in parents["P5"] if e["tw"]], "DV+ 약화 징후 동반": [e for e in parents["P5W"] if e["tw"]],
            "OH 신고가∩RSI70": parents["OH"], "OH∩테마 확산": [e for e in parents["OH"] if e["ts"]]}
    if MK4 is not None:
        sets["A+T+MK4(4그룹)"] = [e for e in A if e["tw"] and e["mk4"]]; sets["O+T+MK4(4그룹)"] = [e for e in O if e["tw"] and e["mk4"]]
    for nm, ev in sets.items():
        z = stats(ev); R["sets"][nm] = z; print(line(nm, z))
    print("\n■ 비교(부분집합 대 나머지) — 5일 하락 비율 차이 · 통과 기준은 사전 등록 §4")
    cmp = {"A 대 IB(위험 캔들의 효과)": (A, parents["IB"], -1), "A+M 대 A∖M": ([e for e in A if e["m3"]], [e for e in A if not e["m3"]], -1),
           "A+T 대 A∖T": ([e for e in A if e["tw"]], [e for e in A if not e["tw"]], -1),
           "A+T+MK 대 A의 나머지": ([e for e in A if e["tw"] and e["mk"]], [e for e in A if not (e["tw"] and e["mk"])], -1),
           "A+T+MK 대 A+T∖MK": ([e for e in A if e["tw"] and e["mk"]], [e for e in A if e["tw"] and not e["mk"]], -1),
           "O+T 대 O∖T": ([e for e in O if e["tw"]], [e for e in O if not e["tw"]], -1),
           "O+T+MK 대 O의 나머지": ([e for e in O if e["tw"] and e["mk"]], [e for e in O if not (e["tw"] and e["mk"])], -1),
           "DV 대 고점권 상승(테마 약화 아님)": ([e for e in parents["P5"] if e["tw"]], [e for e in parents["P5"] if not e["tw"]], -1),
           "DV+ 대 약화 징후(테마 약화 아님)": ([e for e in parents["P5W"] if e["tw"]], [e for e in parents["P5W"] if not e["tw"]], -1),
           "OH∩확산 대 OH∩비확산(상승 비율)": ([e for e in parents["OH"] if e["ts"]], [e for e in parents["OH"] if not e["ts"]], +1)}
    if MK4 is not None:
        cmp["A+T+MK4 대 A의 나머지"] = ([e for e in A if e["tw"] and e["mk4"]], [e for e in A if not (e["tw"] and e["mk4"])], -1)
    for nm, (S_, C_, sg) in cmp.items():
        r = compare(S_, C_, "f5", sg, mid); R["compare"][nm] = r; print(cline(nm, r))
    print("  이웃 문턱(고원 확인) A+T 대 A∖T 5일 차: " + " · ".join(f"Δ5≤−{int(float(k)*100)}%p {p1(compare([e for e in A if e['tw' + k[2:].lstrip('0')]], [e for e in A if not e['tw' + k[2:].lstrip('0')]], 'f5', -1, mid)['diff5'])}%p" for k in ("0.03", "0.08")))
    print("  %B≥0.9로 좁힌 A+T 대 A∖T: " + cline("", compare([e for e in A if e["pb9"] and e["tw"]], [e for e in A if e["pb9"] and not e["tw"]], "f5", -1, mid)).strip())
    # 분해
    print("\n■ 분해 — A+T 대 A∖T의 5일 하락 비율(사건 수)")
    def brk(nm, keyf):
        row = {}
        for lab in sorted({keyf(e) for e in A if keyf(e) not in ("", None)}):
            s_ = [e for e in A if keyf(e) == lab and e["tw"]]; c_ = [e for e in A if keyf(e) == lab and not e["tw"]]
            a_, b_ = stats(s_), stats(c_); row[str(lab)] = {"S": a_.get("dn5"), "Sn": a_["n"], "C": b_.get("dn5"), "Cn": b_["n"]}
        R["break"][nm] = row
        print(f"  {nm}: " + " | ".join(f"{k} {f_(v['S'])}%({v['Sn']}) 대 {f_(v['C'])}%({v['Cn']})" for k, v in row.items()))
    brk("시장 국면", lambda e: e["rg"]); brk("테마 규모", lambda e: "n 4~5" if e["tn"] <= 5 else "n 6+"); brk("소수 집중", lambda e: "소수 집중" if e["narrow"] else "그 밖")
    # 전략
    print("\n■ 1/3 일부익절(다음 날 시가 · 매도분 비용 0.15%) 대 전량 보유 — 3·5·7일")
    for nm in ("A 교집합∩위험캔들", "A+T 테마 약화", "A+T+MK 시장 확인", "O 과열(🟠 코드)", "O+T", "DV 다이버전스", "DV+ 약화 징후 동반"):
        z = R["sets"][nm]
        if not z["n"]: continue
        R["strategy"][nm] = {h: {"hold": z.get(f"hold{h}"), "trim": z.get(f"trim{h}"), "win": z.get(f"trimwin{h}"), "mdd_hold": z.get(f"mddhold{h}"), "mdd_trim": z.get(f"mddtrim{h}")} for h in (3, 5, 7)}
        print(f"  {nm:<22} " + " | ".join(f"{h}일 보유 {p1(z.get(f'hold{h}'))}% 익절 {p1(z.get(f'trim{h}'))}% (익절 유리 {f_(z.get(f'trimwin{h}'))}%) 낙폭 {p1(z.get(f'mddhold{h}'))}→{p1(z.get(f'mddtrim{h}'))}%" for h in (3, 5, 7)) + f" · {z['n']}건")

    # ── §5 테마 약세·반등 ──
    print("\n■ 테마 약세·반등(테마 단위 · 동일가중 평균 수익 · 상승 비율)")
    Cm = {}
    for t in T:
        x = np.full(N, np.nan); x[T[t]["pos"]] = T[t]["c"]; Cm[t] = x
    TE = {"LOWSURGE": [], "LOWMANY": [], "LOWSTOP": [], "HIGHBACK": [], "BASE": []}
    for cat, ms in cats.items():
        nn, nh, nl, _ = agg(ms); F = derive(nn, nh, nl, MIN_N)
        if not F["ok"].any(): continue
        fw = {}
        for h in H:
            rets = np.array([np.r_[Cm[t][h:] / Cm[t][:-h] - 1, np.full(h, np.nan)] for t in ms]); okm = np.array([M[t]["ok"] for t in ms])
            rets = np.where(okm, rets, np.nan)
            cnt_ = np.isfinite(rets).sum(axis=0); fw[h] = np.where(cnt_ > 0, np.nansum(rets, axis=0) / np.maximum(cnt_, 1), np.nan)
        lr5, hr5 = F["lr5"], F["hr5"]
        mx10 = pd.Series(lr5).shift(1).rolling(10, min_periods=10).max().to_numpy()
        mxl20 = pd.Series(lr5).shift(1).rolling(20, min_periods=20).max().to_numpy(); mxh20 = pd.Series(hr5).shift(1).rolling(20, min_periods=20).max().to_numpy()
        masks = {"LOWSURGE": np.nan_to_num(lr5 - sh(lr5, 5), nan=0) >= 0.10, "LOWMANY": np.nan_to_num(lr5, nan=0) >= 0.20,
                 "LOWSTOP": (np.nan_to_num(mx10, nan=0) >= 0.10) & (np.nan_to_num(lr5, nan=9) <= mx10 - 0.05),
                 "HIGHBACK": (np.nan_to_num(hr5, nan=0) > 0) & (np.nan_to_num(mxh20, nan=9) == 0) & (np.nan_to_num(mxl20, nan=0) >= 0.10)}
        mk_ev = lambda i: {"d": dates[i], "cat": cat, **{f"f{h}": fw[h][i] for h in H}}
        for k_, m_ in masks.items():
            for i in cooldown(m_ & F["ok"], 10): TE[k_].append(mk_ev(i))
        for i in np.nonzero(F["ok"] & np.isfinite(lr5))[0][::5]: TE["BASE"].append(mk_ev(i))
    R["theme_rebound"] = {}
    for k_ in ("LOWSURGE", "LOWMANY", "LOWSTOP", "HIGHBACK"):
        ev = TE[k_]; D = [e["d"] for e in ev]
        r = compare(ev, TE["BASE"], "f5", +1, mid); R["theme_rebound"][k_] = r
        z = {h: (drate(D, [e[f"f{h}"] for e in ev], +1), dmean(D, [e[f"f{h}"] for e in ev])) for h in H}
        bz = {h: (drate([e["d"] for e in TE["BASE"]], [e[f"f{h}"] for e in TE["BASE"]], +1), dmean([e["d"] for e in TE["BASE"]], [e[f"f{h}"] for e in TE["BASE"]])) for h in H}
        r["up"] = {str(h): z[h][0] for h in H}; r["avg"] = {str(h): z[h][1] for h in H}; r["base_up"] = {str(h): bz[h][0] for h in H}; r["base_avg"] = {str(h): bz[h][1] for h in H}
        print(f"  {k_:<9} {len(ev):>4}건 | 상승 {'·'.join(f_(z[h][0]) for h in H)}%(평소 {'·'.join(f_(bz[h][0]) for h in H)}) | 평균 {'·'.join(p1(z[h][1]) for h in H)}%(평소 {'·'.join(p1(bz[h][1]) for h in H)}) | " + cline("상승 비율 대 평소", r).strip())

    # ── 화면용 테마 폭 자료 ──
    if a.breadth:
        out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "kind": "display", "doc": "docs/2026-11-12-theme-flow.md",
               "note": "현재 관심종목 고정 유니버스 소급 분석(과거에 뺀 종목 없음 — 생존 편향) · 252봉 미만 제외 · 레버리지 제외 · 신고가권 = 종가 ≥ 52주 고가 × 0.99",
               "min_n": MIN_N, "markets": {}}
        for mk_name, B in (("us", US), ("kr", KR)):
            if not B: continue
            keep = slice(max(0, B["N"] - 800), B["N"]); th = {}
            for cat, ms in B["cats"].items():
                nn = np.sum([B["M"][t]["ok"] for t in ms], axis=0); nh = np.sum([B["M"][t]["nh"] for t in ms], axis=0); nl = np.sum([B["M"][t]["nl"] for t in ms], axis=0)
                th[cat] = {"members": ms, "n": [int(x) for x in nn[keep]], "nh": [int(x) for x in nh[keep]], "nl": [int(x) for x in nl[keep]]}
            out["markets"][mk_name] = {"dates": B["dates"][keep], "themes": th, "first_ok": {t: B["T"][t]["first_ok"] for t in B["T"]}}
        json.dump(out, open(a.breadth, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"→ {a.breadth} 저장")
    if a.emit:
        clean = lambda o: None if isinstance(o, float) and not np.isfinite(o) else (float(o) if isinstance(o, np.floating) else (int(o) if isinstance(o, np.integer) else (bool(o) if isinstance(o, np.bool_) else str(o))))
        res = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "kind": "research-exploratory", "doc": "docs/2026-11-12-theme-flow.md",
               "note": "탐색 연구 — 현재 관심종목 고정 유니버스 소급(생존 편향) · 독립 검증 아님", "period": [dates[0], dates[-1]], "mid": mid, "mk4": MK4 is not None, **R}
        txt = json.dumps(res, ensure_ascii=False, separators=(",", ":"), default=clean).replace("NaN", "null")
        open(a.emit, "w", encoding="utf-8").write(txt); print(f"→ {a.emit} 저장")


if __name__ == "__main__":
    main()
