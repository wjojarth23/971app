import crypto from "crypto";

export function createKeyDigest(token: string) {
  const secret = process.env.API_KEY_DIGEST_SECRET;
  if (!secret) throw new Error("API_KEY_DIGEST_SECRET is not configured");
  return crypto.createHmac("sha256", secret).update(token).digest("hex");
}
