# 每日热点雷达

每天定时抓取中文热点新闻，归一化成一份标准 `data/news.json`，配一个零依赖的独立看板页。
零服务器、零数据库、零 API Key，全部跑在 GitHub Actions 上。

## 它做什么

```
每天 08:00（北京时间）
      │
      ├─ 60s API ── 每日要闻 15 条 / 微博·知乎·抖音·头条 热搜
      ├─ RSS ───── 36氪、IT之家、人民网时政、人民网财经、华尔街见闻快讯
      └─ Hacker News ── 海外技术热点
      ↓
  data/news.json  ← 页面读这个
  data/archive/   ← 按日期归档，保留 60 天
      ↓
  GitHub Actions 自动 commit 回仓库
```

- **多源容错**：任一源失败（常见是 60s 接口限流）不影响整体，失败板块自动沿用上一次缓存并标记 `stale`。
- **关键词命中**：在 `config.json` 里配关注词，命中的条目标 `kw` 字段，页面可一键「只看关注词」。
- **纯静态**：`index.html` 只读本地 JSON，不发任何第三方请求，双击也能用来查历史归档。

## 三步上线

1. 在 GitHub 新建一个仓库 `news-radar`（Public，**不要**勾选初始化 README）。
2. 在本目录执行：

```bash
git init
git add .
git commit -m "init: 每日热点雷达"
git branch -M main
git remote add origin https://github.com/<你的用户名>/news-radar.git
git push -u origin main
```

3. 进仓库 **Actions → daily-news → Run workflow** 手动跑一次。看到 `data/news.json` 被提交就成功了，之后每天 08:00 自动运行。

> 仓库必须 Public，raw 链接才能被工作台直接读取；如果坚持 Private，后续要用带 token 的代理。

## 本地预览

```bash
npm run fetch   # 抓一次，生成 data/news.json
npm run serve   # 打开 http://localhost:4173
```

直接双击 `index.html` 打不开数据——浏览器禁止 `file://` 页面读本地 JSON，必须走 `npm run serve`。

## 改配置

`config.json`：

| 字段 | 说明 |
| --- | --- |
| `keywords` | 关注词，中文用包含匹配，英文用单词边界匹配（避免 `AI` 命中 `said`） |
| `limits.perPlatform` | 每个热搜平台取前几条 |
| `limits.perFeed` | 每个 RSS 取前几条 |
| `sources.hot` | 启用的热搜平台：`weibo` `zhihu` `douyin` `toutiao` |
| `sources.feeds` | 自定义 RSS，`section` 决定归到哪个板块 |
| `sources.hackerNews` | 是否抓 HN |

## 已知问题

**60s 接口限流。** 主域名 `60s.viki.moe` 有每日额度，频繁请求会返回 429。脚本已做退避重试 + 缓存兜底，正常一天一次不会触发。如果你想要稳定，可以自建一份（Docker 一行）：

```bash
docker run -d --restart always -p 4399:4399 vikiboss/60s:latest
```

然后把 `scripts/fetch.mjs` 里的 `https://60s.viki.moe` 换成你的地址。

**Actions 定时不准。** GitHub 的 cron 在高峰期会延迟 5–30 分钟，属于正常现象。

## 之后接入个人工作台

工作台是纯前端页面，直接读这份 JSON 即可：

```js
const url = 'https://raw.githubusercontent.com/<用户名>/news-radar/main/data/news.json';
const data = await fetch(url).then(r => r.json());
// data.sections[] → { id, name, items[] }
// item → { title, url, source, platform, rank, hot, time, kw }
```

字段是稳定的，接入时不需要改动抓取层。

## 数据来源

- [vikiboss/60s](https://github.com/vikiboss/60s) — MIT
- 各媒体 RSS（36氪、IT之家、人民网、华尔街见闻）
- [Hacker News API](https://github.com/HackerNews/API)

抓取内容版权归原媒体所有，本仓库仅做个人阅读聚合，请勿公开再分发。
