/**
 * 翻页：首页是活页夹最上面那一张，登录页、个人中心在它底下。
 * BaseLayout 的 <html data-leaf="cover|inner"> 标出这一页是哪一张；这里是两页之间跳转时共用的约定。
 * 这个模块会进浏览器（登录表单用），不能引用服务端代码
 */

/** 登录成功、跳回首页之前写进 sessionStorage：首页据此让书签「落」下来，而不只是翻回来 */
export const SIGNED_IN_FLAG = 'home:signed-in';

export type Leaf = 'cover' | 'inner';
