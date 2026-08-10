package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestWantsV2OnlyOnExactOptIn(t *testing.T) {
	cases := []struct {
		header string
		want   bool
		why    string
	}{
		{"2", true, "opt-in đúng"},
		{"", false, "không có header"},
		{"1", false, "xin v1"},
		{"3", false, "phiên bản chưa tồn tại"},
		{"v2", false, "sai định dạng"},
		{" 2", true, "khoảng trắng thừa vẫn là opt-in"},
	}
	for _, tc := range cases {
		r := httptest.NewRequest(http.MethodGet, "/api/cv", nil)
		if tc.header != "" {
			r.Header.Set("X-CV-Schema", tc.header)
		}
		if got := wantsV2(r); got != tc.want {
			t.Fatalf("X-CV-Schema=%q → %v, muốn %v (%s)", tc.header, got, tc.want, tc.why)
		}
	}
}
