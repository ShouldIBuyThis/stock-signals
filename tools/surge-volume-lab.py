"""1년 폭등 종목에서 거래량 폭증·볼밴 상단·이탈이 고점 위험을 예측하나 (읽기 전용 · 반영 전 보고용)

왜 (2026-11-06 사용자: NAIL·SOXL·하이닉스·우주·양자처럼 1년 안에 폭등한 종목 — 거래량 3배·볼밴 상단 밖·복귀/5일선 이탈을
    단독·조합으로 · 10/20/60일 안 −15%·−25% 하락 확률과 계속 상승 확률 · 같은 급등인데 안 빠진 종목과 비교 · 레버리지 구분 · 그날 알 수 있는 값만)
정의(전부 신호일 t 종가까지)
  급등 등급  종가 / 직전 250거래일 최저가 − 1 ≥ 100% · 200% · 300%   (같은 급등 수준 전체 = '비교군')
  V3        직전 5거래일(t 포함) 안에 거래량이 20일 평균의 3배↑인 날
  OUT       오늘 종가가 볼밴(20, 2σ) 상단 밖
  OUT5      최근 5거래일 안에 상단 밖이었던 날
  EXIT      오늘 '상단 밖 → 안 복귀'(어제 밖, 오늘 안) 또는 '처음 5일선 아래 마감'
결과(진입 = 다음 날 시가)
  하락15/25  n일 안 저가가 진입가 대비 −15%/−25% 이하
  계속 상승   n일 동안 −15% 하락 없이 n일 뒤 종가가 진입가 +10%↑
같은 종목·같은 조건 10거래일 쿨다운 · 레버리지 ETF(main.py LEVERAGED + SOXL·NAIL 등)는 따로 · 앞/뒤 반 · 표본 등급
"""
import importlib.util, sys, ast
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)

def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py")
ss = _load("ss", "signal-stats.py")
pt = _load("pt", "peak-trough-lab.py")
_src = open(f"{ROOT}/main.py", encoding="utf-8").read()
LEV = set(ast.literal_eval(_src[_src.index("LEVERAGED = {") + len("LEVERAGED = "):_src.index("}", _src.index("LEVERAGED = {")) + 1])) | {"SOXL", "NAIL", "TQQQ"}
COOL, NS = 10, (10, 20, 60)

def main():
    tks = list(dict.fromkeys(list(ss.watchlist()) + [t for v in pt.THEMES.values() for t in v]))
    rows = []
    for tk in tks:
        df = tr.fetch(tk)
        if df is None or len(df) < 320: continue
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        N = len(c); dates = [str(d.date()) for d in df.index]
        m20 = pd.Series(c).rolling(20).mean().to_numpy(); sd = pd.Series(c).rolling(20).std().to_numpy(); up = m20 + 2 * sd
        ma5 = pd.Series(c).rolling(5).mean().to_numpy()
        vs = pd.Series(v).shift(1).rolling(20).mean().to_numpy(); vr = v / np.where(vs > 0, vs, np.nan)
        lo250 = pd.Series(l).rolling(250).min().to_numpy()
        out = c > up; out5 = pd.Series(out.astype(float)).rolling(5).max().to_numpy() > 0
        v3 = pd.Series(np.nan_to_num(vr) >= 3).astype(float).rolling(5).max().to_numpy() > 0
        exit_ = (np.r_[False, out[:-1]] & ~out) | ((c < ma5) & ~(np.r_[np.nan, c[:-1]] < np.r_[np.nan, ma5[:-1]]))
        surge = c / lo250 - 1
        conds = {"비교군(급등만)": np.ones(N, bool), "+V3": v3, "+OUT": out, "+V3+OUT": v3 & out, "+EXIT": exit_,
                 "+V3+EXIT": v3 & exit_, "+OUT5+EXIT": out5 & exit_, "+V3+OUT5+EXIT": v3 & out5 & exit_}
        last = {}
        for i in range(260, N - 61):
            if np.isnan(surge[i]) or surge[i] < 1.0: continue
            lvl = 3 if surge[i] >= 3 else 2 if surge[i] >= 2 else 1
            e = o[i + 1]
            res = {}
            for n in NS:
                mn = l[i + 1:i + 1 + n].min() / e - 1
                res[f"d15_{n}"] = mn <= -0.15; res[f"d25_{n}"] = mn <= -0.25
                res[f"up_{n}"] = mn > -0.15 and c[i + n] / e - 1 >= 0.10
            for cn, m in conds.items():
                if not m[i]: continue
                for L in (1, 2, 3):
                    if lvl < L: continue
                    k = (cn, L)
                    if i - last.get(k, -999) < COOL: continue
                    last[k] = i
                    rows.append(dict(tk=tk, lev=tk in LEV, d=dates[i], cn=cn, L=L, **res))
    ds = sorted({r["d"] for r in rows}); mid = ds[len(ds) // 2] if ds else ""
    tier = lambda n: "사용" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "희귀" if n >= 10 else "불가"
    print(f"■ 1년 폭등 종목 · 거래량 폭증 · 볼밴 상단 · 이탈 → 고점 위험? · {ds[0] if ds else ''}~{ds[-1] if ds else ''} · 종목 {len(tks)}개(레버리지 {len(LEV & set(tks))}) · 앞/뒤 경계 {mid}")
    print("  칸 = 하락15%: 10/20/60일 · 하락25%: 10/20/60일 · 계속 상승(−15% 없이 +10%↑): 20/60일 · 60일 하락25% 앞/뒤 반")
    for lev in (False, True):
        for L, nm in ((1, "1년 저점 대비 +100%↑"), (2, "+200%↑"), (3, "+300%↑")):
            print(f"\n  [{'레버리지 ETF' if lev else '일반 주식·ETF'} · {nm}]")
            for cn in ("비교군(급등만)", "+V3", "+OUT", "+V3+OUT", "+EXIT", "+V3+EXIT", "+OUT5+EXIT", "+V3+OUT5+EXIT"):
                rr = [r for r in rows if r["lev"] == lev and r["L"] == L and r["cn"] == cn]
                if not rr: print(f"    {cn:<16} 표본 0"); continue
                p = lambda k, a=rr: (np.mean([x[k] for x in a]) * 100) if a else float("nan")
                fr, bk = [x for x in rr if x["d"] < mid], [x for x in rr if x["d"] >= mid]
                print(f"    {cn:<16} n={len(rr):<5}[{tier(len(rr))}] 하락15 {p('d15_10'):3.0f}/{p('d15_20'):3.0f}/{p('d15_60'):3.0f}%"
                      f" · 하락25 {p('d25_10'):3.0f}/{p('d25_20'):3.0f}/{p('d25_60'):3.0f}% · 계속상승 {p('up_20'):3.0f}/{p('up_60'):3.0f}%"
                      f" · 60일 하락25 앞 {p('d25_60', fr):.0f}%({len(fr)}) 뒤 {p('d25_60', bk):.0f}%({len(bk)})")

if __name__ == "__main__":
    main()
