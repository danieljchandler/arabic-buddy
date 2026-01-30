
# Lahja Brand Guidelines Update
## Updated Color Palette and Typography

---

## Overview

This update refines the Lahja brand identity with the official color palette and typography guidelines provided. The changes move from the previous maroon/beige palette to a **Deep Desert Green** primary with **Warm Sand** backgrounds and **Charcoal Black** text.

---

## Color Palette Changes

### Current vs New Colors

| Role | Current | New |
|------|---------|-----|
| **Primary** | Deep Maroon (#8B3A3A) | Deep Desert Green (#1F6F54) |
| **Foreground/Text** | Charcoal (#3D3D3D) | Charcoal Black (#1F1F1F) |
| **Background** | Cream (#FAF8F5) | Warm Sand (#E6D5B8) |
| **Secondary** | Warm Beige (#D4B896) | Muted Indigo (#2F3E46) |
| **Accent** | Olive Green (#6B7B4F) | Desert Red (#8C3A2B) |
| **Additional** | - | Olive Green (#5A6F4D) for dialect accents |

### Color Usage Ratio
- Primary (Green + Charcoal): 70%
- Secondary (Sand + Indigo): 20%
- Accent (Red / Olive): 10%

---

## Typography Changes

### Current vs New Fonts

| Usage | Current | New |
|-------|---------|-----|
| **English Headlines** | Inter Bold | Montserrat SemiBold/Bold |
| **English Body** | Inter Regular | Open Sans Regular/Medium |
| **Arabic All** | IBM Plex Sans Arabic | Cairo Regular/SemiBold/Bold |
| **Arabic Display** | - | Reem Kufi (marketing only) |

### Typography Rules
- No multiple Arabic font styles on same screen
- Generous line spacing for readability
- Clarity over decoration

---

## Phase 1: Update CSS Variables

**File:** `src/index.css`

Update the Google Fonts import to load new fonts:
```css
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&family=Montserrat:wght@600;700&family=Open+Sans:wght@400;500&display=swap');
```

Update root CSS variables to new color values (converting HEX to HSL):
- `--primary`: 160 57% 28% (Deep Desert Green #1F6F54)
- `--foreground`: 0 0% 12% (Charcoal Black #1F1F1F)
- `--background`: 38 47% 81% (Warm Sand #E6D5B8) 
- `--secondary`: 192 22% 23% (Muted Indigo #2F3E46)
- `--accent`: 7 52% 36% (Desert Red #8C3A2B)
- Additional olive accent: 97 17% 37% (#5A6F4D)

Update dark mode colors to complement the new palette.

---

## Phase 2: Update Tailwind Configuration

**File:** `tailwind.config.ts`

Update font family definitions:
```typescript
fontFamily: {
  sans: ["Open Sans", "Cairo", "sans-serif"],
  heading: ["Montserrat", "Cairo", "sans-serif"],
  arabic: ["Cairo", "Open Sans", "sans-serif"],
}
```

---

## Phase 3: Update Gradient Classes

**File:** `src/index.css`

Update heritage/cultural gradients to use new green primary:
- `.bg-gradient-heritage`: green to sand gradient
- `.bg-gradient-earth`: indigo to charcoal
- `.bg-gradient-warm`: sand to desert red accent

Update topic gradients to align with new palette.

---

## Phase 4: Update Component Font Usage

### Index Page (`src/pages/Index.tsx`)
- Apply `font-heading` class to main headings

### Auth Page (`src/pages/Auth.tsx`)  
- Apply heading font to "Welcome Back" / "Join Lahja"

### Admin Dashboard (`src/pages/admin/Dashboard.tsx`)
- Apply heading font to dashboard title

### Body Text Updates
All body text will automatically use Open Sans through the base font-family setting.

---

## Phase 5: Adjust Background Colors

Since the new background is Warm Sand (#E6D5B8), which is darker than cream:
- Cards may need slightly adjusted contrast
- Ensure text remains readable on sand background
- Consider using white/cream for card backgrounds to maintain contrast

---

## File Change Summary

| File | Changes |
|------|---------|
| `src/index.css` | Font imports, CSS variables, gradients |
| `tailwind.config.ts` | Font family definitions |
| `src/pages/Index.tsx` | Apply heading font class |
| `src/pages/Auth.tsx` | Apply heading font class |
| `src/pages/admin/Dashboard.tsx` | Apply heading font class |
| `src/components/TopicCard.tsx` | Ensure text contrast on new colors |

---

## Technical Notes

1. **HSL Conversions**:
   - #1F6F54 (Deep Desert Green) = 160 57% 28%
   - #1F1F1F (Charcoal Black) = 0 0% 12%
   - #E6D5B8 (Warm Sand) = 38 47% 81%
   - #2F3E46 (Muted Indigo) = 192 22% 23%
   - #8C3A2B (Desert Red) = 7 52% 36%
   - #5A6F4D (Olive Green) = 97 17% 37%

2. **Contrast Considerations**: The sand background is warmer and darker than cream, so card/popover backgrounds should use white or light cream for contrast.

3. **Font Loading**: New fonts will load from Google Fonts with Arabic subset support for Cairo.

---

## Expected Outcome

After implementation, Lahja will have:
- Deep green primary that evokes heritage and sophistication
- Warm, earthy sand backgrounds
- Professional typography with Montserrat headlines and Open Sans body
- Native Cairo font for all Arabic content
- Cohesive color usage following the 70/20/10 ratio guideline
