'use client';
import { lazy, Suspense } from 'react';
const Halo = lazy(() => import('@/components/vitality-halo'));
export default function VitalityHalo(props: {
  breathing?: boolean;
  paused?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <div className="vitality-halo" aria-hidden="true">
          <svg className="halo-fallback" viewBox="0 0 300 300">
            {[100, 106, 112, 118].map((r) => (
              <circle
                key={r}
                cx="150"
                cy="150"
                r={r}
                fill="none"
                stroke="#a4d983"
                strokeOpacity=".15"
              />
            ))}
          </svg>
        </div>
      }
    >
      <Halo {...props} />
    </Suspense>
  );
}
