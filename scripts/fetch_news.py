#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
中美欧热点新闻 — RSS 抓取脚本（仅使用 Python 标准库）。

用法：
    python3 scripts/fetch_news.py

输出：
    data/news.json
    {"updated_at": "...(+08:00)", "items": [{region, category, title,
      summary, source, url, published_at}, ...]}

规则（见 README）：
- 只用 urllib + xml.etree，不依赖任何第三方包。
- 只保留近 3 天（2026-11-05 起）的条目，按发布时间倒序，最多 40 条，
  每个地区最多 14 条；优先收录中文源的条目，其次用英文源补齐。
- 标题保留 RSS 原文；摘要取 RSS 描述的前 1-2 句，不编造事实。
  中文描述直接取中文摘要；英文描述无法在无翻译服务的情况下忠实
  转述时，按任务要求保留英文原文（不做机器翻译、不编造）。
- 分类与地区用标题+描述的关键词打分判定。

2026-11-07 实测被排除的源（见 README「数据源」一节）：
- BBC 中文 / BBC 欧洲 / BBC 科技：返回 200 但无 2026-11-07（UTC）当日条目
- China Daily RSS、新华社英文 RSS：404
- AP：403（Cloudflare 拦截）；Reuters：401
- 环球时报 outbrain RSS：返回 200 但内容过期（最新为 10 月），近 48 小时 0 条

2026-11-08 扩充经济/科技源实测（见 README「数据源」一节）：
- 可用：金融时报 FT（technology/markets/companies/global-economy，
  均为 200 且 3 天内新鲜；摘要为一句话提要，全文付费墙）、
  彭博 Bloomberg（markets/technology/economics）、BBC 商业/科技、
  纽约时报商业/科技、卫报商业/科技、CNBC、SCMP 商业/科技、
  Euronews 商业。
- 仍不可用：AP（403 / 连接被重置，Cloudflare 拦截）、
  Reuters（401）、The Times（返回 200 但内容是 "Verifying Device"
  机器人验证 HTML，不是 RSS）、RFI 经济（200 但 3 天内 0 条新鲜）。
"""

import html
import json
import re
import sys
import urllib.request
import urllib.error
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "news.json"

USER_AGENT = "Mozilla/5.0 (china-us-europe-hot-news; +https://github.com/jztjxxxx/china-us-europe-hot-news)"

# (url, 来源名, 地区提示, 分类提示；提示为 None 表示按关键词判定。
#  频道明确属于经济/科技/市场时给分类提示；频道本身无明确地区时
#  地区提示为 None，无法按关键词判定地区的条目会被丢弃。）
FEEDS = [
    # 综合源（原有）
    ("https://rss.dw.com/xml/rss-chi-all", "德国之声", None, None),
    ("https://www.rfi.fr/cn/rss", "法国国际广播电台", None, None),
    ("https://www.scmp.com/rss/91/feed", "南华早报", "中国", None),
    ("https://feeds.bbci.co.uk/news/world/asia/rss.xml", "BBC", "中国", None),
    ("https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml", "BBC", "美国", None),
    ("https://www.theguardian.com/us-news/rss", "卫报", "美国", None),
    ("https://rss.nytimes.com/services/xml/rss/nyt/US.xml", "纽约时报", "美国", None),
    ("https://www.npr.org/rss/rss.php?id=1001", "NPR", "美国", None),
    ("https://www.theguardian.com/world/europe-news/rss", "卫报", "欧洲", None),
    ("https://www.euronews.com/rss?format=mrss&level=theme&name=news", "Euronews", None, None),
    ("https://www.theguardian.com/world/rss", "卫报", None, None),
    ("https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "纽约时报", None, None),
    # 经济 / 科技 / 市场源（2026-11-08 新增）
    ("https://www.ft.com/rss/technology", "金融时报", None, "科技"),
    ("https://www.ft.com/rss/markets", "金融时报", None, "市场"),
    ("https://www.ft.com/rss/companies", "金融时报", None, "市场"),
    ("https://www.ft.com/rss/global-economy", "金融时报", None, "经济"),
    ("https://feeds.bloomberg.com/markets/news.rss", "彭博", None, "市场"),
    ("https://feeds.bloomberg.com/technology/news.rss", "彭博", None, "科技"),
    ("https://feeds.bloomberg.com/economics/news.rss", "彭博", None, "经济"),
    ("https://feeds.bbci.co.uk/news/business/rss.xml", "BBC", "欧洲", "经济"),
    ("https://feeds.bbci.co.uk/news/technology/rss.xml", "BBC", "欧洲", "科技"),
    ("https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "纽约时报", "美国", "经济"),
    ("https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml", "纽约时报", "美国", "科技"),
    ("https://www.theguardian.com/uk/business/rss", "卫报", "欧洲", "经济"),
    ("https://www.theguardian.com/technology/rss", "卫报", "欧洲", "科技"),
    ("https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", "CNBC", "美国", "市场"),
    ("https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910", "CNBC", "美国", "科技"),
    ("https://www.scmp.com/rss/92/feed", "南华早报", "中国", "经济"),
    ("https://www.scmp.com/rss/36/feed", "南华早报", "中国", "科技"),
    ("https://www.euronews.com/rss?format=mrss&level=theme&name=business", "Euronews", "欧洲", "经济"),
]

# 不属于中/美/欧三栏的地方：若一条新闻没有任何地区关键词，
# 又提到这些地方（如以色列新闻），直接丢弃，不硬塞进某一栏。
OUT_OF_SCOPE = [
    "以色列", "巴勒斯坦", "加沙", "伊朗", "伊拉克", "沙特", "埃及",
    "巴西", "墨西哥", "阿根廷", "尼日利亚", "肯尼亚", "南非",
    "Israel", "Palestine", "Gaza", "Iran", "Iraq", "Saudi", "Egypt",
    "Brazil", "Mexico", "Argentina", "Nigeria", "Kenya", "South Africa",
]

# ---- 地区关键词（中英；短英文词用词边界匹配，避免 "US" 误命中）----
REGION_KEYWORDS = {
    "中国": ["中国", "中國", "北京", "上海", "深圳", "广州", "香港", "澳门",
            "台湾", "臺灣", "台北", "习近平", "習近平", "国务院", "人大",
            "华为", "小米", "人民币", "中共", "中方", "大陆",
            "China", "Beijing", "Shanghai", "Shenzhen", "Hong Kong", "Macau",
            "Taiwan", "Taipei", "Xi Jinping", "Huawei", "Xiaomi", "Chinese",
            "Alibaba", "Tencent", "BYD", "TSMC", "台积电", "阿里", "腾讯",
            "比亚迪",
            # 亚太地区新闻（SCMP / BBC 亚洲线）归入中国栏，见 README 说明
            "日本", "东京", "韩国", "首尔", "新加坡", "印度", "新西兰",
            "澳大利亚", "印尼", "越南", "泰国", "马来西亚", "菲律宾",
            "Japan", "Tokyo", "South Korea", "Seoul", "Singapore", "India",
            "New Zealand", "Australia", "Indonesia", "Vietnam", "Thailand",
            "Malaysia", "Philippines"],
    "美国": ["美国", "美國", "华盛顿", "特朗普", "白宫", "纽约", "加州",
            "德州", "佛州", "拜登", "万斯", "美联储", "美元", "硅谷",
            "美方", "中期选举",
            "US", "USA", "U.S.", "Trump", "White House", "Washington",
            "New York", "California", "Texas", "Florida", "Biden", "Vance",
            "Federal Reserve", "Silicon Valley", "America", "American",
            "Apple", "Microsoft", "Nvidia", "Tesla", "Amazon", "Google",
            "Meta", "OpenAI", "Intel", "Netflix", "Nasdaq", "Dow Jones"],
    "欧洲": ["欧洲", "歐洲", "英国", "法国", "德国", "意大利", "西班牙",
            "葡萄牙", "荷兰", "比利时", "瑞士", "奥地利", "波兰", "希腊",
            "瑞典", "挪威", "丹麦", "芬兰", "爱尔兰", "欧盟", "歐盟",
            "乌克兰", "俄罗斯", "莫斯科", "基辅", "伦敦", "巴黎", "柏林",
            "马德里", "罗马", "布鲁塞尔", "北约",
            "Europe", "European", "EU", "UK", "Britain", "France", "Germany",
            "Italy", "Spain", "Ukraine", "Russia", "Moscow", "Kyiv",
            "London", "Paris", "Berlin", "Madrid", "Brussels", "NATO",
            "Volkswagen", "BMW", "Siemens", "Airbus", "Shell", "HSBC", "SAP"],
}

# ---- 分类关键词；打分最高者胜，平局按 CATEGORY_ORDER 顺序 ----
CATEGORIES = ["政治", "经济", "科技", "市场", "社会"]
CATEGORY_KEYWORDS = {
    "政治": ["选举", "選舉", "议会", "总统", "總理", "政府", "政策", "外交",
            "军事", "战争", "戰爭", "制裁", "峰会", "国安", "党", "法案",
            "议员", "部长", "内阁", "白宫", "国会", "参议院", "众议院",
            "公投",
            "election", "elections", "president", "government", "parliament",
            "policy", "war", "sanction", "summit", "diplomacy", "minister",
            "congress", "senate", "cabinet", "prime minister", "vote",
            "voter", "voters", "midterm", "midterms", "ballot", "party",
            "referendum"],
    "经济": ["经济", "經濟", "GDP", "通胀", "通膨", "利率", "央行", "贸易",
            "关税", "财政", "增长", "增速", "就业", "失业", "非农",
            "营收", "利润", "估值", "并购", "债券", "黄金", "降息", "加息",
            "economy", "economic", "inflation", "interest rate", "central bank",
            "trade", "tariff", "growth", "jobs", "unemployment", "GDP",
            "recession", "revenue", "profit", "bond", "gold price", "merger",
            "acquisition", "valuation", "startup", "IPO", "listing"],
    "科技": ["科技", "人工智能", "AI", "芯片", "半导体", "机器人", "互联网",
            "卫星", "算法", "大模型", "算力", "英伟达", "黄仁勋",
            "数据中心", "初创",
            "technology", "tech", "artificial intelligence", "chip",
            "semiconductor", "robot", "software", "satellite", "Nvidia",
            "Huang", "AI", "data center", "datacenter", "cloud", "cyber",
            "smartphone", "electric vehicle", "EV", "battery"],
    "市场": ["股市", "股票", "股价", "市场", "投資", "投资", "基金", "暴跌",
            "暴涨", "上涨", "下跌", "财报", "市值", "纳斯达克", "道指",
            "比特币", "加密货币",
            "stock", "stocks", "market", "shares", "investor", "earnings",
            "Nasdaq", "Dow", "S&P", "rally", "plunge", "trading",
            "bitcoin", "crypto", "fund", "index"],
    "社会": ["社会", "教育", "健康", "文化", "体育", "事故", "火灾", "移民",
            "难民", "气候", "环保", "电影", "音乐", "学校", "医院",
            "society", "health", "education", "culture", "sport", "accident",
            "immigration", "climate", "film", "school", "hospital", "fire"],
}

MAX_ITEMS = 45
MAX_PER_REGION = 16
MAX_PER_SOURCE = 10  # 单一来源上限，保证来源多样性
# 只收录近 3 天的条目（按 UTC 日期）
CUTOFF_DAYS = 3
# 分类目标：经济/科技/市场不再被政治/社会淹没
CATEGORY_MIN = {"经济": 8, "科技": 8, "市场": 5}
CATEGORY_MAX = {"政治": 12, "经济": 14, "科技": 14, "市场": 12, "社会": 12}
REGION_MIN = 10
REGION_CATEGORY_MIN = 2  # 每个地区至少 2 条经济、2 条科技（若候选允许）


def contains(text, keyword):
    """中英关键词匹配：中文子串匹配；纯 ASCII 词用词边界匹配。"""
    if not keyword or not text:
        return False
    if keyword.isascii():
        return re.search(r"\b" + re.escape(keyword) + r"\b", text, re.I) is not None
    return keyword in text


def score(text, keywords):
    return sum(1 for k in keywords if contains(text, k))


def detect_region(text, hint):
    """按关键词得分判定地区；多地区出现时取标题中最先出现的地区。"""
    scores = {r: score(text, kws) for r, kws in REGION_KEYWORDS.items()}
    best = max(scores.values())
    if best == 0:
        # 无地区关键词：若提到三栏之外的地方（如以色列），丢弃；
        # 否则用来源提示（如 SCMP 亚洲线 -> 中国栏），无提示则丢弃。
        if any(contains(text, w) for w in OUT_OF_SCOPE):
            return None
        return hint
    tied = [r for r, s in scores.items() if s == best]
    if len(tied) == 1:
        return tied[0]
    # 平局：看哪个地区关键词在标题中最先出现
    first_pos = {}
    for r in tied:
        pos = min(
            (text.find(k) for k in REGION_KEYWORDS[r] if k in text or
             (k.isascii() and re.search(r"\b" + re.escape(k) + r"\b", text, re.I))),
            default=10 ** 9,
        )
        first_pos[r] = pos
    return min(tied, key=lambda r: first_pos[r])


def detect_category(text, hint=None):
    """频道提示优先：频道明确属于某类时用提示，除非关键词强烈反对
    （另一类得分比提示类高 3 分以上）。无提示时按关键词打分。"""
    scores = {c: score(text, kws) for c, kws in CATEGORY_KEYWORDS.items()}
    best = max(scores.values())
    if hint:
        # 提示只在与关键词得分基本一致时生效；若另一类明显更强
        # （高 2 分以上），以关键词为准，避免把党代会新闻划入市场。
        if best == 0 or scores[hint] >= best - 1:
            return hint
    if best == 0:
        return "社会"
    for c in CATEGORIES:  # 平局按固定顺序：政治、经济、科技、市场、社会
        if scores[c] == best:
            return c
    return "社会"


def clean_text(raw):
    if not raw:
        return ""
    text = re.sub(r"<[^>]+>", " ", raw)
    text = html.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_chinese(text):
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def make_summary(description):
    """取描述的前 1-2 句，不编造。中文描述直接截取；英文描述保留原文。"""
    text = clean_text(description)
    if not text:
        return ""
    if is_chinese(text):
        parts = re.split(r"(?<=[。！？；])", text)
        out = ""
        for p in parts:
            if len(out) + len(p) > 140 and out:
                break
            out += p
            if len(parts) > 1 and out and len(out) >= 40:
                break
        return out.strip() or text[:140]
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = ""
    for p in parts[:2]:
        if len(out) + len(p) > 220 and out:
            break
        out += (" " if out else "") + p
    out = out.strip() or text[:220]
    if len(out) >= 220:  # 截断时不要切断单词
        out = out[:220].rsplit(" ", 1)[0]
    return out


def parse_date(raw):
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw.strip())
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def norm_url(url):
    url = (url or "").strip()
    url = re.sub(r"[?&](utm_[^=&]+|fbclid|gclid)=[^&]*", "", url)
    return url.rstrip("?&")


def norm_title_tokens(title):
    t = title.lower()
    t = re.sub(r"[^\w\u4e00-\u9fff]+", " ", t)
    return set(t.split())


STOPWORDS = {
    "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "after",
    "with", "his", "her", "their", "is", "are", "was", "were", "be", "has",
    "have", "will", "would", "from", "by", "at", "as", "it", "its", "this",
    "that", "new", "more", "over", "under", "into", "about", "up", "out",
    "who", "what", "why", "how", "when", "can", "could", "than", "then",
}


def content_tokens(title):
    """标题实词集合：去停用词、去单字母，用于跨源同题去重。"""
    return {t for t in norm_title_tokens(title)
            if t not in STOPWORDS and len(t) > 2}


def similar_title(a, b):
    """跨源同题去重：词集合 Jaccard 相似度过高视为同一新闻。
    不同媒体对同一新闻的标题措辞不同（如 UFC  press secretary 的
    三个版本），全词 Jaccard 只有 0.25，因此再算一层实词 Jaccard，
    0.5 以上也视为同一新闻。"""
    ta, tb = norm_title_tokens(a), norm_title_tokens(b)
    if not ta or not tb:
        return False
    if ta <= tb or tb <= ta:
        return True
    if len(ta & tb) / len(ta | tb) >= 0.65:
        return True
    ca, cb = content_tokens(a), content_tokens(b)
    if len(ca) < 3 or len(cb) < 3:
        return False
    return len(ca & cb) / len(ca | cb) >= 0.5


def fetch_feed(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status != 200:
            raise urllib.error.HTTPError(url, resp.status, "non-200", None, None)
        return resp.read()


def parse_items(data):
    root = ET.fromstring(data)
    items = []
    for it in root.iter("item"):
        title = clean_text(it.findtext("title"))
        link = (it.findtext("link") or "").strip()
        desc = it.findtext("description") or ""
        if not desc:
            desc = it.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or ""
        pub = it.findtext("pubDate") or ""
        if not pub:
            pub = it.findtext("{http://purl.org/dc/elements/1.1/}date") or ""
        if title and link:
            items.append({"title": title, "link": link,
                          "description": desc, "pub_raw": pub})
    return items


def main():
    now_utc = datetime.now(timezone.utc)
    cutoff = now_utc - timedelta(days=CUTOFF_DAYS)
    today = now_utc.date().isoformat()
    beijing = timezone(timedelta(hours=8))

    candidates = []
    feed_stats = {}
    for url, source, hint, cat_hint in FEEDS:
        try:
            data = fetch_feed(url)
            raw_items = parse_items(data)
        except Exception as e:  # noqa: BLE001 - 记录并继续下一个源
            print(f"[跳过] {source} {url} -> {e}")
            feed_stats[source + " | " + url] = "失败"
            continue
        kept = 0
        today_n = 0
        for raw in raw_items:
            dt = parse_date(raw["pub_raw"])
            if dt is None or dt < cutoff:
                continue
            if dt.date().isoformat() == today:
                today_n += 1
            if re.search(r"news bulletin", raw["title"], re.I):
                continue  # Euronews 的“新闻简报”视频无实质内容，跳过
            text = raw["title"] + " " + clean_text(raw["description"])
            region = detect_region(text, hint)
            if region is None:
                continue  # 无法判定地区，不收录
            candidates.append({
                "region": region,
                "category": detect_category(text, cat_hint),
                "title": raw["title"],
                "summary": make_summary(raw["description"]) or raw["title"],
                "source": source,
                "url": norm_url(raw["link"]),
                "published_at": dt.astimezone(beijing).isoformat(),
                "_dt": dt,
            })
            kept += 1
        feed_stats[f"{source} | {url}"] = f"共 {len(raw_items)} 条，近 3 天 {kept} 条，今日 {today_n} 条"
        print(f"[OK] {source}: {feed_stats[f'{source} | {url}']}")

    # 去重：先按 URL，再按相似标题
    seen_urls, deduped = set(), []
    for c in sorted(candidates, key=lambda x: x["_dt"], reverse=True):
        if c["url"] in seen_urls:
            continue
        if any(similar_title(c["title"], d["title"]) for d in deduped):
            continue
        seen_urls.add(c["url"])
        deduped.append(c)

    # 选条：按时间倒序贪心选，分类设上限（政治/社会各不超 12），
    # 地区、来源设上限；中文标题优先于同等新鲜度的英文标题。
    # 注意：不再全局“中文先、补英文”，否则英文经济/科技源
    # （FT/彭博/纽约时报商业版）永远排不上；但先为中文标题
    # 预留 CHINESE_QUOTA 个名额，否则新一批会被英文标题淹没。
    CHINESE_QUOTA = 12
    picked = []

    def fits(c, items):
        if sum(1 for p in items if p["region"] == c["region"]) >= MAX_PER_REGION:
            return False
        if sum(1 for p in items if p["source"] == c["source"]) >= MAX_PER_SOURCE:
            return False
        if sum(1 for p in items if p["category"] == c["category"]) >= CATEGORY_MAX[c["category"]]:
            return False
        return True

    pool = sorted(deduped,
                  key=lambda c: (c["_dt"], is_chinese(c["title"])),
                  reverse=True)
    for c in pool:
        if len(picked) >= MAX_ITEMS:
            break
        if sum(1 for p in picked if is_chinese(p["title"])) >= CHINESE_QUOTA:
            break
        if not is_chinese(c["title"]):
            continue
        if fits(c, picked):
            picked.append(c)
    for c in pool:
        if len(picked) >= MAX_ITEMS:
            break
        if c in picked:
            continue
        if fits(c, picked):
            picked.append(c)

    def counts_of(items, key):
        return Counter(x[key] for x in items)

    def can_swap_in(cand, victim):
        """换入 cand、换出 victim 后，地区/来源上限是否仍成立。"""
        rest_picked = [p for p in picked if p is not victim]
        if sum(1 for p in rest_picked if p["region"] == cand["region"]) >= MAX_PER_REGION:
            return False
        if sum(1 for p in rest_picked if p["source"] == cand["source"]) >= MAX_PER_SOURCE:
            return False
        return True

    def swap_for(need_fn, victim_cats):
        """为满足 need_fn 的候选换入：找未入选的最新候选，从
        victim_cats 类别中最旧的入选项中换出一个。"""
        rest = [c for c in deduped if c not in picked]
        for cand in rest:
            if not need_fn(cand):
                continue
            for vcat in victim_cats:
                victims = [p for p in reversed(picked)
                           if p["category"] == vcat]
                for victim in victims:
                    if can_swap_in(cand, victim):
                        picked.remove(victim)
                        picked.append(cand)
                        return True
        return False

    # 补齐 1：分类下限（经济 >= 8、科技 >= 8、市场 >= 5），
    # 从政治/社会超额部分换出。
    for cat, minimum in CATEGORY_MIN.items():
        while counts_of(picked, "category")[cat] < minimum:
            if not swap_for(lambda c, cat=cat: c["category"] == cat,
                            ["政治", "社会"]):
                break

    # 补齐 2：每个地区至少 10 条。
    for region in ("中国", "美国", "欧洲"):
        while counts_of(picked, "region")[region] < REGION_MIN:
            if not swap_for(lambda c, region=region: c["region"] == region,
                            ["政治", "社会", "经济", "科技", "市场"]):
                break

    # 补齐 3：每个地区至少 2 条经济、2 条科技。
    for region in ("中国", "美国", "欧洲"):
        for cat in ("经济", "科技"):
            while sum(1 for p in picked
                      if p["region"] == region and p["category"] == cat) < REGION_CATEGORY_MIN:
                if not swap_for(
                        lambda c, region=region, cat=cat:
                            c["region"] == region and c["category"] == cat,
                        ["政治", "社会"]):
                    break

    picked.sort(key=lambda x: x["_dt"], reverse=True)
    for p in picked:
        p.pop("_dt", None)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "updated_at": datetime.now(beijing).isoformat(timespec="seconds"),
        "items": picked,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")

    print(f"\n共收录 {len(picked)} 条")
    print("按地区：", dict(Counter(p["region"] for p in picked)))
    print("按分类：", dict(Counter(p["category"] for p in picked)))
    print("按来源：", dict(Counter(p["source"] for p in picked)))
    print("中文标题：", sum(1 for p in picked if is_chinese(p["title"])),
          "英文标题：", sum(1 for p in picked if not is_chinese(p["title"])))
    print(f"已写入 {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
