import { PUBLIC_ONSHAPE_ACCESS_KEY, PUBLIC_ONSHAPE_SECRET_KEY, PUBLIC_ONSHAPE_BASE_URL } from '$env/static/public';
import { json } from '@sveltejs/kit';

const ONSHAPE_BASE_URL = PUBLIC_ONSHAPE_BASE_URL || 'https://frc971.onshape.com';

/* ── SVG Conversion Helper Functions ─────────────────────────────── */
async function getBoundingBox(documentId, wvm, wvmId, elementId, partId) {
  const url = `${ONSHAPE_BASE_URL}/api/v5/parts/d/${documentId}/${wvm}/${wvmId}/e/${elementId}/partid/${partId}/boundingboxes`;
  const response = await fetch(url, { headers: getBasicAuth() });
  if (!response.ok) {
    throw new Error(`Failed to get bounding box: ${response.status}`);
  }
  const data = await response.json();
  return data;
}

async function getTessellatedEdges(documentId, wvm, wvmId, elementId, partId) {
  const url = `${ONSHAPE_BASE_URL}/api/v5/parts/d/${documentId}/${wvm}/${wvmId}/e/${elementId}/partid/${partId}/tessellatededges`;
  const response = await fetch(url, { headers: getBasicAuth() });
  if (!response.ok) {
    throw new Error(`Failed to get tessellated edges: ${response.status}`);
  }
  const data = await response.json();
  return data;
}

function project(point, plane) {
  const scale = 1000 * 2.83465; // meters to millimeters to points (1mm = 2.83465pt)
  if (plane === 'XY') return { x: point.x * scale, y: -point.y * scale };
  if (plane === 'XZ') return { x: point.x * scale, y: -point.z * scale };
  if (plane === 'YZ') return { x: point.y * scale, y: -point.z * scale };
}

function generateSVG(edgesData, plane) {
  const margin = 28.3465; // 10mm margin converted to points (10 * 2.83465)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const paths = [];

  console.log('Processing tessellated edges data:', edgesData);

  // Check if we have edges in the response - they're nested under bodies[0].edges
  let edges = [];
  if (edgesData && edgesData.bodies && edgesData.bodies.length > 0 && edgesData.bodies[0].edges) {
    edges = edgesData.bodies[0].edges;
    console.log(`Found ${edges.length} edges in bodies[0].edges`);
  } else if (edgesData && edgesData.edges) {
    edges = edgesData.edges;
    console.log(`Found ${edges.length} edges in direct edges property`);
  }

  if (edges.length === 0) {
    console.log('No edges found in tessellated data');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="100" height="100" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <text x="50" y="50" text-anchor="middle" font-size="12" fill="red">No edges found</text>
</svg>`;
  }
  // Process each edge
  for (const edge of edges) {
    console.log('Processing edge:', edge);
    
    if (edge.tessellation && edge.tessellation.length > 0) {
      console.log(`Edge has ${edge.tessellation.length} tessellation points`);
      // Use tessellation points instead of vertices
      const pathData = [];
      
      for (let i = 0; i < edge.tessellation.length; i += 3) {
        // Tessellation data comes as [x, y, z, x, y, z, ...]
        const point = {
          x: edge.tessellation[i],
          y: edge.tessellation[i + 1],
          z: edge.tessellation[i + 2]        };
        
        const projected = project(point, plane);
        console.log(`Point ${point.x}, ${point.y}, ${point.z} projected to ${projected?.x}, ${projected?.y} on plane ${plane}`);
        
        if (projected) {
          minX = Math.min(minX, projected.x);
          minY = Math.min(minY, projected.y);
          maxX = Math.max(maxX, projected.x);
          maxY = Math.max(maxY, projected.y);
          
          if (pathData.length === 0) {
            pathData.push(`M ${projected.x} ${projected.y}`);
          } else {
            pathData.push(`L ${projected.x} ${projected.y}`);
          }        }
      }
        console.log(`Generated path data for edge: ${pathData.join(' ')}`);
      if (pathData.length > 0) {
        paths.push(`<path d="${pathData.join(' ')}" stroke="red" stroke-width="0.01" fill="none" />`);
      }
    } else {      console.log('Edge has no tessellation data:', edge);
      
      if (edge.vertices && edge.vertices.length >= 2) {
        // Fallback to vertices if tessellation is not available
        const pathData = [];
        
        for (let i = 0; i < edge.vertices.length; i++) {
          const vertex = edge.vertices[i];
          const projected = project(vertex, plane);
          
          if (projected) {
            minX = Math.min(minX, projected.x);
            minY = Math.min(minY, projected.y);
            maxX = Math.max(maxX, projected.x);
            maxY = Math.max(maxY, projected.y);
            
            if (i === 0) {
              pathData.push(`M ${projected.x} ${projected.y}`);
            } else {
              pathData.push(`L ${projected.x} ${projected.y}`);
            }
          }        }
        
        if (pathData.length > 0) {
          paths.push(`<path d="${pathData.join(' ')}" stroke="red" stroke-width="0.01" fill="none" />`);
        }
      }
    }
  }

  // Ensure we have valid bounds
  if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {    console.log('No valid bounds found, using default');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="100pt" height="100pt" viewBox="0 0 283.465 283.465" xmlns="http://www.w3.org/2000/svg">
  <text x="141.7325" y="141.7325" text-anchor="middle" font-size="34" fill="red">No valid geometry</text>
</svg>`;
  }

  const width = maxX - minX + 2 * margin;
  const height = maxY - minY + 2 * margin;
  
  console.log(`Generated SVG bounds: width=${width}, height=${height}, paths=${paths.length}`);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}pt" height="${height}pt" viewBox="${minX - margin} ${minY - margin} ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description>
        <dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Laser Cut Part</dc:title>
        <dc:description xmlns:dc="http://purl.org/dc/elements/1.1/">Generated from Onshape CAD model for laser cutting</dc:description>
      </rdf:Description>
    </rdf:RDF>
  </metadata>
${paths.join('\n')}
</svg>`;
  
  return svg;
}

async function handleSVGConversion(documentId, wvm, wvmId, elementId, partId) {
  try {
    console.log(`Starting SVG conversion for part ${partId}`);
    
    // Get bounding box to determine the best projection plane
    console.log('Fetching bounding box...');
    const boundingBoxData = await getBoundingBox(documentId, wvm, wvmId, elementId, partId);
    console.log('Bounding box data:', boundingBoxData);
    
    // Get tessellated edges
    console.log('Fetching tessellated edges...');
    const edgesData = await getTessellatedEdges(documentId, wvm, wvmId, elementId, partId);
    console.log('Tessellated edges data structure:', {
      hasEdges: !!edgesData.edges,
      edgeCount: edgesData.edges ? edgesData.edges.length : 0,
      firstEdge: edgesData.edges && edgesData.edges.length > 0 ? edgesData.edges[0] : null
    });
    
    // Determine best plane based on bounding box dimensions
    let plane = 'XY'; // Default to XY plane
    if (boundingBoxData && boundingBoxData.bodies && boundingBoxData.bodies.length > 0) {
      const bb = boundingBoxData.bodies[0];
      const xSize = Math.abs(bb.highX - bb.lowX);
      const ySize = Math.abs(bb.highY - bb.lowY);
      const zSize = Math.abs(bb.highZ - bb.lowZ);
      
      console.log(`Bounding box dimensions: X=${xSize}, Y=${ySize}, Z=${zSize}`);
      
      // Choose the plane with the largest area
      const xyArea = xSize * ySize;
      const xzArea = xSize * zSize;
      const yzArea = ySize * zSize;
      
      console.log(`Projection areas: XY=${xyArea}, XZ=${xzArea}, YZ=${yzArea}`);
      
      if (xzArea > xyArea && xzArea > yzArea) {
        plane = 'XZ';
      } else if (yzArea > xyArea && yzArea > xzArea) {
        plane = 'YZ';
      }
    }
    
    console.log(`Using projection plane: ${plane}`);
    
    // Generate SVG
    const svg = generateSVG(edgesData, plane);
    
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Content-Disposition': `attachment; filename="${partId}.svg"`,
        'Content-Length': Buffer.byteLength(svg, 'utf8').toString()
      }
    });
    
  } catch (error) {
    console.error('Error in SVG conversion:', error);
    return json({ error: 'Internal server error during SVG conversion', details: error.message }, { status: 500 });
  }
}

/* ── Auth helpers (add or replace) ─────────────────────────────── */

function getBasicAuth() {
  const cred = btoa(`${PUBLIC_ONSHAPE_ACCESS_KEY}:${PUBLIC_ONSHAPE_SECRET_KEY}`);
  return { 'Authorization': `Basic ${cred}` };
}

/* ── Translation Handler (for both STL and STEP) ─────────────────────────────── */
async function handlePartTranslation(documentId, wvm, wvmId, elementId, partId, format) {
    try {
        console.log(`Starting ${format} translation for part ${partId}`);
        
        // 1) Initiate translation using the PartStudio endpoint (not Assembly)
        const exportResp = await fetch(
            `${ONSHAPE_BASE_URL}/api/v11/partstudios/d/${documentId}/${wvm}/${wvmId}/e/${elementId}/translations`,
            {
                method: 'POST',
                headers: {
                    ...getBasicAuth(),
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    formatName: format,
                    partIds: partId,         // single-part string
                    onePartPerDoc: true,     // important for STEP files
                    storeInDocument: false   // external file
                })
            }
        );

        if (!exportResp.ok) {
            const errorText = await exportResp.text();
            console.error(`${format} translation initiation failed: ${exportResp.status} - ${errorText}`);
            return json({ error: `${format} translation initiation failed: ${exportResp.status}`, details: errorText }, { status: exportResp.status });
        }

        const { id: translationId } = await exportResp.json();
        console.log(`${format} Translation ID:`, translationId);

        // 2) Poll until DONE (with timeout)
        let state = 'ACTIVE';
        let attempts = 0;
        const maxAttempts = 60; // 60 seconds max
        let foreignId;
        
        while (state === 'ACTIVE' && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
            attempts++;
            
            const statusResp = await fetch(
                `${ONSHAPE_BASE_URL}/api/v11/translations/${translationId}`,
                { 
                    headers: {
                        ...getBasicAuth(),
                        'Accept': 'application/json'
                    }
                }
            );
            
            if (!statusResp.ok) {
                const errorText = await statusResp.text();
                console.error(`Translation status check failed: ${statusResp.status} - ${errorText}`);
                return json({ error: `Translation status check failed: ${statusResp.status}`, details: errorText }, { status: statusResp.status });
            }
            
            const statusData = await statusResp.json();
            state = statusData.requestState;
            foreignId = (statusData.resultExternalDataIds || [])[0];
            console.log(`Translation state (attempt ${attempts}):`, state);
        }
        
        if (attempts >= maxAttempts) {
            return json({ error: `${format} translation timeout - translation took too long` }, { status: 408 });
        }

        if (state !== 'DONE') {
            return json({ error: `${format} translation failed with state: ${state}` }, { status: 500 });
        }

        if (!foreignId) {
            return json({ error: 'No external data ID found in translation result' }, { status: 500 });
        }

        console.log(`${format} translation complete, data ID =`, foreignId);

        // 3) Download the file
        const downloadResp = await fetch(
            `${ONSHAPE_BASE_URL}/api/v11/documents/d/${documentId}/externaldata/${foreignId}`,
            { 
                headers: {
                    ...getBasicAuth(),
                    'Accept': 'application/octet-stream'
                }
            }
        );
        
        if (!downloadResp.ok) {
            const errorText = await downloadResp.text();
            return json({ error: `Failed to download ${format} file: ${downloadResp.status}`, details: errorText }, { status: downloadResp.status });
        }
        
        const buffer = await downloadResp.arrayBuffer();
        
        const fileExt = format === 'STL' ? 'stl' : 'step';
        const contentType = format === 'STL' ? 'application/sla' : 'application/step';
        
        return new Response(buffer, {
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename="${partId}.${fileExt}"`,
                'Content-Length': buffer.byteLength.toString()
            }
        });
        
    } catch (error) {
        console.error(`Error in ${format} translation:`, error);
        return json({ error: `Internal server error during ${format} translation`, details: error.message }, { status: 500 });
    }
}

export async function GET({ url }) {
    const action = url.searchParams.get('action');
    const documentId = url.searchParams.get('documentId');
    const workspaceId = url.searchParams.get('workspaceId');
    const elementId = url.searchParams.get('elementId');

    console.log('Onshape API Request:', {
        action,
        documentId,
        workspaceId,
        elementId,
        allParams: Object.fromEntries(url.searchParams.entries())
    });

    if (!action || !documentId) {
        return json({ error: 'Missing required parameters' }, { status: 400 });
    }

    try {
        let apiPath;
        
  switch (action) {
            case 'document-info':
                apiPath = `/api/v11/documents/${documentId}`;
                break;
            case 'versions':
                apiPath = `/api/v11/documents/d/${documentId}/versions`;
                break;
            case 'version-details':
                const versionId = url.searchParams.get('versionId');
                if (!versionId) {
                    return json({ error: 'Missing versionId for version details request' }, { status: 400 });
                }
                apiPath = `/api/v11/documents/d/${documentId}/v/${versionId}`;
                break;
            case 'assembly-info':
                if (!workspaceId || !elementId) {
                    return json({ error: 'Missing workspaceId or elementId for assembly info request' }, { status: 400 });
                }
                apiPath = `/api/v11/assemblies/d/${documentId}/w/${workspaceId}/e/${elementId}`;
                break;
            case 'assembly-bom':
                if (!workspaceId || !elementId) {
                    return json({ error: 'Missing workspaceId or elementId for BOM request' }, { status: 400 });
                }
                const wvm = url.searchParams.get('wvm') || 'w';
                const wvmid = url.searchParams.get('wvmid') || workspaceId;
                const indented = url.searchParams.get('indented') || 'false';
                apiPath = `/api/v11/assemblies/d/${documentId}/${wvm}/${wvmid}/e/${elementId}/bom?indented=${indented}`;
                break;
            case 'part-bounding-box':
                if (!elementId) {
                    return json({ error: 'Missing elementId for bounding box request' }, { status: 400 });
                }
                const partWvm = url.searchParams.get('wvm') || 'w';
                const partWvmId = url.searchParams.get('wvmId') || workspaceId;
                const partId = url.searchParams.get('partId');
                if (!partId) {
                    return json({ error: 'Missing partId for bounding box request' }, { status: 400 });
                }
                apiPath = `/api/v11/parts/d/${documentId}/${partWvm}/${partWvmId}/e/${elementId}/partid/${partId}/boundingboxes`;
                break;
            case 'download-stl':
                if (!elementId) {
                    return json({ error: 'Missing elementId for STL download' }, { status: 400 });
                }
                const stlWvm = url.searchParams.get('wvm') || 'w';
                const stlWvmId = url.searchParams.get('wvmId');
                const stlPartId = url.searchParams.get('partId');
                if (!stlPartId) {
                    return json({ error: 'Missing partId for STL download' }, { status: 400 });
                }
                if (!stlWvmId) {
                    return json({ error: 'Missing wvmId for STL download' }, { status: 400 });
                }
                
                // Use the new translation workflow for STL files
                return await handlePartTranslation(documentId, stlWvm, stlWvmId, elementId, stlPartId, 'STL');
            case 'translate-part':
                if (!elementId) {
                    return json({ error: 'Missing elementId for part translation' }, { status: 400 });
                }
                const transWvm = url.searchParams.get('wvm') || 'w';
                const transWvmId = url.searchParams.get('wvmId');
                const transPartId = url.searchParams.get('partId');
                const format = url.searchParams.get('format') || 'STEP';
                
                if (!transPartId) {
                    return json({ error: 'Missing partId for part translation' }, { status: 400 });
                }
                if (!transWvmId) {
                    return json({ error: 'Missing wvmId for part translation' }, { status: 400 });
                }
                
                // Use the new translation workflow for both STL and STEP
                return await handlePartTranslation(documentId, transWvm, transWvmId, elementId, transPartId, format);
            case 'convert-to-svg':
                if (!elementId) {
                    return json({ error: 'Missing elementId for SVG conversion' }, { status: 400 });
                }
                const svgWvm = url.searchParams.get('wvm') || 'w';
                const svgWvmId = url.searchParams.get('wvmId');
                const svgPartId = url.searchParams.get('partId');
                
                if (!svgPartId) {
                    return json({ error: 'Missing partId for SVG conversion' }, { status: 400 });
                }
                if (!svgWvmId) {
                    return json({ error: 'Missing wvmId for SVG conversion' }, { status: 400 });
                }
                
                // Use the SVG conversion workflow
                return await handleSVGConversion(documentId, svgWvm, svgWvmId, elementId, svgPartId);
            case 'download-step':
                if (!elementId) {
                    return json({ error: 'Missing elementId for STEP download' }, { status: 400 });
                }
                const stepWvm = url.searchParams.get('wvm') || 'w';
                const stepWvmId = url.searchParams.get('wvmId');
                const stepPartId = url.searchParams.get('partId');
                if (!stepPartId) {
                    return json({ error: 'Missing partId for STEP download' }, { status: 400 });
                }
                if (!stepWvmId) {
                    return json({ error: 'Missing wvmId for STEP download' }, { status: 400 });
                }
                
                // Use the new translation workflow for STEP files
                return await handlePartTranslation(documentId, stepWvm, stepWvmId, elementId, stepPartId, 'STEP');
      case 'translate-drawing': {
        const drawWvm = url.searchParams.get('wvm') || 'w';
        const drawWvmId = url.searchParams.get('wvmId');
        if (!elementId) {
          return json({ error: 'Missing elementId for drawing translation' }, { status: 400 });
        }
        if (!drawWvmId) {
          return json({ error: 'Missing wvmId for drawing translation' }, { status: 400 });
        }

        // Initiate drawing translation to PDF
        const createResp = await fetch(
          `${ONSHAPE_BASE_URL}/api/v11/drawings/d/${documentId}/${drawWvm}/${drawWvmId}/e/${elementId}/translations`,
          {
            method: 'POST',
            headers: {
              ...getBasicAuth(),
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify({
              formatName: 'PDF',
              storeInDocument: false
            })
          }
        );
        if (!createResp.ok) {
          const t = await createResp.text();
          return json({ error: `Drawing translation init failed: ${createResp.status}`, details: t }, { status: createResp.status });
        }
        const { id: drawTransId } = await createResp.json();

        // Poll translation status
        let state = 'ACTIVE';
        let attempts = 0;
        const maxAttempts = 60;
        let externalId;
        while (state === 'ACTIVE' && attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, 2000));
          attempts++;
          const st = await fetch(`${ONSHAPE_BASE_URL}/api/v11/translations/${drawTransId}`, { headers: { ...getBasicAuth(), 'Accept': 'application/json' } });
          if (!st.ok) {
            const et = await st.text();
            return json({ error: `Drawing translation status failed: ${st.status}`, details: et }, { status: st.status });
          }
          const sd = await st.json();
          state = sd.requestState;
          externalId = (sd.resultExternalDataIds || [])[0];
        }
        if (attempts >= maxAttempts) {
          return json({ error: 'Drawing translation timeout' }, { status: 408 });
        }
        if (state !== 'DONE' || !externalId) {
          return json({ error: `Drawing translation failed: ${state}` }, { status: 500 });
        }

        // Download PDF
        const dl = await fetch(`${ONSHAPE_BASE_URL}/api/v11/documents/d/${documentId}/externaldata/${externalId}`,
          { headers: { ...getBasicAuth(), 'Accept': 'application/pdf' } });
        if (!dl.ok) {
          const et = await dl.text();
          return json({ error: `PDF download failed: ${dl.status}`, details: et }, { status: dl.status });
        }
        const buf = await dl.arrayBuffer();
        return new Response(buf, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="drawing.pdf"',
            'Content-Length': buf.byteLength.toString()
          }
        });
      }
            case 'check-translation':
                const translationId = url.searchParams.get('translationId');
                if (!translationId) {
                    return json({ error: 'Missing translationId for translation check' }, { status: 400 });
                }
                apiPath = `/api/v11/translations/${translationId}`;
                break;
            case 'download-translation-result':
                const resultTranslationId = url.searchParams.get('translationId');
                if (!resultTranslationId) {
                    return json({ error: 'Missing translationId for result download' }, { status: 400 });
                }
                
                // Get the external data ID from translation result
                const translationResp = await fetch(`${ONSHAPE_BASE_URL}/api/v11/translations/${resultTranslationId}`, {
                    headers: getBasicAuth()
                });
                if (!translationResp.ok) {
                    return json({ error: 'Failed to get translation result' }, { status: translationResp.status });
                }
                const translationData = await translationResp.json();
                const externalDataId = translationData.resultExternalDataIds?.[0];
                if (!externalDataId) {
                    return json({ error: 'No external data ID found in translation result' }, { status: 400 });
                }
                
                apiPath = `/api/v11/documents/d/${documentId}/externaldata/${externalDataId}`;
                break;
      default:
        return json({ error: 'Invalid action. Available actions: document-info, versions, version-details, assembly-info, assembly-bom, part-bounding-box, download-stl, download-step, translate-part, convert-to-svg, translate-drawing, check-translation, download-translation-result' }, { status: 400 });
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        // Build the full URL we're going to request
        const fullUrl = `${ONSHAPE_BASE_URL}${apiPath}`;
        const isFileDownload = action === 'download-stl' || action === 'download-translation-result';

        const headers = isFileDownload
        ? {
            ...getBasicAuth(),
            'Accept': 'application/vnd.onshape.v1+octet-stream'
          }
        : {
            ...getBasicAuth(),
            'Content-Type': 'application/json'
          };

        console.log('Using authentication type: Basic Auth');

        const response = await fetch(fullUrl, {
            method: 'GET',
            headers: headers,
            signal: controller.signal,
            redirect: 'manual'
        });

        clearTimeout(timeoutId);

        // Handle binary file downloads with proper 307 redirect handling
        if (action === 'download-stl' || action === 'download-translation-result') {
            console.log(`Download response status: ${response.status}`);
            console.log('Download response headers:', Object.fromEntries(response.headers.entries()));
            
            if (response.status === 307 && response.headers.get('location')) {
                const s3Url = response.headers.get('location');
                console.log('Following redirect to S3:', s3Url);
                
                const s3Response = await fetch(s3Url, {
                    method: 'GET',
                    headers: getBasicAuth(),
                    signal: controller.signal
                });
                
                if (!s3Response.ok) {
                    const errorText = await s3Response.text();
                    console.error(`S3 download error: ${s3Response.status} - ${errorText}`);
                    return json({ error: `S3 download error: ${s3Response.status}`, details: errorText }, { status: s3Response.status });
                }
                
                const buffer = await s3Response.arrayBuffer();
                const fileExt = action === 'download-stl' ? 'stl' : 'step';
                
                return new Response(buffer, {
                    headers: {
                        'Content-Type': action === 'download-stl' ? 'application/sla' : 'application/step',
                        'Content-Disposition': `attachment; filename="part.${fileExt}"`,
                        'Content-Length': buffer.byteLength.toString()
                    }
                });
            } else if (response.status === 200) {
                const buffer = await response.arrayBuffer();
                const fileExt = action === 'download-stl' ? 'stl' : 'step';
                
                return new Response(buffer, {
                    headers: {
                        'Content-Type': action === 'download-stl' ? 'application/sla' : 'application/step',
                        'Content-Disposition': `attachment; filename="part.${fileExt}"`,
                        'Content-Length': buffer.byteLength.toString()
                    }
                });
            } else {
                const errorText = await response.text();
                console.error(`OnShape download API error: ${response.status} - ${errorText}`);
                return json({ error: `OnShape download API error: ${response.status}`, details: errorText }, { status: response.status });
            }
        }

        // Handle regular API responses (non-downloads)
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`OnShape API error: ${response.status} - ${errorText}`);
            return json({ error: `OnShape API error: ${response.status}`, details: errorText }, { status: response.status });
        }

        const data = await response.json();
        return json(data);
    } catch (error) {
        console.error('Error calling OnShape API:', error);
        
        if (error.name === 'AbortError') {
            return json({ error: 'OnShape API timeout - request took too long' }, { status: 408 });
        }
        
        return json({ error: 'Internal server error', details: error.message }, { status: 500 });
    }
}