
export interface RawDataRow {
  [key:string]: string | number;
}

export interface ProcessedDataRow {
  t: string; 
  timeInSeconds: number; // For calculations
  "V'O2"?: number | null;
  "V'CO2"?: number | null;
  "V'E"?: number | null;
  HR?: number | null;
  VT?: number | null;
  BF?: number | null;
  "V'O2/kg"?: number | null;
  "V'O2/HR"?: number | null;
  "V'E/V'O2"?: number | null;
  "V'E/V'CO2"?: number | null;
  RER?: number | null;
  "VD/VT(est)"?: number | null;
  Load?: number | null;
  Marker?: string | null;
  [key: string]: number | string | null;
}

export interface AuditLogEntry {
  time: string;
  column: string;
  originalValue: number | string | null;
  reason: string;
  action: 'REMOVED' | 'INTERPOLATED';
  newValue?: number;
}


export interface CleaningStats {
  outliersRemoved: number;
  pointsInterpolated: number;
}

export interface PlateauStageSummary {
  stage: number;
  duration: number;
  avgVo2: number;
  deltaVo2: number | null;
  isPartial: boolean;
}

export interface KeyMetrics {
  vo2max: number;
  vo2max_kg: number;
  vemax: number;
  hrmax: number;
  rermax: number;
  plateauReached: boolean;
  isPeak: boolean;
  plateauTime?: string;
  plateauComparison?: { prevStageAvg: number; lastStageAvg: number; };
  plateauStageSummary?: PlateauStageSummary[];
  duration?: number;
}

export interface BatchResult {
  id: string;
  testType: 'pre' | 'mid' | 'post' | 'unspecified';
  fileName: string;
  metrics: KeyMetrics;
  smoothedData?: ProcessedDataRow[];
  percentageData?: ProcessedDataRow[];
  auditLog?: AuditLogEntry[];
  cleaningStats?: CleaningStats;
}

export interface AucResult {
  value: number;
  startTime: number;
  endTime: number;
  startVo2: number;
  endVo2: number;
}