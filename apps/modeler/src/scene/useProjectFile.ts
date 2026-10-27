import { useCallback, useEffect, useState } from "react";
import type { ModelerScene } from "./ModelerScene";
import { EXPORT_FORMATS, exportScene, type ExportFormat } from "./exporters";

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

  return { name, newFile, open, save, exportAs };
}
