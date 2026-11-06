"""최고점 폭락 · 찐반등 저점 — 실제 사례를 찾아 캔들·위치 공통점을 대조군과 비교 (읽기 전용 · 반영 전 보고용)

왜 (2026-11-06 사용자: "NAIL·우주·코인·반도체·국장·양자 최고점 폭락 차트 다 찾아서 정밀비교(캔들 위주) · 공통점 · 찐반등 공통점도")
사례 찾기 — 사후에만 알 수 있는 정의라 '찾기'에만 쓰고, 공통점은 그날까지의 값으로만 잰다.
  변동 단위 u = 직전 60일 일간 진폭(고가−저가)/종가 중앙값. 종목마다 다른 변동성을 맞춘다(레버리지 vs 지수 ETF).
  최고점 폭락: t의 고가가 [t−120, t+60] 최고 · 직전 60일 저점→고점 상승 ≥ max(30%, 8u) · 이후 60일 안 저가가 고점 대비 ≥ max(20%, 8u) 하락
  찐반등 저점: t의 저가가 [t−120, t+60] 최저 · 직전 60일 고점→저점 하락 ≥ max(20%, 8u) · 이후 60일 안 고가가 저점 대비 ≥ max(30%, 8u) 상승
대조군(같은 종목들, 같은 기간)
  고점 대조: RSI14 ≥ 70 · 직전 60일 상승 ≥ 같은 문턱 · 52주 고가 5% 안 — 그런데 이후 60일 하락이 문턱의 절반도 안 된 날(가짜 고점)
  저점 대조: RSI14 ≤ 30 · 직전 60일 하락 ≥ 같은 문턱 · 52주 저가 5% 안 — 그런데 이후 60일 상승이 문턱의 절반도 안 된 날(가짜 반등)
  같은 종목 20거래일 안 중복은 하나만.
비교 구간: 직전(t−5~t−1) · 당일(t) · 직후 확인(t+1~t+3). 직후 확인 구간만 실전에서 '확인 신호'로 쓸 수 있다(고점·저점은 그날엔 모른다).
캔들 정의는 tools/candle-context-lab.py features()와 같다. 대상: 관심종목 해당 테마 + 연구용 추가 종목(아래 EXTRA, 사이트 원장과 무관).
"""
import importlib.util, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)

def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py")
cc = _load("cc", "candle-context-lab.py")

THEMES = {
    "주택(NAIL)": ["NAIL", "ITB"],
    "우주": ["RKLB", "ASTS", "LUNR", "RDW", "PL", "SPCE", "JOBY"],
    "코인": ["BMNR", "MSTR", "COIN", "MARA", "RIOT", "CIFR", "WULF", "HUT"],
    "반도체": ["SOXL", "NVDA", "AMD", "MU", "SMCI", "AVGO", "ARM"],
    "국장": ["069500.KS", "229200.KS", "000660.KS", "005930.KS", "042700.KS"],
    "양자": ["IONQ", "QBTS", "RGTI", "QUBT"],
}
SHORT = {"LLDOJI": "장족도지", "HWAVE": "고파동", "DOJI": "도지", "SPIN": "팽이", "HAMMER": "망치꼴", "INVHAM": "역망치꼴", "BIGBULL": "장대양봉",
         "BIGBEAR": "장대음봉", "BENGULF": "상승장악", "SENGULF": "하락장악", "MSTAR": "샛별", "ESTAR": "석별", "LUPPER": "긴윗꼬리", "LLOWER": "긴아랫꼬리"}

def day_feats(o, h, l, c, v):
    K, Z, R, T, ma20, ma60, dd60 = cc.features(o, h, l, c)
    N = len(c); pc = np.r_[np.nan, c[:-1]]; ph = np.r_[np.nan, h[:-1]]; pl = np.r_[np.nan, l[:-1]]
    vs = pd.Series(v).rolling(20).mean().to_numpy(); vr = v / np.where(vs > 0, vs, np.nan)
    ret = (c / pc - 1) * 100
    upn = np.zeros(N, int); dnn = np.zeros(N, int)
    for i in range(1, N):
        upn[i] = upn[i - 1] + 1 if c[i] > c[i - 1] else 0; dnn[i] = dnn[i - 1] + 1 if c[i] < c[i - 1] else 0
    h20 = pd.Series(c).rolling(20).max().to_numpy(); r20 = pd.Series(R).rolling(20).max().to_numpy()
    l20 = pd.Series(c).rolling(20).min().to_numpy(); r20m = pd.Series(R).rolling(20).min().to_numpy()
    F = {f"캔들:{SHORT[k]}": K[k] for k in K}
    F.update({
        "볼밴 상단 밖": Z["OUT_UP"], "볼밴 하단 밖": Z["OUT_LO"], "볼밴 하단 재진입": Z["REENTRY"],
        "볼밴 상단 밖→안 복귀": np.r_[False, Z["OUT_UP"][:-1]] & ~Z["OUT_UP"],
        "RSI≥80": R >= 80, "RSI≥70": R >= 70, "RSI≤30": R <= 30, "RSI≤20": R <= 20,
        "거래량 2배↑": vr >= 2, "거래량 3배↑": vr >= 3,
        "갭 상승(시가>전일 고가)": o > ph, "갭 하락(시가<전일 저가)": o < pl,
        "하루 +8%↑": ret >= 8, "하루 −8%↓": ret <= -8,
        "5일+ 연속 상승": upn >= 5, "5일+ 연속 하락": dnn >= 5,
        "전일 저가 아래 마감": c < pl, "전일 고가 위 마감": c > ph,
        "RSI 하락 다이버전스(20일 신고가·RSI 낮음)": (c >= h20) & (R < r20 - 3),
        "RSI 상승 다이버전스(20일 신저가·RSI 높음)": (c <= l20) & (R > r20m + 3),
        "5일선 이탈(종가<5일선)": c < pd.Series(c).rolling(5).mean().to_numpy(),
        "5일선 회복(종가>5일선)": c > pd.Series(c).rolling(5).mean().to_numpy(),
    })
    for k in F: F[k] = np.nan_to_num(np.asarray(F[k], float)) > 0
    return F, K, Z, R, vr

def events(o, h, l, c):
    N = len(c); u = pd.Series((h - l) / c).rolling(60).median().to_numpy()
    tops, bots, ctop, cbot = [], [], [], []
    R = cc.rsi(c)
    hi250 = pd.Series(h).rolling(250, min_periods=120).max().to_numpy(); lo250 = pd.Series(l).rolling(250, min_periods=120).min().to_numpy()
    for t in range(130, N - 61):
        if np.isnan(u[t]): continue
        thr_dn, thr_up = max(0.20, 8 * u[t]), max(0.30, 8 * u[t])
        run = h[t] / l[t - 60:t + 1].min() - 1; fall = 1 - l[t + 1:t + 61].min() / h[t]
        drop = 1 - l[t] / h[t - 60:t + 1].max(); rise = h[t + 1:t + 61].max() / l[t] - 1
        if h[t] >= h[t - 120:t + 61].max() and run >= thr_up and fall >= thr_dn: tops.append(t)
        if l[t] <= l[t - 120:t + 61].min() and drop >= thr_dn and rise >= thr_up: bots.append(t)
        if R[t] >= 70 and run >= thr_up and c[t] >= 0.95 * hi250[t] and fall < thr_dn / 2: ctop.append(t)
        if R[t] <= 30 and drop >= thr_dn and c[t] <= 1.05 * lo250[t] and rise < thr_up / 2: cbot.append(t)
    def thin(a):
        out = []
        for t in a:
            if not out or t - out[-1] >= 20: out.append(t)
        return out
    return thin(tops), thin(bots), thin(ctop), thin(cbot)

def seq(K, t):
    out = []
    for i in range(t - 2, t + 3):
        ks = [SHORT[k] for k in K if K[k][i]]
        nm = "/".join(ks[:2]) if ks else "·"
        out.append(f"[{nm}]" if i == t else nm)
    return " → ".join(out)

def main():
    rows = {"top": [], "bot": [], "ctop": [], "cbot": []}
    for theme, tks in THEMES.items():
        for tk in tks:
            df = tr.fetch(tk)
            if df is None or len(df) < 300: print(f"  건너뜀 {tk}"); continue
            o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
            F, K, Z, R, vr = day_feats(o, h, l, c, v)
            dates = [str(d.date()) for d in df.index]
            tops, bots, ctop, cbot = events(o, h, l, c)
            for key, lst in (("top", tops), ("bot", bots), ("ctop", ctop), ("cbot", cbot)):
                for t in lst:
                    if t + 4 >= len(c) or t < 6: continue
                    w = {"pre": {f: bool(F[f][t - 5:t].any()) for f in F}, "day": {f: bool(F[f][t]) for f in F},
                         "post": {f: bool(F[f][t + 1:t + 4].any()) for f in F}}
                    info = dict(theme=theme, tk=tk, d=dates[t], w=w)
                    if key in ("top", "bot"):
                        if key == "top":
                            info.update(run=(h[t] / l[t - 60:t + 1].min() - 1) * 100, mv=(1 - l[t + 1:t + 61].min() / h[t]) * 100)
                        else:
                            info.update(run=(1 - l[t] / h[t - 60:t + 1].max()) * 100, mv=(h[t + 1:t + 61].max() / l[t] - 1) * 100)
                        info.update(seq=seq(K, t), rsi=R[t], vr=vr[t],
                                    zone="상단 밖" if Z["OUT_UP"][t] else "하단 밖" if Z["OUT_LO"][t] else "상단 근처" if Z["NEAR_UP"][t] else "하단 근처" if Z["NEAR_LO"][t] else "중간")
                    rows[key].append(info)
    for key, title, ck in (("top", "🔴 최고점 폭락", "ctop"), ("bot", "🟢 찐반등 저점", "cbot")):
        E, C = rows[key], rows[ck]
        print("\n  ※ z = 두 비율 차이의 표준화 값. |z|≥3(◀)만 우연보다 크다고 본다. 대조군을 정의한 특징(당일 RSI·52주 근처)은 비교 의미 없음.")
        print(f"\n■ {title} 사례 {len(E)}건 · 대조군({'가짜 고점: 과열인데 폭락 안 함' if key == 'top' else '가짜 반등: 과매도인데 반등 안 함'}) {len(C)}건")
        for th in THEMES:
            ev = [e for e in E if e["theme"] == th]
            if not ev: print(f"  [{th}] 사례 없음"); continue
            print(f"  [{th}] {len(ev)}건")
            for e in sorted(ev, key=lambda x: x["d"])[-12:]:
                print(f"    {e['d']} {e['tk']:<9} {'직전 상승' if key == 'top' else '직전 하락'} {e['run']:.0f}% → {'이후 하락' if key == 'top' else '이후 상승'} {e['mv']:.0f}%"
                      f" · RSI {e['rsi']:.0f} · 거래량 {e['vr']:.1f}배 · {e['zone']} · 캔들(t−2→t+2) {e['seq']}")
        for win, wname in (("pre", "직전 5일(t−5~t−1)"), ("day", "당일(t)"), ("post", "직후 3일(t+1~t+3) — 실전 확인용")):
            feats = list(E[0]["w"][win]) if E else []
            res = []
            for f in feats:
                pe = np.mean([e["w"][win][f] for e in E]) * 100 if E else 0
                pc_ = np.mean([x["w"][win][f] for x in C]) * 100 if C else 0
                if pe >= 15 or pc_ >= 15:
                    p1, p2, n1, n2 = pe / 100, pc_ / 100, len(E), len(C); pp = (p1 * n1 + p2 * n2) / (n1 + n2)
                    z = (p1 - p2) / np.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2)) if 0 < pp < 1 else 0
                    res.append((pe - pc_, f, pe, pc_, z))
            res.sort(key=lambda x: -abs(x[0]))
            print(f"  ◆ {wname} 공통점 — 사례 비율 vs 대조군 비율 (차이 큰 순 상위 10)")
            for dlt, f, pe, pc_, z in res[:10]:
                print(f"    {f:<34} 사례 {pe:3.0f}% · 대조 {pc_:3.0f}% · 차이 {dlt:+.0f}%p · z {z:+.1f}{' ◀' if abs(z) >= 3 else ''}")
        # 테마별로도 같은 방향인지(직후 3일 상위 3개)
        if E:
            top3 = sorted([(np.mean([e['w']['post'][f] for e in E]) - np.mean([x['w']['post'][f] for x in C]), f) for f in E[0]["w"]["post"]], key=lambda x: -abs(x[0]))[:3]
            print("  ◆ 직후 3일 상위 3개 특징의 테마별 사례 비율(대조군은 전체)")
            for _, f in top3:
                cells = []
                for th in THEMES:
                    ev = [e for e in E if e["theme"] == th]
                    if ev: cells.append(f"{th} {np.mean([e['w']['post'][f] for e in ev]) * 100:.0f}%({len(ev)})")
                print(f"    {f}: " + " · ".join(cells) + f" | 대조 {np.mean([x['w']['post'][f] for x in C]) * 100:.0f}%")

if __name__ == "__main__" and "--forward" not in sys.argv:
    main()


# ── 2단계: 공통점을 '그날 알 수 있는 규칙'으로 바꿔 앞으로 맞혔는지 (python tools/peak-trough-lab.py --forward) ──
# 사례 비교의 '직후 3일' 공통점은 고점·저점을 이미 알고 본 것이라 반은 정의상 당연하다(폭락했으니 5일선이 깨졌다).
# 그래서 같은 공통점을 그날 기준 규칙으로 만들고, 모든 날에 대해 '그 뒤 정말 폭락/급반등했나'를 센다(시간순 · 다음 날 시가 진입).
#  고점 경계 T0  과열 맥락: 최근 10일 안 RSI≥70 · 52주 고가 5% 안 · 직전 60일 상승 ≥ max(30%, 8u)
#           T1  T0 + 오늘 처음 5일선 아래 마감
#           T2  T1 + 오늘 종가 < 전일 저가
#           T3  T2 + 직전 5일 안 거래량 3배↑ 날
#           T4  T1 + 직전 5일 안 하루 −8%↓ 아님 대신 오늘 −8%↓ (급락 첫날)
#  저점 확인 B0  과매도 맥락: 최근 10일 안 RSI≤30 · 52주 저가 5% 안 · 직전 60일 하락 ≥ max(20%, 8u)
#           B1  B0 + 오늘 처음 5일선 위 마감
#           B2  B1 + 오늘 종가 > 전일 고가
#           B3  B2 + 직전 5일 안 하루 −8%↓(투매) 있었음
#           B4  B1 + 오늘 하루 +8%↑
#  잴 것: 진입(다음 날 시가) 뒤 60일 안 문턱만큼 폭락(고점 쪽)/급등(저점 쪽)한 비율 · 10·20일 수익 · 앞/뒤 반
def forward():
    allrows = []
    for theme, tks in THEMES.items():
        for tk in tks:
            df = tr.fetch(tk)
            if df is None or len(df) < 300: continue
            o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
            N = len(c); dates = [str(d.date()) for d in df.index]
            R = cc.rsi(c); u = pd.Series((h - l) / c).rolling(60).median().to_numpy()
            ma5 = pd.Series(c).rolling(5).mean().to_numpy()
            vs = pd.Series(v).rolling(20).mean().to_numpy(); vr = v / np.where(vs > 0, vs, np.nan)
            ret = np.r_[np.nan, c[1:] / c[:-1] - 1] * 100
            hi250 = pd.Series(h).rolling(250, min_periods=120).max().to_numpy(); lo250 = pd.Series(l).rolling(250, min_periods=120).min().to_numpy()
            rmax10 = pd.Series(R).rolling(10).max().to_numpy(); rmin10 = pd.Series(R).rolling(10).min().to_numpy()
            for t in range(130, N - 61):
                if np.isnan(u[t]): continue
                thr_dn, thr_up = max(0.20, 8 * u[t]), max(0.30, 8 * u[t]); e = o[t + 1]
                run = c[t] / l[t - 60:t + 1].min() - 1; drop = 1 - c[t] / h[t - 60:t + 1].max()
                fall60 = 1 - l[t + 1:t + 61].min() / e; rise60 = h[t + 1:t + 61].max() / e - 1
                r10, r20 = c[t + 10] / e - 1, c[t + 20] / e - 1
                below5, above5 = c[t] < ma5[t], c[t] > ma5[t]
                first_below = below5 and not (c[t - 1] < ma5[t - 1]); first_above = above5 and not (c[t - 1] > ma5[t - 1])
                T0 = rmax10[t] >= 70 and c[t] >= 0.95 * hi250[t - 1] and run >= thr_up
                B0 = rmin10[t] <= 30 and c[t] <= 1.05 * lo250[t - 1] and drop >= thr_dn
                if not (T0 or B0): continue
                d = dict(theme=theme, d=dates[t], r10=r10 * 100, r20=r20 * 100, crash=fall60 >= thr_dn, surge=rise60 >= thr_up, tags=[])
                if T0:
                    d["tags"].append("T0")
                    if first_below:
                        d["tags"].append("T1")
                        if c[t] < l[t - 1]:
                            d["tags"].append("T2")
                            if np.nanmax(vr[t - 5:t]) >= 3: d["tags"].append("T3")
                        if ret[t] <= -8: d["tags"].append("T4")
                if B0:
                    d["tags"].append("B0")
                    if first_above:
                        d["tags"].append("B1")
                        if c[t] > h[t - 1]:
                            d["tags"].append("B2")
                            if np.nanmin(ret[t - 5:t]) <= -8: d["tags"].append("B3")
                        if ret[t] >= 8: d["tags"].append("B4")
                allrows.append(d)
    ds = sorted({r["d"] for r in allrows}); mid = ds[len(ds) // 2] if ds else ""
    NM = {"T0": "과열 맥락(전부)", "T1": "+ 처음 5일선 아래 마감", "T2": "+ 전일 저가 아래 마감", "T3": "+ 직전 5일 거래량 3배↑", "T4": "+ 오늘 −8%↓",
          "B0": "과매도 맥락(전부)", "B1": "+ 처음 5일선 위 마감", "B2": "+ 전일 고가 위 마감", "B3": "+ 직전 5일 투매(−8%↓)", "B4": "+ 오늘 +8%↑"}
    def thin(rows):     # 같은 테마·같은 날 몰림 완화는 하지 않고, 같은 종목 연속일은 이미 '처음' 조건이 걸러 준다
        return rows
    print(f"\n■ 2단계 — 공통점을 그날 규칙으로 · 앞으로 맞혔나 ({ds[0] if ds else ''}~{ds[-1] if ds else ''}, 앞/뒤 경계 {mid}) · 다음 날 시가 진입")
    for side, keys, ev, lab in (("top", ["T0", "T1", "T2", "T3", "T4"], "crash", "60일 안 폭락"), ("bot", ["B0", "B1", "B2", "B3", "B4"], "surge", "60일 안 급반등")):
        print(f"  [{'🔴 고점 경계' if side == 'top' else '🟢 저점 확인'}] — {lab} 비율 · 10일/20일 평균 수익 · 앞/뒤 반 {lab} 비율")
        for k in keys:
            rows = thin([r for r in allrows if k in r["tags"]])
            if not rows: print(f"    {NM[k]:<22} 표본 0"); continue
            f = lambda rr: (np.mean([x[ev] for x in rr]) * 100 if rr else float("nan"))
            fr, bk = [x for x in rows if x["d"] < mid], [x for x in rows if x["d"] >= mid]
            th = " · ".join(f"{t} {f([x for x in rows if x['theme'] == t]):.0f}%({len([x for x in rows if x['theme'] == t])})" for t in THEMES if any(x['theme'] == t for x in rows))
            print(f"    {NM[k]:<22} n={len(rows):<5} {lab} {f(rows):.0f}% · 10일 {np.mean([x['r10'] for x in rows]):+.1f}% · 20일 {np.mean([x['r20'] for x in rows]):+.1f}%"
                  f" · 앞 {f(fr):.0f}%({len(fr)}) 뒤 {f(bk):.0f}%({len(bk)})")
            print(f"      테마별: {th}")

if __name__ == "__main__" and "--forward" in sys.argv:
    forward()
