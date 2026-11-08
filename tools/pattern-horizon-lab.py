"""캔들·패턴 위젯 신호는 며칠 관점인가 — 1·2·3·5·10·20일 뒤 적중률을 평소와 비교 (읽기 전용)

왜 (2026-11-08 사용자: "캔들 옆 '오늘 할 일'보다는 '초단기 관점'이 낫지 않나 — 캔들 패턴은 보통 하루이틀 관점 아냐? 맞으면 맞게, 아니면 반박")
대상: 화면 '🕯 캔들·패턴 신호' 위젯에 뜨는 코드(index.html PAT_INFO) — pattern_flags.flag_series() 그대로
진입 = 신호 다음 날 시가 · h일 뒤 종가(h=1이면 다음 날 시가→다음 날 종가) · 같은 종목·코드 10일 쿨다운 · 보합 ±1% 제외
적중 = 매수 쪽(bounce·theme_buy) 상승, 경고 쪽(trim·risk·danger) 하락 · 평소 = 같은 종목 모든 날(같은 진입 규칙)
관심종목 10년 (생존 편향 있음)
"""
import importlib.util, sys
import numpy as np
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)
import pattern_flags as pf
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py"); ss = _load("ss", "signal-stats.py")
HS = (1, 2, 3, 5, 10, 20)
GROUPS = {"매수 쪽(살 만함)": ("bounce", "theme_buy"), "경고 쪽(조금 팔기·비중 줄이기·사지 마)": ("trim", "risk", "danger")}

def main():
    wl = ss.watchlist(); ev = {}; base = {h: [0, 0] for h in HS}
    for t in wl:
        df = tr.fetch(t)
        if df is None or len(df) < 300: continue
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        N = len(c); ser = pf.flag_series(o, h, l, c, v, t)
        fw = {}
        for k in HS:
            f = np.full(N, np.nan); f[:N - k] = (c[k:] / np.r_[o[1:], np.nan][:N - k] - 1) * 100; fw[k] = f
        ok = (np.arange(N) >= 260) & ~np.isnan(fw[20])
        for i in np.nonzero(ok)[0]:
            for k in HS:
                x = fw[k][i]; base[k][0] += x > 1; base[k][1] += x < -1
        for code, (kind, _nm) in pf.CODES.items():
            if kind not in ("bounce", "theme_buy", "trim", "risk", "danger") or code not in ser: continue
            last = -10 ** 9
            for i in np.nonzero(ser[code] & ok)[0]:
                if i - last < 10: continue
                last = i; ev.setdefault(code, []).append([fw[k][i] for k in HS])
    bu = {k: base[k][0] / (base[k][0] + base[k][1]) * 100 for k in HS}
    print(f"■ 캔들·패턴 위젯 신호의 관점(며칠 뒤가 가장 잘 맞나) · 관심종목 {len(wl)}개 10년 · 다음 날 시가 진입 · 보합 ±1% 제외")
    print("  평소 상승 비율 " + " · ".join(f"{k}일 {bu[k]:.0f}%" for k in HS))
    for gname, kinds in GROUPS.items():
        up = kinds[0] in ("bounce", "theme_buy")
        rows = [x for c, xs in ev.items() if pf.CODES[c][0] in kinds for x in xs]
        def edge(xs, j):
            w = sum(r[j] > 1 for r in xs); lo = sum(r[j] < -1 for r in xs)
            if not w + lo: return None, None
            hit = (w if up else lo) / (w + lo) * 100; b = bu[HS[j]] if up else 100 - bu[HS[j]]
            return hit, hit - b
        print(f"\n  [{gname}] 전체 {len(rows)}건 — 적중%(평소 대비 %p) · 평균 수익")
        cells = []
        for j, k in enumerate(HS):
            hh, e = edge(rows, j); avg = np.nanmean([r[j] for r in rows])
            cells.append(f"{k}일 {hh:.0f}%({e:+.0f}) {avg:+.1f}%")
        print("    " + " · ".join(cells))
        for c in sorted({c for c in ev if pf.CODES[c][0] in kinds}):
            xs = ev[c]
            if len(xs) < 30: continue
            cs = []
            for j, k in enumerate(HS):
                hh, e = edge(xs, j); cs.append(f"{k}일 {hh:.0f}({e:+.0f})")
            best = max(range(len(HS)), key=lambda j: edge(xs, j)[1] if edge(xs, j)[1] is not None else -99)
            print(f"    {c:<10} n={len(xs):<5} " + " · ".join(cs) + f"  ← 평소 대비 가장 큰 날: {HS[best]}일")

if __name__ == "__main__":
    main()
