#!/bin/sh
# 本地编译：类型检查 → 单元测试 → 构建到 dist/local/（不碰线上用的 dist/client、dist/server）。
# 编好之后用 ./start.sh --built 跑起来看。任何一步失败就停下，不会留下半截产物。
#
# 用法：./build.sh          检查 + 单测 + 构建
#       ./build.sh --e2e    再跑一遍端到端测试（用本机的 Chrome，约 3 分钟）
#       ./build.sh --fast   跳过检查和单测，只构建
set -eu
cd "$(dirname "$0")"

E2E=0
FAST=0
for arg in "$@"; do
  case "$arg" in
    --e2e) E2E=1 ;;
    --fast) FAST=1 ;;
    -h | --help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "不认识的参数：$arg（./build.sh --help 看用法）" >&2
      exit 2
      ;;
  esac
done

step() {
  printf '\n\033[1;34m==> %s\033[0m\n' "$1"
}

if [ ! -d node_modules ]; then
  step '安装依赖'
  npm ci
fi

if [ "$FAST" = 0 ]; then
  step '类型检查（astro check + svelte-check）'
  npm run check
  step '单元测试'
  npm test
fi

step '构建到 dist/local/'
rm -rf dist/local
node_modules/.bin/astro build --outDir dist/local

if [ "$E2E" = 1 ]; then
  step '端到端测试'
  npm run test:e2e
fi

printf '\n\033[1;32m编译完成\033[0m，运行 ./start.sh --built 预览\n'
