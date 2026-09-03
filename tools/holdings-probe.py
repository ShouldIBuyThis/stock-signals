#!/usr/bin/env python3
"""의회 거래 ETF(NANC·GOP·MAGA) 보유 내역을 어디서 받을 수 있나 — 탐색 전용 (CI).

1) 야후(yfinance funds_data): 상위 보유 10종·비중, 섹터 비중 — 어느 ETF든 대체로 나온다.
2) 운용사 CSV: 후보 URL 몇 개를 두드려 본다(전체 보유 종목·비중이 목적). 실패해도 계속.
결과는 요약만 찍는다. 화면·산식에는 아무것도 안 넣는다.
"""
import json, sys, io
import yfinance as yf
try:
    import requests
except Exception:
    requests = None

ETFS = ["NANC", "GOP", "MAGA"]
print("■ 보유 내역 탐색")
for tk in ETFS:
    try:
        fd = yf.Ticker(tk).funds_data
        th = fd.top_holdings
        sw = fd.sector_weightings
        print(f"\n[{tk}] 야후 상위 보유 {len(th)}종")
        for sym, r in th.iterrows():
            w = r.get("Holding Percent", None)
            print(f"   {sym:6} {str(r.get('Name',''))[:28]:28} {float(w)*100 if w is not None else float('nan'):5.1f}%")
        print(f"   섹터 비중: " + ", ".join(f"{k} {v*100:.0f}%" for k, v in list((sw or {}).items())[:6]))
        try:
            eh = fd.equity_holdings
            print(f"   equity_holdings 키: {list(eh.index)[:8] if hasattr(eh,'index') else type(eh)}")
        except Exception as e:
            print(f"   equity_holdings 없음: {e}")
    except Exception as e:
        print(f"\n[{tk}] 야후 funds_data 실패: {e}")

CANDS = {
    "NANC": ["https://subversiveetfs.com/nanc/", "https://www.subversiveetfs.com/nanc", "https://subversiveetfs.com/wp-content/uploads/holdings/NANC.csv",
             "https://unusualwhales.com/etf/NANC/holdings"],
    "GOP":  ["https://subversiveetfs.com/gop/", "https://www.subversiveetfs.com/gop", "https://subversiveetfs.com/wp-content/uploads/holdings/GOP.csv"],
    "MAGA": ["https://www.pointbridgecapital.com/maga-etf/", "https://pointbridgecapital.com/holdings/"],
}
if requests:
    print("\n■ 운용사 페이지 탐색 (상태코드 · 'csv' 링크 개수)")
    for tk, urls in CANDS.items():
        for u in urls:
            try:
                r = requests.get(u, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
                body = r.text
                n_csv = body.lower().count(".csv")
                n_xlsx = body.lower().count(".xlsx")
                links = [seg.split('"')[0] for seg in body.split('href="')[1:] if ".csv" in seg.split('"')[0].lower() or "holding" in seg.split('"')[0].lower()]
                print(f"  {tk} {r.status_code} {u}  csv:{n_csv} xlsx:{n_xlsx} " + (" | ".join(links[:4]) if links else ""))
            except Exception as e:
                print(f"  {tk} ERR {u} {type(e).__name__}")
print("\n※ 탐색 전용. 전체 보유 내역 CSV가 있으면 다음 단계는 매일 holdings/ 원장에 쌓아 편입·편출·비중 변화를 기록하는 것.")
