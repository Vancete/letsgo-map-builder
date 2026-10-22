// Bottom panel: the catalog of game objects with thumbnails. Drag a card into the view, double-click to drop it at the
// view's center, or click to arm it and click in the view to place copies.
import { memo, useDeferredValue, useMemo, useState } from 'react';
import { useEditor } from '../store';
import { useUi } from '../ui';
import { CATEGORY_LABELS, CATEGORY_ORDER, type AssetEntry, type Category } from '@shared/types';
import { thumbUrl } from '../three/thumbs';
import { getView } from './Viewport';

type CatKey = Category | 'all' | 'used';

function readPref<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
}
function writePref(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

const Card = memo(function Card({ a, thumb, armed, onArm }: { a: AssetEntry; thumb: string | null; armed: boolean; onArm(id: string): void }) {
  return (
    <div
      className={`card ${armed ? 'armed' : ''}`}
      draggable
      title={`${a.name}\n${CATEGORY_LABELS[a.category]}${a.zone ? ` · ${a.zone}` : ''}\n${Math.round(a.bounds[3] - a.bounds[0])} × ${Math.round(a.bounds[5] - a.bounds[2])} u, ${Math.round(a.bounds[4] - a.bounds[1])} high\nDrag into the view, double-click to add, click to place several`}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-lgasset', a.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onArm(a.id)}
      onDoubleClick={() => {
        const ed = useEditor.getState();
        ed.arm(null);
        ed.addObject(a.id, getView()?.viewCenter() ?? [0, 0, 0]);
      }}
    >
      <div className="thumb">{thumb ? <img src={thumb} loading="lazy" /> : <span className="ph">…</span>}</div>
      <div className="label">{a.name}</div>
      <div className="sub">{a.zone ?? CATEGORY_LABELS[a.category]}</div>
    </div>
  );
});

export function AssetBrowser() {
  const catalog = useEditor((s) => s.catalog);
  const thumbs = useEditor((s) => s.thumbs);
  const thumbVersion = useEditor((s) => s.thumbVersion);
  const armed = useEditor((s) => s.armedAsset);
  const objects = useEditor((s) => s.doc.objects);
  const thumbJob = useUi((s) => s.thumbJob);
  const [cat, setCat] = useState<CatKey>(() => readPref<CatKey>('browser.cat', 'tree'));
  const [query, setQuery] = useState('');
  const [size, setSize] = useState(() => readPref('browser.size', 104));
  const [zone, setZone] = useState('');
  const q = useDeferredValue(query.trim().toLowerCase());

  const assets = catalog?.assets ?? [];
  const counts = useMemo(() => {
    const m = new Map<CatKey, number>();
    for (const a of assets) m.set(a.category, (m.get(a.category) ?? 0) + 1);
    return m;
  }, [assets]);
  const used = useMemo(() => new Set(objects.map((o) => o.asset).filter(Boolean)), [objects]);
  const zones = useMemo(() => [...new Set(assets.map((a) => a.zone).filter((z): z is string => !!z))].sort(), [assets]);

  const list = useMemo(() => {
    let l = assets;
    if (cat === 'used') l = l.filter((a) => used.has(a.id));
    else if (cat !== 'all') l = l.filter((a) => a.category === cat);
    if (zone) l = l.filter((a) => a.zone === zone || (zone === '-' && !a.zone));
    if (q) l = l.filter((a) => a.name.toLowerCase().includes(q) || (a.zone ?? '').toLowerCase().includes(q) || a.id.toLowerCase().includes(q));
    return l;
  }, [assets, cat, q, used, zone]);

  const onArm = (id: string) => {
    const ed = useEditor.getState();
    ed.arm(ed.armedAsset === id ? null : id);
  };

  const pickCat = (c: CatKey) => {
    setCat(c);
    writePref('browser.cat', c);
  };

  const shown = list.slice(0, 1500);
  return (
    <div className="browser">
      <div className="cats">
        <div className={`cat ${cat === 'all' ? 'on' : ''}`} onClick={() => pickCat('all')}>
          All <small>{assets.length}</small>
        </div>
        <div className={`cat ${cat === 'used' ? 'on' : ''}`} onClick={() => pickCat('used')}>
          In the map <small>{used.size}</small>
        </div>
        {CATEGORY_ORDER.filter((c) => counts.get(c)).map((c) => (
          <div key={c} className={`cat ${cat === c ? 'on' : ''}`} onClick={() => pickCat(c)}>
            {CATEGORY_LABELS[c]} <small>{counts.get(c)}</small>
          </div>
        ))}
      </div>
      <div className="assets-wrap">
        <div className="assets-tools">
          <input type="search" placeholder="Search objects (name, zone...)" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={zone} onChange={(e) => setZone(e.target.value)} title="Filter by source zone">
            <option value="">All zones</option>
            <option value="-">The game's standalone objects</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <span className="kv">
            {list.length} objects{list.length > shown.length ? ` (showing ${shown.length})` : ''}
          </span>
          <span className="grow" />
          {thumbJob && (
            <>
              <span className="kv">
                Generando miniaturas {thumbJob.done}/{thumbJob.total}
              </span>
              <div className="progress">
                <div style={{ width: `${(thumbJob.done / thumbJob.total) * 100}%` }} />
              </div>
            </>
          )}
          <input
            type="range"
            min={72}
            max={180}
            value={size}
            title="Thumbnail size"
            onChange={(e) => {
              setSize(Number(e.target.value));
              writePref('browser.size', Number(e.target.value));
            }}
          />
        </div>
        <div className="assets" style={{ '--card': `${size}px` } as React.CSSProperties}>
          {shown.map((a) => (
            <Card key={a.id} a={a} thumb={thumbs.has(a.id) ? thumbUrl(a.id, thumbVersion) : null} armed={armed === a.id} onArm={onArm} />
          ))}
          {!list.length && <div className="empty">Nothing here.</div>}
        </div>
      </div>
    </div>
  );
}
