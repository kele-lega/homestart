# 配置说明

所有配置文件在 `config/` 目录，YAML 格式，运行时读取（改完刷新页面即生效，不用重启或重新构建）。默认路径可以用环境变量 `CONFIG_DIR` 改（见 [DEPLOYMENT.md](DEPLOYMENT.md)）。

## site.yaml — 站点设置

```yaml
title: "我的主页"       # 浏览器标签页标题，也是页头 <h1>（仅读屏可见）
description: 个人主页    # <meta name="description">
favicon: /favicon.ico   # public/ 下的路径
lang: zh-CN
timezone: Asia/Shanghai  # 影响日历、Deadline、时钟的日期计算
# background: /images/background.png   # 页面背景图，放 public/ 下；不填则纯色背景
```

## links.yaml — 网站链接

```yaml
links:
  # 最简写法：不填 icon 就按网址域名自动取 favicon（一个 { } 写完一行）
  - { name: 哔哩哔哩, url: https://www.bilibili.com, category: fun, favorite: true }

  - name: GitHub
    url: https://github.com
    icon: /icons/github.svg        # 可选。不填就按域名自动取；填了就用手填的这个（public/ 下的路径，或 https 图片地址）
    iconDark: /icons/github-light.svg   # 深色主题下用的图标（深色图形在深色底上看不清时才需要）
    description: Where the world builds software   # 显示在常用网站卡片里的小字
    category: dev                  # 对应 categories 的 id；不填则只参与搜索，不出现在分类导航
    favorite: true                 # 常用网站卡片的备选：最近点开的不够数时用它补上
    keywords: [gh]                 # 额外的搜索关键词，比如拼音缩写

# 图标服务：模板里的 {host} 会换成链接的域名。不填就用默认的 favicon.im
faviconService: https://a.favicon.im/{host}?larger=true
```

`categories` 的顺序就是分类导航的显示顺序。链接不填 `category` 也没关系，仍然能被本地搜索找到。

**图标的三种情况**：

1. **不填 `icon`** —— 按网址域名自动取，`https://github.com` → `https://a.favicon.im/github.com?larger=true`。日常加链接推荐这种。
2. **填站内路径** —— 如 `/icons/github.svg`，图标放在 `public/icons/` 下。快、稳、不依赖外网，常用站点推荐。
3. **填 https 地址** —— 直接用外链图标（适合对方有官方 favicon 的情况）。

外链图标依赖第三方服务，服务挂了图标会退回首字母。想彻底不依赖外网，跑一次 `npm run fetch-icons`
把所有外链图标下载到 `public/icons/fetched/` 并自动改写配置，见 [SERVER-OPERATIONS.md](SERVER-OPERATIONS.md)。

**目标站换了图标、这里没跟着变**：favicon.im 会把抓到的图标缓存一周左右。最稳的做法是把图标下载到
`public/icons/` 再填站内路径（放进去后同步一份到 `dist/client/icons/`，或重新 `npm run build`）。
直接填对方的图标地址不一定行：对方若返回 `Cross-Origin-Resource-Policy: same-origin`，浏览器会拒绝跨站加载，退回首字母。

### 每个账号自己的导航

登录用户可以在设置页（`/settings#links`）的「导航」一栏编辑自己的分类和网站：最多 6 个分类、每个分类最多 24 个网站。存过之后，这个账号的分类导航、搜索里的网站、常用网站都用它，不再读 `links.yaml`；没存过的账号和未登录访客照常用 `links.yaml`。第一次打开时编辑的起点就是 `links.yaml`（没填 `category` 的链接放不进来，它们只参与搜索），随时可以「恢复默认」。

图标默认自动：填好网址后服务端去打开那个网站，读 `<link rel="icon">` 之类的标签挑一张（都没有就试 `/favicon.ico`），存进本站；也可以自己上传（PNG、JPG、GIF、WebP、ICO、SVG，最多 256 KB）。图标按内容哈希存在 `SITE_ICONS_DIR`（默认 `data/site-icons/`），经 `/site-icons/<文件名>` 提供，之后首页显示图标不再连外网。抓取和日历订阅一样只走 https、不连本机和内网地址。

## 日历：订阅和自己添加的日程

日历、今天、Deadline 三个版块显示的是两部分合在一起：设置页里填的 ICS 订阅（只读），加上登录后在月历里用「+ 新建」自己添加的日程。自己添加的按账号存在服务端（`CALENDAR_EVENTS_FILE`，默认 `data/calendar-events.json`），每个账号一份，换设备登录看到的一样。

想让自己添加的日程也进 Google 日历，在设置页「日历订阅」下面的「写回 Google 日历」里连接：点「开始连接」拿到一段带口令的 Apps Script，在 script.google.com 新建项目粘贴进去，部署成网页应用（执行身份「我」、有权访问的人「任何人」），把网址粘贴回来。脚本以那个人自己的身份运行，只写他的默认日历；不需要 Google Cloud 项目、OAuth 或公网域名。每个账号各自部署、各自连接，互不影响。

- 同步方向是本站 → Google：在本站新建、修改、删除都会推过去；推不过去的标「未同步」，之后自动重试，也可以在月历底部点「重试」。
- 在 Google 日历里直接改本站添加的那几件，本站不会跟着变；在 Google 里删掉的，下次在本站改它时这边也删掉。
- 订阅填的是同一个日历时，推过去的日程按 UID 只显示一份。

## layout.yaml — 页面布局

三层结构：**Widget 实例** → **区域（zone）** → **页面网格**。

### widgets：模块实例

```yaml
widgets:
  - { id: clock, type: clock, options: { seconds: false } }
```

- `id`：这个实例的唯一标识，区域的 `items` 用它来引用
- `type`：对应 `src/widgets/<type>/` 目录
- `title`：可选，覆盖模块自己的默认标题
- `tone`：可选，卡片强调色，同 `links.yaml` 的 `tone`
- `options`：模块自己的配置，字段因模块而异，见下表。表里标了「可个人设置」的，登录用户可以在设置页（页头右边的齿轮圆，`/settings`）覆盖成自己的，这里写的就是默认值

| 模块 type | 说明 | options |
|---|---|---|
| `clock` | 时间 + 旁边两行日期 | `seconds`（显示秒，默认 false）；时间右边第一行的 `date`（2026.10.01）、`weekday`（周四），第二行的 `lunar`（农历）、`festival`（节日节气），默认都是 true，一行全关时那一行不显示。都可个人设置。和别的模块合成一张卡片（`items` 里写 `[clock, weather]`）时，后面那个排在日期下面、时间右边 |
| `search` | 搜索框 | `engines`（可选的搜索引擎，第一个为默认；用户只能在这几个里挑）、`suggest`（联想来源：`bing` / `false` 关闭）、`sites`（是否搜索 links.yaml，默认 true）、`placeholder`。引擎、联想开关、搜网站可个人设置 |
| `weather` | 天气（一行：地名、天气、气温、最高 / 最低） | `label`（地名，可选）、`latitude`、`longitude`（必填，[-90,90] / [-180,180]）。地区可个人设置（按地名搜索，同时查 OpenStreetMap Nominatim 和 Open-Meteo） |
| `toolbar` | 页头右边三个圆：头像、设置、公告 | 无。头像按站内登录显示，悬停展开账号面板（上次登录、登录设备数，链到个人中心各块，退出登录）；公告点开是弹窗，所有人都能看，**admin** 在弹窗里发布、删除，存在 `ANNOUNCEMENTS_FILE`（默认 `data/announcements.json`），最多留 50 条 |
| `calendar` | 月历 + ICS 订阅 | 无（每个登录用户在设置页填自己的订阅地址） |
| `agenda` | 今天的日程（默认布局没放） | 无（数据来自 calendar 的订阅） |
| `deadline` | 临近事项倒数 | `max`（最多列几条，默认 5）、`days`（往后看多少天，默认 90）。两项都可个人设置 |
| `favorites` | 常用网站卡片 | `count`（显示几个，默认 4）。登录用户最近点开过的网站在前（常用网站、分类导航、搜索里点的都算，按账号记在服务端）；不够时先用 `favorite: true` 的、再按顺序用其余链接补齐 |
| `steam` | Steam 最近游玩 | `count`（最多列几款游戏，默认 4，可个人设置；账号在设置页绑定，见 [STEAM.md](STEAM.md)） |
| `server` | 本站（所有人）/ 服务器（管理员） | `entries`（最多 4 个服务入口，每个 `{ name, url, description? }`，悬停显示说明和域名，新标签页打开，只进管理员的页面）。正面「本站」所有人都看得到：一个翻页计数器，导航和搜索合在一起算，经 `/api/site/stream`（Server-Sent Events）实时推送，别人点一下开着的页面不刷新就跟着一格一格翻上去，推送连不上时每 15 秒轮询（任何访客在分类导航、常用网站、搜索里点开网站算一次导航，用搜索框搜一次算一次搜索；存在 `SITE_STATS_FILE`，按账号 / 来源 IP 限流），登录用户在下面提建议（存在 `SUGGESTIONS_FILE`，最多留 500 条）。**admin** 多一排工具：「查看建议」（标为已处理、删除）、「发布公告」（打开公告弹窗的写一条）；栏目头右边能翻到背面「服务器」：CPU / 内存 / 存储三个圆环和入口，接口 `/api/server/stats` 按登录角色把关 |
| `link-groups` | 分类导航 | 无（读 `links.yaml` 的 `categories`；登录用户可以在设置页编辑自己的，见上文） |

### zones：区域排布

```yaml
zones:
  - id: main
    layout: areas              # stack 纵向堆叠 / grid 等宽多列 / areas 命名区域
    areas: ["favorites favorites", "steam ."]
    columns: "minmax(0, 1.35fr) minmax(0, 1fr)"
    align: start                # stretch / start / center / end
    dividers: none               # none / columns / rows / both，格子间的分隔线
    mobile: flatten              # flatten 拆开参与整页排序 / block 整体保留 / collapse 可折叠
    items: [favorites, steam]
```

`layout: areas` 的区域还可以给另外两种宽度各配一套：`mobileAreas` / `mobileColumns` 是手机（≤ 48rem），`narrowAreas` / `narrowColumns` 是窄窗口（48rem ~ 78rem，比如平板横屏、缩小的浏览器窗口）。不设就沿用宽屏的。默认的页头就是这样：宽屏一行三栏、两侧等宽，搜索框正好在正中；窄窗口和手机上搜索框换到第二行占满。

`areas` 用 CSS Grid 的区域语法：每个字符串是一行，空格分隔的每一项是一个格子里放的 widget id，用 `.` 表示空格子（比如上面例子里 `steam` 只占左边一格，右边留空，不必占满整行）。

### page：整页网格

```yaml
page:
  desktop:
    columns: "minmax(21rem, 1fr) minmax(0, 1.44fr)"
    dividers: columns
    areas:
      - "header header"
      - "nav nav"
      - "side main"
  mobile:
    order: [header, nav, deadline, favorites, calendar, steam]   # 手机端从上到下的顺序
```

`page.mobile.order` 里的名字是**区域 id**，`mobile: flatten` 的区域会被拆开、其内部的 widget id 直接出现在这个顺序列表里（所以上面例子里能看到 `deadline`、`favorites`、`steam` 直接列在其中，而不是它们所属的 `side`/`main` 区域）。

## 新增一个模块（Widget）

1. 在 `src/widgets/<type>/` 新建目录
2. 写 `widget.ts`：用 `defineWidget({ type, options, load?, actions? })` 声明配置 schema（用 `astro/zod`）和数据加载逻辑
3. 写 `View.astro`：接收 `WidgetViewProps<Options>`，画界面
4. 需要浏览器交互的话，加 `.svelte` 组件和 `client.ts`
5. 在 `config/layout.yaml` 加一个实例，放进某个区域

不需要改动任何已有文件，模块按目录名自动注册。具体的契约类型定义在 `src/core/widget.ts`。
