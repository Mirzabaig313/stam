import { afterEach, describe, expect, test } from "bun:test";

import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";

import { createApi, type Me } from "@/cloud/api";
import { createAuthStore } from "@/cloud/auth";
import { createSessionStore } from "@/cloud/session";
import { startSettingsSync } from "@/cloud/settingsSync";
import type { TreeRepo } from "@/storage/treeRepo";
import { RepoContext } from "@/ui/app/RepoContext";
import {
  currentSettings,
  DEFAULT_SETTINGS,
  setCurrentSettings,
  SETTINGS_KEY,
  settingsSavedAt,
  useSettings,
} from "@/ui/settings/settings";

import { fakeFetch } from "./fakeFetch";

afterEach(() => {
  cleanup();
  setCurrentSettings(DEFAULT_SETTINGS);
});

function fakeRepo(stored?: unknown) {
  const data = new Map<string, unknown>(stored === undefined ? [] : [[SETTINGS_KEY, stored]]);
  return {
    data,
    getSetting: async <T>(k: string) => data.get(k) as T | undefined,
    setSetting: async (k: string, v: unknown) => void data.set(k, v),
  };
}

const ME: Me = { user: { id: "u1", name: "Ana", email: "a@x" }, trees: [] };

function setup(repo: ReturnType<typeof fakeRepo>) {
  const { fetch, calls } = fakeFetch({
    "PUT /api/me/settings": () => new Response(null, { status: 204 }),
  });
  const api = createApi(fetch);
  const auth = createAuthStore({
    api,
    session: createSessionStore({ getItem: () => null, setItem() {}, removeItem() {} }),
  });
  const stop = startSettingsSync({ repo, auth, api });
  const puts = () => calls.filter((c) => c.method === "PUT");
  return { auth, puts, stop };
}

/** Changes a setting the way the Settings dialog does. */
function choose(
  repo: ReturnType<typeof fakeRepo>,
  patch: Parameters<ReturnType<typeof useSettings>[1]>[0],
) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(RepoContext.Provider, { value: repo as unknown as TreeRepo }, children);
  const { result } = renderHook(() => useSettings(), { wrapper });
  act(() => result.current[1](patch));
}

describe("settings in the account", () => {
  test("signed out, nothing is sent, also when a setting changes", async () => {
    const repo = fakeRepo();
    const { auth, puts } = setup(repo);
    auth.setState({ status: "signedOut", me: null });
    choose(repo, { theme: "dark" });
    await Bun.sleep(10);
    expect(puts()).toEqual([]);
  });

  test("the account's newer settings are applied on this device", async () => {
    const repo = fakeRepo({ ...DEFAULT_SETTINGS, savedAt: 100 });
    const { auth, puts } = setup(repo);
    auth.setState({
      status: "signedIn",
      me: { ...ME, settings: { settings: { theme: "dark", language: "ur" }, savedAt: 500 } },
    });
    await Bun.sleep(10);
    expect(currentSettings()).toMatchObject({ theme: "dark", language: "ur" });
    expect(await settingsSavedAt(repo)).toBe(500);
    expect(puts()).toEqual([]);
  });

  test("this device's newer settings go up to the account", async () => {
    const repo = fakeRepo({ ...DEFAULT_SETTINGS, colorMode: "branch", savedAt: 900 });
    setCurrentSettings({ ...DEFAULT_SETTINGS, colorMode: "branch" });
    const { auth, puts } = setup(repo);
    auth.setState({
      status: "signedIn",
      me: { ...ME, settings: { settings: { colorMode: "gender" }, savedAt: 100 } },
    });
    await Bun.sleep(10);
    expect(puts()).toHaveLength(1);
    expect(puts()[0]!.body).toMatchObject({ settings: { colorMode: "branch" }, savedAt: 900 });
  });

  test("an account with no settings yet and a device that never chose any: nothing happens", async () => {
    const repo = fakeRepo();
    const { auth, puts } = setup(repo);
    auth.setState({ status: "signedIn", me: { ...ME, settings: null } });
    await Bun.sleep(10);
    expect(puts()).toEqual([]);
    expect(currentSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("signed in, each change goes up; the same sign-in is reconciled once", async () => {
    const repo = fakeRepo();
    const { auth, puts } = setup(repo);
    auth.setState({ status: "signedIn", me: { ...ME, settings: null } });
    await Bun.sleep(10);
    choose(repo, { treeDirection: "rtl" });
    await Bun.sleep(10);
    expect(puts()).toHaveLength(1);
    expect(puts()[0]!.body).toMatchObject({ settings: { treeDirection: "rtl" } });
    // A later refresh of the same account does not reconcile (and re-send) again.
    auth.setState({ status: "signedIn", me: { ...ME, settings: null } });
    await Bun.sleep(10);
    expect(puts()).toHaveLength(1);
  });
});
