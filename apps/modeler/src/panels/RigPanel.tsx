import { useState } from "react";
import { Panel } from "@suite/ui";
import type { Rig } from "../mesh/rig";
import type { RigMode } from "../viewport/RigTool";
import type { ModelerScene } from "../scene/ModelerScene";

interface Props {
  model: ModelerScene;
  id: string;
  rig: Rig | null;
  mode: RigMode;
  onMode: (m: RigMode) => void;
  bone: string | null;
  onBone: (id: string | null) => void;
  mirror: boolean;
  onMirror: (on: boolean) => void;
  notify: (m: string) => void;
}

const deg = (r: number) => Math.round((r * 180) / Math.PI);
const rad = (d: number) => (d * Math.PI) / 180;

/** 뼈대 모드 패널 (블렌더의 아마추어 + 포즈 모드) */
export function RigPanel({ model, id, rig, mode, onMode, bone, onBone, mirror, onMirror, notify }: Props) {
  const [links, setLinks] = useState(4);
  if (!rig) {
    return (
      <Panel title="뼈대 (리깅)" className="sculpt-panel rig-panel">
        <p className="panel-empty">뼈대를 넣으면 뼈를 돌리는 것만으로 팔다리가 구부러져요. 포즈를 키프레임으로 남기면 캐릭터 애니메이션이 되고, GLB 로 내보내면 로블록스·유니티에서 그대로 움직여요.</p>
        <div className="paint-actions">
          <button
            className="prop-small-button"
            title="앞(+Z)을 보고 팔을 옆으로 벌린 캐릭터에 맞춰 19개 뼈를 넣어요"
            onClick={() => {
              const b = model.addRig(id, "human");
              if (b) {
                onBone(b.find((x) => x.name === "왼 위팔")?.id ?? b[0].id);
                notify(`사람 뼈대 ${b.length}개를 넣고 가중치를 자동으로 붙였어요. 관절 위치가 어긋나면 ‘관절 위치’에서 구슬을 끌어 맞춰요.`);
              }
            }}
          >
            🧍 사람 뼈대
          </button>
          <button
            className="prop-small-button"
            title="가장 긴 방향으로 이어진 뼈 (꼬리, 줄, 촉수, 나무)"
            onClick={() => {
              const b = model.addRig(id, "chain", links);
              if (b) {
                onBone(b[0].id);
                notify(`마디 ${b.length}개짜리 사슬 뼈대를 넣었어요.`);
              }
            }}
          >
            ⛓ 사슬 뼈대
          </button>
        </div>
        <label className="prop-row">
          <span className="prop-label">사슬 마디</span>
          <input type="range" min={2} max={12} value={links} onChange={(e) => setLinks(Number(e.target.value))} />
          <span className="sculpt-value">{links}개</span>
        </label>
      </Panel>
    );
  }

  const selected = rig.bones.find((b) => b.id === bone) ?? null;
  const rot = (selected && rig.pose[selected.id]) || [0, 0, 0];
  const depth = (b: (typeof rig.bones)[number]) => {
    let d = 0;
    let p = b.parent;
    while (p && d < 20) {
      d++;
      p = rig.bones.find((x) => x.id === p)?.parent ?? null;
    }
    return d;
  };
  // 부모 아래에 자식이 오게 (트리)
  const ordered: typeof rig.bones = [];
  const walk = (parent: string | null) =>
    rig.bones.filter((b) => b.parent === parent || (parent === null && b.parent && !rig.bones.some((x) => x.id === b.parent))).forEach((b) => {
      if (ordered.includes(b)) return;
      ordered.push(b);
      walk(b.id);
    });
  walk(null);
  const setAxis = (axis: number, d: number, done: boolean) => {
    if (!selected) return;
    const next = [...rot] as [number, number, number];
    next[axis] = rad(d);
    model.setBonePose(id, selected.id, next, done);
  };

  return (
    <Panel title="뼈대 (리깅)" className="sculpt-panel rig-panel">
      <div className="sculpt-brushes paint-brushes rig-modes">
        <button className="prop-small-button" aria-pressed={mode === "pose"} title="뼈를 돌려 포즈 만들기" onClick={() => onMode("pose")}>
          <b>🤸</b> 포즈
        </button>
        <button
          className="prop-small-button"
          aria-pressed={mode === "joint"}
          title="쉬는 자세에서 관절(구슬)을 끌어 뼈 자리 맞추기"
          onClick={() => {
            if (Object.keys(rig.pose).length) {
              model.resetPose(id);
              notify("관절 위치는 쉬는 자세에서 고쳐요. 포즈를 초기화했어요 (Ctrl+Z 로 되돌릴 수 있어요).");
            }
            onMode("joint");
          }}
        >
          <b>📍</b> 관절 위치
        </button>
      </div>
      <ul className="rig-bones">
        {ordered.map((b) => (
          <li key={b.id} style={{ paddingLeft: depth(b) * 10 }}>
            <button aria-pressed={b.id === bone} onClick={() => onBone(b.id)}>
              {rig.pose[b.id] ? "● " : ""}
              {b.name}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <>
          <label className="prop-row">
            <span className="prop-label">이름</span>
            <input key={selected.id} className="rig-name" defaultValue={selected.name} onBlur={(e) => model.renameBone(id, selected.id, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
          </label>
          {mode === "pose" &&
            (["X", "Y", "Z"] as const).map((axis, i) => (
              <label key={axis} className="prop-row" title={`${axis} 축으로 돌리기 (화면의 손잡이를 끌어도 돼요)`}>
                <span className="prop-label">회전 {axis}</span>
                <input type="range" min={-180} max={180} value={deg(rot[i])} onChange={(e) => setAxis(i, Number(e.target.value), false)} onPointerUp={(e) => setAxis(i, Number((e.target as HTMLInputElement).value), true)} />
                <span className="sculpt-value">{deg(rot[i])}°</span>
              </label>
            ))}
          <div className="paint-actions">
            {mode === "pose" && (
              <button className="prop-small-button" title="이 뼈를 쉬는 자세로 (Alt+R)" onClick={() => model.resetPose(id, selected.id)}>
                ↺ 이 뼈 초기화
              </button>
            )}
            <button className="prop-small-button" title="이 뼈 끝에 새 뼈를 이어 붙여요 (E)" onClick={() => onBone(model.extrudeBone(id, selected.id))}>
              ＋ 뼈 이어 붙이기
            </button>
            <button
              className="prop-small-button"
              title="이 뼈를 지워요. 자식 뼈는 위 뼈에 붙어요"
              onClick={() => {
                const parent = selected.parent;
                model.deleteBone(id, selected.id);
                onBone(parent);
              }}
            >
              ✕ 뼈 지우기
            </button>
          </div>
        </>
      )}
      {mode === "pose" && (
        <>
          <label className="boolean-keep" title="왼쪽 뼈를 돌리면 오른쪽 짝 뼈도 거울처럼 (이름에 왼/오른이 있는 뼈)">
            <input type="checkbox" checked={mirror} onChange={(e) => onMirror(e.target.checked)} /> 좌우 대칭 포즈
          </label>
          <div className="paint-actions">
            <button className="prop-small-button" title="지금 포즈를 이 프레임에 키로 남겨요 (I)" onClick={() => model.insertKey() && notify("포즈 키를 넣었어요. 다른 프레임으로 가서 포즈를 바꾸고 또 넣어 보세요.")}>
              ◆ 포즈 키 넣기
            </button>
            <button className="prop-small-button" title="모든 뼈를 쉬는 자세로" onClick={() => model.resetPose(id)}>
              ↺ 모든 포즈 초기화
            </button>
            <button
              className="prop-small-button"
              title="지금 모습을 모양에 굳히고 뼈대를 떼요"
              onClick={() => model.applyPose(id) && notify("지금 포즈를 모양에 굳혔어요. 뼈대와 모디파이어는 떼어졌어요.")}
            >
              ⤓ 포즈를 모양에 굳히기
            </button>
            <button className="prop-small-button" title="뼈대를 통째로 지워요" onClick={() => model.removeRig(id) && onBone(null)}>
              ✕ 뼈대 지우기
            </button>
          </div>
        </>
      )}
      <p className="panel-empty sculpt-tip">
        {mode === "pose"
          ? "뼈를 클릭해 고르고 동그란 손잡이를 끌어 돌려요. ● 표시는 돌린 뼈예요. Alt+R: 이 뼈 초기화 · I: 포즈 키 · Tab: 끝내기"
          : "구슬(관절)을 클릭하고 화살표를 끌어 옮겨요. 이어진 뼈도 함께 따라와요. 가중치는 저절로 다시 계산돼요."}
      </p>
    </Panel>
  );
}
