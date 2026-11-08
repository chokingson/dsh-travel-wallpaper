/** Subscription protocol adapter derived from dsh-image-gen 0.9.1 (Apache-2.0).
 * Modified for Travel Wallpaper: standalone exports and local login messages.
 * See THIRD_PARTY_NOTICES.md for source, licenses and original MIT notices.
 */
import http from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
const SUBSCRIPTION_PROVIDER_DISPLAY_NAMES = { 'chatgpt-sub': 'ChatGPT订阅', 'google-sub': 'Google订阅', 'grok-sub': 'Grok订阅' };
const DEFAULT_SUBSCRIPTION_MODELS = { 'chatgpt-sub': 'gpt-image-2.5-flare', 'google-sub': 'gemini-3.1-flash-image' };
const credentialRef = value => value;
//#region lib/types/subscription/oauth.js
/**
* OAuth primitives shared by the subscription vendors.
*
* Adapted from @goodandready/dsh-subscriptions (MIT, (c) 2026 GooDAnDReaDY)
* lib/oauth.js, lib/pkce.js, lib/jwt.js — PKCE generation, authorize-URL
* building and the JWT payload reads the vendors need for identity headers.
*/
async function createPkce() {
	const verifier = Buffer.from(randomBytes(32)).toString("base64url");
	return {
		verifier,
		challenge: Buffer.from(createHash("sha256").update(verifier).digest()).toString("base64url"),
		state: Buffer.from(randomBytes(16)).toString("base64url")
	};
}
/** Build an authorization-code URL with PKCE and optional extra params. */
function buildAuthorizeUrl(input) {
	const url = new URL(input.authUrl);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", input.clientId);
	url.searchParams.set("redirect_uri", input.redirectUri);
	url.searchParams.set("code_challenge", input.challenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", input.state);
	if (input.scope !== void 0 && input.scope.length > 0) url.searchParams.set("scope", input.scope);
	if (input.extra !== void 0) for (const [key, value] of Object.entries(input.extra)) {
		if (value === null || value === void 0 || value === "") continue;
		url.searchParams.set(key, String(value));
	}
	return url.toString();
}
/** Decode a JWT payload without signature verification (identity read only). */
function decodeJwtPayload(token) {
	const parts = String(token ?? "").split(".");
	if (parts.length < 2) return void 0;
	try {
		const json = Buffer.from(parts[1], "base64url").toString("utf8");
		const parsed = JSON.parse(json);
		return typeof parsed === "object" && parsed !== null ? parsed : void 0;
	} catch {
		return;
	}
}
/** The chatgpt-account-id a Codex API call must carry. */
function chatgptAccountId(token) {
	const payload = decodeJwtPayload(token);
	if (payload === void 0) return "";
	if (typeof payload.chatgpt_account_id === "string") return payload.chatgpt_account_id;
	const nested = payload["https://api.openai.com/auth"];
	if (typeof nested === "object" && nested !== null && typeof nested.chatgpt_account_id === "string") return nested.chatgpt_account_id;
	const orgs = payload.organizations;
	if (Array.isArray(orgs) && orgs[0] !== null && typeof orgs[0] === "object" && typeof orgs[0].id === "string") return orgs[0].id;
	return "";
}
/** The account email for badges and login confirmation. */
function emailFromToken(token) {
	const payload = decodeJwtPayload(token);
	if (payload === void 0) return "";
	const email = payload.email;
	const preferred = payload.preferred_username;
	if (typeof email === "string" && email.length > 0) return email;
	if (typeof preferred === "string") return preferred;
	return "";
}
/** POST an OAuth token endpoint with form encoding; 25s cap like the source. */
async function formTokenRequest(url, params, fetchImpl) {
	const response = await fetchImpl(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json"
		},
		body: new URLSearchParams(params).toString(),
		signal: AbortSignal.timeout(25e3)
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`订阅登录或刷新失败（HTTP ${String(response.status)}），请重新授权`);
	}
	try {
		const parsed = await response.json();
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}
//#endregion
//#region lib/types/subscription/loopback.js
/**
* Temporary loopback server that catches the OAuth redirect on a vendor-fixed
* local port and hands the code to a handler.
*
* Adapted from @goodandready/dsh-subscriptions (MIT, (c) 2026 GooDAnDReaDY)
* lib/loopback.js — same protocol (first matching request wins, server shuts
* down, 10-minute cap), restated in TypeScript with this bundle's style.
*/
const OK_HTML = "<!doctype html><meta charset=\"utf-8\"><title>旅行壁纸</title><p lang=\"zh-CN\">登录成功，可以关闭此页返回设置。</p><p lang=\"en\">Sign-in successful. You can close this page and return to settings.</p>";
const ERR_HTML = "<!doctype html><meta charset=\"utf-8\"><title>旅行壁纸</title><p lang=\"zh-CN\">登录失败，请返回设置重试。</p><p lang=\"en\">Sign-in failed. Return to settings and try again.</p><p lang=\"zh-CN\">需要代理时，请在重新登录前开启代理软件的 TUN（虚拟网卡）模式。普通系统代理可能无法覆盖 DSH 后端请求，导致网页授权后登录失败。</p><p lang=\"en\">If you need a proxy, enable TUN (virtual network adapter) mode before trying again. A system proxy alone may not cover DSH backend requests, causing sign-in to fail after browser authorization.</p>";
/**
* Loopback addresses accepted by the request handler. On dual-stack systems
* Node reports IPv4-mapped IPv6 addresses as `::ffff:127.0.0.1`, so we must
* accept that form in addition to the canonical IPv4 and IPv6 loopback.
*/
const LOOPBACK_ADDRESSES = /* @__PURE__ */ new Set([
	"127.0.0.1",
	"::1",
	"::ffff:127.0.0.1"
]);
/**
* Listen on the redirect_uri's port and resolve when the provider calls back.
* Rejects on port conflicts, network errors, or when nothing arrives in time.
*/
function startLoopback(options) {
	const parsed = new URL(options.redirectUri);
	if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return Promise.reject(/* @__PURE__ */ new Error(`loopback redirect requires localhost, got ${parsed.hostname}`));
	const port = Number(parsed.port) || 80;
	const path = parsed.pathname;
	const timeoutMs = options.timeoutMs ?? 6e5;
	const state = { done: false };
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const remote = req.socket.remoteAddress ?? "";
			if (!LOOPBACK_ADDRESSES.has(remote)) {
				res.writeHead(403);
				res.end();
				return;
			}
			const url = new URL(req.url ?? "/", `http://127.0.0.1:${String(port)}`);
			if (!url.pathname.startsWith(path)) {
				res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
				res.end(ERR_HTML);
				return;
			}
			if (state.done) return;
			state.done = true;
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			Promise.resolve(options.onCode(url.searchParams)).then((html) => {
				res.end(html.length > 0 ? html : OK_HTML);
			}).catch(() => {
				res.end(ERR_HTML);
			}).finally(() => {
				clearTimeout(timer);
				server.close();
				resolve({ ok: true });
			});
		});
		server.on("error", (error) => {
			if (state.done) return;
			state.done = true;
			clearTimeout(timer);
			reject(error);
		});
		const timer = setTimeout(() => {
			if (state.done) return;
			state.done = true;
			server.close();
			reject(/* @__PURE__ */ new Error("loopback timeout: no callback received"));
		}, timeoutMs);
		server.listen(port, '127.0.0.1', () => options.onReady?.(() => { clearTimeout(timer); server.close(); }));
	});
}
//#endregion
//#region lib/types/subscription/blob.js
/**
* OAuth token blob persistence for subscription accounts.
*
* Adapted from @goodandready/dsh-subscriptions (MIT, (c) 2026 GooDAnDReaDY)
* lib/blob.js — trimmed to the two image vendors this plugin ships. The blob
* is stored through the DSH Credentials service under a provider-scoped ref
* (see refs.ts); it never reaches the browser side.
*/
function asString(value) {
	return value === null || value === void 0 ? "" : String(value);
}
/** Serialize a blob for storage; at least one token must be present. */
function serializeBlob(obj) {
	const accessToken = asString(obj.accessToken);
	const refreshToken = asString(obj.refreshToken);
	if (accessToken.length === 0 && refreshToken.length === 0) throw new Error("oauth blob needs accessToken or refreshToken");
	return JSON.stringify({
		accessToken,
		refreshToken,
		expiresAt: Number(obj.expiresAt) || 0,
		label: asString(obj.label),
		email: asString(obj.email),
		accountId: asString(obj.accountId)
	});
}
/** Parse a stored blob back; invalid input throws. */
function parseBlob(text) {
	const obj = typeof text === "string" ? JSON.parse(text) : text;
	if (typeof obj !== "object" || obj === null) throw new Error("invalid oauth blob");
	const row = obj;
	return {
		accessToken: asString(row.accessToken),
		refreshToken: asString(row.refreshToken),
		expiresAt: Number(row.expiresAt) || 0,
		label: asString(row.label),
		email: asString(row.email),
		accountId: asString(row.accountId)
	};
}
//#endregion
//#region lib/types/subscription/vendors/codex.js
/**
* ChatGPT (Codex) subscription image vendor.
*
* Adapted from @goodandready/dsh-subscriptions (MIT, (c) 2026 GooDAnDReaDY)
* lib/vendors/codex.js and lib/images.js — only the pieces the image channel
* needs: authorize URL, code exchange, refresh, and the generations call.
* The device-code flow and chat streaming stay out of this bundle.
*/
const CODEX_AUTH = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN = "https://auth.openai.com/oauth/token";
const CODEX_SCOPE = "openid profile email offline_access api.connectors.read api.connectors.invoke";
/** Where the ChatGPT subscription image request goes. */
const CODEX_IMAGE_URL = "https://chatgpt.com/backend-api/codex/images/generations";
/** Where the ChatGPT subscription image edit request goes. */
const CODEX_IMAGE_EDIT_URL = "https://chatgpt.com/backend-api/codex/images/edits";
/** The model served by this endpoint (probed live: gpt-image-2.5-flare works
* on the ChatGPT internal generations route as of 2026-09-14). */
const CODEX_IMAGE_MODEL = "gpt-image-2.5-flare";
/** Public client id of the Codex CLI; vendor-fixed redirect on port 1455. */
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
function codexConfig() {
	return {
		clientId: CODEX_CLIENT_ID,
		redirectUri: CODEX_REDIRECT_URI
	};
}
function codexAuthorizeUrl(cfg, pkce) {
	return buildAuthorizeUrl({
		authUrl: CODEX_AUTH,
		clientId: cfg.clientId,
		redirectUri: cfg.redirectUri,
		challenge: pkce.challenge,
		state: pkce.state,
		scope: CODEX_SCOPE,
		extra: {
			id_token_add_organizations: "true",
			codex_cli_simplified_flow: "true",
			originator: "codex_cli_rs"
		}
	});
}
/** Identity fields every Codex API call must carry. */
function codexIdentityHeaders(blob) {
	return {
		authorization: `Bearer ${blob.accessToken}`,
		"chatgpt-account-id": blob.accountId,
		originator: "codex_cli_rs",
		"content-type": "application/json",
		accept: "application/json"
	};
}
function decorate(blob, json) {
	const idToken = typeof json.id_token === "string" ? json.id_token : "";
	return {
		...blob,
		accountId: blob.accountId.length > 0 ? blob.accountId : chatgptAccountId(idToken) || chatgptAccountId(blob.accessToken),
		email: blob.email.length > 0 ? blob.email : emailFromToken(idToken) || emailFromToken(blob.accessToken),
		label: blob.label.length > 0 ? blob.label : emailFromToken(idToken) || emailFromToken(blob.accessToken) || "ChatGPT"
	};
}
function tokenBlobFromOAuth$2(json) {
	const access = json.access_token;
	const refresh = json.refresh_token;
	return {
		accessToken: typeof access === "string" ? access : "",
		refreshToken: typeof refresh === "string" ? refresh : "",
		expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1e3,
		label: "",
		email: "",
		accountId: ""
	};
}
async function codexExchangeCode(cfg, pkce, code) {
	const json = await formTokenRequest(CODEX_TOKEN, {
		grant_type: "authorization_code",
		client_id: cfg.clientId,
		code,
		redirect_uri: cfg.redirectUri,
		code_verifier: pkce.verifier
	}, fetch);
	return decorate(tokenBlobFromOAuth$2(json), json);
}
async function codexRefresh(blob) {
	const next = tokenBlobFromOAuth$2(await formTokenRequest(CODEX_TOKEN, {
		grant_type: "refresh_token",
		client_id: CODEX_CLIENT_ID,
		refresh_token: blob.refreshToken
	}, fetch));
	return {
		...next,
		refreshToken: next.refreshToken.length > 0 ? next.refreshToken : blob.refreshToken,
		label: blob.label,
		email: blob.email,
		accountId: blob.accountId.length > 0 ? blob.accountId : next.accountId
	};
}
//#endregion
//#region lib/types/subscription/vendors/grok.js
/**
* Grok subscription image vendor.
*
* Adapted from @goodandready/dsh-subscriptions (MIT, (c) 2026 GooDAnDReaDY)
* lib/vendors/grok.js and lib/images.js — only the pieces the image channel
* needs: authorize URL, code exchange, refresh, and the generations call
* (grok-cli token, not an xAI API key).
*/
const GROK_AUTH = "https://auth.x.ai/oauth2/authorize";
const GROK_TOKEN = "https://auth.x.ai/oauth2/token";
const GROK_SCOPE = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";
/** Where the Grok subscription image request goes. */
const GROK_IMAGE_URL = "https://api.x.ai/v1/images/generations";
/** Where the Grok subscription image edit request goes. */
const GROK_IMAGE_EDIT_URL = "https://api.x.ai/v1/images/edits";
/** The model served by this endpoint. */
const GROK_IMAGE_MODEL = "grok-imagine-image-2.0";
/** Public client id of the grok-cli; vendor-fixed redirect on 127.0.0.1:56121. */
const GROK_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const GROK_REDIRECT_URI = "http://127.0.0.1:56121/callback";
function grokConfig() {
	return {
		clientId: GROK_CLIENT_ID,
		redirectUri: GROK_REDIRECT_URI
	};
}
function grokAuthorizeUrl(cfg, pkce) {
	return buildAuthorizeUrl({
		authUrl: GROK_AUTH,
		clientId: cfg.clientId,
		redirectUri: cfg.redirectUri,
		challenge: pkce.challenge,
		state: pkce.state,
		scope: GROK_SCOPE
	});
}
/** Identity fields every grok.com call must carry (the API host ignores them). */
function grokIdentityHeaders(blob) {
	return {
		authorization: `Bearer ${blob.accessToken}`,
		"X-XAI-Token-Auth": "xai-grok-cli",
		"x-grok-client-identifier": "grok-shell",
		"x-grok-client-version": "0.2.103",
		"User-Agent": "xai-grok-cli",
		"content-type": "application/json",
		accept: "application/json"
	};
}
function tokenBlobFromOAuth$1(json) {
	const access = json.access_token;
	const refresh = json.refresh_token;
	return {
		accessToken: typeof access === "string" ? access : "",
		refreshToken: typeof refresh === "string" ? refresh : "",
		expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1e3,
		label: "",
		email: "",
		accountId: ""
	};
}
async function grokExchangeCode(cfg, pkce, code) {
	const blob = tokenBlobFromOAuth$1(await formTokenRequest(GROK_TOKEN, {
		grant_type: "authorization_code",
		client_id: cfg.clientId,
		code,
		redirect_uri: cfg.redirectUri,
		code_verifier: pkce.verifier
	}, fetch));
	return {
		...blob,
		email: blob.email.length > 0 ? blob.email : emailFromToken(blob.accessToken),
		label: "Grok"
	};
}
async function grokRefresh(blob) {
	const next = tokenBlobFromOAuth$1(await formTokenRequest(GROK_TOKEN, {
		grant_type: "refresh_token",
		client_id: GROK_CLIENT_ID,
		refresh_token: blob.refreshToken
	}, fetch));
	return {
		...next,
		refreshToken: next.refreshToken.length > 0 ? next.refreshToken : blob.refreshToken,
		label: blob.label.length > 0 ? blob.label : "Grok",
		email: blob.email.length > 0 ? blob.email : next.email
	};
}
//#endregion
//#region lib/types/subscription/vendors/antigravity.js
/**
* Google Antigravity (Nano Banana 2) subscription image vendor.
*
* Protocol adapted from opencode-antigravity-auth-remix (MIT,
* (c) 2026 Darkstarrd-dev, based on NoeFabris/opencode-antigravity-auth):
* Google OAuth with the Antigravity CLI's public client credentials, managed
* project discovery via loadCodeAssist, and image generation through the
* v1internal:streamGenerateContent endpoint. Reference:
* dist/src/constants.js, dist/src/plugin/image.js,
* dist/src/plugin/project.js.
*
* The dsh-subscriptions antigravity vendor left the OAuth client empty
* (Google's is confidential); the remix package ships the Antigravity CLI's
* own embedded client id/secret, which the community treats as public the
* same way Codex CLI's and grok-cli's are.
*/
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const SCOPE = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs"
].join(" ");
/** Antigravity CLI's embedded OAuth client, treated as public like Codex's. */
const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const ANTIGRAVITY_CLIENT_SECRET = "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";
const ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";
/**
* Preserve the working sandbox routes, then try ordinary daily (consumer
* accounts) before the production compatibility fallback. A Gmail address
* alone does not establish which backend an account can use.
*/
const ANTIGRAVITY_ENDPOINTS = [
	"https://daily-cloudcode-pa.sandbox.googleapis.com",
	"https://autopush-cloudcode-pa.sandbox.googleapis.com",
	"https://daily-cloudcode-pa.googleapis.com",
	"https://cloudcode-pa.googleapis.com"
];
/** loadCodeAssist is best supported on prod; discovery tries prod first. */
const LOAD_ENDPOINTS = [
	"https://cloudcode-pa.googleapis.com",
	"https://daily-cloudcode-pa.sandbox.googleapis.com",
	"https://autopush-cloudcode-pa.sandbox.googleapis.com",
	"https://daily-cloudcode-pa.googleapis.com"
];
/** The image model served through this channel: Nano Banana 2. */
const ANTIGRAVITY_IMAGE_MODEL = DEFAULT_SUBSCRIPTION_MODELS["google-sub"];
/**
* Antigravity client version carried in the browser User-Agent. Google's
* backend routes by this: a non-Antigravity or outdated UA lands in the
* enterprise-license check and fails with the misleading 403 #3501
* "You do not have a valid license of this product". The official
* auto-updater publishes the current version; changelog scrape and the
* hardcoded fallback keep the header sane when the updater is unreachable
* (same strategy as the reference implementation's version.js).
*/
const ANTIGRAVITY_VERSION_FALLBACK = "2.0.6";
const VERSION_URL = "https://antigravity-auto-updater-974169037036.us-central1.run.app";
const CHANGELOG_URL = "https://antigravity.google/changelog";
const VERSION_FETCH_TIMEOUT_MS = 5e3;
const CHANGELOG_SCAN_CHARS = 5e3;
const VERSION_REGEX = /\d+\.\d+\.\d+/;
let antigravityVersion;
/** Current client version: the fetched one, or the fallback until fetched. */
function getAntigravityVersion() {
	return antigravityVersion ?? ANTIGRAVITY_VERSION_FALLBACK;
}
/** Fetch and cache the current version once; failures keep the fallback. */
async function initAntigravityVersion(signal) {
	signal?.throwIfAborted();
	if (antigravityVersion !== void 0) return;
	const parsed = await fetchVersionText(VERSION_URL, void 0, signal) ?? await fetchVersionText(CHANGELOG_URL, CHANGELOG_SCAN_CHARS, signal);
	signal?.throwIfAborted();
	if (parsed !== void 0) antigravityVersion = parsed;
}
async function fetchVersionText(url, maxChars, signal) {
	try {
		const timeout = AbortSignal.timeout(VERSION_FETCH_TIMEOUT_MS);
		const response = await fetch(url, { signal: signal === void 0 ? timeout : AbortSignal.any([signal, timeout]) });
		if (!response.ok) return void 0;
		let text = await response.text();
		if (maxChars !== void 0) text = text.slice(0, maxChars);
		const match = text.match(VERSION_REGEX);
		return match === null ? void 0 : match[0];
	} catch (error) {
		if (signal?.aborted === true) throw error;
		return;
	}
}
/** Legacy compatibility project: not an account project or proof of entitlement. */
const DEFAULT_PROJECT_ID = "rising-fact-p41fc";
/** Generation timeout mirroring the reference implementation. */
const IMAGE_TIMEOUT_MS = 12e4;
/** Aspect ratios the generationConfig.imageConfig accepts (gemini-3.1-flash-image). */
const ASPECT_RATIOS = [
	"1:1",
	"2:3",
	"3:2",
	"3:4",
	"4:3",
	"4:5",
	"5:4",
	"9:16",
	"16:9",
	"21:9"
];
/** Safety settings the image endpoint requires to not block benign prompts. */
const SAFETY_SETTINGS_OFF = [
	{
		category: "HARM_CATEGORY_HARASSMENT",
		threshold: "OFF"
	},
	{
		category: "HARM_CATEGORY_HATE_SPEECH",
		threshold: "OFF"
	},
	{
		category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
		threshold: "OFF"
	},
	{
		category: "HARM_CATEGORY_DANGEROUS_CONTENT",
		threshold: "OFF"
	},
	{
		category: "HARM_CATEGORY_CIVIC_INTEGRITY",
		threshold: "OFF"
	}
];
function antigravityConfig() {
	return {
		clientId: ANTIGRAVITY_CLIENT_ID,
		clientSecret: ANTIGRAVITY_CLIENT_SECRET,
		redirectUri: ANTIGRAVITY_REDIRECT_URI
	};
}
function antigravityAuthorizeUrl(cfg, pkce) {
	return buildAuthorizeUrl({
		authUrl: AUTH,
		clientId: cfg.clientId,
		redirectUri: cfg.redirectUri,
		challenge: pkce.challenge,
		state: pkce.state,
		scope: SCOPE,
		extra: {
			access_type: "offline",
			prompt: "consent"
		}
	});
}
/**
* Preserve the SDK discovery identity first. A no-project UNSUPPORTED_CLIENT
* response can be retried with the same Antigravity identity as generation.
*/
function loadHeaders(projectId, identity) {
	return {
		"User-Agent": identity === "antigravity" ? antigravityUserAgent() : "google-api-nodejs-client/9.15.1",
		"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
		"Client-Metadata": JSON.stringify(clientMetadata(projectId))
	};
}
function antigravityUserAgent() {
	return `Mozilla/5.0 (${process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "Windows NT 10.0; Win64; x64"}) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${getAntigravityVersion()} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`;
}
/**
* Headers for content requests (image generation): the full Electron
* browser User-Agent with the Antigravity client version, matching the
* official IDE. This is the identity the license check keys on — the plain
* SDK UA here is what produced 403 #3501 on personal accounts.
*/
function contentHeaders(projectId) {
	return {
		"User-Agent": antigravityUserAgent(),
		"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
		"Client-Metadata": JSON.stringify(clientMetadata(projectId))
	};
}
function tokenBlobFromOAuth(json) {
	const access = json.access_token;
	const refresh = json.refresh_token;
	const idToken = typeof json.id_token === "string" ? json.id_token : "";
	return {
		accessToken: typeof access === "string" ? access : "",
		refreshToken: typeof refresh === "string" ? refresh : "",
		expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1e3,
		label: "",
		email: emailFromIdToken(idToken),
		accountId: ""
	};
}
/** Decode the id_token's JWT payload for the account email (identity only). */
function emailFromIdToken(idToken) {
	const parts = idToken.split(".");
	if (parts.length < 2) return "";
	try {
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		return typeof payload.email === "string" ? payload.email : "";
	} catch {
		return "";
	}
}
async function antigravityExchangeCode(cfg, pkce, code) {
	const blob = tokenBlobFromOAuth(await formTokenRequest(TOKEN, {
		client_id: cfg.clientId,
		client_secret: cfg.clientSecret,
		grant_type: "authorization_code",
		code,
		redirect_uri: cfg.redirectUri,
		code_verifier: pkce.verifier
	}, fetch));
	if (blob.accessToken.length === 0) throw new Error("Antigravity token endpoint returned no access token");
	return blob;
}
async function antigravityRefresh(blob) {
	const next = tokenBlobFromOAuth(await formTokenRequest(TOKEN, {
		client_id: ANTIGRAVITY_CLIENT_ID,
		client_secret: ANTIGRAVITY_CLIENT_SECRET,
		grant_type: "refresh_token",
		refresh_token: blob.refreshToken
	}, fetch));
	return {
		...next,
		refreshToken: next.refreshToken.length > 0 ? next.refreshToken : blob.refreshToken,
		label: blob.label,
		email: blob.email.length > 0 ? blob.email : next.email,
		accountId: ""
	};
}
/**
* Discover an actual account project, preserving HTTP and eligibility failures.
* Keep the legacy fallback for accounts whose image route still accepts it;
* UNSUPPORTED_CLIENT here describes Code Assist, not a universal image ban.
* Do not invoke onboarding or accept account terms during image generation.
*/
async function antigravityResolveProjectContext(blob, signal) {
	signal?.throwIfAborted();
	const metadata = clientMetadata("");
	const diagnostics = [];
	const identityRetryEndpoints = [];
	for (const identity of ["sdk", "antigravity"]) {
		const endpoints = identity === "sdk" ? LOAD_ENDPOINTS : identityRetryEndpoints;
		if (identity === "antigravity") {
			if (endpoints.length === 0) break;
			await initAntigravityVersion(signal);
		}
		for (const base of endpoints) {
			signal?.throwIfAborted();
			const label = `loadCodeAssist ${new URL(base).hostname}${identity === "antigravity" ? ` [Antigravity/${getAntigravityVersion()}]` : ""}`;
			try {
				const response = await fetch(`${base}/v1internal:loadCodeAssist`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${blob.accessToken}`,
						...loadHeaders("", identity)
					},
					body: JSON.stringify({ metadata }),
					signal: signal === void 0 ? AbortSignal.timeout(25e3) : AbortSignal.any([signal, AbortSignal.timeout(25e3)])
				});
				if (!response.ok) {
					diagnostics.push(`${label}: ${httpDiagnostic(response.status, await response.text().catch(() => ""), blob)}`);
					continue;
				}
				const payload = recordOf(await response.json().catch(() => null));
				if (payload === void 0) {
					diagnostics.push(`${label}: HTTP ${String(response.status)}, invalid response`);
					continue;
				}
				const project = payload.cloudaicompanionProject;
				const projectRecord = recordOf(project);
				const id = typeof project === "string" ? project : typeof projectRecord?.id === "string" ? projectRecord.id : "";
				if (id.trim().length > 0) return {
					projectId: id.trim(),
					source: "account",
					diagnostics
				};
				diagnostics.push(`${label}: HTTP ${String(response.status)}, ${missingProjectDiagnostic(payload, blob)}`);
				if (identity === "sdk" && Array.isArray(payload.ineligibleTiers) && payload.ineligibleTiers.some((tier) => recordOf(tier)?.reasonCode === "UNSUPPORTED_CLIENT")) identityRetryEndpoints.push(base);
			} catch (error) {
				if (signal?.aborted === true) throw error;
				diagnostics.push(`${label}: ${diagnosticText(error instanceof Error ? error.message : "request failed", blob)}`);
			}
		}
	}
	return {
		projectId: DEFAULT_PROJECT_ID,
		source: "fallback",
		diagnostics
	};
}
/** Google ClientMetadata.Platform enum, shared by request body and headers. */
function platformOf() {
	if (process.platform === "win32" && process.arch === "x64") return "WINDOWS_AMD64";
	if (process.platform === "darwin" && process.arch === "x64") return "DARWIN_AMD64";
	if (process.platform === "darwin" && process.arch === "arm64") return "DARWIN_ARM64";
	if (process.platform === "linux" && process.arch === "x64") return "LINUX_AMD64";
	if (process.platform === "linux" && process.arch === "arm64") return "LINUX_ARM64";
	return "PLATFORM_UNSPECIFIED";
}
function clientMetadata(projectId) {
	return {
		ideType: "ANTIGRAVITY",
		platform: platformOf(),
		pluginType: "GEMINI",
		...projectId.length > 0 ? { duetProject: projectId } : {}
	};
}
function recordOf(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/** Upstream errors may echo request identity; redact before bounding the text. */
function diagnosticText(value, blob) {
	let text = typeof value === "string" ? value : "";
	for (const secret of [
		blob.accessToken,
		blob.refreshToken,
		blob.accountId,
		blob.email
	]) if (secret.length > 0) text = text.replaceAll(secret, "[redacted]");
	return text.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").replace(/\s+/g, " ").trim().slice(0, 200);
}
function httpDiagnostic(status, text, blob) {
	let detail = text;
	try {
		const error = recordOf(recordOf(JSON.parse(text))?.error);
		if (typeof error?.message === "string") detail = `${typeof error.status === "string" ? `${error.status}: ` : ""}${error.message}`;
	} catch {}
	const safe = diagnosticText(detail, blob);
	return `HTTP ${String(status)}${safe.length > 0 ? `: ${safe}` : ""}`;
}
function missingProjectDiagnostic(payload, blob) {
	const reasons = Array.isArray(payload.ineligibleTiers) ? payload.ineligibleTiers.flatMap((value) => {
		const tier = recordOf(value);
		return typeof tier?.reasonCode === "string" ? [`${tier.reasonCode}${typeof tier.reasonMessage === "string" ? `: ${tier.reasonMessage}` : ""}`] : [];
	}) : [];
	const allowed = Array.isArray(payload.allowedTiers) ? payload.allowedTiers.flatMap((value) => {
		const tier = recordOf(value);
		return typeof tier?.id === "string" ? [tier.id] : [];
	}) : [];
	const current = recordOf(payload.paidTier)?.id ?? recordOf(payload.currentTier)?.id;
	const detail = [
		...reasons,
		...typeof current === "string" ? [`tier=${current}`] : [],
		...allowed.length > 0 ? [`allowedTiers=${allowed.join(",")}`] : []
	];
	return `未返回账号项目${detail.length > 0 ? `; ${diagnosticText(detail.join("; "), blob)}` : ""}`;
}
/**
* Build the streamGenerateContent request body for one image generation.
* Ported from the reference buildImageRequest + the wrapping envelope: no
* tools, no systemInstruction, no thinkingConfig; responseModalities asks
* for TEXT+IMAGE. Reference images (edits) ride along as inlineData parts
* before the text part, mirroring the reference implementation.
*/
function antigravityImageBody(options) {
	const ratio = options.aspectRatio !== void 0 && ASPECT_RATIOS.includes(options.aspectRatio) ? options.aspectRatio : void 0;
	const imageConfig = ratio === void 0 ? {} : { aspectRatio: ratio };
	if (options.hd === true) imageConfig.imageSize = "4K";
	const parts = [];
	for (const image of options.referenceImages ?? []) parts.push({ inlineData: {
		mimeType: image.mediaType,
		data: Buffer.from(image.data).toString("base64")
	} });
	parts.push({ text: options.prompt });
	return {
		contents: [{
			role: "user",
			parts
		}],
		generationConfig: {
			candidateCount: 1,
			imageConfig,
			responseModalities: ["TEXT", "IMAGE"]
		},
		safetySettings: SAFETY_SETTINGS_OFF
	};
}
/** Wrap the inner request in the Antigravity agent envelope. */
function antigravityEnvelope(projectId, request) {
	return {
		project: projectId,
		model: ANTIGRAVITY_IMAGE_MODEL,
		userAgent: "antigravity",
		requestId: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
		requestType: "agent",
		request: {
			...request,
			session_id: `sess-${randomUUID()}`
		}
	};
}
/**
* Generate one image on the logged-in Antigravity account: resolve the
* project, POST the wrapped body to each endpoint in fallback order, and
* parse the SSE stream for the inlineData image part.
*/
async function antigravityGenerateImage(options) {
	options.signal?.throwIfAborted();
	await initAntigravityVersion(options.signal);
	const inner = antigravityImageBody({
		prompt: options.prompt,
		...options.aspectRatio !== void 0 ? { aspectRatio: options.aspectRatio } : {},
		...options.hd !== void 0 ? { hd: options.hd } : {},
		...options.referenceImages !== void 0 ? { referenceImages: options.referenceImages } : {}
	});
	const body = antigravityEnvelope(options.projectId, inner);
	const failures = [];
	for (const base of ANTIGRAVITY_ENDPOINTS) {
		const url = `${base}/v1internal:streamGenerateContent?alt=sse`;
		const timeoutSignal = AbortSignal.timeout(IMAGE_TIMEOUT_MS);
		const signal = options.signal !== void 0 ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					...contentHeaders(options.projectId),
					Authorization: `Bearer ${options.blob.accessToken}`,
					"Content-Type": "application/json",
					Accept: "text/event-stream"
				},
				body: JSON.stringify(body),
				signal
			});
			if (!response.ok) {
				const text = await response.text().catch(() => "");
				failures.push(`${new URL(base).hostname}: ${httpDiagnostic(response.status, text, options.blob)}`);
				continue;
			}
			const text = await response.text();
			const parsed = parseSseImage(text);
			if (parsed !== void 0) return parsed;
			const reason = parseSseError(text);
			failures.push(`${new URL(base).hostname}: ${diagnosticText(reason ?? "response contained no image", options.blob)}`);
			continue;
		} catch (error) {
			if (options.signal?.aborted === true) throw error;
			failures.push(`${new URL(base).hostname}: ${diagnosticText(error instanceof Error ? error.message : "request failed", options.blob)}`);
			continue;
		}
	}
	const discovery = options.projectContext?.source === "fallback" ? ["项目发现未返回账号项目，已尝试兼容项目。", ...options.projectContext.diagnostics] : [];
	throw new Error(`antigravity image generation failed: ${[...discovery, ...failures].join(" | ")}`);
}
/** Scan an SSE body for the first image part in any data: line. */
function parseSseImage(text) {
	for (const line of text.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const raw = line.slice(6).trim();
		if (raw.length === 0 || raw === "[DONE]") continue;
		try {
			const data = JSON.parse(raw);
			for (const candidate of data.response?.candidates ?? []) for (const part of candidate.content?.parts ?? []) {
				const inline = part.inlineData;
				if (typeof inline?.data === "string" && inline.data.length > 0 && typeof inline.mimeType === "string" && inline.mimeType.startsWith("image/")) return {
					b64: inline.data,
					mimeType: inline.mimeType
				};
			}
		} catch {}
	}
}
/** Pull the first error block an SSE body reports, for better messages. */
function parseSseError(text) {
	for (const line of text.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const raw = line.slice(6).trim();
		if (raw.length === 0 || raw === "[DONE]") continue;
		try {
			const data = JSON.parse(raw);
			if (data.error !== void 0) {
				const code = typeof data.error.code === "string" || typeof data.error.code === "number" ? String(data.error.code) : "";
				const message = typeof data.error.message === "string" ? data.error.message : "";
				const joined = `${code.length > 0 ? `${code}: ` : ""}${message}`.trim();
				if (joined.length > 0) return joined;
			}
		} catch {}
	}
}
//#endregion
//#region lib/types/xai-params.js
/** xAI's image routes use aspect_ratio/resolution rather than OpenAI's size. */
const RATIOS = /* @__PURE__ */ new Set([
	"auto",
	"1:1",
	"16:9",
	"9:16",
	"4:3",
	"3:4",
	"3:2",
	"2:3",
	"2:1",
	"1:2",
	"19.5:9",
	"9:19.5",
	"20:9",
	"9:20",
	"21:9",
	"5:2"
]);
function xaiToolParameters(options) {
	let ratio = options.aspectRatio;
	if (options.size !== void 0) {
		const match = /^(\d+)x(\d+)$/.exec(options.size);
		if (match === null) throw new Error("xAI size 请使用 WIDTHxHEIGHT；也可直接传 aspect_ratio");
		const width = Number(match[1]);
		const height = Number(match[2]);
		if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error("xAI size 必须是正整数宽高");
		let divisor = width;
		let remainder = height;
		while (remainder !== 0) {
			const next = divisor % remainder;
			divisor = remainder;
			remainder = next;
		}
		const fromSize = `${String(width / divisor)}:${String(height / divisor)}`;
		if (ratio !== void 0 && ratio !== fromSize) throw new Error("xAI size 与 aspect_ratio 不一致");
		ratio = fromSize;
	}
	if (ratio !== void 0 && !RATIOS.has(ratio)) throw new Error(`xAI 不支持比例 ${ratio}`);
	const resolution = options.imageSize?.toLowerCase();
	if (resolution !== void 0 && resolution !== "1k" && resolution !== "2k") throw new Error(`xAI 不支持清晰度 ${options.imageSize}`);
	return {
		...ratio === void 0 || ratio === "auto" ? {} : { aspect_ratio: ratio },
		...resolution === void 0 ? {} : { resolution }
	};
}
//#endregion
//#region lib/types/subscription/manager.js
/**
* Subscription account manager: login flows, blob storage through the DSH
* Credentials service, token refresh with per-account locking, and image
* generation on the logged-in account.
*
* The account store pattern follows @goodandready/dsh-subscriptions (MIT,
* (c) 2026 GooDAnDReaDY) lib/accounts.js, trimmed to one account per vendor
* (no rotation, no cooldowns) because this bundle has one account per vendor
* and no chat adapter to protect.
*
* Isolation invariants (project rules):
* - OAuth blobs live under SUBSCRIPTION_OAUTH_* refs, never the API-key refs.
* - Login/logout never touches any other setting or credential.
* - The browser side never sees a token; it sees the authorize URL and
*   status words only. Generation happens host-side, mirroring every other
*   adapter in this bundle.
*/
/** The vendor each dsh-image-gen subscription provider maps onto. */
function vendorOf(provider) {
	if (provider === "chatgpt-sub") return "codex";
	if (provider === "google-sub") return "antigravity";
	return "grok";
}
/** Credential ref one vendor's OAuth blob is stored under (index fixed at 1). */
function subscriptionOauthRef(vendor) {
	return credentialRef(`${vendor.toUpperCase()}_OAUTH_1`);
}
/**
* Per-application manager instance. Constructed once in the plugin entry,
* owns the pending-login map (PKCE state to login session) and the refresh
* locks; nothing here is persisted except the blobs themselves.
*/
/** Provider names by vendor for login-result pages and errors. */
function providerNameOf(vendor) {
	return SUBSCRIPTION_PROVIDER_DISPLAY_NAMES[vendor === "codex" ? "chatgpt-sub" : vendor === "antigravity" ? "google-sub" : "grok-sub"];
}
var SubscriptionManager = class {
	ctx;
	pending = /* @__PURE__ */ new Map();
	refreshLocks = /* @__PURE__ */ new Map();
	/** Cheap in-memory expiry cache so badges do not hit credentials on read. */
	blobCache = /* @__PURE__ */ new Map();
	/** Antigravity needs a per-account project id on every generation call. */
	projectCache = /* @__PURE__ */ new Map();
	loginClosers = new Map();
	constructor(ctx) {
		this.ctx = ctx;
		ctx.effect?.(() => () => { for (const close of this.loginClosers.values()) close(); this.pending.clear(); }, 'travel: subscription callbacks');
	}
	/** Read a vendor's stored blob, or undefined when signed out. */
	async readBlob(vendor) {
		try {
			const raw = (await this.ctx.credentials.resolve(subscriptionOauthRef(vendor)))?.value ?? "";
			if (raw.trim().length === 0) return void 0;
			return parseBlob(raw);
		} catch {
			return;
		}
	}
	/** Login status for the settings card; never throws. */
	async loginStatus(vendor) {
		const blob = await this.readBlob(vendor);
		if (blob === void 0) return { state: "logged-out" };
		return {
			state: "logged-in",
			email: blob.email
		};
	}
	/**
	* Begin a login: registers PKCE state, starts the loopback catch server on
	* the vendor-fixed redirect port, and returns the authorize URL for the
	* browser to open. Completion lands in the loopback callback.
	*/
	async beginLogin(vendor) {
		const redirectUri = vendor === "codex" ? CODEX_REDIRECT_URI : vendor === "antigravity" ? ANTIGRAVITY_REDIRECT_URI : GROK_REDIRECT_URI;
		const pkce = await createPkce();
		this.pending.set(pkce.state, {
			vendor,
			pkce
		});
		const url = vendor === "codex" ? codexAuthorizeUrl(codexConfig(), pkce) : vendor === "antigravity" ? antigravityAuthorizeUrl(antigravityConfig(), pkce) : grokAuthorizeUrl(grokConfig(), pkce);
        this.loginClosers.get(vendor)?.();
        let resolveReady, rejectReady;
        const ready = new Promise((resolve,reject)=>{ resolveReady=resolve; rejectReady=reject; });
        startLoopback({
          redirectUri,
          onReady: close => { this.loginClosers.set(vendor,close); resolveReady(); },
          onCode: async params => await this.completeLoginFromCallback(vendor,params.get('code')??'',params.get('state')??'')
        }).catch(error=>{ this.pending.delete(pkce.state); rejectReady(new Error(`登录回调端口${new URL(redirectUri).port}不可用：${error.code || error.message}`)); });
        await ready;
		return { url };
	}
	/** Loopback callback: validate state, exchange the code, store the blob. */
	async completeLoginFromCallback(vendor, code, state) {
		if (code.length === 0) throw new Error("callback carried no authorization code");
		const row = this.pending.get(state);
		if (row === void 0 || row.vendor !== vendor) throw new Error("login session expired; start again");
		this.pending.delete(state);
		const blob = vendor === "codex" ? await codexExchangeCode(codexConfig(), row.pkce, code) : vendor === "antigravity" ? await antigravityExchangeCode(antigravityConfig(), row.pkce, code) : await grokExchangeCode(grokConfig(), row.pkce, code);
		await this.saveBlob(vendor, blob);
		return `<!doctype html><meta charset="utf-8"><title>旅行壁纸</title><p lang="zh-CN">${providerNameOf(vendor)} 登录成功（${escapeHtml(blob.email)}），可以关闭此页返回设置。</p><p lang="en">${providerNameOf(vendor)} sign-in successful (${escapeHtml(blob.email)}). You can close this page and return to settings.</p>`;
	}
	/** Sign out: clear the blob and the caches. No other setting changes. */
	async logout(vendor) {
		await this.ctx.credentials.unset(subscriptionOauthRef(vendor));
		this.blobCache.delete(vendor);
		this.projectCache.clear();
	}
	async saveBlob(vendor, blob) {
		await this.ctx.credentials.set(subscriptionOauthRef(vendor), serializeBlob(blob));
		this.blobCache.set(vendor, blob);
	}
	/**
	* Return a blob whose access token is usable; refreshes first when the
	* stored one is expired (or expiring within the skew window). Single-flight
	* per vendor so concurrent generate calls share one refresh.
	*/
	async ensureFresh(vendor) {
		const blob = await this.readBlob(vendor);
		if (blob === void 0) throw notLoggedInError(vendor);
		if (blob.refreshToken.length === 0) return blob;
		if (blob.expiresAt !== 0 && blob.expiresAt - 6e4 > Date.now()) return blob;
		const inflight = this.refreshLocks.get(vendor);
		if (inflight !== void 0) return inflight;
		const refresh = (async () => {
			const next = vendor === "codex" ? await codexRefresh(blob) : vendor === "antigravity" ? await antigravityRefresh(blob) : await grokRefresh(blob);
			const merged = {
				...next,
				refreshToken: next.refreshToken.length > 0 ? next.refreshToken : blob.refreshToken,
				accountId: next.accountId.length > 0 ? next.accountId : blob.accountId
			};
			await this.saveBlob(vendor, merged);
			return merged;
		})().finally(() => {
			this.refreshLocks.delete(vendor);
		});
		this.refreshLocks.set(vendor, refresh);
		return refresh;
	}
	/** Generate one image through the logged-in account. b64 reply decoded host-side. */
	async generate(options) {
		const { vendor, prompt } = options;
		const session = await this.ensureFresh(vendor);
		const text = prompt.trim();
		if (text.length === 0) throw new Error("prompt must be a non-empty string");
		const references = options.referenceImages ?? [];
		if (references.length > 5) throw new Error(`订阅生图最多支持 ${String(5)} 张参考图，当前 ${String(references.length)} 张`);
		if (vendor === "antigravity") {
			const projectContext = await this.ensureAntigravityProject(session, options.signal);
			const aspectRatio = antigravityAspectRatioOf(options.size);
			return [{ b64_json: (await antigravityGenerateImage({
				blob: session,
				projectId: projectContext.projectId,
				projectContext,
				prompt: text,
				...aspectRatio !== void 0 ? { aspectRatio } : {},
				hd: options.quality === "hd" || options.quality === "high",
				...references.length > 0 ? { referenceImages: references } : {},
				...options.signal !== void 0 ? { signal: options.signal } : {}
			})).b64 }];
		}
		let url;
		let headers;
		let body;
		if (vendor === "codex") {
			url = references.length > 0 ? CODEX_IMAGE_EDIT_URL : CODEX_IMAGE_URL;
			headers = codexIdentityHeaders(session);
			body = {
				prompt: codexPromptWithSize(text, options.size),
				model: CODEX_IMAGE_MODEL,
				...references.length > 0 ? { images: references.map((image) => ({ image_url: toDataUrl(image) })) } : {},
				...options.size !== void 0 && options.size.length > 0 ? { size: options.size } : {},
				...options.quality !== void 0 && options.quality.length > 0 ? { quality: options.quality } : {}
			};
		} else {
			url = references.length > 0 ? GROK_IMAGE_EDIT_URL : GROK_IMAGE_URL;
			headers = grokIdentityHeaders(session);
			const xaiParams = xaiToolParameters({
				...options.size === void 0 ? {} : options.size === "auto" || options.size.includes(":") ? { aspectRatio: options.size } : { size: options.size },
				...options.quality === "1k" || options.quality === "2k" ? { imageSize: options.quality } : {}
			});
			const level = options.quality === "low" ? "low" : options.quality === "medium" || options.quality === "high" ? "medium" : void 0;
			body = {
				prompt: text,
				model: GROK_IMAGE_MODEL,
				response_format: "b64_json",
				...references.length === 1 ? { image: {
					type: "image_url",
					url: toDataUrl(references[0])
				} } : references.length > 1 ? { images: references.map((image) => ({
					type: "image_url",
					url: toDataUrl(image)
				})) } : {},
				...xaiParams,
				...level !== void 0 ? { quality: level } : {}
			};
		}
		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			...options.signal !== void 0 ? { signal: options.signal } : {}
		});
		const payload = await response.json().catch(() => ({}));
		if (!response.ok) {
			const detail = extractErrorMessage(payload);
			throw new Error(`${vendor} HTTP ${String(response.status)}${detail !== void 0 ? `: ${diagnosticText(detail, session)}` : ""}`);
		}
		return parseImages(payload);
	}
	/**
	* Resolve (and cache per refresh token) the managed project id the
	* Antigravity generation envelope needs. Re-resolved when the account
	* signs out or a different account logs in.
	*/
	async ensureAntigravityProject(blob, signal) {
		const cacheKey = blob.refreshToken.length > 0 ? blob.refreshToken : blob.accessToken.slice(0, 32);
		const cached = this.projectCache.get(cacheKey);
		if (cached !== void 0) return cached;
		const context = await antigravityResolveProjectContext(blob, signal);
		if (context.source === "account") this.projectCache.set(cacheKey, context);
		return context;
	}
};
/** The private Codex backend can ignore size while following a canvas ratio in
* the prompt (live checks: 16:9 -> 1672x941, 9:16 -> 941x1672). Keep size too;
* this is best-effort composition guidance, not an exact-pixel guarantee. */
function codexPromptWithSize(prompt, size) {
	const dimensions = /^(\d+)x(\d+)$/.exec(size ?? "");
	if (dimensions === null) return prompt;
	const width = Number(dimensions[1]);
	const height = Number(dimensions[2]);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return prompt;
	let divisor = width;
	let remainder = height;
	while (remainder !== 0) {
		const next = divisor % remainder;
		divisor = remainder;
		remainder = next;
	}
	const ratio = `${String(width / divisor)}:${String(height / divisor)}`;
	const orientation = width > height ? "横向宽屏" : width < height ? "竖向" : "正方形";
	return `${prompt}\n\n输出图片的画布宽高比必须为${ratio}，${orientation}构图，完整画面铺满${orientation}画布。`;
}
/** Map an OpenAI-style size onto the aspect ratio Antigravity accepts. */
function antigravityAspectRatioOf(size) {
	const table = {
		"1024x1024": "1:1",
		"1024x1536": "2:3",
		"1536x1024": "3:2",
		"768x1398": "9:16",
		"1398x768": "16:9"
	};
	if (size === void 0) return void 0;
	if (size === "auto") return void 0;
	const mapped = table[size];
	if (mapped !== void 0) return mapped;
	return /^\d+:\d+$/.test(size) ? size : "1:1";
}
/** Encode one reference image as the data URL the edit endpoints accept. */
function toDataUrl(image) {
	return `data:${image.mediaType};base64,${Buffer.from(image.data).toString("base64")}`;
}
/** Response parsing: Codex and Grok reply in the same `{data:[{b64_json}]}` shape. */
function parseImages(payload) {
	const body = typeof payload === "object" && payload !== null ? payload : {};
	const rows = Array.isArray(body.data) ? body.data : [];
	const images = [];
	const reportedQuality = typeof body.quality === "string" && body.quality.length > 0 ? body.quality : void 0;
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const b64 = row.b64_json;
		if (typeof b64 !== "string" || b64.length === 0) continue;
		const revised = row.revised_prompt;
		images.push({
			b64_json: b64,
			...typeof revised === "string" && revised.length > 0 ? { revisedPrompt: revised } : {},
			...reportedQuality !== void 0 ? { reportedQuality } : {}
		});
	}
	if (images.length === 0) throw new Error("response contains no images");
	return images;
}
function extractErrorMessage(payload) {
	if (typeof payload !== "object" || payload === null) return void 0;
	const error = payload.error;
	if (typeof error !== "object" || error === null) return void 0;
	const row = error;
	if (typeof row.message === "string") return row.message;
	if (typeof row.code === "string") return row.code;
}
function notLoggedInError(vendor) {
	const display = providerNameOf(vendor);
	return /* @__PURE__ */ new Error(`${display} 未登录：请到 旅行壁纸 > 渠道设置 完成订阅登录`);
}
function escapeHtml(value) {
	return value.replace(/[&<>"']/g, (ch) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;",
		"'": "&#39;"
	})[ch] ?? ch);
}
//#endregion

export { SubscriptionManager };
