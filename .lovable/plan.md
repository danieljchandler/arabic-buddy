

# Fix: Badge component ref warning

## Problem
React warns that a `ref` is being passed to the `Badge` component, which currently renders a plain `<div>` without forwarding refs. This is a cosmetic console warning -- it does not break anything.

## Fix
Update `src/components/ui/badge.tsx` to use `React.forwardRef` so the component properly accepts and forwards refs.

## Change

**File: `src/components/ui/badge.tsx`**

Replace the current `Badge` function:
```tsx
function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

With a `forwardRef` version:
```tsx
const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
  }
);
Badge.displayName = "Badge";
```

This is a one-line structural change. No other files need updating.

