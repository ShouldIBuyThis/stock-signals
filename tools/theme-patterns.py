#!/usr/bin/env python3
"""고점 연속 윗꼬리 · 샛별십자형 · 극단 과매도 저점 반등(골든크로스·5일선 안착) · 테마별 조합 검증 — 연구 전용.

2026-11-05 사용자 지시 (차트 예시: SK하이닉스 고점, 어플라이드 머티어리얼즈 고점, 맥도날드 저점 반등)
  ① 극단적 고점에서 폭락 직전 연속 윗꼬리  ② 샛별십자형  ③ 극단적 과매도에서 저점 반등 특징
     — 맥도날드에서 보인 이동평균선 골든크로스와 5일선 안착 포함  ④ 테마별 보조지표 조합 검증 후 승률 높이기
원칙: 지표는 그날까지의 값만. 패턴의 효과는 '같은 맥락(고점·과매도) 자체'와 비교한다 — 고점에서 무엇이든
      평소보다 잘 빠지므로, 캔들이 맥락 위에 정보를 더하는지가 핵심이다. 같은 종목 10일 안 재신호는 첫 신호만.
사용: python tools/theme-patterns.py [--placebo N]   (CI lab-quick에서만)
"""
import ast, importlib.util, sys, time
import numpy as np, pandas as pd

H = __file__.rsplit("/", 1)[0]
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{H}/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py")
tt = _load("tt", "theme-trim.py")
log, rsi, shift, gt, lt, wilson = tr.log, tr.rsi, tr.shift, tr.gt, tr.lt, tr.wilson
T0 = time.time()
SECTORS = tr.SECTORS
DUP = {"TQQQ", "^NDX", "SOXX", "SOXL", "NAIL"}           # 같은 기초자산 중복 — 전체 집계에서 뺀다
EXTRA = {"MCD": "경기방어(맥도날드)", "AMAT": "반도체 장비(어플라이드)", "000660.KS": "반도체·메모리(SK하이닉스)"}

def watchlist():
    src = open(f"{H}/../main.py", encoding="utf-8").read()
    i = src.index("WATCHLIST = {"); j = src.index("\n}\n", i) + 2
    wl = ast.literal_eval(src[i + len("WATCHLIST = "):j])
    out = {}
    for cat, g in wl.items():
        for t in g:
            if not t.endswith((".KS", ".KQ")) and not t[:1].isdigit():
                out[t] = cat
    return out

def theme_of(t, wl):
    for k, v in SECTORS.items():
        if t in v:
            return k
    return EXTRA.get(t) or ("기타 관심종목" if t in wl else "기타")

# ── 종목별 지표·사후 성과 ───────────────────────────────────────────────
def prep(df):
    o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
    s = pd.Series(c)
    P = dict(o=o, h=h, l=l, c=c, dates=np.array([str(d.date()) for d in df.index]))
    P["rsi14"] = rsi(c, 14)
    for n in (5, 20, 50, 60, 200):
        P[f"ma{n}"] = s.rolling(n).mean().to_numpy()
    sd = s.rolling(20).std(ddof=0).to_numpy()
    P["bbup"], P["bblo"] = P["ma20"] + 2 * sd, P["ma20"] - 2 * sd
    trr = np.maximum(h - l, np.maximum(abs(h - shift(c)), abs(l - shift(c))))
    P["atr"] = pd.Series(trr).rolling(14).mean().to_numpy()
    rng = np.where(h - l > 0, h - l, np.nan)
    P["upw"], P["loww"], P["body"] = (h - np.maximum(o, c)) / rng, (np.minimum(o, c) - l) / rng, np.abs(c - o) / rng
    P["uwick"] = h - np.maximum(o, c)
    vs = pd.Series(v).rolling(20).mean().to_numpy()
    P["vr"] = np.where(vs > 0, v / np.where(vs > 0, vs, 1), np.nan)
    hh, ll = pd.Series(h).rolling(14).max().to_numpy(), pd.Series(l).rolling(14).min().to_numpy()
    P["k"] = np.where(hh > ll, (c - ll) / np.where(hh > ll, hh - ll, 1) * 100, np.nan)
    P["d"] = pd.Series(P["k"]).rolling(3).mean().to_numpy()
    e12, e26 = s.ewm(span=12, adjust=False).mean(), s.ewm(span=26, adjust=False).mean()
    P["mh"] = ((e12 - e26) - (e12 - e26).ewm(span=9, adjust=False).mean()).to_numpy()
    P["ret20"] = c / shift(c, 20) - 1
    P["ret60"] = c / shift(c, 60) - 1
    P["hh60"] = pd.Series(h).rolling(60).max().to_numpy()
    P["off60"] = c / pd.Series(c).rolling(60).max().to_numpy() - 1   # 과거: 60일 최고 종가 대비 (미래값 dd60과 이름을 분리)
    N = len(c)
    for n in (5, 10, 20):
        f = np.full(N, np.nan); f[:-n] = (c[n:] / c[:-n] - 1) * 100; P[f"f{n}"] = f
    f = np.full(N, np.nan); f[:-60] = (c[60:] / c[:-60] - 1) * 100; P["f60"] = f
    for n in (10, 20, 60):
        lo = pd.Series(l[::-1]).rolling(n).min().to_numpy()[::-1]; hi = pd.Series(h[::-1]).rolling(n).max().to_numpy()[::-1]
        dd = np.full(N, np.nan); ru = np.full(N, np.nan)
        dd[:-n] = (lo[1:N - n + 1] / c[:-n] - 1) * 100; ru[:-n] = (hi[1:N - n + 1] / c[:-n] - 1) * 100
        P[f"dd{n}"], P[f"ru{n}"] = dd, ru
    P["ok"] = (P["dates"] >= tr.ANALYSIS_FROM) & ~np.isnan(P["f20"])
    return P

def declust(mask, cool=10):
    out = np.zeros(len(mask), dtype=bool); last = -10 ** 9
    for i in np.nonzero(mask)[0]:
        if i - last >= cool:
            out[i] = True; last = i
    return out

def collect(U, tks, fn, cool=10):
    ev = []
    for t in tks:
        P = U[t]
        m = fn(P)
        if m is None:
            continue
        m = declust(m & P["ok"], cool)
        ev += [(t, i) for i in np.nonzero(m)[0]]
    return ev

def sell_stats(U, ev):
    if not ev:
        return "—(0)"
    f10 = np.array([U[t]["f10"][i] for t, i in ev]); dd = np.array([U[t]["dd20"][i] for t, i in ev])
    return f"하락 {round(np.mean(f10 < 0)*100)}%·급락 {round(np.mean(dd <= -10)*100)}%·{np.mean(f10):+.1f}%({len(ev)})"

def buy_stats(U, ev, short=False):
    if not ev:
        return "—(0)"
    a = lambda k: np.array([U[t][k][i] for t, i in ev])
    f10, f20, ru, dd = a("f10"), a("f20"), a("ru20"), a("dd20")
    if short:
        return f"{round(np.mean(f20 > 0)*100)}%·{np.mean(f20):+.1f}%({len(ev)})"
    return f"10일 {round(np.mean(f10 > 0)*100)}% · 20일 {round(np.mean(f20 > 0)*100)}% 평균 {np.mean(f20):+.1f}% · +10% 반등 {round(np.mean(ru >= 10)*100)}% · 20일 최저 평균 {np.mean(dd):+.1f}% ({len(ev)})"

# ── ① 극단 고점 연속 윗꼬리 ─────────────────────────────────────────────
def ctx_top(P):
    r, h, up = P["rsi14"], P["h"], P["bbup"]
    return {
        "RSI14≥70": gt(r, 70 - 1e-9) | gt(shift(r), 70 - 1e-9),
        "볼밴 상단 터치": gt(h, up) | gt(shift(h), shift(up)),
        "20일 +30%↑": gt(P["ret20"], 0.30 - 1e-9),
        "60일 신고가권+RSI65": gt(h, P["hh60"] * 0.97) & gt(r, 65 - 1e-9),
    }

def wick_pats(P):
    u, u1, u2 = P["upw"], shift(P["upw"]), shift(P["upw"], 2)
    big = P["uwick"] >= 0.5 * P["atr"]
    return {
        "맥락만": None,
        "당일 윗꼬리≥40%": gt(u, 0.4 - 1e-9),
        "2일 연속 윗꼬리≥30%": gt(u, 0.3 - 1e-9) & gt(u1, 0.3 - 1e-9),
        "2일 연속 윗꼬리≥40%": gt(u, 0.4 - 1e-9) & gt(u1, 0.4 - 1e-9),
        "3일 연속 윗꼬리≥30%": gt(u, 0.3 - 1e-9) & gt(u1, 0.3 - 1e-9) & gt(u2, 0.3 - 1e-9),
        "2일 연속 윗꼬리≥ATR×0.5": big & shift(big.astype(float), 1, 0).astype(bool),
        "2일 연속 윗꼬리≥30% + 오늘 음봉": gt(u, 0.3 - 1e-9) & gt(u1, 0.3 - 1e-9) & lt(P["c"], P["o"]),
    }

def section_wicks(U, pool, groups):
    log("\n■ ① 극단 고점의 연속 윗꼬리 — 10거래일 하락 확률 · 20일 안 −10% 이상 급락 확률 · 10일 평균 (사례 수)")
    log("  비교는 '맥락만'(그 고점 조건 자체) 줄과 한다. 기준(아무 날): " + sell_stats(U, collect(U, pool, lambda P: np.ones(len(P["c"]), bool), 10)))
    ctx_names = list(ctx_top(U[pool[0]]).keys())
    pat_names = list(wick_pats(U[pool[0]]).keys())
    for cn in ctx_names:
        log(f"  [{cn}]")
        for pn in pat_names:
            def fn(P, cn=cn, pn=pn):
                m = ctx_top(P)[cn]; w = wick_pats(P)[pn]
                return m if w is None else m & w
            log(f"    {pn.ljust(24)} {sell_stats(U, collect(U, pool, fn))}")
    log("  테마별 [RSI14≥70] 맥락만 → 2일 연속 윗꼬리≥30% → 3일 연속 윗꼬리≥30%")
    for g, tks in groups.items():
        cells = []
        for pn in ("맥락만", "2일 연속 윗꼬리≥30%", "3일 연속 윗꼬리≥30%"):
            cells.append(sell_stats(U, collect(U, tks, lambda P, pn=pn: ctx_top(P)["RSI14≥70"] & (np.ones(len(P["c"]), bool) if wick_pats(P)[pn] is None else wick_pats(P)[pn]))))
        log(f"    {g.ljust(12)} " + " → ".join(cells))

# ── ⑤ 고전 버블 붕괴형 '진짜 위험' 신호 — 일부 익절 신호와 같은 잣대로 ─────────────────
def danger_stats(U, ev):
    if not ev:
        return "—(0)"
    a = lambda k: np.array([U[t][k][i] for t, i in ev])
    f10, f20, dd20, dd60 = a("f10"), a("f20"), a("dd20"), a("dd60")
    ok60 = ~np.isnan(dd60)
    p60 = f"{round(np.mean(dd60[ok60] <= -25)*100)}%" if ok60.any() else "—"
    return f"10일 하락 {round(np.mean(f10 < 0)*100)}% · 20일 −15% 급락 {round(np.mean(dd20 <= -15)*100)}% · 60일 −25% 폭락 {p60} · 20일 평균 {np.mean(f20):+.1f}% ({len(ev)})"

def danger_pats(P):
    c, o, h, l, v = P["c"], P["o"], P["h"], P["l"], P["vr"]
    c1, h1, o1, o2, c2 = shift(c), shift(h), shift(o), shift(o, 2), shift(c, 2)
    para = gt(pd.Series(P["ret60"]).rolling(20).max().to_numpy(), 0.5 - 1e-9)       # 최근 20일 안 60일 +50% 포물선
    at_hi = gt(h, P["hh60"] * 0.97)
    gap1 = gt(o1, shift(c, 2) * 1.03) & gt(h1, shift(P["hh60"]) * 0.97)              # 어제 고점권 갭상승 3%+
    gap2 = gt(o2, shift(c, 3) * 1.03) & gt(shift(h, 2), shift(P["hh60"], 2) * 0.97)
    hh20 = pd.Series(h).rolling(20).max().to_numpy()
    return {
        "블로우오프 대량 음봉(60일 +50%↑ · 거래량 2배↑ · −3%↓ 음봉)": gt(P["ret60"], 0.5 - 1e-9) & lt(c, o) & gt(v, 2 - 1e-9) & lt(c / c1 - 1, -0.03 + 1e-9),
        "20일선 이격 +25%↑": gt(c / P["ma20"], 1.25 - 1e-9),
        "200일선 이격 +80%↑": gt(c / P["ma200"], 1.8 - 1e-9),
        "포물선 뒤 20일선 첫 이탈": para & lt(c, P["ma20"]) & ~lt(c1, shift(P["ma20"])),
        "소진 갭 반전(고점권 갭 3%↑을 1~2일 안에 메움)": (gap1 & lt(c, shift(c, 2))) | (gap2 & lt(c, shift(c, 3))),
        "클라이맥스 거래량 3배↑ + 윗꼬리≥40% (고점권)": gt(v, 3 - 1e-9) & gt(P["upw"], 0.4 - 1e-9) & at_hi,
        "포물선 뒤 20일 고점 대비 −10% 첫 도달": para & lt(c, hh20 * 0.90) & ~lt(c1, shift(hh20) * 0.90),
    }

def section_danger(U, pool, groups):
    log("\n■ ⑤ 일부 익절 신호 vs 고전 버블 붕괴형 '진짜 위험' 신호 — 같은 잣대(10일 하락 · 20일 −15% 급락 · 60일 −25% 폭락 · 20일 평균)")
    log("    " + "기준(아무 날)".ljust(52) + danger_stats(U, collect(U, pool, lambda P: np.ones(len(P["c"]), bool), 10)))
    log("    " + "고점 맥락만(RSI14≥70)".ljust(52) + danger_stats(U, collect(U, pool, lambda P: ctx_top(P)["RSI14≥70"])))
    log("    " + "[익절] RSI14≥70 + 2일 연속 윗꼬리≥30%".ljust(52) + danger_stats(U, collect(U, pool, lambda P: ctx_top(P)["RSI14≥70"] & wick_pats(P)["2일 연속 윗꼬리≥30%"])))
    log("    " + "[익절] 볼밴 상단 터치 + 3일 연속 윗꼬리≥30%".ljust(52) + danger_stats(U, collect(U, pool, lambda P: ctx_top(P)["볼밴 상단 터치"] & wick_pats(P)["3일 연속 윗꼬리≥30%"])))
    log("    " + "[익절] 샛별십자 느슨 + 고점".ljust(52) + danger_stats(U, collect(U, pool, lambda P: star_pats(P)["샛별십자 느슨(도지 몸통≤15%, 별이 전날 몸통 중간 위)"] & (gt(shift(P["rsi14"]), 65 - 1e-9) | gt(shift(P["h"]), shift(P["bbup"]))))))
    names = list(danger_pats(U[pool[0]]).keys())
    for dn in names:
        log("    " + f"[위험] {dn}"[:52].ljust(52) + danger_stats(U, collect(U, pool, lambda P, dn=dn: danger_pats(P)[dn])))
    log("  테마별 [위험] 블로우오프 대량 음봉 / 포물선 뒤 20일선 첫 이탈")
    for g, tks in groups.items():
        a = danger_stats(U, collect(U, tks, lambda P: danger_pats(P)[names[0]]))
        b = danger_stats(U, collect(U, tks, lambda P: danger_pats(P)[names[3]]))
        log(f"    {g.ljust(12)} {a}  /  {b}")
    ex = []
    for t in ("000660.KS", "AMAT", "NVDA", "SOXL", "IONQ", "RGTI", "NAIL", "TSLA", "MU"):
        if t in U:
            P = U[t]
            for dn in (names[0], names[3], names[6]):
                for i in np.nonzero(declust(danger_pats(P)[dn] & (P["dates"] >= "2025-06-01"), 10))[0]:
                    dd = P["dd60"][i]
                    ex.append(f"{t} {P['dates'][i]} {dn.split('(')[0]}{'' if np.isnan(dd) else f' → 60일 최저 {dd:+.0f}%'}")
    log("  최근 사례(2025-06~): " + " · ".join(ex[:40]))

# ── ② 샛별십자형 ───────────────────────────────────────────────────────
def star_pats(P):
    o, c, h, l, b = P["o"], P["c"], P["h"], P["l"], P["body"]
    o1, c1, b1, h1, o2, c2, b2 = shift(o), shift(c), shift(b), shift(h), shift(o, 2), shift(c, 2), shift(b, 2)
    rng2, atr2 = shift(h - l, 2), shift(P["atr"], 2)
    big2 = gt(c2, o2) & gt(b2, 0.5 - 1e-9) & gt(rng2, 0.8 * atr2)
    mid2 = (o2 + c2) / 2
    bear = lt(c, o) & lt(c, mid2)
    return {
        "샛별십자 엄격(도지 몸통≤10%, 별이 전날 종가 위)": big2 & lt(b1, 0.1 + 1e-9) & gt(np.minimum(o1, c1), c2 * 0.998) & bear,
        "샛별십자 느슨(도지 몸통≤15%, 별이 전날 몸통 중간 위)": big2 & lt(b1, 0.15 + 1e-9) & gt(np.minimum(o1, c1), mid2) & bear,
        "샛별형(별 몸통≤30%)": big2 & lt(b1, 0.3 + 1e-9) & gt(np.minimum(o1, c1), mid2) & bear,
    }

def section_star(U, pool, groups):
    log("\n■ ② 샛별십자형 — 셋째 날(음봉 확인) 종가 기준 · 하락 확률·급락 확률·10일 평균")
    top = lambda P: gt(shift(P["rsi14"]), 65 - 1e-9) | gt(shift(P["h"]), shift(P["bbup"]))
    log("  고점 맥락 = 별 캔들 날 RSI14≥65 또는 고가가 볼밴 상단 위")
    log(f"    {'고점 맥락만'.ljust(40)} {sell_stats(U, collect(U, pool, top))}")
    for pn in star_pats(U[pool[0]]):
        log(f"    {pn.ljust(40)} 전체 {sell_stats(U, collect(U, pool, lambda P, pn=pn: star_pats(P)[pn]))}")
        log(f"    {'  └ 고점 맥락에서'.ljust(40)} {sell_stats(U, collect(U, pool, lambda P, pn=pn: star_pats(P)[pn] & top(P)))}")
    log("  최근 3년 샛별십자(느슨)+고점 사례: " + " · ".join(
        f"{t} {U[t]['dates'][i]} {U[t]['f10'][i]:+.1f}%" for t, i in collect(U, pool + [x for x in ("SOXL", "NAIL", "TQQQ") if x in U], lambda P: star_pats(P)["샛별십자 느슨(도지 몸통≤15%, 별이 전날 몸통 중간 위)"] & top(P)) if U[t]["dates"][i] >= "2023-11-01")[:600])

# ── ③ 극단 과매도 저점 반등 ─────────────────────────────────────────────
def oversold(P, rt=30, ddt=-0.15, band=True):
    m = lt(P["rsi14"], rt + 1e-9) & lt(P["off60"], ddt + 1e-9)
    return m & lt(P["c"], P["bblo"] * 1.0) if band else m

def recent(mask, n=20):
    """오늘 이전 n일 안에 mask가 한 번이라도 있었나 (오늘 제외)."""
    cs = np.concatenate([[0], np.cumsum(mask)])
    i = np.arange(len(mask))
    return (cs[i] - cs[np.maximum(i - n, 0)]) > 0

def triggers(P):
    c, ma5, ma20, ma60 = P["c"], P["ma5"], P["ma20"], P["ma60"]
    above5 = gt(c, ma5)
    run = tt.runlen(above5)
    g520 = gt(ma5, ma20) & ~gt(shift(ma5), shift(ma20))
    g2060 = gt(ma20, ma60) & ~gt(shift(ma20), shift(ma60))
    k, d, k1, d1 = P["k"], P["d"], shift(P["k"]), shift(P["d"])
    o, o1, c1 = P["o"], shift(P["o"]), shift(c)
    return {
        "5일선 회복(첫날)": run == 1,
        "5일선 안착(2일 연속 위)": run == 2,
        "5일선 안착(3일 연속 위)": run == 3,
        "5·20일선 골든크로스": g520,
        "20·60일선 골든크로스": g2060,
        "볼밴 하단 재진입": gt(c, P["bblo"]) & lt(c1, shift(P["bblo"])),
        "스토캐스틱 K≤20 골든": lt(k1, 20 + 1e-9) & lt(k1, d1 + 1e-9) & gt(k, d),
        "상승장악형": lt(c1, o1) & gt(c, o) & gt(c, o1) & lt(o, c1),
    }

def features(P):
    c, l = P["c"], P["l"]
    vr5 = pd.Series(P["vr"]).rolling(5).max().to_numpy()
    lw3 = pd.Series(np.nan_to_num(P["loww"])).rolling(3).max().to_numpy()
    lowc10 = pd.Series(c).rolling(10).min().to_numpy(); lowc_prev = pd.Series(c).shift(10).rolling(20).min().to_numpy()
    r = np.nan_to_num(P["rsi14"], nan=50)
    lowr10 = pd.Series(r).rolling(10).min().to_numpy(); lowr_prev = pd.Series(r).shift(10).rolling(20).min().to_numpy()
    down = lt(c, shift(c)); dr = tt.runlen(down)
    maxdr10 = pd.Series(dr).rolling(10).max().to_numpy()
    mh = P["mh"]
    return {
        "긴 아랫꼬리(최근 3일 ≥50%)": gt(lw3, 0.5 - 1e-9),
        "투매 거래량(최근 5일 2배↑)": gt(vr5, 2 - 1e-9),
        "RSI 상승 다이버전스": lt(lowc10, lowc_prev) & gt(lowr10, lowr_prev),
        "직전 5일+ 연속 하락": gt(maxdr10, 5 - 1e-9),
        "MACD 히스토 3일 연속 개선": gt(mh, shift(mh)) & gt(shift(mh), shift(mh, 2)) & gt(shift(mh, 2), shift(mh, 3)),
        "200일선 위(장기 상승 중 눌림)": gt(c, P["ma200"]),
        "낙폭 30%↑(60일 고점 대비)": lt(P["off60"], -0.30 + 1e-9),
    }

def section_rebound(U, pool, groups, qqq_up):
    log("\n■ ③ 극단 과매도 저점 반등 — 과매도(RSI14≤30 · 종가<볼밴 하단 · 60일 고점 대비 −15%↓) 뒤 20일 안 첫 반등 신호")
    log("  성과는 신호일 종가 매수 기준. '이미 반등' = 신호일 종가가 그 전 20일 최저 종가보다 몇 % 위인가(늦게 살수록 커진다)")
    log("  기준(아무 날 매수): " + buy_stats(U, collect(U, pool, lambda P: np.ones(len(P["c"]), bool), 10)))
    for tn in triggers(U[pool[0]]):
        ev = collect(U, pool, lambda P, tn=tn: triggers(P)[tn] & recent(oversold(P), 20), 15)
        late = [U[t]["c"][i] / np.nanmin(U[t]["c"][max(0, i - 20):i]) - 1 for t, i in ev] if ev else [np.nan]
        log(f"    {tn.ljust(22)} {buy_stats(U, ev)} · 이미 반등 {np.nanmean(late)*100:+.1f}%")
    log("  특징별(신호 = 5일선 안착 2일) — 있음 / 없음")
    base_tr = lambda P: triggers(P)["5일선 안착(2일 연속 위)"] & recent(oversold(P), 20)
    for fn_ in list(features(U[pool[0]]).keys()) + ["QQQ 60일선 위(시장 건강)"]:
        def yes(P, fn_=fn_):
            f = qqq_up(P) if fn_.startswith("QQQ") else features(P)[fn_]
            return base_tr(P) & f
        def no(P, fn_=fn_):
            f = qqq_up(P) if fn_.startswith("QQQ") else features(P)[fn_]
            return base_tr(P) & ~f
        log(f"    {fn_.ljust(24)} 있음 {buy_stats(U, collect(U, pool, yes, 15), True)} / 없음 {buy_stats(U, collect(U, pool, no, 15), True)}")
    log("  테마별 — 5일선 안착(2일) / 5·20 골든크로스 (20일 상승 비율·평균(건수))")
    for g, tks in groups.items():
        a = buy_stats(U, collect(U, tks, base_tr, 15), True)
        b = buy_stats(U, collect(U, tks, lambda P: triggers(P)["5·20일선 골든크로스"] & recent(oversold(P), 20), 15), True)
        log(f"    {g.ljust(12)} {a} / {b}")
    for t in ("MCD", "000660.KS", "AMAT"):
        if t in U:
            P = U[t]
            evs = []
            for tn, m in triggers(P).items():
                for i in np.nonzero(m & recent(oversold(P), 20))[0]:
                    if P["dates"][i] >= "2026-01-01":
                        evs.append(f"{P['dates'][i]} {tn}{'' if np.isnan(P['f10'][i]) else f' 10일 {P[chr(102)+chr(49)+chr(48)][i]:+.1f}%'}")
            log(f"  {t} 2026 반등 신호: " + (" · ".join(evs) or "없음"))

# ── ④ 테마별 조합: 일부 매도(확장 캔들) + 저점 매수 ───────────────────────
def extended_candles(X):
    base = tt._orig_candles(X)
    u, u1, u2 = X["upw"], shift(X["upw"]), shift(X["upw"], 2)
    b, o, c = X["body"], X["o"], X["c"]
    c1, o1, b1 = shift(c), shift(o), shift(b)
    return base + [
        ("2일 연속 윗꼬리≥30%", gt(u, 0.3 - 1e-9) & gt(u1, 0.3 - 1e-9)),
        ("2일 연속 윗꼬리≥40%", gt(u, 0.4 - 1e-9) & gt(u1, 0.4 - 1e-9)),
        ("3일 연속 윗꼬리≥30%", gt(u, 0.3 - 1e-9) & gt(u1, 0.3 - 1e-9) & gt(u2, 0.3 - 1e-9)),
        ("샛별십자 별(큰 양봉 다음 날 도지)", gt(c1, o1) & gt(b1, 0.5 - 1e-9) & lt(b, 0.1 + 1e-9) & gt(np.minimum(o, c), c1 * 0.998)),
    ]

def buy_combos(U, name, tks, qqq_up, quiet=False):
    """과매도 정의 × 반등 신호 × 특징 1개 → 20일·10일 상승. 앞 80% 선정, 뒤 20% 확인. 같은 날 = 1건."""
    dates = sorted({d for t in tks for d in U[t]["dates"][U[t]["ok"]]})
    if len(dates) < 200:
        return []
    cut = dates[int(len(dates) * 0.8)]
    rows = []
    trg_names = list(triggers(U[tks[0]]).keys())
    feat_names = ["없음"] + list(features(U[tks[0]]).keys()) + ["QQQ 60일선 위(시장 건강)"]
    cache = {t: (triggers(U[t]), features(U[t]), qqq_up(U[t])) for t in tks}
    for rt in (25, 30, 35):
        for ddt in (-0.10, -0.15, -0.20, -0.30):
            for band in (True, False):
                rec = {t: recent(oversold(U[t], rt, ddt, band), 20) for t in tks}
                for tn in trg_names:
                    for fn_ in feat_names:
                        evs = []
                        for t in tks:
                            T, Fe, Q = cache[t]
                            m = T[tn] & rec[t]
                            if fn_ != "없음":
                                m = m & (Q if fn_.startswith("QQQ") else Fe[fn_])
                            m = declust(m & U[t]["ok"], 15)
                            evs += [(U[t]["dates"][i], U[t]["f10"][i], U[t]["f20"][i]) for i in np.nonzero(m)[0]]
                        for hk, hi in (("20일", 2), ("10일", 1)):
                            def agg(es):
                                by = {}
                                for e in es:
                                    by.setdefault(e[0], []).append(e[hi])
                                if not by:
                                    return 0, float("nan"), float("nan")
                                return len(by), float(np.mean([np.mean([x > 0 for x in v]) for v in by.values()])), float(np.mean([np.mean(v) for v in by.values()]))
                            e_ = agg([e for e in evs if e[0] < cut]); l_ = agg([e for e in evs if e[0] >= cut])
                            if e_[0] >= 5 and e_[2] > 0:
                                rows.append((hk, f"RSI14≤{rt} · 60일 고점 대비 {int(ddt*100)}%↓{' · 볼밴 하단 밖' if band else ''} → {tn}{'' if fn_ == '없음' else ' + ' + fn_}", e_, l_))
    out = []
    for hk in ("10일", "20일"):
        rs = sorted([r for r in rows if r[0] == hk], key=lambda r: -wilson(r[2][1], r[2][0])[0])
        seen = []
        for r in rs:
            sig = r[1].split(" → ")[1]
            if sig in seen:
                continue
            seen.append(sig)
            out.append(r)
            if not quiet:
                lo = wilson(r[2][1], r[2][0])[0]
                log(f"    [{hk}] {r[1]}")
                log(f"        앞 80% {round(r[2][1]*100)}%({r[2][0]}) 평균 {r[2][2]:+.1f}% [하한 {round(lo*100)}%] → 뒤 20% {'—' if not r[3][0] else str(round(r[3][1]*100))+'%'}({r[3][0]}){'' if not r[3][0] else f' 평균 {r[3][2]:+.1f}%'}")
            if len(seen) >= 2:
                break
    return out

def main():
    wl = watchlist()
    tks = sorted(set(t for v in SECTORS.values() for t in v) | set(wl) | set(EXTRA) | {"QQQ", "^VXN"})
    data = {}
    for t in tks:
        df = tr.fetch(t)
        if df is not None and t in tt.STARTS:
            df = df[df.index >= tt.STARTS[t]]
        data[t] = df
    run(data, wl, quiet=False)
    if "--placebo" in sys.argv:
        k = int(sys.argv[sys.argv.index("--placebo") + 1])
        for s in range(k):
            rng = np.random.default_rng(3000 + s)
            pdata = {t: (tr.permuted(df, rng) if df is not None and not t.startswith("^V") else df) for t, df in data.items()}
            st, tot = run(pdata, wl, quiet=True)
            log(f"  대조(수익률 섞기) {s+1}: 저점 매수 1순위 중 뒤 20% 5건+·75%+ {st}/{tot}")
    log(f"\n(총 {time.time()-T0:.0f}초)")

def run(data, wl, quiet):
    U = {t: prep(df) for t, df in data.items() if df is not None and len(df) > 260 and not t.startswith("^V")}
    q = U["QQQ"]; qmap = dict(zip(q["dates"], gt(q["c"], q["ma60"])))
    qqq_up = lambda P: np.array([qmap.get(d, False) for d in P["dates"]])
    pool = [t for t in U if t not in DUP]
    groups = {}
    for t in U:
        groups.setdefault(theme_of(t, wl), []).append(t)
    groups = {g: v for g, v in groups.items() if g in SECTORS or g in EXTRA.values()}
    if not quiet:
        log(f"■ 패턴 연구 · 종목 {len(U)}개(전체 집계는 같은 기초자산 중복 {len(U)-len(pool)}개 제외) · {tr.ANALYSIS_FROM}~2026-11-04")
        section_wicks(U, pool, groups)
        section_star(U, pool, groups)
        section_danger(U, pool, groups)
        section_rebound(U, pool, groups, qqq_up)
        log("\n■ ④-가 테마별 일부 매도 재검증 — 확장 캔들(연속 윗꼬리·샛별십자 별) 포함 · 앞 80% 선정 → 뒤 20% 확인")
        tt._orig_candles = getattr(tt, "_orig_candles", tt.candles)
        tt.candles = extended_candles
        for nm in SECTORS:
            T = tt.Theme(nm, data)
            if not T.tk:
                continue
            log(f"  ▣ {nm}")
            tt.recommend(T, tt.search_trim(T), 3)
    log("\n■ ④-나 테마별 저점 매수 조합 — 과매도 정의 × 반등 신호(골든크로스·5일선 안착 포함) × 특징 1개 · 앞 80% → 뒤 20%")
    stars = tot = 0
    for g in list(SECTORS) + list(EXTRA.values()):
        if g not in groups:
            continue
        if not quiet:
            log(f"  ▣ {g} ({', '.join(groups[g])})")
        res = buy_combos(U, g, groups[g], qqq_up, quiet)
        for r in res[:1]:
            tot += 1
            if r[3][0] >= 5 and r[3][1] >= 0.75:
                stars += 1
    if not quiet:
        log(f"\n■ 저점 매수 1순위 규칙 중 뒤 20%에서 5건+·75%+: {stars}/{tot}")
    return stars, tot

if __name__ == "__main__":
    main()
