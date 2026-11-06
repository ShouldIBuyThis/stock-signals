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

# 테마별 저점 매수 규칙 — 다중 신호 '보조' 표시 전용(등급·순위 불변). 2026-11-05 사용자 지시
# "10년 통틀어 5건만 넘어도 규칙으로 써 보조 다중신호 적중률 높으면".
# 출처: tools/theme-patterns.py buy_combos(run 42049254937) 테마별 상위 규칙 중
#   10년 합계 적중 75%↑ · 5건↑ · 마지막 20% 기간에서 무너지지 않은 것(60%↑, 또는 1건 이하이고 맞음).
# 소프트웨어·데이터센터·나스닥은 마지막 20%에서 무너져 뺐다. 맥도날드·SK하이닉스는 관심종목이 아니다.
# (대상, RSI≤, 60일 고점 대비, 볼밴 하단 밖, 신호, 특징, 보유일, 앞 80% 적중(건), 뒤 20% 적중(건))
THEME_BUY = {
    "M_SEMI":  (("SOXL",), 35, -0.10, True, "ma5_run3", "above200", 10, "93%(15)", "75%(4)"),
    "M_IND":   (("CAT", "AIT"), 25, -0.20, False, "ma5_run2", None, 20, "100%(8)", "100%(1)"),
    "M_HOUSE": (("NAIL", "ITB"), 35, -0.10, False, "g2060", None, 20, "100%(9)", "100%(2)"),
    "M_QUANT": (("IONQ", "QBTS", "RGTI", "INFQ", "QUBT"), 30, -0.30, True, "bblo_reentry", "capitulation", 10, "76%(17)", "100%(1)"),
    "M_NVDA":  (("NVDA",), 35, -0.10, True, "ma5_run1", "above200", 10, "92%(12)", "75%(4)"),
    "M_TSLA":  (("TSLA",), 35, -0.20, True, "ma5_run1", "down5", 10, "91%(11)", "67%(3)"),
    "M_AMAT":  (("AMAT",), 30, -0.20, True, "ma5_run3", None, 20, "100%(8)", "100%(2)"),
}

# 테마 하락 패턴 — v22 산식 입력(evaluate가 매수 등급을 보류한다). 2026-11-06 사용자 지시 "산식에 넣어야지".
# 출처: tools/theme-combos.py(run 42146129826) 테마별 1위 중 10년 20건+ · 마지막 20%에서도 방향 유지한 3개.
#   D_SEMI  SOXL      종가 볼밴 상단(20·2σ, 표본 표준편차) 밖 + 십자형(몸통≤10%)   10일 하락 68%(22) vs 기준 41%
#   D_SKH   SKHY      고가만 상단 돌파(종가는 안) + 윗꼬리≥50%                  20일 −10% 급락 40%(35) vs 28% (연구는 000660.KS)
#   D_QUANT 양자      상단 밖 2일+ 체류 뒤 첫 재진입 (+ evaluate에서 그날 VXN≥25)    10일 하락 72%·급락 86%(29) vs 53%·66%
THEME_DANGER = {
    "D_SEMI": ("SOXL",),
    "D_SKH": ("SKHY",),
    "D_QUANT": ("IONQ", "QBTS", "RGTI", "INFQ", "QUBT"),
}

# 볼밴 상단 밖 캔들(전 종목) — 테마 흐름 '오늘 캔들 신호' 표시용. tools/theme-trim.py candles()·band_trades()와 같은 정의
# (볼밴 20·2σ 모표준편차, 상단 밖 구간에서 그 캔들이 처음 나온 날). 성적은 index.html CANDLE_MAP(테마별 10년 실측)에서 읽는다.
CANDLE_CODES = {
    "C_OUT": "조건 없음", "C_UPW": "윗꼬리≥50%", "C_SHOOT": "유성형", "C_LOWW": "아랫꼬리≥50%", "C_HANG": "교수형",
    "C_DOJI": "도지·팽이", "C_STAR": "샛별 형성(큰 양봉 다음 날 별)", "C_BEAR": "음봉", "C_BIGBEAR": "장대양봉 다음 날 음봉",
    "C_DIV": "RSI 약세 다이버전스", "C_VOL": "거래량≥1.5배",
}

# 2026-11-06 신호 보드(사용자 지시: '오늘 어떤 반등·추세전환·과열·위험 신호가 떴나'를 4분류로) — 새 신호 코드.
# 성적은 미리 정하지 않는다. tools/signal-stats.py가 이 함수 그대로 10년을 돌려 backtest/signal-stats.json에 실측을 쓴다.
#   🟢 B_* 반등(과매도 뒤)  🔵 U_* 추세전환·상승 지속  🟠 O_* 단기과열·일부익절  🔴 X_* 하락추세·고점 위험
SIGNAL_CODES = {
    "B_DIVUP": ("green", "과매도 뒤 RSI 상승 다이버전스"),
    "B_ENGULF": ("green", "과매도 뒤 상승장악형"),
    "B_HAMMER": ("green", "볼밴 하단 망치형"),
    "B_MSTAR": ("green", "과매도 뒤 샛별형(상승반전)"),
    "B_VOLUP": ("green", "과매도 뒤 거래량 실린 양봉"),
    "B_SUPPORT": ("green", "120일 지지선 반등"),
    "U_MA20": ("blue", "20일선 돌파(60일선 상승 중)"),
    "U_BREAK": ("blue", "거래량 동반 20일 고점 돌파"),
    "U_G520": ("blue", "5·20일선 골든크로스"),
    "U_G2060": ("blue", "20·60일선 골든크로스"),
    "U_PULL": ("blue", "눌림목 뒤 추세 재개"),
    "O_RSI": ("orange", "RSI 70 과열 + 볼밴 상단 밖"),
    "O_EXT": ("orange", "볼밴 상단 과도 이탈"),
    "O_TURN": ("orange", "상단 밖에서 윗꼬리·음봉 전환"),
    "O_VOLSTALL": ("orange", "거래량 급증 뒤 상승 둔화"),
    "X_ESTAR": ("red", "고점 석별형(하락반전)"),
    "X_TOPBEAR": ("red", "고점 장대음봉"),
    "X_SUPBREAK": ("red", "거래량 동반 지지선 붕괴"),
    "X_DIVDN": ("red", "고점 RSI 하락 다이버전스"),
    "X_MA60": ("red", "60일선 하향 이탈(20일선 하락 중)"),
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
    "D_SEMI": ("danger", "반도체: 볼밴 상단 밖 십자형"),
    "D_SKH": ("danger", "SK하이닉스: 고가만 상단 돌파 + 긴 윗꼬리"),
    "D_QUANT": ("danger", "양자: 볼밴 위 체류 뒤 첫 재진입(VXN≥25일 때)"),
    **{k: ("candle", v) for k, v in CANDLE_CODES.items()},
    **{k: (v[0], v[1]) for k, v in SIGNAL_CODES.items()},
    "M_SEMI": ("theme_buy", "반도체: RSI≤35·−10%·하단 밖 뒤 5일선 3일 안착 + 200일선 위"),
    "M_IND": ("theme_buy", "산업재: RSI≤25·−20% 뒤 5일선 2일 안착"),
    "M_HOUSE": ("theme_buy", "주택: RSI≤35·−10% 뒤 20·60일선 골든크로스"),
    "M_QUANT": ("theme_buy", "양자: RSI≤30·−30%·하단 밖 뒤 하단 재진입 + 투매 거래량"),
    "M_NVDA": ("theme_buy", "엔비디아: RSI≤35·−10%·하단 밖 뒤 5일선 회복 + 200일선 위"),
    "M_TSLA": ("theme_buy", "테슬라: RSI≤35·−20%·하단 밖 뒤 5일선 회복 + 직전 5일 연속 하락"),
    "M_AMAT": ("theme_buy", "어플라이드: RSI≤30·−20%·하단 밖 뒤 5일선 3일 안착"),
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

    # ── 볼밴 상단 밖 캔들 (theme-trim candles, 전 종목) ──
    b1, rng_ = _shift(body), h - l
    tr_ = np.maximum(h - l, np.maximum(abs(h - c1), abs(l - c1)))
    atr = pd.Series(tr_).rolling(14).mean().to_numpy()
    big_up1c = _gt(c1, o1) & _gt(b1, 0.6 - 1e-9)
    cmax20 = s.shift(1).rolling(20).max().to_numpy()
    rmax20 = pd.Series(r14).shift(1).rolling(20).max().to_numpy()
    cm = {
        "C_OUT": np.ones(len(c), bool),
        "C_UPW": _gt(upw, 0.5 - 1e-9),
        "C_SHOOT": _gt(upw, 0.6 - 1e-9) & _lt(body, 0.3 + 1e-9) & _lt(loww, 0.15 + 1e-9),
        "C_LOWW": _gt(loww, 0.5 - 1e-9),
        "C_HANG": _gt(loww, 0.6 - 1e-9) & _lt(body, 0.3 + 1e-9) & _lt(upw, 0.15 + 1e-9),
        "C_DOJI": _lt(body, 0.3 + 1e-9) & _gt(upw, 0.25 - 1e-9) & _gt(loww, 0.25 - 1e-9),
        "C_STAR": big_up1c & _lt(body, 0.3 + 1e-9) & _gt(np.minimum(o, c), c1 * 0.995),
        "C_BEAR": _lt(c, o),
        "C_BIGBEAR": _gt(c1, o1) & _gt(b1, 0.6 - 1e-9) & _gt(_shift(rng_), 1.5 * _shift(atr)) & _lt(c, o),
        "C_DIV": _gt(c, cmax20 - 1e-9) & _lt(r14, rmax20),
        "C_VOL": _gt(vr, 1.5 - 1e-9),
    }
    for k, m in cm.items():
        out[k] = _first_in_run(outside & m, outside)

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

    # ── 테마별 저점 매수 규칙 (theme-patterns buy_combos의 triggers·features·oversold와 같은 정의) ──
    trig = {
        "ma5_run1": run5 == 1, "ma5_run2": run5 == 2, "ma5_run3": run5 == 3,
        "g2060": _gt(ma[20], ma[60]) & ~_gt(_shift(ma[20]), _shift(ma[60])),
        "bblo_reentry": _gt(c, bblo) & _lt(c1, _shift(bblo)),
    }
    vr5 = pd.Series(vr).rolling(5).max().to_numpy()
    maxdr10 = pd.Series(_runlen(_lt(c, c1))).rolling(10).max().to_numpy()
    feat = {"above200": _gt(c, ma[200]), "capitulation": _gt(vr5, 2 - 1e-9), "down5": _gt(maxdr10, 5 - 1e-9)}
    for code, (tks, rt, ddt, band, tn, fn_, *_rest) in THEME_BUY.items():
        if ticker not in tks:
            continue
        os_ = _lt(r14, rt + 1e-9) & _lt(off60, ddt + 1e-9)
        if band:
            os_ = os_ & _lt(c, bblo)
        m = trig[tn] & _recent(os_, 20)
        if fn_:
            m = m & feat[fn_]
        out[code] = m

    # ── 테마 하락 패턴 (theme-combos contexts·candles와 같은 정의 — 볼밴은 표본 표준편차 bbup1) ──
    sd1 = s.rolling(20).std(ddof=1).to_numpy()
    up1 = ma[20] + 2 * sd1
    out1_ = _gt(c, up1)
    run1 = _runlen(out1_)
    if ticker in THEME_DANGER["D_SEMI"]:
        out["D_SEMI"] = out1_ & _lt(body, 0.10 + 1e-9)
    if ticker in THEME_DANGER["D_SKH"]:
        out["D_SKH"] = _gt(h, up1) & ~out1_ & _gt(upw, 0.5 - 1e-9)
    if ticker in THEME_DANGER["D_QUANT"]:
        prev_out = _shift(out1_.astype(float)) > 0.5
        out["D_QUANT"] = ~out1_ & prev_out & (_shift(run1.astype(float)) >= 2)

    # ── 신호 보드 4분류 (SIGNAL_CODES) ──
    o2_, c2_, b1_, b2_ = _shift(o, 2), _shift(c, 2), _shift(body), _shift(body, 2)
    l1_, h1_, h2_ = _shift(l), _shift(h), _shift(h, 2)
    rng_all = h - l
    tr2 = np.maximum(h - l, np.maximum(abs(h - c1), abs(l - c1)))
    atr14 = pd.Series(tr2).rolling(14).mean().to_numpy()
    long_bear = _lt(c, o) & _gt(body, 0.6 - 1e-9) & _gt(rng_all, 1.5 * atr14)
    up_day = _gt(c, c1)
    # 🟢 반등 (최근 20일 안 과매도 rec 맥락)
    lowc10 = s.rolling(10).min().to_numpy(); lowc_prev = s.shift(10).rolling(20).min().to_numpy()
    rr = pd.Series(np.nan_to_num(r14, nan=50))
    lowr10 = rr.rolling(10).min().to_numpy(); lowr_prev = rr.shift(10).rolling(20).min().to_numpy()
    out["B_DIVUP"] = rec & _lt(lowc10, lowc_prev) & _gt(lowr10, lowr_prev) & up_day
    out["B_ENGULF"] = rec & _lt(c1, o1) & _gt(c, o) & _gt(c, o1) & _lt(o, c1)
    out["B_HAMMER"] = _lt(l, bblo * 1.01) & _gt(loww, 0.6 - 1e-9) & _lt(body, 0.3 + 1e-9) & _lt(upw, 0.15 + 1e-9) & _lt(r14, 40 + 1e-9)
    out["B_MSTAR"] = rec & _lt(c2_, o2_) & _gt(b2_, 0.6 - 1e-9) & _lt(b1_, 0.3 + 1e-9) & _lt(np.maximum(o1, c1), c2_ * 1.005) \
        & _gt(c, o) & _gt(c, (o2_ + c2_) / 2)
    out["B_VOLUP"] = rec & _gt(vr, 1.5 - 1e-9) & _gt(c, o) & _gt(c / c1 - 1, 0.02 - 1e-9)
    supp = pd.Series(l).shift(5).rolling(120).min().to_numpy()
    out["B_SUPPORT"] = _lt(l, supp * 1.02) & _gt(l, supp * 0.97) & _gt(c, o) & up_day & _gt(loww, 0.3 - 1e-9)
    # 🔵 추세전환·상승 지속 (과매도 맥락 아님)
    ma60_up = _gt(ma[60], _shift(ma[60], 5))
    out["U_MA20"] = _gt(c, ma[20]) & ~_gt(c1, _shift(ma[20])) & ma60_up & ~rec
    cmax20p = s.shift(1).rolling(20).max().to_numpy()
    out["U_BREAK"] = _gt(c, cmax20p) & _gt(vr, 1.5 - 1e-9) & ~_gt(c1, _shift(cmax20p))
    out["U_G520"] = _gt(ma[5], ma[20]) & ~_gt(_shift(ma[5]), _shift(ma[20])) & ~rec
    out["U_G2060"] = _gt(ma[20], ma[60]) & ~_gt(_shift(ma[20]), _shift(ma[60]))
    near20 = pd.Series(_lt(c, ma[20] * 1.02).astype(float)).rolling(5).max().to_numpy() > 0.5
    out["U_PULL"] = _gt(ma[20], ma[60]) & ma60_up & near20 & _gt(c, ma[20]) & (run5 == 1) & up_day
    # 🟠 단기과열·일부익절
    pctb = (c - bblo) / np.where(bbup - bblo > 0, bbup - bblo, np.nan)
    out["O_RSI"] = _first_in_run(outside & _gt(r14, 70 - 1e-9), outside)
    out["O_EXT"] = _first_in_run(outside & _gt(pctb, 1.25 - 1e-9), outside)
    prev_outside = _shift(outside.astype(float)) > 0.5
    out["O_TURN"] = prev_outside & (_gt(upw, 0.5 - 1e-9) | _lt(c, o))
    vrmax5p = pd.Series(np.nan_to_num(vr)).shift(1).rolling(5).max().to_numpy()
    out["O_VOLSTALL"] = _gt(vrmax5p, 3 - 1e-9) & _lt(c / _shift(c, 5) - 1, 0.01) & _gt(r14, 60 - 1e-9) & _gt(ma[20], _shift(ma[20], 5))
    # 🔴 하락추세·고점 위험
    hh60 = pd.Series(h).rolling(60).max().to_numpy()
    out["X_ESTAR"] = _gt(c2_, o2_) & _gt(b2_, 0.6 - 1e-9) & _lt(b1_, 0.3 + 1e-9) & _gt(np.minimum(o1, c1), c2_ * 0.995) \
        & _lt(c, o) & _lt(c, (o2_ + c2_) / 2) & _gt(h2_, _shift(hh60, 2) * 0.97)
    rmax5 = pd.Series(np.nan_to_num(r14)).rolling(5).max().to_numpy()
    out["X_TOPBEAR"] = long_bear & (_gt(rmax5, 70 - 1e-9) | _gt(h, hh60 * 0.97))
    lmin20p = pd.Series(l).shift(1).rolling(20).min().to_numpy()
    out["X_SUPBREAK"] = _lt(c, lmin20p) & _gt(vr, 1.5 - 1e-9) & ~_lt(c1, _shift(lmin20p))
    rmax20p = rr.shift(1).rolling(20).max().to_numpy()
    out["X_DIVDN"] = _gt(c, cmax20p - 1e-9) & _lt(r14, rmax20p - 3) & _gt(rmax20p, 70 - 1e-9)
    out["X_MA60"] = _lt(c, ma[60]) & ~_lt(c1, _shift(ma[60])) & _lt(ma[20], _shift(ma[20], 5))
    return out


def flags_at(series, i):
    """봉 i(음수 허용)의 코드 문자열. 없으면 ''."""
    return ",".join(k for k in CODES if k in series and bool(series[k][i]))
