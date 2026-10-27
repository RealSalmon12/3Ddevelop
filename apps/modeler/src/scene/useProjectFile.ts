import { useCallback, useEffect, useState } from "react";
import type { ModelerScene } from "./ModelerScene";
import { EXAMPLES } from "./examples";
import { EXPORT_FORMATS, ROBLOX_TRIANGLE_LIMIT, exportScene, robloxProblems, type ExportFormat } from "./exporters";

const PROJECT_FILTER = { name: "3D 모델러 프로젝트", extensions: ["nmodel"] };

const baseName = (path: string) => path.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "");

/** 새로 만들기, 열기, 저장, 내보내기. 화면 맨 위 제목과 닫기 경고도 여기서 맞춘다. */
export function useProjectFile(model: ModelerScene, dirty: boolean, notify: (message: string) => void) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const name = filePath ? baseName(filePath) : "제목 없음";

  useEffect(() => {
    document.title = `${dirty ? "● " : ""}${name} - 3D 모델러`;
    window.suite?.window.setDirty(dirty);
  }, [name, dirty]);

  const confirmDiscard = useCallback(
    () => !model.getSnapshot().dirty || window.confirm("저장하지 않은 작업이 사라져요. 계속할까요?"),
    [model],
  );

  const newFile = useCallback(() => {
    if (!confirmDiscard()) return;
    model.reset();
    setFilePath(null);
  }, [model, confirmDiscard]);

  /** 예제를 새 파일로 연다. 실행 취소하면 빈 장면이 된다. */
  const openExample = useCallback(
    (example: (typeof EXAMPLES)[number]) => {
      if (!confirmDiscard()) return false;
      model.reset();
      setFilePath(null);
      model.applyChanges({ remove: [], upsert: example.parts });
      model.select(null);
      notify(`‘${example.label}’ 예제를 열었어요. ${example.hint}. 장면 목록에서 하나씩 눌러 보세요.`);
      return true;
    },
    [model, confirmDiscard, notify],
  );

  const open = useCallback(async () => {
    if (!window.suite || !confirmDiscard()) return;
    const result = await window.suite.files.open({ filters: [PROJECT_FILTER] });
    if (!result.ok) {
      if (result.reason === "error") notify(`파일을 열지 못했어요. ${result.message ?? ""}`);
      return;
    }
    try {
      model.load(result.text);
      setFilePath(result.path);
    } catch (err) {
      notify(err instanceof Error ? err.message : "파일을 열지 못했어요.");
    }
  }, [model, confirmDiscard, notify]);

  const save = useCallback(
    async (saveAs = false) => {
      if (!window.suite) return;
      const result = await window.suite.files.save({
        path: saveAs ? undefined : filePath ?? undefined,
        defaultName: `${name}.nmodel`,
        filters: [PROJECT_FILTER],
        data: model.serialize(),
      });
      if (result.ok) {
        model.markSaved();
        setFilePath(result.path);
        notify("저장했어요.");
      } else if (result.reason === "error") {
        notify(`저장하지 못했어요. ${result.message ?? ""}`);
      }
    },
    [model, filePath, name, notify],
  );

  const exportAs = useCallback(
    async (format: ExportFormat) => {
      if (!window.suite) return;
      if (model.allMeshes().length === 0) return notify("내보낼 오브젝트가 없어요.");
      const info = EXPORT_FORMATS.find((f) => f.format === format)!;
      const result = await window.suite.files.save({
        defaultName: `${name}.${format}`,
        filters: [{ name: info.filterName, extensions: [format] }],
        data: await exportScene(model.root, format),
      });
      if (result.ok) notify(`${format.toUpperCase()} 파일로 내보냈어요.`);
      else if (result.reason === "error") notify(`내보내지 못했어요. ${result.message ?? ""}`);
    },
    [model, name, notify],
  );

  /** 로블록스용: 오브젝트마다 MeshPart 하나가 되는 GLB. 삼각형이 너무 많으면 먼저 알려 준다. */
  const exportForRoblox = useCallback(async (onlySelected = false) => {
    if (!window.suite) return;
    const selectedId = model.getSnapshot().selectedId;
    if (onlySelected && !selectedId) return notify("먼저 내보낼 오브젝트를 골라 주세요.");
    const only = onlySelected ? (c: { userData: Record<string, unknown> }) => c.userData.id === selectedId : undefined;
    const meshes = model.allMeshes().filter((m) => m.userData.kind !== "effect" && (!only || only(m)));
    if (meshes.length === 0) return notify(onlySelected ? "이펙트는 내보낼 수 없어요. 도형을 골라 주세요." : "내보낼 오브젝트가 없어요.");
    const problems = robloxProblems(meshes);
    if (problems.length > 0)
      return notify(
        `로블록스는 오브젝트 하나에 삼각형 ${ROBLOX_TRIANGLE_LIMIT.toLocaleString()}개쯤까지만 받아요. ${problems.join(", ")}. 모서리 깎기나 세분화를 덜 하거나 여러 조각으로 나눠 주세요.`,
      );
    const result = await window.suite.files.save({
      defaultName: `${onlySelected ? meshes[0].name : name}-로블록스.glb`,
      filters: [{ name: "GLB 3D 모델", extensions: ["glb"] }],
      data: await exportScene(model.root, "glb", only),
    });
    if (result.ok)
      notify("로블록스용으로 내보냈어요. 로블록스 스튜디오에서 ‘3D 가져오기’로 이 파일을 열면 돼요. 이펙트는 빠졌어요.");
    else if (result.reason === "error") notify(`내보내지 못했어요. ${result.message ?? ""}`);
  }, [model, name, notify]);

  return { name, newFile, openExample, open, save, exportAs, exportForRoblox };
}
