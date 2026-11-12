#!/usr/bin/env python3
"""화면 블록(pattern_flags.combo_blocks / combo_blocks_now)이 연구 도구(tools/peak-combo-lab.py blocks())와 같은 식인지 대조.
합성 일봉 여러 개에서 봉 단위로 비교한다(불일치 0이어야 통과). 사용: python3 tools/test_combo_blocks.py"""
import importlib.util, sys, zlib
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parent.parent; sys.path.insert(0, str(ROOT))
import pattern_flags as pf
s = importlib.util.spec_from_file_location("cb", ROOT / "tools" / "peak-combo-lab.py"); cb = importlib.util.module_from_spec(s); s.loader.exec_module(cb)
bad = 0; n_on = 0
for t in ["A", "B", "C", "D", "E", "F", "G", "H"]:
    rng = np.random.default_rng(zlib.crc32(t.encode())); n = 700
    r = rng.normal(0.001, 0.03, n); r[300:330] += 0.03; c = np.cumprod(1 + r) * 50; o = c * (1 + rng.normal(0, .01, n))
    h = np.maximum(o, c) * (1 + abs(rng.normal(0, .015, n))); l = np.minimum(o, c) * (1 - abs(rng.normal(0, .015, n))); v = rng.integers(1e5, 1e7, n).astype(float)
    lev = 3 if t == "H" else 1; z = np.zeros(n, bool)
    B1, _, _ = cb.blocks(t, o, h, l, c, v, lev, None, None, z, z); B2 = pf.combo_blocks(o, h, l, c, v, lev, t)
    for k in pf.COMBO_STOCK_BLOCKS: bad += int((B1[k] != B2[k]).sum()); n_on += int(B2[k].sum())
    now = pf.combo_blocks_now(o[-250:], h[-250:], l[-250:], c[-250:], v[-250:], [str(i) for i in range(250)], lev=lev, ticker=t)
    assert set(now) == {"days", "na"} and len(now["days"]) == 5 and now["na"] == ["P_NEAR", "P_RT5", "C_FB"], now
    full = pf.combo_blocks_now(o, h, l, c, v, [str(i) for i in range(n)], lev=lev, ticker=t)
    assert full["na"] == [] and all(set(x) <= set(pf.COMBO_STOCK_BLOCKS) for x in full["days"].values())
    for j, d in enumerate(sorted(full["days"], key=int)):   # 마지막 5봉 값이 전체 계산과 같아야 한다
        i = int(d); assert full["days"][d] == [k for k in pf.COMBO_STOCK_BLOCKS if B2[k][i]], (t, d)
print(f"블록 대조: 켜진 봉 {n_on} · 불일치 {bad}")
if bad: sys.exit(1)

# 52주 블록 복구(main.restore_52w_blocks) — 가짜 2년치로: 연구 정의(이전 251봉)와 같고, 나머지 블록·매수 입력은 그대로
import pandas as pd
import main as M
rng = np.random.default_rng(3); n = 520
r = rng.normal(0.001, 0.02, n); r[500:512] += 0.04; c = np.cumprod(1 + r) * 50; o = c * (1 + rng.normal(0, .01, n)); h = np.maximum(o, c) * 1.02; l = np.minimum(o, c) * 0.98
v = rng.integers(1e5, 1e7, n).astype(float); idx = pd.bdate_range('2024-09-01', periods=n)
long = pd.DataFrame({'Open': o, 'High': h, 'Low': l, 'Close': c, 'Volume': v}, index=idx); short = long.iloc[-250:]; sd = [d.strftime('%Y-%m-%d') for d in short.index]
b1 = pf.combo_blocks_now(short.Open.values, short.High.values, short.Low.values, short.Close.values, short.Volume.values, sd)
b2 = M.restore_52w_blocks('T', {'days': {k: list(x) for k, x in b1['days'].items()}, 'na': list(b1['na'])}, fetch=lambda tk: long)
B = pf.combo_blocks(long.Open.values, long.High.values, long.Low.values, long.Close.values, long.Volume.values, min52=251)
ok52 = b2['na'] == [] and all(((k in b2['days'][d]) == bool(B[k][n - 5 + j])) for j, d in enumerate(b2['days']) for k in ('P_NEAR', 'P_RT5', 'C_FB'))
keep = all({x for x in b2['days'][d] if x not in ('P_NEAR', 'P_RT5', 'C_FB')} == set(b1['days'][d]) for d in b1['days'])
miss = M.restore_52w_blocks('T', {'days': {'x': ['O_EXT']}, 'na': ['P_NEAR']}, fetch=lambda tk: long)
print(f"52주 복구: 연구 정의 일치 {ok52} · 나머지 블록 그대로 {keep} · 날짜 불일치면 보류 유지 {miss['na'] == ['P_NEAR']}")
sys.exit(0 if ok52 and keep and miss['na'] == ['P_NEAR'] else 1)
