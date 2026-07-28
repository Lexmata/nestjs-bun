#!/usr/bin/env bash
# Generate a self-signed certificate for local TLS testing.
# The output is gitignored — never commit key.pem or cert.pem.
set -euo pipefail

cd "$(dirname "$0")"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout key.pem -out cert.pem \
  -days 365 -subj "/CN=localhost"

# openssl writes the key with the ambient umask, which on most systems leaves it
# world-readable. Restrict it to the owner.
chmod 600 key.pem

echo "Wrote key.pem (mode 600) and cert.pem in $(pwd)"
