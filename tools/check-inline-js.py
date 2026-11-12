#!/usr/bin/env python3
"""index.html 안의 <script> 블록을 꺼내 node --check로 문법 검사(브라우저 스크립트 문법 오류를 배포 전에 잡는다)."""
import re, subprocess, sys, tempfile
from pathlib import Path
src = (Path(__file__).resolve().parent.parent / "index.html").read_text(encoding="utf-8")
blocks = [b for b in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", src, flags=re.S) if b.strip()]
bad = 0
for i, b in enumerate(blocks):
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f: f.write(b); p = f.name
    r = subprocess.run(["node", "--check", p], capture_output=True, text=True)
    if r.returncode: bad += 1; print(f"::error::index.html <script> #{i + 1} 문법 오류\n{r.stderr[-800:]}")
print(f"inline script {len(blocks)}개 · 문법 오류 {bad}")
sys.exit(1 if bad else 0)
