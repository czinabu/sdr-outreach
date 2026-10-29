import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { WebsiteError, htmlToText, isPublicAddress, normalizeUrl, publicFetch, readWebsite } from "../server/website.ts";

const page = `<!doctype html><html><head>
  <title>Bright Smiles Dental &amp; Ortho</title>
  <meta name="description" content="Family dentistry in Austin since 2009.">
  <style>body { color: red }</style>
  <script>window.track("visit with enough words to look real")</script>
</head><body>
  <nav><a href="/">Home</a><a href="/about">About us and our whole team</a></nav>
  <h1>We&rsquo;re opening a second location in Round Rock this spring</h1>
  <p>Our new office adds six chairs and evening hours for busy families.</p>
  <p>Book now</p>
  <footer>Copyright 2026 Bright Smiles Dental, all rights reserved</footer>
</body></html>`;

test("extracts title, description and readable body text", () => {
  const text = htmlToText(page);
  assert.match(text, /^Title: Bright Smiles Dental & Ortho\nDescription: Family dentistry in Austin since 2009\./);
  assert.match(text, /We're opening a second location in Round Rock this spring/);
  assert.match(text, /six chairs and evening hours/);
  assert.doesNotMatch(text, /window\.track|color: red|About us|Copyright|Book now/);
});

test("adds https to bare domains and rejects other schemes", () => {
  assert.equal(normalizeUrl("brightsmiles.com").href, "https://brightsmiles.com/");
  assert.equal(normalizeUrl("http://brightsmiles.com/news").href, "http://brightsmiles.com/news");
  assert.throws(() => normalizeUrl("file:///etc/passwd"), WebsiteError);
  assert.throws(() => normalizeUrl("not a url"), WebsiteError);
});

function respond(body: string, init: ResponseInit = {}) {
  return (async () => new Response(body, { headers: { "content-type": "text/html" }, ...init })) as unknown as typeof fetch;
}

test("reads a page through fetch", async () => {
  assert.match(await readWebsite("brightsmiles.com", respond(page)), /second location/);
});

test("explains unreachable, failing and empty sites", async () => {
  const unreachable = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  await assert.rejects(readWebsite("nope.example", unreachable), /Couldn't reach nope\.example/);
  await assert.rejects(readWebsite("gone.example", respond("missing", { status: 404 })), /returned an error \(404\)/);
  await assert.rejects(readWebsite("app.example", respond('<div id="root"></div>')), /needs? JavaScript|readable text/);
});

test("only public addresses count as public", () => {
  for (const ip of ["8.8.8.8", "104.16.1.1", "2606:4700::1111"]) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "not an ip"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test("refuses private network addresses and unusual ports before fetching", async () => {
  for (const address of ["localhost", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://192.168.1.1", "http://[::1]/", "app.localhost", "example.com:8080", "https://user:pass@example.com"]) {
    await assert.rejects(readWebsite(address, publicFetch()), /private network|normal address/, address);
  }
});

test("follows redirects, unpacks compressed pages, and refuses a redirect to a private address", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/moved") res.writeHead(301, { location: "/" }).end();
    else if (req.url === "/to-private") res.writeHead(302, { location: "http://10.0.0.5/admin" }).end();
    else if (req.url === "/loop") res.writeHead(302, { location: "/loop" }).end();
    else res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(zlib.gzipSync(page));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Treat this test server's address as public; everything else keeps the normal rules.
  const fetchImpl = publicFetch({ isAllowed: (ip) => ip === "127.0.0.1" || isPublicAddress(ip), allowPorts: true });
  try {
    assert.match(await readWebsite(`${base}/moved`, fetchImpl), /second location in Round Rock/);
    await assert.rejects(readWebsite(`${base}/to-private`, fetchImpl), /private network/);
    await assert.rejects(readWebsite(`${base}/loop`, fetchImpl), /redirected too many times/);
  } finally {
    server.close();
  }
});
