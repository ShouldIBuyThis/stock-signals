"""pattern_flags.peak_risk_series 단위 시험(2026-11-10) — 손으로 만든 일봉으로 단계·석별형 오분류 방지 확인."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
import pattern_flags as pf
fail = 0
def check(name, cond):
    global fail; print(("✅ " if cond else "❌ ") + name); fail += (not cond)
def base(n=60):
    # 완만한 상승: 종가 100 → 130, 작은 몸통·작은 꼬리
    c = np.linspace(100, 130, n); o = c - 0.3; h = c + 0.2; l = o - 0.2
    return [o.copy(), h.copy(), l.copy(), c.copy()]
def wick_day(o, h, l, c, i, up=6.0):
    # 고가를 크게 올려 상단 밖 + 윗꼬리 ≥ 50%
    o[i] = c[i-1]; c[i] = o[i] + 0.5; l[i] = o[i] - 0.2; h[i] = c[i] + up
def run(o, h, l, c):
    fs = pf.flag_series(o, h, l, c, np.full(len(c), 1e6), "TEST")
    return fs, pf.peak_risk_series(o, h, l, c, fs["X_ESTAR"])
# 1) 3일 중 2일 윗꼬리 → 1단계
o, h, l, c = base(); wick_day(o, h, l, c, 57); wick_day(o, h, l, c, 59)
fs, ps = run(o, h, l, c)
check("1단계: 최근 3일 중 2일 상단 밖 긴 윗꼬리 → stage 1", ps["stage"][-1] == 1 and ps["q"][57] and ps["q"][59])
o, h, l, c = base(); wick_day(o, h, l, c, 59)
fs, ps = run(o, h, l, c)
check("윗꼬리 하루만 → 경고 없음", ps["stage"][-1] == 0)
# 2) 1단계 뒤 정식 석별형 → 2단계
o, h, l, c = base(64); wick_day(o, h, l, c, 57); wick_day(o, h, l, c, 58)
c[60] = c[59] + 4.0; o[60] = c[59] + 0.2; h[60] = c[60] + 0.2; l[60] = o[60] - 0.1          # 큰 양봉
o[61] = c[60] + 0.4; c[61] = o[61] + 0.1; h[61] = c[61] + 0.5; l[61] = o[61] - 0.5          # 별(작은 몸통·위쪽)
o[62] = c[61] - 0.2; c[62] = (o[60] + c[60]) / 2 - 1.0; h[62] = o[62] + 0.1; l[62] = c[62] - 0.2  # 첫 봉 몸통 중간 아래 음봉
for k in (63,): o[k] = c[62]; c[k] = c[62] + 0.1; h[k] = c[k] + 0.1; l[k] = o[k] - 0.1
fs, ps = run(o[:63], h[:63], l[:63], c[:63])
check("2단계: 정식 석별형(1단계 맥락) → stage 2", fs["X_ESTAR"][-1] and ps["stage"][-1] == 2)
# 3) 도지 하나 / 단순 음봉 하나는 석별형이 아님
o2, h2, l2, c2 = (x[:63].copy() for x in (o, h, l, c))
o2[62] = c2[61]; c2[62] = c2[61] + 0.01; h2[62] = c2[62] + 1; l2[62] = o2[62] - 1             # 셋째 봉을 도지로
fs2, ps2 = run(o2, h2, l2, c2)
check("셋째 봉이 도지 → 석별형 아님(stage 2 아님)", not fs2["X_ESTAR"][-1] and ps2["stage"][-1] != 2)
o3, h3, l3, c3 = base(); wick_day(o3, h3, l3, c3, 56); wick_day(o3, h3, l3, c3, 57)
o3[59] = c3[58] + 0.1; c3[59] = c3[58] - 1.5; h3[59] = o3[59] + 0.1; l3[59] = c3[59] - 0.1    # 큰 양봉·별 없이 음봉 하나
fs3, ps3 = run(o3, h3, l3, c3)
check("별 없는 단순 음봉 → 석별형 아님", not fs3["X_ESTAR"][-1])
# 4) 1단계 뒤 지지(스윙 저점) 종가 이탈 → 3단계, 지지 가격은 경고일에 고정
o, h, l, c = base(70)
l[50] = l[50] - 3.0                                                                             # 경고일 앞 스윙 저점
wick_day(o, h, l, c, 57); wick_day(o, h, l, c, 58)
sup = l[50]
for k in range(59, 64): o[k] = c[k-1]; c[k] = c[k-1] - 0.5; h[k] = o[k] + 0.1; l[k] = c[k] - 0.1
c[64] = sup - 1.0; o[64] = c[63]; h[64] = o[64] + 0.1; l[64] = c[64] - 0.1
fs, ps = run(o[:65], h[:65], l[:65], c[:65])
check(f"3단계: 1단계 뒤 10봉 안 종가 < 지지 → stage 3 (지지 {ps['brk'][-1]:.2f} = 스윙 저점 {sup:.2f})", ps["stage"][-1] == 3 and abs(ps["brk"][-1] - sup) < 1e-9 and ps["brk_src"][-1] == "스윙 저점")
now = pf.peak_risk_now(ps, [f"d{i}" for i in range(65)], c[:65])
check("화면 요약: 가장 높은 단계 하나(3) · 지지·종가·경고일 포함", now["stage"] == 3 and "support" in now and now["warn_date"] is not None)
sys.exit(1 if fail else 0)
