
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
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
import { HistoryAndComparison } from './components/HistoryAndComparison';
import { applySortOrder } from './utils/sortingUtils';

// --- Helper Functions & Components ---

const LightbulbIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
);


const extractNameFromFile = (fileName: string): string => {
    const chineseParts = fileName.match(/[\u4e00-\u9fa5]+/g);
    if (!chineseParts || chineseParts.length === 0) return fileName.replace(/\.[^/.]+$/, "");
    const combinedName = chineseParts.join('');
    if (combinedName.length > 0 && combinedName.length % 2 === 0) {
        const halfLength = combinedName.length / 2;
        const firstHalf = combinedName.substring(0, halfLength);
        const secondHalf = combinedName.substring(halfLength);
        if (firstHalf === secondHalf) return firstHalf;
    }
    return combinedName;
};

const CheckIcon = () => <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>;
const CrossIcon = () => <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>;
const InfoIcon = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;

// --- Dashboard Icons ---
const IconSingleFile = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-brand-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>;
const IconBatchFile = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-brand-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>;
const IconCalculator = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-brand-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m3 1a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V10a2 2 0 012-2h1V6a1 1 0 011-1h4a1 1 0 011 1v1h1z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 13H9" /></svg>;
const IconChart = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-brand-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" /></svg>;

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

const AuditLog: React.FC<{ log: AuditLogEntry[] }> = ({ log }) => (
    <div className="bg-white shadow-md rounded-lg p-4 my-4">
        <h3 className="text-xl font-bold text-brand-blue mb-4">剔除与插补审计日志</h3>
        <div className="h-48 overflow-y-auto text-sm font-mono">
            {log.length > 0 ? log.map((entry, i) => {
                const original = typeof entry.originalValue === 'number' ? entry.originalValue.toFixed(2) : entry.originalValue;
                const message = entry.action === 'INTERPOLATED' && entry.newValue !== undefined 
                    ? `t=${entry.time}, 列: ${entry.column}. 原始值 [${original}] 因 (${entry.reason}) 被移除, 并插补为新值 [${entry.newValue.toFixed(2)}].`
                    : `t=${entry.time}, 列: ${entry.column}. 原始值 [${original}] 因 (${entry.reason}) 被移除 (因数据缺口过大或处于阶段边缘, 未能插补).`;
                return <p key={i} className={`p-1 border-b border-gray-100 ${entry.action === 'INTERPOLATED' ? 'text-blue-700' : 'text-amber-700'}`}>{message}</p>
            }) : <p className="text-gray-500">没有检测到异常值或进行插补。</p>}
        </div>
    </div>
);

const CleaningSummaryCard: React.FC<{ stats: CleaningStats; totalPoints: number }> = ({ stats, totalPoints }) => (
    <div className="bg-white shadow-xl rounded-2xl p-6 my-6">
        <h3 className="text-2xl font-bold text-brand-blue mb-4 text-center">数据清洗结果汇总</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
            <div className="bg-gray-50 p-4 rounded-lg"><p className="text-sm font-semibold text-light-text">总数据点</p><p className="text-2xl font-bold text-dark-text">{totalPoints}</p></div>
            <div className="bg-gray-50 p-4 rounded-lg"><p className="text-sm font-semibold text-light-text">移除异常值</p><p className="text-2xl font-bold text-brand-accent">{stats.outliersRemoved}</p></div>
            <div className="bg-gray-50 p-4 rounded-lg"><p className="text-sm font-semibold text-light-text">线性插补点</p><p className="text-2xl font-bold text-brand-accent">{stats.pointsInterpolated}</p></div>
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
                        <button onClick={() => setIsPlateauDetailsVisible(v => !v)} className="p-1 rounded-full hover:bg-gray-200" aria-expanded={isPlateauDetailsVisible}>
                            <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 text-gray-600 transition-transform transform ${isPlateauDetailsVisible ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                        </button>
                    </div>
                    <p className="text-xs mt-1">{metrics.plateauReached ? `在 t=${metrics.plateauTime} 达成` : "未达到平台"}</p>
                    {metrics.plateauReached && metrics.plateauComparison && <p className="text-xs text-blue-600 mt-1" title={`最后两阶段末30s VO₂平均值增量 < 0.15 L/min`}>{`ΔV'O₂: ${(metrics.plateauComparison.lastStageAvg - metrics.plateauComparison.prevStageAvg).toFixed(3)} L/min`}</p>}
                </div>
                <div className="bg-gray-50 p-4 rounded-lg text-center"><p className="text-sm font-semibold text-light-text">{metrics.isPeak ? 'VO₂peak' : 'VO₂max'}</p><p className="text-2xl font-bold text-brand-accent">{metrics.vo2max.toFixed(2)}</p><p className="text-xs text-gray-500">L/min</p></div>
                <div className="bg-gray-50 p-4 rounded-lg text-center"><p className="text-sm font-semibold text-light-text">{metrics.isPeak ? 'VO₂peak/kg' : 'VO₂max/kg'}</p><p className="text-2xl font-bold text-brand-accent">{metrics.vo2max_kg.toFixed(2)}</p><p className="text-xs text-gray-500">mL/min/kg</p></div>
                <div className="bg-gray-50 p-4 rounded-lg text-center"><p className="text-sm font-semibold text-light-text">VEmax</p><p className="text-2xl font-bold text-dark-text">{metrics.vemax.toFixed(2)}</p><p className="text-xs text-gray-500">L/min</p></div>
                <div className="bg-gray-50 p-4 rounded-lg text-center"><p className="text-sm font-semibold text-light-text">HRmax</p><p className="text-2xl font-bold text-dark-text">{metrics.hrmax.toFixed(0)}</p><p className="text-xs text-gray-500">bpm</p></div>
                <div className="bg-gray-50 p-4 rounded-lg text-center"><p className="text-sm font-semibold text-light-text">RERmax</p><p className="text-2xl font-bold text-dark-text">{metrics.rermax.toFixed(2)}</p></div>
                {isPlateauDetailsVisible && metrics.plateauStageSummary && (
                    <div className="col-span-2 md:col-span-3 mt-4 p-4 bg-blue-50 rounded-lg">
                        <h4 className="font-bold text-brand-blue mb-2">各阶段末30秒平均数据 (基于平滑数据)</h4>
                        <div className="overflow-x-auto text-xs">
                            <table className="min-w-full">
                                <thead><tr className="border-b-2 border-brand-accent"><th className="p-2 text-left">阶段</th><th className="p-2 text-right">阶段时长(s)</th><th className="p-2 text-right">末30s平均V'O₂ (L/min)</th><th className="p-2 text-right">ΔV'O₂ (L/min)</th></tr></thead>
                                <tbody>{metrics.plateauStageSummary.map((s) => <tr key={s.stage} className={s.stage === metrics.plateauStageSummary!.length ? 'bg-blue-200 font-bold' : ''}><td className="p-2 text-left">{s.stage}</td><td className="p-2 text-right">{s.duration.toFixed(0)}</td><td className="p-2 text-right">{s.avgVo2.toFixed(3)}{s.isPartial && <span className="text-xs italic ml-1">(全阶段)</span>}</td><td className="p-2 text-right">{s.deltaVo2 !== null ? s.deltaVo2.toFixed(3) : '—'}</td></tr>)}</tbody>
                            </table><p className="text-xs text-gray-500 mt-2">注: 平台判断基于最后两个阶段的V'O₂平均值增量(ΔV'O₂)。如末级不足3分钟但长于30秒, V'O₂平均值取自该阶段最后30秒；如末级不足30秒, 则取自整个阶段数据。</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const AucCalculator: React.FC<{ onCalculate: (start: number, end: number) => AucResult | null }> = ({ onCalculate }) => {
    const [startPercent, setStartPercent] = useState(50);
    const [endPercent, setEndPercent] = useState(70);
    const [result, setResult] = useState<AucResult | null>(null);
    const handleCalculate = () => { if (startPercent >= endPercent) { alert("起始百分比必须小于结束百分比。"); return; } setResult(onCalculate(startPercent, endPercent)); };
    return (
        <div className="bg-white shadow-xl rounded-2xl p-6 my-6">
            <h3 className="text-2xl font-bold text-brand-blue mb-4 text-center">AUC 计算模块</h3>
            <div className="flex flex-wrap items-center justify-center gap-4"><label>从 <input type="number" value={startPercent} onChange={e => setStartPercent(Number(e.target.value))} className="w-20 p-1 border rounded" /> %</label><label>至 <input type="number" value={endPercent} onChange={e => setEndPercent(Number(e.target.value))} className="w-20 p-1 border rounded" /> % VO₂max</label><button onClick={handleCalculate} className="px-6 py-2 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-blue-500 transition">计算 AUC</button></div>
            {result && <div className="mt-4 p-4 bg-blue-50 text-center rounded-lg"><p className="text-lg font-semibold">总耗氧量: <span className="text-2xl font-bold text-brand-blue">{result.value.toFixed(3)} L</span></p><p className="text-sm text-gray-600">在 V'O₂ 从 {result.startVo2.toFixed(2)} 到 {result.endVo2.toFixed(2)} L/min 区间内</p></div>}
            {!result && result !== null && <p className="text-center text-red-500 mt-4">无法计算，请检查数据或区间。</p>}
        </div>
    );
};

const PowerCalculatorMode: React.FC = () => {
    const [inputData, setInputData] = useState('');
    const [stageDuration, setStageDuration] = useState(180);
    const [powerIncrement, setPowerIncrement] = useState(50);
    const [results, setResults] = useState<{ name: string; time: number; power: number }[]>([]);
    const calculateMaxPower = (t: number, T: number, P: number): number => { if (t < 0) return 0; const n = Math.floor(t / T); const r = t - T * n; const startPower = P; const powerInc = P; const propPower = (r / T) * powerInc; if (n === 0) return propPower; const completedPower = startPower + (n - 1) * powerInc; return completedPower + propPower; };
    const handleCalculate = () => { const lines = inputData.split('\n').filter(line => line.trim() !== ''); const res = lines.map(line => { const trimmed = line.trim(); const nums = trimmed.match(/\d+/g); if (!nums || nums.length === 0) return null; const lastNumStr = nums[nums.length-1]; const time = parseInt(lastNumStr, 10); const lastIndex = trimmed.lastIndexOf(lastNumStr); const name = (trimmed.substring(0, lastIndex) + trimmed.substring(lastIndex + lastNumStr.length)).trim(); if (name && !isNaN(time)) { return { name, time, power: calculateMaxPower(time, stageDuration, powerIncrement) }; } return null; }).filter(Boolean) as any[]; setResults(res); };
    const handleDownload = () => { if (results.length === 0) return; const csvData = results.map(r => ({ '姓名': r.name, '时间(s)': r.time, '最大功率(W)': r.power.toFixed(2) })); const headers = Object.keys(csvData[0]); const csvRows = [headers.join(','), ...csvData.map(row => headers.map(h => (row as any)[h]).join(','))]; const csvString = csvRows.join('\n'); const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); const url = URL.createObjectURL(blob); link.setAttribute('href', url); link.setAttribute('download', 'max_power_results.csv'); document.body.appendChild(link); link.click(); document.body.removeChild(link); };
    return (<div className="max-w-4xl mx-auto"><h2 className="text-3xl font-bold text-brand-blue mb-6">最大功率计算</h2><div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-6 rounded-lg shadow-lg mb-8"><div><label htmlFor="duration-select" className="block text-sm font-medium text-gray-700 mb-1">阶段时长 (分钟)</label><select id="duration-select" value={stageDuration / 60} onChange={(e) => setStageDuration(Number(e.target.value) * 60)} className="p-2 w-full border rounded-md shadow-sm">{[1, 2, 3, 4, 5].map(m => <option key={m} value={m}>{m}</option>)}</select></div><div><label htmlFor="power-select" className="block text-sm font-medium text-gray-700 mb-1">功率增量 (W)</label><select id="power-select" value={powerIncrement} onChange={(e) => setPowerIncrement(Number(e.target.value))} className="p-2 w-full border rounded-md shadow-sm">{[10, 20, 30, 40, 50, 60, 70, 80].map(w => <option key={w} value={w}>{w}</option>)}</select></div><div className="md:col-span-2"><label htmlFor="data-input" className="block text-sm font-medium text-gray-700 mb-1">输入数据 (每行一个: 姓名 时间(s))</label><textarea id="data-input" rows={8} value={inputData} onChange={(e) => setInputData(e.target.value)} placeholder="例如:&#10;张三 650&#10;李四 735" className="mt-1 block w-full border rounded-md shadow-sm p-2 font-mono" /></div><div className="md:col-span-2 text-center"><button onClick={handleCalculate} className="w-full md:w-auto px-8 py-3 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-blue-500 disabled:bg-gray-400">计算最大功率</button></div></div>{results.length > 0 && <div className="bg-white p-6 rounded-lg shadow-lg"><div className="flex justify-between items-center mb-4"><h3 className="text-xl font-bold text-brand-blue">计算结果</h3><button onClick={handleDownload} className="px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700">下载为 CSV</button></div><div className="overflow-x-auto"><table className="min-w-full divide-y"><thead className="bg-gray-50"><tr><th className="px-6 py-3 text-left text-xs font-medium uppercase">姓名</th><th className="px-6 py-3 text-left text-xs font-medium uppercase">时间 (s)</th><th className="px-6 py-3 text-left text-xs font-medium uppercase">最大功率 (W)</th></tr></thead><tbody className="bg-white divide-y">{results.map((res, i) => <tr key={i}><td className="px-6 py-4">{res.name}</td><td className="px-6 py-4">{res.time}</td><td className="px-6 py-4">{res.power.toFixed(2)}</td></tr>)}</tbody></table></div></div>}</div>);
};

const App: React.FC = () => {
    type View = 'dashboard' | 'single_analysis' | 'batch_processing' | 'power_calculator' | 'longitudinal_comparison';
    const [currentView, setCurrentView] = useState<View>('dashboard');
    const [currentStep, setCurrentStep] = useState(0);
    const [fileName, setFileName] = useState('');
    const [manualBodyWeight, setManualBodyWeight] = useState('');
    const [singleFileDuration, setSingleFileDuration] = useState<number | null>(null);
    const [batchFiles, setBatchFiles] = useState<{file: File, weight: string}[]>([]);
    const [batchSortOrderText, setBatchSortOrderText] = useState('');
    const [batchResultsSortOrderText, setBatchResultsSortOrderText] = useState('');
    const [currentBatchResults, setCurrentBatchResults] = useState<BatchResult[]>([]);
    const [historicalData, setHistoricalData] = useState<BatchResult[]>([]);
    const [batchProcessingStatus, setBatchProcessingStatus] = useState('');
    const [isBatchLoading, setIsBatchLoading] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);
    const { rawData, cleanedData, smoothedData, percentageData, auditLog, cleaningStats, keyMetrics, error, isLoading, parseExcelFile, processOutliers, applyRollingAverage, calculateKeyMetrics, extractPercentageValues, calculateAuc, resetState } = useDataProcessor();
    const LOCAL_STORAGE_KEY = 'vo2max_analysis_history';

    const sortedBatchFiles = useMemo(() => {
        const order = batchSortOrderText.split(/[\r\n]+/).map(name => name.trim()).filter(Boolean);
        if (order.length === 0) return batchFiles;
        const itemsWithNames = batchFiles.map(bf => ({ fileName: extractNameFromFile(bf.file.name), ...bf }));
        return applySortOrder(itemsWithNames, order);
    }, [batchFiles, batchSortOrderText]);
    
    const sortedCurrentBatchResults = useMemo(() => {
        const order = batchResultsSortOrderText.split(/[\r\n]+/).map(name => name.trim()).filter(Boolean);
        if (order.length === 0) return currentBatchResults;
        return applySortOrder(currentBatchResults, order);
    }, [currentBatchResults, batchResultsSortOrderText]);

    useEffect(() => { try { const d = localStorage.getItem(LOCAL_STORAGE_KEY); if(d) setHistoricalData(JSON.parse(d)); } catch (e) { console.error("Failed to load data", e); } }, []);
    useEffect(() => { try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(historicalData)); } catch (e) { console.error("Failed to save data", e); } }, [historicalData]);

    const handleReset = () => { 
        resetState(); 
        setManualBodyWeight(''); 
        setCurrentStep(0); 
        setFileName(''); 
        setSingleFileDuration(null);
        setBatchFiles([]);
        setBatchSortOrderText('');
        setBatchResultsSortOrderText('');
        setBatchProcessingStatus(''); 
        setCurrentView('dashboard');
        setCurrentBatchResults([]);
    };

    const handleFileSelectForSingleAnalysis = useCallback((file: File) => {
        resetState();
        setManualBodyWeight('');
        setFileName(file.name);
        setSingleFileDuration(null);
        extractWeightFromFile(file).then(weight => { if (weight) setManualBodyWeight(weight); });
        extractDurationFromFile(file).then(duration => setSingleFileDuration(duration));
        parseExcelFile(file);
        setCurrentStep(1);
    }, [parseExcelFile, resetState]);

    const handleProcessOutliers = useCallback(() => { const w = parseFloat(manualBodyWeight); if (isNaN(w) || w <= 0) return; processOutliers(rawData, w); setCurrentStep(2); }, [processOutliers, rawData, manualBodyWeight]);
    const handleSmoothing = useCallback(() => { const w = parseFloat(manualBodyWeight); if (isNaN(w) || w <= 0) return; const s = applyRollingAverage(cleanedData, w); if (s) calculateKeyMetrics(s); setCurrentStep(3); }, [applyRollingAverage, calculateKeyMetrics, cleanedData, manualBodyWeight]);
    const handleAnalysis = useCallback(() => { if (keyMetrics) { extractPercentageValues(smoothedData, keyMetrics); setCurrentStep(4); } }, [extractPercentageValues, keyMetrics, smoothedData]);
    
    const handleGenerateReport = async () => {
        const input = reportRef.current;
        if (!input) return;

        setIsGeneratingPdf(true);

        try {
            const canvas = await html2canvas(input, {
                scale: 2, // Higher scale for better resolution
                useCORS: true,
                // Allow html2canvas to render the full scrollable content
                height: input.scrollHeight,
                width: input.scrollWidth,
                windowHeight: input.scrollHeight,
                windowWidth: input.scrollWidth,
            });
            const imgData = canvas.toDataURL('image/png');

            const pdf = new jsPDF({
                orientation: 'landscape',
                unit: 'mm',
                format: 'a4'
            });

            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();

            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;
            const ratio = canvasWidth / canvasHeight;
            const totalImageHeightInPdf = pdfWidth / ratio;

            let position = 0;
            pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, totalImageHeightInPdf);
            
            let heightLeft = totalImageHeightInPdf - pdfHeight;
            let pageCount = 1;

            while (heightLeft > 0) {
                position = -pdfHeight * pageCount;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, totalImageHeightInPdf);
                heightLeft -= pdfHeight;
                pageCount++;
            }
            
            pdf.save(`${fileName.replace(/\.[^/.]+$/, "")}_report.pdf`);

        } catch (error) {
            console.error("Error generating PDF:", error);
            alert("抱歉，生成PDF报告时出错。请检查控制台获取更多信息。");
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const handleSaveToHistory = useCallback(() => {
        if (!smoothedData || smoothedData.length === 0 || !fileName) {
            alert("没有可用于保存的平滑数据。");
            return;
        }
    
        const finalMetrics = calculateKeyMetricsForData(smoothedData);
        if (singleFileDuration !== null) {
            finalMetrics.duration = singleFileDuration;
        }
        
        const finalPercentageData = extractPercentageDataForMetrics(smoothedData, finalMetrics);

        const newRecord: BatchResult = {
            id: `${Date.now()}-${fileName}`,
            testType: 'unspecified',
            fileName: extractNameFromFile(fileName),
            metrics: finalMetrics,
            smoothedData: smoothedData,
            percentageData: finalPercentageData,
            auditLog: auditLog,
            cleaningStats: cleaningStats || undefined,
        };
        setHistoricalData(prev => [...prev, newRecord]);
        alert(`'${extractNameFromFile(fileName)}' 的分析结果已成功存入历史记录。`);
    }, [fileName, smoothedData, singleFileDuration, auditLog, cleaningStats]);

    const handleBatchFileSelect = async (files: FileList) => { const newFiles = await Promise.all(Array.from(files).map(async f => ({ file: f, weight: await extractWeightFromFile(f) || '' }))); setBatchFiles(p => [...p, ...newFiles]); };
    const handleWeightChange = (fileNameToUpdate: string, weight: string) => { setBatchFiles(prevFiles => prevFiles.map(f => f.file.name === fileNameToUpdate ? { ...f, weight } : f)); };
    const handleBatchProcess = async () => {
        const filesToProcess = sortedBatchFiles.filter(f => f.weight && parseFloat(f.weight) > 0);
        if (filesToProcess.length === 0) { alert('没有有效的文件和体重可供处理。'); return; }
        setIsBatchLoading(true);
        setCurrentBatchResults([]);
        setBatchProcessingStatus('开始处理...');
        const newResults: BatchResult[] = [];
        for (let i = 0; i < filesToProcess.length; i++) {
            const { file, weight } = filesToProcess[i]; const bodyWeight = parseFloat(weight); const extractedName = extractNameFromFile(file.name); const duration = await extractDurationFromFile(file);
            setBatchProcessingStatus(`处理中 (${i+1}/${filesToProcess.length}): ${file.name}`);
            try {
                const raw = await parseExcelFileContents(file); const { cleanedData, auditLog, stats } = cleanAndInterpolateData(raw, bodyWeight); const smoothed = applySmoothing(cleanedData, bodyWeight); let metrics = calculateKeyMetricsForData(smoothed); if (duration !== null) metrics.duration = duration; const percentage = extractPercentageDataForMetrics(smoothed, metrics);
                newResults.push({ id: `${Date.now()}-${i}-${file.name}`, testType: 'unspecified', fileName: extractedName, metrics, smoothedData: smoothed, percentageData: percentage, auditLog, cleaningStats: stats });
            } catch (e: any) { console.error(`Failed to process ${file.name}:`, e); setBatchProcessingStatus(`错误: 处理 ${file.name} 失败 - ${e.toString()}`); }
        }
        setHistoricalData(prev => [...prev, ...newResults]);
        setCurrentBatchResults(newResults);
        setBatchFiles([]); 
        setBatchSortOrderText('');
        setBatchResultsSortOrderText('');
        setIsBatchLoading(false); 
        setBatchProcessingStatus(`完成! ${newResults.length} 个新文件已处理并存入历史记录。`);
    };

     // --- Centralized History Management ---
    const handleClearHistory = useCallback(() => {
        setHistoricalData([]);
    }, []);

    const handleTestTypeChange = useCallback((testId: string, newType: BatchResult['testType']) => {
        setHistoricalData(currentData => currentData.map(test =>
            test.id === testId ? { ...test, testType: newType } : test
        ));
    }, []);

    const handleDeleteTests = useCallback((testIdsToDelete: Set<string> | string) => {
        console.log("已删除"); // Log to console to verify trigger
        if (typeof testIdsToDelete === 'string') {
            setHistoricalData(currentData =>
                currentData.filter(test => test.id !== testIdsToDelete)
            );
        } else {
            setHistoricalData(currentData =>
                currentData.filter(test => !testIdsToDelete.has(test.id))
            );
        }
    }, []);


    const renderDashboard = () => (
        <div>
            <h2 className="text-3xl font-bold text-brand-blue mb-8 text-center">选择一个功能模块</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <DashboardCard title="单个文件详细分析" description="上传单个文件进行分步检查、图表分析并生成报告。" icon={<IconSingleFile />} onClick={() => setCurrentView('single_analysis')} />
                <DashboardCard title="多文件批量处理" description="一次性处理多个文件，结果将自动保存用于纵向比较。" icon={<IconBatchFile />} onClick={() => setCurrentView('batch_processing')} />
                <DashboardCard title="最大功率计算" description="根据测试时间和方案，快速从原始数据计算最大功率。" icon={<IconCalculator />} onClick={() => setCurrentView('power_calculator')} />
                <DashboardCard title="摄氧量纵向比较" description="查看所有历史测试数据，对比受试者前后测变化。" icon={<IconChart />} onClick={() => setCurrentView('longitudinal_comparison')} />
            </div>
        </div>
    );

    const DashboardCard: React.FC<{title: string, description: string, icon: React.ReactNode, onClick: () => void}> = ({ title, description, icon, onClick }) => (
        <div onClick={onClick} className="bg-white p-8 rounded-2xl shadow-lg hover:shadow-2xl hover:-translate-y-2 transition-all duration-300 cursor-pointer flex flex-col items-center text-center">
            {icon}
            <h3 className="text-2xl font-bold text-brand-blue mt-4 mb-2">{title}</h3>
            <p className="text-medium-text">{description}</p>
        </div>
    );
    
    const renderSingleAnalysisView = () => (
        <div>
            {currentStep === 0 && (
                <div className="max-w-3xl mx-auto">
                    <h2 className="text-3xl font-bold text-brand-blue mb-6 text-center">单个文件详细分析</h2>
                    <p className="text-center text-gray-600 mb-8">上传单个文件以进行分步详细检查、查看图表和生成报告。</p>
                    <FileUpload onFileSelect={handleFileSelectForSingleAnalysis} isLoading={isLoading} />
                </div>
            )}
            {currentStep > 0 && (
                 <div>
                    <StepIndicator currentStep={currentStep - 1} />
                    {currentStep === 1 && rawData.length > 0 && (
                        <div>
                             <div className="flex items-center justify-between space-x-4 p-4 bg-blue-50 border border-brand-accent rounded-lg mb-6">
                                <div className="flex items-center space-x-3"><InfoIcon /><p className="font-semibold text-brand-blue">已加载文件: <span className="font-bold">{fileName}</span> ({rawData.length}行).</p></div>
                                <div className="flex items-center space-x-2"><label htmlFor="bodyWeightInput" className="font-semibold text-brand-blue">请输入体重 (kg):</label><input id="bodyWeightInput" type="number" value={manualBodyWeight} onChange={(e) => setManualBodyWeight(e.target.value)} placeholder="例如: 70" className="px-2 py-1 border rounded-md w-32" required /></div>
                            </div>
                            <DataTable data={rawData} title="原始数据预览" />
                            <div className="flex justify-end mt-6"><button onClick={handleProcessOutliers} disabled={!manualBodyWeight || parseFloat(manualBodyWeight) <= 0} className="px-6 py-2 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-blue-500 disabled:bg-gray-400">开始异常值处理</button></div>
                        </div>
                    )}
                    {currentStep === 2 && (<div>{cleaningStats && <CleaningSummaryCard stats={cleaningStats} totalPoints={cleanedData.length}/>}<AuditLog log={auditLog} /><DataTable data={cleanedData} title="已插补完毕的数据" /><div className="flex justify-end space-x-4 mt-6"><button onClick={() => exportToCsv(cleanedData, 'cleaned_data.csv')} className="px-6 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700">下载表格</button><button onClick={handleSmoothing} className="px-6 py-2 bg-brand-accent text-white font-semibold rounded-lg hover:bg-blue-500">继续进行30秒滚动平滑处理</button></div></div>)}
                    <div ref={reportRef}>
                        {currentStep >= 3 && keyMetrics && <SummaryCard metrics={keyMetrics} />}
                        {currentStep >= 3 && smoothedData.length > 0 && <><DataChart data={smoothedData} /><DataTable data={smoothedData} title="30秒滚动平滑处理数据" /></>}
                    </div>
                    {currentStep === 3 && <div className="flex justify-end space-x-4 mt-6"><button onClick={() => exportToCsv(smoothedData, 'smoothed_data.csv')} className="px-6 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700">下载平滑处理结果</button><button onClick={handleAnalysis} className="px-6 py-2 bg-brand-accent text-white font-semibold rounded-lg hover:bg-blue-500">进行最终分析</button></div>}
                    {currentStep === 4 && keyMetrics && (
                        <div>
                            <DataTable data={percentageData} title="%VO₂max/peak 数据" />
                            <AucCalculator onCalculate={(s, e) => calculateAuc(smoothedData, keyMetrics.vo2max, s, e)} />
                            
                            {/* Action Buttons Section */}
                            <div className="mt-8 p-6 bg-gray-50 rounded-lg border">
                                <h4 className="text-xl font-bold text-brand-blue mb-4 text-center">最终操作与导出</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    
                                    {/* Save to History */}
                                    <div className="flex flex-col">
                                        <button onClick={handleSaveToHistory} className="px-6 py-3 bg-teal-600 text-white font-semibold rounded-lg shadow-md hover:bg-teal-700 transition-colors">
                                            存入纵向比较
                                        </button>
                                        <p className="text-xs text-gray-500 mt-2">将本次分析结果保存到历史记录中，用于后续的纵向数据对比。</p>
                                    </div>

                                    {/* Generate PDF */}
                                    <div className="flex flex-col">
                                        <button 
                                            onClick={handleGenerateReport} 
                                            disabled={isGeneratingPdf}
                                            className="px-6 py-3 bg-purple-600 text-white font-semibold rounded-lg shadow-md hover:bg-purple-700 transition-colors disabled:bg-gray-400"
                                        >
                                            {isGeneratingPdf ? '正在生成...' : '生成图文报告 (PDF)'}
                                        </button>
                                        <p className="text-xs text-gray-500 mt-2">将关键指标和图表汇总为一份横向、可多页的完整PDF报告。</p>
                                    </div>
                                    
                                    {/* Download Data */}
                                    <div className="flex flex-col">
                                        <button 
                                            onClick={() => exportToXlsx(smoothedData, percentageData, '30秒平滑数据', '百分位摄氧量数据', `${fileName.replace(/\.[^/.]+$/, "")}_processed_data.xlsx`)}
                                            className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 transition-colors">
                                            下载分析数据 (XLSX)
                                        </button>
                                        <p className="text-xs text-gray-500 mt-2">
                                            下载包含两个工作表的Excel文件: 
                                            <br/>1. 30秒平滑处理后的完整数据。
                                            <br/>2. 各百分位下的摄氧量数据。
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-8 border-t pt-6 text-center">
                                    <button onClick={handleReset} className="px-8 py-3 bg-brand-blue text-white font-semibold rounded-lg shadow-md hover:bg-blue-700">
                                        分析另一个文件
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const BatchResultsTable: React.FC<{ results: BatchResult[] }> = ({ results }) => (
        <div className="bg-white p-6 rounded-lg shadow-lg mt-6">
            <h3 className="text-xl font-bold text-brand-blue mb-4">本次批量处理结果</h3>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">受试者</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">时长 (s)</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">V'O2 (L/min)</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">V'O2/kg</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">VEmax (L/min)</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">HRmax</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">RERmax</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">是否平台</th>
                            <th className="px-4 py-3 text-left text-xs font-medium uppercase">下载数据</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y">
                        {results.map((res) => (
                            <tr key={res.id}>
                                <td className="px-4 py-4 whitespace-nowrap">{res.fileName}</td>
                                <td className="px-4 py-4">{res.metrics.duration?.toFixed(0) ?? 'N/A'}</td>
                                <td className="px-4 py-4">{res.metrics.vo2max.toFixed(2)}</td>
                                <td className="px-4 py-4">{res.metrics.vo2max_kg.toFixed(2)}</td>
                                <td className="px-4 py-4">{res.metrics.vemax.toFixed(2)}</td>
                                <td className="px-4 py-4">{res.metrics.hrmax.toFixed(0)}</td>
                                <td className="px-4 py-4">{res.metrics.rermax.toFixed(2)}</td>
                                <td className="px-4 py-4">{res.metrics.plateauReached ? '✔️' : '❌'}</td>
                                <td className="px-4 py-4">
                                    {res.smoothedData && res.percentageData && (
                                        <button
                                            onClick={() => exportToXlsx(res.smoothedData!, res.percentageData!, '平滑数据', '百分比数据', `${res.fileName}_processed_data.xlsx`)}
                                            className="px-3 py-1 bg-green-600 text-white text-xs font-semibold rounded-lg shadow-md hover:bg-green-700 transition"
                                        >
                                            下载
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderBatchProcessingView = () => {
        return (
            <div className="max-w-4xl mx-auto">
                <h2 className="text-3xl font-bold text-brand-blue mb-6">多文件批量处理</h2>
                 <div className="bg-white p-6 rounded-lg shadow-lg space-y-6">
                     <div>
                        <label className="text-sm font-medium text-gray-700 block mb-2">1. 添加新文件 (.xlsx) - 将自动提取体重</label>
                        <input type="file" multiple onChange={(e) => e.target.files && handleBatchFileSelect(e.target.files)} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-brand-blue hover:file:bg-blue-100" accept=".xlsx, .xls" />
                    </div>
                    {batchFiles.length > 0 && (
                        <>
                            <div>
                                <label htmlFor="batch-sort-order" className="text-sm font-medium text-gray-700 block mb-2">2. (可选) 按姓名排序文件 (每行一个)</label>
                                <textarea
                                    id="batch-sort-order"
                                    value={batchSortOrderText}
                                    onChange={(e) => setBatchSortOrderText(e.target.value)}
                                    placeholder="例如:&#10;李四&#10;张三&#10;将按此顺序排列下方文件..."
                                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-brand-accent focus:border-brand-accent"
                                    rows={3}
                                />
                            </div>
                            <div>
                               <h4 className="font-semibold text-base mb-2">3. 核对并调整体重 (kg)</h4>
                                <div className="max-h-60 overflow-y-auto border p-2 rounded-md"><table className="min-w-full"><tbody>
                                   {sortedBatchFiles.map((item) => (<tr key={item.file.name} className="border-b"><td className="py-2 pr-4 text-gray-700 text-sm truncate">{item.file.name}</td><td><input type="number" value={item.weight} onChange={(e) => handleWeightChange(item.file.name, e.target.value)} placeholder="例如: 70" className="px-2 py-1 border rounded-md w-32"/></td></tr>))}
                                </tbody></table></div>
                            </div>
                        </>
                    )}
                    <div>
                        <button onClick={handleBatchProcess} disabled={isBatchLoading || batchFiles.length === 0} className="w-full md:w-auto px-6 py-3 bg-brand-accent text-white font-semibold rounded-lg shadow-md hover:bg-blue-500 disabled:bg-gray-400">
                             {isBatchLoading ? '处理中...' : `处理 ${sortedBatchFiles.length} 个文件`}
                         </button>
                    </div>
                 </div>
                 
                 {batchProcessingStatus && <div className={`text-center mt-4 p-4 rounded-lg ${batchProcessingStatus.startsWith("完成") ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>{batchProcessingStatus}</div>}

                 {currentBatchResults.length > 0 && (
                    <div>
                         <div className="mt-6">
                            <label htmlFor="batch-results-sort-order" className="text-sm font-medium text-gray-700 block mb-2">按姓名排序结果 (每行一个)</label>
                            <textarea
                                id="batch-results-sort-order"
                                value={batchResultsSortOrderText}
                                onChange={(e) => setBatchResultsSortOrderText(e.target.value)}
                                placeholder="例如:&#10;李四&#10;张三&#10;将按此顺序排列下方表格..."
                                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:ring-brand-accent focus:border-brand-accent"
                                rows={3}
                            />
                        </div>
                        <BatchResultsTable results={sortedCurrentBatchResults} />
                        <div className="text-center mt-6 space-x-4">
                            <button onClick={() => { setCurrentBatchResults([]); setBatchProcessingStatus(''); setBatchResultsSortOrderText('') }} className="px-6 py-2 bg-gray-500 text-white font-semibold rounded-lg shadow-md hover:bg-gray-600">清空本次结果</button>
                            <button onClick={() => setCurrentView('longitudinal_comparison')} className="px-6 py-2 bg-brand-blue text-white font-semibold rounded-lg shadow-md hover:bg-blue-700">查看纵向比较</button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4 sm:p-6 lg:p-8">
            <div className="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-800 rounded-r-lg p-4 mb-8 flex items-start shadow-sm" role="alert">
                <button className="p-1 rounded-full hover:bg-yellow-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 mr-3 shrink-0" aria-label="Information">
                    <LightbulbIcon />
                </button>
                <div>
                    <p className="text-sm">
                        Developed by Dr. Zepeng Hu (Capital University of Physical Education and Sports). This tool is designed for academic/research analysis of raw MetaLyzer Excel data. Not for commercial use. Support for other brands is in development.
                    </p>
                </div>
            </div>
            
            <header className="text-center mb-8">
                 <h1 className="text-4xl font-extrabold text-brand-blue">最大/峰值氧摄取量分析工具</h1>
                <p className="text-md text-medium-text mt-2">适用于 MetaLyzer 原始 Excel 数据</p>
                 {currentView !== 'dashboard' && <button onClick={handleReset} className="mt-4 text-sm text-gray-500 hover:text-brand-blue">&larr; 返回仪表盘并重置</button>}
            </header>
            
            {error && <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">{error}</div>}
            
            {currentView === 'dashboard' && renderDashboard()}
            {currentView === 'single_analysis' && renderSingleAnalysisView()}
            {currentView === 'batch_processing' && renderBatchProcessingView()}
            {currentView === 'power_calculator' && <PowerCalculatorMode />}
            {currentView === 'longitudinal_comparison' && (
                <HistoryAndComparison 
                    data={historicalData} 
                    onDeleteTest={handleDeleteTests}
                    onClearHistory={handleClearHistory}
                    onTestTypeChange={handleTestTypeChange}
                />
            )}

        </div>
    );
}

export default App;
