import { expect, it } from "vitest";
import * as api from "../../packages/notes/src/index.js";
it("notes loads as an ESM module", () => {
  expect(Object.keys(api)).toEqual([]);
});
