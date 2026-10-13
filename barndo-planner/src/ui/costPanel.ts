import { CATEGORY_ORDER, estimate, type Category, type Estimate } from '../cost/estimate';
import type { Project } from '../model/types';
import { el } from './dom';
import { fmtInt, fmtMoney } from './format';

export function createCostPanel(): { el: HTMLElement; update: (p: Project) => Estimate } {
  const total = el('div', { class: 'cost-total' });
  const metrics = el('div', { class: 'stats' });
  const warnings = el('div', { class: 'warnings' });
  const groups = el('div', { class: 'cost-groups' });
  const collapsed = new Set<Category>();
  const root = el('div', { class: 'cost-panel' }, [
    el('h2', { text: 'Build estimate' }),
    total,
    metrics,
    warnings,
    groups,
    el('p', { class: 'hint disclaimer', text: 'Planning-level estimate from national-average unit costs (see src/cost/pricing.ts). Local bids vary widely: use the regional multiplier and contingency, and treat the result as a budget starting point, not a quote.' }),
  ]);

  const stat = (label: string, value: string): HTMLElement => el('div', { class: 'stat' }, [el('span', { class: 'stat-value', text: value }), el('span', { class: 'stat-label', text: label })]);

  let last: Estimate | undefined;
  const render = (): void => {
    const est = last;
    if (!est) return;
    total.replaceChildren(
      el('div', { class: 'total-line' }, [el('span', { class: 'total-label', text: 'Estimated total' }), el('span', { class: 'total-value', text: fmtMoney(est.total) })]),
      el('div', { class: 'total-sub' }, [`${fmtMoney(est.metrics.costPerSf)}/sf footprint · ${fmtMoney(est.metrics.costPerLivingSf)}/sf living · subtotal ${fmtMoney(est.subtotal)} + ${fmtMoney(est.contingency)} contingency`]),
    );
    metrics.replaceChildren(
      stat('footprint', `${fmtInt(est.metrics.footprintSf)} sf`),
      stat('living', `${fmtInt(est.metrics.livingSf)} sf`),
      stat('shop', `${fmtInt(est.metrics.shopSf)} sf`),
      stat('roof', `${fmtInt(est.metrics.roofSf)} sf`),
      stat('windows / doors', `${est.metrics.windows} / ${est.metrics.exteriorDoors}`),
      stat('bed / bath', `${est.metrics.bedrooms} / ${est.metrics.fullBaths}${est.metrics.halfBaths ? `+${est.metrics.halfBaths}½` : ''}`),
    );
    warnings.replaceChildren(...est.warnings.map((w) => el('div', { class: 'warning', text: `⚠ ${w}` })));
    groups.replaceChildren(
      ...CATEGORY_ORDER.map((cat) => {
        const items = est.items.filter((i) => i.category === cat);
        if (!items.length) return null;
        const sum = items.reduce((s, i) => s + i.amount, 0);
        const isCollapsed = collapsed.has(cat);
        const header = el('button', { type: 'button', class: `cost-group-header ${isCollapsed ? 'collapsed' : ''}` }, [
          el('span', { class: 'chevron', text: isCollapsed ? '▸' : '▾' }),
          el('span', { class: 'cost-group-title', text: cat }),
          el('span', { class: 'cost-group-sum', text: fmtMoney(sum) }),
        ]);
        header.addEventListener('click', () => {
          if (collapsed.has(cat)) collapsed.delete(cat);
          else collapsed.add(cat);
          render();
        });
        const body = el(
          'div',
          { class: 'cost-items', hidden: isCollapsed },
          items.map((i) =>
            el('div', { class: 'cost-item' }, [
              el('div', { class: 'cost-item-text' }, [el('div', { class: 'cost-item-label', text: i.label }), i.detail ? el('div', { class: 'cost-item-detail', text: i.detail }) : null]),
              el('div', { class: 'cost-item-amount', text: fmtMoney(i.amount) }),
            ]),
          ),
        );
        return el('div', { class: 'cost-group' }, [header, body]);
      }).filter((n): n is HTMLDivElement => n !== null),
    );
  };

  const update = (project: Project): Estimate => {
    last = estimate(project);
    render();
    return last;
  };
  return { el: root, update };
}
