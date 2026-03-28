const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type SessionPayload = {
  email: string;
  exp: number;
};

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readSessionSigningSecret() {
  const configuredSecret = process.env.SESSION_SIGNING_SECRET?.trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV !== "production") {
    const adminEmail = process.env.ADMIN_EMAIL?.trim();
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (adminEmail && adminPassword) {
      return `${adminEmail}:${adminPassword}`;
    }

    return "dev-session-signing-secret";
  }

  throw new Error("SESSION_SIGNING_SECRET is required in production.");
}

async function getSigningKey() {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(readSessionSigningSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(email: string) {
  const payload = encodeBase64Url(
    encoder.encode(
      JSON.stringify({
        email,
        exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
      } satisfies SessionPayload),
    ),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await getSigningKey(),
    encoder.encode(payload),
  );

  return `${payload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string) {
  const [payload, signature, ...rest] = token.split(".");

  if (!payload || !signature || rest.length > 0) {
    return null;
  }

  try {
    const isValid = await crypto.subtle.verify(
      "HMAC",
      await getSigningKey(),
      decodeBase64Url(signature),
      encoder.encode(payload),
    );

    if (!isValid) {
      return null;
    }

    const data = JSON.parse(decoder.decode(decodeBase64Url(payload))) as SessionPayload;

    if (typeof data.email !== "string" || typeof data.exp !== "number") {
      return null;
    }

    if (Date.now() > data.exp) {
      return null;
    }

    return data.email;
  } catch {
    return null;
  }
}

export { SESSION_MAX_AGE_SECONDS };