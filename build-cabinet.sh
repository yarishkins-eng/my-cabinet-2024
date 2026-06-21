#!/bin/bash
cd /opt/bedolaga-cabinet
echo "[build] start $(date)"
docker compose build 2>&1
echo "[build] up..."
docker compose up -d 2>&1
echo "[build] DONE rc=$?"
