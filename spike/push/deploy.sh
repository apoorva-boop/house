#!/usr/bin/env bash
# Deploys the spike to Cloud Run. Run from spike/push with a filled-in .env next to it.
#
#   ./deploy.sh <gcp-project-id> [region]
#
# Subscriptions live in a JSON file. Cloud Run's disk is wiped every time the instance
# scales to zero (min-instances=0), so the file sits on a small Cloud Storage bucket
# mounted at /data. That is still "a JSON file, no database" — it just survives the night.
set -euo pipefail

PROJECT="${1:?usage: ./deploy.sh <gcp-project-id> [region]}"
REGION="${2:-australia-southeast1}"
SERVICE="push-spike"
BUCKET="${PROJECT}-push-spike-data"

if [[ ! -f .env ]]; then
  echo "No .env here. Copy .env.example to .env and fill it in first." >&2
  exit 1
fi
# shellcheck disable=SC1091
set -a; source .env; set +a
for v in VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_SUBJECT SEND_SECRET; do
  [[ -n "${!v:-}" ]] || { echo "$v is empty in .env" >&2; exit 1; }
done

gcloud config set project "$PROJECT" >/dev/null

if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  echo "Creating bucket gs://${BUCKET}"
  gcloud storage buckets create "gs://${BUCKET}" --location="$REGION" --uniform-bucket-level-access
fi

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --max-instances=1 --min-instances=0 --memory=256Mi \
  --add-volume="name=data,type=cloud-storage,bucket=${BUCKET}" \
  --add-volume-mount="volume=data,mount-path=/data" \
  --set-env-vars "VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY},VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY},VAPID_SUBJECT=${VAPID_SUBJECT},SEND_SECRET=${SEND_SECRET},DATA_FILE=/data/subscriptions.json"

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo
echo "Deployed. Open this on the iPhone in Safari:"
echo "  $URL"
echo
echo "Then send with:   ./send.sh $URL"
