/**
 * GOVBRIDGE CORE
 *
 * The interoperability layer: authenticates the source platform,
 * validates its payload (completeness + data quality), maps it through
 * the shared canonical schema into the target platform's native
 * schema, forwards it with retry-based exception handling, and logs
 * every step to the audit trail — regardless of whether it succeeds
 * or fails at any stage.
 */

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
const { validateAgainstSchema, validateDataQuality } = require("./validate");
const { mapPayload } = require("./mapping");
const { authenticateSource, checkRole } = require("./auth");
const { logTransaction, getRecentTransactions, getTransactionsForRecord } = require("./db/database");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const PORT = process.env.GOVBRIDGE_PORT || 4000;

// Registry of known target platforms GovBridge can route to.
const PLATFORM_REGISTRY = {
  "platform-b": {
    baseUrl: "http://localhost:4002",
    verifyEndpoint: "/api/verify",
    apiKey: "govbridge-core-secret-key",
  },
};

const NOTIFICATION_SERVICE_URL = "http://localhost:4003";

/**
 * Fire-and-forget event emission — GovBridge publishes the event and
 * moves on; it does not block the citizen's response waiting for a
 * notification service to process it, and a notification failure
 * never fails the main transaction. That decoupling is the point of
 * "event-driven": GovBridge doesn't know or care who's subscribed.
 */
function emitNotification({ traceId, recordId, status, message }) {
  axios
    .post(`${NOTIFICATION_SERVICE_URL}/api/notify`, { traceId, recordId, status, message }, { timeout: 2000 })
    .catch((err) => {
      console.log(`[GovBridge] Notification emit failed (non-blocking): ${err.message}`);
    });
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 400;
const REQUEST_TIMEOUT_MS = 5000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Forwards a request to the target platform, retrying transient
 * failures (network errors, 5xx) up to MAX_RETRIES times. Does NOT
 * retry 4xx errors — those are the target rejecting the data itself,
 * retrying won't help.
 */
async function forwardWithRetry(url, body, headers) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await axios.post(url, body, { headers, timeout: REQUEST_TIMEOUT_MS });
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isClientError = status && status >= 400 && status < 500;
      const attemptsLeft = attempt <= MAX_RETRIES;

      if (isClientError || !attemptsLeft) {
        throw err;
      }
      console.log(`[GovBridge] Attempt ${attempt} failed (${err.message}), retrying...`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "GovBridge Core" });
});

// Audit trail read endpoint — OFFICIAL ROLE ONLY. Full cross-citizen
// visibility is exactly what a citizen must never get.
app.get("/api/audit", (req, res) => {
  const roleResult = checkRole(req.headers["x-role"], "official");
  if (!roleResult.authorized) {
    return res.status(403).json({ error: "Forbidden", reason: roleResult.reason });
  }
  const limit = Number(req.query.limit) || 50;
  res.json({ transactions: getRecentTransactions(limit) });
});

// Citizen-facing tracking endpoint — either role may call it, but it
// only ever returns THAT record's limited status history, never raw
// payloads or other citizens' data. This is "unified application
// tracking" scoped by role-based access.
app.get("/api/track/:recordId", (req, res) => {
  const roleResult = checkRole(req.headers["x-role"]);
  if (!roleResult.authorized) {
    return res.status(403).json({ error: "Forbidden", reason: roleResult.reason });
  }
  const transactions = getTransactionsForRecord(req.params.recordId);
  res.json({ recordId: req.params.recordId, transactions });
});

/**
 * Main entry point: a source platform posts a request here, naming
 * which target platform it wants to reach.
 */
app.post("/api/bridge/request", async (req, res) => {
  const traceId = crypto.randomUUID();
  const { sourcePlatform, targetPlatform, payload, consent } = req.body || {};
  // Best-effort record ID extraction for citizen tracking — works
  // across whichever native ID field the source platform uses.
  const recordId = payload?.citizen_id || payload?.landRecordId || null;

  if (!sourcePlatform || !targetPlatform || !payload) {
    logTransaction({
      traceId,
      sourcePlatform,
      targetPlatform,
      recordId,
      status: "REJECTED_MALFORMED",
      statusCode: 400,
      requestPayload: req.body,
      errorMessage: "Missing sourcePlatform, targetPlatform, or payload.",
    });
    return res.status(400).json({
      traceId,
      error: "Malformed request: sourcePlatform, targetPlatform, and payload are all required.",
    });
  }

  const target = PLATFORM_REGISTRY[targetPlatform];
  if (!target) {
    logTransaction({
      traceId,
      sourcePlatform,
      targetPlatform,
      recordId,
      status: "REJECTED_UNKNOWN_TARGET",
      statusCode: 404,
      requestPayload: payload,
      errorMessage: `Unknown target platform: ${targetPlatform}`,
    });
    return res.status(404).json({ traceId, error: `Unknown target platform: ${targetPlatform}` });
  }

  console.log(`[GovBridge] [${traceId}] Routing request: ${sourcePlatform} -> ${targetPlatform}`);

  // 0. Authenticate the SOURCE platform before doing anything else
  const apiKey = req.headers["x-api-key"];
  const authResult = authenticateSource(sourcePlatform, apiKey);
  if (!authResult.authorized) {
    logTransaction({
      traceId,
      sourcePlatform,
      targetPlatform,
      recordId,
      status: "REJECTED_AUTH",
      statusCode: 401,
      requestPayload: payload,
      errorMessage: authResult.reason,
    });
    return res.status(401).json({ traceId, error: "Unauthorized", reason: authResult.reason });
  }

  // 0b. Verify consent independently — GovBridge does not just trust the
  // source platform's claim; it checks the consent object's own shape.
  // This is what "consent-based data sharing" means in practice: no
  // valid consent record, no routing, no matter how well-formed the
  // rest of the request is.
  if (!consent || consent.consentGiven !== true || !consent.consentId) {
    logTransaction({
      traceId,
      sourcePlatform,
      targetPlatform,
      recordId,
      status: "REJECTED_NO_CONSENT",
      statusCode: 403,
      requestPayload: payload,
      errorMessage: "No valid consent record attached to this request.",
    });
    return res.status(403).json({
      traceId,
      error: "Request rejected: no valid consent record attached.",
    });
  }

  // 1a. Schema completeness check against the SOURCE platform's own schema
  const sourceCheck = validateAgainstSchema(sourcePlatform, payload);
  if (!sourceCheck.valid) {
    logTransaction({
      traceId,
      sourcePlatform,
      targetPlatform,
      recordId,
      status: "REJECTED_SOURCE_VALIDATION",
      consentId: consent.consentId,
      statusCode: 422,
      requestPayload: payload,
      errorMessage: `Missing fields: ${sourceCheck.missing.join(", ")}`,
    });
    return res.status(422).json({
      traceId,
      error: "Source payload failed validation against its own platform schema.",
      missingFields: sourceCheck.missing,
    });
  }

  // 1b. Data-quality check — fields are present, but are they well-formed?
  const sourceQuality = validateDataQuality(sourcePlatform, payload);
  if (!sourceQuality.valid) {
    logTransaction({
      traceId,
      sourcePlatform,
      targetPlatform,
      recordId,
      status: "REJECTED_DATA_QUALITY",
      consentId: consent.consentId,
      statusCode: 422,
      requestPayload: payload,
      errorMessage: sourceQuality.issues.map((i) => `${i.field}: ${i.message}`).join("; "),
    });
    return res.status(422).json({
      traceId,
      error: "Source payload failed data-quality checks.",
      issues: sourceQuality.issues,
    });
  }

  // 2. Map the payload through GovBridge's canonical (common) data standard
  const { mapped, canonical, error: mapError } = mapPayload(sourcePlatform, targetPlatform, payload);
  if (mapError) {
    logTransaction({
      traceId,
      sourcePlatform,
      targetPlatform,
      recordId,
      status: "REJECTED_NO_MAPPING",
      consentId: consent.consentId,
      statusCode: 422,
      requestPayload: payload,
      errorMessage: mapError,
    });
    return res.status(422).json({ traceId, error: mapError });
  }

  // 3. Validate the MAPPED payload against the TARGET platform's schema
  const targetCheck = validateAgainstSchema(targetPlatform, mapped);
  if (!targetCheck.valid) {
    logTransaction({
      traceId,
      sourcePlatform,
      targetPlatform,
      recordId,
      status: "REJECTED_TARGET_VALIDATION",
      consentId: consent.consentId,
      statusCode: 422,
      requestPayload: payload,
      canonicalPayload: canonical,
      mappedPayload: mapped,
      errorMessage: `Mapped payload missing: ${targetCheck.missing.join(", ")}`,
    });
    return res.status(422).json({
      traceId,
      error: "Mapped payload failed validation against target platform schema.",
      missingFields: targetCheck.missing,
      mappedPayload: mapped,
    });
  }

  // 4. Forward to the target platform, with retry-based exception handling
  try {
    const targetResponse = await forwardWithRetry(
      `${target.baseUrl}${target.verifyEndpoint}`,
      mapped,
      { "x-api-key": target.apiKey }
    );

    logTransaction({
      traceId,
      sourcePlatform,
      targetPlatform,
      recordId,
      status: "SUCCESS",
      consentId: consent.consentId,
      statusCode: 200,
      requestPayload: payload,
      canonicalPayload: canonical,
      mappedPayload: mapped,
      responsePayload: targetResponse.data,
    });

    emitNotification({
      traceId,
      recordId,
      status: "SUCCESS",
      message: `Your application (${recordId}) was processed successfully. Status: ${targetResponse.data.verificationStatus || "COMPLETED"}.`,
    });

    res.json({
      traceId,
      routedTo: targetPlatform,
      canonicalPayload: canonical,
      mappedPayload: mapped,
      targetResponse: targetResponse.data,
    });
  } catch (err) {
    const status = err.response?.status || 502;
    const details = err.response?.data || err.message;
    const isNetworkFailure = !err.response;

    logTransaction({
      traceId,
      sourcePlatform,
      targetPlatform,
      recordId,
      status: isNetworkFailure ? "FAILED_NETWORK_RETRIES_EXHAUSTED" : "FAILED_AT_TARGET",
      consentId: consent.consentId,
      statusCode: status,
      requestPayload: payload,
      canonicalPayload: canonical,
      mappedPayload: mapped,
      errorMessage: typeof details === "string" ? details : JSON.stringify(details),
    });

    emitNotification({
      traceId,
      recordId,
      status: "FAILED",
      message: `Your application (${recordId}) could not be processed. Please try again later or contact support.`,
    });

    res.status(status).json({
      traceId,
      error: isNetworkFailure
        ? "Could not reach target platform after retries."
        : "Target platform rejected or failed to process the request.",
      details,
    });
  }
});

app.listen(PORT, () => {
  console.log(`[GovBridge] Core running on http://localhost:${PORT}`);
});
