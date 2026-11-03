// 测试告警通道：会写入页面告警与 data/alerts.log；配置了 WECOM_ALERT_WEBHOOK 时会同时发企微。
// 用法：node scripts/test-alert-channel.ts
import { AlertCenter, LogAlertChannel, WeComAlertChannel } from '../src/alert-center.ts';

const center = new AlertCenter({
  channels: [new LogAlertChannel(), new WeComAlertChannel()],
});

const event = center.raise({
  key: 'test-alert-channel',
  severity: 'info',
  component: '告警通道',
  title: '告警通道测试',
  message: '这是一条测试告警，收到即表示通道可用。',
  action: '无需处理',
});
center.recover('test-alert-channel', '测试完成，已自动恢复。');
await center.flush();

console.log(JSON.stringify({
  alertId: event.id,
  wecomEnabled: center.channelEnabled('wecom'),
  logChannel: true,
  message: center.channelEnabled('wecom') ? '已发送到页面、日志与企业微信' : '已发送到页面与日志；企微未配置',
}, null, 2));
