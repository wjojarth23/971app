/**
 * Manual Part Classification Service
 * Implements rule-based classification for COTS vs Manufactured parts
 * and assigns manufacturing processes based on defined criteria
 */

const ENABLE_CEMO = true;

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
                // Per new rules: never use bounding boxes for classification.
                // Apply deterministic rules based on name and material.

                // Normalize checking strings
                const nameContains = (s) => name.includes(s);
                const materialContains = (s) => material.includes(s);

                // 3D printing materials (immediate assignment)
                if (materialContains('nylon') || materialContains('pla') || materialContains('abs') || materialContains('petg') || materialContains('onyx')) {
                    manufacturingProcess = '3d-print';
                } else if (nameContains('shaft') || nameContains('standoff')) {
                    // Everything named shaft or standoff => lathe
                    manufacturingProcess = 'lathe';
                } else if (materialContains('birch') || materialContains('polycarbonate') || nameContains('plate') || nameContains('tube')) {
                    // Birch or Polycarbonate auto router, name contains plate or tube => router
                    manufacturingProcess = 'router';
                } else {
                    // Default to mill for anything else
                    manufacturingProcess = 'mill';
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
