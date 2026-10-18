import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts", "test/fake/**/*.test.ts"],
    maxWorkers: 2,
  },
});
