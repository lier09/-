

import React, { useState, useCallback, useRef, useEffect } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import {
    useDataProcessor,
    extractWeightFromFile,
    extractDurationFromFile,
    parseExcelFileContents,
    cleanAndInterpolateData,
    applySmoothing,
    calculateKeyMetricsForData,
    extractPercentageDataForMetrics
} from './hooks/useDataProcessor';
import { FileUpload } from './components/FileUpload';
import { DataTable } from './components/DataTable';
import { DataChart } from './components/DataChart';
import { exportToCsv, exportToXlsx } from './utils/fileUtils';
import type { ProcessedDataRow, AuditLogEntry, KeyMetrics, BatchResult, CleaningStats, AucResult } from './types';

// --- Helper Functions ---
const extractNameFromFile = (fileName: string): string => {
    // Matches all sequences of Chinese characters
    const chineseParts = fileName.match(/[\u4e00-\u9fa5]+/g);

    if (!chineseParts || chineseParts.length === 0) {
        // Fallback: return the filename without extension if no Chinese characters are found.
        return fileName.replace(/\.[^/.]+$/, "");
    }
    
    // Join the parts together, e.g., ["王", "泽齐"] becomes "王泽齐"
    const combinedName = chineseParts.join('');

    // Handle special repetition case, e.g., "吴启车启车" becomes "吴启车"
    if (combinedName.length > 0 && combinedName.length % 2 === 0) {
        const halfLength = combinedName.length / 2;
        const firstHalf = combinedName.substring(0, halfLength);
        const secondHalf = combinedName.substring(halfLength);
        if (firstHalf === secondHalf) {
            return firstHalf;
        }
    }

    return combinedName;
};

// --- Sub-components defined outside App to prevent re-renders ---

const CheckIcon = () => <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>;
const CrossIcon = () => <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>;
const InfoIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;

const StepIndicator: React.FC<{ currentStep: number }> = ({ currentStep }) => {
    const steps = ["上传文件", "数据清洗", "平滑与分析", "最终分析 & 报告"];
    return (
        <nav className="mb-8">
            <ol className="flex items-center w-full">
                {steps.map((step, index) => (
                    <li key={index} className={`flex w-full items-center ${index < steps.length - 1 ? "after:content-[''] after:w-full after:h-1 after:border-b after:border-4 after:inline-block" : ""} ${index < currentStep ? 'text-brand-blue after:border-brand-blue' : 'text-gray-400 after:border-gray-200'}`}>
                        <span className={`flex items-center justify-center w-10 h-10 rounded-full lg:h-12 lg:w-12 shrink-0 ${index < currentStep ? 'bg-brand-blue text-white' : 'bg-gray-200'}`}>
                            {index + 1}
                        </span>
                    </li>
                ))}
            </ol>
            <h2 className="text-center text-2xl font-bold text-brand-blue mt-2">{steps[currentStep]}</h2>
        </nav>
    );
};

const AuditLog: React.FC<{ log: AuditLogEntry[] }> = ({ log }) => {
    const formatLogEntry = (entry: AuditLogEntry) => {
        const original = typeof entry.originalValue === 'number' ? entry.originalValue.toFixed(2) : entry.originalValue;
        if (entry.action === 'INTERPOLATED' && entry.newValue !== undefined) {
            return `t=${entry.time}, 列: ${entry.column}. 原始值 [${original}] 因 (${entry.reason}) 被移除, 并插补为新值 [${entry.newValue.toFixed(2)}].`;
        }
        return `t=${entry.time}, 列: ${entry.column}. 原始值 [${original}] 因 (${entry.reason}) 被移除 (因数据缺口过大或处于阶段边缘, 未能插补).`;
    };

    return (
        <div className="bg-white shadow-md rounded-lg p-4 my-4">
            <h3 className="text-xl font-bold text-brand-blue mb-4">剔除与插补审计日志</h3>
            <div className="h-48 overflow-y-auto text-sm font-mono">
                {log.length > 0 ? log.map((entry, i) => (
                    <p key={i} className={`p-1 border-b border-gray-100 ${entry.action === 'INTERPOLATED' ? 'text-blue-700' : 'text-amber-700'}`}>
                        {formatLogEntry(entry)}
                    </p>
                )) : <p className="text-gray-500">没有检测到异常值或进行插补。</p>}
            </div>
        </div>
    );
};


const CleaningSummaryCard: React.FC<{ stats: CleaningStats; totalPoints: number }> = ({ stats, totalPoints }) => (
    <div className="bg-white shadow-xl rounded-2xl p-6 my-6">
        <h3 className="text-2xl font-bold text-brand-blue mb-4 text-center">数据清洗结果汇总</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
             <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-semibold text-light-text">总数据点</p>
                <p className="text-2xl font-bold text-dark-text">{totalPoints}</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-semibold text-light-text">移除异常值</p>
                <p className="text-2xl font-bold text-brand-accent">{stats.outliersRemoved}</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-semibold text-light-text">线性插补点</p>
                <p className="text-2xl font-bold text-brand-accent">{stats.pointsInterpolated}</p>
            </div>
        </div>
    </div>
);

const SummaryCard: React.FC<{ metrics: KeyMetrics }> = ({ metrics }) => {
    const [isPlateauDetailsVisible, setIsPlateauDetailsVisible] = useState(false);

    return (
        <div className="bg-white shadow-xl rounded-2xl p-6 my-6">
            <h3 className="text-2xl font-bold text-brand-blue mb-4 text-center">关键指标自动汇总</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                <div className="flex flex-col items-center justify-center bg-gray-50 p-4 rounded-lg text-center">
                    <p className="text-sm font-semibold text-light-text">VO₂ Plateau</p>
                    <div className="flex items-center space-x-2">
                        {metrics.plateauReached ? <CheckIcon /> : <CrossIcon />}
                        <button 
                            onClick={() => setIsPlateauDetailsVisible(v => !v)} 
                            className="p-1 rounded-full hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-blue"
                            aria-expanded={isPlateauDetailsVisible}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-gray-600 transition-transform transform ${isPlateauDetailsVisible ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                        </button>
                    </div>
                    <p className="text-xs mt-1">{metrics.plateauReached ? `在 t=${metrics.plateauTime} 达成` : "未达到平台"}</p>
                    {metrics.plateauReached && metrics.plateauComparison && (
                        <p className="text-xs text-blue-600 mt-1" title={`最后两阶段末30s VO₂平均值增量 < 0.15 L/min`}>
                           {`ΔV'O₂: ${(metrics.plateauComparison.lastStageAvg - metrics.plateauComparison.prevStageAvg).toFixed(3)} L/min`}
                        </p>
                    )}
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                    <p className="text-sm font-semibold text-light-text">{metrics.isPeak ? 'VO₂peak' : 'VO₂max'}</p>
                    <p className="text-2xl font-bold text-brand-accent">{metrics.vo2max.toFixed(2)}</p>
                    <p className="text-xs text-gray-500">L/min</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                    <p className="text-sm font-semibold text-light-text">{metrics.isPeak ? 'VO₂peak/kg' : 'VO₂max/kg'}</p>
                    <p className="text-2xl font-bold text-brand-accent">{metrics.vo2max_kg.toFixed(2)}</p>
                    <p className="text-xs text-gray-500">mL/min/kg</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                    <p className="text-sm font-semibold text-light-text">VEmax</p>
                    <p className="text-2xl font-bold text-dark-text">{metrics.vemax.toFixed(2)}</p>
                    <p className="text-xs text-gray-500">L/min</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                    <p className="text-sm font-semibold text-light-text">HRmax</p>
                    <p className="text-2xl font-bold text-dark-text">{metrics.hrmax.toFixed(0)}</p>
                    <p className="text-xs text-gray-500">bpm</p>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center">
                    <p className="text-sm font-semibold text-light-text">RERmax</p>
                    <p className="text-2xl font-bold text-dark-text">{metrics.rermax.toFixed(2)}</p>
                </div>

                {isPlateauDetailsVisible && metrics.plateauStageSummary && (
                    <div className="col-span-2 md:col-span-3 mt-4 p-4 bg-blue-50 rounded-lg">
                        <h4 className="font-bold text-brand-blue mb-2">各阶段末30秒平均数据 (基于平滑数据)</h4>
                        <div className="overflow-x-auto text-xs">
                            <table className="min-w-full">
                                <thead>
                                    <tr className="border-b-2 border-brand-accent">
                                        <th className="p-2 text-left">阶段</th>
                                        <th className="p-2 text-right">阶段时长(s)</th>
                                        <th className="p-2 text-right">末30s平均V'O₂ (L/min)</th>
                                        <th className="p-2 text-right">ΔV'O₂ (L/min)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {metrics.plateauStageSummary.map((stageInfo) => {
                                        const isLastStage = stageInfo.stage === metrics.plateauStageSummary!.length;
                                        return (
                                            <tr key={stageInfo.stage} className={`${isLastStage ? 'bg-blue-200 font-bold' : ''}`}>
                                                <td className="p-2 text-left">{stageInfo.stage}</td>
                                                <td className="p-2 text-right">{stageInfo.duration.toFixed(0)}</td>
                                                <td className="p-2 text-right">
                                                    {stageInfo.avgVo2.toFixed(3)}
                                                    {stageInfo.isPartial && <span className="text-xs italic ml-1">(全阶段)</span>}
                                                </td>
                                                <td className="p-2 text-right">
                                                    {stageInfo.deltaVo2 !== null ? stageInfo.deltaVo2.toFixed(3) : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                             <p className="text-xs text-gray-500 mt-2">
                                注: 平台判断基于最后两个阶段的V'O₂平均值增量(ΔV'O₂)。如末级不足3分钟但长于30秒, V'O₂平均值取自该阶段最后30秒；如末级不足30秒, 则取自整个阶段数据。
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

const AucCalculator: React.FC<{ onCalculate: (start: number, end: number) => AucResult | null }> = ({ onCalculate }) => {
    const [startPercent, setStartPercent] = useState(50);
    const [endPercent, setEndPercent] = useState(70);
    const [result, setResult] = useState<AucResult | null>(null);

    const handleCalculate = () => {
        if (startPercent >= endPercent) {
            alert("起始百分比必须小于结束百分比。");
            return;
        }
        const calcResult = onCalculate(startPercent, endPercent);
        setResult(calcResult);
    };

    return (
        <div className="bg-white shadow-xl rounded-2xl p-6 my-6">
            <h3 className="text-2xl font-bold text-brand-blue mb-4 text-center">AUC 计算模块</h3>
            <div className="flex flex-wrap items-center justify-center gap-4">
                <label>从 <input type="number" value={startPercent} onChange={e => setStartPercent(Number(e.target.value))} className="w-20 p-1 border rounded" /> %</label>
                <label>至 <input type="number" value={endPercent} onChange={e => setEndPercent(Number(e.target.value))} className="w-20 p-1 border rounded" /> % VO₂max</label>
                <button onClick={handleCalculate} className="px-6 py-2 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-blue-500 transition">计算 AUC</button>
            </div>
            {result && (
                <div className="mt-4 p-4 bg-blue-50 text-center rounded-lg">
                    <p className="text-lg font-semibold">总耗氧量: <span className="text-2xl font-bold text-brand-blue">{result.value.toFixed(3)} L</span></p>
                    <p className="text-sm text-gray-600">在 V'O₂ 从 {result.startVo2.toFixed(2)} 到 {result.endVo2.toFixed(2)} L/min 区间内</p>
                </div>
            )}
            {!result && result !== null && <p className="text-center text-red-500 mt-4">无法计算，请检查数据或区间。</p>}
        </div>
    );
};

const PowerCalculatorMode = () => {
    const [inputData, setInputData] = useState('');
    const [stageDuration, setStageDuration] = useState(180); // Default to 3 min (180s)
    const [powerIncrement, setPowerIncrement] = useState(50); // Default to 50 W
    const [results, setResults] = useState<{ name: string; time: number; power: number }[]>([]);

    const calculateMaxPower = (t: number, T: number, P: number): number => {
        if (t < 0) return 0;
        const n = Math.floor(t / T); // Number of completed stages
        const r = t - T * n;       // Time into the current, unfinished stage
    
        // The protocol implies the starting power is P and the increment is also P.
        const startPower = P;
        const powerInc = P;
        
        // Power achieved proportionally within the current stage.
        const proportionalPowerInCurrentStage = (r / T) * powerInc;
        
        if (n === 0) {
            // If still in the first stage, power is just the proportional amount.
            return proportionalPowerInCurrentStage;
        }
        
        // If n>=1, at least one stage is completed.
        // The power of the last fully completed stage is the starting power plus all increments from completed stages.
        // Last completed stage is stage 'n'. Power OF that stage = startPower + (n - 1) * powerInc.
        const powerFromCompletedStages = startPower + (n - 1) * powerInc;
        
        return powerFromCompletedStages + proportionalPowerInCurrentStage;
    };

    const handleCalculate = () => {
        const lines = inputData.split('\n').filter(line => line.trim() !== '');
        const calculatedResults = lines.map(line => {
            const trimmedLine = line.trim();
            const lastSpaceIndex = trimmedLine.lastIndexOf(' ');
            
            if (lastSpaceIndex === -1) return null; // Invalid format
            
            const name = trimmedLine.substring(0, lastSpaceIndex).trim();
            const timeStr = trimmedLine.substring(lastSpaceIndex + 1).trim();
            const time = parseInt(timeStr, 10);
            
            if (!name || isNaN(time)) return null; // Invalid format
            
            const power = calculateMaxPower(time, stageDuration, powerIncrement);
            return { name, time, power };
        }).filter(Boolean) as { name: string; time: number; power: number }[];
        
        setResults(calculatedResults);
    };
    
    const handleDownload = () => {
        if (results.length === 0) return;
        const csvData = results.map(r => ({ '姓名': r.name, '时间(s)': r.time, '最大功率(W)': r.power.toFixed(2) }));
        const headers = Object.keys(csvData[0]);
        const csvRows = [
            headers.join(','),
            ...csvData.map(row => 
                headers.map(header => (row as any)[header]).join(',')
            )
        ];
        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'max_power_results.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-bold text-brand-blue mb-6">最大功率计算</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-6 rounded-lg shadow-lg mb-8">
                <div>
                    <label htmlFor="duration-select" className="block text-sm font-medium text-gray-700 mb-1">阶段时长 (分钟)</label>
                    <select
                        id="duration-select"
                        value={stageDuration / 60}
                        onChange={(e) => setStageDuration(Number(e.target.value) * 60)}
                        className="p-2 w-full border border-gray-300 rounded-md shadow-sm focus:ring-brand-accent focus:border-brand-accent"
                    >
                        {[1, 2, 3, 4, 5].map(min => (
                            <option key={min} value={min}>{min}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label htmlFor="power-select" className="block text-sm font-medium text-gray-700 mb-1">功率增量 (W)</label>
                    <select
                        id="power-select"
                        value={powerIncrement}
                        onChange={(e) => setPowerIncrement(Number(e.target.value))}
                        className="p-2 w-full border border-gray-300 rounded-md shadow-sm focus:ring-brand-accent focus:border-brand-accent"
                    >
                        {[10, 20, 30, 40, 50, 60, 70, 80].map(w => (
                            <option key={w} value={w}>{w}</option>
                        ))}
                    </select>
                </div>
                
                <div className="md:col-span-2">
                    <label htmlFor="data-input" className="block text-sm font-medium text-gray-700 mb-1">输入数据 (每行一个: 姓名 时间(s))</label>
                    <textarea
                        id="data-input"
                        rows={8}
                        value={inputData}
                        onChange={(e) => setInputData(e.target.value)}
                        placeholder="例如:&#10;张三 650&#10;李四 735"
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-brand-accent focus:border-brand-accent font-mono"
                    />
                </div>

                <div className="md:col-span-2 text-center">
                    <button onClick={handleCalculate} className="w-full md:w-auto px-8 py-3 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-blue-500 transition disabled:bg-gray-400">
                        计算最大功率
                    </button>
                </div>
            </div>

            {results.length > 0 && (
                <div className="bg-white p-6 rounded-lg shadow-lg">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-brand-blue">计算结果</h3>
                        <button onClick={handleDownload} className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition">下载为 CSV</button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓名</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">时间 (s)</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">最大功率 (W)</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {results.map((res, i) => (
                                    <tr key={i}>
                                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{res.name}</td>
                                        <td className="px-6 py-4 text-sm text-gray-600">{res.time}</td>
                                        <td className="px-6 py-4 text-sm text-gray-600">{res.power.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};


// --- Fuzzy Search / Sort Logic ---
const levenshtein = (s1: string, s2: string): number => {
    if (!s1) s1 = '';
    if (!s2) s2 = '';
    
    // Swap to save memory
    if (s1.length > s2.length) {
        [s1, s2] = [s2, s1];
    }
    
    const s1_len = s1.length;
    const s2_len = s2.length;
    
    if (s2_len === 0) return s1_len;

    let previousRow = Array.from({ length: s1_len + 1 }, (_, i) => i);

    for (let i = 1; i <= s2_len; i++) {
        let currentRow = [i];
        for (let j = 1; j <= s1_len; j++) {
            const insertions = previousRow[j] + 1;
            const deletions = currentRow[j - 1] + 1;
            const substitutions = previousRow[j - 1] + (s1[j - 1] === s2[i - 1] ? 0 : 1);
            currentRow.push(Math.min(insertions, deletions, substitutions));
        }
        previousRow = currentRow;
    }

    return previousRow[s1_len];
}

const applySortOrder = (results: BatchResult[], order: string[]): BatchResult[] => {
    if (order.length === 0) return results;
    
    const findBestMatchIndex = (recordName: string, nameOrder: string[]): number => {
        let bestMatch = { index: -1, score: Infinity };

        for (let i = 0; i < nameOrder.length; i++) {
            const inputName = nameOrder[i];
            let currentScore: number;

            // Priority 1: Exact match
            if (recordName === inputName) {
                currentScore = 0;
            } 
            // Priority 2: Substring match (name contains or is contained by)
            else if (recordName.includes(inputName) || inputName.includes(recordName)) {
                currentScore = 1;
            } 
            // Priority 3: Levenshtein distance for typos and similar characters
            else {
                currentScore = levenshtein(recordName, inputName);
                // Add a penalty so substring matches are always preferred over a Levenshtein match
                currentScore += 1.1; 
            }

            if (currentScore < bestMatch.score) {
                bestMatch = { index: i, score: currentScore };
            }
        }
        
        // Only consider a match if it's exact, a substring, or Levenshtein distance is <= 2
        // Exact score = 0, Substring score = 1, Levenshtein of 1 = 2.1, Levenshtein of 2 = 3.1
        if (bestMatch.score > 3.1) {
            return -1;
        }

        return bestMatch.index;
    };

    const sorted = [...results].sort((a, b) => {
        const indexA = findBestMatchIndex(a.fileName, order);
        const indexB = findBestMatchIndex(b.fileName, order);

        if (indexA === -1 && indexB === -1) return 0; // both not in order list, keep original order
        if (indexA === -1) return 1; // a is not in list, should go to the end
        if (indexB === -1) return -1; // b is not in list, should go to the end
        return indexA - indexB; // sort by their appearance in the user's list
    });
    return sorted;
};

const App: React.FC = () => {
    const [mode, setMode] = useState<'single' | 'batch' | 'power' | null>(null);
    const [currentStep, setCurrentStep] = useState(0);
    const [fileName, setFileName] = useState('');
    const [manualBodyWeight, setManualBodyWeight] = useState('');
    const [batchFiles, setBatchFiles] = useState<{file: File, weight: string}[]>([]);
    
    const [batchResults, setBatchResults] = useState<BatchResult[]>(() => {
        try {
            const saved = window.localStorage.getItem('vo2_analysis_session');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && (parsed.length === 0 || parsed[0].fileName)) {
                    return parsed;
                }
            }
        } catch (e) {
            console.error("Failed to load session from localStorage", e);
        }
        return [];
    });
    
    const [sortOrderText, setSortOrderText] = useState('');
    const [batchProcessingStatus, setBatchProcessingStatus] = useState('');
    const [isBatchLoading, setIsBatchLoading] = useState(false);
    
    // State for interactive charts
    const [chartMetric, setChartMetric] = useState<keyof KeyMetrics>('vo2max_kg');
    const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
    const [expandedRowIndex, setExpandedRowIndex] = useState<number | null>(null);


    const reportRef = useRef<HTMLDivElement>(null);

    const {
        rawData, cleanedData, smoothedData, percentageData, auditLog, cleaningStats, keyMetrics, error, isLoading,
        parseExcelFile, processOutliers, applyRollingAverage, calculateKeyMetrics, extractPercentageValues, calculateAuc, resetState
    } = useDataProcessor();
    
    useEffect(() => {
        try {
            window.localStorage.setItem('vo2_analysis_session', JSON.stringify(batchResults));
        } catch (e) {
            console.error("Failed to save session to localStorage", e);
        }
    }, [batchResults]);

    // --- Single File Mode Handlers ---
    const handleFileSelect = (file: File) => {
        resetState();
        setManualBodyWeight('');
        setFileName(file.name);
        parseExcelFile(file);
        setCurrentStep(1);
    };

    const handleProcessOutliers = useCallback(() => {
        const weight = parseFloat(manualBodyWeight);
        if (isNaN(weight) || weight <= 0) return;
        processOutliers(rawData, weight);
        setCurrentStep(2);
    }, [processOutliers, rawData, manualBodyWeight]);

    const handleSmoothing = useCallback(() => {
        const weight = parseFloat(manualBodyWeight);
        if (isNaN(weight) || weight <= 0) return;
        const smoothed = applyRollingAverage(cleanedData, weight);
        if (smoothed) {
            calculateKeyMetrics(smoothed);
        }
        setCurrentStep(3);
    }, [applyRollingAverage, calculateKeyMetrics, cleanedData, manualBodyWeight]);

    const handleAnalysis = useCallback(() => {
        if (keyMetrics) {
            extractPercentageValues(smoothedData, keyMetrics);
            setCurrentStep(4);
        }
    }, [extractPercentageValues, keyMetrics, smoothedData]);
    
    // --- Batch Mode Handlers ---
    const handleBatchFileSelect = async (files: FileList) => {
         const newFilesWithWeights = await Promise.all(
            Array.from(files).map(async (file) => {
                const weight = await extractWeightFromFile(file);
                return { file, weight: weight || '' };
            })
        );
        setBatchFiles(prev => [...prev, ...newFilesWithWeights]);
    };
    
    const handleWeightChange = (index: number, weight: string) => {
        const newFiles = [...batchFiles];
        newFiles[index].weight = weight;
        setBatchFiles(newFiles);
    };

    const handleApplySortFromText = () => {
        const names = sortOrderText.split(/[\r\n]+/).map(name => name.trim()).filter(Boolean);
        setBatchResults(prev => applySortOrder(prev, names));
        alert(`已应用 ${names.length} 个姓名的模糊排序。`);
    };
    
    const handleBatchProcess = async () => {
        const filesToProcess = batchFiles.filter(f => f.weight && parseFloat(f.weight) > 0);
        if (filesToProcess.length === 0) {
            alert('没有有效的文件和体重可供处理。请检查输入。');
            return;
        }

        setIsBatchLoading(true);
        const newResults: BatchResult[] = [];
        for (let i = 0; i < filesToProcess.length; i++) {
            const { file, weight } = filesToProcess[i];
            const bodyWeight = parseFloat(weight);
            const extractedName = extractNameFromFile(file.name);
            const duration = await extractDurationFromFile(file);
            setBatchProcessingStatus(`处理中 (${i+1}/${filesToProcess.length}): ${file.name}`);
            try {
                const raw = await parseExcelFileContents(file);
                const { cleanedData, auditLog, stats } = cleanAndInterpolateData(raw, bodyWeight);
                const smoothed = applySmoothing(cleanedData, bodyWeight);
                const metrics = calculateKeyMetricsForData(smoothed);
                
                if (duration !== null) {
                    metrics.duration = duration;
                }
                
                const percentage = extractPercentageDataForMetrics(smoothed, metrics);
                newResults.push({ 
                    fileName: extractedName, 
                    metrics, 
                    smoothedData: smoothed, 
                    percentageData: percentage,
                    auditLog,
                    cleaningStats: stats
                });
            } catch (e: any) {
                console.error(`Failed to process ${file.name}:`, e);
                setBatchProcessingStatus(`错误: 处理 ${file.name} 失败 - ${e.toString()}`);
            }
        }
        
        setBatchResults(prevResults => {
            const resultsMap = new Map(prevResults.map(r => [r.fileName, r]));
            newResults.forEach(res => resultsMap.set(res.fileName, res)); // Add or update
            const merged = Array.from(resultsMap.values());
            const currentSortOrder = sortOrderText.split(/[\r\n]+/).map(name => name.trim()).filter(Boolean);
            return applySortOrder(merged, currentSortOrder);
        });

        setBatchFiles(batchFiles.filter(f => !f.weight || parseFloat(f.weight) <= 0)); // Remove processed files
        setIsBatchLoading(false);
        setBatchProcessingStatus(`完成! ${newResults.length} 个文件已处理并合并到历史记录中。`);
    };

    // --- Common Handlers ---
    const handleReset = () => {
        resetState();
        setManualBodyWeight('');
        setCurrentStep(0);
        setFileName('');
        setMode(null);
        setBatchFiles([]);
        // Do not clear batchResults on reset, only on explicit clear button
        // setBatchResults([]); 
        setSortOrderText('');
        setBatchProcessingStatus('');
    };
    
    const handleGenerateReport = () => {
        if (!reportRef.current) return;
        const reportElement = reportRef.current;
        html2canvas(reportElement, { scale: 2 }).then(canvas => {
            const imgData = canvas.toDataURL('image/png');
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            const ratio = canvasHeight / canvasWidth;
            let heightInPdf = pdfWidth * ratio;
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, heightInPdf);
            pdf.save(`${fileName.replace(/\.[^/.]+$/, "")}_report.pdf`);
        });
    };

    const isWeightValid = !manualBodyWeight || parseFloat(manualBodyWeight) <= 0;

    const renderModeSelection = () => (
        <div className="max-w-5xl mx-auto text-center">
            <h2 className="text-2xl font-semibold mb-6">请选择分析模式</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <button onClick={() => setMode('single')} className="p-8 bg-white rounded-xl shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all transform flex flex-col items-center">
                    <h3 className="text-xl font-bold text-brand-blue mb-2">单个文件详细分析</h3>
                    <p className="text-gray-600">深入分析单个文件，查看详细图表、日志和中间数据。</p>
                </button>
                 <button onClick={() => setMode('batch')} className="p-8 bg-white rounded-xl shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all transform flex flex-col items-center">
                    <h3 className="text-xl font-bold text-brand-blue mb-2">多文件批量处理</h3>
                    <p className="text-gray-600">同时处理多个文件，进行结果对比，并自动保存到历史记录。</p>
                </button>
                <button onClick={() => setMode('power')} className="p-8 bg-white rounded-xl shadow-lg hover:shadow-2xl hover:-translate-y-1 transition-all transform flex flex-col items-center">
                    <h3 className="text-xl font-bold text-brand-blue mb-2">最大功率计算</h3>
                    <p className="text-gray-600">根据测试时间和协议，快速计算最大功率。</p>
                </button>
            </div>
        </div>
    );
    
    const renderHistoricalData = () => {
        const chartMetricsOptions: { key: keyof KeyMetrics; label: string; unit: string; }[] = [
            { key: 'vo2max_kg', label: 'V\'O₂/kg', unit: 'mL/min/kg' },
            { key: 'vo2max', label: 'V\'O₂', unit: 'L/min' },
            { key: 'hrmax', label: 'HRmax', unit: 'bpm' },
            { key: 'vemax', label: 'VEmax', unit: 'L/min' },
            { key: 'rermax', label: 'RERmax', unit: '' },
        ];
        
        const selectedMetricInfo = chartMetricsOptions.find(m => m.key === chartMetric)!;

        const chartData = batchResults.map(item => ({
            name: item.fileName,
            value: typeof item.metrics[chartMetric] === 'number' ? (item.metrics[chartMetric] as number) : 0
        }));

        const ChartComponent = chartType === 'bar' ? BarChart : LineChart;
        const ChartSeries = chartType === 'bar' 
            ? <Bar dataKey="value" name={selectedMetricInfo.label} fill="#00A8E8" />
            : <Line type="monotone" dataKey="value" name={selectedMetricInfo.label} stroke="#00A8E8" strokeWidth={2} />;
        
        return batchResults.length > 0 && (
            <div className="mt-12">
                <div className="flex flex-col md:flex-row justify-between md:items-center mb-4 pb-2 border-b-2 border-brand-blue">
                    <h2 className="text-3xl font-bold text-brand-blue mb-4 md:mb-0">历史分析记录 ({batchResults.length} 人)</h2>
                    <div className="flex flex-col sm:flex-row items-end gap-4">
                        <div className="flex-grow">
                           <label htmlFor="sort-order-textarea" className="block text-sm font-medium text-gray-700">按预定姓名排序 (支持模糊匹配)</label>
                           <textarea
                                id="sort-order-textarea"
                                value={sortOrderText}
                                onChange={(e) => setSortOrderText(e.target.value)}
                                placeholder="每行一个姓名..."
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-brand-accent focus:border-brand-accent"
                                rows={4}
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                             <button onClick={handleApplySortFromText} className="px-4 py-2 bg-brand-blue text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition">应用排序</button>
                             <button onClick={() => { if (window.confirm('确定要清空所有历史记录吗？此操作无法撤销。')) setBatchResults([]); }} className="px-4 py-2 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 transition">清空所有记录</button>
                        </div>
                    </div>
                </div>

                <div className="bg-white shadow-md rounded-lg p-4 my-4 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">name</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">duration (s)</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">V'O2 (L/min)</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">V'O2/kg (mL/min/kg)</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">最大心率 (bpm)</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">是否平台</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">VEmax (L/min)</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">RERmax</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">数据下载</th>
                                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">详情</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {batchResults.map((res, i) => (
                                <React.Fragment key={i}>
                                    <tr>
                                        <td className="px-3 py-4 text-sm font-medium text-gray-900">{res.fileName}</td>
                                        <td className="px-3 py-4 text-sm text-gray-600">{res.metrics.duration ?? 'N/A'}</td>
                                        <td className="px-3 py-4 text-sm text-gray-600">{res.metrics.vo2max.toFixed(2)}</td>
                                        <td className="px-3 py-4 text-sm text-gray-600">{res.metrics.vo2max_kg.toFixed(2)}</td>
                                        <td className="px-3 py-4 text-sm text-gray-600">{res.metrics.hrmax.toFixed(0)}</td>
                                        <td className="px-3 py-4 text-sm text-gray-600">{res.metrics.plateauReached ? '✔️' : '❌'}</td>
                                        <td className="px-3 py-4 text-sm text-gray-600">{res.metrics.vemax.toFixed(2)}</td>
                                        <td className="px-3 py-4 text-sm text-gray-600">{res.metrics.rermax.toFixed(2)}</td>
                                        <td className="px-3 py-4 text-sm text-gray-600">
                                                <button
                                                onClick={() => {
                                                    if (res.smoothedData && res.percentageData) {
                                                        exportToXlsx(res.smoothedData, res.percentageData, '平滑数据', '百分比数据', `${res.fileName}_data.xlsx`);
                                                    }
                                                }}
                                                disabled={!res.smoothedData || !res.percentageData}
                                                className="text-blue-600 hover:underline text-xs disabled:text-gray-400 disabled:no-underline"
                                            >下载数据 (XLSX)</button>
                                        </td>
                                        <td className="px-3 py-4 text-sm text-gray-600">
                                            <button 
                                                onClick={() => setExpandedRowIndex(expandedRowIndex === i ? null : i)}
                                                className="text-indigo-600 hover:indigo-900 text-xs"
                                            >
                                                {expandedRowIndex === i ? '收起' : '查看详情'}
                                            </button>
                                        </td>
                                    </tr>
                                    {expandedRowIndex === i && (
                                        <tr>
                                            <td colSpan={10} className="p-4 bg-gray-50">
                                                <div className="max-w-4xl mx-auto">
                                                {res.cleaningStats && res.smoothedData && (
                                                    <CleaningSummaryCard stats={res.cleaningStats} totalPoints={res.smoothedData.length} />
                                                )}
                                                {res.auditLog && (
                                                    <AuditLog log={res.auditLog} />
                                                )}
                                                {(!res.cleaningStats || !res.auditLog) && <p className="text-center text-gray-500">此记录无详细的清洗日志。</p>}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>

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
                                    <option key={opt.key} value={opt.key}>{opt.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <p className="block text-sm font-medium text-gray-700 mb-1">图表类型:</p>
                            <div className="flex items-center space-x-1 p-1 bg-gray-200 rounded-lg">
                                <button onClick={() => setChartType('bar')} className={`px-4 py-1 text-sm font-semibold rounded-md transition-colors ${chartType === 'bar' ? 'bg-white text-brand-blue shadow' : 'text-gray-600 hover:bg-gray-100'}`}>Bar</button>
                                <button onClick={() => setChartType('line')} className={`px-4 py-1 text-sm font-semibold rounded-md transition-colors ${chartType === 'line' ? 'bg-white text-brand-blue shadow' : 'text-gray-600 hover:bg-gray-100'}`}>Line</button>
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
            </div>
        )
    };

    const renderBatchMode = () => (
        <div>
            <div className="bg-white p-6 rounded-lg shadow-lg">
                 <h3 className="font-bold text-xl text-brand-blue border-b pb-2 mb-4">处理新文件</h3>
                 <div className="space-y-4">
                     <div>
                        <label className="text-sm font-medium text-gray-700">1. 添加新文件 (.xlsx) - 将自动提取体重</label>
                        <input type="file" multiple onChange={(e) => e.target.files && handleBatchFileSelect(e.target.files)} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-brand-blue hover:file:bg-blue-100" accept=".xlsx, .xls" />
                    </div>
                    
                    {batchFiles.length > 0 && (
                        <div>
                           <h4 className="font-semibold text-lg mb-2">2. 核对并调整体重 (kg)</h4>
                            <div className="max-h-48 overflow-y-auto border p-2 rounded-md">
                               <table className="min-w-full"><tbody>
                               {batchFiles.map((item, index) => (
                                   <tr key={index} className="border-b"><td className="py-2 pr-4 text-gray-700">{item.file.name}</td><td>
                                       <input type="number" value={item.weight} onChange={(e) => handleWeightChange(index, e.target.value)} placeholder="例如: 70" className="px-2 py-1 border border-gray-300 rounded-md w-32 focus:ring-brand-accent focus:border-brand-accent"/>
                                   </td></tr>
                               ))}
                               </tbody></table>
                            </div>
                        </div>
                    )}

                    <div>
                        <button onClick={handleBatchProcess} disabled={isBatchLoading || batchFiles.length === 0} className="w-full md:w-auto px-6 py-3 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-blue-500 transition disabled:bg-gray-400">
                             {isBatchLoading ? '处理中...' : `3. 处理 ${batchFiles.length} 个新文件`}
                         </button>
                    </div>
                 </div>
                 {batchProcessingStatus && <p className="text-center mt-4 text-gray-600">{batchProcessingStatus}</p>}
            </div>

            {renderHistoricalData()}
        </div>
    );

    return (
        <div className="container mx-auto p-4 sm:p-6 lg:p-8">
            <header className="text-center mb-8">
                 <h1 className="text-4xl font-extrabold text-brand-blue">最大/峰值氧摄取量分析工具</h1>
                <p className="text-md text-medium-text mt-2">适用于 MetaLyzer 原始 Excel 数据</p>
                 {mode && <button onClick={handleReset} className="mt-4 text-sm text-gray-500 hover:text-brand-blue">返回主菜单并重置</button>}
            </header>
            
            {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">{error}</div>}
            
            {mode === null && renderModeSelection()}
            
            {mode === 'single' && currentStep === 0 && <FileUpload onFileSelect={handleFileSelect} isLoading={isLoading} />}
            {mode === 'batch' && renderBatchMode()}
            {mode === 'power' && <PowerCalculatorMode />}


            {mode === 'single' && currentStep > 0 && <StepIndicator currentStep={currentStep - 1} />}

            {mode === 'single' && currentStep === 1 && rawData.length > 0 && (
                <div>
                     <div className="flex items-center justify-between space-x-4 p-4 bg-blue-50 border border-brand-accent rounded-lg mb-6">
                        <div className="flex items-center space-x-3">
                            <InfoIcon />
                            <p className="font-semibold text-brand-blue">
                                已加载文件: <span className="font-bold">{fileName}</span> ({rawData.length}行).
                            </p>
                        </div>
                        <div className="flex items-center space-x-2">
                             <label htmlFor="bodyWeightInput" className="font-semibold text-brand-blue">请输入体重 (kg):</label>
                             <input
                                id="bodyWeightInput" type="number" value={manualBodyWeight}
                                onChange={(e) => setManualBodyWeight(e.target.value)}
                                placeholder="例如: 70"
                                className="px-2 py-1 border border-gray-300 rounded-md w-32 focus:ring-brand-accent focus:border-brand-accent"
                                required
                            />
                        </div>
                    </div>
                    <DataTable data={rawData} title="原始数据预览" />
                    <div className="flex justify-end mt-6">
                         <button onClick={() => {resetState(); setCurrentStep(0); setMode('single');}} className="px-6 py-2 bg-gray-500 text-white font-semibold rounded-lg shadow-md hover:bg-gray-600 transition mr-4">重置</button>
                        <button onClick={handleProcessOutliers} disabled={isWeightValid} className="px-6 py-2 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-blue-500 transition disabled:bg-gray-400 disabled:cursor-not-allowed">
                            开始异常值处理
                        </button>
                    </div>
                </div>
            )}

            {mode === 'single' && currentStep === 2 && (
                <div>
                    {cleaningStats && <CleaningSummaryCard stats={cleaningStats} totalPoints={cleanedData.length}/>}
                    <AuditLog log={auditLog} />
                    <DataTable data={cleanedData} title="已插补完毕的数据" />
                    <div className="flex justify-end space-x-4 mt-6">
                        <button onClick={() => exportToCsv(cleanedData, 'cleaned_data.csv')} className="px-6 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition">下载已插补表格</button>
                        <button onClick={handleSmoothing} className="px-6 py-2 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-blue-500 transition">继续进行30秒滚动平滑处理</button>
                    </div>
                </div>
            )}
            
             {mode === 'single' && (
                <div ref={reportRef}>
                    {currentStep >= 3 && keyMetrics && (
                        <div className="grid grid-cols-1 gap-6">
                            <SummaryCard metrics={keyMetrics} />
                        </div>
                    )}
                    
                    {currentStep >= 3 && smoothedData.length > 0 && (
                        <>
                            <DataChart data={smoothedData} />
                            <DataTable data={smoothedData} title="30秒滚动平滑处理数据" />
                        </>
                    )}
                </div>
             )}

            {mode === 'single' && currentStep === 3 && (
                 <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={() => exportToCsv(smoothedData, 'smoothed_data.csv')} className="px-6 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition">下载平滑处理结果</button>
                    <button onClick={handleAnalysis} className="px-6 py-2 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-blue-500 transition">进行最终分析</button>
                </div>
            )}
            
            {mode === 'single' && currentStep === 4 && keyMetrics && (
                <div>
                    <DataTable data={percentageData} title="%VO₂max/peak 数据" />
                    <AucCalculator onCalculate={(start, end) => calculateAuc(smoothedData, keyMetrics.vo2max, start, end)} />
                    <div className="flex justify-between items-center mt-6 p-4 bg-gray-100 rounded-lg">
                        <div/>
                        <div>
                             <button onClick={handleGenerateReport} className="px-6 py-2 bg-purple-600 text-white font-semibold rounded-lg shadow-md hover:bg-purple-700 transition mr-4">生成报告 (PDF)</button>
                             <button onClick={() => exportToCsv(percentageData, 'percentage_data.csv')} className="px-6 py-2 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition mr-4">下载百分比数据</button>
                             <button onClick={handleReset} className="px-6 py-2 bg-brand-blue text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 transition">分析新文件</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
