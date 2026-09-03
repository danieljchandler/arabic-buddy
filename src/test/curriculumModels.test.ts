import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CURRICULUM_MODEL_OPTIONS,
  DEFAULT_CURRICULUM_MODEL,
  curriculumModelName,
} from "../../supabase/functions/_shared/curriculumModels";
import { MODEL_IDS } from "../../supabase/functions/_shared/modelRegistry";

/**
 * The Curriculum Builder's model list is shared between the browser picker
 * and curriculum-chat's registry. What broke before this existed: the picker
 * defaulted to an id the function did not know, so every new session failed
 * on its first message. These pin the properties that make the sharing hold.
 */
describe("the curriculum model list", () => {
  it("starts a new session on a model it offers", () => {
    expect(CURRICULUM_MODEL_OPTIONS.map((o) => o.id)).toContain(DEFAULT_CURRICULUM_MODEL);
  });

  it("offers each id once", () => {
    const ids = CURRICULUM_MODEL_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names every registry-owned model by its registry id", () => {
    // Anything that is a registry model must be addressed as one, or a bump
    // leaves this tool on the old generation.
    const registry = new Set(Object.values(MODEL_IDS) as string[]);
    for (const option of CURRICULUM_MODEL_OPTIONS) {
      if (option.id === "fanar" || option.id.startsWith("google/gemma")) continue;
      expect(registry, option.id).toContain(option.id);
    }
  });

  it("is what curriculum-chat builds its registry from", () => {
    // The function must derive its accepted ids from this list, not keep a
    // second hand-written copy — that copy is exactly what drifted.
    const source = readFileSync(
      join(process.cwd(), "supabase", "functions", "curriculum-chat", "index.ts"),
      "utf8",
    );
    expect(source).toContain("CURRICULUM_MODEL_OPTIONS.map(");
  });

  it("labels an id it knows and echoes one it does not", () => {
    expect(curriculumModelName(MODEL_IDS.CLAUDE)).toBe("Claude Sonnet 5");
    expect(curriculumModelName("vendor/unheard-of")).toBe("vendor/unheard-of");
  });
});
