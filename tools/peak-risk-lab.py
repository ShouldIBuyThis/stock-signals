"""고점 위험 3단계 경고 백테스트 + NVDA 확인 — docs/2026-11-10-peak-risk.md. 정의는 pattern_flags 그대로(재구현 없음). CI 전용."""
import importlib.util, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)
import pattern_flags as pf
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py"); bb = _load("bb", "bb-walk-lab.py")
H, COOL = (3, 5, 10), 5
def nvda_now():
    """NVDA는 최신 일봉(오늘까지 확정분)으로 따로 확인 — 백테스트용 fetch는 종료일이 고정돼 있다."""
    import yfinance as yf
    from datetime import datetime
    from zoneinfo import ZoneInfo
    df = yf.Ticker("NVDA").history(period="1y", interval="1d", auto_adjust=False)
    df.index = pd.to_datetime([d.date() for d in df.index])
    ny = datetime.now(ZoneInfo("America/New_York"))
    if len(df) and df.index[-1].date() == ny.date() and ny.hour < 16: df = df.iloc[:-1]      # 진행 중인 봉 제외(확정 일봉만)
    o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
    dates = [str(d.date()) for d in df.index]
    fs = pf.flag_series(o, h, l, c, v, "NVDA"); ps = pf.peak_risk_series(o, h, l, c, fs["X_ESTAR"]); st = ps["stage"]
    print(f"\n■ NVDA 확인(원본 일봉 · 마지막 확정 {dates[-1]}) — 2026-08-01 이후 상단 윗꼬리 날 · 단계 · 석별형")
    for i in range(len(c)):
        if dates[i] < "2026-08-01": continue
        if ps["q"][i] or st[i] or fs["X_ESTAR"][i] or (ps["upw"][i] >= 0.4 and ps["pb_hi"][i] >= 0.9):
            sup = f" · 지지 {ps['sup'][i]:.2f}({ps['sup_src'][i]})" if np.isfinite(ps['sup'][i]) else ""
            brk = f" · 이탈 기준 {ps['brk'][i]:.2f}" if st[i] == 3 else ""
            print(f"  {dates[i]} 시{o[i]:.2f} 고{h[i]:.2f} 저{l[i]:.2f} 종{c[i]:.2f} · 윗꼬리 {ps['upw'][i]*100:.0f}% · 고가 %B {ps['pb_hi'][i]:.2f} · 윗꼬리 날 {'예' if ps['q'][i] else '아니오'} · 단계 {st[i]}{' · 석별형' if fs['X_ESTAR'][i] else ''}{sup}{brk}")
    print("  화면 요약(마지막 확정 일봉 기준):", pf.peak_risk_now(ps, dates, c))

def main():
    nvda_now()
    W = bb.wl_names(); lev = {t for t, (_, nm) in W.items() if any(k.lower() in nm.lower() for k in bb.LEVK) or t in ("SOXL", "NAIL", "TQQQ", "TECL", "UPRO", "SPXL", "FNGU", "LABU", "TNA", "FAS")}
    qq = tr.fetch("QQQ"); q200 = qq["Close"].rolling(200).mean()
    regime = {str(d.date()): ("up" if c >= m else "down") for d, c, m in zip(qq.index, qq["Close"], q200) if not np.isnan(m)}
    variants = {"기본(윗꼬리0.5·%B1.0)": (0.5, 1.0), "윗꼬리0.4": (0.4, 1.0), "윗꼬리0.6": (0.6, 1.0), "%B0.95": (0.5, 0.95), "%B1.05": (0.5, 1.05)}
    ev = {}; base = {}
    for t, (cat, nm) in W.items():
        df = tr.fetch(t)
        if df is None or len(df) < 300: continue
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        N = len(c); dates = np.array([str(d.date()) for d in df.index]); reg = np.array([regime.get(d, "") for d in dates])
        fs = pf.flag_series(o, h, l, c, v, t)
        o1 = np.full(N, np.nan); o1[:-1] = o[1:]
        fw = {n: np.r_[(c[n:] / o1[:-n] - 1) * 100, np.full(n, np.nan)] for n in H}
        ok = (np.arange(N) >= 260) & ~np.isnan(fw[3])
        for vn, (uw, bh) in variants.items():
            ps = pf.peak_risk_series(o, h, l, c, fs["X_ESTAR"], uw, bh); st = ps["stage"]
            if vn.startswith("기본"):
                quiet = pd.Series((st > 0).astype(float)).rolling(5, min_periods=1).max().to_numpy() < 0.5
                for i in np.nonzero(ok & quiet)[0]:
                    b = base.setdefault((cat, reg[i]), np.zeros((len(H), 2)))
                    for j, n in enumerate(H): b[j, 0] += fw[n][i] < -1; b[j, 1] += fw[n][i] > 1
            for k in (1, 2, 3):
                m = (st == k) & ~(np.r_[0, st[:-1]] == k); last = -10 ** 9
                for i in np.nonzero(m & ok)[0]:
                    if i - last < COOL: continue
                    last = i
                    ev.setdefault((vn, k), []).append((dates[i], cat, reg[i], t, "레버리지" if t in lev else "일반") + tuple(fw[n][i] for n in H))
    allrows = [r for v in ev.values() for r in v]; ds = sorted({r[0] for r in allrows}); mid = ds[len(ds) // 2]; t30 = ds[int(len(ds) * 0.7)]
    def dr(vals):
        a = np.array([x for x in vals if not np.isnan(x)]); d, u = (a < -1).sum(), (a > 1).sum()
        return (d / (d + u) if d + u else np.nan), (a.mean() if len(a) else np.nan)
    def bl(rows, j):
        w = {}
        for r in rows: w[(r[1], r[2])] = w.get((r[1], r[2]), 0) + 1
        num = den = 0
        for key, cnt in w.items():
            b = base.get(key)
            if b is None or b[j].sum() == 0: continue
            num += cnt * b[j, 0] / b[j].sum(); den += cnt
        return num / den if den else np.nan
    pc = lambda x: "—" if np.isnan(x) else f"{x*100:.0f}%"
    print(f"\n=== 고점 위험 3단계 — 관심종목 {len(W)} · {ds[0]}~{ds[-1]} · 진입 다음 날 시가 · 하락 비율 = (−1% 미만)/(±1% 밖) · 기준 = 같은 조건 없는 날(섹터×QQQ 국면 가중) · 반쪽 {mid} · 뒤30% {t30}~ ===")
    for vn in variants:
        print(f"\n■ {vn}")
        for g in ("전체", "일반", "레버리지"):
            for k in (1, 2, 3):
                rows = [r for r in ev.get((vn, k), []) if g == "전체" or r[4] == g]
                if not rows: print(f"  {g} {k}단계 0건"); continue
                parts = []
                for j, n in enumerate(H):
                    d, m = dr([r[5 + j] for r in rows]); parts.append(f"+{n}일 하락 {pc(d)}(없는 날 {pc(bl(rows, j))}) 평균 {m:+.2f}%")
                hh = " / ".join(pc(dr([r[6] for r in z])[0]) for z in ([r for r in rows if r[0] < mid], [r for r in rows if r[0] >= mid], [r for r in rows if r[0] >= t30]))
                print(f"  {g} {k}단계 n{len(rows)}(날 {len({r[0] for r in rows})}·종목 {len({r[3] for r in rows})}) · " + " · ".join(parts) + f" | +5일 하락 앞/뒤 반쪽/뒤30% {hh}")
            if vn != "기본(윗꼬리0.5·%B1.0)": break
if __name__ == "__main__":
    main()
