// Inspector sections of a sign (the text the player reads with A) and of a trigger zone (an area that runs its logic
// when the player walks into it); both open the block editor at their event.
import { useEditor } from '../store';
import type { MapObject } from '@shared/types';
import { messageChars } from '@shared/signs';
import { BLOCK, readProgram, type WorkspaceJson } from '@shared/logic';
import { openLogic } from '../actions';

function hasEvent(type: string, field: string, id: string, logic: unknown): boolean {
  const ws = logic as WorkspaceJson | undefined;
  return !!ws?.blocks?.blocks?.some((b) => b.type === type && b.fields?.[field] === id);
}

export function SignPanel({ obj }: { obj: MapObject }) {
  const logic = useEditor((s) => s.doc.logic);
  const text = obj.sign?.text ?? '';
  const scripted = hasEvent(BLOCK.onRead, 'SIGN', obj.id, logic);
  const long = text.split('\n').filter((l) => l.length > 44).length;
  return (
    <div>
      <h3>Cartel</h3>
      <textarea
        key={obj.id}
        rows={6}
        defaultValue={text}
        disabled={scripted}
        placeholder="Texto del cartel"
        style={{ width: '100%', resize: 'vertical', opacity: scripted ? 0.5 : 1 }}
        onBlur={(e) => e.target.value !== text && useEditor.getState().updateObject(obj.id, { sign: { text: e.target.value } })}
      />
      <div className="btn-row" style={{ marginTop: 6 }}>
        <button onClick={() => openLogic(obj.id)}>🧩 {scripted ? 'Editar su lógica' : 'Añadir lógica'}</button>
      </div>
      <p className="kv">
        {scripted ? (
          <>Este cartel tiene lógica (bloque «Al leer el cartel»): lo que muestra se decide allí y este texto no se usa.</>
        ) : (
          <>
            En el juego, al pulsar A delante del cartel (por su cara delantera) aparece este texto. La ventana muestra dos líneas;
            las siguientes van apareciendo al pulsar A, y una <b>línea en blanco</b> empieza una ventana nueva.
            {long > 0 && <span style={{ color: 'var(--danger)' }}> Hay líneas de más de 44 letras: puede que no quepan.</span>}
            <br />
            {messageChars(text || '...').length - 1} caracteres.
          </>
        )}
      </p>
    </div>
  );
}

function IntInput({ value, onChange }: { value: number; onChange(v: number): void }) {
  return <input type="number" min={1} max={32} value={value} onChange={(e) => onChange(Math.max(1, Math.min(32, Math.round(Number(e.target.value)) || 1)))} style={{ width: '100%' }} />;
}

export function TriggerPanel({ obj }: { obj: MapObject }) {
  const logic = useEditor((s) => s.doc.logic);
  const t = obj.trigger ?? { w: 1, d: 1 };
  const set = (p: Partial<typeof t>) => useEditor.getState().updateObject(obj.id, { trigger: { ...t, ...p } });
  const scripted = hasEvent(BLOCK.onStep, 'ZONE', obj.id, logic);
  const errors = readProgram(logic as WorkspaceJson).errors;
  return (
    <div>
      <h3>Zona de activación</h3>
      <div className="field">
        <span>Casillas</span>
        <div className="vec3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <IntInput value={t.w} onChange={(w) => set({ w })} />
          <IntInput value={t.d} onChange={(d) => set({ d })} />
        </div>
      </div>
      <div className="btn-row" style={{ marginTop: 6 }}>
        <button onClick={() => openLogic(obj.id)}>🧩 {scripted ? 'Editar su lógica' : 'Añadir lógica'}</button>
      </div>
      <p className="kv">
        Cuando el jugador entra en estas casillas se ejecuta su bloque «Al pisar la zona» (una vez por visita al mapa). En el juego
        no se ve: pon encima un objeto si quieres que parezca un botón. Hasta 6 zonas por mapa.
        {!scripted && <span style={{ color: 'var(--danger)' }}> Aún no tiene lógica: no hará nada.</span>}
        {errors.length > 0 && <span style={{ color: 'var(--danger)' }}> La lógica del mapa tiene avisos: ábrela para verlos.</span>}
      </p>
    </div>
  );
}
