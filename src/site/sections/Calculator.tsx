import { useMemo, useState } from "react";

import { CardBody, cardClass, RulerMarks, StaticTree } from "@/site/components/Tree";
import { calculator } from "@/site/content";
import { FINAL, FINAL_DOC } from "@/site/data";
import { samplePerson } from "@/site/sample/family";
import { relationship } from "@/site/sample/kinship";

/** Connector ids along a path of person keys, so the path can be drawn in the accent. */
function edgesOnPath(path: string[]): Set<string> {
  const ids = new Set(FINAL.edges.map((e) => e.id));
  const on = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const [x, y] = [path[i - 1]!, path[i]!];
    const union = `union:${[x, y].toSorted().join("+")}`;
    if (ids.has(union)) {
      on.add(union);
      continue;
    }
    // Parent to child: the child's own line, and its parents' union line.
    for (const [parent, child] of [
      [x, y],
      [y, x],
    ] as const) {
      const edge = FINAL.edges.find(
        (e) =>
          e.kind === "child" &&
          e.id.endsWith(`:${child}`) &&
          e.id.split(":")[1]!.split("+").includes(parent),
      );
      if (edge) {
        on.add(edge.id);
        on.add(`union:${edge.id.split(":")[1]}`);
      }
    }
  }
  return on;
}

export function Calculator() {
  const [picked, setPicked] = useState<[string, string | null]>([
    calculator.start.a,
    calculator.start.b,
  ]);
  const [a, b] = picked;
  const result = useMemo(() => (b ? relationship(FINAL_DOC, a, b) : null), [a, b]);
  const onPath = new Set(result?.path ?? []);
  const highlight = useMemo(
    () => (result ? edgesOnPath(result.path) : new Set<string>()),
    [result],
  );

  const pick = (key: string) => {
    setPicked(([first, second]) => (second === null ? [first, key] : [key, null]));
  };

  const status = result ? result.sentence : calculator.pickSecond(samplePerson(a).first);

  return (
    <section className="calc" aria-labelledby="calc-title">
      <div className="calc__head">
        <h2 id="calc-title" className="heading">
          {calculator.heading}
        </h2>
        <p className="calc__text">{calculator.text}</p>
      </div>
      <fieldset className="calc__tree">
        <legend className="sr-only">Sample family</legend>
        {/* The same register as the hero: generation numerals in the margin, rules across. */}
        <div className="register calc__register">
          <RulerMarks frame={FINAL} />
          <div className="calc__frame">
            <StaticTree
              frame={FINAL}
              highlight={highlight}
              renderCard={(key, style) => {
                const state = key === a ? "a" : key === b ? "b" : onPath.has(key) ? "path" : "";
                return (
                  <button
                    key={key}
                    type="button"
                    className={cardClass(key, `card--pick${state ? ` is-${state}` : ""}`)}
                    style={style}
                    aria-pressed={key === a || key === b}
                    onClick={() => pick(key)}
                  >
                    <CardBody personKey={key} />
                  </button>
                );
              }}
            />
          </div>
        </div>
      </fieldset>
      <p className="calc__answer" aria-live="polite">
        <bdi>{status}</bdi>
      </p>
      <p className="calc__note">{calculator.note}</p>
    </section>
  );
}
