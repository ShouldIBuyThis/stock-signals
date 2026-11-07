"""신고가 비율↑ + 20일선 위 비율↑ + 신저가↓ 동시 발생 → QQQ 10·20일 뒤 상승 확률 (읽기 전용 · 산식·그래프 변경 없음)

왜 (2026-11-07 사용자: "단순 교차보다 신고가 종목 비율 증가 + 20일선 위 종목 비율 상승 + 신저가 감소가 동시에 나타날 때
    QQQ 10·20거래일 뒤 상승 확률이 평소보다 높은지 3년치 · 기준은 결과를 보기 전에 미리 정하고 · 기간을 나눠 재현성·표본·평균수익")

━━ 사전 등록 기준 (이 파일을 결과 보기 전에 커밋했다 — git 이력으로 확인 가능) ━━
대상: 관심종목 미국(main.py WATCHLIST, 국장 제외) — 그래프(backtest/breadth-history.json)와 같은 종목군. 야후 수정주가.
매일 t (그날 종가까지):
  n      = 그날 가격이 있고 252봉 이력이 있는 종목 수
  NH%    = 종가가 252봉 최고가의 1% 안인 종목 / n      (그래프의 신고가권 정의와 같음)
  NL     = 종가가 252봉 최저가의 1% 안인 종목 수
  A20%   = 종가 > 20일 이동평균인 종목 / n
신호 S(t) = 세 조건 모두 (비교 창 W = 5거래일, 크기 문턱 없음 · 미리 고정):
  ① NH%(t) > NH%(t−5)   ② A20%(t) > A20%(t−5)   ③ NL(t) < NL(t−5)
주 결과(미리 고정): QQQ를 신호 다음 날 시가에 사서 10·20거래일 뒤 종가 — 상승(>0) 확률 · 평균 수익률
  · 비교 기준 '평소' = 같은 기간의 모든 날(같은 진입 규칙)
  · 표본: 모든 신호일 / '첫날'(전날은 S 아님) / 10일 중복 제거 — 신호가 며칠 연달아 몰려 표본이 부풀지 않게
  · 재현성: 3년을 1년씩 3구간 + 앞/뒤 반으로 나눠 같은 표
  · 참고(선택 근거로 쓰지 않음): 조건 하나씩 · 둘씩 · 창 W=3/10 · 단순 교차(신저가 우세→신고가 우세)
판정 원칙(미리 고정): 세 구간 모두 평소보다 높고, '첫날' 표본이 30건 이상일 때만 '평소보다 높다'고 보고한다.
기간: 결과 20일이 확정되는 마지막 날까지 거꾸로 756거래일(약 3년).
"""
import importlib.util, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py"); ss = _load("ss", "signal-stats.py")
KS = (10, 20)

def main():
    tks = [t for t in ss.watchlist() if not t.endswith((".KS", ".KQ"))]
    cl = {}
    for t in tks:
        df = tr.fetch(t)
        if df is not None and len(df) > 300: cl[t] = df["Close"]
    C = pd.DataFrame(cl).sort_index()
    q = tr.fetch("QQQ"); qo, qc = q["Open"], q["Close"]
    idx = C.index.intersection(q.index); C = C.loc[idx]; qo, qc = qo.loc[idx].to_numpy(), qc.loc[idx].to_numpy()
    hi = C.rolling(252, min_periods=252).max(); lo = C.rolling(252, min_periods=252).min(); ma20 = C.rolling(20).mean()
    valid = hi.notna() & C.notna()
    n = valid.sum(axis=1).to_numpy().astype(float)
    nh = ((C >= hi * 0.99) & valid).sum(axis=1).to_numpy(); nl = ((C <= lo * 1.01) & valid).sum(axis=1).to_numpy()
    a20 = ((C > ma20) & valid).sum(axis=1).to_numpy()
    with np.errstate(invalid="ignore", divide="ignore"):
        NHp, A20p = nh / n, a20 / n
    dates = [str(d.date()) for d in C.index]; N = len(dates)
    def S(i, W=5, use=(1, 1, 1)):
        if i - W < 0 or n[i] < 20 or n[i - W] < 20: return False
        c = [NHp[i] > NHp[i - W], A20p[i] > A20p[i - W], nl[i] < nl[i - W]]
        return all(cc for cc, u in zip(c, use) if u)
    end = N - 21; start = max(260, end - 756)
    days = list(range(start, end + 1))
    ret = {k: np.array([(qc[i + k] / qo[i + 1] - 1) * 100 for i in range(N - k - 1)] + [np.nan] * (k + 1)) for k in KS}
    def stat(ix):
        return [((np.mean(ret[k][ix] > 0) * 100) if len(ix) else np.nan, (np.mean(ret[k][ix]) if len(ix) else np.nan)) for k in KS]
    def fresh(ix, Sx):
        return [i for i in ix if not Sx(i - 1)]
    def cool(ix, g=10):
        o = []
        for i in ix:
            if not o or i - o[-1] >= g: o.append(i)
        return o
    segs = [days[:252], days[252:504], days[504:]]
    half = [days[:len(days) // 2], days[len(days) // 2:]]
    f = lambda v: "  —" if v != v else f"{v:3.0f}"
    g = lambda v: "   —" if v != v else f"{v:+.1f}"
    def line(nm, ix):
        st = stat(ix); return f"  {nm:<30} n={len(ix):<4} " + " · ".join(f"{k}일 상승 {f(a)}% 평균 {g(b)}%" for k, (a, b) in zip(KS, st))
    print(f"■ 신고가 비율↑ + 20일선 위 비율↑ + 신저가↓ (W=5) · {dates[days[0]]}~{dates[days[-1]]} ({len(days)}거래일) · 관심종목 미국 {len(cl)}개 · QQQ 다음 날 시가 진입")
    base = days; sig = [i for i in days if S(i)]
    fr = fresh(sig, S); cl10 = cool(sig)
    print(line("평소(모든 날)", base)); print(line("신호 S 모든 날", sig)); print(line("신호 S 첫날", fr)); print(line("신호 S 10일 중복 제거", cl10))
    print("\n  [재현성 — 1년씩 3구간 · 앞/뒤 반]  (평소 → 신호 모든 날 → 첫날)")
    for nm, seg in [(f"구간{j+1} {dates[s_[0]]}~{dates[s_[-1]]}", s_) for j, s_ in enumerate(segs)] + [("앞 반", half[0]), ("뒤 반", half[1])]:
        st0, st1, st2 = stat(seg), stat([i for i in sig if i in set(seg)]), stat([i for i in fr if i in set(seg)])
        n1, n2 = len([i for i in sig if i in set(seg)]), len([i for i in fr if i in set(seg)])
        print(f"  {nm:<30} " + " · ".join(f"{k}일 {f(st0[j][0])}%→{f(st1[j][0])}%({n1})→{f(st2[j][0])}%({n2}) 평균 {g(st0[j][1])}→{g(st1[j][1])}→{g(st2[j][1])}" for j, k in enumerate(KS)))
    print("\n  [참고 — 선택 근거로 쓰지 않음]")
    for nm, use in (("① 신고가 비율↑만", (1, 0, 0)), ("② 20일선 위 비율↑만", (0, 1, 0)), ("③ 신저가↓만", (0, 0, 1)),
                    ("①+②", (1, 1, 0)), ("①+③", (1, 0, 1)), ("②+③", (0, 1, 1))):
        Sx = lambda i, u=use: S(i, 5, u); ix = [i for i in days if Sx(i)]
        print(line(nm, ix) + f" · 첫날 {len(fresh(ix, Sx))}건")
    for W in (3, 10):
        Sx = lambda i, w=W: S(i, w); ix = [i for i in days if Sx(i)]
        print(line(f"세 조건 W={W}", ix) + f" · 첫날 {len(fresh(ix, Sx))}건 → " + " · ".join(f"{k}일 {f(a)}%" for k, (a, b) in zip(KS, stat(fresh(ix, Sx)))))
    sg = np.sign(nh - nl); lastsg = np.zeros(N); cur = 0
    for i in range(N): lastsg[i] = cur; cur = sg[i] or cur
    xu = [i for i in days if sg[i] > 0 and lastsg[i] < 0 and not (nh[i - 1] == 0 and nl[i - 1] == 0)]
    print(line("단순 교차(신저가→신고가 우세)", xu))
    ok = all(stat([i for i in fr if i in set(s_)])[j][0] > stat(s_)[j][0] for s_ in segs for j in range(len(KS))) and len(fr) >= 30
    print(f"\n  사전 판정 원칙(세 구간 모두 평소보다 높음 ∧ 첫날 30건↑): {'충족' if ok else '미충족'}")

if __name__ == "__main__":
    main()
