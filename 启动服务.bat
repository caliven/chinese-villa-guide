@echo off
setlocal
cd /d "%~dp0"
set "PORT=18888"

where py >nul 2>nul
if %errorlevel%==0 (
  set "PYTHON=py -3"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo 未找到 Python 3。请先从 https://www.python.org/downloads/ 安装，并勾选 Add Python to PATH。
    pause
    exit /b 1
  )
  set "PYTHON=python"
)

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if not errorlevel 1 (
  echo 端口 %PORT% 已被占用，请关闭占用该端口的服务后重试。
  pause
  exit /b 1
)

echo 正在启动自建房资料服务：http://127.0.0.1:%PORT%/
echo 文档中心：http://127.0.0.1:%PORT%/docs/
echo 实景别墅模型：http://127.0.0.1:%PORT%/villa-3d/
echo 日照模拟页面：http://127.0.0.1:%PORT%/sunlight-3d/
echo 关闭此窗口即可停止服务。
start "" "http://127.0.0.1:%PORT%/"
%PYTHON% -m http.server %PORT% --bind 127.0.0.1
if errorlevel 1 (
  echo 服务启动失败，请检查 Python 3 安装。
  pause
)
endlocal
