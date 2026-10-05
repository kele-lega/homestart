<!--
  Steam：绑定哪个账号（SteamID64 或个人资料链接，存在服务端）+ 卡片上最多列几款游戏
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { SteamBinding } from '../../adapters/steam/model';
  import type { Section } from '../../core/settings-view';
  import { bindSteam, unbindSteam } from '../../lib/settings-api';
  import type { SteamPreference } from '../../widgets/steam/widget';
  import BindingForm from './BindingForm.svelte';
  import { Editable } from './editable.svelte';
  import PreferenceCard from './PreferenceCard.svelte';

  interface Props {
    section: Section<SteamPreference>;
    binding: SteamBinding;
    /** 服务端的上限（STEAM_MAX_COUNT） */
    maxCount: number;
  }

  let { section, binding: initial, maxCount }: Props = $props();
  let steamId = $state(untrack(() => initial.steamId));
  const pref = new Editable(untrack(() => section));

  function ondone(data: unknown): string {
    steamId = (data as SteamBinding).steamId;
    return steamId ? '已绑定，回主页就能看到游戏记录' : '已解除绑定';
  }
</script>

<PreferenceCard type="steam" title="Steam" value={pref.value} customized={!!pref.saved} onsaved={pref.onsaved}>
  {#snippet before()}
    <BindingForm
      id="steam-account"
      status={steamId ? `账号：${steamId}` : '还没有绑定 Steam 账号'}
      bound={!!steamId}
      label="SteamID64 或个人资料链接"
      placeholder="76561197960265729"
      hint="Steam 客户端 → 账户明细 里的 17 位数字，或粘贴个人资料链接。「游戏详情」要设为公开，否则读不到游玩记录。"
      addLabel="绑定账号"
      removeLabel="解除绑定"
      save={bindSteam}
      remove={unbindSteam}
      {ondone}
    />
  {/snippet}
  <label class="leaf-field">
    <span class="leaf-field-label">最多列几款游戏（1–{maxCount}）</span>
    <input class="leaf-input" type="number" name="count" required min="1" max={maxCount} step="1" bind:value={pref.value.count} />
  </label>
</PreferenceCard>
