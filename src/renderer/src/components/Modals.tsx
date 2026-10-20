import { useUi } from '../ui';

export function Modals() {
  const confirm = useUi((s) => s.confirm);
  const toast = useUi((s) => s.toast);
  const close = useUi((s) => s.closeConfirm);
  return (
    <>
      {confirm && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close('cancel')}>
          <div className="modal">
            <h2>{confirm.title}</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{confirm.text}</p>
            <div className="actions">
              {confirm.buttons.map((b) => (
                <button key={b.value} className={b.primary ? 'primary' : ''} onClick={() => close(b.value)} autoFocus={b.primary}>
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {toast && <div className={`toast ${toast.error ? 'err' : ''}`}>{toast.text}</div>}
    </>
  );
}
