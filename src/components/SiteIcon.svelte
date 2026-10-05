<!--
  网站图标：有 icon 显示图片（可选 iconDark 深色版本，由 CSS 按主题切换），否则显示首字母。
  图片加载失败时退回首字母。失败监听用 attachment 挂在浏览器端，
  服务端渲染不会输出内联 onerror 属性（避免与 CSP 冲突），静态使用时失败只会留下空白底块。
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments';

  interface Props {
    name: string;
    icon?: string | undefined;
    iconDark?: string | undefined;
    /** xs 22px（面板、图标摞里），md 40px（常用网站的格子） */
    size?: 'xs' | 'md';
  }

  let { name, icon, iconDark, size = 'md' }: Props = $props();

  let failed = $state<readonly string[]>([]);

  const usable = (src: string | undefined) => (src && !failed.includes(src) ? src : undefined);
  // 浅色图失败时用深色图顶上，反之亦然；两张都不可用才显示首字母
  const light = $derived(usable(icon) ?? usable(iconDark));
  const dark = $derived(usable(iconDark) ?? light);
  const letter = $derived(Array.from(name.trim())[0]?.toUpperCase() ?? '·');

  function fallbackOnError(src: string): Attachment<HTMLImageElement> {
    return (img) => {
      const fail = () => {
        failed = [...failed, src];
      };
      img.addEventListener('error', fail, { once: true });
      // 注水前就已失败的图片不会再触发 error，重新设一次 src 让它再报一次。
      // 个别浏览器里没有固有尺寸的 SVG 加载成功后 naturalWidth 也是 0，重设只会多从缓存解码一次
      if (img.complete && img.naturalWidth === 0) img.src = src;
      return () => img.removeEventListener('error', fail);
    };
  }
</script>

<span class="site-icon" data-size={size} aria-hidden="true">
  {#if light}
    <img
      src={light}
      alt=""
      data-variant={dark !== light ? 'light' : undefined}
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      {@attach fallbackOnError(light)}
    />
  {/if}
  {#if dark && dark !== light}
    <img
      src={dark}
      alt=""
      data-variant="dark"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      {@attach fallbackOnError(dark)}
    />
  {/if}
  {#if !light}
    <span class="letter">{letter}</span>
  {/if}
</span>

<style>
  /* 图标本身不加底块，只占一个方格；没有图标时是细线圆圈里的首字母 */
  .site-icon {
    display: inline-grid;
    flex: none;
    place-items: center;
    inline-size: 2.5rem;
    block-size: 2.5rem;
  }

  .site-icon[data-size='xs'] {
    inline-size: 1.375rem;
    block-size: 1.375rem;
  }

  img {
    inline-size: 60%;
    block-size: 60%;
    object-fit: contain;
  }

  img[data-variant='dark'] {
    display: none;
  }

  :global(:root[data-theme='dark']) img[data-variant='light'] {
    display: none;
  }

  :global(:root[data-theme='dark']) img[data-variant='dark'] {
    display: block;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) img[data-variant='light'] {
      display: none;
    }

    :global(:root:not([data-theme='light'])) img[data-variant='dark'] {
      display: block;
    }
  }

  .letter {
    display: grid;
    place-items: center;
    inline-size: 100%;
    block-size: 100%;
    font: 700 0.6875rem / 1 var(--num);
    color: var(--ink-2);
    border: var(--rule-thin);
    border-radius: 50%;
  }
</style>
