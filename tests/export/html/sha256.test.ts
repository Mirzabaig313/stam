import { describe, expect, test } from "bun:test";

import { sha256Base64 } from "@/export/html/sha256";

function reference(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("base64");
}

describe("sha256Base64", () => {
  test("matches the known digest of the empty string and 'abc'", () => {
    expect(sha256Base64("")).toBe("47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=");
    expect(sha256Base64("abc")).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  });

  test("agrees with Bun's hasher across block boundaries and non-ASCII text", () => {
    for (const text of [
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(64),
      "x".repeat(1000),
      "Hadžić هانا 🌳",
    ]) {
      expect(sha256Base64(text)).toBe(reference(text));
    }
  });
});
