#!/usr/bin/env python3
"""캔들·패턴 신호별 3·5·10일 성적표 (연구 전용 · 백테스트 · 원장 아님) — 2026-11-11 사용자 점검 4번.
판정·진입은 tools/signal-stats.py per_ticker() 그대로(pattern_flags.flag_series · 신호일 종가 확정 → 다음 날 시가 진입 → n일 뒤 종가,
같은 종목·신호 10일 쿨다운, 같은 날 여러 종목은 1건 평균). 기준선 = 모든 종목·5일 간격 같은 진입 규칙.
출력(요약만): 신호별 n · 3/5/10일 '맞는 방향' 비율(>0, 보합은 실패) · ±1% 방향 비율 · 평균% · 기준선 대비 차이.
사용: python tools/signal-horizon-table.py
"""
import importlib.util, sys
import numpy as np
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)
s = importlib.util.spec_from_file_location("ss", f"{ROOT}/tools/signal-stats.py"); ss = importlib.util.module_from_spec(s); s.loader.exec_module(ss)
HS = (3, 5, 10)
wl = ss.watchlist(); qq = ss.tr.fetch("QQQ"); q200 = qq["Close"].rolling(200).mean()
regime = {str(d.date()): ("up" if c >= m else "down") for d, c, m in zip(qq.index, qq["Close"], q200) if not np.isnan(m)}
ev_all, base = {}, {h: [] for h in HS}
for t in wl:
    df = ss.tr.fetch(t)
    if df is None or len(df) < 300: continue
    ev, _, _, _, N = ss.per_ticker(t, df, regime)
    for code, es in ev.items(): ev_all.setdefault(code, []).extend(es)
    o = df["Open"].to_numpy(float); c = df["Close"].to_numpy(float); o1 = np.full(N, np.nan); o1[:-1] = o[1:]
    for h in HS:
        f = np.full(N, np.nan); f[:-h] = (c[h:] / o1[:-h] - 1) * 100
        base[h].extend([x for x in f[260::5] if not np.isnan(x)])
B = {h: np.array(base[h]) for h in HS}
print(f"기간 {ss.tr.START}~{ss.tr.END} · 관심종목 {len(wl)} · 기준선 n {len(B[10])}")
print("기준선(아무 날 매수): " + " · ".join(f"{h}일 상승 {np.mean(B[h] > 0)*100:.0f}% 평균 {B[h].mean():+.2f}%" for h in HS))
print("표기: 맞는 방향% (🟢🔵=상승, 🟠🔴=하락 · >0/<0, 보합 실패) [±1% 방향%] 평균% · Δ = 기준선 대비 %p(맞는 방향 기준)")
IX = {3: 2, 5: 3, 10: 4}
rows = []
for code, es in ev_all.items():
    kind = ss.kind_of(code)
    if kind is None: continue
    up = kind in ("green", "blue")
    by = {}
    for e in es: by.setdefault(e[0], []).append(e)
    R = {h: [] for h in HS}
    for d, g in by.items():
        for h in HS:
            v = [x[IX[h]] for x in g if not np.isnan(x[IX[h]])]
            if v: R[h].append(float(np.mean(v)))
    cells, deltas = [], {}
    for h in HS:
        a = np.array(R[h]); n = len(a)
        if not n: cells.append(f"{h}일 —"); continue
        good = np.mean(a > 0) if up else np.mean(a < 0)
        u1, d1 = np.sum(a > 1), np.sum(a < -1)
        dirp = (u1 if up else d1) / (u1 + d1) if u1 + d1 else np.nan
        bgood = np.mean(B[h] > 0) if up else np.mean(B[h] < 0)
        deltas[h] = (good - bgood) * 100
        cells.append(f"{h}일 {good*100:3.0f}% [{dirp*100:3.0f}%] {a.mean():+5.2f}% Δ{deltas[h]:+4.0f}")
    n10 = len(R[10]); grade = "50+" if n10 >= 50 else "30~50" if n10 >= 30 else "15~30" if n10 >= 15 else "<15"
    rows.append((kind, code, n10, grade, cells, deltas))
order = {"green": 0, "blue": 1, "orange": 2, "red": 3}
for kind, code, n10, grade, cells, dl in sorted(rows, key=lambda r: (order[r[0]], -r[2])):
    flag = ""
    if 3 in dl and 10 in dl:
        if dl[3] >= 3 and dl[10] < 3: flag = " ← 짧게만"
        elif dl[3] < 3 and dl[10] >= 3: flag = " ← 길게만"
    print(f"{kind:6} {code:10} n{n10:4}({grade:5}) | " + " | ".join(cells) + flag)
