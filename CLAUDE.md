# CLAUDE.md

Project guidance for AI coding agents working in this repository.

## Project Goal

Build a movie search and recommendation backend using hybrid retrieval (semantic vector + keyword search) and RAG-style answers.

Current stack:
- Backend: NestJS + TypeScript (`apps/backend`)
- Database: PostgreSQL + `pgvector` + full-text search
- ORM/DB access: Prisma + raw SQL where needed
- Embeddings/LLM: Hugging Face Inference API and local Ollama endpoint

## Repository Structure

- `apps/backend`: Main NestJS API service
  - `src/ai`: Embedding and LLM integration (`AiService`)
  - `src/movie`: Movie create/search/RAG endpoints and ranking logic
  - `prisma`: Prisma schema, migrations, and DB service
- `apps/frontend`: Simple React + Vite UI for search and RAG endpoints
- `infra/postgres`: Local infra files for PostgreSQL
- `docker-compose.yml`: Service orchestration
- `dataset.json`: Seed/source movie dataset

## Core API Behavior

- `POST /movies`
  - Stores movie metadata.
  - Builds a rich text representation and generates embedding.
  - Inserts metadata + vector embedding into Postgres.
- `GET /movies/search?q=...`
  - Runs keyword search (full-text ranking).
  - Runs vector similarity search.
  - Applies weighted ranking blend:
    - semantic similarity
    - BM25-style keyword score
    - rating boost
    - theme overlap
    - genre match
- `GET /movies/rag?q=...`
  - Retrieves top candidates from hybrid search.
  - Builds movie context.
  - Sends structured prompt to LLM.
  - Returns JSON recommendations + summary.

## Local Development Commands

Run from `apps/backend` unless noted otherwise.

- Install deps: `npm install`
- Dev server: `npm run start:dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Unit tests: `npm run test`
- E2E tests: `npm run test:e2e`

From repo root:
- Start infra/services: `docker-compose up -d`

## Environment Notes

Expected secrets/config (backend `.env`):
- `HUGGING_FACE_API_TOKEN`
- Database connection settings used by Prisma/Postgres

Rules:
- Never commit secrets.
- Never print tokens in logs.
- Mask/remove sensitive values in any debug output.

## Coding Rules for Agents

- Keep changes scoped and minimal; avoid broad refactors unless requested.
- Preserve current architecture (Nest modules/services/controllers).
- Prefer typed DTOs/interfaces over `any` for new code.
- Reuse `AiService` for model calls instead of ad-hoc fetch usage in controllers.
- Keep DB writes/queries in service layer, not controllers.
- For search tuning, preserve current weighted ranking shape unless explicitly asked to redesign.
- Add or update tests when behavior changes.
- Run lint/tests for touched areas when possible before finishing.
- Keep existing `console.log` debug statements unless explicitly asked to remove them.
- If adding logs, avoid printing secrets (API keys, tokens, connection strings, raw credentials).
- Preserve request correlation logging (`x-request-id`) for incoming HTTP requests.
- Keep rate limiting enabled for AI-heavy endpoints (especially `/movies/rag`).

## Data and Retrieval Conventions

- Movie embedding text should include title, plot, genre, themes, mood, year, and rating.
- For retrieval:
  - Pull a wider candidate pool from vector search.
  - Blend with keyword relevance.
  - Sort by final score and return top results.
  - Cache repeated search and RAG queries in Redis with short TTLs for latency/cost control.
- Cache embeddings in Redis (keyed by normalized text hash) to avoid repeated inference calls.
- For RAG:
  - Use only retrieved movie context.
  - Do not fabricate movie facts.
  - Return structured JSON output.
  - Reject or neutralize prompt-injection style queries (for example: "ignore previous instructions", "reveal system prompt", "bypass safety").
  - Enforce query length limits and normalize control characters before LLM calls.

## Current Stage

This repo is early-stage backend-focused setup for a movie RAG project.
When adding new features, prioritize:
1. stability of retrieval quality,
2. predictable API responses,
3. simple, debuggable service logic.
