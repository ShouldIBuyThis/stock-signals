#!/usr/bin/env python3
"""signals.json 배포 전 원장·구조 불변식 검증.

점수나 등급을 다시 계산하지 않는다. 대신 생성기가 내보내야 하는
구조와 frozen history의 append-only 규칙을 검사해 조용한 오염을 막는다.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path

from main import (HIST_BACKFILL_FIELDS, HIST_FIELDS, MARKET_TICKER, PENDING_TICKERS, RETIRED_TICKERS,
                  SNAPSHOT_FIELDS, WATCHLIST, is_kr_ticker)


def fail(message: str) -> None:
    raise AssertionError(message)


def load(path: str | Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def finite_positive(value) -> bool:
    try:
        n = float(value)
        return math.isfinite(n) and n > 0
    except (TypeError, ValueError):
        return False


def rows_by_ticker(payload: dict) -> dict[str, dict]:
    rows = payload.get("stocks") or []
    tickers = [r.get("ticker") for r in rows]
    if any(not t for t in tickers):
        fail("ticker가 빈 종목 행이 있습니다.")
    if len(tickers) != len(set(tickers)):
        fail("중복 ticker가 있습니다.")
    return {r["ticker"]: r for r in rows}


def hist_map(stock: dict, fields: list[str]) -> dict[str, list]:
    date_i = fields.index("date")
    out = {}
    for row in stock.get("hist") or []:
        if not isinstance(row, list) or len(row) <= date_i or not row[date_i]:
            fail(f"{stock.get('ticker')} hist 행 형식/날짜 오류")
        day = str(row[date_i])
        if day in out:
            fail(f"{stock.get('ticker')} hist 중복 날짜 {day}")
        out[day] = row
    return out


def same_value(a, b) -> bool:
    # JSON의 1과 1.0은 동일한 숫자로 취급하되, 배열/객체는 내용이 같아야 한다.
    if isinstance(a, (int, float)) and not isinstance(a, bool) and isinstance(b, (int, float)) and not isinstance(b, bool):
        return math.isfinite(float(a)) and math.isfinite(float(b)) and float(a) == float(b)
    return a == b


def validate_current(payload: dict, scope: str) -> None:
    fields = payload.get("hist_fields")
    if fields != HIST_FIELDS:
        fail("hist_fields 순서가 main.py 정의와 다릅니다.")
    # market_events까지가 원래 스키마다. 그 뒤로는 꼬리 확장 필드만 온다
    # (2026-08-17: low_52w·pct_from_low). 위치 기반 배열이라 중간 삽입은 여전히 금지.
    if not fields or "market_events" not in fields:
        fail("market_events가 hist_fields에 없습니다.")

    rows = rows_by_ticker(payload)
    expected = {ticker for group in WATCHLIST.values() for ticker in group}
    actual = set(rows)
    # 신규 상장은 일봉 30개가 쌓이기 전까지 analyze()가 "데이터 부족"으로 걸러낸다.
    # PENDING_TICKERS에 올라온 종목만 그 기간 동안 빠져 있어도 통과시킨다.
    # 반대로 '있으면 안 되는 종목이 있는 것'은 면제하지 않는다.
    missing = expected - actual - PENDING_TICKERS
    if missing or (actual - expected):
        fail(f"WATCHLIST 불일치 — 누락 {sorted(missing)} / 추가 {sorted(actual-expected)}")
    for ticker in sorted(PENDING_TICKERS & (expected - actual)):
        print(f"[대기] {ticker} 아직 30봉 미만 — 쌓이면 자동 합류 (PENDING_TICKERS)")
    if MARKET_TICKER in actual:
        fail(f"{MARKET_TICKER}가 일반 stocks 랭킹 유니버스에 섞였습니다.")
    qqq = payload.get("qqq_card") or {}
    if not qqq or not qqq.get("last_date") or not finite_positive(qqq.get("price")):
        fail("QQQ 별도 기준카드가 비었거나 가격이 잘못됐습니다.")
    # 상장 대기 종목의 수집 실패는 예상된 상태다. 그 외 실패만 오류로 본다.
    hard_failed = [f for f in (payload.get("failed") or [])
                   if str(f).split(" ")[0] not in PENDING_TICKERS]
    if hard_failed:
        fail(f"최종 수집 실패 종목이 있습니다: {hard_failed}")

    for ticker, stock in rows.items():
        day = str(stock.get("last_date") or "")
        if not day or not finite_positive(stock.get("price")):
            fail(f"{ticker} 최신 날짜/가격 오류")
        hm = hist_map(stock, fields)
        if day not in hm:
            fail(f"{ticker} 현재 카드 {day}가 frozen hist에 없습니다.")
        current = hm[day]
        for i, name in enumerate(fields):
            if name == "date":
                continue
            hist_value = current[i] if i < len(current) else None
            if not same_value(stock.get(name), hist_value):
                fail(f"{ticker} {day} top/hist 불일치: {name} ({stock.get(name)!r} != {hist_value!r})")

    # 현재 실행 범위의 일자별 snapshot이 실제로 생성됐는지 확인한다.
    regions = ["us", "kr"] if scope == "all" else [scope]
    for region in regions:
        selected = [s for s in rows.values() if is_kr_ticker(s["ticker"]) == (region == "kr")]
        day = max(str(s["last_date"]) for s in selected)
        path = Path("history") / region / f"{day}.json"
        if not path.exists():
            fail(f"{region.upper()} 일자별 frozen snapshot 누락: {path}")
        snap = load(path)
        snap_by_ticker = {s.get("ticker"): s for s in (snap.get("stocks") or []) if s.get("ticker")}
        snap_tickers = set(snap_by_ticker)
        expected_region = {s["ticker"] for s in selected}
        # 신규 티커가 이미 고정된 거래일에 합류하면 그 날 snapshot에는 아직 없다
        # (2026-08-16 실패 사례: UYG 등 4종 추가 직후). snapshot 파일은 불변이므로
        # '모르는 티커가 들어있는 것'만 오류로 보고, 빠진 신규 티커는 다음
        # 새 거래일 snapshot부터 자동 포함된다.
        # 반대 방향(2026-08-17 실패 사례: MCD·CURE 제외)도 있다 — 관심종목에서
        # 뺀 티커가 예전 snapshot에는 남아 있다. RETIRED_TICKERS로 허용한다.
        retired_region = {t for t in RETIRED_TICKERS if is_kr_ticker(t) == (region == "kr")}
        if not snap_tickers <= (expected_region | retired_region):
            fail(f"{path} snapshot에 알 수 없는 티커: {sorted(snap_tickers - expected_region - retired_region)}")
        for stock in selected:
            frozen = snap_by_ticker.get(stock["ticker"])
            if frozen is None:
                continue  # 고정일 이후 합류한 신규 티커
            if str(frozen.get("last_date") or "") != str(stock.get("last_date") or ""):
                fail(f"{path} {stock['ticker']} 날짜 불일치")
            for name in SNAPSHOT_FIELDS:
                if name == "ticker":
                    continue
                # 뒤늦게 추가된 열은 그 열이 생기기 전에 고정된 snapshot에 없다.
                # snapshot 파일은 불변이므로 '없음'만 허용하고, 값이 다른 것은 오류다.
                if name in HIST_BACKFILL_FIELDS and frozen.get(name) is None:
                    continue
                if not same_value(stock.get(name), frozen.get(name)):
                    fail(f"{path} {stock['ticker']} snapshot/top 불일치: {name}")


def backfill_ok(old_row: list, new_row: list, fields: list[str]) -> bool:
    """고정된 행이 바뀌지 않았는지 본다 — 단 두 가지만 허용한다.

    ① 꼬리 확장: 옛 행이 짧으면 뒤에 새 열(None 또는 값)이 붙을 수 있다.
    ② 뒤늦게 추가된 열(HIST_BACKFILL_FIELDS)은 None이던 칸을 한 번 채울 수 있다.
       값이 있던 칸을 다른 값으로 바꾸는 것은 여전히 변조다.
    2026-09-02 실제 사례: market_vxn 열을 옛 행에 채우자(main.py attach_historical_market)
    통째 비교가 '변조'로 잡아 배포가 두 번 멈췄다(run #283·#285).
    """
    if len(new_row) < len(old_row):
        return False
    backfill_idx = {fields.index(n) for n in HIST_BACKFILL_FIELDS if n in fields}
    for i, (a, b) in enumerate(zip(old_row, new_row)):
        if same_value(a, b):
            continue
        if a is None and i in backfill_idx:
            continue
        return False
    return True


def validate_append_only(old: dict, new: dict, force_resnap: bool, scope: str) -> None:
    old_fields = old.get("hist_fields") or []
    new_fields = new.get("hist_fields") or []
    # 꼬리에 필드를 덧붙이는 확장만 허용한다. 기존 구간의 순서 변경·중간 삽입은
    # 이미 저장된 위치 기반 배열을 전부 어긋나게 하므로 차단한다.
    if new_fields[:len(old_fields)] != old_fields:
        fail("run 전후 hist_fields 기존 구간이 바뀌었습니다(꼬리 추가만 허용).")
    old_rows, new_rows = rows_by_ticker(old), rows_by_ticker(new)
    for ticker in set(old_rows) & set(new_rows):
        before, after = old_rows[ticker], new_rows[ticker]
        old_hist = hist_map(before, old_fields)
        new_hist = hist_map(after, new_fields)
        new_days = sorted(new_hist)
        new_oldest = new_days[0] if new_days else ""
        active = scope == "all" or (scope == "kr") == is_kr_ticker(ticker)
        allowed_resnap_day = str(after.get("last_date") or "") if force_resnap and active else None
        for day, row in old_hist.items():
            if day not in new_hist:
                # 10일 롤링 창에서 새 날짜가 들어오며 가장 오래된 행이 밀려나는 것만 허용.
                if not new_oldest or day >= new_oldest:
                    fail(f"{ticker} frozen hist 중간/최신 행 삭제: {day}")
                continue
            if day != allowed_resnap_day and not backfill_ok(row, new_hist[day], new_fields):
                fail(f"{ticker} frozen hist 변조 감지: {day}")

        for key in ("validation_blocked_dates", "validation_affected_dates"):
            before_set = set(before.get(key) or [])
            after_set = set(after.get(key) or [])
            if not before_set <= after_set:
                fail(f"{ticker} {key} 과거 제외일 삭제 감지")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", nargs="?", default="signals.json")
    parser.add_argument("--previous")
    parser.add_argument("--scope", choices=("us", "kr", "all"), default=os.getenv("RUN_SCOPE", "all"))
    parser.add_argument("--force-resnap", action="store_true")
    args = parser.parse_args()

    payload = load(args.path)
    validate_current(payload, args.scope)
    if args.previous:
        validate_append_only(load(args.previous), payload, args.force_resnap, args.scope)
    print(f"signals 정합성 PASS — {len(payload.get('stocks') or [])}종목 · scope={args.scope} · frozen append-only 확인")


if __name__ == "__main__":
    main()
