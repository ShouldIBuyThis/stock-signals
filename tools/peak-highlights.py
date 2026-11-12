"""5차 교집합 연구에서 '검증 통과'(사전 등록 §12·§13 기준 · 미사용 자료 ZB) 조합만 뽑아 화면용 작은 파일로 만든다.
입력: backtest/peak-combo2.json(2회 결과) · backtest/peak-combo-diag.json(§14 진단). 출력: backtest/peak-highlights.json.
새 판정·새 문턱 없음 — 연구 결과 숫자를 그대로 옮긴다. 사용: python3 tools/peak-highlights.py
"""
import json
ROOT = __file__.rsplit("/", 2)[0]
src = json.load(open(f"{ROOT}/backtest/peak-combo2.json", encoding="utf-8"))
dg = {tuple(r["combo"]): r for r in json.load(open(f"{ROOT}/backtest/peak-combo-diag.json", encoding="utf-8"))["rows"]}
BN = src["blocks"]; STOCK_ONLY = lambda cb: not any(b.startswith("X_") for b in cb)
out = {}
for rd in ("Q", "F"):
    R = src["readers"][rd]; P = str(R["prim"])
    for c in R["cands"]:
        if c["verdict"] != "검증 통과": continue
        key = tuple(c["combo"]); e, z = c["parts"]["ex"], c["parts"]["zb"]
        h = out.setdefault(key, {"combo": list(key), "name": " ∩ ".join(BN[b] for b in key), "live": STOCK_ONLY(key), "readers": {}})
        h["readers"][rd] = {"ex": round(e[P]["w"], 3), "ex_hit": e[P]["hit"], "ex_n": e[P]["hit"] + e[P]["miss"], "ex_ind": e["ind"],
                            "zb": round(z[P]["w"], 3), "zb_r": round(z[P]["r"], 3), "zb_hit": z[P]["hit"], "zb_n": z[P]["hit"] + z[P]["miss"], "zb_ind": z["ind"], "zb_tickers": z["tickers"],
                            "base_zb": round(z["base"], 3) if z.get("base") is not None else None, "class": z.get("class"), "timing": z.get("timing"),
                            "trim5": z.get("trim5"), "hold5": z.get("hold5"), "trim_win5": z.get("trim_win5"), "h10": round(z["10"]["w"], 3) if rd == "Q" and z.get("10", {}).get("w") is not None else None}
        d = dg.get(key)
        if d:
            h["diag"] = {k: (None if not d.get(f"{k}|zb") else {"obs": round(d[f"{k}|zb"]["obs"], 3), "exp": round(d[f"{k}|zb"]["exp"], 3), "diff": round(d[f"{k}|zb"]["diff"], 3),
                                                                  "ci": [round(x, 3) for x in d[f"{k}|zb"].get("ci", [])] or None, "n": d[f"{k}|zb"]["n"]}) for k in ("Q20", "Q′20", "R20", "F5", "M5", "D5", "D20")}
            h["diag"]["beyond_vol"] = [k for k, v in d["beyond_vol"].items() if v]; h["atr_med_zb"] = d["atr_med"]["zb"]
L = sorted(out.values(), key=lambda h: -max(v["zb"] for v in h["readers"].values()))
res = {"generated": src["generated"], "kind": "research-highlight", "doc": "docs/2026-11-12-peak-combo.md §12·§13·§14",
       "rule": "미사용 자료(ZB)에서 사전 등록 검증 통과(독립 사건 30↑ · 적중률 65%↑ · 윌슨 하한 55%↑ · 평소 대비 +15%p · 부트스트랩 하한>0 · 종목·연도 편중 제한) 조합만",
       "defs": {"Q": "신호 뒤 형성된 고점 대비 20거래일 안 −10% 급락(신호일 고가 포함)", "F": "다음 날 시가 대비 5거래일 안 −3% 조정 도달"},
       "summary": {rd: src["readers"][rd]["summary"] | {"name": src["readers"][rd]["name"]} for rd in src["readers"]},
       "controls": {rd: [{"name": u["name"], "ex": u["parts"]["ex"][str(src["readers"][rd]["prim"])]["w"], "zb": u["parts"]["zb"][str(src["readers"][rd]["prim"])]["w"],
                          "zb_ind": u["parts"]["zb"]["ind"]} for u in src["readers"][rd]["user5"]] for rd in src["readers"]},
       "highlights": L}
json.dump(res, open(f"{ROOT}/backtest/peak-highlights.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(f"검증 통과 조합 {len(L)}개(화면 판정 가능 {sum(h['live'] for h in L)}) → backtest/peak-highlights.json")
for h in L: print(" ", h["name"], {k: (v["zb"], f"{v['zb_hit']}/{v['zb_n']}") for k, v in h["readers"].items()}, "live" if h["live"] else "외부조건")
