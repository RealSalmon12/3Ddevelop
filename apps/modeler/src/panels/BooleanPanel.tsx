import { useState } from "react";
import { Panel } from "@suite/ui";
import { BOOLEAN_OPS, type BooleanOp } from "../mesh/boolean";
import type { ModelerScene, ObjectInfo } from "../scene/ModelerScene";

/** 불리언: 고른 오브젝트에 다른 오브젝트를 합치거나 빼기 (블렌더 Boolean, 로블록스 Union/Negate) */
export function BooleanPanel({ model, item, items, notify }: { model: ModelerScene; item: ObjectInfo; items: ObjectInfo[]; notify: (m: string) => void }) {
  const others = items.filter((o) => o.id !== item.id && o.kind !== "effect");
  const [target, setTarget] = useState<string>("");
  const [keep, setKeep] = useState(false);
  const chosen = others.find((o) => o.id === target) ?? others[0];
  const run = (op: BooleanOp) => {
    if (!chosen) return;
    const label = BOOLEAN_OPS.find((b) => b.op === op)!.label;
    const r = model.booleanWith(chosen.id, op, keep);
    if (r === "ok") notify(`‘${item.name}’ 에 ‘${chosen.name}’ 을(를) ${label} 했어요. 마음에 안 들면 Ctrl+Z.`);
    else if (r === "empty") notify("결과가 비었어요. 두 오브젝트가 서로 겹치게 놓았는지 봐 주세요.");
    else notify("이 둘로는 할 수 없어요. 이펙트가 아닌 도형 두 개가 필요해요.");
  };
  return (
    <Panel title="불리언 (합치기·빼기)" className="boolean-panel">
      {chosen ? (
        <>
          <div className="prop-row">
            <span className="prop-label" title="고른 오브젝트에 함께 쓸 다른 오브젝트">대상</span>
            <select className="prop-select" value={chosen.id} onChange={(e) => setTarget(e.target.value)}>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.hidden ? " (숨김)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="boolean-ops">
            {BOOLEAN_OPS.map((b) => (
              <button key={b.op} className="prop-small-button" title={b.hint} onClick={() => run(b.op)}>
                <b>{b.icon}</b> {b.label}
              </button>
            ))}
          </div>
          <label className="boolean-keep" title="끄면 로블록스처럼 대상 오브젝트가 없어져요. 켜면 숨겨 두고 다시 쓸 수 있어요 (숨긴 것도 내보내기에 들어가요).">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> 대상 숨겨서 남겨 두기
          </label>
        </>
      ) : (
        <p className="panel-empty">도형이 두 개 있어야 해요. Shift+A 로 하나 더 넣고 겹치게 놓아 보세요.</p>
      )}
    </Panel>
  );
}
