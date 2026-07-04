## Geospatial AI (BigQuery + Vertex AI) - Isosehat Jawa Timur

Repo ini sudah punya data siap-load ke BigQuery dan folder `gcp/geojson` berisi file GeoJSON asli dari shapefile untuk:
- Zonasi rawan gempa bumi (jatim_gempa bumi/)
- Zonasi rawan tanah gerak (jatim_tanah gerak/)
- Semua faskes di Jawa Timur (faskes_jatim.geojson)
- Data banjir (placeholder untuk banjir Surabaya & Malang)

Data di folder `../data`:
- `boundary_provinsi.csv` / `province-boundary.output.geojson`
- `population_grid.csv` (data densitas penduduk asli)
- `faskes_aplicares.csv` (data fasilitas kesehatan)
- Folder shapefile gempa dan tanah gerak

---

## Panduan Lengkap Setup Google Cloud

### Prasyarat
1. Sudah punya akun GCP dengan Project ID: `genai-apac-497712`
2. Sudah install `gcloud` CLI dan login
3. Sudah install Python 3.10+ dan Node.js 18+

---

## Langkah 1: Aktifkan Layanan GCP

```bash
cd /Users/kohryan/Documents/Ryan/2-programming/isosehatv2/gcp
bash bootstrap_services.sh
```

Script ini akan mengaktifkan:
- BigQuery
- Vertex AI
- Cloud Storage
- Cloud Functions (untuk API)
- Cloud Run

---

## Langkah 2: Muat Data ke BigQuery + Buat Tabel dan Views

### Opsi A (Quick Start - Pakai Dashboard JSON Sudah Jadi):
Jika kamu ingin langsung lihat dashboard tanpa setup BigQuery:
```bash
cd ../frontend
npm run dev
```

### Opsi B (Full Setup BigQuery):
1. Pindah ke folder `gcp/bq/`
2. Jalankan script untuk memuat data dan build tabel:
```bash
cd gcp/bq
bash load_and_build.sh
```

3. Setelah selesai, kamu bisa export data untuk dashboard dari BigQuery:
```bash
pip install -r requirements.txt
export PROJECT_ID="genai-apac-497712"
export DATASET="isosehat_jatim"
python export_dashboard_data.py
```

---

## Langkah 3: Menggunakan GeoJSON di Google Cloud

File GeoJSON untuk hazard dan faskes sudah disiapkan di `gcp/geojson/`:
1. `hazard_gempa_jatim.geojson` - zonasi gempa
2. `hazard_tanah_gerak_jatim.geojson` - zonasi tanah gerak
3. `hazard_banjir_surabaya.geojson` - banjir Surabaya
4. `hazard_banjir_malang.geojson` - banjir Malang
5. `faskes_jatim.geojson` - semua fasilitas kesehatan

Untuk upload ke Cloud Storage:
```bash
export PROJECT_ID="genai-apac-497712"
export BUCKET_NAME="gs://isosehat-jatim-data"

# Buat bucket (jika belum ada)
gcloud storage buckets create $BUCKET_NAME --location=asia-southeast2

# Upload semua geojson
gcloud storage cp gcp/geojson/*.geojson $BUCKET_NAME/
```

Untuk membuat tabel BigQuery dari GeoJSON:
```bash
# Contoh untuk gempa
bq load --source_format=NEWLINE_DELIMITED_JSON \
  --json_extension=GEOJSON \
  isosehat_jatim.hazard_gempa \
  $BUCKET_NAME/hazard_gempa_jatim.geojson

# Contoh untuk faskes
bq load --source_format=NEWLINE_DELIMITED_JSON \
  --json_extension=GEOJSON \
  isosehat_jatim.faskes_jatim \
  $BUCKET_NAME/faskes_jatim.geojson
```

---

## Langkah 4: Setup Vertex AI untuk Analisis

Lihat file `vertex-ai-setup.md` untuk panduan lengkap integrasi Vertex AI (Gemini).

Quick steps:
1. Buat service account untuk Vertex AI
2. Deploy backend API ke Cloud Run
3. Hubungkan frontend ke API

---

## Langkah 5: Jalankan Frontend

```bash
cd /Users/kohryan/Documents/Ryan/2-programming/isosehatv2/frontend
npm install
npm run dev
```

Frontend akan berjalan di http://localhost:5173.

---

## Struktur Output BigQuery

Dataset default: `isosehat_jatim` (lokasi `asia-southeast2`)

Tabel:
- `boundary_provinsi` - batas provinsi
- `population_grid` - grid densitas penduduk
- `faskes_aplicares` - semua faskes
- `faskes_isochrone` - isochrone faskes
- `hazard_gempa` - hazard gempa (dari shapefile)
- `hazard_tanah_gerak` - hazard tanah gerak (dari shapefile)
- `scenario_flood_zone` - scenario banjir

Views (untuk dashboard):
- `v_area_metrics_geohash6` - metrik area per geohash
- `v_top5_underserved_geohash6` - 5 area teratas yang membutuhkan layanan
- `v_resilience_area_geohash6` - resilience analysis

---

## Fitur Utama

1. **Policy Copilot** - tanya analisis ke AI berbasis BigQuery
2. **Citizen Copilot** - chat untuk triase dan rujukan faskes
3. **Resilience Simulator** - overlay hazard dan hitung dampak
4. **Peta Choropleth** - visualisasi equity index dan kepadatan penduduk
5. **Isochrones** - jangkauan faskes

---

## Catatan Penting

- Semua data populasi, hazard, dan faskes sudah menggunakan data asli untuk Jawa Timur
- Semua shapefile telah dikonversi ke GeoJSON untuk kemudahan penggunaan di Google Cloud
- Anda bisa mengganti data populasi atau hazard dengan data asli terbaru kapan saja!
