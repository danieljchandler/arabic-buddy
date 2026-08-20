import { describe, expect, it } from "vitest";
import { nextRelearn, pushRelearn, RELEARN_GAP } from "./relearn";

/**
 * The relearn policy: a failed card comes back a few cards later, and the
 * session cannot end while one is still owed a retrieval.
 */

describe("relearn queue", () => {
  it("holds a failed card back until its position comes up", () => {
    const queue = pushRelearn([], "بيت", 3);

    expect(nextRelearn(queue, 3, false)).toBeNull();
    expect(nextRelearn(queue, 3 + RELEARN_GAP - 1, false)).toBeNull();
    expect(nextRelearn(queue, 3 + RELEARN_GAP, false)?.card).toBe("بيت");
  });

  it("presents immediately once the main list is exhausted", () => {
    const queue = pushRelearn([], "بيت", 3);

    // A session about to end must not skip the retrieval the failure earned.
    expect(nextRelearn(queue, 4, true)?.card).toBe("بيت");
  });

  it("presents failed cards in the order they failed", () => {
    let queue = pushRelearn([], "أول", 0);
    queue = pushRelearn(queue, "ثاني", 1);

    expect(nextRelearn(queue, 20, false)?.card).toBe("أول");
    expect(nextRelearn(queue.slice(1), 20, false)?.card).toBe("ثاني");
  });

  it("answers null on an empty queue, exhausted or not", () => {
    expect(nextRelearn([], 10, false)).toBeNull();
    expect(nextRelearn([], 10, true)).toBeNull();
  });
});
