import { onBlankClick } from './blank-click';

// 设置、个人中心：和留白的子页一样，鼠标点纸上的空白处回首页（登录、注册这些带 data-blank-home 的才算）
onBlankClick({ within: '.leaf[data-blank-home]', then: () => location.assign('/') });
