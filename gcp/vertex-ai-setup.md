# Setup Vertex AI untuk Isosehat

Dokumentasi ini menjelaskan cara mengintegrasikan Vertex AI (Gemini) ke dalam aplikasi Isosehat.

## Prasyarat
1. Project GCP sudah dibuat (`genai-apac-497712`)
2. gcloud CLI sudah terinstal dan dikonfigurasi
3. Vertex AI API sudah diaktifkan

## Langkah-langkah Setup

### 1. Aktifkan API yang Dibutuhkan
```bash
export PROJECT_ID="genai-apac-497712"
export REGION="asia-southeast2"

gcloud config set project $PROJECT_ID
gcloud services enable aiplatform.googleapis.com
gcloud services enable cloudfunctions.googleapis.com
gcloud services enable run.googleapis.com
```

### 2. Buat Service Account untuk Akses Vertex AI
```bash
gcloud iam service-accounts create isosehat-vertex-service \
  --display-name="Isosehat Vertex AI Service"

# Berikan izin Vertex AI User
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:isosehat-vertex-service@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Berikan izin untuk Cloud Storage (jika dibutuhkan)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:isosehat-vertex-service@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

### 3. Buat Service API dengan Cloud Run
Kami akan membuat backend sederhana untuk memanggil Vertex AI, sehingga frontend tidak perlu menyimpan kredensial.

Buat file `gcp/vertex-api/main.py`:
```python
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from google.cloud import aiplatform
from vertexai.preview.generative_models import GenerativeModel

app = FastAPI(title="Isosehat Vertex AI API")

PROJECT_ID = os.getenv("PROJECT_ID", "genai-apac-497712")
REGION = os.getenv("REGION", "asia-southeast2")

# Inisialisasi Vertex AI
aiplatform.init(project=PROJECT_ID, location=REGION)
model = GenerativeModel("gemini-1.5-flash-001")

class PolicyQuestionRequest(BaseModel):
    question: str
    context: str

class CitizenTriageRequest(BaseModel):
    symptoms: str
    location: dict

@app.post("/api/policy/analyze")
async def analyze_policy(request: PolicyQuestionRequest):
    try:
        prompt = f"""
        Kamu adalah AI Analis Kesehatan untuk Pemerintah Jawa Timur.
        
        Konteks data:
        {request.context}
        
        Pertanyaan: {request.question}
        
        Jawab dengan:
        1. Analisis singkat (max 3 kalimat)
        2. Rekomendasi tindakan
        3. Saran query SQL (jika relevan)
        
        Gunakan bahasa Indonesia yang ramah dan mudah dimengerti.
        """
        
        response = model.generate_content(prompt)
        return {"analysis": response.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/citizen/triage")
async def citizen_triage(request: CitizenTriageRequest):
    try:
        prompt = f"""
        Kamu adalah AI untuk triase kesehatan ringan.
        
        Gejala pasien: {request.symptoms}
        Lokasi: {request.location}
        
        Berikan rekomendasi:
        - Level layanan (Puskesmas/Klinik/RS/IGD)
        - Alasan mengapa level tersebut sesuai
        - Catatan penting
        
        Gunakan bahasa Indonesia yang ramah. Jangan mendiagnosis, hanya memberikan rekomendasi level layanan.
        """
        
        response = model.generate_content(prompt)
        return {"recommendation": response.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8080)))
```

### 4. Deploy ke Cloud Run
```bash
# Buat requirements.txt untuk Vertex API
cat > gcp/vertex-api/requirements.txt << 'EOF'
fastapi==0.109.0
uvicorn[standard]==0.27.0
google-cloud-aiplatform==1.42.0
pydantic==2.5.3
python-multipart==0.0.6
EOF

# Deploy ke Cloud Run
gcloud run deploy isosehat-vertex-api \
  --source=gcp/vertex-api \
  --platform=managed \
  --region=$REGION \
  --allow-unauthenticated \
  --set-env-vars=PROJECT_ID=$PROJECT_ID,REGION=$REGION \
  --service-account=isosehat-vertex-service@${PROJECT_ID}.iam.gserviceaccount.com
```

### 5. Integrasikan ke Frontend
Update frontend untuk memanggil API ini. Contoh implementasi:
```typescript
// src/services/vertexApi.ts
const API_BASE = "YOUR_CLOUD_RUN_URL";

export async function analyzePolicyQuestion(question: string, context: string) {
  const response = await fetch(`${API_BASE}/api/policy/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, context }),
  });
  return response.json();
}

export async function getCitizenRecommendation(symptoms: string, location: { lat: number; lon: number }) {
  const response = await fetch(`${API_BASE}/api/citizen/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symptoms, location }),
  });
  return response.json();
}
```

## Catatan Penting
- Selalu simpan kredensial di sisi server, never expose di frontend
- Gunakan IAM dengan prinsip least privilege
- Monitor penggunaan Vertex AI untuk mengendalikan biaya
