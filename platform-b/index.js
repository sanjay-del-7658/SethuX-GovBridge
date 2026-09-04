/**
 * PLATFORM B — "Land & Verification Records Service"
 * A second standalone mock government platform, run by a different
 * "department". Its schema is intentionally shaped differently from
 * Platform A's (camelCase, different field names, extra fields) —
 * this is the real-world reality GovBridge has to bridge.
 *
 * Platform B never talks to Platform A directly. It only accepts
 * verification requests from GovBridge, authenticated via API key.
 */

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PLATFORM_B_PORT || 4002;
const GOVBRIDGE_API_KEY_EXPECTED = "govbridge-core-secret-key"; // only GovBridge should know this

// --- Platform B's own schema (camelCase) — different shape from Platform A ---
const records = [
  {
    landRecordId: "LR-5001",
    applicantName: "Ananya Rao",
    birthDate: "1998-03-14",
    region: "Hyderabad, Telangana",
    contactNumber: "9876500001",
    status: "VERIFIED",
  },
  {
    landRecordId: "LR-5002",
    applicantName: "Rahul Mehta",
    birthDate: "1995-11-02",
    region: "Pune, Maharashtra",
    contactNumber: "9876500002",
    status: "VERIFIED",
  },
  {
    landRecordId: "LR-5003",
    applicantName: "Sara Thomas",
    birthDate: "2000-07-21",
    region: "Kochi, Kerala",
    contactNumber: "9876500003",
    status: "PENDING_REVIEW",
  },
];

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Platform B - Land & Verification Records Service" });
});

// View Platform B's own records (for demo purposes)
app.get("/api/records", (req, res) => {
  res.json({ platform: "Platform B", records });
});

/**
 * Verification endpoint — ONLY GovBridge should ever call this.
 * Expects Platform B's own schema shape (already mapped by GovBridge
 * from whatever Platform A originally sent).
 */
app.post("/api/verify", (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== GOVBRIDGE_API_KEY_EXPECTED) {
    return res.status(403).json({ error: "Forbidden: direct access not allowed. Requests must come through GovBridge." });
  }

  const { applicantName, birthDate } = req.body || {};
  if (!applicantName || !birthDate) {
    return res.status(400).json({ error: "Missing required fields: applicantName, birthDate" });
  }

  const match = records.find(
    (r) => r.applicantName.toLowerCase() === applicantName.toLowerCase() && r.birthDate === birthDate
  );

  if (!match) {
    return res.status(404).json({
      verificationStatus: "NOT_FOUND",
      message: "No matching land record found for this applicant.",
    });
  }

  res.json({
    landRecordId: match.landRecordId,
    verificationStatus: match.status,
    region: match.region,
    message: `Record found and status is ${match.status}.`,
  });
});

app.listen(PORT, () => {
  console.log(`[Platform B] Land & Verification Records Service running on http://localhost:${PORT}`);
});
