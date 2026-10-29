import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

/** Shown to the user when a company website can't be used; the drafts still go ahead without it. */
export class WebsiteError extends Error {}

// Enough for a model to find a hook, and small enough for local models with short context windows.
const MAX_TEXT_CHARS = 2500;
const MAX_HTML_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

// Addresses that aren't the public internet: this computer, home and office networks, cloud metadata services.
// The app fetches whatever address a user types, so without this a public copy could be used to probe the network
// it runs in (server-side request forgery).
const PRIVATE = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) PRIVATE.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return isPublicAddress(mapped);
  const family = net.isIP(ip);
  if (family === 0) return false;
  return !PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6");
}

type FetchPolicy = {
  /** Which resolved addresses may be fetched. */
  isAllowed?: (ip: string) => boolean;
  /** Allow addresses with a port number. Only tests need this; real company sites use the normal ports. */
  allowPorts?: boolean;
};

const PRIVATE_ADDRESS = "Only public websites can be used, not addresses on a private network.";

/**
 * A fetch for company websites that only connects to public addresses, follows up to three redirects (checking
 * each), and stops reading after MAX_HTML_BYTES. The address check runs on the connection's own DNS lookup, so it
 * can't be dodged by a domain that changes its answer between a check and the request.
 */
export function publicFetch({ isAllowed = isPublicAddress, allowPorts = false }: FetchPolicy = {}): typeof fetch {
  const lookup = ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
    dns.lookup(hostname, { all: true, family: options.family }, (error, addresses) => {
      if (error) return callback(error);
      if (addresses.length === 0 || addresses.some((a) => !isAllowed(a.address))) {
        return callback(Object.assign(new Error(`${hostname} is a private address`), { code: "EPRIVATE" }));
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  }) as unknown as typeof dns.lookup;

  function check(url: URL) {
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new WebsiteError("Only http and https website addresses are supported.");
    if ((url.port && !allowPorts) || url.username || url.password) {
      throw new WebsiteError("Use the website's normal address, without a port number or password.");
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || (net.isIP(host) && !isAllowed(host))) throw new WebsiteError(PRIVATE_ADDRESS);
  }

  async function get(url: URL, init: RequestInit, redirects: number): Promise<Response> {
    check(url);
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const request = url.protocol === "https:" ? https.get : http.get;
      const headers = { ...(init.headers as Record<string, string>), "Accept-Encoding": "gzip, deflate, br" };
      request(url, { headers, lookup, signal: init.signal ?? undefined }, resolve).on("error", reject);
    });

    const location = response.headers.location;
    if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
      response.destroy();
      if (redirects >= MAX_REDIRECTS) throw new WebsiteError(`${url.hostname} redirected too many times.`);
      return get(new URL(location, url), init, redirects + 1);
    }

    const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
    const body =
      encoding === "gzip" ? response.pipe(zlib.createGunzip()) :
      encoding === "deflate" ? response.pipe(zlib.createInflate()) :
      encoding === "br" ? response.pipe(zlib.createBrotliDecompress()) :
      response;
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of body) {
        chunks.push(chunk);
        size += chunk.length;
        if (size >= MAX_HTML_BYTES) break;
      }
    } finally {
      response.destroy();
    }
    const headers = new Headers();
    if (response.headers["content-type"]) headers.set("content-type", String(response.headers["content-type"]));
    return new Response(Buffer.concat(chunks).subarray(0, MAX_HTML_BYTES), { status: response.statusCode ?? 502, headers });
  }

  return ((input: URL, init: RequestInit = {}) => get(new URL(input), init, 0)) as typeof fetch;
}

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
export async function readWebsite(raw: string, fetchImpl: typeof fetch = publicFetch()): Promise<string> {
  const url = normalizeUrl(raw);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SDR-Outreach/1.0)", Accept: "text/html,*/*;q=0.8" },
    });
  } catch (error) {
    if (error instanceof WebsiteError) throw error;
    if ((error as NodeJS.ErrnoException).code === "EPRIVATE") throw new WebsiteError(PRIVATE_ADDRESS);
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
