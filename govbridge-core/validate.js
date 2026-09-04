/**
 * VALIDATION LAYER
 * Two kinds of checks:
 *  1. Schema completeness — does the payload have the fields the
 *     platform requires at all?
 *  2. Data quality — even if a field is present, is it actually
 *     well-formed? (dates that look like dates, phone numbers that
 *     look like phone numbers.) This is the PS's explicit
 *     "data-quality checks" requirement — catching malformed data
 *     before it reaches another department's system, not just
 *     missing data.
 */

const SCHEMA_REQUIREMENTS = {
  "platform-a": ["citizen_id", "full_name", "dob", "address", "mobile"],
  "platform-b": ["applicantName", "birthDate"],
};

// Format rules per platform: fieldName -> { pattern, message }
const DATA_QUALITY_RULES = {
  "platform-a": {
    dob: { pattern: /^\d{4}-\d{2}-\d{2}$/, message: "dob must be in YYYY-MM-DD format" },
    mobile: { pattern: /^[6-9]\d{9}$/, message: "mobile must be a valid 10-digit Indian mobile number" },
  },
  "platform-b": {
    birthDate: { pattern: /^\d{4}-\d{2}-\d{2}$/, message: "birthDate must be in YYYY-MM-DD format" },
    contactNumber: { pattern: /^[6-9]\d{9}$/, message: "contactNumber must be a valid 10-digit Indian mobile number" },
  },
};

/**
 * Schema completeness check. Returns { valid: boolean, missing: string[] }
 */
function validateAgainstSchema(platformKey, payload) {
  const requiredFields = SCHEMA_REQUIREMENTS[platformKey];
  if (!requiredFields) {
    return { valid: false, missing: [], error: `No schema defined for platform: ${platformKey}` };
  }

  const missing = requiredFields.filter(
    (field) => payload[field] === undefined || payload[field] === null || payload[field] === ""
  );

  return { valid: missing.length === 0, missing };
}

/**
 * Data-quality check. Only checks fields that are present (missing
 * fields are the schema check's job). Returns
 * { valid: boolean, issues: [{ field, message }] }
 */
function validateDataQuality(platformKey, payload) {
  const rules = DATA_QUALITY_RULES[platformKey] || {};
  const issues = [];

  for (const [field, rule] of Object.entries(rules)) {
    const value = payload[field];
    if (value !== undefined && value !== null && value !== "" && !rule.pattern.test(String(value))) {
      issues.push({ field, message: rule.message });
    }
  }

  return { valid: issues.length === 0, issues };
}

module.exports = { validateAgainstSchema, validateDataQuality, SCHEMA_REQUIREMENTS };
