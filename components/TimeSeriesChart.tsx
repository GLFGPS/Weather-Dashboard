'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TimeSeriesData } from '@/types';

interface TimeSeriesChartProps {
  data: TimeSeriesData[];
  title: string;
  lines: {
    dataKey: string;
    name: string;
    color: string;
    yAxisId?: string;
  }[];
  showDualAxis?: boolean;
}

export default function TimeSeriesChart({ data, title, lines, showDualAxis = false }: TimeSeriesChartProps) {
  return (
    <div className="w-full">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12 }}
            tickFormatter={(date) => {
              const d = new Date(date);
              return `${d.getMonth() + 1}/${d.getDate()}`;
            }}
          />
          <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
          {showDualAxis && <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />}
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(255, 255, 255, 0.95)',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '12px',
            }}
            labelFormatter={(date) => new Date(date).toLocaleDateString()}
          />
          <Legend />
          {lines.map((line) => (
            <Line
              key={line.dataKey}
              type="monotone"
              dataKey={line.dataKey}
              name={line.name}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              yAxisId={line.yAxisId || 'left'}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
