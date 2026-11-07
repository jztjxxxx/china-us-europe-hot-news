# 中美欧热点新闻

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

脚本只用 Python 标准库（`urllib` + `xml.etree`），不需要安装任何依赖。它会抓取下方数据源的 RSS，保留近 3 天的条目，按发布时间倒序、去重后取最多 40 条（每地区最多 14 条、每来源最多 12 条），写入 `data/news.json`。

## 每天自动更新

`.github/workflows/update-news.yml` 每天 23:30 UTC（北京时间次日约 07:30）自动运行一次：

1. 检出代码，安装 Python 3.12
2. 运行 `python3 scripts/fetch_news.py`
3. `data/news.json` 有变化时自动提交并推送

也可以在仓库 Actions 页面点 **Run workflow** 手动触发。

## 数据源

抓取脚本使用的 RSS（2026-11-07 实测，全部返回 200 且当日有新条目）：

| 来源 | RSS |
| --- | --- |
| 德国之声（中文） | `rss.dw.com/xml/rss-chi-all` |
| 法国国际广播电台（中文） | `www.rfi.fr/cn/rss` |
| 南华早报 | `www.scmp.com/rss/91/feed` |
| BBC（亚洲 / 美国与加拿大 / 商业） | `feeds.bbci.co.uk/news/…/rss.xml` |
| 卫报（美国 / 欧洲 / 世界） | `www.theguardian.com/…/rss` |
| 纽约时报（美国 / 世界） | `rss.nytimes.com/services/xml/rss/nyt/…` |
| NPR | `www.npr.org/rss/rss.php?id=1001` |
| Euronews | `www.euronews.com/rss` |

2026-11-07 实测**未采用**的源：BBC 中文 / BBC 欧洲 / BBC 科技（返回 200 但无当日条目）、China Daily RSS 与新华社英文 RSS（404）、AP（403，被 Cloudflare 拦截）、路透社（401）、环球时报 outbrain RSS（返回 200 但内容过期，近 48 小时 0 条）。

## 摘要与分类说明

- 标题与摘要均译为中文，取 RSS 描述的前 1–2 句忠实转述，**不编造事实**。2026-11-07 的首批数据由人工逐条译为中文；此后每日自动更新由脚本抓取，脚本本身没有翻译服务，英文源的新条目将保留英文原文，以免机器转述失真。
- 地区、分类由标题 + 描述的关键词打分判定。美中、俄乌这类跨地区新闻按关键词得分、标题中最先出现的地区归类，个别条目的归类可能存在争议，以原文链接为准。
- 2026-11-07 生成的首批数据共 39 条：中国 15、美国 13、欧洲 11；政治 16、社会 16、科技 3、经济 3、市场 1；已全部译为中文，并剔除了一条无实质内容的 Euronews 视频简报。

## 版权

- 本项目代码按 **MIT 许可证**开源（见 `LICENSE`）。
- **新闻内容版权属于原来源**，本站仅做摘要聚合、注明来源并链接原文；如需转载请遵循原来源的授权。
