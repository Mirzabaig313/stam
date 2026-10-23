import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";

import "@/i18n";
import type { TreeRepo } from "@/storage/treeRepo";
import { RepoContext } from "@/ui/app/RepoContext";

/** Renders `ui` (the test file still needs `afterEach(cleanup)`) inside a memory router with the repo provided, like `main.tsx` does. */
export function renderApp(
  ui: ReactElement,
  opts: { repo: TreeRepo; route?: string; state?: unknown },
) {
  return render(
    <RepoContext.Provider value={opts.repo}>
      <MemoryRouter initialEntries={[{ pathname: opts.route ?? "/app", state: opts.state }]}>
        {ui}
      </MemoryRouter>
    </RepoContext.Provider>,
  );
}
