"""패턴 캔들 신호 + 프랙탈 · FVG(페어 밸류 갭) 반전 — 넣으면 승률이 어떻게 되나 (읽기 전용 · 아무 파일도 안 고친다)

왜 (2026-11-06 사용자: "패턴캔들신호에 프랙탈이랑 페어리버셜 활용하면 어케되는지 승률 비교(반영 전 요약 보고)")
정의 — 전부 그날 종가까지 알 수 있는 값만 쓴다(미래 봉 미사용).
  프랙탈(윌리엄스 5봉): j봉 저가가 앞뒤 2봉보다 낮으면 저점 프랙탈. j+2봉 종가에 비로소 확정된다.
    FR_LOW  최근 3거래일 안에 저점 프랙탈이 확정됨(바닥 반전 확인)
    FR_BRK  종가가 직전 확정 고점 프랙탈을 처음 넘음(돌파)
  FVG(3봉 갭): 하락 FVG = h[k] < l[k-2] (k-1봉이 급락하며 비운 구간). 상승 FVG = l[k] > h[k-2].
    FVG_REV 종가가 최근 20봉 안의 하락 FVG 윗변(l[k-2])을 처음 되찾음(하락 갭을 메우고 반전 = 역FVG)
    FVG_UP  오늘 상승 FVG가 생김(강한 상승 이탈)
  패턴 = pattern_flags.flag_series() 그대로(사이트 원장 pat과 같은 함수).
체결 = 신호 다음 날 시가 진입 → n거래일 뒤 종가(signal-stats.py와 같음). 같은 종목·같은 조건 10거래일 쿨다운.
승률 = (+1% 초과)/(+1% 초과 + −1% 미만), 보합 제외(화면 stat()과 같은 규칙). 관심종목 10년 일봉(생존 편향 있음).
사용 python3 tools/fractal-fvg-lab.py   (CI lab-quick — 야후 필요)
"""
import importlib.util, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)
import pattern_flags as pf

def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py")
ss = _load("ss", "signal-stats.py")
H, COOL = (3, 5, 10), 10

def recent(m, k):
    return pd.Series(m.astype(float)).rolling(k, min_periods=1).max().to_numpy() > 0

def feats(o, h, l, c):
    N = len(c)
    frl = np.zeros(N, bool); frh_lvl = np.full(N, np.nan)
    last_hi = np.nan
    for i in range(4, N):
        j = i - 2
        if l[j] < l[j-1] and l[j] < l[j-2] and l[j] < l[j+1] and l[j] < l[j+2]: frl[i] = True
        if h[j] > h[j-1] and h[j] > h[j-2] and h[j] > h[j+1] and h[j] > h[j+2]: last_hi = h[j]
        frh_lvl[i] = last_hi
    prev_lvl = np.r_[np.nan, frh_lvl[:-1]]
    frb = (c > frh_lvl) & ~(np.r_[np.nan, c[:-1]] > prev_lvl) & ~np.isnan(frh_lvl)
    fvg_up = np.zeros(N, bool); fvg_rev = np.zeros(N, bool)
    tops = []                                          # (형성 봉, 윗변) — 아직 되찾지 않은 하락 FVG
    for i in range(2, N):
        if l[i] > h[i-2]: fvg_up[i] = True
        hit = [t for t in tops if c[i] > t[1] and i - t[0] <= 20]
        if hit: fvg_rev[i] = True
        tops = [t for t in tops if not (c[i] > t[1]) and i - t[0] <= 20]
        if h[i] < l[i-2]: tops.append((i, l[i-2]))
    return {"FR_LOW": recent(frl, 3), "FR_BRK": frb, "FVG_REV": recent(fvg_rev, 1), "FVG_UP": fvg_up,
            "FR_LOW_raw": frl, "FVG_REV3": recent(fvg_rev, 3)}

BOUNCE = {"B_STOCH", "B_BBLO", "B_MA5", "B_G520"}
GREEN = {k for k, v in pf.SIGNAL_CODES.items() if v[0] == "green"}
BLUE = {k for k, v in pf.SIGNAL_CODES.items() if v[0] == "blue"}
ALLBUY = BOUNCE | GREEN | BLUE | set(pf.THEME_BUY) | set(pf.RARE_RULES)
TODAY = {"B_MA5", "B_STOCH"}

def any_of(ser, codes, N):
    m = np.zeros(N, bool)
    for k in codes:
        if k in ser: m |= np.asarray(ser[k], bool)
    return m

def main():
    wl = ss.watchlist()
    rows = {}            # 이름 → [(date, r3, r5, r10)]
    names = None
    for t in wl:
        df = tr.fetch(t)
        if df is None or len(df) < 300: continue
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        N = len(c); dates = np.array([str(d.date()) for d in df.index])
        ser = pf.flag_series(o, h, l, c, v, t); F = feats(o, h, l, c)
        o1 = np.full(N, np.nan); o1[:-1] = o[1:]
        fw = {}
        for n in H:
            f = np.full(N, np.nan); f[:-n] = (c[n:] / o1[:-n] - 1) * 100; fw[n] = f
        P = {"오늘 뜬 것(B_MA5∪B_STOCH)": any_of(ser, TODAY, N), "과매도 반등 4종": any_of(ser, BOUNCE, N),
             "🟢 보드 반등 6종": any_of(ser, GREEN, N), "🔵 추세 5종": any_of(ser, BLUE, N), "매수 패턴 전부": any_of(ser, ALLBUY, N)}
        S = {"기준선(5일마다)": np.isin(np.arange(N), np.arange(0, N, 5))}
        for k in ("FR_LOW", "FR_BRK", "FVG_REV", "FVG_UP"): S[f"{k} 단독"] = F[k]
        for pn, pm in P.items():
            S[pn] = pm
            S[f"{pn} ∩ 프랙탈 저점(3일 내)"] = pm & F["FR_LOW"]
            S[f"{pn} ∩ 프랙탈 고점 돌파"] = pm & recent(F["FR_BRK"], 3)
            S[f"{pn} ∩ FVG 반전(3일 내)"] = pm & F["FVG_REV3"]
            S[f"{pn} ∩ (프랙탈 저점 or FVG 반전)"] = pm & (F["FR_LOW"] | F["FVG_REV3"])
            S[f"{pn} ∩ 프랙탈 저점 ∩ FVG 반전"] = pm & F["FR_LOW"] & F["FVG_REV3"]
        names = names or list(S)
        ok = np.arange(N) >= 260
        for nm, m in S.items():
            last = -10 ** 9; cool = 0 if nm.startswith("기준선") else COOL
            for i in np.nonzero(m & ok)[0]:
                if i - last < cool: continue
                if np.isnan(fw[3][i]): continue
                last = i
                rows.setdefault(nm, []).append((dates[i], fw[3][i], fw[5][i], fw[10][i]))
    alld = sorted({r[0] for r in rows["기준선(5일마다)"]})
    mid, cut = alld[len(alld) // 2], alld[int(len(alld) * 0.8)]
    def st(a, j):
        x = [r[j] for r in a if not np.isnan(r[j])]
        w = sum(v > 1 for v in x); lo = sum(v < -1 for v in x)
        return f"{round(w / (w + lo) * 100) if w + lo else '—'}%({len(x)}) {np.mean(x):+.1f}%".ljust(17) if x else "—(0)".ljust(17)
    print(f"■ 패턴 × 프랙탈 · FVG 반전 · {alld[0]}~{alld[-1]} · 관심종목 {len(wl)}개 · 다음 날 시가 진입 · 쿨다운 {COOL}일")
    print(f"  칸 = 승률(표본) 평균수익 · 보합(±1%) 제외 · 앞/뒤 반 경계 {mid} · 최근 20% 시작 {cut}")
    for label, keep in (("전체", lambda d: True), ("앞 반", lambda d: d < mid), ("뒤 반", lambda d: d >= mid), ("최근 20%", lambda d: d >= cut)):
        print(f"\n  [{label}]" + "".ljust(42) + "".join(f"+{n}일".ljust(17) for n in H))
        for nm in names:
            a = [r for r in rows.get(nm, []) if keep(r[0])]
            print("    " + nm.ljust(46) + "".join(st(a, j) for j in (1, 2, 3)))

if __name__ == "__main__":
    main()
