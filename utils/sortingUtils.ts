import type { BatchResult } from '../types';

// --- Utility functions for sorting ---
const levenshtein = (s1: string, s2: string): number => {
    if (!s1) s1 = '';
    if (!s2) s2 = '';
    
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

export const applySortOrder = (results: (BatchResult | {fileName: string, [key: string]: any})[], order: string[]): any[] => {
    if (order.length === 0) return results;
    
    const findBestMatchIndex = (recordName: string, nameOrder: string[]): number => {
        let bestMatch = { index: -1, score: Infinity };

        for (let i = 0; i < nameOrder.length; i++) {
            const inputName = nameOrder[i];
            let currentScore: number;

            if (recordName === inputName) currentScore = 0;
            else if (recordName.includes(inputName) || inputName.includes(recordName)) currentScore = 1;
            else {
                currentScore = levenshtein(recordName, inputName);
                currentScore += 1.1; 
            }

            if (currentScore < bestMatch.score) {
                bestMatch = { index: i, score: currentScore };
            }
        }
        
        if (bestMatch.score > 3.1) return -1;
        return bestMatch.index;
    };

    const sorted = [...results].sort((a, b) => {
        const indexA = findBestMatchIndex(a.fileName, order);
        const indexB = findBestMatchIndex(b.fileName, order);

        if (indexA === -1 && indexB === -1) return 0;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
    });
    return sorted;
};
