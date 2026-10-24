import "./share.css";

import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { authStore as defaultAuth } from "@/cloud/auth";
import { type Identity, identity as defaultIdentity, MAX_NAME_CHARS } from "@/cloud/identity";
import type { PresencePerson } from "@/sync/protocol";
import { Dialog } from "@/ui/app/Dialog";
import { Avatar, avatarHue, Button, TextField } from "@/ui/design";
import { useEditor } from "@/ui/store/useEditor";

/** Avatars shown before "+N". */
const SHOWN = 4;

/** A person in the room's display name: theirs, or "Guest" for a link user who gave none. */
export function presenceName(person: PresencePerson, guest: string): string {
  return person.name.trim() || guest;
}

/** The colour of someone in the room: the album hue of their name (their id when unnamed). */
export function presenceHue(person: PresencePerson): number {
  return avatarHue(person.name.trim() || person.id);
}

/** Who else has the tree open (spec §9): initials in their colour, then "+N". */
export function PresenceAvatars() {
  const { t } = useTranslation();
  const people = useEditor((s) => s.cloud?.presence) ?? [];
  if (people.length === 0) return null;
  // The owner is marked: a link user could type the owner's name.
  const names = people.map((p) => {
    const name = presenceName(p, t("presence.guest"));
    return p.kind === "owner" ? t("presence.owner", { name }) : name;
  });
  const extra = people.length - SHOWN;
  return (
    <ul className="presence" aria-label={t("presence.label", { names: names.join(", ") })}>
      {people.slice(0, SHOWN).map((p, i) => (
        <li key={p.id} className="presence__person" title={names[i]}>
          <Avatar
            name={presenceName(p, t("presence.guest"))}
            hue={presenceHue(p)}
            label={names[i]!}
            size="sm"
          />
        </li>
      ))}
      {extra > 0 && (
        <li className="presence__more" title={names.slice(SHOWN).join(", ")}>
          {t("presence.more", { count: extra })}
        </li>
      )}
    </ul>
  );
}

/**
 * A ring in their colour around each person someone else has selected. Drawn by a style rule on
 * the card's `data-person-id`, so the canvas needs no knowledge of presence.
 */
export function PresenceRings() {
  const people = useEditor((s) => s.cloud?.presence) ?? [];
  const rules = new Map<string, string>();
  for (const p of people) {
    if (!p.selectedPersonId || rules.has(p.selectedPersonId)) continue;
    const hue = presenceHue(p);
    rules.set(
      p.selectedPersonId,
      `[data-person-id="${CSS.escape(p.selectedPersonId)}"]{filter:drop-shadow(0 0 1.5px var(--hue-${hue}-deep)) drop-shadow(0 0 1.5px var(--hue-${hue}-deep)) drop-shadow(0 0 3px var(--hue-${hue}-deep))}`,
    );
  }
  if (rules.size === 0) return null;
  return <style data-presence-rings="">{[...rules.values()].join("\n")}</style>;
}

/**
 * Asks someone who opened an edit link what to call them (spec §9), so their changes and their
 * avatar carry a name. Asked once per browser: a name, or "Not now" (then "Guest"), ends it.
 * Someone signed in with Google is named from the account by the server, so is not asked.
 */
export function DisplayNamePrompt({
  identity = defaultIdentity,
  auth = defaultAuth,
}: {
  identity?: Identity;
  auth?: typeof defaultAuth;
}) {
  const { t } = useTranslation();
  const role = useEditor((s) => s.cloud?.role);
  // Asked only once it is known that this browser is not signed in.
  const signedOut = useStore(auth, (s) => s.status === "signedOut");
  const setDisplayName = useEditor((s) => s.setDisplayName);
  const [dismissed, setDismissed] = useState(() => identity.name() !== "" || identity.skipped());
  const [name, setName] = useState("");
  if (role !== "edit" || dismissed || !signedOut) return null;

  function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setDisplayName(name);
    setDismissed(true);
  }

  return (
    <Dialog title={t("namePrompt.title")} onClose={() => setDismissed(true)} closeButton={false}>
      <form onSubmit={save}>
        <TextField
          label={t("namePrompt.label")}
          hint={t("namePrompt.hint")}
          value={name}
          maxLength={MAX_NAME_CHARS}
          autoComplete="name"
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <div className="dialog-actions">
          <Button
            type="button"
            onClick={() => {
              identity.skip();
              setDismissed(true);
            }}
          >
            {t("namePrompt.skip")}
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {t("namePrompt.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
