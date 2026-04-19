// Pure helpers for roundtrip-level derivations. No React imports.

export type MaeMfeSample = { t: number; pnl: number };

export const deriveMaeMfe = (samples: MaeMfeSample[]): { mae: number; mfe: number } => {
  if (samples.length === 0) return { mae: 0, mfe: 0 };
  let mae = 0;
  let mfe = 0;
  for (const s of samples) {
    if (s.pnl < mae) mae = s.pnl;
    if (s.pnl > mfe) mfe = s.pnl;
  }
  return { mae, mfe };
};

export const computeRMultiple = (pnl: number, mae: number): number | null => {
  if (mae >= 0) return null;
  return Math.round((pnl / Math.abs(mae)) * 100) / 100;
};

// Decimate samples to a target count, preserving temporal ordering.
// We always keep the first and last sample; intermediate samples are evenly spaced.
export const decimateSamples = (samples: MaeMfeSample[], target: number): MaeMfeSample[] => {
  if (samples.length <= target) return samples;
  if (target <= 2) return [samples[0], samples[samples.length - 1]];
  const step = (samples.length - 1) / (target - 1);
  const out: MaeMfeSample[] = [];
  for (let i = 0; i < target; i++) {
    out.push(samples[Math.round(i * step)]);
  }
  return out;
};
