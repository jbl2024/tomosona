# UI Architecture

Tomosona's design system uses four layers:

For the exhaustive component reference for everything in this folder, see [README.md](./README.md).

1. Tokens
Semantic CSS custom properties in `src/assets/tailwind.css` define shared colors, surfaces, borders, typography, spacing, and component states. App code should consume semantic tokens like `--surface-bg`, `--menu-bg`, `--button-primary-bg`, not raw palette values.

2. Primitives
Small presentational components in this folder own repeated UI contracts such as buttons, inputs, badges, separators, and panels. Primitives support explicit variants and sizes. They must stay free of domain logic and Tauri calls.

3. Patterns
Higher-level shared shells such as fields, modal shells, and menus compose primitives into reusable structures with accessibility baked in. Create a pattern when multiple features repeat the same structure, not just the same color.

4. Domains
Editor, cosmos, explorer, pulse, and second-brain components should compose primitives and patterns while keeping their own behavior and layout decisions. Domain-specific layouts can stay local if the structure is not broadly reusable.

## Naming rules

- Foundation tokens may change with the palette.
- Semantic tokens are the app-facing contract and should remain stable when possible.
- Domain-only tokens should be prefixed by the owning area, for example `--editor-*` or `--sb-*`.

## When to extract

- Create a primitive when multiple screens repeat the same element contract.
- Create a pattern when multiple screens repeat the same composition contract.
- Keep markup local when only one domain needs the structure or state flow.

## Variants

- Use `variant` for visual role such as `primary`, `secondary`, `ghost`, `danger`.
- Use `size` for physical scale such as `sm`, `md`, `lg`.
- Use `tone` for neutral versus contextual surfaces or badges.

## Accessibility

- Buttons and icon buttons keep native `<button>` semantics.
- Fields own label/help/error relationships via `for`, `aria-describedby`, and `aria-invalid`.
- Modal shells own `role="dialog"`, `aria-modal`, title, description, and backdrop dismissal.
- Menus should render focusable actions and keep disabled state explicit.
