"""pytest 公共装置：把 `scripts/` 放进 import 路径。

仓库里的检查器都是「脚本 + `if __name__ == "__main__"`」，本身可以安全 import
（导入时只定义函数与常量，不跑检查、不联网）。测试直接调用它们的纯函数，
不必把脚本改成包。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return ROOT


@pytest.fixture(scope="session")
def content_dir(repo_root: Path) -> Path:
    return repo_root / "content"
