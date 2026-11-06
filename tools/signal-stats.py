#!/usr/bin/env python3
"""신호 보드용 10년 실측 — 신호(pattern_flags 코드)별 · 사이트 테마별 적중률·수익률·불리한 움직임 (백테스트, 원장 아님)

왜 (2026-11-06 사용자): "오늘 어떤 종목에 무슨 반등·위험 신호가 떴고, 과거엔 얼마나 잘 맞았고, 지금 무엇을 고려해야 하나"를
  3초 안에 보이게. 숫자는 임의로 채우지 말고 실제 계산값만.
방법
  · 판정은 pattern_flags.flag_series() 그대로(사이트 원장 pat과 같은 함수). 관심종목(main.py WATCHLIST, 국장 포함) 10년 일봉.
  · 신호 방향: 🟢 반등·🔵 추세 = 오르면 적중, 🟠 과열·🔴 위험 = 내리면 적중. 기준 = 10거래일.
  · 같은 종목 같은 신호는 10거래일 쿨다운, 한 그룹 안 같은 날은 1건(평균).
  · 앞 80% / 뒤 20%(날짜 기준)로 나눠 재현을 본다. 평균 손실이 평균 이익의 1.5배를 넘으면 '손익비 나쁨'.
  · 판정: 표본 부족(<15) / 검증 부족(뒤 20% <5건) / 평소와 비슷(기준+5%p 미만) / 최근 재현 안 됨(뒤 20%가 기준 이하) /
          손익비 나쁨 / 검증됨 / 75% 달성(전체·뒤 20% 모두 75%↑)
  · 정상 과열 vs 위험 고점: 🟠 신호 뒤 5일 안에 🔴 신호가 이어진 경우와 아닌 경우의 10일 뒤를 비교.
  ⚠ 관심종목을 지금 골랐으므로 생존 편향이 있다(특히 반등 쪽이 좋아 보일 수 있다).
출력  backtest/signal-stats.json
사용  python tools/signal-stats.py [--out backtest/signal-stats.json]
"""
import ast, importlib.util, json, sys, time
from datetime import datetime, timezone
import numpy as np, pandas as pd

ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)
import pattern_flags as pf

def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py")
COOL, H = 10, (3, 5, 10, 20)

def kind_of(code):
    k = pf.CODES[code][0]
    if code.startswith("C_"): return None
    if k in ("green", "bounce", "theme_buy"): return "green"
    if k == "blue": return "blue"
    if k in ("orange", "trim") or code in ("R_MA20", "R_MA200"): return "orange"
    if k in ("red", "danger") or code in ("R_PARA", "R_BLOW"): return "red"
    return None

def watchlist():
    src = open(f"{ROOT}/main.py", encoding="utf-8").read()
    i = src.index("WATCHLIST = {"); j = src.index("\n}\n", i) + 2
    wl = ast.literal_eval(src[i + len("WATCHLIST = "):j])
    return {t: cat for cat, g in wl.items() for t in g}

def per_ticker(t, df, regime):
    """체결 = 신호일 종가로 확정 → 다음 거래일 시가(o[i+1]) 진입, n거래일 뒤 종가 c[i+n] (2026-11-06 지적 반영).
    참고용으로 신호일 종가 진입(c[i]) 10일 수익도 같이 둔다."""
    o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
    ser = pf.flag_series(o, h, l, c, v, t)
    dates = np.array([str(d.date()) for d in df.index])
    N = len(c); fw = {}
    o1 = np.full(N, np.nan); o1[:-1] = o[1:]
    for n in H:
        f = np.full(N, np.nan); f[:-n] = (c[n:] / o1[:-n] - 1) * 100; fw[n] = f
    fc10 = np.full(N, np.nan); fc10[:-10] = (c[10:] / c[:-10] - 1) * 100
    lo = pd.Series(l[::-1]).rolling(10).min().to_numpy()[::-1]; hi = pd.Series(h[::-1]).rolling(10).max().to_numpy()[::-1]
    mn = np.full(N, np.nan); mx = np.full(N, np.nan)
    mn[:-10] = (lo[1:N - 9] / o1[:-10] - 1) * 100; mx[:-10] = (hi[1:N - 9] / o1[:-10] - 1) * 100
    ok = np.arange(N) >= 260                                   # 지표 워밍업(200일선) 뒤만
    reg = np.array([regime.get(d, "") for d in dates])
    ev, idx = {}, {}
    for code, m in ser.items():
        if kind_of(code) is None: continue
        last = -10 ** 9
        for i in np.nonzero(m & ok)[0]:
            if i - last < COOL: continue
            last = i
            ev.setdefault(code, []).append((str(dates[i]), t, *(fw[n][i] for n in H), mn[i], mx[i], fc10[i], reg[i]))
            idx.setdefault(code, []).append(i)
    base = [(dates[i], fw[10][i], reg[i]) for i in range(260, N, 5) if not np.isnan(fw[10][i])]
    return ev, base, idx, fw[10], N

def wilson_lb(p, n, z=1.96):
    if not n: return None
    d = 1 + z * z / n
    return (p + z * z / (2 * n) - z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d

def summarize(evs, kind, base_up, cut, base_reg=None, pval=None):
    """evs: [(date, tk, f3, f5, f10, f20, mn10, mx10)] → 같은 날 평균 1건으로 묶어 통계."""
    by = {}
    for e in evs:
        by.setdefault(e[0], []).append(e)
    rows = []
    for d, es in sorted(by.items()):
        a = np.array([x[2:9] for x in es], float)
        rows.append((d, ",".join(sorted({x[1] for x in es})), *np.nanmean(a, axis=0), es[0][9]))
    done = [r for r in rows if not np.isnan(r[4])]
    up = kind in ("green", "blue")
    def hit(rs, k=4):
        rs = [r for r in rs if not np.isnan(r[k])]
        return (sum((r[k] > 0) == up for r in rs) / len(rs)) if rs else None
    n = len(done)
    out = {"n": n, "n_all": len(rows)}
    if n:
        f10 = np.array([r[4] for r in done])
        sgn = 1 if up else -1
        wins = f10[sgn * f10 > 0] * sgn; losses = f10[sgn * f10 <= 0] * sgn
        fr = [r for r in done if r[0] < cut]; bk = [r for r in done if r[0] >= cut]
        out.update({
            "hit10": hit(done), "hit5": hit(done, 3),
            "avg": {str(k): float(np.nanmean([r[2 + i] for r in done])) for i, k in enumerate(H)},
            "adverse10": float(np.nanmean([r[6] if up else r[7] for r in done])),
            "adverse10_med": float(np.nanmedian([r[6] if up else r[7] for r in done])),
            "avg_win": float(wins.mean()) if len(wins) else 0.0, "avg_loss": float(-losses.mean()) if len(losses) else 0.0,
            "front": {"n": len(fr), "hit10": hit(fr)}, "back": {"n": len(bk), "hit10": hit(bk)},
            "hit10_close": hit([r for r in done if not np.isnan(r[8])], 8),
            "regime": {g: {"n": len([r for r in done if r[9] == g]), "hit10": hit([r for r in done if r[9] == g])} for g in ("up", "down")},
        })
        out["wilson10"] = wilson_lb(out["hit10"], n)
    base_hit = base_up if up else (1 - base_up if base_up is not None else None)
    out["base10"] = base_hit
    if base_reg:
        out["base_regime"] = {g: (b if up else (1 - b if b is not None else None)) for g, b in base_reg.items()}
    out["p_shift"] = pval
    # 판정 (2026-11-06 강화): 검증 완료 = 아래 전부. 하나라도 빠지면 '연구 후보'(평소보다 나은데 확인 안 됨) 또는 '평소와 비슷'.
    v, why = "표본 부족", []
    if n >= 15 and base_hit is not None:
        bh = out["back"]["hit10"]
        lift = out["hit10"] - base_hit
        if lift < 0.05:
            v = "평소와 비슷"
        else:
            if n < 30: why.append(f"표본 {n}건(30건 미만)")
            if out["back"]["n"] < 8: why.append(f"최근 20% 표본 {out['back']['n']}건")
            elif bh is None or bh <= base_hit: why.append("최근 20%에서 재현 안 됨")
            if out["wilson10"] is None or out["wilson10"] <= base_hit: why.append("95% 신뢰 하한이 평소 이하")
            if pval is None or pval >= 0.05: why.append("우연과 구별 안 됨(블록 대조)")
            if out["avg_loss"] > 1.5 * max(out["avg_win"], 1e-9): why.append("손실이 이익의 1.5배 초과")
            if why: v = "연구 후보"
            elif out["hit10"] >= 0.75 and bh is not None and bh >= 0.75: v = "75% 달성"
            else: v = "검증 완료"
    elif n < 15 and n and base_hit is not None and out.get("hit10") is not None and out["hit10"] - base_hit >= 0.05:
        v, why = "연구 후보", [f"표본 {n}건(15건 미만)"]
    out["verdict"] = v
    out["why"] = why
    keep = 30
    out["cases"] = [[r[0], r[1], *[None if np.isnan(x) else round(float(x), 1) for x in r[2:8]], r[9]] for r in rows[-keep:]]
    return out

def rnd(o):
    if isinstance(o, float): return None if np.isnan(o) else round(o, 3)
    if isinstance(o, dict): return {k: rnd(v) for k, v in o.items()}
    if isinstance(o, list): return [rnd(x) for x in o]
    return o

def main():
    T0 = time.time()
    out_path = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else f"{ROOT}/backtest/signal-stats.json"
    wl = watchlist()
    qq = tr.fetch("QQQ")
    q200 = qq["Close"].rolling(200).mean()
    regime = {str(d.date()): ("up" if c >= m else "down") for d, c, m in zip(qq.index, qq["Close"], q200) if not np.isnan(m)}
    rng = np.random.default_rng(7)
    shift_hits = {}                                          # code → [placebo별 (적중수, 표본수)] — 블록 대조
    real_hits = {}
    ev_all, base_all = {}, {}
    hl = {}                                                  # 날짜 → [n, [신고가권], [신저가권]] (미국 관심종목)
    for t, cat in wl.items():
        df = tr.fetch(t)
        if df is None or len(df) < 300:
            print(f"  건너뜀 {t} ({0 if df is None else len(df)}봉)"); continue
        if not t.endswith((".KS", ".KQ")):
            h52 = df["High"].rolling(252, min_periods=252).max(); l52 = df["Low"].rolling(252, min_periods=252).min()
            pfh = df["Close"] / h52 - 1; pfl = df["Close"] / l52 - 1
            for d, a, b in zip(df.index, pfh.to_numpy(), pfl.to_numpy()):
                if np.isnan(a) or np.isnan(b): continue
                x = hl.setdefault(str(d.date()), [0, [], []]); x[0] += 1
                if a >= -0.01: x[1].append(t)
                if b <= 0.01: x[2].append(t)
        ev, base, idx, f10, N = per_ticker(t, df, regime)
        # 블록 대조: 종목의 신호 날짜 묶음을 통째로 원형 이동(k일) — 신호끼리의 뭉침·변동성 군집은 그대로, 시점만 무관하게
        valid = np.arange(260, N - 11)
        for code, ii in idx.items():
            up = kind_of(code) in ("green", "blue")
            ii = np.array(ii); fv = f10[ii]; fv = fv[~np.isnan(fv)]
            rh = real_hits.setdefault(code, [0, 0]); rh[0] += int(((fv > 0) == up).sum()); rh[1] += len(fv)
            sh = shift_hits.setdefault(code, np.zeros((200, 2)))
            if len(valid) < 50: continue
            span = len(valid)
            for b in range(200):
                k = rng.integers(20, span - 20)
                jj = valid[0] + ((ii - valid[0] + k) % span)
                fs = f10[jj]; fs = fs[~np.isnan(fs)]
                sh[b, 0] += ((fs > 0) == up).sum(); sh[b, 1] += len(fs)
        for code, es in ev.items():
            ev_all.setdefault(code, {}).setdefault(cat, []).extend(es)
        base_all.setdefault(cat, []).extend(base)
    alld = sorted({e[0] for c in ev_all.values() for es in c.values() for e in es})
    cut = alld[int(len(alld) * 0.8)] if alld else "9999"
    def base_up(rows):
        return (sum(r[1] > 0 for r in rows) / len(rows)) if rows else None
    def base_reg(rows):
        return {g: base_up([r for r in rows if r[2] == g]) for g in ("up", "down")}
    def pval(code):
        rh, sh = real_hits.get(code), shift_hits.get(code)
        if not rh or not rh[1] or sh is None: return None
        real = rh[0] / rh[1]; ph = sh[:, 0] / np.maximum(sh[:, 1], 1)
        return float((np.sum(ph >= real) + 1) / (len(ph) + 1))
    allbase = [r for rs in base_all.values() for r in rs]
    stats = {}
    for code, cats in ev_all.items():
        kind = kind_of(code)
        allev = [e for es in cats.values() for e in es]
        pv = pval(code)
        stats[code] = {"kind": kind, "name": pf.CODES[code][1], "all": summarize(allev, kind, base_up(allbase), cut, base_reg(allbase), pv),
                       "by_cat": {cat: summarize(es, kind, base_up(base_all.get(cat, [])), cut, base_reg(base_all.get(cat, [])), None) for cat, es in cats.items() if len(es) >= 5}}
        for cs in stats[code]["by_cat"].values():
            cs["cases"] = cs["cases"][-12:]
    # 정상 과열 vs 위험 고점: 🟠 뒤 5일 안 🔴 이어짐 여부
    red_days = {}
    for code, cats in ev_all.items():
        if kind_of(code) != "red": continue
        for es in cats.values():
            for e in es: red_days.setdefault(e[1], set()).add(e[0])
    calm, danger = [], []
    for code, cats in ev_all.items():
        if kind_of(code) != "orange": continue
        for es in cats.values():
            for e in es:
                ds = red_days.get(e[1], set())
                end = (pd.Timestamp(str(e[0])) + pd.Timedelta(days=8)).strftime("%Y-%m-%d")   # 5거래일 ≈ 달력 8일
                follow = any(str(e[0]) <= d <= end for d in ds)
                (danger if follow else calm).append(e)
    def cmp(es):
        es = [e for e in es if not np.isnan(e[4])]
        if not es: return None
        a = np.array([[e[4], e[5], e[6]] for e in es])
        return {"n": len(es), "down10": float(np.mean(a[:, 0] < 0)), "avg10": float(np.mean(a[:, 0])),
                "avg20": float(np.nanmean(a[:, 1])), "crash10": float(np.mean(a[:, 2] <= -10))}
    res = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
           "period": [alld[0] if alld else None, alld[-1] if alld else None], "cut": cut,
           "universe": len(wl), "cooldown": COOL, "horizon": 10, "entry": "신호일 종가 확정 → 다음 거래일 시가 진입, n거래일 뒤 종가",
           "regime_today": regime.get(max(regime)) if regime else None,
           "note": "백테스트(관심종목 10년, 생존 편향 있음) — 원장이 아님. 판정은 pattern_flags.py(사이트와 같은 함수).",
           "compare_overheat": {"calm": cmp(calm), "then_red": cmp(danger)},
           "stats": stats}
    json.dump(rnd(res), open(out_path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    # ── 52주 신고가·신저가 이력 (사이트 52주 화면 '과거에는 어땠나'·그래프용) ──
    q = tr.fetch("QQQ")
    qc, ql = q["Close"].to_numpy(float), q["Low"].to_numpy(float)
    qd = [str(d.date()) for d in q.index]; N = len(qc)
    qf = {}
    for i, d in enumerate(qd):
        f5 = (qc[i + 5] / qc[i] - 1) * 100 if i + 5 < N else None
        f10 = (qc[i + 10] / qc[i] - 1) * 100 if i + 10 < N else None
        mdd = (ql[i + 1:i + 11].min() / qc[i] - 1) * 100 if i + 10 < N else None
        qf[d] = (f5, f10, mdd, qc[i])
    keep_lists = sorted(hl)[-800:]                            # 종목 목록은 최근 약 3년만(용량)
    rows = []
    for d in sorted(hl):
        n, a, b = hl[d]
        if n < 20 or d not in qf: continue
        f5, f10, mdd, px = qf[d]
        rows.append([d, n, len(a), len(b), sorted(a) if d in keep_lists else None, sorted(b) if d in keep_lists else None,
                     None if f5 is None else round(f5, 2), None if f10 is None else round(f10, 2),
                     None if mdd is None else round(mdd, 2), round(float(px), 2)])
    import os
    bpath = os.path.join(os.path.dirname(out_path) or ".", "breadth-history.json")
    json.dump({"generated_at": res["generated_at"], "universe": "관심종목 미국(main.py WATCHLIST) — NYSE 전체가 아님",
               "def": "신고가권 = 종가가 52주(252봉) 최고가의 1% 안 · 신저가권 = 52주 최저가의 1% 안 · 야후 수정주가",
               "cols": ["date", "n", "nh", "nl", "nh_list", "nl_list", "qqq_f5", "qqq_f10", "qqq_mdd10", "qqq_close"],
               "rows": rows}, open(bpath, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"저장 {bpath} · {len(rows)}일 · {rows[0][0] if rows else '-'}~{rows[-1][0] if rows else '-'}")
    print(f"저장 {out_path} · 신호 {len(stats)}개 · {res['period']} · 경계 {cut} · {time.time()-T0:.0f}초")
    for code, st in sorted(stats.items(), key=lambda x: (x[1]["kind"], x[0])):
        a = st["all"]
        if not a.get("n"): continue
        print(f"  {st['kind']:6} {code:11} {st['name'][:22]:22} n={a['n']:4} 적중10 {a['hit10']*100:4.0f}% (기준 {a['base10']*100:3.0f}%) "
              f"앞 {(a['front']['hit10'] or 0)*100:3.0f}%({a['front']['n']}) 뒤 {(a['back']['hit10'] or 0)*100:3.0f}%({a['back']['n']}) "
              f"평균10 {a['avg']['10']:+5.1f}% 하한 {(a.get('wilson10') or 0)*100:3.0f}% p {a.get('p_shift') if a.get('p_shift') is not None else '-'} "
              f"상승장 {((a['regime']['up']['hit10'] or 0)*100):3.0f}%({a['regime']['up']['n']}) 하락장 {((a['regime']['down']['hit10'] or 0)*100):3.0f}%({a['regime']['down']['n']}) "
              f"종가체결 {((a.get('hit10_close') or 0)*100):3.0f}% → {a['verdict']} {' / '.join(a.get('why') or [])}")
    print("  정상 과열 vs 🔴 이어짐:", res["compare_overheat"])

if __name__ == "__main__":
    main()
