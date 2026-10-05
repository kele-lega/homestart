<!--
  导航：账号自己的分类导航——最多 6 个分类，每个分类下若干网站。存进来之后分类导航、搜索里的网站、常用网站都用它。
  图标默认自动：填好网址后服务端去抓网站的图标存在本站；也可以自己上传。整份一起保存，没保存之前首页不变
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import type { Section } from '../../core/settings-view';
  import { USER_LINKS_LIMITS, type UserLink, type UserLinks } from '../../core/user-links';
  import { fetchSiteIcon, resetLinks, saveLinks, uploadSiteIcon } from '../../lib/settings-api';
  import SiteIcon from '../SiteIcon.svelte';

  interface Props {
    section: Section<UserLinks>;
  }

  let { section }: Props = $props();

  const MAX_UPLOAD_BYTES = 256 * 1024;

  /** 表单里的一个网站：存的字段 + 页面上的状态 */
  interface DraftLink extends Omit<UserLink, 'name' | 'url'> {
    readonly key: number;
    name: string;
    url: string;
    /** 自己上传的图标：改网址时不自动换掉 */
    manual: boolean;
    iconBusy: boolean;
    iconError: string | undefined;
  }

  interface DraftCategory {
    readonly key: number;
    name: string;
    links: DraftLink[];
  }

  let nextKey = 0;
  const toDraft = (links: UserLinks): DraftCategory[] =>
    links.categories.map((category) => ({
      key: nextKey++,
      name: category.name,
      links: category.links.map((link) => ({
        ...link,
        key: nextKey++,
        // 存的数据里不记图标是抓的还是上传的：改了网址就重新抓，上传的要再传一次
        manual: false,
        iconBusy: false,
        iconError: undefined,
      })),
    }));

  // 服务端给的只是初始值，之后以接口返回为准
  let saved = $state(untrack(() => section.saved));
  let categories = $state<DraftCategory[]>(toDraft(untrack(() => section.saved ?? section.defaults)));
  let saving = $state(false);
  let notice = $state<{ readonly kind: 'ok' | 'error'; readonly text: string } | undefined>(undefined);
  let cardEl = $state<HTMLElement>();

  /** 补全网址：只写了域名时加上 https:// */
  function normalizeUrl(input: string): string {
    const url = input.trim();
    if (url === '' || /^[a-z][a-z\d+.-]*:/i.test(url)) return url;
    return `https://${url}`;
  }

  function hostName(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  /** 要保存的那份：去掉页面状态和整行空着的网站；没写名字的用域名 */
  function payload(): UserLinks {
    return {
      categories: categories.map((category) => ({
        name: category.name.trim(),
        links: category.links
          .filter((link) => link.name.trim() !== '' || link.url.trim() !== '')
          .map(({ key: _key, manual: _manual, iconBusy: _busy, iconError: _error, ...link }) => {
            const url = normalizeUrl(link.url);
            const result: UserLink = { ...$state.snapshot(link), url, name: link.name.trim() || hostName(url) };
            if (!result.icon) delete result.icon;
            return result;
          }),
      })),
    };
  }

  const baseline = $derived(JSON.stringify(saved ?? section.defaults));
  const dirty = $derived(JSON.stringify(payload()) !== baseline);

  // ---- 分类

  async function focusLast(selector: string): Promise<void> {
    await tick();
    const fields = cardEl?.querySelectorAll<HTMLInputElement>(selector);
    fields?.[fields.length - 1]?.focus();
  }

  function addCategory(): void {
    if (categories.length >= USER_LINKS_LIMITS.categories) return;
    categories.push({ key: nextKey++, name: '', links: [] });
    void focusLast('[data-field="category"]');
  }

  function removeCategory(index: number): void {
    const category = categories[index]!;
    if (category.links.length > 0 && !confirm(`删除分类「${category.name || '未命名'}」和里面的 ${category.links.length} 个网站？`)) return;
    categories.splice(index, 1);
  }

  function move<T>(list: T[], index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(target, 0, item!);
  }

  // ---- 网站

  function addLink(category: DraftCategory): void {
    if (category.links.length >= USER_LINKS_LIMITS.links) return;
    category.links.push({ key: nextKey++, name: '', url: '', manual: false, iconBusy: false, iconError: undefined });
    void focusLast(`[data-category="${category.key}"] [data-field="url"]`);
  }

  /** 自动抓图标；force 为 true 时连自己上传的也换掉（点了「重新抓取」） */
  async function autoIcon(link: DraftLink, force = false): Promise<void> {
    if (link.manual && !force) return;
    const url = normalizeUrl(link.url);
    if (!/^https?:\/\/[^/]/i.test(url)) return;
    link.url = url;
    if (!link.name.trim()) link.name = hostName(url);
    link.iconBusy = true;
    link.iconError = undefined;
    const result = await fetchSiteIcon(url);
    link.iconBusy = false;
    if (result.ok) {
      link.icon = result.data.icon;
      // 深色版本是 links.yaml 里配给原来那张图的，换了图就不再适用
      delete link.iconDark;
      link.manual = false;
    } else {
      link.iconError = result.message;
    }
  }

  /** 网址改了：原来的图标不再对应，重新抓 */
  function onUrlChange(link: DraftLink): void {
    if (link.manual) return;
    delete link.icon;
    delete link.iconDark;
    void autoIcon(link);
  }

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function upload(link: DraftLink, event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      link.iconError = `图片太大（最多 ${MAX_UPLOAD_BYTES / 1024} KB）`;
      return;
    }
    link.iconBusy = true;
    link.iconError = undefined;
    const result = await uploadSiteIcon(await readAsDataUrl(file));
    link.iconBusy = false;
    if (result.ok) {
      link.icon = result.data.icon;
      delete link.iconDark;
      link.manual = true;
    } else {
      link.iconError = result.message;
    }
  }

  // ---- 保存

  async function onSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    saving = true;
    notice = undefined;
    const result = await saveLinks(payload());
    saving = false;
    if (result.ok) {
      saved = result.data;
      categories = toDraft(result.data);
      notice = { kind: 'ok', text: '已保存，回主页就能看到' };
    } else {
      notice = { kind: 'error', text: result.message };
    }
  }

  async function onReset(): Promise<void> {
    if (!confirm('恢复成站点默认的导航？你添加和修改的分类、网站都会丢掉。')) return;
    saving = true;
    notice = undefined;
    const result = await resetLinks();
    saving = false;
    if (result.ok) {
      saved = undefined;
      categories = toDraft(section.defaults);
      notice = { kind: 'ok', text: '已恢复默认导航' };
    } else {
      notice = { kind: 'error', text: result.message };
    }
  }
</script>

<section class="leaf-card links-card" id="links" aria-labelledby="links-title" bind:this={cardEl}>
  <div class="leaf-card-head">
    <h2 class="leaf-card-title" id="links-title">导航</h2>
    {#if saved}
      <span class="leaf-badge">已自定义</span>
    {:else}
      <span class="leaf-badge" data-kind="muted">默认</span>
    {/if}
  </div>
  <p class="leaf-card-hint">
    首页搜索框下面的分类导航，最多 {USER_LINKS_LIMITS.categories} 个分类。搜索里的网站、常用网站也从这里取。
    填好网址会自动抓取图标，也可以自己上传。
  </p>

  <form class="leaf-form" onsubmit={onSubmit}>
    {#each categories as category, ci (category.key)}
      <fieldset class="category" data-category={category.key}>
        <legend class="visually-hidden">第 {ci + 1} 个分类</legend>
        <div class="category-head">
          <label class="leaf-field category-name">
            <span class="leaf-field-label">分类 {ci + 1}</span>
            <input
              class="leaf-input"
              data-field="category"
              required
              maxlength={USER_LINKS_LIMITS.categoryName}
              autocomplete="off"
              placeholder="例如：开发"
              bind:value={category.name}
            />
          </label>
          <span class="leaf-meta">{category.links.length} 个网站</span>
          <div class="row-tools">
            <button type="button" class="tool" aria-label="分类 {ci + 1} 上移" disabled={ci === 0} onclick={() => move(categories, ci, -1)}>↑</button>
            <button
              type="button"
              class="tool"
              aria-label="分类 {ci + 1} 下移"
              disabled={ci === categories.length - 1}
              onclick={() => move(categories, ci, 1)}>↓</button
            >
            <button type="button" class="leaf-link" data-kind="danger" onclick={() => removeCategory(ci)}>删除分类</button>
          </div>
        </div>

        {#if category.links.length > 0}
          <ol class="sites" role="list">
            {#each category.links as link, li (link.key)}
              {@const label = link.name.trim() || hostName(normalizeUrl(link.url)) || `第 ${li + 1} 个网站`}
              <li class="site">
                <span class="site-icon" aria-busy={link.iconBusy}>
                  <SiteIcon name={link.name || hostName(normalizeUrl(link.url)) || '?'} icon={link.icon} iconDark={link.iconDark} size="xs" />
                </span>
                <label class="site-field">
                  <span class="visually-hidden">{label}的名称</span>
                  <input
                    class="leaf-input"
                    maxlength={USER_LINKS_LIMITS.linkName}
                    autocomplete="off"
                    placeholder="名称（不填用域名）"
                    bind:value={link.name}
                  />
                </label>
                <label class="site-field site-url">
                  <span class="visually-hidden">{label}的网址</span>
                  <input
                    class="leaf-input"
                    data-field="url"
                    type="text"
                    inputmode="url"
                    maxlength="2048"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="https://…"
                    bind:value={link.url}
                    onchange={() => onUrlChange(link)}
                  />
                </label>
                <div class="row-tools">
                  <button
                    type="button"
                    class="leaf-link"
                    disabled={link.iconBusy || link.url.trim() === ''}
                    onclick={() => autoIcon(link, true)}
                  >
                    {link.iconBusy ? '抓取中…' : '抓取图标'}
                  </button>
                  <label class="leaf-link upload">
                    上传图标
                    <input
                      class="visually-hidden"
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,image/x-icon,image/svg+xml,.ico"
                      disabled={link.iconBusy}
                      aria-label="给{label}上传图标"
                      onchange={(event) => upload(link, event)}
                    />
                  </label>
                  <button type="button" class="tool" aria-label="{label}上移" disabled={li === 0} onclick={() => move(category.links, li, -1)}>↑</button>
                  <button
                    type="button"
                    class="tool"
                    aria-label="{label}下移"
                    disabled={li === category.links.length - 1}
                    onclick={() => move(category.links, li, 1)}>↓</button
                  >
                  <button type="button" class="tool" aria-label="删除{label}" onclick={() => category.links.splice(li, 1)}>×</button>
                </div>
                {#if link.iconError}<p class="site-error" role="status">{link.iconError}</p>{/if}
              </li>
            {/each}
          </ol>
        {/if}

        {#if category.links.length < USER_LINKS_LIMITS.links}
          <button type="button" class="leaf-link add" onclick={() => addLink(category)}>＋ 添加网站</button>
        {:else}
          <p class="leaf-meta">这个分类已经有 {USER_LINKS_LIMITS.links} 个网站了</p>
        {/if}
      </fieldset>
    {/each}

    {#if categories.length < USER_LINKS_LIMITS.categories}
      <button type="button" class="leaf-btn add-category" onclick={addCategory}>＋ 添加分类</button>
    {:else}
      <p class="leaf-meta">最多 {USER_LINKS_LIMITS.categories} 个分类</p>
    {/if}

    <div class="leaf-actions">
      <button type="submit" class="leaf-btn" data-kind="primary" disabled={saving}>保存导航</button>
      {#if saved}
        <button type="button" class="leaf-link" disabled={saving} onclick={onReset}>恢复默认</button>
      {/if}
      {#if dirty}<span class="leaf-meta">有改动还没保存</span>{/if}
    </div>
  </form>

  {#if notice}<p class="leaf-notice" data-kind={notice.kind} role="status">{notice.text}</p>{/if}
</section>

<style>
  .links-card {
    margin-block-start: var(--space-6);
  }

  /* 每个分类一块，上面一道细线隔开 */
  .category {
    display: grid;
    gap: var(--space-3);
    min-inline-size: 0;
    margin: 0;
    padding: var(--space-4) 0 0;
    border: 0;
    border-block-start: var(--rule-thin);
  }

  .category-head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2) var(--space-4);
  }

  .category-name {
    flex: 0 1 14rem;
  }

  .row-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    margin-inline-start: auto;
  }

  /* 上移、下移、删除：小方块按钮 */
  .tool {
    min-inline-size: 1.75rem;
    min-block-size: 1.75rem;
    padding: 0;
    font: var(--text-base) / 1 var(--num);
    color: var(--ink-2);
    background: none;
    border: 1px solid var(--rule);
  }

  .tool:disabled {
    opacity: 0.35;
    cursor: default;
  }

  @media (hover: hover) {
    .tool:not(:disabled):hover {
      color: var(--ink);
      background: var(--sakura-wash);
    }
  }

  /* 一个网站一行：图标、名称、网址、操作；窄屏时网址折到下一行 */
  .sites {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    list-style: none;
  }

  .site {
    display: grid;
    grid-template-columns: auto minmax(6rem, 0.6fr) minmax(10rem, 1fr) auto;
    align-items: center;
    gap: var(--space-1) var(--space-3);
  }

  .site-icon[aria-busy='true'] {
    opacity: 0.4;
  }

  .site .leaf-input {
    font-size: var(--text-base);
  }

  .site .row-tools {
    margin-inline-start: 0;
  }

  .upload {
    cursor: pointer;
  }

  /* 文件框藏起来了，焦点落在它身上时给外面的文字画框 */
  .upload:focus-within {
    outline: 2px solid var(--blue);
    outline-offset: 2px;
  }

  .site-error {
    grid-column: 2 / -1;
    font: var(--text-xs) / 1.5 var(--label);
    color: var(--red);
  }

  .add {
    justify-self: start;
  }

  .add-category {
    justify-self: start;
  }

  @media (width <= 48rem) {
    .site {
      grid-template-columns: auto minmax(0, 1fr);
    }

    .site-url,
    .site .row-tools,
    .site-error {
      grid-column: 2;
    }
  }
</style>

