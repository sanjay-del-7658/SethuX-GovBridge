/**
 * PLATFORM A — "Citizen ID Service"
 * A standalone mock government platform with its OWN data schema.
 * This plays the role of a real department system (e.g. a citizen
 * registry) that needs to exchange data with another department
 * (Platform B) — but only ever talks through GovBridge, never directly.
 */

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PLATFORM_A_PORT || 4001;
const GOVBRIDGE_URL = process.env.GOVBRIDGE_URL || "http://localhost:4000";
const PLATFORM_A_API_KEY = "platformA-secret-key-001"; // used for GovBridge access control (Step 6)

// --- Platform A's own schema (snake_case) ---
// Note: intentionally different field names/shape from Platform B.
// This is what makes the mapping layer in GovBridge necessary.
const citizens = [
  {
    citizen_id: "CID-1001",
    full_name: "Ananya Rao",
    dob: "1998-03-14",
    address: "Hyderabad, Telangana",
    mobile: "9876500001",
  },
  {
    citizen_id: "CID-1002",
    full_name: "Rahul Mehta",
    dob: "1995-11-02",
    address: "Pune, Maharashtra",
    mobile: "9876500002",
  },
  {
    citizen_id: "CID-1003",
    full_name: "Sara Thomas",
    dob: "2000-07-21",
    address: "Kochi, Kerala",
    mobile: "9876500003",
  },
];

// --- Consent store (in-memory) ---
// A citizen must explicitly consent before Platform A is allowed to
// share their data through GovBridge. No consent, no request — this
// directly implements the PS's "consent-based data sharing" requirement.
const consents = {}; // citizen_id -> { consentId, purpose, consentGiven, consentTimestamp }

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Platform A - Citizen ID Service" });
});

// View Platform A's own records (for demo purposes)
app.get("/api/citizens", (req, res) => {
  res.json({ platform: "Platform A", records: citizens });
});

app.get("/api/citizens/:id", (req, res) => {
  const record = citizens.find((c) => c.citizen_id === req.params.id);
  if (!record) return res.status(404).json({ error: "Citizen not found" });
  res.json(record);
});

/**
 * The citizen (or a UI acting on their behalf) explicitly consents
 * here before ANY data sharing can happen. This must be called before
 * request-verification below — there is no way to bypass it.
 */
app.post("/api/citizens/:id/consent", (req, res) => {
  const record = citizens.find((c) => c.citizen_id === req.params.id);
  if (!record) return res.status(404).json({ error: "Citizen not found" });

  const purpose = req.body?.purpose || "land-record-verification";
  const consent = {
    consentId: crypto.randomUUID(),
    citizenId: req.params.id,
    purpose,
    consentGiven: true,
    consentTimestamp: new Date().toISOString(),
  };
  consents[req.params.id] = consent;

  res.json({ message: "Consent recorded", consent });
});

app.get("/api/citizens/:id/consent", (req, res) => {
  const consent = consents[req.params.id];
  if (!consent) return res.status(404).json({ error: "No consent on record for this citizen" });
  res.json({ consent });
});

/**
 * This is the key action: Platform A does NOT call Platform B directly.
 * It sends its request through GovBridge, which validates, maps the
 * schema, authenticates, forwards it, and logs the whole transaction.
 * Requires prior consent — see /consent endpoint above.
 */
app.post("/api/citizens/:id/request-verification", async (req, res) => {
  const record = citizens.find((c) => c.citizen_id === req.params.id);
  if (!record) return res.status(404).json({ error: "Citizen not found" });

  const consent = consents[req.params.id];
  if (!consent || !consent.consentGiven) {
    return res.status(403).json({
      error: "Consent required before this citizen's data can be shared via GovBridge.",
      hint: `POST /api/citizens/${req.params.id}/consent first.`,
    });
  }

  try {
    const bridgeResponse = await axios.post(
      `${GOVBRIDGE_URL}/api/bridge/request`,
      {
        sourcePlatform: "platform-a",
        targetPlatform: "platform-b",
        payload: record, // sent in Platform A's native schema
        consent, // proof of consent, checked again independently by GovBridge
      },
      {
        headers: { "x-api-key": PLATFORM_A_API_KEY },
      }
    );
    res.json({
      message: "Request routed through GovBridge",
      bridgeResult: bridgeResponse.data,
    });
  } catch (err) {
    const status = err.response?.status || 500;
    res.status(status).json({
      error: "GovBridge request failed",
      details: err.response?.data || err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`[Platform A] Citizen ID Service running on http://localhost:${PORT}`);
});
