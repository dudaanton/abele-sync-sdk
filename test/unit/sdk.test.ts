import { expect, it } from "vitest";
import * as api from "../../packages/sdk/src/index.js";
it("sdk loads as an ESM module", () => {
  expect(Object.keys(api)).toEqual([]);
});
