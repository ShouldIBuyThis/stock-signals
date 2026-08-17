# ============================================================
# main.py — 관심종목 시세·지표 계산 → signals.json 저장
# (GitHub Actions가 하루 2번 자동 실행)
# 종목을 바꾸려면 아래 WATCHLIST 딕셔너리만 고치세요.
# ------------------------------------------------------------
# [1차 개선 반영]
#  · 거래량 비중 ↑ (0.3 → 0.6~0.8)
#  · MACD 0선 조건 (0선 아래 골든크로스 = 강한 반등 → 가점 크게)
#  · 시장 필터 (QQQ 20일선 아래면 미국 종목 전체 -0.5)
#  · 이동평균 신호 중복 방지 (한 종목당 추세 점수는 한 갈래만)
# ============================================================
import os
import yfinance as yf
import pandas as pd
import numpy as np
import json
import exchange_calendars as xcals
from datetime import datetime, timedelta, time as dtime
from zoneinfo import ZoneInfo

PERIOD = "1y"    # 52주 신고가 계산 위해 1년

# ── 실행 범위 ────────────────────────────────────────────────
#  all : 전 종목 수집 (수동 점검용)
#  us  : 미국 종목만 수집. 한국 종목은 직전 signals.json 값을 그대로 유지한다.
#  kr  : 한국 종목만 수집. 미국 종목은 직전 signals.json 값을 그대로 유지한다.
#        15:40 KST = 뉴욕 02:40 이라 미국장은 닫혀 있어 새 종가가 없다.
#        그래도 다시 부르면 (1) 야후 사후 정정으로 장전에 점수가 흔들리고
#        (2) 불필요한 71건 요청이 레이트리밋을 유발해 종목이 통째로 사라진다.
# 카드 타임라인용 — 최근 며칠치 지표를 함께 내려준다.
# 키를 반복하는 객체 대신 위치 기반 배열이라 용량이 절반 이하다.
# 검증 표본 크기를 결정한다. signals.json의 hist는 이 길이에서 잘린다.
# 10이던 것을 30으로 올렸다 — 10에서는 하루 지날 때마다 가장 오래된 거래일이
# 잘려나가 검증 표본이 영원히 10일에 갇혔고, history/ 폴더 스냅샷이 시작되기 전
# 날짜(2026-08-03~06)는 잘리는 순간 복구할 방법이 없었다.
HIST_DAYS = 30
# 뒤에 필드를 덧붙이는 건 안전하다(옛 행은 짧을 뿐이고 freeze 단계에서 보강한다).
# 순서를 바꾸거나 중간에 끼워 넣으면 이미 저장된 위치 기반 배열이 전부 어긋난다.
HIST_FIELDS = ["date","price","change_1d","ma5","ma10","ma20","ma50","ma60","rsi","macd_hist","macd_cross","macd_zero",
               "bb_pos","stoch_k","stoch_d","stoch_cross","vol_ratio","near_high","pct_from_high",
               "ma20_slope","run5_max","run3_sum","range3","range10","vol3_ratio",
               "res_short","ret20","rs20",
               "atr_pct",
               # 그 날짜의 시장 입력. 산식이 그대로인데 QQQ 재계산만으로 과거 신호가 흔들리는 걸 막는다.
               "market_level","market_weak","market_ret20",
               # 해당 종가 날짜의 주요 미국 시장 이벤트. 점수에는 쓰지 않고 경고 표시만 한다.
               "market_events",
               # 2026-08-17 확장: 미너비니 ③(52주 저점 대비 +25%) 검증용.
               # market_events 뒤에 덧붙였으므로 옛 행은 짧을 뿐 위치가 어긋나지 않는다.
               # validate_signals.py의 append-only 검사도 꼬리 확장을 허용하도록 같이 고쳤다.
               "low_52w", "pct_from_low",
               # 2026-08-17 확장: 미너비니 ①(150·200일선 정배열)·②(200일선 상승세) 검증용
               "ma120", "ma200", "ma200_slope"]

# freeze 단계에서 옛 행에 뒤늦게 채워 넣는 열. 이미 값이 있으면 절대 덮지 않는다.
HIST_BACKFILL_FIELDS = ["atr_pct", "market_level", "market_weak", "market_ret20", "market_events"]

RUN_SCOPE = os.environ.get("RUN_SCOPE", "all").strip().lower()
if RUN_SCOPE not in ("all", "kr", "us"):
    RUN_SCOPE = "all"

# 수동 복구 전용. 자동 실행에서는 반드시 false.
# 켜면 현재 RUN_SCOPE의 "오늘 거래일" 스냅샷과 signals.json의 당일 hist 행만 다시 확정한다.
FORCE_RESNAP = os.environ.get("FORCE_RESNAP", "").strip().lower() in ("1", "true", "yes", "on")
if FORCE_RESNAP:
    print(f"⚠ FORCE_RESNAP ON ({RUN_SCOPE}) — 현재 범위의 당일 스냅샷/hist를 재확정합니다.")

def is_kr_ticker(t):
    return t.endswith(".KS") or t.endswith(".KQ")


def market_inputs_for(ticker, level, ret20):
    """그 날짜의 시장 입력 3종을 만든다.

    index.html histRow()의 규칙과 동일해야 한다:
      · 한국 종목에는 QQQ 국면을 적용하지 않는다(항상 neutral / 약세 아님).
      · market_weak는 weak·caution 두 국면에서만 True.
      · market_ret20(QQQ 20일 수익률)은 한국 종목에도 그대로 붙는다(rs20/주도주 보정용).
    """
    if is_kr_ticker(ticker or ""):
        return "neutral", False, ret20
    lv = level or None
    return lv, bool(lv in ("weak", "caution")), ret20


def market_hist_map(mkt):
    """QQQ 일자별 국면/20일수익률. market_state()의 hist는 [date, level, below_ma20, ret20]."""
    out = {}
    for x in (mkt or {}).get("hist") or []:
        if isinstance(x, (list, tuple)) and len(x) >= 4 and x[0]:
            out[str(x[0])] = (x[1], x[3])
    return out


def market_event_map(events):
    """날짜별 주요 미국 시장 이벤트. 표시/히스토리 경고 전용이며 점수에는 절대 사용하지 않는다."""
    out = {}
    for ev in events or []:
        d = str((ev or {}).get("date") or "")
        if not d:
            continue
        item = {"type": str((ev or {}).get("type") or "시장 이벤트"),
                "name": str((ev or {}).get("name") or (ev or {}).get("type") or "시장 이벤트")}
        bucket = out.setdefault(d, [])
        if not any(x.get("type") == item["type"] and x.get("name") == item["name"] for x in bucket):
            bucket.append(item)
    return out


# ── 이벤트 캘린더 ─────────────────────────────────────────────
# yfinance 1.x Calendars API를 우선 사용한다. 이벤트 조회가 실패해도
# 가격/기술신호 생성은 계속 진행한다(fail-open).
MAJOR_EVENT_KEYS = {
    "FOMC": ["fomc", "federal open market"],
    "CPI": ["consumer price index", "cpi"],
    "PCE": ["personal consumption", "pce price"],
    "고용": ["nonfarm", "non-farm", "employment situation", "unemployment rate", "jobless claims", "jolts"],
}

def _event_date(v):
    """pandas/yfinance datetime을 YYYY-MM-DD로 안전하게 정규화."""
    try:
        ts = pd.Timestamp(v)
        if pd.isna(ts): return None
        # timezone이 있으면 미국 이벤트는 뉴욕 현지일 기준으로 본다.
        if ts.tzinfo is not None:
            ts = ts.tz_convert("America/New_York")
        return ts.strftime("%Y-%m-%d")
    except Exception:
        s = str(v or "")
        m = __import__("re").search(r"\d{4}-\d{2}-\d{2}", s)
        return m.group(0) if m else None

def _timing_code(v):
    s = str(v or "").strip().lower()
    if "before" in s or s == "bmo": return "BMO"
    if "after" in s or s == "amc": return "AMC"
    return "UNKNOWN"

# NYSE 실제 거래 세션. 주말뿐 아니라 미국 휴장일까지 한 곳에서 처리한다.
_US_CAL = xcals.get_calendar("XNYS")
_NY = ZoneInfo("America/New_York")
_KST = ZoneInfo("Asia/Seoul")

def _session_str(v):
    try:
        return pd.Timestamp(v).strftime("%Y-%m-%d")
    except Exception:
        return None

def _as_us_session(day, direction="next"):
    try:
        return _US_CAL.date_to_session(pd.Timestamp(day), direction=direction)
    except Exception:
        return None

def previous_us_session(day):
    s = _as_us_session(day, "next")
    if s is None: return None
    try: return _session_str(_US_CAL.previous_session(s))
    except Exception: return None

def next_us_session(day):
    s = _as_us_session(day, "next")
    if s is None: return None
    try: return _session_str(_US_CAL.next_session(s))
    except Exception: return None

def current_or_next_us_session(now):
    """현재 시각에 실제로 진입 가능한 NYSE 세션. 장 마감 전이면 당일, 마감 뒤면 다음 세션."""
    try:
        ny = now.astimezone(_NY) if now.tzinfo else now.replace(tzinfo=_KST).astimezone(_NY)
        d = pd.Timestamp(ny.date())
        if _US_CAL.is_session(d):
            close = _US_CAL.session_close(d).to_pydatetime().astimezone(_NY)
            if ny <= close:
                return d.strftime("%Y-%m-%d")
            return _session_str(_US_CAL.next_session(d))
        return _session_str(_US_CAL.date_to_session(d, direction="next"))
    except Exception:
        return None

def us_session_open_kst(day):
    try:
        s = _as_us_session(day, "next")
        if s is None: return ""
        dt = _US_CAL.session_open(s).to_pydatetime().astimezone(_KST)
        return dt.strftime("%Y-%m-%d %H:%M KST")
    except Exception:
        return ""

def _earnings_windows(ev):
    """실적 이벤트의 신규진입 금지 세션과 실제 가격 오염 종가를 분리한다."""
    if not ev or not ev.get("date"):
        return [], [], None, None
    event_session = _session_str(_as_us_session(ev["date"], "next"))
    if not event_session:
        return [], [], None, None
    pre = previous_us_session(event_session)
    post = next_us_session(event_session)
    post2 = next_us_session(post) if post else None
    timing = ev.get("timing") or "UNKNOWN"
    if timing == "BMO":
        blocked = [pre, event_session]
        affected = [event_session]
        release = post
    elif timing == "AMC":
        blocked = [pre, event_session, post]
        affected = [post]
        release = post2
    else:
        # 시간 미확인은 BMO/AMC 양쪽 가능성을 모두 덮는다.
        blocked = [pre, event_session, post]
        affected = [event_session, post]
        release = post2
    return [x for x in blocked if x], [x for x in affected if x], release, event_session

def _timing_from_timestamp(v):
    try:
        ts = pd.Timestamp(v)
        if ts.tzinfo is None:
            return "UNKNOWN"
        ny = ts.tz_convert("America/New_York")
        h = ny.hour + ny.minute / 60
        if h < 12: return "BMO"
        if h >= 15: return "AMC"
    except Exception:
        pass
    return "UNKNOWN"

def _fallback_earnings(ticker, start_day, end_day, existing=None):
    """전체 캘린더 누락/UNKNOWN만 티커별 API로 보강한다."""
    t = yf.Ticker(ticker)
    target = (existing or {}).get("date")
    # 1) earnings_dates: 인덱스 timestamp에서 BMO/AMC까지 복원 가능하면 우선 사용.
    try:
        df = t.get_earnings_dates(limit=12)
        if df is not None and not df.empty:
            rows=[]
            for idx, _ in df.iterrows():
                d = _event_date(idx)
                if not d: continue
                try:
                    dd = datetime.strptime(d, "%Y-%m-%d").date()
                except Exception:
                    continue
                if start_day <= dd <= end_day:
                    rows.append((d, _timing_from_timestamp(idx), str(idx)))
            if rows:
                if target:
                    match = next((x for x in rows if x[0] == target), None)
                    if match:
                        return {"date": target, "timing": match[1], "timing_raw": match[2],
                                "source": "Yahoo/yfinance Ticker.get_earnings_dates"}
                else:
                    today = datetime.now(_NY).date()
                    rows.sort(key=lambda x: abs((datetime.strptime(x[0], "%Y-%m-%d").date()-today).days))
                    d,timing,raw = rows[0]
                    return {"date": d, "timing": timing, "timing_raw": raw,
                            "source": "Yahoo/yfinance Ticker.get_earnings_dates"}
    except Exception:
        pass
    # 2) calendar: 날짜만이라도 복구한다. timing은 모르면 UNKNOWN 유지.
    try:
        cal = t.get_calendar() if hasattr(t, "get_calendar") else t.calendar
        vals = (cal or {}).get("Earnings Date") if isinstance(cal, dict) else None
        if vals is not None and not isinstance(vals, (list,tuple,pd.Index,np.ndarray)):
            vals = [vals]
        cand=[]
        for v in vals or []:
            d=_event_date(v)
            if not d: continue
            dd=datetime.strptime(d, "%Y-%m-%d").date()
            if start_day <= dd <= end_day: cand.append(d)
        if cand:
            if target and target in cand: d=target
            elif target: return None
            else: d=sorted(cand)[0]
            return {"date":d, "timing":"UNKNOWN", "timing_raw":"", "source":"Yahoo/yfinance Ticker.calendar"}
    except Exception:
        pass
    return None

def fetch_event_calendars(now_kst, wanted_tickers):
    """관심종목 어닝 + 주요 거시 이벤트. 전체 페이지를 끝까지 읽고 누락/UNKNOWN만 티커별 fallback."""
    out_earn, out_market = {}, []
    status = {"source":"yfinance Calendars + ticker fallback", "ok":False, "quality_version":2,
              "earnings_rows":0,
              "matched":0, "time_confirmed":0, "time_unknown":0, "fallback_resolved":0,
              "fallback_attempted":0, "missing":0, "eligible":0, "skipped_no_earnings":0,
              "matched_events":[], "economic_events_ok":False, "economic_events_error":"", "error":""}
    ny_now = now_kst.astimezone(_NY) if now_kst.tzinfo else now_kst.replace(tzinfo=_KST).astimezone(_NY)
    today_ny = ny_now.date()
    start_day = today_ny - timedelta(days=16)
    end_day   = today_ny + timedelta(days=7)
    # wanted에는 애초에 미국 종목만 담긴다(한국 종목은 여기서 제외).
    # 따라서 NO_EARNINGS_TICKERS의 한국 ETF 2종목은 이 집계에 등장하지 않는다.
    # 실적 조회 '대상'은 그중 ETF·지수를 뺀 나머지다. 누락 집계는 반드시 이 기준으로 센다.
    wanted = {t.upper() for t in wanted_tickers if not is_kr_ticker(t)}
    no_earn_here = wanted & NO_EARNINGS_TICKERS          # 실제로 스킵되는 미국 ETF·지수만
    earnings_eligible = wanted - NO_EARNINGS_TICKERS     # 실적 일정이 존재할 수 있는 종목
    cal = None
    if hasattr(yf, "Calendars"):
        try:
            cal = yf.Calendars(start=start_day, end=end_day)
            off=0; seen_pages=set()
            while True:
                df = cal.get_earnings_calendar(start=start_day, end=end_day, filter_most_active=False,
                                               limit=100, offset=off, force=True)
                if df is None or df.empty: break
                fp=(len(df), str(df.index[0]) if len(df) else "", str(df.index[-1]) if len(df) else "")
                if fp in seen_pages:
                    print(f"어닝 캘린더: 반복 페이지 감지(offset={off}) — 안전 종료")
                    break
                seen_pages.add(fp)
                status["earnings_rows"] += len(df)
                for tk, r in df.iterrows():
                    tk = str(tk).upper()
                    if tk not in wanted: continue
                    dt = _event_date(r.get("Event Start Date")); timing_raw = r.get("Timing")
                    if not dt: continue
                    out_earn[tk] = {"date":dt, "timing":_timing_code(timing_raw),
                                    "timing_raw":str(timing_raw or ""), "source":"Yahoo/yfinance Calendars"}
                if len(df) < 100: break
                off += 100
            status["ok"] = True
        except Exception as e:
            status["error"] = f"{type(e).__name__}: {e}"
            print("어닝 캘린더 조회 실패:", status["error"])
    else:
        status["error"] = "현재 yfinance에 Calendars API 없음 — 티커별 fallback만 사용"
        print("이벤트 캘린더:", status["error"])

    # 전체 캘린더에서 빠졌거나 timing UNKNOWN인 관심종목만 보강.
    fallback_targets=[tk for tk in sorted(earnings_eligible)
                      if tk not in out_earn or out_earn[tk].get("timing")=="UNKNOWN"]
    if no_earn_here:
        print(f"어닝 캘린더: 실적 조회 비대상 ETF·지수 {len(no_earn_here)}종목 "
              f"({', '.join(sorted(no_earn_here))}) — 누락 집계에서도 제외")
    for tk in fallback_targets:
        status["fallback_attempted"] += 1
        before=out_earn.get(tk)
        fb=_fallback_earnings(tk, start_day, end_day, before)
        if not fb: continue
        if before:
            # 기존 날짜는 유지하고, 같은 날짜에서 timing이 확인된 경우에만 개선한다.
            if fb.get("date")==before.get("date") and before.get("timing")=="UNKNOWN" and fb.get("timing")!="UNKNOWN":
                out_earn[tk]=fb; status["fallback_resolved"] += 1
        else:
            out_earn[tk]=fb; status["fallback_resolved"] += 1

    # 검증용 메타데이터를 이벤트 자체에 붙인다.
    for ev in out_earn.values():
        blocked, affected, release, event_session = _earnings_windows(ev)
        ev["blocked_signal_dates"] = blocked
        ev["affected_close_dates"] = affected
        ev["event_session"] = event_session or ""
        ev["release_session"] = release or ""
        ev["release_open_kst"] = us_session_open_kst(release) if release else ""

    status["matched"] = len(out_earn)
    status["time_confirmed"] = sum(1 for ev in out_earn.values() if ev.get("timing") in ("BMO","AMC"))
    status["time_unknown"] = sum(1 for ev in out_earn.values() if ev.get("timing") == "UNKNOWN")
    # 누락은 '조회 대상' 대비로만 센다. ETF·지수를 분모에 넣으면 실제보다 부풀어 보인다.
    status["eligible"] = len(earnings_eligible)
    status["skipped_no_earnings"] = len(no_earn_here)
    status["missing"] = max(0, len(earnings_eligible) - len(earnings_eligible & set(out_earn)))
    status["matched_events"] = [{"ticker":tk,"date":ev.get("date"),"timing":ev.get("timing"),"source":ev.get("source")}
                                for tk,ev in sorted(out_earn.items())]
    print(f"어닝 캘린더: 조회 {status['earnings_rows']}행 · 매칭 {status['matched']} · "
          f"시간확인 {status['time_confirmed']} · 시간미확인 {status['time_unknown']} · "
          f"fallback 해결 {status['fallback_resolved']} · "
          f"누락 {status['missing']}/{status['eligible']} · 비대상 ETF {status['skipped_no_earnings']}")

    try:
        # yfinance 경제 캘린더는 한 페이지 최대 100건이므로 끝까지 읽는다.
        # 한 페이지만 읽으면 이벤트가 많은 기간의 뒷부분 경고가 조용히 누락될 수 있다.
        economic_called = False
        if cal is not None:
            off=0; seen_pages=set()
            while True:
                edf = cal.get_economic_events_calendar(start=start_day, end=end_day,
                                                       limit=100, offset=off, force=True)
                economic_called = True
                if edf is None or edf.empty: break
                fp=(len(edf), str(edf.index[0]) if len(edf) else "", str(edf.index[-1]) if len(edf) else "")
                if fp in seen_pages:
                    print(f"경제 이벤트: 반복 페이지 감지(offset={off}) — 안전 종료")
                    break
                seen_pages.add(fp)
                for ev, r in edf.iterrows():
                    name = str(ev); low = name.lower()
                    label = next((k for k, words in MAJOR_EVENT_KEYS.items() if any(w in low for w in words)), None)
                    if not label: continue
                    dt = _event_date(r.get("Event Time")); region = str(r.get("Region") or "")
                    if region and region.upper() not in ("US", "USA"): continue
                    if dt: out_market.append({"type":label, "name":name, "date":dt})
                if len(edf) < 100: break
                off += 100
        # 호출 자체가 정상 완료되면 빈 결과도 정상으로 본다. 실패한 날에는 과거 hist에 '이벤트 없음'을 고정하지 않는다.
        status["economic_events_ok"] = economic_called
    except Exception as e:
        status["economic_events_error"] = f"{type(e).__name__}: {e}"
        print("경제 이벤트 캘린더 조회 실패:", e)

    uniq=[]; seen=set()
    for x in sorted(out_market, key=lambda z:(z.get("date") or "", z.get("name") or "")):
        k=(x.get("date"),x.get("name"))
        if k not in seen: seen.add(k); uniq.append(x)
    return out_earn, uniq, status

def attach_earnings_holds(results, earnings, now_kst):
    """저장 종가가 아니라 현재 시점의 실제 진입 NYSE 세션으로 실적 보류를 판정한다."""
    entry_session = current_or_next_us_session(now_kst)
    for r in results:
        ev = earnings.get(r.get("ticker"))
        r["earnings"] = ev
        r["earnings_hold"] = False
        r["earnings_hold_reason"] = ""
        r["earnings_hold_date"] = ""
        r["earnings_release_date"] = ""
        r["earnings_release_open_kst"] = ""
        if not ev: continue

        blocked = list(ev.get("blocked_signal_dates") or [])
        affected = list(ev.get("affected_close_dates") or [])
        release = ev.get("release_session") or ""
        if not blocked:
            blocked, affected, release, event_session = _earnings_windows(ev)
            ev["blocked_signal_dates"] = blocked
            ev["affected_close_dates"] = affected
            ev["event_session"] = event_session or ""
            ev["release_session"] = release or ""
            ev["release_open_kst"] = us_session_open_kst(release) if release else ""

        if entry_session and entry_session in blocked:
            timing = ev.get("timing") or "UNKNOWN"
            if timing == "BMO": reason="장전 실적 영향권 — 신규 진입 보류"
            elif timing == "AMC": reason="장후 실적 영향권 — 신규 진입 보류"
            else: reason="실적 시간 미확인 — 장전·장후 양쪽 가능성 보수적 보류"
            r["earnings_hold"] = True
            r["earnings_hold_reason"] = reason
            r["earnings_hold_date"] = blocked[0] if blocked else entry_session
            r["earnings_release_date"] = release
            r["earnings_release_open_kst"] = ev.get("release_open_kst") or us_session_open_kst(release)
    return results

def freeze_validation_earnings_dates(results, prev_rows):
    """신뢰도 검증용 실적 제외 날짜를 append-only로 고정한다.

    과거에 이미 제외했던 날짜는 Yahoo 실적 메타데이터가 나중에 바뀌어도 제거하지 않는다.
    반대로 새로 실제 신호/성과 날짜가 된 실적 영향권은 이후 실행에서 추가한다.
    미래 날짜를 미리 얼리지 않아 일정 정정이 과거 검증을 불필요하게 오염시키지 않게 한다.
    """
    for r in results:
        tk = r.get("ticker")
        prev = (prev_rows or {}).get(tk) or {}
        old_b = set(prev.get("validation_blocked_dates") or [])
        old_a = set(prev.get("validation_affected_dates") or [])

        ev = r.get("earnings") or {}
        cur_b = set(ev.get("blocked_signal_dates") or [])
        cur_a = set(ev.get("affected_close_dates") or [])
        if ev.get("date") and not (cur_b or cur_a):
            b, a, _, _ = _earnings_windows(ev)
            cur_b.update(b); cur_a.update(a)

        # 이 종목 데이터가 실제로 도달한 날짜까지만 확정한다.
        cutoff = str(r.get("last_date") or "")
        if cutoff:
            cur_b = {d for d in cur_b if d and str(d) <= cutoff}
            cur_a = {d for d in cur_a if d and str(d) <= cutoff}
        else:
            cur_b, cur_a = set(), set()

        r["validation_blocked_dates"] = sorted(old_b | cur_b)
        r["validation_affected_dates"] = sorted(old_a | cur_a)
    return results

def load_previous():
    """직전 signals.json을 티커별로 읽어둔다. 없으면 빈 dict."""
    try:
        with open("signals.json", encoding="utf-8") as f:
            old = json.load(f)
        return {r["ticker"]: r for r in old.get("stocks", []) if r.get("ticker")}, old
    except Exception:
        return {}, None

# ── 관심종목 (카테고리: {티커: 이름}) ──────────────────────
WATCHLIST = {
    "경기방어": {"KO":"코카콜라", "BRK-B":"버크셔해서웨이B"},
    "헬스케어": {"LLY":"일라이릴리", "UNH":"유나이티드헬스", "HIMS":"힘스앤허스",
                 "RXL":"헬스케어 2x", "HQH":"헬스케어 펀드"},
    "금융": {"JPM":"JP모건", "MA":"마스터카드", "UYG":"금융 2x", "FXO":"금융 ETF"},
    "산업재": {"CAT":"캐터필러", "AIT":"어플라이드인더스트리얼"},
    "반도체·메모리":  {"MU":"마이크론", "SNDK":"샌디스크", "STX":"씨게이트"},
    "반도체·파운드리":{"TSM":"TSMC", "INTC":"인텔"},
    "반도체·GPU":     {"NVDA":"엔비디아", "AMD":"AMD", "SOXL":"반도체 3x",
                       "ALAB":"아스테라랩스", "AMAT":"어플라이드머티어리얼즈",
                       "DELL":"델", "AVGO":"브로드컴", "MRVL":"마벨테크놀로지"},
    "데이터센터":    {"APLD":"어플라이드디지털", "NBIS":"네비우스", "CRWV":"코어위브", "IREN":"아이렌"},
    "소프트웨어":    {"MSFT":"마이크로소프트", "NOW":"서비스나우", "PLTR":"팔란티어", "CRWD":"크라우드스트라이크", "SNOW":"스노우플레이크", "DDOG":"데이터독", "NET":"클라우드플레어"},
    "광통신":        {"AAOI":"어플라이드옵토", "GLW":"코닝", "LITE":"루멘텀", "CIEN":"시에나", "POET":"포엣테크놀로지",
                      "CRDO":"크레도테크놀로지", "COHR":"코히런트"},
    "전기차·자율주행":{"TSLA":"테슬라", "PONY":"포니AI"},
    "에너지·원전":   {"CEG":"컨스텔레이션에너지", "VST":"비스트라", "BE":"블룸에너지",
                      "SMR":"뉴스케일파워", "OKLO":"오클로"},
    "원자재·금":     {"GDXU":"금광주 3x", "GLD":"금 현물 ETF"},
    "원자재·유가":   {"XOM":"엑슨모빌", "USO":"미국 원유 ETF"},
    "원자재·농산물": {"DBA":"농산물 ETF"},
    "원자재·희토류": {"MP":"MP머티리얼즈", "UUUU":"에너지퓨얼스"},
    "암호화폐":      {"ETHU":"이더리움 2x ETF", "MSTR":"마이크로스트래티지", "BMNR":"비트마인", "COIN":"코인베이스"},
    "양자컴퓨팅":    {"IONQ":"아이온큐", "QBTS":"디웨이브", "INFQ":"인플렉션", "RGTI":"리게티컴퓨팅"},
    "우주·UAM":      {"RKLB":"로켓랩", "SPCX":"스페이스X", "PL":"플래닛랩스",
                      "JOBY":"조비에비에이션", "RDW":"레드와이어"},
    "방산·드론":     {"RCAT":"레드캣홀딩스", "LMT":"록히드마틴", "LHX":"L3해리스", "AXON":"액손"},
    "주택":          {"ITB":"미국주택건설 ETF", "NAIL":"주택건설 3x"},
    "빅테크":        {"META":"메타", "AAPL":"애플", "GOOGL":"구글", "AMZN":"아마존"},
    "국장":          {"069500.KS":"코스피", "229200.KS":"코스닥"},
}

# ── 레버리지(배수) 상품 — 대시보드에서 ❗ 경고 표시 ──────────
LEVERAGED = {"SOXL", "GDXU", "NAIL", "ETHU", "UYG", "RXL"}

# ── 기업 실적발표가 없는 상품(ETF·지수) ────────────────────
# 실적 조회를 시도해도 404만 돌아오고 응답 대기시간만 낭비한다.
# 신호 산식·frozen history·검증 표본에는 아무 영향이 없다. 조회를 건너뛸 뿐이다.
NO_EARNINGS_TICKERS = {
    "SOXL", "GDXU", "GLD", "USO", "ITB", "NAIL", "ETHU",
    "UYG", "FXO", "RXL", "HQH", "DBA",
    "069500.KS", "229200.KS",
}

# ── 시장 필터 기준 지수 (QQQ만) ────────────────────────────
MARKET_TICKER = "QQQ"

def safe(x, nd=2):
    try:
        if x is None or (isinstance(x, float) and (np.isnan(x) or np.isinf(x))): return None
        return round(float(x), nd)
    except Exception: return None

def wilder_rsi(close, period=14):
    d = close.diff(); g = d.clip(lower=0); l = -d.clip(upper=0)
    ag = g.ewm(alpha=1/period, min_periods=period).mean()
    al = l.ewm(alpha=1/period, min_periods=period).mean()
    return 100 - 100/(1+ag/al)

def cross_state(fast, slow, lookback=2):
    diff = (fast - slow).dropna()
    if len(diff) < lookback + 1: return "none"
    now = diff.iloc[-1]
    for i in range(2, lookback + 2):
        prev = diff.iloc[-i]
        if now > 0 and prev <= 0: return "golden"
        if now < 0 and prev >= 0: return "dead"
    return "none"

def ichimoku(high, low):
    """일목균형표 5선. 표준 파라미터(9/26/52, 선행 26)를 그대로 쓴다.

    현재는 '기록만' 한다 — 시장 국면 판정에는 아직 반영하지 않는다.
    기존 4단계(20·60일선 기준)와 어느 쪽이 나은지 데이터로 비교한 뒤 결정하기 위한 것이다.
    구름은 26일 전에 만들어진 값이므로 shift(26)이 들어간다.
    """
    conv = (high.rolling(9).max() + low.rolling(9).min()) / 2      # 전환선
    base = (high.rolling(26).max() + low.rolling(26).min()) / 2    # 기준선
    span_a = ((conv + base) / 2).shift(26)                          # 선행스팬1
    span_b = ((high.rolling(52).max() + low.rolling(52).min()) / 2).shift(26)  # 선행스팬2
    return conv, base, span_a, span_b


def ichimoku_state(px, conv, base, span_a, span_b):
    """그 시점의 일목 상태. 값이 없으면 전부 None을 돌려준다."""
    vals = [px, conv, base, span_a, span_b]
    if any(v is None or (isinstance(v, float) and (np.isnan(v) or np.isinf(v))) for v in vals):
        return {"pos": None, "tk": None, "cloud": None, "level": None,
                "conv": None, "base": None, "span_a": None, "span_b": None}
    top, bot = max(span_a, span_b), min(span_a, span_b)
    pos = "above" if px > top else ("below" if px < bot else "in")   # 구름 위/안/아래
    tk = "bull" if conv > base else ("bear" if conv < base else "flat")  # 전환선 vs 기준선
    cloud = "bull" if span_a > span_b else "bear"                    # 양운/음운
    if pos == "above" and tk == "bull" and cloud == "bull":  level = "strong"
    elif pos == "below":                                      level = "weak"
    elif pos == "in":                                         level = "caution"
    else:                                                     level = "neutral"
    return {"pos": pos, "tk": tk, "cloud": cloud, "level": level,
            "conv": safe(conv, 2), "base": safe(base, 2),
            "span_a": safe(span_a, 2), "span_b": safe(span_b, 2)}


def market_state(ticker):
    """시장 국면을 3단계로 판정: strong / neutral / weak"""
    try:
        # 일목 선행스팬2는 52봉 고가/저가를 26봉 앞으로 밀어 쓰므로 최소 78봉이 필요하다.
        # 6개월(약 126봉)로는 30일치 이력을 만들 여유가 빠듯해 1년으로 늘린다.
        df = yf.Ticker(ticker).history(period="1y", interval="1d", auto_adjust=False)
        df = drop_unclosed(df, ticker)
        df = drop_invalid_price_rows(df, ticker)
        if df is None or len(df) < 61:
            return {"ticker": ticker, "level": "neutral", "below_ma20": False, "detail": "데이터 부족"}
        c = df["Close"]
        m20s, m60s = c.rolling(20).mean(), c.rolling(60).mean()
        ic_conv, ic_base, ic_a, ic_b = ichimoku(df["High"], df["Low"])

        def ichi_at(i):
            def g(sr):
                try:
                    v = float(sr.iloc[i])
                    return None if (np.isnan(v) or np.isinf(v)) else v
                except Exception:
                    return None
            return ichimoku_state(g(c), g(ic_conv), g(ic_base), g(ic_a), g(ic_b))

        def judge(i):
            """i=-1 오늘, i=-2 직전 거래일. 같은 기준으로 판정한다."""
            p = float(c.iloc[i]); a20 = float(m20s.iloc[i]); a60 = float(m60s.iloc[i])
            rising = a20 > float(m20s.iloc[i-5])
            if p >= a20 and a20 >= a60 and rising: return "strong"
            if p < a20 and p < a60:               return "weak"
            if p < a20:                           return "caution"
            return "neutral"

        px = float(c.iloc[-1])
        ma20 = float(m20s.iloc[-1])
        ma60 = float(m60s.iloc[-1])
        ma20_prev = float(m20s.iloc[-6])                      # 5일 전 20일선(기울기)
        rising20 = ma20 > ma20_prev
        ret20 = (float(c.iloc[-1]) / float(c.iloc[-21]) - 1) * 100 if len(c) >= 21 else None
        prev_level = judge(-2) if len(c) >= 66 else None
        prev_below = bool(float(c.iloc[-2]) < float(m20s.iloc[-2])) if len(c) >= 66 else None
        mhist = []
        if len(c) >= 66 + HIST_DAYS:
            for j in range(-HIST_DAYS, 0):
                r20 = (float(c.iloc[j]) / float(c.iloc[j-20]) - 1) * 100 if len(c) >= abs(j)+20 else None
                ij = ichi_at(j)
                # 기존 4칸 뒤에 덧붙인다. 화면은 앞 4칸만 읽으므로 영향이 없다.
                mhist.append([c.index[j].strftime("%Y-%m-%d"), judge(j),
                              bool(float(c.iloc[j]) < float(m20s.iloc[j])), safe(r20),
                              ij["level"], ij["pos"], ij["tk"], ij["cloud"]])

        if px >= ma20 and ma20 >= ma60 and rising20:
            level, detail = "strong", "20일선 위 · 20일선 상승 · 60일선 위"
        elif px < ma20 and px < ma60:
            level, detail = "weak", "20·60일선 모두 아래"
        elif px < ma20:
            level, detail = "caution", "20일선 아래(60일선은 유지)"
        else:
            level, detail = "neutral", "20일선 위이나 추세 약함"
        ic_now = ichi_at(-1)
        # 일목은 아직 판정에 쓰지 않는다. level은 그대로 20·60일선 기준이고,
        # ichimoku는 나중에 비교 검증하기 위해 값만 남긴다.
        return {"ticker": ticker, "level": level, "below_ma20": bool(px < ma20),
                "detail": detail, "price": safe(px), "ma20": safe(ma20), "ma60": safe(ma60),
                "ret20": safe(ret20),
                "prev": ({"level": prev_level, "below_ma20": prev_below} if prev_level else None),
                "ichimoku": ic_now, "ichi_applied": False,
                "hist": mhist}
    except Exception as e:
        print("시장 판정 실패:", e)
        return {"ticker": ticker, "level": "neutral", "below_ma20": False, "detail": "조회 실패"}

def drop_unclosed(df, ticker):
    """아직 장 마감 전이면 '오늘 봉'(미완성)을 잘라내 항상 확정 종가만 쓴다."""
    if df is None or len(df) == 0:
        return df
    is_kr = ticker.endswith(".KS") or ticker.endswith(".KQ")
    tz = ZoneInfo("Asia/Seoul") if is_kr else ZoneInfo("America/New_York")
    close_t = dtime(15, 30) if is_kr else dtime(16, 0)     # 한국 15:30, 미국 16:00(현지)
    now = datetime.now(tz)
    last_date = df.index[-1].date()
    if last_date < now.date():
        return df                                          # 과거 봉 → 이미 확정
    if now.time() >= close_t:
        return df                                          # 오늘 봉이지만 마감 지남 → 확정
    return df.iloc[:-1]                                    # 장중 → 미완성 봉 제거

def drop_invalid_price_rows(df, ticker):
    """Yahoo가 OHLC는 비우고 Volume만 주는 비정상 일봉을 제거한다.

    이런 행을 통과시키면 날짜는 최신인데 가격·이평·점수가 빈 카드가 될 수 있다.
    정상 행의 값은 건드리지 않고, Close·High·Low가 유한하고 양수인 행만 남긴다.
    """
    if df is None or len(df) == 0:
        return df
    required = [c for c in ("Close", "High", "Low") if c in df.columns]
    if len(required) != 3:
        raise ValueError(f"{ticker} OHLC 열 누락")
    mask = pd.Series(True, index=df.index)
    for c in required:
        vals = pd.to_numeric(df[c], errors="coerce")
        mask &= vals.notna() & np.isfinite(vals) & (vals > 0)
    removed = int((~mask).sum())
    if removed:
        print(f"데이터 품질 보호: {ticker} 비정상 OHLC {removed}행 제외")
    return df.loc[mask].copy()

def analyze(ticker, name, category):
    df = yf.Ticker(ticker).history(period=PERIOD, interval="1d", auto_adjust=False)
    df = drop_unclosed(df, ticker)
    df = drop_invalid_price_rows(df, ticker)
    if df is None or len(df) < 30: raise ValueError("데이터 부족")
    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]
    ma5 = close.rolling(5).mean()
    ma10 = close.rolling(10).mean()
    ma20 = close.rolling(20).mean()
    ma50 = close.rolling(50).mean()
    ma60 = close.rolling(60).mean()
    # 미너비니 ①②(150·200일선 정배열 / 200일선 상승세) 검증용.
    # PERIOD가 1년(약 252거래일)이라 ma200은 초반 구간이 NaN이다 — safe()가 None으로 내보낸다.
    ma120 = close.rolling(120).mean()
    ma200 = close.rolling(200).mean()
    rsi = wilder_rsi(close)
    ema12, ema26 = close.ewm(span=12, adjust=False).mean(), close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26; sig = macd.ewm(span=9, adjust=False).mean()
    std = close.rolling(20).std(); upper, lower = ma20 + 2*std, ma20 - 2*std
    ll, hh = low.rolling(14).min(), high.rolling(14).max()
    k = ((close - ll) / (hh - ll) * 100).rolling(3).mean(); d = k.rolling(3).mean()
    vavg = vol.rolling(20).mean().shift(1)
    tr = pd.concat([(high-low), (high-close.shift()).abs(), (low-close.shift()).abs()], axis=1).max(axis=1)
    atr_s = tr.rolling(14).mean()
    is_kr = ticker.endswith(".KS") or ticker.endswith(".KQ")
    nd = 0 if is_kr else 2

    def snap(i):
        """i=-1이면 오늘(확정 종가), i=-2면 직전 거래일. 같은 로직을 그대로 재사용한다."""
        end = len(close) + i + 1              # 해당 시점까지만 보이도록 자르는 위치
        c_i = close.iloc[i]
        bw = (upper.iloc[i] - lower.iloc[i])
        bb = ((c_i - lower.iloc[i]) / bw * 100) if bw and bw > 0 else None
        va = vavg.iloc[i]
        vr = (vol.iloc[i] / va) if va and va > 0 else None
        chg = (c_i / close.iloc[i-1] - 1) * 100 if len(close) >= abs(i)+1 else None
        atr_pct = (atr_s.iloc[i] / c_i * 100) if c_i else None
        h52 = high.iloc[:end].max()           # 그 시점까지의 52주 고가
        pfh = (c_i / h52 - 1) * 100 if h52 else None
        l52 = low.iloc[:end].min()            # 그 시점까지의 52주 저가 (미너비니 ③ 검증용)
        pfl = (c_i / l52 - 1) * 100 if l52 else None
        # 미너비니 ②: "200일선이 최소 1개월 이상 상승세". 20거래일 전 대비 기울기로 본다.
        m200_now = ma200.iloc[i]
        m200_ago = ma200.iloc[i-20] if abs(i-20) <= len(ma200) else None
        ma200_slope = ((m200_now / m200_ago - 1) * 100) \
            if (m200_now is not None and m200_ago is not None
                and not np.isnan(m200_now) and not np.isnan(m200_ago) and m200_ago > 0) else None

        # ── 진입 위치(Positioning) 판단용 파생값 ────────────────────
        # 점수 계산은 하지 않는다. 산식은 index.html 한 곳에만 둔다.
        m20_now, m20_ago = ma20.iloc[i], ma20.iloc[i-5]
        ma20_slope = ((m20_now / m20_ago - 1) * 100) if (m20_ago and m20_ago > 0) else None
        chg_s = close.pct_change() * 100
        run5_max = chg_s.iloc[end-5:end].max() if end >= 5 else None       # 최근 5일 중 최대 일간 상승률
        run3_sum = ((c_i / close.iloc[i-3] - 1) * 100) if end >= 4 else None  # 최근 3일 누적 등락률
        rng = ((high - low) / close * 100)
        range3  = rng.iloc[end-3:end].mean()  if end >= 3  else None       # 최근 3일 평균 변동폭
        range10 = rng.iloc[end-13:end-3].mean() if end >= 13 else None     # 그 직전 10일 평균 변동폭
        v3 = vol.iloc[end-3:end].mean() if end >= 3 else None
        vol3_ratio = (v3 / va) if (v3 is not None and va and va > 0) else None

        # ── 지지·저항 (표시용 + 자리 보정용) ────────────────────────
        # 52주 고가 하나만 저항으로 쓰면 MSTR $100에 저항 $414 같은 값이 나온다.
        # 지금 당장 부딪힐 가격(단기)과 그다음 매물대(중기)를 나눠서 계산한다.
        def hi_above(n_):
            if end < n_: return None
            h = float(high.iloc[end-n_:end].max())
            return h if h > c_i * 1.005 else None      # 이미 뚫었으면 저항이 아니다
        def lo_below(n_):
            if end < n_: return None
            l = float(low.iloc[end-n_:end].min())
            return l if l < c_i * 0.995 else None
        res_short = hi_above(20)          # 최근 20거래일 고점 중 현재가 위
        res_mid   = hi_above(60)          # 최근 60거래일 고점
        sup_short = lo_below(20)
        sup_mid   = lo_below(60)
        ret20 = ((c_i / close.iloc[i-20] - 1) * 100) if end >= 21 else None

        return {
            "price": safe(c_i, nd), "change_1d": safe(chg),
            "volume": int(vol.iloc[i]) if not np.isnan(vol.iloc[i]) else None,
            "vol_ratio": safe(vr),
            "ma5": safe(ma5.iloc[i], nd), "ma10": safe(ma10.iloc[i], nd),
            "ma20": safe(ma20.iloc[i], nd), "ma50": safe(ma50.iloc[i], nd), "ma60": safe(ma60.iloc[i], nd),
            "prev_price": safe(close.iloc[i-1], nd) if abs(i) < len(close) else None,
            "prev_ma5": safe(ma5.iloc[i-1], nd) if abs(i) < len(ma5) else None,
            "prev_ma20": safe(ma20.iloc[i-1], nd) if abs(i) < len(ma20) else None,
            "rsi": safe(rsi.iloc[i]),
            "macd": safe(macd.iloc[i], 4), "macd_signal": safe(sig.iloc[i], 4),
            "macd_hist": safe(macd.iloc[i] - sig.iloc[i], 4),   # index.html이 읽는 이름
            "macd_zero": "above" if macd.iloc[i] > 0 else "below",
            "macd_cross": cross_state(macd.iloc[:end], sig.iloc[:end]),
            "bb_pos": safe(bb),
            "stoch_k": safe(k.iloc[i]), "stoch_d": safe(d.iloc[i]),
            "stoch_cross": cross_state(k.iloc[:end], d.iloc[:end]),
            "atr_pct": safe(atr_pct),
            "pct_from_high": safe(pfh),
            "near_high": bool(pfh is not None and pfh >= -5),
            "ma20_slope": safe(ma20_slope), "run5_max": safe(run5_max), "run3_sum": safe(run3_sum),
            "res_short": safe(res_short, nd), "res_mid": safe(res_mid, nd),
            "sup_short": safe(sup_short, nd), "sup_mid": safe(sup_mid, nd),
            "high_52w": safe(h52, nd), "ret20": safe(ret20),
            "low_52w": safe(l52, nd), "pct_from_low": safe(pfl),
            "ma120": safe(ma120.iloc[i], nd), "ma200": safe(ma200.iloc[i], nd),
            "ma200_slope": safe(ma200_slope),
            "range3": safe(range3), "range10": safe(range10), "vol3_ratio": safe(vol3_ratio),
            "last_date": df.index[i].strftime("%Y-%m-%d"),
        }

    row = snap(-1)
    # 최근 HIST_DAYS 거래일 지표(오래된 것 → 최신 순). 마지막 항목이 오늘이다.
    # 점수 계산은 index.html의 evaluate() 한 곳에서만 한다.
    # (산식을 파이썬으로 옮기면 두 곳이 반드시 어긋난다)
    hist = []
    if ticker == "SPCX":
        # SPCX는 신규상장 종목이라 장기 이력(61+10일) 조건을 적용하지 않는다.
        # analyze()가 통과한 데이터 안에서 최근 최대 10거래일만 내려준다.
        spcx_days = min(HIST_DAYS, len(close))
        for j in range(-spcx_days, 0):
            d_ = snap(j)
            d_["date"] = d_.pop("last_date")
            hist.append([d_.get(k) for k in HIST_FIELDS])
    elif len(close) >= 61 + HIST_DAYS:
        for j in range(-HIST_DAYS, 0):
            d_ = snap(j)
            d_["date"] = d_.pop("last_date")
            hist.append([d_.get(k) for k in HIST_FIELDS])
    row["hist"] = hist
    row.update({
        "ticker": ticker, "name": name, "category": category,
        "currency": "KRW" if is_kr else "USD",
        "leveraged": ticker in LEVERAGED,
    })
    return row

# evaluate() 재현에 필요한 입력값을 모두 보관한다. 점수 자체는 저장하지 않는다.
SNAPSHOT_FIELDS = [
    "ticker", "last_date", "price", "change_1d", "volume", "vol_ratio",
    "ma5", "ma10", "ma20", "ma50", "ma60", "rsi",
    "macd_hist", "macd_cross", "macd_zero",
    "bb_pos", "stoch_k", "stoch_d", "stoch_cross",
    "near_high", "pct_from_high", "atr_pct",
    "ma20_slope", "run5_max", "run3_sum", "range3", "range10", "vol3_ratio",
    "res_short", "ret20", "rs20",
    "prev_change_1d", "prev_vol_ratio", "prev_macd_hist", "prev_price", "prev_ma5", "prev_ma20",
    "market_level", "market_weak", "market_ret20", "market_events",
    "low_52w", "pct_from_low", "ma120", "ma200", "ma200_slope",
]

def _storage_row(r, mkt):
    out={k:r.get(k) for k in SNAPSHOT_FIELDS}
    # 행이 자기 시장 입력을 갖고 있으면 그것이 우선이다(그날 고정값).
    if out.get("market_ret20") is None:
        out["market_ret20"] = mkt.get("ret20") if isinstance(mkt, dict) else None
    hist=r.get("hist") or []
    if len(hist)>=2:
        prev=hist[-2]; idx={k:i for i,k in enumerate(HIST_FIELDS)}
        def hv(k):
            i=idx.get(k); return prev[i] if i is not None and i < len(prev) else None
        out.update({"prev_change_1d":hv("change_1d"), "prev_vol_ratio":hv("vol_ratio"),
                    "prev_macd_hist":hv("macd_hist"), "prev_price":hv("price"),
                    "prev_ma5":hv("ma5"), "prev_ma20":hv("ma20")})
    return out

def save_history(results, mkt, now_kst):
    """미국/한국 일자별 원장을 분리해 append-only로 저장한다.

    scope=all은 두 시장을 모두 재수집하므로 US·KR snapshot을 모두 남겨야 한다.
    한 쪽만 남기면 업로드 충돌 후 반대 시장의 당일 원장을 복원할 근거가 사라진다.
    """
    regions = ["us", "kr"] if RUN_SCOPE == "all" else ["kr" if RUN_SCOPE == "kr" else "us"]
    for region in regions:
        selected = [r for r in results if is_kr_ticker(r.get("ticker", "")) == (region == "kr")]
        dates = [r.get("last_date") for r in selected if r.get("last_date")]
        if not dates:
            print(f"이력 저장 건너뜀: {region} last_date 없음")
            continue
        day = max(dates)
        folder=f"history/{region}"; os.makedirs(folder, exist_ok=True)
        slim=[_storage_row(r,mkt) for r in selected]
        path=f"{folder}/{day}.json"; existed=os.path.exists(path)
        payload={
            "date":day, "market":"KR" if region=="kr" else "US",
            "saved_at":now_kst.strftime("%Y-%m-%d %H:%M")+" KST",
            # FORCE_RESNAP으로 기존 파일을 교체한 경우 원장 안에 흔적을 남긴다.
            "resnapped": bool(existed and FORCE_RESNAP),
            "market_state":{k:mkt.get(k) for k in ("ticker","level","below_ma20","ret20") if k in mkt},
            "stocks":slim,
        }
        if existed and not FORCE_RESNAP:
            # 자동/일반 수동 재실행은 최초 확정 스냅샷을 보존한다.
            print(f"이력 고정 유지: {path} — 기존 파일 보존")
            continue
        if existed and FORCE_RESNAP:
            print(f"⚠ 재촬영: {path} — 기존 당일 스냅샷을 명시적으로 교체")
        with open(path,"w",encoding="utf-8") as f:
            json.dump(payload,f,ensure_ascii=False)
        size=os.path.getsize(path)/1024
        print(f"이력 저장: {path} ({size:.0f}KB, {len(slim)}종목) — 최초 스냅샷 고정")


def hist_row_from_current(r):
    """오늘 카드에 쓰는 top-level 값을 hist 형식으로 직렬화한다.
    HIST_FIELDS의 첫 필드는 "date"인데 top-level row는 "last_date"를 쓰므로 그 항목만 보정한다.
    (analyze()는 hist를 만들 때만 d_["date"] = d_.pop("last_date")로 개명한다)
    나머지 필드는 이름이 동일하다. rs20은 main()에서 freeze 호출 전에 top-level에 채워진다."""
    return [
        r.get("last_date") if f == "date" else r.get(f)
        for f in HIST_FIELDS
    ]


def freeze_signal_hist(results, prev_rows, mkt=None, market_events=None, market_events_ok=False):
    """
    공개된 종가 스냅샷을 append-only로 고정한다.

    - 이미 존재하는 과거 ticker+date hist는 재계산값으로 덮지 않는다.
    - 같은 last_date가 이미 history/{us|kr}/YYYY-MM-DD.json에 있으면
      top-level 현재 카드 입력값도 그 최초 스냅샷으로 복원한다.
    - 기존 positional hist에 빠져 있던 열(atr_pct·시장 입력)은 Yahoo 재계산값이 아니라
      immutable 일자별 history snapshot에서 우선 보강하고, 없으면 그 날짜의
      QQQ hist 값으로 한 번만 채운 뒤 그대로 고정한다. 이미 값이 있으면 건드리지 않는다.
    - 새 거래일만 오늘 계산값을 1회 append한다.
    """
    idx = {k:i for i,k in enumerate(HIST_FIELDS)}
    date_i = idx["date"]
    last_i = len(HIST_FIELDS) - 1
    qmap = market_hist_map(mkt)
    emap = market_event_map(market_events)
    snap_cache = {}

    def day_snapshot(ticker, day):
        if not ticker or not day:
            return None
        region = "kr" if is_kr_ticker(ticker) else "us"
        key = (region, day)
        if key not in snap_cache:
            path = f"history/{region}/{day}.json"
            rows = {}
            try:
                with open(path, encoding="utf-8") as f:
                    p = json.load(f)
                rows = {x.get("ticker"): x for x in (p.get("stocks") or []) if x.get("ticker")}
            except Exception:
                rows = {}
            snap_cache[key] = rows
        return snap_cache[key].get(ticker)

    backfilled = {k: 0 for k in HIST_BACKFILL_FIELDS}

    def backfill(h, tk, d):
        """빈 칸만 채운다. 채우는 순서는 '고정된 것 → 덜 고정된 것' 순.
           1) 그날 확정된 immutable 일자별 snapshot
           2) 이번 실행의 QQQ 일자별 hist (최초 1회만, 이후 실행에서는 이미 값이 있어 건드리지 않음)
           이미 값이 있으면 어느 경우에도 덮지 않는다."""
        # 패딩은 backfill이 실제로 쓰는 마지막 칸(market_events)까지만 한다.
        # HIST_FIELDS 전체 길이(last_i)로 늘리면 확장 필드가 붙을 때마다 모든
        # 옛 행의 배열 길이가 바뀌어 append-only 검사가 '변조'로 판정한다
        # (2026-08-16 실제 실패: GDXU 2026-07-06 — 33칸 행이 35칸으로 패딩됨).
        # 옛 행은 바이트 단위로 동일하게 유지하고, 확장 필드는 새 거래일 행에만 존재한다.
        pad_i = max(idx[f] for f in HIST_BACKFILL_FIELDS)
        while len(h) <= pad_i:
            h.append(None)
        snap = None
        for f in HIST_BACKFILL_FIELDS:
            i = idx[f]
            if h[i] is not None:
                continue
            if snap is None:
                snap = day_snapshot(tk, d) or {}
            if snap.get(f) is not None:
                h[i] = snap.get(f)
                backfilled[f] += 1
        # snapshot에도 없던 시장 입력만 그날 QQQ 값으로 채우고 이후 영구 고정한다.
        ilv, iwk, irt = idx["market_level"], idx["market_weak"], idx["market_ret20"]
        if h[ilv] is None or h[irt] is None:
            q = qmap.get(str(d))
            if q:
                lv, wk, rt = market_inputs_for(tk, q[0], q[1])
                if h[ilv] is None: h[ilv] = lv;  backfilled["market_level"] += 1
                if h[iwk] is None: h[iwk] = wk;  backfilled["market_weak"] += 1
                if h[irt] is None: h[irt] = rt;  backfilled["market_ret20"] += 1
        # 시장 이벤트는 점수 입력이 아니라 표시용 메타데이터다.
        # 경제캘린더 조회가 정상 완료된 실행에서만 빈 배열까지 고정해, 조회 실패를 '이벤트 없음'으로 오인하지 않는다.
        iev = idx.get("market_events")
        if iev is not None and h[iev] is None and market_events_ok:
            h[iev] = emap.get(str(d), [])
            backfilled["market_events"] += 1
        return h

    frozen_count = 0
    appended_count = 0
    restored_current = 0
    gap_filled = 0
    restored_from_hist = 0

    for r in results:
        tk = r.get("ticker")
        last_date = str(r.get("last_date") or "")
        prev = (prev_rows or {}).get(tk) or {}

        # 수동 재촬영 때는 기존 "오늘" snapshot으로 top-level 값을 되돌리지 않는다.
        # 방금 수집한 값을 그대로 사용해 당일 snapshot/hist를 새로 확정한다.
        fixed_today = None if FORCE_RESNAP else day_snapshot(tk, last_date)
        if fixed_today:
            for k in SNAPSHOT_FIELDS:
                if k in ("ticker", "last_date"):
                    continue
                if k in fixed_today:
                    r[k] = fixed_today.get(k)
                else:
                    # 확장 필드(low_52w 등)가 옛 snapshot에 없으면 top-level도 비운다.
                    # 이미 고정된 날의 카드는 원장과 완전히 일치해야 하고,
                    # 새 필드는 다음 '새 거래일'부터 쌓인다.
                    r[k] = None
            restored_current += 1
        elif not FORCE_RESNAP and last_date:
            # 일자별 snapshot 커밋이 실패했더라도 signals.json의 기존 hist는
            # 사용자가 이미 본 최초 frozen 원장이다. 같은 거래일을 다시 받았을 때
            # Yahoo 사후 정정값으로 카드만 바뀌지 않도록 top-level을 원장으로 복원한다.
            frozen_rows = [h for h in (prev.get("hist") or [])
                           if isinstance(h, list) and len(h) > date_i and h[date_i]]
            frozen_rows.sort(key=lambda h: str(h[date_i]))
            pos = next((i for i,h in enumerate(frozen_rows) if str(h[date_i]) == last_date), None)
            if pos is not None:
                today_h = frozen_rows[pos]
                for f, i in idx.items():
                    if f == "date":
                        continue
                    # 고정 행이 짧으면(확장 전 행) 그 필드는 top-level도 비운다 —
                    # 위 snapshot 복원과 같은 이유. 안 비우면 top/hist 불일치로
                    # validate_signals.py가 막는다 (2026-08-16 실제 실패 사례: KO low_52w).
                    r[f] = today_h[i] if i < len(today_h) else None
                if pos > 0:
                    prev_h = frozen_rows[pos-1]
                    for dst, src in (("prev_change_1d","change_1d"), ("prev_vol_ratio","vol_ratio"),
                                     ("prev_macd_hist","macd_hist"), ("prev_price","price"),
                                     ("prev_ma5","ma5"), ("prev_ma20","ma20")):
                        i = idx[src]
                        r[dst] = prev_h[i] if i < len(prev_h) else None
                restored_current += 1
                restored_from_hist += 1

        old_hist = []
        seen = set()
        for h0 in (prev.get("hist") or []):
            if not isinstance(h0, list) or len(h0) <= date_i:
                continue
            h = list(h0)
            d = str(h[date_i] or "")
            if not d or d in seen:
                continue
            active_market = (
                RUN_SCOPE == "all" or
                (RUN_SCOPE == "kr" and is_kr_ticker(tk)) or
                (RUN_SCOPE == "us" and not is_kr_ticker(tk))
            )
            # 수동 재촬영 시 현재 갱신 범위의 당일 기존 행만 버린다.
            # 반대 시장 carry 행은 절대 건드리지 않는다.
            if FORCE_RESNAP and active_market and last_date and d == last_date:
                continue
            old_hist.append(backfill(h, tk, d))
            seen.add(d)

        if old_hist:
            frozen_count += len(old_hist)

        # 신규 종목은 직전 signals.json에 frozen hist가 없으므로 analyze()가 계산한
        # 과거 행으로 최대 9일을 먼저 채운다. 오늘 행은 아래에서 반드시 top-level 값으로 만든다.
        # 이미 오늘 한 줄만 저장된 신규 종목도 immutable 일자 snapshot에 티커가 없으면 1회 복구한다.
        bootstrap_hist = (
            not prev or
            (len(old_hist) <= 1 and last_date and day_snapshot(tk, last_date) is None)
        )
        if bootstrap_hist:
            seed=[]
            seed_seen=set()
            for h0 in (r.get("hist") or []):
                if not isinstance(h0,list) or len(h0)<=date_i:
                    continue
                h=list(h0)
                d=str(h[date_i] or "")
                # 오늘 값은 analyze() 재계산값이 아니라 실제 카드 top-level 값으로 고정한다.
                if not d or d == last_date or d in seen or d in seed_seen:
                    continue
                seed.append(backfill(h, tk, d)); seed_seen.add(d)
            old_hist=(seed + old_hist)[-HIST_DAYS:]
            seen.update(seed_seen)

        # 오늘 hist는 analyze()가 따로 계산한 snap(-1)을 믿지 않고,
        # 화면 카드에 쓰는 top-level current row를 그대로 직렬화해서 넣는다.
        # 사용자가 실제로 본 신호와 그날 frozen hist가 갈라지지 않게 하기 위한 것이다.
        # 과거 행은 건드리지 않는다 — 여기서 만드는 건 오늘 한 줄뿐이다.
        current_hist_row = hist_row_from_current(r) if last_date else None

        if last_date and last_date not in seen and current_hist_row is not None:
            old_hist.append(current_hist_row)
            seen.add(last_date)
            appended_count += 1

        # 창이 아직 HIST_DAYS에 못 미치면 analyze()가 방금 가져온 이력에서
        # '한 번도 저장된 적 없는 과거 날짜'만 끌어와 채운다.
        # 이미 있는 행은 절대 건드리지 않으므로 고정 원칙은 그대로다.
        # (HIST_DAYS를 올린 직후 창이 즉시 넓어지게 하는 장치다)
        if len(old_hist) < HIST_DAYS:
            for h0 in (r.get("hist") or []):
                if not isinstance(h0, list) or len(h0) <= date_i:
                    continue
                d = str(h0[date_i] or "")
                if not d or d in seen or (last_date and d > last_date):
                    continue
                old_hist.append(backfill(list(h0), tk, d))
                seen.add(d)
                gap_filled += 1

        old_hist.sort(key=lambda h: str(h[date_i] or ""))
        r["hist"] = old_hist[-HIST_DAYS:]

    bf = " · ".join(f"{k} {v}행" for k, v in backfilled.items() if v)
    print(
        f"hist 고정: 기존 {frozen_count}행 유지 · 새 거래일 {appended_count}행 추가 · "
        f"과거 빈칸 보충 {gap_filled}행 · 현재카드 frozen 복원 {restored_current}종목"
        + (f"(hist fallback {restored_from_hist}종목)" if restored_from_hist else "")
        + (f" · 보강 {bf}" if bf else " · 보강 없음")
    )


def attach_historical_rs20(results, mkt):
    """각 과거 날짜의 종목 ret20에서 같은 날짜 QQQ ret20을 빼 rs20을 채운다.

    이미 값이 있는 행은 건드리지 않는다. rs20은 그 날짜의 시장 대비 상대강도라
    나중에 QQQ가 재계산됐다고 과거 값을 다시 쓰면 과거 신호가 바뀐다.
    """
    qmap = market_hist_map(mkt)
    if not qmap: return
    idx={k:i for i,k in enumerate(HIST_FIELDS)}
    idate, iret, irs = idx.get("date"), idx.get("ret20"), idx.get("rs20")
    if None in (idate,iret,irs): return
    for r in results:
        for h in r.get("hist") or []:
            if len(h) <= max(idate,iret,irs): continue
            if h[irs] is not None: continue          # 이미 고정된 값은 유지
            rr = h[iret]; qr = (qmap.get(str(h[idate])) or (None, None))[1]
            if rr is not None and qr is not None:
                h[irs] = safe(float(rr)-float(qr))


def attach_historical_market(results, mkt):
    """각 hist 행에 '그 날짜의' 시장 입력을 붙인다. 이미 있으면 덮지 않는다.

    이 값이 행 안에 없으면 화면이 매번 최신 QQQ 계산으로 과거를 다시 채점하게 되고,
    산식을 하나도 안 건드렸는데 어제 신호 등급이 오늘 바뀌는 일이 생긴다.
    """
    qmap = market_hist_map(mkt)
    idx={k:i for i,k in enumerate(HIST_FIELDS)}
    idate = idx["date"]; ilv = idx["market_level"]; iwk = idx["market_weak"]; irt = idx["market_ret20"]
    need = max(idate, ilv, iwk, irt)
    for r in results:
        tk = r.get("ticker")
        for h in r.get("hist") or []:
            while len(h) <= need: h.append(None)
            if h[ilv] is not None and h[irt] is not None: continue   # 이미 고정됨
            q = qmap.get(str(h[idate]))
            if not q: continue
            lv, wk, rt = market_inputs_for(tk, q[0], q[1])
            if h[ilv] is None: h[ilv] = lv
            if h[iwk] is None: h[iwk] = wk
            if h[irt] is None: h[irt] = rt

def prepare_qqq_card(row, market_events, market_events_ok):
    """QQQ를 일반 evaluate() 입력 모양으로 만들되 자기 자신에 QQQ 시장필터는 적용하지 않는다. 랭킹에는 넣지 않는다."""
    if not row:
        return None
    emap = market_event_map(market_events)
    row["market_level"] = "neutral"
    row["market_weak"] = False
    row["market_ret20"] = row.get("ret20")
    row["rs20"] = 0.0 if row.get("ret20") is not None else None
    if market_events_ok:
        row["market_events"] = emap.get(str(row.get("last_date") or ""), [])
    else:
        row["market_events"] = row.get("market_events") or []

    idx = {k:i for i,k in enumerate(HIST_FIELDS)}
    last_i = len(HIST_FIELDS)-1
    for h in row.get("hist") or []:
        while len(h) <= last_i:
            h.append(None)
        d = str(h[idx["date"]] or "")
        rt = h[idx["ret20"]]
        h[idx["rs20"]] = 0.0 if rt is not None else None
        h[idx["market_level"]] = "neutral"
        h[idx["market_weak"]] = False
        h[idx["market_ret20"]] = rt
        if market_events_ok:
            h[idx["market_events"]] = emap.get(d, [])
    return row


def main():
    prev_rows, prev_payload = load_previous()
    print(f"실행 범위: {RUN_SCOPE} · 직전 데이터 {len(prev_rows)}종목 보유")

    # QQQ 시장 국면은 어느 실행이든 새로 본다 (요청 1건)
    mkt = market_state(MARKET_TICKER)
    mkt_level = mkt["level"]
    print(f"시장({MARKET_TICKER}) 국면: {mkt_level} — {mkt['detail']}")

    # 한국장 실행에서도 미국 가격은 유지하되 실적 일정만 다시 조회해 장 시작 전 변경을 잡는다.
    all_tickers = [tk for items in WATCHLIST.values() for tk in items]
    now_kst = datetime.now(_KST)
    earnings_map, market_events, calendar_status = fetch_event_calendars(now_kst, all_tickers)
    event_map_now = market_event_map(market_events)
    market_events_ok = bool((calendar_status or {}).get("economic_events_ok"))

    # QQQ는 시장 기준 미니카드 전용. 일반 종목과 같은 기술입력을 계산하지만 랭킹 유니버스에는 넣지 않는다.
    # 자기 자신에게 QQQ 시장필터/상대강도 보정을 다시 먹이지 않도록 neutral·rs20=0으로 고정한다.
    qqq_card = None
    try:
        qqq_card = prepare_qqq_card(analyze(MARKET_TICKER, "나스닥100 ETF", "시장 기준"), market_events, market_events_ok)
        print(f"QQQ 기준카드: {qqq_card.get('last_date')} 종가 · 랭킹 제외")
    except Exception as e:
        print("QQQ 기준카드 생성 실패:", e)

    # SPY 보조 시장카드 — 나스닥(QQQ)만으로는 시장 전반을 못 본다는 지적에 따라 추가.
    # 국면 판정에는 아직 쓰지 않는다(판정은 여전히 QQQ 기준). 데이터를 쌓아
    # QQQ·SPY 겸용 국면이 나은지 tools/qqq-lab.js 방식으로 비교한 뒤 결정한다.
    spy_card = None
    try:
        spy_card = prepare_qqq_card(analyze("SPY", "S&P500 ETF", "시장 기준"), market_events, market_events_ok)
        print(f"SPY 보조카드: {spy_card.get('last_date')} 종가 · 랭킹 제외")
    except Exception as e:
        print("SPY 보조카드 생성 실패:", e)

    # 조회 실패/누락 시 직전 이벤트를 보조적으로 유지한다.
    prev_earn = {r.get("ticker"): r.get("earnings") for r in (prev_payload or {}).get("stocks", []) if r.get("earnings")}
    for tk, ev in prev_earn.items():
        if tk not in earnings_map and ev:
            earnings_map[tk]=ev

    results, failed, carried, fetch_carried = [], [], 0, []
    for cat, items in WATCHLIST.items():
        for tk, nm in items.items():
            is_kr = is_kr_ticker(tk)

            # 스코프 밖 종목은 건드리지 않고 직전 값을 그대로 넘긴다.
            # kr 실행: 미국 carry / us 실행: 한국 carry / all 실행: 전 종목 재수집
            if (RUN_SCOPE == "kr" and not is_kr) or (RUN_SCOPE == "us" and is_kr):
                if tk in prev_rows:
                    kept = dict(prev_rows[tk])
                    kept["name"], kept["category"] = nm, cat  # 가격은 유지, 메타데이터는 현재 WATCHLIST에 맞춘다.
                    results.append(kept); carried += 1; print("KEEP", tk)
                else:
                    failed.append(f"{tk} ({nm}) — 직전 데이터 없음")
                continue

            try:
                row = analyze(tk, nm, cat)
                # 시장 필터: 미국 종목이고 QQQ가 약세면 표시 (대시보드가 -0.5 반영)
                # 이 값은 오늘 hist 행에도 그대로 실려 그날의 시장 입력으로 고정된다.
                lv, wk, rt = market_inputs_for(tk, mkt_level, mkt.get("ret20") if isinstance(mkt, dict) else None)
                row["market_level"] = lv
                row["market_weak"] = wk
                row["market_ret20"] = rt
                results.append(row); print("OK", tk)
            except Exception as e:
                # 실패해도 대시보드에서 사라지지 않게 직전 값을 유지한다
                if tk in prev_rows:
                    kept = dict(prev_rows[tk])
                    kept["name"], kept["category"] = nm, cat
                    kept["data_status"] = "carried_after_fetch_error"
                    kept["data_status_message"] = str(e)
                    results.append(kept); carried += 1
                    fetch_carried.append(tk)
                    print("SKIP→KEEP", tk, e)
                else:
                    failed.append(f"{tk} ({nm}) — {e}"); print("SKIP", tk, e)
    # 현재 카드에도 그 종가 날짜의 시장 이벤트를 붙인다. 경고 표시 전용이며 점수에는 사용하지 않는다.
    if market_events_ok:
        for r in results:
            r["market_events"] = event_map_now.get(str(r.get("last_date") or ""), [])

    # 실적 보류 판정은 가격 수집이 끝난 뒤 한 번만 적용한다.
    attach_earnings_holds(results, earnings_map, now_kst)
    # 신뢰도 검증의 실적 제외일도 과거 기록처럼 append-only로 고정한다.
    freeze_validation_earnings_dates(results, prev_rows)
    print(f"수집 {len(results)}종목 (직전 값 유지 {carried}건) · 실패 {len(failed)}건 · 실적보류 {sum(1 for r in results if r.get('earnings_hold'))}건")

    # ── 섹터별 평균 등락률 (핫/약세 섹터 표시용) ──
    sector_moves = {}
    for r in results:
        c = r.get("category") or "기타"
        v = r.get("change_1d")
        if v is None: continue
        sector_moves.setdefault(c, []).append(v)
    sectors = [{"name": k, "avg_change": safe(sum(v)/len(v)), "count": len(v)}
               for k, v in sector_moves.items() if v]
    sectors.sort(key=lambda x: (x["avg_change"] if x["avg_change"] is not None else -999), reverse=True)

    # 상대강도(20일): 종목 20일 수익률 - QQQ 20일 수익률. 미너비니식 RS의 단순 근사치.
    mret20 = None
    try:
        mret20 = mkt.get("ret20") if isinstance(mkt, dict) else None
    except Exception:
        mret20 = None
    for _s in results:
        if _s.get("ret20") is not None and mret20 is not None:
            _s["rs20"] = round(float(_s["ret20"]) - float(mret20), 2)
        else:
            _s["rs20"] = None
    attach_historical_rs20(results, mkt)
    # 각 hist 행에 '그 날짜의' 시장 입력을 붙인다. 이미 붙어 있으면 그대로 둔다.
    attach_historical_market(results, mkt)

    # 신뢰도용 최근 hist는 여기서 고정한다.
    # 과거 날짜는 직전 signals.json 값을 그대로 유지하고 새 거래일만 append한다.
    freeze_signal_hist(results, prev_rows, mkt, market_events, market_events_ok)

    payload = {
        "generated_at": now_kst.strftime("%Y-%m-%d %H:%M") + " KST",
        "generation_status": {
            "scope": RUN_SCOPE,
            "force_resnap": FORCE_RESNAP,
            "carried_after_fetch_error": sorted(fetch_carried),
        },
        "hist_fields": HIST_FIELDS,
        "note": "yfinance 무료 데이터 · 15~20분 지연 · 참고용",
        "market": mkt,
        "qqq_card": qqq_card,
        "spy_card": spy_card,
        "market_events": market_events,
        "calendar_status": calendar_status,
        "sectors": sectors,
        "stocks": results, "failed": failed,
    }
    with open("signals.json", "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    # ── 신호 이력 보관 (나중에 백테스트/승률 분석용) ──────────────
    # 규칙 세 가지:
    #  1) 파일은 "거래일 하루에 하나". 같은 날 몇 번을 돌려도 덮어써서 중복이 안 쌓인다.
    #  2) 점수는 저장하지 않는다. 산식이 바뀌면 옛 점수는 죽은 값이 되지만,
    #     지표만 남겨두면 나중에 어떤 산식으로도 다시 채점할 수 있다.
    #  3) 이름·카테고리·통화 같은 표시용 값은 빼고, evaluate() 재현에 필요한 입력만 남긴다.
    # 브라우저는 이 폴더를 절대 읽지 않는다. 채점 스크립트 전용이다.
    save_history(results, mkt, now_kst)

    print(f"저장 완료: 성공 {len(results)} / 실패 {len(failed)}")

if __name__ == "__main__":
    main()
