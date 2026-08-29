import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Eye, User } from "lucide-react";
import { SettingSection, SettingsGroup, type SettingsGroupMeta } from "./SettingsGroup";

const account: SettingsGroupMeta = {
  id: "account",
  label: "Account",
  icon: User,
  blurb: "Who you are here.",
};

describe("SettingsGroup", () => {
  it("is a landmark named by its own heading", () => {
    render(
      <SettingsGroup group={account}>
        <p>a setting</p>
      </SettingsGroup>,
    );

    // The rail's links are the only way in for a keyboard or screen-reader
    // user, so the target has to announce itself as somewhere they arrived.
    expect(screen.getByRole("region", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Who you are here.")).toBeInTheDocument();
  });

  it("carries the id the section index links to", () => {
    const { container } = render(
      <SettingsGroup group={account}>
        <p>a setting</p>
      </SettingsGroup>,
    );

    // href="#account" resolves to nothing without this, and the failure is
    // silent — the page simply doesn't move.
    expect(container.querySelector("#account")).toBe(
      screen.getByRole("region", { name: "Account" }),
    );
  });
});

describe("SettingSection", () => {
  it("keeps each setting its own <section>", () => {
    const { container } = render(
      <SettingSection icon={Eye} title="Privacy">
        <p>Show on Leaderboard</p>
      </SettingSection>,
    );

    // Groups are regions and settings are sections, deliberately: markup and
    // tests both scope "one setting" to a <section>, and a group that took the
    // tag over would make every such scope match twice.
    const sections = container.querySelectorAll("section");
    expect(sections).toHaveLength(1);
    expect(sections[0]).toHaveTextContent("Privacy");
    expect(sections[0]).toHaveTextContent("Show on Leaderboard");
  });

  it("places an optional action beside the caption", () => {
    render(
      <SettingSection icon={Eye} title="Home Layout" action={<button>Reset</button>}>
        <p>rows</p>
      </SettingSection>,
    );

    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });
});
