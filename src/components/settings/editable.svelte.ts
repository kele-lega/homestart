import type { Section } from '../../core/settings-view';

/** 一栏偏好在页面上的状态：存过的值、表单里正在改的值。保存或恢复默认后两者一起更新 */
export class Editable<P extends object> {
  saved = $state<P | undefined>();
  value = $state() as P;
  readonly defaults: P;

  constructor(section: Section<P>) {
    this.defaults = section.defaults;
    this.saved = section.saved;
    this.value = { ...(section.saved ?? section.defaults) };
  }

  /** PreferenceCard 的 onsaved：服务端整理过的值，恢复默认时是 null */
  readonly onsaved = (next: unknown): void => {
    this.saved = (next ?? undefined) as P | undefined;
    this.value = { ...(this.saved ?? this.defaults) };
  };
}
