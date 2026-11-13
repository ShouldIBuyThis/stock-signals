"""월봉 거래량 급증 · 매집 의심 패턴 (사전 등록 docs/2026-11-13-monthly-volume.md · 보고 전용 · 산식·화면 변경 없음)

신호는 월말(그 달 마지막 거래일) 종가 기준이며 그때까지 완성된 월봉·주봉만 쓴다. 평가는 그 뒤 일봉 종가.
야후 일봉 거래량은 분할·병합에 맞춰 소급 조정되므로 분할 이력을 출력하고, 거래대금(종가×거래량) 배율도 함께 본다.
사용: python tools/monthly-volume-lab.py [--out 경로]
"""
import itertools, json, sys
import numpy as np, pandas as pd, yfinance as yf

LEV = ["NAIL", "SOXL", "TQQQ", "LABU", "TNA", "FNGU", "GDXU", "NUGT", "BULZ"]
NONLEV = ["ITB", "XHB", "SOXX", "SMH", "XBI", "IWM", "QQQ"]
SINGLE = ["NVDA", "AMD", "MU", "INTC", "RKLB", "ASTS", "LUNR", "IONQ", "QBTS", "RGTI", "QUBT"]
ALL = LEV + NONLEV + SINGLE
GROUP = {**{t: "레버리지" for t in LEV}, **{t: "비레버리지" for t in NONLEV}, **{t: "개별 급등락" for t in SINGLE}}


def rsi(x, n=14):
    d = np.diff(x, prepend=np.nan); up = pd.Series(np.where(d > 0, d, 0.0)).ewm(alpha=1 / n, adjust=False).mean()
    dn = pd.Series(np.where(d < 0, -d, 0.0)).ewm(alpha=1 / n, adjust=False).mean()
    return (100 - 100 / (1 + up / dn.replace(0, np.nan))).to_numpy()


def build(t):
    tk = yf.Ticker(t); df = tk.history(period="max", interval="1d", auto_adjust=True)
    if df is None or len(df) < 600: return None, None
    df = df[["Open", "High", "Low", "Close", "Volume"]].dropna(); df.index = pd.to_datetime([d.date() for d in df.index])
    try: sp = [(str(d.date()), float(r)) for d, r in tk.splits.items() if r and r != 1]
    except Exception: sp = []
    return df, sp


def features(df):
    d = df.copy(); d["DV"] = d["Close"] * d["Volume"]
    today = d.index[-1]
    M = d.resample("ME").agg({"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum", "DV": "sum"})
    M["last"] = d["Close"].resample("ME").apply(lambda s: s.index[-1] if len(s) else pd.NaT)
    M = M.dropna(subset=["Close"])
    if M.index[-1].month == today.month and M.index[-1].year == today.year and (today + pd.offsets.BDay(1)).month == today.month:
        M = M.iloc[:-1]                                            # 진행 중인 달 제외(완성된 월봉만)
    W = d.resample("W-FRI").agg({"Close": "last", "Volume": "sum", "DV": "sum"}).dropna()
    W["last"] = d["Close"].resample("W-FRI").apply(lambda s: s.index[-1] if len(s) else pd.NaT)
    c, h, l, v, dv = (M[k].to_numpy(float) for k in ("Close", "High", "Low", "Volume", "DV"))
    mo = M.index; n = len(M)
    obv = np.cumsum(np.sign(np.r_[0, np.diff(c)]) * v); rng = np.where(h - l > 0, h - l, np.nan)
    mfv = np.nan_to_num(((c - l) - (h - c)) / rng, nan=0) * v; R = rsi(c)
    wc = W["Close"].to_numpy(float); wma20 = pd.Series(wc).rolling(20).mean().to_numpy(); wl = list(W["last"])
    wv, wdv = W["Volume"].to_numpy(float), W["DV"].to_numpy(float)
    rows = []
    for m in range(30, n):
        f = {}
        hi12 = h[m - 11:m + 1].max(); r12 = c[m] / c[m - 12] - 1
        f["DEC"] = c[m] <= 0.7 * hi12 and r12 < 0
        for nm_, arr in (("M", v), ("D", dv)):
            b12 = arr[m - 14:m - 2].mean(); b24 = arr[m - 29:m - 5].mean()
            r3 = arr[m - 2:m + 1].sum() / (3 * b12) if b12 > 0 else np.nan; r6 = arr[m - 5:m + 1].sum() / (6 * b24) if b24 > 0 else np.nan
            for k in (1.5, 2.0, 3.0): f[f"{nm_}3_{int(k * 10)}"] = bool(r3 >= k)
            for k in (1.5, 2.0): f[f"{nm_}6_{int(k * 10)}"] = bool(r6 >= k)
            f[f"_{nm_}r3"] = float(r3); f[f"_{nm_}r6"] = float(r6)
        # 주봉: 월말 거래일 이하로 끝난 마지막 완성 주
        lastday = M["last"].iloc[m]; wj = max([j for j, x in enumerate(wl) if pd.notna(x) and x <= lastday], default=None)
        for wk in (4, 8, 12):
            ok = wj is not None and wj - wk - 26 >= 0
            base = wv[wj - wk - 25:wj - wk + 1].mean() if ok else np.nan
            f[f"W{wk}"] = bool(ok and base > 0 and wv[wj - wk + 1:wj + 1].sum() / (wk * base) >= 2.0)
        r3p = c[m] / c[m - 3] - 1; r3pp = c[m - 3] / c[m - 6] - 1
        f["_r3"] = float(r3p)
        f["SLOW"] = r3p > r3pp
        f["HOLD"] = l[m - 1:m + 1].min() >= l[m - 5:m - 1].min()
        f["REC20W"] = wj is not None and not np.isnan(wma20[wj]) and wc[wj] > wma20[wj]
        f["REC6M"] = c[m] > c[m - 5:m + 1].mean()
        low6 = c[m] <= c[m - 5:m + 1].min()
        f["OBVDIV"] = bool(low6 and obv[m] > obv[m - 5:m + 1].min())
        f["CMF"] = bool(mfv[m - 2:m + 1].sum() / max(v[m - 2:m + 1].sum(), 1) > 0)
        f["RSIDIV"] = bool(low6 and not np.isnan(R[m]) and R[m] > np.nanmin(R[m - 5:m + 1]))
        rows.append((mo[m], lastday, f, float(l[m - 2:m + 1].min())))
    return rows


def outcome(df, day, low3):
    ix = df.index.get_indexer([day])[0]
    if ix < 0: return None
    c = df["Close"].to_numpy(float); lo = df["Low"].to_numpy(float); n = len(c); e = c[ix]
    o = {}
    for k in (10, 20, 60):
        o[f"r{k}"] = (c[ix + k] / e - 1) if ix + k < n else None
        o[f"dd{k}"] = (c[ix + 1:ix + k + 1].min() / e - 1) if ix + k < n else None
    o["rebreak"] = bool(lo[ix + 1:ix + 61].min() < low3) if ix + 60 < n else None
    if o["r60"] is not None:
        o["cls"] = "반등" if o["r60"] >= 0.20 else ("계속 폭락" if (o["rebreak"] and o["r60"] <= -0.20) else "횡보")
    return o


VOL = [f"{p}3_{k}" for p in ("M", "D") for k in (15, 20, 30)] + [f"{p}6_{k}" for p in ("M", "D") for k in (15, 20)] + ["W4", "W8", "W12"]
PX = ["SLOW", "HOLD", "REC20W", "REC6M", "OBVDIV", "CMF", "RSIDIV"]
NM = {"M3_15": "월 3개월 1.5배(주식수)", "M3_20": "월 3개월 2배(주식수)", "M3_30": "월 3개월 3배(주식수)", "D3_15": "월 3개월 1.5배(거래대금)", "D3_20": "월 3개월 2배(거래대금)",
      "D3_30": "월 3개월 3배(거래대금)", "M6_15": "월 6개월 1.5배(주식수)", "M6_20": "월 6개월 2배(주식수)", "D6_15": "월 6개월 1.5배(거래대금)", "D6_20": "월 6개월 2배(거래대금)",
      "W4": "주 4주 2배", "W8": "주 8주 2배", "W12": "주 12주 2배", "SLOW": "하락 둔화", "HOLD": "저점 유지", "REC20W": "20주선 회복", "REC6M": "6개월선 회복",
      "OBVDIV": "OBV 다이버전스", "CMF": "CMF>0", "RSIDIV": "월봉 RSI 다이버전스"}


def stat(E):
    n = len(E)
    if not n: return {"n": 0}
    g = lambda k: [e["o"][k] for e in E if e["o"].get(k) is not None]
    z = {"n": n, "months": len({str(e["m"])[:7] for e in E}), "tickers": len({e["t"] for e in E})}
    for k in ("r10", "r20", "r60"):
        a = g(k); z[k] = float(np.mean(a)) if a else None; z["up" + k[1:]] = float(np.mean([x > 0 for x in a])) if a else None
    for k in ("dd20", "dd60"):
        a = g(k); z[k] = float(np.mean(a)) if a else None
    a = g("rebreak"); z["rebreak"] = float(np.mean(a)) if a else None
    cl = [e["o"].get("cls") for e in E if e["o"].get("cls")]; z["cls"] = {k: cl.count(k) for k in ("반등", "횡보", "계속 폭락")}
    return z


def extra(DEC, thin, stat, pc, SET, MID):
    """추가 검증(사용자 2026-11-13 · 사전 등록 외 · 별도 표시). 거래량 급증을 '매집'으로 단정하지 않고 급증 동안의 가격 움직임으로 경우를 나눈다.
    확정 시점: 월봉·주봉은 그 달·그 주 마지막 거래일 장 마감 뒤에야 확정 — 신호는 그 날 종가로만 계산되고, 실제 행동 가능 시점은 그 날 종가(또는 다음 거래일)."""
    def typ(e):
        r = e["f"]["_r3"]
        return "투매형(3개월 −25%↓)" if r <= -0.25 else "하락 지속형(−25~−10%)" if r <= -0.10 else "손바뀜·횡보형(±10%)" if r < 0.10 else "반등 동반형(+10%↑)"
    for vb in ("M3_20", "D3_20", "M6_15"):
        E = thin([e for e in DEC if e["f"][vb]])
        print(f"\n■ 추가 — {vb} 급증 달을 급증 3개월 동안의 가격으로 분류 ({len(E)}건)")
        for t in ("투매형(3개월 −25%↓)", "하락 지속형(−25~−10%)", "손바뀜·횡보형(±10%)", "반등 동반형(+10%↑)"):
            s = stat([e for e in E if typ(e) == t])
            if s["n"]: print(f"  {t:22} {s['n']}건 · 60일 {pc(s['r60'])} 상승 {s['up60']:.0%} · 10/20일 {pc(s['r10'])}/{pc(s['r20'])} · 낙폭20/60 {pc(s['dd20'])}/{pc(s['dd60'])} · 재이탈 {s['rebreak']:.0%} · {s['cls']}")
    print("\n■ 추가 — 거래량 급증 단독 vs + 저점 유지 + 추세 회복(20주선) vs 대조(하락 국면 · 거래량 조건 없음)")
    for vb in ("M3_15", "M3_20", "D3_20", "M6_15", "W8"):
        for nm_, px in (("단독", []), ("+저점 유지", ["HOLD"]), ("+저점 유지+20주선 회복", ["HOLD", "REC20W"]), ("+하락 둔화+20주선 회복", ["SLOW", "REC20W"])):
            E = thin([e for e in DEC if e["f"][vb] and all(e["f"][p] for p in px)]); C = thin([e for e in DEC if all(e["f"][p] for p in px)])
            s, c = stat(E), stat(C)
            if not s["n"]: print(f"  {vb:6} {nm_:22} 0건"); continue
            sA, sB = stat([e for e in E if SET[e["t"]] == "A"]), stat([e for e in E if SET[e["t"]] == "B"])
            print(f"  {vb:6} {nm_:22} {s['n']}건 {s['tickers']}종목 | 60일 {pc(s['r60'])} (대조 {pc(c['r60'])} · {c['n']}건) 상승 {s['up60']:.0%}/{c['up60']:.0%} | 낙폭60 {pc(s['dd60'])}/{pc(c['dd60'])} | 재이탈 {s['rebreak']:.0%}/{c['rebreak']:.0%} | A {pc(sA.get('r60'))}({sA['n']}) B {pc(sB.get('r60'))}({sB['n']})")


def main():
    out_path = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else ""
    ev, splits, nail_rows = [], {}, []
    for t in ALL:
        df, sp = build(t)
        if df is None: print(f"  건너뜀 {t}"); continue
        splits[t] = sp
        for (mo, day, f, low3) in features(df):
            o = outcome(df, day, low3)
            if o is None: continue
            ev.append({"t": t, "m": mo, "d": str(day.date()), "f": f, "o": o})
            if t == "NAIL": nail_rows.append({"m": str(mo.date())[:7], "d": str(day.date()), "f": {k: f[k] for k in ["DEC"] + VOL + PX}, "r3": round(f["_Mr3"], 2), "dr3": round(f["_Dr3"], 2),
                                              "r6": round(f["_Mr6"], 2), "o": {k: (round(v, 3) if isinstance(v, float) else v) for k, v in o.items()}})
        print(f"  {t}: 월 {sum(1 for e in ev if e['t'] == t)} · 분할 {sp}")
    tick = sorted({e["t"] for e in ev}); SET = {t: ("A" if k % 2 == 0 else "B") for k, t in enumerate(tick)}
    months = sorted({str(e["m"]) for e in ev}); MID = months[len(months) // 2]
    def thin(E):
        last, out = {}, []
        for e in sorted(E, key=lambda x: (x["t"], x["m"])):
            if e["t"] in last and (e["m"].year - last[e["t"]].year) * 12 + e["m"].month - last[e["t"]].month < 3: continue
            last[e["t"]] = e["m"]; out.append(e)
        return out
    DEC = [e for e in ev if e["f"]["DEC"]]
    res = {"prereg": "docs/2026-11-13-monthly-volume.md", "splits": splits, "mid": MID, "base_dec": stat(thin(DEC)), "combos": [], "nail": nail_rows}
    b = res["base_dec"]
    print(f"\n하락 국면 월 전체(대조 기준) {b['n']}건 · 60일 상승 {b['up60']:.0%} · 평균 10/20/60일 {b['r10']:+.1%}/{b['r20']:+.1%}/{b['r60']:+.1%} · 60일 최대낙폭 {b['dd60']:+.1%} · 저점 재이탈 {b['rebreak']:.0%} · {b['cls']}")
    for vb in VOL:
        for k in range(0, 3):
            for px in itertools.combinations(PX, k):
                E = thin([e for e in DEC if e["f"][vb] and all(e["f"][p] for p in px)])
                if len(E) < 6: continue
                C = thin([e for e in DEC if all(e["f"][p] for p in px)])
                s, sc = stat(E), stat(C)
                sA, sB = stat([e for e in E if SET[e["t"]] == "A"]), stat([e for e in E if SET[e["t"]] == "B"])
                sh = [stat([e for e in E if str(e["m"]) < MID]), stat([e for e in E if str(e["m"]) >= MID])]
                grp = {g: stat([e for e in E if GROUP[e["t"]] == g]) for g in ("레버리지", "비레버리지", "개별 급등락")}
                res["combos"].append({"vol": vb, "px": list(px), "name": " ∩ ".join([NM[vb]] + [NM[p] for p in px]), "s": s, "ctl": sc, "A": sA, "B": sB, "halves": sh, "groups": grp,
                                      "nail": [x["d"] for x in E if x["t"] == "NAIL"]})
    R = res["combos"]; R.sort(key=lambda x: -((x["s"]["r60"] or -9) - (x["ctl"]["r60"] or 0)))
    pc = lambda x: "—" if x is None else f"{x:+.1%}"
    print(f"\n■ 조합(하락 국면 ∩ 거래량 ∩ 가격·보조 0~2) 표본 6↑ {len(R)}개 — 60일 평균 수익 대조군 대비 상위 25")
    for x in R[:25]:
        s, c = x["s"], x["ctl"]
        print(f"  {x['name'][:58]:58} | {s['n']}건 {s['months']}달 {s['tickers']}종목 | 60일 {pc(s['r60'])} (대조 {pc(c['r60'])}) 상승 {s['up60']:.0%}/{c['up60']:.0%} | 10·20일 {pc(s['r10'])}·{pc(s['r20'])} | "
              f"낙폭60 {pc(s['dd60'])}/{pc(c['dd60'])} | 재이탈 {s['rebreak']:.0%}/{c['rebreak']:.0%} | A {pc(x['A'].get('r60'))}({x['A']['n']}) B {pc(x['B'].get('r60'))}({x['B']['n']}) | 앞/뒤 {pc(x['halves'][0].get('r60'))}/{pc(x['halves'][1].get('r60'))} | {s['cls']}")
    print("\n■ 거래량 단독(하락 국면 ∩ 거래량) vs 하락 국면 전체")
    for x in [x for x in R if not x["px"]]:
        s = x["s"]; print(f"  {x['name']:28} {s['n']}건 · 60일 {pc(s['r60'])} 상승 {s['up60']:.0%} · 낙폭60 {pc(s['dd60'])} · 재이탈 {s['rebreak']:.0%} · {s['cls']} · 레버리지 {pc(x['groups']['레버리지'].get('r60'))}({x['groups']['레버리지']['n']}) 비레버리지 {pc(x['groups']['비레버리지'].get('r60'))}({x['groups']['비레버리지']['n']}) 개별 {pc(x['groups']['개별 급등락'].get('r60'))}({x['groups']['개별 급등락']['n']})")
    print("\n■ NAIL — 하락 국면이었던 달과 켜진 조건(최근 24개 + 2022년)")
    for r in [r for r in nail_rows if r["f"]["DEC"] and (r["m"] >= "2022-01" and r["m"] <= "2023-03" or r in nail_rows[-24:])]:
        on = [NM[k] for k in VOL + PX if r["f"][k]]
        print(f"  {r['m']} 종가일 {r['d']} · 3개월 배율 주식수 {r['r3']} / 거래대금 {r['dr3']} · 6개월 {r['r6']} | {', '.join(on) or '—'} | 60일 {pc(r['o'].get('r60'))} {r['o'].get('cls', '')}")
    print(f"\n분할 이력: " + " · ".join(f"{t} {v}" for t, v in splits.items() if v))
    if "--extra" in sys.argv:
        extra(DEC, thin, stat, pc, SET, MID)
    if out_path:
        json.dump(res, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, default=str); print(f"→ {out_path}")


if __name__ == "__main__":
    main()
