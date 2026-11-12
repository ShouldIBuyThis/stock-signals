"""20일 종가 하락 연구 후보(고점권 ∩ 신고가 돌파 실패 ∩ 스토캐스틱 과열권 데드 ∩ 20일선 이탈 ∩ 테마 약화) 과거 사례 재현.

2026-11-12 사용자 지시: '실제 과거 사례 재현'. 연구(peak-combo-lab.py --only P)가 잡은 탐색·미사용 사건 35건 각각에 대해
  1) 연구에 쓴 바로 그 시세 스냅샷(peak-price-cache, 같은 data_hash)을 사건일까지만 잘라(미래 자료 제거)
  2) 사이트 운영 경로 그대로 — 1년치(251봉) pattern_flags.combo_blocks_now → main.restore_52w_blocks(2년치) —
  3) 사건일에 가격 조건 4개((P_RT5|P_H60)·C_FB·I_STO·K_20)가 켜지는지,
  4) 잘라낸 값이 전체 자료로 계산한 값과 같은지(미래 자료 누수 검사)를 본다.
테마 약화(X_T)는 사이트가 원장(pct_from_high)으로 계산하므로 2009~2023 사건은 원장이 없어 재현 대상이 아니다(연구 값 그대로).
산식을 새로 짜지 않는다 — 운영 함수(pattern_flags·main)를 그대로 부른다.
사용: python tools/p20-replay.py --cache pp.pkl --out backtest/peak-p20-replay.json"""
import argparse, json, pickle, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent; sys.path.insert(0, str(ROOT))
import pattern_flags as pf
import main as M

PRICE = ("C_FB", "I_STO", "K_20")


def lit(days, d):
    b = set(days.get(d, []))
    return bool(({"P_RT5", "P_H60"} & b) and set(PRICE) <= b), sorted(b)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--cache", required=True); ap.add_argument("--out", default=""); a = ap.parse_args()
    Z = pickle.load(open(a.cache, "rb")); data = Z["data"]; h = Z.get("data_hash")
    R = json.load(open(ROOT / "backtest/peak-p20.json", encoding="utf-8"))
    if R.get("data_hash") != h: print(f"⚠ 연구 해시 {R.get('data_hash')} ≠ 스냅샷 {h} — 비교 불가"); sys.exit(2)
    cand = [x for x in R["readers"]["P"]["cands"] if x["combo"] == ["P_RT5", "C_FB", "I_STO", "K_20", "X_T"]][0]
    wl = set(Z.get("orig") or [])
    rows = []
    for part in ("ex", "zb"):
        for e in cand["parts"][part]["events"]:
            t, d, sub, hit = e[0], e[1], e[2], e[3]; r = {"part": part, "ticker": t, "date": d, "set": sub, "hit20": hit, "on_site": t in wl}
            df = data.get(t)
            if df is None: r["err"] = "시세 없음"; rows.append(r); continue
            idx = [x.strftime("%Y-%m-%d") for x in df.index]
            if d not in idx: r["err"] = "사건일 봉 없음"; rows.append(r); continue
            j = idx.index(d); cut = df.iloc[: j + 1]
            o, hh, l, c, v = (cut[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
            # 사이트 1년치 경로(251봉 → 52주 블록 판정 보류) → 후보면 2년치로 52주 블록만 복구
            y1 = cut.iloc[-251:]; d1 = idx[max(0, j - 250): j + 1]
            blk = pf.combo_blocks_now(*(y1[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume")), d1, lev=1, ticker=t)
            r["na_1y"] = list(blk["na"])
            blk = M.restore_52w_blocks(t, blk, lev=1, fetch=lambda tk, _c=cut: _c.iloc[-504:])
            r["src52"] = blk.get("src52") or blk.get("na_reason") or ("1년치" if not blk.get("na") else "보류")
            r["site_ok"], r["site_blocks"] = lit(blk["days"], d)
            # 미래 자료 누수 검사: 전체 시세로 계산한 같은 날 블록과 비교(연구 정의 min52=251)
            fo, fh, fl, fc, fv = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
            F = pf.combo_blocks(fo, fh, fl, fc, fv, lev=1, ticker=t, min52=251); T = pf.combo_blocks(o, hh, l, c, v, lev=1, ticker=t, min52=251)
            r["leak_free"] = all(bool(F[k][j]) == bool(T[k][j]) for k in pf.COMBO_STOCK_BLOCKS)
            r["full_ok"] = bool((F["P_RT5"][j] or F["P_H60"][j]) and all(F[k][j] for k in PRICE))
            rows.append(r)
    n = len(rows); ok = sum(1 for r in rows if r.get("site_ok")); lf = sum(1 for r in rows if r.get("leak_free")); fo = sum(1 for r in rows if r.get("full_ok"))
    print(f"스냅샷 {h} · 사건 {n}건 · 사이트 경로 4개 가격 조건 재현 {ok}/{n} · 전체 자료 기준 {fo}/{n} · 미래 자료 누수 없음 {lf}/{n}")
    for r in rows:
        if not r.get("site_ok") or not r.get("leak_free") or r.get("on_site"):
            print(f"  {r['part']} {r['ticker']:6} {r['date']} 관심종목={'예' if r['on_site'] else '아니오'} 사이트={r.get('site_ok')} 52주={r.get('src52')} 누수없음={r.get('leak_free')} {r.get('err','')} 블록={','.join(r.get('site_blocks', []))}")
    if a.out:
        json.dump({"generated": R.get("generated"), "kind": "replay", "data_hash": h, "combo": cand["name"], "events": n, "site_ok": ok, "full_ok": fo, "leak_free": lf,
                   "note": "테마 약화(X_T)는 원장이 없는 과거라 연구 값 그대로 · 가격 조건 4개만 사이트 운영 함수로 재현", "rows": rows},
                  open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
