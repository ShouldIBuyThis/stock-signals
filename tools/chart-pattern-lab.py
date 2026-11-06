"""차트 패턴(쌍바닥·쌍봉·헤드앤숄더·역H&S·삼각수렴·상승 깃발·피보나치 되돌림) — 단독 vs 기존 위치·캔들 결합 (읽기 전용 · 반영 전 보고용)

왜 (2026-11-06 사용자: 첨부 '줄먹×차트' 패턴을 실제 데이터로 검증 · 단독 vs 볼밴×RSI×캔들×추세 결합 · 3/5/10/20일 ·
    평균수익 · 표본 · 평소 대비 · 앞/뒤 반 · 확정 시점부터 · 미래 데이터 금지 · 표본 10건+ 희귀 고적중도 후보로 표시 · 산식 변경 금지)
판정(전부 객관 규칙 · 확정 시점 = 돌파한 날 종가, 그때까지 확정된 스윙점만 사용)
  스윙점: j봉 고가(저가)가 앞뒤 3봉 중 최고(최저) → j+3봉 종가에 비로소 확정.
  쌍바닥 W  최근 확정 스윙저점 2개(10~60봉 간격, 차이 3% 안) · 사이 최고가 = 넥라인(저점보다 5%↑) · 두 번째 저점 확정 뒤 30봉 안에 종가가 넥라인 첫 상향 돌파 → 상승 기대
  쌍봉 M    위와 대칭(스윙고점 2개 · 사이 최저가 넥라인 하향 이탈) → 하락 기대
  헤드앤숄더 스윙고점 3개(가운데가 양옆보다 3%↑, 양 어깨 차이 5% 안) · 두 골을 이은 넥라인 · 오른 어깨 확정 뒤 20봉 안 종가가 넥라인 하향 이탈 → 하락 기대
  역H&S     대칭 → 상승 기대
  삼각수렴   최근 스윙고점 2개 낮아짐 + 스윙저점 2개 높아짐(40봉 안) · 위 추세선 상향 돌파 → 상승 / 아래 추세선 하향 이탈 → 하락
  상승 깃발  깃대: 10봉 상승 ≥ 15% · 깃발: 그 뒤 5~15봉 동안 깃대 상승분의 50% 넘게 안 밀림 · 깃발 구간 최고가 상향 돌파 → 상승 기대
  피보나치   스윙저점 A → 스윙고점 B(20%↑) 뒤 0.5~0.618 되돌림 구간을 저가가 건드리고, 종가가 0.5 위 양봉으로 마감 → 상승 기대
  (엘리엇 파동은 파동 세는 규칙이 사람마다 달라 객관 판정이 안 되므로 제외. VWAP·ORB는 분봉이 없어 제외.)
결합: + 맥락(상승 기대 패턴은 RSI<70·볼밴 상단 밖 아님 / 반전형은 직전 60일 하락 15%↑ · 하락 기대 패턴은 직전 60일 상승 15%↑)
      + 캔들 확인(돌파일 몸통 50%↑ 양봉/음봉) · + 둘 다
진입 = 다음 날 시가, n일 뒤 종가 · 같은 종목·같은 조건 10일 쿨다운 · 보합 ±1% 제외 · '평소' = 같은 섹터×같은 국면(QQQ 200일선) 가중
추가: 검토자 제안 고점 조합 — 과열 맥락(최근 10일 RSI≥70 · 52주 고가 5% 안 · 60일 급등)에서
      직전 5일 거래량 3배↑ · 볼밴 상단 밖→안 복귀 · 종가 < 전일 저가 를 겹쳤을 때 10·20·60일 안 폭락 비율
"""
import importlib.util, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)

def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py")
ss = _load("ss", "signal-stats.py")
cc = _load("cc", "candle-context-lab.py")
H, COOL, K = (3, 5, 10, 20), 10, 3

def pivots(h, l):
    N = len(h); ph, pl = [], []          # (확정 봉, 피벗 봉, 값)
    for j in range(K, N - K):
        if h[j] == h[j - K:j + K + 1].max(): ph.append((j + K, j, h[j]))
        if l[j] == l[j - K:j + K + 1].min(): pl.append((j + K, j, l[j]))
    return ph, pl

def patterns(o, h, l, c):
    N = len(c); ph, pl = pivots(h, l)
    out = {k: np.zeros(N, bool) for k in ("W", "M", "HS", "IHS", "TRI_UP", "TRI_DN", "FLAG", "FIB")}
    ih = il = 0; H_, L_ = [], []
    lastW = lastM = lastHS = lastIHS = -999
    for i in range(K * 2 + 1, N):
        while ih < len(ph) and ph[ih][0] <= i: H_.append(ph[ih]); ih += 1
        while il < len(pl) and pl[il][0] <= i: L_.append(pl[il]); il += 1
        cross_up = lambda lv: c[i] > lv and c[i - 1] <= lv
        cross_dn = lambda lv: c[i] < lv and c[i - 1] >= lv
        if len(L_) >= 2:
            (_, a, va), (cb, b, vb) = L_[-2], L_[-1]
            if 10 <= b - a <= 60 and abs(vb - va) / va <= 0.03 and i - cb <= 30:
                neck = h[a:b + 1].max()
                if neck >= max(va, vb) * 1.05 and cross_up(neck) and (b, neck) != lastW: out["W"][i] = True; lastW = (b, neck)
        if len(H_) >= 2:
            (_, a, va), (cb, b, vb) = H_[-2], H_[-1]
            if 10 <= b - a <= 60 and abs(vb - va) / va <= 0.03 and i - cb <= 30:
                neck = l[a:b + 1].min()
                if neck <= min(va, vb) / 1.05 and cross_dn(neck) and (b, neck) != lastM: out["M"][i] = True; lastM = (b, neck)
        if len(H_) >= 3:
            (_, p1, v1), (_, p2, v2), (c3, p3, v3) = H_[-3], H_[-2], H_[-1]
            if v2 >= max(v1, v3) * 1.03 and abs(v1 - v3) / v2 <= 0.05 and p3 - p1 <= 80 and i - c3 <= 20:
                t1 = p1 + int(np.argmin(l[p1:p2 + 1])); t2 = p2 + int(np.argmin(l[p2:p3 + 1]))
                slope = (l[t2] - l[t1]) / max(t2 - t1, 1); neck = l[t2] + slope * (i - t2); neck0 = l[t2] + slope * (i - 1 - t2)
                if c[i] < neck and c[i - 1] >= neck0 and p3 != lastHS: out["HS"][i] = True; lastHS = p3
        if len(L_) >= 3:
            (_, p1, v1), (_, p2, v2), (c3, p3, v3) = L_[-3], L_[-2], L_[-1]
            if v2 <= min(v1, v3) / 1.03 and abs(v1 - v3) / v2 <= 0.05 and p3 - p1 <= 80 and i - c3 <= 20:
                t1 = p1 + int(np.argmax(h[p1:p2 + 1])); t2 = p2 + int(np.argmax(h[p2:p3 + 1]))
                slope = (h[t2] - h[t1]) / max(t2 - t1, 1); neck = h[t2] + slope * (i - t2); neck0 = h[t2] + slope * (i - 1 - t2)
                if c[i] > neck and c[i - 1] <= neck0 and p3 != lastIHS: out["IHS"][i] = True; lastIHS = p3
        if len(H_) >= 2 and len(L_) >= 2:
            (_, a1, h1), (_, a2, h2) = H_[-2], H_[-1]; (_, b1, l1), (_, b2, l2) = L_[-2], L_[-1]
            if h2 < h1 and l2 > l1 and i - min(a1, b1) <= 40:
                su = (h2 - h1) / max(a2 - a1, 1); sl = (l2 - l1) / max(b2 - b1, 1)
                up_i, up_p = h2 + su * (i - a2), h2 + su * (i - 1 - a2); lo_i, lo_p = l2 + sl * (i - b2), l2 + sl * (i - 1 - b2)
                if up_i > lo_i:
                    if c[i] > up_i and c[i - 1] <= up_p: out["TRI_UP"][i] = True
                    if c[i] < lo_i and c[i - 1] >= lo_p: out["TRI_DN"][i] = True
        for fl in range(5, 16):                                     # 깃발 길이
            p = i - 1 - fl
            if p < 11: break
            pole = c[p] / c[p - 10] - 1
            if pole < 0.15: continue
            seg_h, seg_l = h[p + 1:i].max(), l[p + 1:i].min()
            if seg_h <= h[p] * 1.01 and (c[p] - seg_l) <= 0.5 * (c[p] - c[p - 10]) and c[i] > seg_h and c[i - 1] <= seg_h:
                out["FLAG"][i] = True; break
        if len(L_) >= 1 and len(H_) >= 1:
            (_, a, va), (_, b, vb) = L_[-1], H_[-1]
            if a < b and vb >= va * 1.2 and i - b <= 30:
                f50, f618 = vb - 0.5 * (vb - va), vb - 0.618 * (vb - va)
                if l[i] <= f50 and l[i] >= f618 * 0.99 and c[i] > f50 and c[i] > o[i] and l[b + 1:i].min() >= f618 * 0.99:
                    out["FIB"][i] = True
    return out

def flag_combo(o, h, l, c):
    """사이트 표시 후보 ① 상승 깃발 돌파 + 맥락(RSI<70·볼밴 상단 밖 아님) + 캔들(몸통 50%↑ 양봉) — pattern_flags K_FLAG 대조용."""
    Kc, Z, R, *_ = cc.features(o, h, l, c)
    body = np.abs(c - o) / np.where(h - l > 0, h - l, np.nan)
    bullc = np.nan_to_num((c > o) & (body >= 0.5)).astype(bool)
    Rn = np.nan_to_num(R, nan=50)
    return patterns(o, h, l, c)["FLAG"] & (Rn < 70) & ~Z["OUT_UP"] & bullc

def top3_mask(o, h, l, c, v):
    """사이트 표시 후보 ② 과열 맥락 + 직전 5일 거래량 3배 + 볼밴 상단 밖→안 + 전일 저가 아래 마감 — pattern_flags K_TOP3 대조용."""
    N = len(c); Kc, Z, R, *_ = cc.features(o, h, l, c)
    u = pd.Series((h - l) / c).rolling(60).median().to_numpy()
    vs = pd.Series(v).rolling(20).mean().to_numpy(); vr = v / np.where(vs > 0, vs, np.nan)
    hi250 = pd.Series(h).rolling(250, min_periods=240).max().to_numpy(); rmax10 = pd.Series(R).rolling(10).max().to_numpy()   # 사이트와 같은 52주(240봉↑)
    out = np.zeros(N, bool)
    for i in range(61, N):          # 사이트 판정과 같은 워밍업(1년치 데이터용). 연구 집계(main)는 260봉부터.
        if np.isnan(u[i]) or np.isnan(hi250[i - 1]): continue
        run = c[i] / l[i - 60:i + 1].min() - 1
        if not (rmax10[i] >= 70 and c[i] >= 0.95 * hi250[i - 1] and run >= max(0.30, 8 * u[i])): continue
        out[i] = bool(np.nanmax(vr[i - 5:i]) >= 3) and bool(Z["OUT_UP"][i - 1] and not Z["OUT_UP"][i]) and c[i] < l[i - 1]
    return out

UP = {"W": "쌍바닥(W) 넥라인 돌파", "IHS": "역헤드앤숄더 돌파", "TRI_UP": "삼각수렴 위로 돌파", "FLAG": "상승 깃발 돌파", "FIB": "피보나치 0.5~0.618 지지 양봉"}
DN = {"M": "쌍봉(M) 넥라인 이탈", "HS": "헤드앤숄더 넥라인 이탈", "TRI_DN": "삼각수렴 아래로 이탈"}
REV_UP = {"W", "IHS"}

def main():
    wl = ss.watchlist()
    qq = tr.fetch("QQQ"); q200 = qq["Close"].rolling(200).mean()
    regime = {str(d.date()): ("up" if c_ >= m else "down") for d, c_, m in zip(qq.index, qq["Close"], q200) if not np.isnan(m)}
    ev, base, hot = {}, {}, []
    for t, cat in wl.items():
        df = tr.fetch(t)
        if df is None or len(df) < 300: continue
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        N = len(c); dates = [str(d.date()) for d in df.index]; reg = [regime.get(d, "") for d in dates]
        Kc, Z, R, T, ma20, ma60, dd60 = cc.features(o, h, l, c)
        P = patterns(o, h, l, c)
        o1 = np.full(N, np.nan); o1[:-1] = o[1:]
        fw = {}
        for n in H:
            f = np.full(N, np.nan); f[:-n] = (c[n:] / o1[:-n] - 1) * 100; fw[n] = f
        ok = (np.arange(N) >= 260) & ~np.isnan(fw[3])
        for i in np.nonzero(ok)[0]:
            b = base.setdefault((cat, reg[i]), np.zeros((len(H), 2)))
            for j, n in enumerate(H):
                vv = fw[n][i]
                if not np.isnan(vv): b[j, 0] += vv > 1; b[j, 1] += vv < -1
        c60 = np.r_[np.full(60, np.nan), c[:-60]]; r60 = (c / c60 - 1) * 100
        body = np.abs(c - o) / np.where(h - l > 0, h - l, np.nan)
        bullc = np.nan_to_num((c > o) & (body >= 0.5)).astype(bool); bearc = np.nan_to_num((c < o) & (body >= 0.5)).astype(bool)
        Rn = np.nan_to_num(R, nan=50)
        for k in list(UP) + list(DN):
            up = k in UP
            if up:
                ctx = (Rn < 70) & ~Z["OUT_UP"] & ((np.nan_to_num(r60) <= -15) if k in REV_UP else True)
                cdl = bullc
            else:
                ctx = np.nan_to_num(r60) >= 15; cdl = bearc
            for tag, m in (("단독", P[k]), ("+맥락", P[k] & ctx), ("+캔들", P[k] & cdl), ("+둘 다", P[k] & ctx & cdl)):
                last = -10 ** 9
                for i in np.nonzero(m & ok)[0]:
                    if i - last < COOL: continue
                    last = i
                    ev.setdefault((k, tag), []).append((dates[i], cat, reg[i], *(fw[n][i] for n in H)))
        # 검토자 제안 고점 조합
        u = pd.Series((h - l) / c).rolling(60).median().to_numpy()
        vs = pd.Series(v).rolling(20).mean().to_numpy(); vr = v / np.where(vs > 0, vs, np.nan)
        hi250 = pd.Series(h).rolling(250, min_periods=120).max().to_numpy(); rmax10 = pd.Series(R).rolling(10).max().to_numpy()
        last = {}
        for i in range(260, N - 61):
            if np.isnan(u[i]): continue
            thr = max(0.20, 8 * u[i]); run = c[i] / l[i - 60:i + 1].min() - 1
            if not (rmax10[i] >= 70 and c[i] >= 0.95 * hi250[i - 1] and run >= max(0.30, 8 * u[i])): continue
            e = o[i + 1]
            V3 = np.nanmax(vr[i - 5:i]) >= 3; BBR = bool(Z["OUT_UP"][i - 1] and not Z["OUT_UP"][i]); LOW = c[i] < l[i - 1]
            rec = dict(d=dates[i], f10=1 - l[i + 1:i + 11].min() / e >= thr, f20=1 - l[i + 1:i + 21].min() / e >= thr,
                       f60=1 - l[i + 1:i + 61].min() / e >= thr, r10=(c[i + 10] / e - 1) * 100, r20=(c[i + 20] / e - 1) * 100, tags=["과열 맥락 전부"])
            for nm, cond in (("+거래량3배(5일)", V3), ("+볼밴 상단 밖→안", BBR), ("+전일 저가 이탈", LOW), ("+거래량3배 · 볼밴 복귀", V3 and BBR),
                             ("+볼밴 복귀 · 저가 이탈", BBR and LOW), ("+거래량3배 · 볼밴 복귀 · 저가 이탈", V3 and BBR and LOW)):
                if cond: rec["tags"].append(nm)
            for tg in rec["tags"]:
                if i - last.get(tg, -999) >= COOL:
                    last[tg] = i; hot.append(dict(rec, tag=tg))
    alld = sorted({e[0] for vv in ev.values() for e in vv}); mid, cut80 = alld[len(alld) // 2], alld[int(len(alld) * 0.8)]
    def upr(rows, j):
        x = [r[3 + j] for r in rows if not np.isnan(r[3 + j])]; w = sum(vv > 1 for vv in x); lo_ = sum(vv < -1 for vv in x)
        return (w / (w + lo_) * 100 if w + lo_ else None), (np.mean(x) if x else None)
    def bsh(rows, j):
        num = den = 0.0
        for r in rows:
            b = base.get((r[1], r[2]))
            if b is None or b[j].sum() == 0: continue
            num += b[j, 0] / b[j].sum(); den += 1
        return num / den * 100 if den else None
    f0 = lambda x: "—" if x is None else f"{x:.0f}"
    tier = lambda n: "사용" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "희귀" if n >= 10 else "불가"
    print(f"■ 차트 패턴 × 기존 위치·캔들 · {alld[0]}~{alld[-1]} · 관심종목 {len(wl)}개 · 다음 날 시가 진입 · 쿨다운 {COOL}일 · 앞/뒤 경계 {mid} · 최근 20% {cut80}")
    print("  칸 = 기대 방향 적중%/평소% 평균수익 · 상승 기대는 상승 비율, 하락 기대는 하락 비율(보합 ±1% 제외)")
    best = []
    for k, nm in list(UP.items()) + list(DN.items()):
        up = k in UP
        print(f"\n  [{'🟢' if up else '🔴'} {nm}] 기대: {'상승' if up else '하락'}")
        for tag in ("단독", "+맥락", "+캔들", "+둘 다"):
            rows = ev.get((k, tag), [])
            if not rows: print(f"    {tag:<6} 표본 0"); continue
            cells = []
            for j, n in enumerate(H):
                u_, a = upr(rows, j); b = bsh(rows, j)
                hv = u_ if up else (None if u_ is None else 100 - u_); bv = b if up else (None if b is None else 100 - b)
                cells.append(f"+{n} {f0(hv)}%/{f0(bv)}% {a:+.1f}%")
            hs = [upr([r for r in rows if r[0] < mid], 2)[0], upr([r for r in rows if r[0] >= mid], 2)[0], upr([r for r in rows if r[0] >= cut80], 2)[0]]
            if not up: hs = [None if x is None else 100 - x for x in hs]
            print(f"    {tag:<6} n={len(rows):<5}[{tier(len(rows))}] " + " · ".join(cells) + f" · 10일 앞/뒤/최근 {'/'.join(f0(x) for x in hs)}")
            u10 = upr(rows, 2)[0]; b10 = bsh(rows, 2)
            if u10 is not None and b10 is not None and len(rows) >= 10:
                edge = (u10 - b10) if up else (b10 - u10)
                hv = [x for x in hs[:2] if x is not None]; bb = b10 if up else 100 - b10
                best.append((edge, nm, tag, len(rows), all(x > bb for x in hv) and len(hv) == 2))
    print("\n  [10일 기준 평소보다 나은 조합 — 앞/뒤 반 모두 평소 위인 것만 ✔]")
    for e_, nm, tag, n, keep in sorted(best, key=lambda x: -x[0])[:12]:
        print(f"    {'✔' if keep else ' '} {nm} {tag} · 평소 대비 {e_:+.0f}%p · n={n}[{tier(n)}]")
    print("\n  [검토자 제안 고점 조합 — 과열 맥락에서 10·20·60일 안 문턱만큼 폭락한 비율 · 10/20일 평균 수익 · 앞/뒤 반 60일 폭락]")
    hd = sorted({x['d'] for x in hot}); hm = hd[len(hd) // 2] if hd else ""
    for tg in ("과열 맥락 전부", "+거래량3배(5일)", "+볼밴 상단 밖→안", "+전일 저가 이탈", "+거래량3배 · 볼밴 복귀", "+볼밴 복귀 · 저가 이탈", "+거래량3배 · 볼밴 복귀 · 저가 이탈"):
        rr = [x for x in hot if x['tag'] == tg]
        if not rr: print(f"    {tg:<26} 표본 0"); continue
        pct = lambda key, a: np.mean([x[key] for x in a]) * 100 if a else float('nan')
        fr, bk = [x for x in rr if x['d'] < hm], [x for x in rr if x['d'] >= hm]
        print(f"    {tg:<26} n={len(rr):<5}[{tier(len(rr))}] 폭락 10일 {pct('f10', rr):.0f}% · 20일 {pct('f20', rr):.0f}% · 60일 {pct('f60', rr):.0f}%"
              f" · 수익 10일 {np.mean([x['r10'] for x in rr]):+.1f}% 20일 {np.mean([x['r20'] for x in rr]):+.1f}% · 앞 {pct('f60', fr):.0f}%({len(fr)}) 뒤 {pct('f60', bk):.0f}%({len(bk)})")

if __name__ == "__main__":
    main()
