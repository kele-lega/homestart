<!--
  账号头像：上传过就显示那张图，没有就是按种子画的色块图（lib/identicon）。
  只管画，不管大小：外面给多大就填满多大（圆形由外面的容器裁）。纯展示，在 Astro 里用不需要 client: 指令
-->
<script lang="ts">
  import type { AvatarView } from '../lib/account-view';
  import { IDENTICON_GRID, identicon } from '../lib/identicon';

  interface Props {
    avatar: AvatarView;
  }

  let { avatar }: Props = $props();

  const pattern = $derived(identicon(avatar.seed));
  // 四周留半格空白，和 GitHub 的默认头像一样
  const SIZE = IDENTICON_GRID + 1;
</script>

{#if avatar.image}
  <img class="avatar-art" src={avatar.image} alt="" decoding="async" draggable="false" />
{:else}
  <!-- fill / stroke 写在每个格子上：外面给 svg 设的图标样式（fill: none、stroke: currentcolor）只是继承下来，盖不过属性 -->
  <svg class="avatar-art" viewBox="0 0 {SIZE} {SIZE}" aria-hidden="true" shape-rendering="crispEdges">
    <rect width={SIZE} height={SIZE} fill="#f0f0f0" stroke="none" />
    {#each pattern.cells as [column, row] (`${column}-${row}`)}
      <rect
        x={column + 0.5}
        y={row + 0.5}
        width="1"
        height="1"
        fill={pattern.color}
        stroke="none"
      />
    {/each}
  </svg>
{/if}

<style>
  .avatar-art {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }
</style>
