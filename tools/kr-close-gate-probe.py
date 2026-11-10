"""실데이터로 국장 공식 종가 확인 장치(main.kr_official_close_gate)를 시험한다 — CI 전용, 읽기만.
signals.json의 국장 행(이미 기록된 값)을 '새 행'처럼 넣어 오늘 quote와 맞는지 본다."""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datetime import datetime
import yfinance as yf
import main
d = json.load(open("signals.json", encoding="utf-8"))
rows = [dict(s) for s in d["stocks"] if main.is_kr_ticker(s["ticker"])]
for r in rows: r.pop("data_status", None)
exp = main.latest_closed_kr_session()
print("기대 거래일", exp, "· 행", len(rows))
for r in rows:
    t = yf.Ticker(r["ticker"]); info = t.get_info()
    ts = info.get("regularMarketTime")
    print(f"  {r['ticker']} 원장 {r['last_date']} {r['price']} | quote {datetime.fromtimestamp(ts, main._KST):%m-%d %H:%M:%S} {info.get('regularMarketPrice')}")
bad = main.kr_official_close_gate(rows, exp)
print("판정:", "통과" if not bad else "실패 — " + "; ".join(bad))
