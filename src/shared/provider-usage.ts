import { supportsServiceMode, translationApiOptions } from "./translation-service";
import type { ProviderConfig } from "./types";

export interface UsageSource { label: string; url: string }
export interface ProviderUsage {
  service: string;
  quota: string;
  request: string;
  rate: string;
  concurrency: string;
  note?: string;
  sources: UsageSource[];
}

// Snapshot of the linked official material; these are published rules, not account balances.
export const PROVIDER_USAGE_CHECKED_AT = "2026-10-27";
const source = (label: string, url: string): UsageSource => ({ label, url });
const unknown = "官方未公布。";
const freeServices = {
  "microsoft-web-translate": { service: "Microsoft 浏览器翻译 · 匿名", source: source("Microsoft Edge 帮助", "https://support.microsoft.com/en-au/edge/use-microsoft-translator-in-microsoft-edge-browser") },
  "google-web-translate": { service: "Google Web Translate · 匿名", source: source("Google 翻译", "https://translate.google.com/about/") },
  "tencent-transmart": { service: "腾讯 TranSmart · 匿名", source: source("TranSmart", "https://transmart.qq.com/") },
  "yandex-web-translate": { service: "Yandex 网页翻译 · 匿名", source: source("Yandex 翻译", "https://translate.yandex.com/") },
  "volcengine-web-translate": { service: "火山浏览器翻译 · 匿名", source: source("火山翻译", "https://translate.volcengine.com/") }
};

function azureUsage(): ProviderUsage {
  return { service: "Microsoft Translator API（Azure）", quota: "F0 免费层：每月 200 万字符；需 Azure 账号和密钥。其他套餐按订阅计费。",
    request: "最多 50,000 字符、1,000 个文本项；字符数按所有目标语言合计。",
    rate: "F0：200 万字符/小时，需均匀发送。其他套餐以账号配额为准。", concurrency: "无固定并发上限，受字符速率和订阅额度限制。",
    sources: [source("Microsoft 免费层说明", "https://www.microsoft.com/en-us/translator/business/faq/"),
      source("Azure 请求、速率与并发限制", "https://learn.microsoft.com/en-us/azure/ai-services/translator/service-limits")] };
}

function googleUsage(): ProviderUsage {
  return { service: "Google Cloud Translation · Basic v2", quota: "NMT 每月前 50 万字符以 10 美元抵扣额形式免费；需 Cloud 账号和 API Key。",
    request: "Basic 单次最多 100K 字节、128 个文本项；官方建议每次约 5K 字符以内。",
    rate: "默认每项目 600 万字符/分钟、v2 30 万次请求/分钟；以账号配额为准。", concurrency: "官方未公布统一并发上限。",
    sources: [source("Google Cloud 计费与免费额度", "https://cloud.google.com/products/translate/pricing"),
      source("Google Cloud 配额与请求限制", "https://docs.cloud.google.com/translate/quotas"),
      source("v2 文本项数量限制", "https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate")] };
}

function customUsage(service = "自定义接口"): ProviderUsage {
  return { service, quota: "以所配置服务的套餐及账号额度为准。", request: "以服务商的单次请求或模型规格为准。",
    rate: "以服务商的账号限流为准。", concurrency: "以服务商的账号并发额度为准。", sources: [] };
}

function officialHost(address: string, domains: string[]): boolean {
  try { const url = new URL(address); return url.protocol === "https:" && domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)); }
  catch { return false; }
}

export function getProviderUsage(provider: ProviderConfig): ProviderUsage {
  if (provider.type === "doubao-web") return { service: "豆包（实验性）", quota: "以豆包服务实际提供的额度为准。",
    request: unknown, rate: unknown, concurrency: unknown,
    sources: [source("豆包", "https://www.doubao.com/")] };
  if (supportsServiceMode(provider)) {
    const useApi = provider.serviceMode === "api";
    if (!useApi && provider.type !== "mymemory") {
      const free = freeServices[provider.type];
      return { service: free.service, quota: "官方未公布匿名接口配额。", request: unknown, rate: unknown, concurrency: unknown,
        sources: [free.source] };
    }
    const api = translationApiOptions(provider);
    if (provider.type === "microsoft-web-translate") return officialHost(api.endpoint ?? "", ["cognitive.microsofttranslator.com", "cognitiveservices.azure.com"])
      ? azureUsage() : customUsage("Microsoft 翻译 · 自定义 API 地址");
    if (provider.type === "google-web-translate") return googleUsage();
    if (provider.type === "tencent-transmart") {
      if (!officialHost(api.endpoint ?? "", ["tokenhub.tencentmaas.com", "tokenhub.tencentcloudmaas.com", "tokenhub-intl.tencentcloudmaas.com", "tokenhub-us.tencentcloudmaas.tech"])) return customUsage("腾讯翻译 · 自定义 API 地址");
      return { service: `腾讯 TokenHub · ${api.model || "未填写模型"}`,
        quota: "新用户可领取 100 万 Tokens 体验额度，有效期 1 年；需符合领取条件。",
        request: "以所选模型的上下文和输出上限为准。",
        rate: "按模型和账号限制 TPM（Tokens/分钟）、QPM（请求/分钟）。", concurrency: "以账号和所选模型的限流设置为准。",
        note: "体验活动截至 2026-12-31，领取资格及可用额度以控制台为准。",
        sources: [source("TokenHub 新人免费体验包", "https://cloud.tencent.com/document/product/1823/130053"),
          source("TokenHub 在线推理与限流", "https://cloud.tencent.cn/document/product/1823/130087")] };
    }
    if (provider.type === "yandex-web-translate") return { service: "Yandex Cloud Translate API", quota: "按字符计费，需账号和密钥；试用额度以账号为准。",
      request: "单次所有文本合计最多 10,000 字符。", rate: "默认同一 API 方法 20 次/秒；翻译和语言检测合计 100 万字符/小时，账号配额可能调整。",
      concurrency: "官方未公布固定并发上限。",
      sources: [source("Yandex Cloud 官方配额表", "https://yandex.cloud/en/docs/overview/concepts/quotas-limits#translate-quotas"),
        source("Yandex Translate 请求限制", "https://aistudio.yandex.ru/en/docs/translate/api-ref/Translation/translate"),
        source("Yandex Cloud 计费说明", "https://aistudio.yandex.ru/en/docs/translate/pricing")] };
    if (provider.type === "volcengine-web-translate") return { service: "火山引擎机器翻译 API", quota: "文本翻译每月前 200 万字符免费；需开通 API 服务并配置账号密钥。",
      request: "每次最多 16 个文本项，文本总长度最多 5,000 字符。", rate: "以账号的 QPS（请求/秒）配额为准。",
      concurrency: "官方未公布固定并发上限。",
      sources: [source("火山引擎机器翻译计费", "https://docs.volcengine.com/docs/MachineTranslation/Productbilling?lang=zh"),
        source("火山引擎文本翻译 API 限制", "https://docs.volcengine.com/docs/MachineTranslation/TextTranslationAPI?lang=zh")] };
    return useApi ? { service: "MyMemory · RapidAPI", quota: "按 RapidAPI 订阅方案计算额度。",
      request: "每次最多 500 UTF-8 字节，实际限制以订阅方案为准。", rate: "以 RapidAPI 订阅方案和账号限流为准。", concurrency: "以 RapidAPI 订阅方案为准。",
      sources: [source("MyMemory RapidAPI 订阅", "https://rapidapi.com/translated/api/mymemory-translation-memory"),
        source("MyMemory API 规范", "https://mymemory.translated.net/doc/spec.php")] }
      : { service: "MyMemory · 匿名", quota: "每天 5,000 字符。",
        request: "每次最多 500 UTF-8 字节。", rate: unknown, concurrency: unknown,
        sources: [source("MyMemory 匿名免费额度", "https://mymemory.translated.net/doc/usagelimits.php"),
          source("MyMemory 单次请求限制", "https://mymemory.translated.net/doc/spec.php")] };
  }
  if (provider.type === "microsoft-translator") return officialHost(provider.endpoint, ["cognitive.microsofttranslator.com", "cognitiveservices.azure.com"])
    ? azureUsage() : customUsage("Microsoft 翻译 · 自定义 API 地址");
  if (provider.type === "google-cloud-translation") return googleUsage();
  if (provider.type === "deepseek") {
    if (!officialHost(provider.baseURL, ["api.deepseek.com"])) return customUsage("DeepSeek · 自定义 API 地址");
    const concurrency = provider.model === "deepseek-flash" ? "deepseek-flash：每账号 2,500 并发。"
      : provider.model === "deepseek-v4-pro" ? "deepseek-v4-pro：每账号 500 并发。" : "以账号和所选模型的并发额度为准。";
    return { service: `DeepSeek API · ${provider.model}`, quota: "按 Tokens 计费，需 API Key；赠送额度以账号为准。",
      request: "以所选模型的上下文和输出上限为准。", rate: "按账号和模型限流，超限时返回 429。", concurrency,
      sources: [source("DeepSeek 官方并发限制", "https://api-docs.deepseek.com/quick_start/rate_limit/"),
        source("DeepSeek 官方 API 说明", "https://api-docs.deepseek.com/")] };
  }
  if (provider.type === "zhipu-glm") {
    if (!officialHost(provider.baseURL, ["open.bigmodel.cn"])) return customUsage("智谱 GLM · 自定义 API 地址");
    const freeModel = ["glm-4-flash-250414", "glm-4.5-flash", "glm-4.7-flash"].includes(provider.model);
    return { service: `智谱 GLM API · ${provider.model}`, quota: freeModel
      ? "当前模型免费，需账号和 API Key。"
      : "价格及赠送额度以模型定价和账号信息为准。",
      request: provider.model === "glm-4-flash-250414" ? "128K 上下文，最大输出 16K Tokens。" : "以所选模型的上下文和输出上限为准。",
      rate: "按账号和模型限流。", concurrency: "以账号当前模型的并发额度为准。",
      sources: [source("智谱官方模型表（含免费模型）", "https://docs.bigmodel.cn/cn/guide/start/model-overview"),
        source("智谱官方速率限制说明", "https://docs.bigmodel.cn/cn/api/rate-limit")] };
  }
  if (provider.type === "firefox-local") return { service: "Firefox 本地翻译（实验）", quota: "本地翻译，不消耗在线 API 额度；首次使用需下载或导入模型。",
    request: "受语言模型及设备内存限制。", rate: "不适用（本地翻译）。", concurrency: "不适用（本地翻译）。",
    sources: [source("Mozilla 本地翻译说明", "https://support.mozilla.org/en-US/kb/website-translation")] };
  if (provider.type === "openai-compatible" && officialHost(provider.baseURL, ["api.openai.com"])) return {
    service: `OpenAI 官方 API · ${provider.model}`, quota: "按模型计费，需 API Key；赠送额度以账号为准。",
    request: "以当前模型的上下文和输出上限为准。", rate: "按模型和账号等级限制 RPM（请求/分钟）、TPM（Tokens/分钟）等。",
    concurrency: "以账号 Limits 页的限额为准。",
    sources: [source("OpenAI 官方速率与账号等级", "https://developers.openai.com/api/docs/guides/rate-limits")] };
  if (provider.type === "anthropic-compatible" && officialHost(provider.baseURL, ["api.anthropic.com"])) return {
    service: `Anthropic 官方 API · ${provider.model}`, quota: "按模型计费，需 API Key；试用额度以账号为准。",
    request: "以当前模型的上下文、输出上限及单次请求大小限制为准。", rate: "按模型和账号等级限制 RPM（请求/分钟）、每分钟输入 Tokens 和输出 Tokens。",
    concurrency: "以账号当前模型的并发额度为准。",
    sources: [source("Anthropic 官方速率与账号等级", "https://platform.claude.com/docs/en/api/rate-limits"),
      source("Anthropic 官方 API 概览", "https://platform.claude.com/docs/en/api/overview")] };
  return customUsage(provider.type === "http-template" ? "自定义 HTTP 服务" : "自定义 LLM 兼容服务");
}
