<!--
  Cloudflare Turnstile 人机验证小部件：显式渲染，拿到的一次性令牌通过 token 交给表单。
  令牌只能验一次，表单每提交一次（不管成没成）都要调 reset() 换新的
-->
<script lang="ts" module>
  interface TurnstileApi {
    render(container: HTMLElement, options: Record<string, unknown>): string;
    reset(widgetId: string): void;
    remove(widgetId: string): void;
  }

  const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  let loading: Promise<TurnstileApi> | undefined;

  const loaded = () => (window as Window & { turnstile?: TurnstileApi }).turnstile;

  /** 整页只加载一次脚本；失败了下次再试 */
  function loadTurnstile(): Promise<TurnstileApi> {
    const ready = loaded();
    if (ready) return Promise.resolve(ready);
    loading ??= new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_URL;
      script.async = true;
      script.onload = () => {
        const api = loaded();
        if (api) resolve(api);
        else reject(new Error('turnstile missing'));
      };
      script.onerror = () => reject(new Error('turnstile load failed'));
      document.head.append(script);
    }).catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    siteKey: string;
    token?: string;
  }

  let { siteKey, token = $bindable('') }: Props = $props();

  let container = $state<HTMLDivElement>();
  let failed = $state(false);
  let api: TurnstileApi | undefined;
  let widgetId: string | undefined;

  export function reset(): void {
    token = '';
    if (api && widgetId) api.reset(widgetId);
  }

  onMount(() => {
    let disposed = false;
    loadTurnstile()
      .then((ready) => {
        if (disposed || !container) return;
        api = ready;
        widgetId = ready.render(container, {
          sitekey: siteKey,
          language: 'zh-cn',
          callback: (value: string) => (token = value),
          'expired-callback': () => (token = ''),
          'error-callback': () => (token = ''),
        });
      })
      .catch(() => (failed = true));
    return () => {
      disposed = true;
      if (api && widgetId) api.remove(widgetId);
    };
  });
</script>

<div class="turnstile" bind:this={container}></div>
{#if failed}
  <p class="leaf-notice" data-kind="error">人机验证没加载出来，请刷新页面重试</p>
{/if}

<style>
  .turnstile {
    min-block-size: 65px;
  }
</style>
