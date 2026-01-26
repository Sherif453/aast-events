import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  // Reliable ignores for ESLint 9 flat config (preferred over .eslintignore)
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "node_modules/**",
    "next-env.d.ts",
    "supabase/functions/**"
  ]),

  ...nextVitals,
  ...nextTs,

  // Project-specific overrides (remove dangerous rules)
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error", // Ensure type safety
      "react-hooks/purity": "error", // Enforce purity in hooks
      "react-hooks/set-state-in-effect": "error", // Prevent unsafe state updates
      "@next/next/no-img-element": "error", // Ensure the use of next/image for all images
    }
  }
]);

export default eslintConfig;