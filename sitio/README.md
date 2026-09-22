# Guía de instalación — Acreditación de contratistas v1-0

Tiempo estimado: 30 minutos. No hace falta saber programar: se copia y se pega.

Al terminar tendrás:
- Una **página web** en GitHub Pages donde los contratistas entran con su RUC y cargan documentos.
- Una **hoja de Google** con tres pestañas (empresas, solicitudes, documentos) donde queda cada registro.
- Una **carpeta de Google Drive** con los archivos, ordenados así:
  `Acreditación de contratistas — archivos / Grupo Pana / 20123456786 - EMPRESA SAC / 2026-10-01 - Actividad (abc123)`

> **Piloto con datos ficticios.** Esta instalación usa una cuenta de Gmail temporal. No cargues DNI, CAMO ni documentos reales de contratistas hasta migrar a la cuenta de la empresa con conocimiento de TI.

---

## Parte 1 — El servidor en Google (15 min)

### 1. Crea una cuenta de Gmail solo para el piloto
Por ejemplo `piloto.acreditacion.sst@gmail.com`. No uses tu cuenta personal: todo lo que se cargue quedará en esta cuenta.

### 2. Crea el proyecto
1. Con esa cuenta, entra a **script.google.com** y pulsa **Nuevo proyecto**.
2. Arriba a la izquierda, cambia "Proyecto sin título" por **Acreditación contratistas**.
3. Borra todo lo que hay en el archivo `Código.gs`.
4. Abre el archivo `apps-script/Code.gs` de este paquete, copia todo su contenido y pégalo.
5. Guarda con el ícono del disquete o Ctrl + S.

### 3. Ejecuta la configuración (una sola vez)
1. En la barra superior, en el selector de funciones, elige **configurar**.
2. Pulsa **Ejecutar**.
3. Google pedirá permisos: **Revisar permisos**, elige la cuenta del piloto.
4. Aparecerá "Google no ha verificado esta aplicación". Es normal: el script es tuyo y no está publicado para terceros. Pulsa **Configuración avanzada**, luego **Ir a Acreditación contratistas**, y después **Permitir**.
5. Abajo, en el **Registro de ejecución**, verás dos enlaces: la hoja de registros y la carpeta de archivos. Ábrelos para comprobar que existen.

### 4. Define la clave de SST (recomendado)
Sin clave, cualquiera que pulse el botón "SST" de la página puede aprobar documentos.
1. En el menú de la izquierda, entra a **Configuración del proyecto** (ícono de engranaje).
2. Baja hasta **Propiedades de la secuencia de comandos** y pulsa **Editar propiedades de la secuencia de comandos**.
3. En `SST_CLAVE` escribe una clave larga (por ejemplo, una frase de 4 palabras). Guarda.

La clave vive solo en Google: no aparece en la página ni en GitHub. Para cambiarla, repite este paso; no hace falta volver a implementar.

### 5. Publica el servidor
1. Arriba a la derecha: **Implementar**, luego **Nueva implementación**.
2. En el engranaje de "Seleccionar tipo", elige **Aplicación web**.
3. Configura:
   - **Ejecutar como:** Yo (la cuenta del piloto)
   - **Quién tiene acceso:** Cualquier usuario *(en inglés: "Anyone"; la etiqueta puede variar ligeramente)*
4. Pulsa **Implementar** y copia la **URL de la aplicación web**. Termina en `/exec`.

### 6. Comprueba que responde
Pega esa URL en el navegador. Debes ver algo como:
```
{"ok":true,"servicio":"acreditacion-contratistas","version":"v1-0","configurado":true}
```
Si dice `"configurado":false`, vuelve al paso 3.

---

## Parte 2 — La página en GitHub (10 min)

### 7. Crea el repositorio
1. En **github.com**, pulsa **New repository**.
2. Nombre: `acreditacion-contratistas`. Visibilidad: **Public**. En una cuenta gratuita, GitHub Pages solo funciona con repositorios públicos. El código no contiene claves ni datos.
3. Pulsa **Create repository**.

### 8. Sube los archivos
1. En el repositorio vacío, pulsa **uploading an existing file**.
2. Arrastra el **contenido** de la carpeta `sitio/`, no la carpeta: `index.html`, `config.js`, la carpeta `documentos/` y `.nojekyll`. La carpeta `apps-script/` y esta guía son opcionales.
3. Pulsa **Commit changes**.

### 9. Conecta la página con el servidor
1. En el repositorio, abre `config.js` y pulsa el lápiz para editar.
2. Pega tu URL entre las comillas de `API_URL`:
   ```js
   API_URL: "https://script.google.com/macros/s/AKfy.../exec",
   ```
3. Pulsa **Commit changes**.

### 10. Activa GitHub Pages
1. **Settings**, luego **Pages**.
2. En **Source**, elige **Deploy from a branch**; en Branch elige **main** y **/ (root)**. Pulsa **Save**.
3. En 1 o 2 minutos aparecerá la dirección: `https://TU-USUARIO.github.io/acreditacion-contratistas/`.

---

## Parte 3 — Lista de verificación

Haz estas pruebas en orden, solo con datos ficticios. Son las partes que no se pudieron probar contra los servicios reales de Google.

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Abre la página | Aparece el aviso **"Piloto en prueba"**. Si dice "Versión de demostración", `config.js` no tiene la URL. |
| 2 | Entra con RUC `20123456786` y razón social `EMPRESA DE PRUEBA SAC`. Crea una solicitud y sube un PDF | En la hoja, pestaña **documentos**, aparece una fila. En Drive, el archivo en su carpeta. |
| 3 | Abre la página en tu celular con el mismo RUC | Ves la misma solicitud y el mismo documento. |
| 4 | Entra con otro RUC: `20100070970` | No ves nada de la empresa anterior. |
| 5 | Pulsa **SST** e ingresa la clave. Observa el documento con un comentario | En la hoja, la fila cambia a `observado`. |
| 6 | Vuelve como contratista (RUC `20123456786`) | El documento aparece **Observado**, con el comentario. |
| 7 | Descarga el RISST desde el requisito de cargos | Se descarga el PDF completo. |

**Si en la prueba 2 aparece "No se pudo conectar con el servidor":**
- Revisa que en el paso 5 "Quién tiene acceso" sea **Cualquier usuario**.
- Revisa que la URL en `config.js` termine en `/exec` (no en `/dev`) y esté entre comillas.
- Si todo está bien y sigue fallando, avisa: hay un plan alternativo, que es servir la página desde el mismo Apps Script en lugar de GitHub.

---

## Mantenimiento

**Cambiar requisitos, sedes o textos:** se edita `index.html`, en el bloque `CATÁLOGO` al inicio del script. Guarda y GitHub publica solo.

**Actualizar el servidor después de cambiar `Code.gs`:** **Implementar**, luego **Gestionar implementaciones**, lápiz, en **Versión** elige **Nueva versión**, y **Implementar**. La URL no cambia. Si creas una *nueva* implementación en lugar de editar la existente, la URL cambia y hay que actualizar `config.js`.

**Revisar sin la app:** SST puede trabajar directamente en la hoja (filtrar por RUC, por estado) y en la carpeta de Drive. Evita editar a mano las columnas `id`, `solicitudId` y `driveId`: son las que enlazan todo.

**Un documento quitado por error:** está en la papelera de Drive de la cuenta del piloto y se puede restaurar. La fila de la hoja sí se borra; los datos del archivo (nombre, tipo, trabajador) están en el nombre del archivo en Drive.

---

## Lo que esta versión no hace (decisión del piloto)
- No envía correos: SST revisa entrando a la app o a la hoja.
- No guarda un historial de cambios, solo la fecha de la última revisión.
- El contratista entra solo con el RUC: quien conozca un RUC puede ver y quitar los documentos de esa empresa.
