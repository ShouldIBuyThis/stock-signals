"""'살 만함' 캔들·패턴 신호 중 그날 캔들 모양이 🟢(반등 쪽)인 것만 남기면 적중률이 오르나 — 원본 수집 (읽기 전용, CI 전용)

2026-11-09 사용자 질문: "캔들패턴신호 중 캔들형태가 초록불만 있는 신호만 살 만함으로 하면 승률이 얼마나 올라가?"
사전 정의(결과 보기 전 커밋):
- 대상 = 화면 '🕯 캔들·패턴 신호'의 '살 만함'(pattern_flags.CODES 중 bounce·theme_buy) — pattern-horizon-lab.py와 같은 판정
- 단위 = 종목·날짜(그날 살 만함 코드가 하나라도 있으면 1건), 같은 종목 10거래일 쿨다운
- 진입 = 신호 다음 날 시가, h일 뒤 종가(h=3·5·10·20), 보합 ±1% 제외, 평소 = 같은 종목 모든 날(같은 진입 규칙)
- 캔들 색 = 화면의 todayShape()+CANDLE_LIGHT 그대로(Node 쪽 tools/candle-green-lab.js가 index.html에서 추출)
- 관심종목 10년, 생존 편향 있음. 결과를 보고 정의를 바꾸지 않는다.
"""
import argparse, importlib.util, json, sys
import numpy as np
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)
import pattern_flags as pf
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py"); ss = _load("ss", "signal-stats.py")
HS = (3, 5, 10, 20)

ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); a = ap.parse_args()
wl = ss.watchlist(); ev = []; base = {h: [0, 0] for h in HS}; baseHalf = {}
buy_codes = [c for c, (k, _n) in pf.CODES.items() if k in ("bounce", "theme_buy")]
for t in wl:
    df = tr.fetch(t)
    if df is None or len(df) < 300: continue
    o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
    N = len(c); ser = pf.flag_series(o, h, l, c, v, t)
    dates = [d.strftime("%Y-%m-%d") for d in df.index]
    s = np.array(c); ma = np.convolve(s, np.ones(20) / 20, "valid")
    std = np.array([s[i - 19:i + 1].std(ddof=1) for i in range(19, N)])
    bbp = np.full(N, np.nan); bw = 4 * std
    with np.errstate(invalid="ignore", divide="ignore"):
        bbp[19:] = np.where(bw > 0, (s[19:] - (ma - 2 * std)) / bw * 100, np.nan)
    fw = {}
    for k in HS:
        f = np.full(N, np.nan); f[:N - k] = (c[k:] / np.r_[o[1:], np.nan][:N - k] - 1) * 100; fw[k] = f
    ok = (np.arange(N) >= 260) & ~np.isnan(fw[20])
    for i in np.nonzero(ok)[0]:
        y = dates[i][:4]
        for k in HS:
            x = fw[k][i]; base[k][0] += int(x > 1); base[k][1] += int(x < -1)
    hit = np.zeros(N, bool); codes_at = {}
    for code in buy_codes:
        if code in ser:
            m = ser[code] & ok; hit |= m
            for i in np.nonzero(m)[0]: codes_at.setdefault(i, []).append(code)
    last = -10 ** 9
    for i in np.nonzero(hit)[0]:
        if i - last < 10: continue
        last = i
        lo = max(0, i - 15)
        ev.append({"t": t, "d": dates[i], "codes": codes_at[i], "bb": None if np.isnan(bbp[i]) else float(bbp[i]),
                   "ohlc": [[dates[j], float(o[j]), float(h[j]), float(l[j]), float(c[j])] for j in range(lo, i + 1)],
                   "fw": {str(k): float(fw[k][i]) for k in HS}})
    # 평소(날짜별) — 반쪽 비교용으로 날짜와 수익만 남긴다
    for i in np.nonzero(ok)[0]:
        baseHalf[dates[i]] = baseHalf.get(dates[i]) or []
        baseHalf[dates[i]].append([float(fw[k][i]) for k in HS])
json.dump({"hs": HS, "ev": ev, "base": base, "baseDays": {d: x for d, x in baseHalf.items() if x}}, open(a.out, "w"))
print(f"종목 {len(wl)} · 살 만함 사건 {len(ev)}")
