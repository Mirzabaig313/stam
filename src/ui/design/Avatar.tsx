import { avatarHue, initialsFor } from "./avatarHue";
import { cx } from "./cx";

export type AvatarProps = {
  /** The person's name: gives the initials and the warm background hue. */
  name: string;
  photoUrl?: string;
  size?: "sm" | "md" | "lg" | "xl";
  /**
   * Names the avatar for assistive technology (role="img"). Without it the avatar is decorative,
   * because the name is almost always written next to it.
   */
  label?: string;
  /** The background hue, when it should not come from the name. */
  hue?: number;
  className?: string;
};

/**
 * A person's face: their photo in a circle, or their initials on a warm album hue picked from the
 * name (the same hue as their card's disc on the canvas).
 */
export function Avatar({ name, photoUrl, size = "md", label, hue, className }: AvatarProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <span
      className={cx("avatar", size !== "md" && `avatar--${size}`, className)}
      data-hue={photoUrl ? undefined : (hue ?? avatarHue(name))}
      {...a11y}
    >
      {photoUrl ? (
        <img className="avatar__image" src={photoUrl} alt="" draggable={false} />
      ) : (
        initialsFor(name)
      )}
    </span>
  );
}
