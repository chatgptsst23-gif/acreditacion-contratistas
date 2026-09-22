/**
 * ACREDITACIÓN DE CONTRATISTAS — servidor en Google Apps Script
 * Versión v1-0
 *
 * Qué hace:
 *   Recibe desde la página los datos y archivos que cargan los contratistas.
 *   Los registros van a una hoja de Google; los archivos, a una carpeta de Drive
 *   ordenada por empresa contratante / RUC / solicitud.
 *
 * Instalación (detalle en la guía):
 *   1. Pegar este archivo en un proyecto nuevo de Apps Script.
 *   2. Ejecutar la función configurar() una vez y aceptar los permisos.
 *   3. Implementar > Nueva implementación > Aplicación web
 *        Ejecutar como: Yo
 *        Quién tiene acceso: Cualquier usuario
 *   4. Copiar la URL que termina en /exec dentro de config.js de la página.
 *
 * Clave de SST:
 *   Configuración del proyecto > Propiedades de la secuencia de comandos > SST_CLAVE.
 *   Si queda vacía, el modo SST no pide clave.
 *
 * Acceso de contratistas:
 *   Por RUC, sin contraseña, por decisión del usuario para el piloto.
 *   Quien conozca un RUC puede ver el expediente de esa empresa.
 */

var VERSION = "v1-0";

/* Columnas de cada pestaña. Se leen por nombre de columna, no por posición:
   se pueden agregar columnas a mano sin romper nada. */
var HOJAS = {
  empresas:    ["ruc", "razonSocial", "creado"],
  solicitudes: ["id", "ruc", "contratante", "actividad", "sedes", "inicio", "fin", "nTrabajadores",
                "vehicular", "altoRiesgo", "quimicos", "equipos", "acreditada", "carpetaId",
                "creado", "actualizado"],
  documentos:  ["id", "solicitudId", "ruc", "tipoId", "titular", "nombre", "peso", "mime", "meta",
                "emision", "vencimiento", "revision", "comentario", "revisadoEn",
                "driveId", "driveUrl", "creado"]
};

var EMPRESAS = { grupopana: "Grupo Pana", panaautos: "Pana Autos" };
var REVISIONES = ["pendiente", "aprobado", "observado"];
var TAM_MAX = 10 * 1024 * 1024;                      /* 10 MB, igual que en la página */
var MIMES = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
var ZONA = "America/Lima";


/* ============================================================
   INSTALACIÓN
   ============================================================ */

/** Crea la hoja de registros y la carpeta de archivos. Se puede ejecutar más de una vez. */
function configurar() {
  var p = PropertiesService.getScriptProperties();

  var hojaId = p.getProperty("HOJA_ID");
  if (!hojaId) {
    hojaId = SpreadsheetApp.create("Acreditación de contratistas — registros").getId();
    p.setProperty("HOJA_ID", hojaId);
  }
  var ss = SpreadsheetApp.openById(hojaId);
  Object.keys(HOJAS).forEach(function (n) { prepararHoja_(ss, n); });

  var carpetaId = p.getProperty("CARPETA_ID");
  if (!carpetaId) {
    carpetaId = DriveApp.createFolder("Acreditación de contratistas — archivos").getId();
    p.setProperty("CARPETA_ID", carpetaId);
  }
  if (p.getProperty("SST_CLAVE") === null) p.setProperty("SST_CLAVE", "");

  Logger.log("Hoja de registros:   " + ss.getUrl());
  Logger.log("Carpeta de archivos: " + DriveApp.getFolderById(carpetaId).getUrl());
  Logger.log(p.getProperty("SST_CLAVE")
    ? "Clave de SST: definida."
    : "Clave de SST: VACÍA. El modo SST queda abierto hasta que la definas en Propiedades de la secuencia de comandos.");
}

function prepararHoja_(ss, nombre) {
  var h = ss.getSheetByName(nombre);
  if (!h) {
    var hojas = ss.getSheets();
    /* reutiliza la pestaña vacía que trae toda hoja nueva */
    if (hojas.length === 1 && !HOJAS[hojas[0].getName()] && hojas[0].getLastRow() === 0) {
      h = hojas[0]; h.setName(nombre);
    } else {
      h = ss.insertSheet(nombre);
    }
  }
  if (h.getLastRow() === 0) {
    var cols = HOJAS[nombre].length;
    /* formato texto: evita que Sheets convierta fechas, RUC o "true" en otros tipos */
    h.getRange(1, 1, h.getMaxRows(), cols).setNumberFormat("@");
    h.getRange(1, 1, 1, cols).setValues([HOJAS[nombre]]).setFontWeight("bold");
    h.setFrozenRows(1);
  }
  return h;
}


/* ============================================================
   ENTRADA HTTP
   ============================================================ */

/** Permite comprobar desde el navegador que el servidor responde. */
function doGet() {
  var p = PropertiesService.getScriptProperties();
  return json_({ ok: true, servicio: "acreditacion-contratistas", version: VERSION,
                 configurado: !!p.getProperty("HOJA_ID") && !!p.getProperty("CARPETA_ID") });
}

function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: "Solicitud mal formada.", codigo: "formato" }); }

  try {
    var f = ACCIONES[p.accion];
    if (!f) throw publico_("Acción desconocida.", "accion");
    if (!prop_("HOJA_ID") || !prop_("CARPETA_ID"))
      throw publico_("El servidor no está configurado. Ejecuta configurar() en Apps Script.", "sin_configurar");
    return json_({ ok: true, datos: f(p) });
  } catch (err) {
    if (err && err.publico) return json_({ ok: false, error: err.message, codigo: err.codigo });
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: "Error interno del servidor. Inténtalo de nuevo en unos minutos.", codigo: "interno" });
  }
}


/* ============================================================
   ACCIONES
   Contratista: se identifica solo por RUC.
   SST: requiere la clave SST_CLAVE, si está definida.
   El servidor nunca confía en el RUC que viene dentro de un documento
   o solicitud: lo toma de la sesión y lo compara con lo guardado.
   ============================================================ */

var ACCIONES = {

  "empresa.ingresar": function (p) {
    var ruc = exigirRuc_(p.ruc);
    var razon = mayus_(p.razonSocial);
    if (razon.length < 3) throw publico_("Escribe la razón social.", "datos");
    if (razon.length > 200) throw publico_("La razón social es demasiado larga.", "datos");
    return conBloqueo_(function () {
      var ex = buscar_("empresas", "ruc", ruc);
      if (ex) {
        return { estado: normaliza_(ex.razonSocial) === normaliza_(razon) ? "existente" : "conflicto",
                 razonSocial: ex.razonSocial };
      }
      agregar_("empresas", { ruc: ruc, razonSocial: razon, creado: ahora_() });
      return { estado: "nuevo", razonSocial: razon };
    });
  },

  "contratista.datos": function (p) {
    var ruc = exigirEmpresa_(p.ruc);
    return {
      empresas:    leer_("empresas").filter(function (x) { return x.ruc === ruc; }).map(aEmpresa_),
      solicitudes: leer_("solicitudes").filter(function (x) { return x.ruc === ruc; }).map(aSolicitud_),
      documentos:  leer_("documentos").filter(function (x) { return x.ruc === ruc; }).map(aDocumento_)
    };
  },

  "solicitud.guardar": function (p) {
    var ruc = exigirEmpresa_(p.ruc);
    var s = p.solicitud || {};
    var id = exigirId_(s.id);
    if (!EMPRESAS[s.contratante]) throw publico_("Empresa contratante no válida.", "datos");
    return conBloqueo_(function () {
      var ex = buscar_("solicitudes", "id", id);
      if (ex && ex.ruc !== ruc) throw publico_("Esta solicitud pertenece a otra empresa.", "sin_permiso");
      var fila = {
        id: id, ruc: ruc, contratante: s.contratante,
        actividad: texto_(s.actividad, 300),
        sedes: lista_(s.sedes).join(", "),
        inicio: fecha_(s.inicio), fin: fecha_(s.fin),
        nTrabajadores: String(Math.max(1, Math.min(999, parseInt(s.nTrabajadores, 10) || 1))),
        vehicular: ["no", "conduce", "ingreso"].indexOf(s.vehicular) >= 0 ? s.vehicular : "no",
        altoRiesgo: lista_(s.altoRiesgo).join(", "),
        quimicos: String(!!s.quimicos), equipos: String(!!s.equipos),
        /* la autorización solo la cambia SST, nunca el contratista */
        acreditada: ex ? ex.acreditada : "false",
        carpetaId: ex ? ex.carpetaId : "",
        creado: ex ? ex.creado : ahora_(),
        actualizado: ahora_()
      };
      if (ex) actualizar_("solicitudes", ex._fila, fila); else agregar_("solicitudes", fila);
      return aSolicitud_(fila);
    });
  },

  "documento.subir": function (p) {
    var ruc = exigirEmpresa_(p.ruc);
    var d = p.documento || {};
    var id = exigirId_(d.id);
    var nombre = texto_(d.nombre, 180) || "archivo";
    var ext = (nombre.split(".").pop() || "").toLowerCase();
    var mime = MIMES[ext];
    if (!mime) throw publico_("Solo se aceptan archivos PDF, JPG o PNG.", "tipo_archivo");
    var b64 = String(p.base64 || "");
    if (!b64) throw publico_("El archivo llegó vacío.", "datos");
    /* 4 caracteres de base64 = 3 bytes: se rechaza antes de decodificar */
    if (b64.length * 3 / 4 > TAM_MAX + 3) throw publico_("El archivo supera los 10 MB.", "tamano");
    var bytes = Utilities.base64Decode(b64);
    if (bytes.length > TAM_MAX) throw publico_("El archivo supera los 10 MB.", "tamano");

    var meta = objeto_(d.meta);
    var tipoId = texto_(d.tipoId, 40);
    if (!tipoId) throw publico_("Falta el tipo de documento.", "datos");

    return conBloqueo_(function () {
      var sol = buscar_("solicitudes", "id", d.solicitudId);
      if (!sol || sol.ruc !== ruc) throw publico_("La solicitud no existe o pertenece a otra empresa.", "sin_permiso");
      if (buscar_("documentos", "id", id)) throw publico_("Este documento ya fue cargado.", "duplicado");

      var carpeta = carpetaSolicitud_(sol);
      var titular = texto_(meta.titular, 120);
      var nombreDrive = limpiarNombre_(tipoId + " - " + (titular ? titular + " - " : "") + nombre);
      var archivo = carpeta.createFile(Utilities.newBlob(bytes, mime, nombreDrive));

      var fila = {
        id: id, solicitudId: sol.id, ruc: ruc, tipoId: tipoId, titular: titular,
        nombre: nombre, peso: String(bytes.length), mime: mime, meta: JSON.stringify(meta),
        emision: fecha_(d.emision), vencimiento: fecha_(d.vencimiento),
        revision: "pendiente", comentario: "", revisadoEn: "",
        driveId: archivo.getId(), driveUrl: archivo.getUrl(), creado: ahora_()
      };
      agregar_("documentos", fila);
      return aDocumento_(fila);
    });
  },

  "documento.quitar": function (p) {
    var ruc = exigirEmpresa_(p.ruc);
    return conBloqueo_(function () {
      var d = buscar_("documentos", "id", p.id);
      if (!d || d.ruc !== ruc) throw publico_("El documento no existe o pertenece a otra empresa.", "sin_permiso");
      /* va a la papelera de Drive: se puede recuperar durante 30 días */
      try { DriveApp.getFileById(d.driveId).setTrashed(true); } catch (e) { console.warn("Archivo ya no estaba en Drive: " + d.driveId); }
      hoja_("documentos").deleteRow(d._fila);
      return { id: d.id };
    });
  },

  "documento.archivo": function (p) {
    var d = buscar_("documentos", "id", p.id);
    var permitido = d && ((p.modo === "sst" && claveOk_(p.clave)) || (d.ruc === String(p.ruc || "")));
    if (!permitido) throw publico_("El documento no existe o no tienes acceso.", "sin_permiso");
    var blob = DriveApp.getFileById(d.driveId).getBlob();
    return { base64: Utilities.base64Encode(blob.getBytes()), mime: d.mime, nombre: d.nombre };
  },

  "sst.acceso": function (p) {
    return { ok: claveOk_(p.clave), requiereClave: !!prop_("SST_CLAVE") };
  },

  "sst.datos": function (p) {
    exigirSST_(p);
    return {
      empresas:    leer_("empresas").map(aEmpresa_),
      solicitudes: leer_("solicitudes").map(aSolicitud_),
      documentos:  leer_("documentos").map(aDocumento_)
    };
  },

  "documento.revisar": function (p) {
    exigirSST_(p);
    if (REVISIONES.indexOf(p.revision) < 0) throw publico_("Resultado de revisión no válido.", "datos");
    return conBloqueo_(function () {
      var d = buscar_("documentos", "id", p.id);
      if (!d) throw publico_("El documento ya no existe.", "no_existe");
      d.revision = p.revision;
      d.comentario = texto_(p.comentario, 1000);
      d.revisadoEn = ahora_();
      actualizar_("documentos", d._fila, d);
      return aDocumento_(d);
    });
  },

  "solicitud.acreditar": function (p) {
    exigirSST_(p);
    return conBloqueo_(function () {
      var s = buscar_("solicitudes", "id", p.id);
      if (!s) throw publico_("La solicitud ya no existe.", "no_existe");
      s.acreditada = String(p.acreditada === true);
      s.actualizado = ahora_();
      actualizar_("solicitudes", s._fila, s);
      return aSolicitud_(s);
    });
  }
};


/* ============================================================
   PERMISOS Y VALIDACIÓN
   ============================================================ */

function claveOk_(clave) {
  var k = prop_("SST_CLAVE");
  return !k || String(clave || "") === k;
}
function exigirSST_(p) {
  if (!claveOk_(p.clave)) throw publico_("Clave de SST incorrecta o vencida. Vuelve a ingresar.", "sin_permiso");
}
function exigirRuc_(ruc) {
  ruc = String(ruc || "").trim();
  if (!rucValido_(ruc)) throw publico_("RUC inválido.", "ruc");
  return ruc;
}
function exigirEmpresa_(ruc) {
  ruc = exigirRuc_(ruc);
  if (!buscar_("empresas", "ruc", ruc)) throw publico_("La empresa no está registrada. Vuelve a ingresar.", "sin_empresa");
  return ruc;
}
function exigirId_(id) {
  id = String(id || "");
  if (!/^[a-z0-9]{6,40}$/i.test(id)) throw publico_("Identificador no válido.", "datos");
  return id;
}
function rucValido_(ruc) {
  if (!/^\d{11}$/.test(ruc)) return false;
  if (["10", "15", "16", "17", "20"].indexOf(ruc.slice(0, 2)) < 0) return false;
  var f = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2], s = 0;
  for (var i = 0; i < 10; i++) s += parseInt(ruc[i], 10) * f[i];
  var r = 11 - (s % 11); if (r === 10) r = 0; if (r === 11) r = 1;
  return r === parseInt(ruc[10], 10);
}
function publico_(msg, codigo) { var e = new Error(msg); e.publico = true; e.codigo = codigo || "error"; return e; }


/* ============================================================
   HOJA DE REGISTROS
   ============================================================ */

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function hoja_(n) {
  var h = SpreadsheetApp.openById(prop_("HOJA_ID")).getSheetByName(n);
  if (!h) throw publico_("Falta la pestaña '" + n + "'. Ejecuta configurar() en Apps Script.", "sin_configurar");
  return h;
}
function leer_(n) {
  var v = hoja_(n).getDataRange().getValues();
  if (v.length < 2) return [];
  var cab = v[0].map(String);
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var o = { _fila: i + 1 };
    for (var j = 0; j < cab.length; j++) o[cab[j]] = celda_(v[i][j]);
    if (o.id || o.ruc) out.push(o);
  }
  return out;
}
function buscar_(n, campo, valor) {
  valor = String(valor || "");
  if (!valor) return null;
  var filas = leer_(n);
  for (var i = 0; i < filas.length; i++) if (filas[i][campo] === valor) return filas[i];
  return null;
}
function filaDe_(n, obj) {
  var h = hoja_(n);
  var cab = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(String);
  return { h: h, cab: cab, valores: [cab.map(function (c) { return obj[c] == null ? "" : String(obj[c]); })] };
}
function agregar_(n, obj) {
  var f = filaDe_(n, obj);
  var r = f.h.getLastRow() + 1;
  f.h.getRange(r, 1, 1, f.cab.length).setNumberFormat("@").setValues(f.valores);
}
function actualizar_(n, fila, obj) {
  var f = filaDe_(n, obj);
  f.h.getRange(fila, 1, 1, f.cab.length).setValues(f.valores);
}
function conBloqueo_(fn) {
  var l = LockService.getScriptLock();
  l.waitLock(20000);
  try { return fn(); } finally { l.releaseLock(); }
}


/* ============================================================
   DRIVE
   Acreditación de contratistas — archivos /
     Grupo Pana / 20123456786 - EMPRESA SAC / 2026-09-22 - Mantenimiento de extractores (abc123)
   Los archivos no se comparten: solo la cuenta dueña del script los ve en Drive.
   ============================================================ */

function carpetaSolicitud_(sol) {
  if (sol.carpetaId) {
    try { return DriveApp.getFolderById(sol.carpetaId); } catch (e) { /* se recrea abajo */ }
  }
  var raiz = DriveApp.getFolderById(prop_("CARPETA_ID"));
  var empresa = subcarpeta_(raiz, EMPRESAS[sol.contratante] || sol.contratante);
  var ex = buscar_("empresas", "ruc", sol.ruc);
  var cont = subcarpeta_(empresa, limpiarNombre_(sol.ruc + " - " + (ex ? ex.razonSocial : "")));
  var nombre = limpiarNombre_((sol.inicio || sol.creado.slice(0, 10)) + " - " +
               (sol.actividad || "Solicitud") + " (" + sol.id.slice(-6) + ")");
  var c = cont.createFolder(nombre);
  sol.carpetaId = c.getId();
  actualizar_("solicitudes", sol._fila, sol);
  return c;
}
function subcarpeta_(padre, nombre) {
  var it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}


/* ============================================================
   CONVERSIONES
   En la hoja todo se guarda como texto legible; aquí se devuelve
   con los tipos que espera la página.
   ============================================================ */

function aEmpresa_(o) { return { ruc: o.ruc, razonSocial: o.razonSocial, creado: o.creado }; }
function aSolicitud_(o) {
  return {
    id: o.id, ruc: o.ruc, contratante: o.contratante, actividad: o.actividad || "",
    sedes: dividir_(o.sedes), inicio: o.inicio || "", fin: o.fin || "",
    nTrabajadores: parseInt(o.nTrabajadores, 10) || 1,
    vehicular: o.vehicular || "no", altoRiesgo: dividir_(o.altoRiesgo),
    quimicos: verdad_(o.quimicos), equipos: verdad_(o.equipos), acreditada: verdad_(o.acreditada),
    creado: o.creado || "", actualizado: o.actualizado || ""
  };
}
function aDocumento_(o) {
  return {
    id: o.id, solicitudId: o.solicitudId, tipoId: o.tipoId, nombre: o.nombre,
    peso: parseInt(o.peso, 10) || 0, mime: o.mime, meta: objeto_(o.meta),
    emision: o.emision || "", vencimiento: o.vencimiento || "",
    revision: o.revision || "pendiente", comentario: o.comentario || "",
    revisadoEn: o.revisadoEn || "", creado: o.creado || ""
  };
}
function celda_(x) {
  if (x instanceof Date) return Utilities.formatDate(x, ZONA, "yyyy-MM-dd");
  return x == null ? "" : String(x);
}
function verdad_(x) { return String(x).toLowerCase() === "true"; }
function dividir_(x) { return String(x || "").split(",").map(function (s) { return s.trim(); }).filter(String); }
function lista_(x) { return (Array.isArray(x) ? x : []).map(function (s) { return texto_(s, 80); }).filter(String).slice(0, 30); }
function objeto_(x) {
  if (x && typeof x === "object" && !Array.isArray(x)) return x;
  try { var o = JSON.parse(String(x || "{}")); return (o && typeof o === "object" && !Array.isArray(o)) ? o : {}; }
  catch (e) { return {}; }
}
function texto_(x, max) { return String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, max || 500); }
function fecha_(x) { x = String(x || ""); return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : ""; }
function mayus_(x) { return texto_(x, 250).toUpperCase(); }
function normaliza_(x) { return mayus_(x).normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function ahora_() { return Utilities.formatDate(new Date(), ZONA, "yyyy-MM-dd HH:mm:ss"); }
function limpiarNombre_(x) { return texto_(x, 150).replace(/[\\\/:*?"<>|]/g, "-"); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
