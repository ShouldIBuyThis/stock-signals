#!/usr/bin/env python3
"""캔들·패턴 코드(pat) 소급 재계산 — 연구 전용 · 원장이 아님.
원장 hist의 pat 열은 2026-11-05부터 쌓였다. 그 이전 날짜의 🏆 황금신호(일봉 ∩ 캔들패턴 ∩ 장중)를 '소급 재현'하려면
같은 함수로 과거 날짜의 pat을 다시 계산해야 한다. main.analyze()와 같은 경로를 쓴다:
_fetch_daily → drop_unclosed → drop_invalid_price_rows → pattern_flags.flag_series → flags_at(i).
대조: 원장 pat이 있는 날짜는 재계산 값과 비교해 일치율을 찍는다(다르면 소급 값을 쓰지 말 것).
출력(로그 한 줄): PATJSON {"TICKER": {"YYYY-MM-DD": "코드,코드"}} — 마지막 N거래일 · 빈 날은 생략.
사용: python tools/pat-recompute.py [N=70]
"""
import json, sys
ROOT = __file__.rsplit("/", 2)[0]; sys.path.insert(0, ROOT)
import main as M, pattern_flags as pf
N = int(sys.argv[1]) if len(sys.argv) > 1 else 70
sig = json.load(open(f"{ROOT}/signals.json", encoding="utf-8"))
F = sig["hist_fields"]; iD, iP = F.index("date"), F.index("pat")
ledger = {s["ticker"]: {h[iD]: h[iP] for h in s.get("hist") or [] if len(h) > iP and h[iP] is not None} for s in sig["stocks"]}
norm = lambda x: ",".join(sorted([c for c in str(x or "").split(",") if c]))
out, same, diff, ex = {}, 0, 0, []
for s in sig["stocks"]:
    t = s["ticker"]
    try:
        df = M.drop_invalid_price_rows(M.drop_unclosed(M._fetch_daily(t), t), t)
        ps = pf.flag_series(df["Open"].values, df["High"].values, df["Low"].values, df["Close"].values, df["Volume"].values, t)
    except Exception as e:
        print(f"  {t} 실패: {e}"); continue
    dates = [str(d.date()) for d in df.index]
    row = {}
    for i in range(max(0, len(dates) - N), len(dates)):
        p = pf.flags_at(ps, i) or ""
        if p: row[dates[i]] = p
        lp = ledger.get(t, {}).get(dates[i])
        if lp is not None:
            if norm(lp) == norm(p): same += 1
            else:
                diff += 1
                if len(ex) < 12: ex.append(f"{t} {dates[i]} 원장[{lp}] 재계산[{p}]")
    if row: out[t] = row
print(f"대조(원장 pat 있는 날): 일치 {same} · 불일치 {diff}" + (" · 예: " + " | ".join(ex) if ex else ""))
print("PATJSON " + json.dumps(out, separators=(",", ":"), ensure_ascii=False))
