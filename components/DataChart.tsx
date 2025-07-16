
import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import type { ProcessedDataRow } from '../types';

interface DataChartProps {
  data: ProcessedDataRow[];
}

type ChartType = 'Line' | 'Area' | 'Bar';

export const DataChart: React.FC<DataChartProps> = ({ data }) => {
  const [selectedMetrics, setSelectedMetrics] = useState<(keyof ProcessedDataRow)[]>(["V'O2", "HR"]);
  const [chartType, setChartType] = useState<ChartType>('Line');
  const colors = ['#00A8E8', '#E53E3E', '#38A169', '#DD6B20', '#805AD5', '#D53F8C'];

  const plottableMetrics = useMemo(() => {
    if (!data || data.length === 0) return [];
    return Object.keys(data[0]).filter(key =>
      typeof data[0][key as keyof ProcessedDataRow] === 'number' && key !== 'timeInSeconds'
    ) as (keyof ProcessedDataRow)[];
  }, [data]);

  const handleMetricChange = (metric: keyof ProcessedDataRow) => {
    setSelectedMetrics(prev =>
      prev.includes(metric) ? prev.filter(m => m !== metric) : [...prev, metric]
    );
  };

  const renderSeries = () => {
    const validSelectedMetrics = selectedMetrics.filter(m => plottableMetrics.includes(m));

    return validSelectedMetrics.map((metric, index) => {
      const color = colors[index % colors.length];
      const yAxisId = index % 2 === 0 ? 'left' : 'right';

      switch (chartType) {
        case 'Area':
          return <Area key={String(metric)} yAxisId={yAxisId} type="monotone" dataKey={metric} stroke={color} fill={color} fillOpacity={0.6} />;
        case 'Bar':
          return <Bar key={String(metric)} yAxisId={yAxisId} dataKey={metric} fill={color} />;
        case 'Line':
        default:
          return <Line key={String(metric)} yAxisId={yAxisId} type="monotone" dataKey={metric} stroke={color} dot={false} strokeWidth={2} />;
      }
    });
  };

  const ChartComponent = {
    Line: LineChart,
    Area: AreaChart,
    Bar: BarChart,
  }[chartType];

  return (
    <div className="bg-white shadow-md rounded-lg p-4 my-4" id="chart-container">
      <h3 className="text-xl font-bold text-brand-blue mb-4">Trend Chart (30s Smoothed Data)</h3>
      
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-3 bg-gray-50 rounded-lg">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-2">Chart Type</p>
            <div className="flex items-center space-x-1 p-1 bg-gray-200 rounded-lg">
              {(['Line', 'Area', 'Bar'] as ChartType[]).map(type => (
                <button
                  key={type}
                  onClick={() => setChartType(type)}
                  className={`px-4 py-1 text-sm font-semibold rounded-md transition-colors ${chartType === type ? 'bg-white text-brand-blue shadow' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
      </div>
      
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <p className="text-sm font-semibold text-gray-700 mb-2">Select Metrics to Display:</p>
        <div className="flex flex-wrap gap-2">
            {plottableMetrics.map(metric => (
                <button
                    key={String(metric)}
                    onClick={() => handleMetricChange(metric)}
                    className={`px-3 py-1 text-xs font-medium rounded-full transition-all duration-200 ${selectedMetrics.includes(metric) ? 'bg-brand-blue text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                >
                    {String(metric)}
                </button>
            ))}
        </div>
      </div>

      <div style={{ width: '100%', height: 400 }}>
        <ResponsiveContainer>
          <ChartComponent data={data} margin={{ top: 5, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="t" label={{ value: 'Time', position: 'insideBottom', offset: -15 }} />
            <YAxis yAxisId="left" stroke={colors[0]} />
            <YAxis yAxisId="right" orientation="right" stroke={colors[1]} />
            <Tooltip
                contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.9)', border: '1px solid #ccc', borderRadius: '0.5rem', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}
                formatter={(value: number, name: string) => [typeof value === 'number' ? value.toFixed(2) : value, name]}
            />
            <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '10px' }} />
            {renderSeries()}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
    </div>
  );
};