# EdgeAI Orchestrator

An AI agent pipeline for job hunting. From your CV profile it searches Indeed, ranks postings against your experience, tailors a CV for each top match (every claim checked against your original CV), and can save application drafts on Indeed for you to submit yourself. It runs with a local model (Ollama, LM Studio) or an API (OpenAI, OpenRouter, any OpenAI-compatible link).

<img width="5980" height="3122" alt="orch-agents" src="https://github.com/user-attachments/assets/078d7046-1e63-4621-b064-dbc779a6fbe3" />


<img width="3632" height="2950" alt="orch-sequence" src="https://github.com/user-attachments/assets/bc74a1a6-fe03-4038-b7fe-0f10f7b1844e" />

## Setup (Docker)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
git clone https://github.com/sed000/edgeai-orchestrator.git
cd edgeai-orchestrator
docker compose up -d
```

Open http://localhost:3000 and follow the **Get started** checklist: add a model, add your details, sign in to Indeed, then start a run on the Pipeline page. The browser the app uses for Indeed is visible at http://localhost:6080.

Optional: copy `.env.example` to `.env.local` to change defaults (model URLs, keys, search limits).

## Local development

```bash
cp .env.example .env.local
npm install
npx playwright install chromium
npm run latex:build
npm run db:up
npm run db:migrate
npm run dev:all
```
