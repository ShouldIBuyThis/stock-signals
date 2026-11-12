#!/usr/bin/env python3
"""표시 전용 신규 자료 점검 — 원장(hist·history/)과 무관. 갱신 뒤에 돌려 '빠졌는지'를 자동으로 잡는다.
- signals.json: peak_reader가 있는 종목은 peak_reader.blk({days, na})가 있어야 하고 blk_err가 없어야 한다.
- backtest/peak-highlights.json: 구조(조합 블록 이름 · Q/F 숫자 범위 · 진단 열).
사용: python3 tools/check-display-data.py [--strict] [--highlights-only]   (--strict면 문제가 있을 때 종료 코드 1, 아니면 경고만)
"""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import pattern_flags as pf

probs = []
ONLY_HL = "--highlights-only" in sys.argv   # 사이트 점검(push)용: signals.json은 다음 자동 갱신에서 새 형식이 되므로 여기서는 연구 파일만 엄격히 본다
d = json.load(open(ROOT / "signals.json", encoding="utf-8")) if not ONLY_HL else {}
rows = []
def walk(o):
    if isinstance(o, dict):
        if "ticker" in o and "peak_reader" in o: rows.append(o)
        for v in o.values(): walk(v)
    elif isinstance(o, list):
        for v in o: walk(v)
walk(d)
seen = set(); n_pr = n_ok = 0
for r in rows:
    if r["ticker"] in seen: continue
    seen.add(r["ticker"]); pr = r.get("peak_reader")
    if not isinstance(pr, dict): continue
    n_pr += 1; b = pr.get("blk")
    if pr.get("blk_err"): probs.append(f"{r['ticker']} 교집합 블록 계산 실패: {pr['blk_err']}"); continue
    if not isinstance(b, dict) or not isinstance(b.get("days"), dict) or not isinstance(b.get("na"), list):
        probs.append(f"{r['ticker']} peak_reader.blk 없음/형식 오류"); continue
    bad = [x for v in b["days"].values() for x in v if x not in pf.COMBO_STOCK_BLOCKS]
    if bad: probs.append(f"{r['ticker']} 알 수 없는 블록 {sorted(set(bad))}"); continue
    if r.get("last_date") and str(r["last_date"]) not in b["days"]: probs.append(f"{r['ticker']} blk에 최신 거래일 {r['last_date']} 없음"); continue
    n_ok += 1
hp = ROOT / "backtest" / "peak-highlights.json"
if hp.exists():
    h = json.load(open(hp, encoding="utf-8")); L = h.get("highlights") or []
    if not L: probs.append("peak-highlights.json: highlights 비어 있음")
    for x in L:
        if not all(b in pf.COMBO_STOCK_BLOCKS or b.startswith("X_") for b in x.get("combo", [])): probs.append(f"highlights 알 수 없는 블록: {x.get('combo')}")
        for rd, z in (x.get("readers") or {}).items():
            for k in ("zb", "zb_r", "ex"):
                if not (isinstance(z.get(k), (int, float)) and 0 <= z[k] <= 1): probs.append(f"highlights {x.get('name')} {rd}.{k} 범위 오류")
            if not (isinstance(z.get("zb_hit"), int) and isinstance(z.get("zb_n"), int) and 0 <= z["zb_hit"] <= z["zb_n"]): probs.append(f"highlights {x.get('name')} {rd} 건수 오류")
            if abs(z["zb_hit"] / max(1, z["zb_n"]) - z["zb_r"]) > 0.002: probs.append(f"highlights {x.get('name')} {rd} 사건 기준 비율 불일치")
else:
    probs.append("backtest/peak-highlights.json 없음")
print(f"표시 자료 점검: peak_reader {n_pr}종목 중 블록 정상 {n_ok} · 문제 {len(probs)}")
for p in probs[:40]: print(("::warning::" if "--strict" not in sys.argv else "::error::") + p)
sys.exit(1 if probs and "--strict" in sys.argv else 0)
