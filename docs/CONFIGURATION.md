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
    favorite: true                 # 是否放进「常用网站」卡片
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

## layout.yaml — 页面布局

三层结构：**Widget 实例** → **区域（zone）** → **页面网格**。

### widgets：模块实例

```yaml
widgets:
  - { id: clock, type: clock, options: { seconds: false, greeting: true, name: 主人 } }
```

- `id`：这个实例的唯一标识，区域的 `items` 用它来引用
- `type`：对应 `src/widgets/<type>/` 目录
- `title`：可选，覆盖模块自己的默认标题
- `tone`：可选，卡片强调色，同 `links.yaml` 的 `tone`
- `options`：模块自己的配置，字段因模块而异，见下表

| 模块 type | 说明 | options |
|---|---|---|
| `clock` | 时钟 + 问候语 | `seconds`（显示秒，默认 false）、`greeting`（默认 true）、`name`（问候语后的称呼，如"早上好，主人"） |
| `search` | 搜索框 | `engines`（可切换的搜索引擎数组）、`suggest`（联想来源：`bing` / `false` 关闭）、`sites`（是否搜索 links.yaml，默认 true）、`placeholder` |
| `weather` | 天气 | `label`（地名，可选）、`latitude`、`longitude`（必填，[-90,90] / [-180,180]） |
| `calendar` | 月历 + ICS 订阅 | 无（每个登录用户在卡片底部自己填订阅地址） |
| `agenda` | 今天的日程 | 无（数据来自 calendar 的订阅） |
| `deadline` | 临近事项倒数 | `max`（最多列几条，默认 5）、`days`（往后看多少天，默认 90） |
| `favorites` | 常用网站卡片 | 无（读 `links.yaml` 里 `favorite: true` 的条目） |
| `steam` | Steam 最近游玩 | `count`（最多列几款游戏，默认 4，见 [STEAM.md](STEAM.md)） |
| `link-groups` | 分类导航 | 无（读 `links.yaml` 的 `categories`） |

### zones：区域排布

```yaml
zones:
  - id: main
    layout: areas              # stack 纵向堆叠 / grid 等宽多列 / areas 命名区域
    areas: ["favorites favorites", "agenda agenda", "steam ."]
    columns: "minmax(0, 1.35fr) minmax(0, 1fr)"
    align: start                # stretch / start / center / end
    dividers: none               # none / columns / rows / both，格子间的分隔线
    mobile: flatten              # flatten 拆开参与整页排序 / block 整体保留 / collapse 可折叠
    items: [favorites, agenda, steam]
```

`areas` 用 CSS Grid 的区域语法：每个字符串是一行，空格分隔的每一项是一个格子里放的 widget id，用 `.` 表示空格子（比如上面例子里 `steam` 只占左边一格，右边留空，不必占满整行）。

### page：整页网格

```yaml
page:
  desktop:
    columns: "minmax(21rem, 1fr) minmax(0, 1.44fr)"
    dividers: columns
    areas:
      - "header header"
      - "side main"
      - "footer footer"
  mobile:
    order: [header, deadline, agenda, favorites, calendar, steam, footer]   # 手机端从上到下的顺序
```

`page.mobile.order` 里的名字是**区域 id**，`mobile: flatten` 的区域会被拆开、其内部的 widget id 直接出现在这个顺序列表里（所以上面例子里能看到 `deadline`、`agenda`、`favorites`、`steam` 直接列在其中，而不是它们所属的 `side`/`main` 区域）。

## 新增一个模块（Widget）

1. 在 `src/widgets/<type>/` 新建目录
2. 写 `widget.ts`：用 `defineWidget({ type, options, load?, actions? })` 声明配置 schema（用 `astro/zod`）和数据加载逻辑
3. 写 `View.astro`：接收 `WidgetViewProps<Options>`，画界面
4. 需要浏览器交互的话，加 `.svelte` 组件和 `client.ts`
5. 在 `config/layout.yaml` 加一个实例，放进某个区域

不需要改动任何已有文件，模块按目录名自动注册。具体的契约类型定义在 `src/core/widget.ts`。
