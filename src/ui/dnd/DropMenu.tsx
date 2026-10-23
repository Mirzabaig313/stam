import { type ReactNode, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import type { Command } from "@/core/commands/types";
import {
  type DropAction,
  usableUnionsForChild,
  validDropActions,
} from "@/core/commands/validActions";
import { unionsOf } from "@/core/model/tree";
import { personLabel } from "@/ui/cards/describe";
import { useEditor, useEditorStore } from "@/ui/store/useEditor";

import { PopupMenu, useAnchoredBox, useCloseOnOutsidePress } from "./PopupMenu";

type Point = [number, number];

/**
 * Renders the chooser for which of `parentId`'s unions the child joins (FR-E4). Gets only the
 * unions the child can join. The editor passes the shared `UnionChooser`; tests pass a stub.
 */
export type RenderUnionChoice = (
  parentId: string,
  unionIds: string[],
  onChoose: (unionId: string) => void,
  onCancel: () => void,
) => ReactNode;

export type DropMenuProps = {
  /** The person being moved. */
  draggedId: string;
  /** The person they were dropped on (or picked with "Move to…"). */
  targetId: string;
  /** Client px of the drop point. */
  at: Point;
  onClose: () => void;
  renderUnionChoice: RenderUnionChoice;
};

const LABEL_KEY: Record<DropAction, string> = {
  child: "dnd.makeChild",
  spouse: "dnd.makeSpouse",
  parent: "dnd.makeParent",
};

/**
 * FR-D3: what dropping one person on another can mean, offering only what is allowed. A choice
 * is one command and one undo step. The allowed actions are fixed when the menu opens; if the
 * tree changed since and the command is refused, the store's reason is shown and nothing changes.
 */
export function DropMenu({ draggedId, targetId, at, onClose, renderUnionChoice }: DropMenuProps) {
  const { t } = useTranslation();
  const store = useEditorStore();
  const doc = useEditor((s) => s.doc);
  const [actions] = useState(() => {
    const current = store.getState().doc;
    return current ? validDropActions(current, draggedId, targetId) : [];
  });
  const [choosingUnion, setChoosingUnion] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dragged = doc?.persons[draggedId];
  const target = doc?.persons[targetId];
  if (!doc || !dragged || !target) return null;
  const name = personLabel(target, t);

  function run(cmd: Command) {
    const { dispatch } = store.getState();
    if (dispatch(cmd, "Move person") === null) {
      setChoosingUnion(null);
      setError(store.getState().error ?? "INVALID");
      return;
    }
    onClose();
  }

  function choose(action: DropAction) {
    const current = store.getState().doc;
    if (!current) return;
    if (action === "spouse") {
      run({ type: "relinkAsSpouse", personId: draggedId, targetId });
    } else if (action === "parent") {
      run({ type: "relinkAsParent", personId: draggedId, childId: targetId });
    } else {
      const usable = usableUnionsForChild(current, draggedId, targetId);
      if (unionsOf(current, targetId).length >= 2 && usable.length >= 2) {
        setChoosingUnion(usable);
        return;
      }
      const unionId = usable[0];
      run(
        unionId === undefined
          ? { type: "relinkAsChild", personId: draggedId, parentId: targetId }
          : { type: "relinkAsChild", personId: draggedId, parentId: targetId, unionId },
      );
    }
  }

  if (choosingUnion) {
    return (
      <UnionChoiceBox at={at} onClose={onClose}>
        {renderUnionChoice(
          targetId,
          choosingUnion,
          (unionId) =>
            run({ type: "relinkAsChild", personId: draggedId, parentId: targetId, unionId }),
          onClose,
        )}
      </UnionChoiceBox>
    );
  }

  return (
    <PopupMenu
      at={at}
      label={t("dnd.menuLabel", { name: personLabel(dragged, t) })}
      onClose={onClose}
    >
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          role="menuitem"
          className="dnd-menu__item"
          onClick={() => choose(action)}
        >
          <span>
            <Trans i18nKey={LABEL_KEY[action]} components={{ name: <bdi>{name}</bdi> }} />
          </span>
        </button>
      ))}
      {actions.length === 0 && (
        <p className="dnd-menu__note">
          <Trans
            i18nKey="dnd.noActions"
            components={{
              name: <bdi>{personLabel(dragged, t)}</bdi>,
              target: <bdi>{name}</bdi>,
            }}
          />
        </p>
      )}
      {error && (
        <p role="alert" className="dnd-menu__error">
          {t(`dnd.error.${error}`, { defaultValue: t("dnd.error.INVALID") })}
        </p>
      )}
    </PopupMenu>
  );
}

/** Holds the union chooser where the menu was; a press outside closes it. */
function UnionChoiceBox({
  at,
  onClose,
  children,
}: {
  at: Point;
  onClose: () => void;
  children: ReactNode;
}) {
  const { ref, style } = useAnchoredBox(at);
  useCloseOnOutsidePress(ref, onClose);
  return (
    <div ref={ref} className="dnd-popover" style={style}>
      {children}
    </div>
  );
}
