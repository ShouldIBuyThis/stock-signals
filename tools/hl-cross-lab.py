"""신고가·신저가 선 교차 뒤 신고가 수가 늘어나나 · QQQ가 오르나 (읽기 전용 · 산식 반영 없음)

왜 (2026-11-07 사용자: "두 선이 교차한 뒤 신고가 종목 수가 증가하는 패턴이 반복되는 것 같아 — 단순 교차 · 신저가 우세→신고가 우세 전환 ·
    신저가 감소와 신고가 증가 동시 발생을 구분해 과거 3년 검증 · 3/5/10/20일 신고가 수 증가 비율과 QQQ 상승 확률 · 둘 다 0인 교차 제외 · 평소와 비교")
데이터: backtest/breadth-history.json — 화면 그래프와 같은 값(관심종목 미국, 종가가 52주 최고가 1% 안 = 신고가권, 최저가 1% 안 = 신저가권), QQQ 종가.
정의(그날 t 종가까지 알 수 있는 값)
  d = 신고가 수 − 신저가 수.  '방향' = d의 부호(0은 방향 없음 → 직전 방향 유지)
  단순 교차   오늘 방향이 직전 방향과 반대(위·아래 모두). 전날 두 수가 모두 0이었으면 제외(0끼리 겹친 건 교차로 안 봄).
  상승 전환   단순 교차 중 신저가 우세(d<0) → 신고가 우세(d>0)
  동시 발생   상승 전환 ∧ 오늘 신저가 수 < 어제 ∧ 오늘 신고가 수 > 어제
  (참고) 하락 전환 = 신고가 우세 → 신저가 우세
결과: k일 뒤 신고가 수 > 오늘 신고가 수(증가 비율) · k일 뒤 QQQ 종가 > 오늘 종가(상승 확률) · k = 3/5/10/20
평소 = 같은 3년의 모든 날(둘 다 0인 날 제외). 사건이 며칠 연달아 몰리는 것을 보려고 '5일 안 중복 제거' 결과도 같이 낸다.
"""
import json, sys
ROOT = __file__.rsplit("/", 2)[0]
KS = (3, 5, 10, 20)

def main():
    d = json.load(open(f"{ROOT}/backtest/breadth-history.json", encoding="utf-8"))
    C = d["cols"]; iD, iH, iL, iQ = C.index("date"), C.index("nh"), C.index("nl"), C.index("qqq_close")
    R = [r for r in d["rows"] if r[iH] is not None and r[iL] is not None]
    N = len(R); start = max(1, N - 756 - 20)          # 3년(약 756거래일) + 결과 20일
    nh = [r[iH] for r in R]; nl = [r[iL] for r in R]; q = [r[iQ] for r in R]; dt = [r[iD] for r in R]
    sgn = lambda x: (x > 0) - (x < 0)
    last = [0] * N; cur = 0
    for i in range(N):
        s = sgn(nh[i] - nl[i]); last[i] = cur; cur = s or cur      # last[i] = i 전날까지의 마지막 방향
    ev = {"단순 교차": [], "상승 전환(신저가→신고가 우세)": [], "동시 발생(신저가↓·신고가↑)": [], "(참고) 하락 전환": [], "평소(모든 날)": []}
    for i in range(start, N - 20):
        if nh[i] == 0 and nl[i] == 0: continue
        ev["평소(모든 날)"].append(i)
        s = sgn(nh[i] - nl[i])
        if s == 0 or last[i] == 0 or s == last[i]: continue
        if nh[i - 1] == 0 and nl[i - 1] == 0: continue
        ev["단순 교차"].append(i)
        if s > 0:
            ev["상승 전환(신저가→신고가 우세)"].append(i)
            if nl[i] < nl[i - 1] and nh[i] > nh[i - 1]: ev["동시 발생(신저가↓·신고가↑)"].append(i)
        else:
            ev["(참고) 하락 전환"].append(i)
    days = ev["평소(모든 날)"]; mid = dt[days[len(days) // 2]]
    def stat(idx):
        out = []
        for k in KS:
            up_h = sum(nh[i + k] > nh[i] for i in idx); up_q = sum(q[i + k] is not None and q[i] is not None and q[i + k] > q[i] for i in idx)
            out.append((up_h / len(idx) * 100 if idx else None, up_q / len(idx) * 100 if idx else None))
        return out
    def dedup(idx, gap=5):
        o = []
        for i in idx:
            if not o or i - o[-1] >= gap: o.append(i)
        return o
    f = lambda v: "  —" if v is None else f"{v:3.0f}"
    print(f"■ 신고가·신저가 교차 · {dt[days[0]]}~{dt[days[-1]]} ({len(days)}거래일, 둘 다 0인 날 제외) · 관심종목 미국 · 앞/뒤 경계 {mid}")
    print("  칸 = k일 뒤 신고가 수 증가% / QQQ 상승%  (k = 3 · 5 · 10 · 20일)")
    base = stat(days)
    for nm, idx in ev.items():
        for tag, ix in (("", idx), (" · 5일 중복 제거", dedup(idx))):
            if nm.startswith("평소") and tag: continue
            st = stat(ix)
            cells = " · ".join(f"{k}일 {f(a)}%/{f(b)}%" for k, (a, b) in zip(KS, st))
            print(f"  {(nm + tag):<34} n={len(ix):<4} {cells}")
        if not nm.startswith("평소"):
            st = stat(idx)
            diff = " · ".join(f"{k}일 {st[j][0] - base[j][0]:+.0f}/{st[j][1] - base[j][1]:+.0f}" for j, k in enumerate(KS)) if idx else ""
            fr = [i for i in idx if dt[i] < mid]; bk = [i for i in idx if dt[i] >= mid]
            sf, sb = stat(fr), stat(bk)
            print(f"    평소 대비(%p, 신고가/QQQ) {diff}")
            print(f"    앞 반 n={len(fr)} 10일 {f(sf[2][0])}%/{f(sf[2][1])}% · 뒤 반 n={len(bk)} 10일 {f(sb[2][0])}%/{f(sb[2][1])}%"
                  f"  (평소 10일 {f(base[2][0])}%/{f(base[2][1])}%)")
    # 사례 목록(최근 상승 전환·동시 발생)
    print("\n  최근 동시 발생 사례 (날짜 · 신고가/신저가 전날→오늘 · 10일 뒤 신고가 · 10일 뒤 QQQ)")
    for i in ev["동시 발생(신저가↓·신고가↑)"][-12:]:
        print(f"    {dt[i]}  {nh[i-1]}/{nl[i-1]} → {nh[i]}/{nl[i]}  · 10일 뒤 신고가 {nh[i+10]} · QQQ {((q[i+10]/q[i]-1)*100):+.1f}%")

if __name__ == "__main__":
    main()
