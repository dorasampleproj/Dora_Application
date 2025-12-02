import React, { useState, useEffect } from "react";
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
    { date: "2025-10-21", value: 72 },
    { date: "2025-10-22", value: 58 },
    { date: "2025-10-23", value: 45 },
    { date: "2025-10-24", value: 52 },
    { date: "2025-10-25", value: 48 },
    { date: "2025-10-26", value: 36 },
    { date: "2025-10-27", value: 42 },
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
  const [metrics, setMetrics] = useState(defaultMetrics);
  const [dataSources, setDataSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isConfiguring, setIsConfiguring] = useState(false);
  const [newDataSource, setNewDataSource] = useState({
    name: "",
    type: "",
    config: {},
  });
  const [metricHistory, setMetricHistory] = useState(sampleHistoricalData);

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

  const fetchMetrics = async (dataSourcesOverride) => {
    try {
      setLoading(true);
      const githubMetrics = await fetchGitHubMetrics();
      const ds = dataSourcesOverride ? dataSources;

      // Helper to safely coerce different shapes into a number
      const toNumber = (v, fallback = 0) => {
        if (v == null) return fallback;
        if (typeof v === "object") {
          if ("value" in v) return Number(v.value ?? fallback) || fallback;
          return Number(v) || fallback;
        }
        const n = Number(v);
        return Number.isNaN(n) ? fallback : n;
      };

      // Defaults
      let deploymentSeries = sampleHistoricalData.deployment_frequency;
      let deploymentSummaryValue = defaultMetrics.deployment_frequency.value;

      if (!!ds?.length && githubMetrics) {
        if (Array.isArray(githubMetrics.deployment_frequency)) {
          // Ensure series values are numeric
          console.log(
            "Deployment Frequency Series:",
            githubMetrics.deployment_frequency
          );
          deploymentSeries = githubMetrics.deployment_frequency.map((p) => ({
            date: String(p.date),
            value: toNumber(p.value, 0),
          }));
          const total = deploymentSeries.reduce(
            (s, p) => s + (p.value || 0),
            0
          );
          deploymentSummaryValue = total / Math.max(deploymentSeries.length, 1);
          console.log(
            "Calculated Deployment Summary Value:",
            deploymentSummaryValue
          );
        } else if (
          githubMetrics.deployment_frequency_summary &&
          typeof githubMetrics.deployment_frequency_summary.value !==
            "undefined"
        ) {
          deploymentSummaryValue = toNumber(
            githubMetrics.deployment_frequency_summary.value,
            defaultMetrics.deployment_frequency.value
          );
        } else if (
          typeof githubMetrics.deployment_frequency === "number" ||
          typeof githubMetrics.deployment_frequency === "string"
        ) {
          deploymentSummaryValue = toNumber(
            githubMetrics.deployment_frequency,
            defaultMetrics.deployment_frequency.value
          );
        }
      }

      // push series into history state for charting
      setMetricHistory((prev) => ({
        ...prev,
        deployment_frequency: deploymentSeries,
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
          value: toNumber(
            githubMetrics?.lead_time?.value ?? githubMetrics?.lead_time,
            defaultMetrics.lead_time.value
          ),
          unit: "hours",
          timestamp: new Date().toISOString(),
        },
        change_failure_rate: {
          value: toNumber(
            githubMetrics?.change_failure_rate?.value ??
              githubMetrics?.change_failure_rate,
            defaultMetrics.change_failure_rate.value
          ),
          unit: "percent",
          timestamp: new Date().toISOString(),
        },
        mean_time_to_recovery: {
          value: toNumber(
            githubMetrics?.mean_time_to_recovery?.value ??
              githubMetrics?.mean_time_to_recovery,
            defaultMetrics.mean_time_to_recovery.value
          ),
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

  const fetchDataSources = async () => {
    try {
      const response = await axios.get(`${API}/data-sources`); // Use the full API URL
      setDataSources(response.data);
      return response.data;
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
          const ds = await fetchDataSources();
          setIsConfiguring(false);
          setNewDataSource({ name: "", type: "", config: {} });
          await fetchMetrics(ds);
        } else {
          throw new Error("Unexpected response status: " + response.status);
        }
      }
    } catch (error) {
      console.error("Failed to create data source:", error);
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
      default:
        return <div>Please select a data source type</div>;
    }
  };

  useEffect(() => {
    // Initial fetch
    const initializeData = async () => {
      try {
        setLoading(true);
        await Promise.all([
          fetchMetrics(),
          //fetchDataSources()
        ]);
      } catch (error) {
        console.error("Failed to initialize data:", error);
        toast.error("Failed to load initial data");
      } finally {
        setLoading(false);
      }
    };

    initializeData();

    // Set up auto-refresh
    const interval = setInterval(fetchMetrics, 300000);
    return () => clearInterval(interval);
  }, []);

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
    const n =
      value && typeof value === "object" && "value" in value
        ? Number(value.value)
        : Number(value);
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
    const n =
      value && typeof value === "object" && "value" in value
        ? Number(value.value)
        : Number(value);
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
            Data Sources: {dataSources.length} configured
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
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* DORA Metrics Grid */}
        {metrics ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Deployment Frequency */}
            <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-700">
                  Deployment Frequency
                </CardTitle>
                <CardDescription className="text-xs">
                  How often deployments occur
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MetricChart
                  data={metricHistory.deployment_frequency}
                  color="#10b981"
                />
                <div className="space-y-2">
                  <div
                    className={`text-2xl font-bold ${getMetricColor(
                      "deployment_frequency",
                      metrics.deployment_frequency.value
                    )}`}
                  >
                    {formatMetricValue(
                      "deployment_frequency",
                      metrics.deployment_frequency.value
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {metrics.deployment_frequency.unit}
                  </div>
                  <div className="text-xs text-gray-400">
                    Last updated:{" "}
                    {new Date(
                      metrics.deployment_frequency.timestamp
                    ).toLocaleTimeString()}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Lead Time */}
            <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-700">
                  Lead Time for Changes
                </CardTitle>
                <CardDescription className="text-xs">
                  Time from code committed to production
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MetricChart
                  data={sampleHistoricalData.lead_time}
                  color="#6366f1"
                />
                <div className="space-y-2">
                  <div
                    className={`text-2xl font-bold ${getMetricColor(
                      "lead_time",
                      metrics.lead_time.value
                    )}`}
                  >
                    {formatMetricValue("lead_time", metrics.lead_time.value)}
                  </div>
                  <div className="text-xs text-gray-500">average time</div>
                  <div className="text-xs text-gray-400">
                    Last updated:{" "}
                    {new Date(metrics.lead_time.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Change Failure Rate */}
            <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-700">
                  Change Failure Rate
                </CardTitle>
                <CardDescription className="text-xs">
                  Percentage of deployments causing failures
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MetricChart
                  data={sampleHistoricalData.change_failure_rate}
                  color="#ef4444"
                />
                <div className="space-y-2">
                  <div
                    className={`text-2xl font-bold ${getMetricColor(
                      "change_failure_rate",
                      metrics.change_failure_rate.value
                    )}`}
                  >
                    {formatMetricValue(
                      "change_failure_rate",
                      metrics.change_failure_rate.value
                    )}
                  </div>
                  <div className="text-xs text-gray-500">of deployments</div>
                  <div className="text-xs text-gray-400">
                    Last updated:{" "}
                    {new Date(
                      metrics.change_failure_rate.timestamp
                    ).toLocaleTimeString()}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Mean Time to Recovery */}
            <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-lg hover:shadow-xl transition-all duration-300">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-700">
                  Mean Time to Recovery
                </CardTitle>
                <CardDescription className="text-xs">
                  Average time to recover from failures
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MetricChart
                  data={sampleHistoricalData.mean_time_to_recovery}
                  color="#f59e0b"
                />
                <div className="space-y-2">
                  <div
                    className={`text-2xl font-bold ${getMetricColor(
                      "mean_time_to_recovery",
                      metrics.mean_time_to_recovery.value
                    )}`}
                  >
                    {formatMetricValue(
                      "mean_time_to_recovery",
                      metrics.mean_time_to_recovery.value
                    )}
                  </div>
                  <div className="text-xs text-gray-500">to recover</div>
                  <div className="text-xs text-gray-400">
                    Last updated:{" "}
                    {new Date(
                      metrics.mean_time_to_recovery.timestamp
                    ).toLocaleTimeString()}
                  </div>
                </div>
              </CardContent>
            </Card>
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
                    : "Configure a data source to start tracking metrics"}
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