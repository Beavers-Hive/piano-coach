#!/usr/bin/env bash
set -euo pipefail

PIANO_PROJECT_ID="${1:?Usage: deploy-cloud-run.sh PROJECT_ID [REGION]}"
PIANO_REGION="${2:-asia-northeast1}"
cd "$(dirname "$0")/.."

gcloud run deploy piano-coach \
  --source . --project="$PIANO_PROJECT_ID" --region="$PIANO_REGION" \
  --allow-unauthenticated \
  --service-account="piano-coach-runtime@${PIANO_PROJECT_ID}.iam.gserviceaccount.com" \
  --build-service-account="projects/${PIANO_PROJECT_ID}/serviceAccounts/piano-coach-build@${PIANO_PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${PIANO_PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,PIANO_COACH_GEMINI_MODEL=gemini-3.5-flash,PIANO_COACH_GEMINI_FINGERING_MODEL=gemini-3.1-flash-lite,PIANO_COACH_GEMINI_ANALYSIS_MODEL=gemini-3.1-flash-lite" \
  --memory=1Gi --cpu=1 --timeout=3600 \
  --max-instances=1 --min-instances=0 --concurrency=8 --port=8080 \
  --session-affinity --quiet
