import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AvatarPicker } from "./AvatarPicker";
import { PRESET_AVATARS } from "@/data/presetAvatars";

describe("AvatarPicker", () => {
  it("renders a radio for every preset", () => {
    render(<AvatarPicker value={null} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("radio")).toHaveLength(PRESET_AVATARS.length);
  });

  it("marks only the preset matching the current avatar url as checked", () => {
    const current = PRESET_AVATARS[2];
    render(<AvatarPicker value={current.src} onSelect={vi.fn()} />);
    expect(screen.getByRole("radio", { name: current.label })).toBeChecked();
    expect(screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true"))
      .toHaveLength(1);
  });

  it("checks nothing when the user has an uploaded picture", () => {
    render(<AvatarPicker value="https://xyz.supabase.co/avatars/u/a.jpg" onSelect={vi.fn()} />);
    expect(screen.queryAllByRole("radio", { checked: true })).toHaveLength(0);
  });

  it("emits the chosen preset's public path", () => {
    const onSelect = vi.fn();
    render(<AvatarPicker value={null} onSelect={onSelect} />);
    const target = PRESET_AVATARS[0];
    fireEvent.click(screen.getByRole("radio", { name: target.label }));
    expect(onSelect).toHaveBeenCalledWith(target.src);
  });

  it("does not emit while a save is in flight", () => {
    const onSelect = vi.fn();
    render(<AvatarPicker value={null} onSelect={onSelect} disabled />);
    fireEvent.click(screen.getByRole("radio", { name: PRESET_AVATARS[0].label }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
