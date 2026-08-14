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
    """top-level current 값으로 hist 한 줄을 직렬화한다.
    사용자가 실제로 본 카드와 당일 hist가 절대 갈라지지 않게 하기 위한 것."""
    return [r.get(f) for f in HIST_FIELDS]
```

`HIST_FIELDS`의 순서를 그대로 따르므로 스키마가 바뀌어도 자동으로 맞습니다.
top-level 키 이름이 `HIST_FIELDS`와 다른 항목이 있으면 그 항목만 매핑을 추가하세요.

### 2) 당일 행 생성부 교체

**찾을 곳** — `freeze_signal_hist()` 안에서 오늘 행을 고르는 부분

```python
cur = (r.get("hist") or [])[-1] if (r.get("hist") or []) else None
```

**바꿀 내용**

```python
# 오늘 hist는 analyze()가 따로 계산한 snap(-1)을 믿지 않는다.
# 화면 카드에 쓰는 current row를 그대로 직렬화해서 넣는다.
cur = hist_row_from_current(r)
```

### 3) append 조건은 그대로

```python
if last_date and last_date not in seen:
    old_hist.append(cur)          # ← 위에서 만든 current 기반 행
```

`last_date`가 이미 `seen`에 있으면 append하지 않는 기존 로직을 그대로 둡니다.
같은 날 재실행에서도 첫 확정값이 보존됩니다.

## 이 패치가 하지 않는 것

- 과거 행은 건드리지 않습니다. 8/12 LHX처럼 이미 frozen된 값은 그대로 남습니다
- 점수나 등급을 저장하지 않습니다. 저장하는 건 지표 원본값뿐이고, 채점은 `evaluate()` 하나가 계속 담당합니다
- `FORCE_RESNAP`, `us`/`kr` 스코프 로직은 그대로입니다

## 확인 방법

다음 실행 후, 아무 종목이나 골라 `signals.json`에서

- top-level `price / rsi / macd / bb / stoch / vol_ratio / ma / atr_pct / rs20`
- `hist[-1]`의 같은 필드

두 값이 **완전히 일치**하면 성공입니다. 하나라도 다르면 `HIST_FIELDS`와 top-level 키 이름이
어긋난 항목이 있는 것이므로 그 항목만 매핑을 추가하면 됩니다.
