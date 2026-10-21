import assert from "node:assert/strict";
import { test } from "node:test";
import { WebsiteError, htmlToText, normalizeUrl, readWebsite } from "../server/website.ts";

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
