# 部署

## 构建与启动

```bash
npm run build   # 类型检查 + 构建到 dist/
npm start        # 等价于 node ./dist/server/entry.mjs
```

`npm start` 启动的是 `@astrojs/node` 的 standalone 模式，默认监听 `0.0.0.0:8080`，可以用环境变量覆盖：

```bash
PORT=4321 HOST=127.0.0.1 npm start
```

配置文件（`config/*.yaml`）在运行时读取，不参与构建：容器化部署时把 `config/` 挂载成一个卷，改配置不需要重新构建镜像，只要能改到磁盘上的文件、刷新页面就生效。

仓库里的 `config/` 是示例配置。部署自己的站点时建议 `cp -r config config.local`，在 `config.local/` 里改成自己的链接和入口，再在 `.env` 设 `CONFIG_DIR=config.local`。`config.local/` 已被 gitignore，`git pull` 也不会和你的改动冲突。

## 环境变量一览

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口（`@astrojs/node` standalone 模式） |
| `HOST` | `0.0.0.0` | 监听地址 |
| `CONFIG_DIR` | `config` | 配置文件目录，相对路径按当前工作目录解析 |
| `STEAM_API_KEY` | 无 | Steam Web API Key，见 [STEAM.md](STEAM.md)。不配置则 Steam 卡片显示未配置提示，不影响其他功能 |
| `WIDGET_ACTION_RATE_LIMIT` | `120` | 每用户每分钟允许的 Widget 操作请求数（搜索联想、保存设置等） |
| `CALENDAR_USERS_FILE` | `data/calendar-users.json` | 各用户日历订阅地址的存储文件路径 |
| `CALENDAR_EVENTS_FILE` | `data/calendar-events.json` | 各用户自己添加的日程的存储文件路径 |
| `CALENDAR_SYNC_FILE` | `data/calendar-sync.json` | 各用户「写回 Google 日历」的脚本地址和口令（等同于改日历的凭据，权限 0600） |
| `STEAM_USERS_FILE` | `data/steam-users.json` | 各用户绑定的 SteamID 存储文件路径 |
| `PREFERENCES_FILE` | `data/preferences.json` | 各用户在设置页改过的偏好的存储文件路径 |
| `LINK_VISITS_FILE` | `data/link-visits.json` | 各用户最近点开过的网站（常用网站按它排）的存储文件路径 |
| `USER_LINKS_FILE` | `data/user-links.json` | 各用户在设置页编辑的网站导航的存储文件路径 |
| `SITE_ICONS_DIR` | `data/site-icons` | 设置页抓取、上传的网站图标的存放目录 |
| `AVATARS_DIR` | `data/avatars` | 用户自己上传的头像的存放目录 |
| `ANNOUNCEMENTS_FILE` | `data/announcements.json` | 管理员在首页公告弹窗里发布的公告的存储文件路径 |
| `SITE_STATS_FILE` | `data/site-stats.json` | 首页「本站」版块导航、搜索次数的存储文件路径 |
| `SITE_HIT_RATE_LIMIT` | `60` | 每个账号（没登录按来源 IP）每分钟最多计几次导航 / 搜索，超出的不算 |
| `SUGGESTIONS_FILE` | `data/suggestions.json` | 登录用户在首页「本站」版块提交的建议的存储文件路径 |
| `AUTH_DB_FILE` | `data/auth.db` | 登录账号的 SQLite 文件路径，见 [AUTH.md](AUTH.md) |
| `INITIAL_ADMIN_USER` / `INITIAL_ADMIN_PASSWORD` | 无 | 首次启动时创建的管理员账号（账号表为空才生效），见 [AUTH.md](AUTH.md) |
| `SITE_ORIGIN` | 无 | 本站对外地址（如 `https://example.org`，不带结尾斜杠），拼第三方登录回调地址；不配就不开第三方登录，见 [AUTH.md](AUTH.md) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | 无 | GitHub OAuth App，配齐才出现「GitHub 登录」 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 无 | Google OAuth 客户端，配齐才出现「Google 登录」 |
| `RESEND_API_KEY` / `MAIL_FROM` | 无 | Resend 发信，配齐才能邮箱注册、找回密码、换绑邮箱 |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 无 | Cloudflare Turnstile 人机验证，不配就只靠按 IP 限流 |
| `SIGNUP_DAILY_LIMIT` | `50` | 全站每天最多新注册几个账号（邮箱注册和第三方自动建号合计） |
| `MAIL_DAILY_LIMIT` | `90` | 全站每天最多发几封验证码邮件（Resend 免费额度每天 100 封） |
| `TRUST_PROXY_USER` | 无 | 设成 `1` 才信任反代注入的 `X-Authenticated-User` 头，见下面的「反向代理与身份识别」。只用内置登录就不要设置 |
| `HOME_DEV_USER` | 无 | **仅本地开发用**：没有反代注入身份头时，把请求当成这个用户处理。生产环境绝不能设置 |

## 反向代理与身份识别

设置 `TRUST_PROXY_USER=1` 后，`src/core/api.ts` 里的 `userFrom` 会信任请求头 `X-Authenticated-User` 来识别用户（用于日历订阅、Steam 绑定这类按用户隔离的旧机制；内置登录系统的会话优先于这个头）。默认不信任，这个头直接被忽略。打开之前必须满足：

- 由反向代理在做完身份认证后注入这个头，应用本身不做认证
- 反向代理剥离/覆盖客户端自行发送的同名头
- Node 监听的端口不对外开放（`HOST=127.0.0.1` 或防火墙挡住），否则绕过反代直连端口就能伪造身份

一个用 Caddy 做 HTTP Basic Auth 的例子：

```caddyfile
your-domain.example {
    basic_auth {
        # AUTH_USERS 是空格分隔的“用户名 哈希”对
        {$AUTH_USERS}
    }

    reverse_proxy homepage:3000 {
        header_up X-Authenticated-User {http.auth.user.id}
    }
}
```

如果你不需要按用户隔离数据（日历、Steam 绑定这些），可以不配置这个头，网站会把所有人当成同一个匿名身份，其余功能不受影响。

如果你启用了内置的登录系统（见 [AUTH.md](AUTH.md)），它和反代身份头是独立的，二者可以只启用一个，也可以同时存在。

### 真实访客 IP

登录、注册、发验证码的限流和登录设备里记的 IP，取的是 `X-Forwarded-For` 的第一段。反代要**整个覆盖**这个头（不要追加），否则客户端自己带一个就能绕过限流。前面还有 Cloudflare 时，只对从 Cloudflare 回源的连接信它的 `CF-Connecting-IP`：

```caddyfile
your-domain.example {
    @cloudflare remote_ip 173.245.48.0/20 103.21.244.0/22 ...  # 完整列表见 https://www.cloudflare.com/ips/
    handle @cloudflare {
        reverse_proxy 127.0.0.1:4321 {
            header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
        }
    }
    handle {
        reverse_proxy 127.0.0.1:4321 {
            header_up X-Forwarded-For {http.request.remote.host}
        }
    }
}
```

## 数据与备份

以下路径存的是用户数据，不在代码库里，需要你自己决定持久化和备份策略：

- `data/`（或环境变量指定的路径）：日历订阅地址、Steam 绑定、登录账号数据库
- 这些文件包含等同于访问凭据的信息（日历订阅地址）和密码哈希，权限已经设置为仅所有者可读写（`0600`/`0700`，Windows 上无效），但仍需注意备份文件的访问控制

## 出站网络

- 天气数据来自 Open-Meteo（公开 API，无需 Key）
- Steam 数据来自 `api.steampowered.com`，封面图从 Steam CDN 直接在浏览器加载
- 日历订阅从用户自己填的 ICS 地址读取
- 搜索联想根据配置调用 Bing 等联想接口

如果服务器的出站网络受限，见 [STEAM.md](STEAM.md) 里关于代理配置的说明和风险提示。
