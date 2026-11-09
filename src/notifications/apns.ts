import { type KeyObject, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { type ClientHttp2Session, connect } from "node:http2";
import type { DeviceRow } from "../db/devices";
import { envConfig } from "../env";

type ApnsEnvironment = DeviceRow["environment"];

const HOSTS: Record<ApnsEnvironment, string> = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
};

/** APNs rejects provider tokens older than an hour and throttles refreshes under twenty minutes. */
const TOKEN_LIFETIME_MS = 50 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

/** Reasons that mean the token will never work again, so the device is forgotten. */
const DEAD_TOKEN_REASONS = new Set([
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
  "Unregistered",
]);

type ApnsCredentials = {
  keyId: string;
  teamId: string;
  /** The .p8 key's PEM text. */
  privateKey: string;
};

export type ApnsNotification = {
  token: string;
  environment: ApnsEnvironment;
  /** The app's bundle ID. */
  topic: string;
  payload: Record<string, unknown>;
};

export type ApnsResult =
  | { ok: true }
  | { ok: false; status: number; reason: string; deadToken: boolean };

export type ApnsSend = (notification: ApnsNotification) => Promise<ApnsResult>;

const base64url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

/** The ES256 JWT APNs takes as a provider token. */
export function createProviderToken(
  key: KeyObject,
  keyId: string,
  teamId: string,
  now = Date.now(),
): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(
    JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `${header}.${claims}.${base64url(signature)}`;
}

/** Sends alert notifications over one HTTP/2 connection per APNs environment. */
export class ApnsClient {
  private readonly key: KeyObject;
  private readonly sessions = new Map<ApnsEnvironment, ClientHttp2Session>();
  private token?: { value: string; issuedAt: number };

  constructor(private readonly credentials: ApnsCredentials) {
    this.key = createPrivateKey(credentials.privateKey);
  }

  readonly send: ApnsSend = async (notification) => {
    const result = await this.post(notification);
    // A rejected provider token is replaced once; any other failure is final.
    if (!result.ok && result.reason === "ExpiredProviderToken") {
      this.token = undefined;
      return this.post(notification);
    }
    return result;
  };

  private providerToken(): string {
    const now = Date.now();
    if (!this.token || now - this.token.issuedAt > TOKEN_LIFETIME_MS) {
      const { keyId, teamId } = this.credentials;
      this.token = {
        value: createProviderToken(this.key, keyId, teamId, now),
        issuedAt: now,
      };
    }
    return this.token.value;
  }

  private session(environment: ApnsEnvironment): ClientHttp2Session {
    const existing = this.sessions.get(environment);
    if (existing && !existing.closed && !existing.destroyed) return existing;
    const session = connect(HOSTS[environment]);
    const forget = () => {
      if (this.sessions.get(environment) === session)
        this.sessions.delete(environment);
    };
    session.on("error", forget);
    session.on("goaway", forget);
    session.on("close", forget);
    session.unref();
    this.sessions.set(environment, session);
    return session;
  }

  private post({
    token,
    environment,
    topic,
    payload,
  }: ApnsNotification): Promise<ApnsResult> {
    return new Promise((resolve) => {
      const fail = (reason: string) =>
        resolve({ ok: false, status: 0, reason, deadToken: false });
      let stream: ReturnType<ClientHttp2Session["request"]>;
      try {
        stream = this.session(environment).request({
          ":method": "POST",
          ":path": `/3/device/${token}`,
          authorization: `bearer ${this.providerToken()}`,
          "apns-topic": topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        return;
      }
      let status = 0;
      let body = "";
      stream.setTimeout(REQUEST_TIMEOUT_MS, () => {
        stream.close();
        fail("Timed out");
      });
      stream.on("response", (headers) => {
        status = Number(headers[":status"]);
      });
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        body += chunk;
      });
      stream.on("error", (error) => fail(error.message));
      stream.on("end", () => {
        if (status === 200) {
          resolve({ ok: true });
          return;
        }
        let reason = `HTTP ${status}`;
        try {
          reason = (JSON.parse(body) as { reason?: string }).reason ?? reason;
        } catch {}
        resolve({
          ok: false,
          status,
          reason,
          deadToken: DEAD_TOKEN_REASONS.has(reason),
        });
      });
      stream.end(JSON.stringify(payload));
    });
  }
}

/** The configured sender, or null when push is not set up on this server. */
export function apnsSender(): ApnsSend | null {
  const { apnsKeyFile, apnsKeyId, apnsTeamId } = envConfig;
  if (!apnsKeyFile || !apnsKeyId || !apnsTeamId) return null;
  return new ApnsClient({
    keyId: apnsKeyId,
    teamId: apnsTeamId,
    privateKey: readFileSync(apnsKeyFile, "utf8"),
  }).send;
}
