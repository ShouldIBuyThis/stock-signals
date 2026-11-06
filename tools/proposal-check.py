#!/usr/bin/env python3
"""외부 제안 '테마별 단기고점·익절 신호판'(2026-11-06 사용자 붙여넣기)을 10년 데이터로 그대로 재 본다 (연구 전용)

제안 규칙(가중치 대신 조건의 AND로 옮겼다 — 가중치·점수 문턱은 제안에 숫자가 없어 재현 불가):
  양자·초고변동성  RSI14≥80 ∧ 종가 볼밴 상단 밖 ∧ 긴 윗꼬리(≥40%)
  반도체·AI       최근 5일 거래량 2배↑ ∧ 최근 5일 RSI≥70 뒤 RSI 하락 ∧ 오늘 상단 재진입
  테슬라          장대양봉 다음 날 음봉 ∧ 최근 3일 RSI 약세 다이버전스
  소프트웨어·빅테크 최근 5일 RSI≥70 ∧ 20일선 기울기 둔화 ∧ 오늘 상단 재진입
  산업재·다우      고점 갱신 실패(최근 5일 고가 < 직전 20일 고가, 3% 이내) ∧ RSI 약화(10일 안 60↑였고 5일 전보다 낮음) ∧ 5일선 첫 이탈
  공통 3단계       ① RSI≥70 ∧ 종가 상단 밖  ② 윗꼬리≥40% ∧ 거래량 1.5배 ∧ (고가 상단 위 또는 RSI≥65)  ③ 상단 재진입 ∧ RSI 하락 ∧ 음봉
평가: 10거래일 뒤 하락 비율(목표 75%) · 평균 10일 수익 · 10일 안 평균 최대 하락폭 · 앞 80%/뒤 20% · 장세(QQQ 60일 수익 +5%↑ 상승 / −5%↓ 하락 / 그 사이 횡보)
같은 테마 같은 날 = 1건, 종목 쿨다운 10일. 볼밴은 사이트와 같은 표본 표준편차(bbup1).
"""
import importlib.util, time
import numpy as np, pandas as pd

H = __file__.rsplit("/", 1)[0]
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{H}/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tp = _load("tp", "theme-patterns.py")
tr, tt = tp.tr, tp.tt
log, shift, gt, lt = tr.log, tr.shift, tr.gt, tr.lt
roll_max = lambda a, n: pd.Series(a).rolling(n).max().to_numpy()

THEMES = {
    "양자·초고변동성": ["IONQ", "QBTS", "RGTI", "QUBT", "INFQ", "APLD"],
    "반도체·AI": ["NVDA", "MU", "^SOX", "SOXL"],
    "테슬라": ["TSLA"],
    "소프트웨어·빅테크": ["MSFT", "NOW", "AMZN", "GOOGL"],
    "산업재·다우": ["CAT", "AIT", "DIA", "XLI"],
    "주택(레버리지 비교)": ["ITB", "NAIL"],
}

def feats(P):
    c, o, h, l = P["c"], P["o"], P["h"], P["l"]
    r = P["rsi14"]; r1 = shift(r); up = P["bbup1"]
    out_ = gt(c, up); out1 = shift(out_.astype(float)) > 0.5
    reentry = ~out_ & out1
    vr5 = roll_max(np.nan_to_num(P["vr"]), 5)
    rmax5 = roll_max(np.nan_to_num(r), 5)
    rmax10 = roll_max(np.nan_to_num(r), 10)
    rng = h - l; body1 = shift(P["body"])
    big_up1 = gt(shift(c), shift(o)) & gt(body1, 0.6 - 1e-9) & gt(shift(rng), 1.5 * shift(P["atr"]))
    cmax20 = pd.Series(c).shift(1).rolling(20).max().to_numpy(); rmax20 = pd.Series(r).shift(1).rolling(20).max().to_numpy()
    div = gt(c, cmax20 - 1e-9) & lt(r, rmax20)
    div3 = roll_max(div.astype(float), 3) > 0.5
    ma20 = P["ma20"]; slope_now = ma20 - shift(ma20, 5); slope_prev = shift(ma20, 5) - shift(ma20, 10)
    hh5 = roll_max(h, 5); hh20p = pd.Series(h).shift(5).rolling(20).max().to_numpy()
    fail_high = lt(hh5, hh20p) & gt(hh5, hh20p * 0.97)
    rsi_weak = gt(rmax10, 60 - 1e-9) & lt(r, shift(r, 5))
    ma5 = P["ma5"]; break5 = lt(c, ma5) & ~lt(shift(c), shift(ma5))
    return {
        "양자·초고변동성": gt(r, 80 - 1e-9) & out_ & gt(P["upw"], 0.4 - 1e-9),
        "반도체·AI": gt(vr5, 2 - 1e-9) & gt(rmax5, 70 - 1e-9) & lt(r, r1) & reentry,
        "테슬라": big_up1 & lt(c, o) & div3,
        "소프트웨어·빅테크": gt(rmax5, 70 - 1e-9) & gt(slope_now, 0) & lt(slope_now, slope_prev) & reentry,
        "산업재·다우": fail_high & rsi_weak & break5,
        "① 과열 진입": gt(r, 70 - 1e-9) & out_,
        "② 상승 둔화": gt(P["upw"], 0.4 - 1e-9) & gt(P["vr"], 1.5 - 1e-9) & (gt(h, up) | gt(r, 65 - 1e-9)),
        "③ 반전 확인": reentry & lt(r, r1) & lt(c, o),
        "아무 날": np.ones(len(c), bool),
    }

def collect(U, tks, key, regime):
    by = {}
    for t in tks:
        if t not in U: continue
        P = U[t]; m = tp.declust(P["F"][key] & P["ok"], 10)
        run = tt.runlen(gt(P["c"], P["bbup1"]))
        for i in np.nonzero(m)[0]:
            if np.isnan(P["f10"][i]) or np.isnan(P["dd10"][i]): continue
            d = P["dates"][i]
            by.setdefault(d, []).append((P["f10"][i], P["dd10"][i], run[max(i - 1, 0)] if key == "③ 반전 확인" else run[i]))
    return sorted((d, np.mean([x[0] for x in v]), np.mean([x[1] for x in v]), np.mean([x[2] for x in v]), regime.get(d, "횡보")) for d, v in by.items())

def st(ev):
    if not ev: return "—(0)"
    a = np.array([[e[1], e[2]] for e in ev])
    return f"하락 {np.mean(a[:,0] < 0)*100:.0f}% · 평균 {np.mean(a[:,0]):+.1f}% · 최대낙폭 {np.mean(a[:,1]):.1f}% ({len(ev)})"

def main():
    T0 = time.time()
    tks = sorted({t for v in THEMES.values() for t in v} | {"QQQ"})
    data = {t: tr.fetch(t) for t in tks}
    U = {}
    for t, df in data.items():
        if df is None or len(df) < 260: continue
        if t in tt.STARTS: df = df[df.index >= tt.STARTS[t]]
        P = tp.prep(df); P["F"] = feats(P); U[t] = P
    q = U["QQQ"]; r60 = q["c"] / shift(q["c"], 60) - 1
    regime = {d: ("상승" if v > 0.05 else "하락" if v < -0.05 else "횡보") for d, v in zip(q["dates"], r60) if not np.isnan(v)}
    log("■ 외부 제안 '테마별 단기고점·익절 신호판' 10년 검증 · 10일 뒤 하락 비율(목표 75%) · 같은 날 1건 · 쿨다운 10일")
    for th, tks_ in THEMES.items():
        keys = [th] if th in ("양자·초고변동성", "반도체·AI", "테슬라", "소프트웨어·빅테크", "산업재·다우") else []
        keys += ["① 과열 진입", "② 상승 둔화", "③ 반전 확인"]
        base = collect(U, tks_, "아무 날", regime)
        log(f"\n  ▣ {th} ({', '.join(t for t in tks_ if t in U)}) · 아무 날 {st(base)}")
        for k in keys:
            ev = collect(U, tks_, k, regime)
            if not ev:
                log(f"    {k}: —(0)"); continue
            cut = sorted(e[0] for e in ev)[int(len(ev) * 0.8)] if len(ev) >= 5 else "9999"
            log(f"    {('[제안] ' if k == th else '[공통] ') + k}: {st(ev)} · 볼밴 밖 평균 {np.mean([e[3] for e in ev]):.1f}일")
            log(f"      앞 80% {st([e for e in ev if e[0] < cut])} → 뒤 20% {st([e for e in ev if e[0] >= cut])}")
            log("      장세  " + " · ".join(f"{g} {st([e for e in ev if e[4] == g])}" for g in ("상승", "횡보", "하락")))
        if th == "반도체·AI" or th == "주택(레버리지 비교)":
            for t in tks_:
                if t not in U: continue
                log(f"      └ {t} 단독: " + " · ".join(f"{k} {st(collect(U, [t], k, regime))}" for k in keys))
    log(f"\n(총 {time.time()-T0:.0f}초)")

if __name__ == "__main__":
    main()
