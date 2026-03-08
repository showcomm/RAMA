# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Rama Rendezvous — a 3D spaceship tunnel navigation game. The player flies through a cylindrical alien structure, dodging obstacles, firing flares, and managing an empathy/rage mechanic. Built with React, Three.js, and Tailwind CSS. Targeting standalone desktop release via Tauri.

## Commands

- `npm run dev` — Start dev server on port 3000
- `npm run build` — Type-check + format + Vite build (has 20s timeout on checks)
- `npm test` — Run tests with Vitest
- `npm run check` — TypeScript type-check + Biome format
- `npm run format` — Biome format with `--write --unsafe`

## Architecture

### Game (`src/components/TunnelGame.tsx`)

Large single component (~800+ lines) containing the full Three.js game loop. Manages:
- Game state (score, shields, player age, rage level) via refs
- Obstacle types: cloud beings, corkscrew formations, rolling spheres
- Projectile/flare system with ignition mechanics
- Audio: background music tracks, proximity sounds, collision SFX, flyby audio
- High score persistence via ORM layer
- `requestAnimationFrame` render loop

### Data Layer (`src/components/data/`)

- **`orm/client.ts`** — `DataStoreClient` singleton that calls a REST API (`/data/store/v1/*`). Currently points to `api-production.creao.ai` — needs migration for Tauri standalone. Uses `FilterBuilder` and `SortBuilder` for queries.
- **`orm/orm_high_score.ts`** — Code-generated ORM for high score records. Has hardcoded entity IDs/versions — do not modify the generated metadata constants.
- **`orm/common.ts`** — Shared types/enums (DataType, Direction, SimpleSelector, Filter, Sort, Page).
- **`schema/`** and **`resource/`** — JSON schema definitions for data entities.

### Routing

TanStack Router with file-based route generation. `src/routeTree.gen.ts` is auto-generated — do not edit it.

### UI Components (`src/components/ui/`)

shadcn/ui (new-york style) with Radix UI primitives and Tailwind CSS v4.

### Missing Assets

These files are referenced in TunnelGame.tsx but do not exist yet (game uses fallback geometries):
- `src/assets/geometric_o.glb` — obstacle model
- `src/assets/torus_shap_1208213451_texture.glb` — corkscrew obstacle model
- `src/assets/orb_shaped_1208213459_texture.glb` — rolling sphere model
- `src/assets/documentary-background.mp3` — second background music track

## Key Conventions

- **Path alias**: `@/` maps to `./src/`
- **Formatting**: Biome with tabs, double quotes. `src/routeTree.gen.ts` is excluded from Biome.
- **TypeScript**: `strict: false` but `noImplicitAny` and `strictNullChecks` are enabled.
- **Bundler**: Vite via `rolldown-vite` override.
- **Testing**: Vitest with jsdom environment and `@testing-library/react`.
