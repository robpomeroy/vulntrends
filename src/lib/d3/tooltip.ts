/**
 * Shared tooltip factory for D3 charts.
 *
 * Creates a fixed-position tooltip element that follows the mouse and
 * displays formatted content. The tooltip is styled via the `.vt-tooltip`
 * class in `global.css`.
 *
 * Content is provided as DOM nodes (not HTML strings) to prevent XSS —
 * all text is inserted via `textContent`, which does not parse HTML.
 */

/** A single row in the tooltip body. */
export interface TooltipRow {
  /** Colour dot (CSS colour value). */
  colour: string;
  /** Label text (e.g. manufacturer name). */
  label: string;
  /** Value text (e.g. count or lag). */
  value: string;
}

export interface Tooltip {
  show: (event: MouseEvent, title: string, rows: TooltipRow[]) => void;
  hide: () => void;
  destroy: () => void;
}

/** Create a tooltip instance. Call `destroy()` when the chart is removed. */
export function createTooltip(): Tooltip {
  const el = document.createElement('div');
  el.className = 'vt-tooltip';
  document.body.appendChild(el);

  return {
    show(event: MouseEvent, title: string, rows: TooltipRow[]) {
      // Clear previous content
      el.replaceChildren();

      // Title — textContent prevents HTML injection
      const titleEl = document.createElement('div');
      titleEl.style.fontWeight = '600';
      titleEl.style.marginBottom = '4px';
      titleEl.textContent = title;
      el.appendChild(titleEl);

      // Rows
      for (const row of rows) {
        const rowEl = document.createElement('div');
        rowEl.style.display = 'flex';
        rowEl.style.alignItems = 'center';
        rowEl.style.gap = '6px';

        const dot = document.createElement('span');
        dot.style.width = '8px';
        dot.style.height = '8px';
        dot.style.borderRadius = '50%';
        dot.style.flexShrink = '0';
        dot.style.backgroundColor = row.colour;
        rowEl.appendChild(dot);

        const text = document.createElement('span');
        text.textContent = `${row.label}: ${row.value}`;
        rowEl.appendChild(text);

        el.appendChild(rowEl);
      }

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
