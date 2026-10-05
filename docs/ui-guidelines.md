# UI guidelines

## Current visual system

The committed Tailwind configuration defines a navy/blue product palette: primary `#1239B5`, navy `#0B1F4D`, canvas `#F4F7FB`, surface white, border `#E4E9F2`, text-primary `#0F172A`, text-secondary `#5B6B84`, success `#16A34A`, warning `#D97706`, and danger `#DC2626`. The configured sans stack is Plus Jakarta Sans, Inter, then system sans. Dark mode is class-based.

Cards use the shared `Card` primitive and Tailwind’s extended rounded/shadow values (`card` 18px, soft/lift/navy shadows). Buttons, badges, inputs, select controls, tables, dialogs, dropdowns, and empty/loading/error-state components are shared UI primitives. Use them instead of page-specific replacements.

## Layout and navigation

Administrator and root pages use `Sidebar`, `TopNav`, `PageHeader`, dashboard stat/chart cards, command palette, and `MobileBottomBar`. User pages use `UserSidebar` and `UserTopNav`. Page content must remain responsive: use the existing Tailwind breakpoints, preserve horizontal table behavior where needed, and keep navigation usable on smaller screens.

## Content conventions

- Use Lucide icons and semantic `Badge` variants for status; do not communicate state by color alone.
- Keep data views compact, with cards/tables rather than ornamental panels.
- Use the existing form controls, labels, validation presentation, and dialog footer conventions.
- Reuse `EmptyState`, `Skeleton`, `ServiceUnavailable`, and toast/error-boundary paths for non-happy states.
- Preserve visual parity between administrator, root, and user shells while retaining their existing navigation distinctions.

The older `docs/UI_DESIGN_GUIDELINES.md` conflicts with the committed Tailwind primary palette in places. This file reflects the released configuration; component source remains authoritative for an exact variant.
