import React, { useState, useMemo, useCallback, FC, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { FileUpload } from './FileUpload';
import { parseExcelFileContents, applySmoothing } from '../hooks/useDataProcessor';
import type { ProcessedDataRow, AnalysisRecord } from '../types';

const extractNameFromFile = (fileName: string): string => {
    const chineseParts = fileName.match(/[\u4e00-\u9fa5]+/g);
    if (!chineseParts || chineseParts.length === 0) return fileName.replace(/\.[^/.]+$/, "");
    return chineseParts.join('').replace(/(.+)\1/, '$1');
};

type Threshold = {
    vo2: number;
    reason: string;
} | null;

export type AnalysisData = Omit<AnalysisRecord, 'id' | 'timestamp'>;

type ChartYKey = "V'CO2" | "V'E" | "RER" | "V'E/V'O2" | "V'E/V'CO2" | "PETO2" | "PETCO2";
type ChartXKey = "V'O2" | "V'CO2";
type PlotStyle = 'points' | 'line';

const estimateInitialThresholds = (data: ProcessedDataRow[]): { lt: Threshold, rcp: Threshold } => {
    if (data.length < 5) return { lt: null, rcp: null };

    const findNadir = (d: ProcessedDataRow[], key: "V'E/V'O2" | "V'E/V'CO2", startIndex: number = 0): { point: ProcessedDataRow, originalIndex: number } | null => {
        const dataSlice = d.slice(startIndex).filter(row => typeof row[key] === 'number' && typeof row["V'O2"] === 'number');
        if (dataSlice.length === 0) return null;
        const minValue = Math.min(...dataSlice.map(row => row[key] as number));
        const nadirPoint = dataSlice.find(row => row[key] === minValue);
        if (!nadirPoint) return null;
        const originalIndex = d.findIndex(originalRow => originalRow.timeInSeconds === nadirPoint.timeInSeconds);
        return { point: nadirPoint, originalIndex };
    };

    const ltResult = findNadir(data, "V'E/V'O2", 0);
    if (!ltResult) return { lt: null, rcp: null };

    const lt: Threshold = {
        vo2: ltResult.point["V'O2"]!,
        reason: "初步预估: 基于通气当量法 (V'E/V'O₂ 最低点, 第一通气阈 VT1)",
    };

    const rcpResult = findNadir(data, "V'E/V'CO2", ltResult.originalIndex + 1);
    if (!rcpResult || rcpResult.point["V'O2"]! <= lt.vo2) {
        // Fallback if RCP nadir is not found after LT, or is before LT
        return { lt, rcp: null };
    }

    const rcp: Threshold = {
        vo2: rcpResult.point["V'O2"]!,
        reason: "初步预估: 基于 LT 后 V'E/V'CO₂ 开始系统性升高 (第二通气阈 VT2)",
    };
    return { lt, rcp };
};

const ThresholdChart: FC<{ data: ProcessedDataRow[], xKey: ChartXKey, yKey: ChartYKey, title: string, xDomain: [number, number] | ['auto', 'auto'], yDomain: [number, number] | ['auto', 'auto'], ltVo2: number | null, rcpVo2: number | null, plotStyle: PlotStyle, onMouseMove?: (e: any) => void, onMouseDown?: (e: any) => void, onMouseUp?: (e: any) => void, onMouseLeave?: (e: any) => void, cursor?: string }> = React.memo(({ data, xKey, yKey, title, xDomain, yDomain, ltVo2, rcpVo2, plotStyle, onMouseMove, onMouseDown, onMouseUp, onMouseLeave, cursor }) => (
    <div className="bg-white p-4 rounded-lg shadow-md border border-gray-200" style={{ cursor: cursor || 'default' }}>
        <h4 className="font-bold text-center text-brand-blue mb-2">{title}</h4>
        <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 25 }} onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={onMouseUp} onMouseLeave={onMouseLeave}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" dataKey={xKey} domain={xDomain} allowDataOverflow tickFormatter={(v) => v.toFixed(1)} label={{ value: `${xKey} (L/min)`, position: 'insideBottom', offset: -15, fontSize: 12 }} />
                <YAxis domain={yDomain} tickFormatter={(v) => typeof v === 'number' ? v.toFixed(2) : v} width={80} label={{ value: yKey, angle: -90, position: 'insideLeft', offset: -5, fontSize: 12 }} />
                <Tooltip formatter={(value: number, name: string) => [typeof value === 'number' ? value.toFixed(3) : value, name]} />
                {plotStyle === 'line' ? (<Line type="monotone" dataKey={yKey} stroke="#00A8E8" dot={false} strokeWidth={2} />) : (<Line type="monotone" dataKey={yKey} stroke="none" dot={{ r: 3, fill: '#00A8E8' }} activeDot={{ r: 6 }} />)}
                {ltVo2 !== null && <ReferenceLine ifOverflow="extendDomain" x={ltVo2} stroke="#E53E3E" strokeWidth={2} strokeDasharray="4 4" label={{ value: 'LT', position: 'top', fill: '#E53E3E' }} />}
                {rcpVo2 !== null && <ReferenceLine ifOverflow="extendDomain" x={rcpVo2} stroke="#38A169" strokeWidth={2} strokeDasharray="4 4" label={{ value: 'RCP', position: 'top', fill: '#38A169' }} />}
            </LineChart>
        </ResponsiveContainer>
    </div>
));

interface ThresholdAnalyzerProps {
    onSave: (data: AnalysisData) => void;
    initialData?: AnalysisRecord | null;
    onReset: () => void;
}

export const ThresholdAnalyzer: FC<ThresholdAnalyzerProps> = ({ onSave, initialData, onReset }) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<ProcessedDataRow[]>([]);
    const [plotStyle, setPlotStyle] = useState<PlotStyle>('points');
    const [initialLt, setInitialLt] = useState<Threshold>(null);
    const [initialRcp, setInitialRcp] = useState<Threshold>(null);
    const [manualLtVo2, setManualLtVo2] = useState<number | null>(null);
    const [manualRcpVo2, setManualRcpVo2] = useState<number | null>(null);
    const [testType, setTestType] = useState<'pre' | 'mid' | 'post'>('pre');
    const [vo2Domain, setVo2Domain] = useState<[number, number]>([0, 5]);

    const [draggingThreshold, setDraggingThreshold] = useState<'lt' | 'rcp' | null>(null);
    const [isHovering, setIsHovering] = useState<'lt' | 'rcp' | null>(null);
    const visualDragVo2Ref = useRef<number | null>(null);

    useEffect(() => {
        if (initialData) {
            setData(initialData.data);
            setFileName(initialData.fileName);
            setManualLtVo2(initialData.ltVo2);
            setManualRcpVo2(initialData.rcpVo2);
            setInitialLt({ vo2: initialData.ltVo2, reason: initialData.ltReason } as Threshold);
            setInitialRcp({ vo2: initialData.rcpVo2, reason: initialData.rcpReason } as Threshold);
            setVo2Domain(initialData.vo2Domain);
            setPlotStyle(initialData.plotStyle);
            setTestType(initialData.testType);
        }
    }, [initialData]);

    const vo2Range = useMemo(() => {
        if (data.length === 0) return [0, 5];
        const vo2Values = data.map(d => d["V'O2"]).filter(v => typeof v === 'number') as number[];
        return vo2Values.length > 0 ? [Math.min(...vo2Values), Math.max(...vo2Values)] : [0, 5];
    }, [data]);
    
    const yDomains = useMemo(() => {
        const getDomain = (key: ChartYKey | ChartXKey): [number, number] | ['auto', 'auto'] => {
            const dataInDomain = data.filter(d => d["V'O2"]! >= vo2Domain[0] && d["V'O2"]! <= vo2Domain[1]);
            const values = dataInDomain.map(d => d[key]).filter(v => typeof v === 'number') as number[];
            if (values.length < 2) return ['auto', 'auto'];
            const min = Math.min(...values), max = Math.max(...values);
            if (key === "V'CO2" || key === "V'E") return [min - (max - min) * 0.05, max + (max - min) * 0.05];
            const padding = (max - min) * 0.25;
            return [min - padding, max + padding];
        };
        const petKey = data.some(d => d.PETCO2 != null) ? 'PETCO2' : data.some(d => d.PETO2 != null) ? 'PETO2' : null;
        return {
            "V'O2": getDomain("V'O2"), "V'CO2": getDomain("V'CO2"), "V'E": getDomain("V'E"),
            "RER": getDomain("RER"), "V'E/V'O2": getDomain("V'E/V'O2"), "V'E/V'CO2": getDomain("V'E/V'CO2"),
            ...(petKey && { [petKey]: getDomain(petKey) })
        };
    }, [data, vo2Domain]);

    const snapToDataPoint = useCallback(() => {
        if (!draggingThreshold || visualDragVo2Ref.current === null) return;
        const valueToSnap = visualDragVo2Ref.current;
        const closestPoint = data.reduce((prev, curr) => Math.abs((curr["V'O2"] ?? -Infinity) - valueToSnap) < Math.abs((prev["V'O2"] ?? -Infinity) - valueToSnap) ? curr : prev);
        if (closestPoint && typeof closestPoint["V'O2"] === 'number') {
            (draggingThreshold === 'lt' ? setManualLtVo2 : setManualRcpVo2)(closestPoint["V'O2"]);
        }
        setDraggingThreshold(null);
    }, [draggingThreshold, data]);

    const handleChartMouseMove = useCallback((e: any) => {
        if (!e || typeof e.activeLabel !== 'number' || !data.length) return;
        const currentVo2 = e.activeLabel;
        visualDragVo2Ref.current = currentVo2;

        if (draggingThreshold) {
            requestAnimationFrame(() => (draggingThreshold === 'lt' ? setManualLtVo2 : setManualRcpVo2)(currentVo2));
        } else {
            const tolerance = (vo2Domain[1] - vo2Domain[0]) * 0.02;
            const ltDiff = manualLtVo2 !== null ? Math.abs(currentVo2 - manualLtVo2) : Infinity;
            const rcpDiff = manualRcpVo2 !== null ? Math.abs(currentVo2 - manualRcpVo2) : Infinity;
            if (ltDiff < tolerance || rcpDiff < tolerance) setIsHovering(ltDiff < rcpDiff ? 'lt' : 'rcp');
            else setIsHovering(null);
        }
    }, [draggingThreshold, manualLtVo2, manualRcpVo2, vo2Domain, data.length]);

    const handleChartMouseDown = useCallback(() => { if (isHovering) setDraggingThreshold(isHovering); }, [isHovering]);
    const handleChartMouseUp = useCallback(snapToDataPoint, [snapToDataPoint]);
    const handleChartMouseLeave = useCallback(snapToDataPoint, [snapToDataPoint]);

    const handleFileSelect = useCallback(async (file: File) => {
        onReset(); // Reset parent state when a new file is loaded
        setIsLoading(true);
        setError(null);
        setFileName(file.name);
        try {
            const parsed = await parseExcelFileContents(file);
            const exerciseData = parsed.filter(d => d.timeInSeconds >= 60);
            setData(exerciseData);
            const { lt, rcp } = estimateInitialThresholds(applySmoothing(exerciseData, 70));
            setInitialLt(lt); setManualLtVo2(lt?.vo2 ?? null);
            setInitialRcp(rcp); setManualRcpVo2(rcp?.vo2 ?? null);
            const vo2s = exerciseData.map(d => d["V'O2"]).filter(v => typeof v === 'number') as number[];
            if (vo2s.length > 0) setVo2Domain([Math.floor(Math.min(...vo2s) * 10) / 10, Math.ceil(Math.max(...vo2s) * 10) / 10]);
        } catch (err: any) { setError(err.toString()); setData([]); } finally { setIsLoading(false); }
    }, [onReset]);

    const handleSave = useCallback(() => {
        if (!fileName || data.length === 0) { alert("没有可保存的数据。"); return; }
        onSave({
            fileName, subjectName: extractNameFromFile(fileName), testType,
            ltVo2: manualLtVo2, rcpVo2: manualRcpVo2,
            ltReason: manualLtVo2 === initialLt?.vo2 ? initialLt?.reason : "手动标记",
            rcpReason: manualRcpVo2 === initialRcp?.vo2 ? initialRcp?.reason : "手动标记",
            vo2Domain, plotStyle, data
        });
    }, [onSave, fileName, data, manualLtVo2, manualRcpVo2, initialLt, initialRcp, vo2Domain, plotStyle, testType]);

    const petKey = useMemo((): 'PETO2' | 'PETCO2' | null => data.some(d => d.PETCO2 != null) ? 'PETCO2' : data.some(d => d.PETO2 != null) ? 'PETO2' : null, [data]);
    const chartConfigs: { yKey: ChartYKey, xKey: ChartXKey, title: string }[] = [
        { yKey: "V'E", xKey: "V'CO2", title: "V-Slope: V̇E vs. V̇CO₂" }, { yKey: "V'CO2", xKey: "V'O2", title: "V̇CO₂ vs. V̇O₂" },
        { yKey: "V'E", xKey: "V'O2", title: "V̇E vs. V̇O₂" }, { yKey: "V'E/V'O2", xKey: "V'O2", title: "V̇E/V̇O₂ vs. V̇O₂" },
        { yKey: "V'E/V'CO2", xKey: "V'O2", title: "V̇E/V̇CO₂ vs. V̇O₂" }, { yKey: "RER", xKey: "V'O2", title: "RER vs. V̇O₂" },
        ...(petKey ? [{ yKey: petKey, xKey: "V'O2" as ChartXKey, title: `${petKey} vs. V'O₂` }] : [])
    ];

    if (!fileName && !initialData) {
        return (
            <div>
                <h2 className="text-3xl font-bold text-brand-blue mb-6 text-center">递增运动阈值 (LT/RCP) 分析器</h2>
                <p className="text-center text-gray-600 mb-8">上传增量运动测试的原始数据文件，以可视化和识别通气阈值。</p>
                <FileUpload onFileSelect={handleFileSelect} isLoading={isLoading} />
                {error && <div className="text-red-500 mt-4 text-center">{error}</div>}
            </div>
        );
    }
    
    return (
        <div>
            <h2 className="text-3xl font-bold text-brand-blue mb-6 text-center">当前分析: <span className="text-gray-700">{fileName || initialData?.fileName}</span></h2>
            <div className="bg-white p-6 rounded-lg shadow-xl mb-6">
                {/* Controls and Info Display */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-4">
                    <div className="lg:col-span-1">
                        <label className="block text-sm font-medium text-gray-700">V̇O₂ 轴范围 (L/min)</label>
                        <div className="flex items-center gap-2 mt-1">
                            <input type="number" step="0.1" className="w-24 p-1 border rounded" value={vo2Domain[0].toFixed(2)} onChange={e => setVo2Domain(d => [Number(e.target.value), d[1]])} />
                            <input type="range" min={vo2Range[0]} max={vo2Range[1]} step="0.01" className="w-full" value={vo2Domain[0]} onChange={e => setVo2Domain(d => [Number(e.target.value) > d[1] ? d[1] : Number(e.target.value), d[1]])} />
                        </div>
                         <div className="flex items-center gap-2 mt-1">
                            <input type="number" step="0.1" className="w-24 p-1 border rounded" value={vo2Domain[1].toFixed(2)} onChange={e => setVo2Domain(d => [d[0], Number(e.target.value)])} />
                            <input type="range" min={vo2Range[0]} max={vo2Range[1]} step="0.01" className="w-full" value={vo2Domain[1]} onChange={e => setVo2Domain(d => [d[0], Number(e.target.value) < d[0] ? d[0] : Number(e.target.value)])} />
                        </div>
                         <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">图表样式</label>
                            <div className="flex items-center space-x-1 p-1 bg-gray-200 rounded-lg"><button onClick={() => setPlotStyle('points')} className={`w-1/2 px-4 py-1 text-sm font-semibold rounded-md transition-colors ${plotStyle === 'points' ? 'bg-white text-brand-blue shadow' : 'text-gray-600 hover:bg-gray-100'}`}>数据点</button><button onClick={() => setPlotStyle('line')} className={`w-1/2 px-4 py-1 text-sm font-semibold rounded-md transition-colors ${plotStyle === 'line' ? 'bg-white text-brand-blue shadow' : 'text-gray-600 hover:bg-gray-100'}`}>连接线</button></div>
                        </div>
                    </div>
                    <div className="lg:col-span-2 space-y-4">
                        <div className="p-4 bg-red-50 border border-red-200 rounded-lg"><p className="text-sm font-medium text-red-700">乳酸阈 (LT) @ V̇O₂: <span className="font-bold">{manualLtVo2?.toFixed(3) ?? 'N/A'}</span> L/min</p><p className="text-xs text-red-600 mt-1">{manualLtVo2 === initialLt?.vo2 ? initialLt?.reason : '手动标记'}</p></div>
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg"><p className="text-sm font-medium text-green-700">呼吸代偿点 (RCP) @ V̇O₂: <span className="font-bold">{manualRcpVo2?.toFixed(3) ?? 'N/A'}</span> L/min</p><p className="text-xs text-green-600 mt-1">{manualRcpVo2 === initialRcp?.vo2 ? initialRcp?.reason : '手动标记'}</p></div>
                    </div>
                     <div className="lg:col-span-3 border-t pt-4 mt-4 flex flex-wrap justify-center items-center gap-4">
                        <div className="flex items-center gap-2"><label htmlFor="test-type" className="text-sm font-semibold text-gray-700">测试类型:</label><select id="test-type" value={testType} onChange={e => setTestType(e.target.value as any)} className="p-2 border rounded-md shadow-sm bg-white"><option value="pre">前测</option><option value="mid">中测</option><option value="post">后测</option></select></div>
                        <button onClick={handleSave} className="px-4 py-2 text-sm font-semibold text-white bg-brand-blue rounded-lg shadow hover:bg-blue-800">保存到历史记录</button>
                        <button onClick={() => { onReset(); }} className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-200 rounded-lg shadow hover:bg-gray-300">开始新分析</button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {chartConfigs.map(({ yKey, xKey, title }) => (
                    <ThresholdChart key={title} data={data} yKey={yKey} xKey={xKey} title={title} xDomain={xKey === "V'CO2" ? yDomains["V'CO2"] : vo2Domain} yDomain={yDomains[yKey as keyof typeof yDomains] || ['auto', 'auto']} ltVo2={manualLtVo2} rcpVo2={manualRcpVo2} plotStyle={plotStyle} onMouseMove={handleChartMouseMove} onMouseDown={handleChartMouseDown} onMouseUp={handleChartMouseUp} onMouseLeave={handleChartMouseLeave} cursor={isHovering || draggingThreshold ? 'ew-resize' : 'crosshair'} />
                ))}
            </div>
        </div>
    );
};
