import { Panel } from "@suite/ui";
import { MAX_LAYERS, type DocSnapshot, type PixelDoc } from "../doc/PixelDoc";

/** 레이어: 투명한 종이를 겹쳐 놓은 것. 위에 있는 종이가 앞에 보인다. */
export function LayersPanel({ doc, snap }: { doc: PixelDoc; snap: DocSnapshot }) {
  // 위에 있는 레이어가 목록 위에 오도록 거꾸로 보여 준다.
  const order = snap.layers.map((layer, index) => ({ layer, index })).reverse();
  return (
    <Panel title="레이어">
      <ul className="layers">
        {order.map(({ layer, index }) => (
          <li key={layer.id} aria-current={index === snap.active}>
            <button
              className="layer-eye"
              title={layer.visible ? "숨기기" : "보이기"}
              aria-pressed={layer.visible}
              onClick={() => doc.toggleVisible(index)}
            >
              {layer.visible ? "👁" : "–"}
            </button>
            <button
              className="layer-name"
              onClick={() => doc.setActive(index)}
              onDoubleClick={() => {
                const name = window.prompt("레이어 이름", layer.name);
                if (name) doc.renameLayer(index, name);
              }}
              title="눌러서 이 레이어에 그리기 · 두 번 눌러서 이름 바꾸기"
            >
              {layer.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="layer-actions">
        <button title="새 레이어" disabled={snap.layers.length >= MAX_LAYERS} onClick={() => doc.addLayer()}>
          ＋ 새로
        </button>
        <button title="지금 레이어 복제" disabled={snap.layers.length >= MAX_LAYERS} onClick={() => doc.duplicateLayer()}>
          복제
        </button>
        <button title="위로" disabled={snap.active >= snap.layers.length - 1} onClick={() => doc.moveLayer(snap.active, 1)}>
          ▲
        </button>
        <button title="아래로" disabled={snap.active === 0} onClick={() => doc.moveLayer(snap.active, -1)}>
          ▼
        </button>
        <button title="아래 레이어와 합치기" disabled={snap.active === 0} onClick={() => doc.mergeDown()}>
          합치기
        </button>
        <button title="지금 레이어 지우기" disabled={snap.layers.length <= 1} onClick={() => doc.removeLayer()}>
          🗑
        </button>
      </div>
    </Panel>
  );
}
