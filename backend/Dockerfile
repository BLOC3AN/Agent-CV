FROM golang:1.22-bookworm AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -o /out/hr-backend ./cmd/api

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/hr-backend /hr-backend
EXPOSE 8080
ENTRYPOINT ["/hr-backend"]
