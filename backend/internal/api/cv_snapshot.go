package api

import (
	"encoding/json"
	"errors"
	"fmt"
)

// errV2NotBackfilled is retained as a defensive response for databases that
// were not migrated yet. A production database after the cutover stores only
// v2, so callers never fall back to an older document shape.
var errV2NotBackfilled = errors.New("This CV has no v2 revision yet")

func cvSnapshotForResponse(v2Raw []byte) (snapshot any, schemaVersion int, err error) {
	if len(v2Raw) == 0 {
		return nil, 0, errV2NotBackfilled
	}
	var v2 any
	if err := json.Unmarshal(v2Raw, &v2); err != nil {
		return nil, 0, fmt.Errorf("parse profiles.data: %w", err)
	}
	return v2, 2, nil
}
