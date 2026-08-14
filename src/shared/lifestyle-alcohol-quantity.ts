const DECIMAL_COMPARISON_TOLERANCE = 1e-9

export type LifestyleDecimalComparison = -1 | 0 | 1

/** Compares decimal quantities without treating ordinary binary float noise as a difference. */
export function compareLifestyleDecimalQuantities(
  left: number,
  right: number
): LifestyleDecimalComparison {
  const scale = Math.max(1, Math.abs(left), Math.abs(right))
  if (Math.abs(left - right) <= DECIMAL_COMPARISON_TOLERANCE * scale) return 0
  return left < right ? -1 : 1
}
