"""고점판독기 승률 산식별 실제 사례 — 연구 결과 JSON에서 사건 목록만 그대로 뽑는다(새 계산 없음).

2026-11-12 사용자 지적: '고점 사례 연구실에 승률 산식 예시 실제 사례가 하나도 없다'.
연구실 9개 사례는 예전 A 조합(검증 탈락)에만 연결돼 있었고, 지금 승률을 보여 주는 산식의 사건은 연구 파일 안에만 있었다.
  · 🔴 20일 종가 하락 연구 후보: backtest/peak-p20.json (탐색·미사용 사건 전부) + backtest/peak-p20-replay.json(사이트 경로 재현 여부)
  · 📁 Q 22개 조합: backtest/peak-combo2.json Q 판독기 미사용(ZB) 사건 — 연구 도구가 오래된 순 60건까지만 저장했다(그 이상은 개수만).
사용: python tools/peak-examples.py  →  backtest/peak-examples.json"""
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent; B = ROOT / "backtest"


def ev(e):   # [종목, 날짜, 자료, 적중(1/0), 10일 %, 20일 %]
    return [e[0], e[1], e[2], int(e[3]), e[8], e[9]]


def main():
    p20 = json.load(open(B / "peak-p20.json", encoding="utf-8")); P = p20["readers"]["P"]
    cand = [x for x in P["cands"] if x["combo"] == ["P_RT5", "C_FB", "I_STO", "K_20", "X_T"]][0]
    try:
        rp = json.load(open(B / "peak-p20-replay.json", encoding="utf-8"))
        rmap = {(r["ticker"], r["date"]): bool(r.get("site_ok")) for r in rp["rows"]}; rinfo = {k: rp[k] for k in ("events", "site_ok", "leak_free", "data_hash")}
    except FileNotFoundError:
        rmap, rinfo = {}, None
    out = {"generated": p20.get("generated"), "kind": "examples", "note": "연구 결과 JSON의 사건을 그대로 옮김 · 새 계산 없음",
           "p20": {"name": cand["name"], "hit_def": "신호일 종가 대비 정확히 20거래일 뒤 종가가 더 낮음", "data_hash": p20["data_hash"], "replay": rinfo,
                   "parts": {s: {"n": cand["parts"][s]["n"], "hit": cand["parts"][s]["20"]["hit"],
                                 "events": [ev(e) + [rmap.get((e[0], e[1]))] for e in cand["parts"][s]["events"]]} for s in ("ex", "zb")}},
           "q": []}
    c2 = json.load(open(B / "peak-combo2.json", encoding="utf-8")); idx = {tuple(c["combo"]): c for c in c2["readers"]["Q"]["cands"]}
    hl = json.load(open(B / "peak-highlights.json", encoding="utf-8"))
    out["q_def"] = "신호 뒤 20거래일 안에 신호 뒤 고점 대비 −10% 도달(20일 종가 하락과 다른 기준)"; out["q_hash"] = c2.get("data_hash")
    for h in hl["highlights"]:
        z = idx[tuple(h["combo"])]["parts"]["zb"]; E = z.get("events") or []
        out["q"].append({"name": h["name"], "combo": h["combo"], "zb_n": h["readers"]["Q"]["zb_n"], "zb_hit": h["readers"]["Q"]["zb_hit"],
                         "stored": len(E), "stored_hit": sum(int(e[3]) for e in E), "events": [ev(e) for e in E]})
    json.dump(out, open(B / "peak-examples.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"20일 후보 사건 {sum(len(v['events']) for v in out['p20']['parts'].values())}건 · Q 조합 {len(out['q'])}개 사건 {sum(len(q['events']) for q in out['q'])}건 저장")


if __name__ == "__main__":
    main()
