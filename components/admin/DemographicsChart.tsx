'use client';

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

interface DemographicsChartProps {
    data: { [key: string]: string | number }[];
    dataKey: string;
}

export default function DemographicsChart({ data, dataKey }: DemographicsChartProps) {
    const chartData = data.map((item, index) => ({
        name: item[dataKey],
        value: item.count,
        fill: COLORS[index % COLORS.length],
    }));

    return (
        <ResponsiveContainer width="100%" height={300}>
            <PieChart>
                <Pie
                    data={chartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label
                >
                    {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                </Pie>
                <Tooltip />
                <Legend />
            </PieChart>
        </ResponsiveContainer>
    );
}