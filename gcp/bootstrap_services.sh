set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID belum diset}"
: "${REGION:=asia-southeast2}"

command -v gcloud >/dev/null 2>&1 || { echo "gcloud tidak ditemukan di PATH"; exit 1; }

gcloud config set project "$PROJECT_ID" >/dev/null
gcloud config set run/region "$REGION" >/dev/null

gcloud services enable \
  bigquery.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com

echo "OK: services enabled untuk project ${PROJECT_ID}"

