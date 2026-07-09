# OpenAI Environment Deployment

## Local

Create `.env.local` in the repository root. Copy the OpenAI and AI variables from `.env.example`, paste the real `OPENAI_API_KEY` only in `.env.local`, set `AI_EXTRACTION_ENABLED=true`, and restart `npm run dev`.

Confirm `.env.local` stays ignored by Git:

```bash
git check-ignore .env.local
```

## Render

Open Render Dashboard, select the web service, go to Environment, and add `OPENAI_API_KEY` plus the `AI_*` variables. Keep secrets out of Git and redeploy after changes.

## Oracle VM / Docker

Create a `.env` file directly on the VM. Copy variables from `.env.example`, add the real `OPENAI_API_KEY` only on the VM, and restart containers. This repo's `docker-compose.yml` currently runs Orthanc only; if a Next.js service is added later, pass the OpenAI variables through `environment` using `${OPENAI_API_KEY}` and safe defaults for `AI_*`.

## Security

Do not create a public browser variable for the OpenAI key. Do not commit `.env` or `.env.local`. Do not log `process.env.OPENAI_API_KEY`. Do not return keys from endpoints. If a key is ever committed or exposed, rotate it immediately.
