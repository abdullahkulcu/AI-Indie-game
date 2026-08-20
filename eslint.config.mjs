import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Alt ajanların git worktree kopyaları; .gitignore'da zaten dışarıda.
    ".claude/**",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  /**
   * `engine/` SAF kalır: aynı girdi her zaman aynı çıktıyı vermeli.
   *
   * Kural projenin en eski değişmezi ama şimdiye kadar yalnızca yorumlarda
   * yazıyordu ve hiçbir şey denetlemiyordu; `engine/policy.ts` bildirim zaman
   * damgası için `Date.now()` çağırarak sessizce ihlal ediyordu. Zaman ve
   * rastgelelik motora DIŞARIDAN parametre olarak girer: sunucu ile istemci
   * aynı `now` ile aynı sonucu hesaplayabilsin, kayıt doğrulaması ayrışmasın.
   */
  {
    files: ["engine/**/*.ts"],
    rules: {
      "no-restricted-properties": ["error",
        { object: "Date", property: "now", message: "engine/ saf kalır: zamanı dışarıdan parametre olarak alın (now: number)." },
        { object: "Math", property: "random", message: "engine/ saf kalır: rastgeleliği dışarıdan tohumlayın (bkz. engine/raids.ts)." },
      ],
      "no-restricted-globals": ["error",
        { name: "crypto", message: "engine/ saf kalır: rastgelelik ve zaman dışarıdan gelir." },
      ],
      "no-restricted-syntax": ["error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "engine/ saf kalır: `new Date()` yerine dışarıdan gelen `now` kullanın." },
      ],
    },
  },
]);

export default eslintConfig;
