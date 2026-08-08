# Docker daemon DNS

Nếu Docker không resolve được `registry-1.docker.io` hoặc `mcr.microsoft.com`
trong khi host vẫn resolve được, cấu hình DNS cho Docker daemon:

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "dns": ["210.245.1.254", "210.245.1.253", "1.1.1.1"]
}
EOF
sudo systemctl restart docker
docker info
```

Kiểm tra sau khi restart:

```bash
docker pull node:22-bookworm-slim
docker pull mcr.microsoft.com/playwright:v1.49.0-jammy
```

Trong môi trường hiện tại, thao tác này cần mật khẩu `sudo` của máy chủ nên
không thể thực hiện tự động. Trước khi sửa daemon, có thể build tạm bằng:

```bash
BUILDX_BUILDER=default ./backend/scripts/build-all.sh
```
