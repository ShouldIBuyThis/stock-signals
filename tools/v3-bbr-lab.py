"""거래량 3배 급증 + 볼밴 상단 재진입(밖→안) 동시 발생 — 10·20·60일 하락 확률과 −25% 폭락 확률 (읽기 전용 · 산식 변경 없음)

왜 (2026-11-06 사용자: "거래량 3배 급증과 볼밴 상단 재진입이 동시에 발생했을 때 10·20·60일 하락 확률과 −25% 폭락 확률을 별도로,
    기존 3중 조합(27%, 11건)과 비교, 표본 수와 최근 기간 성적도")
정의(chart-pattern-lab.py top3_mask와 같은 재료, 신호일 종가까지)
  V3   직전 5거래일(t 제외) 안 거래량이 20일 평균 3배↑   ·  BBR  어제 볼밴(20,2σ) 상단 밖 → 오늘 안
  LOW  종가 < 전일 저가   ·  과열 맥락  최근 10일 RSI≥70 · 52주 고가 5% 안 · 60일 상승 ≥ max(30%, 진폭 8배)
결과(진입 = 다음 날 시가): 하락 = n일 뒤 종가 < 진입가 · −25% 폭락 = n일 안 저가가 진입가 −25% 이하
같은 종목·같은 조건 10일 쿨다운 · 관심종목 89개 10년 · 앞/뒤 반 · 최근 20%
"""
import importlib.util, sys
import numpy as np, pandas as pd
ROOT = __file__.rsplit("/", 2)[0]
sys.path.insert(0, ROOT)
def _load(name, fn):
    s = importlib.util.spec_from_file_location(name, f"{ROOT}/tools/{fn}"); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m
tr = _load("tr", "theme-research.py"); ss = _load("ss", "signal-stats.py"); cc = _load("cc", "candle-context-lab.py")
NS, COOL = (10, 20, 60), 10

def main():
    wl = ss.watchlist(); rows = []
    for tk in wl:
        df = tr.fetch(tk)
        if df is None or len(df) < 320: continue
        o, h, l, c, v = (df[k].to_numpy(float) for k in ("Open", "High", "Low", "Close", "Volume"))
        N = len(c); dates = [str(d.date()) for d in df.index]
        Kc, Z, R, *_ = cc.features(o, h, l, c)
        u = pd.Series((h - l) / c).rolling(60).median().to_numpy()
        vs = pd.Series(v).rolling(20).mean().to_numpy(); vr = v / np.where(vs > 0, vs, np.nan)
        hi250 = pd.Series(h).rolling(250, min_periods=120).max().to_numpy(); rmax10 = pd.Series(R).rolling(10).max().to_numpy()
        last = {}
        for i in range(260, N - 61):
            V3 = bool(np.nanmax(vr[i - 5:i]) >= 3); BBR = bool(Z["OUT_UP"][i - 1] and not Z["OUT_UP"][i]); LOW = c[i] < l[i - 1]
            hot = (not np.isnan(u[i])) and rmax10[i] >= 70 and c[i] >= 0.95 * hi250[i - 1] and c[i] / l[i - 60:i + 1].min() - 1 >= max(0.30, 8 * u[i])
            tags = []
            if BBR: tags.append("볼밴 복귀만(전체)")
            if V3 and BBR: tags.append("거래량3배+볼밴 복귀(전체)")
            if hot: tags.append("과열 맥락 전부")
            if hot and V3 and BBR: tags.append("과열+거래량3배+볼밴 복귀")
            if hot and V3 and BBR and LOW: tags.append("과열+3중(기존 27%)")
            if not tags: continue
            e = o[i + 1]; res = {}
            for n in NS:
                res[f"dn{n}"] = c[i + n] < e; res[f"cr{n}"] = l[i + 1:i + 1 + n].min() / e - 1 <= -0.25; res[f"r{n}"] = (c[i + n] / e - 1) * 100
            for tg in tags:
                if i - last.get(tg, -999) < COOL: continue
                last[tg] = i; rows.append(dict(tag=tg, d=dates[i], **res))
    ds = sorted({r["d"] for r in rows}); mid, cut = ds[len(ds) // 2], ds[int(len(ds) * 0.8)]
    tier = lambda n: "사용" if n >= 50 else "방향" if n >= 30 else "참고" if n >= 15 else "희귀" if n >= 10 else "불가"
    print(f"■ 거래량 3배 + 볼밴 상단 재진입 · {ds[0]}~{ds[-1]} · 관심종목 {len(wl)}개 · 다음 날 시가 · 앞/뒤 경계 {mid} · 최근 20% {cut}~")
    print("  칸 = n일 뒤 하락 확률(종가<진입가) · n일 안 −25% 폭락 확률 · n일 평균 수익 · 60일 −25% 폭락 앞/뒤/최근 20%")
    for tg in ("볼밴 복귀만(전체)", "거래량3배+볼밴 복귀(전체)", "과열 맥락 전부", "과열+거래량3배+볼밴 복귀", "과열+3중(기존 27%)"):
        rr = [r for r in rows if r["tag"] == tg]
        if not rr: print(f"    {tg:<22} 표본 0"); continue
        p = lambda k, a=rr: np.mean([x[k] for x in a]) * 100 if a else float("nan")
        fr, bk, rc = [x for x in rr if x["d"] < mid], [x for x in rr if x["d"] >= mid], [x for x in rr if x["d"] >= cut]
        print(f"    {tg:<22} n={len(rr):<5}[{tier(len(rr))}] 하락 {p('dn10'):3.0f}/{p('dn20'):3.0f}/{p('dn60'):3.0f}% · −25% {p('cr10'):3.0f}/{p('cr20'):3.0f}/{p('cr60'):3.0f}%"
              f" · 수익 {np.mean([x['r10'] for x in rr]):+.1f}/{np.mean([x['r20'] for x in rr]):+.1f}/{np.mean([x['r60'] for x in rr]):+.1f}%"
              f" · 60일 −25% 앞 {p('cr60', fr):.0f}%({len(fr)}) 뒤 {p('cr60', bk):.0f}%({len(bk)}) 최근 {p('cr60', rc):.0f}%({len(rc)})"
              f" · 최근 60일 하락 {p('dn60', rc):.0f}%")

if __name__ == "__main__":
    main()
