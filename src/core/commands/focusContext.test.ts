import { focusNavigationClaimed, isTextEntry } from './focusContext';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('focusContext', () => {
  it('recognises text entry', () => {
    const host = mount('<input id="i"><textarea id="t"></textarea><select id="s"></select><div id="d">x</div>');
    expect(isTextEntry(host.querySelector('#i'))).toBe(true);
    expect(isTextEntry(host.querySelector('#t'))).toBe(true);
    expect(isTextEntry(host.querySelector('#s'))).toBe(true);
    expect(isTextEntry(host.querySelector('#d'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });

  it('yields Tab inside a dialog, menu or field, and nowhere else', () => {
    const host = mount([
      '<div role="dialog"><button id="in-dialog"></button></div>',
      '<div role="menu"><button id="in-menu"></button></div>',
      '<div data-workspace-viewport="" tabindex="0" id="viewport"></div>',
      '<input id="field">',
    ].join(''));
    expect(focusNavigationClaimed(host.querySelector('#in-dialog'))).toBe(true);
    expect(focusNavigationClaimed(host.querySelector('#in-menu'))).toBe(true);
    expect(focusNavigationClaimed(host.querySelector('#field'))).toBe(true);
    expect(focusNavigationClaimed(host.querySelector('#viewport'))).toBe(false);
    expect(focusNavigationClaimed(document.body)).toBe(false);
    expect(focusNavigationClaimed(null)).toBe(false);
  });
});
