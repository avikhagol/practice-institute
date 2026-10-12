import { mountLauncher } from './app';

const root = document.getElementById('app');
if (!root) throw new Error('Launcher root element is missing.');
void window.pi.getState().then(state => { mountLauncher(root, window.pi, state); });
