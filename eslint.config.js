import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/", "src-tauri/", "vendor/", "playwright-report/", "test-results/", ".artifacts/"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  // Tests poke at window.__TAURI_INTERNALS__ and mock payloads, which have no useful types.
  { files: ["tests/**", "src/lib/mock.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
);
