// GEO Auditor content script (statically registered).
// Delegates to the shared self-contained collector so the service worker can
// inject the exact same logic on demand when this script is missing or stale
// (see collectorMain.ts).

import { collectorMain } from "./collectorMain";

collectorMain();
