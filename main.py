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
import sys
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
               "ma120", "ma200", "ma200_slope",
               # 2026-08-19 확장: 갭(Gap) 매매 검증용. 시가를 저장하지 않아
               # '갭이 있었는지'조차 잴 수 없었다. 꼬리 확장이라 옛 행은 짧을 뿐이다.
               #   gap_pct    당일 시가 갭 % (시가/전일종가-1)
               #   gap20_pct  최근 20봉 안의 가장 최근 '유효 갭상승'(>=2%) 크기
               #   gap20_ago  그 갭이 몇 봉 전인가 (0=오늘)
               #   gap20_vol  그 갭일의 거래량비 — 돌파갭(대량) vs 보통갭(무덤덤) 구분용
               #   gap20_fill 그 갭을 얼마나 메웠나 0~100% (0=미메움, 100=완전 메움)
               "gap_pct", "gap20_pct", "gap20_ago", "gap20_vol", "gap20_fill",
               # 2026-08-22 확장: 주봉·월봉 상위 시간대 맥락 (사용자 요청).
               # "일봉 타이밍은 상위 시간대 추세 안에서만 유효하다"를 검증하려면
               # 그날 시점의 주봉·월봉 상태가 저장돼 있어야 한다. 전부 **완성된**
               # 봉만 쓴다 — 진행 중인 주/월을 쓰면 미래를 보는 셈이 된다.
               #   w_rsi        완성된 마지막 주봉 기준 RSI(14)
               #   w_ma20_pos   현재가가 20주선 대비 몇 % 위/아래인가
               #   w_streak     연속 주봉 방향 (+n 양봉 n주, -n 음봉 n주)
               #   m_ma6_pos    현재가가 6개월선 대비 몇 % 위/아래인가
               #   m_streak     연속 월봉 방향
               "w_rsi", "w_ma20_pos", "w_streak", "m_ma6_pos", "m_streak",
               # 2026-08-25 확장: 그날의 나스닥 변동성지수(VXN).
               # 189일 실측에서 **VXN>=25인 날 강한매수가 62/67/72/73%**로 그날
               # 기준선(51/52/52/52%)을 +11~+21%p 넘었다. 그런데 VXN 과거값이
               # 원장에 없어 화면·검증 어디에서도 쓸 수 없었다(backtest raw.json의
               # macro.vxn 에만 있었다). market_level과 같은 '그날의 시장 입력'이므로
               # 같은 방식으로 얼려 둔다 — 야후가 소급 수정해도 과거 판정이 안 흔들린다.
               "market_vxn"]

# freeze 단계에서 옛 행에 뒤늦게 채워 넣는 열. 이미 값이 있으면 절대 덮지 않는다.
HIST_BACKFILL_FIELDS = ["atr_pct", "market_level", "market_weak", "market_ret20", "market_events", "market_vxn"]

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
# 시장 전체를 흔드는 '예정된' 발표만 잡는다. 캘린더에 없는 비정기 충격
# (연준 인사 지명·돌발 발언 등)은 원리상 여기서 못 잡는다 — 화면에도 그렇게 적는다.
MAJOR_EVENT_KEYS = {
    "FOMC": ["fomc", "federal open market"],
    "금리": ["fed funds", "interest rate decision", "rate decision", "fed interest",
             "fomc minutes", "powell", "fed chair", "humphrey-hawkins", "monetary policy report"],
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
                    # 하루 어긋나는 경우를 버리지 않는다. 전체 캘린더의 'Event Start Date'는
                    # tz가 없는 UTC로 오는 일이 있어(장마감 후 발표 = UTC 다음날) 뉴욕 현지일과
                    # 하루 밀린다. 그 탓에 정확 매칭이 전부 실패해 timing 보강이 0건이었다
                    # (2026-08-22 화면: 시간미확인 18 · fallback 해결 0).
                    # get_earnings_dates 쪽은 tz가 붙은 뉴욕 시각이라 더 정확하므로,
                    # ±1일 후보가 있으면 그쪽 날짜와 timing을 함께 채택한다.
                    try:
                        td = datetime.strptime(target, "%Y-%m-%d").date()
                        near = [x for x in rows
                                if abs((datetime.strptime(x[0], "%Y-%m-%d").date() - td).days) <= 1
                                and x[1] != "UNKNOWN"]
                    except Exception:
                        near = []
                    if near:
                        d, timing, raw = near[0]
                        return {"date": d, "timing": timing, "timing_raw": raw,
                                "source": "Yahoo/yfinance Ticker.get_earnings_dates(±1일 보정)"}
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
    # 전방 21일. +7일이던 것을 늘렸다 — 7일이면 '실적 임박' 표시가 D-7 안쪽에서만
    # 붙어서 발표 2~3주 전 흐름을 보여 줄 수 없었다(2026-08-22 사용자 지적).
    # 먼 이벤트는 _earnings_windows()가 blocked 날짜를 오늘에 걸지 않으므로
    # 창을 넓혀도 등급 보류가 미리 걸리지는 않는다.
    end_day   = today_ny + timedelta(days=21)
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
            # timing이 UNKNOWN이던 것을 확정지어 줄 때만 교체한다. 날짜가 하루 어긋난
            # 경우도 포함한다 — tz가 붙은 get_earnings_dates 쪽이 더 정확하기 때문이다.
            if before.get("timing")=="UNKNOWN" and fb.get("timing")!="UNKNOWN":
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
    "경기방어": {"KO":"코카콜라", "BRK-B":"버크셔해서웨이B", "SCHD":"미국 배당 ETF"},
    "헬스케어": {"LLY":"일라이릴리", "UNH":"유나이티드헬스", "HQH":"헬스케어 펀드"},
    "금융": {"JPM":"JP모건", "MA":"마스터카드", "V":"비자", "UYG":"금융 2x", "FXO":"금융 ETF"},
    "산업재": {"CAT":"캐터필러", "AIT":"어플라이드인더스트리얼", "DUSL":"산업재 3x"},
    "반도체·메모리":  {"MU":"마이크론", "SNDK":"샌디스크", "STX":"씨게이트", "SKHY":"SK하이닉스"},
    "반도체·파운드리":{"TSM":"TSMC", "INTC":"인텔"},
    "반도체·GPU":     {"NVDA":"엔비디아", "AMD":"AMD", "SOXL":"반도체 3x",
                       "ALAB":"아스테라랩스", "AMAT":"어플라이드머티어리얼즈",
                       "DELL":"델", "AVGO":"브로드컴", "MRVL":"마벨테크놀로지", "ASML":"ASML", "CBRS":"세레브라스"},
    "데이터센터":    {"APLD":"어플라이드디지털", "NBIS":"네비우스", "CRWV":"코어위브", "IREN":"아이렌",},
    "소프트웨어":    {"MSFT":"마이크로소프트", "NOW":"서비스나우", "PLTR":"팔란티어", "CRWD":"크라우드스트라이크", "SNOW":"스노우플레이크", "DDOG":"데이터독", "NET":"클라우드플레어"},
    "광통신":        {"AAOI":"어플라이드옵토", "GLW":"코닝", "LITE":"루멘텀", "CIEN":"시에나", "POET":"포엣테크놀로지",
                      "CRDO":"크레도테크놀로지", "COHR":"코히런트"},
    "전기차·자율주행":{"TSLA":"테슬라"},
    "에너지·원전":   {"CEG":"컨스텔레이션에너지", "BE":"블룸에너지"},
    "원자재·금":     {"GDXU":"금광주 3x", "GLD":"금 현물 ETF"},
    "원자재·유가":   {"XOM":"엑슨모빌", "USO":"미국 원유 ETF"},
    "원자재·농산물": {"DBA":"농산물 ETF"},
    "원자재·희토류": {"MP":"MP머티리얼즈", "UUUU":"에너지퓨얼스"},
    "암호화폐":      {"BMNR":"비트마인", "CIFR":"사이퍼마이닝", "WULF":"테라울프", "HUT":"허트8"},
    # 리츠는 금리에 먼저 반응해서 헬스케어·경기방어와 움직임이 다르다 — 섹터를 따로 둔다.
    "리츠":          {"WELL":"웰타워(헬스케어 리츠)"},
    "양자컴퓨팅":    {"IONQ":"아이온큐", "QBTS":"디웨이브", "INFQ":"인플렉션", "RGTI":"리게티컴퓨팅"},
    "우주·UAM":      {"RKLB":"로켓랩", "SPCX":"스페이스X", "PL":"플래닛랩스",
                      "JOBY":"조비에비에이션", "RDW":"레드와이어"},
    "방산·드론":     {"LMT":"록히드마틴", "AXON":"액손"},
    "주택":          {"ITB":"미국주택건설 ETF", "NAIL":"주택건설 3x"},
    "빅테크":        {"META":"메타", "AAPL":"애플", "GOOGL":"구글", "AMZN":"아마존"},
    "국장":          {"069500.KS":"코스피", "229200.KS":"코스닥"},
}

# ── 관심종목에서 빠진 티커 — 과거 frozen snapshot(history/*.json)에는 남아 있다 ──
# validate_signals.py가 옛 snapshot을 검증할 때 이 티커들까지 '알 수 없는 티커'로
# 오탐하지 않도록 허용한다. 현재 실행 결과(rows)에는 여전히 나오면 안 되므로
# validate_current의 WATCHLIST 일치 검사는 그대로 이 티커들을 막는다.
# 관심종목에서 뺀 티커 — 과거 frozen snapshot에는 남아 있어 검증기가 허용해야 한다.
# HXSCL(SK하이닉스 OTC ADR)은 야후가 시세를 안 줘서 실패했고, 국장 원주 000660.KS는
# 거래일이 미국장과 어긋나 사용자가 뺐다. 둘 다 재시도 금지 — SK하이닉스는
# 나스닥 직상장 티커 SKHY로 간다(아래 PENDING_TICKERS).
RETIRED_TICKERS = {"MRNA", "PFE", 
    "MCD", "CURE", "RXL", "000660.KS", "HXSCL", "ANET",
    "VST", "SMR", "OKLO", "RCAT", "LHX", "HIMS", "PONY",
    "CRCL", "RDDT", "LUNR", "COIN", "MSTR", "ETHU",
}

# ── 상장 대기 티커 — 야후에 있지만 일봉이 아직 30개가 안 된 신규 상장 ──────
# analyze()는 지표 계산에 최소 30봉을 요구한다(len(df) < 30 -> "데이터 부족").
# 신규 상장은 직전 데이터도 없어서 그대로 누락되고, 검증기가 "WATCHLIST 불일치"로
# 워크플로우를 세운다. 실제로 SKHY가 이렇게 한 번 멈췄다.
# 여기 올려두면 그때까지는 빠져 있어도 통과시키고, 30봉이 쌓이는 날부터 자동으로
# 합류한다. 합류를 확인하면 이 목록에서 지울 것 — 영구 면제가 아니다.
# ⚠ 최근 상장이라고 무조건 넣지 말 것. CBRS(세레브라스)는 상장 직후인데도
#   30봉이 이미 있어 정상 수집됐다. 실제로 실패한 종목만 올린다.
PENDING_TICKERS = {"SKHY"}

# ── 지표 계산 최소 봉 수 ──────────────────────────────────────────────
# 기본 30봉. 볼린저(20)·RSI(14)·MACD(26)가 자리를 잡는 최소선이다.
# 신규 상장은 이걸 못 채우는데, 그렇다고 통째로 빼면 화면에서 아예 안 보인다.
# 종목별로 낮춰 주면 가격·5일선·10일선·당일 등락은 보여줄 수 있다.
# 이때 볼린저·RSI가 null이라 강한매수 관문(pullBandOK는 볼린저, revStrong은
# RSI를 요구)이 구조적으로 막히므로 가짜 신호는 뜨지 않는다 — 중립으로만 나온다.
MIN_BARS = 30
# 신규 상장은 30봉을 못 채운다. 있는 만큼이라도 흐름을 보여주는 게 낫다.
MIN_BARS_OVERRIDE = {"SKHY": 10, "CBRS": 10}

# 52주 고·저를 신뢰할 수 있는 최소 봉 수. 우리가 쓰는 가장 긴 이동평균이
# 60일선이므로, 그조차 못 만드는 구간에서는 장기 고·저를 계산하지 않는다.
LONG_REF_BARS = 60

# ── 레버리지(배수) 상품 — 대시보드에서 ❗ 경고 표시 ──────────
LEVERAGED = {"SOXL", "GDXU", "NAIL", "UYG", "DUSL"}

# ── 기업 실적발표가 없는 상품(ETF·지수) ────────────────────
# 실적 조회를 시도해도 404만 돌아오고 응답 대기시간만 낭비한다.
# 신호 산식·frozen history·검증 표본에는 아무 영향이 없다. 조회를 건너뛸 뿐이다.
NO_EARNINGS_TICKERS = {
    "SOXL", "GDXU", "GLD", "USO", "ITB", "NAIL",
    "UYG", "FXO", "HQH", "DBA", "DUSL", "SCHD",
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

def _fetch_daily(ticker, days_back=520):
    """일봉을 받는다. period= 가 잘려 오면 명시적 날짜 범위로 한 번 더 시도한다.

    야후는 .KS(KRX) 같은 일부 시장에서 period="1y"를 줘도 최근 몇 주만 돌려줄 때가
    있다(2026-08-18 실측: 코스피·코스닥이 19봉). 같은 티커라도 start/end를 명시하면
    정상적으로 1년치가 온다. 첫 응답이 충분하면 추가 호출은 하지 않는다.
    """
    t = yf.Ticker(ticker)
    df = t.history(period=PERIOD, interval="1d", auto_adjust=False)
    if df is not None and len(df) >= 120:
        return df
    try:
        end = datetime.now(_NY).date() + timedelta(days=1)
        alt = t.history(start=str(end - timedelta(days=days_back)), end=str(end),
                        interval="1d", auto_adjust=False)
        if alt is not None and len(alt) > (0 if df is None else len(df)):
            print(f"데이터 보정: {ticker} period={PERIOD} {0 if df is None else len(df)}봉 "
                  f"→ 날짜범위 조회 {len(alt)}봉")
            return alt
    except Exception as e:
        print(f"데이터 보정 실패: {ticker} — {e}")
    return df

# ── 시장 보조 지표 (표시 전용) ──────────────────────────────────────────
# 점수·등급에는 쓰지 않는다. 화면 뱃지와 앞으로의 검증용으로 값만 쌓는다.
#
# ^TNX(10년물)는 야후가 16일치만 줘서 188거래일 검증이 불가능했다. 같은 금리를
# 보는 티커를 순서대로 시도해 가장 긴 이력을 쓴다 — ^TNX(CBOE 지수) →
# ZN=F(CME 10년물 선물) → IEF/TLT(채권 ETF, 금리와 역방향).
MARKET_EXTRA_SYMBOLS = {
    "vxn": ["^VXN"],
    "tnx": ["^TNX", "ZN=F", "IEF", "TLT"],
}

def fetch_market_extra():
    """오늘/직전 값과 이력 길이를 함께 돌려준다. 실패해도 사이트는 그대로 돈다."""
    out = {}
    for key, syms in MARKET_EXTRA_SYMBOLS.items():
        best = None
        for sym in syms:
            try:
                df = drop_unclosed(_fetch_daily(sym), sym)
                if df is None or len(df) < 2:
                    print(f"보조 지표 {sym}: 데이터 부족")
                    continue
                c = df["Close"].dropna()
                if len(c) < 2:
                    continue
                cand = {"symbol": sym, "days": int(len(c)),
                        "value": round(float(c.iloc[-1]), 4),
                        "prev": round(float(c.iloc[-2]), 4),
                        "date": c.index[-1].strftime("%Y-%m-%d"),
                        "inverse": sym in ("IEF", "TLT"),
                        # 일자별 이력. hist에 '그날의 값'을 얼려 넣는 데만 쓰고
                        # payload에서는 빼낸다(파일만 커진다).
                        "series": {d.strftime("%Y-%m-%d"): round(float(v), 4)
                                   for d, v in c.tail(400).items()}}
                print(f"보조 지표 {sym}: {cand['days']}일 · 최신 {cand['value']} ({cand['date']})")
                if best is None or cand["days"] > best["days"]:
                    best = cand
                if cand["days"] >= 120:
                    break            # 충분히 길면 더 시도하지 않는다
            except Exception as e:
                print(f"보조 지표 {sym} 실패: {e}")
        if best:
            out[key] = best
    return out

def seed_past_hist(kept, tk, nm, cat, date_i):
    """원장에 1~2행뿐인 신규 종목만, carry 중에도 '지난 날짜'를 채워 준다.

    합류 직후 종목은 hist가 한 줄이라 '최근 30거래일 신호 흐름'이 안 그려진다.
    그런데 미국 피드가 역행하는 날에는 carry로 빠져 영원히 한 줄에 머문다.

    여기서 하는 건 last_date를 앞으로 옮기는 게 아니다 — 현재 행(top-level)은
    직전 값 그대로 두고, **그보다 이전 날짜의 hist 행만** 붙인다. 그 날짜들은
    원장에 한 번도 기록된 적이 없으므로 append-only 원칙에 어긋나지 않는다.
    """
    if len(kept.get("hist") or []) > 2:
        return kept
    try:
        fresh = analyze(tk, nm, cat)
    except Exception as e:
        print(f"  과거 보충 실패 {tk}: {e}")
        return kept
    cur = str(kept.get("last_date") or "")
    rows = [h for h in (fresh.get("hist") or [])
            if isinstance(h, list) and len(h) > date_i and str(h[date_i] or "") < cur]
    if not rows:
        return kept
    kept["hist"] = rows + list(kept.get("hist") or [])
    print(f"  과거 보충 {tk}: {len(rows)}행 (~{rows[-1][date_i]}) · 현재 행은 {cur} 유지")
    return kept

def analyze(ticker, name, category):
    df = _fetch_daily(ticker)
    df = drop_unclosed(df, ticker)
    df = drop_invalid_price_rows(df, ticker)
    need = MIN_BARS_OVERRIDE.get(ticker, MIN_BARS)
    if df is None or len(df) < need: raise ValueError(f"데이터 부족 ({0 if df is None else len(df)}봉 < {need})")
    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]
    # 갭 판정에는 시가가 필요하다. 야후가 늘 주지만 없는 피드도 있어 방어한다.
    op = df["Open"] if "Open" in df.columns else None
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

    # ── 상위 시간대(주봉·월봉) 맥락 ──────────────────────────────────
    # 티커당 한 번만 만든다. 봉마다 resample하면 180배 느려진다.
    # ⚠ 진행 중인 주/월은 쓰지 않는다. 각 봉 i에서는 **그 날짜보다 먼저 끝난**
    #   주/월만 참조한다 — 안 그러면 그 주의 남은 날들을 미리 보게 된다.
    def _tf(freq, ma_n):
        try:
            ser = close.resample(freq).last().dropna()
        except Exception:
            return None
        if len(ser) < 3:
            return None
        ends = [pd.Timestamp(x).normalize() for x in ser.index]   # 각 봉의 마지막 날짜(달력)
        return {"end": ends, "val": ser.values.astype(float),
                "ma": ser.rolling(ma_n).mean().values.astype(float),
                "rsi": wilder_rsi(ser).values.astype(float)}
    WK = _tf("W-FRI", 20)          # 주봉 · 20주선
    MO = _tf("ME", 6)              # 월봉 · 6개월선  (12개월선은 1년 데이터로 못 만든다)

    def _tf_at(tf, day):
        """day(그 봉의 날짜)보다 먼저 끝난 마지막 상위봉의 인덱스. 없으면 None."""
        if not tf:
            return None
        j = -1
        for k, e in enumerate(tf["end"]):
            if e < day:
                j = k
            else:
                break
        return j if j >= 1 else None

    def _streak(tf, j):
        """연속 방향. 양봉이 이어지면 +n, 음봉이 이어지면 -n."""
        v = tf["val"]
        if j is None or j < 1:
            return None
        up = v[j] > v[j-1]
        n = 0
        k = j
        while k >= 1 and ((v[k] > v[k-1]) == up):
            n += 1
            k -= 1
        return n if up else -n

    def snap(i):
        """i=-1이면 오늘(확정 종가), i=-2면 직전 거래일. 같은 로직을 그대로 재사용한다."""
        end = len(close) + i + 1              # 해당 시점까지만 보이도록 자르는 위치
        c_i = close.iloc[i]
        # ── 갭(Gap) ──────────────────────────────────────────────
        # 갭은 '전일 종가와 오늘 시가 사이의 빈 구간'이다. 그 구간은 거래가
        # 없었으므로 매물대가 얇고, 되돌림이 오면 빠르게 통과하는 성질이 있다.
        # 여기서는 판정을 하지 않고 사실만 기록한다 — 점수 반영 여부는 실측 후
        # 사용자 승인으로 정한다(방법론 §0: 산식은 index.html 한 곳).
        p_abs = end - 1                      # 이 시점 봉의 절대 위치
        def gap_at(q):
            if op is None or q < 1: return None
            try:
                o_q, pc_q = float(op.iloc[q]), float(close.iloc[q-1])
            except Exception:
                return None
            if not np.isfinite(o_q) or not np.isfinite(pc_q) or pc_q <= 0: return None
            return (o_q / pc_q - 1) * 100
        gap_pct = gap_at(p_abs)
        g20_pct = g20_ago = g20_vol = g20_fill = None
        if op is not None and p_abs >= 1:
            for q in range(p_abs, max(1, p_abs - 19) - 1, -1):
                gq = gap_at(q)
                if gq is None or gq < 2.0:      # 2% 미만은 갭으로 보지 않는다(노이즈)
                    continue
                top, bot = float(op.iloc[q]), float(close.iloc[q-1])
                span = top - bot
                lo_since = low.iloc[q:p_abs+1].min()
                if span > 0 and np.isfinite(lo_since):
                    g20_fill = max(0.0, min(100.0, (top - float(lo_since)) / span * 100))
                v_q = vavg.iloc[q]
                g20_vol = (float(vol.iloc[q]) / float(v_q)) if v_q and float(v_q) > 0 else None
                g20_pct, g20_ago = gq, p_abs - q
                break
        bw = (upper.iloc[i] - lower.iloc[i])
        bb = ((c_i - lower.iloc[i]) / bw * 100) if bw and bw > 0 else None
        va = vavg.iloc[i]
        vr = (vol.iloc[i] / va) if va and va > 0 else None
        chg = (c_i / close.iloc[i-1] - 1) * 100 if len(close) >= abs(i)+1 else None
        atr_pct = (atr_s.iloc[i] / c_i * 100) if c_i else None
        # 52주 고·저는 '있는 봉 중 최대/최소'라, 상장 직후처럼 봉이 짧으면
        # 실제로는 '최근 몇 주 고점'이면서 52주 고점인 척한다. 신규 상장이
        # "고점대비 -2%"로 보이는 착시가 여기서 나온다. 장기 기준선(ma60)조차
        # 없는 구간에서는 값을 아예 주지 않는다 — 틀린 값보다 없는 값이 낫다.
        long_ref_ok = end >= LONG_REF_BARS
        h52 = high.iloc[:end].max() if long_ref_ok else None
        pfh = (c_i / h52 - 1) * 100 if h52 else None
        l52 = low.iloc[:end].min() if long_ref_ok else None
        pfl = (c_i / l52 - 1) * 100 if l52 else None
        # 미너비니 ②: "200일선이 최소 1개월 이상 상승세". 20거래일 전 대비 기울기로 본다.
        m200_now = ma200.iloc[i]
        m200_ago = ma200.iloc[i-20] if abs(i-20) <= len(ma200) else None
        ma200_slope = ((m200_now / m200_ago - 1) * 100) \
            if (m200_now is not None and m200_ago is not None
                and not np.isnan(m200_now) and not np.isnan(m200_ago) and m200_ago > 0) else None

        # ── 진입 위치(Positioning) 판단용 파생값 ────────────────────
        # 점수 계산은 하지 않는다. 산식은 index.html 한 곳에만 둔다.
        # 신규 상장은 hist가 봉 수만큼만 나오므로 i가 배열 끝까지 간다.
        # i-5가 범위를 벗어나면 IndexError로 analyze() 전체가 죽는다 — 없으면 None.
        m20_now = ma20.iloc[i]
        m20_ago = ma20.iloc[i-5] if abs(i-5) <= len(ma20) else None
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
        # 52주 고가 하나만 저항으로 쓰면 현재가와 지나치게 먼 값이 나올 수 있다.
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

        # ── 주봉·월봉 맥락 (완성된 상위봉만 참조) ────────────────────
        day_i = pd.Timestamp(close.index[i]).normalize()
        wj = _tf_at(WK, day_i)
        mj = _tf_at(MO, day_i)
        w_rsi = w_ma20_pos = w_streak = None
        m_ma6_pos = m_streak = None
        if wj is not None:
            r_ = WK["rsi"][wj]
            w_rsi = float(r_) if not np.isnan(r_) else None
            ma_ = WK["ma"][wj]
            if not np.isnan(ma_) and ma_ > 0 and c_i:
                w_ma20_pos = (c_i / float(ma_) - 1) * 100
            w_streak = _streak(WK, wj)
        if mj is not None:
            ma_ = MO["ma"][mj]
            if not np.isnan(ma_) and ma_ > 0 and c_i:
                m_ma6_pos = (c_i / float(ma_) - 1) * 100
            m_streak = _streak(MO, mj)

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
            "gap_pct": safe(gap_pct), "gap20_pct": safe(g20_pct), "gap20_ago": g20_ago,
            "gap20_vol": safe(g20_vol), "gap20_fill": safe(g20_fill),
            "w_rsi": safe(w_rsi, 1), "w_ma20_pos": safe(w_ma20_pos, 1),
            "w_streak": w_streak,
            "m_ma6_pos": safe(m_ma6_pos, 1), "m_streak": m_streak,
            "last_date": df.index[i].strftime("%Y-%m-%d"),
        }

    row = snap(-1)
    # 최근 HIST_DAYS 거래일 지표(오래된 것 → 최신 순). 마지막 항목이 오늘이다.
    # 점수 계산은 index.html의 evaluate() 한 곳에서만 한다.
    # (산식을 파이썬으로 옮기면 두 곳이 반드시 어긋난다)
    hist = []
    # 워밍업(61 + HIST_DAYS봉)을 채운 종목은 HIST_DAYS 전부를 내려준다.
    # 못 채운 신규 상장은 예전에 SPCX만 이름으로 예외 처리했는데, 그 뒤 들어온
    # SKHY·CBRS가 같은 이유로 hist 1~2행에 묶여 '신호 흐름'이 안 그려졌다.
    # 이름 대신 이력 길이로 판단해 같은 상황을 자동으로 처리한다.
    # 짧은 구간의 장기 지표(52주 고저·ma200 등)는 snap()이 None으로 내리므로
    # 없는 값을 지어내지 않는다 — 그날 계산 가능한 것만 들어간다.
    hist_days = HIST_DAYS if len(close) >= 61 + HIST_DAYS else min(HIST_DAYS, len(close))
    for j in range(-hist_days, 0):
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
    "gap_pct", "gap20_pct", "gap20_ago", "gap20_vol", "gap20_fill",
    "w_rsi", "w_ma20_pos", "w_streak", "m_ma6_pos", "m_streak",
    "market_vxn",
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

def sync_prev_from_hist(results):
    """top-level prev_* 를 frozen hist의 직전 행에서 채운다.

    왜 필요한가 — 같은 '어제 값'을 두 곳이 서로 다른 출처로 만들고 있었다.
      · 일자별 snapshot: _storage_row()가 frozen hist[-2]에서 뽑는다
      · top-level 카드:  analyze()가 야후 원본 df[-2]에서 새로 계산한다
    야후가 전날 값을 소급 수정하거나(실제로 있었다: 8/11 RSI ±0.6) 새로 편입된
    티커라 top 쪽이 None이면 둘이 어긋나고, validate_current의
    "snapshot/top 불일치"가 워크플로우를 세운다. 실제 정지 사례가 두 번이다
    (2026-08-17 KO). 지금 데이터에도 27건이 어긋나 있었다.

    원장이 하나면 어긋날 수 없다. frozen hist를 유일한 '어제' 출처로 삼는다 —
    화면도 이미 "변화 칩과 신호 히스토리는 같은 고정 스냅샷 기준"이라고 안내한다.
    반드시 freeze_signal_hist() 뒤에 부른다(그래야 hist[-1]이 오늘 행이다).
    """
    idx = {k: i for i, k in enumerate(HIST_FIELDS)}
    # 확정된 날의 카드는 그날 snapshot이 진실이다. 신규 종목 과거 보충
    # (seed_past_hist)으로 hist[-2]가 '동결 이후에' 생기면, hist에서 다시 계산한
    # prev_*가 이미 고정된 snapshot(당시 None)과 어긋나 검증이 선다
    # (2026-08-18 SKHY prev_change_1d 실패 — carried 예외만으로는 재수집 실행을
    # 못 막았다). 그래서 그 티커가 그날 snapshot에 있으면 prev_*는 snapshot 값을
    # 글자 그대로 쓴다. 없을 때만 frozen hist[-2]에서 계산한다.
    PREV_KEYS = ("prev_change_1d", "prev_vol_ratio", "prev_macd_hist",
                 "prev_price", "prev_ma5", "prev_ma20")
    snap_prev = {}
    for region in ("us", "kr"):
        sel = [r for r in results
               if is_kr_ticker(r.get("ticker", "")) == (region == "kr") and r.get("last_date")]
        if not sel:
            continue
        day = max(str(r["last_date"]) for r in sel)
        path = os.path.join("history", region, f"{day}.json")
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                snap = json.load(fh)
        except Exception:
            continue
        for s0 in (snap.get("stocks") or []):
            tk = s0.get("ticker")
            if tk and str(s0.get("last_date") or "") == day:
                snap_prev[tk] = (day, {k: s0.get(k) for k in PREV_KEYS})
    for r in results:
        # snapshot 원문이 있으면 carried 여부와 무관하게 그 값이 진실이다.
        sp = snap_prev.get(r.get("ticker"))
        if sp is not None and str(r.get("last_date") or "") == sp[0]:
            for k, v in sp[1].items():
                r[k] = v
            continue
        # carry된 행은 이미 고정된 snapshot과 글자 하나까지 같아야 한다.
        if str(r.get("data_status") or "").startswith("carried"):
            continue
        hist = r.get("hist") or []
        if len(hist) < 2:
            continue
        prev = hist[-2]
        def hv(k):
            i = idx.get(k)
            return prev[i] if i is not None and i < len(prev) else None
        r["prev_change_1d"] = hv("change_1d")
        r["prev_vol_ratio"] = hv("vol_ratio")
        r["prev_macd_hist"] = hv("macd_hist")
        r["prev_price"]     = hv("price")
        r["prev_ma5"]       = hv("ma5")
        r["prev_ma20"]      = hv("ma20")


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
        # 아직 원장에 한 줄뿐인 종목은 analyze()가 계산한 과거 행으로 앞을 채운다.
        # 예전에는 '그날 snapshot에 티커가 없을 때'만 허용했는데, SKHY처럼 합류 첫날
        # snapshot에 이미 실린 종목은 영원히 1행에 묶여 신호 흐름이 안 그려졌다.
        # 아래 seed 루프가 이미 frozen된 날짜(seen)와 오늘(last_date)을 건드리지 않으므로,
        # 여기서 푸는 것은 '한 번도 기록된 적 없는 그 이전 날짜'뿐이다 — 원장 변조가 아니다.
        bootstrap_hist = (not prev or len(old_hist) <= 1)
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


def attach_historical_market(results, mkt, vxn_series=None):
    """각 hist 행에 '그 날짜의' 시장 입력을 붙인다. 이미 있으면 덮지 않는다.

    이 값이 행 안에 없으면 화면이 매번 최신 QQQ 계산으로 과거를 다시 채점하게 되고,
    산식을 하나도 안 건드렸는데 어제 신호 등급이 오늘 바뀌는 일이 생긴다.
    """
    qmap = market_hist_map(mkt)
    vmap = vxn_series or {}
    idx={k:i for i,k in enumerate(HIST_FIELDS)}
    idate = idx["date"]; ilv = idx["market_level"]; iwk = idx["market_weak"]; irt = idx["market_ret20"]
    ivx = idx["market_vxn"]
    need = max(idate, ilv, iwk, irt, ivx)
    for r in results:
        tk = r.get("ticker")
        for h in r.get("hist") or []:
            while len(h) <= need: h.append(None)
            # VXN은 뒤늦게 추가된 열이라 국면이 이미 고정된 옛 행에도 채워야 한다.
            # 값이 있으면 절대 덮지 않는다(append-only) — 없을 때만 한 번 채운다.
            if h[ivx] is None:
                v = vmap.get(str(h[idate]))
                if v is not None: h[ivx] = v
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

    # ── 야후 잘린 이력 대응 ────────────────────────────────────────────────
    # 야후는 가끔 전 종목에 대해 며칠 전까지의 이력만 준다(2026-08-18 05:41 UTC 사례:
    # 8/17이 아니라 8/14, 국장은 18봉). 그대로 받으면 카드 종가 날짜가 과거로 되돌아가
    # 이미 고정된 그날 snapshot과 어긋난다.
    #
    # 여기서 실행을 세우면 관심종목 정리 같은 야후와 무관한 변경까지 같이 막히고,
    # 재시도해도 야후가 낫기 전에는 계속 죽는다. 그래서 **중단하지 않고**
    # 직전 시장카드를 그대로 유지한 채 계속 간다. 가격은 안 바뀌지만 원장이 역행하지
    # 않고, WATCHLIST 변경은 정상 반영된다.
    stale_feed = False
    prev_qqq = str(((prev_payload or {}).get("qqq_card") or {}).get("last_date") or "")
    now_qqq = str((qqq_card or {}).get("last_date") or "")
    if prev_qqq and now_qqq and now_qqq < prev_qqq:
        stale_feed = True
        qqq_card = (prev_payload or {}).get("qqq_card")
        mkt = (prev_payload or {}).get("market") or mkt
        mkt_level = (mkt or {}).get("level", mkt_level)
        print(f"⚠ 야후 이력 역행: QQQ가 {now_qqq} — 직전 {prev_qqq}보다 과거다. "
              f"직전 시장카드({prev_qqq})를 유지하고 전 종목도 직전 값으로 간다. "
              f"가격은 이번 실행에서 갱신되지 않는다.")

    market_extra = {}
    try:
        market_extra = fetch_market_extra()
    except Exception as e:
        print("보조 지표 수집 실패:", e)

    # SPY 보조 시장카드 — 나스닥(QQQ)만으로는 시장 전반을 못 본다는 지적에 따라 추가.
    # 국면 판정에는 아직 쓰지 않는다(판정은 여전히 QQQ 기준). 데이터를 쌓아
    # QQQ·SPY 겸용 국면이 나은지 tools/qqq-lab.js 방식으로 비교한 뒤 결정한다.
    spy_card = None
    try:
        spy_card = prepare_qqq_card(analyze("SPY", "S&P500 ETF", "시장 기준"), market_events, market_events_ok)
        print(f"SPY 보조카드: {spy_card.get('last_date')} 종가 · 랭킹 제외")
    except Exception as e:
        print("SPY 보조카드 생성 실패:", e)
    if stale_feed:
        spy_card = (prev_payload or {}).get("spy_card") or spy_card

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

            # 미국 시장 피드가 과거로 돌아간 실행에서는 미국 종목을 새로 받지 않는다.
            # 일부만 최신이면 그 행의 시장 입력(market_level)이 다른 날 값으로 섞인다.
            #
            # 한국 종목은 여기서 제외한다 — histRow()가 국장 행의 market_level을 항상
            # neutral로 고정하므로 QQQ가 며칠 전 값이어도 국장 판정은 오염되지 않는다.
            # 이걸 안 갈라 뒀더니 미국 쪽 야후 문제 하나로 국장 종가까지 며칠씩
            # 멈춰 있었다(2026-08-18: kr 스코프 실행인데 전 종목 carry).
            if stale_feed and not is_kr and tk in prev_rows:
                kept = dict(prev_rows[tk])
                kept["name"], kept["category"] = nm, cat
                kept["data_status"] = "carried_stale_feed"
                kept["data_status_message"] = f"야후 이력 역행 — 직전 값 유지 ({prev_qqq})"
                # 원장이 1~2행뿐인 신규 종목만 지난 날짜를 보충한다(현재 행은 그대로).
                kept = seed_past_hist(kept, tk, nm, cat, HIST_FIELDS.index("date"))
                results.append(kept); carried += 1
                continue

            try:
                row = analyze(tk, nm, cat)
                # ── 시간 역행 차단 ────────────────────────────────────────
                # 야후는 가끔 잘린 이력을 준다(2026-08-18 05:41 UTC 사례: 전 종목이
                # 8/17이 아니라 8/14로 돌아오고 국장은 18봉만 왔다). 그대로 받으면
                # 카드의 종가 날짜가 **과거로 되돌아가고**, 이미 고정된 그날 snapshot과
                # 어긋나 검증이 엉뚱한 필드명(prev_change_1d)으로 실패한다.
                # 원장은 앞으로만 간다 — 뒤로 가는 응답은 데이터 오류로 보고 직전 값을 지킨다.
                prev_day = str((prev_rows.get(tk) or {}).get("last_date") or "")
                new_day = str(row.get("last_date") or "")
                if prev_day and new_day and new_day < prev_day:
                    raise ValueError(f"야후 이력 역행 ({new_day} < 직전 {prev_day}) — 직전 값 유지")
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
                    kept = seed_past_hist(kept, tk, nm, cat, HIST_FIELDS.index("date"))
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
    attach_historical_market(results, mkt,
                             ((market_extra.get("vxn") or {}).get("series") or {}))

    # 신뢰도용 최근 hist는 여기서 고정한다.
    # 과거 날짜는 직전 signals.json 값을 그대로 유지하고 새 거래일만 append한다.
    freeze_signal_hist(results, prev_rows, mkt, market_events, market_events_ok)
    # '어제 값'의 출처를 frozen 원장 하나로 통일한다 — snapshot/top 불일치 방지.
    sync_prev_from_hist(results)

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
        # series(일자별 이력)는 hist에 얼려 넣는 용도라 payload에서는 뺀다.
        "market_extra": {k: {kk: vv for kk, vv in (v or {}).items() if kk != "series"}
                         for k, v in (market_extra or {}).items()},
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
