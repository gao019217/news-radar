import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, 'archive');
const OUT_FILE = path.join(DATA_DIR, 'news.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

async function httpGet(url, { timeout = 15000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 429 ? ' 限流' : ''}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

const getJson = async (url, opt) => JSON.parse(await httpGet(url, opt));

const decodeEntities = (s) => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function cleanText(s) {
  return decodeEntities(String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function pickTag(xml, names) {
  for (const name of names) {
    const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
    if (m && m[1].trim()) return m[1];
  }
  return '';
}

function parseFeed(xml, sourceName) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return blocks.map((b) => {
    const title = cleanText(pickTag(b, ['title']));
    let link = cleanText(pickTag(b, ['link']));
    if (!link) {
      const href = b.match(/<link[^>]+href=["']([^"']+)["']/i);
      link = href ? href[1] : '';
    }
    const rawDate = cleanText(pickTag(b, ['pubDate', 'published', 'updated', 'dc:date']));
    const ts = rawDate ? Date.parse(rawDate) : NaN;
    const desc = cleanText(pickTag(b, ['description', 'summary', 'content'])).slice(0, 120);
    return {
      title,
      url: link,
      source: sourceName,
      time: Number.isNaN(ts) ? '' : new Date(ts).toISOString(),
      desc,
    };
  }).filter((it) => it.title && it.title.length > 4);
}

function normKey(t) {
  return String(t || '').replace(/[\s\u3000·，,。.！!？?、：:；;"'“”‘’（）()\[\]【】\-—]/g, '').toLowerCase();
}

function matchKeywords(title, keywords) {
  const t = String(title);
  return keywords.filter((k) => {
    const word = String(k);
    if (/^[\x00-\x7F]+$/.test(word)) {
      const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(t);
    }
    return t.includes(word);
  });
}

const SOURCE_LABEL = { weibo: '微博', zhihu: '知乎', douyin: '抖音', toutiao: '头条' };

async function fetch60sDaily(limit) {
  const j = await getJson('https://60s.viki.moe/v2/60s', { retries: 1 });
  const list = (j && j.data && j.data.news) || [];
  return list.slice(0, limit).map((title, i) => ({
    title: cleanText(title), url: '', source: '每天60秒', platform: '', rank: i + 1, hot: null,
  }));
}

async function fetchHotPlatform(platform, limit) {
  const j = await getJson(`https://60s.viki.moe/v2/${platform}`, { retries: 1 });
  const list = Array.isArray(j && j.data) ? j.data : [];
  return list.slice(0, limit).map((it, i) => ({
    title: cleanText(it.title),
    url: it.link || it.url || it.mobile_url || '',
    source: SOURCE_LABEL[platform] || platform,
    platform: SOURCE_LABEL[platform] || platform,
    rank: i + 1,
    hot: Number(it.hot_value || it.hot || 0) || null,
    desc: cleanText(it.detail || it.desc || '').slice(0, 100),
  })).filter((x) => x.title);
}

async function fetchHackerNews(limit) {
  const ids = await getJson('https://hacker-news.firebaseio.com/v0/topstories.json', { retries: 1 });
  const picked = (ids || []).slice(0, limit);
  const items = await Promise.all(picked.map(async (id) => {
    try {
      const it = await getJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { retries: 0, timeout: 10000 });
      if (!it || !it.title) return null;
      return {
        title: cleanText(it.title),
        url: it.url || `https://news.ycombinator.com/item?id=${id}`,
        source: 'Hacker News',
        platform: 'HN',
        rank: 0,
        hot: it.score || null,
        time: it.time ? new Date(it.time * 1000).toISOString() : '',
      };
    } catch { return null; }
  }));
  return items.filter(Boolean);
}

function buildSections({ daily, hot, feeds, hn }, cfg) {
  const lim = cfg.limits;
  const sections = [];

  if (daily.length) {
    sections.push({ id: 'daily', name: '每日要闻', items: daily.slice(0, lim.daily) });
  }

  if (hot.length) {
    const order = cfg.sources.hot;
    const sorted = [...hot].sort((a, b) => {
      const pa = order.indexOf(Object.keys(SOURCE_LABEL).find((k) => SOURCE_LABEL[k] === a.platform) || '');
      const pb = order.indexOf(Object.keys(SOURCE_LABEL).find((k) => SOURCE_LABEL[k] === b.platform) || '');
      return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || a.rank - b.rank;
    });
    const seen = new Set();
    const uniq = sorted.filter((it) => {
      const k = normKey(it.title);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    sections.push({ id: 'hot', name: '全网热搜', items: uniq.slice(0, lim.total / 2) });
  }

  const group = (sectionId, name) => {
    const items = feeds.filter((f) => f.section === sectionId);
    if (!items.length) return;
    const seen = new Set();
    const uniq = [];
    for (const it of items) {
      const k = normKey(it.title);
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(it);
    }
    uniq.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
    sections.push({ id: sectionId, name, items: uniq.slice(0, 30) });
  };
  group('tech', '科技与产业');
  group('policy', '时政要闻');

  if (hn.length) {
    sections.push({ id: 'tech-en', name: '海外技术热点', items: hn.slice(0, 8) });
  }
  return sections;
}

async function readPrev() {
  try {
    return JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
  } catch { return null; }
}

async function pruneArchives(keepDays = 60) {
  try {
    const files = (await fs.readdir(ARCHIVE_DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    const drop = files.slice(0, Math.max(0, files.length - keepDays));
    await Promise.all(drop.map((f) => fs.unlink(path.join(ARCHIVE_DIR, f)).catch(() => {})));
  } catch { /* ignore */ }
}

async function main() {
  const cfg = JSON.parse(await fs.readFile(path.join(ROOT, 'config.json'), 'utf8'));
  const prev = await readPrev();
  const status = [];
  const settle = async (id, fn) => {
    try {
      const items = await fn();
      status.push({ id, ok: true, count: items.length });
      return items;
    } catch (err) {
      status.push({ id, ok: false, count: 0, error: String(err.message || err) });
      console.warn(`[warn] ${id} 抓取失败：${err.message}`);
      return [];
    }
  };

  const daily = cfg.sources.daily
    ? await settle('daily', () => fetch60sDaily(cfg.limits.daily))
    : [];

  const hot = [];
  for (const p of cfg.sources.hot) {
    const items = await settle(`hot:${p}`, () => fetchHotPlatform(p, cfg.limits.perPlatform));
    hot.push(...items);
    await sleep(1200);
  }

  const feeds = [];
  for (const feed of cfg.sources.feeds) {
    const items = await settle(`feed:${feed.name}`, async () => parseFeed(await httpGet(feed.url), feed.name)
      .slice(0, cfg.limits.perFeed)
      .map((it) => ({ ...it, section: feed.section })), []);
    feeds.push(...items);
    await sleep(600);
  }

  const hn = cfg.sources.hackerNews
    ? await settle('hn', () => fetchHackerNews(8))
    : [];

  let sections = buildSections({ daily, hot, feeds, hn }, cfg);

  const prevSections = (prev && prev.sections) || [];
  const failedHot = status
    .filter((s) => !s.ok && s.id.startsWith('hot:'))
    .map((s) => SOURCE_LABEL[s.id.slice(4)])
    .filter(Boolean);
  if (failedHot.length) {
    const oldItems = ((prevSections.find((s) => s.id === 'hot') || {}).items) || [];
    const reuse = oldItems.filter((it) => failedHot.includes(it.platform));
    if (reuse.length) {
      const hotSec = sections.find((s) => s.id === 'hot');
      if (hotSec) hotSec.items = [...hotSec.items, ...reuse];
      else sections.push({ id: 'hot', name: '全网热搜', items: reuse });
      console.log(`[info] ${failedHot.join('/')} 本次失败，沿用上次缓存 ${reuse.length} 条`);
    }
  }
  const freshIds = new Set(sections.map((s) => s.id));
  for (const ps of prevSections) {
    if (!freshIds.has(ps.id) && Array.isArray(ps.items) && ps.items.length) {
      sections.push({ ...ps, stale: true, updatedAt: prev.generatedAt });
    }
  }

  const keywords = cfg.keywords || [];
  sections = sections.map((s) => ({
    ...s,
    items: s.items.map((it) => ({ ...it, kw: matchKeywords(it.title, keywords) })),
  })).filter((s) => s.items.length);

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const out = {
    generatedAt: new Date().toISOString(),
    date: todayShanghai(),
    total,
    sections,
    sources: status,
    keywordHits: sections.reduce((n, s) => n + s.items.filter((i) => i.kw && i.kw.length).length, 0),
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
  await fs.writeFile(path.join(ARCHIVE_DIR, `${out.date}.json`), JSON.stringify(out, null, 2), 'utf8');
  await pruneArchives();

  console.log(`[ok] ${out.date} 共 ${total} 条，其中命中关注词 ${out.keywordHits} 条`);
  for (const s of sections) console.log(`  - ${s.name}: ${s.items.length}`);
  const bad = status.filter((s) => !s.ok);
  if (bad.length) console.log(`[注意] ${bad.length} 个源本次失败：${bad.map((b) => b.id).join(', ')}`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
