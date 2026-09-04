/**
 * ACCESS CONTROL LAYER
 * Two layers of access control:
 *  1. Platform authentication — which SYSTEM is allowed to route
 *     requests through GovBridge (existing, API-key based).
 *  2. Role-based access — which HUMAN ROLE is allowed to view what.
 *     "Official" can see the full cross-platform audit trail.
 *     "Citizen" can only track their own application's status, with
 *     no visibility into other citizens' data or internal payloads.
 *     (A real deployment would back this with government SSO / a
 *     federated identity provider — this simulates the role check
 *     that sits behind it, which is the part GovBridge itself owns.)
 */

// In production these would be issued/rotated per department and
// stored securely (e.g. hashed, in a DB). Hardcoded here to prove
// the access-control concept end-to-end.
const SOURCE_PLATFORM_KEYS = {
  "platform-a": "platformA-secret-key-001",
};

const VALID_ROLES = ["official", "citizen"];

/**
 * Returns { authorized: boolean, reason?: string }
 */
function authenticateSource(claimedSourcePlatform, providedApiKey) {
  const expectedKey = SOURCE_PLATFORM_KEYS[claimedSourcePlatform];

  if (!expectedKey) {
    return { authorized: false, reason: `Unknown or unregistered source platform: ${claimedSourcePlatform}` };
  }
  if (!providedApiKey) {
    return { authorized: false, reason: "Missing x-api-key header." };
  }
  if (providedApiKey !== expectedKey) {
    return { authorized: false, reason: "Invalid API key for the claimed source platform." };
  }

  return { authorized: true };
}

/**
 * Role check for human-facing endpoints (audit dashboard, tracking).
 * `requiredRole` of null means "any recognized role is fine".
 */
function checkRole(providedRole, requiredRole = null) {
  if (!providedRole || !VALID_ROLES.includes(providedRole)) {
    return { authorized: false, reason: `Missing or invalid x-role header. Must be one of: ${VALID_ROLES.join(", ")}` };
  }
  if (requiredRole && providedRole !== requiredRole) {
    return { authorized: false, reason: `This endpoint requires role '${requiredRole}', got '${providedRole}'.` };
  }
  return { authorized: true, role: providedRole };
}

module.exports = { authenticateSource, checkRole, VALID_ROLES };
