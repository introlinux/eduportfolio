// ==================== FASE 3: SISTEMA DE CABINA DE FOTOS ====================
// Variables Globales
let currentSubject = null;
let currentView = 'subjectSelector';
let photoBoothState = 'WAITING_FACE'; // Estados: WAITING_FACE, GREETING, COUNTDOWN, FLASH, SAVING
let faceRecognitionService = null;
let isProcessingVideo = false;
let lastFaceDetectionTime = 0;
let greetingTimer = null;
let countdownTimer = null;
let isTrainingMode = false;
let trainingCount = 0;
let pendingPhotos = [];
let currentPendingIndex = 0;
let isQuickMode = false;

// Estado de la galería
let currentGalleryCaptures = [];
let currentLightboxIndex = -1;

const API_URL = 'http://localhost:3000/api';

// ==================== OPENCV (No se usa en tiempo real en Fase 3) ====================
let cvReady = false;

function onOpenCvReady() {
  cvReady = true;
  console.log('✅ OpenCV.js cargado (disponible para futuras fases)');
}

function onOpenCvError() {
  console.warn('⚠️ OpenCV.js no se pudo cargar (no es crítico en Fase 3)');
}

// ==================== INICIALIZACIÓN ====================
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Inicializando EduPortfolio Fase 3 - Cabina de Fotos');
  initAIServices();
  setupKeyboardNavigation();
  showView('subjectSelector');
});

// ==================== SERVICIOS DE IA ====================
async function initAIServices() {
  try {
    console.log('🤖 Inicializando reconocimiento facial...');
    faceRecognitionService = new FaceRecognitionService();
    const faceReady = await faceRecognitionService.initialize();

    if (faceReady) {
      console.log('✅ Reconocimiento facial listo');
      showNotification('✅ Sistema de reconocimiento facial activado', 'success');
    } else {
      console.warn('⚠️ Reconocimiento facial no disponible');
    }
  } catch (error) {
    console.error('Error inicializando IA:', error);
    showNotification('⚠️ Error en servicios de IA', 'error');
  }
}

// ==================== NAVEGACIÓN ENTRE VISTAS ====================
function showView(viewName) {
  // Ocultar todas las vistas
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // Mostrar la vista seleccionada
  const targetView = document.getElementById(viewName);
  if (targetView) {
    targetView.classList.add('active');
    currentView = viewName;
    console.log(`📱 Vista activa: ${viewName}`);
  }

  // Inicializar según la vista
  if (viewName === 'captureView') {
    initWebcam();
  } else if (viewName === 'teacherView') {
    loadStudents();
    updatePendingCount();
  } else if (viewName === 'galleryView') {
    loadStudents(); // Carga alumnos en el select de la galería
    updateGallery();
  }
}

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Tecla ESC: Comportamiento contextual
    if (e.key === 'Escape') {
      const lightbox = document.getElementById('lightbox');
      if (lightbox && lightbox.style.display === 'flex') {
        closeLightbox();
        return;
      }

      if (currentView === 'captureView') {
        stopWebcam();
        showView('subjectSelector');
      } else if (currentView === 'teacherView' || currentView === 'galleryView') {
        showView('subjectSelector');
      } else if (currentView !== 'subjectSelector') {
        stopWebcam();
        showView('subjectSelector');
      }
    }

    // Flechas: Navegación de Galería
    const lightbox = document.getElementById('lightbox');
    if (lightbox && lightbox.style.display === 'flex') {
      if (e.key === 'ArrowRight') {
        e.preventDefault(); // Evitar scroll
        nextLightbox();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault(); // Evitar scroll
        prevLightbox();
      }
      return; // Bloquear otros atajos si el lightbox está abierto
    }

    // P: Vista de profesor
    if (e.key === 'p' || e.key === 'P') {
      if (currentView !== 'teacherView') {
        stopWebcam();
        showView('teacherView');
      }
    }

    // G: Vista de galería
    if ((e.key === 'g' || e.key === 'G') && (currentView === 'subjectSelector' || currentView === 'captureView')) {
      stopWebcam();
      showView('galleryView');
    }

    // R: Alternar Modo Rápido (solo en vista de captura)
    if ((e.key === 'r' || e.key === 'R') && currentView === 'captureView') {
      toggleQuickMode();
    }

    // ESPACIO: Capturar en Modo Rápido
    if (e.key === ' ' && currentView === 'captureView' && isQuickMode) {
      e.preventDefault(); // Evitar scroll
      captureQuickPhoto();
    }
  });
}

// ==================== SELECTOR DE ASIGNATURA ====================
function selectSubject(subject) {
  currentSubject = subject;
  console.log(`📚 Asignatura seleccionada: ${subject}`);

  // Actualizar indicador
  const indicator = document.getElementById('currentSubject');
  if (indicator) {
    indicator.textContent = subject;
  }

  // Cambiar a vista de captura
  showView('captureView');
}

// ==================== WEBCAM ====================
async function initWebcam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920 },  // Intentar 1080p o superior
        height: { ideal: 1080 },
        facingMode: 'user'
      },
      audio: false
    });

    const video = document.getElementById('webcam');
    video.srcObject = stream;

    video.onloadedmetadata = () => {
      video.play();
      console.log(`📹 Webcam iniciada: ${video.videoWidth}x${video.videoHeight}`);

      // Iniciar bucle de detección facial
      isProcessingVideo = true;
      photoBoothState = 'WAITING_FACE';
      requestAnimationFrame(processVideoFrame);
    };

  } catch (error) {
    console.error('❌ Error al acceder a la webcam:', error);
    showNotification('No se pudo acceder a la webcam. Verifica los permisos.', 'error');
  }
}

function stopWebcam() {
  const video = document.getElementById('webcam');
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  isProcessingVideo = false;
  photoBoothState = 'WAITING_FACE';
  isQuickMode = false;
  const indicator = document.getElementById('quickModeIndicator');
  if (indicator) indicator.style.display = 'none';
  clearTimeout(greetingTimer);
  clearTimeout(countdownTimer);
}

// Webcam para entrenamiento
async function initTrainingWebcam() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' }, // Resolución menor para preview
      audio: false
    });

    const video = document.getElementById('trainingWebcam');
    if (video) {
      video.srcObject = stream;

      // Esperar a que el video esté realmente reproduciéndose
      return new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play().then(() => {
            console.log(`📹 Cámara de entrenamiento lista: ${video.videoWidth}x${video.videoHeight}`);
            resolve();
          });
        };
      });
    }
  } catch (error) {
    console.error('❌ Error al acceder a webcam de entrenamiento:', error);
    showNotification('Error al iniciar cámara. Verifica permisos.', 'error');
  }
}

function stopTrainingWebcam() {
  const video = document.getElementById('trainingWebcam');
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
}

// ==================== BUCLE DE PROCESAMIENTO DE VIDEO ====================
async function processVideoFrame() {
  if (!isProcessingVideo) return;

  try {
    const video = document.getElementById('webcam');
    if (!video || !video.videoWidth) {
      requestAnimationFrame(processVideoFrame);
      return;
    }

    // Solo detectar caras si estamos esperando y NO estamos en modo rápido
    if (photoBoothState === 'WAITING_FACE' && !isQuickMode && faceRecognitionService && faceRecognitionService.isReady) {
      const now = Date.now();

      // Limitar frecuencia de detección (cada 500ms)
      if (now - lastFaceDetectionTime > 500) {
        lastFaceDetectionTime = now;

        const result = await faceRecognitionService.recognizeStudent(video);

        if (result.status === 'recognized') {
          console.log(`👤 Alumno reconocido: ${result.name}`);
          startGreetingSequence(result.name, result.studentId);
        }
      }
    }

  } catch (error) {
    console.error('Error en bucle de video:', error);
  }

  requestAnimationFrame(processVideoFrame);
}

// ==================== SECUENCIA DE CAPTURA ====================
function startGreetingSequence(studentName, studentId) {
  // Cambiar estado
  photoBoothState = 'GREETING';

  // Mostrar saludo
  showMessage(`¡Hola, ${studentName}!<br>¿Quieres guardar tu trabajo?<br>Ponte en posición`);

  // Esperar 2 segundos antes de iniciar cuenta atrás
  greetingTimer = setTimeout(() => {
    startCountdown(studentName, studentId);
  }, 2000);
}

function startCountdown(studentName, studentId) {
  photoBoothState = 'COUNTDOWN';
  hideMessage();

  let count = 3;
  const countdownEl = document.getElementById('countdownOverlay');
  const numberEl = document.getElementById('countdownNumber');

  function showNumber() {
    if (count > 0) {
      // Mostrar número
      numberEl.textContent = count;
      countdownEl.classList.add('show');

      // Ocultar después de 800ms
      setTimeout(() => {
        countdownEl.classList.remove('show');
      }, 800);

      count--;
      countdownTimer = setTimeout(showNumber, 1000);
    } else {
      // Cuenta atrás terminada → Flash y captura
      triggerFlashAndCapture(studentName, studentId);
    }
  }

  showNumber();
}

async function triggerFlashAndCapture(studentName, studentId) {
  photoBoothState = 'FLASH';

  // Efecto flash
  const flashEl = document.getElementById('flashOverlay');
  flashEl.classList.add('flash');

  // Capturar foto en el momento del flash
  setTimeout(async () => {
    const photoData = await captureHighResPhoto();
    flashEl.classList.remove('flash');

    if (photoData) {
      await savePhoto(photoData, studentName, studentId);
    } else {
      showNotification('Error al capturar la foto', 'error');
      photoBoothState = 'WAITING_FACE';
    }
  }, 100);
}

async function captureHighResPhoto() {
  try {
    const video = document.getElementById('webcam');
    const canvas = document.getElementById('canvas');

    // Usar la resolución completa del video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convertir a JPEG de alta calidad
    const photoData = canvas.toDataURL('image/jpeg', 0.95);
    console.log(`📸 Foto capturada: ${canvas.width}x${canvas.height}`);

    return photoData;
  } catch (error) {
    console.error('Error capturando foto:', error);
    return null;
  }
}

async function savePhoto(photoData, studentName, studentId) {
  photoBoothState = 'SAVING';
  showMessage('Guardando...');

  try {
    // Verificar identidad en la foto capturada
    const canvas = document.getElementById('canvas');
    const verificationResult = await faceRecognitionService.recognizeStudent(canvas);

    let finalStudentId = studentId;
    let finalStudentName = studentName;

    // Si la cara en la foto es diferente, usar la nueva identidad
    if (verificationResult.status === 'recognized' && verificationResult.studentId !== studentId) {
      console.log(`⚠️ Cambio de alumno detectado: ${studentName} → ${verificationResult.name}`);
      finalStudentId = verificationResult.studentId;
      finalStudentName = verificationResult.name;
    }

    // Guardar en el servidor
    const response = await fetch(`${API_URL}/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: finalStudentId,
        subject: currentSubject,
        imageData: photoData,
        method: 'photo-booth',
        confidence: verificationResult.confidence || 95,
        isClassified: true
      })
    });

    const result = await response.json();

    if (response.ok) {
      console.log(`💾 Foto guardada: ${result.id}`);
      showMessage(`✅ ¡Guardado!<br>${currentSubject} - ${finalStudentName}`);

      // Volver a esperar después de 3 segundos
      setTimeout(() => {
        hideMessage();
        photoBoothState = 'WAITING_FACE';
      }, 3000);
    } else {
      throw new Error(result.error || 'Error al guardar');
    }

  } catch (error) {
    console.error('Error guardando foto:', error);
    showNotification('Error al guardar la foto', 'error');
    photoBoothState = 'WAITING_FACE';
  }
}

// ==================== MODO RÁPIDO ====================

function toggleQuickMode() {
  isQuickMode = !isQuickMode;
  const indicator = document.getElementById('quickModeIndicator');

  if (isQuickMode) {
    console.log('⚡ Modo Rápido Activado');
    if (indicator) indicator.style.display = 'block';
    photoBoothState = 'QUICK_MODE';
    hideMessage();
    clearTimeout(greetingTimer);
    clearTimeout(countdownTimer);
    showNotification('⚡ Modo Rápido: Pulsa ESPACIO para capturar', 'info');
  } else {
    console.log('⚡ Modo Rápido Desactivado');
    if (indicator) indicator.style.display = 'none';
    photoBoothState = 'WAITING_FACE';
    showNotification('🤖 Modo IA Activado: Esperando rostro...', 'info');
  }
}

async function captureQuickPhoto() {
  // Efecto flash
  const flashEl = document.getElementById('flashOverlay');
  flashEl.classList.add('flash');

  setTimeout(async () => {
    const photoData = await captureHighResPhoto();
    flashEl.classList.remove('flash');

    if (photoData) {
      try {
        const response = await fetch(`${API_URL}/system/temp-capture`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: currentSubject,
            imageData: photoData
          })
        });

        if (response.ok) {
          showMessage('⚡ ¡Capturado!', 1000);
          // Ocultar mensaje después de un segundo
          setTimeout(hideMessage, 1000);
        } else {
          showNotification('Error en captura rápida', 'error');
        }
      } catch (e) {
        console.error(e);
        showNotification('Error de conexión', 'error');
      }
    }
  }, 100);
}

// ==================== UI HELPERS ====================
function showMessage(html) {
  const overlay = document.getElementById('messageOverlay');
  const text = document.getElementById('messageText');

  if (overlay && text) {
    text.innerHTML = html;
    overlay.classList.add('show');
  }
}

function hideMessage() {
  const overlay = document.getElementById('messageOverlay');
  if (overlay) {
    overlay.classList.remove('show');
  }
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// ==================== GESTIÓN DE ALUMNOS (VISTA PROFESOR) ====================
async function loadStudents() {
  try {
    const response = await fetch(`${API_URL}/students`);
    const students = await response.json();

    // Actualizar lista en vista de profesor
    const studentsList = document.getElementById('studentsList');
    if (studentsList) {
      studentsList.innerHTML = students
        .map(s => `
          <div class="student-item">
            <span>👶 ${s.name}</span>
            <small>#${s.id}</small>
            <button class="delete-student-btn" onclick="deleteStudent(${s.id})">🗑️</button>
          </div>
        `)
        .join('');
    }

    // Actualizar dropdown de entrenamiento
    const trainingSelect = document.getElementById('selectedStudentTraining');
    if (trainingSelect) {
      trainingSelect.innerHTML =
        '<option value="">-- Selecciona un alumno --</option>' +
        students.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

      // Evento al cambiar selección para cargar info del perfil
      trainingSelect.onchange = (e) => {
        const studentId = e.target.value;
        updateStudentProfileUI(studentId);
      };

      // También poblar el dropdown del wizard de mantenimiento
      const wizardSelect = document.getElementById('wizardStudentSelect');
      if (wizardSelect) {
        wizardSelect.innerHTML = trainingSelect.innerHTML;
      }

      // Y el selector de la Galería
      const gallerySelect = document.getElementById('galleryStudentSelect');
      if (gallerySelect) {
        const savedValue = gallerySelect.value;
        gallerySelect.innerHTML = trainingSelect.innerHTML;
        // Restaurar valor o poner el primero
        if (savedValue) gallerySelect.value = savedValue;
      }
    }

    console.log(`✅ ${students.length} alumnos cargados`);
  } catch (error) {
    console.error('Error cargando alumnos:', error);
    showNotification('Error al cargar alumnos', 'error');
  }
}

async function updateStudentProfileUI(studentId) {
  const trainingSelect = document.getElementById('selectedStudentTraining');
  if (!trainingSelect) return;

  // Buscar o crear div de info
  let infoDiv = document.getElementById('studentProfileInfo');

  if (!infoDiv) {
    infoDiv = document.createElement('div');
    infoDiv.id = 'studentProfileInfo';
    infoDiv.style.marginTop = '10px';
    infoDiv.style.marginBottom = '10px';
    infoDiv.style.padding = '10px';
    infoDiv.style.background = 'rgba(0,0,0,0.2)';
    infoDiv.style.borderRadius = '5px';
    trainingSelect.parentNode.insertBefore(infoDiv, trainingSelect.nextSibling);
  }

  if (studentId) {
    try {
      const response = await fetch(`${API_URL}/faces/${studentId}`);
      const data = await response.json();

      if (data.hasProfile) {
        infoDiv.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span>✅ Perfil facial activo (${data.descriptorCount || 1} imágenes)</span>
            <button onclick="resetFaceProfile(${studentId})" style="padding: 5px 10px; font-size: 0.8em; background: #f44336; border-color: #d32f2f;">Resetear Perfil</button>
          </div>
        `;
      } else {
        infoDiv.innerHTML = '⚠️ Sin perfil facial entrenado';
      }
    } catch (e) {
      console.error(e);
      infoDiv.innerHTML = 'Error cargando info de perfil';
    }
  } else {
    infoDiv.innerHTML = '';
  }
}

async function resetFaceProfile(studentId) {
  if (!confirm('¿Estás seguro de resetear el perfil facial? Se borrarán todos los datos de entrenamiento de este alumno.')) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/faces/${studentId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      showNotification('✅ Perfil facial reseteado. Puedes entrenar de nuevo.', 'success');
      showNotification('✅ Perfil facial reseteado. Puedes entrenar de nuevo.', 'success');
      // Recargar info
      updateStudentProfileUI(studentId);
    } else {
      showNotification('Error al resetear perfil', 'error');
    }
  } catch (error) {
    console.error(error);
    showNotification('Error de conexión', 'error');
  }
}

async function addStudent() {
  const nameInput = document.getElementById('studentName');
  const name = nameInput.value.trim();

  if (!name) {
    showNotification('Por favor, ingresa un nombre', 'error');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    const result = await response.json();

    if (response.ok) {
      showNotification(`✅ ${name} añadido correctamente`, 'success');
      nameInput.value = '';
      await loadStudents();
    } else {
      showNotification(`Error: ${result.error}`, 'error');
    }
  } catch (error) {
    console.error('Error añadiendo alumno:', error);
    showNotification('Error al añadir alumno', 'error');
  }
}

async function deleteStudent(studentId) {
  if (!confirm('¿Estás seguro de que quieres eliminar este alumno?')) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/students/${studentId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      showNotification('🗑️ Alumno eliminado correctamente', 'success');
      await loadStudents();
    } else {
      showNotification('Error al eliminar alumno', 'error');
    }
  } catch (error) {
    console.error('Error eliminando alumno:', error);
    showNotification('Error al eliminar alumno', 'error');
  }
}

// ==================== ENTRENAMIENTO FACIAL ====================
async function startTrainingMode() {
  const select = document.getElementById('selectedStudentTraining');
  const studentId = select.value;

  if (!studentId) {
    showNotification('Por favor, selecciona un alumno', 'error');
    return;
  }

  if (!faceRecognitionService || !faceRecognitionService.isReady) {
    showNotification('Servicio de reconocimiento facial no disponible', 'error');
    return;
  }

  isTrainingMode = true;
  trainingCount = 0;

  const trainingSection = document.getElementById('trainingSection');
  if (trainingSection) {
    trainingSection.style.display = 'block';
  }

  document.getElementById('trainingCount').textContent = '0';
  showNotification('📸 Modo entrenamiento activado', 'info');

  // Iniciar cámara específica para entrenamiento
  await initTrainingWebcam();
}

function stopTrainingMode() {
  isTrainingMode = false;
  trainingCount = 0;

  const trainingSection = document.getElementById('trainingSection');
  if (trainingSection) {
    trainingSection.style.display = 'none';
  }

  stopTrainingWebcam();

  // Actualizar UI del perfil
  const select = document.getElementById('selectedStudentTraining');
  if (select && select.value) {
    updateStudentProfileUI(select.value);
  }

  showNotification('✅ Entrenamiento completado', 'success');
}

async function captureTrainingFace() {
  if (!isTrainingMode) {
    showNotification('Inicia el modo entrenamiento primero', 'error');
    return;
  }

  const select = document.getElementById('selectedStudentTraining');
  const studentId = select.value;

  if (!studentId) {
    showNotification('Selecciona un alumno', 'error');
    return;
  }

  if (trainingCount >= 5) {
    showNotification('Máximo de imágenes alcanzado (5/5)', 'success');
    return;
  }

  try {
    const video = document.getElementById('trainingWebcam'); // Usar la cámara de entrenamiento

    // Pequeño retardo si acaba de arrancar
    if (video.readyState < 2) {
      showNotification('Iniciando cámara...', 'info');
      await new Promise(r => setTimeout(r, 1000));
    }

    console.log('🔍 Buscando rostro en el feed de entrenamiento...');
    const result = await faceRecognitionService.detectFace(video);

    if (!result.detected) {
      console.warn('⚠️ No se detectó rostro en la imagen actual.');
      showNotification('❌ No se detectó rostro. Acércate más y mantente quieto.', 'error');
      return;
    }

    console.log(`✅ Rostro detectado con confianza: ${Math.round(result.confidence * 100)}%`);

    const response = await fetch(`${API_URL}/faces/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: parseInt(studentId),
        descriptor: Array.from(result.descriptor)
      })
    });

    if (response.ok) {
      trainingCount++;
      document.getElementById('trainingCount').textContent = trainingCount;

      if (trainingCount >= 5) {
        showNotification(`✅ Entrenamiento completado: ${trainingCount} imágenes`, 'success');
        setTimeout(() => stopTrainingMode(), 2000);
      } else {
        showNotification(`📸 Imagen ${trainingCount}/5 capturada`, 'success');
      }
    } else {
      showNotification('Error guardando rostro', 'error');
    }
  } catch (error) {
    console.error('Error capturando rostro:', error);
    showNotification('Error en captura de entrenamiento', 'error');
  }
}

// ==================== FUNCIONES DE MANTENIMIENTO ====================

async function syncPortfolios() {
  showNotification('🔄 Sincronizando carpetas...', 'info');
  try {
    const response = await fetch(`${API_URL}/system/sync`, { method: 'POST' });
    const result = await response.json();
    if (response.ok) {
      showNotification(`✅ Sincronización completada: ${result.studentsCreated} alumnos y ${result.capturesCreated} fotos añadidas`, 'success');
      await loadStudents();
    } else {
      showNotification(`Error: ${result.error}`, 'error');
    }
  } catch (e) {
    console.error(e);
    showNotification('Error de conexión', 'error');
  }
}

async function resetSystem(mode) {
  let warning = "";
  if (mode === 'photos') {
    warning = "⚠️ ¿ESTÁS SEGURO? Se borrarán TODOS los trabajos (fotos) del disco duro y de la base de datos.\n\nLos alumnos y sus datos faciales NO se borrarán.";
  } else if (mode === 'students') {
    warning = "⚠️ ¿ESTÁS SEGURO? Se borrarán TODOS los alumnos y sus datos faciales de la base de datos.\n\nLos archivos de fotos en el disco duro NO se borrarán.";
  }

  const confirm1 = confirm(warning);
  if (!confirm1) return;

  const confirm2 = confirm("ÚLTIMA ADVERTENCIA: Esta acción es permanente. ¿Deseas continuar?");
  if (!confirm2) return;

  try {
    const response = await fetch(`${API_URL}/system/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: mode })
    });

    if (response.ok) {
      showNotification(`✅ Reset (${mode}) completado correctamente.`, 'success');
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showNotification('Error al realizar el reset', 'error');
    }
  } catch (e) {
    console.error(e);
    showNotification('Error de conexión', 'error');
  }
}

async function updatePendingCount() {
  try {
    const response = await fetch(`${API_URL}/system/pending`);
    const files = await response.json();
    const countEl = document.getElementById('pendingCount');
    if (countEl) countEl.textContent = files.length;
    pendingPhotos = files;
    return files.length;
  } catch (e) {
    console.error(e);
    return 0;
  }
}

// ==================== WIZARD DE FOTOS EXTERNAS ====================

async function openExternalPhotosWizard() {
  const count = await updatePendingCount();
  if (count === 0) {
    showNotification('No hay fotos pendientes en la carpeta _temporal_', 'info');
    return;
  }

  currentPendingIndex = 0;
  document.getElementById('externalPhotosWizard').style.display = 'flex';
  showNextPendingPhoto();
}

function closeExternalPhotosWizard() {
  document.getElementById('externalPhotosWizard').style.display = 'none';
}

async function showNextPendingPhoto() {
  if (currentPendingIndex >= pendingPhotos.length) {
    showNotification('✅ ¡Todas las fotos procesadas!', 'success');
    closeExternalPhotosWizard();
    updatePendingCount();
    return;
  }

  const file = pendingPhotos[currentPendingIndex];
  const img = document.getElementById('wizardImage');
  const statusEl = document.getElementById('wizardRecognitionStatus');
  const studentSelect = document.getElementById('wizardStudentSelect');
  const subjectSelect = document.getElementById('wizardSubjectSelect');

  img.src = file.url;
  statusEl.textContent = 'Analizando rostro...';
  studentSelect.value = '';

  // Detectar asignatura desde el nombre del archivo (para Modo Rápido)
  // El formato es Asignatura_Timestamp.jpg
  const fileName = file.name;
  const subjects = ['Matematicas', 'Lengua', 'Ciencias', 'Ingles', 'Artistica'];
  for (const s of subjects) {
    if (fileName.startsWith(s)) {
      subjectSelect.value = s;
      break;
    }
  }

  // Esperar a que la imagen cargue para analizarla
  img.onload = async () => {
    if (!faceRecognitionService || !faceRecognitionService.isReady) {
      statusEl.textContent = 'IA no lista para reconocimiento';
      return;
    }

    const result = await faceRecognitionService.recognizeStudent(img);
    if (result.status === 'recognized') {
      statusEl.textContent = `👤 Reconocido: ${result.name} (${Math.round(result.confidence * 100)}%)`;
      studentSelect.value = result.studentId;
    } else {
      statusEl.textContent = '❓ Rostro no reconocido o no detectado';
    }
  };
}

async function moveExternalPhoto() {
  const studentId = document.getElementById('wizardStudentSelect').value;
  const subject = document.getElementById('wizardSubjectSelect').value;
  const file = pendingPhotos[currentPendingIndex];

  if (!studentId) {
    alert('Por favor, selecciona un alumno');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/system/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        studentId: parseInt(studentId),
        subject: subject
      })
    });

    if (response.ok) {
      showNotification('✅ Foto movida y registrada', 'success');
      currentPendingIndex++;
      showNextPendingPhoto();
    } else {
      showNotification('Error al mover foto', 'error');
    }
  } catch (e) {
    console.error(e);
    showNotification('Error de conexión', 'error');
  }
}

function skipExternalPhoto() {
  currentPendingIndex++;
  showNextPendingPhoto();
}

// ==================== LÓGICA DE GALERÍA ====================

async function updateGallery() {
  const studentId = document.getElementById('galleryStudentSelect').value;
  const subject = document.getElementById('gallerySubjectSelect').value;
  const grid = document.getElementById('galleryGrid');

  if (!studentId) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 50px; opacity: 0.5;">Selecciona un alumno para ver sus trabajos</p>';
    currentGalleryCaptures = [];
    return;
  }

  grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 50px;">Cargando trabajos...</p>';

  try {
    const response = await fetch(`${API_URL}/captures/${studentId}`);
    let captures = await response.json();

    // Filtrar por asignatura si no es "Todas"
    if (subject !== 'Todas') {
      captures = captures.filter(c => c.subject === subject);
    }

    currentGalleryCaptures = captures; // Guardar para navegación

    if (captures.length === 0) {
      grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; padding: 50px; opacity: 0.5;">No hay trabajos registrados en ${subject === 'Todas' ? 'ninguna asignatura' : subject}</p>`;
      return;
    }

    grid.innerHTML = '';
    captures.forEach((cap, index) => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      const imgUrl = `/portfolios/${cap.imagePath}`;

      card.innerHTML = `
        <img src="${imgUrl}" alt="Trabajo">
        <div class="gallery-card-info">
          <div class="gallery-card-subject">${cap.subject}</div>
          <div class="gallery-card-date">${new Date(cap.timestamp).toLocaleString()}</div>
        </div>
      `;

      card.onclick = () => openLightbox(index);
      grid.appendChild(card);
    });

  } catch (e) {
    console.error('Error cargando galería:', e);
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #ff6b6b;">Error al cargar los trabajos</p>';
  }
}

function openLightbox(index) {
  if (index < 0 || index >= currentGalleryCaptures.length) return;

  currentLightboxIndex = index;
  const cap = currentGalleryCaptures[index];
  const modal = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  const captionEl = document.getElementById('lightboxCaption');

  const imgUrl = `/portfolios/${cap.imagePath}`;
  const caption = `${cap.subject} - ${new Date(cap.timestamp).toLocaleDateString()}`;

  modal.style.display = 'flex';
  img.src = imgUrl;
  captionEl.textContent = caption;
}

function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
  currentLightboxIndex = -1;
}

function nextLightbox(e) {
  if (e) e.stopPropagation();
  if (currentLightboxIndex < currentGalleryCaptures.length - 1) {
    openLightbox(currentLightboxIndex + 1);
  }
}

function prevLightbox(e) {
  if (e) e.stopPropagation();
  if (currentLightboxIndex > 0) {
    openLightbox(currentLightboxIndex - 1);
  }
}

// ==================== NAVEGACIÓN DE VISTAS ====================
function exitTeacherView() {
  showView('subjectSelector');
}

function exitGalleryView() {
  showView('subjectSelector');
}

console.log('✅ EduPortfolio Fase 3 - Cabina de Fotos cargado');
