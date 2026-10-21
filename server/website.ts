/** Shown to the user when a company website can't be used; the drafts still go ahead without it. */
export class WebsiteError extends Error {}

// Enough for a model to find a hook, and small enough for local models with short context windows.
const MAX_TEXT_CHARS = 3000;
const MAX_HTML_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

export function normalizeUrl(raw: string): URL {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new WebsiteError(`"${raw}" doesn't look like a website address.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WebsiteError("Only http and https website addresses are supported.");
  }
  return url;
}

/** Fetches a company web page and returns its readable text (title, description, headings, paragraphs). */
export async function readWebsite(raw: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = normalizeUrl(raw);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SDR-Outreach/1.0)", Accept: "text/html,*/*;q=0.8" },
    });
  } catch {
    throw new WebsiteError(`Couldn't reach ${url.hostname}.`);
  }
  if (!response.ok) {
    throw new WebsiteError(`${url.hostname} returned an error (${response.status}).`);
  }
  const type = response.headers.get("content-type") ?? "";
  if (type && !/html|text\/plain/i.test(type)) {
    throw new WebsiteError(`${url.hostname} didn't return a web page.`);
  }

  const html = (await response.text()).slice(0, MAX_HTML_BYTES);
  const text = htmlToText(html);
  if (text.length < 40) {
    // Sites built entirely in JavaScript come back nearly empty without a browser.
    throw new WebsiteError(`${url.hostname} didn't have readable text (it may need JavaScript to load).`);
  }
  return text;
}

export function htmlToText(html: string): string {
  const title = match(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description =
    metaContent(html, "description") ?? metaContent(html, "og:description") ?? metaContent(html, "twitter:description");

  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(h[1-6]|p|li|div|section|article|br|tr|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const lines = decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    // Drop menu labels, buttons and other fragments that carry no information.
    .filter((line) => line.split(" ").length >= 4);

  const parts = [title && `Title: ${decodeEntities(title).trim()}`, description && `Description: ${decodeEntities(description).trim()}`];
  const unique = [...new Set(lines)];
  return [...parts.filter(Boolean), ...unique].join("\n").slice(0, MAX_TEXT_CHARS).trim();
}

function match(html: string, pattern: RegExp): string | undefined {
  return pattern.exec(html)?.[1];
}

function metaContent(html: string, name: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (key?.toLowerCase() === name) return /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
  }
  return undefined;
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: "-", ndash: "-", hellip: "..." };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}
