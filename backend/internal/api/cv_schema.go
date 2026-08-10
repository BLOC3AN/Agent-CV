package api

import (
	"encoding/json"
	"errors"
)

// errSchemaV2Invalid marks a document that is not CV schema v2.
var errSchemaV2Invalid = errors.New("CV không đúng schemaVersion 2")

// validateCVV2 checks the only CV document shape accepted in production.
func validateCVV2(cvRaw json.RawMessage) error {
	if !hasSchemaVersion(cvRaw, 2) {
		return errSchemaV2Invalid
	}
	return nil
}

// hasSchemaVersion checks only the version marker at the API boundary. Full
// document validation remains the responsibility of the shared CV schema.
func hasSchemaVersion(raw json.RawMessage, want int) bool {
	if len(raw) == 0 {
		return false
	}
	var probe struct {
		SchemaVersion *int `json:"schemaVersion"`
	}
	if json.Unmarshal(raw, &probe) != nil || probe.SchemaVersion == nil {
		return false
	}
	return *probe.SchemaVersion == want
}
