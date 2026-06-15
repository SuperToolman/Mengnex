import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./openapi/mengnex.json",
  output: {
    path: "src/api/generated",
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/client-fetch",
      bundle: true,
    },
    "@hey-api/typescript",
    "@hey-api/sdk",
  ],
});
