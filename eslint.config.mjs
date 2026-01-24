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

  // Project-specific overrides (pragmatic: allow , tighten later)
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",

      // React 19 purity lint is noisy for server components / rendering-time date math.
      // Fix real issues, but don't block builds on this rule.
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-img-element": "off",
    }
  }
]);

export default eslintConfig;