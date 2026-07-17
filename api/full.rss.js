import { SNAPSHOT_RSS } from "./snapshot-rss.js";
import { FULL_SNAPSHOT_RSS } from "./full-snapshot-rss.js";

const ORIGIN_RSS = "http://118.89.62.40/qianzhu.rss";
const PUBLIC_RSS = "https://folo-rss-proxy.vercel.app/qianzhu.rss";
const TOTAL_ITEMS = 12;
const FULL_ITEMS = 12;
const FEED_TITLE = "qianzhu 信息源";
const FEED_DESCRIPTION = "qianzhu 的微信公众号全文阅读信息源";

const WX_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7"
};

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cdata(value = "") {
  return String(value).replaceAll("]]>", "]]]]><![CDATA[>");
}

function getTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].trim() : "";
}

function plainText(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteImageUrls(html) {
  return html
    .replace(/\sdata-src=/g, " src=")
    .replace(/\sdata-original=/g, " src=")
    .replace(/src="\/\//g, 'src="https://')
    .replace(/src="http:\/\/mmbiz/g, 'src="https://mmbiz')
    .replace(/&amp;wx_lazy=1/g, "")
    .replace(/&wx_lazy=1/g, "");
}

function stripUnsafeHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+="[^"]*"/gi, "")
    .replace(/\son[a-z]+='[^']*'/gi, "")
    .replace(/visibility:\s*hidden;?/gi, "")
    .replace(/opacity:\s*0;?/gi, "");
}

function extractWeChatContent(html) {
  const idIndex = html.indexOf('id="js_content"');
  if (idIndex < 0) return "";

  const tagEnd = html.indexOf(">", idIndex);
  if (tagEnd < 0) return "";

  const marker = html.indexOf('<p style="display: none;"><mp-style-type', tagEnd);
  const fallback = html.indexOf("</div>", tagEnd);
  const endIndex = marker > 0 ? html.indexOf("</div>", marker) : fallback;
  if (endIndex < 0) return "";

  return stripUnsafeHtml(absoluteImageUrls(html.slice(tagEnd + 1, endIndex)));
}

function summaryContent(item) {
  const text = escapeXml(item.description || item.title || "点击阅读全文。");
  const link = escapeXml(item.link);
  return `<article>
  <p>${text}</p>
  <p><a href="${link}" target="_blank" rel="noopener noreferrer">阅读全文</a></p>
</article>`;
}

function parseItems(xml) {
  return [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].slice(0, TOTAL_ITEMS).map((match) => {
    const item = match[0];
    const title = getTag(item, "title");
    const link = getTag(item, "link") || getTag(item, "guid");
    return {
      title,
      link,
      guid: getTag(item, "guid") || link,
      pubDate: getTag(item, "pubDate"),
      description: plainText(getTag(item, "description")).slice(0, 240),
      content: ""
    };
  });
}

function countFullContent(xml) {
  return [...xml.matchAll(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/g)].filter(
    (match) => match[1].length >= 500
  ).length;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOriginXml() {
  const response = await fetchWithTimeout(
    ORIGIN_RSS,
    {
      headers: {
        "User-Agent": "WeRSS-Folo-Full/1.0",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
      },
      redirect: "follow"
    },
    2500
  );
  if (!response.ok) throw new Error(`origin ${response.status}`);
  return response.text();
}

async function enrichItem(item, shouldFetchFull) {
  if (!shouldFetchFull || !item.link.includes("mp.weixin.qq.com")) {
    return { ...item, content: summaryContent(item) };
  }

  try {
    const response = await fetchWithTimeout(item.link, { headers: WX_HEADERS, redirect: "follow" }, 4500);
    if (!response.ok) throw new Error(`wechat ${response.status}`);
    const html = await response.text();
    const content = extractWeChatContent(html);
    if (!content || content.length < 120) throw new Error("empty content");
    return { ...item, content };
  } catch {
    return { ...item, content: summaryContent(item) };
  }
}

async function enrichItems(items) {
  return Promise.all(items.map((item, index) => enrichItem(item, index < FULL_ITEMS)));
}

function renderRss(items) {
  const itemXml = items
    .map((item) => `  <item>
    <title>${escapeXml(item.title)}</title>
    <link>${escapeXml(item.link)}</link>
    <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
    <pubDate>${escapeXml(item.pubDate)}</pubDate>
    <description>${escapeXml(item.description)}</description>
    <content:encoded><![CDATA[${cdata(item.content || summaryContent(item))}]]></content:encoded>
  </item>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${FEED_TITLE}</title>
  <link>${PUBLIC_RSS}</link>
  <description>${FEED_DESCRIPTION}</description>
  <language>zh-CN</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${itemXml}
</channel>
</rss>
`;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end("Method Not Allowed");
  }

  res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "HEAD") {
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.setHeader("X-Upstream-Status", "head-ok");
    return res.status(200).end();
  }

  try {
    const originXml = await fetchOriginXml();
    const originFullCount = countFullContent(originXml);
    if (originFullCount >= 1) {
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
      res.setHeader("X-Upstream-Status", `origin-full-${originFullCount}`);
      return res.status(200).send(originXml);
    }

    const items = await enrichItems(parseItems(originXml));
    const fullCount = items.filter((item) => item.content && item.content.length > 1000).length;
    if (fullCount < 1) throw new Error("no full content");

    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400");
    res.setHeader("X-Upstream-Status", `live-full-${fullCount}`);
    return res.status(200).send(renderRss(items));
  } catch {
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.setHeader("X-Upstream-Status", "full-snapshot");
    return res.status(200).send(FULL_SNAPSHOT_RSS);
  }
}
