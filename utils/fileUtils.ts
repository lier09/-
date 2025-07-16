
import { ProcessedDataRow } from '../types';
import * as XLSX from 'xlsx';

export function exportToCsv(data: ProcessedDataRow[], filename: string): void {
  if (data.length === 0) {
    alert("No data to export.");
    return;
  }

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header as keyof ProcessedDataRow];
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        // Handle values containing commas by enclosing them in double quotes
        return stringValue.includes(',') ? `"${stringValue}"` : stringValue;
      }).join(',')
    )
  ];

  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

export function exportToXlsx(
  sheet1Data: ProcessedDataRow[], 
  sheet2Data: ProcessedDataRow[], 
  sheet1Name: string, 
  sheet2Name: string, 
  filename: string
): void {
  const wb = XLSX.utils.book_new();
  
  const ws1 = XLSX.utils.json_to_sheet(sheet1Data);
  XLSX.utils.book_append_sheet(wb, ws1, sheet1Name);
  
  const ws2 = XLSX.utils.json_to_sheet(sheet2Data);
  XLSX.utils.book_append_sheet(wb, ws2, sheet2Name);
  
  XLSX.writeFile(wb, filename);
}
