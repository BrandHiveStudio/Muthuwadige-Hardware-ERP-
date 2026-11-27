export const formatStock = (stock: number | string | undefined | null, unit?: string): string => {
  const rawNum = Number(stock || 0);
  if (isNaN(rawNum)) return '0.00';

  // Strip binary float jitter (e.g. 2 - 0.001 => 1.9989999999999999) while preserving sub-unit precision (e.g. 1.999 Cube)
  const num = Math.round(rawNum * 1_000_000) / 1_000_000;

  const unitStr = (unit || '').toLowerCase().trim();
  if (unitStr === 'cube' || unitStr === 'cubes') {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  }

  if (Number.isInteger(num)) {
    return num.toLocaleString('en-US');
  }

  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
};
