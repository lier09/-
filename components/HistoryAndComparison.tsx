import React, { useState, useMemo, useCallback } from 'react';
import { LineChart, Line, BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { BatchResult, KeyMetrics, ProcessedDataRow } from '../types';
import { exportToXlsx } from '../utils/fileUtils';
import { DataTable } from './DataTable';
import { applySortOrder } from '../utils/sortingUtils';

// --- Sub-Components ---
const SubjectComparisonChart: React.FC<{tests: BatchResult[]}> = ({ tests }) => {
    const [chartMetric, setChartMetric] = useState<keyof KeyMetrics>('vo2max_kg');
    const [chartType, setChartType] = useState<'bar' | 'line' | 'area'>('bar');
    
    const chartMetricsOptions: { key: keyof KeyMetrics; label: string; unit: string; }[] = [
        { key: 'vo2max_kg', label: 'V\'O₂/kg', unit: 'mL/min/kg' },
        { key: 'vo2max', label: 'V\'O₂', unit: 'L/min' },
        { key: 'hrmax', label: 'HRmax', unit: 'bpm' },
        { key: 'vemax', label: 'VEmax', unit: 'L/min' },
        { key: 'rermax', label: 'RERmax', unit: '' },
        { key: 'duration', label: '总时长', unit: 's' }
    ];

    const comparisonTests = tests
        .filter(t => t.testType !== 'unspecified')
        .sort((a, b) => {
            const order: Record<string, number> = { 'pre': 1, 'mid': 2, 'post': 3 };
            return order[a.testType] - order[b.testType];
        });
    
    if(comparisonTests.length < 2) {
        return <p className="text-center text-gray-500 py-4">请为至少两个测试指定“前/中/后测”类型以生成对比图。</p>
    }

    const selectedMetricInfo = chartMetricsOptions.find(m => m.key === chartMetric)!;

    const chartData = comparisonTests.map(item => ({
        name: item.testType === 'pre' ? '前测' : item.testType === 'mid' ? '中测' : '后测',
        value: typeof item.metrics[chartMetric] === 'number' ? (item.metrics[chartMetric] as number) : 0
    }));

    const ChartComponent = chartType === 'bar' ? BarChart : chartType === 'line' ? LineChart : AreaChart;
    const ChartSeries = chartType === 'bar' 
        ? <Bar dataKey="value" name={selectedMetricInfo.label} fill="#00A8E8" />
        : chartType === 'line' 
        ? <Line type="monotone" dataKey="value" name={selectedMetricInfo.label} stroke="#00A8E8" strokeWidth={2} />
        : <Area type="monotone" dataKey="value" name={selectedMetricInfo.label} stroke="#00A8E8" fill="#00A8E8" fillOpacity={0.3} />;

    return (
         <div className="bg-white shadow-xl rounded-2xl p-6 my-6">
            <h3 className="text-2xl font-bold text-brand-blue mb-4 text-center">受试者指标对比图</h3>
            
            <div className="flex flex-col md:flex-row justify-center items-center gap-6 mb-6 p-4 bg-gray-50 rounded-lg">
                <div>
                    <label htmlFor="chart-metric-select" className="block text-sm font-medium text-gray-700 mb-1">选择指标:</label>
                    <select
                        id="chart-metric-select"
                        value={chartMetric}
                        onChange={(e) => setChartMetric(e.target.value as keyof KeyMetrics)}
                        className="p-2 border border-gray-300 rounded-md shadow-sm focus:ring-brand-accent focus:border-brand-accent"
                    >
                        {chartMetricsOptions.map(opt => (
                            <option key={String(opt.key)} value={opt.key}>{opt.label}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <p className="block text-sm font-medium text-gray-700 mb-1">图表类型:</p>
                    <div className="flex items-center space-x-1 p-1 bg-gray-200 rounded-lg">
                        {(['bar', 'line', 'area'] as const).map(type => (
                            <button key={type} onClick={() => setChartType(type)} className={`px-4 py-1 text-sm font-semibold rounded-md transition-colors ${chartType === type ? 'bg-white text-brand-blue shadow' : 'text-gray-600 hover:bg-gray-100'}`}>{type.charAt(0).toUpperCase() + type.slice(1)}</button>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ width: '100%', height: 400 }}>
                <ResponsiveContainer>
                    <ChartComponent data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" />
                        <YAxis allowDuplicatedCategory={false} label={{ value: selectedMetricInfo.unit, angle: -90, position: 'insideLeft' }} />
                        <Tooltip formatter={(value: number) => [typeof value === 'number' ? value.toFixed(2) : value, selectedMetricInfo.label]} />
                        <Legend />
                        {ChartSeries}
                    </ChartComponent>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

const ActionsBar: React.FC<{ selectedCount: number; onDeleteSelected: () => void; onClearHistory: () => void; }> = ({ selectedCount, onDeleteSelected, onClearHistory }) => (
    <div className="bg-gray-50 rounded-lg shadow p-4 mb-6 flex justify-end items-center gap-4 border">
        {selectedCount > 0 && (
            <button onClick={onDeleteSelected} className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 transition">
                删除选中项 ({selectedCount})
            </button>
        )}
        <button onClick={onClearHistory} className="px-4 py-2 bg-gray-700 text-white font-semibold rounded-lg shadow-md hover:bg-gray-800 transition">
            清空所有记录
        </button>
    </div>
);

interface HistoryAndComparisonProps {
    data: BatchResult[];
    setData: React.Dispatch<React.SetStateAction<BatchResult[]>>;
}

export const HistoryAndComparison: React.FC<HistoryAndComparisonProps> = ({ data, setData }) => {
    const [expandedSubject, setExpandedSubject] = useState<string | null>(null);
    const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
    const [sortOrderText, setSortOrderText] = useState('');
    const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());

    const subjects = useMemo(() => {
        const grouped = data.reduce((acc, result) => {
            (acc[result.fileName] = acc[result.fileName] || []).push(result);
            return acc;
        }, {} as Record<string, BatchResult[]>);
        // Sort tests within each subject by test type (pre, mid, post)
        Object.keys(grouped).forEach(subjectName => {
            grouped[subjectName].sort((a, b) => {
                 const order: Record<string, number> = { 'pre': 1, 'mid': 2, 'post': 3, 'unspecified': 4 };
                 return order[a.testType] - order[b.testType];
            });
        });
        return grouped;
    }, [data]);
    
    const sortedSubjectNames = useMemo(() => {
        const order = sortOrderText.split(/[\r\n]+/).map(name => name.trim()).filter(Boolean);
        const subjectNames = Object.keys(subjects);
        if (order.length === 0) return subjectNames.sort((a, b) => a.localeCompare(b));
        
        const subjectsForSorting = subjectNames.map(name => ({ fileName: name }));
        const sorted = applySortOrder(subjectsForSorting, order);
        return sorted.map(s => s.fileName);
    }, [subjects, sortOrderText]);
    
    const handleClearHistory = useCallback(() => {
        if (window.confirm('确定要清空所有历史记录吗？此操作无法撤销。')) {
            setData([]);
            setSelectedTests(new Set());
        }
    }, [setData]);
    
    const handleTestTypeChange = useCallback((testId: string, newType: BatchResult['testType']) => {
        setData(currentData => currentData.map(test => 
            test.id === testId ? { ...test, testType: newType } : test
        ));
    }, [setData]);

    const handleToggleSelectTest = useCallback((testId: string) => {
        setSelectedTests(prev => {
            const newSet = new Set(prev);
            if (newSet.has(testId)) newSet.delete(testId);
            else newSet.add(testId);
            return newSet;
        });
    }, []);
    
    const handleSelectAllForSubject = useCallback((subjectName: string) => {
        const testIds = subjects[subjectName]?.map(t => t.id) ?? [];
        if (testIds.length === 0) return;

        const allSelected = testIds.every(id => selectedTests.has(id));

        setSelectedTests(currentSelected => {
            const newSelected = new Set(currentSelected);
            if (allSelected) {
                testIds.forEach(id => newSelected.delete(id));
            } else {
                testIds.forEach(id => newSelected.add(id));
            }
            return newSelected;
        });
    }, [subjects, selectedTests]);

    const handleDeleteSelected = useCallback(() => {
        if (selectedTests.size === 0) return;
        const count = selectedTests.size;
        
        // Directly perform deletion without confirmation to ensure it works.
        console.log(`已删除 ${count} 条记录。`);
        
        setData(currentData =>
          currentData.filter(test => !selectedTests.has(test.id))
        );
        
        setSelectedTests(new Set());
    }, [setData, selectedTests]);

    const handleSingleDelete = useCallback((testIdToDelete: string) => {
        // Directly perform the deletion as requested.
        console.log("已删除"); // Log to console to verify trigger
        
        // Update state to make the row disappear immediately
        setData(currentData =>
          currentData.filter(test => test.id !== testIdToDelete)
        );

        // Also update the selection state to be clean
        setSelectedTests(currentSelected => {
          const newSelected = new Set(currentSelected);
          newSelected.delete(testIdToDelete);
          return newSelected;
        });
    }, [setData, setSelectedTests]);
    
    if (data.length === 0) {
        return (
            <div className="text-center py-12">
                <h2 className="text-3xl font-bold text-brand-blue mb-4">摄氧量纵向比较</h2>
                <p className="text-gray-500">此处暂无数据。请通过“多文件批量处理”功能添加数据。</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto">
            <header className="mb-6 pb-6 border-b-2 border-brand-blue">
                <div className="flex flex-col md:flex-row justify-between items-start gap-4">
                    <h2 className="text-3xl font-bold text-brand-blue flex-1">
                        摄氧量纵向比较 <span className="text-xl font-normal text-gray-500">({sortedSubjectNames.length} 人)</span>
                    </h2>
                    <div className="w-full md:w-auto md:max-w-xs">
                        <label htmlFor="sort-order-textarea" className="block text-sm font-medium text-gray-700 mb-1">按姓名排序 (每行一个)</label>
                        <textarea
                            id="sort-order-textarea" value={sortOrderText} onChange={(e) => setSortOrderText(e.target.value)}
                            placeholder="支持模糊匹配..."
                            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-brand-accent focus:border-brand-accent"
                            rows={3}
                        />
                    </div>
                </div>
            </header>

            <ActionsBar selectedCount={selectedTests.size} onDeleteSelected={handleDeleteSelected} onClearHistory={handleClearHistory} />

            <div className="space-y-4">
                {sortedSubjectNames.map(subjectName => {
                    const subjectTests = subjects[subjectName];
                    const isExpanded = expandedSubject === subjectName;
                    const isAllSelectedForSubject = subjectTests.length > 0 && subjectTests.every(t => selectedTests.has(t.id));
                    
                    return (
                        <div key={subjectName} className="bg-white shadow-md rounded-lg overflow-hidden border border-gray-200">
                             <button onClick={() => setExpandedSubject(isExpanded ? null : subjectName)} className="w-full text-left p-4 bg-gray-50 hover:bg-gray-100 flex justify-between items-center transition-colors">
                                <h3 className="text-xl font-bold text-brand-blue">{subjectName} <span className="font-normal text-gray-600">({subjectTests.length} 次测试)</span></h3>
                                <svg xmlns="http://www.w3.org/2000/svg" className={`h-6 w-6 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            {isExpanded && (
                                <div className="p-4 bg-white">
                                    <SubjectComparisonChart tests={subjectTests} />

                                    <div className="mt-8">
                                        <h4 className="text-xl font-bold text-brand-blue mb-4">测试详情列表</h4>
                                        <div className="overflow-x-auto border rounded-lg">
                                             <table className="min-w-full divide-y divide-gray-200 text-sm">
                                                <thead className="bg-gray-100">
                                                    <tr>
                                                        <th className="px-4 py-3 text-left">
                                                           <input type="checkbox" className="rounded border-gray-300 text-brand-accent focus:ring-brand-accent"
                                                                checked={isAllSelectedForSubject} onChange={() => handleSelectAllForSubject(subjectName)}
                                                                title={`全选/取消全选 ${subjectName} 的所有测试`}
                                                            />
                                                        </th>
                                                        <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">测试类型</th>
                                                        <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">时长(s)</th>
                                                        <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">V'O2/kg</th>
                                                        <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">HRmax</th>
                                                        <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">RERmax</th>
                                                        <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">平台</th>
                                                        <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">数据详情</th>
                                                        <th className="px-4 py-3 text-left font-semibold text-gray-600 uppercase tracking-wider">操作</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-200">
                                                    {subjectTests.map(test => (
                                                        <React.Fragment key={test.id}>
                                                            <tr className={`hover:bg-gray-50 transition-colors ${selectedTests.has(test.id) ? 'bg-blue-50' : ''}`}>
                                                                <td className="px-4 py-4"><input type="checkbox" className="rounded border-gray-300 text-brand-accent focus:ring-brand-accent" checked={selectedTests.has(test.id)} onChange={() => handleToggleSelectTest(test.id)} /></td>
                                                                <td className="px-4 py-4"><select value={test.testType} onChange={e => handleTestTypeChange(test.id, e.target.value as any)} className="p-1 border rounded-md text-sm"><option value="unspecified">未指定</option><option value="pre">前测</option><option value="mid">中测</option><option value="post">后测</option></select></td>
                                                                <td className="px-4 py-4">{test.metrics.duration?.toFixed(0) ?? 'N/A'}</td>
                                                                <td className="px-4 py-4 font-semibold">{test.metrics.vo2max_kg.toFixed(2)}</td>
                                                                <td className="px-4 py-4">{test.metrics.hrmax.toFixed(0)}</td>
                                                                <td className="px-4 py-4">{test.metrics.rermax.toFixed(2)}</td>
                                                                <td className="px-4 py-4">{test.metrics.plateauReached ? '✔️' : '❌'}</td>
                                                                <td className="px-4 py-4"><button onClick={() => setExpandedTestId(expandedTestId === test.id ? null : test.id)} className="text-brand-blue hover:underline text-xs">{expandedTestId === test.id ? '收起' : '查看'}</button></td>
                                                                <td className="px-4 py-4"><button onClick={() => handleSingleDelete(test.id)} className="text-red-500 hover:text-red-700 p-1" title="删除此记录"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button></td>
                                                            </tr>
                                                            {expandedTestId === test.id && (
                                                                <tr>
                                                                    <td colSpan={9} className="p-4 bg-blue-50">
                                                                        {test.percentageData && test.smoothedData ? (
                                                                            <div>
                                                                                <DataTable data={test.percentageData} title="百分位摄氧量结果" maxHeight="300px" />
                                                                                <button
                                                                                    onClick={() => exportToXlsx(test.smoothedData!, test.percentageData!, '平滑数据', '百分比数据', `${test.fileName}_data.xlsx`)}
                                                                                    className="mt-2 px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded-lg shadow-md hover:bg-green-700 transition"
                                                                                >下载完整数据 (XLSX)</button>
                                                                            </div>
                                                                        ) : <p>无详细百分比数据。</p>}
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};