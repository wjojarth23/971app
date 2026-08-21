import crypto from "crypto";
import { afterEach, describe, expect, test } from "vitest";
import { createKeyDigest } from "./keyDigest";

describe("createKeyDigest", () => {
  const originalSecret = process.env.API_KEY_DIGEST_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.API_KEY_DIGEST_SECRET;
    } else {
      process.env.API_KEY_DIGEST_SECRET = originalSecret;
    }
  });

  test("uses API_KEY_DIGEST_SECRET when hashing bearer tokens", () => {
    process.env.API_KEY_DIGEST_SECRET = "test-digest-secret";

    expect(createKeyDigest("test-token")).toBe(
      crypto.createHmac("sha256", "test-digest-secret").update("test-token").digest("hex")
    );
  });

  test("throws when API_KEY_DIGEST_SECRET is missing", () => {
    delete process.env.API_KEY_DIGEST_SECRET;

    expect(() => createKeyDigest("test-token")).toThrow("API_KEY_DIGEST_SECRET is not configured");
  });
});
