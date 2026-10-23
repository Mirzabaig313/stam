// Dev-only page at /dev/canvas: the canvas on bigFamily(N) for checking pan/zoom smoothness,
// culling, level of detail and re-layout tweens by hand. Not part of the production build.
// Strings here are dev tooling, not product UI, so they are not translated.
import "@fontsource-variable/archivo/wdth.css";

import i18next from "i18next";
import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import { layoutFamily } from "@/core/layout/family";
import { displayName } from "@/core/model/tree";
import en from "@/i18n/locales/en.json";
import { Canvas, type CanvasHandle } from "@/ui/canvas/Canvas";

import { bigFamily } from "./bigFamily";

const i18n = i18next.createInstance();
void i18n.init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  initAsync: false,
});

function peopleFromQuery(): number {
  const n = Number(new URLSearchParams(location.search).get("n") ?? 200);
  return Number.isFinite(n) ? Math.min(5000, Math.max(1, Math.round(n))) : 200;
}

function CanvasDemo() {
  const people = useMemo(() => peopleFromQuery(), []);
  const doc = useMemo(() => bigFamily(people), [people]);
  const canvas = useRef<CanvasHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focusMode, setFocusMode] = useState(false);
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");
  const [viewRootId, setViewRootId] = useState<string | null>(null);

  const rootId = viewRootId ?? doc.rootPersonId ?? "";
  const layout = useMemo(() => layoutFamily(doc, { rootId, collapsed }), [doc, rootId, collapsed]);
  const selected = selectedId ? doc.persons[selectedId] : undefined;

  return (
    <div className="demo">
      <div className="demo__bar">
        <span className="demo__title">Canvas demo · {people} people</span>
        <button type="button" onClick={() => canvas.current?.zoomOut()}>
          −
        </button>
        <button type="button" onClick={() => canvas.current?.zoomIn()}>
          +
        </button>
        <button type="button" onClick={() => canvas.current?.fit()}>
          Fit
        </button>
        <button type="button" aria-pressed={focusMode} onClick={() => setFocusMode(!focusMode)}>
          Focus
        </button>
        <button
          type="button"
          aria-pressed={dir === "rtl"}
          onClick={() => setDir(dir === "ltr" ? "rtl" : "ltr")}
        >
          RTL
        </button>
        {viewRootId && (
          <button type="button" onClick={() => setViewRootId(null)}>
            ← Back to root
          </button>
        )}
        <span className="demo__note">
          {selected ? <bdi>{displayName(selected)}</bdi> : "Click a card to select it"}
        </span>
      </div>
      <div className="demo__stage">
        <Canvas
          ref={canvas}
          doc={doc}
          layout={layout}
          selectedId={selectedId}
          focusMode={focusMode}
          dir={dir}
          collapsed={collapsed}
          onSelect={setSelectedId}
          onToggleCollapse={(id) =>
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (!next.delete(id)) next.add(id);
              return next;
            })
          }
          onViewFamily={setViewRootId}
          photoUrl={() => undefined}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <CanvasDemo />
    </I18nextProvider>
  </StrictMode>,
);
