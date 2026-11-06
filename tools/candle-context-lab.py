"""캔들 × 위치(볼밴) × RSI × 직전 추세 — 반등·상승 지속·고점 위험·하락 지속 구분 검증 (읽기 전용 · 반영 전 보고용)

왜 (2026-11-06 사용자: 캔들 연구가 '볼밴 상단 밖 익절' 한 상황에 치우쳐 있다 →
    볼밴 위치 + RSI + 캔들 모양 + 직전 추세로 현재 위치별 신호를 구분하고, 실제 예측력을 시간순으로 검증)
원칙
  · 미래 데이터 금지: 모든 조건은 신호일(i) 종가까지의 값. 진입 = i+1 시가, 청산 = i+n 종가.
  · 가설은 아래 HYP에 미리 적어 두고(사전 등록), 표에서 고르지 않는다. 탐색 조합은 학습 구간에서만 고르고
    시험 구간(뒤 30%)에서 따로 확인한다(시간순 검증).
  · 비교 기준 = 같은 섹터(관심종목 카테고리) × 같은 국면(QQQ 200일선 위/아래)의 평소 상승 비율을
    신호 표본 구성대로 가중한 값.
  · 상승 비율 = (+1% 초과)/(+1% 초과 + −1% 미만), 보합 제외(사이트 stat()과 같은 규칙).
  · 표본 등급(방법론 §5-1): 50+ 사용 가능 · 30~49 방향만 · 15~29 참고 · 15 미만 신뢰 불가.
캔들 정의 (r = 고가−저가, body = |종가−시가|, uw/lw = 윗/아랫꼬리, ATR14 = 14일 평균 진폭)
  장족도지 LLDOJI   body ≤ 0.1r · uw ≥ 0.3r · lw ≥ 0.3r · r ≥ 1.3·ATR (진폭이 큰 도지)
  고파동  HWAVE    0.1r < body ≤ 0.3r · uw ≥ 0.3r · lw ≥ 0.3r · r ≥ 1.3·ATR
  도지    DOJI     body ≤ 0.1r 이고 장족도지 아님
  팽이    SPIN     0.1r < body ≤ 0.3r · uw ≥ 0.2r · lw ≥ 0.2r 이고 고파동 아님
  망치꼴  HAMMER   lw ≥ 0.6r · body ≤ 0.3r · uw ≤ 0.15r  (고점이면 교수형, 바닥이면 망치형 — 위치로 구분)
  역망치꼴 INVHAM  uw ≥ 0.6r · body ≤ 0.3r · lw ≤ 0.15r (고점이면 유성형, 바닥이면 역망치형)
  장대양봉 BIGBULL / 장대음봉 BIGBEAR  body ≥ 0.7r · r ≥ 1.5·ATR
  상승장악 BENGULF / 하락장악 SENGULF  전날 반대색 몸통을 오늘 몸통이 감쌈
  샛별 MSTAR / 석별 ESTAR  큰 음(양)봉 → 몸통 ≤0.3r 별 → 큰 양(음)봉이 첫 봉 몸통 중간 넘어 마감
  긴 윗꼬리 LUPPER / 긴 아랫꼬리 LLOWER  uw(lw) ≥ 0.5r 이고 위 꼴들이 아님
위치(볼밴 20·2σ, pos = (종가−하단)/(상단−하단))
  OUT_UP 상단 밖 · NEAR_UP 0.8~1 · MID 0.35~0.65 · NEAR_LO 0~0.2 · OUT_LO 하단 밖 · REENTRY 어제 하단 밖→오늘 안
직전 추세: 직전 10거래일 수익률 ≥ +10% 급등 · ≤ −10% 급락 · 그 외 보통
사용 python3 tools/fractal 계열과 같이 CI lab-quick에서: python tools/candle-context-lab.py
"""
import importlib.util, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)

def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py")
ss = _load("ss", "signal-stats.py")
H, COOL = (3, 5, 10, 20), 5
CANDLES = ["LLDOJI", "HWAVE", "DOJI", "SPIN", "HAMMER", "INVHAM", "BIGBULL", "BIGBEAR", "BENGULF", "SENGULF", "MSTAR", "ESTAR", "LUPPER", "LLOWER"]
KNAME = {"LLDOJI": "장족십자 도지", "HWAVE": "고파동", "DOJI": "일반 도지", "SPIN": "팽이", "HAMMER": "망치·교수형 꼴", "INVHAM": "역망치·유성형 꼴",
         "BIGBULL": "장대양봉", "BIGBEAR": "장대음봉", "BENGULF": "상승장악", "SENGULF": "하락장악", "MSTAR": "샛별형", "ESTAR": "석별형",
         "LUPPER": "긴 윗꼬리", "LLOWER": "긴 아랫꼬리"}

def rsi(c, n=14):
    d = np.diff(c, prepend=c[0]); up = np.clip(d, 0, None); dn = np.clip(-d, 0, None)
    au = pd.Series(up).ewm(alpha=1 / n, adjust=False).mean().to_numpy(); ad = pd.Series(dn).ewm(alpha=1 / n, adjust=False).mean().to_numpy()
    return 100 - 100 / (1 + au / np.where(ad == 0, np.nan, ad))

def features(o, h, l, c):
    N = len(c); r = h - l; rr = np.where(r > 0, r, np.nan)
    body = np.abs(c - o) / rr; uw = (h - np.maximum(o, c)) / rr; lw = (np.minimum(o, c) - l) / rr
    pc = np.r_[np.nan, c[:-1]]
    tr_ = np.maximum.reduce([h - l, np.abs(h - pc), np.abs(l - pc)]); atr = pd.Series(tr_).rolling(14).mean().to_numpy()
    big = r >= 1.3 * atr; vbig = r >= 1.5 * atr
    K = {}
    K["LLDOJI"] = (body <= 0.1) & (uw >= 0.3) & (lw >= 0.3) & big
    K["HWAVE"] = (body > 0.1) & (body <= 0.3) & (uw >= 0.3) & (lw >= 0.3) & big
    K["DOJI"] = (body <= 0.1) & ~K["LLDOJI"]
    K["SPIN"] = (body > 0.1) & (body <= 0.3) & (uw >= 0.2) & (lw >= 0.2) & ~K["HWAVE"]
    K["HAMMER"] = (lw >= 0.6) & (body <= 0.3) & (uw <= 0.15)
    K["INVHAM"] = (uw >= 0.6) & (body <= 0.3) & (lw <= 0.15)
    K["BIGBULL"] = (c > o) & (body >= 0.7) & vbig
    K["BIGBEAR"] = (c < o) & (body >= 0.7) & vbig
    po, pcl = np.r_[np.nan, o[:-1]], pc
    K["BENGULF"] = (pcl < po) & (c > o) & (o <= pcl) & (c >= po) & ((c - o) > (po - pcl))
    K["SENGULF"] = (pcl > po) & (c < o) & (o >= pcl) & (c <= po) & ((o - c) > (pcl - po))
    o2, c2, b1 = np.r_[np.nan, np.nan, o[:-2]], np.r_[np.nan, np.nan, c[:-2]], np.r_[np.nan, body[:-1]]
    big2 = np.r_[np.nan, np.nan, body[:-2]] >= 0.6
    K["MSTAR"] = big2 & (c2 < o2) & (b1 <= 0.3) & (c > o) & (c > (o2 + c2) / 2)
    K["ESTAR"] = big2 & (c2 > o2) & (b1 <= 0.3) & (c < o) & (c < (o2 + c2) / 2)
    other = np.logical_or.reduce([K[k] for k in ("LLDOJI", "HWAVE", "HAMMER", "INVHAM", "DOJI", "SPIN")])
    K["LUPPER"] = (uw >= 0.5) & ~other
    K["LLOWER"] = (lw >= 0.5) & ~other
    for k in K: K[k] = np.nan_to_num(K[k].astype(float)) > 0
    m = pd.Series(c).rolling(20).mean().to_numpy(); sd = pd.Series(c).rolling(20).std().to_numpy()
    up, lo = m + 2 * sd, m - 2 * sd; pos = (c - lo) / (up - lo)
    plo = np.r_[np.nan, lo[:-1]]
    Z = {"OUT_UP": c > up, "NEAR_UP": (pos >= 0.8) & (c <= up), "MID": (pos >= 0.35) & (pos <= 0.65),
         "NEAR_LO": (pos >= 0) & (pos <= 0.2), "OUT_LO": c < lo, "REENTRY": (pc < plo) & (c >= lo)}
    R = rsi(c)
    c10 = np.r_[np.full(10, np.nan), c[:-10]]; t10 = (c / c10 - 1) * 100
    T = {"급등": t10 >= 10, "급락": t10 <= -10, "보통": (t10 > -10) & (t10 < 10)}
    ma20, ma60 = m, pd.Series(c).rolling(60).mean().to_numpy()
    dd60 = (c / pd.Series(c).rolling(60).max().to_numpy() - 1) * 100
    return K, Z, R, T, ma20, ma60, dd60

# 사전 등록 가설 — (이름, 기대 방향, 위치 집합, RSI 조건, 추세, 캔들 집합)
UPC = ["LLDOJI", "HWAVE", "HAMMER", "INVHAM", "BENGULF", "MSTAR", "BIGBULL", "LLOWER", "DOJI", "SPIN"]
TOPC = ["LLDOJI", "HWAVE", "HAMMER", "INVHAM", "SENGULF", "ESTAR", "BIGBEAR", "LUPPER", "DOJI", "SPIN"]
HYP = [
    ("🔴 고점 위험 A (상단 밖·근처 · RSI≥70 · 직전 급등)", "down", ("OUT_UP", "NEAR_UP"), lambda R: R >= 70, "급등", TOPC),
    ("🟢 저점 반등 B (하단 밖·재진입·근처 · RSI≤30 · 직전 급락)", "up", ("OUT_LO", "REENTRY", "NEAR_LO"), lambda R: R <= 30, "급락", UPC),
    ("⚪ 방향 불분명 C (중앙 · RSI 40~60)", "up", ("MID",), lambda R: (R >= 40) & (R <= 60), None, CANDLES),
    ("🔵 상승 지속 (상단 근처·밖 · RSI 50~70 · 20일선>60일선)", "up", ("NEAR_UP", "OUT_UP"), lambda R: (R >= 50) & (R < 70), "MA_UP", ["BIGBULL", "BENGULF", "LLOWER", "HAMMER"]),
    ("🟣 하락 지속 (하단 근처·밖 · RSI 30~50 · 20일선<60일선)", "down", ("NEAR_LO", "OUT_LO"), lambda R: (R > 30) & (R <= 50), "MA_DN", ["BIGBEAR", "SENGULF", "LUPPER", "INVHAM"]),
]
# RSI 문턱 고원 확인(§3): 가설 A·B의 RSI 문턱을 이웃 값으로
PLATEAU = [("A", (65, 70, 75, 80)), ("B", (20, 25, 30, 35))]

def main():
    wl = ss.watchlist()
    qq = tr.fetch("QQQ"); q200 = qq["Close"].rolling(200).mean()
    regime = {str(d.date()): ("up" if c >= m else "down") for d, c, m in zip(qq.index, qq["Close"], q200) if not np.isnan(m)}
    ev = {}                     # key → list of (date, cat, reg, r3, r5, r10, r20, mae10)
    base = {}                   # (cat, reg) → [up, dn] per horizon idx
    for t, cat in wl.items():
        df = tr.fetch(t)
        if df is None or len(df) < 300: continue
        o, h, l, c = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close"))
        N = len(c); dates = np.array([str(d.date()) for d in df.index]); reg = np.array([regime.get(d, "") for d in dates])
        K, Z, R, T, ma20, ma60, dd60 = features(o, h, l, c)
        o1 = np.full(N, np.nan); o1[:-1] = o[1:]
        fw = {}
        for n in H:
            f = np.full(N, np.nan); f[:-n] = (c[n:] / o1[:-n] - 1) * 100; fw[n] = f
        lmin = pd.Series(l[::-1]).rolling(10).min().to_numpy()[::-1]; hmax = pd.Series(h[::-1]).rolling(10).max().to_numpy()[::-1]
        maeL = np.full(N, np.nan); maeL[:-10] = (lmin[1:N - 9] / o1[:-10] - 1) * 100          # 매수 쪽 최대 하락
        maeS = np.full(N, np.nan); maeS[:-10] = (hmax[1:N - 9] / o1[:-10] - 1) * 100          # 고점 위험 쪽: 신호 뒤 더 오른 폭
        ok = (np.arange(N) >= 260) & ~np.isnan(fw[3])
        for i in np.nonzero(ok)[0]:
            b = base.setdefault((cat, reg[i]), np.zeros((len(H), 2)))
            for j, n in enumerate(H):
                v = fw[n][i]
                if np.isnan(v): continue
                b[j, 0] += v > 1; b[j, 1] += v < -1
        def add(key, mask, down):
            last = -10 ** 9
            for i in np.nonzero(mask & ok)[0]:
                if i - last < COOL: continue
                last = i
                ev.setdefault(key, []).append((dates[i], cat, reg[i], fw[3][i], fw[5][i], fw[10][i], fw[20][i], maeS[i] if down else maeL[i]))
        trend = {"급등": T["급등"], "급락": T["급락"], "보통": T["보통"], "MA_UP": ma20 > ma60, "MA_DN": ma20 < ma60, None: np.ones(N, bool)}
        for hi, (nm, d, zs, rc, tk, cs) in enumerate(HYP):
            zm = np.logical_or.reduce([Z[z] for z in zs]) & np.nan_to_num(rc(R)).astype(bool) & trend[tk]
            for k in cs: add(("H", hi, k), zm & K[k], d == "down")
            add(("H", hi, "ANY"), zm & np.logical_or.reduce([K[k] for k in cs]), d == "down")
            add(("H", hi, "NOCANDLE"), zm, d == "down")                                       # 캔들 없이 위치·RSI·추세만
        for tag, ths in PLATEAU:
            for th in ths:
                if tag == "A":
                    zm = (Z["OUT_UP"] | Z["NEAR_UP"]) & (np.nan_to_num(R) >= th) & T["급등"]
                    add(("P", tag, th), zm & np.logical_or.reduce([K[k] for k in TOPC]), True)
                else:
                    zm = (Z["OUT_LO"] | Z["REENTRY"] | Z["NEAR_LO"]) & (np.nan_to_num(R, nan=100) <= th) & T["급락"]
                    add(("P", tag, th), zm & np.logical_or.reduce([K[k] for k in UPC]), False)
        # 탐색 격자: 캔들 × 위치 × RSI 4구간 (추세 무관) — 학습 구간에서만 고르고 시험 구간에서 확인
        rb = {"≤30": R <= 30, "30~50": (R > 30) & (R <= 50), "50~70": (R > 50) & (R < 70), "≥70": R >= 70}
        for k in CANDLES:
            for z, zmask in Z.items():
                for rn, rm in rb.items():
                    add(("G", k, z, rn), K[k] & zmask & np.nan_to_num(rm).astype(bool), False)
    alld = sorted({e[0] for v in ev.values() for e in v})
    mid, cut70, cut80 = alld[len(alld) // 2], alld[int(len(alld) * 0.7)], alld[int(len(alld) * 0.8)]
    def bshare(rows, j):            # 같은 섹터·같은 국면 평소 상승 비율(표본 구성 가중)
        num = den = 0.0
        for r in rows:
            b = base.get((r[1], r[2]))
            if b is None or b[j].sum() == 0: continue
            num += b[j, 0] / b[j].sum(); den += 1
        return num / den * 100 if den else None
    def upr(rows, j):
        x = [r[3 + j] for r in rows if not np.isnan(r[3 + j])]
        w = sum(v > 1 for v in x); lo = sum(v < -1 for v in x)
        return (w / (w + lo) * 100 if w + lo else None), len(x), (np.mean(x) if x else None)
    def tier(n): return "사용" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "불가"
    f0 = lambda v: "—" if v is None else f"{v:.0f}"
    def line(name, rows, down):
        if not rows: return f"    {name:<16} 표본 0"
        cells = []
        for j, n in enumerate(H):
            u, cnt, a = upr(rows, j); b = bshare(rows, j)
            if down:
                cells.append(f"+{n} 하락{f0(None if u is None else 100 - u)}%/평소{f0(None if b is None else 100 - b)}% {a:+.1f}%")
            else:
                cells.append(f"+{n} 상승{f0(u)}%/평소{f0(b)}% {a:+.1f}%")
        mae = np.nanmedian([r[7] for r in rows])
        halves = [upr([r for r in rows if r[0] < mid], 2)[0], upr([r for r in rows if r[0] >= mid], 2)[0], upr([r for r in rows if r[0] >= cut80], 2)[0]]
        if down: halves = [None if v is None else 100 - v for v in halves]
        hv = "/".join(f0(v) for v in halves)
        return (f"    {name:<16} n={len(rows):<5}[{tier(len(rows))}] " + " · ".join(cells)
                + f" · {'신호 뒤 추가 상승' if down else '중간 최대하락'} {mae:+.1f}% · 10일 앞/뒤/최근20% {hv}")
    print(f"■ 캔들 × 볼밴 위치 × RSI × 직전 추세 · {alld[0]}~{alld[-1]} · 관심종목 {len(wl)}개 · 다음 날 시가 진입 · 같은 조건 {COOL}일 쿨다운")
    print(f"  '평소' = 같은 섹터·같은 국면(QQQ 200일선) 평소 비율을 표본 구성대로 가중 · 보합 ±1% 제외 · 앞/뒤 경계 {mid} · 최근 20% {cut80}")
    for hi, (nm, d, zs, rc, tk, cs) in enumerate(HYP):
        print(f"\n  [{nm}] — 기대: {'하락' if d == 'down' else '상승'}")
        print(line("캔들 없이(조건만)", ev.get(("H", hi, "NOCANDLE"), []), d == "down"))
        print(line("후보 캔들 아무거나", ev.get(("H", hi, "ANY"), []), d == "down"))
        for k in cs:
            print(line(KNAME[k], ev.get(("H", hi, k), []), d == "down"))
    print("\n  [§3 RSI 문턱 고원 — 가설 A(고점, 하락 비율) · B(반등, 상승 비율) · 10일]")
    for tag, ths in PLATEAU:
        s = []
        for th in ths:
            rows = ev.get(("P", tag, th), []); u, n_, a = upr(rows, 2)
            v = None if u is None else (100 - u if tag == "A" else u)
            s.append(f"RSI{'≥' if tag == 'A' else '≤'}{th}: {f0(v)}%({n_})")
        print("    " + tag + "  " + " · ".join(s))
    print(f"\n  [탐색 격자 — 캔들×위치×RSI 4구간, 학습(~{cut70})에서 10일 상승/하락이 평소보다 10%p+ 차이 & 학습 n≥30 → 시험({cut70}~)]")
    found = []
    for key, rows in ev.items():
        if key[0] != "G": continue
        tr_rows = [r for r in rows if r[0] < cut70]; te_rows = [r for r in rows if r[0] >= cut70]
        if len(tr_rows) < 30: continue
        u, n_, a = upr(tr_rows, 2); b = bshare(tr_rows, 2)
        if u is None or b is None or abs(u - b) < 10: continue
        ut, nt, at = upr(te_rows, 2); bt = bshare(te_rows, 2)
        found.append((abs(u - b), key, u, b, n_, a, ut, bt, nt, at))
    found.sort(key=lambda x: -x[0])
    tested = len([k for k in ev if k[0] == "G" and len([r for r in ev[k] if r[0] < cut70]) >= 30])
    print(f"    학습 n≥30 조합 {tested}개 중 {len(found)}개가 문턱 통과 (우연이면 이 중 상당수가 시험에서 사라진다)")
    for x in found[:15]:
        _, (g, k, z, rn), u, b, n_, a, ut, bt, nt, at = x
        keep = "유지" if (ut is not None and bt is not None and (ut - bt) * (u - b) > 0 and abs(ut - bt) >= 5) else "소멸"
        print(f"    {KNAME[k]:<9} {z:<8} RSI{rn:<6} 학습 상승{f0(u)}%/평소{f0(b)}% n={n_} {a:+.1f}% → 시험 상승{f0(ut)}%/평소{f0(bt)}% n={nt} "
              f"{'' if at is None else f'{at:+.1f}%'} [{keep}]")
    surv = sum(1 for x in found if x[6] is not None and x[7] is not None and (x[6] - x[7]) * (x[2] - x[3]) > 0 and abs(x[6] - x[7]) >= 5)
    print(f"    시험에서 같은 방향 5%p+ 유지: {surv}/{len(found)}")

if __name__ == "__main__":
    main()
