#!/usr/bin/env bash
# 重新构建并重启 homestart（systemd 服务，见 /etc/systemd/system/homestart.service）。
# 先构建、后重启：构建期间旧服务照常在线；类型检查或构建失败就直接退出，不去动正在跑的服务
set -euo pipefail

SERVICE=homestart.service
PORT=4321
HEALTH_URL="http://127.0.0.1:${PORT}/"

cd "$(dirname "$0")"

# systemctl 需要 root；不是 root 时借 sudo
SUDO=()
if [[ $EUID -ne 0 ]]; then
  SUDO=(sudo)
fi

step() {
  printf '\n\033[1;34m==> %s\033[0m\n' "$1"
}

step '构建（astro check + svelte-check + astro build）'
npm run build

step "重启 ${SERVICE}"
"${SUDO[@]}" systemctl restart "$SERVICE"

step "等待 ${HEALTH_URL} 响应"
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null --max-time 2 "$HEALTH_URL"; then
    printf '\033[1;32m启动成功\033[0m\n'
    "${SUDO[@]}" systemctl status "$SERVICE" --no-pager --lines=0
    exit 0
  fi
  sleep 1
done

printf '\033[1;31m30 秒内没有响应，最近的日志：\033[0m\n' >&2
"${SUDO[@]}" journalctl -u "$SERVICE" -n 30 --no-pager >&2
exit 1
