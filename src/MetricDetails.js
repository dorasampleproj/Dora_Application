import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { MetricChart } from './MetricChart';
import { PieChart, Pie, Cell, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Input } from './components/ui';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function buildSeriesFromDeployments(deployments = [], days = 90, dateField = 'deploy_time') {
  const today = new Date();
  const counts = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - (days - 1 - i));
    counts[d.toISOString().slice(0, 10)] = 0;
  }
  for (const d of deployments) {
    const raw = d[dateField] || d.run_started_at || d.created_at || d.created;
    if (!raw) continue;
    const day = new Date(raw).toISOString().slice(0, 10);
    if (counts[day] !== undefined) counts[day] += 1;
  }
  return Object.keys(counts).map((date) => ({ date, value: counts[date] }));
}

const MetricDetails = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const urlSource = params.get('source');

  // If URL doesn't provide a source, prefer the first configured datasource from sessionStorage
  let defaultSource = 'github';
  try {
    const sess = sessionStorage.getItem('dora_data_sources_session');
    if (sess) {
      const parsed = JSON.parse(sess);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
        defaultSource = parsed[0].type;
      }
    }
  } catch (e) {
    // ignore
  }

  const source = urlSource || defaultSource;
  const metric = params.get('metric') || 'deployment_frequency';
  const days = Number(params.get('days') || 90);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [details, setDetails] = useState({});
  const [series, setSeries] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [selectedDate, setSelectedDate] = useState(null);
  const [deploymentsFilter, setDeploymentsFilter] = useState('');
  const [changesFilter, setChangesFilter] = useState('');
  const [incidentsFilter, setIncidentsFilter] = useState('');
  const [deploymentsSort, setDeploymentsSort] = useState({ key: 'date', dir: 'desc' });
  const [changesSort, setChangesSort] = useState({ key: 'created', dir: 'desc' });
  const [incidentsSort, setIncidentsSort] = useState({ key: 'opened', dir: 'desc' });
  const [metricsData, setMetricsData] = useState({});
  const [chartMode, setChartMode] = useState(() => (metric === 'deployment_frequency' ? 'bar' : 'bar'));

  const copyToClipboard = async (text) => {
    try {
      if (!text) return;
      await navigator.clipboard.writeText(String(text));
      toast.success('Copied to clipboard');
    } catch (err) {
      console.error('Copy failed', err);
      toast.error('Copy failed');
    }
  };

  const getCommitIdFrom = (item) => {
    return (
      item.head_sha || (item.head_commit && (item.head_commit.id || item.head_commit.sha)) || (item.commit && item.commit.sha) || item.sha || item.after || item.merge_commit_sha || null
    );
  };

  const getLinkFor = (item) => {
    if (!item || typeof item !== 'object') return null;
    // common GitHub fields
    if (item.html_url) return item.html_url;
    if (item.pull_request && item.pull_request.html_url) return item.pull_request.html_url;
    if (item.repository && item.repository.html_url) return item.repository.html_url;
    if (item.commit && item.commit.html_url) return item.commit.html_url;
    if (item.head_commit && item.head_commit.url) return item.head_commit.url;
    // workflow runs often expose html_url
    if (item.run_number && item.html_url) return item.html_url;
    return null;
  };

  useEffect(() => {
    const fetchDetails = async () => {
      setLoading(true);
      setError(null);
      // Ensure we have a configured datasource for the requested source (ask backend)
      let matching = null;
      try {
        const resp = await axios.get(`${API}/data-sources`);
        const backendList = resp.data || [];
        matching = (backendList || []).find((s) => s && s.type === source);
      } catch (e) {
        // ignore and fallback to sessionStorage
        try {
          const sess = sessionStorage.getItem('dora_data_sources_session');
          const parsed = sess ? JSON.parse(sess) : [];
          matching = (parsed || []).find((s) => s && s.type === source);
        } catch (ee) {
          matching = null;
        }
      }
      if (!matching) {
        setError(`No configured data source for '${source}'. Configure it on the dashboard.`);
        setLoading(false);
        return;
      }
      try {
        let url;
        if (source === 'servicenow') {
          // For ServiceNow we can fetch both metrics (timeseries) and details
          url = `${API}/servicenow/details?days=${days}`;
        } else {
          url = `${API}/data-sources/details?days=${days}`;
        }

        // Fetch details and metrics in parallel so the chart uses the canonical series when available
        const detailsPromise = axios.get(url).then((r) => r.data || {});
        const metricsUrl = source === 'servicenow' ? `${API}/servicenow/metrics?days=${days}` : `${API}/data-sources/metrics?days=${days}`;
        const metricsPromise = axios.get(metricsUrl).then((r) => r.data || {}).catch(() => ({}));

        const [data, metrics] = await Promise.all([detailsPromise, metricsPromise]);
        setMetricsData(metrics || {});

        const deployments = data.deployments || data.workflow_runs || [];
        const changes = data.changes || data.pulls || [];
        const incidents = data.incidents || data.issues || [];

        setDetails({ deployments, changes, incidents });

        // Build an enriched series: for each day include deployments and PRs so tooltips can show rich info
        const seriesByDate = {};
        const today = new Date();
        for (let i = 0; i < days; i++) {
          const d = new Date(today);
          d.setDate(today.getDate() - (days - 1 - i));
          const key = d.toISOString().slice(0, 10);
          seriesByDate[key] = { date: key, value: 0, deployments: [], prs: [] };
        }

        // Attach deployments
        for (const dep of deployments) {
          const raw = dep.deploy_time || dep.run_started_at || dep.created_at || dep.created;
          if (!raw) continue;
          const day = new Date(raw).toISOString().slice(0, 10);
          if (!seriesByDate[day]) continue;
          seriesByDate[day].deployments.push(dep);
          seriesByDate[day].value = seriesByDate[day].deployments.length;
        }

        // Attach PRs/changes
        for (const pr of changes) {
          const raw = pr.sys_created_on || pr.created_at || pr.created || pr.merged_at;
          if (!raw) continue;
          const day = new Date(raw).toISOString().slice(0, 10);
          if (!seriesByDate[day]) continue;
          seriesByDate[day].prs.push(pr);
        }

        // If metrics endpoint provides canonical series, prefer it but merge details where possible
        let builtSeries = Object.values(seriesByDate);
        if (metrics && Array.isArray(metrics.deployment_frequency) && metrics.deployment_frequency.length > 0) {
          // map canonical series into our enriched shape
          const m = metrics.deployment_frequency.reduce((acc, p) => {
            acc[String(p.date).slice(0, 10)] = Number(p.value || 0);
            return acc;
          }, {});
          builtSeries = builtSeries.map((s) => ({ ...s, value: m[s.date] ?? s.value }));
        }

        setSeries(builtSeries);
      } catch (err) {
        console.error('Failed to fetch details', err);
        setError(err.message || 'Failed to fetch details');
      } finally {
        setLoading(false);
      }
    };
    fetchDetails();
  }, [source, days]);

  // Pagination for combined events table
  const [combinedPage, setCombinedPage] = useState(1);
  const combinedPageSize = 10;
  const [selectedRange, setSelectedRange] = useState(null);

  // Filtering helpers that respect selectedDate if set
  const matchesDate = (item, dateStr) => {
    if (!dateStr) return true;
    const d = dateStr.slice(0, 10);
    const candidates = [
      item.deploy_time,
      item.run_started_at,
      item.created_at,
      item.created,
      item.sys_created_on,
      item.opened_at,
      item.closed_at,
      item.merged_at,
    ];
    return candidates.some((c) => {
      if (!c) return false;
      try {
        return new Date(c).toISOString().slice(0, 10) === d;
      } catch (e) {
        return false;
      }
    });
  };

  const handlePointClick = (e) => {
    try {
      const payload = (e && e.activePayload && e.activePayload[0] && e.activePayload[0].payload) || (e && e.payload) || e;
      const date = payload && (payload.date || payload.payload?.date || payload[0]?.payload?.date);
      if (!date) return;
      // Toggle selection
      const dateKey = String(date).slice(0, 10);
      setSelectedDate((s) => (s === dateKey ? null : dateKey));
    } catch (err) {
      console.error('point click', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Details</h2>
            <div className="text-sm text-gray-600">Source: <Badge variant="secondary">{source}</Badge> • Metric: {metric}</div>
          </div>
          <div className="space-x-2">
            <Button variant="ghost" onClick={() => navigate(-1)}>Back</Button>
            <Button onClick={() => { window.location.reload(); }}>Refresh</Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Timeline for ({days} days)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div>Loading...</div>
            ) : error ? (
              <div className="text-red-600">{error}</div>
            ) : (
              <div>
                {/* ServiceNow: if change_failure_rate requested, show Pie */}
                {source === 'servicenow' && metric === 'change_failure_rate' ? (
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        {(() => {
                          const val = Number(metricsData?.change_failure_rate?.value ?? metricsData?.change_failure_rate ?? 0);
                          const failed = Math.max(0, Math.min(100, val));
                          const success = Math.max(0, 100 - failed);
                          const pieData = [{ name: 'Failed', value: failed }, { name: 'Successful', value: success }];
                          return (
                            <>
                              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label />
                              <Legend />
                            </>
                          );
                        })()}
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="text-sm text-gray-600 mt-2">Change failure rate (ServiceNow): {metricsData?.change_failure_rate?.value ?? metricsData?.change_failure_rate ?? 'N/A'}%</div>
                  </div>
                ) : (
                <>
                  {(source === 'github' && metric === 'deployment_frequency') && (
                    <div className="mb-2">
                      <Button size="sm" variant={chartMode === 'bar' ? 'default' : 'ghost'} onClick={() => setChartMode('bar')}>Bar</Button>
                      <Button size="sm" variant={chartMode === 'line' ? 'default' : 'ghost'} onClick={() => setChartMode('line')}>Line</Button>
                    </div>
                  )}
                  <MetricChart
                  data={series}
                  color="#10b981"
                  onPointClick={handlePointClick}
                  onBrushChange={(range) => {
                    try {
                      if (!range || typeof range.startIndex === 'undefined') return setSelectedRange(null);
                      const start = range.startIndex;
                      const end = range.endIndex;
                      const slice = series && series.slice(start, end + 1);
                      setSelectedRange({ startIndex: start, endIndex: end, slice });
                    } catch (e) {
                      console.warn('brush change', e);
                    }
                  }}
                  chartType={(source === 'github' && metric === 'lead_time') ? 'bar' : (source === 'github' && metric === 'deployment_frequency' ? chartMode : 'bar')}
                  height={220}
                  tooltipContent={(label, point) => {
                    return (
                      <div className="bg-white p-3 rounded shadow text-xs border max-w-xs">
                        <div className="font-medium mb-1">{new Date(label).toLocaleString()}</div>
                        <div className="mb-1">Count: {point.value || 0}</div>
                        {point.deployments && point.deployments.length > 0 && (
                          <div className="mb-1">
                            <div className="font-semibold">Deployments:</div>
                            {point.deployments.slice(0, 5).map((d, i) => (
                              <div key={i} className="text-[11px]">{(d.deploy_time || d.run_started_at || d.created_at || '').replace('T', ' ').slice(0, 19)} • {d.environment || d.status || d.conclusion || ''}</div>
                            ))}
                            {point.deployments.length > 5 && <div className="text-xs">+{point.deployments.length - 5} more</div>}
                          </div>
                        )}
                        {point.prs && point.prs.length > 0 && (
                          <div>
                            <div className="font-semibold">PRs/Changes:</div>
                            {point.prs.slice(0, 5).map((p, i) => (
                              <div key={i} className="text-[11px]">{p.number || p.sys_id || p.id} • {p.merged_at || p.implemented_on || p.sys_created_on || ''}</div>
                            ))}
                            {point.prs.length > 5 && <div className="text-xs">+{point.prs.length - 5} more</div>}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                </>
                )}
                <div className="text-sm text-gray-600 mt-2">{selectedDate ? `Showing items for ${selectedDate}` : 'Click a point to filter items by date'}</div>
                {selectedRange && (
                  <div className="text-sm text-gray-500">Selected range: {selectedRange.slice?.[0]?.date} → {selectedRange.slice?.[selectedRange.slice.length - 1]?.date}</div>
                )}
                {selectedDate && (
                  <Button size="sm" variant="ghost" onClick={() => setSelectedDate(null)}>Clear selection</Button>
                )}
                <div className="text-sm text-gray-500 mt-2">Use brush to select a range on the chart to zoom; click a bar to filter by single date.</div>
              </div>
            )}
          </CardContent>
        </Card>

        {source === 'servicenow' && (
          <Card>
            <CardHeader>
              <CardTitle>ServiceNow Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-600">Mean Time to Recovery</div>
                  <div className="text-xl font-semibold">{metricsData?.mean_time_to_recovery?.value ?? metricsData?.mean_time_to_recovery ?? 'N/A'} hrs</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Average deployments/day</div>
                  <div className="text-xl font-semibold">{metricsData?.deployment_frequency_summary?.average_per_day ?? (metricsData?.deployment_frequency_summary?.value ? (Number(metricsData.deployment_frequency_summary.value) / days).toFixed(2) : 'N/A')}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{selectedDate ? `Events for ${selectedDate}` : 'Select a date on the chart to see events'}</CardTitle>
          </CardHeader>
          <CardContent>
            {!selectedDate ? (
              <div className="text-sm text-gray-500">Click a bar on the timeline to view deployments, PRs and incidents for that date.</div>
            ) : (
              <div className="max-h-64 overflow-auto text-sm">
                {/* combined rows with pagination and drill links */}
                {(() => {
                  const rawRows = [
                    ...(details.deployments || []).filter((d) => matchesDate(d, selectedDate)).map((d) => ({
                      type: 'Deployment',
                      id: d.sys_id || d.id || d.run_id || '-',
                      time: d.deploy_time || d.run_started_at || d.created_at || d.created || '-',
                      summary: d.environment || d.status || d.conclusion || '-',
                      orig: d,
                    })),
                    ...(details.changes || []).filter((c) => matchesDate(c, selectedDate)).map((c) => ({
                      type: 'Change',
                      id: c.number || c.sys_id || c.id || '-',
                      time: c.implemented_on || c.merged_at || c.sys_created_on || c.created_at || '-',
                      summary: c.result || c.title || '-',
                      orig: c,
                    })),
                    ...(details.incidents || []).filter((i) => matchesDate(i, selectedDate)).map((i) => ({
                      type: 'Incident',
                      id: i.sys_id || i.id || '-',
                      time: i.opened_at || i.created_at || '-',
                      summary: i.severity || '-',
                      orig: i,
                    })),
                  ].sort((a, b) => new Date(a.time || 0) - new Date(b.time || 0));

                  const total = rawRows.length;
                  const totalPages = Math.max(1, Math.ceil(total / combinedPageSize));
                  const page = Math.min(Math.max(1, combinedPage), totalPages);
                  const start = (page - 1) * combinedPageSize;
                  const paged = rawRows.slice(start, start + combinedPageSize);

                  return (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-xs text-gray-600">Showing {start + 1}-{Math.min(start + combinedPageSize, total)} of {total}</div>
                        <div className="space-x-2">
                          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setCombinedPage((p) => Math.max(1, p - 1))}>Prev</Button>
                          <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setCombinedPage((p) => Math.min(totalPages, p + 1))}>Next</Button>
                        </div>
                      </div>
                      <table className="w-full text-left">
                        <thead>
                          <tr>
                            <th className="pr-2">Type</th>
                            <th className="pr-2">ID</th>
                            <th className="pr-2">Time</th>
                            <th className="pr-2">Summary</th>
                            <th className="pr-2">Link</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paged.map((row, idx) => {
                            const link = getLinkFor(row.orig);
                            return (
                              <tr key={idx} className="border-t">
                                <td className="pr-2 py-1 text-xs">{row.type}</td>
                                <td className="pr-2 py-1 text-xs">{row.id}</td>
                                <td className="pr-2 py-1 text-xs">{row.time ? new Date(row.time).toLocaleString() : '-'}</td>
                                <td className="pr-2 py-1 text-xs">{row.summary}</td>
                                <td className="pr-2 py-1 text-xs">{link ? <a className="underline text-blue-600" href={link} target="_blank" rel="noreferrer">Open</a> : '-'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Deployments ({details.deployments?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-2">
                <Input placeholder="Filter deployments..." value={deploymentsFilter} onChange={(e) => setDeploymentsFilter(e.target.value)} />
                <div className="text-sm text-gray-500">Sort:</div>
                <Button size="sm" variant="ghost" onClick={() => setDeploymentsSort((s) => ({ key: 'date', dir: s.dir === 'asc' ? 'desc' : 'asc' }))}>
                  Date {deploymentsSort.key === 'date' ? (deploymentsSort.dir === 'asc' ? '↑' : '↓') : ''}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeploymentsSort((s) => ({ key: 'commit', dir: s.dir === 'asc' ? 'desc' : 'asc' }))}>
                  Commit {deploymentsSort.key === 'commit' ? (deploymentsSort.dir === 'asc' ? '↑' : '↓') : ''}
                </Button>
              </div>
              <div className="max-h-56 overflow-auto text-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th className="pr-2">ID</th>
                      <th className="pr-2">Time</th>
                      <th className="pr-2">Commit</th>
                      <th className="pr-2">Env/Status</th>
                      <th className="pr-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {((details.deployments || [])
                      .filter((d) => (!deploymentsFilter || JSON.stringify(d).toLowerCase().includes(deploymentsFilter.toLowerCase())) && matchesDate(d, selectedDate))
                      .sort((a, b) => {
                        if (deploymentsSort.key === 'commit') {
                          const ca = (getCommitIdFrom(a) || '').toLowerCase();
                          const cb = (getCommitIdFrom(b) || '').toLowerCase();
                          return deploymentsSort.dir === 'asc' ? ca.localeCompare(cb) : cb.localeCompare(ca);
                        }
                        // default sort by date
                        const da = new Date(a.run_started_at || a.deploy_time || a.created_at || a.created || 0).getTime();
                        const db = new Date(b.run_started_at || b.deploy_time || b.created_at || b.created || 0).getTime();
                        return deploymentsSort.dir === 'asc' ? da - db : db - da;
                      })
                      .map((d, idx) => {
                        const id = d.sys_id || d.id || d.run_id || `idx-${idx}`;
                        const isOpen = !!expanded[id];
                        const commit = getCommitIdFrom(d);
                        const link = getLinkFor(d);
                        return (
                          <React.Fragment key={id}>
                            <tr className="border-t">
                              <td className="pr-2 py-1 text-xs">{id}</td>
                              <td className="pr-2 py-1 text-xs">{d.deploy_time || d.run_started_at || d.created_at || '-'}</td>
                              <td className="pr-2 py-1 text-xs">
                                {commit ? (
                                  <div className="flex items-center gap-2">
                                    {link ? <a className="underline text-blue-600" href={link} target="_blank" rel="noreferrer">{commit.substring(0, 10)}</a> : <span>{commit.substring(0, 10)}</span>}
                                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(commit)}>Copy</Button>
                                  </div>
                                ) : (
                                  '-'
                                )}
                              </td>
                              <td className="pr-2 py-1 text-xs">{d.environment || d.status || d.conclusion || '-'}</td>
                              <td className="pr-2 py-1 text-xs">
                                <Button size="sm" variant="ghost" onClick={() => setExpanded((s) => ({ ...s, [id]: !s[id] }))}>
                                  {isOpen ? 'Hide' : 'Show'} JSON
                                </Button>
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-gray-50">
                                <td colSpan={5} className="p-2 text-xs">
                                  <pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify(d, null, 2)}</pre>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      }))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Changes / Pull Requests ({details.changes?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-2">
                <Input placeholder="Filter PRs/changes..." value={changesFilter} onChange={(e) => setChangesFilter(e.target.value)} />
                <div className="text-sm text-gray-500">Sort:</div>
                <Button size="sm" variant="ghost" onClick={() => setChangesSort((s) => ({ key: 'created', dir: s.dir === 'asc' ? 'desc' : 'asc' }))}>
                  Created {changesSort.key === 'created' ? (changesSort.dir === 'asc' ? '↑' : '↓') : ''}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setChangesSort((s) => ({ key: 'commit', dir: s.dir === 'asc' ? 'desc' : 'asc' }))}>
                  Commit {changesSort.key === 'commit' ? (changesSort.dir === 'asc' ? '↑' : '↓') : ''}
                </Button>
              </div>
              <div className="max-h-56 overflow-auto text-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th className="pr-2">ID / Number</th>
                      <th className="pr-2">Created</th>
                      <th className="pr-2">Commit</th>
                      <th className="pr-2">Implemented</th>
                      <th className="pr-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {((details.changes || [])
                      .filter((c) => (!changesFilter || JSON.stringify(c).toLowerCase().includes(changesFilter.toLowerCase())) && matchesDate(c, selectedDate))
                      .sort((a, b) => {
                        if (changesSort.key === 'commit') {
                          const ca = (getCommitIdFrom(a) || '').toLowerCase();
                          const cb = (getCommitIdFrom(b) || '').toLowerCase();
                          return changesSort.dir === 'asc' ? ca.localeCompare(cb) : cb.localeCompare(ca);
                        }
                        const da = new Date(a.created_at || a.sys_created_on || a.created || 0).getTime();
                        const db = new Date(b.created_at || b.sys_created_on || b.created || 0).getTime();
                        return changesSort.dir === 'asc' ? da - db : db - da;
                      })
                      .map((c, idx) => {
                        const id = c.number || c.sys_id || c.id || `chg-${idx}`;
                        const isOpen = !!expanded[id];
                        const commit = getCommitIdFrom(c);
                        const link = getLinkFor(c);
                        return (
                          <React.Fragment key={id}>
                            <tr className="border-t">
                              <td className="pr-2 py-1 text-xs">{id}</td>
                              <td className="pr-2 py-1 text-xs">{c.sys_created_on || c.created_at || c.created || '-'}</td>
                              <td className="pr-2 py-1 text-xs">
                                {commit ? (
                                  <div className="flex items-center gap-2">
                                    {link ? <a className="underline text-blue-600" href={link} target="_blank" rel="noreferrer">{commit.substring(0, 10)}</a> : <span>{commit.substring(0, 10)}</span>}
                                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(commit)}>Copy</Button>
                                  </div>
                                ) : (
                                  '-'
                                )}
                              </td>
                              <td className="pr-2 py-1 text-xs">{c.implemented_on || c.merged_at || '-'}</td>
                              <td className="pr-2 py-1 text-xs">
                                <Button size="sm" variant="ghost" onClick={() => setExpanded((s) => ({ ...s, [id]: !s[id] }))}>
                                  {isOpen ? 'Hide' : 'Show'} JSON
                                </Button>
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-gray-50">
                                <td colSpan={5} className="p-2 text-xs">
                                  <pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify(c, null, 2)}</pre>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      }))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Incidents / Issues ({details.incidents?.length || 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 mb-2">
                <Input placeholder="Filter incidents..." value={incidentsFilter} onChange={(e) => setIncidentsFilter(e.target.value)} />
                <div className="text-sm text-gray-500">Sort:</div>
                <Button size="sm" variant="ghost" onClick={() => setIncidentsSort((s) => ({ key: 'opened', dir: s.dir === 'asc' ? 'desc' : 'asc' }))}>
                  Opened {incidentsSort.key === 'opened' ? (incidentsSort.dir === 'asc' ? '↑' : '↓') : ''}
                </Button>
              </div>
              <div className="max-h-56 overflow-auto text-sm">
                <table className="w-full text-left">
                  <thead>
                    <tr>
                      <th className="pr-2">ID</th>
                      <th className="pr-2">Opened</th>
                      <th className="pr-2">Closed</th>
                      <th className="pr-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {((details.incidents || [])
                      .filter((i) => (!incidentsFilter || JSON.stringify(i).toLowerCase().includes(incidentsFilter.toLowerCase())) && matchesDate(i, selectedDate))
                      .sort((a, b) => {
                        const da = new Date(a.opened_at || a.created_at || a.created || 0).getTime();
                        const db = new Date(b.opened_at || b.created_at || b.created || 0).getTime();
                        return incidentsSort.dir === 'asc' ? da - db : db - da;
                      })
                      .map((i, idx) => {
                        const id = i.sys_id || i.id || `inc-${idx}`;
                        const isOpen = !!expanded[id];
                        const link = getLinkFor(i);
                        return (
                          <React.Fragment key={id}>
                            <tr className="border-t">
                              <td className="pr-2 py-1 text-xs">{id}</td>
                              <td className="pr-2 py-1 text-xs">{i.opened_at || i.created_at || i.created || '-'}</td>
                              <td className="pr-2 py-1 text-xs">{i.closed_at || i.closed || i.closed_at || '-'}</td>
                              <td className="pr-2 py-1 text-xs">
                                <div className="flex items-center gap-2">
                                  {link ? <a className="underline text-blue-600" href={link} target="_blank" rel="noreferrer">View</a> : null}
                                  <Button size="sm" variant="ghost" onClick={() => setExpanded((s) => ({ ...s, [id]: !s[id] }))}>
                                    {isOpen ? 'Hide' : 'Show'} JSON
                                  </Button>
                                </div>
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-gray-50">
                                <td colSpan={4} className="p-2 text-xs">
                                  <pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify(i, null, 2)}</pre>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      }))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default MetricDetails;
