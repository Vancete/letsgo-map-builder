import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// for scripted testing (scripts/cdp.ts)
import { useEditor } from './store';
import { getView } from './components/Viewport';
(window as unknown as { __lg: unknown }).__lg = { useEditor, getView };
