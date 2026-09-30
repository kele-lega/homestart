# homestart

一个自用的个人主页，用 Astro + Svelte 重写。风格是活页手帐：milk-white 底色、樱花点缀，只在你动手操作时才有效果。

界面上有时钟、搜索（本地网站 + 网络搜索）、天气、日历（订阅 ICS）、今日日程、Deadline 倒数、常用网站、Steam 最近游玩、分类导航，外加一套简单的登录系统（管理员/普通用户）。每个模块（这个项目里叫 Widget）都是独立目录，加新模块不需要改别的文件。

## 技术栈

- [Astro](https://astro.build/) 7（`output: 'server'`，按需渲染，配置文件运行时读取）
- [Svelte](https://svelte.dev/) 5（只用在需要交互的部分：搜索、日历、登录）
- TypeScript，[Vitest](https://vitest.dev/) 单测，[Playwright](https://playwright.dev/) e2e
- 数据存储用 Node 内置的 `node:sqlite`（账号）和 JSON 文件（日历订阅、Steam 绑定），没有额外的数据库依赖
- Node 22.12+

## 快速开始

```bash
npm install
npm run dev
```

打开 <http://localhost:4321>。默认配置（`config/` 目录）是示例数据，看到的链接、天气坐标都不是真的，改成你自己的内容见下面的[配置](#配置)。

本地开发时，因为没有反向代理注入登录身份头，网站会把你当成匿名用户。如果你想在本地调试"已登录"状态相关的功能（不是本项目内置的登录系统，是指日历订阅、Steam 绑定这类按用户隔离的旧机制），设置：

```bash
HOME_DEV_USER=你的用户名 npm run dev
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 本地开发服务器 |
| `npm run check` | 类型检查（Astro + Svelte），有警告就算失败 |
| `npm run build` | 先 `check` 再构建到 `dist/` |
| `npm run preview` | 预览已构建的产物 |
| `npm start` | 生产模式启动（读 `dist/server/entry.mjs`） |
| `npm test` | 跑单元测试（Vitest） |
| `npm run coverage` | 单元测试 + 覆盖率报告 |
| `npm run test:e2e` | 构建一份 e2e 专用产物，跑 Playwright 端到端测试 |

## 配置

所有个性化内容在 `config/` 目录，改完刷新页面即生效（不用重新构建）：

- `config/site.yaml` — 站点标题、时区、语言、背景图
- `config/links.yaml` — 常用网站、分类导航的链接
- `config/layout.yaml` — 页面上有哪些模块、怎么排布

具体每个字段的含义，见 [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md)。

## 登录系统

网站默认不需要登录也能用。想启用管理员/普通用户的账号系统（比如你想让每个用户自己绑定 Steam 账号、订阅自己的日历），需要设置两个环境变量创建初始管理员，然后在页面右上角的"登录"入口操作。细节见 [`docs/AUTH.md`](docs/AUTH.md)。

## Steam 模块

Steam 卡片需要一个 Steam Web API Key（服务端环境变量，不进代码库）。没配置时卡片会提示"服务器还没有配置 Steam API Key"，这是正常状态，不是故障。申请方式和环境变量设置见 [`docs/STEAM.md`](docs/STEAM.md)。

## 部署

生产环境的部署方式、需要的环境变量、Docker/反向代理相关的注意事项，见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 项目结构

```
config/          站点配置（会被运行时读取，不参与构建）
src/
  core/          布局/配置解析、Widget 契约、API 路由的共用逻辑
  adapters/      服务端专属：外部 API 调用、文件/数据库存储，不会打进浏览器包
  widgets/       每个模块一个目录：widget.ts（数据+校验）+ View.astro（展示）
  zones/         页面骨架：页头、区域网格、卡片外框
  components/    跨模块共享的 UI 组件
  lib/           浏览器和服务端都能用的纯函数
  client/        浏览器端脚本（主题切换、搜索快捷键等）
e2e/             Playwright 端到端测试
tests/           Vitest 单元测试，目录结构对应 src/
```

新增一个 Widget：在 `src/widgets/<type>/` 下新建目录，写 `widget.ts`（用 `defineWidget` 声明配置 schema 和数据加载）和 `View.astro`（展示），再在 `config/layout.yaml` 里加一个实例。不需要改动任何已有文件，注册表按目录名自动发现。

## 测试

```bash
npm test              # 单元测试
npm run coverage       # 单元测试 + 覆盖率
npm run test:e2e      # 端到端测试（会先构建一份独立产物到 dist/e2e）
```

e2e 测试用固定的测试配置（`e2e/fixtures/`），不会连真实网络，也不会用到你 `config/` 里的真实内容。
