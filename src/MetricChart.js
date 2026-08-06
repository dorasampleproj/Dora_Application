import React from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Brush,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

export const MetricChart = ({ data, color, onPointClick, tooltipContent, chartType = 'line', height = 160, onBrushChange }) => {
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    const point = payload[0].payload || {};
    if (typeof tooltipContent === 'function') {
      return tooltipContent(label, point);
    }
    // Default tooltip
    return (
      <div className="bg-white p-2 rounded shadow text-xs border">
        <div className="font-medium">{new Date(label).toLocaleString()}</div>
        <div>Value: {typeof point.value === 'number' ? point.value.toFixed(2) : String(point.value)}</div>
      </div>
    );
  };

  const commonProps = {
    data,
    margin: { top: 5, right: 5, left: 5, bottom: 5 },
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      {chartType === 'pie' ? (
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={(entry) => `${entry.name}: ${entry.percentage}%`}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
            onClick={(e) => onPointClick && onPointClick(e)}
          >
            {data && data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill || color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => `${value} changes`}
            labelFormatter={(label) => {
              const entry = data && data.find((d) => d.name === label);
              return entry ? `${entry.name} (${entry.percentage}%)` : label;
            }}
          />
          <Legend />
        </PieChart>
      ) : chartType === 'stacked' ? (
        <BarChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="date" tickFormatter={(d) => new Date(d).toLocaleDateString()} angle={-45} textAnchor="end" height={48} />
          <YAxis allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          {data && data.length > 0 && data[0].success !== undefined ? (
            <>
              <Bar dataKey="success" stackId="a" fill="#10b981" name="Success" onClick={(e) => onPointClick && onPointClick(e)} />
              <Bar dataKey="failed" stackId="a" fill="#ef4444" name="Failed" onClick={(e) => onPointClick && onPointClick(e)} />
            </>
          ) : (
            <>
              <Bar dataKey="average" stackId="a" fill="#6366f1" name="Average" onClick={(e) => onPointClick && onPointClick(e)} />
              <Bar dataKey="median" stackId="a" fill="#8b5cf6" name="Median" onClick={(e) => onPointClick && onPointClick(e)} />
            </>
          )}
          <Legend />
          <Brush dataKey="date" height={24} stroke={color} onChange={(range) => onBrushChange && onBrushChange(range)} />
        </BarChart>
      ) : chartType === 'bar' ? (
        <BarChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="date" tickFormatter={(d) => new Date(d).toLocaleDateString()} angle={-45} textAnchor="end" height={48} />
          <YAxis allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="value" fill={color} onClick={(e) => onPointClick && onPointClick(e)} />
          <Brush dataKey="date" height={24} stroke={color} onChange={(range) => onBrushChange && onBrushChange(range)} />
        </BarChart>
      ) : (
        <LineChart {...commonProps}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="date" tickFormatter={(d) => new Date(d).toLocaleDateString()} />
          <YAxis />
          <Tooltip content={<CustomTooltip />} />
          <Brush dataKey="date" height={24} stroke={color} onChange={(range) => onBrushChange && onBrushChange(range)} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={onPointClick ? { r: 3, stroke: color, onClick: (e) => onPointClick && onPointClick(e) } : false}
            activeDot={onPointClick ? { r: 4 } : false}
            cursor={onPointClick ? 'pointer' : 'default'}
          />
        </LineChart>
      )}
    </ResponsiveContainer>
  );
};