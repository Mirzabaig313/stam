import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { TreeMeta } from "@/storage/treeRepo";
import { IconButton, Menu, MenuItem, MenuSeparator } from "@/ui/design";

import { relativeTime } from "./relativeTime";
import { useRepo } from "./RepoContext";
import { cachedPreview, type PreviewDrawing, previewOf, type TreePreview } from "./treePreview";

export type TreeAction = "rename" | "duplicate" | "backup" | "delete";

/** Reads the tree once per edit and returns its thumbnail; undefined while it loads. */
function useTreePreview(tree: TreeMeta): TreePreview | undefined {
  const repo = useRepo();
  const [loaded, setLoaded] = useState<{ key: string; preview: TreePreview } | null>(null);
  const key = `${tree.id}@${tree.updatedAt}`;
  const cached = cachedPreview(tree.id, tree.updatedAt);

  useEffect(() => {
    if (cached) return;
    let current = true;
    void repo
      .getTree(tree.id)
      .then((found) => {
        if (current && found) setLoaded({ key, preview: previewOf(found.doc) });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [repo, tree.id, key, cached]);

  return cached ?? (loaded?.key === key ? loaded.preview : undefined);
}

/**
 * One tree in the list: a thumbnail of its first generations, its name (a link that covers the
 * whole card), what is in it, and a "⋯" menu with the rest.
 */
export function TreeCard({
  tree,
  onAction,
}: {
  tree: TreeMeta;
  onAction: (action: TreeAction, tree: TreeMeta) => void;
}) {
  const { t, i18n } = useTranslation();
  const preview = useTreePreview(tree);
  const [menuAt, setMenuAt] = useState<[number, number] | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  /** When the menu last closed: a press on "⋯" closes it first, and must not reopen it. */
  const closedAt = useRef(0);

  function closeMenu() {
    closedAt.current = performance.now();
    setMenuAt(null);
  }

  function openMenu() {
    const box = moreRef.current!.getBoundingClientRect();
    const rtl = getComputedStyle(moreRef.current!).direction === "rtl";
    // Anchored under the button's inline end, opening back toward the start.
    setMenuAt([rtl ? box.left : box.right, box.bottom + 6]);
  }

  function choose(action: TreeAction) {
    setMenuAt(null);
    onAction(action, tree);
  }

  return (
    <li className="tree-card">
      <div className="tree-card__preview">
        {preview === undefined ? null : preview.drawing ? (
          <TreeThumbnail drawing={preview.drawing} />
        ) : (
          <EmptyThumbnail />
        )}
      </div>
      <div className="tree-card__body">
        <h2 className="display tree-card__name">
          <Link to={`/app/t/${tree.id}`} className="tree-card__link">
            <bdi>{tree.name}</bdi>
          </Link>
        </h2>
        <p className="tree-card__stats">
          <span>{t("treeList.people", { count: tree.peopleCount })}</span>
          {preview !== undefined && preview.generations > 0 && (
            <span>{t("treeList.generations", { count: preview.generations })}</span>
          )}
          <span>{t("treeList.edited", { when: relativeTime(tree.updatedAt, i18n.language) })}</span>
        </p>
      </div>
      <IconButton
        ref={moreRef}
        icon="more"
        label={t("treeList.actionsFor", { name: tree.name })}
        className="tree-card__more"
        aria-haspopup="menu"
        aria-expanded={menuAt !== null}
        onClick={() => {
          if (menuAt) closeMenu();
          else if (performance.now() - closedAt.current > 250) openMenu();
        }}
      />
      {menuAt && (
        <Menu at={menuAt} opens="start" label={tree.name} onClose={closeMenu}>
          <MenuItem icon="pencil" onClick={() => choose("rename")}>
            {t("treeList.rename")}
          </MenuItem>
          <MenuItem icon="copy" onClick={() => choose("duplicate")}>
            {t("treeList.duplicate")}
          </MenuItem>
          <MenuItem icon="download" onClick={() => choose("backup")}>
            {t("treeList.downloadBackup")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon="trash" danger onClick={() => choose("delete")}>
            {t("common.delete")}
          </MenuItem>
        </Menu>
      )}
    </li>
  );
}

/** Corner radius of a thumbnail card, in layout px. */
const RX = 16;

/** The first generations as small cards: a face, a name bar, tinted by generation. */
function TreeThumbnail({ drawing }: { drawing: PreviewDrawing }) {
  const { viewBox, cards, lines, cropped } = drawing;
  return (
    <svg
      className={cropped ? "tree-preview tree-preview--cropped" : "tree-preview"}
      viewBox={viewBox.join(" ")}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <g className="tree-preview__lines">
        {lines.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      {cards.map((c, i) => (
        <g
          key={i}
          className={`tree-preview__card tree-preview__card--g${c.generation}${c.living ? "" : " tree-preview__card--deceased"}`}
        >
          <rect x={c.x} y={c.y} width={c.width} height={c.height} rx={RX} />
          <circle
            className={`tree-preview__face tree-preview__face--${c.gender}`}
            cx={c.x + 36}
            cy={c.y + c.height / 2}
            r={20}
          />
          <rect
            className="tree-preview__bar"
            x={c.x + 68}
            y={c.y + 22}
            width={88}
            height={11}
            rx={5.5}
          />
          <rect
            className="tree-preview__bar tree-preview__bar--short"
            x={c.x + 68}
            y={c.y + 41}
            width={54}
            height={9}
            rx={4.5}
          />
        </g>
      ))}
    </svg>
  );
}

/** A tree with nobody in it yet: two dashed parents above an empty card waiting for a "+". */
function EmptyThumbnail() {
  return (
    <svg
      className="tree-preview tree-preview--empty"
      viewBox="0 0 400 200"
      aria-hidden="true"
      focusable="false"
    >
      <g className="tree-preview__lines tree-preview__lines--ghost">
        <path d="M140 52H260M200 52V112" />
      </g>
      <rect className="tree-preview__ghost" x="44" y="30" width="96" height="44" rx="10" />
      <rect className="tree-preview__ghost" x="260" y="30" width="96" height="44" rx="10" />
      <rect
        className="tree-preview__ghost tree-preview__ghost--you"
        x="140"
        y="112"
        width="120"
        height="56"
        rx="12"
      />
      <circle className="tree-preview__plus-disc" cx="200" cy="140" r="14" />
      <path className="tree-preview__plus" d="M200 133v14M193 140h14" />
    </svg>
  );
}
