/**
 * Parsea `fp_raw` (texto ya trim) a `timestamptz` sin evaluar `to_timestamp` fuera de guardas regex.
 * Sin dependencias de alias @/ (importable desde tests con node --test).
 */
export function scheduledTsFromFpRawExpr(fpExpr: string): string {
  return `CASE
  WHEN ${fpExpr} ~ '^\\d{4}-\\d{2}-\\d{2}(\\s+\\d{2}:\\d{2}(:\\d{2})?)?$' THEN (${fpExpr})::timestamptz
  WHEN ${fpExpr} ~ '^\\d{2}/\\d{2}/\\d{4}\\s+\\d{2}:\\d{2}(:\\d{2})?$' THEN to_timestamp(${fpExpr}, 'DD/MM/YYYY HH24:MI')
  WHEN ${fpExpr} ~* '^\\d{2}/\\d{2}/\\d{4}\\s+\\d{1,2}:\\d{2}\\s*(am|pm)$' THEN to_timestamp(${fpExpr}, 'DD/MM/YYYY HH12:MI AM')
  WHEN ${fpExpr} ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN to_timestamp(${fpExpr}, 'DD/MM/YYYY')
  ELSE NULL
END`;
}
