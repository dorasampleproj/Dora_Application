import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

export const MetricChart = ({ data, color, onPointClick }) => (
  <ResponsiveContainer width="100%" height={100}>
    <LineChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
      <XAxis dataKey="date" hide />
      <YAxis hide />
      <Tooltip
        formatter={(value) => [typeof value === 'number' ? value.toFixed(2) : value, "Value"]}
        labelFormatter={(label) => new Date(label).toLocaleDateString()}
      />
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
  </ResponsiveContainer>
);