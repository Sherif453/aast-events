'use client';

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';

interface ConversionChartProps {
    data: { name: string; rsvps: number; checkedIn: number; rate: number }[];
}

export default function ConversionChart({ data }: ConversionChartProps) {
    return (
        <ResponsiveContainer width="100%" height={400}>
            <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="rsvps" fill="#3B82F6" name="RSVPs" />
                <Bar dataKey="checkedIn" fill="#10B981" name="Checked In" />
            </BarChart>
        </ResponsiveContainer>
    );
}