# DORA Lead Time — Feature / Story / Build Tracker

Tracks **lead time for changes** at the level of Features → User Stories → Builds,
with cumulative time measured at each environment milestone (DEV → SIT → UAT → MO → PROD).

---

## How it works

### 1. Developer commits with tags

Every commit that should be tracked must include `[FEAT-x][US-y]` in the commit message:

```
[FEAT-12][US-47] implement login rate limiting
[FEAT-12][US-47] fix edge case in token refresh
[FEAT-8][US-21] add export to CSV
```

Tags are case-insensitive. `FEAT-` and `US-` can contain any alphanumeric characters after the prefix (e.g. `FEAT-PAYMENT-001`, `US-JIRA-4892`).

### 2. Pipeline fires automatically on push → DEV

The GitHub Actions workflow parses the latest commit message, extracts the feature/story IDs, and reports a DEV deployment event to the collector. The collector:
- Creates the feature and story records if they don't exist
- Assigns the next `build-N` number (starting at `build-0`)
- Records the time from first commit on the branch → DEV as **T1**

### 3. Manual promotion to SIT / UAT / MO / PROD

Trigger the `DORA Lead Time Tracker` workflow manually from **Actions → Run workflow**, providing:
- **Environment**: SIT, UAT, MO, or PROD
- **Build number**: e.g. `build-3`
- **Feature ID**: e.g. `FEAT-12`
- **User story ID**: e.g. `US-47`

The collector computes the stage duration (time since the previous milestone) and adds it to the running cumulative total.

### 4. Cumulative lead time calculation

| Milestone | Cumulative time |
|-----------|----------------|
| DEV       | T1 (first commit → DEV deploy) |
| SIT       | T1 + T2 (DEV → SIT duration) |
| UAT       | T1 + T2 + T3 |
| MO        | T1 + T2 + T3 + T4 |
| PROD      | T1 + T2 + T3 + T4 + T5 |

---

## Setup

### Step 1 — Run the collector

```bash
git clone <this-repo>
cd dora-lead-time

# Set your secret token
echo "COLLECTOR_TOKEN=your-strong-secret-here" > .env

docker compose up -d
```

Dashboard → `http://your-server:3000`

### Step 2 — Add GitHub secrets to each tracked repo

Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `DORA_COLLECTOR_URL` | `http://your-server:3000` |
| `DORA_COLLECTOR_TOKEN` | same token as above |

### Step 3 — Copy the workflow

Copy `.github/workflows/dora-track.yml` into each repo you want to track.

---

## API reference

All write endpoints require `Authorization: Bearer <token>`.

### `POST /api/event` — record a deployment

```json
{
  "repo":            "org/repo",
  "feature_id":     "FEAT-12",
  "story_id":       "US-47",
  "build_number":   "build-3",   // omit on first push; collector assigns it
  "environment":    "SIT",
  "sha":            "abc1234",
  "first_commit_at": "2024-01-15T09:00:00Z",  // only needed on first DEV push
  "deployed_at":    "2024-01-15T11:30:00Z"
}
```

### `GET /api/features` — full nested view

Returns: `features[] → stories[] → builds[] → milestones{env: {cumulative_seconds, ...}}`

### `GET /api/summary` — DORA summary stats

Returns: `{ total_builds, reached_prod, avg_prod_hours, dora_rating }`

---

## Porting to other CI platforms

The workflow is just a shell script + `curl`. On any other platform:

```bash
# Parse your commit message the same way
FEAT=$(echo "$COMMIT_MSG" | grep -oP '(?<=\[)FEAT-[^\]]+(?=\])')
STORY=$(echo "$COMMIT_MSG" | grep -oP '(?<=\[)US-[^\]]+(?=\])')

# POST to collector
curl -X POST "$DORA_COLLECTOR_URL/api/event" \
  -H "Authorization: Bearer $DORA_COLLECTOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"feature_id\":\"$FEAT\",\"story_id\":\"$STORY\",\"environment\":\"DEV\",\"deployed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}"
```

---

## DORA ratings (commit → PROD)

| Rating | Avg lead time to PROD |
|--------|-----------------------|
| Elite  | < 1 hour              |
| High   | 1 hour – 1 day        |
| Medium | 1 day – 1 week        |
| Low    | > 1 week              |
