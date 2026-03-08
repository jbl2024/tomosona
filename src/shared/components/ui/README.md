# Shared UI Components

This folder contains Tomosona's shared design-system primitives and patterns.

The components here are intentionally presentational. They define consistent visual and accessibility contracts, but they do not own domain state, Tauri calls, or application-specific workflows.

Use this document as the source-level reference for:

- what each component is for
- which props, slots, and events it supports
- how to compose it in real application code
- when to use it
- what it exposes to parent code
- which semantic tokens it relies on

For design-system architecture and extraction rules, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Principles

- Prefer semantic tokens from `src/assets/tailwind.css` over local hard-coded colors.
- Prefer explicit props such as `variant`, `size`, `tone`, and `invalid` over free-form boolean style flags.
- Keep business logic outside this folder.
- Favor native semantics where possible: `<button>`, `<input>`, `<select>`, `<textarea>`, and labeled form controls.
- Use shared patterns only when multiple screens repeat the same structural contract.

## Quick Start

Most features should follow this sequence:

1. Start with a semantic structure.
2. Pick the smallest shared primitive that matches the contract.
3. Wrap form controls in `UiField` when they need labels, help text, or errors.
4. Use `UiModalShell` for standard dialogs instead of rebuilding modal chrome locally.
5. Only add local layout classes for spacing and arrangement, not for redefining component visuals.

Example:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import UiButton from './UiButton.vue'
import UiField from './UiField.vue'
import UiInput from './UiInput.vue'

const name = ref('')
const error = ref('')
</script>

<template>
  <UiField for-id="profile-name" label="Profile name" :error="error">
    <template #default="{ describedBy, invalid }">
      <UiInput
        id="profile-name"
        v-model="name"
        size="sm"
        :aria-describedby="describedBy"
        :invalid="invalid"
        placeholder="OpenAI Codex"
      />
    </template>
  </UiField>

  <UiButton variant="primary" size="sm">
    Save
  </UiButton>
</template>
```

## Component Index

- `UiButton.vue`
- `UiIconButton.vue`
- `UiInput.vue`
- `UiTextarea.vue`
- `UiSelect.vue`
- `UiCheckbox.vue`
- `UiBadge.vue`
- `UiPanel.vue`
- `UiSeparator.vue`
- `UiField.vue`
- `UiMenu.vue`
- `UiMenuList.vue`
- `UiModalShell.vue`
- `UiFilterableDropdown.vue`
- `UiThemeSwitcher.vue`

## `UiButton`

Purpose:
- Standard action button for primary, secondary, ghost, and danger actions.

Use when:
- the UI needs a normal clickable action
- the action should participate in shared size and variant rules
- loading or active states are needed

Do not use when:
- the control is icon-only; use `UiIconButton`
- the UI needs a hyperlink; use a link element instead

Props:
- `variant?: 'primary' | 'secondary' | 'ghost' | 'danger'`
- `size?: 'sm' | 'md' | 'lg'`
- `disabled?: boolean`
- `loading?: boolean`
- `active?: boolean`
- `type?: 'button' | 'submit' | 'reset'`
- `className?: string`

Slots:
- default: button label/content
- `leading`: optional icon/content before the label
- `trailing`: optional icon/content after the label

Events:
- native button events such as `click`

Exposed API:
- `rootEl: HTMLButtonElement | null`

Notes:
- `loading` disables the button and adds `aria-busy="true"`.
- `active` is visual only; it does not imply toggle-button semantics.
- `ghost` is intended for secondary dismissive actions, not high-emphasis CTA actions.

Example:

```vue
<UiButton variant="primary" size="sm">Save</UiButton>
<UiButton variant="ghost" size="sm">Cancel</UiButton>
<UiButton variant="danger" :loading="deleting">Delete</UiButton>
```

Key tokens:
- `--button-primary-*`
- `--button-secondary-*`
- `--button-danger-*`
- `--button-active-*`

## `UiIconButton`

Purpose:
- Icon-only wrapper around `UiButton` with built-in square sizing.

Use when:
- the control is represented only by an icon
- toolbar and chrome actions need a shared hit target

Props:
- `variant?: UiButtonVariant`
- `size?: UiButtonSize`
- `disabled?: boolean`
- `loading?: boolean`
- `active?: boolean`
- `type?: 'button' | 'submit' | 'reset'`
- `title?: string`
- `ariaLabel?: string`
- `className?: string`

Slots:
- default: usually a single icon component or SVG

Events:
- native button events such as `click`

Exposed API:
- `rootEl`
- `getRootEl(): HTMLButtonElement | null`

Accessibility:
- callers should provide either `ariaLabel` or `title`
- icon-only buttons should always have an accessible name

Example:

```vue
<UiIconButton
  aria-label="Open settings"
  title="Open settings"
  :active="settingsOpen"
  @click="settingsOpen = !settingsOpen"
>
  <Cog8ToothIcon />
</UiIconButton>
```

## `UiInput`

Purpose:
- Shared single-line text input with semantic invalid and size states.

Use when:
- a plain text or password-like single-line control is needed

Props:
- `modelValue: string`
- `placeholder?: string`
- `size?: 'sm' | 'md' | 'lg'`
- `invalid?: boolean`
- `className?: string`

Events:
- `update:modelValue`

Notes:
- this component intentionally stays close to a native `<input>`
- extra attributes such as `id`, `type`, `aria-describedby`, `disabled`, and `data-*` pass through via Vue attribute inheritance

Example:

```vue
<UiInput
  v-model="query"
  size="sm"
  placeholder="Search notes"
  aria-label="Search notes"
/>
```

Key tokens:
- `--input-bg`
- `--input-border`
- `--input-focus-border`
- `--input-focus-ring`
- `--field-error-border`

## `UiTextarea`

Purpose:
- Shared multiline text control for notes, settings, and free-form descriptions.

Props:
- `modelValue: string`
- `placeholder?: string`
- `invalid?: boolean`
- `className?: string`
- `rows?: number`

Events:
- `update:modelValue`

Notes:
- this component does not currently support size variants
- extra native textarea attributes pass through via attribute inheritance

Example:

```vue
<UiTextarea
  v-model="description"
  :rows="6"
  placeholder="Write a short description"
/>
```

## `UiSelect`

Purpose:
- Shared native `<select>` wrapper with semantic invalid, disabled, and size states.

Props:
- `modelValue: string`
- `size?: 'sm' | 'md' | 'lg'`
- `invalid?: boolean`
- `disabled?: boolean`
- `className?: string`

Slots:
- default: `<option>` or `<optgroup>` content

Events:
- `update:modelValue`

Notes:
- this component keeps native browser select behavior
- extra attributes such as `id`, `name`, `aria-describedby`, and `data-*` pass through

Example:

```vue
<UiSelect v-model="provider" size="sm">
  <option value="openai">OpenAI</option>
  <option value="anthropic">Anthropic</option>
</UiSelect>
```

## `UiCheckbox`

Purpose:
- Shared checkbox wrapper with optional inline label content.

Props:
- `modelValue: boolean`
- `disabled?: boolean`
- `label?: string`
- `className?: string`

Slots:
- default: optional custom label content

Events:
- `update:modelValue`

Notes:
- if both `label` and default slot are provided, the slot content wins
- this is best for simple checkbox rows; more complex field compositions should be wrapped in `UiField`

Example:

```vue
<UiCheckbox v-model="enabled" label="Enable external embeddings" />
```

## `UiBadge`

Purpose:
- Small inline status or categorization marker.

Props:
- `tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'`
- `className?: string`

Slots:
- default: badge label/content

Use when:
- a compact, non-interactive status label is needed

Do not use when:
- the element is clickable or toggleable
- the UI needs a pill-shaped button; use `UiButton`

Example:

```vue
<UiBadge tone="success">Indexed</UiBadge>
<UiBadge tone="warning">Out of sync</UiBadge>
```

## `UiPanel`

Purpose:
- Shared bordered surface for grouped content.

Props:
- `tone?: 'default' | 'subtle' | 'raised'`
- `className?: string`

Slots:
- default: panel content

Use when:
- multiple child elements need a shared surface and border

Notes:
- `default` is the standard panel surface
- `subtle` is visually quieter
- `raised` is for slightly more elevated cards and surfaces

Example:

```vue
<UiPanel tone="subtle" class-name="space-y-3">
  <h3 class="text-sm font-semibold">Workspace status</h3>
  <p class="text-sm">Semantic index is ready.</p>
</UiPanel>
```

## `UiSeparator`

Purpose:
- Thin semantic divider, usually inside menus or stacked blocks.

Props:
- none

Slots:
- none

Accessibility:
- renders `role="separator"`

Example:

```vue
<UiMenu>
  <UiMenuList>
    <button type="button" class="ui-menu-item">Open Settings</button>
  </UiMenuList>
  <UiSeparator />
  <UiMenuList>
    <button type="button" class="ui-menu-item">Close workspace</button>
  </UiMenuList>
</UiMenu>
```

## `UiField`

Purpose:
- Shared field wrapper that owns label, help text, error text, and `aria-describedby` relationships.

Props:
- `label?: string`
- `help?: string`
- `error?: string`
- `forId?: string`
- `className?: string`

Slots:
- default: receives slot props

Default slot props:
- `describedBy?: string`
- `invalid: boolean`

Use when:
- an input/select/textarea/checkbox needs label/help/error wiring

Notes:
- pass the returned `describedBy` into the child control's `aria-describedby`
- pass `invalid` into the child control when it supports invalid styling

Example:

```vue
<UiField
  for-id="api-key"
  label="API key"
  help="Leave empty to keep the stored key."
  :error="apiKeyError"
>
  <template #default="{ describedBy, invalid }">
    <UiInput
      id="api-key"
      v-model="apiKey"
      type="password"
      size="sm"
      :aria-describedby="describedBy"
      :invalid="invalid"
    />
  </template>
</UiField>
```

## `UiMenu`

Purpose:
- Outer menu surface with shared border, shadow, and background styling.

Props:
- `className?: string`

Slots:
- default: menu contents

Exposed API:
- `rootEl`
- `getRootEl(): HTMLElement | null`

Accessibility:
- renders `role="menu"`

Notes:
- this component only provides the menu container
- use `UiMenuList` to style menu items consistently inside it

Example:

```vue
<UiMenu class-name="absolute right-0 top-full mt-1 min-w-56">
  <UiMenuList>
    <button type="button" class="ui-menu-item">Open Settings</button>
    <button type="button" class="ui-menu-item">Keyboard shortcuts</button>
  </UiMenuList>
</UiMenu>
```

## `UiMenuList`

Purpose:
- Vertical menu item stack that applies shared `.ui-menu-item` styling via deep selectors.

Props:
- `className?: string`

Slots:
- default: menu items

Expected child contract:
- child action elements should use class `ui-menu-item`
- items may use `data-active="true"` for selected/highlighted state

Notes:
- disabled menu items should use native `disabled`
- this component does not manage focus or roving index behavior on its own

Example:

```vue
<UiMenuList>
  <button type="button" class="ui-menu-item" data-active="true">Light</button>
  <button type="button" class="ui-menu-item">Dark</button>
  <button type="button" class="ui-menu-item" disabled>System</button>
</UiMenuList>
```

## `UiModalShell`

Purpose:
- Shared modal structure with backdrop, dialog surface, title, description, body, optional header actions, and optional footer actions.

Props:
- `modelValue: boolean`
- `title: string`
- `description?: string`
- `labelledby?: string`
- `describedby?: string`
- `width?: 'sm' | 'md' | 'lg' | 'xl'`
- `panelClass?: string`

Slots:
- default: modal body content
- `header`: optional content rendered on the right side of the header
- `footer`: optional footer action row

Events:
- `update:modelValue`
- `close`

Behavior:
- clicking the backdrop closes the modal
- the shell now constrains panel height and makes the body scrollable when content overflows

Accessibility:
- renders `role="dialog"` and `aria-modal="true"`
- wires `aria-labelledby` and optional `aria-describedby`

Use when:
- a feature needs a standard app modal with shared chrome

Do not use when:
- the feature needs a radically custom fullscreen or non-modal surface

Example:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import UiButton from './UiButton.vue'
import UiModalShell from './UiModalShell.vue'

const open = ref(false)
</script>

<template>
  <UiButton variant="secondary" @click="open = true">Open modal</UiButton>

  <UiModalShell
    v-model="open"
    title="New note"
    description="Create a workspace-relative note."
    width="md"
  >
    <p>Modal body content goes here.</p>

    <template #footer>
      <UiButton variant="ghost" size="sm" @click="open = false">Cancel</UiButton>
      <UiButton variant="primary" size="sm">Create</UiButton>
    </template>
  </UiModalShell>
</template>
```

## `UiFilterableDropdown`

Purpose:
- Headless-ish shared dropdown shell with filtering, keyboard support, active-item state, optional grouping, and optional portal positioning.

Primary use cases:
- editor slash menus
- entity pickers
- searchable option lists
- shared menus that need richer keyboard behavior than `UiMenu`

Exported type:
- `FilterableDropdownItem`

Props:
- `items: FilterableDropdownItem[]`
- `modelValue: boolean`
- `query: string`
- `activeIndex: number`
- `filterPlaceholder?: string`
- `showFilter?: boolean`
- `disabled?: boolean`
- `maxHeight?: number | string`
- `closeOnOutside?: boolean`
- `closeOnSelect?: boolean`
- `autoFocusOnOpen?: boolean`
- `menuMode?: 'overlay' | 'inline' | 'portal'`
- `menuClass?: string`
- `matcher?: (item, query) => boolean`

Slots:
- trigger-related and row-related custom rendering are supported by the component's slot contract in code
- use this component when parent code needs to fully control the rows while reusing interaction logic

Events:
- `open-change`
- `query-change`
- `active-index-change`
- `select`

Notes:
- parent code controls open/query/active state; this keeps migration contracts stable
- portal mode computes menu position relative to the trigger/root
- outside-click handling can be disabled for parent-managed overlays

Example:

```vue
<UiFilterableDropdown
  :items="items"
  :model-value="open"
  :query="query"
  :active-index="activeIndex"
  @open-change="open = $event"
  @query-change="query = $event"
  @active-index-change="activeIndex = $event"
  @select="handleSelect"
/>
```

## `UiThemeSwitcher`

Purpose:
- Small presentational theme preference switcher for `light`, `dark`, and `system`.

Props:
- `modelValue: 'light' | 'dark' | 'system'`

Events:
- `update:modelValue`

Use when:
- a compact in-app theme switcher is needed

Notes:
- this component does not persist or resolve theme state on its own
- parent code remains responsible for applying and storing the chosen preference

Example:

```vue
<UiThemeSwitcher
  :model-value="themePreference"
  @update:model-value="setThemePreference"
/>
```

## Common Patterns

### Buttons in toolbars

- Use `UiIconButton`
- Pass an explicit accessible label
- Reuse app-shell classes such as `toolbar-icon-btn` only in shell code

### Form fields

- Wrap controls in `UiField`
- Forward `describedBy` and `invalid` slot props to the inner control
- Prefer `size="sm"` for dense modal/settings forms

Example:

```vue
<UiField for-id="model" label="Model">
  <template #default="{ describedBy, invalid }">
    <UiInput
      id="model"
      v-model="model"
      size="sm"
      :aria-describedby="describedBy"
      :invalid="invalid"
    />
  </template>
</UiField>
```

### Menus

- Use `UiMenu` for the outer surface
- Use `UiMenuList` for item stacks
- Add class `ui-menu-item` to actual action elements

Example:

```vue
<UiMenu class-name="absolute right-0 top-full mt-1 min-w-48">
  <UiMenuList>
    <button type="button" class="ui-menu-item" @click="openSettings">Open Settings</button>
    <button type="button" class="ui-menu-item" @click="openShortcuts">Shortcuts</button>
  </UiMenuList>
</UiMenu>
```

### Modals

- Use `UiModalShell` for standard dialogs
- Keep the footer for primary and dismissive actions
- Let the shell handle overflow rather than building ad hoc scroll wrappers unless a feature needs a custom internal scroll region

Example:

```vue
<UiModalShell
  v-model="settingsVisible"
  title="Settings"
  description="Adjust workspace preferences."
  width="lg"
>
  <UiField for-id="provider" label="Provider">
    <template #default>
      <UiSelect id="provider" v-model="provider" size="sm">
        <option value="openai">OpenAI</option>
      </UiSelect>
    </template>
  </UiField>

  <template #footer>
    <UiButton size="sm" variant="ghost" @click="settingsVisible = false">Cancel</UiButton>
    <UiButton size="sm" variant="primary">Save</UiButton>
  </template>
</UiModalShell>
```

## Token Dependencies

Most shared components in this folder depend on semantic CSS variables from `src/assets/tailwind.css`. The important families are:

- button tokens: `--button-*`
- input tokens: `--input-*`
- field tokens: `--field-*`
- panel tokens: `--panel-*`
- menu tokens: `--menu-*`
- modal tokens: `--modal-*`
- badge tokens: `--badge-*`

If a component seems visually wrong, fix the semantic token mapping before hard-coding component-local colors.

## Testing

Relevant tests in this folder:

- `UiButton.test.ts`
- `UiModalShell.test.ts`
- `UiFilterableDropdown.test.ts`
- `themeTokens.contract.test.ts`

When changing shared styling contracts, update or add tests at this layer before patching domain components.
