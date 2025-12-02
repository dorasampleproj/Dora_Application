import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

const root = ReactDOM.createRoot(document.getElementById("root"));

console.log("Starting deployment test...");

// Simulate failure
process.exit(1);  // 0 = success, anything else = failure

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
