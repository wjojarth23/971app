/**
 * Manual Part Classification Service
 * Implements rule-based classification for COTS vs Manufactured parts
 * and assigns manufacturing processes based on defined criteria
 */

class PartClassificationService {
    constructor() {
        // No API route needed for manual classification
    }

    /**
     * Classify parts using manual rules
     * @param {Array} bomData - Array of BOM items with columns: Bounding Box, Name, Description, Vendor, Material, Part Number
     * @returns {Promise<Array>} - Array of classified parts
     */
    async classifyParts(bomData) {
        try {
            return this.manualClassification(bomData);
        } catch (error) {
            console.error('Part classification error:', error);
            throw error;
        }
    }

    /**
     * Manual classification using defined rules
     */
    manualClassification(bomData) {        return bomData.map(item => {
            const name = (item.name || item.part_name || '').toLowerCase();
            const description = (item.description || '').toLowerCase();  
            const partNumber = (item.part_number || item.partNumber || '');
            const material = (item.material || '').toLowerCase();
            const vendor = (item.vendor || '').toLowerCase();
            const standardContent = (item.standard_content || item.standardContent || false);

            // COTS Classification Rules
            let isCOTS = false;
            
            // Rule 1: Material contains Belt, Acetal, or Delrin
            if (material.includes('belt') || material.includes('acetal') || material.includes('delrin')) {
                isCOTS = true;
            }
            
            // Rule 2: Name contains WCP
            if (name.includes('wcp')) {
                isCOTS = true;
            }
            
            // Rule 3: Part has a vendor
            if (vendor && vendor.trim() !== '') {
                isCOTS = true;
            }
            
            // Rule 4: Marked as standard content in BOM response
            if (standardContent === true || standardContent === 'true') {
                isCOTS = true;
            }

            let manufacturingProcess = null;
            
            // Only classify as manufactured if part number begins with capital "P"
            if (!isCOTS && partNumber.startsWith('P')) {
                // Get dimensions for classification
                const boundingBoxX = item.bounding_box_x || 0;
                const boundingBoxY = item.bounding_box_y || 0;
                const boundingBoxZ = item.bounding_box_z || 0;
                
                // Convert dimensions to inches if they're in meters
                let dimX = boundingBoxX > 1 ? boundingBoxX / 1000 * 39.3701 : boundingBoxX * 39.3701;
                let dimY = boundingBoxY > 1 ? boundingBoxY / 1000 * 39.3701 : boundingBoxY * 39.3701;
                let dimZ = boundingBoxZ > 1 ? boundingBoxZ / 1000 * 39.3701 : boundingBoxZ * 39.3701;
                
                // Sort dimensions to get min/max
                const dimensions = [dimX, dimY, dimZ].sort((a, b) => a - b);
                const minDim = dimensions[0];
                const maxDim = dimensions[2];                // Immediate assignment for 3D printing materials
                if (material.includes('nylon') || material.includes('pla') || 
                    material.includes('abs') || material.includes('petg') || 
                    material.includes('onyx')) {
                    manufacturingProcess = '3d-print';
                }else {
                    // Classify by geometry using heuristics
                    const isSheet = this.isSheetGeometry(dimensions, material);
                    const isShaft = this.isShaftGeometry(dimensions);
                    const isCubic = this.isCubicGeometry(dimensions);
                    
                    console.log(`Part "${name}" geometry analysis: sheet=${isSheet}, shaft=${isShaft}, cubic=${isCubic}, dims=[${dimensions[0].toFixed(2)}, ${dimensions[1].toFixed(2)}, ${dimensions[2].toFixed(2)}]`);
                    
                    if (isSheet) {
                        // Sheet goods classification
                        if (material.includes('acrylic') || material.includes('poly') || 
                            material.includes('wood') || material.includes('birch')) {
                            manufacturingProcess = 'laser-cut';
                        } else {
                            manufacturingProcess = 'router';
                        }
                    } else if (isShaft) {
                        manufacturingProcess = 'lathe';
                    } else if (isCubic) {
                        manufacturingProcess = 'mill';
                    } else {
                        // Default classification based on material
                        if (material.includes('acrylic') || material.includes('poly') || 
                            material.includes('wood') || material.includes('birch')) {
                            manufacturingProcess = 'laser-cut';
                        } else {
                            manufacturingProcess = 'mill';
                        }
                    }
                }
            } else if (!isCOTS) {
                // Not COTS but doesn't start with "P" - cannot be manufactured
                isCOTS = true; // Force to COTS since it doesn't meet manufactured criteria
            }            return {
                part_name: item.name || item.part_name || 'Unknown',
                classification: isCOTS ? 'COTS' : 'manufactured',
                manufacturing_process: manufacturingProcess,
                workflow_status: isCOTS ? 'purchase' : manufacturingProcess
            };
        });
    }

    /**
     * Determine if part has sheet geometry
     */
    isSheetGeometry(dimensions, material) {
        const [minDim, midDim, maxDim] = dimensions;
        
        // Sheet goods: one dimension is significantly smaller than the others
        const aspectRatio = maxDim / minDim;
        const isThick = minDim > 0.25; // More than 1/4 inch thick
        
        // Acrylic or materials with "poly" are automatically sheet goods
        if (material.includes('acrylic') || material.includes('poly')) {
            return true;
        }
        
        // Wood/Birch sheet goods
        if (material.includes('wood') || material.includes('birch')) {
            return true;
        }
        
        // Geometric heuristic: high aspect ratio and thin
        return aspectRatio > 4 && !isThick;
    }    /**
     * Determine if part has shaft geometry
     */
    isShaftGeometry(dimensions) {
        const [minDim, midDim, maxDim] = dimensions;
        
        // Shaft: one dimension much longer than the other two
        // More relaxed criteria for shaft detection
        const lengthRatio = maxDim / midDim;
        const crossSectionRatio = midDim / minDim;
        
        // A shaft is long and relatively thin
        // Length should be at least 2x the next dimension
        // Cross-section should be relatively round/square (not too flat)
        const isLongAndThin = lengthRatio >= 2;
        const hasReasonableCrossSection = crossSectionRatio <= 3;
        
        console.log(`Shaft check for dims [${minDim.toFixed(2)}, ${midDim.toFixed(2)}, ${maxDim.toFixed(2)}]: lengthRatio=${lengthRatio.toFixed(2)}, crossSectionRatio=${crossSectionRatio.toFixed(2)}, isShaft=${isLongAndThin && hasReasonableCrossSection}`);
        
        return isLongAndThin && hasReasonableCrossSection;
    }

    /**
     * Determine if part has cubic geometry
     */
    isCubicGeometry(dimensions) {
        const [minDim, midDim, maxDim] = dimensions;
        
        // Cubic: every dimension exceeds 0.5" and it's not sheet
        const allDimensionsLarge = minDim > 0.5 && midDim > 0.5 && maxDim > 0.5;
        const isSheet = this.isSheetGeometry(dimensions, '');
        
        return allDimensionsLarge && !isSheet;
    }

    /**
     * Test method - no longer needed but kept for compatibility
     */
    async testConnection() {
        return true; // Always return true since we don't need external API
    }
}

export const partClassificationService = new PartClassificationService();
