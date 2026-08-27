import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FEATURE_REQUIREMENTS,
  featureLabel,
  type PremiumFeature,
} from "./featureAccess";

/**
 * The premium tier table.
 *
 * Worth pinning even though the client barely enforces it. `RequireSubscription`
 * and `useFeatureAccess` are written and not imported by a page — the real
 * gates live server-side: usageCap.ts lifts the daily caps for subscribers,
 * realtime-session-token refuses live voice without a subscription, and
 * voiceBudgetCore.ts meters minutes by tier. This file is the client-side
 * naming of those gates, and the risk is that it drifts out of agreement with
 * the Pricing page, so that wiring the paywall up later locks or unlocks the
 * wrong things.
 *
 * These tests therefore do two jobs: pin the table itself, and check it against
 * what Pricing.tsx actually shows a prospective subscriber. This module used to
 * also declare vocabulary caps and Discover content tiers — promises no code
 * kept, repeated on the pricing page. Both now describe the enforced product;
 * see e2e/my-words.spec.ts for the test recording that no vocab cap exists.
 */

const ALL_FEATURES = Object.keys(FEATURE_REQUIREMENTS) as PremiumFeature[];

describe("the tier table", () => {
  it("requires a paid tier for every listed feature", () => {
    // A feature mapped to 'free' would be a premium feature nothing gates —
    // the type forbids it, and this is the runtime half of that.
    for (const feature of ALL_FEATURES) {
      expect(["standard", "allin"]).toContain(FEATURE_REQUIREMENTS[feature]);
    }
  });

  it("puts the AI tools on Standard", () => {
    expect(FEATURE_REQUIREMENTS.transcribe).toBe("standard");
    expect(FEATURE_REQUIREMENTS.meme_analyzer).toBe("standard");
    expect(FEATURE_REQUIREMENTS.how_do_i_say).toBe("standard");
    expect(FEATURE_REQUIREMENTS.learn_from_x).toBe("standard");
  });

  it("puts live voice on Standard, matching the server", () => {
    // The one feature with a real gate today: realtime-session-token calls
    // requireActiveSubscription, and any paid tier satisfies it.
    expect(FEATURE_REQUIREMENTS.live_voice).toBe("standard");
  });

  it("reserves early access for All-In", () => {
    expect(FEATURE_REQUIREMENTS.early_access).toBe("allin");
  });

  it("names every feature it lists", () => {
    // `featureLabel` is a switch with no default, so a feature added to the
    // union without a case returns undefined and renders as an empty paywall
    // heading.
    for (const feature of ALL_FEATURES) {
      expect(featureLabel(feature)).toBeTruthy();
      expect(typeof featureLabel(feature)).toBe("string");
    }
  });

  it("gives each feature its own label", () => {
    const labels = ALL_FEATURES.map(featureLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("agreement with the Pricing page", () => {
  const pricing = readFileSync(resolve(__dirname, "../pages/Pricing.tsx"), "utf8");
  const subscription = readFileSync(resolve(__dirname, "../hooks/useSubscription.ts"), "utf8");

  it("sells the free tier as limited by the day, not by content", () => {
    // Pricing.tsx hardcodes its bullet list rather than reading this file, so
    // the two can disagree without anything failing to compile. The free tier's
    // real ceiling is the daily caps in usageCap.ts — not a vocabulary count,
    // which this page used to promise and nothing enforced.
    expect(pricing).toMatch(/daily free limits/i);
    expect(pricing).not.toMatch(/\d+ vocabulary words/);
  });

  it("sells Standard as the removal of the daily limits", () => {
    expect(subscription).toMatch(/No daily limits/i);
  });

  it("sells the Standard features this module gates behind Standard", () => {
    // Matched loosely against the marketing copy: the bullets are written for
    // a buyer, not generated from the feature ids.
    expect(subscription).toMatch(/Transcribe/i);
    expect(subscription).toMatch(/Meme Analyzer/i);
    expect(subscription).toMatch(/How Do I Say/i);
    expect(subscription).toMatch(/voice conversations/i);
  });

  it("sells the All-In features this module gates behind All-In", () => {
    expect(subscription).toMatch(/Early access/i);
  });
});

describe("what is not wired up yet", () => {
  it("is imported by no page", () => {
    // The finding this file exists to keep visible. When a page starts gating
    // on `FEATURE_REQUIREMENTS`, this test fails and should be deleted — that
    // failure is the signal that the gate went live, which is worth noticing
    // deliberately rather than discovering from a support ticket.
    const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
    expect(app).not.toMatch(/featureAccess|RequireSubscription|useFeatureAccess/);
  });
});
