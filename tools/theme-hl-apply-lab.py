#!/usr/bin/env python3
"""앞설 테마: 순신고가 강도·신저가 조합 vs 현행 V0 (사전 등록 docs/2026-11-19-theme-hl-apply.md · 읽기 전용)
자료·지표·정답 함수는 tools/theme-redesign-lab.py 준비 부분을 그대로 쓴다(재구현 없음).
사용: python tools/theme-hl-apply-lab.py /tmp/theme.json
"""
import numpy as np

SRC = open("tools/theme-redesign-lab.py", encoding="utf-8").read()
CUT = SRC.index('CAND = [("V0 현행", "V0", None)]')
NS = {"__name__": "theme_lib", "__file__": "tools/theme-redesign-lab.py"}
exec(compile(SRC[:CUT], "tools/theme-redesign-lab.py", "exec"), NS)
DATES, SPLIT, RIX, P0, val, judge, FULL0 = NS["DATES"], NS["SPLIT"], NS["RIX"], NS["P0"], NS["val"], NS["judge"], NS["FULL0"]
PER = {"train": "학습 2017~21", "val": "검증 2022~23", "test": "재확인 2024~26(참고)"}
RNG = np.random.default_rng(11)
DAY = {}
fin = lambda x: x is not None and np.isfinite(x)

def day(d):
    if d in DAY: return DAY[d]
    names = list(RIX[d].keys()); F0 = FULL0[d]; fill = F0 + [n for n in names if n not in F0]; pos = {t: i for i, t in enumerate(fill)}
    g = lambda f: {th: val(P0, f, d, th) for th in names}
    X = {f: g(f) for f in ("net5", "d5", "lrd5", "lowstop", "ab200")}
    by = lambda f: sorted([t for t in names if fin(X[f][t])], key=lambda t: (-X[f][t], pos[t]))
    DAY[d] = dict(names=names, fill=fill, X=X, on5=by("net5"), oab=by("ab200")); return DAY[d]

def rec(d, kind, p):
    if len(RIX[d]) < 5: return None
    D = day(d); X, fill = D["X"], D["fill"]
    if kind == "V0": return fill[:3]
    if kind == "K1": return D["on5"][:3] if len(D["on5"]) >= 5 else None
    if kind == "K2":
        if p == "c": S = [t for t in fill if fin(X["d5"][t]) and fin(X["lrd5"][t]) and X["d5"][t] >= 0 and X["lrd5"][t] <= 0]
        else: S = [t for t in fill if fin(X["d5"][t]) and fin(X["lrd5"][t]) and X["d5"][t] > 0 and X["lrd5"][t] < 0]
        if p == "a": S = sorted(S, key=lambda t: (-X["net5"][t] if fin(X["net5"][t]) else 9, fill.index(t)))
        return (S + [t for t in fill if t not in S])[:3]
    if kind == "K3":
        oa = D["oab"]
        if len(oa) < 5: return None
        S = [t for t in oa[:p] if fin(X["d5"][t]) and X["d5"][t] > 0]; return (S + [t for t in oa if t not in S])[:3]
    if kind == "K4":
        if p == "a": return [t for t in fill if not (fin(X["lrd5"][t]) and X["lrd5"][t] > 0)][:3]
        if p == "b": return [t for t in fill[:3] if fin(X["lrd5"][t]) and X["lrd5"][t] < 0]
        if p == "c": return [t for t in fill[:3] if X["lowstop"][t] == 1]
    raise ValueError(kind)

CAND = [("V0 현행", "V0", None, "-"), ("K1 순신고가 강도 단독(net5 순)", "K1", None, "K1"),
        ("K2 (Δ5>0 ∧ 신저가 감소) net5 순 → V0 채움", "K2", "a", "K2"), ("K2b 같은 집합 V0 순 → V0 채움", "K2", "b", "K2"),
        ("K2c (Δ5≥0 ∧ 신저가 안 늘어남) V0 순 → V0 채움", "K2", "c", "K2")]
for n in (4, 5, 6): CAND.append((f"K3 ab200 상위{n} ∩ Δ5>0 → ab200 채움", "K3", n, "K3"))
CAND += [("K4 V0 순서에서 신저가 늘어나는 테마 건너뜀", "K4", "a", "K4"), ("K4b V0 TOP3 ∩ 신저가 감소만(0~3개)", "K4", "b", "K4"),
         ("K4c V0 TOP3 ∩ 신저가 둔화만(0~3개)", "K4", "c", "K4")]

def ev(kind, p, split, step=1):
    rows = []
    for d in [x for x in DATES if SPLIT[x] == split][::step]:
        S = rec(d, kind, p)
        if S is None: continue
        s = len(S); base = day(d)["fill"][:max(s, 1)]; r = {"d": d, "s": s, "S": S}
        for h in (5, 10):
            j = judge(d, S, h) if s else None; z0 = judge(d, base, h)
            if z0 is None: r = None; break
            r[h] = (j, z0)
        if r: rows.append(r)
    return rows
def summ(rows, h):
    L = [r for r in rows if r["s"] > 0 and r[h][0]]
    if not L: return dict(n=0, days=len(rows), zero=1.0, hit=np.nan, hit0=np.nan, d=np.nan, ret=np.nan, ret0=np.nan, pos=np.nan, pos0=np.nan, diff=None, dates=[], top=("—", 0))
    a = np.array([r[h][0][0] for r in L]); b = np.array([r[h][1][0] for r in L]); cnt = {}
    for r in L:
        for t in r["S"]: cnt[t] = cnt.get(t, 0) + 1
    tt = max(cnt, key=cnt.get)
    return dict(n=len(L), days=len(rows), zero=np.mean([r["s"] == 0 for r in rows]), hit=a.mean(), hit0=b.mean(), d=a.mean() - b.mean(),
                ret=np.mean([r[h][0][2] for r in L]), ret0=np.mean([r[h][1][2] for r in L]), pos=np.mean([r[h][0][2] > 0 for r in L]),
                pos0=np.mean([r[h][1][2] > 0 for r in L]), diff=a - b, dates=[r["d"] for r in L], top=(tt, cnt[tt] / sum(cnt.values())))
def boot(diff, B=10):
    if diff is None or len(diff) < 40: return (np.nan, np.nan)
    nb = len(diff) // B; out = []
    for _ in range(2000):
        idx = np.concatenate([np.arange(s, s + B) for s in RNG.integers(0, len(diff) - B, nb)]); out.append(diff[idx].mean())
    return (float(np.percentile(out, 5)), float(np.percentile(out, 95)))
pc = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:.0f}%"; pp = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:+.1f}"
sg = lambda x: "—" if x is None or not np.isfinite(x) else f"{x:+.2f}%"

RES = []
for nm, kind, p, fam in CAND:
    rows = {sp: ev(kind, p, sp) for sp in ("train", "val", "test")}
    o = {sp: {h: summ(rows[sp], h) for h in (5, 10)} for sp in rows}
    o["sp5"] = {sp: summ(ev(kind, p, sp, 5), 5) for sp in ("train", "val", "test")}
    RES.append((nm, kind, p, fam, o))

def pooled(o, h, k):
    n1, n2 = o["train"][h]["n"], o["val"][h]["n"]
    return (o["train"][h][k] * n1 + o["val"][h][k] * n2) / max(1, n1 + n2) if n1 and n2 else np.nan
def gate(o, fam):
    tr, va, te = o["train"], o["val"], o["test"]
    if not (tr[5]["n"] and va[5]["n"]): return False, "자료 없음"
    lo, _ = boot(va[5]["diff"]); why = []
    if not (tr[5]["d"] >= 0.02 and va[5]["d"] >= 0.02): why.append("5일 +2%p 미달")
    if not (np.isfinite(lo) and lo > 0): why.append("검증 구간 하한 ≤ 0")
    if not (tr[10]["d"] >= 0 and va[10]["d"] >= 0): why.append("10일 V0 미만")
    if not (pooled(o, 5, "ret") >= pooled(o, 5, "ret0") and pooled(o, 10, "ret") >= pooled(o, 10, "ret0")): why.append("평균 수익 V0 미만")
    if not (np.isfinite(te[5]["d"]) and te[5]["d"] >= 0): why.append("재확인 뒤집힘")
    if not any(f2 == fam and o2 is not o and o2["train"][5]["n"] and o2["train"][5]["d"] > 0 and o2["val"][5]["d"] > 0 for _, _, _, f2, o2 in RES): why.append("이웃 고원 없음")
    if va[5]["zero"] > 0.20: why.append("추천 없는 날 20%↑")
    return (not why), " · ".join(why) or "통과"

V = RES[0][4]
print("\n■ 기준선 V0(현행 화면 앞설 테마) — " + " · ".join(f"{PER[sp]} 5일 {pc(V[sp][5]['hit'])} 10일 {pc(V[sp][10]['hit'])} 평균 {sg(V[sp][5]['ret'])}/{sg(V[sp][10]['ret'])} 플러스 {pc(V[sp][5]['pos'])}/{pc(V[sp][10]['pos'])} ({V[sp][5]['n']}일)" for sp in ("train", "val", "test")))
print("\n■ 후보 (모든 Δ = 같은 날 · 같은 추천 개수의 V0 상위와 짝 비교 · %p)")
OUT = []
for nm, kind, p, fam, o in RES[1:]:
    ok, why = gate(o, fam); lo, hi = boot(o["val"][5]["diff"]); lo2, hi2 = boot(o["test"][5]["diff"]); OUT.append((ok, o["val"][5]["d"], nm, kind, p))
    yr = {}
    for sp in ("train", "val", "test"):
        for dd, df in zip(o[sp][5]["dates"], o[sp][5]["diff"] if o[sp][5]["diff"] is not None else []): yr.setdefault(dd[:4], []).append(df)
    print(f"  ▶ {nm} — {'적용 가능' if ok else '미달: ' + why}")
    for sp in ("train", "val", "test"):
        a, b = o[sp][5], o[sp][10]
        print(f"     {PER[sp]}: 5일 {pc(a['hit'])}(V0 {pc(a['hit0'])} · {pp(a['d'])}) 10일 {pc(b['hit'])}(V0 {pc(b['hit0'])} · {pp(b['d'])}) · 평균 {sg(a['ret'])}/{sg(b['ret'])} (V0 {sg(a['ret0'])}/{sg(b['ret0'])})"
              f" · 플러스 {pc(a['pos'])}/{pc(b['pos'])} (V0 {pc(a['pos0'])}/{pc(b['pos0'])}) · 추천일 {a['n']}/{a['days']} · 0개 {pc(a['zero'])} · 최다 {a['top'][0]} {pc(a['top'][1])}"
              f" · 5일 간격 {pc(o['sp5'][sp]['hit'])}(V0 {pc(o['sp5'][sp]['hit0'])})")
    print(f"     90% 구간(5일 Δ) 검증 [{pp(lo)}~{pp(hi)}] · 재확인 [{pp(lo2)}~{pp(hi2)}] · 연도별 " + " ".join(f"{y}{pp(np.mean(v_))}" for y, v_ in sorted(yr.items())))
win = sorted([x for x in OUT if x[0]], key=lambda x: -x[1])
print("\n■ 판정: " + (f"적용 = {win[0][2]}" if win else "적용 가능 후보 없음 → 현행 유지"))
for ok, dv, nm, kind, p in win[:2]:
    print(f"\n■ 사례 — {nm}: 최근 12거래일")
    for d in DATES[-12:]:
        S = rec(d, kind, p); D = day(d)
        print(f"  {d} 추천 {', '.join(S) if S else '없음'} · V0 {', '.join(D['fill'][:3])} · net5 " + ", ".join(f"{t} {D['X']['net5'][t]:+.2f}" for t in (S or []) if fin(D['X']['net5'][t])))
