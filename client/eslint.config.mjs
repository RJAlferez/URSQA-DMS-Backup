import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import reactRefresh from "eslint-plugin-react-refresh"

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", {
        allowConstantExport: true,
        // These modules intentionally combine a component with its stable
        // hook/helper API. Splitting them would add import churn without
        // changing Fast Refresh behavior or application runtime behavior.
        allowExportNames: [
          "getFileTypeIcon",
          "getFileTypeColor",
          "badgeVariants",
          "buttonVariants",
          "useAuth",
          "hasServerPermission",
          "hasAnyServerPermission",
          "hasAllServerPermissions",
          "getUserPermissions",
          "ROLE_LABELS",
          "ROLE_DESCRIPTIONS",
          "ROLE_PERMISSIONS",
          "rolePermissionsOf",
          "hasPermission",
          "isAdminRole",
          "isRootRole",
          "isRootUser",
          "isAdminUser",
          "isReviewerRole",
          "isPortalRole",
          "ThemeMode",
          "useTheme",
          "toastStore",
          "useToasts",
          "toast",
        ],
      }],
    },
  },
)
