// Helper functions for adding parts with Onshape API support
// Use these when adding parts from BOM to manufacturing

/**
 * Add a part to manufacturing with Onshape API support
 * @param {Object} partData - The part data
 * @param {string} partData.name - Part name
 * @param {string} partData.requester - Who requested the part
 * @param {string} partData.project_id - Project identifier
 * @param {string} partData.workflow - Manufacturing workflow
 * @param {string} partData.material - Material type
 * @param {number} partData.quantity - Quantity needed
 * @param {Object} onshapeData - Onshape API parameters
 * @param {string} onshapeData.document_id - Onshape document ID
 * @param {string} onshapeData.wvm - 'w' for workspace, 'v' for version, 'm' for microversion
 * @param {string} onshapeData.wvmid - The workspace/version/microversion ID
 * @param {string} onshapeData.element_id - Onshape element ID
 * @param {string} onshapeData.part_id - Onshape part ID
 * @param {string} onshapeData.file_format - File format ('stl' or 'parasolid')
 */
export async function addOnshapePart(supabase, partData, onshapeData) {
    try {
        const { data, error } = await supabase
            .from('parts')
            .insert({
                name: partData.name,
                requester: partData.requester,
                project_id: partData.project_id,
                workflow: partData.workflow,
                material: partData.material,
                quantity: partData.quantity || 1,
                status: 'pending',
                // Onshape fields
                onshape_document_id: onshapeData.document_id,
                onshape_wvm: onshapeData.wvm,
                onshape_wvmid: onshapeData.wvmid,
                onshape_element_id: onshapeData.element_id,
                onshape_part_id: onshapeData.part_id,
                file_format: onshapeData.file_format,
                is_onshape_part: true,
                // Legacy fields - leave empty for Onshape parts
                file_name: '',
                file_url: ''
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error adding Onshape part:', error);
        throw error;
    }
}

/**
 * Add a traditional part (from create route) with file upload
 * @param {Object} partData - The part data
 * @param {string} fileName - Uploaded file name
 * @param {string} fileUrl - File URL in storage bucket
 */
export async function addTraditionalPart(supabase, partData, fileName, fileUrl) {
    try {
        const { data, error } = await supabase
            .from('parts')
            .insert({
                name: partData.name,
                requester: partData.requester,
                project_id: partData.project_id,
                workflow: partData.workflow,
                material: partData.material,
                quantity: partData.quantity || 1,
                status: 'pending',
                file_name: fileName,
                file_url: fileUrl,
                // Onshape fields - leave empty for traditional parts
                is_onshape_part: false
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Error adding traditional part:', error);
        throw error;
    }
}

/**
 * Helper to determine file format based on workflow
 * @param {string} workflow - The manufacturing workflow
 * @returns {string} - The appropriate file format
 */
export function getFileFormatForWorkflow(workflow) {
    switch (workflow) {
        case '3d-print':
            return 'stl';
        case 'router':
        case 'laser-cut':
        case 'mill':
        case 'lathe':
            return 'parasolid';
        default:
            return 'step'; // Fallback
    }
}
