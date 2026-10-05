/**
 * 通用折叠：点击 button[data-disclosure] 时切换 aria-expanded，
 * 并在 aria-controls 指向的元素上切换 data-open，动画交给 CSS。
 * 使用事件委托，后续 Widget 里的折叠按钮也能直接复用。
 */

function toggle(button: HTMLButtonElement): void {
  const target = document.getElementById(button.getAttribute('aria-controls') ?? '');
  if (!target) return;
  const open = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(open));
  target.toggleAttribute('data-open', open);
}

document.addEventListener('click', (event) => {
  const origin = event.target instanceof Element ? event.target : null;
  const button = origin?.closest<HTMLButtonElement>('button[data-disclosure]');
  if (button) toggle(button);
});
