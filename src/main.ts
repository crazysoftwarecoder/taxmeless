import './styles/main.css';
import { startApp } from './ui/app';

try {
  const t = localStorage.getItem('theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch { /* ignore */ }

startApp();
