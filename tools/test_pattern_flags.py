"""pattern_flags.py(사이트 뱃지)가 연구 도구 정의와 봉 단위로 같은지 대조한다.

python3 tools/test_pattern_flags.py
합성 가격(포물선 상승·붕괴·과매도 반등 구간 포함) 여러 seed에서 코드별로 비교한다.
"""
import importlib.util, os, sys
import numpy as np, pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import pattern_flags as pf

def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, os.path.join(ROOT, "tools", fn))
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m

tp = _load("tp", "theme-patterns.py")
tt = tp.tt

def synth(seed, n=900):
    rng = np.random.default_rng(seed)
    drift = np.concatenate([np.full(n // 3, 0.0005), np.full(n // 6, 0.012), np.full(n // 6, -0.012),
                            np.full(n - n // 3 - 2 * (n // 6), 0.001)])
    r = drift + rng.normal(0, 0.03, n)
    c = 50 * np.exp(np.cumsum(r))
    o = c * np.exp(rng.normal(0, 0.012, n))
    h = np.maximum(o, c) * np.exp(np.abs(rng.normal(0, 0.015, n)))
    l = np.minimum(o, c) * np.exp(-np.abs(rng.normal(0, 0.015, n)))
    v = rng.lognormal(10, 0.5, n)
    idx = pd.bdate_range("2017-01-02", periods=n)
    return pd.DataFrame({"Open": o, "High": h, "Low": l, "Close": c, "Volume": v}, index=idx)

def first_per_run(B, m):
    out = np.zeros(len(m), bool)
    idx = np.nonzero(B["outside"] & m)[0]
    if len(idx):
        _, first = np.unique(B["run"][idx], return_index=True)
        out[idx[first]] = True
    return out

def expected(df, ticker):
    P = tp.prep(df)
    D, T = tp.danger_pats(P), tp.triggers(P)
    rec = tp.recent(tp.oversold(P), 20)
    e = {
        "R_BLOW": D["블로우오프 대량 음봉(60일 +50%↑ · 거래량 2배↑ · −3%↓ 음봉)"],
        "R_MA20": D["20일선 이격 +25%↑"], "R_MA200": D["200일선 이격 +80%↑"],
        "R_PARA": D["포물선 뒤 20일선 첫 이탈"],
        "B_STOCH": T["스토캐스틱 K≤20 골든"] & rec, "B_BBLO": T["볼밴 하단 재진입"] & rec,
        "B_MA5": T["5일선 안착(2일 연속 위)"] & rec, "B_G520": T["5·20일선 골든크로스"] & rec,
    }
    X = tt.prep(df); C = dict(tt.candles(X)); B = tt.band_trades(X, 20, 2)
    theme = pf.THEME_TRIM.get(ticker)
    if theme == "house":
        e["T_HOUSE"] = first_per_run(B, C["거래량≥1.5배"])
    elif theme == "quantum":
        names = ["음봉", "윗꼬리≥50%", "교수형(아랫꼬리≥60·몸통≤30·윗꼬리≤15)", "샛별 형성(큰 양봉 다음 날 별)"]
        e["T_QUANTUM"] = np.logical_or.reduce([first_per_run(B, C[k]) for k in names])
    return e

def main():
    bad, hits = 0, {}
    for seed in range(12):
        df = synth(seed)
        for tk in ("ITB", "IONQ", "AAPL"):
            got = pf.flag_series(*(df[k].to_numpy() for k in ("Open", "High", "Low", "Close", "Volume")), ticker=tk)
            exp = expected(df, tk)
            if set(got) != set(exp):
                print(f"seed {seed} {tk}: 코드 집합 다름 {sorted(set(got) ^ set(exp))}"); bad += 1; continue
            for k in exp:
                diff = np.nonzero(np.asarray(got[k], bool) != np.asarray(exp[k], bool))[0]
                hits[k] = hits.get(k, 0) + int(np.sum(exp[k]))
                if len(diff):
                    bad += 1
                    print(f"seed {seed} {tk} {k}: {len(diff)}봉 불일치 (첫 {diff[:5].tolist()})")
    print("코드별 참 봉 수:", " · ".join(f"{k} {v}" for k, v in sorted(hits.items())))
    empty = [k for k in pf.CODES if hits.get(k, 0) == 0]
    if empty:
        print("⚠ 합성 데이터에서 한 번도 안 나온 코드(대조 불충분):", empty)
    print("OK" if bad == 0 else f"FAIL {bad}")
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
