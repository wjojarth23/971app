"""
971hub Autocam Service
A FastAPI backend that integrates PenguinCAM for automatic G-code generation.

This service:
1. Receives DXF files or Onshape URLs
2. Downloads/fetches DXF content
3. Processes through PenguinCAM
4. Returns generated G-code

Deploy with: uvicorn autocam_service:app --host 0.0.0.0 --port 8080
"""

import os
import io
import json
import tempfile
import traceback
from datetime import datetime
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, asdict

import requests
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Import PenguinCAM post-processor
from frc_cam_postprocessor import FRCPostProcessor, MATERIAL_PRESETS, PostProcessorResult

app = FastAPI(
    title="971hub Autocam Service",
    description="Automated G-code generation for sheet stock parts",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to your domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Pydantic Models
# ============================================================================

class AutocamRequest(BaseModel):
    """Request to generate G-code from a DXF file"""
    part_id: int
    part_name: str
    
    # DXF source
    dxf_source: str = "upload"  # "upload", "url", "onshape"
    dxf_url: Optional[str] = None
    
    # Onshape parameters (if dxf_source == "onshape")
    onshape_document_id: Optional[str] = None
    onshape_workspace_id: Optional[str] = None
    onshape_element_id: Optional[str] = None
    onshape_part_id: Optional[str] = None
    
    # Material/profile parameters
    stock_id: Optional[str] = None
    material_preset: str = "aluminum"  # "aluminum", "plywood", "polycarbonate"
    material_thickness: float  # inches
    tool_diameter: float = 0.25  # inches
    
    # Optional override parameters
    feed_rate: Optional[float] = None
    ramp_feed_rate: Optional[float] = None
    plunge_rate: Optional[float] = None
    spindle_speed: Optional[int] = None
    ramp_angle: Optional[float] = None
    stepover_percentage: Optional[float] = None
    tab_width: Optional[float] = None
    tab_height: Optional[float] = None
    tab_spacing: Optional[float] = None


class AutocamResponse(BaseModel):
    """Response from G-code generation"""
    success: bool
    part_id: int
    gcode: Optional[str] = None
    filename: Optional[str] = None
    errors: List[str] = []
    warnings: List[str] = []
    stats: Dict[str, Any] = {}
    processing_time_ms: int = 0


class ProfileConfig(BaseModel):
    """Autocam profile configuration"""
    stock_id: str
    material_preset: str = "aluminum"
    tool_diameter: float = 0.25
    feed_rate: Optional[float] = None
    ramp_feed_rate: Optional[float] = None
    plunge_rate: Optional[float] = None
    spindle_speed: Optional[int] = None
    ramp_angle: Optional[float] = None
    stepover_percentage: Optional[float] = None
    tab_width: Optional[float] = None
    tab_height: Optional[float] = None
    tab_spacing: Optional[float] = None
    enabled: bool = True


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    version: str
    material_presets: List[str]


# ============================================================================
# Utility Functions
# ============================================================================

def fetch_dxf_from_url(url: str) -> bytes:
    """Download DXF content from a URL"""
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return response.content


def fetch_dxf_from_onshape(
    document_id: str,
    workspace_id: str,
    element_id: str,
    part_id: Optional[str] = None,
    onshape_api_base: str = None,
    access_key: str = None,
    secret_key: str = None
) -> bytes:
    """
    Export DXF from Onshape document.
    
    Uses Onshape's translation API to export the part as DXF.
    """
    import base64
    import hmac
    import hashlib
    from datetime import datetime, timezone
    import urllib.parse
    
    if not onshape_api_base:
        onshape_api_base = os.environ.get('ONSHAPE_BASE_URL', 'https://cad.onshape.com')
    
    if not access_key:
        access_key = os.environ.get('ONSHAPE_ACCESS_KEY')
    if not secret_key:
        secret_key = os.environ.get('ONSHAPE_SECRET_KEY')
    
    if not access_key or not secret_key:
        raise ValueError("Onshape API keys not configured")
    
    # Build the export endpoint
    endpoint = f"/api/v5/partstudios/d/{document_id}/w/{workspace_id}/e/{element_id}/export"
    
    # Create signed request (Onshape API key authentication)
    method = "GET"
    nonce = base64.b64encode(os.urandom(16)).decode()
    date = datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S GMT')
    
    query_params = {
        'formatName': 'DXF',
        'storeInDocument': 'false',
        'flattenAssemblies': 'true'
    }
    if part_id:
        query_params['partIds'] = part_id
    
    query_string = urllib.parse.urlencode(query_params)
    path_with_query = f"{endpoint}?{query_string}"
    
    # Build signature string
    string_to_sign = f"{method}\n{nonce}\n{date}\napplication/json\n{endpoint}\n{query_string}\n"
    
    # Create HMAC signature
    signature = base64.b64encode(
        hmac.new(
            secret_key.encode(),
            string_to_sign.lower().encode(),
            hashlib.sha256
        ).digest()
    ).decode()
    
    headers = {
        'Authorization': f'On {access_key}:HmacSHA256:{signature}',
        'Date': date,
        'On-Nonce': nonce,
        'Accept': 'application/octet-stream',
        'Content-Type': 'application/json'
    }
    
    url = f"{onshape_api_base}{path_with_query}"
    response = requests.get(url, headers=headers, timeout=120)
    
    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Onshape export failed: {response.text}"
        )
    
    return response.content


def process_dxf(
    dxf_content: bytes,
    config: AutocamRequest,
    filename: str = "part"
) -> PostProcessorResult:
    """
    Process DXF content through PenguinCAM and generate G-code.
    
    Args:
        dxf_content: Raw DXF file bytes
        config: Autocam configuration parameters
        filename: Base filename for output
        
    Returns:
        PostProcessorResult with G-code and metadata
    """
    # Write DXF to temporary file
    with tempfile.NamedTemporaryFile(mode='wb', suffix='.dxf', delete=False) as f:
        f.write(dxf_content)
        temp_dxf_path = f.name
    
    try:
        # Create post-processor
        pp = FRCPostProcessor(
            material_thickness=config.material_thickness,
            tool_diameter=config.tool_diameter,
            units="inch"
        )
        
        # Apply material preset
        if config.material_preset in MATERIAL_PRESETS:
            pp.apply_material_preset(config.material_preset)
        else:
            pp.apply_material_preset('aluminum')  # Default
        
        # Apply overrides from config
        if config.feed_rate is not None:
            pp.feed_rate = config.feed_rate
        if config.ramp_feed_rate is not None:
            pp.ramp_feed_rate = config.ramp_feed_rate
        if config.plunge_rate is not None:
            pp.plunge_rate = config.plunge_rate
        if config.spindle_speed is not None:
            pp.spindle_speed = config.spindle_speed
        if config.ramp_angle is not None:
            pp.ramp_angle = config.ramp_angle
        if config.stepover_percentage is not None:
            pp.stepover_percentage = config.stepover_percentage
        if config.tab_width is not None:
            pp.tab_width = config.tab_width
        if config.tab_height is not None:
            pp.tab_height = config.tab_height
        if config.tab_spacing is not None:
            pp.tab_spacing = config.tab_spacing
        
        # Set user name for G-code header
        pp.user_name = "971hub Autocam"
        
        # Load and process DXF
        pp.load_dxf(temp_dxf_path)
        pp.transform_coordinates('bottom-left', 0)  # Standard origin
        pp.classify_holes()
        pp.identify_perimeter_and_pockets()
        
        # Generate G-code
        safe_name = "".join(c if c.isalnum() or c in '-_' else '_' for c in config.part_name)
        result = pp.generate_gcode(suggested_filename=safe_name)
        
        return result
        
    finally:
        # Clean up temp file
        if os.path.exists(temp_dxf_path):
            os.unlink(temp_dxf_path)


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        material_presets=list(MATERIAL_PRESETS.keys())
    )


@app.get("/presets")
async def get_material_presets():
    """Get available material presets and their default parameters"""
    return {
        "presets": {
            name: {
                "name": preset["name"],
                "description": preset["description"],
                "feed_rate": preset["feed_rate"],
                "ramp_feed_rate": preset["ramp_feed_rate"],
                "plunge_rate": preset["plunge_rate"],
                "spindle_speed": preset["spindle_speed"],
                "ramp_angle": preset["ramp_angle"],
                "stepover_percentage": preset["stepover_percentage"],
                "tab_width": preset["tab_width"],
                "tab_height": preset["tab_height"]
            }
            for name, preset in MATERIAL_PRESETS.items()
        }
    }


@app.post("/generate", response_model=AutocamResponse)
async def generate_gcode(
    request: AutocamRequest,
    dxf_file: Optional[UploadFile] = File(None),
    authorization: Optional[str] = Header(None)
):
    """
    Generate G-code from a DXF file.
    
    Can receive DXF via:
    - File upload (dxf_file parameter)
    - URL (request.dxf_url)
    - Onshape API (request.onshape_* parameters)
    """
    start_time = datetime.now()
    
    try:
        # Get DXF content based on source
        dxf_content = None
        
        if request.dxf_source == "upload" and dxf_file:
            dxf_content = await dxf_file.read()
            
        elif request.dxf_source == "url" and request.dxf_url:
            dxf_content = fetch_dxf_from_url(request.dxf_url)
            
        elif request.dxf_source == "onshape":
            if not all([request.onshape_document_id, request.onshape_workspace_id, request.onshape_element_id]):
                raise HTTPException(400, "Missing Onshape parameters")
            
            dxf_content = fetch_dxf_from_onshape(
                document_id=request.onshape_document_id,
                workspace_id=request.onshape_workspace_id,
                element_id=request.onshape_element_id,
                part_id=request.onshape_part_id
            )
        else:
            raise HTTPException(400, "No DXF source provided")
        
        if not dxf_content:
            raise HTTPException(400, "Failed to obtain DXF content")
        
        # Process the DXF
        result = process_dxf(dxf_content, request, request.part_name)
        
        processing_time = int((datetime.now() - start_time).total_seconds() * 1000)
        
        return AutocamResponse(
            success=result.success,
            part_id=request.part_id,
            gcode=result.gcode,
            filename=result.filename,
            errors=result.errors,
            warnings=result.warnings,
            stats=result.stats,
            processing_time_ms=processing_time
        )
        
    except HTTPException:
        raise
    except Exception as e:
        processing_time = int((datetime.now() - start_time).total_seconds() * 1000)
        return AutocamResponse(
            success=False,
            part_id=request.part_id,
            errors=[str(e), traceback.format_exc()],
            processing_time_ms=processing_time
        )


@app.post("/generate-from-upload", response_model=AutocamResponse)
async def generate_from_upload(
    dxf_file: UploadFile = File(...),
    part_id: int = Form(...),
    part_name: str = Form(...),
    material_preset: str = Form("aluminum"),
    material_thickness: float = Form(...),
    tool_diameter: float = Form(0.25),
    stock_id: Optional[str] = Form(None),
    feed_rate: Optional[float] = Form(None),
    spindle_speed: Optional[int] = Form(None),
):
    """
    Simplified endpoint for DXF file upload.
    Use this when posting a file directly with form data.
    """
    request = AutocamRequest(
        part_id=part_id,
        part_name=part_name,
        dxf_source="upload",
        stock_id=stock_id,
        material_preset=material_preset,
        material_thickness=material_thickness,
        tool_diameter=tool_diameter,
        feed_rate=feed_rate,
        spindle_speed=spindle_speed
    )
    
    return await generate_gcode(request, dxf_file)


@app.post("/validate-dxf")
async def validate_dxf(dxf_file: UploadFile = File(...)):
    """
    Validate a DXF file without generating G-code.
    Returns information about detected geometry.
    """
    try:
        dxf_content = await dxf_file.read()
        
        # Write to temp file
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.dxf', delete=False) as f:
            f.write(dxf_content)
            temp_path = f.name
        
        try:
            # Create minimal post-processor to analyze
            pp = FRCPostProcessor(
                material_thickness=0.25,  # Dummy value for analysis
                tool_diameter=0.25,
                units="inch"
            )
            
            pp.load_dxf(temp_path)
            pp.transform_coordinates('bottom-left', 0)
            pp.classify_holes()
            pp.identify_perimeter_and_pockets()
            
            return {
                "valid": True,
                "geometry": {
                    "circles": len(pp.circles) if hasattr(pp, 'circles') else 0,
                    "holes": len(pp.holes) if hasattr(pp, 'holes') else 0,
                    "pockets": len(pp.pockets) if hasattr(pp, 'pockets') else 0,
                    "has_perimeter": bool(pp.perimeter) if hasattr(pp, 'perimeter') else False,
                    "polylines": len(pp.polylines) if hasattr(pp, 'polylines') else 0
                },
                "errors": pp.errors if hasattr(pp, 'errors') else []
            }
            
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
                
    except Exception as e:
        return {
            "valid": False,
            "error": str(e)
        }


# ============================================================================
# Main Entry Point
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.environ.get("PORT", 8080))
    host = os.environ.get("HOST", "0.0.0.0")
    
    print(f"Starting 971hub Autocam Service on {host}:{port}")
    print(f"Available material presets: {list(MATERIAL_PRESETS.keys())}")
    
    uvicorn.run(app, host=host, port=port)
