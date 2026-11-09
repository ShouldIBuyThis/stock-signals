"""월봉·주봉·일봉·거래량 조합 10개 패턴 — 70% 목표 연구 (읽기 전용 · 화면·산식·등급 변경 없음)

왜 (2026-11-09 사용자: 기존 캔들 신호와 별개로 미너비니 VCP·포켓 피벗, 오닐 컵앤핸들·플랫베이스, 와인스타인 2단계 등을
    검증 가능한 규칙으로 정의 · 결과 보기 전 커밋 · 89종목 10년 · 마지막 2년 미사용 검증 · 70%만으로 채택 금지)

━━ 사전 등록 (이 파일을 결과 보기 전에 커밋) ━━
봉 확정 규칙: 신호일 t에서 주봉 = t가 속한 주(금요일 마감) '이전'에 끝난 주들만, 월봉 = t가 속한 달 '이전'에 끝난 달들만. 일봉은 t 종가까지.
공통: vr = 오늘 거래량 / 직전 20일 평균(오늘 제외). '첫 돌파' = 오늘 종가 > 기준가 ∧ 어제 종가 ≤ 같은 기준가.
  M↑ (월봉 상승) = 마지막 확정 월 종가 > 10개월 이평 ∧ 10개월 이평 > 3개월 전 10개월 이평
  M→ (월봉 횡보) = |마지막 확정 월 종가 / 3개월 전 월 종가 − 1| < 10%
 1 VCP: M↑ ∧ 최근 확정 9주를 3주씩 3구간, 구간 폭 = (최고 고가 − 최저 저가)/최고 고가 → 폭1 > 폭2 > 폭3 ∧ 폭3 ≤ 10%
        ∧ 일봉 직전 20일 최고 고가 첫 돌파 ∧ vr ≥ 1.5                                                     (상승 기대)
 2 포켓 피벗: M↑ ∧ 최근 확정 4주 종가 범위 ≤ 8% ∧ 일봉 양봉 ∧ 10일선 ≤ 종가 ∧ 저가 ≤ 10일선×1.02
        ∧ 오늘 거래량 > 직전 10일 중 하락일(종가<전일) 최대 거래량(하락일 1개↑)                            (상승)
 3 컵앤핸들: M↑ ∧ 확정 주봉 N주(N=7~30 중 하나라도): 앞 N//3주 최고가 L · 가운데 최저가 B · 뒤 N//3주 최고가 R,
        깊이 1−B/L ∈ [12%, 35%] ∧ R ≥ 0.9·L ∧ 마지막 확정 주 종가 < R(손잡이) ∧ 마지막 2주 저가 ≥ B+0.5(L−B)
        기준가 = N주 최고 고가 · 일봉 기준가 첫 돌파 ∧ vr ≥ 1.4                                           (상승)
 4 플랫베이스: (M↑ ∨ M→) ∧ 확정 주봉 N주(N=5~15 중 하나라도) (최고 고가−최저 저가)/최고 고가 ≤ 15%
        ∧ 기준가 = 그 N주 최고 고가 첫 돌파 ∧ vr ≥ 1.4                                                    (상승)
 5 와인스타인 2단계: M↑ ∧ 주봉 30주 이평 > 4주 전 값 ∧ 마지막 확정 주 종가 > 30주 이평 ∧ 최근 6주 폭 ≤ 20%
        ∧ 일봉이 6주 최고 고가 첫 돌파 ∧ 직전 20일 최고 고가 위 ∧ vr ≥ 1.5                                  (상승)
 6 3주 타이트: M↑ ∧ 최근 확정 3주 종가 범위 ≤ 3% ∧ 일봉이 그 3주 최고 고가 첫 돌파 ∧ vr ≥ 1.3                 (상승)
 7 눌림목: M↑ ∧ 마지막 확정 주 종가 > 10주 이평 ∧ 마지막 확정 주 종가가 직전 8주 최고 종가보다 5~15% 낮음
        ∧ 일봉 망치형 또는 상승장악형(candle-context-lab 정의) ∧ vr ≥ 1.2                                  (상승)
 8 다중 시간대 반전: 마지막 확정 월봉 상승장악형 ∧ 마지막 확정 주봉 망치형 또는 상승장악형
        ∧ 일봉 직전 5일 최고 고가 첫 돌파 ∧ vr ≥ 1.5                                                     (상승)
 9 돌파 실패: 마지막 확정 월 종가 ≥ 12개월 최고 월 고가의 90% ∧ 최근 확정 2주 중 한 주가 직전 10주 최고 고가를
        장중 넘었지만 그 아래 마감(기준가 = 그 10주 최고 고가) ∧ 일봉 종가가 기준가×0.97 아래로 첫 이탈 ∧ vr ≥ 1.3   (하락)
10 과열 하락: 마지막 확정 월 상승률(종가/시가−1) ≥ 25% ∧ 월 윗꼬리 ≥ 월 진폭 30% ∧ 마지막 확정 주 거래량 ≥ 직전 10주 평균 2배
        ∧ 일봉 하락장악형 ∧ vr ≥ 1.5                                                                    (하락)
비교: 각 패턴의 '일봉만' 판(월·주 조건 제거, 일봉·거래량 조건 그대로) · 기존 사이트 캔들·패턴 매수 신호 · 같은 국면(QQQ 200일선 위/아래) 평소.
결과: 진입 다음 날 시가 → 1·2·3·5·10·20일 뒤 종가. 비용(왕복) 미국 0.10% · 국장 0.30%. 하락 기대 패턴은 하락이 적중, 수익은 공매도 가정(참고).
  손익비 = 비용 뒤 이익 합 / 손실 합 · 최대 중간 하락폭 = 보유 기간 중 불리한 쪽 최대 움직임의 중간값 · 같은 종목·패턴 10일 중복 제거.
기간: 학습 = 마지막 2년 이전, 검증(미사용) = 마지막 2년. 가장 유리한 보유 기간은 학습에서만 고름(평소 대비 개선 최대).
레버리지 ETF(main.py LEVERAGED)는 따로 집계(주 결과에서 제외).
채택 기준(미리 고정): 검증 표본 30↑ ∧ 검증 적중률 ≥ 같은 국면 평소 + 5%p ∧ 검증 비용 뒤 평균 > 평소 평균 ∧ 학습도 같은 방향
  ∧ 검증 z ≥ 3.0(10패턴×6기간 = 60번 시험 → 본페로니 보정). 70% 도달은 표시만, 채택 근거 아님. 검증 10~29건은 '희귀 후보'로만.
"""
import importlib.util, sys, ast
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)
import pattern_flags as pf
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py"); ss = _load("ss", "signal-stats.py"); cc = _load("cc", "candle-context-lab.py")
_src = open(f"{ROOT}/main.py", encoding="utf-8").read()
LEV = set(ast.literal_eval(_src[_src.index("LEVERAGED = {") + len("LEVERAGED = "):_src.index("}", _src.index("LEVERAGED = {")) + 1]))
HS = (1, 2, 3, 5, 10, 20)
NAMES = {1: "VCP", 2: "포켓 피벗", 3: "컵앤핸들", 4: "플랫베이스", 5: "와인스타인 2단계", 6: "3주 타이트", 7: "눌림목", 8: "다중 시간대 반전", 9: "돌파 실패(하락)", 10: "과열 하락(하락)"}
DOWN = {9, 10}

def bars(df, rule):
    g = df.resample(rule)
    b = pd.DataFrame({"o": g["Open"].first(), "h": g["High"].max(), "l": g["Low"].min(), "c": g["Close"].last(), "v": g["Volume"].sum()}).dropna()
    return b

def engulf_up(o, c, i): return i >= 1 and c[i - 1] < o[i - 1] and c[i] > o[i] and o[i] <= c[i - 1] and c[i] >= o[i - 1] and (c[i] - o[i]) > (o[i - 1] - c[i - 1])
def hammer(o, h, l, c, i):
    r = h[i] - l[i]
    if r <= 0: return False
    return (min(o[i], c[i]) - l[i]) / r >= 0.6 and abs(c[i] - o[i]) / r <= 0.3 and (h[i] - max(o[i], c[i])) / r <= 0.15

def week_feats(W):
    o, h, l, c, v = (W[k].to_numpy(float) for k in "ohlcv"); n = len(c)
    sma10, sma30 = pd.Series(c).rolling(10).mean().to_numpy(), pd.Series(c).rolling(30).mean().to_numpy()
    F = [dict() for _ in range(n + 1)]       # F[k] = 확정 주 0..k-1 로 계산한 값
    for k in range(10, n + 1):
        f = F[k]; j = k - 1
        if k >= 9:
            rr = []
            for a in (k - 9, k - 6, k - 3):
                hh, ll = h[a:a + 3].max(), l[a:a + 3].min(); rr.append((hh - ll) / hh)
            f["vcp"] = rr[0] > rr[1] > rr[2] and rr[2] <= 0.10
        f["side4"] = (c[k - 4:k].max() - c[k - 4:k].min()) / c[k - 4:k].min() <= 0.08
        cup = None
        for N in range(7, min(30, k) + 1):
            s0 = k - N; t3 = N // 3
            L = h[s0:s0 + t3].max(); B = l[s0 + t3:k - t3].min() if k - t3 > s0 + t3 else np.nan; R = h[k - t3:k].max()
            if not (B == B): continue
            d = 1 - B / L
            if 0.12 <= d <= 0.35 and R >= 0.9 * L and c[j] < R and l[k - 2:k].min() >= B + 0.5 * (L - B):
                cup = h[s0:k].max(); break
        f["cup"] = cup
        flat = None
        for N in range(5, min(15, k) + 1):
            hh, ll = h[k - N:k].max(), l[k - N:k].min()
            if (hh - ll) / hh <= 0.15: flat = hh; break
        f["flat"] = flat
        f["wein"] = (k >= 34 and sma30[j] > sma30[j - 4] and c[j] > sma30[j] and (h[k - 6:k].max() - l[k - 6:k].min()) / h[k - 6:k].max() <= 0.20)
        f["box6"] = h[k - 6:k].max()
        f["tight3"] = (c[k - 3:k].max() - c[k - 3:k].min()) / c[k - 3:k].min() <= 0.03
        f["hi3"] = h[k - 3:k].max()
        f["pull"] = c[j] > sma10[j] and 0.85 <= c[j] / c[k - 9:k - 1].max() <= 0.95 if k >= 9 else False
        f["wrev"] = hammer(o, h, l, c, j) or engulf_up(o, c, j)
        fb = None
        for jj in (j, j - 1):
            if jj >= 10:
                lv = h[jj - 10:jj].max()
                if h[jj] > lv and c[jj] < lv: fb = lv; break
        f["fail"] = fb
        f["wvol"] = v[j] >= 2 * v[j - 10:j].mean()
    return F

def month_feats(M):
    o, h, l, c = (M[k].to_numpy(float) for k in "ohlc"); n = len(c); sma = pd.Series(c).rolling(10).mean().to_numpy()
    F = [dict() for _ in range(n + 1)]
    for k in range(1, n + 1):
        j = k - 1; f = F[k]
        f["up"] = k >= 13 and c[j] > sma[j] and sma[j] > sma[j - 3]
        f["flat"] = k >= 4 and abs(c[j] / c[j - 3] - 1) < 0.10
        f["engulf"] = engulf_up(o, c, j)
        f["hizone"] = k >= 12 and c[j] >= 0.9 * h[k - 12:k].max()
        r = h[j] - l[j]
        f["hot"] = (c[j] / o[j] - 1) >= 0.25 and r > 0 and (h[j] - max(o[j], c[j])) / r >= 0.30
    return F

def main():
    wl = ss.watchlist(); q = tr.fetch("QQQ"); q200 = q["Close"].rolling(200).mean()
    regime = {str(d.date()): ("up" if cl >= m else "down") for d, cl, m in zip(q.index, q["Close"], q200) if not np.isnan(m)}
    ev = []; base = []
    for t in wl:
        df = tr.fetch(t)
        if df is None or len(df) < 600: continue
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        N = len(c); dates = [str(x.date()) for x in df.index]; kr = t.endswith((".KS", ".KQ")); cost = 0.30 if kr else 0.10; lev = t in LEV
        W = bars(df, "W-FRI")
        try: M = bars(df, "ME")
        except (ValueError, KeyError): M = bars(df, "M")          # pandas 2.2 미만
        # 무결성: 신호일이 속한 주·달은 확정 봉에서 빠져야 한다(미래 누수 방지)
        WF, MF = week_feats(W), month_feats(M)
        wk_lab = df.index.to_period("W-FRI").end_time.normalize(); mo_lab = df.index.to_period("M").end_time.normalize()
        wpos = np.searchsorted(W.index.values, wk_lab.values)          # 이번 주 위치 = 그 앞까지가 확정 주
        mpos = np.searchsorted(M.index.values, mo_lab.values)
        vs = pd.Series(v).shift(1).rolling(20).mean().to_numpy(); vr = v / np.where(vs > 0, vs, np.nan)
        hi20 = pd.Series(h).shift(1).rolling(20).max().to_numpy(); hi5 = pd.Series(h).shift(1).rolling(5).max().to_numpy()
        ma10 = pd.Series(c).rolling(10).mean().to_numpy()
        down = np.r_[False, c[1:] < c[:-1]]
        K = cc.features(o, h, l, c)[0]
        ser = pf.flag_series(o, h, l, c, v, t); site = np.zeros(N, bool)
        for code, (kind, _) in pf.CODES.items():
            if code in ser and kind in ("bounce", "theme_buy"): site |= ser[code]
        o1 = np.r_[o[1:], np.nan]
        fw = {}; adv = {}
        for k in HS:
            f = np.full(N, np.nan); f[:N - k] = (c[k:] / o1[:N - k] - 1) * 100; fw[k] = f
            lo_ = pd.Series(l[::-1]).rolling(k).min().to_numpy()[::-1]; hi_ = pd.Series(h[::-1]).rolling(k).max().to_numpy()[::-1]
            a_lo = np.full(N, np.nan); a_hi = np.full(N, np.nan)
            a_lo[:N - k] = (lo_[1:N - k + 1] / o1[:N - k] - 1) * 100; a_hi[:N - k] = (hi_[1:N - k + 1] / o1[:N - k] - 1) * 100
            adv[k] = (a_lo, a_hi)
        cross = lambda lv, i: lv is not None and lv == lv and c[i] > lv and c[i - 1] <= lv
        last = {}
        for i in range(260, N - 21):
            rg = regime.get(dates[i], "")
            if i % 3 == 0: base.append((dates[i], rg, lev, cost, [fw[k][i] for k in HS]))
            wf = WF[wpos[i]] if wpos[i] < len(WF) else {}; mf = MF[mpos[i]] if mpos[i] < len(MF) else {}
            if not wf or not mf: continue
            d = {}
            brk20 = cross(hi20[i], i) and vr[i] >= 1.5
            d[1] = (brk20, mf.get("up") and wf.get("vcp"))
            pp = c[i] > o[i] and c[i] >= ma10[i] and l[i] <= ma10[i] * 1.02 and down[i - 10:i].any() and v[i] > v[i - 10:i][down[i - 10:i]].max()
            d[2] = (pp, mf.get("up") and wf.get("side4"))
            d[3] = (wf.get("cup") is not None and cross(wf["cup"], i) and vr[i] >= 1.4, mf.get("up"))
            d[4] = (wf.get("flat") is not None and cross(wf["flat"], i) and vr[i] >= 1.4, mf.get("up") or mf.get("flat"))
            d[5] = (cross(wf.get("box6"), i) and c[i] > hi20[i] and vr[i] >= 1.5, mf.get("up") and wf.get("wein"))
            d[6] = (cross(wf.get("hi3"), i) and vr[i] >= 1.3, mf.get("up") and wf.get("tight3"))
            d[7] = ((K["HAMMER"][i] or K["BENGULF"][i]) and vr[i] >= 1.2, mf.get("up") and wf.get("pull"))
            d[8] = (cross(hi5[i], i) and vr[i] >= 1.5, mf.get("engulf") and wf.get("wrev"))
            fb = wf.get("fail"); d[9] = (fb is not None and c[i] < fb * 0.97 and c[i - 1] >= fb * 0.97 and vr[i] >= 1.3, mf.get("hizone"))
            d[10] = (K["SENGULF"][i] and vr[i] >= 1.5, mf.get("hot") and wf.get("wvol"))
            d[0] = (bool(site[i]), True)
            for p, (daily, ctx) in d.items():
                for var, on in (("조합", daily and ctx), ("일봉만", daily)):
                    if p == 0 and var == "일봉만": continue
                    if not on: continue
                    key = (t, p, var)
                    if i - last.get(key, -99) < 10: continue
                    last[key] = i
                    dn = p in DOWN
                    ev.append((p, var, dates[i], rg, lev, cost, [fw[k][i] for k in HS], [(adv[k][1][i] if dn else adv[k][0][i]) for k in HS]))
    cut = sorted({b[0] for b in base})[-504]
    print(f"■ 월봉·주봉·일봉·거래량 10개 패턴 · 관심종목 {len(wl)}개 10년 · 학습 ~{cut} · 검증(미사용) {cut}~ · 다음 날 시가 · 비용 미 0.10%·국 0.30% · 10일 중복 제거")
    def bstat(rows, rg_list, j, dn):
        pool = {}
        for g in ("up", "down"):
            xs = [b[4][j] for b in rows if b[1] == g]
            pool[g] = (np.mean([(x < 0) if dn else (x > 0) for x in xs]) * 100, np.mean([(-x if dn else x) - b_cost for x, b_cost in zip(xs, [b[3] for b in rows if b[1] == g])])) if xs else (np.nan, np.nan)
        ok = [g for g in rg_list if g in pool]
        return np.mean([pool[g][0] for g in ok]) if ok else np.nan, np.mean([pool[g][1] for g in ok]) if ok else np.nan
    def stat(rows, j, dn):
        if not rows: return None
        x = np.array([r[6][j] for r in rows]); cst = np.array([r[5] for r in rows]); pnl = (-x if dn else x) - cst
        hit = np.mean(x < 0 if dn else x > 0) * 100; gains, losses = pnl[pnl > 0].sum(), -pnl[pnl < 0].sum()
        return dict(n=len(rows), hit=hit, avg=pnl.mean(), pf=(gains / losses if losses > 0 else np.inf), mae=np.median([r[7][j] for r in rows]))
    res = []
    for lev in (False, True):
        bpart = {"학습": [b for b in base if b[2] == lev and b[0] < cut], "검증": [b for b in base if b[2] == lev and b[0] >= cut]}
        print(f"\n{'━━ 레버리지 ETF (별도)' if lev else '━━ 일반 종목(레버리지 제외)'}")
        for p in range(0, 11):
            dn = p in DOWN; nm = NAMES.get(p, "기존 사이트 캔들·패턴 매수")
            for var in (("조합",) if p == 0 else ("조합", "일봉만")):
                rows = [e for e in ev if e[0] == p and e[1] == var and e[4] == lev]
                trn = [e for e in rows if e[2] < cut]; tst = [e for e in rows if e[2] >= cut]
                if not trn: print(f"  {nm} [{var}] 학습 표본 0"); continue
                best = None
                for j, k in enumerate(HS):
                    s = stat(trn, j, dn); b, _ = bstat(bpart["학습"], {e[3] for e in trn}, j, dn)
                    if s and s["n"] >= 10 and (best is None or s["hit"] - b > best[2]): best = (j, k, s["hit"] - b)
                if best is None: print(f"  {nm} [{var}] 학습 표본 10건 미만"); continue
                j, k, edge_tr = best
                s1, s2 = stat(trn, j, dn), stat(tst, j, dn)
                b2, ba2 = bstat(bpart["검증"], {e[3] for e in tst} or {"up"}, j, dn)
                if s2:
                    z = (s2["hit"] - b2) / np.sqrt(b2 * (100 - b2) / s2["n"]) if b2 == b2 else np.nan
                    ok = s2["n"] >= 30 and s2["hit"] >= b2 + 5 and s2["avg"] > ba2 and edge_tr > 0 and z >= 3.0
                    verdict = "✅ 채택 후보" if ok else ("🟡 희귀 후보" if 10 <= s2["n"] < 30 and s2["hit"] >= b2 + 5 and edge_tr > 0 else "❌")
                else:
                    z, verdict = np.nan, "❌ 검증 표본 0"
                print(f"  {nm} [{var}] 유리한 기간 {k}일 · 학습 {s1['hit']:.0f}%(평소+{edge_tr:.0f}) n={s1['n']} · "
                      + (f"검증 {s2['hit']:.0f}% vs 평소 {b2:.0f}% · 비용 뒤 평균 {s2['avg']:+.2f}%(평소 {ba2:+.2f}%) · 손익비 {s2['pf']:.2f} · 최대 중간 하락 {s2['mae']:+.1f}% · n={s2['n']} · z {z:+.1f}"
                         if s2 else "검증 표본 0") + f" → {verdict}{' · 70%↑' if s2 and s2['hit'] >= 70 else ''}")
                if not lev and var == "조합" and p > 0: res.append((nm, k, s2, b2, ba2, verdict))
    print("\n■ 요약 (일반 종목 · 조합 · 검증 구간 · 유리한 기간은 학습에서 고름)")
    print("  패턴 / 기간 / 승률 / 평소 / 비용 뒤 평균 / 최대 중간 하락 / 표본 / 검증")
    for nm, k, s2, b2, ba2, vd in res:
        print(f"  {nm} / {k}일 / " + (f"{s2['hit']:.0f}% / {b2:.0f}% / {s2['avg']:+.2f}% / {s2['mae']:+.1f}% / {s2['n']} / {vd}" if s2 else f"— / — / — / — / 0 / {vd}"))

if __name__ == "__main__":
    main()
