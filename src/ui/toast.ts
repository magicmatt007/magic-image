/** The four-point sparkle from the app icon (yellow, see .spark in styles.css). */
const SPARK =
  '<svg class="spark" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2Q12 12 22 12Q12 12 12 22Q12 12 2 12Q12 12 12 2Z" fill="currentColor"/></svg>';

let host: HTMLDivElement | null = null;

export function toast(message: string, kind: 'info' | 'error' = 'info') {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = SPARK;
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2200);
  setTimeout(() => el.remove(), 2600);
}
