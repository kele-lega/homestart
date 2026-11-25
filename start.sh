#!/bin/sh
# 本地预览：数据放在独立的 .preview/ 里（不碰线上用的 data/），第一次启动时自动建一个管理员账号。
# 按 Ctrl+C 或者关掉这个终端，预览就停了。
#
# 用法：./start.sh            开发模式，改了代码页面自动刷新
#       ./start.sh --built    跑 ./build.sh 编好的产物（和线上一样的运行方式，不会自动刷新）
#       ./start.sh --reset    清空 .preview/（账号、日程、偏好……），重新生成管理员密码
#       PORT=4400 ./start.sh  换端口（默认 4321）
set -eu
cd "$(dirname "$0")"
ROOT=$(pwd)

MODE=dev
RESET=0
for arg in "$@"; do
  case "$arg" in
    --built) MODE=built ;;
    --reset) RESET=1 ;;
    -h | --help)
      sed -n '2,9p' "$0"
      exit 0
      ;;
    *)
      echo "不认识的参数：$arg（./start.sh --help 看用法）" >&2
      exit 2
      ;;
  esac
done

PORT=${PORT:-4321}
LISTEN=127.0.0.1
DATA="$ROOT/.preview"
BUILT="$ROOT/dist/local/server/entry.mjs"

if [ ! -d node_modules ]; then
  echo '==> 第一次运行，安装依赖'
  npm ci
fi

if [ "$MODE" = built ] && [ ! -f "$BUILT" ]; then
  echo '还没有编译产物，先运行 ./build.sh' >&2
  exit 1
fi

# 端口被占着就直接说，不悄悄换一个
if node -e "require('node:net').connect($PORT, '$LISTEN').on('connect', () => process.exit(0)).on('error', () => process.exit(1))"; then
  echo "端口 $PORT 已经有程序在用。换一个：PORT=4400 ./start.sh" >&2
  exit 1
fi

if [ "$RESET" = 1 ]; then rm -rf "$DATA"; fi
mkdir -p "$DATA"
chmod 700 "$DATA"

# .env 里的 Key（Steam 之类）照常用；下面再把数据路径和会连到外部的几项改成本地的
if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# 管理员账号：第一次启动时生成密码，存在 .preview/admin.env（只有自己能读，不进 git）。
# 想自己定：第一次启动前 PREVIEW_ADMIN_USER=xxx PREVIEW_ADMIN_PASSWORD=xxx ./start.sh
CRED="$DATA/admin.env"
if [ ! -f "$CRED" ]; then
  if [ -f "$DATA/auth.db" ]; then
    echo '.preview/ 里有账号库，但管理员密码文件不见了。./start.sh --reset 重来一份' >&2
    exit 1
  fi
  generated=$(node -e "process.stdout.write(require('node:crypto').randomBytes(9).toString('base64url'))")
  (
    umask 077
    printf 'PREVIEW_ADMIN_USER=%s\nPREVIEW_ADMIN_PASSWORD=%s\n' "${PREVIEW_ADMIN_USER:-admin}" "${PREVIEW_ADMIN_PASSWORD:-$generated}" >"$CRED"
  )
fi
. "$CRED"

# 账号库是空的时候，服务端按这两个变量建管理员（之后改密码请在个人中心里改，并同步改 admin.env）
export INITIAL_ADMIN_USER="$PREVIEW_ADMIN_USER"
export INITIAL_ADMIN_PASSWORD="$PREVIEW_ADMIN_PASSWORD"

# 所有运行时数据都写进 .preview/
export AUTH_DB_FILE="$DATA/auth.db"
export ANNOUNCEMENTS_FILE="$DATA/announcements.json"
export AVATARS_DIR="$DATA/avatars"
export CALENDAR_EVENTS_FILE="$DATA/calendar-events.json"
export CALENDAR_SYNC_FILE="$DATA/calendar-sync.json"
export CALENDAR_USERS_FILE="$DATA/calendar-users.json"
export LINK_VISITS_FILE="$DATA/link-visits.json"
export PREFERENCES_FILE="$DATA/preferences.json"
export SITE_ICONS_DIR="$DATA/site-icons"
export SITE_STATS_FILE="$DATA/site-stats.json"
export STEAM_USERS_FILE="$DATA/steam-users.json"
export SUGGESTIONS_FILE="$DATA/suggestions.json"
export USER_LINKS_FILE="$DATA/user-links.json"

# 配置：.env 里指定了就用它；有 config.local/ 用自己的真实配置；都没有用仓库里的示例 config/
if [ -z "${CONFIG_DIR:-}" ]; then
  if [ -d config.local ]; then CONFIG_DIR="$ROOT/config.local"; else CONFIG_DIR="$ROOT/config"; fi
fi
export CONFIG_DIR

# 本地只认站内登录：不冒充开发用户、不信任反代头；
# 第三方登录、发验证邮件、人机验证的回调和域名都是线上的，本地关掉，免得真的发出邮件
export HOME_DEV_USER=''
export TRUST_PROXY_USER=''
export SITE_ORIGIN=''
export RESEND_API_KEY=''
export TURNSTILE_SITE_KEY=''
export TURNSTILE_SECRET_KEY=''

URL="http://localhost:$PORT/"
printf '\n\033[1;34m==> homestart 本地预览（%s）\033[0m\n' "$([ "$MODE" = dev ] && echo '开发模式' || echo '编译产物')"
printf '    地址      %s\n' "$URL"
printf '    旧版首页  %sclassic\n' "$URL"
printf '    管理员    %s / %s   （登录：%slogin）\n' "$PREVIEW_ADMIN_USER" "$PREVIEW_ADMIN_PASSWORD" "$URL"
printf '    普通用户  用管理员登录后，在 %saccount#users 里开一个\n' "$URL"
printf '    配置      %s\n' "$CONFIG_DIR"
printf '    数据      %s\n' "$DATA"
printf '\033[2m    按 Ctrl+C 或关掉终端即停止\033[0m\n\n'

if [ "$MODE" = dev ]; then
  # --ignore-lock：Astro 7 在检测到 AI 助手的终端里会自己转到后台运行，这里强制留在前台，关脚本才能一起关掉
  node_modules/.bin/astro dev --host "$LISTEN" --port "$PORT" --ignore-lock &
else
  HOST=$LISTEN PORT=$PORT node "$BUILT" &
fi
SERVER=$!

# 后台进程在 sh 里收不到 Ctrl+C：由这里转告它，并等它真的退出
stop() {
  trap - INT TERM HUP
  kill -TERM "$SERVER" 2>/dev/null || true
  wait "$SERVER" 2>/dev/null || true
  printf '\n已停止本地预览\n'
  exit 0
}
trap stop INT TERM HUP

wait "$SERVER" || true
