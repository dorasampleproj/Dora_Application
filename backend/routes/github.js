const express = require("express");
const axios = require("axios");
const router = express.Router();
const dotenv = require('dotenv');

dotenv.config();

// In-memory store for configured data-sources (simple persistence for this demo)
const configuredDataSources = [];
// GitHub API configuration
const GITHUB_API = "https://api.github.com";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = "dorasampleproj";
const REPO = "DORA_Application";

const githubConfig = {
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
  },
};

// Helper function to calculate deployment frequency
async function calculateDeploymentFrequency(workflowRuns) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 90);

  console.log("backend Workflow Runs:", workflowRuns);
  const successfulDeployments = workflowRuns.filter(
    (run) =>
      run.conclusion === "success" && new Date(run.created_at) > thirtyDaysAgo
  );
  console.log(
    "Successful Deployments in last 90 days:",
    successfulDeployments.length
  );
  return successfulDeployments.length / 90; // deployments per day
}

// Build a time series of deployments per day for the last `days` days

// function buildDeploymentSeries(
//   workflowRuns,
//   days = 30,
//   options = { includeZeros: false }
// ) {
//   const today = new Date();

//   // Build counts per day (YYYY-MM-DD)
//   const countsByDate = {};
//   if (Array.isArray(workflowRuns)) {
//     for (const run of workflowRuns) {
//       if (!run || run.conclusion !== "success" || !run.created_at) continue;
//       const day = new Date(run.created_at).toISOString().slice(0, 10);
//       countsByDate[day] = (countsByDate[day] || 0) + 1;
//     }
//   }

//   // Raw counts series (oldest -> newest)
//   const rawSeries = new Array(days);
//   for (let i = 0; i < days; i++) {
//     const d = new Date(today);
//     d.setDate(today.getDate() - (days - 1 - i));
//     const key = d.toISOString().slice(0, 10);
//     rawSeries[i] = { date: key, count: countsByDate[key] || 0 };
//   }

//   const totalDeploys = rawSeries.reduce((s, p) => s + (p.count || 0), 0);

//   // Produce a per-day series for the full window. If a day has no deployments,
//   const rawSeriesFiltered = rawSeries.map((p) => ({
//     date: p.date,
//     value: p.count || 0,
//   }));

//   return { rawSeries, rawSeriesFiltered, totalDeploys };
// }
function buildDeploymentSeries(
  workflowRuns,
  days = 90,
  options = { includeZeros: false },
  conclusionType = "success" // <-- new parameter
) {
  const today = new Date();

  // Build counts per day (YYYY-MM-DD)
  const countsByDate = {};
  if (Array.isArray(workflowRuns)) {
    for (const run of workflowRuns) {
      if (!run || run.conclusion !== conclusionType || !run.created_at) continue;
      const day = new Date(run.created_at).toISOString().slice(0, 10);
      countsByDate[day] = (countsByDate[day] || 0) + 1;
    }
  }

  // Raw counts series (oldest -> newest)
  const rawSeries = new Array(days);
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    const key = d.toISOString().slice(0, 10);
    rawSeries[i] = { date: key, count: countsByDate[key] || 0 };
  }

  const totalDeploys = rawSeries.reduce((s, p) => s + (p.count || 0), 0);

  // Produce a per-day series for the full window
  const rawSeriesFiltered = rawSeries.map((p) => ({
    date: p.date,
    value: p.count || 0,
  }));

  return { rawSeries, rawSeriesFiltered, totalDeploys };
}


// Helper function to calculate lead time
async function calculateLeadTime(pulls) {
  if (pulls.length === 0) return 0;

  const leadTimes = pulls.map((pr) => {
    const createdAt = new Date(pr.created_at);
    const mergedAt = pr.merged_at ? new Date(pr.merged_at) : null;
    if (!mergedAt) return 0;

    return (mergedAt - createdAt) / (1000 * 60 * 60); // hours
  });

  return leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length;
}

// Helper function to calculate lead time per day (with average and median)
async function calculateLeadTimePerDay(pulls) {
  if (!Array.isArray(pulls) || pulls.length === 0) return [];

  const leadTimesByDate = {};

  pulls.forEach((pr) => {
    if (pr.merged_at && pr.created_at) {
      const createdDate = new Date(pr.created_at);
      const mergedDate = new Date(pr.merged_at);
      const leadHours = (mergedDate - createdDate) / (1000 * 60 * 60);
      const dateKey = createdDate.toISOString().split('T')[0];

      if (!leadTimesByDate[dateKey]) {
        leadTimesByDate[dateKey] = [];
      }
      leadTimesByDate[dateKey].push(leadHours);
    }
  });

  const leadTimeData = Object.entries(leadTimesByDate)
    .map(([date, times]) => {
      const sorted = [...times].sort((a, b) => a - b);
      const average = times.reduce((a, b) => a + b, 0) / times.length;
      const median =
        sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];

      return {
        date,
        average: Number(average.toFixed(2)),
        median: Number(median.toFixed(2)),
      };
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  return leadTimeData;
}

// Helper function to calculate change failure rate
async function calculateChangeFailureRateSummary(workflowRuns) {
  if (workflowRuns.length === 0) return 0;

  const failedRuns = workflowRuns.filter((run) => run.conclusion === "failure");
  return (failedRuns.length / workflowRuns.length) * 100;
}

// Helper function to calculate change failure rate breakdown (for pie chart)
async function calculateChangeFailureRateBreakdown(workflowRuns) {
  if (workflowRuns.length === 0) {
    return {
      successful: 0,
      failed: 0,
      total: 0,
      breakdownData: [
        { name: "Successful", value: 0, percentage: 0, fill: "#10b981" },
        { name: "Failed", value: 0, percentage: 0, fill: "#ef4444" },
      ],
    };
  }

  const failedRuns = workflowRuns.filter((run) => run.conclusion === "failure");
  const successfulRuns = workflowRuns.filter((run) => run.conclusion === "success");
  const total = workflowRuns.length;
  const failedCount = failedRuns.length;
  const successfulCount = successfulRuns.length;
  const failurePercentage = (failedCount / total) * 100;
  const successPercentage = (successfulCount / total) * 100;

  return {
    successful: successfulCount,
    failed: failedCount,
    total: total,
    breakdownData: [
      { name: "Successful", value: successfulCount, percentage: Number(successPercentage.toFixed(2)), fill: "#10b981" },
      { name: "Failed", value: failedCount, percentage: Number(failurePercentage.toFixed(2)), fill: "#ef4444" },
    ],
  };
}

async function calculateChangeFailureRate(workflowRuns) {
  if (workflowRuns.length === 0) return 0;

  const failedRuns = workflowRuns.filter((run) => run.conclusion === "failure");
  return failedRuns;
}

// Helper function to calculate MTTR
async function calculateMTTR(issues) {
  const resolvedIssues = issues.filter(
    (issue) =>
      issue.labels.some((label) =>
        label.name.toLowerCase().includes("incident")
      ) && issue.state === "closed"
  );

  if (resolvedIssues.length === 0) return 0;

  const recoveryTimes = resolvedIssues.map((issue) => {
    const createdAt = new Date(issue.created_at);
    const closedAt = new Date(issue.closed_at);
    return (closedAt - createdAt) / (1000 * 60 * 60); // hours
  });

  return recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length;
}

// Get all data sources
router.get("/", async (req, res) => {
  try {
    res.json(configuredDataSources);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test connection
router.get("/:id/test", async (req, res) => {
  try {
    const response = await axios.get(
      `${GITHUB_API}/repos/${OWNER}/${REPO}`,
      githubConfig
    );
    res.json({ success: true, data: response.data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new data source
router.post("/", async (req, res) => {
  try {
    const { name, type, config } = req.body;

    // If it's a GitHub datasource, verify access (best effort)
    if (type === 'github' && config && config.org && config.repo) {
      await axios.get(
        `${GITHUB_API}/repos/${config.org}/${config.repo}`,
        githubConfig
      );
    }

    const created = {
      id: Date.now(),
      name,
      type,
      config,
    };

    configuredDataSources.push(created);

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get DORA metrics
router.get("/metrics", async (req, res) => {
  try {
    // Helper: fetch deployments for the last `days` days (stop paging once pages are older)
    const fetchDeploymentsLastNDays = async (owner, repo, days = 90) => {
      const perPage = 100;
      let page = 1;
      let results = [];
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      while (true) {
        const url = `${GITHUB_API}/repos/${owner}/${repo}/deployments?per_page=${perPage}&page=${page}`;
        const resp = await axios.get(url, githubConfig);
        const items = resp.data || [];
        if (!items || items.length === 0) break;

        // Keep only deployments within the cutoff window
        const recent = items.filter((d) => {
          const created = new Date(
            d.created_at || d.created || d.timestamp || null
          );
          return created && created >= cutoff;
        });
        results = results.concat(recent);

        // If the oldest item on this page is older than cutoff, we can stop paging
        const oldest = items[items.length - 1];
        const oldestDate = oldest
          ? new Date(
              oldest.created_at || oldest.created || oldest.timestamp || null
            )
          : null;
        if (!oldestDate || oldestDate < cutoff) break;

        page++;
      }
      return results;
    };

    // Helper: fetch workflow runs for the last `days` days (stop paging once pages are older)
    const fetchWorkflowRunsLastNDays = async (owner, repo, days = 90) => {
      const perPage = 100;
      let page = 1;
      let results = [];
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      while (true) {
        const url = `${GITHUB_API}/repos/${owner}/${repo}/actions/runs?per_page=${perPage}&page=${page}`;
        const resp = await axios.get(url, githubConfig);
        const runs = resp.data?.workflow_runs || [];
        if (!runs || runs.length === 0) break;

        const recent = runs.filter((r) => {
          const created = new Date(r.created_at || null);
          return created && created >= cutoff;
        });
        results = results.concat(recent);

        const oldest = runs[runs.length - 1];
        const oldestDate = oldest ? new Date(oldest.created_at || null) : null;
        if (!oldestDate || oldestDate < cutoff) break;

        page++;
      }
      return results;
    };

    // Always fetch workflow runs and treat successful runs as deployments
    const workflowRuns = await fetchWorkflowRunsLastNDays(OWNER, REPO, 90);
    // console.log("metrics backend",workflowsResponse.data.workflow_runs);
    // Fetch pull requests
    const prsResponse = await axios.get(
      `${GITHUB_API}/repos/${OWNER}/${REPO}/pulls?state=all&per_page=100`,
      githubConfig
    );

    // Fetch issues for MTTR
    const issuesResponse = await axios.get(
      `${GITHUB_API}/repos/${OWNER}/${REPO}/issues?state=all&per_page=100`,
      githubConfig
    );

    // Return number of deployments per day for the last 90 days (include zeros)
    const daysWindow = 90;
    const smoothingDays = Number(req.query.smooth) || 7;
    // Build deployment data and keep raw counts for the full window using workflow runs
    const deploymentResult = buildDeploymentSeries(workflowRuns, 90, {}, "success");

    // Use the filtered raw series provided by buildDeploymentSeries (only days with deployments)
    const deploymentSeriesToClient = deploymentResult.rawSeriesFiltered; // array of {date, value}

    // Summary: average deploys per day across the full window (preserves meaning as deploys/day)
    const totalDeploys = deploymentResult.totalDeploys;
    const deploymentFrequency = totalDeploys / daysWindow; // average deploys per day
    const leadTime = await calculateLeadTime(prsResponse.data);
    const leadTimePerDay = await calculateLeadTimePerDay(prsResponse.data);
    // Use workflowRuns if available; otherwise use syntheticRuns (which are successful deployments)
    const runsForFailure = await calculateChangeFailureRate(workflowRuns);
    const changeFailureRate = buildDeploymentSeries(workflowRuns, 90, {}, "failure");
    const changeFailureRateToClient = changeFailureRate.rawSeriesFiltered;
    console.log("changeFailureRate:", changeFailureRateToClient);
    const changeFailureRateSummary = await calculateChangeFailureRateSummary(workflowRuns);
    const changeFailureRateBreakdown = await calculateChangeFailureRateBreakdown(workflowRuns);
    const mttr = await calculateMTTR(issuesResponse.data);
    res.json({
      // time series for charting: raw integer counts per day (date, value)
      deployment_frequency: deploymentSeriesToClient,
      // optional smoothed series intentionally removed
      // keep a summary value for the dashboard cards
      deployment_frequency_summary: {
        value: deploymentFrequency,
        unit: "deployments per day",
      },
      lead_time: leadTimePerDay,
      lead_time_summary: {
        value: leadTime,
        unit: "hours",
      },
      change_failure_rate: changeFailureRateToClient,
      change_failure_rate_summary: {
        value: changeFailureRateSummary,
        unit: "percent",
      },
      change_failure_rate_breakdown: changeFailureRateBreakdown,
      mean_time_to_recovery: {
        value: mttr,
        unit: "hours",
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Provide detailed items for the UI 'More Details' view
router.get('/details', async (req, res) => {
  try {
    // Helper to fetch workflow runs with detailed info
    const fetchWorkflowRunsLastNDays = async (owner, repo, days = 90) => {
      const perPage = 100;
      let page = 1;
      let results = [];
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      while (true) {
        const url = `${GITHUB_API}/repos/${owner}/${repo}/actions/runs?per_page=${perPage}&page=${page}`;
        const resp = await axios.get(url, githubConfig);
        const runs = resp.data?.workflow_runs || [];
        if (!runs || runs.length === 0) break;

        const recent = runs.filter((r) => {
          const created = new Date(r.created_at || null);
          return created && created >= cutoff;
        });
        results = results.concat(recent);

        const oldest = runs[runs.length - 1];
        const oldestDate = oldest ? new Date(oldest.created_at || null) : null;
        if (!oldestDate || oldestDate < cutoff) break;

        page++;
      }
      return results;
    };

    // Fetch workflow runs (deployments)
    const workflowRuns = await fetchWorkflowRunsLastNDays(OWNER, REPO, 90);
    
    // Fetch PRs and commits
    const prsResponse = await axios.get(
      `${GITHUB_API}/repos/${OWNER}/${REPO}/pulls?state=all&per_page=100`,
      githubConfig
    );
    
    // Fetch commits
    const commitsResponse = await axios.get(
      `${GITHUB_API}/repos/${OWNER}/${REPO}/commits?per_page=100`,
      githubConfig
    );
    
    // Fetch issues for MTTR
    const issuesResponse = await axios.get(
      `${GITHUB_API}/repos/${OWNER}/${REPO}/issues?state=all&per_page=100`,
      githubConfig
    );

    // Enhance deployment data with detailed information
    const enhancedDeployments = workflowRuns.map((run, idx) => {
      // Find related commits from this workflow run
      const relatedCommits = commitsResponse.data?.filter((commit) => {
        const commitDate = new Date(commit.commit.author.date);
        const runDate = new Date(run.created_at);
        // Match commits from same day as run
        return commitDate.toDateString() === runDate.toDateString();
      }) || [];

      // Find related PRs
      const relatedPRs = prsResponse.data?.filter((pr) => {
        const prDate = new Date(pr.merged_at || pr.created_at);
        const runDate = new Date(run.created_at);
        return prDate.toDateString() === runDate.toDateString();
      }) || [];

      return {
        id: run.id,
        name: run.name,
        app_name: REPO,
        author: run.actor?.name || run.actor?.login || 'Unknown',
        created_by: run.actor?.login || 'Unknown',
        tag_name: run.head_branch || 'main',
        environment: 'production',
        commit_ids: relatedCommits.map((c) => c.sha.substring(0, 7)).join(', '),
        commits: relatedCommits.map((c) => ({
          sha: c.sha,
          message: c.commit.message,
          author: c.commit.author.name,
          url: c.html_url,
        })),
        pr_information: relatedPRs.map((pr) => ({
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          merged_at: pr.merged_at,
        })),
        description: run.conclusion === 'success' ? 'Deployment successful' : `Deployment ${run.conclusion}`,
        created_at: run.created_at,
        status: run.conclusion || run.status,
        conclusion: run.conclusion,
        url: run.html_url,
      };
    });

    // Calculate lead time with average and median
    const prs = prsResponse.data || [];
    const leadTimesByDate = {};
    
    prs.forEach((pr) => {
      if (pr.merged_at && pr.created_at) {
        const createdDate = new Date(pr.created_at);
        const mergedDate = new Date(pr.merged_at);
        const leadHours = (mergedDate - createdDate) / (1000 * 60 * 60);
        const dateKey = createdDate.toISOString().split('T')[0];
        
        if (!leadTimesByDate[dateKey]) {
          leadTimesByDate[dateKey] = [];
        }
        leadTimesByDate[dateKey].push(leadHours);
      }
    });

    const leadTimeData = Object.entries(leadTimesByDate).map(([date, times]) => {
      const sorted = [...times].sort((a, b) => a - b);
      const average = times.reduce((a, b) => a + b, 0) / times.length;
      const median = sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[Math.floor(sorted.length / 2)];
      
      return {
        date,
        average_lead_time: Number(average.toFixed(2)),
        median_lead_time: Number(median.toFixed(2)),
        data_points: times.map((t) => Number(t.toFixed(2))),
      };
    }).sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      deployments: enhancedDeployments.filter((d) => d.conclusion === 'success'),
      lead_time_data: leadTimeData,
      all_data: {
        workflow_runs: workflowRuns,
        pulls: prsResponse.data,
        issues: issuesResponse.data,
      },
    });
  } catch (err) {
    console.error('Details endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
