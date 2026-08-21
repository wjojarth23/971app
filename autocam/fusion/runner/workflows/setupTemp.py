import os
from ..config import *
import sys
import requests
import adsk.core

sys.path.append(OVERRIDE_PATH)


def setupTempDir():
    for path in (TEMP_PATH, INITIAL_PATH, FINAL_PATH, TOOLS_PATH):
        if not os.path.exists(path):
            os.makedirs(path)
    return TEMP_PATH


def downloadFiles(temp_dir, data, session):
    """Downloads every assigned part's STEP file into initial/{part_id}.step.

    /api/fusion-runner's claim response already resolves each assignment's
    signed download URL server-side (src/routes/api/fusion-runner/+server.js's
    buildJobPayload()) - no separate /api/parts/{id} lookup needed (that
    endpoint never existed on this app; Valor's original did the same thing
    the other way around, fetching each part's URL individually here).
    """
    app = adsk.core.Application.get()
    for part in data.get("payload", {}).get("assignments", []):
        step_file_url = part.get("step_file_url")
        if not step_file_url:
            app.log(f"Skipping part {part.get('part_id')}: no step_file_url in payload")
            continue
        content = requests.get(step_file_url, timeout=30).content
        with open(
            os.path.join(temp_dir, "initial", f"{part['part_id']}.step"), "wb"
        ) as f:
            f.write(content)
