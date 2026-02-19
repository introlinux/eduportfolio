# 📚 EduPortfolio

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3.x-003B57?logo=sqlite)](https://www.sqlite.org/)
[![Electron](https://img.shields.io/badge/Electron-33.x-47848F?logo=electron)](https://www.electronjs.org/)
[![Version](https://img.shields.io/badge/Version-0.3.0-blue)](https://github.com/introlinux/eduportfolio)

> **Kiosko digital autónomo de captura y clasificación de evidencias educativas con IA local y privacidad por diseño**

EduPortfolio (versión escritorio) es la segunda pieza de un sistema de dos aplicaciones diseñadas para trabajar conjuntamente: [la aplicación móvil](https://github.com/introlinux/eduportfolio-mobile) y este **Kiosko de Evidencias** de escritorio. Toda la IA y el almacenamiento se procesan localmente, sin conexión a internet.

---

## 📑 Tabla de Contenidos

- [Descripción General](#-descripción-general)
- [Estado del Desarrollo](#-estado-del-desarrollo)
- [Características Principales](#-características-principales)
- [Stack Tecnológico](#-stack-tecnológico)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Instalación y Uso](#-instalación-y-uso)
- [API REST](#-api-rest)
- [Base de Datos](#-base-de-datos)
- [Seguridad y Cifrado](#-seguridad-y-cifrado)
- [Sincronización con Móvil](#-sincronización-con-móvil)
- [Guía para IAs](#-guía-para-ias)
- [Licencia](#-licencia)

---

## 🎯 Descripción General

EduPortfolio (versión de escritorio) es un **kiosko digital autónomo** diseñado para entornos de Educación Infantil y Primaria. Permite que los alumnos digitalicen sus trabajos de forma autónoma mientras el sistema los organiza automáticamente, y permite sincronizar el contenido con la aplicación móvil del docente.

### 🔐 Privacidad por Diseño
El proyecto adopta un paradigma **Local-First**, garantizando que:
- ✅ Todos los datos se procesan y almacenan en el dispositivo local.
- ✅ No hay conexión a servidores externos ni servicios en la nube.
- ✅ Los datos biométricos permanecen en el equipo.
- ✅ Las imágenes del portfolio se cifran automáticamente en reposo.
- ✅ Cumplimiento con normativas de protección de datos (RGPD).

---

## 🚀 Estado del Desarrollo

### ✅ Fase 1: Web Base (COMPLETADA)
- Backend Express.js + API REST + SQLite.
- Frontend responsive (Panel de Docente, de Estudiante y Galería).
- Captura de imágenes desde webcam y clasificación manual.

### ✅ Fase 2: IA, Automatización y Desktop (COMPLETADA)
- Integración de **face-api.js** y **TensorFlow.js**.
- Identificación por rostro para login sin contraseña.
- Sistema de entrenamiento facial integrado.
- Empaquetado como aplicación de escritorio con **Electron**.
- **Sincronización bidireccional** con la aplicación móvil vía WiFi.
- **Sistema de cifrado** de imágenes del portfolio (AES-256).
- **Gestión de cursos** y **asignaturas** (CRUD completo).
- Página de login con contraseña para proteger el acceso.

### 🔄 Fase 3: Visión Avanzada (EN PROGRESO)
- Procesamiento de imagen con **OpenCV.js** (corrección de perspectiva).
- Clasificación automática mediante marcadores (gomets/letras).
- OCR con **Tesseract.js** para texto en imágenes.

---

## ✨ Características Principales

### 👶 Perfil Estudiante
- **Interfaz Guiada**: Instrucciones visuales para posicionar documentos.
- **Captura Inteligente**: Silueta guía para el posicionamiento correcto del documento.
- **Login Facial**: Identificación automática del alumno mediante la cámara.

### 👨‍🏫 Perfil Docente
- **Organización Automática**: Evidencias guardadas y cifradas por alumno y asignatura.
- **Modo Sesión**: Permite fijar una asignatura para procesar lotes de trabajos rápidamente.
- **Gestión de Cursos**: Alta, archivo y eliminación de cursos escolares.
- **Gestión de Asignaturas**: CRUD completo con iconos y colores personalizados.
- **Galería de Evidencias**: Visualización organizada con selección múltiple y exportación ZIP cifrado.
- **Sincronización con Móvil**: Recibe y fusiona evidencias de la app móvil del docente vía WiFi.

### 🔒 Seguridad
- **Login con contraseña** para acceder al sistema.
- **Cifrado AES-256** automático de imágenes del portfolio tras la captura.
- **Desencriptado on-demand** en memoria (sin archivos temporales en claro).
- **Baúl bloqueable** manualmente: recifra todas las imágenes al bloquear.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología | Versión | Propósito |
|------|------------|---------|-----------|
| **Core** | Electron | 33.x | Aplicación de escritorio multiplataforma |
| **Backend** | Node.js / Express.js | 20.x | Lógica de servidor y API REST |
| **Frontend** | HTML5 / CSS3 / Vanilla JS | — | Interfaz de usuario responsive |
| **Base de Datos** | SQLite (sqlite3) | 5.x | Almacenamiento local de metadatos |
| **IA/Visión** | TensorFlow.js | 4.x | Clasificación y análisis de imagen |
| **Reconocimiento Facial** | face-api.js | 0.22.x | Detección e identificación de rostros |
| **Visión por Computador** | OpenCV.js | — | Corrección de perspectiva |
| **OCR** | Tesseract.js | 4.x | Reconocimiento óptico de caracteres |
| **Cifrado** | Node.js crypto (AES-256) | — | Cifrado de imágenes en reposo |
| **Compresión/Exportación** | archiver + archiver-zip-encrypted | 6.x | ZIPs cifrados para exportar portfolio |

---

## 📁 Estructura del Proyecto

```
eduportfolio/
├── src/
│   ├── main.js                  # Punto de entrada de Electron
│   ├── server.js                # Servidor Express + API REST (>2700 líneas)
│   ├── faceDatabase.js          # Gestión de descriptores faciales en SQLite
│   ├── crypto-manager.js        # Cifrado/descifrado AES-256 de archivos
│   ├── portfolio-vault.js       # Gestión del baúl cifrado (lock/unlock)
│   ├── decryption-cache.js      # Caché en memoria de imágenes descifradas
│   └── password-manager.js      # Gestión y verificación de contraseña maestra
├── public/
│   ├── index.html               # Interfaz principal (docente y estudiante)
│   ├── login.html               # Página de autenticación con contraseña
│   ├── styles.css               # Estilos CSS
│   ├── app.js                   # Lógica principal del cliente
│   ├── faceRecognition.js       # Lógica de face-api.js
│   ├── documentProcessor.js     # Procesamiento con OpenCV.js
│   └── imageClassification.js   # Detección de marcadores con TF.js
├── data/
│   └── eduportfolio.db          # Base de datos SQLite
├── portfolios/                  # Almacenamiento de evidencias (cifradas)
│   ├── evidences/               # Capturas clasificadas (.jpg.enc)
│   └── _temporal_/              # Capturas pendientes de clasificación
├── docs/                        # Documentación técnica de sincronización
├── scripts/
│   └── generate-icons.js        # Generación de iconos para el ejecutable
├── dist/                        # Binarios compilados (Electron Builder)
├── package.json                 # Scripts y dependencias
├── AGENTS.md                    # Guía de desarrollo para asistentes de IA
└── README.md                    # Este archivo
```

---

## 🚀 Instalación y Uso

### 1. Descarga de Binarios Ejecutables (Opción Recomendada)

Descarga los binarios precompilados (Windows/Linux):

**📥 [Descargar EduPortfolio (Versión Escritorio)](https://drive.google.com/drive/folders/1BJdJ9gIO39UN28UjLXMRDaEhdnPvmFJZ?usp=drive_link)**

### 2. Requisitos Previos (Para Compilar desde Código Fuente)
- **Node.js**: v20.x LTS o superior.
- **npm**: v10.x o superior.

### 3. Instalación
```bash
# Instalar dependencias
npm install

# Reconstruir módulos nativos para Electron (necesario la primera vez)
npm run rebuild
```

### 4. Ejecución

#### Modo Desarrollo (Navegador)
```bash
# Iniciar el servidor web
npm run dev
```
La aplicación estará disponible en: **http://localhost:3000**

#### Modo Desktop (Electron)
```bash
# Iniciar en modo escritorio
npm run electron:dev
```

### 5. Compilar Ejecutable

```bash
# Windows (instalador NSIS + portable)
npm run electron:build:win

# Linux (tar.gz + zip)
npm run electron:build:linux

# Ambas plataformas
npm run electron:build:all
```

---

## 🔌 API REST

### Autenticación y Seguridad
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/auth/status` | Estado de autenticación y configuración del baúl |
| `POST` | `/api/auth/setup` | Configurar contraseña inicial (solo primera vez) |
| `POST` | `/api/auth/login` | Iniciar sesión con contraseña |
| `POST` | `/api/auth/change-password` | Cambiar contraseña maestra |
| `POST` | `/api/vault/lock` | Bloquear el baúl (cifra todas las imágenes) |
| `GET` | `/api/vault/stats` | Estadísticas del baúl y caché de desencriptado |

### Estudiantes
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/students` | Lista de estudiantes activos con estado facial |
| `POST` | `/api/students` | Registrar nuevo estudiante |
| `DELETE` | `/api/students/:id` | Inactivar estudiante y borrar datos faciales |

### Cursos
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/courses` | Lista de cursos escolares |
| `POST` | `/api/courses` | Crear nuevo curso |
| `PUT` | `/api/courses/:id/archive` | Archivar un curso |
| `PUT` | `/api/courses/:id/reactivate` | Reactivar un curso archivado |
| `DELETE` | `/api/courses/:id` | Eliminar completamente un curso |

### Asignaturas
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/subjects` | Lista de asignaturas |
| `POST` | `/api/subjects` | Crear asignatura |
| `PUT` | `/api/subjects/:id` | Editar asignatura |
| `DELETE` | `/api/subjects/:id` | Eliminar asignatura |

### Evidencias y Capturas
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/captures` | Guardar captura clasificada (se cifra automáticamente) |
| `GET` | `/api/captures` | Todas las evidencias (galería global) |
| `GET` | `/api/captures/:studentId` | Evidencias de un alumno concreto |
| `DELETE` | `/api/evidences/:id` | Eliminar evidencia individual |
| `DELETE` | `/api/evidences/batch` | Eliminar varias evidencias |
| `POST` | `/api/evidences/batch/export` | Exportar evidencias como ZIP (cifrado opcional) |
| `POST` | `/api/evidences/batch/decrypt` | Desencriptar evidencias seleccionadas |

### Reconocimiento Facial
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/faces/train` | Entrenar/actualizar perfil facial de un estudiante |
| `POST` | `/api/faces/search` | Identificar alumno por descriptor facial |
| `GET` | `/api/faces/:studentId` | Estado del perfil facial |
| `DELETE` | `/api/faces/:studentId` | Eliminar perfil facial |

### Sesiones Docente
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/session/active` | Consultar sesión activa |
| `POST` | `/api/session/start` | Iniciar modo sesión (asignatura fija) |
| `POST` | `/api/session/stop` | Detener modo sesión |

### Sincronización con Móvil
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/sync/metadata` | Metadatos para sincronización (estudiantes, evidencias, cursos) |
| `POST` | `/api/sync/push` | Recibir datos del móvil (merge inteligente sin duplicados) |
| `POST` | `/api/sync/files` | Recibir archivo multimedia del móvil |
| `GET` | `/api/sync/files/:filename` | Servir archivo al móvil |

### Sistema
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/system/info` | Información del sistema (IP local, versión) |
| `GET` | `/api/system/stats` | Estadísticas de uso |
| `GET` | `/api/system/pending` | Archivos en carpeta temporal pendientes |
| `POST` | `/api/system/temp-capture` | Guardar captura en carpeta temporal |
| `POST` | `/api/system/move` | Mover archivo temporal al portfolio |
| `POST` | `/api/system/sync` | Sincronizar archivos locales con la base de datos |
| `POST` | `/api/system/reset` | Limpieza masiva (fotos o estudiantes) |

---

## 📊 Base de Datos (SQLite)

El sistema utiliza las siguientes tablas principales:

| Tabla | Propósito |
|-------|-----------|
| `courses` | Cursos escolares (nombre, fechas, estado activo) |
| `students` | Estudiantes con referencia a curso y metadatos de sync |
| `subjects` | Asignaturas con icono, color y flag de predeterminada |
| `evidences` | Evidencias multimedia (foto/vídeo/audio), rutas cifradas, metadatos |
| `sessions` | Sesiones de trabajo docente (modo asignatura fija) |
| `face_profiles` | Descriptores biométricos (128D face-api.js y 192D MobileFaceNet) |

### Notas sobre migración
La tabla `evidences` reemplaza a la antigua `captures`. El sistema incluye migraciones automáticas para bases de datos existentes.

---

## 🔒 Seguridad y Cifrado

El sistema implementa un modelo de **cifrado en reposo** para las imágenes del portfolio:

1. **Contraseña maestra**: Configurada en el primer arranque. Se almacena como hash (no en claro).
2. **Cifrado automático**: Cada imagen capturada se cifra con AES-256 al guardarse (extensión `.jpg.enc`).
3. **Desencriptado on-demand**: Las imágenes se descifran en memoria al solicitarlas, sin crear archivos temporales.
4. **Caché de desencriptado**: Las imágenes recientemente vistas se mantienen en RAM (máx. 150, TTL 30 min) para mejor rendimiento.
5. **Baúl bloqueable**: Al bloquear manualmente, todas las imágenes en claro se re-cifran.

---

## 🔄 Sincronización con Móvil

La sincronización con [EduPortfolio Mobile](https://github.com/introlinux/eduportfolio-mobile) funciona vía **WiFi en red local**:

1. La app móvil descubre el desktop por su IP (mostrada en `/api/system/info`).
2. El móvil envía sus datos al endpoint `/api/sync/push` con merge inteligente:
   - **Estudiantes**: se fusionan por nombre (case e insensible a acentos).
   - **Evidencias**: se deduplicar por `file_path` para evitar duplicados.
3. Los archivos multimedia se transfieren en paralelo vía `/api/sync/files`.

---

## 🤖 Guía para IAs
Este proyecto incluye un archivo [AGENTS.md](AGENTS.md) con reglas de Clean Architecture, SOLID y Clean Code que deben seguir todos los asistentes de IA que colaboren en el desarrollo.

---

##   Autor

**Antonio Sánchez León**
- 📧 Email: [introlinux@gmail.com](mailto:introlinux@gmail.com)
- 🐙 GitHub: [introlinux](https://github.com/introlinux)

---

##  📄 Licencia

Este proyecto está bajo la licencia **MIT**. Consulte el archivo `LICENSE` para más detalles.

---
*Última actualización: Febrero 2026*
