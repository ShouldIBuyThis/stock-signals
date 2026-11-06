#!/usr/bin/env python3
"""테마별 '볼밴 이탈 형태 × 캔들 × 변동성지수(VXN)' 조합 — 어떤 패턴 뒤에 단기 하락·급락이 잦았나 (연구 전용)

왜 (2026-11-06 사용자): "캔들이랑 변동성지수도 활용해서 다양하게 조합해서 테마별로 어떤 산식이 베스트인지 요약.
  예) 양자는 볼밴 십자형 이탈 체류 후 단기하락 비율이 높았다, 반도체장비는 볼밴 이탈 후 윗꼬리 장대음봉 연속 이후 폭락"

방법
  · 데이터·지표는 tools/theme-patterns.py prep() 그대로(10년 일봉). 미래값(f5/f10/dd20)은 결과 칸에만 쓴다.
  · 맥락(볼밴 20·2σ) × 캔들(오늘·어제) × VXN 조건을 전부 곱한다. 한국 종목은 전날 미국 VXN을 쓴다(같은 날 값은 미래).
  · 한 테마 안 같은 날은 1건(평균), 같은 종목 신호는 5거래일 쿨다운.
  · 결과: 5일 하락 · 10일 하락 · 20일 안 −10% 급락 · 10일 평균. 테마 기준(아무 날)과 나란히.
  · 과최적화 방어: 앞 80% 기간에서 고르고(5건+), 뒤 20%에서 확인. 수익률 섞은 가짜 가격으로 같은 절차(--placebo N).
사용  python tools/theme-combos.py [--placebo 2]
"""
import importlib.util, sys, time
import numpy as np, pandas as pd

H = __file__.rsplit("/", 1)[0]
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{H}/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tp = _load("tp", "theme-patterns.py")
tr, tt = tp.tr, tp.tt
log, shift, gt, lt, wilson = tr.log, tr.shift, tr.gt, tr.lt, tr.wilson
T0 = time.time()
COOL = 5

def contexts(P):
    c, up, h = P["c"], P["bbup1"], P["h"]
    out_ = gt(c, up); run = tt.runlen(out_)
    out1 = shift(out_.astype(float)) > 0.5
    return {
        "종가 상단 밖": out_,
        "고가만 상단 돌파": gt(h, up) & ~out_,
        "상단 밖 3일+ 체류": run >= 3,
        "체류 뒤 첫 재진입": ~out_ & out1 & (shift(run.astype(float)) >= 2),
        "RSI14≥70": gt(P["rsi14"], 70 - 1e-9),
    }

def candles(P):
    o, c, h, l = P["o"], P["c"], P["h"], P["l"]
    upw, loww, body, atr = P["upw"], P["loww"], P["body"], P["atr"]
    rng = h - l
    o1, c1, upw1, body1 = shift(o), shift(c), shift(upw), shift(body)
    bear = lt(c, o)
    long_bear = bear & gt(body, 0.6 - 1e-9) & gt(rng, 1.2 * atr)
    return {
        "캔들 조건 없음": None,
        "십자형(몸통≤10%)": lt(body, 0.10 + 1e-9),
        "윗꼬리≥50%": gt(upw, 0.5 - 1e-9),
        "2일 연속 윗꼬리≥30%": gt(upw, 0.3 - 1e-9) & gt(upw1, 0.3 - 1e-9),
        "장대음봉": long_bear,
        "윗꼬리 다음 날 장대음봉": gt(upw1, 0.4 - 1e-9) & long_bear,
        "유성형": gt(upw, 0.6 - 1e-9) & lt(body, 0.3 + 1e-9) & lt(loww, 0.15 + 1e-9),
        "교수형": gt(loww, 0.6 - 1e-9) & lt(body, 0.3 + 1e-9) & lt(upw, 0.15 + 1e-9),
        "큰 양봉 다음 날 별": gt(c1, o1) & gt(body1, 0.6 - 1e-9) & lt(body, 0.3 + 1e-9) & gt(np.minimum(o, c), c1 * 0.995),
        "2일 연속 음봉": bear & lt(c1, o1),
    }

def vxn_conds(P):
    v = P["vxn"]; v5 = shift(v, 5)
    return {
        "VXN 무관": None,
        "VXN≥25(공포)": gt(v, 25 - 1e-9),
        "VXN<20(안심)": lt(v, 20),
        "VXN 5일 +10%↑(공포 확대)": gt(v, v5 * 1.10),
        "VXN 5일 −10%↓(공포 축소)": lt(v, v5 * 0.90),
    }

def attach_vxn(U, vxn):
    vm = dict(zip([str(d.date()) for d in vxn.index], vxn.to_numpy(float)))
    for t, P in U.items():
        v = np.array([vm.get(d, np.nan) for d in P["dates"]])
        v = pd.Series(v).ffill().to_numpy()
        if t.endswith((".KS", ".KQ")):
            v = shift(v)                     # 한국 종가 시점엔 그날 미국 VXN이 아직 없다
        P["vxn"] = v

def events(U, tks, mask_fn):
    """[(date, f5, f10, dd20)] — 종목별 쿨다운 후, 같은 날은 평균 1건."""
    by = {}
    for t in tks:
        P = U[t]; m = mask_fn(P)
        if m is None:
            continue
        m = tp.declust(m & P["ok"], COOL)
        for i in np.nonzero(m)[0]:
            if np.isnan(P["f10"][i]) or np.isnan(P["dd20"][i]):
                continue
            by.setdefault(P["dates"][i], []).append((P["f5"][i], P["f10"][i], P["dd20"][i]))
    return sorted((d, np.mean([x[0] for x in v]), np.mean([x[1] for x in v]), np.mean([x[2] for x in v])) for d, v in by.items())

def stats(ev):
    if not ev:
        return None
    a = np.array([e[1:] for e in ev], float)
    return dict(n=len(ev), d5=float(np.mean(a[:, 0] < 0)), d10=float(np.mean(a[:, 1] < 0)),
                crash=float(np.mean(a[:, 2] <= -10)), avg=float(np.mean(a[:, 1])))

def fs(s):
    if not s:
        return "—(0)"
    return f"5일↓{s['d5']*100:.0f}% 10일↓{s['d10']*100:.0f}% 급락{s['crash']*100:.0f}% 평균{s['avg']:+.1f}% ({s['n']})"

def search(U, tks, quiet=False):
    dates = sorted({d for t in tks for d in U[t]["dates"][U[t]["ok"]]})
    if len(dates) < 200:
        return None
    cut = dates[int(len(dates) * 0.8)]
    base_all = stats(events(U, tks, lambda P: np.ones(len(P["c"]), bool)))
    C = {t: (contexts(U[t]), candles(U[t]), vxn_conds(U[t])) for t in tks}
    names = (list(C[tks[0]][0]), list(C[tks[0]][1]), list(C[tks[0]][2]))
    rows = []
    for cn in names[0]:
        for kn in names[1]:
            for vn in names[2]:
                def mk(P, t=None, cn=cn, kn=kn, vn=vn):
                    cx, kd, vd = C[P["_t"]]
                    m = cx[cn].copy()
                    if kd[kn] is not None: m &= kd[kn]
                    if vd[vn] is not None: m &= vd[vn]
                    return m
                ev = events(U, tks, mk)
                fr = stats([e for e in ev if e[0] < cut]); bk = stats([e for e in ev if e[0] >= cut])
                if fr and fr["n"] >= 5:
                    rows.append((cn, kn, vn, fr, bk, stats(ev)))
    return base_all, cut, rows

def pick(rows, key, k=3):
    """앞 80% 기준 Wilson 하한으로 줄 세움(급락·하락은 비율이 클수록 '좋은' 매도 패턴)."""
    def lb(s):
        return wilson(s[key], s["n"])[0]
    return sorted(rows, key=lambda r: -lb(r[3]))[:k]

def report(name, U, tks):
    res = search(U, tks)
    if not res:
        log(f"\n  ▣ {name} — 표본 부족"); return None
    base, cut, rows = res
    log(f"\n  ▣ {name} ({', '.join(tks)}) · 기준(아무 날) {fs(base)} · 앞/뒤 경계 {cut} · 후보 {len(rows)}개")
    out = {}
    for key, title in (("d10", "10일 단기 하락"), ("crash", "20일 안 −10% 급락")):
        log(f"    [{title} 비율 상위 — 앞 80% → 뒤 20% · 10년 전체]")
        top = pick(rows, key)
        out[key] = top
        for cn, kn, vn, fr, bk, al in top:
            log(f"      {cn} + {kn} + {vn}")
            log(f"        앞 {fs(fr)}  →  뒤 {fs(bk)}  |  10년 {fs(al)}")
    return base, out

def main():
    wl = tp.watchlist()
    tks = sorted(set(t for v in tp.SECTORS.values() for t in v) | set(wl) | set(tp.EXTRA) | {"QQQ", "^VXN"})
    data = {}
    for t in tks:
        df = tr.fetch(t)
        if df is not None and t in tt.STARTS:
            df = df[df.index >= tt.STARTS[t]]
        data[t] = df
    vxn = data["^VXN"]["Close"]
    def build(dd):
        U = {t: tp.prep(df) for t, df in dd.items() if df is not None and len(df) > 260 and not t.startswith("^V")}
        for t, P in U.items(): P["_t"] = t
        attach_vxn(U, vxn)
        groups = {}
        for t in U:
            groups.setdefault(tp.theme_of(t, wl), []).append(t)
        return U, {g: v for g, v in groups.items() if g in tp.SECTORS or g in tp.EXTRA.values()}
    U, groups = build(data)
    log(f"■ 테마별 볼밴 이탈 형태 × 캔들 × VXN — 매도·경계 패턴 (10년, 종목 {len(U)}개)")
    log("  칸: 5일↓ = 5일 뒤 하락 비율 · 10일↓ · 급락 = 20일 안 저가가 −10% 이하 · 평균 = 10일 수익률 평균 · (건수, 같은 날 1건)")
    log("  조합 = 맥락 5 × 캔들 10 × VXN 5 = 250개/테마. 앞 80% 5건+만 후보.")
    summary = {}
    for g in sorted(groups):
        tk = [t for t in groups[g] if t not in ("TQQQ", "^NDX", "SOXX")] or groups[g]
        r = report(g, U, tk)
        if r: summary[g] = r
    # 요약: 뒤 20%에서도 기준보다 높았던 것만
    log("\n■ 요약 — 앞 80%에서 고른 1·2·3위 중 뒤 20%에서도 테마 기준보다 높았던 패턴 (뒤 3건+)")
    held = tot = 0
    for g, (base, out) in summary.items():
        for key, lab in (("d10", "10일 하락"), ("crash", "급락")):
            for cn, kn, vn, fr, bk, al in out[key]:
                tot += 1
                if bk and bk["n"] >= 3 and bk[key] > base[key]:
                    held += 1
                    log(f"  {g} · {lab}: {cn} + {kn} + {vn} — 앞 {fr[key]*100:.0f}%({fr['n']}) → 뒤 {bk[key]*100:.0f}%({bk['n']}) vs 기준 {base[key]*100:.0f}%")
    log(f"  유지 {held}/{tot}")
    if "--placebo" in sys.argv:
        k = int(sys.argv[sys.argv.index("--placebo") + 1])
        for s in range(k):
            rng = np.random.default_rng(4000 + s)
            pdata = {t: (tr.permuted(df, rng) if df is not None and not t.startswith("^V") else df) for t, df in data.items()}
            PU, pg = build(pdata)
            h2 = t2 = 0
            for g in pg:
                tk = [t for t in pg[g] if t not in ("TQQQ", "^NDX", "SOXX")] or pg[g]
                res = search(PU, tk, quiet=True)
                if not res: continue
                base, cut, rows = res
                for key in ("d10", "crash"):
                    for r in pick(rows, key):
                        t2 += 1
                        if r[4] and r[4]["n"] >= 3 and r[4][key] > base[key]:
                            h2 += 1
            log(f"  대조(수익률 섞기) {s+1}: 유지 {h2}/{t2}")
    log(f"\n(총 {time.time()-T0:.0f}초)")

if __name__ == "__main__":
    main()
