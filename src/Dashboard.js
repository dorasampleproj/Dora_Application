import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from 'react-router-dom';
import "@/App.css";
import axios from "axios";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toaster,
} from "./components/ui";
import { toast } from "sonner";
import { MetricChart } from "./MetricChart";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OWNER = "dorasampleproj";
const REPO = process.env.REACT_APP_GITHUB_REPO;

// GitHub API configurations
const GITHUB_API_CONFIG = {
  baseURL: "https://api.github.com",
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
  },
};

const sampleHistoricalData = {
  deployment_frequency: [
    { date: "2025-10-21", value: 0.3 },
    { date: "2025-10-22", value: 0.5 },
    { date: "2025-10-23", value: 0.8 },
    { date: "2025-10-24", value: 0.6 },
    { date: "2025-10-25", value: 1.0 },
    { date: "2025-10-26", value: 0.7 },
    { date: "2025-10-27", value: 0.9 },
  ],
  lead_time: [
    { date: "2025-10-21", average: 72, median: 68 },
    { date: "2025-10-22", average: 58, median: 55 },
    { date: "2025-10-23", average: 45, median: 42 },
    { date: "2025-10-24", average: 52, median: 50 },
    { date: "2025-10-25", average: 48, median: 45 },
    { date: "2025-10-26", average: 36, median: 34 },
    { date: "2025-10-27", average: 42, median: 40 },
  ],
  change_failure_rate: [
    { date: "2025-10-21", value: 18 },
    { date: "2025-10-22", value: 15 },
    { date: "2025-10-23", value: 12 },
    { date: "2025-10-24", value: 14 },
    { date: "2025-10-25", value: 11 },
    { date: "2025-10-26", value: 13 },
    { date: "2025-10-27", value: 15 },
  ],
  mean_time_to_recovery: [
    { date: "2025-10-21", value: 48 },
    { date: "2025-10-22", value: 42 },
    { date: "2025-10-23", value: 36 },
    { date: "2025-10-24", value: 40 },
    { date: "2025-10-25", value: 38 },
    { date: "2025-10-26", value: 32 },
    { date: "2025-10-27", value: 36 },
  ],
};

const sampleCFRBreakdown = {
  successful: 85,
  failed: 15,
  total: 100,
  breakdownData: [
    { name: "Successful", value: 85, percentage: 85, fill: "#10b981" },
    { name: "Failed", value: 15, percentage: 15, fill: "#ef4444" },
  ],
};

const defaultMetrics = {
    deployment_frequency: {
      value: 0.5,
      unit: "deployments per day",
      timestamp: new Date().toISOString(),
    },
    lead_time: {
      value: 48,
      unit: "hours",
      timestamp: new Date().toISOString(),
    },
    change_failure_rate: {
      value: 15,
      unit: "percent",
      timestamp: new Date().toISOString(),
    },
    mean_time_to_recovery: {
      value: 36,
      unit: "hours",
      timestamp: new Date().toISOString(),
    },
  };

const Dashboard = () => {
  // Helper function to determine which metrics are applicable for a datasource type
  const getApplicableMetrics = (datasourceType) => {
    if (datasourceType === 'github') {
      return {
        deployment_frequency: true,
        lead_time: true,
        change_failure_rate: false,
        mean_time_to_recovery: false,
      };
    } else if (datasourceType === 'servicenow') {
      return {
        deployment_frequency: false,
        lead_time: false,
        change_failure_rate: true,
        mean_time_to_recovery: true,
      };
    } else if (datasourceType === 'all') {
      // Show all metrics when "All" is selected
      return {
        deployment_frequency: true,
        lead_time: true,
        change_failure_rate: true,
        mean_time_to_recovery: true,
      };
    }
    // Default: all metrics available when no datasource type
    return {
      deployment_frequency: true,
      lead_time: true,
      change_failure_rate: true,
      mean_time_to_recovery: true,
    };
  };

  // Start with no metrics until a data source is configured
  const [metrics, setMetrics] = useState(null);
  const [dataSources, setDataSources] = useState([]);
  const [selectedDatasource, setSelectedDatasource] = useState(null);
  const [dataSourceCreated, setDataSourceCreated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [newDataSourceId, setNewDataSourceId] = useState(null);
  const [newDataSource, setNewDataSource] = useState({
    name: "",
    type: "",
    config: {},
  });
  const [metricHistory, setMetricHistory] = useState({
    deployment_frequency: [],
    lead_time: [],
    change_failure_rate: [],
    mean_time_to_recovery: [],
  });
  const [changeFailureRateBreakdown, setChangeFailureRateBreakdown] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const primarySourceType = selectedDatasource?.type || (dataSources.length > 0 ? dataSources[0].type : null);
  const urlSource = new URLSearchParams(location.search).get('source');

  const fetchGitHubMetrics = async () => {
    try {
      // Fetch repository workflow runs
      const metricResponse = await axios.get(`${API}/data-sources/metrics`);
      console.log("GitHub Metric Response:", metricResponse.data);
      return metricResponse.data;
    } catch (error) {
      console.error("Failed to fetch GitHub metrics:", error);
      throw error;
    }
  };

  const fetchServiceNowMetrics = async () => {
    try {
      const metricResponse = await axios.get(`${API}/servicenow/metrics`);
      console.log("ServiceNow Metric Response:", metricResponse.data);
      return metricResponse.data;
    } catch (error) {
      console.error("Failed to fetch ServiceNow metrics:", error);
      throw error;
    }
  };

  const fetchMetrics = async ({ datasourceCreated = false } = {}) => {
    try {
      // If no datasource is selected, clear metrics and return
      if (!selectedDatasource && !datasourceCreated) {
        setMetrics(null);
        setMetricHistory({
          deployment_frequency: [],
          lead_time: [],
          change_failure_rate: [],
          mean_time_to_recovery: [],
        });
        return;
      }

      let deploymentSeries = [];
      let deploymentSummaryValue;
      let leadTimeSummaryValue;
      let changeFailureRateSeries = [];
      let changeFailureRateSummaryValue;
      let meanTimeToRecoverySummaryValue;
      let leadTimeSeries = [];
      let meanTimeToRecoverySeries = [];
      
      setLoading(true);
      console.log("Fetching metrics for datasource:", selectedDatasource);
  // pick the appropriate backend metrics endpoint based on selected datasource
      let fetchedMetrics = null;
      if (selectedDatasource?.type === 'github') {
        fetchedMetrics = await fetchGitHubMetrics();
      } else if (selectedDatasource?.type === 'servicenow') {
        fetchedMetrics = await fetchServiceNowMetrics();
      } else if (selectedDatasource?.type === 'all') {
        // Fetch metrics from both sources for "All" option
        try {
          const githubMetrics = await fetchGitHubMetrics();
          const servicenowMetrics = await fetchServiceNowMetrics();
          // Combine metrics - GitHub provides deployment freq and lead time
          // ServiceNow provides change failure rate and MTTR
          fetchedMetrics = {
            ...githubMetrics,
            ...servicenowMetrics,
          };
        } catch (error) {
          console.error("Failed to fetch all metrics:", error);
          // If one source fails, try to use whatever data we have
          try {
            fetchedMetrics = await fetchGitHubMetrics();
          } catch (e) {
            try {
              fetchedMetrics = await fetchServiceNowMetrics();
            } catch (e2) {
              fetchedMetrics = null;
            }
          }
        }
      } else {
        fetchedMetrics = null;
      }

      const toNumber = (v, fallback = 0) => {
        if (v == null) return fallback;
        if (typeof v === "object") {
          if ("value" in v) return Number(v.value ?? fallback) || fallback;
          return Number(v) || fallback;
        }
        const n = Number(v);
        return Number.isNaN(n) ? fallback : n;
      };
      console.log("before if", datasourceCreated, selectedDatasource, fetchedMetrics);
      if (selectedDatasource || datasourceCreated) {
        if (fetchedMetrics && Array.isArray(fetchedMetrics.deployment_frequency)) {
          // Ensure series values are numeric
          console.log("Deployment Frequency Series:", fetchedMetrics.deployment_frequency);
          deploymentSeries = fetchedMetrics.deployment_frequency.map((p) => ({
            date: String(p.date),
            value: toNumber(p.value, 0),
          }));
          const total = deploymentSeries.reduce(
            (s, p) => s + (p.value || 0),
            0
          );
          
          deploymentSummaryValue = total / Math.max(deploymentSeries.length, 1);
          
          // Handle lead_time series
          if (fetchedMetrics.lead_time && Array.isArray(fetchedMetrics.lead_time)) {
            leadTimeSeries = fetchedMetrics.lead_time.map((p) => ({
              date: String(p.date),
              average: toNumber(p.average, 0),
              median: toNumber(p.median, 0),
            }));
            // Calculate average of averages for the summary
            if (leadTimeSeries.length > 0) {
              leadTimeSummaryValue = leadTimeSeries.reduce((s, p) => s + (p.average || 0), 0) / leadTimeSeries.length;
            }
          }
          
          // Handle change_failure_rate series
          changeFailureRateSeries = (fetchedMetrics.change_failure_rate || []).map((p) => ({
            date: String(p.date),
            value: toNumber(p.value, 0),
          }));
          const totalchangeFailureRateSeries = changeFailureRateSeries.reduce(
            (s, p) => s + (p.value || 0),
            0
          );
          changeFailureRateSummaryValue = totalchangeFailureRateSeries / Math.max(changeFailureRateSeries.length, 1);
          
          // Extract change_failure_rate_breakdown if available (for pie chart)
          if (fetchedMetrics.change_failure_rate_breakdown) {
            setChangeFailureRateBreakdown(fetchedMetrics.change_failure_rate_breakdown);
          }
          
          // Handle mean_time_to_recovery series
          if (fetchedMetrics.mean_time_to_recovery && Array.isArray(fetchedMetrics.mean_time_to_recovery)) {
            meanTimeToRecoverySeries = fetchedMetrics.mean_time_to_recovery.map((p) => ({
              date: String(p.date),
              value: toNumber(p.value, 0),
            }));
            const mttrTotal = meanTimeToRecoverySeries.reduce((s, p) => s + (p.value || 0), 0);
            meanTimeToRecoverySummaryValue = mttrTotal / Math.max(meanTimeToRecoverySeries.length, 1);
          }
          
          console.log(
            "Calculated Metric Values:",
            { deploymentSummaryValue, leadTimeSummaryValue, changeFailureRateSummaryValue, meanTimeToRecoverySummaryValue }
          );
        } else if (
          fetchedMetrics && fetchedMetrics.deployment_frequency_summary &&
          typeof fetchedMetrics.deployment_frequency_summary.value !== "undefined"
        ) {
          deploymentSummaryValue = toNumber(fetchedMetrics.deployment_frequency_summary.value, defaultMetrics.deployment_frequency.value);
        } else if (fetchedMetrics && (typeof fetchedMetrics.deployment_frequency === "number" || typeof fetchedMetrics.deployment_frequency === "string")) {
          deploymentSummaryValue = toNumber(fetchedMetrics.deployment_frequency, defaultMetrics.deployment_frequency.value);
        }
        
        // Extract lead_time summary if not already computed from series
        if (!leadTimeSummaryValue) {
          leadTimeSummaryValue = toNumber(fetchedMetrics?.lead_time_summary?.value ?? fetchedMetrics?.lead_time, defaultMetrics.lead_time.value);
        }
        
        // Extract change_failure_rate from summary if needed
        if (!changeFailureRateSummaryValue) {
          changeFailureRateSummaryValue = toNumber(fetchedMetrics?.change_failure_rate_summary?.value ?? fetchedMetrics?.change_failure_rate, defaultMetrics.change_failure_rate.value);
        }
        
        // Extract mean_time_to_recovery from summary if needed
        if (!meanTimeToRecoverySummaryValue) {
          meanTimeToRecoverySummaryValue = toNumber(fetchedMetrics?.mean_time_to_recovery_summary?.value ?? fetchedMetrics?.mean_time_to_recovery ?? fetchedMetrics?.mttr, defaultMetrics.mean_time_to_recovery.value);
        }
      } else {
        console.log("Using sample data for deployment frequency");
      deploymentSeries = sampleHistoricalData.deployment_frequency;
      deploymentSummaryValue = defaultMetrics.deployment_frequency.value;
      leadTimeSummaryValue = defaultMetrics.lead_time.value;
      leadTimeSeries = sampleHistoricalData.lead_time;
      changeFailureRateSeries = sampleHistoricalData.change_failure_rate;
      changeFailureRateSummaryValue = defaultMetrics.change_failure_rate.value;
      setChangeFailureRateBreakdown(sampleCFRBreakdown);
      meanTimeToRecoverySummaryValue = defaultMetrics.mean_time_to_recovery.value;
      meanTimeToRecoverySeries = sampleHistoricalData.mean_time_to_recovery;
      }

      // push series into history state for charting
      console.log("setMetricHistory", { deploymentSeries, leadTimeSeries, changeFailureRateSeries, meanTimeToRecoverySeries });
      setMetricHistory((prev) => ({
        ...prev,
        deployment_frequency: (deploymentSeries && deploymentSeries.length > 0) ? deploymentSeries : prev.deployment_frequency,
        lead_time: (leadTimeSeries && leadTimeSeries.length > 0) ? leadTimeSeries : prev.lead_time,
        change_failure_rate: (changeFailureRateSeries && changeFailureRateSeries.length > 0) ? changeFailureRateSeries : prev.change_failure_rate,
        mean_time_to_recovery: (meanTimeToRecoverySeries && meanTimeToRecoverySeries.length > 0) ? meanTimeToRecoverySeries : prev.mean_time_to_recovery,
      }));

      setMetrics({
        deployment_frequency: {
          value: toNumber(
            deploymentSummaryValue,
            defaultMetrics.deployment_frequency.value
          ),
          unit: "deployments per day",
          timestamp: new Date().toISOString(),
        },
        lead_time: {
          value: toNumber(leadTimeSummaryValue, defaultMetrics.lead_time.value),
          unit: "hours",
          timestamp: new Date().toISOString(),
        },
        change_failure_rate: {
          value: toNumber(
            changeFailureRateSummaryValue,
            defaultMetrics.change_failure_rate.value
          ),
          unit: "percent",
          timestamp: new Date().toISOString(),
        },
        mean_time_to_recovery: {
          value: toNumber(meanTimeToRecoverySummaryValue, defaultMetrics.mean_time_to_recovery.value),
          unit: "hours",
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Failed to fetch metrics:", error);
      toast.error("Failed to fetch DORA metrics");

      // Attempt a fallback to backend API, if available
      try {
        const response = await axios.get(`${API}/metrics/github`, {
          params: {
            org: newDataSource.config?.org,
            repo: newDataSource.config?.repo,
          },
        });

        // Normalize backend response into numeric DORA metrics and series
        const toNumberLocal = (v, fallback = 0) => {
          if (v == null) return fallback;
          if (typeof v === "object") {
            if ("value" in v) return Number(v.value ?? fallback) || fallback;
            return Number(v) || fallback;
          }
          const n = Number(v);
          return Number.isNaN(n) ? fallback : n;
        };

        // Try to pick up a deployment series if available
        let deploymentSeriesFallback =
          sampleHistoricalData.deployment_frequency;
        if (Array.isArray(response.data.deployment_frequency)) {
          deploymentSeriesFallback = response.data.deployment_frequency.map(
            (p) => ({ date: String(p.date), value: toNumberLocal(p.value, 0) })
          );
        } else if (Array.isArray(response.data.deploymentFrequency)) {
          deploymentSeriesFallback = response.data.deploymentFrequency.map(
            (p) => ({
              date: String(p.date),
              value: toNumberLocal(p.value ?? p.count ?? 0, 0),
            })
          );
        }

        setMetricHistory((prev) => ({
          ...prev,
          deployment_frequency: deploymentSeriesFallback,
        }));

        const githubMetrics = {
          deployment_frequency: {
            value: toNumberLocal(
              response.data.deploymentFrequency ??
                response.data.deployment_frequency_summary ??
                0,
              0
            ),
            unit: "deployments per day",
            timestamp: new Date().toISOString(),
          },
          lead_time: {
            value: toNumberLocal(
              response.data.leadTime ?? response.data.lead_time ?? 0,
              0
            ),
            unit: "hours",
            timestamp: new Date().toISOString(),
          },
          change_failure_rate: {
            value: toNumberLocal(
              response.data.changeFailureRate ??
                response.data.change_failure_rate ??
                0,
              0
            ),
            unit: "percent",
            timestamp: new Date().toISOString(),
          },
          mean_time_to_recovery: {
            value: toNumberLocal(
              response.data.mttr ?? response.data.mean_time_to_recovery ?? 0,
              0
            ),
            unit: "hours",
            timestamp: new Date().toISOString(),
          },
        };

        await new Promise((resolve) => setTimeout(resolve, 1000));
        setMetrics(githubMetrics);
      } catch (error2) {
        console.error("Failed to fetch metrics from backend:", error2);
        toast.error("Failed to fetch DORA metrics from Github");

        // Final fallback to sensible defaults
        const mockData = {
          deployment_frequency: {
            value: 0.5,
            unit: "deployments per day",
            timestamp: new Date().toISOString(),
          },
          lead_time: {
            value: 48,
            unit: "hours",
            timestamp: new Date().toISOString(),
          },
          change_failure_rate: {
            value: 15,
            unit: "percent",
            timestamp: new Date().toISOString(),
          },
          mean_time_to_recovery: {
            value: 36,
            unit: "hours",
            timestamp: new Date().toISOString(),
          },
        };
        setMetrics(mockData);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchDataSources = async (opts = {}) => {
    try {
      const response = await axios.get(`${API}/data-sources`); // Use the full API URL
      const backendList = response.data || [];
      // If caller requested to skip local cache (initial load), don't auto-populate
      if (opts && opts.skipLocalCache) {
        // Just return the list without setting state - let the UI remain empty until user configures a source
        return backendList;
      }
      // If the user has local data-sources persisted, prefer those and merge with backend extras.
      // This can be skipped by passing opts.skipLocalCache = true.
      if (!opts.skipLocalCache) {
        try {
          const cached = localStorage.getItem('dora_data_sources');
          const parsed = cached ? JSON.parse(cached) : null;
          if (parsed && Array.isArray(parsed) && parsed.length > 0) {
            // Merge and dedupe: prefer user sources, then add backend extras by unique key
            const map = new Map();
            const isValid = (s) => {
              if (!s || !s.type) return false;
              if (s.type === 'github') return !!(s.config && s.config.org && s.config.repo);
              if (s.type === 'servicenow') return !!(s.config && s.config.url && s.config.token);
              return !!s.name;
            };
            const pushKey = (s) => {
              let key = `${s.type}::${s.name || s.id || ''}`;
              if (s.type === 'servicenow' && s.config && s.config.url) key = `servicenow::${s.config.url}`;
              if (s.type === 'github' && s.config && s.config.org && s.config.repo) key = `github::${s.config.org}/${s.config.repo}`;
              return key;
            };
            // First add parsed (user) entries (only valid ones)
            for (const s of parsed.filter(isValid)) map.set(pushKey(s), s);
            // Add backend entries only if they don't duplicate
            for (const b of backendList) {
              const k = pushKey(b);
              if (!map.has(k)) map.set(k, b);
            }
            const merged = Array.from(map.values());
            setDataSources(merged);
            try { localStorage.setItem('dora_data_sources', JSON.stringify(merged)); } catch (e) { console.warn('localStorage save failed', e); }
            return merged;
          }
        } catch (e) {
          console.warn('Failed to read/merge cached data sources', e);
        }
      }

      // No local cached sources — do not auto-populate the dashboard from backend defaults
      // unless explicitly requested by the caller (opts.forceWrite === true)
      if (opts && opts.forceWrite) {
        try {
          setDataSources(backendList);
          localStorage.setItem('dora_data_sources', JSON.stringify(backendList));
        } catch (e) {
          console.warn('Failed to persist backend data sources', e);
        }
        return backendList;
      }
      return backendList;
    } catch (error) {
      console.error("Failed to fetch data sources:", error);
      toast.error("Failed to fetch data sources");
      return null;
    }
  };

  const handleCreateDataSource = async () => {
    try {
      if (newDataSource.type === "github") {
        // Validate GitHub specific fields
        if (!newDataSource.name.trim()) {
          toast.error("Data source name is required");
          return;
        }
        if (!newDataSource.config.token?.startsWith("ghp_")) {
          toast.error("Invalid GitHub token format");
          return;
        }
        if (!newDataSource.config.org) {
          toast.error("Organization/Owner is required");
          return;
        }
        if (!newDataSource.config.repo?.trim()) {
          toast.error("Repository name is required");
          return;
        }
        // Clean up repository name
        const repoName = newDataSource.config.repo
          .replace("https://github.com/", "")
          .split("/")
          .pop()
          .trim();

        const payload = {
          name: newDataSource.name.trim() || `GitHub - ${OWNER}`,
          type: "github",
          config: {
            token: GITHUB_TOKEN,
            org: OWNER,
            repo: repoName.trim(),
            apiUrl: GITHUB_API_CONFIG.baseURL,
          },
          enabled: true,
          headers: GITHUB_API_CONFIG.headers,
        };

        // Log the request (for debugging)
        console.log("API URL:", `${API}/data-sources`);
        console.log("Payload:", {
          ...payload,
          config: {
            ...payload.config,
            token: "***hidden***",
          },
        });

        const response = await axios.post(`${API}/data-sources`, payload, {
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (response.status === 201 || response.status === 200) {
          toast.success("GitHub data source configured successfully");
          console.log("Data Source Created:", response.data);
          setDataSourceCreated(true);
          setNewDataSourceId(response.data.id);
          // Clear badge after 5 seconds
          setTimeout(() => setNewDataSourceId(null), 5000);
          // Refresh authoritative list from backend
          const updatedSources = await fetchDataSources({ forceWrite: true });
          setIsConfiguring(false);
          setNewDataSource({ name: "", type: "", config: {} });
          
          // Auto-select the newly created datasource
          if (updatedSources && updatedSources.length > 0) {
            const newSource = updatedSources.find((s) => s.id === response.data.id) || updatedSources[updatedSources.length - 1];
            if (newSource) {
              setSelectedDatasource(newSource);
              // Persist to sessionStorage
              try {
                sessionStorage.setItem('dora_selected_datasource', JSON.stringify(newSource));
              } catch (e) {
                console.warn('Failed to save selected datasource to session', e);
              }
            }
          }
          
          await fetchMetrics({ datasourceCreated: true });
        } else {
          throw new Error("Unexpected response status: " + response.status);
        }
      }
      else if (newDataSource.type === 'servicenow') {
        // Validate ServiceNow fields
        if (!newDataSource.name.trim()) {
          toast.error('Data source name is required');
          return;
        }
        if (!newDataSource.config.url?.trim()) {
          toast.error('ServiceNow instance URL is required');
          return;
        }
        if (!newDataSource.config.token?.trim()) {
          toast.error('ServiceNow API token is required');
          return;
        }

        const payload = {
          id: Date.now(),
          name: newDataSource.name.trim() || 'ServiceNow',
          type: 'servicenow',
          enabled: true,
          config: {
            url: newDataSource.config.url.trim(),
            token: newDataSource.config.token.trim(),
          }
        };

        // Persist ServiceNow datasource to backend so it's available to other sessions
        const resp = await axios.post(`${API}/data-sources`, payload, { headers: { 'Content-Type': 'application/json' } });
        if (resp.status === 201 || resp.status === 200) {
          toast.success('ServiceNow data source configured');
          setNewDataSourceId(resp.data.id);
          // Clear badge after 5 seconds
          setTimeout(() => setNewDataSourceId(null), 5000);
          const updatedSources = await fetchDataSources({ forceWrite: true });
          setIsConfiguring(false);
          setNewDataSource({ name: '', type: '', config: {} });
          setDataSourceCreated(true);
          
          // Auto-select the newly created datasource
          if (updatedSources && updatedSources.length > 0) {
            const newSource = updatedSources.find((s) => s.id === resp.data.id) || updatedSources[updatedSources.length - 1];
            if (newSource) {
              setSelectedDatasource(newSource);
              // Persist to sessionStorage
              try {
                sessionStorage.setItem('dora_selected_datasource', JSON.stringify(newSource));
              } catch (e) {
                console.warn('Failed to save selected datasource to session', e);
              }
            }
          }
          
          await fetchMetrics({ datasourceCreated: true });
        } else {
          throw new Error('Failed to persist ServiceNow datasource');
        }
      }
    } catch (error) {
      console.error("Failed to create data source:", error);
      console.log("testing")
      toast.error(
        error.response?.data?.message ||
          "Failed to configure GitHub data source"
      );
    }
  };

  const testConnection = async (sourceId) => {
    try {
      const response = await axios.get(`${API}/data-sources/${sourceId}/test`);
      if (response.data.success) {
        toast.success("Connection test successful");
      } else {
        toast.error("Connection test failed");
      }
    } catch (error) {
      toast.error("Connection test failed");
    }
  };

  const renderConfigForm = () => {
    switch (newDataSource.type) {
      case "github":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="github-token">GitHub Token</Label>
              <Input
                id="github-token"
                type="password"
                placeholder="ghp_xxxxxxxxxxxx"
                value={newDataSource.config.token || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, token: e.target.value },
                  })
                }
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Token needs repos, workflow, actions:read permissions
              </p>
            </div>
            <div>
              <Label htmlFor="github-org">Organization/Owner</Label>
              <Input
                id="github-org"
                placeholder="myorg"
                value={newDataSource.config.org || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, org: e.target.value },
                  })
                }
                required
              />
            </div>
            <div>
              <Label htmlFor="github-repo">Repository Name</Label>
              <Input
                id="github-repo"
                placeholder="myrepo or leave empty for all repos"
                value={newDataSource.config.repo || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, repo: e.target.value },
                  })
                }
                required
              />
            </div>
          </div>
        );
      case "jenkins":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="jenkins-url">Jenkins URL</Label>
              <Input
                id="jenkins-url"
                placeholder="https://jenkins.mycompany.com"
                value={newDataSource.config.url || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, url: e.target.value },
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="jenkins-username">Username</Label>
              <Input
                id="jenkins-username"
                value={newDataSource.config.username || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: {
                      ...newDataSource.config,
                      username: e.target.value,
                    },
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="jenkins-token">API Token</Label>
              <Input
                id="jenkins-token"
                type="password"
                value={newDataSource.config.token || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, token: e.target.value },
                  })
                }
              />
            </div>
          </div>
        );
      case "dynatrace":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="dynatrace-url">Dynatrace URL</Label>
              <Input
                id="dynatrace-url"
                placeholder="https://abc12345.live.dynatrace.com"
                value={newDataSource.config.url || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, url: e.target.value },
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="dynatrace-token">API Token</Label>
              <Input
                id="dynatrace-token"
                type="password"
                placeholder="dt0c01.xxxxxxxxxxxxx"
                value={newDataSource.config.token || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, token: e.target.value },
                  })
                }
              />
            </div>
          </div>
        );
      case "jira":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="jira-url">Jira URL</Label>
              <Input
                id="jira-url"
                placeholder="https://mycompany.atlassian.net"
                value={newDataSource.config.url || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, url: e.target.value },
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="jira-email">Email</Label>
              <Input
                id="jira-email"
                type="email"
                value={newDataSource.config.email || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, email: e.target.value },
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="jira-token">API Token</Label>
              <Input
                id="jira-token"
                type="password"
                value={newDataSource.config.token || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, token: e.target.value },
                  })
                }
              />
            </div>
          </div>
        );
      case "servicenow":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="sn-url">ServiceNow Instance URL</Label>
              <Input
                id="sn-url"
                placeholder="https://devXXXXX.service-now.com"
                value={newDataSource.config.url || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, url: e.target.value },
                  })
                }
                required
              />
            </div>
            <div>
              <Label htmlFor="sn-token">API Token</Label>
              <Input
                id="sn-token"
                type="password"
                placeholder="service-now-api-token"
                value={newDataSource.config.token || ""}
                onChange={(e) =>
                  setNewDataSource({
                    ...newDataSource,
                    config: { ...newDataSource.config, token: e.target.value },
                  })
                }
                required
              />
            </div>
          </div>
        );
      default:
        return <div>Please select a data source type</div>;
    }
  };

  useEffect(() => {
    // Initial fetch
    const initializeData = async () => {
      try {
        setLoading(true);
        
        // Load default mock metrics on page load for initial display
        // Calculate lead_time average from average values (not .value which doesn't exist)
        const leadTimeAvg = sampleHistoricalData.lead_time.reduce((sum, p) => sum + (p.average || 0), 0) / sampleHistoricalData.lead_time.length;
        
        setMetrics({
          deployment_frequency: {
            value: sampleHistoricalData.deployment_frequency.reduce((sum, p) => sum + p.value, 0) / sampleHistoricalData.deployment_frequency.length,
            unit: "deployments per day",
            timestamp: new Date().toISOString(),
          },
          lead_time: {
            value: leadTimeAvg,
            unit: "hours",
            timestamp: new Date().toISOString(),
          },
          change_failure_rate: {
            value: sampleHistoricalData.change_failure_rate.reduce((sum, p) => sum + p.value, 0) / sampleHistoricalData.change_failure_rate.length,
            unit: "percent",
            timestamp: new Date().toISOString(),
          },
          mean_time_to_recovery: {
            value: sampleHistoricalData.mean_time_to_recovery.reduce((sum, p) => sum + p.value, 0) / sampleHistoricalData.mean_time_to_recovery.length,
            unit: "hours",
            timestamp: new Date().toISOString(),
          },
        });
        
        // Load sample historical data - IMPORTANT: This ensures lead_time and MTTR data are visible by default
        setMetricHistory({
          deployment_frequency: sampleHistoricalData.deployment_frequency,
          lead_time: sampleHistoricalData.lead_time,
          change_failure_rate: sampleHistoricalData.change_failure_rate,
          mean_time_to_recovery: sampleHistoricalData.mean_time_to_recovery,
        });
        
        // Set default CFR breakdown
        setChangeFailureRateBreakdown(sampleCFRBreakdown);

        // Fetch data sources from backend, restoring from localStorage if available
        const sources = await fetchDataSources({ skipLocalCache: false });
        if (sources && sources.length > 0) {
          // Try to restore previously selected datasource from sessionStorage
          try {
            const savedDatasource = sessionStorage.getItem('dora_selected_datasource');
            if (savedDatasource) {
              const parsed = JSON.parse(savedDatasource);
              const found = sources.find((s) => s.id === parsed.id || (s.type === parsed.type && s.name === parsed.name));
              if (found) {
                setSelectedDatasource(found);
              }
            }
          } catch (e) {
            console.warn('Failed to restore selected datasource from session', e);
          }
        }
      } catch (error) {
        console.error("Failed to initialize data:", error);
        toast.error("Failed to load initial data");
      } finally {
        setLoading(false);
      }
    };

    initializeData();

    // Set up auto-refresh (only if a datasource is selected)
    const interval = setInterval(() => {
      if (selectedDatasource) {
        fetchMetrics();
      }
    }, 300000);
    // Persist selected datasource to sessionStorage on unload
    const onUnload = () => {
      try { sessionStorage.removeItem('dora_data_sources_session'); } catch (e) { /* ignore */ }
      if (selectedDatasource) {
        try {
          sessionStorage.setItem('dora_selected_datasource', JSON.stringify(selectedDatasource));
        } catch (e) { /* ignore */ }
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  // Update metrics when dataSources change
  useEffect(() => {
    if (dataSources.length > 0 && !selectedDatasource) {
      // Check if we should restore from URL or use previously saved selection
      const sourceParam = new URLSearchParams(location.search).get('source');
      let shouldSelect = null;
      
      if (sourceParam) {
        // Try to find matching datasource from URL
        if (sourceParam === 'all') {
          shouldSelect = { id: "all", type: "all", name: "All Sources" };
        } else {
          shouldSelect = dataSources.find((ds) => 
            ds.type === sourceParam || 
            ds.name === sourceParam || 
            ds.id?.toString() === sourceParam
          );
        }
      } else {
        // Try to restore from sessionStorage if no URL param
        try {
          const savedDatasource = sessionStorage.getItem('dora_selected_datasource');
          if (savedDatasource) {
            const parsed = JSON.parse(savedDatasource);
            shouldSelect = dataSources.find((s) => s.id === parsed.id || (s.type === parsed.type && s.name === parsed.name));
          }
        } catch (e) {
          console.warn('Failed to restore from sessionStorage', e);
        }
      }
      
      // If no URL or saved selection, auto-select first one
      if (!shouldSelect && dataSources.length > 0) {
        shouldSelect = dataSources[0];
      }
      
      if (shouldSelect) {
        setSelectedDatasource(shouldSelect);
        // Persist to sessionStorage
        try {
          sessionStorage.setItem('dora_selected_datasource', JSON.stringify(shouldSelect));
        } catch (e) {
          console.warn('Failed to save to sessionStorage', e);
        }
      }
    }
  }, [dataSources, location.search]);

  // Fetch metrics when selectedDatasource changes
  useEffect(() => {
    if (selectedDatasource) {
      fetchMetrics();
    } else {
      // When no datasource is selected, ensure lead_time and mean_time_to_recovery are shown with sample data
      setMetricHistory((prev) => ({
        ...prev,
        lead_time: sampleHistoricalData.lead_time,
        mean_time_to_recovery: sampleHistoricalData.mean_time_to_recovery,
      }));
    }
  }, [selectedDatasource]);

  // useEffect(() => {
  //     const validateGitHubConnection = async () => {
  //       try {
  //         setLoading(true);
  //         // First, verify GitHub token by checking user access
  //         const userResponse = await axios.get(`${GITHUB_API_CONFIG.baseURL}/user`, {
  //           headers: GITHUB_API_CONFIG.headers
  //         });

  //         if (userResponse.data && userResponse.data.login) {
  //           console.log('GitHub user verified:', userResponse.data);
  //           alert("GitHub user success");
  //           setUserData(userResponse.data);
  //           toast.success(`Connected to GitHub as ${userResponse.data.login}`);

  //           // After successful user verification, check repository access
  //           const repoResponse = await axios.get(
  //             `${GITHUB_API_CONFIG.baseURL}/repos/${OWNER}/${REPO || ''}`,
  //             { headers: GITHUB_API_CONFIG.headers }
  //           );

  //           if (repoResponse.data) {
  //             toast.success('Repository access verified');
  //           }
  //         }
  //       } catch (error) {
  //         console.error("GitHub connection error:", error.response?.data || error.message);

  //         if (error.response?.status === 401) {
  //           toast.error('Invalid GitHub token. Please check your credentials.');
  //         } else if (error.response?.status === 403) {
  //           toast.error('Access denied. Please check token permissions.');
  //         } else if (error.response?.status === 404) {
  //           toast.error('Repository or user not found. Please verify the details.');
  //         } else {
  //           toast.error('Failed to connect to GitHub. Please try again.');
  //         }
  //       } finally {
  //         setLoading(false);
  //       }
  //     };

  //     validateGitHubConnection();
  //   }, []);

  // if (loading) return <p>Connecting to GitHub...</p>;

  const getMetricColor = (metricType, value) => {
    // Coerce possible nested objects or strings to number
    let n;
    if (value === null || typeof value === 'undefined') n = NaN;
    else if (typeof value === "object" && "value" in value) n = Number(value.value);
    else n = Number(value);
    if (Number.isNaN(n)) return "text-gray-600";
    switch (metricType) {
      case "deployment_frequency":
        return n >= 1
          ? "text-emerald-600"
          : n >= 0.1
          ? "text-amber-600"
          : "text-red-600";
      case "lead_time":
        return n <= 24
          ? "text-emerald-600"
          : n <= 168
          ? "text-amber-600"
          : "text-red-600";
      case "change_failure_rate":
        return n <= 10
          ? "text-emerald-600"
          : n <= 20
          ? "text-amber-600"
          : "text-red-600";
      case "mean_time_to_recovery":
        return n <= 24
          ? "text-emerald-600"
          : n <= 168
          ? "text-amber-600"
          : "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  const formatMetricValue = (metricType, value) => {
    // Coerce nested objects or strings to numeric value where possible
    let n;
    if (value === null || typeof value === 'undefined') n = NaN;
    else if (typeof value === "object" && "value" in value) n = Number(value.value);
    else n = Number(value);
    if (Number.isNaN(n)) {
      // If not a number, fall back to a safe representation
      return "-";
    }

    switch (metricType) {
      case "deployment_frequency":
        return n.toFixed(2);
      case "lead_time":
      case "mean_time_to_recovery":
        return n < 24 ? `${n.toFixed(1)}h` : `${(n / 24).toFixed(1)}d`;
      case "change_failure_rate":
        return `${n.toFixed(1)}%`;
      default:
        return n.toString();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-6">
      <Toaster position="top-right" />

      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
            DORA Dashboard
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Monitor four key elements of DORA metrics
          </p>
        </div>

        {/* Action Bar */}
        <div className="flex justify-between items-center">
          <div className="flex gap-3">
            <Button
              onClick={fetchMetrics}
              disabled={loading}
              data-testid="refresh-metrics-btn"
              className="flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></div>
                  Refreshing...
                </>
              ) : (
                "Refresh Metrics"
              )}
            </Button>
            <Dialog open={isConfiguring} onOpenChange={setIsConfiguring}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  data-testid="configure-data-source-btn"
                >
                  Configure Data Source
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Add Data Source</DialogTitle>
                  <DialogDescription>
                    Configure a new data source for DORA metrics collection
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  <div>
                    <Label htmlFor="name">Data Source Name</Label>
                    <Input
                      id="name"
                      value={newDataSource.name}
                      onChange={(e) =>
                        setNewDataSource({
                          ...newDataSource,
                          name: e.target.value,
                        })
                      }
                      placeholder="My GitHub Repository"
                    />
                  </div>

                  <div>
                    <Label htmlFor="type">Type</Label>
                    <Select
                      value={newDataSource.type}
                      onValueChange={(value) =>
                        setNewDataSource({
                          ...newDataSource,
                          type: value,
                          config: {},
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select data source type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="github">GitHub</SelectItem>
                        <SelectItem value="jenkins">Jenkins</SelectItem>
                        <SelectItem value="dynatrace">Dynatrace</SelectItem>
                        <SelectItem value="jira">Jira</SelectItem>
                        <SelectItem value="servicenow">ServiceNow</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {newDataSource.type && renderConfigForm()}
                </div>

                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setIsConfiguring(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateDataSource}
                    disabled={!newDataSource.name || !newDataSource.type}
                  >
                    Add Data Source
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="text-sm text-gray-500">
            {newDataSourceId && <span>✓ New data source connected successfully</span>}
          </div>
        </div>

        {/* Data Sources Status */}
                  
        {dataSources.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                Configured Data Sources
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {dataSources.map((source) => (
                  <div key={source.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <div className="font-medium">{source.name}</div>
                      <Badge variant="secondary" className="text-xs">
                        {source.type}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => testConnection(source.id)}
                      data-testid={`test-connection-${source.type}`}
                    >
                      Test
                    </Button>
                  </div>
                ))}
              </div> */}
              {loading ? (
                <div className="animate-pulse space-y-3">
                  <div className="h-20 bg-gray-200 rounded"></div>
                  <div className="h-6 w-24 bg-gray-200 rounded"></div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {dataSources.map((source) => (
                    <div
                      key={source.id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-2">
                          {source.name}
                          {source.id === newDataSourceId && (
                            <Badge className="bg-emerald-500 text-white text-xs">✓ New</Badge>
                          )}
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {source.type}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => testConnection(source.id)}
                        data-testid={`test-connection-${source.type}`}
                      >
                        Test
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Datasource Selector */}
        {dataSources.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Select Data Source</CardTitle>
              <CardDescription>Choose which datasource metrics to view</CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={selectedDatasource?.id?.toString() || ""} onValueChange={(value) => {
                let selected;
                if (value === "all") {
                  selected = { id: "all", type: "all", name: "All Sources" };
                } else {
                  selected = dataSources.find((ds) => ds.id?.toString() === value);
                }
                if (selected) {
                  setSelectedDatasource(selected);
                  // Persist to sessionStorage
                  try {
                    sessionStorage.setItem('dora_selected_datasource', JSON.stringify(selected));
                  } catch (e) {
                    console.warn('Failed to save to sessionStorage', e);
                  }
                }
              }}>
                <SelectTrigger className="w-full md:w-64">
                  <SelectValue placeholder="Select a datasource to view metrics" />
                </SelectTrigger>
                <SelectContent>
                  {dataSources.length > 1 && (
                    <SelectItem value="all">
                      <span className="flex items-center gap-2">
                        All Sources
                        <Badge variant="secondary" className="text-xs">
                          all
                        </Badge>
                      </span>
                    </SelectItem>
                  )}
                  {dataSources.map((source) => (
                    <SelectItem key={source.id} value={source.id?.toString() || ""}>
                      <span className="flex items-center gap-2">
                        {source.name}
                        <Badge variant="secondary" className="text-xs">
                          {source.type}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}

        {/* DORA Metrics Grid */}
        {metrics && selectedDatasource ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Deployment Frequency (only if available) */}
            {getApplicableMetrics(primarySourceType || 'github').deployment_frequency && metrics.deployment_frequency && metrics.deployment_frequency.value !== null && (
              <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-700">Deployment Frequency</CardTitle>
                  <CardDescription className="text-xs">How often deployments occur</CardDescription>
                </CardHeader>
                <CardContent>
                  <MetricChart data={metricHistory.deployment_frequency} color="#10b981" />
                  <div className="space-y-2">
                    <div className={`text-2xl font-bold ${getMetricColor("deployment_frequency", metrics.deployment_frequency.value)}`}>
                      {formatMetricValue("deployment_frequency", metrics.deployment_frequency.value)}
                    </div>
                    <div className="text-xs text-gray-500">{metrics.deployment_frequency.unit}</div>
                    <div className="text-xs text-gray-400">Last updated: {metrics.deployment_frequency.timestamp ? new Date(metrics.deployment_frequency.timestamp).toLocaleTimeString() : '-'}</div>
                    <div className="mt-3">
                      <Button size="sm" variant="outline" disabled={!selectedDatasource || selectedDatasource?.type === 'all'} onClick={() => selectedDatasource && selectedDatasource.type !== 'all' && navigate(`/details?source=${selectedDatasource.type}&metric=deployment_frequency`)}>More Details</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Lead Time (only if available) */}
            {getApplicableMetrics(primarySourceType || 'github').lead_time && metrics.lead_time && metrics.lead_time.value !== null && (
              <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-700">Lead Time for Changes</CardTitle>
                  <CardDescription className="text-xs">Average and Median time from code committed to production</CardDescription>
                </CardHeader>
                <CardContent>
                  {metricHistory.lead_time && metricHistory.lead_time.length > 0 ? (
                    <MetricChart data={metricHistory.lead_time} color="#6366f1" chartType="stacked" />
                  ) : (
                    <div className="h-48 bg-gray-100 rounded flex items-center justify-center text-gray-500">No data available</div>
                  )}
                  <div className="space-y-2">
                    <div className={`text-2xl font-bold ${getMetricColor("lead_time", metrics.lead_time.value)}`}>{formatMetricValue("lead_time", metrics.lead_time.value)}</div>
                    <div className="text-xs text-gray-500">{metrics.lead_time.unit}</div>
                    <div className="text-xs text-gray-400">Last updated: {metrics.lead_time.timestamp ? new Date(metrics.lead_time.timestamp).toLocaleTimeString() : '-'}</div>
                    <div className="mt-3">
                      <Button size="sm" variant="outline" disabled={!selectedDatasource || selectedDatasource?.type === 'all'} onClick={() => selectedDatasource && selectedDatasource.type !== 'all' && navigate(`/details?source=${selectedDatasource.type}&metric=lead_time`)}>More Details</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Change Failure Rate (only if available) */}
            {getApplicableMetrics(primarySourceType || 'github').change_failure_rate && metrics.change_failure_rate && metrics.change_failure_rate.value !== null && (
              <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-700">Change Failure Rate</CardTitle>
                  <CardDescription className="text-xs">Success vs Failure breakdown of deployments</CardDescription>
                </CardHeader>
                <CardContent>
                  {changeFailureRateBreakdown && changeFailureRateBreakdown.breakdownData ? (
                    <MetricChart data={changeFailureRateBreakdown.breakdownData} color="#ef4444" chartType="pie" height={200} />
                  ) : (
                    <MetricChart data={metricHistory.change_failure_rate} color="#ef4444" />
                  )}
                  <div className="space-y-2">
                    <div className={`text-2xl font-bold ${getMetricColor("change_failure_rate", metrics.change_failure_rate.value)}`}>{formatMetricValue("change_failure_rate", metrics.change_failure_rate.value)}</div>
                    <div className="text-xs text-gray-500">{metrics.change_failure_rate.unit}</div>
                    {changeFailureRateBreakdown && (
                      <div className="text-xs text-gray-400">
                        Successful: {changeFailureRateBreakdown.successful} | Failed: {changeFailureRateBreakdown.failed} | Total: {changeFailureRateBreakdown.total}
                      </div>
                    )}
                    <div className="text-xs text-gray-400">Last updated: {metrics.change_failure_rate.timestamp ? new Date(metrics.change_failure_rate.timestamp).toLocaleTimeString() : '-'}</div>
                    <div className="mt-3">
                      <Button size="sm" variant="outline" disabled={!selectedDatasource || selectedDatasource?.type === 'all'} onClick={() => selectedDatasource && selectedDatasource.type !== 'all' && navigate(`/details?source=${selectedDatasource.type}&metric=change_failure_rate`)}>More Details</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Mean Time to Recovery (only if available) */}
            {getApplicableMetrics(primarySourceType || 'github').mean_time_to_recovery && metrics.mean_time_to_recovery && metrics.mean_time_to_recovery.value !== null && (
              <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-gray-700">Mean Time to Recovery</CardTitle>
                  <CardDescription className="text-xs">Average time to recover from failures</CardDescription>
                </CardHeader>
                <CardContent>
                  {metricHistory.mean_time_to_recovery && metricHistory.mean_time_to_recovery.length > 0 ? (
                    <MetricChart data={metricHistory.mean_time_to_recovery} color="#f59e0b" />
                  ) : (
                    <div className="h-48 bg-gray-100 rounded flex items-center justify-center text-gray-500">No data available</div>
                  )}
                  <div className="space-y-2">
                    <div className={`text-2xl font-bold ${getMetricColor("mean_time_to_recovery", metrics.mean_time_to_recovery.value)}`}>{formatMetricValue("mean_time_to_recovery", metrics.mean_time_to_recovery.value)}</div>
                    <div className="text-xs text-gray-500">{metrics.mean_time_to_recovery.unit}</div>
                    <div className="text-xs text-gray-400">Last updated: {metrics.mean_time_to_recovery.timestamp ? new Date(metrics.mean_time_to_recovery.timestamp).toLocaleTimeString() : '-'}</div>
                    <div className="mt-3">
                      <Button size="sm" variant="outline" disabled={!selectedDatasource || selectedDatasource?.type === 'all'} onClick={() => selectedDatasource && selectedDatasource.type !== 'all' && navigate(`/details?source=${selectedDatasource.type}&metric=mean_time_to_recovery`)}>More Details</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg">
            <CardContent className="flex items-center justify-center h-64">
              <div className="text-center space-y-4">
                <div className="text-lg font-medium text-gray-700">
                  {loading ? "Loading DORA metrics..." : "No metrics available"}
                </div>
                <div className="text-sm text-gray-500">
                  {loading
                    ? "Please wait while we fetch your data"
                    : !selectedDatasource && dataSources.length > 0
                    ? "Please select a datasource from above to view metrics"
                    : "Click on Configured Data Sources to add a source"}
                </div>
                {!loading && dataSources.length === 0 && (
                  <Button onClick={() => setIsConfiguring(true)}>
                    Configure Your First Data Source
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Dashboard;