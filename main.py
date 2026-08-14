# main.py 패치 — 당일 hist를 current 카드값과 일치시키기

## 원칙

```
과거 frozen hist   = 그대로 유지 (소급 수정 금지)
오늘 새로 넣는 hist = current 카드 값으로 생성
```

## 문제

`freeze_signal_hist()`는 과거 행 덮어쓰기는 잘 막지만, **새 거래일을 처음 append할 때**
`r["hist"]`의 마지막 행(= `analyze()`가 별도로 계산한 `snap(-1)`)을 그대로 씁니다.
top-level current row와 계산 경로가 달라 두 값이 갈릴 수 있고, 그 상태가 그대로 frozen됩니다.
LHX 케이스가 이것입니다.

## 패치

`freeze_signal_hist()` 안, 당일 행을 append하기 직전에 **current row로 hist 한 줄을 직접 만들어** 씁니다.

### 1) 헬퍼 추가 — `freeze_signal_hist()` 정의 바로 위

```python
def hist_row_from_current(r):
    """오늘 카드에 쓰는 top-level 값을 hist 형식으로 직렬화."""
    return [
        r.get("last_date") if f == "date" else r.get(f)
        for f in HIST_FIELDS
    ]
```

**`date` 보정이 반드시 필요합니다.** `HIST_FIELDS`의 첫 필드는 `"date"`인데
top-level `row`는 `"last_date"`를 씁니다(`analyze()`가 hist를 만들 때만
`d_["date"] = d_.pop("last_date")`로 개명). 보정 없이 `r.get("date")`를 쓰면
첫 칸이 `None`이 되어 날짜 판정이 깨지고 append가 어긋납니다.

나머지 필드는 top-level과 `HIST_FIELDS`의 이름이 동일하므로 추가 매핑이 필요 없습니다.

### 2) 당일 행 생성부 교체

**찾을 곳** — `freeze_signal_hist()` 안에서 오늘 행을 고르는 부분

```python
cur = (r.get("hist") or [])[-1] if (r.get("hist") or []) else None
```

**바꿀 내용**

```python
# 오늘 hist는 analyze()가 따로 계산한 snap(-1)을 믿지 않는다.
# 화면 카드에 쓰는 current row를 그대로 직렬화해서 넣는다.
current_hist_row = hist_row_from_current(r)

if last_date and last_date not in seen:
    old_hist.append(current_hist_row)
    seen.add(last_date)
    appended_count += 1
```

`last_date`가 이미 `seen`에 있으면 append하지 않는 기존 로직을 그대로 둡니다.
같은 날 재실행에서도 첫 확정값이 보존됩니다.

## 이 패치가 하지 않는 것

- 과거 행은 건드리지 않습니다. 8/12 LHX처럼 이미 frozen된 값은 그대로 남습니다
- 점수나 등급을 저장하지 않습니다. 저장하는 건 지표 원본값뿐이고, 채점은 `evaluate()` 하나가 계속 담당합니다
- `FORCE_RESNAP`, `us`/`kr` 스코프 로직은 그대로입니다

## 패치가 먹었는지 한 번만 확인

다음 자동 갱신이 한 번 돈 뒤, `signals.json`에서 아무 종목(예: LHX) 하나를 골라
top-level과 `hist[-1]`을 비교합니다.

```
top-level:  last_date = 2026-08-14 · price = 291.20 · rsi = 51.4 · macd_hist = 1.23 ...
hist[-1] :  date      = 2026-08-14 · price = 291.20 · rsi = 51.4 · macd_hist = 1.23 ...
```

`last_date ↔ date`만 이름이 다르고 나머지 값이 전부 같으면 성공입니다.
특히 `hist[-1]`의 첫 칸이 `null`이 아닌 실제 날짜인지만 보면 `date` 보정이 제대로
들어갔는지 바로 갈립니다.

한 번 확인하고 나면 이후로는 볼 필요 없습니다. 구조상 current row를 복사하는 것이라
`date` 매핑만 맞으면 항상 같습니다.
