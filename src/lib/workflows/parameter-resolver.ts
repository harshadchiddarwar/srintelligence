/**
 * parameter-resolver — resolves {{param_name}} templates in strings,
 * including built-in date macros.
 */

import type { WorkflowParameter } from '../../types/workflow';

// ---------------------------------------------------------------------------
// Date macros
// ---------------------------------------------------------------------------

function getDateMacros(): Record<string, string> {
  const now = new Date();

  // TODAY
  const today = now.toISOString().slice(0, 10);

  // LAST_WEEK — Monday of the previous ISO week
  const lastWeekDate = new Date(now);
  lastWeekDate.setUTCDate(now.getUTCDate() - 7);
  const lastWeek = lastWeekDate.toISOString().slice(0, 10);

  // LAST_MONTH — first day of the previous calendar month
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonth = lastMonthDate.toISOString().slice(0, 10);

  // LAST_QUARTER_START — first day of Q(current - 1)
  const currentQuarter = Math.floor(now.getUTCMonth() / 3);
  const lastQuarterMonth = (currentQuarter - 1) * 3;
  let lastQuarterYear = now.getUTCFullYear();
  if (lastQuarterMonth < 0) {
    lastQuarterYear -= 1;
  }
  const lastQuarterStart = new Date(
    Date.UTC(lastQuarterYear, ((lastQuarterMonth % 12) + 12) % 12, 1),
  ).toISOString().slice(0, 10);

  // YEAR_START — Jan 1 of current year
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);

  return {
    TODAY: today,
    LAST_WEEK: lastWeek,
    LAST_MONTH: lastMonth,
    LAST_QUARTER_START: lastQuarterStart,
    YEAR_START: yearStart,
  };
}

// ---------------------------------------------------------------------------
// resolveParameters
// ---------------------------------------------------------------------------

/**
 * Replaces all {{MACRO}} and {{param_name}} occurrences in a template string.
 * Built-in date macros take precedence over user-supplied parameters.
 */
export function resolveParameters(
  template: string,
  parameters: Record<string, unknown>,
): string {
  const macros = getDateMacros();
  const combined: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(parameters).map(([k, v]) => [k, String(v ?? '')]),
    ),
    // Macros override user params with the same name
    ...macros,
  };

  return template.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim();
    return Object.prototype.hasOwnProperty.call(combined, trimmed)
      ? combined[trimmed]!
      : match; // Leave unresolved if not found
  });
}

// ---------------------------------------------------------------------------
// validateParameters
// ---------------------------------------------------------------------------

/**
 * Validates a values object against a WorkflowParameter schema.
 * Returns { valid, errors } where errors is a map of key → error message.
 */
export function validateParameters(
  params: WorkflowParameter[],
  values: Record<string, unknown>,
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  for (const param of params) {
    const value = values[param.key];

    // Required check
    if (param.required && (value === undefined || value === null || value === '')) {
      errors[param.key] = `'${param.label}' is required.`;
      continue;
    }

    // Skip further validation if value is absent and not required
    if (value === undefined || value === null) continue;

    // Type-specific validation
    switch (param.type) {
      case 'number':
        if (isNaN(Number(value))) {
          errors[param.key] = `'${param.label}' must be a number.`;
        }
        break;

      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors[param.key] = `'${param.label}' must be true or false.`;
        }
        break;

      case 'date':
        if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          errors[param.key] = `'${param.label}' must be a valid date (YYYY-MM-DD).`;
        }
        break;

      case 'select':
        if (param.options) {
          const valid = param.options.some((o) => o.value === String(value));
          if (!valid) {
            errors[param.key] = `'${param.label}' must be one of: ${param.options.map((o) => o.label).join(', ')}.`;
          }
        }
        break;

      case 'multiselect':
        if (!Array.isArray(value)) {
          errors[param.key] = `'${param.label}' must be an array of values.`;
        } else if (param.options) {
          const allowed = new Set(param.options.map((o) => o.value));
          const invalid = (value as string[]).filter((v) => !allowed.has(v));
          if (invalid.length > 0) {
            errors[param.key] = `'${param.label}' contains invalid values: ${invalid.join(', ')}.`;
          }
        }
        break;

      case 'string':
        if (param.validationPattern) {
          const re = new RegExp(param.validationPattern);
          if (!re.test(String(value))) {
            errors[param.key] = `'${param.label}' does not match the required format.`;
          }
        }
        break;

      default:
        break;
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// ---------------------------------------------------------------------------
// getDefaultParameters
// ---------------------------------------------------------------------------

/**
 * Returns an object populated with each parameter's defaultValue.
 * Parameters without a defaultValue are omitted.
 */
export function getDefaultParameters(
  params: WorkflowParameter[],
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  for (const param of params) {
    if (param.defaultValue !== undefined) {
      // Resolve date macros within string defaults
      if (typeof param.defaultValue === 'string') {
        defaults[param.key] = resolveParameters(param.defaultValue, {});
      } else {
        defaults[param.key] = param.defaultValue;
      }
    }
  }

  return defaults;
}
