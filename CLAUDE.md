# stock-signals — 작업 규칙

한국어로 답한다. 사용자는 실제로 쓸 신뢰성 있는 사이트를 만들고 있다.
**숫자를 맞추려고 사용자를 속이지 않는다. 산식을 임의로 조작하지 않는다.**

## 0. 토큰 규칙 (제일 중요 — 매번 여기서 샌다)

이 저장소는 파일 몇 개가 비정상적으로 크다. **통째로 열면 그 세션은 끝난다.**

| 파일 | 크기 | 통째로 읽으면 |
|---|---|---|
| `signals.json` | 844KB | **≈211,000 토큰 — 절대 금지** |
| `index.html` | 347KB | **≈87,000 토큰 — 절대 금지** |
| `main.py` | 76KB | ≈19,000 토큰 — 구간만 |
| `docs/인수인계.md` | 43KB | ≈11,000 토큰 — 목차 grep 후 구간만 |
| `docs/승률-검증-방법론.md` | 36KB | ≈9,000 토큰 — §번호로 구간만 |

**대신 이렇게 한다**

```bash
grep -n "찾을것" index.html | head -20     # 위치부터 찾고
sed -n 3040,3110p index.html               # 그 구간만 본다
python3 -c "import json; d=json.load(open('signals.json')); ..."   # JSON은 항상 스크립트로
```

- 편집은 `Edit`(정확한 앵커) 또는 `python3 - <<'PY'` 문자열 치환. **`Write`로 큰 파일을 다시 쓰지 않는다.**
- **GitHub MCP `actions_list`·`list_commits` 등은 응답이 400KB씩 온다.** 한 번 호출로
  코드 수정 전체보다 많이 쓴다. `per_page`를 최소로 주고, 큰 응답이 파일로 떨어지면
  `python3 -c`로 필요한 필드만 뽑는다.
- 검증 도구는 결과를 **요약해서** 찍는다. 표본 목록 전체를 stdout에 쏟지 않는다.

## 1. 절대 규칙 — 원장은 불변

- `signals.json`의 `hist`와 `history/{us,kr}/YYYY-MM-DD.json`은 **append-only 원장**이다.
  "그날 우리가 실제로 본 것"이고, 소급 수정하면 사이트의 존재 이유가 사라진다.
- `hist`는 `HIST_FIELDS` 위치 기반 배열이다. **필드는 꼬리에만 덧붙인다.**
  중간 삽입·순서 변경은 저장된 전 구간을 어긋나게 한다.
- 이미 고정된 snapshot 파일은 고치지 않는다. 관심종목에서 뺀 티커는
  `RETIRED_TICKERS`로 허용하고, 새로 넣은 티커는 다음 새 거래일부터 자동 합류한다.
- 백테스트(`backtest/`)는 원장이 **아니다**. 소급 적용 결과이고 생존 편향이 있다.
  둘을 섞거나 나란히 비교하지 않는다.

## 2. 산식을 두 번 짜지 않는다

화면 판정은 전부 `index.html`의 `evaluate()` 하나다. 도구·백테스트는 그것을
**문자열로 추출해서** 쓴다(`docs/승률-검증-방법론.md §0`). 재구현하면 반드시 어긋난다.

새 분석 도구는 `tools/_harness.js`를 쓴다:

```js
const H = require('./_harness');            // extractFunction/extractConst/buildContext
const ctx = H.buildContext();               // evaluate() + 보조 함수가 올라간 vm 컨텍스트
```

`tools/*.js` 18개는 아직 각자 하네스 사본을 갖고 있다. **새로 만들 때만** 위를 쓰고,
기존 파일은 손댈 이유가 생겼을 때 옮긴다(대량 리팩터는 토큰만 쓴다).

## 3. 승률 판단 규칙 (`docs/승률-검증-방법론.md`)

숫자 하나로 컷을 정하지 않는다. 최소한 이 넷은 본다.

- **§2 반쪽 검증** — 기준선 자체가 국면에 따라 37%↔64%로 뒤집힌다.
  한쪽 반에서만 좋은 필터는 국면 산물이다.
- **§3 고원 vs 절벽** — 임계값 이웃 값도 같이 좋아야 한다.
- **§5-1 표본 등급** — 50+ 사용 가능 / 30~50 방향만 / 15~30 참고 / 15 미만 신뢰 불가.
- **지워지는 표본의 성적** — 컷은 그것이 **실제로 지는 표본을 지울 때만** 정당하다.

컷을 조인 뒤에는 반드시 `node tools/keepcases.js` — 사용자가 지목한 보존 사례
(COHR·NET·SNOW·SPCX·AAOI·IREN·GLD·SNDK·코스피·코스닥 등)를 잃지 않았는지 본다.
보존 목록에 임의로 추가하지 않는다.

## 4. 자주 반복한 실수 (같은 걸 또 하지 말 것)

- **"야후에 그 티커 없다"고 단정하지 말 것.** SKHY를 그렇게 판단해 뺐다가 틀렸다.
  진짜 원인은 신규 상장이라 30봉이 안 된 것이었다 → `PENDING_TICKERS`·`MIN_BARS_OVERRIDE`.
- **워치리스트에 추가하기 전에 `grep`으로 이미 있는지 본다.** 파이썬 dict는 중복 키를
  조용히 덮어써서 "개수 세기"로는 안 잡힌다. **리터럴 키를 grep**해야 한다.
- **`prev_*`는 출처가 하나여야 한다.** `analyze()`가 야후에서 다시 계산하면
  야후의 소급 수정 때문에 frozen snapshot과 어긋난다 → `sync_prev_from_hist()`가
  `hist[-2]`에서 채운다. 이 경로를 되돌리지 말 것.
- **게이트를 고칠 때 AND/OR 구조를 뒤집지 말 것**(§5-7). 승률표는 멀쩡해 보인다.

## 5. 검증 · 배포

```bash
python3 validate_signals.py --scope all     # 원장 정합성 (pip install exchange_calendars 필요)
node tools/keepcases.js                     # 보존 사례 회귀
node --check tools/무엇.js
```

- 브랜치: `claude/signal-rank-validation-consistency-7ih0l3`. main 푸시는 사용자가 허락한 범위에서만.
- Actions: `update.yml`(scope=all, force_resnap=false)이 데이터 갱신,
  `backtest-ticker-record.yml`이 종목별 백테스트 승률. 스케줄은 26~40분 지연된다.
- Pages는 main의 `index.html`을 바로 서빙한다 — **산식은 푸시 즉시 반영**되고
  워크플로우는 데이터만 새로 고친다.
- 이 환경은 야후가 프록시에 막혀 있다. 가격 조회가 필요한 작업은 CI에서만 된다.

## 6. 진행 상황

`docs/인수인계.md`가 세션 간 인수인계 문서다. 통째로 읽지 말고
`grep -n "^###" docs/인수인계.md`로 목차를 본 뒤 필요한 절만 `sed -n`으로 읽는다.
