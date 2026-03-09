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

Large single component (~1200+ lines) containing the full Three.js game loop. Manages:
- Game state (score, shields, player age, rage level) via refs
- Obstacle types: cloud beings, corkscrew formations, rolling spheres (1x–4x size variation)
- Projectile/flare system with ignition mechanics
- Audio: plain HTML5 Audio elements (no Web Audio API — it causes routing issues with `createMediaElementSource`)
- Dynamic ambient lighting cycling between intensity 0.04–0.12
- Rolling sphere collision with knockback spin toward tunnel center
- High score persistence via ORM layer
- `requestAnimationFrame` render loop
- Integrates BehaviorSystem for entity AI (see below)

### Entity Behavior System (`src/game/behavior/`)

Boids-like AI driving emergent entity behaviors. All entities (cloud beings, rolling spheres, corkscrews, motes) are registered with `BehaviorSystem` and updated each frame.

- **`types.ts`** — Core types: `EntityKind`, `PersonalityProfile` (curiosity/aggression/sociability/territoriality/fearfulness), `MoodState`, `BehaviorState`, `BehaviorContext`
- **`profiles.ts`** — Default personality per entity type + tuning constants (`MAX_ACCELERATION`, `VELOCITY_DAMPING`, `NEIGHBOR_RADIUS`)
- **`drives.ts`** — 9 steering drives: separation, alignment, cohesion, curiosityDrive, aggressionDrive, avoidanceDrive, fearDrive, territoryDrive, tunnelConstraint
- **`behaviorSystem.ts`** — Main class. Per-frame: rebuild spatial index → compute global mood → per-entity steering → apply velocity/position → update moods. Grouped corkscrew entities skip steering (formation managed by helix math in TunnelGame) but still participate in spatial index.
- **`spatialIndex.ts`** — Z-bucket spatial hash (bucket size = 5, matching tunnel segment length) for O(1) neighbor queries
- **`scratchVectors.ts`** — Pre-allocated vector pool (16 vectors) for zero-allocation drive calculations at 60fps

Key design: rage mechanic feeds into `BehaviorContext.rageNormalized`, which modulates curiosity (reduced) and aggression (amplified). Flare positions feed into fear drives. Each entity has per-instance personality variation (±10% from defaults).

### Playlist System

- **`src/stores/playlistStore.ts`** — Zustand store with persist middleware (localStorage, version 2). 4 bundled default tracks. Tracks have `enabled`, `order`, `bundled` fields. Merge function handles version migrations.
- **`src/lib/PlaylistManager.ts`** — Audio engine. Single HTMLAudioElement, sequential/shuffled playback, `ended` event advances tracks.
- **`src/components/PlaylistSettings.tsx`** — Sheet UI for playlist management (volume, shuffle, reorder, add custom tracks via file picker/drag-drop as base64 data URLs, 10MB limit).

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

## Key Conventions

- **Path alias**: `@/` maps to `./src/`
- **Formatting**: Biome with tabs, double quotes. `src/routeTree.gen.ts` is excluded from Biome.
- **TypeScript**: `strict: false` but `noImplicitAny` and `strictNullChecks` are enabled.
- **Bundler**: Vite via `rolldown-vite` override.
- **Testing**: Vitest with jsdom environment and `@testing-library/react`.
- **Audio**: Use plain HTML5 Audio elements only. Do NOT use Web Audio API's `createMediaElementSource()` — it hijacks audio routing. Vite `import x from "file.mp3"` resolves to a URL string.
- **Tunnel segments**: When recycling, find actual min-z segment by scanning all segments — do not assume array order matches z-order.
- **Case-sensitive filenames**: macOS is case-insensitive but Linux isn't. Match exact case in imports (e.g., `Bomb17.mp3` not `bomb17.mp3`).
