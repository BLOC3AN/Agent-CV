package main

import (
	"log"
	"net/http"
	"os"

	"github.com/hr-agent/backend/internal/api"
)

func main() {
	addr := os.Getenv("BACKEND_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	server := api.NewServer()
	log.Printf("hr backend listening on %s", addr)
	if err := http.ListenAndServe(addr, server.Routes()); err != nil {
		log.Fatal(err)
	}
}
