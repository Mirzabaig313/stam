// Drag and drop demo: Ines is picked up, slid along her row, dropped in front of her
// siblings, and the row re-flows to the engine's reorderChild result. Then she goes back.
// Her connector stretches while she is carried (the "thread" detail) and settles on drop.

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { DRAG_FRAMES } from "@/site/data";
import { blendFrames, CARD_W, type Frame, settle } from "@/site/sample/frames";

import { bindLiveTree, draw, fit, measure } from "./liveTree";

const KEY = "ines";
const EDGE = `child:ada+tomas:${KEY}`;

const cardOf = (frame: Frame, key: string) => frame.cards.find((c) => c.key === key)!;

/** Where the drop marker goes in `from`: before the first sibling or after the last. */
function markerX(from: Frame, to: Frame): number {
  const row = cardOf(from, KEY).row;
  const siblings = from.cards.filter((c) => c.row === row);
  const forward = cardOf(to, KEY).x < cardOf(from, KEY).x;
  return forward
    ? Math.min(...siblings.map((c) => c.x)) - 20
    : Math.max(...siblings.map((c) => c.x)) + CARD_W + 20;
}

export function startDrag(): (() => void) | undefined {
  const figure = document.querySelector<HTMLElement>("[data-drag]");
  const root = figure?.querySelector<HTMLElement>(".live");
  if (!figure || !root) return;
  const live = bindLiveTree(root);
  const mark = root.querySelector<HTMLElement>("[data-drop-mark]");
  const [A, B] = DRAG_FRAMES;
  const room = {
    x: A.bounds.x - 140,
    y: A.bounds.y - 40,
    width: A.bounds.width + 280,
    height: A.bounds.height + 50,
  };

  // lift, carry: Ines rises clear of her row and travels; room: her siblings slide over to make
  // space while she hovers; drop: she settles into the gap. No frame puts text over text.
  const s = { dir: 0, lift: 0, carry: 0, room: 0, drop: 0, mark: 0 };

  const render = () => {
    const [from, to] = s.dir === 0 ? [A, B] : [B, A];
    const blend = blendFrames(from, to, s.room);
    const home = cardOf(from, KEY);
    const dest = cardOf(to, KEY);
    const mx = markerX(from, to);
    // The carried card is lifted above the row, so the siblings it passes stay readable.
    const dropX = mx - CARD_W / 2;
    const carriedX = home.x + (dropX - home.x) * s.carry;
    const lifted = home.y - 84 * s.lift;
    const t = settle(s.drop);
    const x = s.drop > 0 ? dropX + (dest.x - dropX) * t : carriedX;
    const y = s.drop > 0 ? home.y - 84 + 84 * t : lifted;

    const card = blend.cards.find((c) => c.key === KEY)!;
    card.x = x;
    card.y = y;
    const edge = blend.edges.find((e) => e.id === EDGE)!;
    const [p0, p1] = edge.points as [[number, number], [number, number]];
    edge.points = [p0, p1, [x + CARD_W / 2, p1[1]], [x + CARD_W / 2, y]];

    draw(live, blend, fit(live, room, 1.1, 16), s.lift > 0.01 ? KEY : undefined);
    if (mark) {
      mark.style.transform = `translate3d(${mx}px, ${home.y - 8}px, 0)`;
      mark.style.opacity = String(s.mark);
    }
  };

  const tl = gsap.timeline({ repeat: -1, paused: true, onUpdate: render });
  for (const dir of [0, 1]) {
    tl.set(s, { dir, lift: 0, carry: 0, room: 0, drop: 0, mark: 0 })
      .to(s, { lift: 1, duration: 0.35, ease: "power3.out" }, "+=1.1")
      .to(s, { carry: 1, duration: 1.3, ease: "power2.inOut" })
      .to(s, { mark: 1, duration: 0.25, ease: "power3.out" }, "-=0.55")
      .to(s, { room: 1, duration: 0.8, ease: "none" })
      .to(s, { drop: 1, lift: 0, mark: 0, duration: 0.7, ease: "none" }, "-=0.2")
      .to({}, { duration: 1.4 });
  }

  const onRefresh = () => {
    measure(live);
    render();
  };
  ScrollTrigger.addEventListener("refresh", onRefresh);
  const visible = ScrollTrigger.create({
    trigger: figure,
    start: "top bottom",
    end: "bottom top",
    onToggle: (self) => (self.isActive ? tl.play() : tl.pause()),
  });
  render();

  return () => {
    tl.kill();
    visible.kill();
    ScrollTrigger.removeEventListener("refresh", onRefresh);
  };
}
