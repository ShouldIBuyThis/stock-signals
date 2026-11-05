"""카드 표시 전용 패턴 뱃지 — 등급(evaluate)에는 쓰지 않는다.

정의는 2026-11-05 연구 도구와 **같아야** 한다:
  - 익절 후보(테마별): tools/theme-trim.py  candles() · band_trades()  (볼밴 20·2σ, 모표준편차, 밖 구간의 첫 캔들)
  - 급락 위험:        tools/theme-patterns.py danger_pats()
  - 저점 반등 후보:    tools/theme-patterns.py triggers() ∧ recent(oversold(), 20)
대조 테스트: python3 tools/test_pattern_flags.py  (연구 함수와 봉 단위로 같은지 본다)

여기서 정의를 바꾸면 연구 수치(docs/2026-11-05-theme-patterns.md)와 뱃지가 어긋난다.
연구를 다시 돌리고 문서 수치를 고친 뒤에만 바꿀 것.
"""
import numpy as np
import pandas as pd

# 익절 후보는 연구에서 평균 성과가 플러스였던 테마에만 붙인다(다른 테마는 평균 손해).
THEME_TRIM = {
    "NAIL": "house", "ITB": "house",
    "IONQ": "quantum", "INFQ": "quantum", "RGTI": "quantum", "QUBT": "quantum", "QBTS": "quantum",
}

# 코드 → (종류, 짧은 이름). 원장(hist)에는 코드만 쉼표로 남는다.
CODES = {
    "T_HOUSE": ("trim", "주택: 상단 밖 + 거래량 1.5배"),
    "T_QUANTUM": ("trim", "양자: 상단 밖 + 음봉/윗꼬리/교수형/별"),
    "R_BLOW": ("risk", "블로우오프 대량 음봉"),
    "R_MA20": ("risk", "20일선 이격 +25%"),
    "R_MA200": ("risk", "200일선 이격 +80%"),
    "R_PARA": ("risk", "포물선 뒤 20일선 첫 이탈"),
    "B_STOCH": ("bounce", "과매도 뒤 스토캐스틱 K≤20 골든"),
    "B_BBLO": ("bounce", "과매도 뒤 볼밴 하단 재진입"),
    "B_MA5": ("bounce", "과매도 뒤 5일선 안착(2일)"),
    "B_G520": ("bounce", "과매도 뒤 5·20일선 골든크로스"),
}


def _shift(a, k=1):
    out = np.empty_like(a, dtype=float)
    out[:k] = np.nan
    out[k:] = a[:-k]
    return out


def _gt(a, b):
    with np.errstate(invalid="ignore"):
        return np.nan_to_num(a, nan=-1e18) > np.nan_to_num(b, nan=1e18)


def _lt(a, b):
    with np.errstate(invalid="ignore"):
        return np.nan_to_num(a, nan=1e18) < np.nan_to_num(b, nan=-1e18)


def _rsi(c, p=14):
    out = np.full(len(c), np.nan)
    d = np.diff(c)
    if len(d) < p + 1:
        return out
    g, l = np.clip(d, 0, None), np.clip(-d, 0, None)
    ag, al = g[:p].mean(), l[:p].mean()
    out[p] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    for i in range(p, len(d)):
        ag = (ag * (p - 1) + g[i]) / p
        al = (al * (p - 1) + l[i]) / p
        out[i + 1] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


def _runlen(cond):
    r = np.zeros(len(cond), dtype=np.int32)
    n = 0
    for i, v in enumerate(cond):
        n = n + 1 if v else 0
        r[i] = n
    return r


def _recent(mask, n=20):
    cs = np.concatenate([[0], np.cumsum(mask)])
    i = np.arange(len(mask))
    return (cs[i] - cs[np.maximum(i - n, 0)]) > 0


def _first_in_run(cond, outside):
    """상단 밖 구간마다 cond가 처음 참인 날만 (theme-trim 캔들 지도와 같은 집계)."""
    out = np.zeros(len(cond), dtype=bool)
    seen = False
    for i in range(len(cond)):
        if not outside[i]:
            seen = False
            continue
        if cond[i] and not seen:
            out[i] = True
            seen = True
    return out


def flag_series(o, h, l, c, v, ticker=""):
    """봉마다 코드 → bool 배열. 입력은 같은 길이의 float 배열(오래된 → 최근)."""
    o, h, l, c, v = (np.asarray(x, dtype=float) for x in (o, h, l, c, v))
    s = pd.Series(c)
    ma = {n: s.rolling(n).mean().to_numpy() for n in (5, 20, 60, 200)}
    sd0 = s.rolling(20).std(ddof=0).to_numpy()
    bbup, bblo = ma[20] + 2 * sd0, ma[20] - 2 * sd0
    rng = np.where(h - l > 0, h - l, np.nan)
    upw, loww, body = (h - np.maximum(o, c)) / rng, (np.minimum(o, c) - l) / rng, np.abs(c - o) / rng
    vs = pd.Series(v).rolling(20).mean().to_numpy()
    vr = np.where(vs > 0, v / np.where(vs > 0, vs, 1), np.nan)
    r14 = _rsi(c, 14)
    c1, o1 = _shift(c), _shift(o)
    out = {}

    # ── 익절 후보 (theme-trim candles, 볼밴 20·2σ 상단 밖 구간의 첫 캔들) ──
    outside = _gt(c, bbup)
    theme = THEME_TRIM.get(ticker)
    if theme == "house":
        out["T_HOUSE"] = _first_in_run(outside & _gt(vr, 1.5 - 1e-9), outside)
    elif theme == "quantum":
        b1 = _shift(body)
        big_up1 = _gt(c1, o1) & _gt(b1, 0.6 - 1e-9)
        star_today = _lt(body, 0.3 + 1e-9) & _gt(np.minimum(o, c), c1 * 0.995)
        hang = _gt(loww, 0.6 - 1e-9) & _lt(body, 0.3 + 1e-9) & _lt(upw, 0.15 + 1e-9)
        cand = [_lt(c, o), _gt(upw, 0.5 - 1e-9), hang, big_up1 & star_today]
        out["T_QUANTUM"] = np.logical_or.reduce([_first_in_run(outside & m, outside) for m in cand])

    # ── 급락 위험 (theme-patterns danger_pats) ──
    ret60 = c / _shift(c, 60) - 1
    para = _gt(pd.Series(ret60).rolling(20).max().to_numpy(), 0.5 - 1e-9)
    out["R_BLOW"] = _gt(ret60, 0.5 - 1e-9) & _lt(c, o) & _gt(vr, 2 - 1e-9) & _lt(c / c1 - 1, -0.03 + 1e-9)
    out["R_MA20"] = _gt(c / ma[20], 1.25 - 1e-9)
    out["R_MA200"] = _gt(c / ma[200], 1.8 - 1e-9)
    out["R_PARA"] = para & _lt(c, ma[20]) & ~_lt(c1, _shift(ma[20]))

    # ── 저점 반등 후보 (theme-patterns triggers ∧ 최근 20일 안 과매도) ──
    off60 = c / s.rolling(60).max().to_numpy() - 1
    oversold = _lt(r14, 30 + 1e-9) & _lt(off60, -0.15 + 1e-9) & _lt(c, bblo)
    rec = _recent(oversold, 20)
    hh, ll = pd.Series(h).rolling(14).max().to_numpy(), pd.Series(l).rolling(14).min().to_numpy()
    k = np.where(hh > ll, (c - ll) / np.where(hh > ll, hh - ll, 1) * 100, np.nan)
    d = pd.Series(k).rolling(3).mean().to_numpy()
    k1, d1 = _shift(k), _shift(d)
    run5 = _runlen(_gt(c, ma[5]))
    out["B_STOCH"] = rec & _lt(k1, 20 + 1e-9) & _lt(k1, d1 + 1e-9) & _gt(k, d)
    out["B_BBLO"] = rec & _gt(c, bblo) & _lt(c1, _shift(bblo))
    out["B_MA5"] = rec & (run5 == 2)
    out["B_G520"] = rec & _gt(ma[5], ma[20]) & ~_gt(_shift(ma[5]), _shift(ma[20]))
    return out


def flags_at(series, i):
    """봉 i(음수 허용)의 코드 문자열. 없으면 ''."""
    return ",".join(k for k in CODES if k in series and bool(series[k][i]))
