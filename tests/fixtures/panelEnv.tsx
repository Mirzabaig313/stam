import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import "@/i18n";
import type { Command } from "@/core/commands/types";
import type { TreeDocument } from "@/core/model/types";
import { RepoContext } from "@/ui/app/RepoContext";
import { createEditorStore } from "@/ui/store/editorStore";
import { EditorContext } from "@/ui/store/useEditor";

import { makeEditorEnv } from "./editorEnv";
import { famSimple } from "./families";

/**
 * Renders `ui` against a real store that has `doc` loaded (the test file still needs
 * `afterEach(cleanup)`). `commands` lists every command the UI dispatched, in order.
 */
export async function renderWithStore(ui: ReactElement, doc: TreeDocument = famSimple()) {
  const env = await makeEditorEnv();
  await env.repo.saveTree({ ...doc, id: "t1" });
  const store = createEditorStore({ repo: env.repo, autosaver: env.autosaver, now: env.now });
  await store.getState().load("t1");

  const commands: Command[] = [];
  const dispatch = store.getState().dispatch;
  store.setState({
    dispatch(cmd, label) {
      commands.push(cmd);
      return dispatch(cmd, label);
    },
  });

  const view = render(
    <RepoContext.Provider value={env.repo}>
      <EditorContext.Provider value={store}>{ui}</EditorContext.Provider>
    </RepoContext.Provider>,
  );
  return { ...view, env, store, commands };
}
