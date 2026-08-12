#!/usr/bin/env python3
# 1회성 과거 실적 캘린더 생성기 — SEC EDGAR 기반, API key 불필요.
# 미국 기업: 8-K Item 2.02(Results of Operations and Financial Condition)만 사용.
# BMO/AMC: SEC acceptance timestamp가 09:30 ET 이전=BMO, 16:00 ET 이후=AMC.
# 장중/시간 불명확/외국기업 6-K/ETF는 억지 추정하지 않고 제외·미확인 처리.
import json, re, time, urllib.request, urllib.error, csv
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

ROOT=Path.cwd()
START="2025-08-11"
END="2026-07-14"
UA="ShouldIBuyThis research contact admin@example.com"  # SEC는 식별 가능한 UA 요구. 필요시 이메일만 바꿔도 됨.
ETF={"SOXL","GDXU","GLD","USO","ITB","NAIL"}

def get_json(url):
    req=urllib.request.Request(url,headers={"User-Agent":UA,"Accept-Encoding":"gzip, deflate","Host":urllib.parse.urlparse(url).netloc})
    with urllib.request.urlopen(req,timeout=30) as r:
        raw=r.read()
        enc=r.headers.get("Content-Encoding","")
        if enc=="gzip":
            import gzip; raw=gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))

# main.py WATCHLIST를 실행하지 않고 텍스트에서 티커를 뽑아 네트워크 부작용을 막는다.
txt=(ROOT/"main.py").read_text(encoding="utf-8")
m=re.search(r'WATCHLIST\s*=\s*({.*?})\n\n',txt,re.S)
if not m: raise SystemExit("WATCHLIST를 찾지 못했습니다.")
import ast
watch=ast.literal_eval(m.group(1))
tickers=[tk for group in watch.values() for tk in group if not (tk.endswith(".KS") or tk.endswith(".KQ"))]

print(f"미국 WATCHLIST {len(tickers)}개 확인")
mapping=get_json("https://www.sec.gov/files/company_tickers.json")
by_ticker={v["ticker"].upper():str(v["cik_str"]).zfill(10) for v in mapping.values()}

events=[]
coverage=[]
for n,tk in enumerate(tickers,1):
    if tk in ETF:
        coverage.append([tk,START,END,"not_applicable_etf","ETF/펀드: 기업 실적 없음"])
        continue
    cik=by_ticker.get(tk)
    if not cik:
        coverage.append([tk,START,END,"unverified","SEC ticker→CIK 매핑 없음/외국·신규 가능"])
        continue
    try:
        sub=get_json(f"https://data.sec.gov/submissions/CIK{cik}.json")
        recent=sub.get("filings",{}).get("recent",{})
        keys=list(recent.keys())
        rows=[{k:recent[k][i] for k in keys} for i in range(len(recent.get("form",[])))]
        # 1년 범위는 recent에 거의 항상 포함. 필요하면 old submissions 파일도 읽는다.
        if not any(START <= str(r.get("filingDate","")) <= END for r in rows):
            for f in sub.get("filings",{}).get("files",[]):
                old=get_json("https://data.sec.gov/submissions/"+f["name"])
                oks=list(old.keys())
                rows += [{k:old[k][i] for k in oks} for i in range(len(old.get("form",[])))]
                time.sleep(0.11)

        found=0
        for r in rows:
            d=str(r.get("filingDate",""))
            if not (START <= d <= END): continue
            if str(r.get("form","")).upper()!="8-K": continue
            items=str(r.get("items",""))
            if "2.02" not in items: continue

            acc=str(r.get("acceptanceDateTime",""))
            timing="UNKNOWN"
            try:
                # SEC timestamp는 Eastern 기준으로 제공되는 경우가 많지만 offset 없는 값도 있어
                # 날짜와 시각만 사용해 보수적으로 분류.
                hh=int(acc[11:13]); mm=int(acc[14:16])
                mins=hh*60+mm
                if mins <= 9*60+30: timing="BMO"
                elif mins >= 16*60: timing="AMC"
            except: pass
            if timing=="UNKNOWN":
                # 실적일은 확정하되 타이밍 불명확 표시는 유지. 백테스트가 보수적으로 양쪽 영향일을 제외 가능.
                pass
            events.append([tk,d,timing,"SEC_8K_2.02",r.get("accessionNumber",""),acc])
            found+=1

        # 8-K 2.02는 미국 발행사 과거 실적일의 강한 근거. 0건이면 "실적 없음"으로 간주하지 않는다.
        if found:
            coverage.append([tk,START,END,"verified",f"SEC 8-K Item 2.02 {found}건"])
        else:
            coverage.append([tk,START,END,"unverified","해당 기간 SEC 8-K Item 2.02 미확인 — 표본 제외 권장"])
    except Exception as e:
        coverage.append([tk,START,END,"unverified",f"SEC 조회 실패: {type(e).__name__}"])
    if n%10==0: print(f"  {n}/{len(tickers)}")
    time.sleep(0.12)  # SEC fair-access: 초당 요청을 낮게 유지

events.sort()
with open("private_earnings_history.csv","w",newline="",encoding="utf-8") as f:
    w=csv.writer(f); w.writerow(["ticker","earnings_date","timing","source","accession","accepted_at"]); w.writerows(events)
with open("private_earnings_coverage.csv","w",newline="",encoding="utf-8") as f:
    w=csv.writer(f); w.writerow(["ticker","verified_from","verified_to","coverage","note"]); w.writerows(coverage)

verified=sum(1 for x in coverage if x[3]=="verified")
unverified=sum(1 for x in coverage if x[3]=="unverified")
na=sum(1 for x in coverage if x[3]=="not_applicable_etf")
print(f"완료: 실적 이벤트 {len(events)}건 · verified 종목 {verified} · unverified {unverified} · ETF {na}")
print("중요: unverified 종목은 '실적 없음'이 아니라 백테스트 표본에서 제외하세요.")
