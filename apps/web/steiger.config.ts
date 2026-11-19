import fsd from '@feature-sliced/steiger-plugin';
import { defineConfig } from 'steiger';

// Feature-Sliced Design linter: enforces layer/slice boundaries (see docs/rewrite/CONVENTIONS.md).
export default defineConfig([
  ...fsd.configs.recommended,
  {
    // TanStack Router generated tree and route files live in the app layer.
    ignores: ['**/routeTree.gen.ts'],
  },
  {
    // Early stage: many slices are used once. Re-enable when pages are in place.
    rules: { 'fsd/insignificant-slice': 'off' },
  },
  {
    // One page slice per screen (route): 21 screens after call-analysis + overview (19.11.2026). Grouping screens
    // would only add folders; the limit stays on for widgets, features and entities.
    files: ['./src/pages/**'],
    rules: { 'fsd/excessive-slicing': 'off' },
  },
]);
