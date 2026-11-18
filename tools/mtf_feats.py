"""주봉·월봉 지표 — tools/mtf-cross-lab.py(연구)와 tools/mtf-flags.py(화면용 매일 계산)가 같이 쓴다. 정의는 docs/2026-11-13-mtf-cross.md §3.
식을 바꾸면 연구 결과와 화면이 어긋난다 — 바꾸지 말 것."""
import numpy as np, pandas as pd


def rsi(x, n=14):
    d = np.diff(x, prepend=np.nan); up = pd.Series(np.where(d > 0, d, 0.0)).ewm(alpha=1 / n, adjust=False).mean()
    dn = pd.Series(np.where(d < 0, -d, 0.0)).ewm(alpha=1 / n, adjust=False).mean()
    return (100 - 100 / (1 + up / dn.replace(0, np.nan))).to_numpy()


A_KEYS = ["VSPK", "VDRY", "VFADE", "SLOW", "HOLD", "DBOT", "RSIDIV", "FLOW", "REC"]
B_KEYS = ["VSPK", "VDRY", "RUNDRY", "UPSLOW", "WICK", "RSIHOT", "RSIBEAR", "FLOWWK", "BRK"]
KNM = {"VSPK": "거래대금 급증(2배)", "VDRY": "거래대금 고갈(0.6배)", "VFADE": "거래대금 3봉 연속 감소", "SLOW": "하락 둔화", "HOLD": "저점 유지",
       "DBOT": "쌍바닥", "RSIDIV": "RSI 상승 다이버전스", "FLOW": "OBV·CMF 개선", "REC": "추세 회복", "RUNDRY": "급등 뒤 거래대금 고갈",
       "UPSLOW": "상승 둔화", "WICK": "고점 윗꼬리", "RSIHOT": "RSI 70↑", "RSIBEAR": "RSI 하락 다이버전스", "FLOWWK": "OBV·CMF 약화", "BRK": "추세 이탈"}
TFN = {"W": "주봉", "M": "월봉"}


def bars(d, rule):
    B = d.resample(rule).agg({"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum", "DV": "sum"})
    B["last"] = d["Close"].resample(rule).apply(lambda s: s.index[-1] if len(s) else pd.NaT)
    return B.dropna(subset=["Close", "last"])


def tf_feats(B, tf):
    o, h, l, c, v, vol = (B[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "DV", "Volume"))
    n = len(c); k = 8 if tf == "W" else 6; R14 = rsi(c)
    ma = pd.Series(c).rolling(20 if tf == "W" else 6).mean().to_numpy()
    obv = np.cumsum(np.sign(np.r_[0, np.diff(c)]) * vol); rng = np.where(h - l > 0, h - l, np.nan)
    mfv = np.nan_to_num(((c - l) - (h - c)) / rng, nan=0) * vol
    hiwin = 52 if tf == "W" else 12; jmin = max(hiwin, 26 if tf == "W" else 14)
    out = {f"{tf}_{x}": np.zeros(n, bool) for x in set(A_KEYS + B_KEYS)}
    for j in range(jmin, n):
        ap = v[j - k:j].mean(); f = {}
        f["VSPK"] = ap > 0 and v[j] >= 2 * ap; f["VDRY"] = ap > 0 and v[j] <= 0.6 * ap
        f["VFADE"] = v[j] < v[j - 1] < v[j - 2]
        rl, rp = c[j] / c[j - 3] - 1, c[j - 3] / c[j - 6] - 1
        f["SLOW"] = rp < 0 and rl > rp
        f["HOLD"] = l[j - 1:j + 1].min() >= l[j - 5:j - 1].min()
        a0, a1, b0 = (j - 12, j - 3, j - 3) if tf == "W" else (j - 8, j - 2, j - 2)
        i1 = a0 + int(np.argmin(l[a0:a1])); L1 = l[i1]; i2 = b0 + int(np.argmin(l[b0:j + 1])); L2 = l[i2]
        mid = h[i1 + 1:i2].max() if i2 > i1 + 1 else 0
        f["DBOT"] = L1 > 0 and abs(L2 / L1 - 1) <= 0.03 and mid >= L1 * 1.10 and c[j] >= L2 * 1.03
        low6 = c[j] <= c[j - 5:j + 1].min() * 1.02
        f["RSIDIV"] = bool(low6 and np.isfinite(R14[j]) and R14[j] > np.nanmin(R14[j - 5:j]))
        cmf = mfv[j - 2:j + 1].sum() / max(vol[j - 2:j + 1].sum(), 1)
        f["FLOW"] = bool((low6 and obv[j] > obv[j - 5:j + 1].min()) or cmf > 0)
        w = 4 if tf == "W" else 3
        f["REC"] = bool(np.isfinite(ma[j]) and c[j] > ma[j] and np.any(c[j - w:j] <= ma[j - w:j]))
        f["RUNDRY"] = (c[j - 1] / c[j - 4] - 1) >= (0.20 if tf == "W" else 0.30) and ap > 0 and v[j] <= 0.7 * ap
        f["UPSLOW"] = rp >= 0.10 and rl < rp / 2
        hp = h[j - hiwin:j].max(); uw = (h[j] - max(o[j], c[j])) / rng[j] if np.isfinite(rng[j]) else 0
        f["WICK"] = bool(h[j] >= hp * 0.97 and uw >= 0.5)
        f["RSIHOT"] = bool(np.isfinite(R14[j]) and R14[j] >= 70)
        h12 = h[j - 12:j].max()
        f["RSIBEAR"] = bool(h[j] >= h12 and np.isfinite(R14[j]) and R14[j] < np.nanmax(R14[j - 12:j]) - 5)
        f["FLOWWK"] = bool((h[j] >= h12 * 0.97 and obv[j] < obv[j - 12:j].max()) or cmf < 0)
        f["BRK"] = bool(np.isfinite(ma[j]) and np.isfinite(ma[j - 1]) and c[j] < ma[j] and c[j - 1] >= ma[j - 1])
        for x, val in f.items(): out[f"{tf}_{x}"][j] = bool(val)
    F = pd.DataFrame(out); F["last"] = pd.to_datetime(B["last"].to_numpy()).astype("datetime64[ns]"); return F.dropna(subset=["last"])
