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
sys.exit(1 if bad else 0)
