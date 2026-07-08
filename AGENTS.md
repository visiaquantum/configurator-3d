# Repository Guidelines

## Project Structure & Module Organization

This is a React, TypeScript, and Vite package for a 3D configurator library. Public library exports start in `src/lib/index.ts`, with the main component in `src/lib/Configurator3D.tsx`. Scene rendering and interaction code lives in `src/lib/scene/`, state management in `src/lib/state/`, import/export and validation helpers in `src/lib/io/`, and small UI panels in `src/lib/ui/`. Demo app entry points are `src/main.tsx` and `src/App.tsx`. Static assets are in `src/assets/` and `public/`. Build output is generated in `dist/` and should not be edited directly.

## Build, Test, and Development Commands

- `npm run dev`: start the Vite dev server for local demo work.
- `npm run build:lib`: type-check and build the distributable library with declarations.
- `npm run build:demo`: type-check and build the demo app.
- `npm run lint`: run ESLint over the repository.
- `npm run preview`: preview the built demo locally.

There is currently no `npm test` script or committed test directory. Use `npm run lint` and the relevant build command as the minimum verification before submitting changes.

## Coding Style & Naming Conventions

Use TypeScript and React function components. Follow the existing style: two-space indentation, single quotes, no semicolons, named exports for library modules, and colocated type imports with `import type`. Name React components and type/interface exports in `PascalCase`; hooks, helpers, variables, and store actions use `camelCase`. Keep scene math and GLTF logic in `src/lib/scene/`; keep serialization, schema, catalog, and export concerns in `src/lib/io/`.

## Testing Guidelines

No test framework is configured yet. When adding tests, prefer colocating focused tests near the module or creating a top-level `tests/` directory, and use file names such as `serialize.test.ts` or `Configurator3D.test.tsx`. For rendering behavior, cover user-visible scene controls and exported project data rather than implementation details.

## Commit & Pull Request Guidelines

Recent commit history uses short, imperative subjects such as `update` and `add red error overlay`; keep subjects concise and action-oriented. Pull requests should include a clear summary, verification steps run (`npm run lint`, `npm run build:lib`, etc.), linked issues when applicable, and screenshots or screen recordings for UI or 3D scene changes. Note any catalog, schema, or exported-file compatibility impact.

## Security & Configuration Tips

This package publishes to the GitHub npm registry as restricted and is marked `UNLICENSED`. Do not commit secrets, private registry tokens, or generated credentials. Treat remote catalog URLs and GLB assets as untrusted input and keep validation paths in `src/lib/io/` explicit.
