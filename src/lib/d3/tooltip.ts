/**
 * Shared tooltip factory for D3 charts.
 *
 * Creates a fixed-position tooltip element that follows the mouse and
 * displays formatted content. The tooltip is styled via the `.vt-tooltip`
 * class in `global.css`.
 */

export interface Tooltip {
  show: (event: MouseEvent, html: string) => void;
  hide: () => void;
  destroy: () => void;
}

/** Create a tooltip instance. Call `destroy()` when the chart is removed. */
export function createTooltip(): Tooltip {
  const el = document.createElement('div');
  el.className = 'vt-tooltip';
  document.body.appendChild(el);

  return {
    show(event: MouseEvent, html: string) {
      el.innerHTML = html;
      el.classList.add('visible');
      const offset = 12;
      const x = event.clientX + offset;
      const y = event.clientY + offset;
      // Prevent tooltip from going off-screen
      const rect = el.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width - offset;
      const maxY = window.innerHeight - rect.height - offset;
      el.style.left = `${Math.min(x, maxX)}px`;
      el.style.top = `${Math.min(y, maxY)}px`;
    },
    hide() {
      el.classList.remove('visible');
    },
    destroy() {
      el.remove();
    },
  };
}
