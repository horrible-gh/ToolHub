import './style.css';
import { initShell } from './shell.js';
import { initTools } from './tools/index.js';

document.documentElement.classList.add('js');
initShell();
initTools();
