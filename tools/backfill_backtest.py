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

적용되는 필터
--------------
`analyze()`를 그대로 쓰므로 지표는 운영과 동일하고, 여기에 더해
  · 시장 국면(그 날짜의 QQQ)  → attach_historical_market()
  · 항복 바닥(K2) 해제        → qqq_card 동봉
  · 실적 영향권 제외          → historical_earnings()
까지 붙인다. 남는 차이는 아래 생존 편향뿐이다.

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



def historical_earnings(tk: str, first_day: str, last_day: str) -> tuple[list, list]:
    """백테스트 창 안의 과거 실적일을 모아 신호금지·종가오염 세션으로 바꾼다.

    운영 경로(main.fetch_event_calendars)는 '앞으로 며칠' 캘린더만 본다. 백테스트는
    9개월 전까지 거슬러야 하므로 티커별 `get_earnings_dates`(과거 분까지 준다)를 쓴다.
    창을 만드는 규칙은 main._earnings_windows() 그대로다 — 여기서 다시 짜지 않는다.
    """
    if tk in M.NO_EARNINGS_TICKERS:
        return [], []
    try:
        df = M.yf.Ticker(tk).get_earnings_dates(limit=24)
    except Exception:
        return [], []
    if df is None or getattr(df, "empty", True):
        return [], []
    blocked, affected = set(), set()
    for idx, _ in df.iterrows():
        d = M._event_date(idx)
        if not d or not (first_day <= d <= last_day):
            continue
        b, a, _rel, _sess = M._earnings_windows({"date": d, "timing": M._timing_from_timestamp(idx)})
        blocked.update(b); affected.update(a)
    return sorted(blocked), sorted(affected)


def build(days: int) -> dict:
    # analyze()·market_state()가 모듈 전역 HIST_DAYS를 읽으므로 여기서 늘린다.
    M.HIST_DAYS = days
    print(f"HIST_DAYS = {M.HIST_DAYS} (야후 1년 ≈ 252봉 · 워밍업 66봉 필요)")

    mkt = M.market_state(M.MARKET_TICKER)
    mhist = (mkt or {}).get("hist") or []
    print(f"시장({M.MARKET_TICKER}) 이력 {len(mhist)}일")
    if len(mhist) < days * 0.5:
        print("⚠ 시장 이력이 요청 일수의 절반도 안 된다 — 종목 쪽도 짧을 것이다.")

    rows, failed, earn_days = [], [], 0
    todo = [(tk, nm, cat) for cat, grp in M.WATCHLIST.items() for tk, nm in grp.items()]
    for i, (tk, nm, cat) in enumerate(todo, 1):
        try:
            r = M.analyze(tk, nm, cat)
            # 그날의 시장 입력을 각 hist 행에 붙인다 — 실행 시점 값으로 덮지 않는다.
            hist = r.get("hist") or []
            di = M.HIST_FIELDS.index("date")
            days_seen = [str(h[di]) for h in hist if h and h[di]]
            if days_seen:
                b, a = historical_earnings(tk, days_seen[0], days_seen[-1])
                r["validation_blocked_dates"] = b
                r["validation_affected_dates"] = a
                earn_days += len(b)
            rows.append(r)
            print(f"  [{i}/{len(todo)}] OK   {tk:<10} hist {len(hist)}행"
                  f"{' · 실적창 ' + str(len(r.get('validation_blocked_dates') or [])) + '일' if r.get('validation_blocked_dates') else ''}")
        except Exception as e:
            failed.append(f"{tk} — {e}")
            print(f"  [{i}/{len(todo)}] SKIP {tk:<10} {e}")
        time.sleep(0.15)     # 야후 쪽 부담을 줄인다

    M.attach_historical_market(rows, mkt)
    M.attach_historical_rs20(rows, mkt)          # 시장 대비 상대강도(rs20) — 실험에서 rs20 후보를 재려면 필요

    # 항복 바닥(K2) 해제는 qqq_card.hist의 그날 RSI를 읽는다. 이게 없으면 화면 산식이
    # weak을 절대 못 풀어 백테스트만 더 보수적으로 나온다 — 운영과 같은 카드를 만들어 넣는다.
    try:
        qqq_card = M.prepare_qqq_card(M.analyze(M.MARKET_TICKER, "나스닥100 ETF", "시장 기준"), [], False)
        print(f"QQQ 기준카드: hist {len(qqq_card.get('hist') or [])}행 (K2 항복바닥 해제용)")
    except Exception as e:
        qqq_card = None
        print(f"⚠ QQQ 기준카드 실패 — K2 해제가 백테스트에 반영되지 않는다: {e}")

    # 나스닥 예측용 거시 축. 지금은 저장만 하고 판정에는 쓰지 않는다 —
    # 188거래일 표본이 쌓여야 §2·§3 검증을 할 수 있기 때문이다.
    #   ^VXN 나스닥 변동성 · ^TNX 미국 10년물 금리 · NQ=F 나스닥100 선물(일봉)
    macro = {}
    # ^TNX는 야후가 16일치만 줬다(2026-08-18 실측). 같은 금리를 보는 티커를 함께
    # 받아 두고, 검증 도구가 가장 긴 이력을 고르게 한다.
    for sym, key in (("^VXN", "vxn"), ("^TNX", "tnx"), ("ZN=F", "zn"),
                     ("IEF", "ief"), ("TLT", "tlt"), ("NQ=F", "nq"),
                     # SPY 대비 축(나스닥 전용 등급 후보) 측정용 — 2026-08-19
                     ("SPY", "spy")):
        try:
            df = M._fetch_daily(sym)
            df = M.drop_unclosed(df, sym)
            if df is None or len(df) == 0:
                print(f"거시 지표 없음: {sym}")
                continue
            macro[key] = {d.strftime("%Y-%m-%d"): (None if M.pd.isna(v) else round(float(v), 4))
                          for d, v in df["Close"].items()}
            print(f"거시 지표 {sym} → {key} {len(macro[key])}일")
        except Exception as e:
            print(f"거시 지표 실패: {sym} — {e}")
        time.sleep(0.15)

    print(f"실적 영향권: 신호금지 세션 {earn_days}일 수집")
    return {
        "kind": "backtest",           # 원장이 아님을 파일 안에도 남긴다
        "note": "현재 산식을 과거 데이터에 소급 적용한 백테스트. signals.json의 frozen 원장과 다르다.",
        "survivorship_warning": "관심종목을 현재 시점에서 골랐으므로 과거 성적은 위로 편향된다.",
        # 티커별 get_earnings_dates로 과거 실적일까지 복원해 운영과 같은 창을 뺀다.
        "earnings_excluded": True,
        "days_requested": days,
        "hist_fields": M.HIST_FIELDS,
        "market": mkt,
        "qqq_card": qqq_card,
        "macro": macro,
        "stocks": rows,
        "failed": failed,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=1,
                    help="야후 조회 기간(년). 3이면 약 750봉 — 종목별·섹터별 표본이 필요할 때만 쓴다(느리다).")
    ap.add_argument("--days", type=int, default=180,
                    help="hist 행 수. 야후 1년(약 252봉)에서 워밍업 66봉을 빼면 180이 상한")
    ap.add_argument("--out", default="backtest/raw.json")
    args = ap.parse_args()

    M.PERIOD = f"{args.years}y"
    _cap = int(252 * args.years) - 66
    if args.days > _cap:
        sys.exit(f"--days {args.days} 는 --years {args.years}(약 {252*args.years}봉)에 비해 너무 크다 — 66+{args.days}봉이 필요한데 "
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
