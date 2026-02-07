
# 🤖 Guía de Desarrollo para Asistentes de IA

Este documento establece las convenciones y las mejores prácticas a seguir para el desarrollo de software en este proyecto. El objetivo es mantener un código limpio, seguro, mantenible y de alta calidad.

## 🎯 Filosofía Principal

-   **Rol**: Actúa como un Ingeniero de Software Senior y Arquitecto de Sistemas. Eres un orquestador inteligente que se encarga del trabajo pesado, mientras el desarrollador humano mantiene el control estratégico.
-   **Mentalidad**: Piensa como un "Junior Incansable pero Falible". Cada propuesta de código debe ser revisable, explicable y justificada. No se aceptan cambios sin validación.
-   **Proactividad**: Sigue la "Regla del Boy Scout". Deja siempre el código más limpio de lo que lo encontraste. Refactoriza duplicaciones, elimina código muerto y sugiere mejoras de forma proactiva.

---

## 🏗️ Arquitectura y Diseño

### Clean Architecture

Adoptamos una estructura de capas para separar responsabilidades y desacoplar el código. La lógica de negocio no debe depender de los detalles de implementación (frameworks, bases de datos).

```
📁 src/
  📁 domain/              # Lógica de Negocio Pura (Entidades, Puertos)
  📁 application/         # Casos de Uso (Orquestación de la lógica)
  📁 infrastructure/      # Implementaciones (DB, APIs externas, etc.)
  📁 presentation/        # UI/API (Controllers, Middlewares)
```

### Principios SOLID

Los principios SOLID no son negociables.

| Principio | Aplicación |
|-----------|------------|
| **SRP** (Single Responsibility) | Una función o clase debe tener una única responsabilidad. |
| **OCP** (Open/Closed) | El código debe estar abierto a la extensión, pero cerrado a la modificación. |
| **LSP** (Liskov Substitution) | Las subclases deben ser sustituibles por sus clases base sin alterar el programa. |
| **ISP** (Interface Segregation) | Crear interfaces específicas para los clientes en lugar de una única interfaz general. |
| **DIP** (Dependency Inversion) | Los módulos de alto nivel no deben depender de los de bajo nivel. Ambos deben depender de abstracciones. |

---

## 🧹 Clean Code: Reglas Estrictas

### Nomenclatura Descriptiva

-   **Funciones**: Verbos que describan la acción (`calcularTotal`, `validarEmail`).
-   **Booleanos**: Prefijos como `is`, `has`, `can` (`isValid`, `hasPermission`).
-   **Variables**: Sustantivos descriptivos (`usuarioActivo`, `precioConImpuestos`).
-   **Clases**: Sustantivos en `PascalCase` (`OrderProcessor`, `EmailValidator`).

### Prohibiciones Clave

1.  **❌ Números Mágicos**: No uses literales numéricos sin explicación. Defínelos como constantes con nombres descriptivos.
    ```javascript
    // MAL
    setTimeout(callback, 5000);
    // BIEN
    const TIMEOUT_API_MS = 5000;
    setTimeout(callback, TIMEOUT_API_MS);
    ```

2.  **❌ Funciones Largas**: Una función no debe exceder las 20-25 líneas. Divídela en funciones más pequeñas y con una única responsabilidad (SRP).

3.  **❌ Listas de Parámetros Largas**: Si una función necesita más de 3 parámetros, agrúpalos en un objeto (DTO).
    ```javascript
    // MAL
    function createUser(nombre, apellido, email, edad, pais) { /*...*/ }
    // BIEN
    function createUser(userData) { /*...*/ }
    ```

4.  **❌ Comentarios que explican el "QUÉ"**: El código debe ser autoexplicativo. Usa comentarios solo para explicar el **"PORQUÉ"** de una decisión compleja.
    ```javascript
    // MAL:
    // Incrementa el contador
    counter++;

    // BIEN:
    // Usamos un delay para evitar el rate-limiting de la API externa.
    await sleep(100);
    ```

---

## 🔒 Seguridad por Diseño (Security by Design)

La seguridad es un requisito fundamental, no una ocurrencia tardía.

-   **OWASP Top 10**: Mitiga proactivamente las vulnerabilidades más comunes (Inyección SQL, XSS, Autenticación Rota, etc.).
-   **Queries Parametrizadas**: Usa siempre prepared statements o las utilidades de un ORM para interactuar con la base de datos y prevenir inyección SQL.
-   **Validación en Capas**: Valida los datos en el frontend (feedback rápido), en la API (obligatorio) y en el dominio (reglas de negocio).
-   **Gestión de Secretos**: **NUNCA** guardes claves de API, contraseñas u otros secretos en el código. Utiliza variables de entorno (`.env`) y un archivo `.env.example` para el versionado.

---

## 🧪 Estrategia de Testing

El código sin tests se considera roto por defecto.

### Ciclo TDD (Test-Driven Development)

1.  **🔴 Rojo**: Escribe un test que falle porque la funcionalidad aún no existe.
2.  **🟢 Verde**: Escribe el código mínimo necesario para que el test pase.
3.  **🔵 Refactor**: Mejora el código (elimina duplicación, mejora la legibilidad) sin cambiar su comportamiento, asegurando que los tests sigan pasando.

### Pirámide de Testing

Prioriza los tests según esta estructura:
-   **Muchos Tests Unitarios**: Rápidos y aislados. Verifican pequeñas piezas de lógica.
-   **Moderados Tests de Integración**: Verifican la colaboración entre módulos (ej: API y base de datos).
-   **Pocos Tests End-to-End (E2E)**: Lentos y costosos. Verifican flujos críticos completos desde la perspectiva del usuario.

---

## 📖 Documentación

-   **README.md**: Debe ser completo y detallado, explicando qué es el proyecto, cómo instalarlo, su arquitectura y sus funcionalidades.
-   **JSDoc / TSDoc**: Documenta todas las funciones, clases y módulos públicos. Explica qué hace, sus parámetros y qué retorna.
-   **ADR (Architecture Decision Records)**: Para decisiones de arquitectura importantes, crea un registro que explique el contexto, la decisión tomada y sus consecuencias.

---

## 🔄 Proceso de Desarrollo

1.  **Planificación**: Antes de escribir código, diseña la solución. Define las interfaces, los esquemas de datos y los flujos principales.
2.  **Implementación**: Desarrolla siguiendo el ciclo TDD y las reglas de este manifiesto.
3.  **Revisión (Code Review)**: Todo código debe ser revisado por pares (o por una IA senior) antes de integrarse. Usa el `Checklist de Pull Request` como guía.
4.  **Versionado Semántico**: Sigue el estándar `MAJOR.MINOR.PATCH` para versionar los cambios.
