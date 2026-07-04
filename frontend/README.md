## Frontend Dashboard

### Jalankan

```bash
cd frontend
npm install
npm run dev
```

### Data dashboard
Frontend membaca file statis:
- `frontend/public/data/dashboard.json`

Generate cepat dari CSV lokal (pakai metrik proxy + skenario banjir sintetik untuk demo):

```bash
python3 frontend/scripts/build_dashboard_from_csv.py
```

Generate dari BigQuery (choropleth + resilience + boundary):

```bash
python3 -m pip install -r gcp/bq/requirements.txt
export PROJECT_ID="genai-apac-497712"
export DATASET="isosehat_jatim"
python3 gcp/bq/export_dashboard_data.py
```
