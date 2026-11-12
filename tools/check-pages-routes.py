#!/usr/bin/env python3
"""backtest/*.json을 main에 커밋하는 워크플로가 모두 사이트 배포 경로를 갖는지 점검.
- update.yml은 스스로 배포한다. 그 밖에 'git add backtest/…' + push 하는 워크플로는 pages-static.yml의 workflow_run 목록에 이름이 있어야 한다
  (GITHUB_TOKEN 커밋은 push 이벤트를 만들지 않아 정적 배포가 안 돌기 때문)."""
import re, sys
from pathlib import Path
import yaml
W = Path(__file__).resolve().parent.parent / ".github" / "workflows"
ps = yaml.safe_load((W / "pages-static.yml").read_text(encoding="utf-8"))
on = ps.get("on") or ps.get(True)
listed = set((on.get("workflow_run") or {}).get("workflows") or [])
miss = []
for f in sorted(W.glob("*.yml")):
    if f.name in ("update.yml", "pages-static.yml"): continue
    t = f.read_text(encoding="utf-8")
    if re.search(r"git add[^\n]*backtest/", t) and "git push" in t:
        name = yaml.safe_load(t).get("name")
        if name not in listed: miss.append(f"{f.name} ({name})")
print(f"배포 경로 점검: 목록 {len(listed)}개 · 빠진 워크플로 {len(miss)}")
for m in miss: print(f"::error::pages-static.yml workflow_run 목록에 없음: {m}")
sys.exit(1 if miss else 0)
