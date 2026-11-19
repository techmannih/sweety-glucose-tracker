import { useEffect, useRef, useState } from 'react';
import { displayDate, SLOTS } from '../../../shared/domain.js';

export default function TrendChart({ readings }) {
  const container = useRef(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, entry.contentRect.width)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [readings.length > 0]);
  if (!readings.length)
    return (
      <div className="empty">
        <p>Your next reading starts the picture.</p>
        <span>Readings in this period will appear here.</span>
      </div>
    );
  const height = 220,
    left = 42,
    right = 18,
    top = 20,
    bottom = 34;
  const values = readings.map((r) => r.value);
  const low = Math.max(0, Math.floor((Math.min(...values) - 10) / 20) * 20);
  const high = Math.ceil((Math.max(...values) + 10) / 20) * 20;
  const x = (i) => left + (i / Math.max(readings.length - 1, 1)) * (width - left - right);
  const y = (value) => top + (1 - (value - low) / (high - low)) * (height - top - bottom);
  const points = readings.map((r, i) => `${x(i)},${y(r.value)}`).join(' ');
  const area = `${left},${height - bottom} ${points} ${x(readings.length - 1)},${height - bottom}`;
  const ticks = [low, (low + high) / 2, high];
  return (
    <div className="chart-wrap" ref={container}>
      <svg
        className="trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Glucose readings from ${displayDate(readings[0].date)} to ${displayDate(readings.at(-1).date)}. Lowest ${Math.min(...values)}, highest ${Math.max(...values)} mg/dl.`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={width - right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#e6ece8"
              strokeDasharray="4 5"
            />
            <text x={left - 10} y={y(tick) + 5} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        <polygon points={area} fill="#eaf5e5" />
        <polyline
          points={points}
          fill="none"
          stroke="#40775c"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {readings.map((r, i) => (
          <circle
            key={r.id}
            cx={x(i)}
            cy={y(r.value)}
            r={readings.length > 80 ? 2 : 3.5}
            fill="#40775c"
          >
            <title>
              {displayDate(r.date)} · {SLOTS.find((s) => s.value === r.slot)?.label}: {r.value}{' '}
              mg/dl
            </title>
          </circle>
        ))}
        <text x={left} y={height - 6}>
          {displayDate(readings[0].date, { year: undefined })}
        </text>
        {readings.length > 1 && (
          <text x={width - right} y={height - 6} textAnchor="end">
            {displayDate(readings.at(-1).date, { year: undefined })}
          </text>
        )}
      </svg>
      <p className="input-hint">
        Each point is one saved reading, ordered by date and time slot. Units: mg/dl.
      </p>
    </div>
  );
}
