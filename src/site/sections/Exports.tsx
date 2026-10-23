import { useState } from "react";

import { StaticTree } from "@/site/components/Tree";
import { exportsSection } from "@/site/content";
import { FINAL, FINAL_DOC } from "@/site/data";

/** The first lines of the sample family's real backup file, with readable ids. */
function jsonExcerpt(): string {
  const { doc, keyOf } = FINAL_DOC;
  const ada = Object.values(doc.persons).find((p) => keyOf[p.id] === "ada")!;
  const person = { ...ada, id: "ada" };
  const lines = [
    "{",
    '  "format": "stam",',
    '  "schemaVersion": 1,',
    '  "tree": {',
    `    "name": ${JSON.stringify(doc.name)},`,
    '    "persons": {',
    `      "ada": ${JSON.stringify(person, null, 2).replaceAll("\n", "\n      ")},`,
    `      … ${Object.keys(doc.persons).length - 1} more people`,
    "    },",
    `    "unions": { … ${Object.keys(doc.unions).length} unions }`,
    "  }",
    "}",
  ];
  return lines.join("\n");
}

const JSON_TEXT = jsonExcerpt();

export function Exports() {
  const [active, setActive] = useState(0);
  const formats = exportsSection.formats;
  const current = formats[active]!;
  return (
    <section className="exports" aria-labelledby="exports-title">
      <div className="exports__head">
        <h2 id="exports-title" className="heading">
          {exportsSection.heading}
        </h2>
        <p className="exports__text">{exportsSection.text}</p>
      </div>
      <ul className="exports__list">
        {formats.map((format, i) => [
          i > 0 && !format.available && formats[i - 1]!.available ? (
            <li key="next" className="exports__group" aria-hidden="true">
              {exportsSection.nextLabel}
            </li>
          ) : null,
          <li key={format.id}>
            <button
              type="button"
              className={`format${format.available ? "" : " format--soon"}`}
              aria-pressed={i === active}
              aria-controls="export-preview"
              onClick={() => setActive(i)}
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") setActive(i);
              }}
              onFocus={() => setActive(i)}
            >
              <span className="format__marker" aria-hidden="true" />
              <span className="format__name">{format.name}</span>
              <span className="format__text">{format.text}</span>
              <span className={`format__status${format.available ? " is-available" : ""}`}>
                {format.available ? exportsSection.availableLabel : exportsSection.comingLabel}
              </span>
            </button>
          </li>,
        ])}
      </ul>
      <figure id="export-preview" className="preview" data-sheet={current.sheet} aria-live="polite">
        <div className="preview__stage">
          <div className="sheet">
            <div className="sheet__paper">
              <p className="sheet__title" aria-hidden="true">
                {FINAL_DOC.doc.name}
              </p>
              <StaticTree frame={FINAL} className="tree--sheet" />
              <div className="sheet__tiles" aria-hidden="true">
                {Array.from({ length: 6 }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
            </div>
            <pre className="sheet__code" aria-hidden="true">
              {JSON_TEXT}
            </pre>
          </div>
        </div>
        <figcaption className="preview__caption">
          <span className="preview__file">{current.caption}</span>
          <span className="preview__status">
            {current.available ? exportsSection.availableLabel : exportsSection.comingLabel}
          </span>
        </figcaption>
      </figure>
    </section>
  );
}
