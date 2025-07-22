
import React from 'react';
import { ThresholdAnalyzer, AnalysisData } from './ThresholdAnalyzer';
import type { AnalysisRecord } from '../types';

interface ThresholdAnalysisProps {
    onSave: (analysisData: AnalysisData) => void;
    initialData?: AnalysisRecord | null;
    onReset: () => void;
}

export const ThresholdAnalysis: React.FC<ThresholdAnalysisProps> = ({ onSave, initialData, onReset }) => {
    return (
        <div className="space-y-8">
            <ThresholdAnalyzer 
                onSave={onSave} 
                key={initialData?.id || 'new'} 
                initialData={initialData}
                onReset={onReset}
            />
        </div>
    );
};
