<!--
  日历订阅：ICS 地址只提交、不回显，保存后只显示主机名。日历、今天、Deadline 三个版块读的都是这一份。
  下面是「写回 Google 日历」：在月历里新建的日程推到自己的 Google 日历（SyncSection）
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { SyncSettings } from '../../adapters/calendar/google-sync';
  import type { CalendarSettings } from '../../adapters/calendar/model';
  import { clearCalendar, saveCalendar } from '../../lib/settings-api';
  import BindingForm from './BindingForm.svelte';
  import SyncSection from './SyncSection.svelte';

  interface Props {
    settings: CalendarSettings;
    /** 页面上有月历时才有 */
    sync?: SyncSettings;
  }

  let { settings: initial, sync }: Props = $props();
  let settings = $state(untrack(() => initial));

  function ondone(data: unknown): string {
    settings = data as CalendarSettings;
    return settings.configured ? '已保存，回主页就能看到日程' : '已删除订阅';
  }
</script>

<section class="leaf-card" id="calendar" aria-labelledby="calendar-title">
  <div class="leaf-card-head">
    <h2 class="leaf-card-title" id="calendar-title">日历订阅</h2>
  </div>
  <p class="leaf-card-hint">日历、今天、Deadline 三个版块读的都是这一份订阅。</p>
  <BindingForm
    id="calendar-url"
    status={settings.configured ? `订阅：${settings.host}` : '还没有订阅日历'}
    bound={settings.configured}
    label="ICS 订阅地址"
    inputType="url"
    placeholder="https://…/basic.ics"
    hint="Google 日历：设置 → 选中日历 → 集成日历 → iCal 格式的私密地址。地址只存在服务器上，保存后这里只显示主机名。"
    addLabel="添加订阅"
    removeLabel="删除订阅"
    save={saveCalendar}
    remove={clearCalendar}
    {ondone}
  />
  {#if sync}<SyncSection settings={sync} />{/if}
</section>
