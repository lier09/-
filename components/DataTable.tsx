
import React from 'react';
import type { ProcessedDataRow } from '../types';

interface DataTableProps {
  data: ProcessedDataRow[];
  title: string;
  maxHeight?: string;
}

export const DataTable: React.FC<DataTableProps> = ({ data, title, maxHeight = '500px' }) => {
  if (data.length === 0) {
    return (
      <div className="bg-white shadow-md rounded-lg p-6 my-4">
        <h3 className="text-lg font-semibold text-gray-700 mb-2">{title}</h3>
        <p className="text-gray-500">No data available.</p>
      </div>
    );
  }

  const headers = Object.keys(data[0]);

  return (
    <div className="bg-white shadow-md rounded-lg p-4 my-4">
      <h3 className="text-xl font-bold text-brand-blue mb-4">{title}</h3>
      <div className="overflow-x-auto" style={{ maxHeight }}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              {headers.map((header) => (
                <th key={header} scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-gray-50">
                {headers.map((header, colIndex) => {
                  const value = row[header as keyof ProcessedDataRow];
                  return (
                    <td key={`${rowIndex}-${colIndex}`} className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      {typeof value === 'number' ? value.toFixed(2) : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
