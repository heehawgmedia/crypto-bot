export type Child = Node | string | null | undefined | false;
export type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Minimal element builder: `el('button', { class: 'x', onclick: fn }, ['Label'])`. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

export function clear(node: Element): void {
  node.replaceChildren();
}

export interface Choice {
  value: string;
  label: string;
}

export function selectInput(choices: Choice[], value: string, onChange: (v: string) => void, attrs: Attrs = {}): HTMLSelectElement {
  const s = el('select', attrs);
  for (const c of choices) s.append(el('option', { value: c.value, text: c.label }));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export interface NumberOpts {
  min?: number;
  max?: number;
  step?: number;
  /** Fire on every keystroke instead of on commit. */
  live?: boolean;
}

export function numberInput(value: number, opts: NumberOpts, onChange: (v: number) => void, attrs: Attrs = {}): HTMLInputElement {
  const i = el('input', { type: 'number', value: String(value), min: opts.min, max: opts.max, step: opts.step ?? 1, ...attrs });
  i.addEventListener(opts.live ? 'input' : 'change', () => {
    let v = Number(i.value);
    if (!Number.isFinite(v)) return;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    i.value = String(v);
    onChange(v);
  });
  return i;
}

export function rangeInput(value: number, opts: { min: number; max: number; step: number }, onChange: (v: number) => void): HTMLInputElement {
  const i = el('input', { type: 'range', value: String(value), min: opts.min, max: opts.max, step: opts.step });
  i.addEventListener('input', () => onChange(Number(i.value)));
  return i;
}

export function textInput(value: string, onChange: (v: string) => void, attrs: Attrs = {}): HTMLInputElement {
  const i = el('input', { type: 'text', value, ...attrs });
  i.addEventListener('input', () => onChange(i.value));
  return i;
}

export function checkboxInput(checked: boolean, onChange: (v: boolean) => void): HTMLInputElement {
  const i = el('input', { type: 'checkbox' });
  i.checked = checked;
  i.addEventListener('change', () => onChange(i.checked));
  return i;
}

export function button(label: string, onClick: (e: Event) => void, attrs: Attrs = {}): HTMLButtonElement {
  return el('button', { type: 'button', ...attrs, onclick: onClick }, [label]);
}

export function field(label: string, control: Node, hint?: string): HTMLElement {
  return el('label', { class: 'field' }, [el('span', { class: 'field-label', text: label }), control, hint ? el('span', { class: 'hint', text: hint }) : null]);
}

export function section(title: string, children: Child[], opts: { open?: boolean; class?: string } = {}): HTMLDetailsElement {
  const d = el('details', { class: `section ${opts.class ?? ''}`.trim(), open: opts.open !== false });
  d.append(el('summary', { text: title }), el('div', { class: 'section-body' }, children));
  return d;
}

/** Update a control's value without fighting the user while they are typing in it. */
export function setIfNotFocused(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (document.activeElement === input) return;
  if (input.value !== value) input.value = value;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
