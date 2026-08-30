# syntax=docker/dockerfile:1
#
# GPU-capable worker for the Vision Scouting pipeline (see
# ../../scoutingvision.md). This does NOT run on Cloud Run like the main app
# (../../Dockerfile) - Cloud Run has no GPU support and this needs to run
# continuously, polling for work, not respond to inbound HTTP requests. Build
# and run this on a real machine/VM with an NVIDIA GPU and the NVIDIA
# Container Toolkit installed (see ../../scoutingvision-remaining-work.md).
# The deployment target is the planned DGX Spark; this image does not deploy
# or provision that host by itself.
#
# Build:  docker build -t vision-runner -f vision/runner/Dockerfile vision/runner
# Run:    docker run --gpus all --env-file vision/runner/.env \
#           -v /path/to/models:/models:ro vision-runner

ARG NVIDIA_PYTORCH_IMAGE=nvcr.io/nvidia/pytorch:26.07-py3
FROM ${NVIDIA_PYTORCH_IMAGE}

# opencv-python-headless still needs these shared libraries at runtime. No
# X11/GUI stack is installed; the runner remains headless.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY vision_runner.py .

# No EXPOSE - this is an outbound polling client (claim/heartbeat/complete
# against VISION_API_URL), never an inbound server. No HEALTHCHECK for the
# same reason; fleet liveness is the heartbeat action / vision_runners table
# (see the event dashboard), not a container-level probe.
CMD ["python", "vision_runner.py"]
