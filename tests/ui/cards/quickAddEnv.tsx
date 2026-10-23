import { afterAll, beforeAll } from "bun:test";

import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TreeDocument } from "@/core/model/types";
import { useEditorKeys } from "@/ui/app/useEditorKeys";
import { Canvas } from "@/ui/canvas/Canvas";
import { StartCard } from "@/ui/cards/StartCard";
import { type QuickAddOptions, useQuickAdd } from "@/ui/cards/useQuickAdd";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { renderWithStore } from "../../fixtures/panelEnv";
import { reduceMotion } from "../i18n";

const SCREEN = { width: 1600, height: 1000 };
const originalRect = HTMLElement.prototype.getBoundingClientRect;

/** happy-dom has no layout: the canvas gets a fixed size, and motion is off. */
export function withFakeCanvasSize(): void {
  beforeAll(() => {
    reduceMotion(true);
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList.contains("stam-canvas")) {
        return DOMRect.fromRect({ x: 0, y: 0, ...SCREEN });
      }
      return originalRect.call(this);
    };
  });
  afterAll(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    reduceMotion(false);
  });
}

const noop = () => {};

/** What the editor page mounts in its canvas slot: the canvas with quick-add, or the start card. */
function EditorCanvas({ dir, quickAdd }: { dir: "ltr" | "rtl"; quickAdd?: QuickAddOptions }) {
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const layout = useEditor((s) => s.layout);
  const selectedId = useEditor((s) => s.selectedId);
  const collapsed = useEditor((s) => s.collapsed);
  const { renderNodeExtras } = useQuickAdd(quickAdd);
  useEditorKeys({ onOpenSearch: noop, onRequestDelete: noop, dir });
  if (!doc) return null;
  if (!layout) return <StartCard />;
  const s = store.getState();
  return (
    <Canvas
      doc={doc}
      layout={layout}
      selectedId={selectedId}
      focusMode={false}
      dir={dir}
      collapsed={collapsed}
      onSelect={s.select}
      onToggleCollapse={s.toggleCollapse}
      onViewFamily={s.setViewRoot}
      photoUrl={() => undefined}
      renderNodeExtras={renderNodeExtras}
    />
  );
}

export async function renderEditorCanvas(
  doc: TreeDocument,
  opts: { dir?: "ltr" | "rtl"; quickAdd?: QuickAddOptions } = {},
) {
  const env = await renderWithStore(
    <EditorCanvas dir={opts.dir ?? "ltr"} quickAdd={opts.quickAdd} />,
    doc,
  );
  const user = userEvent.setup();
  return { ...env, user };
}

/** The SVG card (role=button) of a person's primary node. */
export function cardOf(personId: string): HTMLElement {
  const el = document.querySelector(`[data-node-id="${personId}"] > .stam-card`);
  if (!el) throw new Error(`no card for ${personId}`);
  return el as HTMLElement;
}

/** Moves the mouse onto a person's card, which shows its handles. */
export function hover(personId: string): void {
  act(() => {
    cardOf(personId).dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
}

export const nameInput = () => screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
