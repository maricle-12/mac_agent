#!/bin/bash
# ============================================================
#  AI Edu Agent - macOS build script
#
#  在 macOS 上双击本文件即可构建 .app 与 .dmg。
#  （如果双击提示没有执行权限，在“终端”里执行一次：
#     chmod +x build_release_mac.command )
#
#  与 Windows 的 build_release.bat 对称：
#    1. 检查 Node（只要求**构建机**有；最终用户不需要装任何东西）
#    2. 缺少构建期依赖时自动 npm install
#    3. 调用 packaging/scripts/build-mac.mjs 完成全部 10 个步骤（含自检）
# ============================================================

set -u

# 切到脚本所在目录（双击时当前目录是用户主目录）
cd "$(dirname "$0")" || exit 1

echo "============================================================"
echo "  AI Edu Agent - macOS build"
echo "============================================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] 没有找到 Node.js。"
  echo "        Node.js 只需要装在**构建机**上（推荐 22 或以上）。"
  echo "        最终用户不需要安装 Node / Python / 任何环境。"
  echo "        下载地址：https://nodejs.org/"
  echo
  read -r -p "按回车键关闭…" _
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[ERROR] Node.js 版本过低（当前 $(node -v)，需要 22 或以上）。"
  echo "        原因：本地数据库使用 Node 内置的 node:sqlite（Node 22.5+ 才有）。"
  echo
  read -r -p "按回车键关闭…" _
  exit 1
fi

if [ ! -d "packaging/node_modules" ]; then
  echo "[1/2] 安装构建期依赖（esbuild / postject / resedit）…"
  ( cd packaging && npm install --no-audit --no-fund ) || {
    echo "[ERROR] 构建期依赖安装失败，请检查网络后重试。"
    read -r -p "按回车键关闭…" _
    exit 1
  }
fi

echo "[2/2] 构建 macOS 发行版（.app + .dmg，含发行包自检）…"
echo
node "packaging/scripts/build-mac.mjs"
STATUS=$?

echo
if [ "$STATUS" -eq 0 ]; then
  echo "构建完成。交付物在 release/ 目录里（见上面的路径）。"
else
  echo "[ERROR] 构建失败（退出码 $STATUS），请看上面的输出。"
fi
echo
read -r -p "按回车键关闭…" _
exit "$STATUS"
