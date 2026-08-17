#!/usr/bin/env python3
"""1회성 장기 백테스트 원본 생성 — 종목별 승률 표본을 늘리기 위한 것.

왜 필요한가
-----------
종목별 개별 승률은 지금 표본이 1~5건이라 대부분 '표본 부족'으로 나온다.
`signals.json`의 frozen hist가 30거래일뿐이기 때문이다.

그런데 main.py는 매 실행마다 야후에서 **1년치**를 받아 놓고 최근 30일만
잘라 쓰고 버린다. 그 버리는 부분을 한 번만 살리면 표본이 6배가 된다.

무엇을 하는가
-------------
main.py의 `analyze()`·`market_state()`를 **그대로** 재사용하되 HIST_DAYS만
늘려서 돌린다. 지표 계산을 여기서 다시 짜지 않는다 — 두 곳에 두면 반드시
어긋난다(docs/승률-검증-방법론.md §0).

  analyze()      는 len(close) >= 61 + HIST_DAYS 를 요구하고
  market_state() 는 len(c)     >= 66 + HIST_DAYS 를 요구한다.
  야후 1년 = 약 252봉이므로 HIST_DAYS = 180이 안전한 상한이다(66+180=246).

⚠ 이 파일은 원장이 아니다
--------------------------
`signals.json`의 frozen hist는 "그날 우리가 실제로 본 것"이고 append-only다.
여기서 만드는 건 "지금 산식을 과거에 소급 적용하면 어땠을까"라는 **백테스트**다.
둘은 다른 주장이므로 절대 섞지 않는다. 이 스크립트는 signals.json도,
history/도 건드리지 않는다.

⚠ 생존 편향이 있다
------------------
관심종목은 **지금 시점에서** 골랐다. 최근 눈에 띈 종목이 들어와 있으므로
과거 1년에 소급하면 성적이 위로 부풀려진다. 화면에도 그렇게 적어야 한다.

사용: python tools/backfill_backtest.py [--days 180] [--out backtest/raw.json]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import main as M


def build(days: int) -> dict:
    # analyze()·market_state()가 모듈 전역 HIST_DAYS를 읽으므로 여기서 늘린다.
    M.HIST_DAYS = days
    print(f"HIST_DAYS = {M.HIST_DAYS} (야후 1년 ≈ 252봉 · 워밍업 66봉 필요)")

    mkt = M.market_state(M.MARKET_TICKER)
    mhist = (mkt or {}).get("hist") or []
    print(f"시장({M.MARKET_TICKER}) 이력 {len(mhist)}일")
    if len(mhist) < days * 0.5:
        print("⚠ 시장 이력이 요청 일수의 절반도 안 된다 — 종목 쪽도 짧을 것이다.")

    rows, failed = [], []
    todo = [(tk, nm, cat) for cat, grp in M.WATCHLIST.items() for tk, nm in grp.items()]
    for i, (tk, nm, cat) in enumerate(todo, 1):
        try:
            r = M.analyze(tk, nm, cat)
            # 그날의 시장 입력을 각 hist 행에 붙인다 — 실행 시점 값으로 덮지 않는다.
            rows.append(r)
            print(f"  [{i}/{len(todo)}] OK   {tk:<10} hist {len(r.get('hist') or [])}행")
        except Exception as e:
            failed.append(f"{tk} — {e}")
            print(f"  [{i}/{len(todo)}] SKIP {tk:<10} {e}")
        time.sleep(0.15)     # 야후 쪽 부담을 줄인다

    M.attach_historical_market(rows, mkt)
    return {
        "kind": "backtest",           # 원장이 아님을 파일 안에도 남긴다
        "note": "현재 산식을 과거 데이터에 소급 적용한 백테스트. signals.json의 frozen 원장과 다르다.",
        "survivorship_warning": "관심종목을 현재 시점에서 골랐으므로 과거 성적은 위로 편향된다.",
        "earnings_excluded": False,   # 1년치 실적일 데이터가 없어 제외하지 못한다
        "days_requested": days,
        "hist_fields": M.HIST_FIELDS,
        "market": mkt,
        "stocks": rows,
        "failed": failed,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=180,
                    help="hist 행 수. 야후 1년(약 252봉)에서 워밍업 66봉을 빼면 180이 상한")
    ap.add_argument("--out", default="backtest/raw.json")
    args = ap.parse_args()

    if args.days > 186:
        sys.exit(f"--days {args.days} 는 너무 크다 — market_state가 66+{args.days}봉을 요구하는데 "
                 f"야후 1년은 약 252봉뿐이다. 186 이하로 줄일 것.")

    payload = build(args.days)
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    size = os.path.getsize(args.out) / 1048576
    got = [len(s.get("hist") or []) for s in payload["stocks"]]
    print(f"\n저장: {args.out} ({size:.1f}MB) · {len(payload['stocks'])}종목 · "
          f"hist {min(got) if got else 0}~{max(got) if got else 0}행 · 실패 {len(payload['failed'])}건")
    if payload["failed"]:
        print("실패 목록:", payload["failed"])


if __name__ == "__main__":
    main()
