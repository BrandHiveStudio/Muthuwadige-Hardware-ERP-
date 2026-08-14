export const formatStock = (stock: number | string | undefined | null, unit?: string): string => {
  const num = Number(stock || 0);
  if (isNaN(num)) return '0.00';
  
  const unitStr = (unit || '').toLowerCase().trim();
  if (unitStr === 'cube' || unitStr === 'cubes') {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  
  if (Number.isInteger(num)) {
    return num.toLocaleString('en-US');
  }
  
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
