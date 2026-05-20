# TokenPilot ServBay + frp Example

## Goal

Expose the TokenPilot control plane as a stable HTTPS endpoint so a ChatGPT Custom GPT Action can create jobs and poll job status, while local execution still happens through the local runner.

## Scope Boundary

This document describes the next deployment stage, not a completed production capability.

Already completed in the public repo:

- local-first CLI / server / runner scaffold
- exposed-mode auth groundwork
- local E2E verification

Still not completed here:

- long-running HTTPS stability proof
- real Custom GPT Actions end-to-end validation
- GPT-side artifact/result consumption loop

Full HTTPS / Custom GPT Actions automation loop is still under validation.

## Public URL Pattern

- `https://tokenpilot.example.com`

Public repo documentation should use a placeholder deployment domain. Real deployment domains, frp tokens, and host-specific notes belong in private ops records.

## Local Components

- TokenPilot server
- TokenPilot runner
- ServBay reverse proxy / site binding
- ServBay built-in frp client
- Existing frps server

## Suggested Local Runtime Layout

```text
127.0.0.1:4318 -> TokenPilot local control plane
ServBay site / reverse proxy -> forwards HTTPS traffic to 127.0.0.1:4318
frp -> exposes the ServBay endpoint to the public internet
```

## Step Order

### 1. Keep the local control plane stable

Run locally first:

```bash
npm run server
npm run runner -- --watch --interval 3
```

Verify:

```bash
curl http://127.0.0.1:4318/api/health
```

### 2. Add a ServBay reverse proxy target

Target:

```text
tokenpilot.example.com -> http://127.0.0.1:4318
```

Requirements:

- valid certificate
- no overlap with the main WordPress app routing
- path passthrough for `/api/*` and `/openapi.yaml`

Repo-native guardrails now exist for this layer:

```bash
npm run doctor:ingress
```

This reports whether the current live ServBay vhost has drifted away from the
TokenPilot control-plane routing invariants.

For local installation/sync of the expected TokenPilot-focused vhost shape:

```bash
npm run ingress:install
```

This script:

- backs up the current `tokenpilot.example.com.conf`
- renders the repo template under `ops/servbay/`
- writes a proxy-first vhost that routes `/api/*`, `/openapi.yaml`, `/ui`, `/favicon.ico`, and `/`
  to `127.0.0.1:4318`
- reloads nginx through `servbayctl`
- probes read paths and a minimal `createPack` write path before returning success

For a fresh public loop regression after ingress changes:

```bash
npm run verify:public-gpt-loop
```

This performs a minimal HTTPS GPT-facing regression:

- `GET /api/health`
- `POST /api/jobs/pack`
- `POST /api/jobs/taskpack`
- poll both jobs until `completed` or `failed`

### 3. Publish through built-in frp

Use your own frps server and token from private/local ops config.

Expected result:

```text
https://tokenpilot.example.com/api/health
https://tokenpilot.example.com/openapi.yaml
```

### 4. Attach the Custom GPT Action

Use the public OpenAPI document:

```text
https://tokenpilot.example.com/openapi.yaml
```

First actions to expose:

- `createPack`
- `createTaskPack`
- `getJob`
- `listJobs`
- `health`

### 5. Keep execution async

The GPT should:

1. create a job
2. receive `job.id`
3. poll `GET /api/jobs/{id}`
4. wait for `completed`
5. consume the returned artifacts

## Security Baseline

- require a bearer token between GPT Actions and TokenPilot
- reject anonymous public traffic
- do not expose arbitrary shell execution endpoints
- keep the local runner as the only process that executes local jobs

## Minimal MVP Acceptance

- [ ] `https://tokenpilot.example.com/api/health` works
- [ ] `https://tokenpilot.example.com/openapi.yaml` works
- [ ] a pack job can be created from the public API
- [ ] the local runner can pick up and complete that job
- [ ] the GPT can poll the completed result
