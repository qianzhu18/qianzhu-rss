import { SNAPSHOT_RSS } from "./snapshot-rss.js";

const ORIGIN_RSS = "http://118.89.62.40/folo.rss";
const PUBLIC_RSS = "https://folo-rss-proxy.vercel.app/read.rss";

function escapeXml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].trim() : "";
}

function cdata(value = "") {
  return value.replaceAll("]]>", "]]]]><![CDATA[>");
}

function plainText(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemContent({ title, link, description }) {
  const body = escapeXml(description || title || "点击阅读全文。");
  const safeLink = escapeXml(link);
  return `<article>
  <p>${body}</p>
  <p><a href="${safeLink}" target="_blank" rel="noopener noreferrer">阅读全文</a></p>
</article>`;
}

function compactRss(xml) {
  const itemXml = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)]
    .slice(0, 12)
    .map((match) => {
      const item = match[0];
      const title = getTag(item, "title");
      const link = getTag(item, "link") || getTag(item, "guid");
      const guid = getTag(item, "guid") || link;
      const pubDate = getTag(item, "pubDate");
      const description = plainText(getTag(item, "description")).slice(0, 240);
      const content = itemContent({ title, link, description });

      return `  <item>
    <title>${title}</title>
    <link>${link}</link>
    <guid isPermaLink="false">${guid}</guid>
    <pubDate>${pubDate}</pubDate>
    <description>${escapeXml(description)}</description>
    <content:encoded><![CDATA[${cdata(content)}]]></content:encoded>
  </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>WeRSS</title>
  <link>${PUBLIC_RSS}</link>
  <description>WeChat RSS collection</description>
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

  if (req.method === "HEAD") {
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Upstream-Status", "head-ok");
    return res.status(200).end();
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const upstream = await fetch(ORIGIN_RSS, {
      headers: {
        "User-Agent": "WeRSS-Folo-Proxy/1.0",
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });
    clearTimeout(timeout);

    const upstreamXml = await upstream.text();
    const body = compactRss(upstreamXml);

    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Upstream-Status", String(upstream.status));

    return res.status(upstream.status).send(body);
  } catch (error) {
    res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Upstream-Status", "snapshot");
    return res.status(200).send(SNAPSHOT_RSS);
  }
}
