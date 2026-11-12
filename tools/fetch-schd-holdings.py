#!/usr/bin/env python3
"""배당 그룹(SCHD 편입 종목) 구성 자료 받기 — 2026-11-12 사용자 승인("슈드 공식 파일 자동으로 받아도 되고").
출처는 슈왑 자산운용 공식 SCHD 보유 종목 페이지 한 곳뿐이다(docs/2026-11-12-theme-flow.md §9).
- robots.txt를 먼저 읽고, 막혀 있거나 접근이 거부되면 우회하지 않는다(파일을 만들지 않음 → 배당 그룹은 '구성 자료 없음').
- 실행 한 번에 요청 최대 4건 · 사이 2초. 주식이 아닌 행(현금·선물 등)은 뺀다. 80~130종목이 아니면 쓰지 않는다.
사용: python tools/fetch-schd-holdings.py [--out data/groups/schd-holdings.csv]
"""
import argparse, io, os, re, sys, time
from datetime import datetime, timezone
from urllib import robotparser
from urllib.parse import urljoin
import pandas as pd, requests

HOST = "https://www.schwabassetmanagement.com"
PAGES = ["/allholdings/SCHD", "/products/schd"]
UA = {"User-Agent": "holdings-reader/1.0 (personal research; a few requests per run)", "Accept": "text/html,application/xhtml+xml,text/csv,*/*"}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SYM = re.compile(r"^[A-Z]{1,5}([.\-][A-Z])?$")
N = 0


def get(url):
    global N
    if N >= 4: raise RuntimeError("요청 한도(4건) 초과")
    if N: time.sleep(2)
    N += 1
    r = requests.get(url, headers=UA, timeout=60)
    print(f"  GET {url} → {r.status_code} · {len(r.content):,}바이트 · {r.headers.get('content-type', '')[:40]}")
    return r


def pick(tables, src):
    for t in tables:
        cols = [" ".join(map(str, c)) if isinstance(c, tuple) else str(c) for c in t.columns]
        k = next((i for i, c in enumerate(cols) if c.strip().lower() in ("symbol", "ticker") or "symbol" in c.lower()), None)
        print(f"    표 {len(t)}행 · 열 {cols[:8]}")
        if k is None: continue
        ac = next((i for i, c in enumerate(cols) if "asset" in c.lower() and "class" in c.lower()), None)
        nm = next((i for i, c in enumerate(cols) if "name" in c.lower() or "description" in c.lower()), None)
        rows = []
        for _, r in t.iterrows():
            s = str(r.iloc[k]).strip().upper()
            if not SYM.match(s): continue
            if ac is not None and "equit" not in str(r.iloc[ac]).lower() and "stock" not in str(r.iloc[ac]).lower(): continue
            rows.append((s, "" if nm is None else str(r.iloc[nm]).strip()))
        rows = list(dict(rows).items())
        if 80 <= len(rows) <= 130: return rows, src
        print(f"    → 종목 {len(rows)}개(80~130 아님) — 쓰지 않음")
    return None, None


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default=f"{ROOT}/data/groups/schd-holdings.csv"); a = ap.parse_args()
    rp = robotparser.RobotFileParser()
    try:
        r = get(HOST + "/robots.txt")
        if r.status_code == 200: rp.parse(r.text.splitlines())
        elif r.status_code in (401, 403): print("robots.txt 접근 거부 — 받지 않는다"); return 0
        else: rp.parse([])
    except Exception as e:
        print(f"robots.txt 읽기 실패({type(e).__name__}) — 받지 않는다"); return 0
    rows = src = asof = None
    for path in PAGES:
        url = HOST + path
        if not rp.can_fetch(UA["User-Agent"], url): print(f"  robots.txt가 막음: {path} — 건너뜀"); continue
        try: r = get(url)
        except Exception as e: print(f"  실패: {type(e).__name__}: {e}"); continue
        if r.status_code != 200: print("  접근 거부·오류 — 우회하지 않는다"); continue
        html = r.text
        m = re.search(r"[Aa]s of\s*:?\s*(?:<[^>]+>\s*)*(\d{1,2}/\d{1,2}/\d{4}|[A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})", html)
        asof = m.group(1) if m else asof
        try: rows, src = pick(pd.read_html(io.StringIO(html)), url)
        except ValueError: print("    표 없음")
        if rows: break
        links = sorted({urljoin(url, h) for h in re.findall(r'href="([^"]+)"', html) if re.search(r"holding", h, re.I) and re.search(r"\.(csv|xlsx?)(\?|$)", h, re.I)})
        print(f"    보유 종목 파일 링크 {len(links)}개: {links[:5]}")
        for lk in links[:1]:
            if not lk.startswith(HOST) or not rp.can_fetch(UA["User-Agent"], lk): continue
            try:
                f = get(lk)
                if f.status_code != 200: continue
                tabs = [pd.read_excel(io.BytesIO(f.content), header=None)] if re.search(r"\.xlsx?", lk, re.I) else [pd.read_csv(io.StringIO(f.text), header=None, names=range(12), engine="python")]
                t = tabs[0]; hr = next((i for i in range(min(15, len(t))) if any(str(x).strip().lower() in ("symbol", "ticker") for x in t.iloc[i])), None)
                if hr is not None:
                    t2 = t.iloc[hr + 1:].copy(); t2.columns = [str(x) for x in t.iloc[hr]]; rows, src = pick([t2], lk)
            except Exception as e: print(f"    파일 읽기 실패: {type(e).__name__}: {e}")
        if rows: break
    if not rows:
        print("SCHD 보유 종목을 받지 못했다 — 배당 그룹은 '구성 자료 없음'으로 둔다"); return 0
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(f"# 출처: 슈왑 자산운용 공식 SCHD 보유 종목({src}) · 기준일 {asof or '페이지에 표시 없음'} · 받은 날 {today} · 주식 {len(rows)}종목\n")
        f.write("Symbol,Name\n")
        for s, n in rows: f.write(f'{s},"{n.replace(chr(34), "")}"\n')
    print(f"→ {a.out} · {len(rows)}종목 · 기준일 {asof}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
