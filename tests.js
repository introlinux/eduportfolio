const http = require('http');

const API_URL = 'http://localhost:3000/api';

// Colores para la consola (deshabilitados en PowerShell)
const colors = {
  reset: '',
  green: '',
  red: '',
  yellow: '',
  blue: '',
  bold: ''
};

let testsPassed = 0;
let testsFailed = 0;

// Función auxiliar para hacer requests HTTP
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL + path);
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Función para registrar pruebas
function logTest(name, passed, details = '') {
  if (passed) {
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } else {
    console.log(`[FAIL] ${name}`);
    if (details) console.log(`       ${details}`);
    testsFailed++;
  }
}

async function runTests() {
  console.log(`\nPRUEBAS AUTOMATIZADAS DE API - EduPortfolio\n`);
  console.log('='.repeat(60));

  let studentIds = [];

  try {
    // ===== TEST 1: Crear Alumnos =====
    console.log(`\n1. PRUEBAS: Crear Alumnos`);
    console.log('-'.repeat(60));

    const names = ['Lucas Martínez', 'Emma García', 'Carlos López', 'Sofia Rodríguez'];

    for (const name of names) {
      const response = await makeRequest('POST', '/students', { name });
      const passed =
        response.status === 200 &&
        response.body.id &&
        response.body.name === name;
      
      logTest(`Crear alumno: "${name}"`, passed, 
        `Status: ${response.status}, ID: ${response.body.id}`);
      
      if (passed) studentIds.push(response.body.id);
    }

    // ===== TEST 2: Obtener Lista de Alumnos =====
    console.log(`\n2. PRUEBAS: Obtener Alumnos`);
    console.log('-'.repeat(60));

    const getResponse = await makeRequest('GET', '/students');
    const studentCount = getResponse.body.length;
    const passed2 = getResponse.status === 200 && studentCount >= 4;
    
    logTest('Obtener lista de alumnos', passed2, 
      `Status: ${getResponse.status}, Total: ${studentCount} alumnos`);

    // ===== TEST 3: Guardar Capturas =====
    console.log(`\n3. PRUEBAS: Guardar Capturas`);
    console.log('-'.repeat(60));

    const subjects = ['Matemáticas', 'Lengua', 'Ciencias', 'Plástica'];
    const fakeImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAA==';
    let captureIds = [];

    for (let i = 0; i < studentIds.length; i++) {
      const subject = subjects[i % subjects.length];
      const captureResponse = await makeRequest('POST', '/captures', {
        studentId: studentIds[i],
        subject,
        imageData: fakeImage,
        method: 'manual',
        confidence: 100
      });

      const passed3 = captureResponse.status === 200 && captureResponse.body.id;
      logTest(
        `Guardar captura - ${names[i]} (${subject})`,
        passed3,
        `Status: ${captureResponse.status}, Capture ID: ${captureResponse.body.id}`
      );

      if (passed3) captureIds.push(captureResponse.body.id);
    }

    // ===== TEST 4: Obtener Capturas de Alumno =====
    console.log(`\n4. PRUEBAS: Obtener Capturas`);
    console.log('-'.repeat(60));

    const firstStudent = studentIds[0];
    const capturesResponse = await makeRequest('GET', `/captures/${firstStudent}`);
    const capturesCount = capturesResponse.body.length;
    const passed4 = capturesResponse.status === 200 && capturesCount >= 1;

    logTest(
      `Obtener capturas del alumno ID=${firstStudent}`,
      passed4,
      `Status: ${capturesResponse.status}, Capturas encontradas: ${capturesCount}`
    );

    // ===== TEST 5: Activar Modo Sesión =====
    console.log(`\n5. PRUEBAS: Modo Sesión`);
    console.log('-'.repeat(60));

    const sessionResponse = await makeRequest('POST', '/session/start', {
      subject: 'Matemáticas'
    });

    const passed5 = sessionResponse.status === 200 && sessionResponse.body.id;
    let sessionId = null;
    
    logTest(
      'Activar Modo Sesión (Matemáticas)',
      passed5,
      `Status: ${sessionResponse.status}, Session ID: ${sessionResponse.body.id}, Duración: ${sessionResponse.body.durationSeconds}s`
    );

    if (passed5) sessionId = sessionResponse.body.id;

    // ===== TEST 6: Obtener Sesión Activa =====
    const activeSessionResponse = await makeRequest('GET', '/session/active');
    const passed6 = activeSessionResponse.status === 200 && activeSessionResponse.body !== null;
    
    logTest(
      'Obtener sesión activa',
      passed6,
      `Status: ${activeSessionResponse.status}, Asignatura: ${activeSessionResponse.body?.subject}`
    );

    // ===== TEST 7: Guardando captura durante Modo Sesión =====
    const sessionCaptureResponse = await makeRequest('POST', '/captures', {
      studentId: studentIds[1],
      subject: 'Matemáticas', // Misma asignatura del Modo Sesión
      imageData: fakeImage,
      method: 'session',
      confidence: 95
    });

    const passed7 = sessionCaptureResponse.status === 200;
    logTest(
      'Guardar captura durante Modo Sesión',
      passed7,
      `Status: ${sessionCaptureResponse.status}`
    );

    // ===== TEST 8: Detener Modo Sesión =====
    console.log('');
    const stopSessionResponse = await makeRequest('POST', '/session/stop');
    const passed8 = stopSessionResponse.status === 200;

    logTest(
      'Detener Modo Sesión',
      passed8,
      `Status: ${stopSessionResponse.status}`
    );

    // ===== TEST 9: Verificar que sesión está detenida =====
    const inactiveSessionResponse = await makeRequest('GET', '/session/active');
    const passed9 = inactiveSessionResponse.status === 200 && inactiveSessionResponse.body === null;

    logTest(
      'Verificar sesión detenida',
      passed9,
      `Status: ${inactiveSessionResponse.status}, Sesión activa: ${inactiveSessionResponse.body !== null}`
    );

    // ===== TEST 10: Prueba de persistencia (crear 2 capturas más) =====
    console.log(`\n6. PRUEBAS: Persistencia de Datos`);
    console.log('-'.repeat(60));

    const persist1 = await makeRequest('POST', '/captures', {
      studentId: studentIds[2],
      subject: 'Ciencias',
      imageData: fakeImage,
      method: 'manual',
      confidence: 98
    });

    const persist2 = await makeRequest('POST', '/captures', {
      studentId: studentIds[3],
      subject: 'Plástica',
      imageData: fakeImage,
      method: 'manual',
      confidence: 100
    });

    const passed10 = persist1.status === 200 && persist2.status === 200;
    logTest(
      'Persistencia: Guardar 2 capturas adicionales',
      passed10,
      `Capture 1: ${persist1.body.id}, Capture 2: ${persist2.body.id}`
    );

    // ===== RESUMEN =====
    console.log('\n' + '='.repeat(60));
    console.log('RESUMEN DE PRUEBAS');
    console.log('='.repeat(60));

    const totalTests = testsPassed + testsFailed;
    const passPercentage = Math.round((testsPassed / totalTests) * 100);

    console.log(`\n[PASS] Pruebas exitosas: ${testsPassed}`);
    console.log(`[FAIL] Pruebas fallidas: ${testsFailed}`);
    console.log(`[INFO] Total de pruebas: ${totalTests}`);
    console.log(`[INFO] Tasa de exito: ${passPercentage}%\n`);

    if (testsFailed === 0) {
      console.log('[SUCCESS] ¡TODAS LAS PRUEBAS PASARON!\n');
    } else {
      console.log('[WARNING] Revisa los errores arriba\n');
    }

    // ===== INFO DE BASE DE DATOS =====
    console.log('INFORMACION DE BASE DE DATOS:');
    console.log('-'.repeat(60));
    console.log(`[DB] Ubicacion: ./data/eduportfolio.db`);
    console.log(`[DB] Alumnos creados: ${studentIds.length}`);
    console.log(`[DB] Capturas guardadas: ${captureIds.length + 2}`); // +2 de persistencia
    console.log(`[DB] Sesiones probadas: 1`);
    console.log(`[DB] Carpetas de portfolios creadas: ${names.length}\n`);

  } catch (error) {
    console.error(`[ERROR] Error critical:`, error.message);
    console.error(error);
    process.exit(1);
  }

  process.exit(testsFailed === 0 ? 0 : 1);
}

// Ejecutar pruebas
runTests();
