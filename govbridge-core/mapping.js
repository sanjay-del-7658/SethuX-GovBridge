/**
 * DATA MAPPING LAYER — Common Data Standard (Canonical Schema)
 *
 * Directly implements the PS's "common data standards" requirement.
 * Instead of writing a separate translation for every (source, target)
 * pair — which is O(n^2) as more platforms join — every platform only
 * needs ONE adapter into/out of a shared canonical schema. Adding a
 * new platform later means writing exactly one adapter, not one
 * mapping per existing platform.
 *
 * GOVBRIDGE CANONICAL SCHEMA (the "common data standard"):
 *   {
 *     recordId:      string   — unique identifier for the record
 *     fullName:      string
 *     dateOfBirth:   string   — ISO format YYYY-MM-DD
 *     address:       string
 *     contactNumber: string
 *   }
 */

const CANONICAL_FIELDS = ["recordId", "fullName", "dateOfBirth", "address", "contactNumber"];

// One adapter per platform: toCanonical (native -> common standard) and
// fromCanonical (common standard -> native). This is the only place a
// new platform needs code written for it.
const ADAPTERS = {
  "platform-a": {
    toCanonical(payload) {
      return {
        recordId: payload.citizen_id,
        fullName: payload.full_name,
        dateOfBirth: payload.dob,
        address: payload.address,
        contactNumber: payload.mobile,
      };
    },
    fromCanonical(canonical) {
      return {
        citizen_id: canonical.recordId,
        full_name: canonical.fullName,
        dob: canonical.dateOfBirth,
        address: canonical.address,
        mobile: canonical.contactNumber,
      };
    },
  },
  "platform-b": {
    toCanonical(payload) {
      return {
        recordId: payload.landRecordId,
        fullName: payload.applicantName,
        dateOfBirth: payload.birthDate,
        address: payload.region,
        contactNumber: payload.contactNumber,
      };
    },
    fromCanonical(canonical) {
      return {
        applicantName: canonical.fullName,
        birthDate: canonical.dateOfBirth,
        region: canonical.address,
        contactNumber: canonical.contactNumber,
      };
    },
  },
};

/**
 * Transforms `payload` (in sourcePlatform's native schema) into
 * targetPlatform's native schema, by routing it through the shared
 * canonical schema. Returns the canonical form too, for transparency
 * in the audit trail.
 */
function mapPayload(sourcePlatform, targetPlatform, payload) {
  const sourceAdapter = ADAPTERS[sourcePlatform];
  if (!sourceAdapter) {
    return { mapped: null, canonical: null, error: `No canonical adapter registered for source platform: ${sourcePlatform}` };
  }

  const targetAdapter = ADAPTERS[targetPlatform];
  if (!targetAdapter) {
    return { mapped: null, canonical: null, error: `No canonical adapter registered for target platform: ${targetPlatform}` };
  }

  const canonical = sourceAdapter.toCanonical(payload);
  const mapped = targetAdapter.fromCanonical(canonical);

  return { mapped, canonical, error: null };
}

module.exports = { mapPayload, ADAPTERS, CANONICAL_FIELDS };
