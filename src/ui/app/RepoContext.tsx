import { createContext, useContext } from "react";

import type { TreeRepo } from "@/storage/treeRepo";

/** The one `TreeRepo` for the app, provided by `main.tsx`. */
export const RepoContext = createContext<TreeRepo | null>(null);

export function useRepo(): TreeRepo {
  const repo = useContext(RepoContext);
  if (!repo) throw new Error("useRepo must be used inside a RepoContext provider");
  return repo;
}
