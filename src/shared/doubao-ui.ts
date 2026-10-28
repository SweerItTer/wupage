import { DOUBAO_TARGET_LANGUAGES, isDoubaoBrowserSupported } from "./doubao";
import type { DoubaoStatus, ExtensionSettings, ProviderConfig } from "./types";

export function isDoubaoProviderUnavailable(provider: ProviderConfig): boolean {
  return provider.type === "doubao-web" && !isDoubaoBrowserSupported();
}

export function syncDoubaoTargetControls(
  settings: ExtensionSettings,
  target: HTMLSelectElement
): void {
  const doubao = settings.providers.find((provider) => provider.id === settings.activeProviderId)?.type === "doubao-web";
  for (const option of target.options) {
    const disabled = doubao && !Object.hasOwn(DOUBAO_TARGET_LANGUAGES, option.value);
    if (option.disabled !== disabled) option.disabled = disabled;
  }
  const title = doubao && !Object.hasOwn(DOUBAO_TARGET_LANGUAGES, target.value)
    ? "豆包暂不支持此目标语言，请选择列表中的其他语言。"
    : "";
  if (target.title !== title) target.title = title;
}

export function doubaoProviderNotice(settings: ExtensionSettings): string | undefined {
  const provider = settings.providers.find((entry) => entry.id === settings.activeProviderId);
  if (provider?.type !== "doubao-web") return undefined;
  if (isDoubaoProviderUnavailable(provider)) return "豆包（实验性）目前仅支持 Chromium 浏览器，Firefox 尚未支持。请手动选择其他服务。";
  if (!Object.hasOwn(DOUBAO_TARGET_LANGUAGES, settings.targetLang)) return "豆包暂不支持当前目标语言，请选择中文、英语、日语、韩语、法语、德语、西班牙语或俄语。";
  return "豆包（实验性）：在同一浏览器登录豆包后可直接翻译；连接异常时可到设置中重新检测。待译文本会发送到豆包。";
}

const STATUS_LABELS: Record<DoubaoStatus["state"], string> = {
  unknown: "尚未验证。在同一浏览器登录豆包后可直接翻译，也可点击重新检测检查连接。",
  checking: "正在检测豆包连接…",
  ready: "最近一次翻译或检测成功，可以翻译。",
  "login-required": "需要登录豆包。登录后可直接重试翻译，也可重新检测连接。",
  "rate-limited": "豆包请求受限，请等待后再试。",
  "service-rejected": "豆包暂时拒绝请求。请检查豆包网页状态，再重试翻译或重新检测。",
  "permission-required": "缺少豆包网站访问权限。请检查浏览器的扩展权限。",
  "network-error": "无法连接豆包，请检查网络后重试翻译，或重新检测连接。",
  timeout: "豆包请求超时，请稍后重试翻译，或重新检测连接。",
  "protocol-changed": "豆包响应格式发生变化，当前版本暂时无法翻译。",
  incomplete: "豆包未返回完整译文，请重试未完成内容。",
  "unsupported-browser": "此浏览器暂不支持豆包翻译。请使用 Chrome / Edge。",
  "unsupported-language": "豆包暂不支持此目标语言，请选择支持的语言。"
};

export function formatDoubaoStatus(status: DoubaoStatus, now = Date.now()): string {
  const label = STATUS_LABELS[status.state] ?? STATUS_LABELS.unknown;
  const remaining = status.retryAt ? Math.max(0, Math.ceil((status.retryAt - now) / 1000)) : 0;
  const wait = remaining > 0 ? ` 约 ${remaining} 秒后可重试。` : "";
  const checked = status.checkedAt && Number.isFinite(status.checkedAt)
    ? ` 最近验证：${new Date(status.checkedAt).toLocaleString()}。`
    : "";
  return `${label}${wait}${checked}`;
}
