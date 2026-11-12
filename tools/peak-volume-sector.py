"""고점 거래량 이상징후 — 분야 확장 재검증 (사전 등록 docs/2026-11-12-peak-volume.md §2 · 읽기 전용 · 반영 전 보고용)

11-06 발견(폭락 고점 101 vs 가짜 고점 235: 직전 5일 거래량 3배 23% vs 9% · RSI 하락 다이버전스 52% vs 37% · 당일 볼밴 상단 밖→안 복귀 19% vs 2%)을
인텔·코히런트·금·은까지 넓혀 같은 정의로 다시 잰다. 사례·특징 정의는 tools/peak-trough-lab.py의 events()·day_feats()를 그대로 불러 쓴다.
  A. 사후 사례 비교 — 폭락 고점(미래 가격으로 찾음) vs 가짜 고점: 직전 5일 특징 점등률(포착률 vs 오경보율). 예측 아님.
  B. 그날 규칙 — 11-06 T0 과열 맥락 ∩ 특징 1~2개(그날까지 자료만) · 신호일 종가 진입 · 10일·20일·OR 하락 각각.
사용: python tools/peak-volume-sector.py [--out backtest/peak-volume-sector.json]
"""
import importlib.util, itertools, json, sys
from datetime import date
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)


def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m


pt = _load("pt", "peak-trough-lab.py")
tr, cc = pt.tr, pt.cc
tr.END = str(date.today())            # 11-06 도구는 11/4 종가까지 고정 — 이번엔 오늘 전까지

SECTORS = {
    "반도체": ["INTC", "COHR", "NVDA", "AMD", "MU", "AVGO", "AMAT", "ALAB", "MRVL", "TSM", "ASML", "ARM", "SMCI", "GLW"],
    "반도체 레버리지": ["SOXL"],
    "금 현물": ["GLD", "IAU"], "금 광산": ["GDX", "GDXJ"], "금 레버리지": ["GDXU", "NUGT"],
    "은 현물": ["SLV", "SIVR"], "은 광산": ["SIL", "SILJ"], "은 레버리지": ["AGQ"],
    "우주": ["RKLB", "ASTS", "LUNR", "RDW", "JOBY", "PL", "SPCE"],
    "양자": ["IONQ", "QBTS", "RGTI", "QUBT"],
    "11-06 주택": pt.THEMES["주택(NAIL)"], "11-06 코인": pt.THEMES["코인"], "11-06 국장": pt.THEMES["국장"],
    "사례실 대조": ["MRNA", "DUSL", "PLUG"],
}
FIELD = {"반도체": "반도체", "반도체 레버리지": "반도체", "금 현물": "금", "금 광산": "금", "금 레버리지": "금", "은 현물": "은", "은 광산": "은", "은 레버리지": "은",
         "우주": "우주", "양자": "양자", "11-06 주택": "11-06 기존", "11-06 코인": "11-06 기존", "11-06 국장": "11-06 기존", "사례실 대조": "사례실 대조"}
FEATS = ["거래량 2배↑", "거래량 3배↑", "5일 누적 1.5배↑", "5일 누적 2배↑", "상승 둔화", "폭증 뒤 감소", "RSI 하락 다이버전스", "볼밴 상단 밖→안 복귀"]


def series(o, h, l, c, v):
    """그날까지의 자료로만 만든 특징 배열(날마다)."""
    F, K, Z, R, vr = pt.day_feats(o, h, l, c, v)            # 11-06 정의 그대로
    n = len(c); V = pd.Series(v, dtype=float)
    with np.errstate(invalid="ignore", divide="ignore"):
        r5v = np.nan_to_num(V.rolling(5).sum().to_numpy() / (5 * V.shift(5).rolling(20, min_periods=20).mean().to_numpy()), nan=0)
        r5 = c / np.r_[np.full(5, np.nan), c[:-5]] - 1; r5p = np.r_[np.full(5, np.nan), r5[:-5]]
        sp2 = np.nan_to_num(vr, nan=0) >= 2; v3 = V.rolling(3).mean().to_numpy()
    dry = np.zeros(n, bool)
    for D in range(11, n):
        ss = [s for s in range(D - 10, D) if sp2[s]]
        if ss and v3[D] < 0.5 * v[ss[-1]]: dry[D] = True
    return {"거래량 2배↑": F["거래량 2배↑"], "거래량 3배↑": F["거래량 3배↑"], "5일 누적 1.5배↑": r5v >= 1.5, "5일 누적 2배↑": r5v >= 2.0,
            "상승 둔화": (r5v >= 1.5) & np.nan_to_num((r5 < r5p) & (r5p > 0), nan=0).astype(bool), "폭증 뒤 감소": dry,
            "RSI 하락 다이버전스": F["RSI 하락 다이버전스(20일 신고가·RSI 낮음)"], "볼밴 상단 밖→안 복귀": F["볼밴 상단 밖→안 복귀"]}, R


def win_any(a, i0, i1):
    return bool(np.any(a[max(0, i0):i1 + 1]))


def z2(a, n1, b, n2):
    if not n1 or not n2: return None
    p = (a + b) / (n1 + n2); se = (p * (1 - p) * (1 / n1 + 1 / n2)) ** 0.5
    return None if se == 0 else round((a / n1 - b / n2) / se, 1)


def main():
    out_path = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else ""
    tops, fakes, rows, cases, skipped = [], [], [], [], []
    pr = json.load(open(f"{ROOT}/backtest/peak-reader.json", encoding="utf-8"))
    lab_cases = {(x["ticker"], x["peak"]): x["kind"] for x in pr.get("cases", [])}
    for sec, tks in SECTORS.items():
        for tk in tks:
            df = tr.fetch(tk)
            if df is None or len(df) < 300: skipped.append(tk); print(f"  건너뜀 {tk} ({0 if df is None else len(df)}봉)"); continue
            o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
            ds = [str(d.date()) for d in df.index]; n = len(c)
            S, R = series(o, h, l, c, v)
            # ── A. 사후 사례(11-06 events 그대로) ──
            tp, _, ctop, _ = pt.events(o, h, l, c)
            for lst, dst, kind in ((tp, tops, "폭락 고점"), (ctop, fakes, "가짜 고점")):
                for t in lst:
                    if t < 11: continue
                    dst.append({"sec": sec, "field": FIELD[sec], "tk": tk, "d": ds[t], "t": t, "kind": kind,
                                "pre": {f: win_any(S[f], t - 5, t - 1) for f in FEATS if f != "볼밴 상단 밖→안 복귀"} | {"볼밴 상단 밖→안 복귀": bool(S["볼밴 상단 밖→안 복귀"][t])}})
            # 사례실 고점일
            for (ct, cd), kd in lab_cases.items():
                if ct == tk and cd in ds:
                    t = ds.index(cd)
                    cases.append({"tk": tk, "d": cd, "kind": "급락" if kd == "bust" else "상승 지속(대조)", "sec": sec,
                                  "lit": {f: [k - t for k in range(max(0, t - 5), t + 1) if S[f][k]] for f in FEATS},
                                  "in_1106_def": {"폭락 고점": any(abs(x - t) <= 5 for x in tp), "가짜 고점": any(abs(x - t) <= 5 for x in ctop)}})
            # ── B. 그날 규칙(11-06 T0 그대로) ──
            u = pd.Series((h - l) / c).rolling(60).median().to_numpy()
            hi250 = pd.Series(h).rolling(250, min_periods=120).max().to_numpy(); rmax10 = pd.Series(R).rolling(10).max().to_numpy()
            W = {f: pd.Series(S[f].astype(float)).rolling(5, min_periods=1).max().to_numpy() > 0 for f in FEATS}   # 직전 5일+당일 창(D−4~D)
            W["볼밴 상단 밖→안 복귀"] = pd.Series(S["볼밴 상단 밖→안 복귀"].astype(float)).rolling(3, min_periods=1).max().to_numpy() > 0   # 재진입은 3일 안(§1과 같음)
            last = -99
            for t in range(130, n - 20):
                if np.isnan(u[t]): continue
                thr_up = max(0.30, 8 * u[t]); run = c[t] / l[t - 60:t + 1].min() - 1
                if not (rmax10[t] >= 70 and c[t] >= 0.95 * hi250[t - 1] and run >= thr_up): continue
                r10, r20 = c[t + 10] / c[t] - 1, c[t + 20] / c[t] - 1
                up10 = h[t + 1:t + 21].max() / c[t] - 1 >= 0.10
                rows.append({"sec": sec, "field": FIELD[sec], "tk": tk, "d": ds[t], "t": t, "r10": r10, "r20": r20, "up10": bool(up10),
                             "f": [f for f in FEATS if W[f][t]], "near_top": any(0 <= x - t <= 5 for x in tp)})
    # ── 집계 ──
    res = {"prereg": "docs/2026-11-12-peak-volume.md §2", "end": tr.END, "skipped": skipped, "A": {}, "B": {}, "cases": cases}
    groups = ["전체"] + list(dict.fromkeys(FIELD[s] for s in SECTORS)) + list(SECTORS)
    def sel(L, g): return L if g == "전체" else [x for x in L if x["field"] == g or x["sec"] == g]
    print(f"\n■ A. 사후 사례 비교 — 폭락 고점 {len(tops)} · 가짜 고점 {len(fakes)} (11-06 정의 · 고점을 알고 본 분석)")
    for g in groups:
        T, Fk = sel(tops, g), sel(fakes, g)
        if not T and not Fk: continue
        res["A"][g] = {"tops": len(T), "fakes": len(Fk), "feat": {}}
        cells = []
        for f in FEATS:
            a, b = sum(x["pre"][f] for x in T), sum(x["pre"][f] for x in Fk)
            res["A"][g]["feat"][f] = {"top": a, "fake": b, "top_r": a / len(T) if T else None, "fake_r": b / len(Fk) if Fk else None, "z": z2(a, len(T), b, len(Fk))}
            cells.append(f"{f} {a / len(T) * 100 if T else 0:.0f}% vs {b / len(Fk) * 100 if Fk else 0:.0f}%")
        print(f"  [{g}] 폭락 {len(T)} · 가짜 {len(Fk)} | " + " · ".join(cells))
    # 그날 규칙
    def thin(L):
        out, lastd = [], {}
        for x in sorted(L, key=lambda x: (x["tk"], x["t"])):
            if x["tk"] in lastd and x["t"] - lastd[x["tk"]] < 5: continue
            lastd[x["tk"]] = x["t"]; out.append(x)
        return out
    rules = [("T0 과열 맥락(평소)", ())] + [(f, (f,)) for f in FEATS] + [(f"{a} ∩ {b}", (a, b)) for a, b in itertools.combinations(FEATS, 2)]
    ds_all = sorted({r["d"] for r in rows}); mid = ds_all[len(ds_all) // 2] if ds_all else ""
    def stat(L):
        if not L: return None
        n = len(L); d10 = sum(x["r10"] < 0 for x in L); d20 = sum(x["r20"] < 0 for x in L); dor = sum((x["r10"] < 0) or (x["r20"] < 0) for x in L)
        return {"n": n, "dates": len({x["d"] for x in L}), "dn10": d10 / n, "dn20": d20 / n, "dnor": dor / n, "avg10": float(np.mean([x["r10"] for x in L])), "avg20": float(np.mean([x["r20"] for x in L])),
                "false_up10": sum(x["up10"] for x in L) / n}
    print(f"\n■ B. 그날 규칙 — T0 ∩ 특징 · 신호일 종가 진입 · 같은 종목 5일 안 중복 제거 · 앞/뒤 경계 {mid}")
    for g in groups:
        base = thin([r for r in sel(rows, g)])
        if not base: continue
        b0 = stat(base); res["B"][g] = {"base": b0, "rules": {}}
        for nm, need in rules:
            L = thin([r for r in sel(rows, g) if all(f in r["f"] for f in need)])
            s_ = stat(L)
            if not s_: continue
            s_["front"] = stat([x for x in L if x["d"] < mid]); s_["back"] = stat([x for x in L if x["d"] >= mid])
            s_["imp10"] = s_["dn10"] - b0["dn10"]; s_["imp20"] = s_["dn20"] - b0["dn20"]; s_["impor"] = s_["dnor"] - b0["dnor"]
            s_["near_top"] = sum(x["near_top"] for x in L)   # 실제 폭락 고점 0~5봉 전에 켜진 사건 수
            res["B"][g]["rules"][nm] = s_
        if g in ("전체", "반도체", "금", "은", "우주", "양자"):
            print(f"  [{g}] 평소 T0 {b0['n']}건({b0['dates']}일) · 10일 하락 {b0['dn10']*100:.0f}% · 20일 {b0['dn20']*100:.0f}% · OR {b0['dnor']*100:.0f}% · 평균 {b0['avg10']*100:+.1f}/{b0['avg20']*100:+.1f}% · +10% 상승 지속 {b0['false_up10']*100:.0f}%")
            best = sorted([(nm, s_) for nm, s_ in res["B"][g]["rules"].items() if nm != "T0 과열 맥락(평소)" and s_["n"] >= 15], key=lambda x: -x[1]["dnor"])[:6]
            for nm, s_ in best:
                fr, bk = s_["front"], s_["back"]
                print(f"     {nm[:34]:34} n {s_['n']:4}({s_['dates']}일) | 10일 {s_['dn10']*100:.0f}% 20일 {s_['dn20']*100:.0f}% OR {s_['dnor']*100:.0f}% (평소 대비 {s_['impor']*100:+.0f}%p)"
                      f" | 평균 {s_['avg10']*100:+.1f}/{s_['avg20']*100:+.1f}% | 오경보 {s_['false_up10']*100:.0f}% | 앞 {fr['dnor']*100 if fr else 0:.0f}%({fr['n'] if fr else 0}) 뒤 {bk['dnor']*100 if bk else 0:.0f}%({bk['n'] if bk else 0})")
    # 실제 폭락 고점 포착률(그날 규칙이 고점 t−5~t 안에 켜졌나) — 규칙별 · 분야별
    rowidx = {}
    for r in rows: rowidx.setdefault((r["tk"]), []).append(r)
    print("\n■ 실제 폭락 고점 포착 — 고점 t−5~t 안에 그날 규칙이 켜진 비율(폭락) vs 가짜 고점 같은 창(오경보)")
    res["capture"] = {}
    for g in ["전체", "반도체", "금", "은", "우주", "양자"]:
        T, Fk = sel(tops, g), sel(fakes, g); res["capture"][g] = {}
        cells = []
        for nm, need in rules[:9]:
            def lit(x):   # 고점 t의 t−5~t 거래일 안에 그날 규칙(T0 ∩ 특징)이 켜졌나 — 그날까지 자료로 계산한 값
                return any(x["t"] - 5 <= r["t"] <= x["t"] and all(f in r["f"] for f in need) for r in rowidx.get(x["tk"], []))
            a, b = sum(lit(x) for x in T), sum(lit(x) for x in Fk)
            res["capture"][g][nm] = {"top": a, "tops": len(T), "fake": b, "fakes": len(Fk)}
            cells.append(f"{nm} {a}/{len(T)} vs {b}/{len(Fk)}")
        print(f"  [{g}] " + " · ".join(cells))
    print("\n■ 고점 사례 연구실 9건 — 고점일 기준 −5~0봉에 켜진 특징(상대 봉)")
    for x in cases:
        print(f"  {x['tk']:5} {x['d']} {x['kind']} | 11-06 정의상 폭락 고점 {x['in_1106_def']['폭락 고점']} · 가짜 고점 {x['in_1106_def']['가짜 고점']} | "
              + (" · ".join(f"{f} {v}" for f, v in x["lit"].items() if v) or "켜진 특징 없음"))
    miss = [k for k in lab_cases if k[0] not in {x["tk"] for x in cases}]
    if miss: print(f"  확인 못 한 사례: {miss}")
    res["lab_missing"] = miss
    if out_path:
        json.dump(res, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"), default=lambda x: x.item() if hasattr(x, "item") else str(x))
        print(f"\n→ {out_path} 저장")


if __name__ == "__main__":
    main()
