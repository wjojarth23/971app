# syntax=docker/dockerfile:1
#
# GPU-capable worker for the Vision Scouting pipeline (see
# ../../scoutingvision.md). This does NOT run on Cloud Run like the main app
# (../../Dockerfile) - Cloud Run has no GPU support and this needs to run
# continuously, polling for work, not respond to inbound HTTP requests. Build
# and run this on a real machine/VM with an NVIDIA GPU and the NVIDIA
# Container Toolkit installed (see ../../scoutingvision-remaining-work.md -
# no such host exists yet as of this Dockerfile; it makes deployment
# possible, it doesn't deploy anything by itself).
#
# Build:  docker build -t vision-runner -f vision/runner/Dockerfile vision/runner
# Run:    docker run --gpus all --env-file vision/runner/.env \
#           -v /path/to/models:/models:ro vision-runner

FROM python:3.11-slim

# opencv-python-headless still needs a couple of shared libs at runtime that
# python:slim doesn't ship (no X11/GUI libs on purpose - "headless" is the
# whole point, but libgl1/libglib2.0 are still linked against even so).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY vision_runner.py .

# No EXPOSE - this is an outbound polling client (claim/heartbeat/complete
# against VISION_API_URL), never an inbound server. No HEALTHCHECK for the
# same reason; fleet liveness is the heartbeat action / vision_runners table
# (see the event dashboard), not a container-level probe.
CMD ["python", "vision_runner.py"]
