# 登录系统

网站默认不需要登录也能用——不登录时，各模块按一个匿名身份运行（日历订阅、Steam 绑定等按用户隔离的功能会提示"未登录"，其余照常显示）。

登录系统是可选的一层：启用后，每个用户可以有自己的账号，分管理员和普通用户两种角色。它和反向代理注入的身份头（`X-Authenticated-User`，见 [DEPLOYMENT.md](DEPLOYMENT.md)）是两套独立机制——如果你的部署已经在用反向代理做 Basic Auth 之类的身份认证，可以不启用这套登录系统；两者也可以同时存在，登录会话优先。

## 存储

账号数据存在一个 SQLite 文件（Node 内置的 `node:sqlite`，不需要额外安装数据库），默认路径 `data/auth.db`，可以用环境变量 `AUTH_DB_FILE` 改。密码用 `scrypt` 哈希（Node 内置 `node:crypto`），不会以明文形式出现在任何地方。

登录会话是服务端内存里的一张表（Cookie 只存一个不可预测的 session id），进程重启后所有人需要重新登录。

## 创建第一个管理员账号

没有公开注册入口——普通用户账号只能由管理员创建。第一个管理员通过环境变量在启动时自动创建：

```bash
INITIAL_ADMIN_USER=admin INITIAL_ADMIN_PASSWORD=你的密码 npm run dev
```

只在账号表为空时生效（避免每次启动都尝试重新创建）。创建后可以把这两个环境变量从启动命令里去掉。

密码建议放进项目根目录的 `.env` 文件（这个文件已经在 `.gitignore` 里，不会被提交）：

```
INITIAL_ADMIN_USER=admin
INITIAL_ADMIN_PASSWORD=一个足够复杂的密码
```

## 使用

- 页面右上角有一个"登录"入口，点击弹出登录框
- 登录后按钮换成用户名，管理员多一个"管理账号"入口
- "管理账号"面板可以：新建账号（选择角色）、重置某个账号的密码、删除账号（不能删除自己）
- 普通用户登录后可以在 Steam、日历卡片里绑定自己的账号/订阅，数据按用户隔离

## API

如果需要脚本化操作（比如批量建号），登录系统的接口在 `/api/auth/`：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/auth/login` | POST | `{ username, password }`，成功后设置登录 Cookie |
| `/api/auth/logout` | POST | 清除登录会话 |
| `/api/auth/me` | GET | 当前登录状态，未登录返回 `data: null` |
| `/api/auth/users` | GET | 列出所有账号（仅管理员） |
| `/api/auth/users` | POST | `{ username, password, role }` 新建账号（仅管理员） |
| `/api/auth/users/:id` | PUT | `{ password }` 重置密码（仅管理员） |
| `/api/auth/users/:id` | DELETE | 删除账号（仅管理员，不能删自己） |

所有接口只接受同源请求（校验 `Sec-Fetch-Site`），`/api/auth/login` 额外按来源 IP 限流，防止暴力猜密码。
