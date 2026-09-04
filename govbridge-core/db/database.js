/**
 * AUDIT & STATUS TRACKING
 * Every request that hits GovBridge gets logged here — regardless of
 * whether it succeeded, was rejected at auth, failed validation, or
 * failed at the target platform. This is the "Response / Status /
 * Audit" stage from the architecture diagram, and it's what makes
 * GovBridge traceable rather than a black box.
 *
 * Implementation note: this uses a plain JSON file instead of SQLite.
 * better-sqlite3 requires a native C++ build step (Visual Studio Build
 * Tools on Windows / Xcode on Mac), which is unnecessary friction for
 * a hackathon prototype. A JSON file gives the same audit trail with
 * zero native dependencies — works identically on any machine.
 */

const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "audit-log.json");

function readAll() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return raw.trim() ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(records) {
  fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), "utf-8");
}

/**
 * Logs one transaction. Object fields are stored as-is (already JSON-serializable).
 */
function logTransaction({
  traceId,
  sourcePlatform = null,
  targetPlatform = null,
  status,
  statusCode = null,
  consentId = null,
  recordId = null,
  requestPayload = null,
  canonicalPayload = null,
  mappedPayload = null,
  responsePayload = null,
  errorMessage = null,
}) {
  const records = readAll();
  const nextId = records.length ? records[records.length - 1].id + 1 : 1;

  records.push({
    id: nextId,
    trace_id: traceId,
    source_platform: sourcePlatform,
    target_platform: targetPlatform,
    status,
    status_code: statusCode,
    consent_id: consentId,
    record_id: recordId,
    request_payload: requestPayload ? JSON.stringify(requestPayload) : null,
    canonical_payload: canonicalPayload ? JSON.stringify(canonicalPayload) : null,
    mapped_payload: mappedPayload ? JSON.stringify(mappedPayload) : null,
    response_payload: responsePayload ? JSON.stringify(responsePayload) : null,
    error_message: errorMessage,
    created_at: new Date().toISOString().replace("T", " ").slice(0, 19),
  });

  writeAll(records);
}

/**
 * Returns the most recent N transactions, newest first — used by the dashboard.
 */
function getRecentTransactions(limit = 50) {
  const records = readAll();
  return records.slice(-limit).reverse();
}

/**
 * Citizen-facing lookup: returns ONLY transactions for one record ID,
 * and ONLY the fields a citizen should see — no raw payloads, no other
 * citizens' data, no internal system details.
 */
function getTransactionsForRecord(recordId, limit = 20) {
  const records = readAll()
    .filter((r) => r.record_id === recordId)
    .slice(-limit)
    .reverse();

  return records.map((r) => ({
    trace_id: r.trace_id,
    status: r.status,
    target_platform: r.target_platform,
    created_at: r.created_at,
  }));
}

module.exports = { logTransaction, getRecentTransactions, getTransactionsForRecord };
