import { LiveTree } from "@/site/components/LiveTree";
import { StaticTree } from "@/site/components/Tree";
import { dragDrop } from "@/site/content";
import { DRAG_FRAMES } from "@/site/data";
import { blendFrames } from "@/site/sample/frames";

export function DragDrop() {
  const [before, after] = DRAG_FRAMES;
  return (
    <section className="drag" aria-labelledby="drag-title">
      <div className="drag__copy">
        <h2 id="drag-title" className="heading">
          {dragDrop.heading}
        </h2>
        <p className="drag__text">{dragDrop.text}</p>
        <dl className="rules">
          {dragDrop.rules.map((rule) => (
            <div key={rule.term} className="rules__item">
              <dt>{rule.term}</dt>
              <dd>{rule.text}</dd>
            </div>
          ))}
        </dl>
      </div>
      <figure className="drag__demo" data-drag>
        <div className="drag__static">
          <StaticTree frame={after} />
        </div>
        <LiveTree all={before} initial={blendFrames(before, before, 1)} className="live--drag">
          <span className="drop-mark" data-drop-mark />
        </LiveTree>
        <figcaption className="drag__caption">{dragDrop.demoLabel}</figcaption>
      </figure>
    </section>
  );
}
