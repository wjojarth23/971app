FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for caching
COPY autocam/requirements.txt ./autocam/
COPY PenguinCAM/requirements.txt ./PenguinCAM/

# Install Python dependencies
RUN pip install --no-cache-dir -r autocam/requirements.txt

# Copy PenguinCAM source
COPY PenguinCAM/frc_cam_postprocessor.py ./

# Copy autocam service
COPY autocam/autocam_service.py ./

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8080/health').raise_for_status()"

# Run the service
CMD ["uvicorn", "autocam_service:app", "--host", "0.0.0.0", "--port", "8080"]
