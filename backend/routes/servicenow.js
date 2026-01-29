const express = require('express');
const router = express.Router();

// Mock ServiceNow-style metrics generator for DORA
// This route synthesizes data for the last N days and returns metrics in the
// same shape the frontend expects (series + summaries).

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function formatDateISODay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// Generate synthetic dataset for last `days` days
function generateMockData(days = 30) {
  const deployments = [];
  const changes = [];
  const incidents = [];

  const now = new Date();
  for (let i = 0; i < days; i++) {
    // day offset from oldest to newest
    const day = new Date(now);
    day.setDate(now.getDate() - (days - 1 - i));
    const dayIso = day.toISOString();

    // random number of deployments per day (0-2)
    const num = Math.random() < 0.4 ? 0 : Math.floor(Math.random() * 2) + 1;
    for (let j = 0; j < num; j++) {
      const t = new Date(day);
      t.setHours(1 + Math.floor(Math.random() * 20), Math.floor(Math.random() * 60));
      const success = Math.random() < 0.9; // 90% success
      const dep = {
        sys_id: `dep-${i}-${j}`,
        deploy_time: t.toISOString(),
        environment: 'prod',
        status: success ? 'success' : 'failure',
      };
      deployments.push(dep);

      // create a change request tied to this deployment (created some hours before)
      const created = new Date(t);
      created.setHours(created.getHours() - (6 + Math.floor(Math.random() * 72)));
      const implemented = success ? t.toISOString() : null;
      const change = {
        sys_id: `cr-${i}-${j}`,
        number: `CR${1000 + i * 10 + j}`,
        sys_created_on: created.toISOString(),
        implemented_on: implemented,
        result: success ? 'successful' : 'failed',
      };
      changes.push(change);

      // occasional incident related to a failed deployment
      if (!success && Math.random() < 0.7) {
        const op = new Date(t);
        op.setHours(op.getHours() + 1 + Math.floor(Math.random() * 6));
        const resolved = new Date(op);
        resolved.setHours(resolved.getHours() + (1 + Math.floor(Math.random() * 48)));
        incidents.push({
          sys_id: `inc-${i}-${j}`,
          opened_at: op.toISOString(),
          closed_at: resolved.toISOString(),
          severity: Math.random() < 0.5 ? 'high' : 'medium',
        });
      }
    }
  }

  // Add a couple of incidents not tied to deployments
  for (let k = 0; k < 3; k++) {
    const d = new Date(now);
    d.setDate(now.getDate() - Math.floor(Math.random() * days));
    const op = new Date(d);
    op.setHours(Math.floor(Math.random() * 24));
    const closed = new Date(op);
    closed.setHours(op.getHours() + 2 + Math.floor(Math.random() * 72));
    incidents.push({ sys_id: `inc-extra-${k}`, opened_at: op.toISOString(), closed_at: closed.toISOString(), severity: 'medium' });
  }

  return { deployments, changes, incidents };
}

// Build deployment series for the last `days` days
function buildDeploymentSeriesFromDeployments(deployments, days = 30) {
  const today = new Date();
  const counts = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    counts[d.toISOString().slice(0, 10)] = 0;
  }
  for (const d of deployments) {
    const day = formatDateISODay(d.deploy_time);
    if (counts[day] !== undefined) counts[day] += 1;
  }
  const series = Object.keys(counts).map((date) => ({ date, value: counts[date] }));
  const total = series.reduce((s, p) => s + p.value, 0);
  return { series, total };
}

function calculateLeadTimeHours(changes, deploymentsMap) {
  // For each change that has an implemented_on or that can be matched to a deployment
  const leadTimes = [];
  for (const c of changes) {
    const created = new Date(c.sys_created_on);
    let implemented = c.implemented_on ? new Date(c.implemented_on) : null;
    // try to match via deploymentsMap if no implemented_on
    if (!implemented && deploymentsMap && deploymentsMap[c.sys_id]) {
      implemented = new Date(deploymentsMap[c.sys_id]);
    }
    if (implemented && created) {
      const hours = (implemented - created) / (1000 * 60 * 60);
      if (hours >= 0) leadTimes.push(hours);
    }
  }
  if (leadTimes.length === 0) return 0;
  return leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length;
}

function calculateChangeFailureRatePercent(changes) {
  if (!changes || changes.length === 0) return 0;
  const failed = changes.filter((c) => c.result && c.result.toLowerCase().includes('fail')).length;
  return (failed / changes.length) * 100;
}

function calculateMTTRHours(incidents) {
  const durations = incidents
    .filter((inc) => inc.opened_at && inc.closed_at)
    .map((inc) => {
      const opened = new Date(inc.opened_at);
      const closed = new Date(inc.closed_at);
      return (closed - opened) / (1000 * 60 * 60);
    })
    .filter((h) => h >= 0);
  if (durations.length === 0) return 0;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
}

router.get('/metrics', async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    // Synthesize mock data
    const { deployments, changes, incidents } = generateMockData(days);

    // Build series and totals
    const { series: deployment_series, total: totalDeploys } = buildDeploymentSeriesFromDeployments(deployments, days);

    // create a simple map to attempt matching changes to deployments by sys_id
    const deploymentsMap = {};
    for (const d of deployments) {
      // we don't have change_sys_id in synthetic data; using sys_id mapping from generation
      deploymentsMap[`cr-${d.sys_id?.split('-')[1] || ''}`] = d.deploy_time;
    }

    const leadTime = calculateLeadTimeHours(changes, deploymentsMap);
    const changeFailureRate = calculateChangeFailureRatePercent(changes);
    const mttr = calculateMTTRHours(incidents);

    res.json({
      deployment_frequency: deployment_series,
      deployment_frequency_summary: { value: totalDeploys, count_last_30_days: totalDeploys, unit: 'total deployments' },
      lead_time: { value: Number(leadTime.toFixed(2)), unit: 'hours' },
      change_failure_rate: { value: Number(changeFailureRate.toFixed(2)), unit: 'percent' },
      mean_time_to_recovery: { value: Number(mttr.toFixed(2)), unit: 'hours' },
    });
  } catch (err) {
    console.error('servicenow metrics error', err);
    res.status(500).json({ error: err.message });
  }
});

// Details endpoint for More Details view - return the synthesized arrays
router.get('/details', async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    const { deployments, changes, incidents } = generateMockData(days);
    res.json({ deployments, changes, incidents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
