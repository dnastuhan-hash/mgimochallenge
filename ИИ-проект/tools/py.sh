#!/usr/bin/env sh
# Переносимый запуск Python для хуков и MCP: Linux, macOS, Git Bash на Windows.
# Берёт первый интерпретатор, который реально запускается (заглушка Microsoft Store «python3» отсеивается).
for p in python3 python py; do
  if command -v "$p" >/dev/null 2>&1 && "$p" -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)" >/dev/null 2>&1; then
    PYTHONUTF8=1 exec "$p" "$@"
  fi
done
echo "Python 3.11+ не найден (python3 / python / py)" >&2
exit 1
