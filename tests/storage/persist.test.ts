import { afterEach, describe, expect, test } from "bun:test";

import { requestPersistentStorage, storagePressure } from "@/storage/persist";

const original = Object.getOwnPropertyDescriptor(globalThis.navigator, "storage");

function stubStorage(storage: unknown) {
  Object.defineProperty(globalThis.navigator, "storage", { value: storage, configurable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis.navigator, "storage", original);
  else Reflect.deleteProperty(globalThis.navigator, "storage");
});

describe("requestPersistentStorage", () => {
  test("returns the browser's answer", async () => {
    stubStorage({ persist: async () => true });
    expect(await requestPersistentStorage()).toBe(true);
    stubStorage({ persist: async () => false });
    expect(await requestPersistentStorage()).toBe(false);
  });

  test("is false when unsupported or throwing", async () => {
    stubStorage(undefined);
    expect(await requestPersistentStorage()).toBe(false);
    stubStorage({
      persist: async () => {
        throw new Error("denied");
      },
    });
    expect(await requestPersistentStorage()).toBe(false);
  });
});

describe("storagePressure", () => {
  test("is usage over quota", async () => {
    stubStorage({ estimate: async () => ({ usage: 25, quota: 100 }) });
    expect(await storagePressure()).toBe(0.25);
  });

  test("is 0 when unknown", async () => {
    stubStorage(undefined);
    expect(await storagePressure()).toBe(0);
    stubStorage({ estimate: async () => ({}) });
    expect(await storagePressure()).toBe(0);
    stubStorage({ estimate: async () => ({ usage: 5, quota: 0 }) });
    expect(await storagePressure()).toBe(0);
    stubStorage({
      estimate: async () => {
        throw new Error("nope");
      },
    });
    expect(await storagePressure()).toBe(0);
  });
});
