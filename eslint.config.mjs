import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // demo/ is a separate Next.js project with its own lint config.
  // src-tauri/ holds the Rust desktop app plus Cargo build output.
  // bin/pi-web-tray.js is the CommonJS tray CLI.
  { ignores: ["demo/**", "src-tauri/**", "bin/pi-web-tray.js"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;
