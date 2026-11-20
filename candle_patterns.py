"""일본식 캔들 패턴 — OHLC 수치 정의 (사전 등록 docs/2026-11-20-candle-rank.md §1 · 연구 tools/candle-rank-lab.py)

이 모듈 하나가 연구와 (통과 시) 화면용 집계의 **유일한 정의**다. 여기를 고치면 연구 수치가 무효가 된다.
모든 함수는 시간봉(일·주·월)에 무관하다 — 같은 정의를 일봉·주봉·월봉 배열에 그대로 쓴다.

기호 (봉 t):  O H L C · R = H−L · B = |C−O| · U = H − max(O,C) (윗꼬리) · D = min(O,C) − L (아랫꼬리)
             ATR = 직전 14봉(t−14..t−1) 참값범위 단순평균 — 그 봉 자신을 넣지 않는다(장대·고파동 판정이 자기 자신에 끌려가지 않게).
             양봉 C>O · 음봉 C<O
모양 정의에는 '추세' 조건을 넣지 않는다. 같은 모양이 어디서 나왔는지(위치)는 context()로 따로 잰다.
망치형/교수형, 역망치형/유성형처럼 이름이 위치로만 갈리는 것은 모양 하나(HAMMER_SHAPE·INVHAM_SHAPE)로 두고
직전 추세(prior z)로 이름을 붙인다 — NAMES_BY_TREND.
"""
import numpy as np
import pandas as pd

EPS = 1e-12


def sh(a, k):
    """k봉 전 값(앞쪽은 nan)."""
    a = np.asarray(a, float)
    if k == 0: return a
    o = np.full_like(a, np.nan)
    o[k:] = a[:-k]
    return o


def atr_prev(O, H, L, C, n=14):
    pc = sh(C, 1)
    tr = np.nanmax(np.vstack([H - L, np.abs(H - pc), np.abs(L - pc)]), axis=0)
    tr[0] = H[0] - L[0]
    cs = np.concatenate([[0.0], np.cumsum(np.nan_to_num(tr))])
    out = np.full(len(C), np.nan)
    if len(C) > n: out[n:] = (cs[n:len(C)] - cs[:len(C) - n]) / n     # 봉 t = t−n .. t−1 평균
    return out


def parts(O, H, L, C):
    R = H - L
    B = np.abs(C - O)
    U = H - np.maximum(O, C)
    D = np.minimum(O, C) - L
    Rs = np.where(R > EPS, R, np.nan)
    return R, B, U, D, Rs


# ── 패턴 목록: 코드 → (한국어 이름, 봉 수, 교과서 방향, 분류) ──
# 방향: +1 상승형 · −1 하락형 · 0 중립(위치에 따라 해석)
# 분류: rev 반전 · cont 지속 · neu 중립
PATTERNS = {
    # 단일봉
    "LONG_W":   ("장대양봉", 1, +1, "cont"),
    "LONG_B":   ("장대음봉", 1, -1, "cont"),
    "MARU_W":   ("양봉 마루보즈", 1, +1, "cont"),
    "MARU_B":   ("음봉 마루보즈", 1, -1, "cont"),
    "SPIN":     ("팽이형", 1, 0, "neu"),
    "DOJI":     ("십자형 도지", 1, 0, "neu"),
    "LL_DOJI":  ("긴 다리 도지", 1, 0, "neu"),
    "DF_DOJI":  ("잠자리 도지", 1, +1, "rev"),
    "GS_DOJI":  ("비석형 도지", 1, -1, "rev"),
    "HIGHWAVE": ("고파동 캔들", 1, 0, "neu"),
    "HAMMER_SHAPE": ("망치 모양(하락 뒤 망치형 · 상승 뒤 교수형)", 1, 0, "neu"),
    "INVHAM_SHAPE": ("역망치 모양(하락 뒤 역망치형 · 상승 뒤 유성형)", 1, 0, "neu"),
    "BELT_W":   ("상승 띠두르기형", 1, +1, "rev"),
    "BELT_B":   ("하락 띠두르기형", 1, -1, "rev"),
    # 2봉
    "ENG_BULL": ("상승 장악형", 2, +1, "rev"),
    "ENG_BEAR": ("하락 장악형", 2, -1, "rev"),
    "HAR_BULL": ("상승 잉태형", 2, +1, "rev"),
    "HAR_BEAR": ("하락 잉태형", 2, -1, "rev"),
    "HARX_BULL": ("상승 십자 잉태형", 2, +1, "rev"),
    "HARX_BEAR": ("하락 십자 잉태형", 2, -1, "rev"),
    "PIERCE":   ("관통형", 2, +1, "rev"),
    "DARKCLOUD": ("먹구름형", 2, -1, "rev"),
    "TWZ_BOT":  ("족집게(집게형) 바닥", 2, +1, "rev"),
    "TWZ_TOP":  ("족집게(집게형) 천장", 2, -1, "rev"),
    "CTR_BULL": ("상승 반격형", 2, +1, "rev"),
    "CTR_BEAR": ("하락 반격형", 2, -1, "rev"),
    "KICK_BULL": ("상승 차기형", 2, +1, "rev"),
    "KICK_BEAR": ("하락 차기형", 2, -1, "rev"),
    "SEP_BULL": ("상승 갈림길형(분리선)", 2, +1, "cont"),
    "SEP_BEAR": ("하락 갈림길형(분리선)", 2, -1, "cont"),
    "ONNECK":   ("걸침형·투입형(하락 지속)", 2, -1, "cont"),
    # 3봉
    "MSTAR":    ("샛별형", 3, +1, "rev"),
    "ESTAR":    ("석별형", 3, -1, "rev"),
    "MSTAR_DOJI": ("샛별 도지형", 3, +1, "rev"),
    "ESTAR_DOJI": ("석별 도지형", 3, -1, "rev"),
    "ABANDON_BULL": ("상승 버려진 아기형", 3, +1, "rev"),
    "ABANDON_BEAR": ("하락 버려진 아기형", 3, -1, "rev"),
    "3WS":      ("세 백병(적삼병)", 3, +1, "rev"),
    "3BC":      ("흑삼병", 3, -1, "rev"),
    "3IN_UP":   ("상승 세 내부형", 3, +1, "rev"),
    "3IN_DN":   ("하락 세 내부형", 3, -1, "rev"),
    "3OUT_UP":  ("상승 세 외부형", 3, +1, "rev"),
    "3OUT_DN":  ("하락 세 외부형", 3, -1, "rev"),
    "UPGAP2CROW": ("상승 갭 두 까마귀", 3, -1, "rev"),
    "TASUKI_UP": ("상승 타스키 갭", 3, +1, "cont"),
    "TASUKI_DN": ("하락 타스키 갭", 3, -1, "cont"),
    "GAP3_UP":  ("상승 갭 메움 지속형", 3, +1, "cont"),
    "GAP3_DN":  ("하락 갭 메움 지속형", 3, -1, "cont"),
    # 다중봉(5봉)
    "R3M":      ("상승 삼법형", 5, +1, "cont"),
    "F3M":      ("하락 삼법형", 5, -1, "cont"),
    "MATHOLD":  ("매트 홀드형(상승 지속)", 5, +1, "cont"),
}

NAMES_BY_TREND = {"HAMMER_SHAPE": {"down": "망치형", "up": "교수형"}, "INVHAM_SHAPE": {"down": "역망치형", "up": "유성형"}}

# 임계값(사전 고정). 이웃 값 검사(§3 고원)는 연구 도구가 SCALE 0.8·1.25로 비율 임계를 함께 바꿔 다시 잰다.
TH = dict(
    long_body=0.60, long_rng=1.20,      # 장대: B ≥ 0.60R ∧ R ≥ 1.2·ATR
    maru_wick=0.03, maru_rng=1.00,      # 마루보즈: U,D ≤ 3%R ∧ R ≥ 1.0·ATR ∧ B ≥ 0.94R
    small=0.30, doji=0.10,              # 작은 몸통 B ≤ 30%R · 도지 B ≤ 10%R
    spin_wick=0.25,                     # 팽이: 10%R < B ≤ 30%R ∧ U,D ≥ 25%R
    ll_wick=0.30, ll_rng=1.20,          # 긴 다리 도지: 도지 ∧ U,D ≥ 30%R ∧ R ≥ 1.2·ATR
    dfgs_long=0.60, dfgs_short=0.10,    # 잠자리/비석: 도지 ∧ 긴 꼬리 ≥ 60%R ∧ 반대 꼬리 ≤ 10%R
    hw_wick=0.35, hw_rng=1.50,          # 고파동: B ≤ 30%R ∧ U,D ≥ 35%R ∧ R ≥ 1.5·ATR
    ham_ratio=2.0, ham_other=0.10, ham_min=0.05,   # 망치: D ≥ 2B ∧ U ≤ 10%R ∧ 5%R ≤ B ≤ 35%R
    belt_wick=0.03,                     # 띠두르기: 장대 ∧ 시가 쪽 꼬리 ≤ 3%R
    tw_tol=0.10,                        # 족집게: |저가 차| ≤ 0.10·ATR
    ctr_tol=0.10, ctr_gap=0.50,         # 반격형: |C2−C1| ≤ 0.10·ATR ∧ 시가가 전 종가에서 0.5·ATR 이상 반대쪽
    sep_tol=0.10,                       # 갈림길: |O2−O1| ≤ 0.10·ATR
    har_body=0.50,                      # 잉태: B2 ≤ 50%·B1
    neck_tol=0.10,                      # 걸침·투입: C2 ≤ C1 + 0.5·B1 (몸통 절반 못 미침) ∧ C2 ≥ C1 − 0.10·ATR
    m3_body=0.50,                       # 삼법형 가운데 봉: B ≤ 50%·B1
)
RATIO_KEYS = ("long_body", "small", "doji", "spin_wick", "ll_wick", "dfgs_long", "hw_wick", "ham_ratio", "har_body", "m3_body")


def detect(O, H, L, C, scale=1.0):
    """봉 t에서 '완성된' 패턴 → {코드: bool 배열}. 미래 봉을 보지 않는다(t와 그 이전 봉만).
    scale: 비율 임계값(RATIO_KEYS)에 곱하는 배수 — 이웃 값 검사용(1.0 = 사전 고정 값)."""
    O, H, L, C = (np.asarray(x, float) for x in (O, H, L, C))
    th = dict(TH)
    for k in RATIO_KEYS: th[k] = TH[k] * scale
    atr = atr_prev(O, H, L, C)
    R, B, U, D, Rs = parts(O, H, L, C)
    W = C > O; K = C < O
    with np.errstate(invalid="ignore", divide="ignore"):
        b, u, d = B / Rs, U / Rs, D / Rs
        rng = R / atr
    f = lambda x: np.nan_to_num(x, nan=0.0).astype(bool)
    P = {}
    long_ = f((b >= th["long_body"]) & (rng >= th["long_rng"]))
    P["LONG_W"] = long_ & W; P["LONG_B"] = long_ & K
    maru = f((u <= th["maru_wick"]) & (d <= th["maru_wick"]) & (rng >= th["maru_rng"]) & (b >= 1 - 2 * th["maru_wick"]))
    P["MARU_W"] = maru & W; P["MARU_B"] = maru & K
    doji = f(b <= th["doji"])
    small = f(b <= th["small"])
    P["SPIN"] = f((b > th["doji"]) & (b <= th["small"]) & (u >= th["spin_wick"]) & (d >= th["spin_wick"]))
    P["LL_DOJI"] = doji & f((u >= th["ll_wick"]) & (d >= th["ll_wick"]) & (rng >= th["ll_rng"]))
    P["DF_DOJI"] = doji & f((d >= th["dfgs_long"]) & (u <= th["dfgs_short"]))
    P["GS_DOJI"] = doji & f((u >= th["dfgs_long"]) & (d <= th["dfgs_short"]))
    P["DOJI"] = doji & ~P["LL_DOJI"] & ~P["DF_DOJI"] & ~P["GS_DOJI"]      # 일반 도지(특수 도지 제외)
    P["HIGHWAVE"] = small & f((u >= th["hw_wick"]) & (d >= th["hw_wick"]) & (rng >= th["hw_rng"]))
    P["HAMMER_SHAPE"] = f((D >= th["ham_ratio"] * B) & (u <= th["ham_other"]) & (b >= th["ham_min"]) & (b <= th["small"] + 0.05))
    P["INVHAM_SHAPE"] = f((U >= th["ham_ratio"] * B) & (d <= th["ham_other"]) & (b >= th["ham_min"]) & (b <= th["small"] + 0.05))
    P["BELT_W"] = long_ & W & f(d <= th["belt_wick"])
    P["BELT_B"] = long_ & K & f(u <= th["belt_wick"])

    # 2봉 (1 = 앞 봉, 2 = 지금 봉)
    O1, H1, L1, C1, B1, R1 = sh(O, 1), sh(H, 1), sh(L, 1), sh(C, 1), sh(B, 1), sh(R, 1)
    W1, K1 = f(C1 > O1), f(C1 < O1)
    with np.errstate(invalid="ignore", divide="ignore"):
        b1 = B1 / np.where(R1 > EPS, R1, np.nan)
        long1 = f((b1 >= th["long_body"]) & (R1 / atr >= 1.0))
    nondoji1 = f(b1 > th["doji"])
    P["ENG_BULL"] = K1 & nondoji1 & W & f((O <= C1) & (C >= O1) & (B > B1))
    P["ENG_BEAR"] = W1 & nondoji1 & K & f((O >= C1) & (C <= O1) & (B > B1))
    inside = f((np.maximum(O, C) <= np.maximum(O1, C1)) & (np.minimum(O, C) >= np.minimum(O1, C1)) & (B <= th["har_body"] * B1))
    P["HAR_BULL"] = long1 & K1 & inside & ~doji
    P["HAR_BEAR"] = long1 & W1 & inside & ~doji
    P["HARX_BULL"] = long1 & K1 & inside & doji
    P["HARX_BEAR"] = long1 & W1 & inside & doji
    mid1 = (O1 + C1) / 2
    P["PIERCE"] = long1 & K1 & W & f((O < C1) & (C > mid1) & (C < O1))
    P["DARKCLOUD"] = long1 & W1 & K & f((O > C1) & (C < mid1) & (C > O1))
    P["TWZ_BOT"] = K1 & W & f(np.abs(L - L1) <= th["tw_tol"] * atr)
    P["TWZ_TOP"] = W1 & K & f(np.abs(H - H1) <= th["tw_tol"] * atr)
    P["CTR_BULL"] = long1 & K1 & W & f((O <= C1 - th["ctr_gap"] * atr) & (np.abs(C - C1) <= th["ctr_tol"] * atr))
    P["CTR_BEAR"] = long1 & W1 & K & f((O >= C1 + th["ctr_gap"] * atr) & (np.abs(C - C1) <= th["ctr_tol"] * atr))
    maru1 = sh(maru.astype(float), 1) > 0.5
    P["KICK_BULL"] = maru1 & K1 & maru & W & f(L > H1)
    P["KICK_BEAR"] = maru1 & W1 & maru & K & f(H < L1)
    P["SEP_BULL"] = K1 & long_ & W & f(np.abs(O - O1) <= th["sep_tol"] * atr)
    P["SEP_BEAR"] = W1 & long_ & K & f(np.abs(O - O1) <= th["sep_tol"] * atr)
    P["ONNECK"] = long1 & K1 & W & f((O < L1) & (C <= C1 + 0.5 * B1 * 0.5) & (C >= C1 - th["neck_tol"] * atr)) & ~P["PIERCE"]

    # 3봉 (1·2·3 = t−2·t−1·t)
    O2, H2, L2, C2, B2, R2 = O1, H1, L1, C1, B1, R1            # 가운데 봉 = t−1
    Oa, Ha, La, Ca, Ba, Ra = sh(O, 2), sh(H, 2), sh(L, 2), sh(C, 2), sh(B, 2), sh(R, 2)   # 첫 봉 = t−2
    with np.errstate(invalid="ignore", divide="ignore"):
        ba = Ba / np.where(Ra > EPS, Ra, np.nan)
        b2 = B2 / np.where(R2 > EPS, R2, np.nan)
        atr2 = sh(atr, 1)
        longa = f((ba >= th["long_body"]) & (Ra / sh(atr, 2) >= 1.0))
    Wa, Ka = f(Ca > Oa), f(Ca < Oa)
    small2, doji2 = f(b2 <= th["small"]), f(b2 <= th["doji"])
    mida = (Oa + Ca) / 2
    star_dn = f(np.maximum(O2, C2) < Ca)     # 가운데 봉 몸통이 첫 봉 종가 아래(몸통 갭)
    star_up = f(np.minimum(O2, C2) > Ca)
    P["MSTAR"] = longa & Ka & small2 & ~doji2 & star_dn & W & f(C > mida)
    P["ESTAR"] = longa & Wa & small2 & ~doji2 & star_up & K & f(C < mida)
    P["MSTAR_DOJI"] = longa & Ka & doji2 & star_dn & W & f(C > mida)
    P["ESTAR_DOJI"] = longa & Wa & doji2 & star_up & K & f(C < mida)
    P["ABANDON_BULL"] = Ka & doji2 & f((H2 < La) & (H2 < L)) & W
    P["ABANDON_BEAR"] = Wa & doji2 & f((L2 > Ha) & (L2 > H)) & K
    def soldier(Ox, Hx, Lx, Cx, Op, Cp, up):
        Rx = Hx - Lx; Rx = np.where(Rx > EPS, Rx, np.nan)
        with np.errstate(invalid="ignore"):
            if up:
                return f((Cx > Ox) & (np.abs(Cx - Ox) / Rx >= 0.5) & ((Hx - Cx) / Rx <= 0.25) & (Cx > Cp) & (Ox >= np.minimum(Op, Cp)) & (Ox <= np.maximum(Op, Cp)))
            return f((Cx < Ox) & (np.abs(Cx - Ox) / Rx >= 0.5) & ((Cx - Lx) / Rx <= 0.25) & (Cx < Cp) & (Ox >= np.minimum(Op, Cp)) & (Ox <= np.maximum(Op, Cp)))
    with np.errstate(invalid="ignore"):
        first_w = f((Ca > Oa) & (Ba / np.where(Ra > EPS, Ra, np.nan) >= 0.5) & ((Ha - Ca) / np.where(Ra > EPS, Ra, np.nan) <= 0.25))
        first_b = f((Ca < Oa) & (Ba / np.where(Ra > EPS, Ra, np.nan) >= 0.5) & ((Ca - La) / np.where(Ra > EPS, Ra, np.nan) <= 0.25))
    P["3WS"] = first_w & soldier(O2, H2, L2, C2, Oa, Ca, True) & soldier(O, H, L, C, O2, C2, True)
    P["3BC"] = first_b & soldier(O2, H2, L2, C2, Oa, Ca, False) & soldier(O, H, L, C, O2, C2, False)
    harb1 = sh((P["HAR_BULL"] | P["HARX_BULL"]).astype(float), 1) > 0.5
    harr1 = sh((P["HAR_BEAR"] | P["HARX_BEAR"]).astype(float), 1) > 0.5
    P["3IN_UP"] = harb1 & W & f(C > Oa)
    P["3IN_DN"] = harr1 & K & f(C < Oa)
    P["3OUT_UP"] = (sh(P["ENG_BULL"].astype(float), 1) > 0.5) & W & f(C > C2)
    P["3OUT_DN"] = (sh(P["ENG_BEAR"].astype(float), 1) > 0.5) & K & f(C < C2)
    P["UPGAP2CROW"] = longa & Wa & f((C2 < O2) & (np.minimum(O2, C2) > Ca)) & K & f((O > O2) & (C < C2) & (C > Ca))
    W2, K2 = f(C2 > O2), f(C2 < O2)
    P["TASUKI_UP"] = Wa & W2 & f(L2 > Ha) & K & f((O < C2) & (O > O2) & (C < L2) & (C > Ha))
    P["TASUKI_DN"] = Ka & K2 & f(H2 < La) & W & f((O > C2) & (O < O2) & (C > H2) & (C < La))
    P["GAP3_UP"] = Wa & W2 & f(L2 > Ha) & K & f((O < C2) & (O > O2) & (C < Ca) & (C > Oa))
    P["GAP3_DN"] = Ka & K2 & f(H2 < La) & W & f((O > C2) & (O < O2) & (C > Ca) & (C < Oa))

    # 5봉 (1 = t−4 … 5 = t)
    O5, H5, L5, C5, B5, R5 = (sh(x, 4) for x in (O, H, L, C, B, R))
    with np.errstate(invalid="ignore", divide="ignore"):
        long5 = f((B5 / np.where(R5 > EPS, R5, np.nan) >= th["long_body"]) & (R5 / sh(atr, 4) >= 1.0))
    mids_in = np.ones(len(C), bool); mids_small = np.ones(len(C), bool); mids_dn = np.ones(len(C), bool)
    for k in (1, 2, 3):
        Ok, Hk, Lk, Ck, Bk = sh(O, k), sh(H, k), sh(L, k), sh(C, k), sh(B, k)
        mids_in &= f((Hk <= H5) & (Lk >= L5)); mids_small &= f(Bk <= th["m3_body"] * B5)
    W5, K5 = f(C5 > O5), f(C5 < O5)
    P["R3M"] = long5 & W5 & mids_in & mids_small & long_ & W & f(C > C5)
    P["F3M"] = long5 & K5 & mids_in & mids_small & long_ & K & f(C < C5)
    # 매트 홀드: 첫 장대양봉 뒤 갭 상승한 작은 봉 포함 3봉이 첫 봉 몸통 위쪽 절반 이상에 머묾 → 장대양봉이 고점 돌파
    Hm = np.fmax(np.fmax(sh(H, 1), sh(H, 2)), sh(H, 3)); Lm = np.fmin(np.fmin(sh(L, 1), sh(L, 2)), sh(L, 3))
    P["MATHOLD"] = long5 & W5 & f(np.minimum(sh(O, 3), sh(C, 3)) > C5) & mids_small & f(Lm >= (O5 + C5) / 2) & W & f(C > Hm) & ~P["R3M"]
    for k in P: P[k] = np.asarray(P[k], bool)
    return P


def context(O, H, L, C, V=None, ma_long=200, pos_n=252):
    """봉 t 기준 위치 맥락(그 봉까지 확정 값만). 시간봉별로 ma_long·pos_n을 바꿔 부른다
    (일봉 200·252 · 주봉 40·52 · 월봉 10·12 — 모두 약 1년·200거래일).
    반환: z(k) = k봉짜리 패턴 '시작 전' 10봉 추세 강도 함수, pos52(0~1), above(장기선 위 1/0), dist(장기선 이격 %),
          vol_r(거래량/직전 20봉 평균), val_r(거래대금 비), sup(20봉 저점 1 ATR 안), res(20봉 고점 1 ATR 안)."""
    O, H, L, C = (np.asarray(x, float) for x in (O, H, L, C))
    n = len(C)
    atr = atr_prev(O, H, L, C)
    cs = np.concatenate([[0.0], np.cumsum(np.nan_to_num(C))])
    ma = np.full(n, np.nan)
    if n >= ma_long: ma[ma_long - 1:] = (cs[ma_long:] - cs[:n - ma_long + 1]) / ma_long
    hh = pd.Series(H).rolling(pos_n, min_periods=pos_n).max().to_numpy()      # t−pos_n+1 .. t
    ll = pd.Series(L).rolling(pos_n, min_periods=pos_n).min().to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        pos = (C - ll) / np.where(hh - ll > EPS, hh - ll, np.nan)
        above = np.where(np.isfinite(ma), (C > ma).astype(float), np.nan)
        dist = (C / ma - 1) * 100
    def z(k):
        """패턴 첫 봉 직전(t−k) 기준 10봉 수익 ÷ (ATR%·√10). ≤ −1 하락 뒤 · ≥ +1 상승 뒤."""
        e = sh(C, k); s = sh(C, k + 10); a = sh(atr, k)
        with np.errstate(invalid="ignore", divide="ignore"):
            return (e / s - 1) / ((a / e) * np.sqrt(10))
    out = dict(z=z, pos52=pos, above=above, dist=dist, atr=atr, ma=ma, hh=hh, ll=ll)
    h20 = sh(pd.Series(H).rolling(20, min_periods=20).max().to_numpy(), 1)    # 직전 20봉(자기 제외)
    l20 = sh(pd.Series(L).rolling(20, min_periods=20).min().to_numpy(), 1)
    with np.errstate(invalid="ignore"):
        out["sup"] = np.where(np.isfinite(l20) & np.isfinite(atr), (np.abs(L - l20) <= atr).astype(float), np.nan)
        out["res"] = np.where(np.isfinite(h20) & np.isfinite(atr), (np.abs(H - h20) <= atr).astype(float), np.nan)
    if V is not None:
        V = np.asarray(V, float); vs = np.concatenate([[0.0], np.cumsum(np.nan_to_num(V))]); dv = V * C
        ds = np.concatenate([[0.0], np.cumsum(np.nan_to_num(dv))])
        vr = np.full(n, np.nan); dr = np.full(n, np.nan)
        if n > 20:
            m = (vs[20:n] - vs[:n - 20]) / 20; md = (ds[20:n] - ds[:n - 20]) / 20     # 직전 20봉 평균
            with np.errstate(invalid="ignore", divide="ignore"):
                vr[20:] = np.where(m > 0, V[20:] / m, np.nan); dr[20:] = np.where(md > 0, dv[20:] / md, np.nan)
        out["vol_r"] = vr; out["val_r"] = dr
    return out


def trend_cell(z, pos, above):
    """기준선 칸: 직전 추세(하락 z≤−1 · 보합 · 상승 z≥1) × 52주 위치(저 ≤0.2 · 중 · 고 ≥0.8) × 장기선 위/아래 = 18칸."""
    tz = np.where(z <= -1, 0, np.where(z >= 1, 2, 1))
    pz = np.where(pos <= 0.2, 0, np.where(pos >= 0.8, 2, 1))
    ok = np.isfinite(z) & np.isfinite(pos) & np.isfinite(above)
    return np.where(ok, tz * 6 + pz * 2 + np.nan_to_num(above).astype(int), -1)
