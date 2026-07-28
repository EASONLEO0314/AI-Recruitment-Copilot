import { createRoot } from 'react-dom/client';

import styles from './styles.css?inline';
import { CopilotPanel } from './components/CopilotPanel';


const HOST_ID = 'ai-recruitment-copilot-root';


export function mountCopilot(targetDocument: Document = document): HTMLElement {
  const existingHost = targetDocument.getElementById(HOST_ID);
  if (existingHost instanceof HTMLElement) {
    return existingHost;
  }

  const host = targetDocument.createElement('div');
  host.id = HOST_ID;
  const shadowRoot = host.attachShadow({ mode: 'open' });

  const style = targetDocument.createElement('style');
  style.textContent = styles;
  shadowRoot.appendChild(style);

  const appRoot = targetDocument.createElement('div');
  appRoot.id = 'arc-app';
  shadowRoot.appendChild(appRoot);

  targetDocument.documentElement.appendChild(host);
  createRoot(appRoot).render(<CopilotPanel />);

  return host;
}
