package api

import (
	"net/http"
	"strings"
)

// SchemaVersionHeader is retained as a harmless compatibility header while
// every production endpoint serves the V2 document shape.
const SchemaVersionHeader = "X-CV-Schema"

// Only the explicit V2 value is accepted. Invalid values never opt a request
// into an unknown response shape.
func wantsV2(r *http.Request) bool {
	return strings.TrimSpace(r.Header.Get(SchemaVersionHeader)) == "2"
}
