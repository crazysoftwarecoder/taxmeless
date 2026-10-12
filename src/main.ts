import './styles/main.css';
import { firstPaint } from './ui/first-paint';

try {
  const t = localStorage.getItem('theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch { /* ignore */ }

// Paint inputs and the results table immediately, then load the chart bundle.
try {
  firstPaint();
} finally {
  document.body.classList.remove('booting');
}
void import('./ui/app').then((m) => m.startApp());
