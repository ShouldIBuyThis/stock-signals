"""시장 폭을 '방향 예측'이 아닌 보조지표로 — 신호 보강·조정 위험·반등 신뢰도·추세 지속·섹터 순환 (읽기 전용 · 산식·화면 변경 없음)

왜 (2026-11-08 사용자: 시장 폭으로 QQQ 방향 예측은 효과 없음 → 시장 건강도·하락 위험·반등 신뢰도·추세 지속·섹터 순환 보조지표로서 유용한지.
    기존 신호 단독 vs 결합 · 동일 국면 평소 대비 · 3년 · 표본·적중률·평균수익·최대 하락폭 · 기간별 재현성 · 최종 채택은 미사용 기간 검증 통과만)

━━ 사전 등록 (결과 보기 전 커밋) ━━
데이터: 관심종목 미국(국장 제외) 야후 수정주가 · QQQ. 기간 = 결과 60일이 확정되는 마지막 날까지 거꾸로 756거래일.
  학습 = 앞 504일, 검증(미사용) = 뒤 252일. 후보 고르기는 학습에서만, 채택 판정은 검증에서만.
시장 폭(그날 t 종가까지): NH% = 252봉 최고가 1% 안 비율 · NL = 252봉 최저가 1% 안 종목 수 · A20% = 20일선 위 비율
폭 개선 후보(이 6개만 본다): A20↑(A20% > 5일 전) · NL↓(NL < 5일 전) · NH↑(NH% > 5일 전) · A20≥50% · A20↑∧NL↓ · A20↑∧NL↓∧NH↑
국면: QQQ 종가가 200일선 위(상승장)/아래(하락장). '평소' = 같은 국면의 모든 종목·날(같은 진입 규칙)을 신호 구성대로 가중.
진입 = 신호 다음 날 시가. 결과 = 10일 뒤 종가 수익 · 10일 최대 하락폭(저가 기준) · 적중 = 10일 수익 > 0.
① 신호 보강: 사이트 신호(강한매수·반등·추세·다중 — 화면 strategyValidation() 그대로, tools/site-signal-export.js)
   단독 vs 폭 개선 겹침 vs 안 겹침. 학습에서 적중률 상승이 가장 큰 후보 1개(겹침 표본 30↑) → 검증에서 판정.
② 조정 위험: QQQ 상승 중(종가 > 50일선 ∧ 52주 고가 3% 안) + 폭 악화(NH% ∧ A20% 둘 다 W일 전보다 낮음, W ∈ {5,10,20})
   결과 = QQQ 20·40일 안 최대 하락 −5%↓·−10%↓ 확률 · 비교 = 상승 중 + 폭 악화 아님. 악화가 연달아 뜨면 첫날만(10일 중복 제거).
③ 반등 신뢰도·추세 지속: 반등 신호 성공(10일 수익>0 ∧ 10일 최대 하락 > −8%) · 추세 신호 유지 기간(진입 뒤 처음 20일선 아래 마감까지, 최대 40일)
   폭 개선 겹침 vs 아님(후보는 ①과 같은 6개, 학습에서 고름).
④ 섹터 순환: 관심종목 카테고리(미국 3종목↑) 참여율 = 20일선 위 비율. 개선 = 5일 전보다 +20%p↑.
   결과 = 섹터 동일가중 10·20일 수익 − 관심종목 전체 동일가중(상대수익) · 5일 간격 표본.
판정(미리 고정): ✅ 유용 = 학습에서 +3%p↑ ∧ 검증에서 결합이 단독(또는 비교군)보다 적중/확률 +5%p↑ ∧ 평균수익(또는 최대하락) 같은 방향 ∧ 검증 결합 표본 30↑
                 (합성 무작위 데이터로 시험했을 때 '표본 15↑' 기준은 우연으로도 통과해 결과 보기 전에 조였다)
                △ 참고 = 학습·검증 같은 방향이지만 문턱 미달 또는 표본 부족 · ❌ 효과 미확인 = 검증에서 반대 방향이거나 차이 없음
"""
import importlib.util, json, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py"); ss = _load("ss", "signal-stats.py")
CANDS = ["A20↑", "NL↓", "NH↑", "A20≥50%", "A20↑∧NL↓", "A20↑∧NL↓∧NH↑"]
KN = {"strongBuy": "강한매수", "rev": "반등 강한매수", "pull": "추세 강한매수", "multi": "다중"}

def main():
    ev = json.load(open(sys.argv[1], encoding="utf-8")) if len(sys.argv) > 1 else {}
    wl = {t: c for t, c in ss.watchlist().items() if not t.endswith((".KS", ".KQ"))}
    P = {}
    for t in wl:
        df = tr.fetch(t)
        if df is not None and len(df) > 300: P[t] = df
    q = tr.fetch("QQQ"); idx = q.index
    O = pd.DataFrame({t: d["Open"] for t, d in P.items()}).reindex(idx); Hh = pd.DataFrame({t: d["High"] for t, d in P.items()}).reindex(idx)
    L = pd.DataFrame({t: d["Low"] for t, d in P.items()}).reindex(idx); C = pd.DataFrame({t: d["Close"] for t, d in P.items()}).reindex(idx)
    hi, lo, ma20 = C.rolling(252, min_periods=252).max(), C.rolling(252, min_periods=252).min(), C.rolling(20).mean()
    valid = hi.notna() & C.notna(); n = valid.sum(axis=1).replace(0, np.nan)
    NH = (((C >= hi * 0.99) & valid).sum(axis=1) / n).to_numpy(); NL = ((C <= lo * 1.01) & valid).sum(axis=1).to_numpy()
    A20 = (((C > ma20) & valid).sum(axis=1) / n).to_numpy()
    qc, qo, ql = q["Close"].to_numpy(), q["Open"].to_numpy(), q["Low"].to_numpy()
    q200, q50 = q["Close"].rolling(200).mean().to_numpy(), q["Close"].rolling(50).mean().to_numpy(); qhi = q["High"].rolling(252).max().to_numpy()
    dates = [str(d.date()) for d in idx]; D = {d: i for i, d in enumerate(dates)}; N = len(dates)
    end = N - 62; start = end - 756 + 1; cut = end - 252 + 1
    period = range(start, end + 1)
    def feat(i, name, W=5):
        if i - W < 0: return False
        a, nl, nh = A20[i] > A20[i - W], NL[i] < NL[i - W], NH[i] > NH[i - W]
        return {"A20↑": a, "NL↓": nl, "NH↑": nh, "A20≥50%": A20[i] >= 0.5, "A20↑∧NL↓": a and nl, "A20↑∧NL↓∧NH↑": a and nl and nh}[name]
    reg = lambda i: "up" if qc[i] >= q200[i] else "down"
    Oa, La, Ca, M20 = O.to_numpy(), L.to_numpy(), C.to_numpy(), ma20.to_numpy(); col = {t: j for j, t in enumerate(C.columns)}
    def outcome(t, i):
        j = col[t]; e = Oa[i + 1, j]
        if not (e > 0): return None
        r10 = Ca[i + 10, j] / e - 1; mdd = np.nanmin(La[i + 1:i + 11, j]) / e - 1
        hold = 40
        for k in range(1, 41):
            if Ca[i + k, j] < M20[i + k, j]: hold = k; break
        return r10 * 100, mdd * 100, hold
    # 같은 국면 평소(종목·날 전부, 5일 간격)
    base = {"up": [], "down": []}
    for i in range(start, end + 1, 5):
        for t in col:
            o = outcome(t, i)
            if o: base[reg(i)].append(o)
    bstat = {g: (np.mean([x[0] > 0 for x in v]) * 100, np.mean([x[0] for x in v])) for g, v in base.items() if v}
    def S(rows):            # rows = [(i, (r10, mdd, hold))]
        if not rows: return None
        r = [x[1] for x in rows]; return dict(n=len(r), hit=np.mean([x[0] > 0 for x in r]) * 100, avg=np.mean([x[0] for x in r]),
                                             mdd=np.median([x[1] for x in r]), succ=np.mean([x[0] > 0 and x[1] > -8 for x in r]) * 100,
                                             hold=np.median([x[2] for x in r]), bhit=np.mean([bstat[reg(i)][0] for i, _ in rows]))
    fmt = lambda s: "표본 0" if not s else f"n={s['n']:<4} 적중 {s['hit']:3.0f}% 평균 {s['avg']:+.1f}% 최대하락 중간 {s['mdd']:+.1f}% (평소 {s['bhit']:.0f}%)"
    verdicts = {}
    print(f"■ 시장 폭 보조지표 · {dates[start]}~{dates[end]} · 학습 ~{dates[cut-1]} · 검증 {dates[cut]}~ · 관심종목 미국 {len(P)}개 · 다음 날 시가 진입 · 10일")
    print(f"  평소(같은 국면, 종목·날): 상승장 적중 {bstat['up'][0]:.0f}% 평균 {bstat['up'][1]:+.1f}% · 하락장 {bstat.get('down',(np.nan,np.nan))[0]:.0f}% {bstat.get('down',(np.nan,np.nan))[1]:+.1f}%")
    # ① 신호 보강 / ③ 반등·추세
    rows_by = {}
    for k, lst in ev.items():
        rr = []
        for t, d in lst:
            if t not in col or d not in D: continue
            i = D[d]
            if not (start <= i <= end): continue
            o = outcome(t, i)
            if o: rr.append((i, o))
        rows_by[k] = rr
    print("\n① 기존 신호 + 시장 폭 개선 — 학습에서 후보 고르기(겹침 30건↑, 적중률 상승 최대) → 검증 판정")
    for k, rr in rows_by.items():
        trn = [x for x in rr if x[0] < cut]; tst = [x for x in rr if x[0] >= cut]
        best = None
        for c in CANDS:
            w = [x for x in trn if feat(x[0], c)]
            if len(w) < 30 or not trn: continue
            lift = S(w)["hit"] - S(trn)["hit"]
            if best is None or lift > best[1]: best = (c, lift)
        print(f"  [{KN[k]}] 학습 단독 {fmt(S(trn))}")
        if not best: print("    후보 없음(겹침 표본 부족)"); verdicts[f"①{KN[k]}"] = "❌"; continue
        c = best[0]
        print(f"    학습 선택: {c} (적중 {best[1]:+.0f}%p) · 겹침 {fmt(S([x for x in trn if feat(x[0], c)]))}")
        s0, s1, s2 = S(tst), S([x for x in tst if feat(x[0], c)]), S([x for x in tst if not feat(x[0], c)])
        print(f"    검증 단독 {fmt(s0)}\n    검증 겹침 {fmt(s1)}\n    검증 안겹침 {fmt(s2)}")
        if s0 and s1 and best[1] >= 3 and s1["n"] >= 30 and s1["hit"] - s0["hit"] >= 5 and s1["avg"] >= s0["avg"]: v = "✅"
        elif s0 and s1 and s1["hit"] > s0["hit"] and best[1] > 0: v = "△"
        else: v = "❌"
        verdicts[f"①{KN[k]}+{c}"] = v
    print("\n③ 반등 신뢰도(성공 = 10일 수익>0 ∧ 최대하락 > −8%) · 추세 지속(20일선 아래 마감까지 거래일 중간값)")
    for k, key, lab in (("rev", "succ", "반등 성공률"), ("pull", "hold", "추세 유지 기간")):
        rr = rows_by.get(k, []); trn = [x for x in rr if x[0] < cut]; tst = [x for x in rr if x[0] >= cut]
        best = None
        for c in CANDS:
            w = [x for x in trn if feat(x[0], c)]; wo = [x for x in trn if not feat(x[0], c)]
            if len(w) < 20 or len(wo) < 20: continue
            lift = S(w)[key] - S(wo)[key]
            if best is None or lift > best[1]: best = (c, lift)
        if not best: print(f"  [{lab}] 후보 없음"); verdicts[f"③{lab}"] = "❌"; continue
        c = best[0]; unit = "%p" if key == "succ" else "일"
        tw, two = S([x for x in tst if feat(x[0], c)]), S([x for x in tst if not feat(x[0], c)])
        print(f"  [{lab}] 학습 선택 {c}: 겹침−안겹침 {best[1]:+.1f}{unit}")
        print(f"    검증 겹침 n={tw['n'] if tw else 0} {lab} {tw[key] if tw else float('nan'):.1f} · 안겹침 n={two['n'] if two else 0} {two[key] if two else float('nan'):.1f}"
              f" · 평균 {tw['avg'] if tw else float('nan'):+.1f}% vs {two['avg'] if two else float('nan'):+.1f}%")
        d = (tw[key] - two[key]) if tw and two else None
        thr = 5 if key == "succ" else 3
        v = "✅" if d is not None and tw["n"] >= 30 and two["n"] >= 30 and d >= thr and best[1] >= thr / 2 else "△" if d is not None and d > 0 and best[1] > 0 else "❌"
        verdicts[f"③{lab}+{c}"] = v
    # ② 조정 위험
    print("\n② QQQ 상승 중 + 폭 악화 → 이후 큰 조정 위험 (QQQ 다음 날 시가 → 20·40일 안 최대 하락)")
    def qdd(i, k): e = qo[i + 1]; return (np.nanmin(ql[i + 1:i + 1 + k]) / e - 1) * 100
    up = lambda i: qc[i] > q50[i] and qc[i] >= 0.97 * qhi[i]
    res2 = {}
    for W in (5, 10, 20):
        bad = lambda i, W=W: NH[i] < NH[i - W] and A20[i] < A20[i - W]
        for part, rng in (("학습", range(start, cut)), ("검증", range(cut, end + 1))):
            dv, nd = [], []; last = -99
            for i in rng:
                if not up(i): continue
                if bad(i):
                    if not bad(i - 1) and i - last >= 10: dv.append(i); last = i
                else: nd.append(i)
            P5 = lambda a, k, th: np.mean([qdd(i, k) <= th for i in a]) * 100 if a else np.nan
            res2[(W, part)] = (len(dv), P5(dv, 20, -5), P5(nd, 20, -5), P5(dv, 40, -10), P5(nd, 40, -10), len(nd))
    bestW = max((5, 10, 20), key=lambda W: (res2[(W, "학습")][1] - res2[(W, "학습")][2]) if res2[(W, "학습")][0] >= 10 else -99)
    for W in (5, 10, 20):
        for part in ("학습", "검증"):
            a = res2[(W, part)]
            print(f"  W={W:<2} {part} 악화 첫날 n={a[0]:<3} 20일 −5%↓ {a[1]:3.0f}% vs 악화 아님 {a[2]:3.0f}%(n={a[5]}) · 40일 −10%↓ {a[3]:3.0f}% vs {a[4]:3.0f}%")
    a = res2[(bestW, "검증")]; d = a[1] - a[2]
    ta = res2[(bestW, "학습")]
    verdicts[f"②조정 위험(W={bestW}, 학습 선택)"] = "✅" if a[0] >= 30 and d >= 5 and ta[1] - ta[2] >= 3 else "△" if d > 0 and ta[1] - ta[2] > 0 else "❌"
    # ④ 섹터 순환
    print("\n④ 섹터 참여율(20일선 위 비율) 5일 새 +20%p↑ → 섹터 상대수익(동일가중, 관심종목 전체 대비)")
    cats = {}
    for t, c in wl.items():
        if t in col: cats.setdefault(c, []).append(t)
    cats = {c: ts for c, ts in cats.items() if len(ts) >= 3}
    above = (C > ma20)
    allret = lambda i, k: np.nanmean(Ca[i + k, :] / Oa[i + 1, :] - 1) * 100
    out4 = {}
    for part, rng in (("학습", range(start, cut, 5)), ("검증", range(cut, end + 1, 5))):
        imp, no = {10: [], 20: []}, {10: [], 20: []}
        for i in rng:
            for c, ts in cats.items():
                js = [col[t] for t in ts]
                pr = np.nanmean(above.to_numpy()[i, js]); pr0 = np.nanmean(above.to_numpy()[i - 5, js])
                for k in (10, 20):
                    rel = np.nanmean(Ca[i + k, js] / Oa[i + 1, js] - 1) * 100 - allret(i, k)
                    (imp if pr - pr0 >= 0.2 else no)[k].append(rel)
        out4[part] = (imp, no)
        print(f"  {part} 개선 n={len(imp[10]):<4} 10일 상대 {np.mean(imp[10]):+.2f}% (앞섬 {np.mean(np.array(imp[10]) > 0)*100:.0f}%) · 20일 {np.mean(imp[20]):+.2f}%"
              f"  | 개선 아님 n={len(no[10])} 10일 {np.mean(no[10]):+.2f}% ({np.mean(np.array(no[10]) > 0)*100:.0f}%) · 20일 {np.mean(no[20]):+.2f}%")
    im, no = out4["검증"]; d = np.mean(np.array(im[10]) > 0) * 100 - np.mean(np.array(no[10]) > 0) * 100
    ti, tn = out4["학습"]; dt_ = np.mean(np.array(ti[10]) > 0) * 100 - np.mean(np.array(tn[10]) > 0) * 100
    verdicts["④섹터 순환(참여율 +20%p)"] = "✅" if len(im[10]) >= 30 and d >= 5 and dt_ >= 3 and np.mean(im[10]) > np.mean(no[10]) else "△" if d > 0 and dt_ > 0 else "❌"
    print("\n■ 판정(사전 기준 · 검증 구간)")
    for k, v in verdicts.items(): print(f"  {v} {k}")

if __name__ == "__main__":
    main()
