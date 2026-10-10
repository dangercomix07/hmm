import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export type GmailAuthMode = "readonly" | "read-send";
class ScopeError extends Error {}
export function validateScopes(scopes: string[], mode: GmailAuthMode = "readonly"): void {
  const expected = mode === "read-send" ? [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE] : [GMAIL_READONLY_SCOPE];
  if (scopes.length !== expected.length || !expected.every(scope => scopes.includes(scope))) {
    throw new ScopeError(mode === "read-send"
      ? "Gmail send authorization requires exactly gmail.readonly and gmail.send. Remove the send token file (.tokens/gmail-send.json by default) and reauthorize with the dedicated send Desktop client. No send attempted."
      : "Authorize only Gmail read-only access using a dedicated Desktop OAuth client.");
  }
}
export async function saveRefreshToken(path: string, clientId: string, refreshToken: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ client_id: clientId, refresh_token: refreshToken }), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
export async function loadRefreshToken(path: string, clientId: string): Promise<string | undefined> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("Cannot read local Gmail token file."); }
  try {
    const data = JSON.parse(text);
    if (data.client_id !== clientId || typeof data.refresh_token !== "string" || !data.refresh_token.trim()) throw new Error();
    return data.refresh_token;
  } catch { throw new Error("Invalid or mismatched local Gmail token. Remove the token file and authorize again."); }
}
function openBrowser(url: string): void {
  const command = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true, shell: false });
  child.on("error", () => { /* The user can open the printed authorization URL. */ });
  child.unref();
}
/** Temporary local OAuth callback only; closes after success, failure or five minutes. */
export async function browserCode(buildUrl: (redirect: string, state: string) => string,
  launch: (url: string) => void = openBrowser): Promise<{ code: string; redirect: string }> {
  const state = randomBytes(32).toString("hex");
  return new Promise((resolve, reject) => {
    let redirect = "";
    const finish = (error?: Error, code?: string): void => {
      clearTimeout(timer); server.close(); server.closeAllConnections();
      if (error) reject(error); else resolve({ code: code!, redirect });
    };
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method !== "GET" || url.pathname !== "/oauth2callback") { response.writeHead(404).end(); return; }
      if (url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state) { response.writeHead(400).end("Invalid OAuth state."); return; }
      if (url.searchParams.has("error") || url.searchParams.getAll("code").length !== 1 || !url.searchParams.get("code")) {
        response.writeHead(400).end("Authorization was not completed."); finish(new Error("Gmail authorization was denied or incomplete.")); return;
      }
      response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" }).end("Authorization received. Return to the terminal.");
      finish(undefined, url.searchParams.get("code")!);
    });
    const timer = setTimeout(() => finish(new Error("Gmail authorization timed out. Run the command again.")), 300_000);
    server.on("error", () => finish(new Error("Cannot open the local OAuth callback.")));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { finish(new Error("Invalid OAuth callback address.")); return; }
      redirect = `http://127.0.0.1:${address.port}/oauth2callback`;
      try { launch(buildUrl(redirect, state)); } catch { finish(new Error("Cannot start browser authorization.")); }
    });
  });
}

export async function authenticateGmail(credentialsPath: string, tokenPath: string, authorize: typeof browserCode = browserCode, mode: GmailAuthMode = "readonly"): Promise<{ account: string; accessToken: () => Promise<string> }> {
  try {
    const data = JSON.parse(await readFile(credentialsPath, "utf8"));
    const keys = data.installed;
    if (!keys || typeof keys.client_id !== "string" || !keys.client_id.endsWith(".apps.googleusercontent.com") || typeof keys.client_secret !== "string" || !keys.client_secret) throw new Error();
    const client = new OAuth2Client({ clientId: keys.client_id, clientSecret: keys.client_secret });
    // Override SDK retry defaults for token exchange, refresh and token-info requests.
    client.transporter.interceptors.request.add({ resolved: async request => {
      request.retry = false; request.retryConfig = { retry: 0 }; request.timeout = 30_000; return request;
    } });
    let refreshToken = await loadRefreshToken(tokenPath, keys.client_id);
    if (refreshToken) client.setCredentials({ refresh_token: refreshToken });
    else {
      const pkce = await client.generateCodeVerifierAsync();
      const challenge = pkce.codeChallenge;
      if (!challenge) throw new Error();
      const callback = await authorize((redirect, state) => {
        const url = client.generateAuthUrl({ redirect_uri: redirect, state, scope: mode === "read-send" ? [GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE] : [GMAIL_READONLY_SCOPE], access_type: "offline", prompt: "consent", include_granted_scopes: false,
          code_challenge: challenge, code_challenge_method: CodeChallengeMethod.S256 });
        console.log(`Open this URL on this computer if the browser does not open:\n${url}`);
        return url;
      });
      const { tokens } = await client.getToken({ code: callback.code, redirect_uri: callback.redirect, codeVerifier: pkce.codeVerifier });
      if (!tokens.refresh_token) throw new Error();
      refreshToken = tokens.refresh_token; client.setCredentials(tokens);
    }
    let verifiedToken: string | undefined;
    const accessToken = async (): Promise<string> => {
      try {
        const value = (await client.getAccessToken()).token;
        if (!value) throw new Error();
        if (value !== verifiedToken) {
          const info = await client.getTokenInfo(value);
          validateScopes(info.scopes, mode);
          if (info.aud !== keys.client_id) throw new Error();
          verifiedToken = value;
        }
        return value;
      } catch (error) { if (error instanceof ScopeError && mode === "read-send") throw error; throw new Error("Gmail authorization failed. Use a dedicated read-only Desktop client; remove the local token and authorize again if expired or revoked."); }
    };
    await accessToken();
    await saveRefreshToken(tokenPath, keys.client_id, refreshToken);
    // Local grant identity, not an asserted or verified email address. Never log the token.
    return { account: `oauth-grant:${createHash("sha256").update(refreshToken).digest("hex")}`, accessToken };
  } catch (error) {
    if (error instanceof ScopeError && mode === "read-send") throw error;
    if (mode === "read-send") throw new Error("Cannot initialize Gmail send OAuth. Check the dedicated send Desktop credentials, test-user access and network. Remove the send token (.tokens/gmail-send.json by default) and reauthorize if expired or revoked. No credentials were logged; no send attempted.");
    throw new Error("Cannot initialize Gmail OAuth. Check the Desktop credentials file, test-user access and network. For expired/revoked/mismatched tokens, remove .tokens/gmail.json and authorize again. No credentials were logged.");
  }
}
