## Variables a Monitorear

Cada estación deberá reportar todas las variables disponibles de contaminantes atmosféricos y meteorología, conforme al siguiente catálogo.

### Contaminantes atmosféricos

| ID | Variable | Descripción |
|----|---------|-------------|
| 1 | O₃ | Ozono |
| 2 | NO | Monóxido de nitrógeno |
| 3 | NO₂ | Dióxido de nitrógeno |
| 4 | NOₓ | Óxidos de nitrógeno |
| 5 | SO₂ | Dióxido de azufre |
| 6 | CO | Monóxido de carbono |
| 7 | PM₁₀ | Partículas menores a 10 µm |
| 8 | PM₂.₅ | Partículas menores a 2.5 µm |

---

### Variables meteorológicas

| ID | Variable | Descripción |
|----|---------|-------------|
| 9 | WS | Velocidad del viento |
| 10 | WD | Dirección del viento |
| 11 | TempExt | Temperatura externa |
| 12 | RH | Humedad relativa |
| 13 | Presión | Presión atmosférica |
| 14 | RadSolar | Radiación solar |
| 15 | Precipitación | Precipitación pluvial |
| 16 | UV | Índice UV |
| 17 | TempInt | Temperatura interna |

---

##  Estructura de Datos por Estación

### Identificación

- Identificador único de estación
- Fecha (`YYYY-MM-DD`)
- Hora (`HH:MM`, formato 24 horas)
- Zona horaria explícita (ej. `UTC-6`)

### Variables

- Cada estación deberá incluir **todas las variables disponibles**, tanto de contaminantes como meteorológicas.
- Las variables no disponibles deberán enviarse explícitamente como:
  - Valor: `null`
  - Bandera correspondiente a “dato no disponible”

---

## Sistema de Banderas (Estatus de Variables)

Cada variable deberá contar obligatoriamente con un **estatus o bandera** que indique la calidad y validez del dato.

### Reglas generales

- Todas las variables deben incluir bandera.
- Un valor de bandera igual a **`1`** indica que el dato es **válido**.
- La ausencia de bandera se considerará un error de formato.
### Diccionario de banderas - **propuesta**

| Código | Descripción |
|------|-------------|
| 1 | Dato válido |
| 2 | Dato fuera de rango |
| 3 | Dato sospechoso |
| 4 | Equipo en calibración |
| 5 | Falla de equipo |
| 6 | Dato no disponible |
| 7 | Dato estimado |
| 8 | Dato corregido |
| 9 | Mantenimiento |
| 99 | Dato inválido |

---

## Frecuencia y Resolución Temporal

### Datos minutales

- La mayoría de los equipos generan datos con resolución **minutal**.
- La API deberá aceptar, almacenar y consultar datos con frecuencia de **1 minuto**.
- Esta resolución permitirá:
  - Agregaciones horarias
  - Detección temprana de anomalías
  - Modelos de imputación y predicción

---
### Datos horarios

- Actualmente, el valor horario se genera y envía **10 minutos después de la hora correspondiente**.
- Se establece como requerimiento deseable que:
  - El envío del dato horario se realice **sincronizado al cierre de la hora**.
  - En caso de retraso, este deberá ser documentado mediante metadatos de recepción.

---

### Ejemplo salida API

``` json
{
  "estacion": {
  
    "id": "ZMG-012",
    "nombre": "Guadalajara Centro",
    "latitud": 20.6736,
    "longitud": -103.3440,
    "zona_horaria": "UTC-6"
  },
  "timestamp": {
    "fecha": "2026-01-30",
    "hora": "10:00",
    "resolucion": "horaria",
    "timestamp_generacion": "2026-01-30T10:00:00-06:00",
    "timestamp_recepcion": "2026-01-30T10:10:12-06:00"
  },
  "variables": {
    "O3": {
      "valor": 0.041,
      "unidad": "ppm",
      "bandera": 1
    },
    "NO": {
      "valor": 0.012,
      "unidad": "ppm",
      "bandera": 1
    },
    "NO2": {
      "valor": 0.029,
      "unidad": "ppm",
      "bandera": 1
    },
    "NOx": {
      "valor": 0.041,
      "unidad": "ppm",
      "bandera": 1
    },
    "SO2": {
      "valor": null,
      "unidad": "ppm",
      "bandera": 6
    },
    "CO": {
      "valor": 0.6,
      "unidad": "ppm",
      "bandera": 1
    },
    "PM10": {
      "valor": 42,
      "unidad": "µg/m³",
      "bandera": 1
    },
    "PM25": {
      "valor": 18,
      "unidad": "µg/m³",
      "bandera": 1
    },
    "WS": {
      "valor": 2.4,
      "unidad": "m/s",
      "bandera": 1
    },
    "WD": {
      "valor": 185,
      "unidad": "grados",
      "bandera": 1
    },
    "TempExt": {
      "valor": 24.7,
      "unidad": "°C",
      "bandera": 1
    },
    "RH": {
      "valor": 58,
      "unidad": "%",
      "bandera": 1
    },
    "Presion": {
      "valor": 1012.3,
      "unidad": "hPa",
      "bandera": 1
    },
    "RadSolar": {
      "valor": 520,
      "unidad": "W/m²",
      "bandera": 1
    },
    "Precipitacion": {
      "valor": 0.0,
      "unidad": "mm",
      "bandera": 1
    },
    "UV": {
      "valor": 4,
      "unidad": "Índice",
      "bandera": 1
    },
    "TempInt": {
      "valor": 26.1,
      "unidad": "°C",
      "bandera": 1
    }
  },
  "metadatos": {
    "fuente": "Estacion automatica",
    "version_api": "1.0.0",
    "estado_registro": "completo"
  }
}

```

## Información de la estación

| Campo        | Valor              |
| ------------ | ------------------ |
| ID estación  | ZMG-012            |
| Nombre       | Guadalajara Centro |
| Latitud      | 20.6736            |
| Longitud     | -103.3440          |
| Zona horaria | UTC-6              |
## Información temporal del registro

|Campo|Valor|
|---|---|
|Fecha|2026-01-30|
|Hora|10:00|
|Resolución|Horaria|
|Timestamp de generación|2026-01-30T10:00:00-06:00|
|Timestamp de recepción|2026-01-30T10:10:12-06:00|

## Contaminantes atmosféricos

|Variable|Descripción|Valor|Unidad|Bandera|
|---|---|---|---|---|
|O₃|Ozono|0.041|ppm|1|
|NO|Monóxido de nitrógeno|0.012|ppm|1|
|NO₂|Dióxido de nitrógeno|0.029|ppm|1|
|NOₓ|Óxidos de nitrógeno|0.041|ppm|1|
|SO₂|Dióxido de azufre|null|ppm|6|
|CO|Monóxido de carbono|0.6|ppm|1|
|PM₁₀|Partículas ≤ 10 µm|42|µg/m³|1|
|PM₂.₅|Partículas ≤ 2.5 µm|18|µg/m³|1|

---

## Variables meteorológicas

|Variable|Descripción|Valor|Unidad|Bandera|
|---|---|---|---|---|
|WS|Velocidad del viento|2.4|m/s|1|
|WD|Dirección del viento|185|grados|1|
|TempExt|Temperatura externa|24.7|°C|1|
|RH|Humedad relativa|58|%|1|
|Presión|Presión atmosférica|1012.3|hPa|1|
|RadSolar|Radiación solar|520|W/m²|1|
|Precipitación|Precipitación pluvial|0.0|mm|1|
|Índice UV|Índice UV|4|índice|1|
|TempInt|Temperatura interna|26.1|°C|1|

---

## Metadatos del registro

| Campo               | Valor               |
| ------------------- | ------------------- |
| Fuente              | Estación automática |
| Versión de la API   | 1.0.0               |
| Estado del registro | Completo            |

---

## Interpretación rápida de banderas

|Bandera|Significado|
|---|---|
|1|Dato válido|
|6|Dato no disponible|

---

### Unidades de contaminantes atmosféricos

| Unidad | Nombre | Descripción |
|------|-------|-------------|
| ppm | Partes por millón | Indica la cantidad de moléculas de un contaminante por cada millón de moléculas de aire. Es una medida de concentración común para gases. |
| µg/m³ | Microgramos por metro cúbico | Representa la masa de contaminante (en microgramos) presente en un metro cúbico de aire. Es ampliamente utilizada para material particulado. |

---

### Unidades de variables meteorológicas

| Unidad | Nombre | Descripción |
|------|-------|-------------|
| m/s | Metros por segundo | Mide la velocidad del viento, indicando qué tan rápido se desplaza el aire. |
| grados | Grados azimutales | Indica la dirección del viento en grados, donde 0° corresponde al norte y el valor aumenta en sentido horario. |
| °C | Grados Celsius | Mide la temperatura del aire, tanto interna como externa. |
| % | Porcentaje | Indica la proporción de humedad relativa del aire respecto a su capacidad máxima. |
| hPa | Hectopascales | Unidad de presión atmosférica equivalente a 100 pascales. |
| W/m² | Watts por metro cuadrado | Mide la intensidad de la radiación solar incidente sobre una superficie. |
| mm | Milímetros | Representa la cantidad de precipitación pluvial acumulada. |
| índice | Índice UV | Escala adimensional que indica el nivel de radiación ultravioleta y su potencial impacto en la salud humana. |

---


