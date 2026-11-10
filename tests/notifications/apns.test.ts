import { expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";
import { createProviderToken } from "../../src/notifications/apns";

test("provider tokens carry a raw ES256 signature naming the key and team", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const token = createProviderToken(
    privateKey,
    "KEY1234567",
    "TEAM123456",
    1_700_000_000_500,
  );
  const [header = "", claims = "", signature = ""] = token.split(".");
  const decode = (part: string) =>
    JSON.parse(Buffer.from(part, "base64url").toString());

  expect(decode(header)).toEqual({ alg: "ES256", kid: "KEY1234567" });
  expect(decode(claims)).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
  // APNs takes JOSE's 64-byte r||s form, not DER.
  expect(Buffer.from(signature, "base64url")).toHaveLength(64);
  expect(
    verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    ),
  ).toBe(true);
});
