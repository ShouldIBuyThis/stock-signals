"""4그룹(S&P500 · 나스닥100 · 경기방어 · 배당) 52주 신고가·신저가 비율 + 상태 연구 — docs/2026-11-12-theme-flow.md §6 사전 등록 그대로. CI 전용.
구성 종목: 위키백과(현재 구성 · 소급) · 배당 = data/groups/schd-holdings.csv(있을 때만). ETF 한 종목으로 그룹을 대신하지 않는다.
사용: python tools/group-breadth-lab.py --emit backtest/group-breadth.json
"""
import argparse, io, json, os, sys, time
from datetime import datetime, timezone
import numpy as np, pandas as pd, requests, yfinance as yf

ROOT = __file__.rsplit("/", 2)[0]
START, END = "2015-01-01", None
UA = {"User-Agent": "stock-signals-research/1.0 (GitHub Actions; research use)"}
THR, NEIGH = 0.02, (0.01, 0.03)
H = (1, 3, 5, 7)
G_NAMES = {"SP": "S&P500", "NDX": "나스닥100", "DEF": "경기방어", "DIV": "배당(SCHD 편입 종목)"}
DEF_SECTORS = {"Consumer Staples", "Utilities"}
DEF_SUBS = {"Pharmaceuticals", "Managed Health Care", "Health Care Distributors"}


def wiki_tables(page):
    r = requests.get("https://en.wikipedia.org/w/api.php", params={"action": "parse", "page": page, "prop": "text", "format": "json", "formatversion": 2}, headers=UA, timeout=60)
    r.raise_for_status()
    return pd.read_html(io.StringIO(r.json()["parse"]["text"]))


def ysym(s):
    return str(s).strip().upper().replace(".", "-")


def constituents():
    sp = next(t for t in wiki_tables("List of S&P 500 companies") if {"Symbol", "GICS Sector"} <= set(map(str, t.columns)))
    sub = "GICS Sub-Industry" if "GICS Sub-Industry" in sp.columns else None
    SP = [ysym(x) for x in sp["Symbol"]]
    DEF = [ysym(x) for x, sec, sb in zip(sp["Symbol"], sp["GICS Sector"], sp[sub] if sub else [""] * len(sp)) if sec in DEF_SECTORS or (sec == "Health Care" and sb in DEF_SUBS)]
    nd, seen = None, []
    for t in wiki_tables("Nasdaq-100"):
        cols = [" ".join(map(str, c)) if isinstance(c, tuple) else str(c) for c in t.columns]
        seen.append((len(t), cols[:5]))
        k = next((i for i, c in enumerate(cols) if any(w in c.lower() for w in ("ticker", "symbol"))), None)
        if k is not None and 80 <= len(t) <= 130:
            cand = [ysym(x) for x in t.iloc[:, k] if isinstance(x, str) and 1 <= len(x.strip()) <= 6]
            if len(cand) >= 80 and (nd is None or len(cand) > len(nd)): nd = cand
    if not nd:
        print("  나스닥100 페이지의 표:", seen)
        raise RuntimeError("나스닥100 구성 표를 찾지 못했다")
    if not (480 <= len(SP) <= 520): raise RuntimeError(f"S&P500 구성 수 이상: {len(SP)}")
    div, div_meta = None, None
    p = f"{ROOT}/data/groups/schd-holdings.csv"
    if os.path.exists(p):
        df = pd.read_csv(p, comment="#")
        k = next(c for c in df.columns if c.lower() in ("ticker", "symbol"))
        div = [ysym(x) for x in df[k] if isinstance(x, str) and x.strip()]
        div_meta = open(p, encoding="utf-8").readline().strip().lstrip("# ")
    return {"SP": SP, "NDX": nd, "DEF": DEF, "DIV": div}, div_meta


def download(tickers):
    out = {}
    for i in range(0, len(tickers), 80):
        chunk = tickers[i:i + 80]
        for attempt in range(3):
            try:
                df = yf.download(chunk, start=START, end=END, auto_adjust=True, group_by="ticker", threads=True, progress=False)
                break
            except Exception as e:
                print(f"  재시도 {i}: {e}"); time.sleep(3); df = None
        if df is None: continue
        for t in chunk:
            try:
                d = df[t][["High", "Low", "Close"]].dropna()
                if len(d) >= 252: out[t] = d
            except Exception:
                pass
    return out


def wrate(x):
    x = np.asarray(x, float); x = x[np.isfinite(x)]
    up, dn = (x > 0.01).sum(), (x < -0.01).sum()
    return (dn / (up + dn) if up + dn else None), (float(x.mean()) if len(x) else None), int(len(x))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--emit", default=""); a = ap.parse_args()
    G, div_meta = constituents()
    allt = sorted({t for g in G.values() if g for t in g} | {"QQQ", "SPY"})
    print(f"구성: S&P500 {len(G['SP'])} · 나스닥100 {len(G['NDX'])} · 경기방어 {len(G['DEF'])} · 배당 {len(G['DIV']) if G['DIV'] else '자료 없음'} · 내려받을 종목 {len(allt)}")
    P = download(allt)
    idx = P["SPY"].index
    dates = [str(d.date()) for d in idx]; n = len(idx)
    NH, NL, OK = {}, {}, {}
    for t, d in P.items():
        if t in ("QQQ", "SPY"): continue
        d = d.reindex(idx)
        c = d["Close"].to_numpy(float)
        # 252봉(그 종목의 실제 거래 봉) 미만은 제외 — 결측을 건너뛴 자기 봉 기준
        valid = np.isfinite(c)
        dd = d[valid]
        hh = dd["High"].rolling(252, min_periods=252).max(); ll = dd["Low"].rolling(252, min_periods=252).min()
        nh = pd.Series(dd["Close"] >= hh * 0.99).where(hh.notna()).reindex(idx)
        nl = pd.Series(dd["Close"] <= ll * 1.01).where(ll.notna()).reindex(idx)
        OK[t] = nh.notna().to_numpy(); NH[t] = (nh == True).to_numpy(); NL[t] = (nl == True).to_numpy()  # noqa: E712
    S = {}
    for g, lst in G.items():
        if not lst: continue
        have = [t for t in lst if t in OK]
        nn = np.sum([OK[t] for t in have], axis=0); nh = np.sum([NH[t] for t in have], axis=0); nl = np.sum([NL[t] for t in have], axis=0)
        ok = nn >= 0.5 * len(lst)
        hr = np.where(ok, nh / np.maximum(nn, 1), np.nan); lr = np.where(ok, nl / np.maximum(nn, 1), np.nan)
        S[g] = {"members": len(lst), "priced": len(have), "n": nn, "nh": nh, "nl": nl, "hr": hr, "lr": lr, "net": hr - lr}
        print(f"  {G_NAMES[g]}: 구성 {len(lst)} · 시세 확보 {len(have)} · 분석 가능한 날 {int(ok.sum())}/{n} · 최근 n {int(nn[-1])} 신고가 {int(nh[-1])} 신저가 {int(nl[-1])}")
    ov = {f"{x}&{y}": len(set(G[x]) & set(G[y])) for x in G for y in G if x < y and G[x] and G[y]}
    print("  중복:", ov)
    r5 = lambda x: pd.Series(x).rolling(5, min_periods=5).mean().to_numpy()
    sh = lambda x, k: np.r_[np.full(k, np.nan), x[:-k]]
    for g in S:
        S[g]["hr5"], S[g]["lr5"], S[g]["net5"] = r5(S[g]["hr"]), r5(S[g]["lr"]), r5(S[g]["net"])
        S[g]["d5"] = S[g]["net5"] - sh(S[g]["net5"], 5); S[g]["h10"] = S[g]["hr5"] - sh(S[g]["hr5"], 10)
    px = {k: P[k]["Close"].reindex(idx).to_numpy(float) for k in ("QQQ", "SPY")}
    hi = {k: pd.Series(P[k]["High"].reindex(idx)).rolling(252, min_periods=252).max().to_numpy() for k in px}
    pos = {k: px[k] / hi[k] - 1 for k in px}
    q = px["QQQ"]; ma200 = pd.Series(q).rolling(200).mean().to_numpy(); r60 = q / sh(q, 60) - 1
    regime = np.where((q > ma200) & (r60 > 0.05), "상승", np.where(q < ma200, "하락", "횡보")); regime[~np.isfinite(ma200)] = ""
    fwd = {k: {h: np.r_[px[k][h:] / px[k][:-h] - 1, np.full(h, np.nan)] for h in H} for k in px}
    gt = lambda x, v: np.nan_to_num(x, nan=-9) >= v
    lt = lambda x, v: np.nan_to_num(x, nan=9) <= v
    has_div = "DIV" in S

    def states(thr):
        d5 = {g: S[g]["d5"] for g in S}; st = {}
        st["NDX_LEAD"] = gt(d5["NDX"], thr) & gt(d5["NDX"] - d5["SP"], thr)
        st["SP_LEAD"] = gt(d5["SP"], thr) & gt(d5["SP"] - d5["NDX"], thr)
        st["R_DEF"] = lt(d5["NDX"], -thr) & gt(d5["DEF"], thr)
        if has_div: st["R_DIV"] = lt(d5["NDX"], -thr) & gt(d5["DIV"], thr)
        st["H_NDX"] = gt(pos["QQQ"], -0.02) & lt(S["NDX"]["h10"], -0.03)
        st["H_SP"] = gt(pos["SPY"], -0.02) & lt(S["SP"]["h10"], -0.03)
        dfo = gt(S["DEF"]["h10"], thr) & lt(S["SP"]["h10"], 0) & lt(S["NDX"]["h10"], 0)
        st["DEF_ONLY"] = dfo & (gt(S["DIV"]["h10"], thr) if has_div else True)
        gs = list(S)
        st["ALL_UP"] = np.all([np.nan_to_num(S[g]["net5"], nan=-9) > 0 for g in gs], axis=0) & np.all([np.nan_to_num(S[g]["d5"], nan=-9) > 0 for g in gs], axis=0)
        st["ALL_DN"] = np.all([np.nan_to_num(S[g]["net5"], nan=9) < 0 for g in gs], axis=0) & np.all([np.nan_to_num(S[g]["d5"], nan=9) < 0 for g in gs], axis=0)
        return st
    okday = np.isfinite(S["SP"]["d5"]) & np.isfinite(S["NDX"]["d5"]) & np.isfinite(ma200)
    def starts(mask, cool=5):
        out, last = [], -99
        for i in np.nonzero(mask & okday)[0]:
            if i - last > cool: out.append(i)
            last = i
        return np.array(out, int)
    rng = np.random.default_rng(20261112)
    def block_ci(mask, base_idx, k, h):
        """상태일 5일 하락 비율 − 모든 날: 10일 블록 부트스트랩 90% 신뢰구간."""
        f = fwd[k][h]; nb = len(base_idx) // 10; diffs = []
        blocks = [base_idx[i * 10:(i + 1) * 10] for i in range(nb)]
        for _ in range(1000):
            pick = np.concatenate([blocks[j] for j in rng.integers(0, nb, nb)])
            a_, _, _ = wrate(f[pick][mask[pick]]); b_, _, _ = wrate(f[pick])
            if a_ is not None and b_ is not None: diffs.append(a_ - b_)
        return (float(np.quantile(diffs, 0.05)), float(np.quantile(diffs, 0.95))) if len(diffs) > 100 else (None, None)
    base_idx = np.nonzero(okday)[0]; mid = base_idx[len(base_idx) // 2]
    res = {}
    ST = states(THR); NB = {t: states(t) for t in NEIGH}
    f_ = lambda x: "—" if x is None else f"{x*100:.0f}"
    base = {k: {h: wrate(fwd[k][h][base_idx]) for h in H} for k in px}
    print(f"\n■ 4그룹 상태 → QQQ·SPY 1·3·5·7일 하락 비율(±1% 보합 제외) — 모든 날 QQQ {'·'.join(f_(base['QQQ'][h][0]) for h in H)}% · SPY {'·'.join(f_(base['SPY'][h][0]) for h in H)}% ({len(base_idx)}일 · {dates[base_idx[0]]}~{dates[base_idx[-1]]})")
    for name, m in ST.items():
        e = starts(m); row = {"days": int((m & okday).sum()), "starts": int(len(e))}
        for k in px:
            row[k] = {}
            for h in H:
                dr, av, nn_ = wrate(fwd[k][h][e]); da, aa, na = wrate(fwd[k][h][m & okday])
                row[k][h] = {"dn": dr, "avg": av, "n": nn_, "dn_alldays": da, "avg_alldays": aa, "base_dn": base[k][h][0], "base_avg": base[k][h][1]}
            lo, hi_ = block_ci(m & okday, base_idx, k, 5); row[k]["ci5"] = [lo, hi_]
            h1 = wrate(fwd[k][5][e[e < mid]])[0]; h2 = wrate(fwd[k][5][e[e >= mid]])[0]; row[k]["half5"] = [h1, h2]
            d = lambda h: None if row[k][h]["dn"] is None else row[k][h]["dn"] - base[k][h][0]
            sgn = all(d(h) is not None and np.sign(d(h)) == np.sign(d(5)) for h in (3, 7)) if d(5) is not None else False
            hs = h1 is not None and h2 is not None and d(5) is not None and np.sign(h1 - base[k][5][0]) == np.sign(d(5)) == np.sign(h2 - base[k][5][0])
            row[k]["pass"] = bool(len(e) >= 30 and d(5) is not None and abs(d(5)) >= 0.05 and sgn and lo is not None and (lo > 0 or hi_ < 0) and hs)
            row[k]["by_regime"] = {rg: wrate(fwd[k][5][e[regime[e] == rg]])[0] for rg in ("상승", "횡보", "하락")}
            row[k]["regime_n"] = {rg: int((regime[e] == rg).sum()) for rg in ("상승", "횡보", "하락")}
        row["neighbor5"] = {str(t): wrate(fwd["QQQ"][5][starts(NB[t][name])])[0] for t in NEIGH}
        res[name] = row
        for k in px:
            c0, c1 = row[k]["ci5"]; cis = "—" if c0 is None else f"{c0*100:+.0f}~{c1*100:+.0f}"
            dn = "·".join(f_(row[k][h]["dn"]) for h in H); rgs = "/".join(f_(row[k]["by_regime"][r]) for r in ("상승", "횡보", "하락"))
            vd = "탐색 통과" if row[k]["pass"] else ("표본 부족" if row["starts"] < 30 else "미통과")
            print(f"  {name:<9} {k} 처음 켜진 날 {row['starts']:>3}(상태일 {row['days']:>4}) | {dn}% · 5일 평균 {(row[k][5]['avg'] or 0)*100:+.2f}%(평소 {base[k][5][1]*100:+.2f}) · 상태일 전체 5일 {f_(row[k][5]['dn_alldays'])}% 차이 CI {cis}%p · 반쪽 {f_(row[k]['half5'][0])}/{f_(row[k]['half5'][1])} · 국면 상승/횡보/하락 {rgs} · {vd}")
    if a.emit:
        keep = slice(max(0, n - 800), n)
        rd = lambda x: [None if not np.isfinite(v) else int(v) for v in x[keep]]
        out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "kind": "research", "doc": "docs/2026-11-12-theme-flow.md#6",
               "note": "현재 구성 종목 소급(편출·상장폐지 종목 없음 — 실제 과거 구성과 다름) · 252봉 미만 제외 · 신고가권 = 종가 ≥ 52주 고가 × 0.99",
               "names": G_NAMES, "defensive_def": "S&P500 중 필수소비재·유틸리티 전체 + 헬스케어의 제약·건강보험·의약품 유통", "div_source": div_meta,
               "members": {g: (len(G[g]) if G[g] else None) for g in G}, "priced": {g: S[g]["priced"] for g in S}, "overlap": ov,
               "dates": dates[keep], "groups": {g: {"n": rd(S[g]["n"]), "nh": rd(S[g]["nh"]), "nl": rd(S[g]["nl"]), "ok": [bool(v) for v in np.isfinite(S[g]["hr"][keep])]} for g in S},
               "index_pos52": {k: [None if not np.isfinite(v) else round(float(v) * 100, 2) for v in pos[k][keep]] for k in pos},
               "state_today": {k: bool(m[-1]) for k, m in ST.items()},
               "state_series": {k: [dates[i] for i in np.nonzero(m)[0]] for k, m in ST.items()},
               "research": {"period": [dates[base_idx[0]], dates[base_idx[-1]]], "days": int(len(base_idx)), "thr": THR, "horizons": list(H),
                            "base": {k: {str(h): {"dn": base[k][h][0], "avg": base[k][h][1]} for h in H} for k in px},
                            "states": json.loads(json.dumps(res, default=lambda x: None if x is None else (float(x) if isinstance(x, (np.floating, float)) else (int(x) if isinstance(x, np.integer) else (bool(x) if isinstance(x, np.bool_) else str(x))))))}}
        json.dump(out, open(a.emit, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"→ {a.emit} 저장")


if __name__ == "__main__":
    main()
