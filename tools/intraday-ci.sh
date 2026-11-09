#!/usr/bin/env bash
# 장중 모드 CI 점검 — ① 배포된 Worker 실제 연결(CORS 포함) ② 60일 과거 시험. lab-quick.yml의 cmd로 돌린다.
set -u
W="${INTRADAY_WORKER:-https://stock-intraday.zzz797911.workers.dev/}"
echo "=== ① Worker 연결 (Origin: https://shouldibuythis.github.io) ==="
for T in NVDA 005930.KS; do
  curl -sS -m 20 -D /tmp/h.txt -H "Origin: https://shouldibuythis.github.io" "${W}?t=${T}" -o /tmp/w.json
  grep -i "^HTTP\|access-control-allow-origin\|x-cache\|cache-control" /tmp/h.txt | tr -d '\r'
  python3 - "$T" <<'PY'
import json, sys, time
d = json.load(open("/tmp/w.json")); now = int(time.time())
if "error" in d: print(sys.argv[1], "오류:", d["error"]); sys.exit(0)
b = d["bars"]; print(f'{sys.argv[1]} 봉 {len(b)}개 · tz {d["tz"]} · 마지막 봉 시작 {time.strftime("%m-%d %H:%M", time.gmtime(b[-1][0]+d["gmtoffset"]))} · 마지막 체결 {time.strftime("%m-%d %H:%M", time.gmtime(d["lastTrade"]+d["gmtoffset"]))} · 체결 후 {round((now-d["lastTrade"])/60)}분 · 서버 수신 {round((now-d["fetchedAt"])/60)}분 전 · 정규장 {time.strftime("%H:%M", time.gmtime(d["reg"]["start"]+d["gmtoffset"]))}~{time.strftime("%H:%M", time.gmtime(d["reg"]["end"]+d["gmtoffset"]))}')
PY
done
echo; echo "=== ② 60일 과거 시험 ==="
python tools/intraday-fetch.py --out /tmp/i5.json && node tools/intraday-mtf-lab.js /tmp/i5.json
