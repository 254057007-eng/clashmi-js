/*
 * Clash Mi / Mihomo｜App Store Apple CN 定向验证版
 * 版本：2026.08.09-appstore-cn-to-apple
 *
 * 设计原则：
 * - 机场只提供 proxies / proxy-providers；
 * - 本脚本接管策略组、DNS、rule-providers、rules；
 * - TUN 由 Clash Mi iOS 本地「核心设置 → TUN」接管，本脚本不写 tun；
 * - 未经实机验收，不得作为生产配置。
 */

var TEMPLATE_VERSION = "2026.08.10-reality-shortid-quote-v2";

// =========================
// 可调参数
// =========================
var SETTINGS = {
  ipv6: false,
  blockAds: true,
  healthUrl: "https://www.gstatic.com/generate_204",
  healthInterval: 1800,
  healthTimeout: 5000,
  autoTolerance: 200,
  ruleInterval: 86400,
  providerInterval: 3600,
  providerPrefix: true,
  forceProviderDownloadDirect: true
};

// 仅使用 JS 与 Mihomo 策略组均可识别的边界写法；短代码支持 HK01 / JP01 等机场命名。
var REGION_RE = {
  HK: "(🇭🇰|香港|Hong\\s*Kong|\\b(HK|HKG)([0-9]+)?\\b)",
  JP: "(🇯🇵|日本|东京|東京|大阪|Japan|Tokyo|Osaka|\\b(JP|JPN|NRT|HND|KIX|CTS|FUK)([0-9]+)?\\b)",
  KR: "(🇰🇷|韩国|韓國|首尔|首爾|South\\s*Korea|Korea|Seoul|\\b(KR|KOR|ICN)([0-9]+)?\\b)",
  US: "(🇺🇸|美国|美國|美西|美东|美東|洛杉矶|洛杉磯|圣何塞|聖何塞|硅谷|矽谷|西雅图|西雅圖|达拉斯|達拉斯|纽约|紐約|芝加哥|Chicago|Los\\s*Angeles|San\\s*Jose|Seattle|Dallas|New\\s*York|United\\s*States|\\b(US|USA|LAX|SJC|SFO|SEA|JFK|ORD|DFW|IAD|ATL|MIA)([0-9]+)?\\b)",
  SG: "(🇸🇬|新加坡|狮城|獅城|Singapore|\\b(SG|SGP|SIN|XSP)([0-9]+)?\\b)",
  TW: "(🇹🇼|台湾|臺灣|台北|臺北|新北|高雄|Taiwan|Taipei|\\b(TW|TWN|TPE|TSA|KHH)([0-9]+)?\\b)"
};

var INFO_RE = "(剩余|剩餘|流量|到期|官网|官網|套餐|重置|公告|客服|订阅|訂閱|机场|機場|工单|工單|邀请|邀請|返利|通知|频道|頻道|Traffic|Expire|Remaining|Reset|Subscribe|Subscription|Official|Website|Channel|Author|Email)";
var MRS_BASE = "https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/";
var FAKEIP_FILTER_URL = "https://testingcf.jsdelivr.net/gh/wwqgtxx/clash-rules@release/fakeip-filter.mrs";

function uniq(arr) {
  var out = [];
  var seen = {};
  for (var i = 0; i < arr.length; i++) {
    var v = arr[i];
    if (!v || seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out;
}

function addIf(arr, value) {
  if (value && arr.indexOf(value) < 0) arr.push(value);
}

function regexMatch(text, pattern) {
  try {
    return new RegExp(pattern, "i").test(text || "");
  } catch (e) {
    return false;
  }
}

function safeNodeNames(config) {
  var proxies = Array.isArray(config.proxies) ? config.proxies : [];
  var names = [];
  for (var i = 0; i < proxies.length; i++) {
    var p = proxies[i] || {};
    var name = p.name;
    if (!name || typeof name !== "string") continue;
    if (regexMatch(name, INFO_RE)) continue;
    names.push(name);
  }
  return uniq(names);
}

function filterNodes(names, pattern) {
  var out = [];
  for (var i = 0; i < names.length; i++) {
    if (regexMatch(names[i], pattern)) out.push(names[i]);
  }
  return out;
}

function hasProviders(config) {
  var providers = config["proxy-providers"];
  return !!(providers && typeof providers === "object" && Object.keys(providers).length > 0);
}

function hasAnyRegion(name) {
  return regexMatch(name, REGION_RE.HK) || regexMatch(name, REGION_RE.JP) ||
    regexMatch(name, REGION_RE.KR) || regexMatch(name, REGION_RE.US) ||
    regexMatch(name, REGION_RE.SG) || regexMatch(name, REGION_RE.TW);
}

function mergeExcludeFilter(oldValue, appendValue) {
  if (!oldValue) return "(?i)" + appendValue;
  return "(?i)(" + String(oldValue) + "|" + appendValue + ")";
}

// REALITY 节点兼容：Clash Mi 的 JS 覆写会把完整订阅经 YAML→JSON→YAML 重写。
// 例如合法字符串 short-id "473277e2" 若写成无引号 YAML，会被 Mihomo 视为科学计数法而报错。
// 因此保留节点并强制有效 short-id 作为 YAML 字符串写回；无法安全还原的非法值仅删除该字段。
function sanitizeRealityNodes(config) {
  if (!Array.isArray(config.proxies)) return;
  for (var i = 0; i < config.proxies.length; i++) {
    var proxy = config.proxies[i];
    if (!proxy || String(proxy.type || '').toLowerCase() !== 'vless') continue;
    var opts = proxy['reality-opts'];
    if (!opts || typeof opts !== 'object' || Array.isArray(opts) || !opts['public-key']) continue;
    if (!Object.prototype.hasOwnProperty.call(opts, 'short-id')) continue;

    var raw = opts['short-id'];
    var shortId = null;
    if (typeof raw === 'string') shortId = raw.trim();
    // 已被客户端 YAML 解析为数值时无法恢复原始前导零；仅保留安全整数。
    else if (typeof raw === 'number' && isFinite(raw) && Math.floor(raw) === raw && Math.abs(raw) <= 9007199254740991) shortId = String(raw);

    if (shortId === null || !/^(?:[0-9a-fA-F]{2}){0,8}$/.test(shortId)) {
      delete opts['short-id'];
      continue;
    }
    // JSON.stringify 生成带双引号的字符串；YamlWriter 会把它写成 YAML 双引号字符串。
    // Clash Mi 下游 Mihomo YAML 解码后得到原始 short-id 字符串，而不是数值。
    opts['short-id'] = JSON.stringify(shortId);
  }
}

// 保留订阅 URL/header 等字段，仅统一不依赖机场策略组的下载路径、刷新、健康检查、信息节点排除及来源前缀。
function normalizeProxyProviders(config) {
  var providers = config["proxy-providers"];
  if (!providers || typeof providers !== "object") return;

  var keys = Object.keys(providers);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var p = providers[key];
    if (!p || typeof p !== "object") continue;

    p.interval = SETTINGS.providerInterval;
    if (SETTINGS.forceProviderDownloadDirect) p.proxy = "DIRECT";

    p["health-check"] = p["health-check"] || {};
    p["health-check"].enable = true;
    p["health-check"].url = SETTINGS.healthUrl;
    p["health-check"].interval = SETTINGS.healthInterval;
    p["health-check"].timeout = SETTINGS.healthTimeout;
    p["health-check"].lazy = true;
    p["health-check"]["expected-status"] = 204;

    p["exclude-filter"] = mergeExcludeFilter(p["exclude-filter"], INFO_RE);

    if (SETTINGS.providerPrefix) {
      p.override = p.override || {};
      var prefix = "[" + key + "] ";
      var oldPrefix = typeof p.override["additional-prefix"] === "string" ? p.override["additional-prefix"] : "";
      if (oldPrefix.indexOf(prefix) < 0) p.override["additional-prefix"] = prefix + oldPrefix;
    }
  }
}

function mrsDomain(name, file) {
  return {
    type: "http",
    behavior: "domain",
    format: "mrs",
    url: MRS_BASE + "geo/geosite/" + file + ".mrs",
    path: "./ruleset/v2-" + name + ".mrs",
    interval: SETTINGS.ruleInterval,
    proxy: "DIRECT"
  };
}

function mrsIp(name, file) {
  return {
    type: "http",
    behavior: "ipcidr",
    format: "mrs",
    url: MRS_BASE + "geo/geoip/" + file + ".mrs",
    path: "./ruleset/v2-" + name + ".mrs",
    interval: SETTINGS.ruleInterval,
    proxy: "DIRECT"
  };
}

function buildRuleProviders() {
  var providers = {
    "private-domain": mrsDomain("private-domain", "private"),
    "private-ip": mrsIp("private-ip", "private"),
    "geolocation-cn": mrsDomain("geolocation-cn", "geolocation-cn"),
    "cn-ip": mrsIp("cn-ip", "cn"),

    "fakeip-filter": {
      type: "http",
      behavior: "domain",
      format: "mrs",
      url: FAKEIP_FILTER_URL,
      path: "./ruleset/v2-fakeip-filter.mrs",
      interval: SETTINGS.ruleInterval,
      proxy: "DIRECT"
    },

    "cloudflare": mrsDomain("cloudflare", "cloudflare"),
    "ai-domain": mrsDomain("ai-domain", "category-ai-!cn"),
    "tiktok-domain": mrsDomain("tiktok-domain", "tiktok"),
    "douyin-domain": mrsDomain("douyin-domain", "douyin"),
    "feishu-domain": mrsDomain("feishu-domain", "feishu"),

    "apple-domain": mrsDomain("apple-domain", "apple"),
    "apple-cn-domain": mrsDomain("apple-cn-domain", "apple@cn"),
    "microsoft-domain": mrsDomain("microsoft-domain", "microsoft"),
    "microsoft-cn-domain": mrsDomain("microsoft-cn-domain", "microsoft@cn"),
    "onedrive-domain": mrsDomain("onedrive-domain", "onedrive"),

    "youtube-domain": mrsDomain("youtube-domain", "youtube"),
    "netflix-domain": mrsDomain("netflix-domain", "netflix"),
    "disney-domain": mrsDomain("disney-domain", "disney"),
    "primevideo-domain": mrsDomain("primevideo-domain", "primevideo"),
    "hbo-domain": mrsDomain("hbo-domain", "hbo"),

    "telegram-domain": mrsDomain("telegram-domain", "telegram"),
    "telegram-ip": mrsIp("telegram-ip", "telegram"),
    "google-domain": mrsDomain("google-domain", "google"),
    "google-ip": mrsIp("google-ip", "google"),
    "googlefcm-domain": mrsDomain("googlefcm-domain", "googlefcm"),
    "github-domain": mrsDomain("github-domain", "github"),
    "docker-domain": mrsDomain("docker-domain", "docker"),
    "gfw-domain": mrsDomain("gfw-domain", "gfw"),
    "twitter-domain": mrsDomain("twitter-domain", "twitter"),
    "twitter-ip": mrsIp("twitter-ip", "twitter"),
    "steam-domain": mrsDomain("steam-domain", "steam")
  };

  if (SETTINGS.blockAds) providers["ads-domain"] = mrsDomain("ads-domain", "category-ads-all");
  return providers;
}

function buildDns() {
  var directDns = [
    "https://dns.alidns.com/dns-query#DIRECT",
    "https://doh.pub/dns-query#DIRECT"
  ];
  var remoteDns = [
    "https://dns.google/dns-query#🛡️ DNS防泄露",
    "https://doh.opendns.com/dns-query#🛡️ DNS防泄露"
  ];

  return {
    enable: true,
    ipv6: SETTINGS.ipv6,
    listen: "0.0.0.0:1053",
    "cache-algorithm": "arc",
    "use-hosts": true,
    "respect-rules": false,
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter-mode": "blacklist",
    "fake-ip-filter": [
      "rule-set:private-domain",
      "rule-set:fakeip-filter",
      "rule-set:geolocation-cn",
      "+.mygcdn.mobaiemby.site",
      "+.mygcns.mobaiemby.site",
      "*.lan",
      "*.local",
      "+.local",
      "+.localhost",
      "+.msftconnecttest.com",
      "+.msftncsi.com",
      "+.market.xiaomi.com",
      "time.*.com",
      "time.*.gov",
      "time.*.edu.cn",
      "time.*.apple.com",
      "time1.*.com",
      "time2.*.com",
      "time3.*.com",
      "time4.*.com",
      "time5.*.com",
      "time6.*.com",
      "time7.*.com",
      "ntp.*.com",
      "stun.*.*",
      "stun.*.*.*"
    ],
    "default-nameserver": ["223.5.5.5#DIRECT", "119.29.29.29#DIRECT"],
    "proxy-server-nameserver": directDns,
    nameserver: remoteDns,
    "direct-nameserver": ["223.6.6.6#DIRECT", "119.29.29.29#DIRECT"],
    "direct-nameserver-follow-policy": false,
    "nameserver-policy": {
      "rule-set:private-domain,geolocation-cn": directDns,
      "mygcdn.mobaiemby.site": directDns,
      "mygcns.mobaiemby.site": directDns,
      "a.mobaiemby.site": remoteDns,
      "m.20269909.xyz": remoteDns,
      "rule-set:ai-domain,tiktok-domain,telegram-domain,google-domain,youtube-domain,netflix-domain,disney-domain,primevideo-domain,hbo-domain": remoteDns
    }
  };
}

function buildSniffer() {
  return {
    enable: true,
    "force-dns-mapping": true,
    "parse-pure-ip": true,
    "override-destination": false,
    sniff: {
      HTTP: { ports: [80, "8080-8880"], "override-destination": true },
      TLS: { ports: [443, 8443] },
      QUIC: { ports: [443, 8443] }
    }
  };
}

function buildRules() {
  var rules = [
    // LAN / 私有地址：强制 DIRECT，不受国内直连策略组手动设置影响。
    "DOMAIN-SUFFIX,local,DIRECT",
    "DOMAIN-SUFFIX,lan,DIRECT",
    "RULE-SET,private-domain,DIRECT",
    "RULE-SET,private-ip,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,100.64.0.0/10,DIRECT,no-resolve",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,169.254.0.0/16,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",

    // Emby：CF 线路与直连 CDN / IP 必须精确隔离；禁止宽泛 mobaiemby.site DIRECT。
    "DOMAIN,a.mobaiemby.site,🎞️ Emby CF",
    "DOMAIN,m.20269909.xyz,🎞️ Emby CF",
    "DOMAIN,mygcdn.mobaiemby.site,DIRECT",
    "DOMAIN,mygcns.mobaiemby.site,DIRECT",
    "IP-CIDR,209.33.172.84/32,DIRECT,no-resolve",
    "IP-CIDR,45.143.131.228/32,DIRECT,no-resolve",
    "IP-CIDR,37.123.192.219/32,DIRECT,no-resolve",
    "IP-CIDR,185.148.13.104/32,DIRECT,no-resolve",
    "IP-CIDR,185.148.13.13/32,DIRECT,no-resolve",
    "IP-CIDR,185.148.13.76/32,DIRECT,no-resolve",
    "IP-CIDR,185.148.13.30/32,DIRECT,no-resolve",

    // 金融证券 / 银行 / 支付。
    "DOMAIN-SUFFIX,eastmoney.com,💰 金融证券",
    "DOMAIN-SUFFIX,1234567.com.cn,💰 金融证券",
    "DOMAIN-SUFFIX,10jqka.com.cn,💰 金融证券",
    "DOMAIN-SUFFIX,xueqiu.com,💰 金融证券",
    "DOMAIN-SUFFIX,hs.net,💰 金融证券",
    "DOMAIN-SUFFIX,alipay.com,💰 金融证券",
    "DOMAIN-SUFFIX,alipayobjects.com,💰 金融证券",
    "DOMAIN-SUFFIX,antgroup.com,💰 金融证券",
    "DOMAIN-SUFFIX,antfin-inc.com,💰 金融证券",
    "DOMAIN-SUFFIX,cmbchina.com,💰 金融证券",
    "DOMAIN-SUFFIX,icbc.com.cn,💰 金融证券",
    "DOMAIN-SUFFIX,ccb.com,💰 金融证券",
    "DOMAIN-SUFFIX,boc.cn,💰 金融证券",
    "DOMAIN-SUFFIX,abchina.com,💰 金融证券",
    "DOMAIN-SUFFIX,bankcomm.com,💰 金融证券",
    "DOMAIN-SUFFIX,psbc.com,💰 金融证券",
    "DOMAIN-SUFFIX,pingan.com,💰 金融证券",
    "DOMAIN-SUFFIX,unionpay.com,💰 金融证券",
    "DOMAIN-SUFFIX,unionpayintl.com,💰 金融证券",
    "DOMAIN-SUFFIX,95516.com,💰 金融证券",
    "DOMAIN-SUFFIX,tenpay.com,💰 金融证券",

    // AI：显式规则在大规则集前，避免 Google 泛规则抢先命中。
    "DOMAIN-SUFFIX,chatgpt.com,🤖 AI专属",
    "DOMAIN-SUFFIX,openai.com,🤖 AI专属",
    "DOMAIN-SUFFIX,oaistatic.com,🤖 AI专属",
    "DOMAIN-SUFFIX,oaiusercontent.com,🤖 AI专属",
    "DOMAIN-SUFFIX,chatgpt.livekit.cloud,🤖 AI专属",
    "DOMAIN-SUFFIX,claude.ai,🤖 AI专属",
    "DOMAIN-SUFFIX,anthropic.com,🤖 AI专属",
    "DOMAIN,gemini.google.com,🤖 AI专属",
    "DOMAIN,ai.google.dev,🤖 AI专属",
    "DOMAIN-SUFFIX,aistudio.google.com,🤖 AI专属",
    "DOMAIN-SUFFIX,generativelanguage.googleapis.com,🤖 AI专属",
    "DOMAIN-SUFFIX,notebooklm.google.com,🤖 AI专属",
    "DOMAIN-SUFFIX,perplexity.ai,🤖 AI专属",
    "DOMAIN-SUFFIX,perplexity.com,🤖 AI专属",
    "DOMAIN-SUFFIX,grok.com,🤖 AI专属",
    "DOMAIN-SUFFIX,x.ai,🤖 AI专属",
    "RULE-SET,ai-domain,🤖 AI专属",

    // TikTok：Mihomo 不支持 USER-AGENT；先处理明确海外 TikTok 域名。
    "DOMAIN-SUFFIX,tiktok.com,🌍 TikTok",
    "DOMAIN-SUFFIX,tiktokv.com,🌍 TikTok",
    "DOMAIN-SUFFIX,tiktokcdn.com,🌍 TikTok",
    "DOMAIN-SUFFIX,tiktokcdn-us.com,🌍 TikTok",
    "DOMAIN-SUFFIX,tiktokv.us,🌍 TikTok",
    "DOMAIN-SUFFIX,tiktokd.net,🌍 TikTok",
    "DOMAIN-SUFFIX,tiktokd.org,🌍 TikTok",
    "DOMAIN-SUFFIX,tik-tokapi.com,🌍 TikTok",
    "DOMAIN-SUFFIX,musical.ly,🌍 TikTok",
    "DOMAIN-SUFFIX,muscdn.com,🌍 TikTok",
    "DOMAIN-SUFFIX,ibyteimg.com,🌍 TikTok",
    "DOMAIN-SUFFIX,ibytedtos.com,🌍 TikTok",
    "DOMAIN-SUFFIX,byteoversea.com,🌍 TikTok",
    "DOMAIN-SUFFIX,byteintlapi.com,🌍 TikTok",
    "DOMAIN-KEYWORD,tiktok,🌍 TikTok",
    "DOMAIN-KEYWORD,byteoversea,🌍 TikTok",
    "RULE-SET,tiktok-domain,🌍 TikTok",

    // 飞书办公。
    "DOMAIN-SUFFIX,larksuite.com,🏢 飞书办公",
    "DOMAIN-SUFFIX,larksuitecdn.com,🏢 飞书办公",
    "DOMAIN-SUFFIX,bdurl.net,🏢 飞书办公",
    "DOMAIN-SUFFIX,toutiaocloud.com,🏢 飞书办公",
    "RULE-SET,feishu-domain,🏢 飞书办公",

    // 公司内容：公司网络实测被拦截域名（2026-08-09）。
    // 默认 DIRECT（家/其他网络正常直连）；到公司网络手动把组切到 🌐 代理访问 绕过拦截。
    "DOMAIN-SUFFIX,snssdk.com,💼 公司内容",
    "DOMAIN-SUFFIX,mail.qq.com,💼 公司内容",
    "DOMAIN-SUFFIX,qqmail.com,💼 公司内容",
    "DOMAIN-SUFFIX,foxmail.com,💼 公司内容",
    "DOMAIN-SUFFIX,exmail.qq.com,💼 公司内容",
    "DOMAIN-SUFFIX,smtp.qq.com,💼 公司内容",
    "DOMAIN-SUFFIX,imap.qq.com,💼 公司内容",
    "DOMAIN-SUFFIX,pop.qq.com,💼 公司内容",
    "DOMAIN-SUFFIX,mail.163.com,💼 公司内容",
    "DOMAIN-SUFFIX,mail.aliyun.com,💼 公司内容",
    "DOMAIN-KEYWORD,qqmail,💼 公司内容",
    "DOMAIN-SUFFIX,douyin.com,💼 公司内容",
    "DOMAIN-SUFFIX,iesdouyin.com,💼 公司内容",
    "DOMAIN-SUFFIX,douyincdn.com,💼 公司内容",
    "DOMAIN-SUFFIX,douyinpic.com,💼 公司内容",
    "DOMAIN-SUFFIX,douyinstatic.com,💼 公司内容",
    "DOMAIN-SUFFIX,douyinvod.com,💼 公司内容",
    "DOMAIN-SUFFIX,idouyinvod.com,💼 公司内容",
    "DOMAIN-SUFFIX,pstatp.com,💼 公司内容",
    "DOMAIN-SUFFIX,toutiao.com,💼 公司内容",
    "DOMAIN-SUFFIX,ixigua.com,💼 公司内容",
    "DOMAIN-SUFFIX,ixiguavideo.com,💼 公司内容",
    "DOMAIN-SUFFIX,bilibili.com,💼 公司内容",
    "DOMAIN-KEYWORD,douyin,💼 公司内容",
    "RULE-SET,douyin-domain,💼 公司内容",
    "DOMAIN-SUFFIX,bytecdn.cn,💼 公司内容",
    "DOMAIN-SUFFIX,byteimg.com,💼 公司内容",

    // App Store 定向验证：Apple CN 集合与通用 Apple 集合均进入苹果服务组，
    // 以便一个“🍎 苹果服务”选择覆盖两类 Apple 请求；Microsoft CN 仍保持直连。
    "RULE-SET,apple-cn-domain,🍎 苹果服务",
    "RULE-SET,microsoft-cn-domain,🎯 国内直连",
    "RULE-SET,apple-domain,🍎 苹果服务",
    "RULE-SET,microsoft-domain,☁️ 微软服务",
    "RULE-SET,onedrive-domain,☁️ 微软服务",

    // 视频 / 流媒体。
    "DOMAIN-SUFFIX,music.youtube.com,📺 视频服务",
    "RULE-SET,youtube-domain,📺 视频服务",
    "RULE-SET,netflix-domain,🎬 流媒体稳定",
    "RULE-SET,disney-domain,🎬 流媒体稳定",
    "RULE-SET,primevideo-domain,🎬 流媒体稳定",
    "RULE-SET,hbo-domain,🎬 流媒体稳定",

    // Telegram。
    "RULE-SET,telegram-domain,📲 电报消息",
    "RULE-SET,telegram-ip,📲 电报消息,no-resolve",

    // Google / GitHub / 其他海外开发和基础服务。
    "RULE-SET,googlefcm-domain,🔎 Google",
    "RULE-SET,google-domain,🔎 Google",
    "RULE-SET,google-ip,🔎 Google,no-resolve",
    "RULE-SET,github-domain,🐙 GitHub",
    "RULE-SET,docker-domain,🐙 GitHub",
    "RULE-SET,twitter-domain,🚀 策略选择",
    "RULE-SET,twitter-ip,🚀 策略选择,no-resolve",
    "RULE-SET,steam-domain,🚀 策略选择",
    "RULE-SET,gfw-domain,🚀 策略选择",

    // 必须排在 Emby 精确规则和上述业务规则之后。
    "RULE-SET,cloudflare,☁️ Cloudflare"
  ];

  if (SETTINGS.blockAds) rules.push("RULE-SET,ads-domain,🛑 广告拦截");

  rules = rules.concat([
    "RULE-SET,geolocation-cn,🎯 国内直连",
    "RULE-SET,cn-ip,🎯 国内直连,no-resolve",
    "MATCH,🚀 策略选择"
  ]);

  return rules;
}

function addNodeSource(group, directNodes, providerPresent, filter, excludeFilter) {
  group.proxies = directNodes.slice();
  if (providerPresent) group["include-all-providers"] = true;
  if (filter) group.filter = "(?i)" + filter;
  group["exclude-filter"] = "(?i)" + (excludeFilter || INFO_RE);
  return group;
}

function fallbackGroup(name, directNodes, providerPresent, filter, excludeFilter) {
  return addNodeSource({
    name: name,
    type: "fallback",
    url: SETTINGS.healthUrl,
    interval: SETTINGS.healthInterval,
    timeout: SETTINGS.healthTimeout,
    lazy: true,
    "max-failed-times": 3,
    "expected-status": 204
  }, directNodes, providerPresent, filter, excludeFilter);
}

function urlTestGroup(name, directNodes, providerPresent, filter, excludeFilter) {
  return addNodeSource({
    name: name,
    type: "url-test",
    url: SETTINGS.healthUrl,
    interval: SETTINGS.healthInterval,
    tolerance: SETTINGS.autoTolerance,
    timeout: SETTINGS.healthTimeout,
    lazy: true,
    "max-failed-times": 3,
    "expected-status": 204
  }, directNodes, providerPresent, filter, excludeFilter);
}

function loadBalanceGroup(name, directNodes, providerPresent, filter, excludeFilter) {
  return addNodeSource({
    name: name,
    type: "load-balance",
    strategy: "sticky-sessions",
    url: SETTINGS.healthUrl,
    interval: SETTINGS.healthInterval,
    timeout: SETTINGS.healthTimeout,
    lazy: true,
    "max-failed-times": 3,
    "expected-status": 204
  }, directNodes, providerPresent, filter, excludeFilter);
}

function selectNodeGroup(name, choices, directNodes, providerPresent, filter, excludeFilter) {
  var group = { name: name, type: "select", proxies: uniq(choices.concat(directNodes)) };
  if (providerPresent) group["include-all-providers"] = true;
  if (filter) group.filter = "(?i)" + filter;
  group["exclude-filter"] = "(?i)" + (excludeFilter || INFO_RE);
  return group;
}

function main(config) {
  config = config || {};

  sanitizeRealityNodes(config);

  normalizeProxyProviders(config);

  var providerPresent = hasProviders(config);
  var allNodes = safeNodeNames(config);
  var nodes = {
    HK: filterNodes(allNodes, REGION_RE.HK),
    JP: filterNodes(allNodes, REGION_RE.JP),
    KR: filterNodes(allNodes, REGION_RE.KR),
    US: filterNodes(allNodes, REGION_RE.US),
    SG: filterNodes(allNodes, REGION_RE.SG),
    TW: filterNodes(allNodes, REGION_RE.TW),
    OTHER: []
  };

  for (var oi = 0; oi < allNodes.length; oi++) {
    if (!hasAnyRegion(allNodes[oi])) nodes.OTHER.push(allNodes[oi]);
  }

  var groups = [];
  var exists = {};
  function push(group) {
    groups.push(group);
    exists[group.name] = true;
  }
  function addExisting(arr, name) {
    if (exists[name]) addIf(arr, name);
  }

  // 全局节点池：若是 Provider 型机场，由 include-all-providers 在运行时吸收节点。
  push(fallbackGroup("🔁 全局故障切换", allNodes, providerPresent, null, INFO_RE));
  push(urlTestGroup("♻️ 全局自动", allNodes, providerPresent, null, INFO_RE));
  push(selectNodeGroup("🫴 手动选择", [], allNodes, providerPresent, null, INFO_RE));

  var regionDefs = [
    { key: "HK", label: "🇭🇰 香港", stable: "🇭🇰 香港稳定", auto: "🇭🇰 香港自动测速" },
    { key: "JP", label: "🇯🇵 日本", stable: "🇯🇵 日本稳定", auto: "🇯🇵 日本自动测速" },
    { key: "KR", label: "🇰🇷 韩国", stable: "🇰🇷 韩国稳定", auto: "🇰🇷 韩国自动测速" },
    { key: "US", label: "🇺🇸 美国", stable: "🇺🇸 美国稳定", auto: "🇺🇸 美国自动测速" },
    { key: "SG", label: "🇸🇬 新加坡", stable: "🇸🇬 新加坡稳定", auto: "🇸🇬 新加坡自动测速" },
    { key: "TW", label: "🇹🇼 台湾", stable: "🇹🇼 台湾稳定", auto: "🇹🇼 台湾自动测速" }
  ];

  // inline 订阅没有该地区且没有 Provider 时，不生成空 fallback / url-test 组。
  for (var ri = 0; ri < regionDefs.length; ri++) {
    var d = regionDefs[ri];
    if (!providerPresent && nodes[d.key].length === 0) continue;
    push(fallbackGroup(d.stable, nodes[d.key], providerPresent, REGION_RE[d.key], INFO_RE));
    push(urlTestGroup(d.auto, nodes[d.key], providerPresent, REGION_RE[d.key], INFO_RE));
    push(selectNodeGroup(d.label, [d.stable, d.auto], nodes[d.key], providerPresent, REGION_RE[d.key], INFO_RE));
  }

  var otherExclude = INFO_RE + "|" + REGION_RE.HK + "|" + REGION_RE.JP + "|" + REGION_RE.KR + "|" + REGION_RE.US + "|" + REGION_RE.SG + "|" + REGION_RE.TW;
  if (providerPresent || nodes.OTHER.length > 0) {
    push(fallbackGroup("🌐 其他节点稳定", nodes.OTHER, providerPresent, null, otherExclude));
    push(urlTestGroup("🌐 其他节点自动测速", nodes.OTHER, providerPresent, null, otherExclude));
    push(selectNodeGroup("🌐 其他节点", ["🌐 其他节点稳定", "🌐 其他节点自动测速"], nodes.OTHER, providerPresent, null, otherExclude));
  }

  // 地区稳定优先顺序严格继承历史习惯：日本 → 新加坡 → 美国 → 香港 → 台湾 → 韩国。
  var proxyChoices = [];
  addExisting(proxyChoices, "🇯🇵 日本稳定");
  addExisting(proxyChoices, "🇸🇬 新加坡稳定");
  addExisting(proxyChoices, "🇺🇸 美国稳定");
  addExisting(proxyChoices, "🇭🇰 香港稳定");
  addExisting(proxyChoices, "🇹🇼 台湾稳定");
  addExisting(proxyChoices, "🇰🇷 韩国稳定");
  addExisting(proxyChoices, "🌐 其他节点稳定");
  addIf(proxyChoices, "🔁 全局故障切换");
  addIf(proxyChoices, "♻️ 全局自动");
  addIf(proxyChoices, "🫴 手动选择");
  push({ name: "🌐 代理访问", type: "select", proxies: proxyChoices });
  push({ name: "🚀 策略选择", type: "select", proxies: ["🌐 代理访问", "DIRECT"] });
  push({ name: "🎯 国内直连", type: "select", proxies: ["DIRECT", "🚀 策略选择"] });
  var dnsChoices = ["🌐 代理访问"];
  addExisting(dnsChoices, "🇯🇵 日本稳定");
  addExisting(dnsChoices, "🇸🇬 新加坡稳定");
  addExisting(dnsChoices, "🇺🇸 美国稳定");
  addIf(dnsChoices, "🫴 手动选择");
  push({ name: "🛡️ DNS防泄露", type: "select", proxies: dnsChoices });
  push({ name: "☁️ Cloudflare", type: "select", proxies: ["DIRECT", "🌐 代理访问", "🫴 手动选择"] });
  push({ name: "🛑 广告拦截", type: "select", proxies: ["REJECT", "DIRECT"] });

  // 视频的地区均衡组仅在该地区有内联节点或可从 Provider 动态吸收时创建。
  if (exists["🇯🇵 日本稳定"]) push(loadBalanceGroup("📺 日本均衡", nodes.JP, providerPresent, REGION_RE.JP, INFO_RE));
  if (exists["🇸🇬 新加坡稳定"]) push(loadBalanceGroup("📺 新加坡均衡", nodes.SG, providerPresent, REGION_RE.SG, INFO_RE));

  var aiChoices = [];
  addExisting(aiChoices, "🇺🇸 美国稳定");
  addExisting(aiChoices, "🇸🇬 新加坡稳定");
  addIf(aiChoices, "🌐 代理访问");
  addIf(aiChoices, "🫴 手动选择");
  push({ name: "🤖 AI专属", type: "select", proxies: aiChoices });

  var tiktokChoices = [];
  addExisting(tiktokChoices, "🇯🇵 日本稳定");
  addExisting(tiktokChoices, "🇸🇬 新加坡稳定");
  addExisting(tiktokChoices, "🇺🇸 美国稳定");
  addIf(tiktokChoices, "🌐 代理访问");
  addIf(tiktokChoices, "🫴 手动选择");
  push({ name: "🌍 TikTok", type: "select", proxies: tiktokChoices });

  push({ name: "🏢 飞书办公", type: "select", proxies: ["DIRECT", "🚀 策略选择"] });
  push({ name: "💼 公司内容", type: "select", proxies: ["DIRECT", "🌐 代理访问", "🚀 策略选择"] });
  push({ name: "💰 金融证券", type: "select", proxies: ["DIRECT", "🚀 策略选择"] });
  push({ name: "🍎 苹果服务", type: "select", proxies: ["DIRECT", "🚀 策略选择"] });
  push({ name: "☁️ 微软服务", type: "select", proxies: ["DIRECT", "🚀 策略选择"] });

  var videoChoices = [];
  addExisting(videoChoices, "📺 日本均衡");
  addExisting(videoChoices, "📺 新加坡均衡");
  addExisting(videoChoices, "🇯🇵 日本稳定");
  addExisting(videoChoices, "🇸🇬 新加坡稳定");
  addExisting(videoChoices, "🇺🇸 美国稳定");
  addIf(videoChoices, "🌐 代理访问");
  addIf(videoChoices, "DIRECT");
  push({ name: "📺 视频服务", type: "select", proxies: videoChoices });

  var mediaChoices = [];
  addExisting(mediaChoices, "🇸🇬 新加坡稳定");
  addExisting(mediaChoices, "🇯🇵 日本稳定");
  addExisting(mediaChoices, "🇺🇸 美国稳定");
  addExisting(mediaChoices, "🇭🇰 香港稳定");
  addExisting(mediaChoices, "🇹🇼 台湾稳定");
  addExisting(mediaChoices, "🇰🇷 韩国稳定");
  addIf(mediaChoices, "🌐 代理访问");
  push({ name: "🎬 流媒体稳定", type: "select", proxies: mediaChoices });

  var embyChoices = ["🎬 流媒体稳定", "🌐 代理访问"];
  addExisting(embyChoices, "🇯🇵 日本稳定");
  addExisting(embyChoices, "🇸🇬 新加坡稳定");
  addExisting(embyChoices, "🇺🇸 美国稳定");
  addIf(embyChoices, "DIRECT");
  push({ name: "🎞️ Emby CF", type: "select", proxies: embyChoices });

  var telegramChoices = [];
  addExisting(telegramChoices, "🇯🇵 日本稳定");
  addExisting(telegramChoices, "🇸🇬 新加坡稳定");
  addExisting(telegramChoices, "🇺🇸 美国稳定");
  addExisting(telegramChoices, "🇭🇰 香港稳定");
  addExisting(telegramChoices, "🇹🇼 台湾稳定");
  addExisting(telegramChoices, "🇰🇷 韩国稳定");
  addIf(telegramChoices, "🌐 代理访问");
  push({ name: "📲 电报消息", type: "select", proxies: telegramChoices });

  push({ name: "🔎 Google", type: "select", proxies: ["🌐 代理访问", "🫴 手动选择"] });
  push({ name: "🐙 GitHub", type: "select", proxies: ["🌐 代理访问", "🫴 手动选择"] });

  // 接管机场策略、DNS、规则与规则集；保留机场节点与 proxy-providers。
  config["proxy-groups"] = groups;
  config["rule-providers"] = buildRuleProviders();
  config.rules = buildRules();
  config.dns = buildDns();
  config.sniffer = buildSniffer();

  // TUN 不在这里写：Clash Mi iOS 本地核心设置是唯一所有者。
  config.mode = "rule";
  config.ipv6 = SETTINGS.ipv6;
  config.udp = true;
  config["tcp-concurrent"] = true;
  config["unified-delay"] = true;
  config["disable-keep-alive"] = false;
  config["keep-alive-interval"] = 15;
  config["keep-alive-idle"] = 600;
  delete config["global-client-fingerprint"];

  config.profile = config.profile || {};
  config.profile["store-selected"] = true;
  config.profile["store-fake-ip"] = true;

  return config;
}
