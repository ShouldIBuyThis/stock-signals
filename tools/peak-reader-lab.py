"""🔬 고점판독기 연구 — docs/2026-11-12-peak-reader.md 사전 등록 그대로. CI 전용(야후).
조건 정의는 pattern_flags.peak_reader_flags 한 곳(재구현 없음). 성과는 평가에만 쓰는 미래값.
사용: python tools/peak-reader-lab.py --emit backtest/peak-reader.json
"""
import argparse, importlib.util, json, re, sys
from datetime import datetime, timezone
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)
import pattern_flags as pf


def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m


tr = _load("tr", "theme-research.py"); bb = _load("bb", "bb-walk-lab.py")
EXTRA = ["QUBT", "000660.KS", "0023B0.KS", "SMCI", "MSTR", "COIN", "ARM", "CVNA", "UPST", "AFRM", "SOUN", "HOOD", "RIVN", "PLUG", "ENPH", "ZM", "PTON", "MRNA"]
LEV = {"SOXL": 3, "GDXU": 3, "NAIL": 3, "UYG": 2, "DUSL": 3, "FNGU": 3, "BULZ": 3}
STARTS = {"QUBT": "2018-03-01"}
H = (3, 5, 7, 10, 20)   # 7일은 2026-11-12 화면 표시(3·5·7일)용으로 추가 — 유효 판정 기준(10일·20일 −15%)은 사전 등록 그대로
SPLIT = "2023-01-01"
CODES = list(pf.PR_GROUPS)


def fwd(c):
    n = len(c); out = {k: np.full(n, np.nan) for k in H}; mae = np.full(n, np.nan)
    for k in H:
        out[k][:n - k] = c[k:] / c[:n - k] - 1
    for t in range(n - 20):
        mae[t] = c[t + 1:t + 21].min() / c[t] - 1
    return out, mae


def stat(rows, mask):
    r = {k: v[mask] for k, v in rows.items()}
    d = {"n": int(mask.sum()), "dates": int(len(set(r["date"])))}
    for k in H:
        x = r[f"f{k}"]; x = x[np.isfinite(x)]
        up, dn = int((x > 0.01).sum()), int((x < -0.01).sum())
        d[f"dn{k}"] = round(dn / (up + dn) * 100, 1) if up + dn else None
        d[f"avg{k}"] = round(float(x.mean()) * 100, 2) if len(x) else None
    m = r["mae"]; m = m[np.isfinite(m)]
    d["big"] = round(float((m <= -0.15).mean()) * 100, 1) if len(m) else None
    return d


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--emit", default=""); a = ap.parse_args()
    W = bb.wl_names(); wl = set(W)
    uni = list(W) + [t for t in EXTRA if t not in wl]
    rows = {k: [] for k in ["tk", "date", "wl", "lev", "mae"] + [f"f{k}" for k in H] + CODES}
    series = {}
    for t in uni:
        df = tr.fetch(t)
        if df is None or len(df) < (60 if t in EXTRA else 200):
            print(f"  · {t} 데이터 부족({0 if df is None else len(df)}) — 제외"); continue
        if t in STARTS: df = df[df.index >= STARTS[t]]
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        dates = [str(d.date()) for d in df.index]
        fl = pf.peak_reader_flags(o, h, l, c, v, lev=LEV.get(t, 1), ticker=t)
        f, mae = fwd(c)
        series[t] = (dates, o, h, l, c, fl)
        idx = np.nonzero(fl["RUN"])[0]
        for i in idx:
            rows["tk"].append(t); rows["date"].append(dates[i]); rows["wl"].append(t in wl); rows["lev"].append(t in LEV); rows["mae"].append(mae[i])
            for k in H: rows[f"f{k}"].append(f[k][i])
            for cd in CODES: rows[cd].append(bool(fl[cd][i]))
    R = {k: np.array(v) for k, v in rows.items()}
    N = len(R["date"])
    print(f"종목 {len(series)} · 급등 국면(RUN) 날 {N:,} (관심종목 {int(R['wl'].sum()):,}) · 탐색 <{SPLIT} / 보류 ≥{SPLIT}")
    disc = R["date"] < SPLIT; hold = ~disc
    res = {}
    for scope, sm in (("all", np.ones(N, bool)), ("wl", R["wl"])):
        base_d, base_h = stat(R, sm & disc), stat(R, sm & hold)
        res[scope] = {"base": {"disc": base_d, "hold": base_h, "all": stat(R, sm)}, "codes": {}}
        print(f"\n■ {'전체(관심+추가)' if scope == 'all' else '관심종목만'} — 대조(RUN 모든 날) 보류 n{base_h['n']} 10일 하락 {base_h['dn10']}% · 큰하락 {base_h['big']}% | 탐색 n{base_d['n']} {base_d['dn10']}% · {base_d['big']}%")
        print(f"  {'조건':<12}{'묶음':<5}| 보류: 날 n  3일  5일 10일 20일 하락% · 10일평균 · 큰하락 | 탐색: 날 10일 큰하락 | 판정")
        for cd in CODES:
            m = sm & R[cd]
            sd, sh = stat(R, m & disc), stat(R, m & hold)
            ok = (sh["dn10"] is not None and base_h["dn10"] is not None and sh["dn10"] >= base_h["dn10"] + 5 and sh["big"] is not None and sh["big"] >= base_h["big"] + 5
                  and sh["dates"] >= 50 and sd["dn10"] is not None and sd["dn10"] >= base_d["dn10"] and sd["big"] is not None and sd["big"] >= base_d["big"])
            res[scope]["codes"][cd] = {"disc": sd, "hold": sh, "all": stat(R, m), "valid": bool(ok)}
            g = lambda x, k: "—" if x.get(k) is None else f"{x[k]:.0f}"
            print(f"  {cd:<12}{pf.PR_GROUPS[cd]:<5}| {sh['dates']:>5} {g(sh,'dn3'):>4} {g(sh,'dn5'):>4} {g(sh,'dn10'):>4} {g(sh,'dn20'):>4} · {sh['avg10'] if sh['avg10'] is not None else '—':>6} · {g(sh,'big'):>3} | {sd['dates']:>5} {g(sd,'dn10'):>4} {g(sd,'big'):>4} | {'✅ 유효' if ok else '참고'}")
    # 레버리지 따로(참고)
    lm = R["lev"]
    if lm.any():
        b = stat(R, lm); print(f"\n  레버리지 RUN 날 n{b['n']} 10일 하락 {b['dn10']}% 큰하락 {b['big']}% — 조건별: " + " · ".join(f"{cd} {stat(R, lm & R[cd])['dn10']}%({stat(R, lm & R[cd])['n']})" for cd in CODES if (lm & R[cd]).sum() >= 10))
    valid = [cd for cd in CODES if res["all"]["codes"][cd]["valid"]]
    print(f"\n유효 조건(전체 기준): {', '.join(valid) if valid else '없음'}")

    # ── 사례 단위: 국소 고점 → 붕괴 / 지속 ──
    peaks = []
    for t, (dates, o, h, l, c, fl) in series.items():
        n = len(c); lo120 = pd.Series(c).rolling(120, min_periods=120).min().to_numpy(); last = -99
        for P in range(140, n - 60):
            if P - last < 20: continue
            if h[P] < h[P - 20:P + 21].max() or not (np.isfinite(lo120[P]) and c[P] >= lo120[P] * 1.5): continue
            mn = c[P + 1:P + 61].min(); hi_after = h[P + 1:P + 61].max()
            kind = "bust" if mn <= c[P] * 0.65 else ("cont" if mn >= c[P] * 0.85 and hi_after > h[P] else None)
            if not kind: continue
            last = P
            Dd = next((j for j in range(P + 1, min(n, P + 61)) if c[j] <= c[P] * 0.9), None)
            peaks.append({"tk": t, "P": P, "kind": kind, "D": Dd, "dd": float(mn / c[P] - 1), "date": dates[P], "wl": t in wl})
    def caught(pk, codes):
        dates, o, h, l, c, fl = series[pk["tk"]]; P = pk["P"]
        end = min(P + 10, (pk["D"] - 1) if pk["D"] else P + 10)
        hit = [j for j in range(max(0, P - 10), end + 1) if any(fl[cd][j] for cd in codes)]
        return hit[0] if hit else None
    sets = {cd: [cd] for cd in CODES}
    for gname in ("과열", "약화", "캔들", "거래량", "이탈"):
        sets["묶음:" + gname] = [cd for cd in CODES if pf.PR_GROUPS[cd] == gname]
    sets["유효 조건 전부"] = valid
    sets["현행 1~3단계"] = ["BB_WICK", "ESTAR", "STAGE3"]
    nb = sum(p["kind"] == "bust" for p in peaks); nc = len(peaks) - nb
    print(f"\n■ 사례 단위 — 붕괴 {nb}건 · 지속 {nc}건 (창 = 고점 −10 ~ 본격 하락 전 / +10)")
    print(f"  {'조건':<16}| 붕괴 포착률 · 리드(중앙, 고점 전 +) · 하락 전 남은 날(중앙) | 지속 오경보율 | 포착/오경보 비")
    case_stats = {}
    for nm, codes in sets.items():
        if not codes: continue
        bw = [(p, caught(p, codes)) for p in peaks if p["kind"] == "bust"]
        cw = [(p, caught(p, codes)) for p in peaks if p["kind"] == "cont"]
        cap = [x for x in bw if x[1] is not None]; fa = [x for x in cw if x[1] is not None]
        lead = [p["P"] - j for p, j in cap]; left = [p["D"] - j for p, j in cap if p["D"]]
        cr, fr = (len(cap) / len(bw) * 100 if bw else None), (len(fa) / len(cw) * 100 if cw else None)
        case_stats[nm] = {"bust": len(bw), "caught": len(cap), "cont": len(cw), "false": len(fa), "lead_med": float(np.median(lead)) if lead else None, "left_med": float(np.median(left)) if left else None}
        print(f"  {nm:<16}| {cr:5.1f}% ({len(cap)}/{len(bw)}) · {np.median(lead) if lead else float('nan'):+.0f}일 · {np.median(left) if left else float('nan'):.0f}일 | {fr:5.1f}% ({len(fa)}/{len(cw)}) | {cr / fr if fr else float('nan'):.2f}")

    # ── 추가 연구: 이격 과열(EXT) 사례 단위 재검증 — docs 사전 등록(2026-11-12) 그대로 ──
    def ext_arr(t, thr):
        dates, o, h, l, c, fl = series[t]
        return np.nan_to_num((c / fl["_aux"]["ma20"] - 1) / max(LEV.get(t, 1), 1), nan=-9) >= thr - 1e-12
    peaksB = []
    for t, (dates, o, h, l, c, fl) in series.items():
        n = len(c); lo120 = pd.Series(c).rolling(120, min_periods=120).min().to_numpy(); last = -99
        for P in range(140, n - 60):
            if P - last < 20: continue
            if h[P] < h[P - 20:P + 21].max() or not (np.isfinite(lo120[P]) and c[P] >= lo120[P] * 1.5): continue
            mn = c[P + 1:P + 61].min()
            kind = "bust" if mn <= c[P] * 0.65 else ("cont" if c[P + 60] >= c[P] and mn >= c[P] * 0.75 else None)
            if not kind: continue
            last = P
            Dd = next((j for j in range(P + 1, min(n, P + 61)) if c[j] <= c[P] * 0.9), None)
            peaksB.append({"tk": t, "P": P, "kind": kind, "D": Dd, "date": dates[P], "wl": t in wl})
    def cap_rate(pk_list, thr, period, wl_only=False):
        sel = [p for p in pk_list if (p["date"] >= SPLIT) == (period == "hold") and (p["wl"] or not wl_only)]
        def hit(p):
            A = ext_arr(p["tk"], thr); P = p["P"]; end = min(P + 10, (p["D"] - 1) if p["D"] else P + 10)
            return any(A[j] for j in range(max(0, P - 10), end + 1))
        bw = [p for p in sel if p["kind"] == "bust"]; cw = [p for p in sel if p["kind"] == "cont"]
        cb, cc = sum(hit(p) for p in bw), sum(hit(p) for p in cw)
        return {"bust": len(bw), "caught": int(cb), "cont": len(cw), "false": int(cc),
                "cap": round(cb / len(bw) * 100, 1) if bw else None, "far": round(cc / len(cw) * 100, 1) if cw else None,
                "tk_bust": len({p["tk"] for p in bw}), "tk_cont": len({p["tk"] for p in cw})}
    ET = {}
    for thr in (0.20, 0.25, 0.30):
        for ctl, pl in (("A", peaks), ("B", peaksB)):
            for per in ("disc", "hold"):
                ET[f"{int(thr*100)}|{ctl}|{per}"] = cap_rate(pl, thr, per)
    ET["25|A|hold|wl"] = cap_rate(peaks, 0.25, "hold", wl_only=True)
    g = lambda k: ET[k]
    d = lambda x: (x["cap"] if x["cap"] is not None else -999) - (x["far"] if x["far"] is not None else 999)
    h25 = g("25|A|hold")
    crit = {
        "1_holdA_diff20_ratio2_n": d(h25) >= 20 and h25["far"] is not None and h25["cap"] is not None and (h25["far"] == 0 or h25["cap"] / h25["far"] >= 2) and h25["bust"] >= 30 and h25["cont"] >= 15,
        "2_holdB_diff10": d(g("25|B|hold")) >= 10,
        "3_discA_same_dir": d(g("25|A|disc")) > 0,
        "4_plateau_20_30": d(g("20|A|hold")) >= 10 and d(g("30|A|hold")) >= 10,
        "5_watchlist_only": d(g("25|A|hold|wl")) > 0,
    }
    ext_pass = all(crit.values())
    print("\n■ 이격 과열(EXT) 사례 단위 재검증 — 사전 등록 기준")
    for k, v in ET.items():
        print(f"  {k:<14} 붕괴 {v['caught']}/{v['bust']} = {v['cap']}% ({v['tk_bust']}종목) · 지속 {v['false']}/{v['cont']} = {v['far']}% ({v['tk_cont']}종목) · 차 {d(v):+.1f}%p")
    for k, v in crit.items(): print(f"  기준 {k}: {'통과' if v else '미통과'}")
    print(f"  → EXT 재검증 {'통과 — 🟡 고점 경계에 사용' if ext_pass else '미통과 — 판정 보류 유지'}")

    # ── 0023B0 소급(사용자 지목) ──
    if "0023B0.KS" in series:
        dates, o, h, l, c, fl = series["0023B0.KS"]
        print("\n■ 0023B0.KS(PLUS 미국양자컴퓨팅TOP10) 2026-02-01~04-30 — 현재 알고리즘 소급(그날까지의 일봉만)")
        ax = fl["_aux"]; first = None
        for i, d in enumerate(dates):
            if not ("2026-02-01" <= d <= "2026-04-30"): continue
            on = [cd for cd in CODES if fl[cd][i]]
            if on and first is None: first = i
            if on or ("2026-02-25" <= d <= "2026-03-10"):
                print(f"  {d} 시{o[i]:.0f} 고{h[i]:.0f} 저{l[i]:.0f} 종{c[i]:.0f} RUN {'예' if fl['RUN'][i] else '-'} RSI {ax['rsi'][i]:.0f} MACD히스토 {ax['macd_hist'][i]:+.1f} 윗꼬리 {ax['upw'][i]*100:.0f}% 고가%B {ax['pb_hi'][i]:.2f} → {', '.join(on) or '-'}")
        inw = [("2026-02-01" <= d <= "2026-04-30") for d in dates]
        print(f"  상장 후 일봉 {len(dates)}개({dates[0]}~) · 120봉 미만 구간은 RUN(급등 국면) 계산 불가")
        pk = int(np.argmax(np.where(inw, h, -1))) if any(inw) else len(dates) - 1
        print(f"  실제 고점 {dates[pk]} 고가 {h[pk]:.0f} 종가 {c[pk]:.0f}")
        if first is not None:
            rr = " · ".join(f"{k}일 {(c[first + k] / c[first] - 1) * 100:+.1f}%" for k in H if first + k < len(c))
            print(f"  최초 경고 {dates[first]} 종가 {c[first]:.0f} · 고점과 {pk - first:+d}거래일(＋면 고점 전) · 이후 {rr} · 켜진 조건 {', '.join(cd for cd in CODES if fl[cd][first])}")
            vf = next((i for i in range(len(dates)) if '2026-02-01' <= dates[i] <= '2026-04-30' and any(fl[cd][i] for cd in valid)), None)
            print(f"  유효 조건만 최초 경고: {dates[vf] + ' 종가 ' + format(c[vf], '.0f') + ' · 고점과 ' + format(pk - vf, '+d') + '거래일' if vf is not None else '없음'}")

    # ── 화면 사례: 최근 붕괴 6 + 최근 지속 3 + 0023B0 — 날짜 기준(성적 기준 선별 아님) ──
    def case(p, tag):
        dates, o, h, l, c, fl = series[p["tk"]]; P = p["P"]; a0, a1 = max(0, P - 40), min(len(c), P + 31)
        rnd = lambda x: float(f"{x:.4g}")
        marks = {dates[j]: [cd for cd in CODES if fl[cd][j]] for j in range(a0, a1) if any(fl[cd][j] for cd in CODES)}
        fv = caught(p, valid) if valid else None; fa = caught(p, CODES)
        return {"ticker": p["tk"], "kind": p["kind"], "tag": tag, "peak": dates[P], "peak_high": rnd(h[P]), "dd60": round(p["dd"] * 100, 1),
                "drop_day": dates[p["D"]] if p["D"] else None, "first_valid": dates[fv] if fv is not None else None, "first_any": dates[fa] if fa is not None else None,
                "bars": [[dates[j], rnd(o[j]), rnd(h[j]), rnd(l[j]), rnd(c[j])] for j in range(a0, a1)], "marks": marks}
    by_date = sorted(peaks, key=lambda p: p["date"], reverse=True)
    cases = [case(p, "최근 붕괴") for p in [p for p in by_date if p["kind"] == "bust"][:6]] + [case(p, "최근 지속(대조군)") for p in [p for p in by_date if p["kind"] == "cont"][:3]]
    if "0023B0.KS" in series:
        z = [p for p in peaks if p["tk"] == "0023B0.KS" and "2026-02-15" <= p["date"] <= "2026-03-20"]
        if z: cases.append(case(z[0], "사용자 지목"))
    print(f"\n화면 사례 {len(cases)}건: " + " · ".join(f"{x['ticker']} {x['peak']} {x['kind']} 유효경고 {x['first_valid'] or '없음'}" for x in cases))
    if a.emit:
        out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "kind": "research", "doc": "docs/2026-11-12-peak-reader.md",
               "period": [min(R["date"]), max(R["date"])], "split": SPLIT, "universe": {"watchlist": len(wl & set(series)), "extra": [t for t in EXTRA if t in series]},
               "rule": "보류 기간 10일 하락 비율·큰 하락(20일 안 −15%) 비율 모두 대조+5%p ∧ 서로 다른 날 50+ ∧ 탐색 기간 같은 방향",
               "names": pf.PR_NAMES, "groups": pf.PR_GROUPS, "valid": valid, "stats": res, "cases_stats": case_stats, "cases": cases,
               "ext_test": {"pass": bool(ext_pass), "criteria": crit, "table": ET, "doc": "docs/2026-11-12-peak-reader.md#추가-연구"},
               "valid_case": ["EXT"] if ext_pass else []}
        json.dump(out, open(a.emit, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"→ {a.emit} 저장")


if __name__ == "__main__":
    main()
