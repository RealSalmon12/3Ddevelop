import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@suite/ui/theme.css";
import "./pixel.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
