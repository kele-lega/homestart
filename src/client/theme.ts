import { THEME_STORAGE_KEY, parseTheme, stepTheme, type Theme } from '../lib/theme';

/**
 * 主题切换按钮组（ThemeSwitch.astro）：role="radiogroup"，方向键移动选择。
 * 切换时用 View Transitions 做一次整页交叉淡化；浏览器不支持或用户要求减少动效时直接切换。
 */

const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

function currentTheme(): Theme {
  return parseTheme(root.dataset.theme);
}

function save(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 隐私模式等情况下存储不可用：本次访问照常生效，只是下次不会记住
  }
}

function sync(theme: Theme): void {
  for (const option of document.querySelectorAll<HTMLButtonElement>('[data-theme-option]')) {
    const checked = option.dataset.themeOption === theme;
    option.setAttribute('aria-checked', String(checked));
    option.tabIndex = checked ? 0 : -1;
  }
}

function apply(theme: Theme): void {
  sync(theme);
  if (theme === currentTheme()) return;
  save(theme);
  const update = () => {
    root.dataset.theme = theme;
  };
  if ('startViewTransition' in document && !reducedMotion.matches) document.startViewTransition(update);
  else update();
}

function optionOf(target: EventTarget | null): HTMLButtonElement | null {
  return target instanceof Element ? target.closest<HTMLButtonElement>('[data-theme-option]') : null;
}

document.addEventListener('click', (event) => {
  const option = optionOf(event.target);
  if (option) apply(parseTheme(option.dataset.themeOption));
});

document.addEventListener('keydown', (event) => {
  const option = optionOf(event.target);
  const delta = STEPS[event.key];
  if (!option || !delta) return;
  event.preventDefault();
  const next = stepTheme(parseTheme(option.dataset.themeOption), delta);
  apply(next);
  option.parentElement?.querySelector<HTMLButtonElement>(`[data-theme-option="${next}"]`)?.focus();
});

sync(currentTheme());
