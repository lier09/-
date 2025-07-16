
import { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import type { RawDataRow, ProcessedDataRow, AuditLogEntry, KeyMetrics, CleaningStats, AucResult, PlateauStageSummary } from '../types';

const HEADER_MAPPING: { [key: string]: keyof ProcessedDataRow } = {
  "t": 't',
  "V'O2": "V'O2", "VO2": "V'O2",
  "V'CO2": "V'CO2", "VCO2": "V'CO2",
  "V'E": "V'E", "VE": "V'E",
  "HR": 'HR',
  "VT": 'VT',
  "BF": 'BF',
  "V'O2/kg": "V'O2/kg", "VO2/kg": "V'O2/kg",
  "V'O2/HR": "V'O2/HR", "VO2/HR": "V'O2/HR",
  "V'E/V'O2": "V'E/V'O2", "VE/VO2": "V'E/V'O2",
  "V'E/V'CO2": "V'E/V'CO2", "VE/VCO2": "V'E/V'CO2",
  "RER": 'RER',
  "VD/VT(est)": "VD/VT(est)",
  "Load": 'Load',
  "Marker": 'Marker',
};

const OUTLIER_COLS: (keyof ProcessedDataRow)[] = ["V'O2", "V'CO2", "V'E", "HR", "VT", "BF"];
const NUMERIC_COLS: (keyof ProcessedDataRow)[] = [...OUTLIER_COLS, "V'O2/kg", "V'O2/HR", "V'E/V'O2", "V'E/V'CO2", "RER", "VD/VT(est)", "Load"];

const timeStringToSeconds = (timeStr: string): number => {
    const parts = timeStr.split(/[:.]/);
    if (parts.length < 3) return 0; // Invalid format
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseInt(parts[2], 10) || 0;
    const ms = parts.length > 3 ? parseInt(parts[3], 10) || 0 : 0;
    return h * 3600 + m * 60 + s + ms / 1000;
};

const recalculateDerivedMetrics = (row: ProcessedDataRow, bodyWeight: number): ProcessedDataRow => {
    const newRow = { ...row };
    const vo2 = newRow["V'O2"];
    const vco2 = newRow["V'CO2"];
    const ve = newRow["V'E"];
    const hr = newRow["HR"];

    if (typeof vo2 === 'number' && bodyWeight > 0) newRow["V'O2/kg"] = vo2 * 1000 / bodyWeight; else newRow["V'O2/kg"] = null;
    if (typeof vo2 === 'number' && typeof hr === 'number' && hr > 0) newRow["V'O2/HR"] = vo2 * 1000 / hr; else newRow["V'O2/HR"] = null;
    if (typeof ve === 'number' && typeof vo2 === 'number' && vo2 > 0) newRow["V'E/V'O2"] = ve / vo2; else newRow["V'E/V'O2"] = null;
    if (typeof ve === 'number' && typeof vco2 === 'number' && vco2 > 0) newRow["V'E/V'CO2"] = ve / vco2; else newRow["V'E/V'CO2"] = null;
    
    if (typeof vco2 === 'number' && typeof vo2 === 'number' && vo2 > 0) {
        const rer = vco2 / vo2;
        newRow["RER"] = rer;
        newRow["VD/VT(est)"] = Math.max(0, 0.25 * rer - 0.05);
    } else {
        newRow["RER"] = null;
        newRow["VD/VT(est)"] = null;
    }
    
    return newRow;
};

// --- Core Logic Functions (Stateless) ---

export const extractDurationFromFile = (file: File): Promise<number | null> => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary', cellFormula: false, cellHTML: false });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];

                const cellC97 = worksheet['C97'];
                if (cellC97 && cellC97.w) { // 'w' is the formatted text
                    const timeStr = String(cellC97.w); // e.g., "0:10:01" or "10:01"
                    const parts = timeStr.split(':').map(part => parseInt(part, 10));
                    let seconds = 0;
                    if (parts.length === 3) { // h:mm:ss
                        seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
                    } else if (parts.length === 2) { // mm:ss
                        seconds = parts[0] * 60 + parts[1];
                    } else {
                        resolve(null); // Unrecognized format
                        return;
                    }

                    if (!isNaN(seconds)) {
                        resolve(seconds);
                        return;
                    }
                }
                resolve(null); // Cell not found or empty
            } catch (err) {
                console.error("Error extracting duration:", err);
                resolve(null);
            }
        };
        reader.onerror = () => {
             console.error("Failed to read file for duration extraction.");
             resolve(null);
        };
        reader.readAsBinaryString(file);
    });
};

export const extractWeightFromFile = (file: File): Promise<string> => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary', cellFormula: false, cellHTML: false });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];

                // Method 1: Direct cell access for C36 (most reliable)
                const cellC36 = worksheet['C36'];
                if (cellC36) {
                    // Prefer the raw value if it's a number
                    if (typeof cellC36.v === 'number' && cellC36.v > 0) {
                        resolve(String(cellC36.v));
                        return;
                    }
                    // Fallback to formatted text if value is not a number (e.g., text-formatted number)
                    if (cellC36.w) {
                         const weightCandidate = parseFloat(String(cellC36.w));
                         if (!isNaN(weightCandidate) && weightCandidate > 0) {
                            resolve(String(weightCandidate));
                            return;
                         }
                    }
                }

                // If direct access fails, fall back to array-based parsing for keyword searching.
                const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
                    header: 1,
                    defval: null,
                });
                
                // Method 2: Keyword search for "体重"
                for (const row of rows) {
                    if (!row) continue;
                    for (let i = 0; i < row.length; i++) {
                        if (row[i] && String(row[i]).includes('体重')) {
                            // Check the cell to the right
                            if (i + 1 < row.length && row[i+1]) {
                                const weightCandidate = parseFloat(String(row[i + 1]));
                                if (!isNaN(weightCandidate) && weightCandidate > 0) {
                                    resolve(String(weightCandidate));
                                    return;
                                }
                            }
                        }
                    }
                }
                
                // Method 3 (Fallback): Original "Bw:" logic on row 36
                if (rows.length >= 36 && rows[35]) {
                    const row36 = rows[35];
                    for (let i = 0; i < row36.length; i++) {
                        if (row36[i] === null || row36[i] === undefined) continue;
                        
                        const cellValue = String(row36[i]).trim();
                        if (cellValue.toLowerCase().includes('bw:')) {
                            let weightStr = cellValue.split(':')[1];
                            if (!weightStr && i + 1 < row36.length && row36[i+1]) {
                                weightStr = String(row36[i + 1] || '');
                            }
                            
                            if (weightStr) {
                                const weight = parseFloat(weightStr.trim());
                                if (!isNaN(weight) && weight > 0) {
                                    resolve(String(weight));
                                    return;
                                }
                            }
                        }
                    }
                }

                resolve(''); // If not found by any method
            } catch (err) {
                console.error("Error extracting weight:", err);
                resolve(''); // Resolve with empty on error
            }
        };
        reader.onerror = () => {
            console.error("Failed to read file for weight extraction.");
            resolve('');
        };
        reader.readAsBinaryString(file);
    });
};


export const parseExcelFileContents = (file: File): Promise<ProcessedDataRow[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                
                const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
                
                let headerRowIndex = -1;
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    if (row && String(row[0]).trim().toLowerCase() === 't' && row.includes("V'O2") && row.includes("HR")) {
                        headerRowIndex = i;
                        break;
                    }
                }

                if (headerRowIndex === -1 && rows.length > 0) {
                    const firstRow = rows[0] || [];
                     if (String(firstRow[0]).trim().toLowerCase() === 't' && firstRow.includes("V'O2")) {
                        headerRowIndex = 0;
                     }
                }
                
                if (headerRowIndex === -1) {
                    return reject("无法自动定位数据表头。请确保文件中包含以 't' 开头的标准数据表。");
                }

                const rawHeaders = rows[headerRowIndex] as string[];
                const dataRows = rows.slice(headerRowIndex + 2);

                const json: RawDataRow[] = dataRows.map(rowArray => {
                    const rowObject: RawDataRow = {};
                    rawHeaders.forEach((header, index) => {
                        if (header) {
                            rowObject[String(header).trim()] = rowArray[index];
                        }
                    });
                    return rowObject;
                }).filter(obj => obj.t !== "" && obj.t !== undefined && obj.t !== null);

                const processed: ProcessedDataRow[] = json.map(rawRow => {
                    const newRow: { [key: string]: any } = {};
                     for (const rawKey in rawRow) {
                        const key = rawKey.trim();
                        const mappedKey = HEADER_MAPPING[key] || key;
                        const originalValue = rawRow[rawKey];

                        if (originalValue === null) {
                            newRow[mappedKey] = null;
                            continue;
                        }

                        if (mappedKey === 't') {
                           const timeStr = String(originalValue).trim();
                           newRow[mappedKey] = timeStr;
                           newRow['timeInSeconds'] = timeStringToSeconds(timeStr);
                        } else if (mappedKey === 'Marker') {
                           newRow[mappedKey] = String(originalValue).trim();
                        } else if (NUMERIC_COLS.includes(mappedKey as any)) {
                            const value = parseFloat(String(originalValue));
                            newRow[mappedKey] = isNaN(value) ? null : value;
                        } else {
                            newRow[mappedKey] = originalValue;
                        }
                    }
                    return newRow as ProcessedDataRow;
                }).filter(row => row.t && String(row.t).trim() !== "");

                resolve(processed);
            } catch (err) {
                console.error(err);
                reject("解析Excel文件失败。请确保文件格式正确。");
            }
        };
        reader.onerror = () => {
            reject("读取文件失败。");
        };
        reader.readAsBinaryString(file);
    });
};

export const cleanAndInterpolateData = (data: ProcessedDataRow[], bodyWeight: number): { cleanedData: ProcessedDataRow[], auditLog: AuditLogEntry[], stats: CleaningStats } => {
    const auditMap = new Map<string, AuditLogEntry>();
    let tempCleanedData = JSON.parse(JSON.stringify(data)) as ProcessedDataRow[];
    let outliersRemoved = 0;
    let pointsInterpolated = 0;

    const STAGE_ROWS = 18;
    const numStages = Math.ceil(tempCleanedData.length / STAGE_ROWS);

    for (let i = 0; i < numStages; i++) {
        const start = i * STAGE_ROWS;
        const end = Math.min((i + 1) * STAGE_ROWS, tempCleanedData.length);
        const stageData = tempCleanedData.slice(start, end);
        
        if (stageData.length < STAGE_ROWS && i === numStages - 1) continue;

        for (const col of OUTLIER_COLS) {
            const values = stageData.slice(3).map(row => row[col]).filter(v => typeof v === 'number') as number[];
            if (values.length < 2) continue;
            
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            const stdDev = Math.sqrt(values.map(x => Math.pow(x - mean, 2)).reduce((a, b) => a + b, 0) / values.length);
            const lowerBound = mean - 3 * stdDev;
            const upperBound = mean + 3 * stdDev;

            for (let j = 3; j < stageData.length; j++) {
                const originalValue = stageData[j][col];
                if (typeof originalValue === 'number' && (originalValue < lowerBound || originalValue > upperBound)) {
                    const time = stageData[j].t;
                    const logKey = `${time}-${col}`;
                    auditMap.set(logKey, {
                        time,
                        column: String(col),
                        originalValue,
                        reason: `阶段 ${i+1}: 3SD规则 (μ=${mean.toFixed(2)}, SD=${stdDev.toFixed(2)})`,
                        action: 'REMOVED',
                    });
                    stageData[j][col] = null;
                    outliersRemoved++;
                }
            }
        }

        for (let j = 0; j < stageData.length; j++) {
            const currentRow = stageData[j];
            const hr = currentRow.HR;
            if (typeof hr !== 'number') continue;
            
            let reason = '';
            if (hr <= 0 || hr > 250) {
                reason = `阶段 ${i+1}: 超出正常生理范围 (≤0 或 >250bpm)`;
            } else if (j > 0) {
                const prevRow = stageData[j - 1];
                const prevHr = prevRow.HR;
                const currentVo2 = currentRow["V'O2"];
                const prevVo2 = prevRow["V'O2"];
                const currentVe = currentRow["V'E"];
                const prevVe = prevRow["V'E"];

                if (typeof prevHr === 'number' && typeof currentVo2 === 'number' && typeof prevVo2 === 'number' && typeof currentVe === 'number' && typeof prevVe === 'number') {
                    const hrIncrease = hr - prevHr;
                    if (hrIncrease > 20 && currentVo2 <= prevVo2 && currentVe <= prevVe) {
                        reason = `阶段 ${i+1}: 孤立心率激增 (+${hrIncrease.toFixed(0)}bpm), 但V'O2/V'E未同步增加`;
                    }
                }
            }

            if (reason) {
                const time = currentRow.t;
                const logKey = `${time}-HR`;
                auditMap.set(logKey, { time, column: 'HR', originalValue: hr, reason, action: 'REMOVED' });
                currentRow.HR = null;
                outliersRemoved++;
            }
        }
        
        tempCleanedData.splice(start, stageData.length, ...stageData);
    }

    for (const col of OUTLIER_COLS) {
        for (let i = 0; i < tempCleanedData.length; i++) {
            if (tempCleanedData[i][col] === null) {
                const currentStageIndex = Math.floor(i / STAGE_ROWS);
                let prevIndex = -1, nextIndex = -1;
                
                for (let j = i - 1; j >= currentStageIndex * STAGE_ROWS; j--) {
                    if (tempCleanedData[j][col] !== null) { prevIndex = j; break; }
                }
                
                for (let j = i + 1; j < (currentStageIndex + 1) * STAGE_ROWS && j < tempCleanedData.length; j++) {
                    if (tempCleanedData[j][col] !== null) { nextIndex = j; break; }
                }

                if (prevIndex !== -1 && nextIndex !== -1) {
                    const gapSize = nextIndex - prevIndex;
                    if (gapSize <= 3) { 
                        const prevValue = tempCleanedData[prevIndex][col] as number;
                        const nextValue = tempCleanedData[nextIndex][col] as number;
                        const interpolatedValue = prevValue + (nextValue - prevValue) * ((i - prevIndex) / gapSize);
                        
                        const time = tempCleanedData[i].t;
                        const logKey = `${time}-${col}`;
                        const logEntry = auditMap.get(logKey);

                        if (logEntry) {
                            if (Math.abs((logEntry.originalValue as number) - interpolatedValue) < 1e-6) {
                                tempCleanedData[i][col] = logEntry.originalValue;
                                auditMap.delete(logKey);
                                outliersRemoved--;
                            } else {
                                tempCleanedData[i][col] = interpolatedValue;
                                logEntry.action = 'INTERPOLATED';
                                logEntry.newValue = interpolatedValue;
                                pointsInterpolated++;
                            }
                        } else {
                            tempCleanedData[i][col] = interpolatedValue;
                        }
                    }
                }
            }
        }
    }
    
    tempCleanedData = tempCleanedData.map(row => recalculateDerivedMetrics(row, bodyWeight));
    
    const auditLog = Array.from(auditMap.values()).sort((a,b) => a.time.localeCompare(b.time));
    const stats = { outliersRemoved, pointsInterpolated };
    
    return { cleanedData: tempCleanedData, auditLog, stats };
};

export const applySmoothing = (data: ProcessedDataRow[], bodyWeight: number): ProcessedDataRow[] => {
    const newSmoothedData = JSON.parse(JSON.stringify(data)) as ProcessedDataRow[];
    if (data.length < 3) {
        return newSmoothedData;
    }

    const colsToSmooth: (keyof ProcessedDataRow)[] = ["V'O2", "V'CO2", "V'E", "HR", "VT", "BF"];
    for (let i = 2; i < data.length; i++) {
        for (const col of colsToSmooth) {
            const val1 = data[i-2][col];
            const val2 = data[i-1][col];
            const val3 = data[i][col];
            if (typeof val1 === 'number' && typeof val2 === 'number' && typeof val3 === 'number') {
                newSmoothedData[i][col] = (val1 + val2 + val3) / 3;
            } else {
                newSmoothedData[i][col] = null;
            }
        }
    }
    
    const finalSmoothedData = newSmoothedData.map(row => recalculateDerivedMetrics(row, bodyWeight));
    return finalSmoothedData;
};

export const calculateKeyMetricsForData = (data: ProcessedDataRow[]): KeyMetrics => {
    if (data.length === 0) {
        return { vo2max: 0, vo2max_kg: 0, vemax: 0, hrmax: 0, rermax: 0, plateauReached: false, isPeak: true };
    }

    const validVo2 = data.map(r => r["V'O2"]).filter(v => v !== null && typeof v === 'number') as number[];
    const validVo2Kg = data.map(r => r["V'O2/kg"]).filter(v => v !== null && typeof v === 'number') as number[];
    const validVe = data.map(r => r["V'E"]).filter(v => v !== null && typeof v === 'number') as number[];
    const validHr = data.map(r => r.HR).filter(v => v !== null && typeof v === 'number') as number[];
    const validRer = data.map(r => r.RER).filter(v => v !== null && typeof v === 'number') as number[];
    
    const vo2max = validVo2.length > 0 ? Math.max(...validVo2) : 0;
    const vo2max_kg = validVo2Kg.length > 0 ? Math.max(...validVo2Kg) : 0;
    const vemax = validVe.length > 0 ? Math.max(...validVe) : 0;
    const hrmax = validHr.length > 0 ? Math.max(...validHr) : 0;
    const rermax = validRer.length > 0 ? Math.max(...validRer) : 0;
    
    let plateauReached = false;
    let plateauTime: string | undefined = undefined;
    let plateauStageSummary: PlateauStageSummary[] = [];
    let plateauComparison: KeyMetrics['plateauComparison'] | undefined = undefined;

    const STAGE_DURATION_SECONDS = 180;
    const stages: { startTime: number; endTime: number; }[] = [];
    if (data.length > 0) {
        const totalDuration = data[data.length - 1].timeInSeconds;
        const numStages = Math.ceil(totalDuration / STAGE_DURATION_SECONDS);

        for (let i = 0; i < numStages; i++) {
            const startTime = i * STAGE_DURATION_SECONDS;
            const endTime = Math.min((i + 1) * STAGE_DURATION_SECONDS, totalDuration);
            if (endTime > startTime) {
                stages.push({ startTime, endTime });
            }
        }
    }

    if (stages.length > 0) {
        let previousAvgVo2 = 0;
        plateauStageSummary = stages.map((stage, index) => {
            const stageData = data.filter(r => r.timeInSeconds >= stage.startTime && r.timeInSeconds < stage.endTime);
            
            const actualDuration = stage.endTime - stage.startTime;
            let avgVo2 = 0;
            let isPartial = false;
            
            if (stageData.length > 0) {
                let vo2ValuesToAverage: (number | null | undefined)[] = [];
                const isLastStage = index === stages.length - 1;

                if (isLastStage && actualDuration < STAGE_DURATION_SECONDS) {
                    if (actualDuration > 30) {
                        const thirtySecondsBeforeEnd = stage.endTime - 30;
                        vo2ValuesToAverage = stageData.filter(r => r.timeInSeconds >= thirtySecondsBeforeEnd).map(r => r["V'O2"]);
                    } else {
                        vo2ValuesToAverage = stageData.map(r => r["V'O2"]);
                        isPartial = true;
                    }
                } else {
                    const thirtySecondsBeforeEnd = stage.endTime - 30;
                    vo2ValuesToAverage = data.filter(r => r.timeInSeconds >= thirtySecondsBeforeEnd && r.timeInSeconds < stage.endTime).map(r => r["V'O2"]);
                }

                const validVo2Values = vo2ValuesToAverage.filter(v => typeof v === 'number') as number[];
                avgVo2 = validVo2Values.length > 0 ? validVo2Values.reduce((a, b) => a + b, 0) / validVo2Values.length : 0;
            }

            const deltaVo2 = (index > 0 && avgVo2 > 0 && previousAvgVo2 > 0) ? (avgVo2 - previousAvgVo2) : null;
            previousAvgVo2 = avgVo2;
            
            return { stage: index + 1, duration: actualDuration, avgVo2, deltaVo2, isPartial };
        });
    }
    
    if (plateauStageSummary.length >= 2) {
        const lastStageInfo = plateauStageSummary[plateauStageSummary.length - 1];
        const vo2_increase = lastStageInfo.deltaVo2;
        
        if (vo2_increase !== null && vo2_increase < 0.15) {
            plateauReached = true;
            const lastStageStartTime = stages[stages.length-1].startTime;
            const plateauDataPoint = data.find(d => d.timeInSeconds >= lastStageStartTime);
            plateauTime = plateauDataPoint?.t || data[data.length - 1].t;
            const secondLastStageInfo = plateauStageSummary[plateauStageSummary.length - 2];
            plateauComparison = { prevStageAvg: secondLastStageInfo.avgVo2, lastStageAvg: lastStageInfo.avgVo2 };
        }
    }
    
    return { 
        vo2max, vo2max_kg, vemax, hrmax, rermax, 
        plateauReached, 
        isPeak: !plateauReached, 
        plateauTime,
        plateauComparison,
        plateauStageSummary
    };
};

export const extractPercentageDataForMetrics = (data: ProcessedDataRow[], metrics: KeyMetrics): ProcessedDataRow[] => {
    if (!metrics || data.length === 0) return [];
    const result: ProcessedDataRow[] = [];
    const vo2max = metrics.vo2max;
    const seenPercentages = new Set<number>();

    for (let i = 10; i <= 100; i += 10) {
        const threshold = vo2max * (i / 100);
        const foundIndex = data.findIndex(row => row["V'O2"] !== null && typeof row["V'O2"] === 'number' && row["V'O2"] >= threshold);
        
        if (foundIndex !== -1) {
             if (!seenPercentages.has(i)) {
                const rowWithPercentage: ProcessedDataRow = { ...data[foundIndex], 'VO2_%max': `${i}%` };
                result.push(rowWithPercentage);
                seenPercentages.add(i);
             }
        }
    }
    return result;
};

// --- Stateful Hook (for single-file analysis mode) ---

export const useDataProcessor = () => {
    const [rawData, setRawData] = useState<ProcessedDataRow[]>([]);
    const [cleanedData, setCleanedData] = useState<ProcessedDataRow[]>([]);
    const [smoothedData, setSmoothedData] = useState<ProcessedDataRow[]>([]);
    const [percentageData, setPercentageData] = useState<ProcessedDataRow[]>([]);
    const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
    const [cleaningStats, setCleaningStats] = useState<CleaningStats | null>(null);
    const [keyMetrics, setKeyMetrics] = useState<KeyMetrics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const parseExcelFile = useCallback(async (file: File) => {
        setIsLoading(true);
        setError(null);
        try {
            const processedData = await parseExcelFileContents(file);
            setRawData(processedData);
        } catch (err: any) {
            setError(err.toString());
        } finally {
            setIsLoading(false);
        }
    }, []);
    
    const processOutliers = useCallback((data: ProcessedDataRow[], bodyWeight: number) => {
        setIsLoading(true);
        const { cleanedData: result, auditLog: newAuditLog, stats } = cleanAndInterpolateData(data, bodyWeight);
        setCleaningStats(stats);
        setAuditLog(newAuditLog);
        setCleanedData(result);
        setIsLoading(false);
        return result;
    }, []);

    const applyRollingAverage = useCallback((data: ProcessedDataRow[], bodyWeight: number) => {
        setIsLoading(true);
        const finalSmoothedData = applySmoothing(data, bodyWeight);
        setSmoothedData(finalSmoothedData);
        setIsLoading(false);
        return finalSmoothedData;
    }, []);

    const calculateKeyMetrics = useCallback((data: ProcessedDataRow[]) => {
        setIsLoading(true);
        const metrics = calculateKeyMetricsForData(data);
        setKeyMetrics(metrics);
        setIsLoading(false);
    }, []);
    
    const extractPercentageValues = useCallback((data: ProcessedDataRow[], metrics: KeyMetrics) => {
        setIsLoading(true);
        const result = extractPercentageDataForMetrics(data, metrics);
        setPercentageData(result);
        setIsLoading(false);
    }, []);

    const calculateAuc = (data: ProcessedDataRow[], vo2max: number, startPercent: number, endPercent: number): AucResult | null => {
        const startVo2 = vo2max * (startPercent / 100);
        const endVo2 = vo2max * (endPercent / 100);
        
        const startIndex = data.findIndex(row => typeof row["V'O2"] === 'number' && row["V'O2"] >= startVo2);
        
        let endIndex = -1;
        for (let i = data.length - 1; i >= 0; i--) {
            const row = data[i];
            const vo2 = row["V'O2"];
            if (typeof vo2 === 'number' && vo2 <= endVo2) {
                endIndex = i;
                break;
            }
        }

        if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) return null;

        let auc = 0;
        for (let i = startIndex; i < endIndex; i++) {
            const row1 = data[i];
            const row2 = data[i + 1];

            const vo2_1 = row1["V'O2"];
            const vo2_2 = row2["V'O2"];
            
            if (typeof vo2_1 === 'number' && typeof vo2_2 === 'number') {
                const avgVo2 = (vo2_1 + vo2_2) / 2; // L/min
                const timeDelta = row2.timeInSeconds - row1.timeInSeconds; // seconds
                auc += avgVo2 * (timeDelta / 60); // (L/min) * min = L
            }
        }
        
        return { value: auc, startTime: data[startIndex].timeInSeconds, endTime: data[endIndex].timeInSeconds, startVo2, endVo2 };
    };
    
    const resetState = useCallback(() => {
        setRawData([]);
        setCleanedData([]);
        setSmoothedData([]);
        setPercentageData([]);
        setAuditLog([]);
        setCleaningStats(null);
        setKeyMetrics(null);
        setError(null);
    }, []);

    return {
        rawData,
        cleanedData,
        smoothedData,
        percentageData,
        auditLog,
        cleaningStats,
        keyMetrics,
        error,
        isLoading,
        parseExcelFile,
        processOutliers,
        applyRollingAverage,
        calculateKeyMetrics,
        extractPercentageValues,
        calculateAuc,
        resetState
    };
};