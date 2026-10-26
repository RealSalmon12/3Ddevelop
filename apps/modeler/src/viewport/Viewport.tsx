import { useEffect, useRef, useState } from "react";
import type { ModelerScene } from "../scene/ModelerScene";
import { ViewportRenderer } from "./ViewportRenderer";

interface ViewportProps {
  model: ModelerScene;
  onReady: (renderer: ViewportRenderer | null) => void;
}

export function Viewport({ model, onReady }: ViewportProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let renderer: ViewportRenderer;
    try {
      renderer = new ViewportRenderer(ref.current!, model);
    } catch (err) {
      console.error(err);
      setFailed(true);
      return;
    }
    onReady(renderer);
    return () => {
      onReady(null);
      renderer.dispose();
    };
  }, [model, onReady]);

  return (
    <div ref={ref} style={{ position: "absolute", inset: 0 }}>
      {failed && (
        <div className="viewport-error">
          3D 화면을 띄우지 못했어요. 그래픽 드라이버를 최신으로 업데이트한 뒤 다시 실행해 주세요.
        </div>
      )}
    </div>
  );
}
