import { GlobalRegistrator } from "@happy-dom/global-registrator";
import "fake-indexeddb/auto";

GlobalRegistrator.register();

// Templates other than Warm album load their card faces on demand; tests draw all six.
const { loadAllFaces } = await import("@/templates");
await loadAllFaces();
