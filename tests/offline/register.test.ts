import { describe, expect, mock, test } from "bun:test";

import { registerShellWorker } from "@/offline/register";

/** A stand-in for a ServiceWorker: a state, statechange listeners, and posted messages. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState = "installing";
  messages: unknown[] = [];
  postMessage(message: unknown) {
    this.messages.push(message);
  }
  become(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  /** A new version starts installing. */
  found(worker: FakeWorker) {
    this.installing = worker;
    this.dispatchEvent(new Event("updatefound"));
  }
}

class FakeContainer extends EventTarget {
  controller: object | null;
  registration = new FakeRegistration();
  register = mock(async (_url: string, _opts?: RegistrationOptions) => this.registration);
  constructor(controlled: boolean) {
    super();
    this.controller = controlled ? {} : null;
  }
}

function setup(controlled = true) {
  const container = new FakeContainer(controlled);
  const onUpdate = mock((_apply: () => void) => {});
  const reload = mock(() => {});
  const ready = registerShellWorker({
    container: container as unknown as ServiceWorkerContainer,
    onUpdate,
    reload,
  });
  return { container, onUpdate, reload, ready };
}

describe("registerShellWorker", () => {
  test("registers /sw.js for /app only", async () => {
    const { container, ready } = setup();
    await ready;
    expect(container.register).toHaveBeenCalledWith("/sw.js", { scope: "/app" });
  });

  test("the first install is not an update: no toast", async () => {
    const { container, onUpdate, ready } = setup(false);
    await ready;
    const worker = new FakeWorker();
    container.registration.found(worker);
    worker.become("installed");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("a new version installed under a controlled page offers an update", async () => {
    const { container, onUpdate, ready } = setup();
    await ready;
    const worker = new FakeWorker();
    container.registration.found(worker);
    expect(onUpdate).not.toHaveBeenCalled();
    worker.become("installed");
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  test("a version already waiting when the page opens is offered too", async () => {
    const container = new FakeContainer(true);
    container.registration.waiting = new FakeWorker();
    const onUpdate = mock((_apply: () => void) => {});
    await registerShellWorker({
      container: container as unknown as ServiceWorkerContainer,
      onUpdate,
      reload: () => {},
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  test("applying the update activates the new version, then reloads once it controls", async () => {
    const { container, onUpdate, reload, ready } = setup();
    await ready;
    const worker = new FakeWorker();
    container.registration.found(worker);
    worker.become("installed");
    const apply = onUpdate.mock.calls[0]![0];
    apply();
    expect(worker.messages).toEqual([{ type: "SKIP_WAITING" }]);
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("a controller change nobody asked for (the first claim) does not reload", async () => {
    const { container, onUpdate, reload, ready } = setup(false);
    await ready;
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  test("another tab applied an update: this tab offers a reload, and never reloads by itself", async () => {
    // This page ran under the old version; the new one, activated from another tab, claims it.
    // Its old files are gone from the cache, so it must reload, but only when the user says so
    // (mid-edit, the autosave journal keeps the work either way).
    const { container, onUpdate, reload, ready } = setup(true);
    await ready;
    container.controller = {};
    container.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const apply = onUpdate.mock.calls[0]![0];
    apply();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("a page claimed for the first time is offered a reload after a later takeover", async () => {
    const { container, onUpdate, ready } = setup(false);
    await ready;
    container.controller = {};
    container.dispatchEvent(new Event("controllerchange")); // first claim: nothing
    container.controller = {};
    container.dispatchEvent(new Event("controllerchange")); // a new version from another tab
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  test("a failed registration is swallowed: the app works without it", async () => {
    const container = new FakeContainer(true);
    container.register.mockImplementation(async () => {
      throw new Error("insecure context");
    });
    await expect(
      registerShellWorker({
        container: container as unknown as ServiceWorkerContainer,
        onUpdate: () => {},
        reload: () => {},
      }),
    ).resolves.toBeUndefined();
  });
});
