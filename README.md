# 📚 EduPortfolio

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3.x-003B57?logo=sqlite)](https://www.sqlite.org/)
[![Electron](https://img.shields.io/badge/Electron-33.x-47848F?logo=electron)](https://www.electronjs.org/)

> **Sistema autónomo de captura y clasificación de evidencias educativas con IA local y privacidad por diseño**

EduPortfolio es una solución innovadora que digitaliza automáticamente los trabajos escolares de alumnos de Infantil y Primaria, utilizando reconocimiento facial, visión por computador e inteligencia artificial, todo procesado localmente sin conexión a internet. Eduportfolio (versión escritorio) Forma parte de la segunda fase de un proyecto que conforma dos aplicaciones que pueden trabajar conjuintamente: [una aplicación móvil](https://github.com/introlinux/eduportfolio-mobile) y ésta de escritorio.

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
- [Guía para IAs](#-guía-para-ias)
- [Licencia](#-licencia)

---

## 🎯 Descripción General

EduPortfolio (versión de escritorio) es un **kiosko digital autónomo** diseñado para entornos de Educación Infantil y Primaria. Permite que los alumnos digitalicen sus trabajos de forma autónoma mientras el sistema se encarga de organizarlos automáticamente.

### 🔐 Privacidad por Diseño
El proyecto adopta un paradigma **Local-First**, garantizando que:
- ✅ Todos los datos se procesan y almacenan en el dispositivo local.
- ✅ No hay conexión a servidores externos ni servicios en la nube.
- ✅ Los datos biométricos permanecen en el equipo.
- ✅ Cumplimiento con normativas de protección de datos (RGPD).

---

## 🚀 Estado del Desarrollo

Actualmente el proyecto se encuentra en la **Fase 3 (Versión Desktop/OpenCV)**.

### ✅ Fase 1: Web Base (COMPLETADA)
- Backend Express.js + API REST + SQLite.
- Frontend responsive (Panel de Profesor, Alumno y Galería).
- Captura de imágenes desde webcam y clasificación manual.

### ✅ Fase 2: IA y Automatización (COMPLETADA)
- Integración de **face-api.js** y **TensorFlow.js**.
- Identificación por rostro para login sin contraseña.
- Sistema de entrenamiento facial integrado.

### 🔄 Fase 3: Visión Avanzada y Desktop (EN PROGRESO)
- Empaquetado como aplicación de escritorio con **Electron**.
- Procesamiento de imagen en cliente con **OpenCV.js** (Corrección de perspectiva).
- Clasificación automática mediante marcadores (Gomets/Letras).

---

## ✨ Características Principales

### 👶 Perfil Alumno
- **Interfaz Guiada**: Instrucciones visuales y (planificado) de voz.
- **Captura Inteligente**: Silueta guía para el posicionamiento correcto del documento.
- **Login Facial**: Identificación automática del alumno mediante la cámara.

### 👨‍🏫 Perfil Docente
- **Organización Automática**: Los archivos se guardan en carpetas por alumno y asignatura.
- **Modo Sesión**: Permite fijar una asignatura para procesar lotes de trabajos rápidamente.
- **Mantenimiento**: Herramientas de sincronización de archivos y limpieza de base de datos.
- **Galería de Evidencias**: Visualización organizada de los trabajos capturados.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología | Propósito |
|------|------------|-----------|
| **Core** | Electron | Aplicación de escritorio multiplataforma |
| **Backend** | Node.js / Express.js | Lógica de servidor y API REST |
| **Frontend** | HTML5 / CSS3 / Vanilla JS | Interfaz de usuario responsive |
| **Base de Datos**| SQLite | Almacenamiento local de metadatos y descriptores faciales |
| **IA/Visión** | TensorFlow.js / OpenCV.js | Reconocimiento facial y análisis de imagen |
| **Visión (Face)** | face-api.js | Detección y reconocimiento de rostros |

---

## 📁 Estructura del Proyecto

```
eduportfolio-web/
├── src/
│   ├── main.js                # Punto de entrada de Electron
│   ├── server.js              # Servidor Express + API REST
│   └── faceDatabase.js        # Gestión de descriptores faciales en SQLite
├── public/
│   ├── index.html             # Interfaz principal
│   ├── styles.css             # Estilos CSS
│   ├── app.js                 # Lógica principal del cliente
│   ├── faceRecognition.js     # Lógica de face-api.js
│   ├── documentProcessor.js   # Procesamiento con OpenCV.js
│   ├── imageClassification.js # Detección de marcadores con TF.js
│   └── opencv.js              # Binario de OpenCV para la web
├── data/
│   └── eduportfolio.db        # Base de datos SQLite (alumnos, capturas, rostros)
├── portfolios/                # Almacenamiento de evidencias
│   ├── _temporal_             # Capturas pendientes de clasificación
│   └── [nombre_id]/           # Carpetas organizadas por alumno
├── package.json               # Scripts de ejecución/construcción y dependencias
├── AGENTS.md                  # Guía de desarrollo para asistentes de IA
└── README.md                  # Este archivo
```

---

## 🚀 Instalación y Uso

### 1. Requisitos Previos
- **Node.js**: v20.x LTS o superior.
- **npm**: v10.x o superior.

### 2. Instalación
```bash
# Instalar dependencias
npm install
```

### 3. Ejecución

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

---

## 🔌 API REST

### Alumnos
- `GET /api/students`: Lista de alumnos activos.
- `POST /api/students`: Registrar nuevo alumno.
- `DELETE /api/students/:id`: Inactivar alumno y borrar sus datos faciales.

### Capturas y Clasificación
- `POST /api/captures`: Guardar captura clasificada en el portfolio.
- `GET /api/captures/:studentId`: Ver evidencias de un alumno.
- `POST /api/system/temp-capture`: Guardar captura en carpeta temporal (`_temporal_`).
- `GET /api/system/pending`: Listar archivos en la carpeta temporal.
- `POST /api/system/move`: Clasificar un archivo pendiente moviéndolo al portfolio.

### Reconocimiento Facial
- `POST /api/faces/train`: Entrenar/Actualizar perfil facial de un estudiante.
- `POST /api/faces/search`: Buscar alumno mediante descriptor facial.
- `GET /api/faces/:studentId`: Consultar estado del perfil facial.
- `DELETE /api/faces/:studentId`: Resetear datos faciales de un alumno.

### Gestión y Sesiones
- `GET /api/session/active`: Consultar sesión docente activa.
- `POST /api/session/start`: Iniciar modo sesión (asignatura fija).
- `POST /api/session/stop`: Detener modo sesión.
- `POST /api/system/sync`: Sincronizar archivos locales con la base de datos.
- `POST /api/system/reset`: Limpieza masiva de fotos o alumnos.

---

## 📊 Base de Datos (SQLite)

El sistema utiliza las siguientes tablas principales:
1. **students**: Información personal y estado del alumno.
2. **captures**: Metadatos de los trabajos, rutas de archivos y confianza de la clasificación.
3. **sessions**: Registro de sesiones de trabajo docente.
4. **face_profiles**: Descriptores biométricos (tensores de 128 dimensiones) para el reconocimiento facial.

---

## 🤖 Guía para IAs
Este proyecto incluye un archivo [AGENTS.md](file:///Users/minino/Downloads/eduportfolio-web/AGENTS.md) con reglas estrictas de Clean Architecture, SOLID y Clean Code que deben seguir todos los asistentes de IA que colaboren en el desarrollo.

---

## � Autor

**Antonio Sánchez León**
- 📧 Email: [introlinux@gmail.com](mailto:introlinux@gmail.com)
- 🐙 GitHub: [introlinux](https://github.com/introlinux)

---

## �📄 Licencia

Este proyecto está bajo la licencia **MIT**. Consulte el archivo `LICENSE` para más detalles.

---
*Última actualización: Febrero 2026*
