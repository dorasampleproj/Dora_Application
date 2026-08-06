'use strict';
const express  = require('express');
const Database = require('better-sqlite3');
const path     = require('path');

const app   = express();
const PORT  = process.env.PORT  || 3000;
const TOKEN = process.env.COLLECTOR_TOKEN || 'change-me';
const DB_PATH = process.env.DB_PATH || '/data/dora.db';

// ─── Database setup ──────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  -- Canonical list of features
  CREATE TABLE IF NOT EXISTS features (
    feature_id   TEXT PRIMARY KEY,
    label        TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- Canonical list of user stories, linked to a feature
  CREATE TABLE IF NOT EXISTS stories (
    story_id     TEXT PRIMARY KEY,
    feature_id   TEXT NOT NULL REFERENCES features(feature_id),
    label        TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  -- One row per build (feature + story combination)
  -- build_num is assigned by the collector (0-indexed, per feature+story)
  CREATE TABLE IF NOT EXISTS builds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id   TEXT NOT NULL,
    story_id     TEXT NOT NULL,
    build_num    INTEGER NOT NULL,
    repo         TEXT,
    sha          TEXT,
    first_commit_at TEXT NOT NULL,
    created_at   TEXT DEFAULT (datetime('now')),
    UNIQUE(feature_id, story_id, build_num)
  );

  -- One row per environment reached by a build.
  -- cumulative_seconds = sum of all stage durations from commit → this env.
  CREATE TABLE IF NOT EXISTS milestone_events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id          TEXT NOT NULL,
    story_id            TEXT NOT NULL,
    build_num           INTEGER NOT NULL,
    environment         TEXT NOT NULL,          -- DEV / SIT / UAT / MO / PROD
    deployed_at         TEXT NOT NULL,
    stage_seconds       INTEGER NOT NULL,       -- time spent IN the previous stage
    cumulative_seconds  INTEGER NOT NULL,       -- total from first commit to THIS env
    created_at          TEXT DEFAULT (datetime('now')),
    UNIQUE(feature_id, story_id, build_num, environment)
  );

  CREATE INDEX IF NOT EXISTS idx_ms_feat ON milestone_events(feature_id);
  CREATE INDEX IF NOT EXISTS idx_ms_story ON milestone_events(story_id);
  CREATE INDEX IF NOT EXISTS idx_build ON builds(feature_id, story_id);
`);

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  if ((req.headers['authorization'] || '') !== `Bearer ${TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ENV_ORDER = ['DEV', 'SIT', 'UAT', 'MO', 'PROD'];

function toTs(isoStr) {
  return Math.floor(new Date(isoStr).getTime() / 1000);
}

function upsertFeature(feature_id) {
  db.prepare(`INSERT OR IGNORE INTO features (feature_id, label) VALUES (?, ?)`)
    .run(feature_id, feature_id);
}

function upsertStory(story_id, feature_id) {
  db.prepare(`INSERT OR IGNORE INTO stories (story_id, feature_id, label) VALUES (?, ?, ?)`)
    .run(story_id, feature_id, story_id);
}

function resolveBuild(feature_id, story_id, build_number_hint, repo, sha, first_commit_at) {
  // If caller specified a build number (manual promotion) — find or fail
  if (build_number_hint && build_number_hint.trim() !== '') {
    const num = parseInt(build_number_hint.replace(/[^0-9]/g, ''), 10);
    const existing = db.prepare(
      `SELECT * FROM builds WHERE feature_id=? AND story_id=? AND build_num=?`
    ).get(feature_id, story_id, num);
    if (!existing) {
      throw new Error(
        `Build ${build_number_hint} not found for ${feature_id}/${story_id}. ` +
        `Did you forget to push a commit with this build first?`
      );
    }
    return existing;
  }

  // Auto-assign: increment the latest build_num for this feature+story
  // But first check: does the LATEST build already have a DEV event?
  // If not, reuse it (idempotent re-push). If yes, create a new build.
  const latest = db.prepare(
    `SELECT b.*, me.environment FROM builds b
     LEFT JOIN milestone_events me ON me.feature_id=b.feature_id
       AND me.story_id=b.story_id AND me.build_num=b.build_num AND me.environment='DEV'
     WHERE b.feature_id=? AND b.story_id=?
     ORDER BY b.build_num DESC LIMIT 1`
  ).get(feature_id, story_id);

  if (latest && !latest.environment) {
    // Latest build has no DEV event yet — reuse it
    return latest;
  }

  // Create a new build
  const nextNum = latest ? latest.build_num + 1 : 0;
  db.prepare(
    `INSERT INTO builds (feature_id, story_id, build_num, repo, sha, first_commit_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(feature_id, story_id, nextNum, repo || null, sha || null, first_commit_at);

  return db.prepare(
    `SELECT * FROM builds WHERE feature_id=? AND story_id=? AND build_num=?`
  ).get(feature_id, story_id, nextNum);
}

// ─── POST /api/event ─────────────────────────────────────────────────────────
// Called by the CI pipeline for every environment deployment.
app.post('/api/event', auth, (req, res) => {
  const {
    repo, feature_id, story_id, build_number,
    environment, sha, first_commit_at, deployed_at
  } = req.body;

  if (!feature_id || !story_id || !environment || !deployed_at) {
    return res.status(400).json({ error: 'Missing required fields: feature_id, story_id, environment, deployed_at' });
  }

  const env = environment.toUpperCase();
  if (!ENV_ORDER.includes(env)) {
    return res.status(400).json({ error: `Unknown environment "${env}". Must be one of: ${ENV_ORDER.join(', ')}` });
  }

  try {
    const insertAll = db.transaction(() => {
      upsertFeature(feature_id);
      upsertStory(story_id, feature_id);

      const build = resolveBuild(
        feature_id, story_id, build_number,
        repo, sha, first_commit_at || deployed_at
      );

      // Check for duplicate event
      const existing = db.prepare(
        `SELECT * FROM milestone_events WHERE feature_id=? AND story_id=? AND build_num=? AND environment=?`
      ).get(feature_id, story_id, build.build_num, env);
      if (existing) {
        return { build, milestone: existing, duplicate: true };
      }

      // Find the previous milestone for this build to compute stage duration
      const envIdx = ENV_ORDER.indexOf(env);
      let prevTimestamp = build.first_commit_at;
      let prevCumulative = 0;

      if (envIdx > 0) {
        // Look for the most recent preceding milestone in order
        for (let i = envIdx - 1; i >= 0; i--) {
          const prev = db.prepare(
            `SELECT * FROM milestone_events WHERE feature_id=? AND story_id=? AND build_num=? AND environment=?`
          ).get(feature_id, story_id, build.build_num, ENV_ORDER[i]);
          if (prev) {
            prevTimestamp = prev.deployed_at;
            prevCumulative = prev.cumulative_seconds;
            break;
          }
        }
      }

      const deployedTs = toTs(deployed_at);
      const prevTs     = toTs(prevTimestamp);
      const stageSecs  = Math.max(0, deployedTs - prevTs);
      const cumulSecs  = prevCumulative + stageSecs;

      const milestone = db.prepare(`
        INSERT INTO milestone_events
          (feature_id, story_id, build_num, environment, deployed_at, stage_seconds, cumulative_seconds)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(feature_id, story_id, build.build_num, env, deployed_at, stageSecs, cumulSecs);

      return { build, id: milestone.lastInsertRowid, duplicate: false };
    });

    const result = insertAll();

    res.json({
      ok: true,
      duplicate: result.duplicate,
      build_num: result.build.build_num,
      build_label: `build-${result.build.build_num}`,
      message: result.duplicate
        ? `Event already recorded for ${feature_id}/${story_id}/build-${result.build.build_num}/${env}`
        : `Recorded ${feature_id}/${story_id}/build-${result.build.build_num} → ${env}`
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message });
  }
});

// ─── GET /api/features ───────────────────────────────────────────────────────
// Returns the full nested view: features → stories → builds → milestones
app.get('/api/features', (req, res) => {
  const features = db.prepare(`SELECT * FROM features ORDER BY feature_id`).all();

  const result = features.map(feat => {
    const stories = db.prepare(
      `SELECT * FROM stories WHERE feature_id=? ORDER BY story_id`
    ).all(feat.feature_id);

    const storiesWithBuilds = stories.map(story => {
      const builds = db.prepare(
        `SELECT * FROM builds WHERE feature_id=? AND story_id=? ORDER BY build_num`
      ).all(feat.feature_id, story.story_id);

      const buildsWithMilestones = builds.map(build => {
        const milestones = db.prepare(
          `SELECT environment, deployed_at, stage_seconds, cumulative_seconds
           FROM milestone_events
           WHERE feature_id=? AND story_id=? AND build_num=?
           ORDER BY cumulative_seconds`
        ).all(feat.feature_id, story.story_id, build.build_num);

        // Build milestone map keyed by ENV for easy lookup
        const milestoneMap = {};
        milestones.forEach(m => { milestoneMap[m.environment] = m; });

        return {
          build_num:      build.build_num,
          build_label:    `build-${build.build_num}`,
          first_commit_at: build.first_commit_at,
          sha:            build.sha,
          milestones:     milestoneMap
        };
      });

      // Rollup: per story, latest cumulative for each env across all builds
      const storyRollup = {};
      ENV_ORDER.forEach(env => {
        const latest = db.prepare(
          `SELECT MAX(cumulative_seconds) as max_cum
           FROM milestone_events
           WHERE feature_id=? AND story_id=? AND environment=?`
        ).get(feat.feature_id, story.story_id, env);
        if (latest && latest.max_cum != null) storyRollup[env] = latest.max_cum;
      });

      return { ...story, builds: buildsWithMilestones, rollup: storyRollup };
    });

    // Rollup: per feature, max across all stories
    const featureRollup = {};
    ENV_ORDER.forEach(env => {
      const latest = db.prepare(
        `SELECT MAX(cumulative_seconds) as max_cum
         FROM milestone_events
         WHERE feature_id=? AND environment=?`
      ).get(feat.feature_id, env);
      if (latest && latest.max_cum != null) featureRollup[env] = latest.max_cum;
    });

    return { ...feat, stories: storiesWithBuilds, rollup: featureRollup };
  });

  res.json(result);
});

// ─── GET /api/summary ────────────────────────────────────────────────────────
app.get('/api/summary', (req, res) => {
  const total_builds = db.prepare(`SELECT COUNT(*) as n FROM builds`).get().n;
  const total_events = db.prepare(`SELECT COUNT(*) as n FROM milestone_events`).get().n;
  const reached_prod = db.prepare(
    `SELECT COUNT(DISTINCT feature_id || '|' || story_id || '|' || build_num) as n
     FROM milestone_events WHERE environment='PROD'`
  ).get().n;

  const avg = db.prepare(
    `SELECT ROUND(AVG(cumulative_seconds),0) as avg FROM milestone_events WHERE environment='PROD'`
  ).get();

  const avgHours = avg.avg ? avg.avg / 3600 : null;
  let doraRating = null;
  if (avgHours !== null) {
    if (avgHours < 1) doraRating = 'Elite';
    else if (avgHours < 24) doraRating = 'High';
    else if (avgHours < 168) doraRating = 'Medium';
    else doraRating = 'Low';
  }

  res.json({ total_builds, total_events, reached_prod, avg_prod_hours: avgHours ? +avgHours.toFixed(1) : null, dora_rating: doraRating });
});

app.listen(PORT, () => console.log(`DORA collector on :${PORT}`));
