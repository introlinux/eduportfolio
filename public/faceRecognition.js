/**
 * Servicio de Reconocimiento Facial
 * Usa face-api.js (construido sobre TensorFlow.js)
 * Se ejecuta en el navegador
 * 
 * NOTA: Este archivo se importa en el navegador, no en Node.js
 */

class FaceRecognitionService {
  constructor() {
    this.isReady = false;
    this.modelsLoaded = false;
    this.faceDetector = null;
  }

  /**
   * Inicializar los modelos de face-api.js
   * Descarga los modelos necesarios (primera carga puede ser lenta)
   */
  async initialize() {
    try {
      console.log('🔄 Cargando modelos de reconocimiento facial...');

      // Las URLs apuntan al CDN de face-api
      const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/';

      // Cargar modelos necesarios
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.load(MODEL_URL), // Cambiado a SSD para mayor precisión
        faceapi.nets.tinyFaceDetector.load(MODEL_URL),
        faceapi.nets.faceLandmark68Net.load(MODEL_URL),
        faceapi.nets.faceRecognitionNet.load(MODEL_URL),
      ]);

      this.isReady = true;
      this.modelsLoaded = true;
      console.log('✅ Modelos de reconocimiento facial cargados');

      return true;
    } catch (error) {
      console.error('❌ Error cargando modelos faciales:', error);
      this.isReady = false;
      return false;
    }
  }

  /**
   * Detectar rostro en video/imagen
   * @param {HTMLVideoElement | HTMLCanvasElement | HTMLImageElement} input 
   * @returns {Object} - {detected: boolean, descriptor: Array, confidence: number}
   */
  async detectFace(input) {
    if (!this.isReady) {
      return { detected: false, descriptor: null, confidence: 0 };
    }

    try {
      // Validar input
      if (!input) {
        console.error('❌ Input de video/imagen nulo');
        return { detected: false, descriptor: null, confidence: 0 };
      }

      // Si es video, asegurar que tenga dimensiones
      if (input.tagName === 'VIDEO' && (input.videoWidth === 0 || input.videoHeight === 0)) {
        console.warn('⚠️ Video sin dimensiones, esperando...');
        return { detected: false, descriptor: null, confidence: 0 };
      }

      // Intentar primero con SSD (más preciso)
      let detections = await faceapi
        .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
        .withFaceLandmarks()
        .withFaceDescriptors();

      // Si falla y es un video rápido, intentar con Tiny como respaldo
      if (detections.length === 0) {
        detections = await faceapi
          .detectAllFaces(input, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.3 }))
          .withFaceLandmarks()
          .withFaceDescriptors();
      }

      if (detections.length > 0) {
        // Usar el rostro más grande/confiable
        const bestDetection = detections.reduce((prev, current) => {
          return current.detection.score > prev.detection.score ? current : prev;
        });

        return {
          detected: true,
          descriptor: bestDetection.descriptor,
          confidence: bestDetection.detection.score,
          landmarks: bestDetection.landmarks,
          box: bestDetection.detection.box
        };
      } else {
        console.log('⚠️ Ningún rostro detectado en el frame actual');
      }

      return { detected: false, descriptor: null, confidence: 0 };
    } catch (error) {
      console.error('Error detectando rostro:', error);
      return { detected: false, descriptor: null, confidence: 0 };
    }
  }

  /**
   * Comparar dos descriptores faciales
   * @param {Array} descriptor1 - Descriptor del rostro 1
   * @param {Array} descriptor2 - Descriptor del rostro 2
   * @returns {number} - Distancia (0 = idéntico, mayor = diferente)
   */
  compareFaces(descriptor1, descriptor2) {
    if (!descriptor1 || !descriptor2) return Infinity;

    let sumSquaredDiff = 0;
    for (let i = 0; i < descriptor1.length; i++) {
      const diff = descriptor1[i] - descriptor2[i];
      sumSquaredDiff += diff * diff;
    }
    return Math.sqrt(sumSquaredDiff);
  }

  /**
   * Buscar estudiante por rostro
   * Compara el rostro detectado con los perfiles almacenados
   * @param {HTMLVideoElement | HTMLCanvasElement} input 
   * @returns {Promise} - {studentId, name, confidence} o null
   */
  async recognizeStudent(input) {
    const detection = await this.detectFace(input);

    if (!detection.detected) {
      return { status: 'no_face', message: 'No se detectó rostro' };
    }

    try {
      // Obtener descriptor del rostro capturado
      const capturedDescriptor = detection.descriptor;

      // Comparar con base de datos de estudiantes
      const response = await fetch('/api/faces/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor: Array.from(capturedDescriptor) })
      });

      const result = await response.json();

      if (response.ok && result.studentId) {
        return {
          status: 'recognized',
          studentId: result.studentId,
          name: result.name,
          confidence: result.confidence,
          message: `Hola, ${result.name}!`
        };
      } else {
        return {
          status: 'unknown',
          confidence: 0,
          message: 'No te reconozco. Pide ayuda a un profesor.'
        };
      }
    } catch (error) {
      console.error('Error en reconocimiento:', error);
      return { status: 'error', message: 'Error en reconocimiento facial' };
    }
  }

  /**
   * Capturar y guardar descriptor facial para nuevo alumno
   * Se necesitan 3-5 capturas para entrenar un buen perfil
   * @param {HTMLVideoElement} video 
   * @param {number} studentId 
   * @returns {Promise}
   */
  async captureTrainingImage(video, studentId) {
    const detection = await this.detectFace(video);

    if (!detection.detected) {
      return { success: false, message: 'Rostro no detectado' };
    }

    try {
      const response = await fetch('/api/faces/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: studentId,
          descriptor: Array.from(detection.descriptor),
          confidence: detection.confidence
        })
      });

      if (response.ok) {
        const result = await response.json();
        return { success: true, message: 'Rostro capturado', captureCount: result.captureCount };
      } else {
        return { success: false, message: 'Error guardando rostro' };
      }
    } catch (error) {
      console.error('Error capturando rostro:', error);
      return { success: false, message: 'Error en la captura' };
    }
  }

  /**
   * Continuamente detectar rostros en video
   * Usado para mostrar información en tiempo real
   * @param {HTMLVideoElement} video 
   * @param {Function} callback - Llamado con resultados de detección
   */
  startContinuousDetection(video, callback) {
    const detect = async () => {
      if (!this.isReady) {
        setTimeout(detect, 100);
        return;
      }

      try {
        const detection = await this.detectFace(video);
        callback(detection);
      } catch (error) {
        console.error('Error en detección continua:', error);
      }

      requestAnimationFrame(detect);
    };

    detect();
  }

  /**
   * Detener detección continua
   */
  stopContinuousDetection() {
    // Detener el requestAnimationFrame
    // Se usa cuando el usuario sale del video
  }
}

// Exportar para uso en navegador
if (typeof window !== 'undefined') {
  window.FaceRecognitionService = FaceRecognitionService;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = FaceRecognitionService;
}
