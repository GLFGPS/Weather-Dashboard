'use client';

import { useState, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

interface FileUploadProps {
  onDataParsed: (data: any[]) => void;
  accept?: string;
}

export default function FileUpload({ onDataParsed, accept = '.csv,.xlsx,.xls' }: FileUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setFileName(file.name);

    try {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();

      if (fileExtension === 'csv') {
        // Parse CSV
        Papa.parse(file, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            if (results.errors.length > 0) {
              setError(`CSV parsing errors: ${results.errors.map(e => e.message).join(', ')}`);
              setUploading(false);
              return;
            }
            onDataParsed(results.data);
            setUploading(false);
          },
          error: (error) => {
            setError(`Failed to parse CSV: ${error.message}`);
            setUploading(false);
          },
        });
      } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
        // Parse Excel
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(firstSheet);
        onDataParsed(data);
        setUploading(false);
      } else {
        setError('Unsupported file format. Please upload a CSV or Excel file.');
        setUploading(false);
      }
    } catch (err) {
      setError(`Failed to process file: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setUploading(false);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileUpload}
        className="hidden"
        disabled={uploading}
      />
      
      <button
        onClick={handleClick}
        disabled={uploading}
        className="w-full px-6 py-4 bg-white hover:bg-gray-50 text-gray-800 rounded-lg border-2 border-dashed border-gray-300 hover:border-primary transition-all duration-200 flex flex-col items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <svg
          className="w-12 h-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <div className="text-center">
          <p className="text-lg font-semibold">
            {uploading ? 'Processing...' : fileName ? fileName : 'Upload Lead Data'}
          </p>
          <p className="text-sm text-gray-500">
            CSV or Excel file (date, leads, source, cost, conversions)
          </p>
        </div>
      </button>

      {error && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {fileName && !error && !uploading && (
        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm text-green-800">
            ✓ Successfully loaded {fileName}
          </p>
        </div>
      )}
    </div>
  );
}
