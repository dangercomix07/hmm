import test from "node:test";
import { OAuth2Client } from "google-auth-library";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealGmailClient } from "../src/adapters/inbox/real-gmail-client.js";
import { GmailTransport } from "../src/adapters/inbox/gmail-transport.js";
import { authenticateGmail, browserCode, GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE, loadRefreshToken, saveRefreshToken, validateScopes } from "../src/adapters/auth/gmail-oauth.js";
import { gmailCheck, observations } from "../src/cli/gmail-check.js";
import { MimeEmailParser } from "../src/adapters/email/mime-parser.js";
import { fileEmail } from "../src/adapters/email/check-email.js";

function mockClient(responses: unknown[]) {
  const requests: { url: URL; init: RequestInit }[] = [];
  const client = new RealGmailClient(async () => "private-token", (async (url, init) => {
    requests.push({ url: new URL(String(url)), init: init! });
    return new Response(JSON.stringify(responses.shift()), { status: 200 });
  }) as typeof fetch);
  return { client, requests };
}
test("real client paginates with GET only and preserves RAW bytes, Gmail IDs and thread IDs", async () => {
  const raw = await readFile("fixtures/google-groups/plain.eml");
  const { client, requests } = mockClient([
    { messages: [{ id: "a1", threadId: "b1" }], nextPageToken: "page & two" },
    { id: "a1", threadId: "b1", raw: raw.toString("base64url") },
    { messages: [{ id: "a2", threadId: "b2" }] },
    { id: "a2", threadId: "b2", raw: raw.toString("base64url") },
  ]);
  const emails = await new GmailTransport(client, "test-grant").discover('subject:"pending"', 1);
  assert.deepEqual(emails.map(x => [x.id, x.threadId]), [["a1", "b1"], ["a2", "b2"]]);
  assert.deepEqual(emails[0]!.raw, raw);
  assert.equal(requests[2]!.url.searchParams.get("pageToken"), "page & two");
  assert.equal(requests[0]!.url.searchParams.get("q"), 'subject:"pending"');
  assert.equal(requests[1]!.url.searchParams.get("format"), "raw");
  for (const { url, init } of requests) {
    assert.equal(url.origin, "https://gmail.googleapis.com"); assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error"); assert.equal(init.body, undefined);
  }
});
test("empty Gmail response is a valid search with no candidates", async () => {
  assert.deepEqual(await new GmailTransport(mockClient([{}]).client, "grant").discover("test"), []);
});
test("malformed lists and references fail closed", async () => {
  for (const response of [null, [], { messages: {} }, { messages: [null] }, { messages: [{ id: "a" }] }, { nextPageToken: "" }, { nextPageToken: 4 }]) {
    await assert.rejects(mockClient([response]).client.listMessages({ q: "test", maxResults: 1 }), /Malformed/);
  }
});
test("malformed RAW responses and mismatched IDs fail closed", async () => {
  for (const response of [null, { id: "other", threadId: "b", raw: "YQ" }, { id: "a", raw: "YQ" }, { id: "a", threadId: "b", raw: 12 }]) {
    await assert.rejects(mockClient([response]).client.getMessage("a", { format: "raw" }), /Malformed/);
  }
});
test("HTTP failures are sanitized and never retried", async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    const client = new RealGmailClient(async () => "secret", (async () => { calls++; return new Response("private error", { status }); }) as typeof fetch);
    await assert.rejects(client.listMessages({ q: "test", maxResults: 1 }), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /Gmail read failed/); assert.doesNotMatch(error.message, /secret|private error/); return true;
    });
    assert.equal(calls, 1);
  }
});
test("network, JSON and auth-provider failures do not leak secrets", async () => {
  for (const fetcher of [async () => { throw new Error("private-token"); }, async () => new Response("invalid-json private-token")]) {
    const client = new RealGmailClient(async () => "secret", fetcher as typeof fetch);
    await assert.rejects(client.listMessages({ q: "test", maxResults: 1 }), /Gmail read failed/);
  }
  const client = new RealGmailClient(async () => { throw new Error("refresh-token"); }, (() => assert.fail("No API call")) as typeof fetch);
  await assert.rejects(client.getMessage("a", { format: "raw" }), /Gmail read failed/);
});
test("invalid initialization and unsafe request inputs fail before network", async () => {
  assert.throws(() => new RealGmailClient(null as never), /initialization/);
  const client = new RealGmailClient(async () => assert.fail("No authorization"));
  await assert.rejects(client.getMessage("../send", { format: "raw" }), /Invalid/);
  await assert.rejects(client.getMessage("a", { format: "full" } as never), /Invalid/);
  await assert.rejects(client.listMessages({ q: "", maxResults: 1 }), /Invalid/);
  await assert.rejects(client.listMessages({ q: "test", maxResults: 501 }), /Invalid/);
});
test("public real Gmail client exposes no send, draft, modify or generic request capability", () => {
  const names = Object.getOwnPropertyNames(RealGmailClient.prototype);
  assert.deepEqual(names.sort(), ["constructor", "getMessage", "listMessages"].sort());
  assert.ok(!names.some(name => /send|draft|modify|delete/i.test(name)));
});
test("scope validation refuses missing or additional privileges", () => {
  validateScopes([GMAIL_READONLY_SCOPE]);
  for (const scopes of [[], ["https://mail.google.com/"], [GMAIL_READONLY_SCOPE, "https://www.googleapis.com/auth/gmail.send"]]) assert.throws(() => validateScopes(scopes), /read-only/);
});
test("refresh token persistence is client-bound and preserves the token without storing access tokens", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hmm-oauth-")); const path = join(directory, "tokens", "gmail.json");
  try {
    assert.equal(await loadRefreshToken(path, "client"), undefined);
    await saveRefreshToken(path, "client", "refresh-only");
    await saveRefreshToken(path, "client", "refresh-new");
    assert.equal(await loadRefreshToken(path, "client"), "refresh-new");
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { client_id: "client", refresh_token: "refresh-new" });
    await assert.rejects(loadRefreshToken(path, "other-client"), /mismatched/);
    if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("missing OAuth credentials fail with a sanitized actionable error", async () => {
  await assert.rejects(authenticateGmail("/not-a-real-file", "/not-a-token"), /Cannot initialize Gmail OAuth/);
});
test("OAuth loopback checks state and callback path before accepting a code and closes afterwards", async () => {
  let request: Promise<void> | undefined; let callback = "";
  const result = await browserCode((redirect, state) => { callback = redirect; return `${redirect}?state=${state}`; }, url => {
    request = (async () => {
      const bad = new URL(url); bad.searchParams.set("state", "wrong"); bad.searchParams.set("code", "abc");
      assert.equal((await fetch(bad)).status, 400);
      const good = new URL(url); good.searchParams.set("code", "abc");
      assert.equal((await fetch(good)).status, 200);
    })();
  });
  await request; assert.deepEqual(result, { code: "abc", redirect: callback });
  await assert.rejects(fetch(callback));
});
test("OAuth denial closes callback without accepting a code", async () => {
  let request: Promise<Response> | undefined;
  await assert.rejects(browserCode((redirect, state) => `${redirect}?state=${state}`, url => {
    request = fetch(`${url}&error=access_denied`);
  }), /denied/);
  assert.equal((await request)!.status, 400);
});
test("gmail CLI validates options and refuses Jev before authorization", async () => {
  await assert.rejects(gmailCheck(["--send"]), /Invalid/);
  await assert.rejects(gmailCheck(["--config", "config/jev.example.yaml"]), /requires provider: fake/);
});
test("inspection reports metadata without printing the original body or claiming authentication", async () => {
  const parsed = await new MimeEmailParser().parse(fileEmail(await readFile("fixtures/google-groups/plain.eml")));
  const output = observations(parsed);
  assert.match(output, /from:/); assert.match(output, /Authentication.*NOT verified/);
  assert.ok(!output.includes(parsed.text));
});

test("first OAuth authorization requests only read-only offline consent with PKCE, validates token and persists refresh only", async t => {
  const directory = await mkdtemp(join(tmpdir(), "hmm-first-auth-"));
  const credentials = join(directory, "client.json"), token = join(directory, "token.json");
  const clientId = "test.apps.googleusercontent.com";
  try {
    await writeFile(credentials, JSON.stringify({ installed: { client_id: clientId, client_secret: "test-secret" } }));
    t.mock.method(OAuth2Client.prototype, "getToken", async (options: { code: string; codeVerifier: string; redirect_uri: string }) => {
      assert.equal(options.code, "test-code"); assert.ok(options.codeVerifier); assert.equal(options.redirect_uri, "http://127.0.0.1:1234/oauth2callback");
      return { tokens: { access_token: "access-only", refresh_token: "refresh-only" } };
    });
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({ token: "access-only" }));
    const info = t.mock.method(OAuth2Client.prototype, "getTokenInfo", async () => ({ scopes: [GMAIL_READONLY_SCOPE], aud: clientId }));
    const auth = await authenticateGmail(credentials, token, async build => {
      const redirect = "http://127.0.0.1:1234/oauth2callback";
      const url = new URL(build(redirect, "test-state"));
      assert.equal(url.origin, "https://accounts.google.com");
      assert.equal(url.searchParams.get("scope"), GMAIL_READONLY_SCOPE);
      assert.equal(url.searchParams.get("access_type"), "offline");
      assert.equal(url.searchParams.get("prompt"), "consent");
      assert.equal(url.searchParams.get("include_granted_scopes"), "false");
      assert.equal(url.searchParams.get("state"), "test-state");
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.ok(url.searchParams.get("code_challenge"));
      assert.equal(url.searchParams.get("client_secret"), null);
      return { code: "test-code", redirect };
    });
    assert.equal(await auth.accessToken(), "access-only"); assert.equal(info.mock.callCount(), 1);
    assert.match(auth.account, /^oauth-grant:[a-f0-9]{64}$/);
    assert.equal(await loadRefreshToken(token, clientId), "refresh-only");
    assert.doesNotMatch(await readFile(token, "utf8"), /access-only|test-secret/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("cached OAuth grant reuses refresh token without browser and validates each changed access token", async t => {
  const directory = await mkdtemp(join(tmpdir(), "hmm-cached-auth-"));
  const credentials = join(directory, "client.json"), token = join(directory, "token.json");
  const clientId = "test.apps.googleusercontent.com";
  try {
    await writeFile(credentials, JSON.stringify({ installed: { client_id: clientId, client_secret: "test-secret" } }));
    await saveRefreshToken(token, clientId, "refresh-only");
    let next = 0;
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async function(this: OAuth2Client) {
      assert.equal(this.credentials.refresh_token, "refresh-only");
      const interceptor = [...this.transporter.interceptors.request].at(-1)!;
      const request = await interceptor.resolved!({ retry: true } as never);
      assert.equal(request.retry, false); assert.equal(request.retryConfig!.retry, 0); assert.equal(request.timeout, 30_000);
      return { token: `access-${++next}` };
    });
    const info = t.mock.method(OAuth2Client.prototype, "getTokenInfo", async () => ({ scopes: [GMAIL_READONLY_SCOPE], aud: clientId }));
    const auth = await authenticateGmail(credentials, token, async () => assert.fail("No browser"));
    assert.equal(await auth.accessToken(), "access-2"); assert.equal(info.mock.callCount(), 2);
    assert.equal(await loadRefreshToken(token, clientId), "refresh-only");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("OAuth rejects excessive scopes or wrong audience before returning a Gmail token provider", async t => {
  const directory = await mkdtemp(join(tmpdir(), "hmm-rejected-auth-"));
  const credentials = join(directory, "client.json"), token = join(directory, "token.json");
  const clientId = "test.apps.googleusercontent.com";
  try {
    await writeFile(credentials, JSON.stringify({ installed: { client_id: clientId, client_secret: "private-client-secret" } }));
    await saveRefreshToken(token, clientId, "private-refresh-token");
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({ token: "private-access-token" }));
    for (const info of [{ scopes: [GMAIL_READONLY_SCOPE, "https://mail.google.com/"], aud: clientId }, { scopes: [GMAIL_READONLY_SCOPE], aud: "other-client" }]) {
      const mock = t.mock.method(OAuth2Client.prototype, "getTokenInfo", async () => info);
      await assert.rejects(authenticateGmail(credentials, token), error => {
        assert.ok(error instanceof Error); assert.match(error.message, /Cannot initialize/); assert.doesNotMatch(error.message, /private-/); return true;
      });
      mock.mock.restore();
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("send OAuth rejects an insufficient cached read-only grant with explicit reauthorization instructions", async t => {
  const directory = await mkdtemp(join(tmpdir(), "hmm-send-scope-"));
  const credentials = join(directory, "client.json"), token = join(directory, "token.json");
  const clientId = "send-test.apps.googleusercontent.com";
  try {
    await writeFile(credentials, JSON.stringify({ installed: { client_id: clientId, client_secret: "test-secret" } }));
    await saveRefreshToken(token, clientId, "refresh-only");
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({ token: "access-only" }));
    t.mock.method(OAuth2Client.prototype, "getTokenInfo", async () => ({ scopes: [GMAIL_READONLY_SCOPE], aud: clientId }));
    await assert.rejects(authenticateGmail(credentials, token, async () => assert.fail("Do not silently reauthorize"), "read-send"), /requires exactly gmail.readonly and gmail.send.*reauthorize/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("separate send OAuth requests and accepts only read-only plus send scopes", async t => {
  validateScopes([GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE], "read-send");
  assert.throws(() => validateScopes([GMAIL_SEND_SCOPE], "read-send"));
  assert.throws(() => validateScopes([GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE, "https://www.googleapis.com/auth/gmail.modify"], "read-send"));
  const directory = await mkdtemp(join(tmpdir(), "hmm-send-auth-"));
  const credentials = join(directory, "client.json"), token = join(directory, "token.json");
  const clientId = "send-test.apps.googleusercontent.com";
  try {
    await writeFile(credentials, JSON.stringify({ installed: { client_id: clientId, client_secret: "test-secret" } }));
    t.mock.method(OAuth2Client.prototype, "getToken", async () => ({ tokens: { access_token: "access-only", refresh_token: "refresh-only" } }));
    t.mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({ token: "access-only" }));
    t.mock.method(OAuth2Client.prototype, "getTokenInfo", async () => ({ scopes: [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE], aud: clientId }));
    const auth = await authenticateGmail(credentials, token, async build => {
      const redirect = "http://127.0.0.1:1234/oauth2callback";
      const url = new URL(build(redirect, "test-state"));
      assert.deepEqual(url.searchParams.get("scope")!.split(" "), [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE]);
      return { code: "test-code", redirect };
    }, "read-send");
    assert.equal(await auth.accessToken(), "access-only");
    assert.equal(await loadRefreshToken(token, clientId), "refresh-only");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
