/**
 * 点空白处回首页：留白的子页（router.ts）和设置、个人中心（leaf-blank.ts）共用。
 * 只认鼠标单击在「纯排版的空地」上：页面本身、分栏的格子之类自己不带字的容器。
 * 点到字、链接、按钮、输入框都不算；正在选字、有挂轴或小纸开着（这一下是在收起它）、刚从输入框点出来（只是想让它失焦）也不算。
 * 手机上不做：手指点空白多半是想滚动或者点偏了
 */
const LAYOUT_TAGS = /^(SECTION|DIV|MAIN|HEADER|FOOTER|NAV|ASIDE|UL|OL|DL)$/;
const INTERACTIVE =
  'a, button, input, textarea, select, label, summary, details, dialog, [role="button"], [role="tab"], [tabindex], [contenteditable]';

function hasOwnText(el: Element): boolean {
  for (const child of el.childNodes) if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) return true;
  return false;
}

function typingIn(target: Element | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

interface BlankClick {
  /** 哪块地方的空白算数（选择器） */
  readonly within: string;
  /** 这会儿算不算（比如子页才算、首页不算）；不给就一直算 */
  readonly when?: () => boolean;
  readonly then: () => void;
}

export function onBlankClick({ within, when = () => true, then }: BlankClick): void {
  const isBlank = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    target.closest(within) !== null &&
    LAYOUT_TAGS.test(target.tagName) &&
    !hasOwnText(target) &&
    !target.closest(INTERACTIVE);

  let pressedOnBlank = false;

  document.addEventListener(
    'pointerdown',
    (event) => {
      pressedOnBlank =
        event.pointerType === 'mouse' &&
        event.button === 0 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.altKey &&
        !typingIn(document.activeElement) &&
        !document.querySelector('dialog[open], :popover-open') &&
        when() &&
        isBlank(event.target);
    },
    true,
  );

  document.addEventListener('click', (event) => {
    const pressed = pressedOnBlank;
    pressedOnBlank = false;
    if (!pressed || event.defaultPrevented || event.detail !== 1 || !isBlank(event.target)) return;
    if (!(getSelection()?.isCollapsed ?? true)) return;
    then();
  });
}
