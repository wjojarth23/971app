# 971hub Autocam Service - Deployment Guide

The Autocam Service is a Python FastAPI backend that integrates PenguinCAM for automatic G-code generation of sheet stock parts.

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   971hub App    │────▶│  /api/autocam    │────▶│ Autocam Service │
│   (SvelteKit)   │     │  (API endpoint)  │     │  (FastAPI/Python)│
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                                                  │
        │                                                  ▼
        │                                        ┌─────────────────┐
        └───────────────────────────────────────▶│    Supabase     │
                                                 │   (Database)    │
                                                 └─────────────────┘
```

## Prerequisites

- Python 3.11+
- Node.js (for the SvelteKit app)
- Docker (optional, for containerized deployment)

## Local Development

### 1. Install Python Dependencies

```bash
cd autocam
pip install -r requirements.txt
```

### 2. Copy PenguinCAM Core Files

The service needs access to the PenguinCAM post-processor:

```bash
# Copy the core processing file
cp PenguinCAM/frc_cam_postprocessor.py autocam/
```

### 3. Start the Service

```bash
cd autocam
python autocam_service.py
```

Or using uvicorn directly:

```bash
uvicorn autocam_service:app --host 0.0.0.0 --port 8080 --reload
```

The service will be available at `http://localhost:8080`.

### 4. Configure the SvelteKit App

Add the autocam API URL to your `.env` file:

```env
PUBLIC_AUTOCAM_API_URL=http://localhost:8080
```

## Production Deployment Options

### Option 1: Docker (Recommended)

1. **Build the Docker image:**

```bash
docker build -f autocam/Dockerfile -t 971hub-autocam:latest .
```

2. **Run the container:**

```bash
docker run -d \
  --name autocam \
  -p 8080:8080 \
  -e ONSHAPE_ACCESS_KEY=your_key \
  -e ONSHAPE_SECRET_KEY=your_secret \
  -e ONSHAPE_BASE_URL=https://cad.onshape.com \
  971hub-autocam:latest
```

3. **Deploy to cloud:**

   - **Google Cloud Run:**
     ```bash
     gcloud run deploy autocam --image 971hub-autocam:latest --platform managed
     ```

   - **AWS ECS/Fargate:**
     Push to ECR and deploy via ECS task definition

   - **Railway/Render/Fly.io:**
     Connect repo and auto-deploy from Dockerfile

### Option 2: Heroku

1. Create a `Procfile` in the autocam directory (already included):
   ```
   web: uvicorn autocam_service:app --host 0.0.0.0 --port $PORT
   ```

2. Deploy:
   ```bash
   cd autocam
   heroku create 971hub-autocam
   heroku config:set ONSHAPE_ACCESS_KEY=your_key
   heroku config:set ONSHAPE_SECRET_KEY=your_secret
   git push heroku main
   ```

### Option 3: Traditional VPS (Ubuntu/Debian)

1. **Install system dependencies:**
   ```bash
   sudo apt update
   sudo apt install python3.11 python3.11-venv nginx supervisor
   ```

2. **Set up the application:**
   ```bash
   # Create app directory
   sudo mkdir -p /opt/autocam
   cd /opt/autocam

   # Copy files
   cp -r /path/to/autocam/* .
   cp /path/to/PenguinCAM/frc_cam_postprocessor.py .

   # Create virtual environment
   python3.11 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Configure Supervisor:**
   Create `/etc/supervisor/conf.d/autocam.conf`:
   ```ini
   [program:autocam]
   command=/opt/autocam/venv/bin/uvicorn autocam_service:app --host 127.0.0.1 --port 8080
   directory=/opt/autocam
   user=www-data
   autostart=true
   autorestart=true
   environment=ONSHAPE_ACCESS_KEY="your_key",ONSHAPE_SECRET_KEY="your_secret"
   ```

4. **Configure Nginx:**
   ```nginx
   server {
       listen 80;
       server_name autocam.yourdomain.com;

       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       }
   }
   ```

5. **Start services:**
   ```bash
   sudo supervisorctl reread
   sudo supervisorctl update
   sudo systemctl restart nginx
   ```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Service port (default: 8080) | No |
| `HOST` | Bind address (default: 0.0.0.0) | No |
| `ONSHAPE_ACCESS_KEY` | Onshape API access key | For Onshape DXF export |
| `ONSHAPE_SECRET_KEY` | Onshape API secret key | For Onshape DXF export |
| `ONSHAPE_BASE_URL` | Onshape API base URL | For Onshape DXF export |

## API Endpoints

### Health Check
```
GET /health
```
Returns service status and available material presets.

### Get Material Presets
```
GET /presets
```
Returns available material presets with default parameters.

### Generate G-code
```
POST /generate
Content-Type: application/json

{
  "part_id": 123,
  "part_name": "my_part",
  "dxf_source": "url",
  "dxf_url": "https://...",
  "material_preset": "aluminum",
  "material_thickness": 0.125,
  "tool_diameter": 0.25
}
```

### Generate from Upload
```
POST /generate-from-upload
Content-Type: multipart/form-data

dxf_file: (file)
part_id: 123
part_name: my_part
material_preset: aluminum
material_thickness: 0.125
tool_diameter: 0.25
```

### Validate DXF
```
POST /validate-dxf
Content-Type: multipart/form-data

dxf_file: (file)
```

## Database Setup

Run the migration to set up the autocam tables:

```bash
# Using Supabase CLI
supabase db push migrations/20260126_autocam_system.sql

# Or via psql
psql $DATABASE_URL -f migrations/20260126_autocam_system.sql
```

## Testing

1. Start the service locally
2. Navigate to the autocam settings page: `/manufacture/autocam`
3. Verify the service status shows "healthy"
4. Configure profiles for your stock types
5. Add a pending sheet stock part
6. Verify it gets auto-CAMmed and shows "Review Autocam" button

## Troubleshooting

### Service Unavailable
- Check if the service is running: `curl http://localhost:8080/health`
- Verify the `PUBLIC_AUTOCAM_API_URL` environment variable
- Check Docker container logs: `docker logs autocam`

### DXF Export Failed
- Verify Onshape API credentials
- Check the part has a valid face for 2D export
- Ensure the DXF URL is accessible

### G-code Generation Failed
- Check the DXF file is valid (use `/validate-dxf` endpoint)
- Verify material thickness matches the profile
- Check for closed paths in the DXF (open paths can't be milled)

## Scaling Considerations

For high volume:
- Use Redis for job queuing
- Run multiple service instances behind a load balancer
- Consider async processing with Celery
- Cache frequently-accessed autocam profiles

## Security

- The service should not be directly exposed to the internet
- Always route through the SvelteKit API endpoint
- Consider adding API key authentication for production
- Rate limit the generate endpoints
