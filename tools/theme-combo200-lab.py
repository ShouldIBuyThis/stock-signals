#!/usr/bin/env python3
"""앞설 테마: 200일선 위 비율(A) × 복합지표(B) 결합 (사전 등록 docs/2026-11-19-theme-200-combo.md · 읽기 전용 · 산식 불변)
자료·지표·정답 함수는 tools/theme-redesign-lab.py의 준비 부분을 그대로 불러 쓴다(같은 정의 · 재구현 없음).
사용: python tools/theme-combo200-lab.py /tmp/theme.json
"""
import sys, re
import numpy as np, pandas as pd

SRC = open("tools/theme-redesign-lab.py", encoding="utf-8").read()
CUT = SRC.index('CAND = [("V0 현행", "V0", None)]')
NS = {"__name__": "theme_lib", "__file__": "tools/theme-redesign-lab.py"}
exec(compile(SRC[:CUT], "tools/theme-redesign-lab.py", "exec"), NS)   # 자료 받기 · 지표 패널 · 정합성 출력까지
DATES, SPLIT, RIX, P0, val, judge = NS["DATES"], NS["SPLIT"], NS["RIX"], NS["P0"], NS["val"], NS["judge"]
PER = {"train": "학습 2017~21(탐색)", "val": "검증 2022~23(탐색)", "test": "재확인 2024~26(참고 · 이미 본 기간)"}

def z(vals):
    a = np.array([v for v in vals.values() if np.isfinite(v)]);
    if len(a) < 2: return {k: np.nan for k in vals}
    mu, sd = a.mean(), a.std() or 1.0
    return {k: (v - mu) / sd if np.isfinite(v) else np.nan for k, v in vals.items()}
DAY = {}
def day(d):
    if d in DAY: return DAY[d]
    names = list(RIX[d].keys()); g = lambda f: {th: val(P0, f, d, th) for th in names}
    A = g("ab200"); zs = [z(g("net5")), z({k: -v for k, v in g("lrd5").items()}), z(g("w_trend")), z(g("w_vspk"))]
    B = {th: (sum(x[th] for x in zs) if all(np.isfinite(x[th]) for x in zs) else np.nan) for th in names}
    net5, lrd5, hrd5, wt, wv = g("net5"), g("lrd5"), g("hrd5"), g("w_trend"), g("w_vspk")
    med = np.nanmedian([v for v in net5.values()]) if any(np.isfinite(v) for v in net5.values()) else np.nan
    C = {th: dict(C1=np.isfinite(net5[th]) and np.isfinite(med) and net5[th] >= med, C2=np.isfinite(lrd5[th]) and lrd5[th] < 0,
                  C3=np.isfinite(wt[th]) and wt[th] >= 0.5, C4=np.isfinite(wv[th]) and wv[th] > 0, HUP=np.isfinite(hrd5[th]) and hrd5[th] > 0) for th in names}
    oa = [th for th in sorted(names, key=lambda t: -A[t]) if np.isfinite(A[th])]; ob = [th for th in sorted(names, key=lambda t: -B[t]) if np.isfinite(B[th])]
    DAY[d] = dict(names=names, A=A, B=B, C=C, oa=oa, ob=ob, zA=z(A), zB=z(B)); return DAY[d]

def rec(d, kind, p):
    D = day(d); oa, ob = D["oa"], D["ob"]
    if len(oa) < 5: return None
    if kind == "A": return oa[:3]
    if kind == "inter": k, m = p; s = set(ob[:m]); return [t for t in oa[:k] if t in s][:3]
    if kind == "AthenB": return [t for t in ob if t in oa[:p]][:3]
    if kind == "BthenA": return [t for t in oa if t in ob[:p]][:3]
    if kind == "wsum":
        sc = {t: p * D["zA"][t] + (1 - p) * D["zB"][t] for t in oa if np.isfinite(D["zB"].get(t, np.nan))}
        return sorted(sc, key=lambda t: -sc[t])[:3]
    if kind == "thrB": th, by = p; ok = [t for t in oa if D["A"][t] >= th]; return ([t for t in ob if t in ok] if by == "B" else ok)[:3]
    if kind == "topcond":
        n, need = p; out = []
        for t in oa[:n]:
            c = D["C"][t]; k = sum(c[x] for x in ("C1", "C2", "C3", "C4"))
            if (need == "2+" and k >= 2) or (need == "all" and k == 4) or (need in ("C1", "C2", "C3", "C4") and c[need]): out.append(t)
        return out[:3]
    if kind == "prio": f = [t for t in oa if D["C"][t]["HUP"] and D["C"][t]["C2"]]; return (f + [t for t in oa if t not in f])[:3]
    if kind == "pen":
        if p == "back": f = [t for t in oa if D["C"][t]["C3"]]; return (f + [t for t in oa if t not in f])[:3]
        sc = {t: D["A"][t] - (p if not D["C"][t]["C3"] else 0) for t in oa}; return sorted(sc, key=lambda t: -sc[t])[:3]
    if kind == "agree": s = [t for t in oa[:3] if t in ob[:3]]; return s if p == "only" else (s + [t for t in oa if t not in s])[:3]
    raise ValueError(kind)

CAND = [("A 200일선 위 비율 TOP3(기준선)", "A", None)]
for k, m in ((3, 3), (5, 5), (3, 5), (5, 3)): CAND.append((f"교집합 A TOP{k} ∩ B TOP{m}", "inter", (k, m)))
for n in (4, 5, 6): CAND.append((f"단계 A 상위{n} → B로 재정렬", "AthenB", n)); CAND.append((f"단계 B 상위{n} → A로 재정렬", "BthenA", n))
for w in (0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1): CAND.append((f"점수 {int(w * 100)}:{int(round((1 - w) * 100))} (A:B z가중합)", "wsum", w))
for th in (0.4, 0.5, 0.6, 0.7, 0.8):
    CAND.append((f"임계 A≥{int(th * 100)}% → B 순", "thrB", (th, "B"))); CAND.append((f"임계 A≥{int(th * 100)}% → A 순", "thrB", (th, "A")))
CN = {"C1": "순신고가 강도 상위 절반", "C2": "신저가 감소", "C3": "주봉 상승 추세", "C4": "주봉 거래대금 증가", "2+": "4조건 중 2개↑", "all": "4조건 모두"}
for n in (4, 5, 6):
    for need in ("C1", "C2", "C3", "C4", "2+", "all"): CAND.append((f"A 상위{n} ∩ {CN[need]}", "topcond", (n, need)))
CAND.append(("우선 (신고가 증가 ∧ 신저가 감소) 먼저, A 순 채움", "prio", None))
CAND.append(("감점 주봉 약화 테마 뒤로(A 순)", "pen", "back"))
for pn in (0.1, 0.2, 0.3): CAND.append((f"감점 주봉 약화 −{pn}(A − 감점)", "pen", pn))
CAND.append(("일치형 A TOP3 ∩ B TOP3만", "agree", "only")); CAND.append(("일치형 + 부족분 A 순 보충", "agree", "fill"))

def ev(kind, p, split, rnd=None):
    rows = []
    for d in [x for x in DATES if SPLIT[x] == split]:
        S = rnd(d) if rnd else rec(d, kind, p)
        if S is None: continue
        s = len(S); base = day(d)["oa"][:max(s, 1)]
        r = {"d": d, "s": s}
        for h in (5, 10):
            j = judge(d, S, h) if s else None; z0 = judge(d, base, h)
            if z0 is None: r = None; break
            r[h] = (j, z0)
        if r: rows.append(r)
    return rows
def summ(rows, h):
    L = [r for r in rows if r["s"] > 0 and r[h][0]]; n = len(rows)
    if not L: return dict(n=0, days=n, zero=1.0, one=np.nan, hit=np.nan, hit0=np.nan, d=np.nan, ret=np.nan, ret0=np.nan, pos=np.nan, pos0=np.nan, diff=None, dates=[])
    a = np.array([r[h][0][0] for r in L]); b = np.array([r[h][1][0] for r in L])
    return dict(n=len(L), days=n, zero=np.mean([r["s"] == 0 for r in rows]), one=np.mean([r["s"] == 1 for r in rows]), hit=a.mean(), hit0=b.mean(), d=a.mean() - b.mean(),
                ret=np.mean([r[h][0][2] for r in L]), ret0=np.mean([r[h][1][2] for r in L]), pos=np.mean([r[h][0][2] > 0 for r in L]), pos0=np.mean([r[h][1][2] > 0 for r in L]),
                diff=a - b, dates=[r["d"] for r in L], avgsz=np.mean([r["s"] for r in L]))
RNG = np.random.default_rng(11)
def boot(diff, B=10):
    if diff is None or len(diff) < 40: return (np.nan, np.nan)
    nb = len(diff) // B; out = []
    for _ in range(2000):
        idx = np.concatenate([np.arange(s, s + B) for s in RNG.integers(0, len(diff) - B, nb)]); out.append(diff[idx].mean())
    return (float(np.percentile(out, 5)), float(np.percentile(out, 95)))

pc = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:.0f}%"; pp = lambda x: "—" if x is None or not np.isfinite(x) else f"{x * 100:+.1f}%p"; sg = lambda x: "—" if x is None or not np.isfinite(x) else f"{x:+.2f}%"
# 무작위 기준: 그날 A가 아닌 순서로 같은 개수(3개) 추천 — 검증 기간
rnd = []
for k in range(200):
    rr = np.random.default_rng(1000 + k)
    def R(d, rr=rr):
        D = day(d); return list(rr.permutation(D["oa"]))[:3] if len(D["oa"]) >= 5 else None
    s5 = summ(ev(None, None, "val", R), 5); rnd.append(s5["d"])
R95, RMX = np.nanpercentile(rnd, 95), np.nanmax(rnd)
RES = []
for nm, kind, p in CAND:
    out = {sp: {h: summ(ev(kind, p, sp), h) for h in (5, 10)} for sp in ("train", "val", "test")}
    RES.append((nm, kind, p, out))
A0 = RES[0][3]
print(f"\n■ 기준선 A(200일선 위 비율 TOP3) — " + " · ".join(f"{PER[sp]} 5일 {pc(A0[sp][5]['hit'])} 10일 {pc(A0[sp][10]['hit'])} 평균 {sg(A0[sp][5]['ret'])}/{sg(A0[sp][10]['ret'])} 플러스 {pc(A0[sp][5]['pos'])}/{pc(A0[sp][10]['pos'])}" for sp in ("train", "val", "test")))
print(f"  후보 {len(CAND) - 1}개 · 무작위 같은 개수 추천 200회의 검증 5일 개선폭: 상위 5% {pp(R95)} · 최대 {pp(RMX)}")
def verdict(o):
    tr, va = o["train"], o["val"]
    if not (va[5]["n"] and tr[5]["n"]): return "자료 없음"
    lo, _ = boot(va[5]["diff"])
    ok = (tr[5]["d"] >= 0.03 and va[5]["d"] >= 0.03 and np.isfinite(lo) and lo > 0 and all(o[sp][10]["d"] >= 0 and o[sp][5]["ret"] >= o[sp][5]["ret0"] and o[sp][10]["ret"] >= o[sp][10]["ret0"] for sp in ("train", "val"))
          and va[5]["zero"] <= 0.20 and va[5]["d"] > R95)
    return "유망" if ok else ("방향만" if tr[5]["d"] > 0 and va[5]["d"] > 0 else "미달")
ORD = {"유망": 0, "방향만": 1, "미달": 2, "자료 없음": 3}
rank = sorted(RES[1:], key=lambda x: (ORD[verdict(x[3])], -(x[3]["val"][5]["d"] if np.isfinite(x[3]["val"][5]["d"]) else -9)))
print("\n■ 상위 15 (판정 → 검증 개선폭 순) · 모든 개선폭 = 같은 날 · 같은 추천 개수의 A 상위와 짝 비교")
for i, (nm, kind, p, o) in enumerate(rank[:15], 1):
    v = verdict(o); lo, hi = boot(o["val"][5]["diff"]); lo2, hi2 = boot(o["test"][5]["diff"])
    yr = {}
    for sp in ("train", "val", "test"):
        for dd, df in zip(o[sp][5]["dates"], o[sp][5]["diff"] if o[sp][5]["diff"] is not None else []): yr.setdefault(dd[:4], []).append(df)
    yrs = " ".join(f"{y}{'+' if np.mean(v_) > 0 else '−' if np.mean(v_) < 0 else '0'}" for y, v_ in sorted(yr.items()))
    print(f"  {i:>2}. [{v}] {nm}")
    for sp in ("train", "val", "test"):
        a5, a10 = o[sp][5], o[sp][10]
        print(f"      {PER[sp]}: 5일 {pc(a5['hit'])}(A {pc(a5['hit0'])} · {pp(a5['d'])}) 10일 {pc(a10['hit'])}(A {pc(a10['hit0'])}) · 평균 5/10일 {sg(a5['ret'])}/{sg(a10['ret'])} (A {sg(a5['ret0'])}/{sg(a10['ret0'])})"
              f" · 플러스 5/10일 {pc(a5['pos'])}/{pc(a10['pos'])} (A {pc(a5['pos0'])}/{pc(a10['pos0'])}) · 추천일 {a5['n']}/{a5['days']} · 0개 {pc(a5['zero'])} · 1개 {pc(a5['one'])} · 평균 {a5.get('avgsz', np.nan):.1f}개")
    print(f"      90% 구간(5일 차이) 검증 [{pp(lo)}~{pp(hi)}] · 재확인 [{pp(lo2)}~{pp(hi2)}] · 연도별 부호 {yrs}")
best = [x for x in rank if verdict(x[3]) == "유망"]
for nm, kind, p, o in best[:3]:
    print(f"\n■ 사례 — {nm}: 최근 10거래일 추천")
    for d in [x for x in DATES if SPLIT[x] == "test"][-10:]:
        S = rec(d, kind, p); D = day(d); print(f"  {d} 추천 {', '.join(S) if S else '없음'} · A TOP3 {', '.join(D['oa'][:3])} · B TOP3 {', '.join(D['ob'][:3])}")
print("\n※ 학습·검증·재확인 모두 탐색 결과(재확인 기간은 이미 본 기간). 최종 독립 검증은 2026-11-19 이후 전진 자료. 사이트 산식 불변.")
