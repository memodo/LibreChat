import { useState, useCallback } from 'react';
import { DATE_PRESETS } from './utils';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onDateChange: (startDate: string, endDate: string) => void;
}

/**
 * REQ-011: Date range picker with presets and custom input.
 */
export default function DateRangePicker({ startDate, endDate, onDateChange }: DateRangePickerProps) {
  const [activePreset, setActivePreset] = useState<number | null>(30);

  const handlePreset = useCallback(
    (days: number) => {
      const end = new Date();
      const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
      setActivePreset(days);
      onDateChange(start.toISOString().split('T')[0], end.toISOString().split('T')[0]);
    },
    [onDateChange],
  );

  const handleCustomStart = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setActivePreset(null);
      onDateChange(e.target.value, endDate);
    },
    [endDate, onDateChange],
  );

  const handleCustomEnd = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setActivePreset(null);
      onDateChange(startDate, e.target.value);
    },
    [startDate, onDateChange],
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {DATE_PRESETS.map((preset) => (
        <button
          key={preset.days}
          type="button"
          onClick={() => handlePreset(preset.days)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            activePreset === preset.days
              ? 'bg-green-600 text-white'
              : 'bg-surface-secondary text-text-secondary hover:bg-surface-tertiary dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          {preset.label}
        </button>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={startDate}
          onChange={handleCustomStart}
          className="rounded-md border border-border-light bg-surface-primary px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          aria-label="Start date"
        />
        <span className="text-text-secondary text-sm">to</span>
        <input
          type="date"
          value={endDate}
          onChange={handleCustomEnd}
          className="rounded-md border border-border-light bg-surface-primary px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          aria-label="End date"
        />
      </div>
    </div>
  );
}
