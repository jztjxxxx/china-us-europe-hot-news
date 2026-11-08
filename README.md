# 中美欧热点新闻

> 👉 **在线看新闻：https://jztjxxxx.github.io/china-us-europe-hot-news/**
>
> 直接点上面这个链接就能看，不用下载、不用安装。

整合中国、美国、欧洲的热点新闻：报纸头版式页面，顶部头条、下方按地区分栏，覆盖政治、经济、科技、市场、社会五类，可按地区 / 分类筛选、全文搜索，每天自动更新一次。

> **English summary:** A static, open-source hot-news page covering China, the US and Europe. Headlines are fetched from public RSS feeds, rendered client-side from `data/news.json`, and refreshed daily by GitHub Actions. No build step, no external fonts or CDNs, no tracking.

## 功能

- 头版式版面：头条大标题 + 中国 / 美国 / 欧洲分栏
- 地区页签：全部 / 中国 / 美国 / 欧洲；分类筛选：全部 / 政治 / 经济 / 科技 / 市场 / 社会
- 搜索框：按标题、摘要过滤
- 每条新闻：中文标题、1–2 句中文摘要、来源、发布时间、原文链接（新标签页打开）
- 页眉显示数据更新时间；响应式布局，手机可正常浏览
- 零外部依赖：只用系统字体，不加载任何外部字体或 CDN；纯静态页面

## 本地使用

直接用浏览器打开 `index.html` 会因为 `file://` 限制读不到 `data/news.json`，请用本地服务器：

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

也可以部署到 GitHub Pages：仓库 Settings → Pages → 选择 `main` 分支根目录即可。

## 手动更新数据

```bash
python3 scripts/fetch_news.py
```

脚本只用 Python 标准库（`urllib` + `xml.etree`），不需要安装任何依赖。它会抓取下方数据源的 RSS，保留近 3 天的条目，按发布时间倒序、去重后取最多 45 条（每地区最多 16 条、每来源最多 10 条），写入 `data/news.json`。选条时保证经济不少于 8 条、科技不少于 8 条、市场不少于 5 条，政治、社会各不超过 12 条；每个地区至少 10 条，且每个地区至少 2 条经济、2 条科技。

## 每天自动更新

`.github/workflows/update-news.yml` 每天 23:30 UTC（北京时间次日约 07:30）自动运行一次：

1. 检出代码，安装 Python 3.12
2. 运行 `python3 scripts/fetch_news.py`
3. `data/news.json` 有变化时自动提交并推送

也可以在仓库 Actions 页面点 **Run workflow** 手动触发。

## 数据源

抓取脚本使用的 RSS（2026-11-08 实测，全部返回 200 且 3 天内有新鲜条目）：

| 来源 | RSS |
| --- | --- |
| 德国之声（中文） | `rss.dw.com/xml/rss-chi-all` |
| 法国国际广播电台（中文） | `www.rfi.fr/cn/rss` |
| 南华早报（综合 / 商业 / 科技） | `www.scmp.com/rss/91,92,36/feed` |
| BBC（亚洲 / 美国与加拿大 / 商业 / 科技） | `feeds.bbci.co.uk/news/…/rss.xml` |
| 卫报（美国 / 欧洲 / 世界 / 商业 / 科技） | `www.theguardian.com/…/rss` |
| 纽约时报（美国 / 世界 / 商业 / 科技） | `rss.nytimes.com/services/xml/rss/nyt/…` |
| NPR | `www.npr.org/rss/rss.php?id=1001` |
| Euronews（综合 / 商业） | `www.euronews.com/rss` |
| 金融时报（科技 / 市场 / 公司 / 全球经济） | `www.ft.com/rss/technology,markets,companies,global-economy` |
| 彭博（市场 / 科技 / 经济） | `feeds.bloomberg.com/markets,technology,economics/news.rss` |
| CNBC（综合 / 科技） | `search.cnbc.com/rs/search/combinedcms/view.xml` |

金融时报的 RSS 可正常抓取标题和一句话提要，全文在付费墙后，本站只做摘要聚合并链接原文。

2026-11-07 / 2026-11-08 实测**未采用**的源：

| 来源 | 原因 |
| --- | --- |
| 美联社 AP | 403 / 连接被重置（Cloudflare 拦截） |
| 路透社 Reuters | 401 |
| The Times（泰晤士报） | 返回 200 但内容是 “Verifying Device” 机器人验证页，不是 RSS |
| China Daily RSS、新华社英文 RSS | 404 |
| RFI 经济（英文） | 返回 200 但 3 天内 0 条新鲜内容 |
| BBC 中文 / BBC 欧洲 / BBC 科技（2026-11-07） | 返回 200 但当日无条目（BBC 商业 / 科技频道已于 2026-11-08 采用） |
| 环球时报 outbrain RSS | 返回 200 但内容过期（最新为 10 月） |

## 摘要与分类说明

- 标题与摘要均译为中文，取 RSS 描述的前 1–2 句忠实转述，**不编造事实**。2026-11-07 的首批数据与 2026-11-08 的新一批数据均由人工逐条译为中文；此后每日自动更新由脚本抓取，脚本本身没有翻译服务，英文源的新条目将保留英文原文，以免机器转述失真。
- 地区、分类由标题 + 描述的关键词打分判定，频道明确属于经济 / 科技 / 市场时以频道为准（除非关键词强烈反对）。美中、俄乌这类跨地区新闻按关键词得分、标题中最先出现的地区归类，个别条目的归类可能存在争议，以原文链接为准。**中国栏覆盖中国及亚太地区**（日本、韩国、东南亚、印度、新西兰、澳大利亚等新闻归入该栏）；中东、非洲、拉美等三栏之外的新闻不收录。
- 2026-11-08 生成的新一批数据共 44 条：中国 16、美国 13、欧洲 15；政治 8、经济 8、科技 9、市场 8、社会 11；已全部译为中文（仅人名等专有名词保留原文），并剔除了无实质内容的 Euronews 视频简报、一条以色列新闻，以及一条与英文版重复的 UFC 中文报道。

## 版权

- 本项目代码按 **MIT 许可证**开源（见 `LICENSE`）。
- **新闻内容版权属于原来源**，本站仅做摘要聚合、注明来源并链接原文；如需转载请遵循原来源的授权。
