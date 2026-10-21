// Inspector section of a sign: the text the player reads in the game when pressing A in front of it.
import { useEditor } from '../store';
import type { MapObject } from '@shared/types';
import { messageChars } from '@shared/signs';

export function SignPanel({ obj }: { obj: MapObject }) {
  const text = obj.sign?.text ?? '';
  const lines = text.split('\n');
  const long = lines.filter((l) => l.length > 44).length;
  return (
    <div>
      <h3>Cartel</h3>
      <textarea
        key={obj.id}
        rows={6}
        defaultValue={text}
        placeholder="Texto del cartel"
        style={{ width: '100%', resize: 'vertical' }}
        onBlur={(e) => e.target.value !== text && useEditor.getState().updateObject(obj.id, { sign: { text: e.target.value } })}
      />
      <p className="kv">
        En el juego, al pulsar A delante del cartel (por su cara delantera) aparece este texto. La ventana muestra dos líneas; las
        siguientes van apareciendo al pulsar A, y una <b>línea en blanco</b> empieza una ventana nueva.
        {long > 0 && <span style={{ color: 'var(--danger)' }}> Hay líneas de más de 44 letras: puede que no quepan.</span>}
        <br />
        {messageChars(text || '...').length - 1} caracteres · hasta 8 carteles por mapa.
      </p>
    </div>
  );
}
