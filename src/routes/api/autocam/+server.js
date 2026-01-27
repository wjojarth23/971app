import { json } from '@sveltejs/kit';
import { PUBLIC_AUTOCAM_API_URL } from '$env/static/public';
import { DISABLE_AUTOCAM } from '$lib/config/autocam.js';

const AUTOCAM_BASE_URL = PUBLIC_AUTOCAM_API_URL || 'http://localhost:8080';

/**
 * GET /api/autocam - Get autocam service status and presets
 */
export async function GET({ url }) {
  const action = url.searchParams.get('action') || 'health';
  
  try {
    if (DISABLE_AUTOCAM) {
      return json({ success: false, error: 'Autocam disabled by config' }, { status: 503 });
    }
    if (action === 'health') {
      const response = await fetch(`${AUTOCAM_BASE_URL}/health`);
      if (!response.ok) {
        return json({ error: 'Autocam service unavailable' }, { status: 503 });
      }
      return json(await response.json());
    }
    
    if (action === 'presets') {
      const response = await fetch(`${AUTOCAM_BASE_URL}/presets`);
      if (!response.ok) {
        return json({ error: 'Failed to fetch presets' }, { status: response.status });
      }
      return json(await response.json());
    }
    
    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Autocam API error:', error);
    return json({ error: 'Autocam service connection failed', details: error.message }, { status: 503 });
  }
}

/**
 * POST /api/autocam - Generate G-code or perform autocam actions
 */
export async function POST({ request, url }) {
  const action = url.searchParams.get('action') || 'generate';
  
  try {
    if (DISABLE_AUTOCAM) {
      return json({ success: false, error: 'Autocam disabled by config' }, { status: 503 });
    }
    if (action === 'generate') {
      // Forward the request to autocam service
      const body = await request.json();
      
      const response = await fetch(`${AUTOCAM_BASE_URL}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      });
      
      const result = await response.json();
      return json(result, { status: response.ok ? 200 : 400 });
    }
    
    if (action === 'generate-from-upload') {
      // Handle multipart form data for DXF uploads
      const formData = await request.formData();
      
      const response = await fetch(`${AUTOCAM_BASE_URL}/generate-from-upload`, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      return json(result, { status: response.ok ? 200 : 400 });
    }
    
    if (action === 'validate') {
      // Validate DXF without generating G-code
      const formData = await request.formData();
      
      const response = await fetch(`${AUTOCAM_BASE_URL}/validate-dxf`, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      return json(result, { status: response.ok ? 200 : 400 });
    }
    
    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Autocam API error:', error);
    return json({ 
      success: false,
      error: 'Autocam processing failed', 
      details: error.message 
    }, { status: 500 });
  }
}
