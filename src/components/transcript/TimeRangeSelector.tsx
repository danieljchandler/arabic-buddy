import { useState, useCallback } from "react";
import { Slider } from "@/components/ui/slider";

interface TimeRangeSelectorProps {
  duration: number; // total seconds
  maxRange?: number; // max selectable range in seconds (default 180)
  onChange: (range: [number, number]) => void;
  value?: [number, number];
}

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const TimeRangeSelector = ({
  duration,
  maxRange = 180,
  onChange,
  value,
}: TimeRangeSelectorProps) => {
  const effectiveMax = Math.min(duration, maxRange);
  const [range, setRange] = useState<[number, number]>(
    value || [0, Math.min(duration, effectiveMax)]
  );

  const handleChange = useCallback(
    (newValues: number[]) => {
      let [start, end] = newValues;
      
      // Enforce max range constraint
      if (end - start > maxRange) {
        // If user moved the end handle, clamp it
        if (end !== range[1]) {
          end = start + maxRange;
        } else {
          // User moved the start handle
          start = end - maxRange;
        }
      }

      // Clamp to valid bounds
      start = Math.max(0, start);
      end = Math.min(duration, end);

      const newRange: [number, number] = [start, end];
      setRange(newRange);
      onChange(newRange);
    },
    [duration, maxRange, onChange, range]
  );

  const selectedDuration = range[1] - range[0];

  return (
    <div className="space-y-3" dir="ltr">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>اختر المقطع للمعالجة</span>
        <span className="font-mono text-xs">
          {formatTime(selectedDuration)} / {formatTime(maxRange)} max
        </span>
      </div>
      
      <Slider
        value={range}
        onValueChange={handleChange}
        min={0}
        max={duration}
        step={1}
        className="w-full"
      />

      <div className="flex justify-between text-xs font-mono text-muted-foreground">
        <span>{formatTime(range[0])}</span>
        <span className="text-foreground font-medium">
          {formatTime(range[0])} – {formatTime(range[1])}
        </span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
};
