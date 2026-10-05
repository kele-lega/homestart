<script lang="ts">
  import { untrack } from 'svelte';

  /**
   * 一张翻页牌：上下两半各是一张卡。数字变了时，上半张带着旧数字往下翻倒，翻到竖直的那一刻，
   * 下半张带着新数字接着从竖直翻下来，慢慢停稳，盖住旧的。两半交接时角度、速度都接得上，看起来是一张牌一口气翻过去。
   * 翻的时候背光的一面渐渐变暗，翻下来以后再亮起来。
   * 静止时上半显示新数字、下半显示旧数字，正好被翻下来的那半张盖住，翻完就是完整的新数字。
   * 每次翻多久由 FlipCounter 定，翻到一半不会变；中途又变了，换个 key 从当前显示的数字接着翻
   */
  interface Props {
    char: string;
    /** 补位的 0：颜色淡一些 */
    dim?: boolean;
    /** 这一次翻页总共多少毫秒 */
    duration?: number;
  }

  let { char, dim = false, duration = 600 }: Props = $props();

  // 服务端渲染和第一次挂载时 previous 就是 char：没有翻页的两半张
  let previous = $state(untrack(() => char));
  let turn = $state(0);
  /** 正在翻的这一次的时长；只在开始翻的时候取，翻到一半 duration 变了也不影响 */
  let flipMs = $state(untrack(() => duration));
  let seen = untrack(() => char);

  $effect.pre(() => {
    const next = char;
    if (next === seen) return;
    untrack(() => {
      previous = seen;
      flipMs = duration;
      turn += 1;
    });
    seen = next;
  });

  // 只认下半张自己的动画结束；它的阴影（::before）同一时刻也会冒出 animationend
  function onLanded(event: AnimationEvent): void {
    if (event.target === event.currentTarget && !event.pseudoElement) previous = char;
  }
</script>

<span class="digit" data-dim={dim ? '' : undefined} aria-hidden="true">
  <span class="half top"><span class="glyph">{char}</span></span>
  <span class="half bottom"><span class="glyph">{previous}</span></span>
  {#if previous !== char}
    {#key turn}
      <span class="half top flap fold" style:--flip-ms={`${flipMs}ms`}><span class="glyph">{previous}</span></span>
      <span class="half bottom flap unfold" style:--flip-ms={`${flipMs}ms`} onanimationend={onLanded}>
        <span class="glyph">{char}</span>
      </span>
    {/key}
  {/if}
</span>

<style>
  /*
   * 牌面是墨色的小卡片、纸色的字，中线一道缝；字号跟着 --flip-size（FlipCounter 设）。
   * 每一半只露出字形的一半：上半露上面、下半露下面，两半拼起来是完整的字
   */
  .digit {
    --h: var(--flip-size, 2.25rem);
    --w: calc(var(--h) * 0.68);

    position: relative;
    display: inline-block;
    inline-size: var(--w);
    block-size: var(--h);
    perspective: calc(var(--h) * 5);
    font: 700 calc(var(--h) * 0.78) / 1 var(--num);
    font-variant-numeric: tabular-nums;
    color: var(--paper);
  }

  .digit[data-dim] {
    color: color-mix(in srgb, var(--paper) 42%, var(--ink));
  }

  .half {
    position: absolute;
    inset-inline: 0;
    block-size: 50%;
    overflow: hidden;
    background: var(--ink);
    backface-visibility: hidden;
  }

  .top {
    inset-block-start: 0;
    border-radius: 3px 3px 0 0;
    transform-origin: 50% 100%;
  }

  .bottom {
    inset-block-end: 0;
    border-radius: 0 0 3px 3px;
    transform-origin: 50% 0;
  }

  /* 中线：上半张底边一道细缝 */
  .top::after {
    content: '';
    position: absolute;
    inset: auto 0 0;
    block-size: 1px;
    background: color-mix(in srgb, var(--ink) 55%, black);
  }

  /* 字形按整张牌的高度居中，下半张往上挪半张，只露出下半截 */
  .glyph {
    display: grid;
    place-items: center;
    block-size: var(--h);
  }

  .bottom .glyph {
    translate: 0 -50%;
  }

  /* 翻动的两半张单独合成一层，只动 transform 和阴影的 opacity，不触发重排 */
  .flap {
    z-index: 1;
    will-change: transform;
  }

  /* 背光的阴影：盖在半张牌上的一层暗色，只改透明度 */
  .flap::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 1;
    background: rgb(0 0 0 / 0.55);
    opacity: 0;
    pointer-events: none;
  }

  /*
   * 上半张：从静止开始往下倒，越倒越快，翻到竖直（-90°）时正好用掉 45% 的时间。
   * 交接处的角速度两边对上：上半张收尾斜率 0.4/0.15 ≈ 2.67，90° 用 0.45T，约 533°/T；
   * 下半张 90° 用 0.55T，起手斜率 0.49/0.15 ≈ 3.27，也是约 533°/T，之后一路减速、斜率为 0 停住，不弹
   */
  .fold {
    animation: fold calc(var(--flip-ms) * 0.45) cubic-bezier(0.55, 0, 0.85, 0.6) forwards;
  }

  .fold::before {
    animation: shade-in calc(var(--flip-ms) * 0.45) cubic-bezier(0.55, 0, 0.85, 0.6) forwards;
  }

  /* 下半张：开始前竖着（90°）看不见，上半张一到竖直就接着翻下来，带着同样的速度，慢慢停稳 */
  .unfold {
    transform: rotateX(90deg);
    animation: unfold calc(var(--flip-ms) * 0.55) cubic-bezier(0.15, 0.49, 0.35, 1) calc(var(--flip-ms) * 0.45) forwards;
  }

  .unfold::before {
    opacity: 1;
    animation: shade-out calc(var(--flip-ms) * 0.4) cubic-bezier(0.2, 0.6, 0.4, 1) calc(var(--flip-ms) * 0.45) forwards;
  }

  @keyframes fold {
    to {
      transform: rotateX(-90deg);
    }
  }

  @keyframes unfold {
    to {
      transform: rotateX(0deg);
    }
  }

  @keyframes shade-in {
    to {
      opacity: 1;
    }
  }

  @keyframes shade-out {
    to {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .fold,
    .unfold,
    .flap::before {
      animation-duration: 1ms;
      animation-delay: 0s;
    }
  }
</style>
