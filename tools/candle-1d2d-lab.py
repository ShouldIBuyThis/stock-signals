"""캔들 비중을 높이면 초단기(1~2거래일) 예측이 좋아지나 — A/B/C/D 비교 (읽기 전용 · 화면·산식·등급 변경 없음)

왜 (2026-11-08 사용자: 기존 캔들·패턴 신호는 3~20일에서 효과 → 캔들 비중을 높이면 1~2일 예측력이 개선되는지 별도 연구)

━━ 사전 등록 (결과 보기 전 커밋 · 가중치·문턱·비용 고정) ━━
대상: 관심종목 전체(미국+국장) 10년 야후 일봉 · 같은 종목·같은 기간으로 네 방식 비교.
캔들 점수 Cs(그날 봉, 위치 무시 — 교과서 방향): 상승 +1 = 망치꼴·역망치꼴·상승장악·샛별·장대양봉·긴 아랫꼬리·갭상승(시가>전일 고가)
                                              하락 −1 = 하락장악·석별·장대음봉·긴 윗꼬리·갭하락(시가<전일 저가)
                                              0 = 장족도지·고파동·도지·팽이 (정의는 tools/candle-context-lab.py features())
  Cs = (상승 수 − 하락 수)를 −1~+1로 자름.
기술 점수 Ts = 아래 셋의 평균(각 +1/0/−1): 볼밴 위치(하단 20% 안 +1, 상단 20% 안 −1) · 스토캐스틱(14,3) K≤20에서 D 상향 돌파 +1, K≥80에서 하향 −1 ·
  RSI14 ≤30 +1, ≥70 −1.
방식: A = Cs만 · B = 기존 사이트 캔들·패턴 판정(pattern_flags: 반등·테마 매수 = 상승, 익절·위험·하락 = 하락) ·
      C = 0.5·Cs + 0.5·Ts · D = 0.75·Cs + 0.25·Ts.   A·C·D는 점수 ≥ +0.5 상승 예측, ≤ −0.5 하락 예측.
진입 = 신호 확정 다음 날 시가 · 평가 = 1·2거래일 뒤 종가 · 비용(왕복, 슬리피지 포함) 미국 0.10% · 국장 0.30%.
적중: 상승 예측 = 수익>0, 하락 예측 = 수익<0. 기대수익: 상승 예측은 (수익 − 비용), 하락 예측은 (−수익 − 비용, 공매도 가정·참고용).
최대 불리 움직임: 상승 예측은 보유 중 최저가, 하락 예측은 최고가 (진입가 대비).
중복 제거: 같은 종목·같은 방식·같은 방향은 3거래일 안 첫 신호만.
평소 = 모든 종목·날(같은 진입·비용). 기간: 앞 반 · 뒤 반 · 최근 20%(미사용 검증 — 가중치는 미리 고정했으므로 고른 것이 없음).
신호 수 착시 방지: 방식마다 신호 수·평소 대비 개선 폭·신호당 기대수익·합계 기대수익을 함께 보고, B와 D가 같은 날 같은 종목에 낸 공통 신호끼리도 비교.
캔들×위치: 각 캔들 × (볼밴 상단·하단 / RSI≥70·≤30 / 직전 5일 +10%↑·−10%↓) 1·2일 뒤 상승 비율 — 반전/지속 구분, 30건↑ 사용 · 10~29건 소표본 표시.
  여러 칸을 동시에 보므로 우연 착시가 크다(합성 무작위 데이터에서도 30~50건 칸이 ±15%p 나왔다) → |z|≥3 ∧ 앞뒤 같은 방향일 때만 '의미 있음'.
테마: 나스닥 대형(빅테크·소프트웨어) · 반도체(GPU·메모리·파운드리) · 주택 · 양자 · 데이터센터 · 그 밖.
편입/제외: 최근 60거래일 B(상승 예측) vs D(상승 예측)의 종목 차이와 그 신호들의 2일 성과.
"""
import importlib.util, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)
import pattern_flags as pf
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py"); ss = _load("ss", "signal-stats.py"); cc = _load("cc", "candle-context-lab.py")
BULL = ["HAMMER", "INVHAM", "BENGULF", "MSTAR", "BIGBULL", "LLOWER"]; BEAR = ["SENGULF", "ESTAR", "BIGBEAR", "LUPPER"]
THEME = {"빅테크": "나스닥 대형", "소프트웨어": "나스닥 대형", "반도체·GPU": "반도체", "반도체·메모리": "반도체", "반도체·파운드리": "반도체",
         "주택": "주택", "양자컴퓨팅": "양자", "데이터센터": "데이터센터"}
KNAME = dict(cc.KNAME, GAPUP="갭상승", GAPDN="갭하락")

def stoch(h, l, c, n=14, d=3):
    hh = pd.Series(h).rolling(n).max(); ll = pd.Series(l).rolling(n).min()
    k = ((pd.Series(c) - ll) / (hh - ll) * 100).rolling(d).mean(); return k.to_numpy(), k.rolling(d).mean().to_numpy()

def main():
    wl = ss.watchlist(); rec = []      # (method, dir, ticker, date_idx_global, theme, r1, r2, mae1, mae2, cost)
    base = []; ctx_rows = []
    for t, cat in wl.items():
        df = tr.fetch(t)
        if df is None or len(df) < 320: continue
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        N = len(c); dates = [str(x.date()) for x in df.index]; kr = t.endswith((".KS", ".KQ")); cost = 0.30 if kr else 0.10
        K, Z, R, T, *_ = cc.features(o, h, l, c)
        ph, pl = np.r_[np.nan, h[:-1]], np.r_[np.nan, l[:-1]]
        K = dict(K); K["GAPUP"] = np.nan_to_num(o > ph).astype(bool); K["GAPDN"] = np.nan_to_num(o < pl).astype(bool)
        cs = np.clip(sum(K[x].astype(int) for x in BULL + ["GAPUP"]) - sum(K[x].astype(int) for x in BEAR + ["GAPDN"]), -1, 1).astype(float)
        m20 = pd.Series(c).rolling(20).mean().to_numpy(); sd = pd.Series(c).rolling(20).std().to_numpy()
        with np.errstate(invalid="ignore", divide="ignore"):
            pos = (c - (m20 - 2 * sd)) / (4 * sd)
        sk, sdd = stoch(h, l, c); skp, sdp = np.r_[np.nan, sk[:-1]], np.r_[np.nan, sdd[:-1]]
        bb = np.where(pos <= 0.2, 1, np.where(pos >= 0.8, -1, 0))
        st = np.where((skp <= 20) & (skp <= sdp) & (sk > sdd), 1, np.where((skp >= 80) & (skp >= sdp) & (sk < sdd), -1, 0))
        rs = np.where(R <= 30, 1, np.where(R >= 70, -1, 0))
        ts = (bb + st + rs) / 3.0
        ser = pf.flag_series(o, h, l, c, v, t)
        bu = np.zeros(N, bool); bd = np.zeros(N, bool)
        for code, (kind, _) in pf.CODES.items():
            if code in ser:
                if kind in ("bounce", "theme_buy"): bu |= ser[code]
                elif kind in ("trim", "risk", "danger"): bd |= ser[code]
        meth = {"A": cs, "C": 0.5 * cs + 0.5 * ts, "D": 0.75 * cs + 0.25 * ts}
        o1 = np.r_[o[1:], np.nan]
        r1 = np.full(N, np.nan); r2 = np.full(N, np.nan); lo1 = np.full(N, np.nan); lo2 = np.full(N, np.nan); hi1 = np.full(N, np.nan); hi2 = np.full(N, np.nan)
        r1[:N - 1] = (c[1:] / o1[:N - 1] - 1) * 100; r2[:N - 2] = (c[2:] / o1[:N - 2] - 1) * 100
        lo1[:N - 1] = (l[1:] / o1[:N - 1] - 1) * 100; hi1[:N - 1] = (h[1:] / o1[:N - 1] - 1) * 100
        lo2[:N - 2] = (np.minimum(l[1:N - 1], l[2:]) / o1[:N - 2] - 1) * 100; hi2[:N - 2] = (np.maximum(h[1:N - 1], h[2:]) / o1[:N - 2] - 1) * 100
        ok = (np.arange(N) >= 260) & ~np.isnan(r2)
        th = THEME.get(cat, "그 밖")
        for i in np.nonzero(ok)[0][::3]: base.append((dates[i], th, r1[i], r2[i], cost))
        sig = {"A": (meth["A"] >= 0.5, meth["A"] <= -0.5), "B": (bu & ~bd, bd & ~bu), "C": (meth["C"] >= 0.5, meth["C"] <= -0.5), "D": (meth["D"] >= 0.5, meth["D"] <= -0.5)}
        for mname, (mu, md) in sig.items():
            for dname, m in (("up", mu), ("dn", md)):
                last = -99
                for i in np.nonzero(m & ok)[0]:
                    if i - last < 3: continue
                    last = i
                    if dname == "up": rec.append((mname, dname, t, dates[i], th, r1[i], r2[i], lo1[i], lo2[i], cost))
                    else: rec.append((mname, dname, t, dates[i], th, r1[i], r2[i], hi1[i], hi2[i], cost))
        ctxs = {"볼밴 상단": Z["NEAR_UP"] | Z["OUT_UP"], "볼밴 하단": Z["NEAR_LO"] | Z["OUT_LO"] | Z["REENTRY"], "RSI≥70": np.nan_to_num(R) >= 70,
                "RSI≤30": np.nan_to_num(R, nan=50) <= 30, "직전 급등": T["급등"], "직전 급락": T["급락"]}
        for kname in list(cc.CANDLES) + ["GAPUP", "GAPDN"]:
            for cn, cm in ctxs.items():
                last = -99
                for i in np.nonzero(K[kname] & np.nan_to_num(cm).astype(bool) & ok)[0]:
                    if i - last < 3: continue
                    last = i; ctx_rows.append((kname, cn, dates[i], r1[i], r2[i]))
    alld = sorted({b[0] for b in base}); mid, cut = alld[len(alld) // 2], alld[int(len(alld) * 0.8)]
    B1 = np.mean([b[2] > 0 for b in base]) * 100; B2 = np.mean([b[3] > 0 for b in base]) * 100
    bavg1 = np.mean([b[2] - b[4] for b in base]); bavg2 = np.mean([b[3] - b[4] for b in base])
    def S(rows, d):
        if not rows: return None
        up = d == "up"; r1 = np.array([r[5] for r in rows]); r2 = np.array([r[6] for r in rows]); cst = np.array([r[9] for r in rows])
        hit1 = np.mean(r1 > 0 if up else r1 < 0) * 100; hit2 = np.mean(r2 > 0 if up else r2 < 0) * 100
        ex1 = np.mean((r1 if up else -r1) - cst); ex2 = np.mean((r2 if up else -r2) - cst)
        mae = np.median([r[8] for r in rows])
        return dict(n=len(rows), h1=hit1, h2=hit2, e1=ex1, e2=ex2, mae=mae, b1=(B1 if up else 100 - B1), b2=(B2 if up else 100 - B2))
    f = lambda s: "표본 0" if not s else (f"n={s['n']:<6} 1일 {s['h1']:3.0f}%({s['h1']-s['b1']:+.0f}) 2일 {s['h2']:3.0f}%({s['h2']-s['b2']:+.0f})"
                                          f" · 기대수익(비용 뒤) 1일 {s['e1']:+.2f}% 2일 {s['e2']:+.2f}% · 합계 2일 {s['e2']*s['n']:+.0f}%p · 최대불리 중간(2일) {s['mae']:+.1f}%")
    print(f"■ 초단기(1~2일) 캔들 가중치 비교 · {alld[0]}~{alld[-1]} · 관심종목 {len(wl)}개 · 다음 날 시가 진입 · 비용 미 0.10%·국 0.30% · 3일 중복 제거")
    print(f"  평소: 1일 상승 {B1:.0f}% · 2일 {B2:.0f}% · 비용 뒤 평균 1일 {bavg1:+.2f}% 2일 {bavg2:+.2f}%  (칸 = 적중%(평소 대비 %p))")
    names = {"A": "A 캔들만", "B": "B 기존 사이트", "C": "C 캔들50+지표50", "D": "D 캔들75+지표25"}
    for d, dl in (("up", "상승 예측"), ("dn", "하락 예측(참고)")):
        print(f"\n  [{dl}] 전체")
        for m in "ABCD": print(f"    {names[m]:<16} " + f(S([r for r in rec if r[0] == m and r[1] == d], d)))
        print(f"  [{dl}] 기간별 2일 적중%(평소 대비) · 앞 반 / 뒤 반 / 최근 20%(미사용)")
        for m in "ABCD":
            parts = [[r for r in rec if r[0] == m and r[1] == d and cond(r[3])] for cond in (lambda x: x < mid, lambda x: x >= mid, lambda x: x >= cut)]
            cells = []
            for p_ in parts:
                s = S(p_, d); cells.append("—" if not s else f"{s['h2']:.0f}%({s['h2']-s['b2']:+.0f}) n={s['n']} 기대 {s['e2']:+.2f}%")
            print(f"    {names[m]:<16} " + " / ".join(cells))
    # 공통 신호 비교 (B와 D가 같은 종목·같은 날 상승 예측)
    kB = {(r[2], r[3]) for r in rec if r[0] == "B" and r[1] == "up"}; kD = {(r[2], r[3]) for r in rec if r[0] == "D" and r[1] == "up"}
    com = [r for r in rec if r[0] == "D" and r[1] == "up" and (r[2], r[3]) in kB]
    print(f"\n  [공통 신호] B∩D 같은 날 같은 종목 상승 예측: " + f(S(com, "up")))
    print("\n  [테마별 상승 예측 2일 적중%(평소 대비) · 기대수익] B 기존 vs D 캔들75")
    for th in ("나스닥 대형", "반도체", "주택", "양자", "데이터센터", "그 밖"):
        sb = S([r for r in rec if r[0] == "B" and r[1] == "up" and r[4] == th], "up"); sd_ = S([r for r in rec if r[0] == "D" and r[1] == "up" and r[4] == th], "up")
        cell = lambda s: "—" if not s else f"{s['h2']:.0f}%({s['h2']-s['b2']:+.0f}) n={s['n']} 1일 {s['e1']:+.2f}% 2일 {s['e2']:+.2f}%"
        print(f"    {th:<8} B {cell(sb)} | D {cell(sd_)}")
    # 캔들 × 위치
    print("\n  [캔들 × 위치 — 1·2일 뒤 상승 비율(평소 대비) · 30건↑ 상위 · 반전/지속]")
    from collections import defaultdict
    g = defaultdict(list)
    for kname, cn, d, a, b in ctx_rows: g[(kname, cn)].append((d, a, b))
    bull = set(BULL + ["GAPUP"]); bear = set(BEAR + ["GAPDN"])
    def kind(kname, cn):
        lowc = cn in ("볼밴 하단", "RSI≤30", "직전 급락"); hic = cn in ("볼밴 상단", "RSI≥70", "직전 급등")
        if kname in bull: return "상승 반전" if lowc else "상승 지속" if hic else ""
        if kname in bear: return "하락 반전" if hic else "하락 지속" if lowc else ""
        return "중립"
    res = []
    for (kname, cn), xs in g.items():
        if len(xs) < 10: continue
        u1 = np.mean([x[1] > 0 for x in xs]) * 100; u2 = np.mean([x[2] > 0 for x in xs]) * 100
        fr = [x for x in xs if x[0] < mid]; bk = [x for x in xs if x[0] >= mid]
        f2 = np.mean([x[2] > 0 for x in fr]) * 100 if fr else np.nan; b2_ = np.mean([x[2] > 0 for x in bk]) * 100 if bk else np.nan
        z = (u2 - B2) / np.sqrt(B2 * (100 - B2) / len(xs))
        res.append((abs(u2 - B2), kname, cn, len(xs), u1 - B1, u2 - B2, f2 - B2, b2_ - B2, z))
    for big in (True, False):
        sel = sorted([x for x in res if (x[3] >= 30) == big], key=lambda x: -x[0])[:10]
        print(f"    {'30건↑' if big else '10~29건(소표본 · 불확실)'}")
        for _, kname, cn, n_, d1, d2, df_, db_, z in sel:
            same = "앞뒤 같은 방향" if (df_ * db_ > 0) else "앞뒤 엇갈림"
            mean = " ◀의미 있음" if abs(z) >= 3 and df_ * db_ > 0 else ""
            print(f"      {KNAME[kname]:<9} @{cn:<6} n={n_:<5} 1일 {d1:+.0f}%p · 2일 {d2:+.0f}%p (z {z:+.1f}) · {kind(kname, cn):<5} · {same}({df_:+.0f}/{db_:+.0f}){mean}")
    # 편입·제외 (최근 60거래일)
    last60 = alld[-60]
    rb = {(r[2], r[3]): r for r in rec if r[0] == "B" and r[1] == "up" and r[3] >= last60}
    rd = {(r[2], r[3]): r for r in rec if r[0] == "D" and r[1] == "up" and r[3] >= last60}
    add = [rd[k] for k in rd if k not in rb]; rem = [rb[k] for k in rb if k not in rd]; both = [rd[k] for k in rd if k in rb]
    print(f"\n  [최근 60거래일({last60}~) B → D로 바꾸면] 들어오는 신호 {len(add)} · 빠지는 신호 {len(rem)} · 그대로 {len(both)}")
    for nm, xs in (("들어옴", add), ("빠짐", rem), ("그대로", both)):
        s = S(xs, "up")
        if not s: print(f"    {nm}: 없음"); continue
        from collections import Counter
        top = ", ".join(f"{t}({n})" for t, n in Counter(x[2] for x in xs).most_common(8))
        print(f"    {nm} n={s['n']} 2일 적중 {s['h2']:.0f}% · 비용 뒤 2일 {s['e2']:+.2f}% · 자주: {top}")

if __name__ == "__main__":
    main()
