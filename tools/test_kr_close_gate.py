"""main.kr_official_close_gate 단위 시험 — 네트워크 없이 가짜 quote로 (2026-11-10)."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datetime import datetime
from zoneinfo import ZoneInfo
import main
K = ZoneInfo("Asia/Seoul")
ts = lambda hm: int(datetime(2026, 11, 10, int(hm[:2]), int(hm[3:]), tzinfo=K).timestamp())
Q = {
    "A.KS": {"regularMarketTime": ts("15:30"), "regularMarketPrice": 10840},
    "B.KS": {"regularMarketTime": ts("15:21"), "regularMarketPrice": 10840},   # 종가 단일가 전
    "C.KQ": {"regularMarketTime": ts("15:30"), "regularMarketPrice": 10850},   # 가격 불일치
    "D.KS": {},                                                                # 값 없음
}
rows = [
    {"ticker": "A.KS", "last_date": "2026-11-10", "price": 10840.0},
    {"ticker": "B.KS", "last_date": "2026-11-10", "price": 10840.0},
    {"ticker": "C.KQ", "last_date": "2026-11-10", "price": 10840.0},
    {"ticker": "D.KS", "last_date": "2026-11-10", "price": 1.0},
    {"ticker": "E.KS", "last_date": "2026-11-10", "price": 1.0, "data_status": "carried_after_fetch_error"},
    {"ticker": "F.KS", "last_date": "2026-11-07", "price": 1.0},
    {"ticker": "NVDA", "last_date": "2026-11-10", "price": 1.0},
]
bad = main.kr_official_close_gate(rows, "2026-11-10", quote=lambda t: Q[t])
want = {"B.KS", "C.KQ", "D.KS"}
got = {b.split()[0] for b in bad}
ok = got == want
print(("✅" if ok else "❌"), "걸린 종목", sorted(got), "기대", sorted(want))
for b in bad: print("  ·", b)
ok2 = main.kr_official_close_gate(rows[:1], "2026-11-10", quote=lambda t: Q[t]) == []
print(("✅" if ok2 else "❌"), "정상 1종목 통과")
sys.exit(0 if ok and ok2 else 1)
