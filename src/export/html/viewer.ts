/**
 * The interactive viewer that runs inside an exported HTML file.
 *
 * `stamViewer` is written into the file as source text (`viewerSource()`), so it must be
 * fully self-contained: no imports, no references to anything outside its own body. It reads
 * people and labels from `<script type="application/json" id="stam-data">` and writes user text
 * with `textContent` only.
 */

export type ViewerPerson = {
  id: string;
  name: string;
  nativeName?: string;
  lifespan: string;
  details: { label: string; value: string }[];
};

export type ViewerData = {
  lang: string;
  people: ViewerPerson[];
  /** Plural category -> text with `{n}` for the count, e.g. { one: "{n} match" }. */
  matches: Record<string, string>;
  noMatches: string;
};

export function stamViewer(win: Window): void {
  const doc = win.document;
  const dataEl = doc.getElementById("stam-data");
  const stage = doc.getElementById("stage");
  const world = doc.getElementById("world");
  const input = doc.getElementById("q") as HTMLInputElement | null;
  const status = doc.getElementById("status");
  const results = doc.getElementById("results");
  const panel = doc.getElementById("panel");
  const panelName = doc.getElementById("panel-name");
  const panelNative = doc.getElementById("panel-native");
  const panelLife = doc.getElementById("panel-life");
  const panelList = doc.getElementById("panel-details");
  if (!dataEl || !stage || !world || !panel || !panelName || !panelNative || !panelLife) return;
  if (!panelList || !input || !status || !results) return;

  const data = JSON.parse(dataEl.textContent || "{}") as ViewerData;
  const people = new Map<string, ViewerPerson>();
  for (const person of data.people || []) people.set(person.id, person);

  const cards = new Map<string, Element>();
  for (const el of Array.from(stage.querySelectorAll("[data-person-id]"))) {
    const id = el.getAttribute("data-person-id") || "";
    const person = people.get(id);
    if (!person || cards.has(id)) continue;
    cards.set(id, el);
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    el.setAttribute(
      "aria-label",
      person.lifespan ? person.name + ", " + person.lifespan : person.name,
    );
  }

  // ---- Pan and zoom: world is translated by (x, y) and scaled by k, origin top-left. ----
  const contentW = Number(world.getAttribute("data-width")) || 1;
  const contentH = Number(world.getAttribute("data-height")) || 1;
  const MIN = 0.02;
  const MAX = 8;
  let x = 0;
  let y = 0;
  let k = 1;
  let touched = false;

  // oxlint-disable-next-line unicorn/consistent-function-scoping -- the viewer must be self-contained
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const stageBox = () => stage.getBoundingClientRect();

  function apply(glide: boolean): void {
    world!.classList.toggle("glide", glide);
    world!.style.transform = "translate(" + x + "px, " + y + "px) scale(" + k + ")";
  }

  function zoomAt(factor: number, cx: number, cy: number, glide: boolean): void {
    const next = clamp(k * factor, MIN, MAX);
    x = cx - (cx - x) * (next / k);
    y = cy - (cy - y) * (next / k);
    k = next;
    touched = true;
    apply(glide);
  }

  function zoomCentre(factor: number): void {
    const box = stageBox();
    zoomAt(factor, box.width / 2, box.height / 2, true);
  }

  function fit(glide: boolean): void {
    const box = stageBox();
    const pad = 24;
    const s = Math.min((box.width - pad * 2) / contentW, (box.height - pad * 2) / contentH, 1);
    k = clamp(s, MIN, MAX);
    x = (box.width - contentW * k) / 2;
    y = (box.height - contentH * k) / 2;
    touched = false;
    apply(glide);
  }

  function panBy(dx: number, dy: number, glide: boolean): void {
    x += dx;
    y += dy;
    touched = true;
    apply(glide);
  }

  function centreOn(id: string): void {
    const el = cards.get(id);
    if (!el) return;
    const box = stageBox();
    const r = el.getBoundingClientRect();
    // The card's centre in content coordinates, then place it in the middle of the stage.
    const cx = (r.left + r.width / 2 - box.left - x) / k;
    const cy = (r.top + r.height / 2 - box.top - y) / k;
    k = Math.max(k, Math.min(1, MAX));
    x = box.width / 2 - cx * k;
    y = box.height / 2 - cy * k;
    touched = true;
    apply(true);
  }

  stage.addEventListener(
    "wheel",
    (e: WheelEvent) => {
      e.preventDefault();
      const box = stageBox();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.height : 1;
      // Trackpad pinch arrives as a wheel event with ctrlKey and small deltas.
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      zoomAt(Math.exp(-e.deltaY * unit * speed), e.clientX - box.left, e.clientY - box.top, false);
    },
    { passive: false },
  );

  // ---- Pointers: one drags, two pinch. A drag of more than a few px swallows the click. ----
  const pointers = new Map<number, { x: number; y: number }>();
  let dragged = false;
  let downAt = { x: 0, y: 0 };
  let pinch: { dist: number; mx: number; my: number } | null = null;

  function pinchState(): { dist: number; mx: number; my: number } {
    const [a, b] = Array.from(pointers.values());
    const box = stageBox();
    return {
      dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1,
      mx: (a!.x + b!.x) / 2 - box.left,
      my: (a!.y + b!.y) / 2 - box.top,
    };
  }

  stage.addEventListener("pointerdown", (e: PointerEvent) => {
    // Touching the tree puts the results list away so it never covers the cards.
    results.hidden = true;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragged = false;
      downAt = { x: e.clientX, y: e.clientY };
    } else if (pointers.size === 2) {
      dragged = true;
      pinch = pinchState();
    }
  });

  stage.addEventListener("pointermove", (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      if (!dragged && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) return;
      if (!dragged) {
        dragged = true;
        // Capture only once a drag starts, so a plain click still reaches the card.
        try {
          stage.setPointerCapture(e.pointerId);
        } catch {
          /* the pointer may already be gone */
        }
        stage.classList.add("is-dragging");
      }
      panBy(e.clientX - prev.x, e.clientY - prev.y, false);
    } else if (pointers.size === 2 && pinch) {
      const now = pinchState();
      panBy(now.mx - pinch.mx, now.my - pinch.my, false);
      zoomAt(now.dist / pinch.dist, now.mx, now.my, false);
      pinch = now;
    }
  });

  function release(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) stage!.classList.remove("is-dragging");
  }
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);

  stage.addEventListener("click", (e: MouseEvent) => {
    if (dragged) {
      dragged = false;
      return;
    }
    const target = e.target as Element | null;
    const card = target && target.closest ? target.closest("[data-person-id]") : null;
    const id = card ? card.getAttribute("data-person-id") || "" : "";
    if (cards.has(id)) open(id, card as Element);
  });

  // ---- Details panel ----
  let opener: Element | null = null;
  let selected: Element | null = null;

  function open(id: string, from: Element | null): void {
    const person = people.get(id);
    if (!person) return;
    if (selected) selected.classList.remove("is-selected");
    selected = cards.get(id) || null;
    if (selected) selected.classList.add("is-selected");
    opener = from;
    panelName!.textContent = person.name;
    panelNative!.textContent = person.nativeName || "";
    panelNative!.hidden = !person.nativeName;
    panelLife!.textContent = person.lifespan;
    panelLife!.hidden = !person.lifespan;
    panelList!.textContent = "";
    for (const row of person.details || []) {
      const dt = doc.createElement("dt");
      dt.textContent = row.label;
      const dd = doc.createElement("dd");
      dd.textContent = row.value;
      panelList!.append(dt, dd);
    }
    panelList!.hidden = !(person.details && person.details.length);
    panel!.hidden = false;
    panelName!.focus();
  }

  function close(): void {
    if (panel!.hidden) return;
    panel!.hidden = true;
    if (selected) selected.classList.remove("is-selected");
    selected = null;
    const back = opener as (Element & { focus?: () => void }) | null;
    opener = null;
    if (back && back.focus) back.focus();
  }

  // ---- Search ----
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- the viewer must be self-contained
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const folded = new Map<string, string[]>();
  for (const person of people.values()) {
    folded.set(person.id, [fold(person.name), fold(person.nativeName || "")].filter(Boolean));
  }
  let matches: string[] = [];
  let current = -1;
  const plural = (() => {
    try {
      return new Intl.PluralRules(data.lang);
    } catch {
      return new Intl.PluralRules("en");
    }
  })();

  function countLabel(n: number): string {
    const text = data.matches[plural.select(n)] || data.matches.other || "{n}";
    return text.split("{n}").join(n.toLocaleString(data.lang));
  }

  function markCurrent(): void {
    for (const el of cards.values()) el.classList.remove("is-current");
    const id = matches[current];
    const el = id ? cards.get(id) : null;
    if (el) el.classList.add("is-current");
    if (id) centreOn(id);
  }

  function runSearch(): void {
    const needle = fold(input!.value.trim());
    matches = [];
    if (needle) {
      for (const [id, fields] of folded) {
        if (cards.has(id) && fields.some((f) => f.includes(needle))) matches.push(id);
      }
    }
    const set = new Set(matches);
    for (const [id, el] of cards) {
      el.classList.toggle("is-match", set.has(id));
      el.classList.remove("is-current");
    }
    stage!.classList.toggle("is-searching", needle !== "");
    status!.textContent = needle
      ? matches.length
        ? countLabel(matches.length)
        : data.noMatches
      : "";
    results!.textContent = "";
    for (const id of matches.slice(0, 12)) {
      const person = people.get(id)!;
      const li = doc.createElement("li");
      const button = doc.createElement("button");
      button.type = "button";
      const name = doc.createElement("bdi");
      name.textContent = person.name;
      button.append(name);
      if (person.lifespan) {
        // Heard as "Name, 1931 – 2004"; the comma is hidden because the row is laid out in columns.
        const comma = doc.createElement("span");
        comma.className = "vh";
        comma.textContent = ", ";
        button.append(comma);
        const life = doc.createElement("span");
        life.className = "life";
        life.textContent = person.lifespan;
        button.append(life);
      }
      button.setAttribute("data-id", id);
      li.append(button);
      results!.append(li);
    }
    results!.hidden = matches.length === 0;
    current = matches.length ? 0 : -1;
    if (current === 0) markCurrent();
  }

  input.addEventListener("input", runSearch);
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    // Escape first closes the results list (keeping the query and highlights), then the panel.
    if (e.key === "Escape" && !results.hidden) {
      e.preventDefault();
      e.stopPropagation();
      results.hidden = true;
      return;
    }
    if (e.key === "Enter" && matches.length) {
      e.preventDefault();
      current = (current + (e.shiftKey ? matches.length - 1 : 1)) % matches.length;
      markCurrent();
    }
  });
  input.addEventListener("focus", () => {
    results.hidden = matches.length === 0;
  });
  results.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as Element | null;
    const button = target && target.closest ? target.closest("button[data-id]") : null;
    const id = button ? button.getAttribute("data-id") || "" : "";
    if (!id) return;
    current = matches.indexOf(id);
    markCurrent();
    open(id, cards.get(id) || null);
  });

  // ---- Toolbar and keyboard ----
  for (const button of Array.from(doc.querySelectorAll("[data-action]"))) {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-action");
      if (action === "zoom-in") zoomCentre(1.25);
      else if (action === "zoom-out") zoomCentre(0.8);
      else if (action === "fit") fit(true);
      else if (action === "close") close();
    });
  }

  stage.addEventListener("keydown", (e: KeyboardEvent) => {
    const target = e.target as Element | null;
    const card = target && target.closest ? target.closest("[data-person-id]") : null;
    if (card && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      open(card.getAttribute("data-person-id") || "", card);
      return;
    }
    const step = e.shiftKey ? 240 : 60;
    let handled = true;
    if (e.key === "ArrowLeft") panBy(step, 0, true);
    else if (e.key === "ArrowRight") panBy(-step, 0, true);
    else if (e.key === "ArrowUp") panBy(0, step, true);
    else if (e.key === "ArrowDown") panBy(0, -step, true);
    else if (e.key === "+" || e.key === "=") zoomCentre(1.25);
    else if (e.key === "-" || e.key === "_") zoomCentre(0.8);
    // `code` too: an Arabic keyboard types ٠ on that key.
    else if (e.key === "0" || e.code === "Digit0") fit(true);
    else handled = false;
    if (handled) e.preventDefault();
  });

  doc.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    if (e.key === "/" && !typing) {
      e.preventDefault();
      input.focus();
    }
  });

  win.addEventListener("resize", () => {
    if (!touched) fit(false);
  });

  fit(false);
}

/** The viewer as a standalone script: its own source, called with `window`. */
export function viewerSource(): string {
  return "(" + stamViewer.toString() + ")(window);";
}
