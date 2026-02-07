class DocumentProcessor {
    constructor() {
        this.isReady = false;
        this.initialized = false;
        // Configuración por defecto
        this.config = {
            blurSize: 5,
            cannyLow: 75,
            cannyHigh: 200,
            minArea: 2000,
            epsilon: 0.03
        };
    }

    /**
     * Update detection configuration
     * @param {Object} newConfig 
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('⚙️ Configuración de DocumentProcessor actualizada:', this.config);
    }

    /**
     * Initialize matrices with video dimensions (called automatically on first detection)
     */
    ensureInitialized(width, height) {
        if (typeof cv === 'undefined') {
            console.error('❌ OpenCV not loaded yet');
            this.isReady = false;
            return false;
        }

        if (this.initialized && this.lastWidth === width && this.lastHeight === height) {
            return true; // Already initialized with these dimensions
        }

        console.error(`🔧 Inicializando DocumentProcessor con dimensiones ${width}x${height}...`);

        // Clean up old matrices if reinitializing
        if (this.initialized) {
            try {
                this.gray?.delete();
                this.blurred?.delete();
                this.edges?.delete();
                this.contours?.delete();
                this.hierarchy?.delete();
            } catch (e) {
                console.warn('Error cleaning up old matrices:', e);
            }
        }

        try {
            console.error('📦 Creando matrices OpenCV...');
            // Don't pre-allocate src/dst - they're created per-frame in detectDocument
            this.gray = new cv.Mat();
            this.blurred = new cv.Mat();
            this.edges = new cv.Mat();
            this.contours = new cv.MatVector();
            this.hierarchy = new cv.Mat();

            this.lastWidth = width;
            this.lastHeight = height;
            this.initialized = true;
            this.isReady = true;

            console.error(`✅ DocumentProcessor initialized (${width}x${height})`);
            return true;
        } catch (e) {
            console.error('❌ Error initializing DocumentProcessor:', e);
            console.error('❌ Error message:', e.message);
            console.error('❌ Error stack:', e.stack);
            this.isReady = false;
            return false;
        }
    }

    /**
     * Detects a document in the video frame
     * @param {HTMLVideoElement} video 
     * @param {HTMLCanvasElement} outputCanvas - Optional, for debug drawing
     * @returns {Object|null} - Detected contour points or null
     */
    detectDocument(video, outputCanvas = null) {
        // Validate video dimensions
        if (!video || !video.videoWidth || !video.videoHeight) {
            if (!window.videoDimWarning) {
                console.error(`⚠️ Video dimensions invalid: ${video?.videoWidth}x${video?.videoHeight}`);
                window.videoDimWarning = true;
            }
            return null;
        }

        // Auto-initialize with video dimensions on first call
        if (!this.ensureInitialized(video.videoWidth, video.videoHeight)) {
            return null;
        }

        try {
            // Reutilizar o crear canvas oculto para captura (más compatible que VideoCapture)
            if (!this.tempCanvas) {
                this.tempCanvas = document.createElement('canvas');
                this.tempCtx = this.tempCanvas.getContext('2d', { willReadFrequently: true });
            }

            // Solo redimensionar si las dimensiones han cambiado para no resetear el contexto
            if (this.tempCanvas.width !== video.videoWidth || this.tempCanvas.height !== video.videoHeight) {
                this.tempCanvas.width = video.videoWidth;
                this.tempCanvas.height = video.videoHeight;
            }

            this.tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

            // Capture frame from canvas
            let src = cv.imread(this.tempCanvas);

            // Pre-processing
            // 1. Convert to Grayscale
            cv.cvtColor(src, this.gray, cv.COLOR_RGBA2GRAY, 0);

            // 1b. Mejorar CONTRASTE (Ecualización o Normalización)
            // Esto ayudará con el problema del "recuadro negro" al asegurar que los bordes sean visibles
            cv.normalize(this.gray, this.gray, 0, 255, cv.NORM_MINMAX);

            // 2. Gaussian Blur to reduce noise
            let ksize = new cv.Size(this.config.blurSize, this.config.blurSize);
            cv.GaussianBlur(this.gray, this.blurred, ksize, 0, 0, cv.BORDER_DEFAULT);

            // 3. Canny Edge Detection
            cv.Canny(this.blurred, this.edges, this.config.cannyLow, this.config.cannyHigh);

            // DEBUG: Mostrar bordes en canvas de diagnóstico si se proporciona
            if (outputCanvas) {
                try {
                    // Sincronizar dimensiones internas del canvas
                    if (outputCanvas.width !== 160) outputCanvas.width = 160;
                    if (outputCanvas.height !== 120) outputCanvas.height = 120;

                    let dsize = new cv.Size(160, 120);
                    let dst = new cv.Mat();
                    cv.resize(this.edges, dst, dsize, 0, 0, cv.INTER_AREA);

                    // Usar el elemento directamente en lugar del ID string
                    cv.imshow(outputCanvas, dst);

                    // Diagnóstico básico de brillo medio para descartar "frames negros"
                    if (!window.lastBrightLog || Date.now() - window.lastBrightLog > 5000) {
                        let mean = cv.mean(this.gray)[0];
                        console.log(`📊 Diagnóstico Debug: Brillo medio=${Math.round(mean)}, Config Canny=${this.config.cannyLow}/${this.config.cannyHigh}`);
                        window.lastBrightLog = Date.now();
                    }

                    dst.delete();
                } catch (e) {
                    if (!window.lastDebugDrawError || Date.now() - window.lastDebugDrawError > 5000) {
                        console.warn('⚠️ Error dibujando debug OpenCV:', e);
                        window.lastDebugDrawError = Date.now();
                    }
                }
            }


            // 4. Find Contours
            cv.findContours(this.edges, this.contours, this.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            const numContours = this.contours.size();

            // Debug log (throttled)
            if (!window.lastContourLog || Date.now() - window.lastContourLog > 3000) {
                console.log(`🔍 OpenCV Pipeline: Encontrados ${numContours} contornos`);
                window.lastContourLog = Date.now();
            }

            // 5. Find Largest Quadrilateral
            let maxArea = 0;
            let maxContour = null;
            let approxContour = new cv.Mat();
            let quadCount = 0;

            for (let i = 0; i < numContours; ++i) {
                let contour = this.contours.get(i);
                let area = cv.contourArea(contour);

                // Filter small noise (reduced from 5000 to 2000 to detect napkins/smaller papers)
                if (area < this.config.minArea) continue;

                // Approximate contour to polygon
                let peri = cv.arcLength(contour, true);
                // Epsilon 0.02 is standard, but 0.03 or 0.04 is more robust for imperfect rectangles
                cv.approxPolyDP(contour, approxContour, this.config.epsilon * peri, true);

                // Check if it has 4 points (quadrilateral) and is the largest found so far
                if (approxContour.rows === 4 && area > maxArea) {
                    quadCount++;
                    maxArea = area;
                    // Clone because approxContour is reused/freed
                    if (maxContour) maxContour.delete();
                    maxContour = approxContour.clone();
                }
            }

            // Debug: Report findings
            if (!window.lastQuadLog || Date.now() - window.lastQuadLog > 3000) {
                if (quadCount > 0) {
                    console.log(`📐 Encontrados ${quadCount} cuadriláteros. Mayor área: ${Math.round(maxArea)}px²`);
                } else if (numContours > 0) {
                    console.log(`⚠️ Se encontraron ${numContours} contornos pero ninguno es cuadrilátero`);
                } else {
                    console.log(`❌ No se encontraron contornos (¿poco contraste?)`);
                }
                window.lastQuadLog = Date.now();
            }

            approxContour.delete();

            // DEBUG: Draw result if canvas provided
            if (outputCanvas && maxContour) {
                let ctx = outputCanvas.getContext('2d');
                ctx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);

                // Draw contour
                // Note: Drawing directly with CV is easier for debug
                // Create a separate Mat for drawing to avoid messing up src
                // But for performance, maybe just pass points to JS?
                // Let's draw with OpenCV for now for robust visualization

                // We need to convert Mat points to array for JS drawing or use cv.drawContours
                // Using cv.drawContours is robust but requires a Mat destination.
                // Let's return the points so the main app can draw a nice overlay using standard Canvas API
            }

            if (maxContour) {
                // Extract points
                const points = [];
                for (let i = 0; i < maxContour.rows; i++) {
                    points.push({
                        x: maxContour.data32S[i * 2],
                        y: maxContour.data32S[i * 2 + 1]
                    });
                }

                maxContour.delete();
                src.delete();
                return { points, area: maxArea };
            }

            src.delete();
            return null;

        } catch (e) {
            console.error('Error in detectDocument:', e);
            return null;
        }
    }
}
