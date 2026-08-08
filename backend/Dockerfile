FROM alpine:3.20 AS certs
RUN apk add --no-cache ca-certificates

FROM scratch
COPY --from=certs /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY bin/hr-backend /hr-backend
EXPOSE 8080
ENTRYPOINT ["/hr-backend"]
