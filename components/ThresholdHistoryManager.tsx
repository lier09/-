import React, { FC } from 'react';
import type { AnalysisRecord } from '../types';

interface ThresholdHistoryManagerProps {
    history: AnalysisRecord[];
    onLoad: (id: string) => void;
    onDelete: (id: string) => void;
    onClearAll: () => void;
}

export const ThresholdHistoryManager: FC<ThresholdHistoryManagerProps> = ({ history, onLoad, onDelete, onClearAll }) => {
    const testTypeLabels: Record<'pre' | 'mid' | 'post', string> = {
        pre: '前测',
        mid: '中测',
        post: '后测',
    };

    if (history.length === 0) {
        return (
            <div className="text-center py-8">
                 <h3 className="text-2xl font-bold text-brand-blue">分析历史记录</h3>
                 <p className="text-gray-500 mt-2">暂无历史记录。</p>
            </div>
        );
    }

    return (
        <div className="mt-12">
            <div className="flex justify-between items-center mb-4">
                 <h3 className="text-2xl font-bold text-brand-blue text-center flex-1">分析历史记录</h3>
                 <button onClick={onClearAll} className="px-3 py-1 bg-red-600 text-white text-xs font-semibold rounded-lg shadow-md hover:bg-red-700 transition">清空全部</button>
            </div>
            <div className="bg-white p-4 rounded-lg shadow-xl max-h-96 overflow-y-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                        <tr>
                            <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">受试者</th>
                            <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">测试类型</th>
                            <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">分析时间</th>
                            <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">LT (V̇O₂)</th>
                            <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">RCP (V̇O₂)</th>
                            <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">操作</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {history.map(record => (
                            <tr key={record.id} className="hover:bg-gray-50">
                                <td className="px-4 py-4 whitespace-nowrap font-medium text-gray-800">{record.subjectName}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-gray-500">{testTypeLabels[record.testType]}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-gray-500">{new Date(record.timestamp).toLocaleString()}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-red-600">{record.ltVo2?.toFixed(3) ?? 'N/A'}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-green-600">{record.rcpVo2?.toFixed(3) ?? 'N/A'}</td>
                                <td className="px-4 py-4 whitespace-nowrap space-x-2">
                                    <button onClick={() => onLoad(record.id)} className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600">加载</button>
                                    <button onClick={() => onDelete(record.id)} className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">删除</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
