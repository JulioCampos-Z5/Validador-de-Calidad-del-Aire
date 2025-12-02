# Sistema de Validación de Datos de Calidad del Aire

Sistema web para validar datos de calidad del aire desde archivos ENVISTA (Trs.xlsx).

## 📁 Estructura del Proyecto

```
web/
├── backend/          # API REST con Flask
│   └── app.py        # Servidor con toda la lógica de validación integrada
├── frontend/         # Interfaz web con React + TypeScript
│   ├── src/
│   │   ├── components/   # Componentes reutilizables
│   │   ├── pages/        # Páginas de la aplicación
│   │   └── services/     # Servicios de API
│   └── package.json
└── README.md
```

---

## 🚀 Cómo Iniciar

### Requisitos
- Python 3.10+
- Node.js 18+

---

### 1. Backend (API Flask)

```bash
cd web/backend
pip install -r requirements.txt
python app.py
```

El servidor se iniciará en: **http://localhost:8000**

---

### 2. Frontend (React + Vite)

```bash
cd web/frontend
npm install
npm run dev
```

La aplicación estará disponible en: **http://localhost:3000**

---

## 🔧 Cómo Funciona

### Flujo de Validación

1. **Subir Archivo**: El usuario sube un archivo Excel (.xlsx) en formato ENVISTA
2. **Procesamiento**: El backend realiza automáticamente:
   - Carga y parseo del archivo ENVISTA
   - Conversión al formato estándar (BD_2024)
   - Validación por rangos
   - Validación por temperatura interna (20-30°C)
   - Validación por series temporales
3. **Resultados**: Se muestra una tabla con los datos validados y banderas aplicadas
4. **Descarga**: El usuario puede descargar el Excel validado con múltiples hojas

### Validaciones Aplicadas

| Validación | Descripción |
|------------|-------------|
| **Rangos** | Verifica que cada parámetro esté dentro de límites permitidos. Marca `IR` si está fuera |
| **Temperatura Interna** | Si IT está fuera de 20-30°C, invalida contaminantes con `IO` |
| **Series Temporales** | Detecta valores constantes >3 horas (`DS`) y relaciones inválidas NOX/PM (`IO`) |

### Banderas de Validación

| Bandera | Color | Significado |
|---------|-------|-------------|
| `IO` | 🟠 Naranja | Inválido por operador |
| `IR` | 🔴 Rojo | Inválido por rango de operación |
| `IF` | 🔴 Rojo | Inválido por falla en el equipo |
| `IC` | 🟡 Amarillo | Inválido por calibración |
| `ND` | ⚫ Gris | Sin dato (No Data) |
| `DS` | 🟣 Púrpura | Dato sospechoso |
| `VZ` | 🔵 Azul | Válido igualado al límite de detección |

---

## 📡 Endpoints de la API

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/health` | Estado de la API |
| `GET` | `/api/config` | Configuración del validador (rangos, banderas, estaciones) |
| `POST` | `/api/upload` | Subir archivo Excel |
| `POST` | `/api/validate/full` | Ejecutar validación completa |
| `GET` | `/api/download/<filename>` | Descargar archivo validado |

### Ejemplo de uso con curl:

```bash
# Verificar estado
curl http://localhost:8000/api/health

# Ver configuración
curl http://localhost:8000/api/config
```

---

## 🎨 Interfaz Web

### Páginas Disponibles

- **Dashboard**: Resumen general del sistema y estado de la API
- **Subir Archivo**: Cargar y validar archivos ENVISTA (drag & drop)
- **Resultados**: Historial de validaciones realizadas
- **Configuración**: Ver rangos y parámetros del validador

### Características de la Tabla de Datos

- **Columnas ordenadas** según formato BD_2024:
  `STATION, DATE, HOUR, O3, NO, NO2, NOX, SO2, CO, PM10, PM2.5, IT, ET, RH, WS, WD, PP, ATM, RS, UVI`

- **Colores por tipo de parámetro**:
  - 🔵 **Azul**: Identificadores (STATION, DATE, HOUR)
  - 🟢 **Verde**: Contaminantes gaseosos (O3, NO, NO2, NOX, SO2, CO)
  - 🟠 **Naranja**: Material particulado (PM10, PM2.5)
  - 🔴 **Rojo**: Temperatura (IT, ET)
  - 🟣 **Púrpura**: Meteorológicos (RH, WS, WD, PP, ATM, RS, UVI)

- **Paginación** de 50 registros por página
- **Leyenda colapsable** con descripción de colores y banderas

---

## 📦 Dependencias

### Backend (Python)
```
Flask
Flask-CORS
pandas
numpy
openpyxl
```

### Frontend (Node.js)
```
React 18
TypeScript
Vite 5
Tailwind CSS 3
Axios
Lucide React
```

---

## 📊 Archivo Excel de Salida

El archivo validado incluye las siguientes hojas:

1. **Datos_Validados**: Todos los registros con banderas aplicadas
2. **Resumen_Banderas_Global**: Conteo total de cada bandera
3. **Resumen_Banderas_Detallado**: Banderas por estación y parámetro
4. **Estadísticas_Generales**: Totales de registros, estaciones, días
5. **Estadísticas_Detalladas**: Mín, máx, promedio por estación/parámetro
6. **Configuración**: Rangos y decimales utilizados

---

## 📝 Notas Importantes

- El backend tiene toda la lógica de validación integrada en `app.py`
- Los archivos temporales se guardan en una carpeta temporal del sistema
- La validación siempre es completa (rangos + temperatura + series temporales)
- El frontend se conecta al backend a través del proxy configurado en Vite
