"""보존한 5분봉 원본 스냅샷(--keep-extra) → 실험용 정규봉 자료.
intraday-fetch.py 기본 동작과 같은 필터(국장 15:00 KST 이후 · 미장 16:00 ET 이후 봉 제거)만 적용한다. 값은 고치지 않는다.
사용: python tools/intraday-regular.py raw.json out.json
"""
import json, sys
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src))
drop = 0
for t, D in d.items():
    lim = 900 if t.endswith((".KS", ".KQ")) else 960
    keep = [b for b in D["bars"] if ((b[0] + b[6]) % 86400) // 60 < lim]
    drop += len(D["bars"]) - len(keep)
    D["bars"] = keep
json.dump(d, open(dst, "w"))
print(f"정규봉 변환: {len(d)}종목 · 제거한 비정규 봉 {drop}개")
