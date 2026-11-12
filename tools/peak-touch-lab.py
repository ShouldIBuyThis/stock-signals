"""고점 터치 후 종가 급락(고점 돌파 실패) 연구 — docs/2026-11-12-peak-touch-fail.md 사전 등록 그대로. CI 전용(야후).
+ 보고용: EXT(25%) 3·5·7·10일 하락 비율(종가·시가 진입). 자료 묶음·가져오기·가중은 peak-reader-lab2.py 것을 그대로 쓴다.
사용: python tools/peak-touch-lab.py --emit backtest/peak-touch.json
"""
import argparse, importlib.util, json, sys
from datetime import datetime, timezone
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)
import pattern_flags as pf


def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m


L2 = _load("lab2", "peak-reader-lab2.py")
SIGS = ["TF", "TF_M", "T_W", "T_L", "T_D", "BW", "T"]
NAMES = {"TF": "본 신호: 고점 터치 ∧ 윗꼬리 ∧ (하위 마감 ∨ −3%)", "TF_M": "본 신호 ∧ 모멘텀 약화", "T_W": "터치 ∧ 윗꼬리", "T_L": "터치 ∧ 하위 30% 마감",
         "T_D": "터치 ∧ 전일 대비 −3%", "BW": "비교: 밴드 워크(강하게 마감)", "T": "비교: 고점 터치 전체"}
PARTS = ("E", "T", "X")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--emit", default=""); a = ap.parse_args()
    W = L2.bb.wl_names(); wl = set(W)
    orig = list(W) + [t for t in L2.EXTRA if t not in wl]
    rows, ext_rows, run_rows = [], [], []
    for t in orig + L2.NEW:
        df = L2.fetch(t)
        if df is None or len(df) < 260: continue
        if t in L2.STARTS: df = df[df.index >= L2.STARTS[t]]
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        dates = [str(x.date()) for x in df.index]; n = len(c); lev = L2.LEV.get(t, 1)
        part = lambda d: "X" if t in L2.NEW else ("T" if d < L2.T_END else ("E" if d >= L2.EXP_START else None))
        tf = pf.touch_fail_flags(o, h, l, c, v, lev=lev, ticker=t)
        h52 = pd.Series(h).rolling(252, min_periods=1).max().to_numpy()
        def rec(i):
            r = {"d": dates[i], "p": part(dates[i])}
            for k in (3, 5, 7, 10):
                r[f"c{k}"] = c[i + k] / c[i] - 1 if i + k < n else np.nan
                r[f"o{k}"] = c[i + k] / o[i + 1] - 1 if i + k < n and i + 1 < n else np.nan
            r["up10"] = float(c[i + 1:i + 11].max() / c[i] - 1 >= 0.10) if i + 10 < n else np.nan
            r["nh20"] = float(h[i + 1:i + 21].max() > h52[i]) if i + 20 < n else np.nan
            r["day"] = c[i] / o[i] - 1
            return r
        for sname in SIGS:
            for i in L2.episodes(tf[sname], cool=5):
                if i + 10 >= n: continue
                r = rec(i)
                if r["p"]: r["s"] = sname; rows.append(r)
        # EXT 25% 3·5·7·10일(보고용) — RUN 안
        fl = pf.peak_reader_flags(o, h, l, c, v, lev=lev, ticker=t)
        ext = (c / fl["_aux"]["ma20"] - 1) / max(lev, 1)
        for i in L2.episodes(fl["RUN"] & np.nan_to_num(ext >= 0.25 - 1e-12, nan=False)):
            if i + 10 < n:
                r = rec(i)
                if r["p"]: ext_rows.append(r)
        for i in range(0, n - 10, 5):
            if fl["RUN"][i]:
                r = rec(i)
                if r["p"]: run_rows.append(r)
    def st(rs, pre="c"):
        d = [r["d"] for r in rs]; z = {"n": len(rs), "dates": len(set(d))}
        for k in (3, 5, 7, 10):
            x = np.array([r[f"{pre}{k}"] for r in rs], float)
            z[f"dn{k}"] = L2.wrate(d, np.where(x < -0.01, 1.0, np.where(x > 0.01, 0.0, np.nan))) if rs else None
            z[f"avg{k}"] = L2.wrate(d, x) if rs else None
        if pre == "c":
            z["up10"] = L2.wrate(d, [r["up10"] for r in rs]) if rs else None
            z["nh20"] = L2.wrate(d, [r["nh20"] for r in rs]) if rs else None
            z["day"] = L2.wrate(d, [r["day"] for r in rs]) if rs else None
        return z
    f_ = lambda x: "—" if x is None else f"{x*100:.0f}"
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "kind": "research", "doc": "docs/2026-11-12-peak-touch-fail.md", "names": NAMES, "touch": {}, "ext": {}}
    print("■ 고점 터치 후 종가 급락 — 묶음 E/T/X · 하락 비율 3·5·7·10일(±1% 보합 제외 · 날짜 가중) · 10일 평균 · 10일 안 +10% · 20일 안 신고가 · 사건")
    for P in PARTS:
        base = st([r for r in rows if r["p"] == P and r["s"] == "T"])
        print(f"  [{P}]")
        for sname in SIGS:
            rs = [r for r in rows if r["p"] == P and r["s"] == sname]; z = st(rs); zo = st(rs, "o")
            out["touch"][f"{P}|{sname}"] = {"close": z, "open": zo}
            dd = "" if sname == "T" or z["dn10"] is None or base["dn10"] is None else f" (터치 전체 대비 10일 {(z['dn10']-base['dn10'])*100:+.0f}%p)"
            print(f"    {NAMES[sname]:<32} {f_(z['dn3'])}·{f_(z['dn5'])}·{f_(z['dn7'])}·{f_(z['dn10'])}% · 평균 {(z['avg10'] or 0)*100:+.1f}% · +10% {f_(z['up10'])}% · 신고가 {f_(z['nh20'])}% · {z['n']}건 · 시가진입 10일 {f_(zo['dn10'])}% · 당일 {(z['day'] or 0)*100:+.1f}%{dd}")
    def passP(P):
        z = out["touch"].get(f"{P}|TF", {}).get("close"); b = out["touch"].get(f"{P}|T", {}).get("close")
        if not z or not b or z["n"] < 50 or z["dn10"] is None: return None
        return z["dn10"] - b["dn10"] >= 0.05 and z["dn5"] - b["dn5"] >= 0.03 and z["avg10"] - b["avg10"] <= -0.01
    pt, px = passP("T"), passP("X")
    zE, bE = out["touch"]["E|TF"]["close"], out["touch"]["E|T"]["close"]
    eok = zE["dn10"] is not None and bE["dn10"] is not None and zE["dn10"] >= bE["dn10"]
    verdict = "판단 보류(사건 50 미만)" if pt is None or px is None else ("검증 통과" if pt and px and eok else "검증 미통과")
    out["verdict"] = verdict; out["pass_parts"] = {"T": pt, "X": px, "E_same_dir": eok}
    print(f"  ▶ 본 신호 판정: {verdict} (T {pt} · X {px} · E 같은 방향 {eok})")
    print("\n■ EXT 25%(급등 국면) 3·5·7·10일 하락 비율 vs 급등 국면 평소 — 보고용")
    for P in PARTS:
        z, zo, b = st([r for r in ext_rows if r["p"] == P]), st([r for r in ext_rows if r["p"] == P], "o"), st([r for r in run_rows if r["p"] == P])
        out["ext"][P] = {"close": z, "open": zo, "base": b}
        print(f"  {P}: EXT {f_(z['dn3'])}·{f_(z['dn5'])}·{f_(z['dn7'])}·{f_(z['dn10'])}% ({z['n']}건) · 시가진입 {f_(zo['dn3'])}·{f_(zo['dn5'])}·{f_(zo['dn7'])}·{f_(zo['dn10'])}% · 평소 {f_(b['dn3'])}·{f_(b['dn5'])}·{f_(b['dn7'])}·{f_(b['dn10'])}%")
    # 233740 별도(표본 밖) — 2배 레버리지
    df = L2.fetch("233740.KS")
    if df is not None and len(df) > 260:
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume")); dates = [str(x.date()) for x in df.index]
        tf = pf.touch_fail_flags(o, h, l, c, v, lev=2, ticker="233740.KS"); ax = tf["_aux"]
        print("\n■ 233740.KS(2배 · 표본 밖) 2026-02-20~03-20 — 고가/종가 기준 52주 위치 · %B · 신호")
        for i, d in enumerate(dates):
            if "2026-02-20" <= d <= "2026-03-20":
                on = [s_ for s_ in SIGS if tf[s_][i]]
                print(f"  {d} 고{h[i]:.0f} 종{c[i]:.0f} · 52주(고가) {ax['p52h'][i]*100:+.1f}% · 52주(종가) {ax['p52c'][i]*100:+.1f}% · %B 고가 {ax['pbh'][i]:.2f} 종가 {ax['pbc'][i]:.2f} · 윗꼬리 {ax['upw'][i]*100:.0f}% · 마감위치 {ax['cpos'][i]*100:.0f}% · 등락(1배 환산) {ax['chg'][i]*100:+.1f}% → {', '.join(on) or '-'}")
    if a.emit:
        json.dump(out, open(a.emit, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"), default=lambda x: None if isinstance(x, float) and not np.isfinite(x) else (float(x) if isinstance(x, np.floating) else (bool(x) if isinstance(x, np.bool_) else None)))
        print(f"→ {a.emit} 저장")


if __name__ == "__main__":
    main()
