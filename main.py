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
#  all : 전 종목 수집 (미국장 마감 후 실행)
#  kr  : 한국 종목만 수집. 미국 종목은 직전 signals.json 값을 그대로 유지한다.
#        15:40 KST = 뉴욕 02:40 이라 미국장은 닫혀 있어 새 종가가 없다.
#        그래도 다시 부르면 (1) 야후 사후 정정으로 장전에 점수가 흔들리고
#        (2) 불필요한 71건 요청이 레이트리밋을 유발해 종목이 통째로 사라진다.
# 카드 타임라인용 — 최근 며칠치 지표를 함께 내려준다.
# 키를 반복하는 객체 대신 위치 기반 배열이라 용량이 절반 이하다.
HIST_DAYS = 10
HIST_FIELDS = ["date","price","change_1d","ma5","ma10","ma20","ma50","ma60","rsi","macd_hist","macd_cross","macd_zero",
               "bb_pos","stoch_k","stoch_d","stoch_cross","vol_ratio","near_high","pct_from_high",
               "ma20_slope","run5_max","run3_sum","range3","range10","vol3_ratio",
               "res_short","ret20","rs20",
               "atr_pct"]

RUN_SCOPE = os.environ.get("RUN_SCOPE", "all").strip().lower()
if RUN_SCOPE not in ("all", "kr"):
    RUN_SCOPE = "all"

def is_kr_ticker(t):
    return t.endswith(".KS") or t.endswith(".KQ")


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
    status = {"source":"yfinance Calendars + ticker fallback", "ok":False, "earnings_rows":0,
              "matched":0, "time_confirmed":0, "time_unknown":0, "fallback_resolved":0,
              "fallback_attempted":0, "missing":0, "matched_events":[], "error":""}
    ny_now = now_kst.astimezone(_NY) if now_kst.tzinfo else now_kst.replace(tzinfo=_KST).astimezone(_NY)
    today_ny = ny_now.date()
    start_day = today_ny - timedelta(days=16)
    end_day   = today_ny + timedelta(days=7)
    wanted = {t.upper() for t in wanted_tickers if not is_kr_ticker(t)}
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
    fallback_targets=[tk for tk in sorted(wanted) if tk not in out_earn or out_earn[tk].get("timing")=="UNKNOWN"]
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
    status["missing"] = max(0, len(wanted) - len(out_earn))
    status["matched_events"] = [{"ticker":tk,"date":ev.get("date"),"timing":ev.get("timing"),"source":ev.get("source")}
                                for tk,ev in sorted(out_earn.items())]
    print(f"어닝 캘린더: 조회 {status['earnings_rows']}행 · 매칭 {status['matched']} · "
          f"시간확인 {status['time_confirmed']} · 시간미확인 {status['time_unknown']} · "
          f"fallback 해결 {status['fallback_resolved']} · 누락 {status['missing']}")

    try:
        edf = cal.get_economic_events_calendar(start=start_day, end=end_day, limit=100, force=True) if cal is not None else None
        if edf is not None and not edf.empty:
            for ev, r in edf.iterrows():
                name = str(ev); low = name.lower()
                label = next((k for k, words in MAJOR_EVENT_KEYS.items() if any(w in low for w in words)), None)
                if not label: continue
                dt = _event_date(r.get("Event Time")); region = str(r.get("Region") or "")
                if region and region.upper() not in ("US", "USA"): continue
                if dt: out_market.append({"type":label, "name":name, "date":dt})
    except Exception as e:
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
    "경기방어": {"KO":"코카콜라", "MCD":"맥도날드"},
    "헬스케어": {"LLY":"일라이릴리", "UNH":"유나이티드헬스", "HIMS":"힘스앤허스"},
    "금융": {"JPM":"JP모건", "MA":"마스터카드"},
    "산업재": {"CAT":"캐터필러"},
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
    "원자재·희토류": {"MP":"MP머티리얼즈", "UUUU":"에너지퓨얼스"},
    "암호화폐":      {"MSTR":"마이크로스트래티지", "BMNR":"비트마인", "COIN":"코인베이스"},
    "양자컴퓨팅":    {"IONQ":"아이온큐", "QBTS":"디웨이브", "INFQ":"인플렉션", "RGTI":"리게티컴퓨팅"},
    "우주·UAM":      {"RKLB":"로켓랩", "SPCX":"스페이스X", "PL":"플래닛랩스",
                      "JOBY":"조비에비에이션", "RDW":"레드와이어"},
    "방산·드론":     {"RCAT":"레드캣홀딩스", "LMT":"록히드마틴", "LHX":"L3해리스", "AXON":"액손"},
    "주택":          {"ITB":"미국주택건설 ETF", "NAIL":"주택건설 3x"},
    "빅테크":        {"META":"메타", "AAPL":"애플", "GOOGL":"구글", "AMZN":"아마존"},
    "국장":          {"069500.KS":"코스피", "229200.KS":"코스닥"},
}

# ── 레버리지(배수) 상품 — 대시보드에서 ❗ 경고 표시 ──────────
LEVERAGED = {"SOXL", "GDXU", "NAIL"}

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

def market_state(ticker):
    """시장 국면을 3단계로 판정: strong / neutral / weak"""
    try:
        df = yf.Ticker(ticker).history(period="6mo", interval="1d", auto_adjust=False)
        df = drop_unclosed(df, ticker)
        if df is None or len(df) < 61:
            return {"ticker": ticker, "level": "neutral", "below_ma20": False, "detail": "데이터 부족"}
        c = df["Close"]
        m20s, m60s = c.rolling(20).mean(), c.rolling(60).mean()

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
                mhist.append([c.index[j].strftime("%Y-%m-%d"), judge(j),
                              bool(float(c.iloc[j]) < float(m20s.iloc[j])), safe(r20)])

        if px >= ma20 and ma20 >= ma60 and rising20:
            level, detail = "strong", "20일선 위 · 20일선 상승 · 60일선 위"
        elif px < ma20 and px < ma60:
            level, detail = "weak", "20·60일선 모두 아래"
        elif px < ma20:
            level, detail = "caution", "20일선 아래(60일선은 유지)"
        else:
            level, detail = "neutral", "20일선 위이나 추세 약함"
        return {"ticker": ticker, "level": level, "below_ma20": bool(px < ma20),
                "detail": detail, "price": safe(px), "ma20": safe(ma20), "ma60": safe(ma60),
                "ret20": safe(ret20),
                "prev": ({"level": prev_level, "below_ma20": prev_below} if prev_level else None),
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

def analyze(ticker, name, category):
    df = yf.Ticker(ticker).history(period=PERIOD, interval="1d", auto_adjust=False)
    df = drop_unclosed(df, ticker)
    if df is None or len(df) < 30: raise ValueError("데이터 부족")
    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]
    ma5 = close.rolling(5).mean()
    ma10 = close.rolling(10).mean()
    ma20 = close.rolling(20).mean()
    ma50 = close.rolling(50).mean()
    ma60 = close.rolling(60).mean()
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
    "market_level", "market_weak", "market_ret20",
]

def _storage_row(r, mkt):
    out={k:r.get(k) for k in SNAPSHOT_FIELDS}
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
    """미국/한국 이력을 분리한다. all은 미국만, kr은 한국만 저장한다."""
    region = "kr" if RUN_SCOPE == "kr" else "us"
    selected = [r for r in results if is_kr_ticker(r.get("ticker", "")) == (region == "kr")]
    dates = [r.get("last_date") for r in selected if r.get("last_date")]
    if not dates:
        print(f"이력 저장 건너뜀: {region} last_date 없음"); return
    day = max(dates)
    folder=f"history/{region}"; os.makedirs(folder, exist_ok=True)
    slim=[_storage_row(r,mkt) for r in selected]
    payload={
        "date":day, "market":"KR" if region=="kr" else "US",
        "saved_at":now_kst.strftime("%Y-%m-%d %H:%M")+" KST",
        "market_state":{k:mkt.get(k) for k in ("ticker","level","below_ma20","ret20") if k in mkt},
        "stocks":slim,
    }
    path=f"{folder}/{day}.json"; existed=os.path.exists(path)
    if existed:
        # 같은 거래일 재실행에서도 최초 확정 스냅샷을 보존한다.
        print(f"이력 고정 유지: {path} — 기존 파일 보존")
        return
    with open(path,"w",encoding="utf-8") as f:
        json.dump(payload,f,ensure_ascii=False)
    size=os.path.getsize(path)/1024
    print(f"이력 저장: {path} ({size:.0f}KB, {len(slim)}종목) — 최초 스냅샷 고정")


def freeze_signal_hist(results, prev_rows):
    """
    공개된 종가 스냅샷을 append-only로 고정한다.

    - 이미 존재하는 과거 ticker+date hist는 재계산값으로 덮지 않는다.
    - 같은 last_date가 이미 history/{us|kr}/YYYY-MM-DD.json에 있으면
      top-level 현재 카드 입력값도 그 최초 스냅샷으로 복원한다.
    - 기존 positional hist에 빠져 있던 atr_pct는 Yahoo 재계산값이 아니라
      immutable 일자별 history snapshot에서만 보강한다.
    - 새 거래일만 오늘 계산값을 1회 append한다.
    """
    idx = {k:i for i,k in enumerate(HIST_FIELDS)}
    date_i = idx["date"]
    atr_i = idx["atr_pct"]
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

    frozen_count = 0
    appended_count = 0
    restored_current = 0
    atr_backfilled = 0

    for r in results:
        tk = r.get("ticker")
        last_date = str(r.get("last_date") or "")
        prev = (prev_rows or {}).get(tk) or {}

        fixed_today = day_snapshot(tk, last_date)
        if fixed_today:
            for k in SNAPSHOT_FIELDS:
                if k in ("ticker", "last_date"):
                    continue
                if k in fixed_today:
                    r[k] = fixed_today.get(k)
            restored_current += 1

        old_hist = []
        seen = set()
        for h0 in (prev.get("hist") or []):
            if not isinstance(h0, list) or len(h0) <= date_i:
                continue
            h = list(h0)
            d = str(h[date_i] or "")
            if not d or d in seen:
                continue
            while len(h) <= atr_i:
                h.append(None)
            if h[atr_i] is None:
                snap = day_snapshot(tk, d)
                if snap and snap.get("atr_pct") is not None:
                    h[atr_i] = snap.get("atr_pct")
                    atr_backfilled += 1
            old_hist.append(h)
            seen.add(d)

        if old_hist:
            frozen_count += len(old_hist)

        current_hist_row = None
        for h in (r.get("hist") or []):
            if not isinstance(h, list) or len(h) <= date_i:
                continue
            if str(h[date_i] or "") == last_date:
                current_hist_row = list(h)
                while len(current_hist_row) <= atr_i:
                    current_hist_row.append(None)
                if current_hist_row[atr_i] is None:
                    current_hist_row[atr_i] = r.get("atr_pct")

        if last_date and last_date not in seen and current_hist_row is not None:
            old_hist.append(current_hist_row)
            seen.add(last_date)
            appended_count += 1

        if not old_hist:
            seed=[]
            seed_seen=set()
            for h0 in (r.get("hist") or []):
                if not isinstance(h0,list) or len(h0)<=date_i:
                    continue
                h=list(h0)
                while len(h)<=atr_i:
                    h.append(None)
                d=str(h[date_i] or "")
                if not d or d in seed_seen:
                    continue
                if h[atr_i] is None:
                    snap=day_snapshot(tk,d)
                    h[atr_i]=(snap or {}).get("atr_pct")
                seed.append(h); seed_seen.add(d)
            old_hist=seed[-HIST_DAYS:]

        old_hist.sort(key=lambda h: str(h[date_i] or ""))
        r["hist"] = old_hist[-HIST_DAYS:]

    print(
        f"hist 고정: 기존 {frozen_count}행 유지 · 새 거래일 {appended_count}행 추가 · "
        f"현재카드 스냅샷 복원 {restored_current}종목 · ATR 보강 {atr_backfilled}행"
    )


def attach_historical_rs20(results, mkt):
    """각 과거 날짜의 종목 ret20에서 같은 날짜 QQQ ret20을 빼 rs20을 채운다."""
    mh = (mkt or {}).get("hist") or []
    qret={}
    for x in mh:
        if isinstance(x,(list,tuple)) and len(x)>=4 and x[0]: qret[str(x[0])] = x[3]
    if not qret: return
    idx={k:i for i,k in enumerate(HIST_FIELDS)}
    idate, iret, irs = idx.get("date"), idx.get("ret20"), idx.get("rs20")
    if None in (idate,iret,irs): return
    for r in results:
        for h in r.get("hist") or []:
            if len(h) <= max(idate,iret,irs): continue
            d, rr = h[idate], h[iret]; qr=qret.get(str(d))
            h[irs] = safe(float(rr)-float(qr)) if rr is not None and qr is not None else None

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
    # 조회 실패/누락 시 직전 이벤트를 보조적으로 유지한다.
    prev_earn = {r.get("ticker"): r.get("earnings") for r in (prev_payload or {}).get("stocks", []) if r.get("earnings")}
    for tk, ev in prev_earn.items():
        if tk not in earnings_map and ev:
            earnings_map[tk]=ev

    results, failed, carried = [], [], 0
    for cat, items in WATCHLIST.items():
        for tk, nm in items.items():
            is_kr = is_kr_ticker(tk)

            # 한국장 실행: 미국 종목은 건드리지 않고 직전 값을 그대로 넘긴다
            if RUN_SCOPE == "kr" and not is_kr:
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
                row["market_level"] = "neutral" if is_kr else mkt_level
                row["market_weak"] = bool((not is_kr) and mkt_level in ("weak","caution"))
                results.append(row); print("OK", tk)
            except Exception as e:
                # 실패해도 대시보드에서 사라지지 않게 직전 값을 유지한다
                if tk in prev_rows:
                    kept = dict(prev_rows[tk])
                    kept["name"], kept["category"] = nm, cat
                    results.append(kept); carried += 1
                    print("SKIP→KEEP", tk, e)
                else:
                    failed.append(f"{tk} ({nm}) — {e}"); print("SKIP", tk, e)
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

    # 신뢰도용 최근 hist는 여기서 고정한다.
    # 과거 날짜는 직전 signals.json 값을 그대로 유지하고 새 거래일만 append한다.
    freeze_signal_hist(results, prev_rows)

    payload = {
        "generated_at": now_kst.strftime("%Y-%m-%d %H:%M") + " KST",
        "hist_fields": HIST_FIELDS,
        "note": "yfinance 무료 데이터 · 15~20분 지연 · 참고용",
        "market": mkt,
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
