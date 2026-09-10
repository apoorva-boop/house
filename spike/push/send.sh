#!/usr/bin/env bash
# Sends the one hard-coded message to every stored subscription.
#
#   ./send.sh https://push-spike-xxxx.run.app
#
# Reads SEND_SECRET from .env (or the environment). Prints the JSON the service returns.
set -euo pipefail

URL="${1:?usage: ./send.sh <service-url>}"
if [[ -z "${SEND_SECRET:-}" && -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi
[[ -n "${SEND_SECRET:-}" ]] || { echo "SEND_SECRET is not set. Fill in .env." >&2; exit 1; }

echo "$(date -u +%FT%TZ)  POST ${URL%/}/send"
curl -sS -X POST "${URL%/}/send" \
  -H "Authorization: Bearer ${SEND_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{}' \
  -w '\nHTTP %{http_code}\n'
