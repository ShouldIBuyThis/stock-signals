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
HIST_DAYS = 5
HIST_FIELDS = ["date","price","change_1d","ma5","ma20","ma60","rsi","macd_hist","macd_cross","macd_zero",
               "bb_pos","stoch_k","stoch_d","stoch_cross","vol_ratio","near_high","pct_from_high",
               "ma20_slope","run5_max","run3_sum","range3","range10","vol3_ratio"]

RUN_SCOPE = os.environ.get("RUN_SCOPE", "all").strip().lower()
if RUN_SCOPE not in ("all", "kr"):
    RUN_SCOPE = "all"

def is_kr_ticker(t):
    return t.endswith(".KS") or t.endswith(".KQ")

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
    "경기방어·헬스케어·금융·산업재": {
        "KO":"코카콜라", "MCD":"맥도날드", "LLY":"일라이릴리",
        "UNH":"유나이티드헬스", "HIMS":"힘스앤허스", "JPM":"JP모건", "CAT":"캐터필러",
        "MA":"마스터카드"},
    "반도체·메모리":  {"MU":"마이크론", "SNDK":"샌디스크", "STX":"씨게이트"},
    "반도체·파운드리":{"TSM":"TSMC"},
    "반도체·GPU":     {"NVDA":"엔비디아", "AMD":"AMD", "SOXL":"반도체 3x",
                       "ALAB":"아스테라랩스", "AMAT":"어플라이드머티어리얼즈",
                       "INTC":"인텔", "DELL":"델", "AVGO":"브로드컴", "MRVL":"마벨테크놀로지"},
    "데이터센터":    {"APLD":"어플라이드디지털", "NBIS":"네비우스", "CRWV":"코어위브", "IREN":"아이렌"},
    "소프트웨어":    {"MSFT":"마이크로소프트", "NOW":"서비스나우", "PLTR":"팔란티어", "CRWD":"크라우드스트라이크", "SNOW":"스노우플레이크"},
    "광통신":        {"AAOI":"어플라이드옵토", "GLW":"코닝", "LITE":"루멘텀", "CIEN":"시에나", "POET":"포엣테크놀로지",
                      "CRDO":"크레도테크놀로지", "COHR":"코히어런트"},
    "전기차·자율주행":{"TSLA":"테슬라", "PONY":"포니AI"},
    "에너지·원전":   {"CEG":"컨스텔레이션에너지", "VST":"비스트라", "BE":"블룸에너지",
                      "SMR":"뉴스케일파워", "OKLO":"오클로"},
    "원자재·금":     {"GDXU":"금광주 3x", "GLD":"금 현물 ETF"},
    "원자재·유가":   {"XOM":"엑슨모빌"},
    "원자재·희토류": {"MP":"MP머티리얼즈"},
    "암호화폐":      {"MSTR":"마이크로스트래티지", "BMNR":"비트마인", "COIN":"코인베이스"},
    "양자컴퓨팅":    {"IONQ":"아이온큐", "QBTS":"디웨이브", "INFQ":"인플렉션", "RGTI":"리게티컴퓨팅"},
    "우주·UAM":      {"RKLB":"로켓랩", "SPCX":"스페이스X", "PL":"플래닛랩스",
                      "JOBY":"조비에비에이션", "RDW":"레드와이어"},
    "방산·드론":     {"RCAT":"레드캣홀딩스", "LMT":"록히드마틴", "LHX":"L3해리스", "AXON":"액손"},
    "주택":          {"ITB":"미국주택건설 ETF", "NAIL":"주택건설 3x"},
    "빅테크":        {"META":"메타", "AAPL":"애플", "GOOGL":"구글", "AMZN":"아마존"},
    "중국":          {"BABA":"알리바바"},
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
        prev_level = judge(-2) if len(c) >= 66 else None
        prev_below = bool(float(c.iloc[-2]) < float(m20s.iloc[-2])) if len(c) >= 66 else None
        mhist = []
        if len(c) >= 66 + HIST_DAYS:
            for j in range(-HIST_DAYS, 0):
                mhist.append([judge(j), bool(float(c.iloc[j]) < float(m20s.iloc[j]))])

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
    ma5, ma20, ma60 = close.rolling(5).mean(), close.rolling(20).mean(), close.rolling(60).mean()
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

        return {
            "price": safe(c_i, nd), "change_1d": safe(chg),
            "volume": int(vol.iloc[i]) if not np.isnan(vol.iloc[i]) else None,
            "vol_ratio": safe(vr),
            "ma5": safe(ma5.iloc[i], nd), "ma20": safe(ma20.iloc[i], nd), "ma60": safe(ma60.iloc[i], nd),
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
            "range3": safe(range3), "range10": safe(range10), "vol3_ratio": safe(vol3_ratio),
            "last_date": df.index[i].strftime("%Y-%m-%d"),
        }

    row = snap(-1)
    # 최근 HIST_DAYS 거래일 지표(오래된 것 → 최신 순). 마지막 항목이 오늘이다.
    # 점수 계산은 index.html의 evaluate() 한 곳에서만 한다.
    # (산식을 파이썬으로 옮기면 두 곳이 반드시 어긋난다)
    hist = []
    if len(close) >= 61 + HIST_DAYS:
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

# 채점(evaluate)에 실제로 쓰이는 값 + 수익률 계산용 종가만 남긴다
HISTORY_FIELDS = [
    "ticker", "last_date", "price", "change_1d", "vol_ratio",
    "ma5", "ma20", "ma60", "rsi",
    "macd_hist", "macd_cross", "macd_zero",
    "bb_pos", "stoch_k", "stoch_d", "stoch_cross",
    "near_high", "pct_from_high", "atr_pct",
    "market_level", "market_weak",
]

def save_history(results, mkt, now_kst):
    """거래일 하루에 파일 하나. 스냅샷 날짜는 실행 시각이 아니라 '데이터의 날짜'로 잡는다."""
    os.makedirs("history", exist_ok=True)
    dates = [r.get("last_date") for r in results if r.get("last_date")]
    if not dates:
        print("이력 저장 건너뜀: last_date 없음"); return
    day = max(dates)                       # 가장 최신 거래일을 파일명으로
    slim = [{k: r[k] for k in HISTORY_FIELDS if r.get(k) is not None} for r in results]
    payload = {
        "date": day,
        "saved_at": now_kst.strftime("%Y-%m-%d %H:%M") + " KST",
        "market": {k: mkt.get(k) for k in ("ticker", "level", "below_ma20") if k in mkt},
        "stocks": slim,
    }
    path = f"history/{day}.json"
    existed = os.path.exists(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    size = os.path.getsize(path) / 1024
    print(f"이력 저장: {path} ({size:.0f}KB, {len(slim)}종목){' — 덮어씀' if existed else ''}")

def main():
    prev_rows, prev_payload = load_previous()
    print(f"실행 범위: {RUN_SCOPE} · 직전 데이터 {len(prev_rows)}종목 보유")

    # QQQ 시장 국면은 어느 실행이든 새로 본다 (요청 1건)
    mkt = market_state(MARKET_TICKER)
    mkt_level = mkt["level"]
    print(f"시장({MARKET_TICKER}) 국면: {mkt_level} — {mkt['detail']}")

    results, failed, carried = [], [], 0
    for cat, items in WATCHLIST.items():
        for tk, nm in items.items():
            is_kr = is_kr_ticker(tk)

            # 한국장 실행: 미국 종목은 건드리지 않고 직전 값을 그대로 넘긴다
            if RUN_SCOPE == "kr" and not is_kr:
                if tk in prev_rows:
                    results.append(prev_rows[tk]); carried += 1; print("KEEP", tk)
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
                    results.append(prev_rows[tk]); carried += 1
                    print("SKIP→KEEP", tk, e)
                else:
                    failed.append(f"{tk} ({nm}) — {e}"); print("SKIP", tk, e)
    print(f"수집 {len(results)}종목 (직전 값 유지 {carried}건) · 실패 {len(failed)}건")
    now_kst = datetime.utcnow() + timedelta(hours=9)

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

    payload = {
        "generated_at": now_kst.strftime("%Y-%m-%d %H:%M") + " KST",
        "hist_fields": HIST_FIELDS,
        "note": "yfinance 무료 데이터 · 15~20분 지연 · 참고용",
        "market": mkt,
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
    #  3) 채점에 안 쓰는 필드(이름·카테고리·통화·prev·거래량 등)는 뺀다.
    # 브라우저는 이 폴더를 절대 읽지 않는다. 채점 스크립트 전용이다.
    save_history(results, mkt, now_kst)

    print(f"저장 완료: 성공 {len(results)} / 실패 {len(failed)}")

if __name__ == "__main__":
    main()
