// Dev-only page at /dev/views: the fan chart and the timeline on a generated pedigree, for
// checking them by hand. Query: ?view=fan|timeline&g=2..7. Not part of the production build.
// Strings here are dev tooling, not product UI, so they are not translated.
import "@fontsource-variable/archivo/wdth.css";

import i18next from "i18next";
import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import { layoutFan } from "@/core/layout/fan";
import { layoutTimeline } from "@/core/layout/timeline";
import { displayName } from "@/core/model/tree";
import en from "@/i18n/locales/en.json";
import { FanChart } from "@/ui/views/FanChart";
import { Timeline } from "@/ui/views/Timeline";
import type { ViewHandle } from "@/ui/views/useViewCamera";

import { pedigreeFamily } from "./viewsDemoData";

const i18n = i18next.createInstance();
void i18n.init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  initAsync: false,
});

const query = new URLSearchParams(location.search);
const initialView = query.get("view") === "timeline" ? "timeline" : "fan";
const initialGenerations = Math.min(7, Math.max(2, Number(query.get("g") ?? 5) || 5));

function ViewsDemo() {
  const doc = useMemo(() => pedigreeFamily(7), []);
  const startFocus = useMemo(() => Object.keys(doc.persons)[0]!, [doc]);
  const view = useRef<ViewHandle>(null);
  const [mode, setMode] = useState<"fan" | "timeline">(initialView);
  const [generations, setGenerations] = useState(initialGenerations);
  const [focusId, setFocusId] = useState(startFocus);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dir, setDir] = useState<"ltr" | "rtl">(query.get("dir") === "rtl" ? "rtl" : "ltr");

  const fan = useMemo(() => layoutFan(doc, { focusId, generations }), [doc, focusId, generations]);
  const timeline = useMemo(() => layoutTimeline(doc, { rootId: doc.rootPersonId! }), [doc]);
  const selected = selectedId ? doc.persons[selectedId] : undefined;
  const focus = doc.persons[focusId];

  const shared = { doc, selectedId, dir, onSelect: setSelectedId, onFocus: setFocusId };

  return (
    <div className="demo">
      <div className="demo__bar">
        <span className="demo__title">Views demo</span>
        <button type="button" aria-pressed={mode === "fan"} onClick={() => setMode("fan")}>
          Fan
        </button>
        <button
          type="button"
          aria-pressed={mode === "timeline"}
          onClick={() => setMode("timeline")}
        >
          Timeline
        </button>
        {mode === "fan" && (
          <label>
            Generations{" "}
            <select
              value={generations}
              onChange={(e) => setGenerations(Number(e.currentTarget.value))}
            >
              {[2, 3, 4, 5, 6, 7].map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={() => view.current?.zoomOut()}>
          −
        </button>
        <button type="button" onClick={() => view.current?.zoomIn()}>
          +
        </button>
        <button type="button" onClick={() => view.current?.fit()}>
          Fit
        </button>
        <button
          type="button"
          aria-pressed={dir === "rtl"}
          onClick={() => setDir(dir === "ltr" ? "rtl" : "ltr")}
        >
          RTL
        </button>
        {focusId !== startFocus && (
          <button type="button" onClick={() => setFocusId(startFocus)}>
            ← Back to Noor
          </button>
        )}
        <span className="demo__note">
          {mode === "fan" && focus && (
            <>
              Focus: <bdi>{displayName(focus)}</bdi> ·{" "}
            </>
          )}
          {selected ? <bdi>{displayName(selected) || "Unknown"}</bdi> : "Click to select"} ·
          double-click or Enter refocuses
        </span>
      </div>
      <div className="demo__stage">
        {mode === "fan" ? (
          <FanChart ref={view} layout={fan} {...shared} />
        ) : (
          <Timeline ref={view} layout={timeline} {...shared} />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <ViewsDemo />
    </I18nextProvider>
  </StrictMode>,
);
