import React from "react";
import ReactDOM from "react-dom/client";
import QuickSearchWindow from "./QuickSearchWindow";
import { installConsoleTimestamps } from "../lib/consoleTimestamps";
import { isLinux } from "../lib/platform";
import "../styles/globals.css";

installConsoleTimestamps();

if (isLinux) {
  document.documentElement.dataset.platform = "linux";
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QuickSearchWindow />
  </React.StrictMode>
);
