#!/bin/bash
set -u

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_PORT=8000
PORT="$BASE_PORT"

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 Python 3。请先从 https://www.python.org/downloads/ 安装 Python 3。"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

while [ "$PORT" -le 8010 ]; do
  if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  PORT=$((PORT + 1))
done

if [ "$PORT" -gt 8010 ]; then
  echo "端口 8000 到 8010 均已被占用，请关闭其他服务后重试。"
  read -r -p "按回车键关闭窗口..."
  exit 1
fi

URL="http://127.0.0.1:$PORT/"
echo "正在启动自建房资料服务：$URL"
echo "文档中心：${URL}docs/"
echo "实景别墅模型：${URL}villa-3d/"
echo "日照模拟页面：${URL}sunlight-3d/"
echo "关闭此窗口即可停止服务。"
open "$URL" 2>/dev/null || true
cd "$ROOT_DIR" || exit 1
python3 -m http.server "$PORT" --bind 127.0.0.1
