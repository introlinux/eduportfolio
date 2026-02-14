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
let previewAutoSaveTimer = null;
let manualSelectedStudent = null; // Store manually selected student

// Estado de la galería
let currentGalleryCaptures = [];
let currentLightboxIndex = -1;
let lightboxZoomLevel = 1; // Track zoom state: 1 = normal, 2 = zoomed
let lightboxPanState = { x: 0, y: 0, isDragging: false, startX: 0, startY: 0 };

// Estado de selección múltiple
let selectedEvidences = new Set(); // IDs de evidencias seleccionadas
let selectionMode = false; // true cuando está activo el modo selección
let lastSelectedIndex = -1; // Para selección con Shift

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
  loadSubjects(); // Cargar asignaturas al inicio
  loadStudents(); // Cargar estudiantes al inicio (para selectores manuales)
  loadCourses(); // Cargar curso activo
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
    loadCameras().then(() => initWebcam(document.getElementById('webcamFeed')));
  } else if (viewName === 'teacherView') {
    loadStudents();
    loadSubjects(); // Cargar asignaturas en el panel docente
    loadSystemStats(); // Cargar estadísticas en el panel docente
    updatePendingCount();
    loadSyncInfo();
    loadCourses(); // Cargar lista de cursos
  } else if (viewName === 'galleryView') {
    loadStudents(); // Carga estudiantes en el select de la galería
    loadSubjects(); // Carga asignaturas en el select de la galería
    updateGallery();
  }
}

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Ignorar atajos de teclado cuando el usuario está escribiendo en un input o textarea
    const activeElement = document.activeElement;
    const isTyping = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    );

    // Si está escribiendo, solo permitir ESC para cerrar modales
    if (isTyping && e.key !== 'Escape') {
      return; // No ejecutar shortcuts
    }

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

    // P: Vista de docente
    if (e.key === 'p' || e.key === 'P') {
      if (currentView !== 'teacherView') {
        stopWebcam();
        showView('teacherView');
      }
    }

    // G: Vista de galería
    if ((e.key === 'g' || e.key === 'G') && (currentView === 'subjectSelector' || currentView === 'captureView')) {
      stopWebcam();
      // Resetear filtros a "Todos" al abrir con G
      const studentSelect = document.getElementById('galleryStudentSelect');
      const subjectSelect = document.getElementById('gallerySubjectSelect');
      if (studentSelect) studentSelect.value = ''; // Asumiendo que '' es "Todos" o el default
      if (subjectSelect) subjectSelect.value = 'Todas';

      showView('galleryView');
    }

    // R: Alternar Modo Rápido (solo en vista de captura)
    if ((e.key === 'r' || e.key === 'R') && currentView === 'captureView') {
      toggleQuickMode();
    }

    // ESPACIO: Capturar
    if (e.key === ' ' && currentView === 'captureView') {
      // Modo Rápido
      if (isQuickMode) {
        e.preventDefault();
        captureQuickPhoto();
      }
      // Modo Manual (Selección de estudiante)
      else if (photoBoothState === 'MANUAL_READY' && manualSelectedStudent) {
        e.preventDefault();
        startCountdown(manualSelectedStudent.name, manualSelectedStudent.id);
      }
    }
  });
}

// ==================== SELECTOR DE ASIGNATURA ====================
// Variable para almacenar todas las asignaturas
let allSubjects = [];

async function loadSubjects() {
  try {
    const response = await fetch(`${API_URL}/subjects`);
    allSubjects = await response.json();

    renderSubjectSelector();
    renderSubjectsManagement();
    populateSubjectDropdowns();

    console.log(`📚 ${allSubjects.length} asignaturas cargadas`);
  } catch (error) {
    console.error('Error cargando asignaturas:', error);
    showNotification('Error al cargar asignaturas', 'error');
  }
}

function renderSubjectSelector() {
  const grid = document.getElementById('subjectsGrid');
  if (!grid) return;

  if (allSubjects.length === 0) {
    grid.innerHTML = '<p>No hay asignaturas configuradas. Ve al panel docente para añadirlas.</p>';
    return;
  }

  grid.innerHTML = allSubjects.map(subject => `
    <button class="subject-btn" 
            style="border-color: ${subject.color || '#2196F3'}"
            onclick="selectSubject(${JSON.stringify(subject).replace(/"/g, '&quot;')})">
      <span class="subject-icon">${subject.icon || '📚'}</span>
      <span class="subject-name">${subject.name}</span>
    </button>
  `).join('');
}

function renderSubjectsManagement() {
  const list = document.getElementById('subjectsList');
  if (!list) return;

  list.innerHTML = allSubjects.map(s => `
    <div class="subject-item">
      <div class="subject-info">
        <div class="subject-icon-small" style="color: ${s.color || '#fff'}">${s.icon || '📚'}</div>
        <div>
          <div style="font-weight: 600;">${s.name} ${s.is_default ? '<span title="Predeterminada">⭐</span>' : ''}</div>
          <div style="font-size: 0.8em; opacity: 0.6;">Color: ${s.color || '#2196F3'}</div>
        </div>
      </div>
      <button title="Eliminar Asignatura" class="delete-student-btn" onclick="deleteSubject(${s.id})">🗑️</button>
    </div>
  `).join('');
}

function populateSubjectDropdowns() {
  // Wizard de fotos externas
  const wizardSelect = document.getElementById('wizardSubjectSelect');
  if (wizardSelect) {
    wizardSelect.innerHTML = allSubjects.map(s => `
      <option value="${s.id}">${s.name}</option>
    `).join('');
  }

  // Galería
  const gallerySelect = document.getElementById('gallerySubjectSelect');
  if (gallerySelect) {
    const currentValue = gallerySelect.value;
    gallerySelect.innerHTML = '<option value="Todas">Todas las asignaturas</option>' +
      allSubjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    gallerySelect.value = currentValue || 'Todas';
  }
}

async function addSubject() {
  const nameInput = document.getElementById('newSubjectName');
  const iconInput = document.getElementById('newSubjectIcon');
  const colorInput = document.getElementById('newSubjectColor');

  const name = nameInput.value.trim();
  const icon = iconInput.value;
  const color = colorInput.value;

  if (!name) {
    showNotification('El nombre es obligatorio', 'error');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/subjects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon, color })
    });

    if (response.ok) {
      showNotification('✅ Asignatura añadida', 'success');
      nameInput.value = '';
      // Resetear al valor por defecto
      selectEmoji('📚');
      await loadSubjects();
    } else {
      const error = await response.json();
      showNotification(`Error: ${error.error}`, 'error');
    }
  } catch (error) {
    console.error('Error añadiendo asignatura:', error);
  }
}

// ==================== LÓGICA DE EMOJI PICKER ====================
const RECOMMENDED_EMOJIS = ['📚', '🧮', '🧪', '🇬🇧', '🎨', '🎵', '⚽', '📝', '💻', '🗺️', '📜', '📖', '❓', '🧬', '📐', '🎭', '🧪', '🌍', '⚖️'];

function toggleEmojiPicker(event) {
  event.stopPropagation();
  const picker = document.getElementById('emojiPicker');
  const isHidden = picker.style.display === 'none';

  // Cerrar si ya está abierto
  if (!isHidden) {
    picker.style.display = 'none';
    return;
  }

  // Inicializar si está vacío o no contiene opciones
  if (picker.querySelectorAll('.emoji-option').length === 0) {
    picker.innerHTML = RECOMMENDED_EMOJIS.map(emoji => `
      <div class="emoji-option" onclick="selectEmoji('${emoji}')">${emoji}</div>
    `).join('');
  }

  picker.style.display = 'grid';

  // Cerrar al hacer click fuera
  const closePicker = (e) => {
    if (!picker.contains(e.target) && e.target.id !== 'emojiPickerBtn') {
      picker.style.display = 'none';
      document.removeEventListener('click', closePicker);
    }
  };
  document.addEventListener('click', closePicker);
}

function selectEmoji(emoji) {
  const btn = document.getElementById('emojiPickerBtn');
  const input = document.getElementById('newSubjectIcon');
  const picker = document.getElementById('emojiPicker');

  if (btn) btn.textContent = emoji;
  if (input) input.value = emoji;
  if (picker) picker.style.display = 'none';
}

async function deleteSubject(id) {
  if (!confirm('¿Estás seguro? Las fotos asociadas NO se borrarán, pero la asignatura desaparecerá.')) return;

  try {
    const response = await fetch(`${API_URL}/subjects/${id}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      showNotification('🗑️ Asignatura eliminada', 'success');
      await loadSubjects();
    } else {
      const error = await response.json();
      showNotification(`Error: ${error.error}`, 'error');
    }
  } catch (error) {
    console.error('Error eliminando asignatura:', error);
  }
}

function selectSubject(subject) {
  currentSubject = subject; // Ahora es un objeto
  console.log(`📚 Asignatura seleccionada: ${subject.name}`);

  // Actualizar indicador
  const indicator = document.getElementById('currentSubject');
  if (indicator) {
    indicator.textContent = subject.name;
    indicator.parentElement.style.backgroundColor = subject.color || '#2196F3';
  }

  // Cambiar a vista de captura
  showView('captureView');
}

// ==================== WEBCAM ====================
async function loadCameras() {
  const select = document.getElementById('cameraSelect');
  if (!select) return;

  try {
    // Pedir permiso primero si no lo tenemos para ver las etiquetas
    if (!navigator.mediaDevices.enumerateDevices) {
      console.warn('enumerateDevices no soportado');
      return;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');

    select.innerHTML = videoDevices.map(device =>
      `<option value="${device.deviceId}">${device.label || `Cámara ${select.length + 1}`}</option>`
    ).join('');

    // Recuperar cámara guardada
    const savedCamera = localStorage.getItem('preferredCameraId');
    if (savedCamera && videoDevices.find(d => d.deviceId === savedCamera)) {
      select.value = savedCamera;
    }

    if (videoDevices.length <= 1) {
      select.style.display = 'none'; // Ocultar si solo hay una
    } else {
      select.style.display = 'block';
    }
  } catch (error) {
    console.error('Error cargando cámaras:', error);
  }
}

async function initWebcam() {
  try {
    const cameraSelect = document.getElementById('cameraSelect');
    const deviceId = cameraSelect ? cameraSelect.value : null;

    // Obtener preferencia de calidad
    const quality = localStorage.getItem('cameraQuality') || '1080p';

    let width = 1920;
    let height = 1080;

    if (quality === '1440p') {
      width = 2560; height = 1440;
    } else if (quality === '2160p') {
      width = 3840; height = 2160;
    } else if (quality === 'max') {
      width = 9999; height = 9999; // Forzar máximo
    }

    const constraints = {
      video: {
        width: { ideal: width },
        height: { ideal: height },
        facingMode: 'user'
      },
      audio: false
    };

    if (deviceId) {
      constraints.video.deviceId = { exact: deviceId };
      delete constraints.video.facingMode;
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);

    const video = document.getElementById('webcam');
    video.srcObject = stream;

    video.onloadedmetadata = () => {
      video.play();
      console.log(`📹 Webcam iniciada: ${video.videoWidth}x${video.videoHeight} (Objetivo: ${quality})`);

      // Iniciar bucle de detección facial
      isProcessingVideo = true;
      photoBoothState = 'WAITING_FACE';
      requestAnimationFrame(processVideoFrame);
    };

  } catch (error) {
    console.error('❌ Error al acceder a la webcam:', error);
    showNotification('No se pudo acceder a la webcam en la calidad seleccionada.', 'error');
  }
}

function changeCamera() {
  const select = document.getElementById('cameraSelect');
  const deviceId = select.value;

  if (deviceId) {
    localStorage.setItem('preferredCameraId', deviceId);
    stopWebcam();
    initWebcam();
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

  // Resetear selector manual
  const manualSelect = document.getElementById('manualStudentSelect');
  if (manualSelect) manualSelect.value = '';
  manualSelectedStudent = null;
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

    // Solo detectar caras si estamos esperando y NO estamos en modo rápido NI manual
    if (photoBoothState === 'WAITING_FACE' && !isQuickMode && faceRecognitionService && faceRecognitionService.isReady) {
      const now = Date.now();

      // Limitar frecuencia de detección (cada 500ms)
      if (now - lastFaceDetectionTime > 500) {
        lastFaceDetectionTime = now;

        const result = await faceRecognitionService.recognizeStudent(video);

        if (result.status === 'recognized') {
          console.log(`👤 Estudiante reconocido: ${result.name}`);
          startGreetingSequence(result.name, result.studentId);
        }
      }
    }

  } catch (error) {
    console.error('Error en bucle de video:', error);
  }

  requestAnimationFrame(processVideoFrame);
}

// ==================== SELECCIÓN MANUAL ====================
function onManualStudentSelect() {
  const select = document.getElementById('manualStudentSelect');
  const studentId = select.value;

  // Caso especial: Volver a modo automático
  if (studentId === 'AUTO_MODE') {
    setAutomaticMode();
    select.value = ''; // Resetear selector
    return;
  }

  if (!studentId) return;

  // *** DETENER TODO LO AUTOMÁTICO INMEDIATAMENTE ***
  clearTimeout(greetingTimer);
  clearTimeout(countdownTimer);

  // Ocultar overlays activos
  const countdownEl = document.getElementById('countdownOverlay');
  if (countdownEl) countdownEl.classList.remove('show');

  const flashEl = document.getElementById('flashOverlay');
  if (flashEl) flashEl.classList.remove('flash');

  const imgOverlay = document.getElementById('capturePreviewOverlay');
  if (imgOverlay) imgOverlay.style.display = 'none';

  const studentName = select.options[select.selectedIndex].text;

  console.log(`🖱️ Selección manual: ${studentName} (ID: ${studentId})`);

  // Activar modo manual
  manualSelectedStudent = { id: parseInt(studentId), name: studentName };
  photoBoothState = 'MANUAL_READY';

  // Feedback visual
  showMessage(`Modo Manual: ${studentName}<br>Pulsa ESPACIO para capturar`);
  showNotification('Modo Manual activado. Pulsa ESPACIO para hacer la foto.', 'info');
}

function setAutomaticMode() {
  console.log('🔄 Reactivando Modo Automático');

  // Limpiar estado manual
  manualSelectedStudent = null;
  photoBoothState = 'WAITING_FACE';

  // Limpiar timers por si acaso
  clearTimeout(greetingTimer);
  clearTimeout(countdownTimer);

  // Ocultar mensajes de manual
  hideMessage();

  showNotification('🔄 Modo Automático Reactivado', 'success');
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

  let count = 4; // Cambiado a 4
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
      showCapturePreview(photoData, studentName, studentId);
    } else {
      showNotification('Error al capturar la foto', 'error');
      if (manualSelectedStudent) {
        photoBoothState = 'MANUAL_READY';
      } else {
        photoBoothState = 'WAITING_FACE';
      }
    }
  }, 100);
}

function showCapturePreview(photoData, studentName, studentId) {
  photoBoothState = 'PREVIEW';

  const overlay = document.getElementById('capturePreviewOverlay');
  const img = document.getElementById('previewImage');
  const progress = document.getElementById('previewTimerProgress');

  if (!overlay || !img || !progress) {
    // Fallback si no hay UI de preview
    savePhoto(photoData, studentName, studentId);
    return;
  }

  img.src = photoData;
  overlay.style.display = 'flex';

  // Resetear y animar barra de progreso
  progress.style.transition = 'none';
  progress.style.width = '100%';

  // Pequeño delay para que el navegador registre el reset de la transición
  setTimeout(() => {
    progress.style.transition = 'width 3s linear';
    progress.style.width = '0%';
  }, 50);

  // Programar guardado automático tras 3 segundos
  previewAutoSaveTimer = setTimeout(() => {
    overlay.style.display = 'none';
    savePhoto(photoData, studentName, studentId);
  }, 3000);
}

function discardPhoto() {
  if (previewAutoSaveTimer) {
    clearTimeout(previewAutoSaveTimer);
    previewAutoSaveTimer = null;
  }

  const overlay = document.getElementById('capturePreviewOverlay');
  if (overlay) overlay.style.display = 'none';

  showNotification('📸 Captura descartada. Vuelve a intentarlo.', 'info');

  // Si estábamos en modo manual, volver a ese estado
  if (manualSelectedStudent) {
    photoBoothState = 'MANUAL_READY';
    showMessage(`Modo Manual: ${manualSelectedStudent.name}<br>Pulsa ESPACIO para capturar`);
  } else {
    photoBoothState = 'WAITING_FACE';
    hideMessage();
  }
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

    // Si hay selección manual, FORZAR esa identidad
    if (manualSelectedStudent) {
      console.log(`🔒 Usando selección manual: ${manualSelectedStudent.name}`);
      finalStudentId = manualSelectedStudent.id;
      finalStudentName = manualSelectedStudent.name;
    }
    // Si no, usar reconocimiento facial
    else if (verificationResult.status === 'recognized' && verificationResult.studentId !== studentId) {
      console.log(`⚠️ Cambio de estudiante detectado: ${studentName} → ${verificationResult.name}`);
      finalStudentId = verificationResult.studentId;
      finalStudentName = verificationResult.name;
    }

    // Guardar en el servidor
    const response = await fetch(`${API_URL}/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: finalStudentId,
        subject: currentSubject.name, // Mantenemos .name para compatibilidad con el endpoint actual si no lo cambiamos
        subject_id: currentSubject.id, // Añadimos ID para el nuevo sistema
        imageData: photoData,
        method: manualSelectedStudent ? 'manual' : 'photo-booth',
        confidence: manualSelectedStudent ? 100 : (verificationResult.confidence || 95),
        isClassified: true
      })
    });

    const result = await response.json();

    if (response.ok) {
      console.log(`💾 Foto guardada: ${result.id}`);
      showMessage(`✅ ¡Guardado, ${finalStudentName}!`);

      // Volver a esperar después de 3 segundos
      setTimeout(() => {
        hideMessage();

        // Si no estamos en modo manual, volvemos a esperar caras
        if (!manualSelectedStudent) {
          photoBoothState = 'WAITING_FACE';
        } else {
          // Si estamos en modo manual, volvemos a estado LISTO y mostramos mensaje
          photoBoothState = 'MANUAL_READY';
          showMessage(`Modo Manual: ${manualSelectedStudent.name}<br>Pulsa ESPACIO para capturar`);
        }
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
            subject: currentSubject.name,
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

// ==================== GESTIÓN DE ESTUDIANTES (VISTA DOCENTE) ====================
async function loadStudents() {
  try {
    const response = await fetch(`${API_URL}/students`);
    const students = await response.json();

    // Actualizar lista en vista de docente con botones de entrenamiento integrados
    const studentsList = document.getElementById('studentsList');
    if (studentsList) {
      studentsList.innerHTML = students
        .map(s => {
          const hasProfile = s.descriptorCount > 0;
          return `
            <div class="student-item" style="border-left-color: ${hasProfile ? '#4CAF50' : '#FF9800'}">
              <div style="flex: 1;">
                <span>👶 ${s.name}</span>
                <small style="display: block; opacity: 0.7;">
                  ${hasProfile ? `✅ Perfil activo (${s.descriptorCount} imágenes)` : '⚠️ Sin perfil facial'}
                </small>
              </div>
              <div class="student-actions" style="display: flex; gap: 5px;">
                <button title="Entrenar Rostro" onclick="startTrainingMode(${s.id}, '${s.name}')" 
                        style="padding: 5px 10px; background: ${hasProfile ? 'rgba(76, 175, 80, 0.2)' : 'rgba(255, 152, 0, 0.3)'}">📸</button>
                ${hasProfile ? `<button title="Resetear Rostro" onclick="resetFaceProfile(${s.id})" 
                        style="padding: 5px 10px; background: rgba(244, 67, 54, 0.2); border-color: rgba(244, 67, 54, 0.4);">🔄</button>` : ''}
                <button title="Eliminar Estudiante" class="delete-student-btn" onclick="deleteStudent(${s.id})" 
                        style="padding: 5px 10px;">🗑️</button>
              </div>
            </div>
          `;
        })
        .join('');
    }

    // Poblar dropdown del wizard de mantenimiento
    const wizardSelect = document.getElementById('wizardStudentSelect');
    if (wizardSelect) {
      wizardSelect.innerHTML = '<option value="">-- Selecciona un estudiante --</option>' +
        students.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }

    // Selector de la Galería
    const gallerySelect = document.getElementById('galleryStudentSelect');
    if (gallerySelect) {
      const savedValue = gallerySelect.value;
      gallerySelect.innerHTML = '<option value="">Todos los estudiantes</option>' +
        '<option value="unassigned">Sin asignar</option>' +
        students.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
      if (savedValue) gallerySelect.value = savedValue;
    }

    // Selector manual en Vista de Captura
    const manualSelect = document.getElementById('manualStudentSelect');
    if (manualSelect) {
      manualSelect.innerHTML = '<option value="">-- Selección Manual --</option>' +
        '<option value="AUTO_MODE">✨ Modo Automático ✨</option>' +
        students.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    }

    console.log(`✅ ${students.length} estudiantes cargados`);
  } catch (error) {
    console.error('Error cargando estudiantes:', error);
    showNotification('Error al cargar estudiantes', 'error');
  }
}

// Removida función updateStudentProfileUI (redudante con la nueva integración)

async function resetFaceProfile(studentId) {
  if (!confirm('¿Estás seguro de resetear el perfil facial? Se borrarán todos los datos de entrenamiento de este estudiante.')) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/faces/${studentId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      showNotification('✅ Perfil facial reseteado. Puedes entrenar de nuevo.', 'success');
      await loadStudents(); // Recargar lista para actualizar estado
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
    console.error('Error añadiendo estudiante:', error);
    showNotification('Error al añadir estudiante', 'error');
  }
}

async function deleteStudent(studentId) {
  if (!confirm('¿Estás seguro de que quieres eliminar este estudiante?')) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/students/${studentId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      showNotification('🗑️ Estudiante eliminado correctamente', 'success');
      await loadStudents();
    } else {
      showNotification('Error al eliminar estudiante', 'error');
    }
  } catch (error) {
    console.error('Error eliminando estudiante:', error);
    showNotification('Error al eliminar estudiante', 'error');
  }
}

// ==================== ENTRENAMIENTO FACIAL ====================
let currentTrainingStudentId = null;

async function startTrainingMode(studentId, studentName) {
  if (!studentId) return;

  if (!faceRecognitionService || !faceRecognitionService.isReady) {
    showNotification('Servicio de reconocimiento facial no disponible', 'error');
    return;
  }

  currentTrainingStudentId = studentId;
  isTrainingMode = true;
  trainingCount = 0;

  const modal = document.getElementById('trainingModal');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('trainingStudentName').textContent = studentName;
    document.getElementById('trainingCount').textContent = '0';
  }

  showNotification(`📸 Entrenando rostro de ${studentName}`, 'info');

  // Iniciar cámara específica para entrenamiento
  await initTrainingWebcam();
}

function stopTrainingMode() {
  isTrainingMode = false;
  trainingCount = 0;
  currentTrainingStudentId = null;

  const modal = document.getElementById('trainingModal');
  if (modal) {
    modal.style.display = 'none';
  }

  stopTrainingWebcam();
  loadStudents(); // Recargar lista para actualizar indicadores
  showNotification('✅ Entrenamiento finalizado', 'success');
}

async function captureTrainingFace() {
  if (!isTrainingMode || !currentTrainingStudentId) {
    showNotification('Inicia el modo entrenamiento primero', 'error');
    return;
  }

  const studentId = currentTrainingStudentId;

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
  showNotification('🔄 Iniciando Importación Inteligente...', 'info');

  try {
    // 1. Escanear carpeta temporal en el servidor
    const syncResponse = await fetch(`${API_URL}/system/sync`, { method: 'POST' });
    const syncData = await syncResponse.json();

    // 2. Obtener lista detallada de archivos pendientes
    const pendingResponse = await fetch(`${API_URL}/system/pending`);
    const files = await pendingResponse.json();

    if (files.length === 0) {
      showNotification('ℹ️ No hay archivos nuevos en la carpeta temporal', 'info');
      return;
    }

    showNotification(`🔍 Procesando ${files.length} archivos con IA...`, 'info');

    let recognizedCount = 0;
    const subjects = await (await fetch(`${API_URL}/subjects`)).json();

    // Imagen oculta para procesamiento
    const offscreenImg = new Image();

    for (const file of files) {
      await new Promise((resolve) => {
        offscreenImg.onload = async () => {
          try {
            // IA: Reconocimiento Facial
            const result = await faceRecognitionService.recognizeStudent(offscreenImg);

            if (result.status === 'recognized' && result.confidence > 0.85) {
              // IA: Clasificación de Asignatura (o por nombre de archivo)
              let subjectId = null;
              const fileName = file.name.toLowerCase();

              // Prioridad 1: Nombre de archivo
              const matchedSubject = subjects.find(s => fileName.includes(s.name.toLowerCase()));
              if (matchedSubject) {
                subjectId = matchedSubject.id;
              } else {
                // Prioridad 2: IA de clasificación (si está lista)
                // const classResult = await imageClassificationService.classifyImage(offscreenImg);
                // subjectId = ...
              }

              // Mover si tenemos estudiante y asignatura (o usar 'General' si no)
              if (!subjectId) {
                const general = subjects.find(s => s.name === 'General') || subjects[0];
                subjectId = general.id;
              }

              const moveResp = await fetch(`${API_URL}/system/move`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  filename: file.name,
                  studentId: result.studentId,
                  subject_id: subjectId
                })
              });

              if (moveResp.ok) recognizedCount++;
            }
          } catch (err) {
            console.error('Error procesando archivo:', file.name, err);
          }
          resolve();
        };
        offscreenImg.src = file.url;
      });
    }

    if (recognizedCount > 0) {
      showNotification(`✅ Importación completada: ${recognizedCount} fotos clasificadas automáticamente`, 'success');
      await loadStudents();
      updatePendingCount();
    } else {
      showNotification('ℹ️ Escaneo finalizado. No se pudo identificar automáticamente ningún estudiante. Usa el asistente manual.', 'warning');
    }

  } catch (e) {
    console.error('Error en Importación Inteligente:', e);
    showNotification('Error de conexión o en el procesamiento IA', 'error');
  }
}

async function resetSystem(mode) {
  let warning = "";
  if (mode === 'photos') {
    warning = "⚠️ ¿ESTÁS SEGURO? Se borrarán TODOS los trabajos (fotos) del disco duro y de la base de datos.\n\nLos estudiantes y sus datos faciales NO se borrarán.";
  } else if (mode === 'students') {
    warning = "⚠️ ¿ESTÁS SEGURO? Se borrarán TODOS los estudiantes y sus datos faciales de la base de datos.\n\nLos archivos de fotos en el disco duro NO se borrarán.";
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

async function loadSyncInfo() {
  try {
    const response = await fetch(`${API_URL}/system/info`);
    const data = await response.json();

    const ipEl = document.getElementById('syncIp');
    const portEl = document.getElementById('syncPort');

    if (ipEl) {
      if (data.ips && data.ips.length > 0) {
        ipEl.textContent = data.ips.join(' / ');
      } else {
        ipEl.textContent = data.ip;
      }
    }
    if (portEl) portEl.textContent = data.port;
  } catch (e) {
    console.error('Error cargando info de sincronización:', e);
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
  // Buscar en las opciones del select si alguna coincide con el inicio del nombre
  for (let i = 0; i < subjectSelect.options.length; i++) {
    const opt = subjectSelect.options[i];
    if (fileName.toLowerCase().startsWith(opt.text.toLowerCase())) {
      subjectSelect.selectedIndex = i;
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
    alert('Por favor, selecciona un estudiante');
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
      const errorData = await response.json();
      showNotification(`Error: ${errorData.error || 'Error al mover foto'}`, 'error');
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

  grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 50px;">Cargando trabajos...</p>';

  try {
    let captures = [];

    // Si no hay alumno seleccionado o es "Todos", cargar TODO
    if (!studentId || studentId === 'Todos') {
      const response = await fetch(`${API_URL}/captures`);
      captures = await response.json();
    } else if (studentId === 'unassigned') {
      // Cargar evidencias sin estudiante asignado
      const response = await fetch(`${API_URL}/captures`);
      const allCaptures = await response.json();
      captures = allCaptures.filter(c => !c.student_id || c.student_id === null);
    } else {
      // Cargar solo de un alumno
      const response = await fetch(`${API_URL}/captures/${studentId}`);
      captures = await response.json();
    }

    // Filtrar por asignatura si no es "Todas"
    if (subject !== 'Todas') {
      // Comparar por ID si es numérico (nuevo sistema) o por nombre (antiguo)
      const isNumeric = !isNaN(parseInt(subject));
      captures = captures.filter(c => {
        if (isNumeric) return String(c.subject_id) === String(subject);
        return c.subject === subject;
      });
    }

    currentGalleryCaptures = captures; // Guardar para navegación

    if (captures.length === 0) {
      grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; padding: 50px; opacity: 0.5;">No hay trabajos registrados ${subject !== 'Todas' ? 'en ' + subject : ''}</p>`;
      return;
    }

    grid.innerHTML = '';

    // Si estamos viendo un solo alumno, obtenemos su nombre una vez.
    // Si estamos viendo todos, usamos el nombre que viene en cada captura.
    let singleStudentName = 'Estudiante';
    if (studentId && studentId !== 'Todos' && studentId !== 'unassigned') {
      const studentResponse = await fetch(`${API_URL}/students`);
      const students = studentResponse.ok ? await studentResponse.json() : [];
      const selectedStudent = students.find(s => s.id === parseInt(studentId));
      singleStudentName = selectedStudent ? selectedStudent.name : 'Estudiante';
    }

    captures.forEach((cap, index) => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      const imgUrl = `/portfolios/${cap.imagePath}`;
      const studentNameDisplay = cap.studentName || (studentId && studentId !== 'Todos' ? singleStudentName : 'Sin asignar');

      card.innerHTML = `
        <img src="${imgUrl}" alt="Trabajo">
        <div class="gallery-card-info">
          <div class="gallery-card-student">${studentNameDisplay}</div>
          <div class="gallery-card-subject">${cap.subject || 'General'}</div>
          <div class="gallery-card-date">${new Date(cap.timestamp).toLocaleDateString()} ${new Date(cap.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      `;

      // Agregar indicador visual si está seleccionada
      if (selectedEvidences.has(cap.id)) {
        card.classList.add('selected');
      }

      // Indicador de posición en el array para Shift+clic
      card.dataset.evidenceId = cap.id;
      card.dataset.arrayIndex = index;

      // Comportamiento de clic según el modo
      card.onclick = (e) => {
        if (selectionMode) {
          // MODO SELECCIÓN: clic simple selecciona/deselecciona
          handleCardClick(cap.id, index, e.shiftKey);
        } else {
          // MODO NORMAL: clic abre lightbox
          openLightbox(index);
        }
      };

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

  // Reset zoom state
  resetLightboxZoom();

  // Remove old event listeners to avoid duplicates
  img.removeEventListener('dblclick', handleLightboxZoom);
  img.removeEventListener('mousedown', handlePanStart);
  img.removeEventListener('mousemove', handlePanMove);
  img.removeEventListener('mouseup', handlePanEnd);
  img.removeEventListener('mouseleave', handlePanEnd);

  // Add event listeners
  img.addEventListener('dblclick', handleLightboxZoom);
  img.addEventListener('mousedown', handlePanStart);
  img.addEventListener('mousemove', handlePanMove);
  img.addEventListener('mouseup', handlePanEnd);
  img.addEventListener('mouseleave', handlePanEnd);
}

function handleLightboxZoom(e) {
  e.stopPropagation();
  e.preventDefault();

  const img = document.getElementById('lightboxImg');
  const rect = img.getBoundingClientRect();

  if (lightboxZoomLevel === 1) {
    // Calculate click position relative to image
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Calculate the center of the image
    const imgCenterX = rect.width / 2;
    const imgCenterY = rect.height / 2;

    // Calculate offset to center the click point
    // When we zoom 2x, we want the click point to stay in the same screen position
    let panX = (imgCenterX - clickX) * 2;
    let panY = (imgCenterY - clickY) * 2;

    // Apply boundary constraints
    const maxPanX = rect.width / 4;
    const maxPanY = rect.height / 4;

    panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
    panY = Math.max(-maxPanY, Math.min(maxPanY, panY));

    lightboxPanState.x = panX;
    lightboxPanState.y = panY;

    // Zoom in to 2x
    lightboxZoomLevel = 2;
    img.classList.add('zoomed');
    updateImageTransform(img);
  } else {
    // Zoom out to 1x
    lightboxZoomLevel = 1;
    lightboxPanState.x = 0;
    lightboxPanState.y = 0;
    img.classList.remove('zoomed');
    updateImageTransform(img);
  }
}

function handlePanStart(e) {
  // Only allow panning when zoomed
  if (lightboxZoomLevel === 1) return;

  e.preventDefault();
  lightboxPanState.isDragging = true;
  lightboxPanState.startX = e.clientX - lightboxPanState.x;
  lightboxPanState.startY = e.clientY - lightboxPanState.y;

  const img = document.getElementById('lightboxImg');
  img.style.cursor = 'grabbing';
}

function handlePanMove(e) {
  if (!lightboxPanState.isDragging) return;

  e.preventDefault();

  // Calculate new position
  let newX = e.clientX - lightboxPanState.startX;
  let newY = e.clientY - lightboxPanState.startY;

  // Get image dimensions
  const img = document.getElementById('lightboxImg');
  const rect = img.getBoundingClientRect();

  // When zoomed 2x:
  // - The scaled image is rect.width * 2 and rect.height * 2
  // - The viewport shows rect.width and rect.height
  // - Maximum pan = (scaled size - viewport size) / 2
  // - In transform coordinates (which are affected by scale), divide by scale again

  // Maximum pan in screen pixels
  const maxPanXScreen = (rect.width * 2 - rect.width) / 2; // = rect.width / 2
  const maxPanYScreen = (rect.height * 2 - rect.height) / 2; // = rect.height / 2

  // Convert to transform coordinates (divide by scale factor)
  const maxPanX = maxPanXScreen / 2;
  const maxPanY = maxPanYScreen / 2;

  // Constrain pan to boundaries
  newX = Math.max(-maxPanX, Math.min(maxPanX, newX));
  newY = Math.max(-maxPanY, Math.min(maxPanY, newY));

  // Update pan state with constrained values
  lightboxPanState.x = newX;
  lightboxPanState.y = newY;

  updateImageTransform(img);
}

function handlePanEnd(e) {
  if (!lightboxPanState.isDragging) return;

  lightboxPanState.isDragging = false;
  const img = document.getElementById('lightboxImg');
  img.style.cursor = lightboxZoomLevel === 2 ? 'grab' : 'zoom-in';
}

function updateImageTransform(img) {
  if (lightboxZoomLevel === 1) {
    img.style.transform = 'scale(1) translate(0, 0)';
  } else {
    // Apply both zoom and pan
    const translateX = lightboxPanState.x / 2; // Divide by 2 because scale affects translate
    const translateY = lightboxPanState.y / 2;
    img.style.transform = `scale(2) translate(${translateX}px, ${translateY}px)`;
  }
}

function resetLightboxZoom() {
  lightboxZoomLevel = 1;
  lightboxPanState = { x: 0, y: 0, isDragging: false, startX: 0, startY: 0 };

  const img = document.getElementById('lightboxImg');
  if (img) {
    img.classList.remove('zoomed');
    img.style.transform = 'scale(1) translate(0, 0)';
    img.style.cursor = 'zoom-in';
  }
}

function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
  currentLightboxIndex = -1;
  resetLightboxZoom();
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

async function deleteCurrentEvidence(e) {
  if (e) e.stopPropagation();
  if (currentLightboxIndex < 0 || !currentGalleryCaptures[currentLightboxIndex]) return;

  const cap = currentGalleryCaptures[currentLightboxIndex];

  if (!confirm('¿Estás seguro de eliminar este trabajo? Esta acción no se puede deshacer.')) {
    return;
  }

  try {
    const response = await fetch(`${API_URL}/evidences/${cap.id}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      showNotification('✅ Trabajo eliminado correctamente', 'success');
      closeLightbox();
      updateGallery(); // Refrescar la galería
    } else {
      const error = await response.json();
      showNotification(`Error: ${error.error}`, 'error');
    }
  } catch (error) {
    console.error('Error eliminando evidencia:', error);
    showNotification('Error de conexión', 'error');
  }
}

// ==================== NAVEGACIÓN DE VISTAS ====================
function exitTeacherView() {
  showView('subjectSelector');
}

function exitGalleryView() {
  showView('subjectSelector');
}


// ==================== ESTADÍSTICAS DEL SISTEMA ====================
async function loadSystemStats() {
  const statsEl = document.getElementById('systemStats');
  const qualitySelect = document.getElementById('qualitySelect');

  if (qualitySelect) {
    const savedQuality = localStorage.getItem('cameraQuality') || '1080p';
    qualitySelect.value = savedQuality;
  }

  if (!statsEl) return;

  try {
    const response = await fetch(`${API_URL}/system/stats`);
    const stats = await response.json();

    statsEl.innerHTML = `
      <div class="stat-item">👥 <strong>Estudiantes:</strong> ${stats.students}</div>
      <div class="stat-item">📸 <strong>Evidencias:</strong> ${stats.evidences}</div>
      <div class="stat-item">💾 <strong>Espacio en disco:</strong> ${formatBytes(stats.totalSize)}</div>
    `;
  } catch (error) {
    console.error('Error cargando estadísticas:', error);
    statsEl.innerHTML = 'Error al cargar estadísticas';
  }
}

function changeQuality() {
  const select = document.getElementById('qualitySelect');
  const quality = select.value;

  localStorage.setItem('cameraQuality', quality);
  showNotification(`Calidad de captura actualizada: ${select.options[select.selectedIndex].text}`, 'success');
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ==================== GESTIÓN DE CURSOS ====================

async function loadCourses() {
  const listEl = document.getElementById('coursesList');
  if (!listEl) return;

  listEl.innerHTML = 'Cargando...';

  try {
    const response = await fetch(`${API_URL}/courses`);
    const courses = await response.json();

    // Actualizar indicador de Curso Actual (Teacher Panel)
    const activeCourse = courses.find(c => c.is_active);
    const activeCourseEl = document.getElementById('activeCourseName');
    if (activeCourseEl) {
      activeCourseEl.textContent = activeCourse ? activeCourse.name : 'Ninguno';
      activeCourseEl.style.color = activeCourse ? '#333' : '#666';
    }

    // Actualizar indicador de Curso Actual (Main Screen)
    const mainActiveCourseEl = document.querySelector('#mainActiveCourse span');
    if (mainActiveCourseEl) {
      mainActiveCourseEl.textContent = activeCourse ? activeCourse.name : 'Ninguno';
      mainActiveCourseEl.style.color = activeCourse ? '#2196F3' : '#666';
    }

    if (courses.length === 0) {
      listEl.innerHTML = '<div style="padding:10px; text-align:center; color:#666;">No hay cursos registrados.</div>';
      return;
    }

    listEl.innerHTML = '';
    courses.forEach(course => {
      const el = document.createElement('div');
      el.className = 'course-item';

      const statusClass = course.is_active ? 'status-active' : 'status-archived';
      const statusText = course.is_active ? 'ACTIVO' : 'ARCHIVADO';
      const startDate = new Date(course.start_date).toLocaleDateString();
      const endDate = course.end_date ? new Date(course.end_date).toLocaleDateString() : '';

      el.innerHTML = `
        <div class="course-info">
          <span class="course-name">${course.name} <span class="course-status ${statusClass}">${statusText}</span></span>
          <span class="course-date">Inicio: ${startDate} ${endDate ? '| Fin: ' + endDate : ''}</span>
        </div>
        <div class="course-actions">
          ${course.is_active
          ? `<button onclick="toggleCourseStatus(${course.id}, false)">📦 Archivar</button>`
          : `<button onclick="toggleCourseStatus(${course.id}, true)">🔄 Reactivar</button>`
        }
          <button onclick="deleteCourse(${course.id}, '${course.name}')" class="delete-btn" style="margin-left: 5px; background: #f44336;" title="Borrar curso y sus datos">🗑️</button>
        </div>
      `;
      listEl.appendChild(el);
    });
  } catch (error) {
    console.error('Error cargando cursos:', error);
    listEl.innerHTML = 'Error al cargar cursos.';
  }
}

async function deleteCourse(id, name) {
  const confirm1 = confirm(`⚠️ ¿Estás seguro de que quieres borrar el curso "${name}"?\n\nESTO ES IRREVERSIBLE.\n\nSe borrarán:\n- Todos los estudiantes del curso\n- Todas las fotos y evidencias\n- Todos los datos faciales`);
  if (!confirm1) return;

  const confirm2 = confirm(`⚠️ ÚLTIMA ADVERTENCIA\n\n¿Realmente deseas eliminar "${name}" y TODOS sus datos?`);
  if (!confirm2) return;

  try {
    const response = await fetch(`${API_URL}/courses/${id}`, { method: 'DELETE' });
    const result = await response.json();

    if (response.ok) {
      showNotification('✅ Curso eliminado correctamente', 'success');
      loadCourses(); // Recargar lista
    } else {
      showNotification(`Error: ${result.error}`, 'error');
    }
  } catch (e) {
    console.error(e);
    showNotification('Error de conexión al borrar curso', 'error');
  }
}

function openCourseModal() {
  document.getElementById('courseModal').style.display = 'flex';

  // Prellenar con año sugerido según calendario español
  const now = new Date();
  const currentYear = now.getFullYear();
  const nextYear = currentYear + 1;

  // Si estamos después de septiembre, sugerir curso actual-siguiente
  // Si estamos antes, sugerir curso anterior-actual
  let suggestedCourse;
  if (now.getMonth() >= 8) { // Septiembre (mes 8) a diciembre
    suggestedCourse = `Curso ${currentYear}-${nextYear.toString().substring(2)}`;
  } else { // Enero a agosto
    suggestedCourse = `Curso ${currentYear - 1}-${currentYear.toString().substring(2)}`;
  }

  document.getElementById('courseName').value = suggestedCourse;
  document.getElementById('courseStartDate').valueAsDate = now;
}

function closeCourseModal() {
  document.getElementById('courseModal').style.display = 'none';
}

// === GESTIÓN DE CONTRASEÑA ===

function openChangePasswordModal() {
  document.getElementById('changePasswordModal').style.display = 'flex';
  document.getElementById('changePasswordForm').reset();
  document.getElementById('passwordError').style.display = 'none';
}

function closeChangePasswordModal() {
  document.getElementById('changePasswordModal').style.display = 'none';
  document.getElementById('changePasswordForm').reset();
  document.getElementById('passwordError').style.display = 'none';
}

async function handleChangePassword(e) {
  e.preventDefault();

  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  const errorDiv = document.getElementById('passwordError');

  // Validar que las contraseñas coincidan
  if (newPassword !== confirmPassword) {
    errorDiv.textContent = '❌ Las contraseñas no coinciden';
    errorDiv.style.display = 'block';
    return;
  }

  // Validar longitud mínima
  if (newPassword.length < 4) {
    errorDiv.textContent = '❌ La contraseña debe tener al menos 4 caracteres';
    errorDiv.style.display = 'block';
    return;
  }

  try {
    const response = await fetch(`${API_URL}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldPassword: currentPassword,
        newPassword: newPassword
      })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      showNotification('✅ Contraseña cambiada correctamente', 'success');
      closeChangePasswordModal();
    } else {
      errorDiv.textContent = `❌ ${data.message || 'Error cambiando la contraseña'}`;
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    errorDiv.textContent = '❌ Error de conexión al servidor';
    errorDiv.style.display = 'block';
  }
}

async function handleCreateCourse(e) {
  e.preventDefault();

  const name = document.getElementById('courseName').value;
  const startDate = document.getElementById('courseStartDate').value;

  try {
    const response = await fetch(`${API_URL}/courses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, start_date: startDate })
    });

    if (response.ok) {
      showNotification('✅ Curso creado correctamente', 'success');
      closeCourseModal();
      loadCourses();
    } else {
      const error = await response.json();
      showNotification(`Error: ${error.error}`, 'error');
    }
  } catch (error) {
    console.error('Error creando curso:', error);
    showNotification('Error de conexión', 'error');
  }
}

async function toggleCourseStatus(id, isActive) {
  const endpoint = isActive ? 'reactivate' : 'archive';
  const actionName = isActive ? 'reactivar' : 'archivar';

  if (!confirm(`¿Seguro que quieres ${actionName} este curso?`)) return;

  try {
    const response = await fetch(`${API_URL}/courses/${id}/${endpoint}`, {
      method: 'PUT'
    });

    if (response.ok) {
      showNotification(`✅ Curso ${isActive ? 'reactivado' : 'archivado'}`, 'success');
      loadCourses();
    } else {
      const error = await response.json();
      showNotification(`Error: ${error.error}`, 'error');
    }
  } catch (error) {
    console.error('Error actualizando curso:', error);
    showNotification('Error de conexión', 'error');
  }
}

// ==================== FUNCIONES DE SELECCIÓN MÚLTIPLE ====================

function toggleSelectionMode() {
  selectionMode = !selectionMode;
  const btn = document.getElementById('toggleSelectionMode');
  const galleryGrid = document.getElementById('galleryGrid');

  if (selectionMode) {
    btn.textContent = '✕ Cancelar selección';
    btn.classList.add('active');
    galleryGrid.classList.add('selection-mode');
  } else {
    btn.textContent = '☑️ Seleccionar';
    btn.classList.remove('active');
    galleryGrid.classList.remove('selection-mode');
    deselectAll();
  }
}

function handleCardClick(evidenceId, arrayIndex, shiftPressed) {
  if (shiftPressed && lastSelectedIndex !== -1) {
    // SHIFT+CLIC: Seleccionar rango
    selectRange(lastSelectedIndex, arrayIndex);
  } else {
    // CLIC SIMPLE: Toggle selección individual
    if (selectedEvidences.has(evidenceId)) {
      selectedEvidences.delete(evidenceId);
    } else {
      selectedEvidences.add(evidenceId);
    }
    lastSelectedIndex = arrayIndex;
  }

  updateGallery(); // Re-renderizar para actualizar clases CSS
  updateSelectionUI();
}

function selectRange(startIndex, endIndex) {
  const start = Math.min(startIndex, endIndex);
  const end = Math.max(startIndex, endIndex);

  for (let i = start; i <= end; i++) {
    if (currentGalleryCaptures[i]) {
      selectedEvidences.add(currentGalleryCaptures[i].id);
    }
  }
}

function updateSelectionUI() {
  const count = selectedEvidences.size;
  const actionBar = document.getElementById('selectionActionBar');
  const selectedCountSpan = document.getElementById('selectedCount');

  if (count > 0) {
    actionBar.classList.add('visible');
    selectedCountSpan.textContent = count;
  } else {
    actionBar.classList.remove('visible');
  }
}

function selectAll() {
  currentGalleryCaptures.forEach(cap => {
    selectedEvidences.add(cap.id);
  });
  updateGallery();
  updateSelectionUI();
}

function deselectAll() {
  selectedEvidences.clear();
  lastSelectedIndex = -1;
  updateGallery();
  updateSelectionUI();
}

function closeZipPasswordModal() {
  document.getElementById('zipPasswordModal').style.display = 'none';
  document.getElementById('zipPassword').value = '';
  document.getElementById('zipPasswordConfirm').value = '';
  document.getElementById('zipPasswordError').style.display = 'none';
}

function showError(message) {
  const errorDiv = document.getElementById('zipPasswordError');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
}

// ==================== ELIMINACIÓN BATCH ====================

async function deleteSelectedEvidences() {
  if (selectedEvidences.size === 0) return;

  const confirmed = confirm(
    `¿Eliminar ${selectedEvidences.size} evidencias?\n\nEsta acción no se puede deshacer.`
  );
  if (!confirmed) return;

  try {
    const response = await fetch(`${API_URL}/evidences/batch`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedEvidences) })
    });

    if (response.ok) {
      showNotification('✅ Evidencias eliminadas', 'success');
      selectedEvidences.clear();
      updateGallery();
      updateSelectionUI();
    } else {
      const error = await response.json();
      showNotification(`Error: ${error.error}`, 'error');
    }
  } catch (error) {
    console.error('Error eliminando evidencias:', error);
    showNotification('Error de conexión', 'error');
  }
}

// ==================== EXPORTACIÓN A ZIP CON CONTRASEÑA ====================

function exportSelectedEvidences() {
  if (selectedEvidences.size === 0) return;
  document.getElementById('zipExportCount').textContent = selectedEvidences.size;
  document.getElementById('zipPasswordModal').style.display = 'flex';
}

async function confirmZipExport() {
  const exportType = document.querySelector('input[name="exportType"]:checked').value;

  // Verificar qué tipo de exportación se seleccionó
  if (exportType === 'pixelated') {
    // Exportar con caras pixeladas
    closeZipPasswordModal();
    await exportPixelatedEvidences(Array.from(selectedEvidences));
  } else {
    // Exportar con contraseña (flujo original)
    const password = document.getElementById('zipPassword').value;
    const passwordConfirm = document.getElementById('zipPasswordConfirm').value;

    // Validaciones
    if (password.length < 4) {
      showError('La contraseña debe tener al menos 4 caracteres');
      return;
    }
    if (password !== passwordConfirm) {
      showError('Las contraseñas no coinciden');
      return;
    }

    closeZipPasswordModal();
    showNotification('📦 Exportando...', 'info');

    try {
      const response = await fetch(`${API_URL}/evidences/batch/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: Array.from(selectedEvidences),
          zipPassword: password
        })
      });

      if (response.ok) {
        // Descargar el ZIP
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `evidencias_${new Date().toISOString().split('T')[0]}.zip`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showNotification('✅ ZIP descargado', 'success');
        deselectAll();
      } else {
        const error = await response.json();
        showNotification(`Error: ${error.error}`, 'error');
      }
    } catch (error) {
      console.error('Error exportando:', error);
      showNotification('Error de conexión', 'error');
    }
  }
}

/**
 * Exportar evidencias con caras pixeladas en un ZIP sin contraseña
 * @param {Array<number>} ids - IDs de las evidencias a exportar
 */
async function exportPixelatedEvidences(ids) {
  if (ids.length === 0) return;

  try {
    // Paso 1: Obtener imágenes desencriptadas del backend
    showNotification('🔄 Obteniendo imágenes...', 'info');

    const response = await fetch(`${API_URL}/evidences/batch/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });

    if (!response.ok) {
      const error = await response.json();
      showNotification(`Error: ${error.error}`, 'error');
      return;
    }

    const images = await response.json();
    console.log(`📦 Recibidas ${images.length} imágenes`);

    // Paso 2: Asegurar que face-api.js esté cargado
    if (!faceRecognitionService || !faceRecognitionService.isReady) {
      showNotification('🔄 Cargando modelos de detección facial...', 'info');
      if (!faceRecognitionService) {
        faceRecognitionService = new FaceRecognitionService();
      }
      await faceRecognitionService.initialize();
    }

    // Paso 3: Procesar cada imagen (detectar y pixelar caras)
    showNotification(`🎭 Pixelando caras (0/${images.length})...`, 'info');

    const zip = new JSZip();
    let processedCount = 0;

    for (const imgData of images) {
      try {
        // Cargar imagen
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = imgData.imageBase64;
        });

        console.log(`🖼️ Procesando: ${imgData.fileName}`);

        // Pixelar caras (tamaño de píxel: 25 para máxima privacidad)
        const pixelatedDataUrl = await pixelateFaces(img, 25);

        // Convertir a blob
        const blob = await fetch(pixelatedDataUrl).then(r => r.blob());

        // Agregar al ZIP
        zip.file(imgData.fileName, blob);

        processedCount++;
        showNotification(`🎭 Pixelando caras (${processedCount}/${images.length})...`, 'info');
      } catch (error) {
        console.error(`Error procesando ${imgData.fileName}:`, error);
      }
    }

    // Paso 4: Generar y descargar ZIP
    showNotification('📦 Creando archivo ZIP...', 'info');

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 1 } // Nivel 1 = más rápido (JPG no comprime mucho)
    });

    // Descargar
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `evidencias_pixeladas_${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);

    showNotification(`✅ ZIP descargado con ${processedCount} imágenes`, 'success');
    deselectAll();
  } catch (error) {
    console.error('Error en exportación pixelada:', error);
    showNotification('❌ Error al exportar', 'error');
  }
}

// ==================== FUNCIONES DE PIXELADO DE CARAS ====================

function togglePasswordFields() {
  const exportType = document.querySelector('input[name="exportType"]:checked').value;
  const passwordFields = document.getElementById('passwordFields');

  if (exportType === 'encrypted') {
    passwordFields.style.display = 'block';
  } else {
    passwordFields.style.display = 'none';
  }
}

/**
 * Pixelar una región específica del canvas (efecto mosaico)
 * @param {CanvasRenderingContext2D} ctx - Contexto del canvas
 * @param {number} x - Posición X inicial
 * @param {number} y - Posición Y inicial
 * @param {number} width - Ancho de la región
 * @param {number} height - Alto de la región
 * @param {number} blockSize - Tamaño del píxel del mosaico
 */
function pixelateRegion(ctx, x, y, width, height, blockSize = 15) {
  // Asegurar que las coordenadas estén dentro del canvas
  x = Math.max(0, Math.floor(x));
  y = Math.max(0, Math.floor(y));
  width = Math.floor(width);
  height = Math.floor(height);

  // Expandir un poco el área para cubrir mejor la cara
  const padding = blockSize * 2;
  x = Math.max(0, x - padding);
  y = Math.max(0, y - padding);
  width = width + padding * 2;
  height = height + padding * 2;

  // Crear efecto mosaico
  for (let px = x; px < x + width; px += blockSize) {
    for (let py = y; py < y + height; py += blockSize) {
      // Obtener el color del pixel central del bloque
      const sampleX = Math.min(px + Math.floor(blockSize / 2), ctx.canvas.width - 1);
      const sampleY = Math.min(py + Math.floor(blockSize / 2), ctx.canvas.height - 1);

      try {
        const pixelData = ctx.getImageData(sampleX, sampleY, 1, 1).data;
        ctx.fillStyle = `rgb(${pixelData[0]},${pixelData[1]},${pixelData[2]})`;

        // Dibujar bloque
        const blockWidth = Math.min(blockSize, ctx.canvas.width - px);
        const blockHeight = Math.min(blockSize, ctx.canvas.height - py);
        ctx.fillRect(px, py, blockWidth, blockHeight);
      } catch (e) {
        // Ignorar errores en bordes
      }
    }
  }
}

/**
 * Detectar caras y pixelarlas en una imagen
 * @param {HTMLImageElement} imageElement - Elemento de imagen
 * @param {number} pixelSize - Tamaño del píxel (bloques)
 * @returns {Promise<string>} - Data URL de la imagen pixelada
 */
async function pixelateFaces(imageElement, pixelSize = 15) {
  // Crear canvas
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = imageElement.width;
  canvas.height = imageElement.height;

  // Dibujar imagen original
  ctx.drawImage(imageElement, 0, 0);

  try {
    // Detectar caras usando face-api.js
    const detections = await faceapi
      .detectAllFaces(imageElement, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
      .withFaceLandmarks();

    // Si no detecta con SSD, intentar con Tiny (más rápido pero menos preciso)
    if (detections.length === 0) {
      const tinyDetections = await faceapi
        .detectAllFaces(imageElement, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.2 }))
        .withFaceLandmarks();

      if (tinyDetections.length > 0) {
        detections.push(...tinyDetections);
      }
    }

    console.log(`🎭 Detectadas ${detections.length} cara(s) en la imagen`);

    // Pixelar cada cara detectada
    detections.forEach((detection, index) => {
      const box = detection.detection.box;
      console.log(`  → Pixelando cara ${index + 1}: x=${Math.floor(box.x)}, y=${Math.floor(box.y)}, w=${Math.floor(box.width)}, h=${Math.floor(box.height)}`);
      pixelateRegion(ctx, box.x, box.y, box.width, box.height, pixelSize);
    });

    if (detections.length === 0) {
      console.warn('⚠️ No se detectaron caras en la imagen');
    }
  } catch (error) {
    console.error('Error detectando caras:', error);
  }

  // Retornar imagen procesada como data URL
  return canvas.toDataURL('image/jpeg', 0.92);
}

console.log('✅ EduPortfolio Fase 3 - Cabina de Fotos cargado');
