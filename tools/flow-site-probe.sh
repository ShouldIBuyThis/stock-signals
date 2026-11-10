#!/usr/bin/env bash
# 수급 사이트 이용 조건 확인(읽기 전용 · 데이터 수집 아님) — robots.txt · 약관/정책 페이지 · 화면에 적힌 출처·갱신·시장 범위 문구만 본다.
# 이 환경은 해당 호스트가 막혀 있어 CI(lab-quick)에서 돌린다. 사용: bash tools/flow-site-probe.sh
set -u
UA="Mozilla/5.0 (compatible; stock-signals-terms-check; one-off)"
clean(){ sed -e 's/<script[^>]*>.*<\/script>//g' -e 's/<[^>]*>/ /g' -e 's/&nbsp;/ /g' -e 's/  */ /g'; }
for H in https://stock.minemelon.com https://signals.kr https://www.mijangmap.com; do
  echo; echo "################ $H"
  echo "=== robots.txt"; curl -sS -m 20 -A "$UA" -w "\n[HTTP %{http_code}]\n" "$H/robots.txt" | head -60
  for P in /terms /terms-of-service /tos /policy /privacy /legal /about /disclaimer /이용약관; do
    c=$(curl -sS -m 15 -A "$UA" -o /tmp/pp.html -w "%{http_code}" "$H$P" 2>/dev/null); s=$(wc -c < /tmp/pp.html 2>/dev/null || echo 0)
    echo "  $P → HTTP $c · ${s}B"
    if [ "$c" = "200" ] && [ "$s" -gt 500 ]; then clean < /tmp/pp.html | grep -oiE ".{0,120}(약관|무단|크롤|스크랩|수집|복제|재배포|배포|상업|저작권|copyright|scrap|crawl|automated|redistribut|license|데이터 출처|출처).{0,160}" | sort -u | head -25; fi
  done
done
for U in "https://stock.minemelon.com/" "https://stock.minemelon.com/?indicator=UBM" "https://signals.kr/market/" "https://www.mijangmap.com/korea/flow"; do
  echo; echo "################ 화면 $U"
  c=$(curl -sSL -m 25 -A "$UA" -o /tmp/p.html -w "%{http_code}" "$U"); echo "HTTP $c · $(wc -c < /tmp/p.html)B"
  grep -oiE '<title>[^<]*</title>|<meta[^>]+(description|og:title)[^>]+>' /tmp/p.html | head -4
  grep -oiE 'href="[^"]*(terms|policy|privacy|about|legal|약관|정책|disclaimer)[^"]*"' /tmp/p.html | sort -u | head
  clean < /tmp/p.html | grep -oiE ".{0,100}(약관|무단|수집|재배포|저작권|copyright|©|출처|KRX|한국거래소|NXT|넥스트레이드|코스콤|koscom|갱신|업데이트|분 간격|잠정|가집계|금융투자|투신|사모|연기금|기금|프로그램|외국인|기관|과거|히스토리).{0,120}" | sort -u | head -40
done
