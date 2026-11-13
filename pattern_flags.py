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
    # 2026-11-06 사용자 지시 표본 등급 — theme-research 선정 규칙 중 검증·테스트 모두 75%↑, 테스트 5~9건 = '희귀 고적중 후보(소표본)'.
    # 연구 규칙의 '실적 전후 제외(5일)'는 대상(^SOX·SOXX·SOXL)이 전부 실적 없는 ETF(theme-research NO_EARN)라 연구 당시에도 적용되지 않았다.
    # R10_NVDA에는 실적 조건이 없다. 그래서 여기서도·사이트에서도 실적 조건을 걸지 않는다(2026-11-06 정합성 점검).
    "R5_SEMI": ("green", "반도체 5일 반등 매수(희귀 고적중 후보)"),
    "R10_NVDA": ("green", "엔비디아 10일 반등 매수(희귀 고적중 후보)"),
}
RARE_RULES = {"R5_SEMI": ("SOXL", "SOXX"), "R10_NVDA": ("NVDA",)}

# 연구 후보 캔들 (2026-11-06 사용자 지시 "장족도지·고파동 65~74% 후보는 숨기지 말고 표시").
# 출처 tools/candle-context-lab.py 탐색 격자(run 42214209999): 학습(~2023-10-18)에서 고른 뒤 시험 구간에서도 유지된 2개.
#   K_LLD_UP  장족십자 도지 · 볼밴 상단 근처(pos 0.8~1, 상단 안) · RSI 50~70 — 10일 상승 학습 67%(32) → 시험 74%(24) vs 평소 55%
#   K_HW_UP   고파동 캔들   · 같은 위치·RSI                       — 10일 상승 학습 76%(43) → 시험 65%(27) vs 평소 55%
# 정의는 연구 도구와 같다(볼밴 표본표준편차 ddof=1, RSI ewm(1/14), ATR14 = 실제 진폭 14일 평균). 등급·점수에는 쓰지 않는다(참고 표시).
RESEARCH_CODES = {"K_LLD_UP": "장족십자 도지 · 상단 근처 상승 지속 후보", "K_HW_UP": "고파동 캔들 · 상단 근처 상승 지속 후보",
    # 2026-11-06 사용자 지시 "세 후보 모두 활용하되 기존 매수 점수는 변경하지 마세요"(표시 전용 · 등급·점수에 안 씀)
    #   K_FLAG  상승 깃발 돌파 + 맥락 + 확인 캔들 — tools/chart-pattern-lab.py flag_combo() (run 42221750347: 10일 61% vs 55%, 153건)
    #   K_TOP3  과열 + 거래량 3배 + 볼밴 상단 밖→안 + 전일 저가 이탈 — chart-pattern-lab.py top3_mask() (60일 큰 하락 27% vs 11%, 11건)
    #   K_SV1~3 1년 저점 대비 +100/200/300% 급등 + 거래량 3배 — tools/surge-volume-lab.py surge_tiers() (60일 −25% 40/45/50% vs 34/45/50%)
    "K_FLAG": "상승 깃발 돌파 · 상승 지속 후보", "K_TOP3": "과열 뒤 거래량 폭증·볼밴 복귀·저가 이탈 · 희귀 고점 주의",
    "K_SV1": "1년 +100%↑ 급등 + 거래량 3배", "K_SV2": "1년 +200%↑ 급등 + 거래량 3배", "K_SV3": "1년 +300%↑ 급등 + 거래량 3배"}

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
    **{k: ("research", v) for k, v in RESEARCH_CODES.items()},
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
    # 희귀 고적중 후보 (theme-research rsi_conds·bb_conds·filter_conds와 같은 정의 — 볼밴 모표준편차)
    if ticker in RARE_RULES["R5_SEMI"]:
        r7 = _rsi(c, 7)
        lo30 = s.rolling(30).mean().to_numpy() - 1.5 * s.rolling(30).std(ddof=0).to_numpy()
        out["R5_SEMI"] = _lt(np.fmin(r7, _shift(r7)), 25 + 1e-9) & (_runlen(_lt(c, lo30)) >= 3)
    if ticker in RARE_RULES["R10_NVDA"]:
        r9 = _rsi(c, 9)
        lo10 = s.rolling(10).mean().to_numpy() - 1.5 * s.rolling(10).std(ddof=0).to_numpy()
        o10 = _lt(c, lo10); prev_run = np.concatenate([[0], _runlen(o10)[:-1]])
        out["R10_NVDA"] = _lt(np.fmin(r9, _shift(r9)), 35 + 1e-9) & ~o10 & (prev_run >= 1) & _gt(c, o)
    out.update(research_candles(o, h, l, c))
    out.update(research_patterns(o, h, l, c, v))
    return out


def _ctx_rsi_band(c):
    """연구 도구(candle-context-lab)와 같은 RSI(ewm 1/14)·볼밴(20, 표본표준편차 2σ) 상단."""
    d = np.diff(c, prepend=c[0])
    au = pd.Series(np.clip(d, 0, None)).ewm(alpha=1 / 14, adjust=False).mean().to_numpy()
    ad = pd.Series(np.clip(-d, 0, None)).ewm(alpha=1 / 14, adjust=False).mean().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        R = 100 - 100 / (1 + au / np.where(ad == 0, np.nan, ad))
    m = pd.Series(c).rolling(20).mean().to_numpy(); sd = pd.Series(c).rolling(20).std().to_numpy()
    return R, m + 2 * sd


def research_patterns(o, h, l, c, v):
    """K_FLAG · K_TOP3 · K_SV1~3 — 대조: tools/test_pattern_flags.py (chart-pattern-lab·surge-volume-lab 함수와 봉 단위 비교)."""
    N = len(c); R, up = _ctx_rsi_band(c)
    with np.errstate(invalid="ignore"):
        out_up = np.nan_to_num(c > up).astype(bool)
        rng = h - l; body = np.abs(c - o) / np.where(rng > 0, rng, np.nan)
        bullc = np.nan_to_num((c > o) & (body >= 0.5)).astype(bool)
    # ① 상승 깃발: 깃대 10봉 +15%↑ → 5~15봉 깃발(깃대 고가 +1% 넘지 않음 · 깃대 상승분 절반 넘게 안 밀림) → 깃발 최고가 첫 상향 돌파
    flag = np.zeros(N, bool)
    for i in range(7, N):
        for fl in range(5, 16):
            p = i - 1 - fl
            if p < 11: break
            if c[p] / c[p - 10] - 1 < 0.15: continue
            seg_h, seg_l = h[p + 1:i].max(), l[p + 1:i].min()
            if seg_h <= h[p] * 1.01 and (c[p] - seg_l) <= 0.5 * (c[p] - c[p - 10]) and c[i] > seg_h and c[i - 1] <= seg_h:
                flag[i] = True; break
    Rn = np.nan_to_num(R, nan=50)
    k_flag = flag & (Rn < 70) & ~out_up & bullc
    # ② 고점 3중: 과열 맥락(최근 10일 RSI≥70 · 52주 고가 5% 안 · 60일 급등 ≥ max(30%, 8u)) ∧ 직전 5일 거래량 3배 ∧ 상단 밖→안 ∧ 종가<전일 저가
    u = pd.Series((h - l) / c).rolling(60).median().to_numpy()
    vs = pd.Series(v).rolling(20).mean().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        vr = v / np.where(vs > 0, vs, np.nan)
    # 52주 고가 = 최근 1년(250봉, 국장은 1년치 ≈245봉) — 240봉 미만 종목은 52주 조건에서 뺀다(2026-11-06 검토 "120봉을 52주라 부르지 말 것")
    hi250 = pd.Series(h).rolling(250, min_periods=240).max().to_numpy(); rmax10 = pd.Series(R).rolling(10).max().to_numpy()
    top3 = np.zeros(N, bool)
    for i in range(61, N):          # 사이트는 1년치(약 250봉)만 받는다 → 지표가 계산되는 봉부터(연구 집계는 260봉부터였다)
        if np.isnan(u[i]) or np.isnan(hi250[i - 1]): continue
        run = c[i] / l[i - 60:i + 1].min() - 1
        if not (rmax10[i] >= 70 and c[i] >= 0.95 * hi250[i - 1] and run >= max(0.30, 8 * u[i])): continue
        top3[i] = bool(np.nanmax(vr[i - 5:i]) >= 3) and bool(out_up[i - 1] and not out_up[i]) and c[i] < l[i - 1]
    # ③ 급등 + 거래량: 1년(250봉) 최저가 대비 급등 등급 ∧ 오늘 포함 5일 안 거래량이 직전 20일 평균의 3배↑
    vs1 = pd.Series(v).shift(1).rolling(20).mean().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        vr1 = v / np.where(vs1 > 0, vs1, np.nan); surge = c / pd.Series(l).rolling(250, min_periods=240).min().to_numpy() - 1   # 1년 저가 · 국장 1년 ≈ 245봉 · 240봉 미만은 판정 안 함
    v3 = pd.Series(np.nan_to_num(vr1) >= 3).astype(float).rolling(5).max().to_numpy() > 0
    ok = v3 & ~np.isnan(surge); s_ = np.nan_to_num(surge, nan=-1)
    return {"K_FLAG": k_flag, "K_TOP3": top3, "K_SV1": ok & (s_ >= 1) & (s_ < 2), "K_SV2": ok & (s_ >= 2) & (s_ < 3), "K_SV3": ok & (s_ >= 3)}


def research_candles(o, h, l, c):
    """연구 후보 K_LLD_UP · K_HW_UP — tools/candle-context-lab.py features()와 같은 식(대조: tools/test_pattern_flags.py)."""
    N = len(c); r = h - l; rr = np.where(r > 0, r, np.nan)
    body = np.abs(c - o) / rr; uw = (h - np.maximum(o, c)) / rr; lw = (np.minimum(o, c) - l) / rr
    pc = np.r_[np.nan, c[:-1]]
    tr_ = np.maximum.reduce([h - l, np.abs(h - pc), np.abs(l - pc)]); atr = pd.Series(tr_).rolling(14).mean().to_numpy()
    with np.errstate(invalid="ignore"):
        big = r >= 1.3 * atr
        lld = (body <= 0.1) & (uw >= 0.3) & (lw >= 0.3) & big
        hw = (body > 0.1) & (body <= 0.3) & (uw >= 0.3) & (lw >= 0.3) & big
        m = pd.Series(c).rolling(20).mean().to_numpy(); sd = pd.Series(c).rolling(20).std().to_numpy()
        up, lo = m + 2 * sd, m - 2 * sd; pos = (c - lo) / (up - lo)
        near_up = (pos >= 0.8) & (c <= up)
        d = np.diff(c, prepend=c[0]); au = pd.Series(np.clip(d, 0, None)).ewm(alpha=1 / 14, adjust=False).mean().to_numpy()
        ad = pd.Series(np.clip(-d, 0, None)).ewm(alpha=1 / 14, adjust=False).mean().to_numpy()
        R = 100 - 100 / (1 + au / np.where(ad == 0, np.nan, ad))
        rmid = (R > 50) & (R < 70)
    f = lambda x: np.nan_to_num(np.asarray(x, float)) > 0
    return {"K_LLD_UP": f(lld) & f(near_up) & f(rmid), "K_HW_UP": f(hw) & f(near_up) & f(rmid)}


def flags_at(series, i):
    """봉 i(음수 허용)의 코드 문자열. 없으면 ''."""
    return ",".join(k for k in CODES if k in series and bool(series[k][i]))


# ── 고점 위험 3단계 경고 (2026-11-10 사용자 지시 · NVDA 차트 관찰 동기) ─────────────────
# 표시 전용 — 점수·등급·강한매수·다중 산식에는 쓰지 않는다. 연구 문서: docs/2026-11-10-peak-risk.md
# 문턱은 이 저장소의 기존 정의를 그대로 쓴다(새 숫자를 만들지 않음):
#   윗꼬리 ≥ 범위 50%  — C_UPW·O_TURN·D_SKH(고가만 상단 돌파 + 긴 윗꼬리)와 같은 기준
#   고가 %B ≥ 1.0     — main.py bb_hi_pos(고가의 볼린저 위치, 100 초과 = 고가가 상단 밖)·D_SKH와 같은 기준
#   석별형            — 위 flag_series의 X_ESTAR 그대로(큰 양봉 몸통≥60% → 별 몸통≤30% · 첫 봉 종가 근처 위 → 음봉이 첫 봉 몸통 중간 아래 마감 · 60일 고점 97% 안)
#   단기 지지         — 경고일 기준 최근 스윙 저점(좌우 2봉보다 낮은 저가 · 경고일 직전 20봉 안의 가장 최근 것),
#                       없으면 main.py sup_short와 같은 '직전 20봉 최저가'. 경고일에 고정하고 이후 값으로 바꾸지 않는다.
PEAK_UPW, PEAK_BBHI, PEAK_NEED, PEAK_WIN = 0.5, 1.0, 2, 3
PEAK_STAR_CTX = 3      # 석별형 완성일 기준 이 봉 수 안(완성일 포함)에 1단계가 있었어야 2단계
PEAK_BREAK_WIN = 10    # 1·2단계 경고 뒤 이 봉 수 안에 종가가 지지 아래면 3단계
PEAK_SHOW = 5          # 화면: 최근 이 거래일 안의 가장 높은 단계를 대표로 표시


def peak_risk_series(o, h, l, c, estar, upw_min=PEAK_UPW, bbhi_min=PEAK_BBHI):
    """봉마다 단계(0~3)와 그날 고정한 지지선. 입력은 확정 일봉만(오래된 → 최근)."""
    o, h, l, c = (np.asarray(x, dtype=float) for x in (o, h, l, c))
    n = len(c); s = pd.Series(c)
    ma = s.rolling(20).mean().to_numpy(); sd = s.rolling(20).std(ddof=0).to_numpy()
    up, lo = ma + 2 * sd, ma - 2 * sd
    rng = np.where(h - l > 0, h - l, np.nan)
    upw = (h - np.maximum(o, c)) / rng
    pb_hi = (h - lo) / np.where(up - lo > 0, up - lo, np.nan)
    q = _gt(upw, upw_min - 1e-9) & _gt(pb_hi, bbhi_min - 1e-9)
    cnt = pd.Series(q.astype(float)).rolling(PEAK_WIN, min_periods=PEAK_WIN).sum().to_numpy()
    s1 = np.nan_to_num(cnt) >= PEAK_NEED
    estar = np.asarray(estar, dtype=bool)
    s1ctx = pd.Series(s1.astype(float)).rolling(PEAK_STAR_CTX + 1, min_periods=1).max().to_numpy() > 0.5
    s2 = estar & s1ctx
    sup = np.full(n, np.nan); src = [""] * n
    for t in np.nonzero(s1 | s2)[0]:
        lo_win = max(0, t - 20)
        piv = [j for j in range(max(lo_win, 2), t - 1) if l[j] < l[j - 1] and l[j] < l[j - 2] and l[j] < l[j + 1] and l[j] < l[j + 2] and l[j] < c[t]]
        if piv:
            sup[t], src[t] = l[piv[-1]], "스윙 저점"
        elif t >= 20:
            v = float(np.min(l[t - 20:t]))
            if v < c[t]: sup[t], src[t] = v, "20일 최저가"
    stage = np.where(s2, 2, np.where(s1, 1, 0)).astype(int)
    brk = np.full(n, np.nan); bsrc = [""] * n; wday = np.full(n, -1)
    last_w = -10 ** 9
    for t in range(n):
        if t - last_w <= PEAK_BREAK_WIN and t > last_w and np.isfinite(sup[last_w]) and c[t] < sup[last_w]:
            stage[t] = 3; brk[t] = sup[last_w]; bsrc[t] = src[last_w]; wday[t] = last_w
        if s1[t] or s2[t]:
            last_w = t
    return {"stage": stage, "q": q, "s1": s1, "s2": s2, "sup": sup, "sup_src": src, "brk": brk, "brk_src": bsrc, "warn_day": wday, "upw": upw, "pb_hi": pb_hi}


def peak_risk_now(ps, dates, c, show=PEAK_SHOW):
    """화면용 요약 — 최근 show 거래일 안의 가장 높은 단계(같으면 가장 최근). 없으면 None."""
    st = ps["stage"]; n = len(st)
    if not n: return None
    lo = max(0, n - show)
    best = max(range(lo, n), key=lambda t: (st[t], t))
    if st[best] == 0: return None
    t = best
    out = {"stage": int(st[t]), "date": dates[t], "ago": int(n - 1 - t),
           "wick_days": [dates[j] for j in range(max(0, t - PEAK_WIN + 1), t + 1) if ps["q"][j]] if st[t] >= 1 else []}
    if st[t] == 2:
        out["star_dates"] = [dates[j] for j in (t - 2, t - 1, t) if j >= 0]
    if st[t] == 3:
        w = int(ps["warn_day"][t])
        out.update({"support": float(ps["brk"][t]), "support_src": ps["brk_src"][t], "close": float(c[t]),
                    "warn_date": dates[w] if w >= 0 else None, "warn_stage": int(ps["stage"][w]) if w >= 0 else None})
    elif np.isfinite(ps["sup"][t]):
        out.update({"support": float(ps["sup"][t]), "support_src": ps["sup_src"][t]})
    return out


# ══ 🔬 고점판독기(실험실) 조건 — docs/2026-11-12-peak-reader.md (사전 등록 정의 그대로) ══
# 한 곳 정의: 연구(tools/peak-reader-lab.py)와 화면 데이터(main.py → signals.json peak_reader)가 함께 쓴다.
# 모두 그날까지의 확정 일봉만 쓴다(롤링·과거 이동만 · 미래 참조 없음). 등급·점수·판정에는 쓰지 않는다.
PR_GROUPS = {
    "EXT": "과열", "RSI_HOT": "과열", "BB_WICK": "과열",
    "RSI_DIV": "약화", "MACD_FADE": "약화", "MACD_DEAD": "약화", "STOCH_DEAD": "약화", "FAIL_HIGH": "약화",
    "SHOOT": "캔들", "HANG": "캔들", "ESTAR": "캔들",
    "VOL_BEAR": "거래량", "VOL_STALL": "거래량",
    "MA20_BRK": "이탈", "MA60_BRK": "이탈", "SUP_BRK": "이탈", "STAGE3": "이탈",
}
PR_NAMES = {
    "EXT": "20일선 대비 과열(이격 25%↑)", "RSI_HOT": "RSI 75 이상", "BB_WICK": "볼밴 상단 밖 윗꼬리 반복",
    "RSI_DIV": "RSI 약세 다이버전스", "MACD_FADE": "MACD 상승 힘 3일 연속 감소", "MACD_DEAD": "고점권 MACD 데드크로스",
    "STOCH_DEAD": "스토캐스틱 과열권 데드크로스", "FAIL_HIGH": "전 고점 돌파 실패(쌍봉형)",
    "SHOOT": "고점권 유성형", "HANG": "고점권 교수형", "ESTAR": "석별형",
    "VOL_BEAR": "고점권 대량 음봉", "VOL_STALL": "거래량 폭증 뒤 상승 정체",
    "MA20_BRK": "20일선 첫 이탈", "MA60_BRK": "60일선 첫 이탈", "SUP_BRK": "고점권 지지선 붕괴", "STAGE3": "단기 지지 붕괴(현행 3단계)",
}


def _ema(a, n):
    return pd.Series(a).ewm(span=n, adjust=False).mean().to_numpy().copy()


def peak_reader_flags(o, h, l, c, v, lev=1.0, ticker=""):
    """봉마다 조건 → bool 배열 + RUN(급등 국면). 입력은 확정 일봉(오래된 → 최근)."""
    o, h, l, c, v = (np.asarray(x, dtype=float) for x in (o, h, l, c, v))
    n = len(c); s = pd.Series(c)
    ma20, ma60 = s.rolling(20).mean().to_numpy(), s.rolling(60).mean().to_numpy()
    lo120 = s.rolling(120, min_periods=120).min().to_numpy()
    hh60 = pd.Series(h).rolling(60).max().to_numpy()
    rng = np.where(h - l > 0, h - l, np.nan)
    upw, loww, body = (h - np.maximum(o, c)) / rng, (np.minimum(o, c) - l) / rng, np.abs(c - o) / rng
    r14 = _rsi(c, 14)
    vma = pd.Series(v).rolling(20).mean().to_numpy()
    near_hi = _gt(h, hh60 * 0.97 - 1e-12)
    out = {}
    out["RUN"] = _gt(c, lo120 * 1.5 - 1e-12) & _gt(c, hh60 * 0.85 - 1e-12)
    # 과열
    out["EXT"] = _gt((c / ma20 - 1) / max(lev, 1.0), 0.25 - 1e-12)
    out["RSI_HOT"] = _gt(r14, 75 - 1e-9)
    fs = flag_series(o, h, l, c, v, ticker)
    ps = peak_risk_series(o, h, l, c, fs["X_ESTAR"])
    out["BB_WICK"] = np.asarray(ps["s1"], dtype=bool)
    # 약화
    hh20p = pd.Series(h).shift(1).rolling(20).max().to_numpy()
    rmax20p = pd.Series(r14).shift(1).rolling(20).max().to_numpy()
    out["RSI_DIV"] = _gt(h, hh20p - 1e-12) & _gt(rmax20p, 70 - 1e-9) & _lt(r14, rmax20p - 5)
    macd = _ema(c, 12) - _ema(c, 26); sig = _ema(macd, 9).copy(); hist = (macd - sig).copy(); macd = macd.copy()
    if n > 35:
        macd[:34] = np.nan; sig[:34] = np.nan; hist[:34] = np.nan
    cc20 = s.rolling(20).max().to_numpy()
    out["MACD_FADE"] = _gt(hist, 0) & _lt(hist, _shift(hist)) & _lt(_shift(hist), _shift(hist, 2)) & _lt(_shift(hist, 2), _shift(hist, 3)) & _gt(c, cc20 * 0.97 - 1e-12)
    hh10 = pd.Series(h).rolling(10).max().to_numpy()
    out["MACD_DEAD"] = _lt(macd, sig) & ~_lt(_shift(macd), _shift(sig)) & np.isfinite(_shift(macd)) & _gt(hh10, hh60 * 0.97 - 1e-12)
    ll14, hh14 = pd.Series(l).rolling(14).min().to_numpy(), pd.Series(h).rolling(14).max().to_numpy()
    kraw = 100 * (c - ll14) / np.where(hh14 - ll14 > 0, hh14 - ll14, np.nan)
    k = pd.Series(kraw).rolling(3).mean().to_numpy(); d = pd.Series(k).rolling(3).mean().to_numpy()
    out["STOCH_DEAD"] = _lt(k, d) & ~_lt(_shift(k), _shift(d)) & _gt(_shift(k), 80 - 1e-9)
    # 전 고점(10~60봉 전 구간 최고) 근처까지 왔다가 돌파 못 하고 밀림
    prev_hi = pd.Series(h).shift(10).rolling(51).max().to_numpy()
    hh10b = pd.Series(h).rolling(10).max().to_numpy()
    out["FAIL_HIGH"] = _gt(hh10b, prev_hi * 0.97 - 1e-12) & _lt(hh10b, prev_hi * 1.01 + 1e-12) & _lt(c, prev_hi * 0.97) & _gt(prev_hi, 0)
    # 캔들
    out["SHOOT"] = _gt(upw, 0.6 - 1e-9) & _lt(body, 0.3 + 1e-9) & _lt(loww, 0.15 + 1e-9) & near_hi
    out["HANG"] = _gt(loww, 0.6 - 1e-9) & _lt(body, 0.3 + 1e-9) & _lt(upw, 0.15 + 1e-9) & near_hi
    out["ESTAR"] = np.asarray(fs["X_ESTAR"], dtype=bool)
    # 거래량
    out["VOL_BEAR"] = _lt(c, o) & _gt(body, 0.5 - 1e-9) & _gt(v, vma * 2 - 1e-9) & near_hi
    out["VOL_STALL"] = np.asarray(fs["O_VOLSTALL"], dtype=bool)
    # 이탈
    above20 = _gt(c, ma20); above60 = _gt(c, ma60)
    run20 = pd.Series(_shift(above20.astype(float))).rolling(10).sum().to_numpy()
    run60 = pd.Series(_shift(above60.astype(float))).rolling(20).sum().to_numpy()
    out["MA20_BRK"] = _lt(c, ma20) & _gt(run20, 9.5)
    out["MA60_BRK"] = _lt(c, ma60) & _gt(run60, 19.5)
    hh15 = pd.Series(h).rolling(15).max().to_numpy()
    out["SUP_BRK"] = np.asarray(fs["X_SUPBREAK"], dtype=bool) & _gt(hh15, hh60 * 0.9 - 1e-12)
    out["STAGE3"] = np.asarray(ps["stage"]) == 3
    out["_aux"] = {"rsi": r14, "macd_hist": hist, "stoch_k": k, "ma20": ma20, "ma60": ma60, "hh60": hh60, "lo120": lo120, "upw": upw, "pb_hi": ps["pb_hi"]}
    return out


def peak_reader_now(fl, dates, c, stats=None, win=5):
    """화면용: 오늘 RUN 여부 · 최근 win 거래일 안에 켜진 조건(가장 최근 날짜) · 오늘 보조 수치. stats(검증 결과)는 화면이 따로 읽는다."""
    n = len(c)
    if not n: return None
    t = n - 1
    lo = max(0, n - win)
    on = {}
    for code in PR_GROUPS:
        a = fl.get(code)
        if a is None: continue
        hits = [j for j in range(lo, n) if a[j]]
        if hits: on[code] = dates[hits[-1]]
    ax = fl["_aux"]
    f = lambda x: None if x is None or not np.isfinite(x) else round(float(x), 2)
    return {"date": dates[t], "run": bool(fl["RUN"][t]), "run_recent": bool(np.any(fl["RUN"][lo:n])),
            "on": on, "rsi": f(ax["rsi"][t]), "hh60": f(ax["hh60"][t]), "lo120": f(ax["lo120"][t]),
            "ma20": f(ax["ma20"][t]), "ma60": f(ax["ma60"][t]), "up120": f(c[t] / ax["lo120"][t] - 1) if np.isfinite(ax["lo120"][t]) and ax["lo120"][t] > 0 else None}


# ══ 🔬 고점판독기 2차 — 위험 캔들 · 52주 위치 · %B (docs/2026-11-12-peak-reader.md '2차 연구') ══
# 캔들 문턱은 화면 캔들 분류(index.html todayShape)와 같다. 그날까지의 값만 쓴다.
RC_NAMES = {"ESTAR": "석별형", "SHOOTS": "유성형", "HANGS": "교수형", "TOP": "팽이·도지", "UPW": "윗꼬리(50%↑)", "BIGBEAR": "장대음봉"}
POS52_BUCKETS = [("0~5", -0.05, 1e9), ("5~10", -0.10, -0.05), ("10~20", -0.20, -0.10), ("20+", -1e9, -0.20)]


def risk_candle_flags(o, h, l, c, v, ticker=""):
    o, h, l, c, v = (np.asarray(x, dtype=float) for x in (o, h, l, c, v))
    rng = np.where(h - l > 0, h - l, np.nan)
    upw, loww, body = (h - np.maximum(o, c)) / rng, (np.minimum(o, c) - l) / rng, np.abs(c - o) / rng
    avg14 = pd.Series(h - l).rolling(14).mean().to_numpy()
    fs = flag_series(o, h, l, c, v, ticker)
    out = {
        "ESTAR": np.asarray(fs["X_ESTAR"], dtype=bool),
        "SHOOTS": _gt(upw, 0.6 - 1e-9) & _lt(body, 0.3 + 1e-9) & _lt(loww, 0.15 + 1e-9),
        "HANGS": _gt(loww, 0.6 - 1e-9) & _lt(body, 0.3 + 1e-9) & _lt(upw, 0.15 + 1e-9),
        "TOP": _lt(body, 0.3 + 1e-9) & _gt(upw, 0.2 - 1e-9) & _gt(loww, 0.2 - 1e-9),
        "UPW": _gt(upw, 0.5 - 1e-9),
        "BIGBEAR": _lt(c, o) & _gt(body, 0.6 - 1e-9) & _gt(h - l, avg14 * 1.3 - 1e-12),
    }
    s = pd.Series(c)
    ma, sd = s.rolling(20).mean().to_numpy(), s.rolling(20).std(ddof=0).to_numpy()
    up, lo = ma + 2 * sd, ma - 2 * sd
    pb = (c - lo) / np.where(up - lo > 0, up - lo, np.nan)
    hh252 = pd.Series(h).rolling(252, min_periods=252).max().to_numpy()   # 252봉 미만 = 52주 고점 판정 보류(NaN)
    pos52 = c / hh252 - 1
    return out, pb, pos52


def pos52_bucket(x):
    if x is None or not np.isfinite(x): return None
    for name, lo_, hi_ in POS52_BUCKETS:
        if lo_ <= x < hi_ or (name == "0~5" and x >= -0.05): return name
    return None


# ══ 고점 터치 후 종가 급락(고점 돌파 실패) — docs/2026-11-12-peak-touch-fail.md 사전 등록 정의 ══
def touch_fail_flags(o, h, l, c, v, lev=1.0, ticker=""):
    o, h, l, c, v = (np.asarray(x, dtype=float) for x in (o, h, l, c, v))
    s = pd.Series(c)
    h52p = pd.Series(h).shift(1).rolling(251, min_periods=251).max().to_numpy()   # 그날 제외 이전 251봉
    p52h = h / h52p - 1
    p52c = c / np.fmax(h52p, h) - 1
    ma, sd = s.rolling(20).mean().to_numpy(), s.rolling(20).std(ddof=0).to_numpy()
    up, lo = ma + 2 * sd, ma - 2 * sd
    den = np.where(up - lo > 0, up - lo, np.nan)
    pbh, pbc = (h - lo) / den, (c - lo) / den
    rng = np.where(h - l > 0, h - l, np.nan)
    upw = (h - np.maximum(o, c)) / rng
    cpos = (c - l) / rng
    chg = (c / _shift(c) - 1) / max(lev, 1.0)
    T = _gt(p52h, -0.02 - 1e-12) & _gt(pbh, 1.0 - 1e-9)
    W = _gt(upw, 0.5 - 1e-9)
    L = _lt(cpos, 0.3 + 1e-9)
    D = _lt(chg, -0.03 + 1e-12)
    fl = peak_reader_flags(o, h, l, c, v, lev=lev, ticker=ticker)
    m1 = np.asarray(fl["RSI_DIV"], bool) | np.asarray(fl["MACD_FADE"], bool) | np.asarray(fl["STOCH_DEAD"], bool)
    M = pd.Series(m1.astype(float)).rolling(3, min_periods=1).max().to_numpy() > 0.5
    BW = T & _gt(cpos, 0.7 - 1e-9) & ~_lt(c, _shift(c))
    TF = T & W & (L | D)
    ok = np.isfinite(h52p)
    z = lambda a: np.asarray(a, bool) & ok
    return {"T": z(T), "TF": z(TF), "TF_M": z(TF & M), "T_W": z(T & W), "T_L": z(T & L), "T_D": z(T & D), "BW": z(BW),
            "_aux": {"p52h": p52h, "p52c": p52c, "pbh": pbh, "pbc": pbc, "upw": upw, "cpos": cpos, "chg": chg}}


def risk_candle_now(o, h, l, c, v, fl, dates, win=5, ticker=""):
    """화면용(고점판독기 위험 캔들 참고): 최근 win 거래일 안 마지막 발생일과 그날의 52주 위치(종가)·%B(종가). 252봉 미만이면 위치 None."""
    rc, pb, p52 = risk_candle_flags(o, h, l, c, v, ticker)
    # 화면 전용 보정(2026-11-12): main.py는 야후 1y(250~252봉)를 받는데 연구 정의는 252봉을 꽉 채워야 해서, 251봉인 날은 전 종목이
    # '판정 보류(1년 미만)'가 됐다. 240봉 이상이면 받은 범위의 최고 고가로 52주 위치를 낸다(사이트 high_52w와 같은 범위).
    # 진짜 1년 미만 상장(240봉 미만)은 그대로 보류. 연구 도구가 쓰는 risk_candle_flags 정의는 바꾸지 않는다.
    if len(c) >= 240 and not np.isfinite(p52[len(c) - 1]):
        hh = pd.Series(np.asarray(h, dtype=float)).rolling(252, min_periods=240).max().to_numpy()
        p52 = np.asarray(c, dtype=float) / hh - 1
    sig = dict(rc)
    for k in ("RSI_DIV", "MACD_FADE", "MACD_DEAD", "STOCH_DEAD"):
        if k in fl: sig[k] = np.asarray(fl[k], dtype=bool)
    n = len(c); lo = max(0, n - win); out = {}
    f = lambda x: None if x is None or not np.isfinite(x) else round(float(x), 4)
    for k, a in sig.items():
        hits = [j for j in range(lo, n) if a[j]]
        if hits:
            j = hits[-1]; out[k] = [dates[j], f(p52[j]), f(pb[j])]
    return {"rcx": out, "pos52": f(p52[n - 1]) if n else None, "pb": f(pb[n - 1]) if n else None}


# ══ 5차 교집합 연구의 종목 블록(화면용) — tools/peak-combo-lab.py blocks()와 같은 식 · docs/2026-11-12-peak-combo.md §2 ══
# 외부 블록(X_T 테마 · X_MK 4그룹 · X_BR S&P500 참여 · X_RS 상대강도)은 화면에서 계산하지 않는다 → 그런 조합은 화면 판정 대상에서 뺀다.
COMBO_STOCK_BLOCKS = ("P_NEAR", "P_RT5", "P_H60", "O_BB", "O_BBX", "O_RSI", "O_EXT", "C_W", "C_SHOOT", "C_ESTAR", "C_BEAR", "C_FB",
                      "I_RSID", "I_MACD", "I_STO", "I_VST", "I_VDN", "K_5", "K_20", "K_SUP")


def combo_blocks(o, h, l, c, v, lev=1.0, ticker="", min52=251):
    """봉마다 블록 bool. min52 = 52주 고가에 필요한 이전 봉 수(연구 251 · 화면은 야후 1년치라 240까지 허용)."""
    o, h, l, c, v = (np.asarray(x, dtype=float) for x in (o, h, l, c, v))
    rmx = lambda a, k: pd.Series(np.asarray(a, float)).rolling(k, min_periods=1).max().to_numpy() > 0.5
    fl = peak_reader_flags(o, h, l, c, v, lev=lev, ticker=ticker); rc, pb, _ = risk_candle_flags(o, h, l, c, v, ticker)
    h52p = pd.Series(h).shift(1).rolling(251, min_periods=min52).max().to_numpy(); ok = np.isfinite(h52p)
    s = pd.Series(c); ma20 = s.rolling(20).mean().to_numpy(); up = ma20 + 2 * s.rolling(20).std(ddof=0).to_numpy(); ma5 = s.rolling(5).mean().to_numpy()
    hh60 = pd.Series(h).rolling(60).max().to_numpy(); v5, v20 = pd.Series(v).rolling(5).mean().to_numpy(), pd.Series(v).rolling(20).mean().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        hi52 = np.fmax(h52p, h); TOUCH = ok & (h >= h52p * 0.99)
        rng = np.where(h - l > 0, h - l, np.nan); upw = np.nan_to_num((h - np.maximum(o, c)) / rng, nan=0); pbz = np.nan_to_num(pb, nan=-9)
        B = {"P_NEAR": ok & (c >= hi52 * 0.95), "P_RT5": rmx(TOUCH, 5), "P_H60": np.isfinite(hh60) & (h >= hh60 * 0.97),
             "O_BB": pbz >= 0.8, "O_BBX": np.isfinite(up) & (h > up), "O_RSI": rmx(fl["RSI_HOT"], 3), "O_EXT": rmx(fl["EXT"], 3),
             "C_W": upw >= 0.5, "C_SHOOT": np.asarray(rc["SHOOTS"], bool), "C_ESTAR": np.asarray(rc["ESTAR"], bool), "C_BEAR": np.asarray(rc["BIGBEAR"], bool),
             "C_FB": ok & (h >= h52p) & (c < h52p),
             "I_RSID": rmx(fl["RSI_DIV"], 3), "I_MACD": rmx(np.asarray(fl["MACD_FADE"], bool) | np.asarray(fl["MACD_DEAD"], bool), 3), "I_STO": rmx(fl["STOCH_DEAD"], 3),
             "I_VST": rmx(fl["VOL_STALL"], 3), "I_VDN": v5 < v20,
             "K_5": (c < _shift(l)) & (c < ma5), "K_20": np.asarray(fl["MA20_BRK"], bool), "K_SUP": np.asarray(fl["SUP_BRK"], bool)}
    return {k: np.asarray(a, bool) for k, a in B.items()}


VS3_K = 1.6   # 2026-11-13 거래량 정밀 연구 고원(1.4~1.8배)의 가운데 · docs/2026-11-13-peak-volume-precise.md


def vol_stage3(o, h, l, c, v, lev=1.0, ticker="", min52=251, k=VS3_K, parts=False):
    """연구 조합 '52주 고가 5% 안 ∩ 단기 지지 붕괴(현행 3단계) ∩ 5일 누적 거래량 k배↑(앞 20일 기준)' — 봉마다 bool.
    P_NEAR는 combo_blocks와 같은 정의, STAGE3는 peak_reader_flags, 5일 누적은 tools/peak-combo-lab.py vol2_blocks와 같은 정의
    (평가 5일을 뺀 D−24~D−5 일평균). 52주 칸은 이전 min52봉이 있어야 한다(없으면 False)."""
    o, h, l, c, v = (np.asarray(x, dtype=float) for x in (o, h, l, c, v))
    fl = peak_reader_flags(o, h, l, c, v, lev=lev, ticker=ticker)
    h52p = pd.Series(h).shift(1).rolling(251, min_periods=min52).max().to_numpy(); ok = np.isfinite(h52p)
    V = pd.Series(v)
    with np.errstate(invalid="ignore", divide="ignore"):
        r20 = np.nan_to_num(V.rolling(5).sum().to_numpy() / (5 * V.shift(5).rolling(20, min_periods=20).mean().to_numpy()), nan=-1)
        pn = ok & (c >= np.fmax(h52p, h) * 0.95)
    st3 = np.asarray(fl["STAGE3"]) == True
    if parts: return {"P_NEAR": pn, "STAGE3": st3, "VR": r20 >= k}
    return pn & st3 & (r20 >= k), ok


def vol_stage3_now(o, h, l, c, v, dates, lev=1.0, ticker="", win=3):
    """화면용: 최근 win 거래일 중 켜진 날 목록 + 52주 판정 가능 여부. 표시 전용(판정·원장 무관)."""
    m, ok = vol_stage3(o, h, l, c, v, lev=lev, ticker=ticker)
    n = len(c); idx = range(max(0, n - win), n)
    return {"days": [str(dates[j]) for j in idx if m[j]], "na": not all(ok[j] for j in idx), "k": VS3_K}


def combo_blocks_now(o, h, l, c, v, dates, lev=1.0, ticker="", win=5):
    """화면용: 최근 win 거래일 각각의 켜진 블록 {날짜: [블록…]}(꺼진 날은 빈 목록) + 판정 보류 블록.
    52주 블록(P_NEAR·P_RT5·C_FB)은 연구와 같은 '이전 251봉'이 있어야 계산한다 — 야후 1년치(약 250봉)면 판정 보류(na)로 둔다.
    조합 판정은 화면(index.html prHlMatch)이 backtest/peak-highlights.json으로만 한다."""
    B = combo_blocks(o, h, l, c, v, lev=lev, ticker=ticker, min52=251)
    n = len(c); na = [k for k in ("P_NEAR", "P_RT5", "C_FB") if n < 252]
    days = {str(dates[j]): [k for k in COMBO_STOCK_BLOCKS if B[k][j] and k not in na] for j in range(max(0, n - win), n)}
    return {"days": days, "na": na}
