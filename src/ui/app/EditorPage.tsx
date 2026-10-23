import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useParams } from "react-router";

import { createAutosaver } from "@/storage/autosave";
import { createJournal } from "@/storage/journal";
import { createTabSync } from "@/storage/multitab";
import { createSaveGuard } from "@/storage/saveGuard";
import { StaleWriteError } from "@/storage/treeRepo";
import { Canvas, type CanvasHandle } from "@/ui/canvas/Canvas";
import { useTreeDir } from "@/ui/canvas/treeDirection";
import { ExportDialog } from "@/ui/export/ExportDialog";
import { visibleWorldRect } from "@/ui/export/gatherInput";
import { usePrintFit } from "@/ui/export/usePrintFit";
import "@/ui/export/export.css";
import { StartCard } from "@/ui/cards/StartCard";
import { UnionChooser } from "@/ui/cards/UnionChooser";
import { useQuickAdd } from "@/ui/cards/useQuickAdd";
import { useDragAndDrop } from "@/ui/dnd/useDragAndDrop";
import { type KinshipFns, realKinship } from "@/ui/kinship/explain";
import { RelationPanel } from "@/ui/kinship/RelationPanel";
import { useRelation } from "@/ui/kinship/useRelation";
import { PersonPanel } from "@/ui/panels/PersonPanel";
import { SearchBox } from "@/ui/panels/SearchBox";
import { useDeleteDialog } from "@/ui/panels/useDeleteDialog";
import { usePhotoUrls } from "@/ui/photos/usePhotoUrls";
import { createEditorStore } from "@/ui/store/editorStore";
import { EditorContext, useEditor, useEditorStore } from "@/ui/store/useEditor";
import { isFocusView, isReadOnlyView, type ViewLayoutFns } from "@/ui/store/viewLayouts";
import { realRenderers, type ViewRenderers } from "@/ui/views/renderers";
import type { ViewHandle } from "@/ui/views/useViewCamera";

import { noteEditDay } from "./backupState";
import { useRepo } from "./RepoContext";
import { StorageBanner } from "./StorageBanner";
import { Toolbar } from "./Toolbar";
import { UnconnectedList } from "./UnconnectedList";
import { useCenterAfterLayout } from "./useCenterAfterLayout";
import { useEditorKeys } from "./useEditorKeys";
import { panelCoverage, useSelectedAboveSheet } from "./useSelectedAboveSheet";
import { useSkippedPhotosNotice } from "./useSkippedPhotosNotice";

/** The editor fills this with `centerOn`: centring that runs once the layout has been drawn. */
export type CenterOnRef = RefObject<((personId: string) => void) | null>;

/**
 * `autosaverOptions` exists for tests, which pass a fake clock. The rest are the page's
 * boundaries, which tests replace: today's date, the layout functions, the two read-only views
 * and the kinship calculator.
 */
export type EditorPageProps = {
  autosaverOptions?: Parameters<typeof createAutosaver>[1];
  centerOnRef?: CenterOnRef;
  today?: () => Date;
  layouts?: ViewLayoutFns;
  renderers?: ViewRenderers;
  kinship?: KinshipFns;
};

export function EditorPage(props: EditorPageProps = {}) {
  const { treeId } = useParams();
  if (!treeId) return <Navigate to="/app" replace />;
  // A new tree id is a new session: new store, new autosaver, new tab sync.
  return <EditorSession key={treeId} treeId={treeId} {...props} />;
}

function EditorSession({
  treeId,
  autosaverOptions,
  centerOnRef,
  today,
  layouts,
  renderers,
  kinship,
}: EditorPageProps & { treeId: string }) {
  const repo = useRepo();
  const [{ store, autosaver, journal }] = useState(() => {
    const wal = createJournal();
    const guard = createSaveGuard(repo);
    const saver = createAutosaver(async (doc) => {
      // The autosaver has just taken `doc`: anything journaled from now on is newer than it.
      const capturedAt = Date.now();
      let savedAt: number;
      try {
        savedAt = await guard.save(doc, { capturedAt });
      } catch (error) {
        // Another tab saved or deleted the tree since we loaded it: this copy is stale.
        if (error instanceof StaleWriteError) {
          editor.getState().lock(error.deleted ? "deleted" : "changed");
        }
        throw error;
      }
      wal.saved(doc, savedAt); // IndexedDB has it now: the journal copy is no longer needed
    }, autosaverOptions);
    const editor = createEditorStore({
      repo,
      autosaver: saver,
      journal: wal,
      guard,
      ...(layouts ? { layouts } : {}),
    });
    return { autosaver: saver, journal: wal, store: editor };
  });

  useEffect(() => {
    void store.getState().load(treeId);
  }, [store, treeId]);

  // FR-S5: tell other tabs about our saves, hear about theirs. Saving also counts as an edit
  // day for the backup reminder.
  useEffect(() => {
    // Any save, rename or delete by another tab makes this copy stale, so the editor goes
    // read-only rather than overwrite it later. Our own messages are filtered by the per-tab id.
    const sync = createTabSync(treeId, (change) =>
      store.getState().lock(change === "deleted" ? "deleted" : "changed"),
    );
    const stop = autosaver.onStatus((status) => {
      if (status !== "saved") return;
      sync.announceSave();
      void noteEditDay(repo).catch(() => {});
    });
    return () => {
      stop();
      sync.close();
    };
  }, [treeId, store, autosaver, repo]);

  // Edits waiting in the debounce must not die with the page or the tab. The journal write is
  // synchronous, so it is the one that is sure to land when the page is going away; the
  // IndexedDB save is started as well and may or may not finish.
  useEffect(() => {
    const flush = () => {
      journal.flush();
      void autosaver.flush().catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [autosaver, journal]);

  return (
    <EditorContext.Provider value={store}>
      <EditorFrame
        autosaver={autosaver}
        centerOnRef={centerOnRef}
        today={today}
        renderers={renderers}
        kinship={kinship}
      />
    </EditorContext.Provider>
  );
}

function EditorFrame({
  autosaver,
  centerOnRef,
  today,
  renderers = realRenderers,
  kinship = realKinship,
}: {
  autosaver: ReturnType<typeof createAutosaver>;
  centerOnRef?: CenterOnRef;
  today?: () => Date;
  renderers?: ViewRenderers;
  kinship?: KinshipFns;
}) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const canvasRef = useRef<CanvasHandle>(null);
  /** The fan chart's or the timeline's handle, while one of them is shown. */
  const viewRef = useRef<ViewHandle>(null);
  /** A person to centre in the fan or timeline once it has drawn its newest layout. */
  const viewCentre = useRef<string | null>(null);
  // Only a re-render signal: asking again for the same person must still run the effect.
  const [viewCentreAsks, setViewCentreAsks] = useState(0);
  const doc = useEditor((s) => s.doc);
  const layout = useEditor((s) => s.layout);
  const viewMode = useEditor((s) => s.viewMode);
  const fanLayout = useEditor((s) => s.fanLayout);
  const timelineLayout = useEditor((s) => s.timelineLayout);
  const relation = useRelation(kinship);
  const focusMode = useEditor((s) => s.focusMode);
  const collapsed = useEditor((s) => s.collapsed);
  const photoUrl = usePhotoUrls(doc);
  /** Centres a person's card in the part of the canvas the panel does not cover. */
  const centerVisible = (id: string) =>
    canvasRef.current?.centerOnPerson(id, { bottomInset: panelCoverage() });
  const centerOn = useCenterAfterLayout(layout, centerVisible);
  // The views fit themselves in a layout effect when their focus changes; this runs after it,
  // once the view has drawn the layout the request was made for.
  useEffect(() => {
    const personId = viewCentre.current;
    if (personId === null) return;
    viewCentre.current = null;
    viewRef.current?.centerOnPerson(personId);
    // `viewCentreAsks` is what re-runs this after an ask.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [viewCentreAsks]);
  useEffect(() => {
    if (!centerOnRef) return;
    centerOnRef.current = centerOn;
    return () => {
      centerOnRef.current = null;
    };
  }, [centerOnRef, centerOn]);
  const status = useEditor((s) => s.status);
  const recovered = useEditor((s) => s.recoveredFromSnapshot);
  const skipped = useSkippedPhotosNotice();
  const selectedId = useEditor((s) => s.selectedId);
  const selectedExists = useEditor((s) => s.selectedId !== null && !!s.doc?.persons[s.selectedId]);
  useSelectedAboveSheet(canvasRef, selectedExists ? selectedId : null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [unconnectedOpen, setUnconnectedOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  usePrintFit(canvasRef);
  const locked = useEditor((s) => s.locked);
  const deleteDialog = useDeleteDialog();
  const { dialog } = deleteDialog;
  // Fan and timeline are read-only like a locked tree: no handles, no dragging, no deleting.
  const readOnly = locked !== null || isReadOnlyView(viewMode);
  /** Read-only: nothing may be deleted (the dialog would only be refused). */
  const requestDelete = (personId: string) => {
    const s = store.getState();
    if (!s.locked && !isReadOnlyView(s.viewMode)) deleteDialog.requestDelete(personId);
  };

  /** Shift+click: the second person for "How are we related?", the first being the selection. */
  function pickForRelation(personId: string) {
    const s = store.getState();
    if (s.relation) s.setRelation({ bId: personId });
    else if (s.selectedId !== null && s.selectedId !== personId) {
      s.openRelation(s.selectedId, personId);
    } else s.openRelation(personId, null);
  }
  function toggleRelation() {
    const s = store.getState();
    if (s.relation) s.closeRelation();
    else s.openRelation(s.selectedId, null);
  }

  /** "↑ View family": a focus view moves its focus; only the family view moves its root. */
  function viewFamily(personId: string) {
    const s = store.getState();
    if (isFocusView(s.viewMode)) s.setFocus(personId);
    else s.setViewRoot(personId);
  }

  // A drop that makes someone a child of a person with several unions asks which one (FR-D3).
  const dnd = useDragAndDrop({ canvasRef, renderUnionChoice });
  // Quick add: "+" handles and the inline editor on the canvas; a new card off screen is
  // brought into view, and so is a card the arrow keys move to.
  const { renderNodeExtras } = useQuickAdd({
    reveal: centerVisible,
    coveredBottom: panelCoverage,
    isOnScreen: (id) =>
      canvasRef.current?.isPersonInView(id, { bottomInset: panelCoverage() }) ?? true,
  });
  const dir = useTreeDir();

  /**
   * Search result: expand or re-root the view so the person has a card (see `revealPerson`),
   * select them, and centre on them.
   */
  function showPerson(personId: string) {
    const current = store.getState();
    if (!current.doc?.persons[personId]) return;
    if (isReadOnlyView(current.viewMode)) {
      showInView(personId);
      setSearchOpen(false);
      return;
    }
    if (current.revealPerson(personId)) {
      current.select(personId);
      centerOn(personId);
    } else {
      centerOn(null); // nothing to centre: drop any request still waiting
    }
    setSearchOpen(false);
  }

  /**
   * Search or a birthday in the fan or timeline: select the person and centre them. Someone the
   * fan doesn't draw becomes its focus; someone off the timeline is revealed in the family view
   * the timeline is drawn from.
   */
  function showInView(personId: string) {
    const s = store.getState();
    if (s.viewMode === "fan") {
      const fan = s.fanLayout;
      const inFan =
        fan !== null &&
        (fan.focusId === personId || fan.segments.some((seg) => seg.personId === personId));
      if (!inFan) s.setFocus(personId);
    } else if (!s.timelineLayout?.bars.some((bar) => bar.personId === personId)) {
      s.revealPerson(personId);
    }
    store.getState().select(personId);
    viewCentre.current = personId;
    setViewCentreAsks((n) => n + 1);
  }

  const zoomIn = () =>
    isReadOnlyView(viewMode) ? viewRef.current?.zoomIn() : canvasRef.current?.zoomIn();
  const zoomOut = () =>
    isReadOnlyView(viewMode) ? viewRef.current?.zoomOut() : canvasRef.current?.zoomOut();
  const fit = () => (isReadOnlyView(viewMode) ? viewRef.current?.fit() : canvasRef.current?.fit());

  useEditorKeys({
    onOpenSearch: () => setSearchOpen(true),
    onOpenExport: () => setExportOpen(true),
    onRequestDelete: requestDelete,
    onReveal: centerVisible,
    dir,
  });

  if (status === "failed") {
    return (
      <main className="page">
        <h1 className="page-title">{t("editor.failedTitle")}</h1>
        <p>
          <Link to="/app">{t("editor.failedLink")}</Link>
        </p>
      </main>
    );
  }
  if (status !== "ready") {
    return (
      <main className="page" aria-busy="true">
        <p className="muted">{t("app.loading")}</p>
      </main>
    );
  }

  return (
    <div className="editor">
      <Toolbar
        autosaver={autosaver}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={fit}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenUnconnected={() => setUnconnectedOpen((open) => !open)}
        onOpenExport={() => setExportOpen(true)}
        onToggleRelation={toggleRelation}
        onShowPerson={showPerson}
        today={today}
      />
      <StorageBanner />
      {recovered && (
        <div className="banner banner-warn">
          <output>{t("banner.recovered")}</output>
        </div>
      )}
      {skipped.count > 0 && (
        <div className="banner">
          <output>{t("app.import.photosSkipped", { count: skipped.count })}</output>
          <button type="button" className="button" onClick={skipped.dismiss}>
            {t("common.dismiss")}
          </button>
        </div>
      )}
      {locked === "changed" && (
        <div className="banner banner-warn">
          <output>{t("banner.otherTab")}</output>
          <button type="button" className="button" onClick={() => window.location.reload()}>
            {t("banner.reload")}
          </button>
        </div>
      )}
      {locked === "deleted" && (
        <div className="banner banner-warn">
          <output>{t("banner.deletedElsewhere")}</output>
          <Link to="/app" className="button">
            {t("banner.backToTrees")}
          </Link>
        </div>
      )}
      <main className="editor-body" id="main">
        <div data-slot="canvas" className="canvas-slot">
          {/* A tree with no people yet: one "Start with a person" card. */}
          {doc && !layout && <StartCard />}
          {doc && layout && viewMode === "fan" && fanLayout && (
            <renderers.FanChart
              ref={viewRef}
              doc={doc}
              layout={fanLayout}
              selectedId={selectedExists ? selectedId : null}
              onSelect={store.getState().select}
              onFocus={store.getState().setFocus}
              dir={dir}
            />
          )}
          {doc && layout && viewMode === "timeline" && timelineLayout && (
            <renderers.Timeline
              ref={viewRef}
              doc={doc}
              layout={timelineLayout}
              selectedId={selectedExists ? selectedId : null}
              onSelect={store.getState().select}
              onFocus={store.getState().setFocus}
              dir={dir}
            />
          )}
          {doc && layout && !isReadOnlyView(viewMode) && (
            <Canvas
              key={viewMode}
              ref={canvasRef}
              doc={doc}
              layout={layout}
              selectedId={selectedExists ? selectedId : null}
              focusMode={focusMode}
              dir={dir}
              collapsed={collapsed}
              onSelect={store.getState().select}
              onToggleCollapse={store.getState().toggleCollapse}
              onViewFamily={viewFamily}
              photoUrl={photoUrl}
              highlightPath={relation.explanation?.path}
              onShiftSelect={pickForRelation}
              {...(readOnly ? {} : dnd.canvasProps)}
              renderNodeExtras={readOnly ? undefined : renderNodeExtras}
            />
          )}
        </div>
        {relation.pair !== null ? (
          <RelationPanel relation={relation} />
        ) : (
          selectedId !== null &&
          selectedExists && (
            <PersonPanel
              personId={selectedId}
              onRequestDelete={requestDelete}
              onShowPerson={showPerson}
              readOnly={readOnly}
            />
          )
        )}
      </main>
      {searchOpen && <SearchBox onPick={showPerson} onClose={() => setSearchOpen(false)} />}
      {unconnectedOpen && <UnconnectedList onClose={() => setUnconnectedOpen(false)} />}
      {exportOpen && (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          getVisibleRect={() => {
            const slot = document.querySelector('[data-slot="canvas"]');
            const box = slot?.getBoundingClientRect();
            return visibleWorldRect(
              canvasRef.current,
              box ? { width: box.width, height: box.height } : null,
            );
          }}
        />
      )}
      {dialog}
      {dnd.layer}
    </div>
  );
}

function renderUnionChoice(
  personId: string,
  unionIds: string[],
  onChoose: (unionId: string) => void,
  onCancel: () => void,
) {
  return (
    <UnionChooser personId={personId} unionIds={unionIds} onChoose={onChoose} onCancel={onCancel} />
  );
}
