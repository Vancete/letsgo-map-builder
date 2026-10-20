# Let's Go Map Builder

Editor de mapas para **Pokémon: Let's Go, Pikachu! / Eevee!**, pensado para crear mapas que se carguen como mods en
[Let's Go Recomp](../letsgo-recomp). Los modelos salen de tu propia copia del juego; el editor no incluye ningún archivo
del juego.

> [!WARNING]
> **Work in progress, en una fase muy temprana.** Los mapas todavía no se pueden cargar en el juego (ver "Pendiente"),
> y el formato de archivo y la interfaz pueden cambiar sin aviso.

![El editor: escena a la izquierda, vista 3D en el centro, inspector a la derecha y catálogo de objetos abajo](editor.png)

## Uso

```bash
npm install
npm run dev        # editor en modo desarrollo
npm run build      # compila a out/
npm start          # ejecuta lo compilado
```

1. Al arrancar por primera vez, elige la carpeta del juego: tu instalación de Let's Go Recomp (usa
   `extracted/romfs.bin`), una carpeta `romfs` extraída o el propio `romfs.bin`. Se detectan solas las instalaciones
   habituales.
2. Se extrae el catálogo (≈30 s) y se generan las miniaturas de los ~3000 objetos (≈1 min, en segundo plano).
   **🖼 Regenerar miniaturas** las vuelve a crear; **↻ Catálogo** vuelve a extraerlo todo.
3. Monta el mapa:
   - **Abajo**, el catálogo por categorías (suelo, árboles, hierba, flores, saltos y desniveles, rocas, vallas,
     mobiliario, Centros Pokémon, tiendas, gimnasios, edificios, puertas, objetos de juego, zonas completas), con
     buscador y filtro por zona de origen. Arrastra una miniatura a la vista, haz doble clic para ponerla en el centro, o
     haz clic para "armarla" y coloca copias con cada clic en la vista (Esc para terminar).
   - **Izquierda**, el árbol de la escena: grupos, arrastrar para reordenar o anidar, renombrar con doble clic,
     ocultar y bloquear.
   - **Centro**, la vista 3D con gizmo de mover / rotar / escalar (W / E / R) y ajuste a la rejilla.
   - **Derecha**, el inspector: posición, rotación y escala numéricas (admite operaciones: `350+100`), la casilla de la
     rejilla en la que está el objeto y las propiedades del mapa.
4. **Guardar** crea un `.lgmap`; **📦 Exportar mod** lo empaqueta como mod en la carpeta `mods/` de Let's Go Recomp.

### Controles

| | |
|---|---|
| Clic | seleccionar (Ctrl/Mayús: añadir a la selección) |
| Botón derecho / central / rueda | orbitar / desplazar / zoom |
| W / E / R | mover / rotar / escalar |
| Q | girar 90° |
| Flechas, RePág/AvPág | mover una casilla (Mayús: ¼), subir/bajar |
| X | activar/desactivar el ajuste a la rejilla |
| G / T / F | rejilla / vista cenital / encuadrar |
| Ctrl+D, Ctrl+G, Supr | duplicar, agrupar, eliminar |
| Ctrl+Z / Ctrl+Y | deshacer / rehacer |
| Ctrl+N / O / S / Mayús+S | nuevo / abrir / guardar / guardar como |

## La rejilla

Como en el juego, **una casilla mide 100 unidades** (la roca de Fuerza y la baldosa de teletransporte miden 100×100) y
los objetos que coloca el propio juego están en los centros de casilla (múltiplos de 50). El ajuste por defecto es de ½
casilla; "Centro de casilla" coloca cada objeto en el centro. Tamaño y origen de la rejilla se cambian en el inspector
del mapa.

## De dónde salen los objetos

- `bin/archive/field/buildmodel.gfpak`: los objetos que el juego coloca por separado (hierba alta, flores, árboles
  cortables, rocas de Fuerza, farolas, puertas de Centros y tiendas, máquina del PC...). Los nombres se recuperan de las
  rutas que cita `placement.gfpak` (en el archivo solo hay hashes FNV-1a de 64 bits).
- Los modelos de cada zona (`bin/archive/field/<area>/<zona>.gfpak`) están "horneados": cada grupo (`tree001`,
  `bldg_pc`, `town010_00_build01`) junta todas sus instancias en coordenadas de mundo. El editor separa cada grupo en
  componentes conexos, agrupa los que se tocan en instancias, elimina duplicados y deja cada pieza con su origen en el
  centro de su base. Así aparecen Centros Pokémon, tiendas, casas, bancos, farolas, carteles, vallas, desniveles...
- Cada zona completa, para construir encima de un mapa existente.
- Baldosas de suelo (1×1 y 4×4 casillas) con cada textura de terreno que usan las zonas.

Formatos leídos: GFLXPACK (LZ4), GFBMDL (FlatBuffers), BNTX (deswizzle Tegra + BC1/BC2/BC3/BC4/BC5/BC7) y RomFS. Todo en
TypeScript, en `src/shared/formats/`.

## Formato del mapa (`.lgmap`)

JSON, unidades del juego (Y hacia arriba, 1 casilla = 100), rotaciones en grados (orden XYZ):

```jsonc
{
  "format": "letsgo-map", "version": 1,
  "name": "Mi pueblo", "author": "", "description": "",
  "grid": { "cellSize": 100, "width": 32, "depth": 32, "originX": -1600, "originZ": -1600 },
  "objects": [
    { "id": "o…", "name": "bldg_pc", "asset": "zp.area03.town003_00.bldg_pc.0", "parent": null,
      "position": [-600, 0, -500], "rotation": [0, 0, 0], "scale": [1, 1, 1], "visible": true, "locked": false }
  ],
  // de dónde sale cada modelo usado, para reconstruirlo desde los archivos del juego sin el editor
  "assets": {
    "zp.area03.town003_00.bldg_pc.0": { "name": "bldg_pc", "category": "pc",
      "source": { "kind": "zonePiece", "pak": "bin/archive/field/area03/town003_00.gfpak", "fileIndex": 0,
                  "family": "bldg_pc", "pivot": [x, y, z], "instance": 0 } }
  }
}
```

`source.kind`: `model` (un modelo entero de un `.gfpak`, con su ruta RomFS si se conoce), `zonePiece` (una instancia de
un grupo de un modelo de zona, con el punto de su base en coordenadas de la zona), `zone` (zona completa) o `tile`
(baldosa generada con una textura del juego). Los objetos con `asset: null` son grupos; la posición de un hijo es
relativa a su padre.

### Mod exportado

```
mods/<Nombre>/
  mapmod.json                          nombre, autor, ruta del mapa
  README.txt
  romfs/bin/lgmap/<Nombre>.lgmap       el mapa
```

El mod tiene `romfs/`, así que Let's Go Recomp lo lista y lo monta por LayeredFS. El mapa va en una ruta de la RomFS que
el juego original no lee (`bin/lgmap/`): **cargarlo dentro del juego necesita un cargador en el runtime de Let's Go
Recomp**, que todavía no existe (ver "Pendiente").

## Pendiente

- Cargador en el runtime de Let's Go Recomp: leer `bin/lgmap/*.lgmap` de los mods activos y construir la zona.
  Dos caminos posibles: (a) generar en la exportación los archivos que el juego ya entiende (un GFBMDL de zona con las
  piezas fusionadas, su colisión `.gfbcol` y su entrada en `placement.gfpak`), o (b) un hook en el runtime que dibuje y
  colisione los objetos del mapa.
- Los materiales se aproximan con iluminación Lambert; los shaders de terreno que mezclan varias texturas usan solo la
  principal.

## Estructura

```
src/shared/formats/   lectores de formatos del juego (gfpak, lz4, flatbuf, gfbmdl, bntx, bcn, gamefs, png)
src/shared/extract.ts construcción del catálogo (modelos LGM + texturas PNG en la caché)
src/shared/lgm.ts     formato de modelo de la caché
src/main/             proceso principal de Electron (ajustes, catálogo en un worker, archivos, mods)
src/renderer/         interfaz (React + three.js): store con deshacer, vista 3D, miniaturas, paneles
scripts/              utilidades de desarrollo (extract-cli, pakinfo, fbdump, cdp para pruebas automáticas)
```

La caché vive en `%APPDATA%/letsgo-map-builder/library`.
