import crypto from "node:crypto";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const endpoint = process.env.PRICE_HISTORY_URL;
const writeKey = process.env.PRICE_HISTORY_WRITE_KEY;

if (!endpoint) {
  throw new Error("PRICE_HISTORY_URL is missing.");
}

if (!writeKey) {
  throw new Error("PRICE_HISTORY_WRITE_KEY secret is missing.");
}

function appendQuery(url, params) {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

function solveInfinityFreeCookie(html) {
  const a = html.match(/\ba=toNumbers\("([0-9a-fA-F]+)"\)/)?.[1];
  const b = html.match(/\bb=toNumbers\("([0-9a-fA-F]+)"\)/)?.[1];
  const c = html.match(/\bc=toNumbers\("([0-9a-fA-F]+)"\)/)?.[1];

  if (!a || !b || !c) {
    return null;
  }

  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    Buffer.from(a, "hex"),
    Buffer.from(b, "hex")
  );
  decipher.setAutoPadding(false);

  const plain = Buffer.concat([
    decipher.update(Buffer.from(c, "hex")),
    decipher.final(),
  ]);

  return `__test=${plain.toString("hex")}`;
}

async function requestJson(url, cookie = null) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "application/json",
      "User-Agent": "EnsarPriceHistoryCron/1.0",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return JSON.parse(body);
  }

  const challengeCookie = solveInfinityFreeCookie(body);
  if (challengeCookie) {
    const retryUrl = appendQuery(url, { challenge_retry: Date.now().toString() });
    const retryResponse = await fetch(retryUrl, {
      redirect: "follow",
      headers: {
        Accept: "application/json",
        "User-Agent": "EnsarPriceHistoryCron/1.0",
        Cookie: challengeCookie,
      },
    });
    const retryBody = await retryResponse.text();
    return JSON.parse(retryBody);
  }

  throw new Error(`Unexpected response from capture endpoint: ${body.slice(0, 200)}`);
}

const captureUrl = appendQuery(endpoint, { key: writeKey });
const payload = await requestJson(captureUrl);

if (!payload?.success) {
  throw new Error(payload?.message ?? "Price capture failed.");
}

console.log(
  JSON.stringify(
    {
      sample_time: payload.sample_time,
      row_count: payload.row_count,
      saved_count: payload.saved_count,
      payload_timestamp: payload.payload_timestamp,
      used_fallback: payload.used_fallback,
    },
    null,
    2
  )
);
