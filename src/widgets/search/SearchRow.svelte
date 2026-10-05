<!--
  搜索面板里的一行：网站（图标 + 名称 + 域名）、用搜索引擎搜索输入内容、联想词。
  高亮与点击由父组件在列表上统一处理（事件委托），这里只负责展示。
-->
<script lang="ts">
  import SiteIcon from '../../components/SiteIcon.svelte';
  import type { SearchOption } from './options';

  interface Props {
    option: SearchOption;
    id: string;
    active: boolean;
  }

  let { option, id, active }: Props = $props();
</script>

<div class="row petal-row" {id} role="option" aria-selected={active} data-key={option.key} data-kind={option.kind}>
  {#if option.kind === 'site'}
    <SiteIcon name={option.site.name} icon={option.site.icon} iconDark={option.site.iconDark} size="xs" />
    <span class="label">{option.site.name}</span>
    <span class="meta">{option.site.host}</span>
  {:else}
    <span class="glyph" aria-hidden="true">
      <svg viewBox="0 0 20 20" width="12" height="12">
        <circle cx="8.75" cy="8.75" r="5.25" />
        <path d="m12.75 12.75 3.75 3.75" />
      </svg>
    </span>
    <span class="label">{option.kind === 'web' ? `“${option.text}”` : option.text}</span>
  {/if}
  <kbd class="enter" aria-hidden="true">↵</kbd>
</div>

<style>
  /* 高亮用 base.css 的 .petal-row，与分类面板里的链接同一套；这里只决定什么时候亮 */
  .row {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-block-size: 2.5rem;
    padding: 0.5rem 0.5rem 0.5rem 0.75rem;
    font-size: var(--text-sm);
    font-weight: 700;
    cursor: pointer;
  }

  /* 每一行是单独的组件实例，前一个兄弟要用 :global 才能匹配 */
  :global(.row) + .row {
    border-block-start: var(--rule-thin);
  }

  .row[aria-selected='true'] {
    --lit: 1;
  }

  /* 搜索和联想词：细线圆圈里一个放大镜，和没有图标的网站首字母一个样子 */
  .glyph {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 1.375rem;
    block-size: 1.375rem;
    color: var(--ink-3);
    border: var(--rule-thin);
    border-radius: 50%;
  }

  .glyph svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }

  .row[data-kind='web'] .glyph {
    color: var(--ink);
  }

  .label {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row[data-kind='suggest'] .label {
    font-weight: 400;
    color: var(--ink-2);
  }

  .row[data-kind='suggest'][aria-selected='true'] .label {
    color: var(--ink);
  }
  .meta {
    flex: none;
    max-inline-size: 45%;
    overflow: hidden;
    font: var(--text-xs) / 1.4 var(--num);
    color: var(--ink-3);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 回车提示与搜索框的快捷键提示同款：细线方框里的衬线字 */
  .enter {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 1.375rem;
    block-size: 1.375rem;
    font: var(--text-xs) / 1 var(--serif);
    color: var(--sakura-deep);
    border: var(--rule-thin);
    opacity: 0;
    transition: opacity var(--dur-fast) linear;
  }

  .row[aria-selected='true'] .enter {
    opacity: 1;
  }

  /* 触屏上回车键在软键盘里，不显示提示 */
  @media (pointer: coarse) {
    .enter {
      display: none;
    }
  }
</style>
