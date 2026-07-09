# Repository Guidelines

## Project Structure & Module Organization

This repository is a RIS/RIS-PACS web app for scheduling, worklists, DICOM viewing, and radiology reports. It uses Next.js and TypeScript.

- `src/app/`: Next.js routes and API handlers.
- `src/components/`: shared UI and access guards.
- `src/features/`: domain modules for appointments, scheduling, clinical coding, reports, patients, tenants, and users.
- `src/lib/`: shared helpers for Supabase, Orthanc, tenant resolution, and safe text handling.
- `supabase/migrations/`: versioned database schema changes; there is no separate ORM layer.
- `orthanc/` and `docker-compose.yml`: local Orthanc/OHIF DICOM services.
- `docs/`: architecture notes.

Before implementing, review the current structure, framework, routes, data models, migrations, and Supabase patterns. If context is missing, propose a short plan and ask before touching critical files.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run dev`: start the local Next.js app.
- `npm run build`: build the production app.
- `npm run start`: run the built app.
- `npm run lint`: run TypeScript checking with `tsc --noEmit`.
- `npm test`: run the listed Node tests.
- `npm run dicom:start` / `npm run dicom:stop`: start or stop Orthanc/OHIF with Docker.

## Coding Style & Naming Conventions

Use strict TypeScript, ESM imports, and the existing `@/*` alias. Keep feature logic inside its domain folder and shared logic in `src/lib/`. Match current naming: React components use `PascalCase.tsx`, helpers use `kebab-case.ts`, and tests use `*.test.ts`. Prefer small pure functions for clinical and scheduling logic.

## Testing Guidelines

Tests use Node's built-in runner with `node:assert/strict`. Add focused `*.test.ts` files beside code when changing non-trivial validation, scheduling, tenant, PACS, report, or clinical coding behavior. Run `npm test` and `npm run lint` before submitting.

## Clinical, Security & AI Rules

Do not modify existing clinical logic without reviewing downstream impact. Never expose API keys in frontend code; OpenAI calls must run only from backend routes or server-side code. AI extraction of findings must be suggested, not definitive, and must allow user confirmation, editing, or rejection. AI must never modify the original report text. Do not make SNOMED CT, CIE-11, LOINC, or RadLex coding mandatory.

## Commit & Pull Request Guidelines

Recent commits use concise Spanish summaries, for example `Fix clinical coding linkage in scheduling`. Keep commits focused and mention the affected clinical, scheduling, or PACS area. PRs should include a short description, verification commands, linked issue if available, and screenshots for UI changes.
