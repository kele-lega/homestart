# 登录系统

网站默认不需要登录也能用——不登录时，各模块按一个匿名身份运行（日历订阅、Steam 绑定等按用户隔离的功能会提示"未登录"，其余照常显示）。

登录系统是可选的一层：启用后，每个用户可以有自己的账号，分管理员和普通用户两种角色。它和反向代理注入的身份头（`X-Authenticated-User`，见 [DEPLOYMENT.md](DEPLOYMENT.md)）是两套独立机制——如果你的部署已经在用反向代理做 Basic Auth 之类的身份认证，可以不启用这套登录系统；两者也可以同时存在，登录会话优先。

## 存储

账号数据存在一个 SQLite 文件（Node 内置的 `node:sqlite`，不需要额外安装数据库），默认路径 `data/auth.db`，可以用环境变量 `AUTH_DB_FILE` 改。密码用 `scrypt` 哈希（Node 内置 `node:crypto`），不会以明文形式出现在任何地方。

同一个库里还有登录会话（Cookie 只存随机 token，库里只存它的哈希，重启不掉线）、第三方登录绑定和已删除的用户名。

头像：每个账号开通时随机定下一个种子，默认头像是按它画的 GitHub 风格 5×5 对称色块图，不能挑。用户可以在个人中心上传自己的图（浏览器里先居中裁成正方形、缩到 256×256 再传，服务端只收 PNG / JPG / GIF / WebP，最多 512 KB），存在 `AVATARS_DIR`（默认 `data/avatars/`），经 `/avatars/<文件名>` 提供；换头像、恢复默认、删账号时旧文件随即删掉。

## 创建第一个管理员账号

第一个管理员通过环境变量在启动时自动创建（之后普通用户可以自己注册，见下一节；管理员也能在个人中心直接开号）：

```bash
INITIAL_ADMIN_USER=admin INITIAL_ADMIN_PASSWORD=你的密码 npm run dev
```

只在账号表为空时生效（避免每次启动都尝试重新创建）。创建后可以把这两个环境变量从启动命令里去掉。

密码建议放进项目根目录的 `.env` 文件（这个文件已经在 `.gitignore` 里，不会被提交）：

```
INITIAL_ADMIN_USER=admin
INITIAL_ADMIN_PASSWORD=一个足够复杂的密码
```

## 注册与第三方登录

注册一直开放，没有审批开关。三种方式，各自独立，没配齐的那种直接不出现在页面上（接口回 503），其余照常：

| 方式 | 需要的环境变量 | 说明 |
|---|---|---|
| 邮箱注册（`/register`） | `RESEND_API_KEY`、`MAIL_FROM` | 先往邮箱发 6 位验证码（10 分钟有效，60 秒后才能重发），填对才建号；用户名 3-32 位小写字母、数字、`. _ -`，`admin` 之类冒充站方的名字不给 |
| GitHub 登录 | `SITE_ORIGIN`、`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` | 第一次登录自动建号，用户名按对方账号名自动生成 |
| Google 登录 | `SITE_ORIGIN`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | 同上 |

- 找回密码（`/forgot-password`）、个人中心换绑邮箱，和邮箱注册共用一套发信配置
- 第三方登录用的是授权码 + PKCE + state；拿到对方资料后对方的 token 就丢掉，不存
- **不会按邮箱自动合并账号**：同一个邮箱先邮箱注册、后用 GitHub 登录，会被拒绝并提示去个人中心绑定，防止有人用别处的同名邮箱接管账号
- 个人中心「登录方式」可以绑定 / 解绑 GitHub、Google，换绑邮箱；只用第三方登录的账号可以在那里补设一个密码。解绑时至少要留一种登录方式
- 用户名注册后不能改（各模块的数据按它隔离）；昵称随便改

### 防刷

- 设了 `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` 时，发验证码前要过 Cloudflare Turnstile 人机验证；不设就只靠下面的限流
- 发验证码、注册、找回密码按来源 IP 限流；限流依赖反代传来的真实 IP，见 [DEPLOYMENT.md](DEPLOYMENT.md)
- 全站每天最多新注册 `SIGNUP_DAILY_LIMIT`（默认 50）个账号，最多发 `MAIL_DAILY_LIMIT`（默认 90）封信
- 发验证码的接口不管邮箱有没有注册过都回一样的结果，不能拿来探测谁注册了

### 申请第三方登录

回调地址都是 `<SITE_ORIGIN>/api/auth/oauth/<provider>/callback`，`SITE_ORIGIN` 是本站对外地址，必须是 https（`localhost` 除外），不带结尾斜杠。

- **GitHub**：Settings → Developer settings → OAuth Apps → New OAuth App。Homepage URL 填 `SITE_ORIGIN`，Authorization callback URL 填 `<SITE_ORIGIN>/api/auth/oauth/github/callback`
- **Google**：Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID（Web application）。Authorized redirect URIs 填 `<SITE_ORIGIN>/api/auth/oauth/google/callback`；OAuth consent screen 只要 `openid`、`email`、`profile` 三个范围，发布状态改成「正式」，否则只有测试用户能登录

### 发信（Resend）

在 [Resend](https://resend.com) 添加发信域名，按提示把 DNS 记录加到域名解析里，验证通过后建一个只有发信权限的 API Key 填进 `RESEND_API_KEY`。`MAIL_FROM` 写成 `homestart <noreply@你的域名>`，域名要和验证过的一致。

### Turnstile

Cloudflare 控制台 → Turnstile → 添加站点，域名填本站域名，模式选「托管」，把站点密钥和私钥分别填进 `TURNSTILE_SITE_KEY`、`TURNSTILE_SECRET_KEY`。

## 使用

- 页面右上角是登录入口；登录页可以用户名或邮箱 + 密码登录，也可以点 GitHub / Google，底下有「注册账号」「忘记密码」
- 个人中心（`/account`）：头像、资料、登录方式、密码、登录设备；管理员多一块账号管理，能看到每个账号的邮箱和注册方式，可以新建账号、重置密码、删除账号（不能删除自己）。删掉的用户名以后不会再注册出去
- 普通用户登录后可以在 Steam、日历卡片里绑定自己的账号/订阅，数据按用户隔离

## API

如果需要脚本化操作（比如批量建号），登录系统的接口在 `/api/auth/`：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/auth/login` | POST | `{ username, password }`，成功后设置登录 Cookie |
| `/api/auth/logout` | POST | 清除登录会话 |
| `/api/auth/me` | GET | 当前登录状态，未登录返回 `data: null` |
| `/api/auth/signup/code` | POST | `{ email, turnstile }` 发注册验证码 |
| `/api/auth/signup` | POST | `{ email, code, username, password, remember }` 验证码对了才建号，成功后直接登录 |
| `/api/auth/forgot/code` | POST | `{ email, turnstile }` 发找回密码验证码 |
| `/api/auth/forgot` | POST | `{ email, code, password }` 重设密码，该账号别处的登录全部失效 |
| `/api/auth/oauth/:provider` | GET | 跳去 GitHub / Google 授权；`?mode=link` 是给已登录账号绑定，`?remember=1` 记住登录 |
| `/api/auth/oauth/:provider/callback` | GET | 授权回调，结果用 `?notice=` 带回登录页或个人中心 |
| `/api/account/email/code` | POST | `{ email }` 往新邮箱发换绑验证码（需登录） |
| `/api/account/email` | PUT | `{ email, code }` 换绑邮箱（需登录） |
| `/api/account/identities/:provider` | DELETE | 解绑第三方登录，至少要留一种登录方式（需登录） |
| `/api/account/avatar` | PUT | `{ image }` 上传头像，base64（可带 `data:image/...;base64,` 前缀）；返回 `{ avatar }` |
| `/api/account/avatar` | DELETE | 换回默认色块头像 |
| `/api/account/password` | POST | `{ current, next }` 改密码；还没设过密码时 `current` 传空串 |
| `/api/auth/users` | GET | 列出所有账号（仅管理员） |
| `/api/auth/users` | POST | `{ username, password, role }` 新建账号（仅管理员） |
| `/api/auth/users/:id` | PUT | `{ password }` 重置密码（仅管理员） |
| `/api/auth/users/:id` | DELETE | 删除账号（仅管理员，不能删自己） |

所有接口只接受同源请求（校验 `Sec-Fetch-Site`；第三方登录的回调例外，靠 state 防伪造），登录、注册、发验证码额外按来源 IP 限流。
