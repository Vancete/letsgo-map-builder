# Let's Go Map Builder

Map editor for **Pokémon: Let's Go, Pikachu! / Eevee!**, made to build maps that load as mods in
[Let's Go Recomp](../letsgo-recomp). The models come from your own copy of the game; the editor ships no game files.

> [!WARNING]
> **Work in progress, at a very early stage.** Maps can already be played inside Let's Go Recomp (see
> [Playing the map in the game](#playing-the-map-in-the-game)), with limitations; the file format and the interface may
> change without notice.

A map made in the editor ([`examples/test-town.lgmap`](examples/test-town.lgmap)) and the same map in the game:

![The example map in the editor](docs/editor-map.png)
![The example map in the game](docs/ingame.png)

## Usage

```bash
npm install
npm run dev        # the editor in development mode
npm run build      # builds into out/
npm start          # runs the build
```

1. On first start, pick the game folder: your Let's Go Recomp install (it uses `extracted/romfs.bin`), an extracted
   `romfs` folder or the `romfs.bin` itself. The usual install locations are detected on their own.
2. The catalog is extracted (≈30 s) and thumbnails for its ~3000 objects are made (≈1 min, in the background).
   **Catalog › Make thumbnails again** makes the thumbnails again; **Catalog › Rebuild the catalog** extracts
   everything again (done on its own when the catalog version changes).
3. Build the map:
   - **Bottom**: the catalog by category (ground, trees, grass, flowers, ledges and slopes, rocks, fences, street
     furniture, Pokémon Centers, shops, gyms, buildings, doors, gimmicks, whole zones), with a search box and a filter by
     source zone. Drag a thumbnail into the view, double-click to put it in the middle, or click to "arm" it and place a
     copy with every click in the view (Esc to stop).
   - **Left**: the scene tree: groups, drag to reorder or nest, double-click to rename, hide and lock.
   - **Center**: the 3D view with a move / rotate / scale gizmo (W / E / R) and grid snapping.
   - **Right**: the inspector: position, rotation and scale as numbers (arithmetic works: `350+100`), the grid cell the
     object is on, and the map's own properties.
4. For wild Pokémon, place a **Tall-grass zone** (category _Grass_, the first one) and set its size
   in cells, the levels and which Pokémon appear and how often in the inspector (see
   [Tall-grass zones and wild Pokémon](#tall-grass-zones-and-wild-pokémon)).
5. For the ground, the **tiles** of the _Ground_ category are exported to the game; **Edit › Fill the ground** (or
   _Fill_ in the map's inspector) covers the grid with 4 × 4 tiles. For height changes, ledges and stairs use
   **Raised ground** and **Stairs** (category _Ledges and heights_), and for a sign read with A, **Sign with text**
   (category _Street furniture_). See [Heights, ledges and stairs](#heights-ledges-and-stairs) and [Signs](#signs).
6. Place the markers of the **Arrival and exit** category: the _Arrival point_ (the arrow: where the player arrives)
   and the _Exit_ (the teleport pad back to Pallet Town). Both are optional; don't put the arrival right next to the
   exit.
7. **File › Save** writes a `.lgmap`; **🎮 Export to the game** (or Ctrl+E) makes the mod (see below).

The menu bar (**File, Edit, View, Catalog, Help**) has every command with its shortcut; the toolbar only the
everyday ones (undo, move/rotate/scale, grid snapping, the view, logic and export).

![The editor with its menu bar, a raised block with its cliff, and stairs](docs/editor-terrain.png)

### Controls

|                              |                                                    |
| ---------------------------- | -------------------------------------------------- |
| Click                        | select (Ctrl/Shift: add to the selection)          |
| Right / middle button, wheel | orbit / pan / zoom                                 |
| W / E / R                    | move / rotate / scale                              |
| Q                            | turn 90°                                           |
| Arrows, PgUp/PgDn            | move one cell (Shift: ¼), up/down                  |
| X                            | grid snapping on/off                               |
| G / T / F                    | grid / top view / frame the selection              |
| Ctrl+D, Ctrl+G, Del          | duplicate, group, delete                           |
| Ctrl+Z / Ctrl+Y              | undo / redo                                        |
| Ctrl+N / O / S / Shift+S     | new / open / save / save as                        |
| Ctrl+E                       | export to the game                                 |
| Ctrl+L                       | logic (block editor)                               |

## The grid

As in the game, **a cell is 100 units** (a Strength boulder and a teleport pad are 100 × 100) and the objects the game
places itself sit on cell centers (multiples of 50). Snapping is half a cell by default; "Cell center" puts every
object on a cell center. The grid's size and origin are set in the map's inspector.

## Where the objects come from

- `bin/archive/field/buildmodel.gfpak`: the objects the game places one by one (tall grass, flowers, cuttable trees,
  Strength boulders, street lamps, Pokémon Center and shop doors, the PC...). Their names are recovered from the paths
  `placement.gfpak` refers to (the pack itself only has FNV-1a 64-bit hashes).
- Each zone's models (`bin/archive/field/<area>/<zone>.gfpak`) are "baked": every group (`tree001`, `bldg_pc`,
  `town010_00_build01`) holds all its instances in world coordinates. The editor splits each group into connected
  pieces, joins the ones that touch into instances, drops duplicates and leaves each piece with its origin at the center
  of its base. That is how Pokémon Centers, shops, houses, benches, lamps, signs, fences, ledges... appear.
- Every whole zone, to build on top of an existing map.
- Ground tiles (1 × 1 and 4 × 4 cells) with every terrain texture the zones use.

Formats read: GFLXPACK (LZ4), GFBMDL (FlatBuffers), BNTX (Tegra deswizzle + BC1/BC2/BC3/BC4/BC5/BC7) and RomFS. All in
TypeScript, in `src/shared/formats/`.

## Map format (`.lgmap`)

JSON, game units (Y up, 1 cell = 100), rotations in degrees (XYZ order):

```jsonc
{
  "format": "letsgo-map", "version": 1,
  "name": "My town", "author": "", "description": "",
  "grid": { "cellSize": 100, "width": 32, "depth": 32, "originX": -1600, "originZ": -1600 },
  "objects": [
    { "id": "o…", "name": "bldg_pc", "asset": "zp.area03.town003_00.bldg_pc.0", "parent": null,
      "position": [-600, 0, -500], "rotation": [0, 0, 0], "scale": [1, 1, 1], "visible": true, "locked": false }
  ],
  // where every model used comes from, to rebuild it from the game's files without the editor
  "assets": {
    "zp.area03.town003_00.bldg_pc.0": { "name": "bldg_pc", "category": "pc",
      "source": { "kind": "zonePiece", "pak": "bin/archive/field/area03/town003_00.gfpak", "fileIndex": 0,
                  "family": "bldg_pc", "pivot": [x, y, z], "instance": 0 } }
  }
}
```

A map may also have `slotGround` (the slot's meadow under the map: `true`/`false`; unset: only when the map has no
tiles), `border` (`{ "texture", "cells" }`: ground around the map) and `logic` (the block editor's workspace, Blockly's
JSON), and the editor's own objects their settings: `grass` (tall-grass zone), `terrain` (`w`, `d`, `height`, `top`,
`side`, `edges: { n, e, s, w: "wall" | "ledge" }`), `stairs` (`w`, `length`, `height`, `texture`), `sign` (`{ "text" }`)
and `trigger` (`{ "w", "d" }`).

`source.kind`: `model` (a whole model of a `.gfpak`, with its RomFS path when known), `zonePiece` (an instance of a group
of a zone model, with the point at its base in the zone's coordinates), `zone` (a whole zone), `tile` (a tile generated
with a game texture) or `marker` (the editor's own objects: arrival, exit, grass zone, raised block, stairs, sign,
trigger zone). Objects with `asset: null` are groups; a child's position is relative to its parent.

## Playing the map in the game

1. In the editor, **🎮 Export to the game**: pick the `mods/` folder of your Let's Go Recomp install (suggested on its own)
   and one of the four map slots. `mods/<map name>/` is created.
2. In the Let's Go Recomp launcher, **Mods** tab, enable the mod (and disable other map mods or mods that change
   `placement.gfpak` / `script_amx.gfpak`).
3. Play and go to **Pallet Town**: on the path between the northern houses there is a new teleport pad (the Saffron Gym's
   pad). Step on it to enter your map, with the game's teleport effect; the map's exit pad takes you back to Pallet Town
   the same way.

![The teleport: the player rises in a beam of light and appears in the map](docs/teleport.png)

A map exported now (tiled ground, tall grass, trees with their shadows, a sign):

![The example map exported with this version](docs/ingame-v2.png)

![The teleport pad in Pallet Town](docs/teleporter.png)

## Heights, ledges and stairs

![A ledge: the player jumps down from a raised block](docs/ledge.png)

- **Raised ground**: a rectangle of cells raised _Height_ units above the object's height (ledges in the game
  are 50 high), with one texture on top and another on its sides. Each edge (north, east, south, west) is either a
  **cliff**, which can't be crossed, or a **ledge**, which the player jumps down from but can't climb. Blocks may touch;
  in each cell the highest one wins.
- **Stairs**: _Width_ × _Length_ cells that climb _Height_ towards where the object faces (0°: north; turn it
  with Q). Put the high end against the edge of a block of the same height.
- Whatever is placed on top (the arrival point, the exit, grass zones) sits at the ground's height.

![Stairs in the game, and a whole map raised by 300 units with its tall grass](docs/stairs-tiles.png)

How the game does it and how it is exported (`src/shared/terrain.ts`; the editor draws exactly what is exported):

- The **floor** (`<slot>_floor.gfbcol`) is a single mesh at every height: on Route 1 the terraces are at 0, 50, 100...
  with vertical faces where the height changes. The editor works out a height per cell and writes the rectangles of each
  height, the stairs' ramps and those vertical faces.
- **Cliffs** are walls (`col_wall`) along the edge of the higher ground.
- A **ledge** is not an ordinary wall: it is a thin closed box of **`col_jump`** walls, one face on the edge line and one
  25 units out over the lower ground (Route 1: z = −815 and −790). The game lets the player through it only downwards,
  with the jump animation.
- In wall files, field 0 of each polygon is the index of its name in the file's list of names (`col_wall`, `col_sky`,
  `col_water`, `col_safety`, `col_jump`...); the same in floor files (`col_grass`, `col_ground`, `col_sea`: the kind of
  ground).

## Signs

![A sign of the map read in the game](docs/sign.png)

**Sign with text** uses Pallet Town's signboard; its text is written in the inspector. In the game, pressing A in front
of it (on its front side) opens the message window with the text: two lines per window, the next ones scroll in, and an
empty line starts a new window. A sign can also have logic (see [Logic with blocks](#logic-with-blocks)).

How it works (`src/shared/signs.ts`, `src/shared/amxgen.ts`):

- **List 17** of a zone's placement holds what can be inspected with A: a position, a box to face (80 × 100 × 50 in
  Pallet Town, turned to the side it is read from) and, in field 11 of its transform, the **hash of a script event**.
  The player has to be able to get into that box: the sign's wall is thinner than the model (with the model's own box,
  69 deep, the player couldn't reach it).
- `bin/script/param/script_id/script_id_record.bin` registers **every event** with the script that handles it and its
  messages (`0x59892b61…` → `bin/script/amx/town001.amx`, `script/town001.dat`). When entering a map, the game loads the
  messages of the events of its zones; when inspecting, it runs the script with the event's hash in its global 0.
- Scripts are **64-bit AMX (Pawn) in compact encoding** (each cell as 7-bit groups, most significant first, the high
  bit set on every byte but the last and bit 6 of the first one as the sign), with "packed" opcodes (the operand in the
  high 32 bits) and native names as hashes (`h = h·0x83 ^ byte`; the names are in plain text in the executable's
  `.rodata`: `MsgWin_`, `GetTargetFieldObjectID`, `ABKeyWait_`...). `town001.amx`'s main function switches on the event;
  each case calls a function that passes the message's label (FNV-1a 64 of `msg_town001_kanban_01`) to a common one that
  turns the player towards the sign and opens the window.
- The map's zone script is generated (see [Logic with blocks](#logic-with-blocks)): every sign is an event whose handler
  shows its text, or runs its logic.
- The messages go in `bin/message/<language>/script/<slot>.dat` and `.tbl` (the test slots' files exist and are
  registered in `bin/message/asset.tbl`), in all 10 languages. Format: one section; per line, its offset, length and
  flags; the text in UTF-16, encrypted per line (key 0x7C89 + 0x2983·line, XOR per character, the key rotated left 3
  bits after each). Line break `0x000A`; `0x0010 0x0001 0xBE00` before the break scrolls one line and `0xBE01` starts a
  new window. The `.tbl` (AHTB) lists the labels and ends with `msg_<zone>_max`.

## Logic with blocks

![The block editor: a sign whose text changes once a button has been stepped on](docs/logic-editor.png)

**🧩 Logic** (Ctrl+L, or _Add logic_ in a sign's or a trigger zone's inspector) opens the map's block editor
([Blockly](https://developers.google.com/blockly)): drag blocks from the left, snap them together or leave them loose;
the wheel zooms and dragging the background moves around the canvas. Only what hangs from an **event** runs:

- **When reading the sign** _X_: when the player reads that sign with A (it replaces the inspector's text).
- **When stepping into the zone** _X_: when the player walks into that **Trigger zone** (category _Gimmicks_: a
  rectangle of cells, invisible in the game; put any object on top to make it look
  like a button). Once per visit to the map; up to 6 zones.

Inside: **show text**, **variables** (create, set, change by), **constants** (number, true/false),
**conditions** (if / else if / else; =, ≠, <, ≤, >, ≥; and, or, not; + − ×). Variables are numbers (true = 1, false = 0)
and **are kept in the save**; up to 15 per map. Warnings (a block without a value, an event without an object...) show
at the bottom right and when exporting.

The example [`examples/sign-and-button.lgmap`](examples/sign-and-button.lgmap) is the one in the picture; in the game:

![The sign before, the button, and the sign after](docs/logic-game.png)

How it gets into the game (`src/shared/logic.ts`, `src/shared/amxgen.ts`):

- The logic is saved in the map (`logic`) as Blockly's JSON; the export reads it without Blockly and turns it into a
  small program (events, statements, expressions).
- **The zone's script** is generated: Pallet Town's (`town001.amx`, for its message functions) with our code **appended
  after its code** (in Pawn, calls and jumps are relative and data is addressed from its own section, so nothing moves),
  a new main function (the entry point, `cip`) that compares the event's hash (global 0) with ours, and one more native
  in its table (`WorkSet`; the tables after it and the sections have to move, including the `overlays` field of the Pawn
  3.3 header: without it the game crashed). Expressions leave their value in PRI; binary operators get their left side
  in ALT.
- **Show text** on a sign calls Pallet Town's sign function (`0x1d80`: turns the player, opens the window, waits and
  closes it); in a trigger zone, the message function that doesn't turn the player (`0xf40`), then the wait (`0xe80`) and
  close (`0xdb8`) ones. Each text is a line of the zone's message file.
- **Variables** are the game's _works_ (`WorkGet(hash)`, `WorkSet(hash, value)`), kept in the save: works are named in
  `bin/flagwork/*.tbl` (AHTB: a name's hash gives its slot in the save, in order) and `system_works.tbl` has 15 slots
  named `NOUSED`; the mod renames them (`LGMAP_WORK_01`...).
- **Trigger zones** are entries of placement **list 14** (the ones the game uses for scenes when passing a spot): a
  position, an area (its size is **half its extent**, from the center), the event's hash, and a work with a value: the
  game only fires it while that work has that value. If the condition stays true, it fires again and again while the
  player stays inside; so each zone has a work of its own (in `zone_works.tbl`, which has 6 free slots) and its script
  sets it to 1 first.
- The events of signs and trigger zones are registered in `script_id_record.bin` with the zone's script and messages.

## Tall-grass zones and wild Pokémon

![A grass zone in the editor: size, levels and Pokémon table in the inspector](docs/editor-grass.png)

Each **Tall-grass zone** of the map is a rectangle of cells with its own table: up to 10 Pokémon (Kanto's 151,
Meltan and Melmetal), the chance of each one (they must add up to 100 %; **Share 100 %** evens them out) and the
level range. The same table applies to Pikachu and Eevee.

In the game the zone fills with animated tall grass and the Pokémon appear and wander in it, as on the routes; touching
one starts the catch:

![Before and now: tall grass like the game's and soft tree shadows](docs/before-after.png)
![A wild level 9 Charmander from the second zone](docs/encounter.png)

How it is built (`src/shared/encounters.ts`):

- **One game zone per grass zone.** The game has one wild table per _zone_ (a map is split into zones, each with its
  shape, its object lists, its scripts and its table), so each grass zone is exported as a new zone of the slot
  (`<slot>_g1`, `_g2`…): its shape is the grass rectangle and the map's base zone covers the remaining cells, without
  overlapping. It is registered in `ZoneNameHashTable.tbl` and gets its scripts (`.amx`).
- **The grass** is a _vegetation patch_ (list 5 of the zone's placement): a position, a `.gfbcol` shape of cells around
  it and the tuft model (`enc_grass01.gfbmdl`), with which the game fills the shape. All the tall grass of the game's
  routes is made that way. The game's 75 `_enc*.gfbcol` shapes carry, besides the position, a **color per vertex**
  (attribute `{type 7, format 3, 4}`: four bytes, white in nearly all of them) that the game reads for every tuft;
  without it, it read garbage and tufts came out in random sizes and shades (the left picture).
- **The table** is added to `bin/field/param/encount/encount_data_p.bin` (Pikachu) and `_e.bin` (Eevee), copying Route
  1's (how many appear at once, how often) and changing slots and levels. A table's format (FlatBuffers): field 0 = the
  zone's hash; grass: 4 max at once, 5 interval, 7/8 min/max level, 10 the 10 slots `{0 chance %, 1 species}`; water
  12–18 and sky 35–41 with the same shape (emptied).

### How it works

The game has no open map format: the mod **replaces one of its unused maps** with yours, using the same file types its
maps use. The slots are the four character test rooms (`test_chr01`…`04`): the game has them registered (with their
model, collision, terrain and placement), but no path leads to them.

| Mod file (`romfs/…`)                                     | What it is                                                                                                                                                                  |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bin/field/model/<slot>/<slot>.gfbmdl`                   | the map's model: every object's triangles, taken from the game's original vertex data (not the editor's cache) and moved into place; all in one model, with the original materials |
| `bin/archive/field/<slot>.gfpak`                         | the slot's resources plus the shaders (`<material>.bnsh_vsh/.bnsh_fsh`) and textures (`<texture>.bntx`) of every material, copied from the packs the pieces come from         |
| `bin/field/model/<slot>/<slot>_floor/_wall/_zone.gfbcol` | collision: the floor at every height, walls around the grid, boxes around solid objects (buildings, trees, rocks, fences, furniture), cliffs and ledges, and the zone's shape |
| `bin/field/param/terrain/<slot>/terrain_data.bin`        | the slot's terrain block, with the map's size (and height)                                                                                                                  |
| `bin/archive/field/placement.gfpak`                      | the slot's placement (an outdoor map's settings, without the test characters, with the pad back, signs and trigger zones); area02's with the teleport pad in Pallet Town     |
| `bin/archive/script_amx.gfpak`                           | the scripts every zone needs (`<zone>.amx`, `init_<zone>.amx`); the test rooms have none and the game hangs on entering without them. With signs or logic, the generated one  |
| `bin/script/param/script_id/script_id_record.bin`        | (with signs or logic) their events, with their script and messages                                                                                                          |
| `bin/message/<language>/script/<slot>.dat/.tbl`          | (with signs or logic) their texts                                                                                                                                           |
| `bin/flagwork/system_works.tbl`, `zone_works.tbl`        | (with variables or trigger zones) the names of their works                                                                                                                  |
| `bin/field/model/<slot>/<slot>_gN_zone/_enc.gfbcol`      | the shape of each grass zone and of its grass patch                                                                                                                         |
| `bin/field/param/encount/encount_data_p/_e.bin`          | the grass zones' wild Pokémon tables                                                                                                                                        |
| `bin/field/param/placement/table/ZoneNameHashTable.tbl`  | the names of the new zones                                                                                                                                                  |
| `bin/lgmap/<name>.lgmap`                                 | the editor's map (the game doesn't read it; it is there to open it again)                                                                                                   |

**The ground.** The editor's tiles are exported drawn with a game ground material (`FieldObjectShader`, Route 1's paving
stones, `roadstone01_com` in `area02/road001_00`) with its texture replaced by the tile's. The slot comes with its own
ground, a 40 × 40-cell test meadow whose UVs are in islands (stripes show): by default it only goes under maps without
tiles (_Slot meadow_ in the map's inspector). Beyond the map's edge the game draws nothing but its background:
**it is not a test-room floor** (the only model the map loads is ours, checked with the log of opened files, and raising
the whole map by 300 units doesn't change that background), so lowering or raising the map doesn't hide it; that is
what the **Outer border** is for (a ring of ground around the map, only drawn).

Without the interface: `node scripts/build-map-mod.ts <map.lgmap> <catalog cache> <game folder> <mods folder> [name]`.

### What had to be worked out

Notes on how this was reached, for whoever carries on:

- **Placement** (`bin/archive/field/placement.gfpak`, one FlatBuffer per map at `bin/field/param/placement/<map>.bin`;
  the names are recovered by trying paths against the FNV-1a 64 hashes): the root is the map (field 1 = its name's hash),
  with a vector of zones; each zone has its info (field 1 = the zone name's hash, e.g. `town001` = Pallet Town) and about
  28 object lists. List 2: objects with a model (`warp01.gfbmdl`…). List 4: **warps** (the trigger's position, the
  destination map _by name_, the destination zone's hash, the arrival position and rotation, the trigger box, and on
  doors the door's model and animation); a warp fires when entering its box **walking in the box's direction**. List 5:
  vegetation patches. List 14: step triggers. List 17: things to inspect. List 25: teleport pads.
- **Editing FlatBuffers without a schema**: offsets only point forward, so whatever changes is written again at the end
  of the file and linked in again (`src/shared/formats/fbedit.ts`). To copy tables without knowing which fields are
  offsets, the editor **learns the schema** from hundreds of instances (a field is an offset if in all of them it points
  at a string, a table or a vector of them).
- **Test maps**: `test_chr01` hung on entering; hooking `nn::fs::OpenFile` (the runtime's `LARECOMP_HOOK_DUMP`) showed it
  asked for `bin/script/amx/test_chr01.amx` and then `init_test_chr01.amx`, which don't exist. The empty script many
  zones share does for both.
- **`terrain_data.bin`** lists each map's terrain blocks: box, model, animation, wall and floor collision.
- **Schemas learned from many samples**: copying zones learning only from the slot's (1–3 zones) misclassified fields and
  corrupted the first grass zone when adding the second; the zone schema is now learned from every zone of every map.
  Empty strings (length 0) count as strings.
- **Pixelated shadows**: fields 13..18 of the placement root are not the map's bounds but the shadow volume around the
  camera (area02: −1536, −1024, −1536 .. 1536, 1024, 512; interiors −1024..768). The exporter filled them with the map's
  size and stretched the shadow map over all of it. The slot's root is now written again with area02's layout and values
  (field 6 = outdoor, 7..12 outdoor lighting and fog, 13..18, 23/24), keeping its own name and children.
- **Shadow casters**: trees and other pieces cast their shadow with invisible meshes (`FieldShadowOnlyShader`) the
  catalog leaves out of the pieces; the export finds again the ones of the same family inside the piece's box.
- **Fields at 0**: FlatBuffers tables leave out fields at their default value, so many of the game's transforms have no
  Y (or X, or Z). When copying a template the field has to be **added** (`cloneTable` with extra fields), not just
  written: the grass patch template had no Y and, with the map raised, the grass stayed at height 0.
- **Teleport pads**: list 25 pads can lead to another map (`t009r02`'s and `r010r01`'s do); the Saffron Gym's have field
  10 = 1, which keeps them within the same map. With a template without that field the map changes with the teleport
  effect; walk-in warps of list 4 were used before (no effect).
- **Arrival next to the exit**: with the arrival point right next to the exit pad, Pallet Town's teleport pad didn't take
  the player to the map.
- **Materials**: fields 8 and 10 of a material are its number in the model (its shader in the shader list); when merging
  materials from several models they have to be rewritten or the game reads past the list.
- Testing was done with Let's Go Recomp's scripted runs (`tools/scenario_shot.sh`, `mod = <name>` in the ini), which take
  a copy of the save to Pallet Town and take screenshots.

### Limitations

- The map is only reached from Pallet Town (fixed teleport pad position), and only one map mod can be active at a time:
  the mod replaces `placement.gfpak` and `script_amx.gfpak` whole (and, with signs or logic, `script_id_record.bin`).
- Raised blocks and stairs are aligned to the grid; stairs climb in a straight line. The sides and stairs use an object
  material, without the grass blend along the game's cliff edges.
- Signs and trigger zones work in the map's base zone (not tested inside a grass zone). Trigger zones: up to 6, once per
  visit. Variables: up to 15, numbers only.
- The logic is simple for now: read and step events, texts, variables and conditions (no loops, no yes/no questions, no
  giving items or moving characters).
- Whole zones and animated objects (doors) are exported as static geometry. So are the catalog's loose tall-grass tufts:
  encounters need a _Tall-grass zone_.
- Grass zones are grid-aligned rectangles (they don't rotate) and their table is the same for Pikachu and Eevee; there
  are no water or flying Pokémon.
- Building doors lead nowhere.

## To do

- Choosing in the editor the map and spot of the entrance teleport pad.
- Cliff edges with the game's grass (its `FieldCliffShader01`), curved ramps and stairs.
- Signs with other models and NPCs that talk (the same way: the character list + an event + the script).
- More blocks: yes/no questions, giving items, battles, moving and turning characters, sounds, waiting; trigger zones
  that re-arm when the player leaves them.
- Water and flying Pokémon (the same tables have those blocks), different tables for Pikachu and Eevee.
- The game's NPCs and items (other placement lists).
- The viewer's materials are approximated with Lambert lighting; terrain shaders that blend several textures use only
  the main one.

## Layout

```
src/shared/formats/      readers of the game's formats (gfpak, lz4, flatbuf, gfbmdl, bntx, bcn, gamefs, png)
src/shared/extract.ts    builds the catalog (LGM models + PNG textures in the cache)
src/shared/lgm.ts        the cache's model format
src/shared/placement.ts  the game's placement: warps, teleport pads, object lists, signs, step triggers
src/shared/mapbuild.ts   the export to the game (merged model, pack, collision, terrain, placement, scripts)
src/shared/terrain.ts    heights per cell: floor, cliffs, ledges, stairs and their surfaces
src/shared/collision.ts  .gfbcol files (names per polygon, color per vertex)
src/shared/signs.ts      compact AMX, encrypted messages, the event register, renamed works
src/shared/logic.ts      the block logic: reads Blockly's JSON
src/shared/amxgen.ts     generates the zone script (AMX) from the signs and the logic
src/shared/encounters.ts grass zones: new zones, vegetation patches, wild tables, zone names
src/shared/pokemon.ts    Let's Go's species
src/main/                Electron's main process (settings, the catalog in a worker, files, mods)
src/renderer/            the interface (React + three.js): store with undo, 3D view, thumbnails, panels
src/renderer/src/logic/  the editor's blocks (Blockly)
scripts/                 development tools: extract-cli, build-map-mod (export a .lgmap without the interface),
                         pakinfo, pakhash, pakextract, fbdump, coldump, listdump, mdlinfo, meshattrs, rootfields,
                         schema, warps, debugtable, texdump, cdp (automated tests)
```

The cache lives in `%APPDATA%/letsgo-map-builder/library`.
