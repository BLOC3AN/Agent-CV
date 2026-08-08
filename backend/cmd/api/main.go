package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"

	"github.com/hr-agent/backend/internal/api"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	addr := os.Getenv("BACKEND_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	server := api.NewServer()
	if databaseURL := os.Getenv("DATABASE_URL"); databaseURL != "" {
		db, err := sql.Open("pgx", databaseURL)
		if err != nil {
			log.Fatal(err)
		}
		if err := db.Ping(); err != nil {
			log.Fatal(err)
		}
		defer db.Close()
		storageRoot := os.Getenv("STORAGE_ROOT")
		server = api.NewServerWithDB(db, storageRoot)
	}
	log.Printf("hr backend listening on %s", addr)
	if err := http.ListenAndServe(addr, server.Routes()); err != nil {
		log.Fatal(err)
	}
}
