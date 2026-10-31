use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetectedProxy {
    pub url: String,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProxyDetectionResult {
    pub proxy: Option<DetectedProxy>,
    #[serde(rename = "vpnName", alias = "vpn_name")]
    pub vpn_name: Option<String>,
}

/// Standard local proxy port probes for Clash, Mihomo, V2Ray, Xray, NekoBox, Shadowsocks, Fiddler, Charles, etc.
const LOCAL_PROBES: &[(u16, &str, &str)] = &[
    (7890, "http", "Clash / Mihomo HTTP (порт 7890)"),
    (7897, "http", "Clash Verge Rev (порт 7897)"),
    (7891, "socks5", "Clash / Mihomo SOCKS5 (порт 7891)"),
    (10809, "http", "v2rayN HTTP (порт 10809)"),
    (10808, "socks5", "v2rayN SOCKS5 (порт 10808)"),
    (1087, "http", "Shadowsocks / V2Ray HTTP (порт 1087)"),
    (1086, "socks5", "Shadowsocks / V2Ray SOCKS5 (порт 1086)"),
    (20810, "http", "NekoBox HTTP (порт 20810)"),
    (2080, "socks5", "NekoBox SOCKS5 (порт 2080)"),
    (1080, "socks5", "Shadowsocks (порт 1080)"),
    (2334, "socks5", "sing-box SOCKS5 (порт 2334)"),
    (8888, "http", "Локальный прокси Fiddler / Charles (порт 8888)"),
    (8889, "http", "Локальный прокси Charles (порт 8889)"),
];

/// Probe localhost on common proxy ports.
/// On loopback (127.0.0.1), OS immediately returns RST for closed ports (<0.1ms),
/// so probing takes under 2ms in total.
pub fn probe_local_proxy_ports() -> Option<DetectedProxy> {
    for &(port, scheme, label) in LOCAL_PROBES {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        if TcpStream::connect_timeout(&addr, Duration::from_millis(35)).is_ok() {
            return Some(DetectedProxy {
                url: format!("{}://127.0.0.1:{}", scheme, port),
                source: label.to_string(),
            });
        }
    }
    None
}

/// Parse output of macOS `scutil --proxy`
#[allow(dead_code)]
pub fn parse_scutil_proxy_output(stdout: &str) -> Option<DetectedProxy> {
    let mut map = HashMap::new();
    for line in stdout.lines() {
        let line = line.trim();
        if let Some((k, v)) = line.split_once(':') {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }

    // 1. Check HTTPS proxy
    if map.get("HTTPSEnable").map(|s| s == "1").unwrap_or(false) {
        if let (Some(proxy), Some(port)) = (map.get("HTTPSProxy"), map.get("HTTPSPort")) {
            if !proxy.is_empty() && !port.is_empty() {
                return Some(DetectedProxy {
                    url: format!("http://{}:{}", proxy, port),
                    source: "Системный HTTPS прокси macOS".to_string(),
                });
            }
        }
    }

    // 2. Check HTTP proxy
    if map.get("HTTPEnable").map(|s| s == "1").unwrap_or(false) {
        if let (Some(proxy), Some(port)) = (map.get("HTTPProxy"), map.get("HTTPPort")) {
            if !proxy.is_empty() && !port.is_empty() {
                return Some(DetectedProxy {
                    url: format!("http://{}:{}", proxy, port),
                    source: "Системный HTTP прокси macOS".to_string(),
                });
            }
        }
    }

    // 3. Check SOCKS proxy
    if map.get("SOCKSEnable").map(|s| s == "1").unwrap_or(false) {
        if let (Some(proxy), Some(port)) = (map.get("SOCKSProxy"), map.get("SOCKSPort")) {
            if !proxy.is_empty() && !port.is_empty() {
                return Some(DetectedProxy {
                    url: format!("socks5://{}:{}", proxy, port),
                    source: "Системный SOCKS прокси macOS".to_string(),
                });
            }
        }
    }

    None
}

/// Detect macOS system proxy via `scutil --proxy`
#[cfg(target_os = "macos")]
pub fn detect_macos_system_proxy() -> Option<DetectedProxy> {
    let output = std::process::Command::new("scutil")
        .arg("--proxy")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_scutil_proxy_output(&stdout)
}

/// Parse Windows `ProxyServer` registry string
#[allow(dead_code)]
pub fn parse_windows_proxy_server(proxy_server: &str) -> Option<DetectedProxy> {
    let trimmed = proxy_server.trim().trim_matches('"').trim_matches('\'').trim();
    if trimmed.is_empty() {
        return None;
    }

    // ProxyServer formats:
    // 1) "127.0.0.1:7890"
    // 2) "http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891"
    if trimmed.contains('=') {
        let mut http_part = None;
        let mut https_part = None;
        let mut socks_part = None;

        for entry in trimmed.split(';') {
            let entry = entry.trim();
            if let Some((proto, addr)) = entry.split_once('=') {
                let clean_addr = addr.trim().to_string();
                match proto.trim().to_lowercase().as_str() {
                    "https" => https_part = Some(clean_addr),
                    "http" => http_part = Some(clean_addr),
                    "socks" => socks_part = Some(clean_addr),
                    _ => {}
                }
            }
        }

        if let Some(https) = https_part {
            return Some(DetectedProxy {
                url: if https.contains("://") { https } else { format!("http://{}", https) },
                source: "Системный прокси Windows (HTTPS)".to_string(),
            });
        }
        if let Some(http) = http_part {
            return Some(DetectedProxy {
                url: if http.contains("://") { http } else { format!("http://{}", http) },
                source: "Системный прокси Windows (HTTP)".to_string(),
            });
        }
        if let Some(socks) = socks_part {
            return Some(DetectedProxy {
                url: if socks.contains("://") { socks } else { format!("socks5://{}", socks) },
                source: "Системный прокси Windows (SOCKS)".to_string(),
            });
        }
    } else {
        let url = if trimmed.contains("://") {
            trimmed.to_string()
        } else {
            format!("http://{}", trimmed)
        };
        return Some(DetectedProxy {
            url,
            source: "Системный прокси Windows".to_string(),
        });
    }

    None
}

/// Detect Windows system proxy from Registry
#[cfg(windows)]
pub fn detect_windows_system_proxy() -> Option<DetectedProxy> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let internet_settings = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    let proxy_enable: u32 = internet_settings.get_value("ProxyEnable").unwrap_or(0);
    if proxy_enable == 0 {
        return None;
    }
    let proxy_server: String = internet_settings.get_value("ProxyServer").unwrap_or_default();
    parse_windows_proxy_server(&proxy_server)
}

/// Check standard environment variables: ALL_PROXY, HTTPS_PROXY, HTTP_PROXY
pub fn detect_env_proxy() -> Option<DetectedProxy> {
    for var in &[
        "ALL_PROXY",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "all_proxy",
        "https_proxy",
        "http_proxy",
    ] {
        if let Ok(val) = std::env::var(var) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                let url = if trimmed.contains("://") {
                    trimmed.to_string()
                } else {
                    format!("http://{}", trimmed)
                };
                return Some(DetectedProxy {
                    url,
                    source: format!("Переменная окружения {}", var),
                });
            }
        }
    }
    None
}

/// Detect active proxy across platforms (OS settings, local daemons, environment).
pub fn detect_system_or_local_proxy() -> Option<DetectedProxy> {
    // 1. Check OS system proxy settings
    #[cfg(target_os = "macos")]
    {
        if let Some(proxy) = detect_macos_system_proxy() {
            return Some(proxy);
        }
    }
    #[cfg(windows)]
    {
        if let Some(proxy) = detect_windows_system_proxy() {
            return Some(proxy);
        }
    }

    // 2. Check local proxy daemons (Clash, Mihomo, v2ray, etc.)
    if let Some(proxy) = probe_local_proxy_ports() {
        return Some(proxy);
    }

    // 3. Check environment variables
    if let Some(proxy) = detect_env_proxy() {
        return Some(proxy);
    }

    None
}

/// Normalize user-provided or detected proxy URL
pub fn normalize_proxy_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_matches('"').trim_matches('\'').trim();
    if trimmed.is_empty() {
        return None;
    }

    let with_scheme = if !trimmed.contains("://") {
        format!("http://{}", trimmed)
    } else {
        trimmed.to_string()
    };

    Some(with_scheme)
}

/// Resolve the effective proxy URL according to settings:
/// - If `proxy_mode == "disabled"`, returns None
/// - If `proxy_url` is non-empty, normalizes and returns it
/// - If `proxy_mode == "auto"` or `"always"`, detects automatically
pub fn resolve_effective_proxy_url() -> Option<String> {
    let settings = crate::load_settings().unwrap_or_default();
    if settings.proxy_mode == "disabled" {
        return None;
    }

    if !settings.proxy_url.trim().is_empty() {
        return normalize_proxy_url(&settings.proxy_url);
    }

    detect_system_or_local_proxy().map(|d| d.url)
}

/// Test connection to a proxy endpoint.
/// First performs a fast TCP connectivity test to the proxy host/port.
/// If TCP is open, performs an HTTP request through the proxy to verify routing.
pub async fn test_proxy_url(raw_proxy: &str) -> Result<String, String> {
    let normalized = normalize_proxy_url(raw_proxy)
        .ok_or_else(|| "Адрес прокси не указан или пуст".to_string())?;

    let parts: Vec<&str> = normalized.split("://").collect();
    if parts.len() < 2 {
        return Err("Неверный формат адреса прокси (ожидается scheme://host:port)".to_string());
    }

    let scheme = parts[0].to_lowercase();
    let host_port_part = parts[1];
    let host_port = host_port_part.split('/').next().unwrap_or("");
    let host_port = host_port.split('@').last().unwrap_or(host_port);

    // If host_port does not have a port, append the default port based on scheme
    let resolved_host_port = if !host_port.contains(':') {
        let default_port = match scheme.as_str() {
            "socks4" | "socks5" | "socks5h" => 1080,
            "https" => 443,
            _ => 80,
        };
        format!("{}:{}", host_port, default_port)
    } else {
        host_port.to_string()
    };

    // Fast TCP connection test to proxy daemon
    let addr = resolved_host_port
        .to_socket_addrs()
        .map_err(|e| format!("Не удалось разрешить адрес {}: {}", resolved_host_port, e))?
        .next()
        .ok_or_else(|| format!("Не найден IP для адреса {}", resolved_host_port))?;

    TcpStream::connect_timeout(&addr, Duration::from_secs(2))
        .map_err(|e| format!("Порт прокси недоступен ({}): {}", resolved_host_port, e))?;

    // HTTP test via reqwest proxy
    let reqwest_proxy = reqwest::Proxy::all(&normalized)
        .map_err(|e| format!("Не удалось настроить клиент прокси ({}): {}", normalized, e))?;

    let client = reqwest::Client::builder()
        .proxy(reqwest_proxy)
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(6))
        .build()
        .map_err(|e| format!("Ошибка создания HTTP-клиента: {}", e))?;

    let test_targets = [
        "https://api.github.com/zen",
        "https://cloudflare.com",
        "https://soundcloud.com",
        "https://www.google.com",
    ];

    let mut last_err = String::new();
    for target in test_targets {
        match client
            .get(target)
            .header("User-Agent", "Szhimatar/1.4")
            .send()
            .await
        {
            Ok(resp) => {
                if resp.status().is_success() || resp.status().is_redirection() {
                    return Ok(format!(
                        "Прокси работает корректно (подключение успешно проверено через {})",
                        target
                    ));
                } else {
                    last_err = format!("Сервер вернул статус HTTP {}", resp.status());
                }
            }
            Err(e) => {
                last_err = e.to_string();
            }
        }
    }

    Err(format!(
        "Порт прокси открыт ({}), но внешний тестовый запрос завершился ошибкой: {}",
        resolved_host_port, last_err
    ))
}

/// Parse macOS `scutil --nc list` output to extract connected VPN service names
pub fn parse_scutil_nc_vpn_names(stdout: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in stdout.lines() {
        let trimmed = line.trim();
        // Check for Connected state specifically in the line prefix status field
        // (e.g. "* (Connected)" or "(Connected)").
        // Avoid naive line-wide contains("Connected") which falsely triggers on disconnected
        // VPNs that happen to have "Connected" in their service name (e.g. "Office Connected")
        // or on "(Connecting)" state.
        let line_after_star = trimmed.strip_prefix('*').unwrap_or(trimmed).trim_start();
        if !line_after_star.to_ascii_lowercase().starts_with("(connected)") {
            continue;
        }

        // Extract quoted service name e.g. "Anywhere"
        if let Some(first_quote) = trimmed.find('"') {
            if let Some(last_quote) = trimmed.rfind('"') {
                if last_quote > first_quote {
                    let name = trimmed[first_quote + 1..last_quote].trim();
                    let clean = name.trim_matches('"').trim();
                    if !clean.is_empty() && !names.iter().any(|n: &String| n.eq_ignore_ascii_case(clean)) {
                        names.push(clean.to_string());
                        continue;
                    }
                }
            }
        }

        // Fallback: if no quotes, but line has VPN/IPSec/PPP markers
        if trimmed.contains("VPN") || trimmed.contains("IPSec") || trimmed.contains("PPP") {
            if let Some(bracket_start) = trimmed.find('[') {
                let before_bracket = trimmed[..bracket_start].trim();
                let parts: Vec<&str> = before_bracket.split_whitespace().collect();

                // Find index of VPN / IPSec / PPP token
                let kind_idx = parts.iter().position(|&p| {
                    let p_upper = p.to_ascii_uppercase();
                    p_upper == "VPN" || p_upper == "IPSEC" || p_upper == "PPP"
                });

                if let Some(idx) = kind_idx {
                    let mut name_tokens = Vec::new();
                    let mut start = idx + 1;
                    // Skip bundle identifier / subkind if in parentheses e.g. (com.tailscale)
                    if start < parts.len() && parts[start].starts_with('(') && parts[start].ends_with(')') {
                        start += 1;
                    }
                    for &t in &parts[start..] {
                        let cleaned = t.trim_matches(|c| c == '"' || c == '(' || c == ')' || c == '*');
                        if !cleaned.is_empty() {
                            name_tokens.push(cleaned);
                        }
                    }
                    if !name_tokens.is_empty() {
                        let full_name = name_tokens.join(" ");
                        if !names.iter().any(|n: &String| n.eq_ignore_ascii_case(&full_name)) {
                            names.push(full_name);
                            continue;
                        }
                    }
                }

                // Ultimate fallback to last token
                if let Some(last_token) = parts.last() {
                    let cleaned = last_token.trim_matches(|c| c == '"' || c == '(' || c == ')' || c == '*');
                    if !cleaned.is_empty() && !names.iter().any(|n: &String| n.eq_ignore_ascii_case(cleaned)) {
                        names.push(cleaned.to_string());
                    }
                }
            }
        }
    }
    names
}

/// Parse ifconfig tunnel interfaces (e.g. wg0, tailscale0)
pub fn parse_ifconfig_tunnel_interfaces(ifconfig_output: &str) -> Vec<String> {
    let mut tunnels = Vec::new();
    let keywords = ["wg", "tailscale", "tun", "tap", "ppp", "ipsec", "warp", "clash", "sing"];
    for iface in ifconfig_output.split_whitespace() {
        let lower = iface.to_lowercase();
        // Exclude internal Apple utun interfaces unless named tailscale/wg etc.
        if !lower.starts_with("utun") && keywords.iter().any(|k| lower.starts_with(k)) {
            tunnels.push(iface.to_string());
        }
    }
    tunnels.sort();
    tunnels.dedup();
    tunnels
}

/// Parse Windows `Get-NetAdapter` JSON output for active VPN adapters
pub fn parse_windows_vpn_adapters(json_str: &str) -> Vec<String> {
    let mut matches = Vec::new();
    let keywords = [
        "vpn",
        "wireguard",
        "wg",
        "openvpn",
        "tap",
        "tun",
        "wintun",
        "ppp",
        "pptp",
        "l2tp",
        "ikev2",
        "clash",
        "mihomo",
        "nordlynx",
        "mullvad",
        "proton",
        "outline",
        "cisco",
        "forticlient",
        "anyconnect",
        "zerotier",
        "tailscale",
        "hamachi",
        "anywhere",
        "amnezia",
        "sing-box",
        "singbox",
        "nekobox",
        "warp",
        "v2ray",
        "xray",
        "shadowsocks",
    ];

    let parse_adapter = |item: &serde_json::Value, acc: &mut Vec<String>| {
        let status = item
            .get("Status")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_lowercase();

        if status != "up" {
            return;
        }

        let name = item
            .get("Name")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let description = item
            .get("InterfaceDescription")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let haystack = format!("{} {}", name.to_lowercase(), description.to_lowercase());
        if keywords.iter().any(|k| haystack.contains(k)) {
            let label = if keywords.iter().any(|k| name.to_lowercase().contains(k)) && !name.is_empty() {
                name
            } else if !description.is_empty() {
                if !name.is_empty() {
                    format!("{} ({})", name, description)
                } else {
                    description
                }
            } else if !name.is_empty() {
                name
            } else {
                "VPN".to_string()
            };
            let clean = label.trim_matches('"').trim().to_string();
            if !acc.contains(&clean) {
                acc.push(clean);
            }
        }
    };

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(json_str) {
        if let Some(items) = json.as_array() {
            for item in items {
                parse_adapter(item, &mut matches);
            }
        } else if json.is_object() {
            parse_adapter(&json, &mut matches);
        }
    }

    matches.sort();
    matches.dedup();
    matches
}

/// Detect active VPN name on macOS
#[cfg(target_os = "macos")]
pub fn detect_active_vpn_name_macos() -> Option<String> {
    // 1. Check scutil --nc list for named VPN connections
    if let Ok(output) = std::process::Command::new("scutil").arg("--nc").arg("list").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let vpn_names = parse_scutil_nc_vpn_names(&stdout);
            if !vpn_names.is_empty() {
                return Some(vpn_names.join(", "));
            }
        }
    }

    // 2. Check third-party tunnel interfaces from ifconfig -l
    if let Ok(output) = std::process::Command::new("ifconfig").arg("-l").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let tunnels = parse_ifconfig_tunnel_interfaces(&stdout);
            if !tunnels.is_empty() {
                let formatted: Vec<String> = tunnels
                    .into_iter()
                    .map(|iface| {
                        let lower = iface.to_lowercase();
                        if lower.starts_with("wg") {
                            format!("WireGuard ({})", iface)
                        } else if lower.starts_with("tailscale") {
                            format!("Tailscale ({})", iface)
                        } else if lower.starts_with("warp") {
                            format!("Cloudflare WARP ({})", iface)
                        } else if lower.starts_with("clash") {
                            format!("Clash TUN ({})", iface)
                        } else if lower.starts_with("sing") {
                            format!("sing-box TUN ({})", iface)
                        } else if lower.starts_with("amnezia") {
                            format!("Amnezia VPN ({})", iface)
                        } else {
                            iface
                        }
                    })
                    .collect();
                return Some(formatted.join(", "));
            }
        }
    }

    None
}

/// Detect connected VPN adapter names on Windows using PowerShell Get-NetAdapter
#[cfg(windows)]
pub fn detect_vpn_adapters_windows() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let script = "$adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Select-Object Name, InterfaceDescription, Status; $adapters | ConvertTo-Json -Compress";

    let output = std::process::Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-Command", script])
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_windows_vpn_adapters(&stdout)
}

/// Detect active VPN name on Windows
#[cfg(windows)]
pub fn detect_active_vpn_name_windows() -> Option<String> {
    let adapters = detect_vpn_adapters_windows();
    if adapters.is_empty() {
        None
    } else {
        Some(adapters.join(", "))
    }
}

/// Detect active VPN name on Linux / Unix
#[cfg(not(any(target_os = "macos", windows)))]
pub fn detect_active_vpn_name_linux() -> Option<String> {
    if let Ok(entries) = std::fs::read_dir("/sys/class/net") {
        let keywords = ["tun", "tap", "wg", "tailscale", "ppp"];
        let mut matches = Vec::new();
        for entry in entries.flatten() {
            if let Ok(file_name) = entry.file_name().into_string() {
                let lower = file_name.to_lowercase();
                if keywords.iter().any(|k| lower.starts_with(k)) {
                    matches.push(file_name);
                }
            }
        }
        if !matches.is_empty() {
            matches.sort();
            matches.dedup();
            return Some(matches.join(", "));
        }
    }
    None
}

/// Detect active system VPN name across platforms
pub fn detect_active_vpn_name() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(name) = detect_active_vpn_name_macos() {
            return Some(name);
        }
    }

    #[cfg(windows)]
    {
        if let Some(name) = detect_active_vpn_name_windows() {
            return Some(name);
        }
    }

    #[cfg(not(any(target_os = "macos", windows)))]
    {
        if let Some(name) = detect_active_vpn_name_linux() {
            return Some(name);
        }
    }

    None
}

/// Detect active VPN interfaces on macOS (excluding internal Apple utun services)
#[cfg(target_os = "macos")]
pub fn detect_vpn_interfaces_macos() -> Vec<String> {
    let mut matches = Vec::new();

    // 1. Check scutil --nc list for connected VPN services
    if let Ok(output) = std::process::Command::new("scutil").arg("--nc").arg("list").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for name in parse_scutil_nc_vpn_names(&stdout) {
                matches.push(name);
            }
        }
    }

    // 2. Check third-party tunnel interfaces from ifconfig -l (excluding macOS internal utun)
    if let Ok(output) = std::process::Command::new("ifconfig").arg("-l").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for iface in parse_ifconfig_tunnel_interfaces(&stdout) {
                matches.push(iface);
            }
        }
    }

    matches.sort();
    matches.dedup();
    matches
}

/// Combined detection returning both proxy and active VPN information
pub fn detect_proxy_and_vpn() -> ProxyDetectionResult {
    let proxy = detect_system_or_local_proxy();
    let vpn_name = detect_active_vpn_name();
    ProxyDetectionResult { proxy, vpn_name }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_scutil_proxy_output_https() {
        let output = r#"
<dictionary> {
  HTTPEnable : 0
  HTTPSEnable : 1
  HTTPSPort : 7890
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 0
}
"#;
        let parsed = parse_scutil_proxy_output(output);
        assert!(parsed.is_some());
        let p = parsed.unwrap();
        assert_eq!(p.url, "http://127.0.0.1:7890");
        assert!(p.source.contains("HTTPS"));
    }

    #[test]
    fn test_parse_scutil_proxy_output_socks() {
        let output = r#"
<dictionary> {
  HTTPEnable : 0
  HTTPSEnable : 0
  SOCKSEnable : 1
  SOCKSPort : 10808
  SOCKSProxy : 127.0.0.1
}
"#;
        let parsed = parse_scutil_proxy_output(output);
        assert!(parsed.is_some());
        let p = parsed.unwrap();
        assert_eq!(p.url, "socks5://127.0.0.1:10808");
        assert!(p.source.contains("SOCKS"));
    }

    #[test]
    fn test_parse_scutil_proxy_output_disabled() {
        let output = r#"
<dictionary> {
  HTTPEnable : 0
  HTTPSEnable : 0
  SOCKSEnable : 0
}
"#;
        let parsed = parse_scutil_proxy_output(output);
        assert!(parsed.is_none());
    }

    #[test]
    fn test_parse_windows_proxy_server_simple() {
        let parsed = parse_windows_proxy_server("127.0.0.1:7890");
        assert!(parsed.is_some());
        assert_eq!(parsed.unwrap().url, "http://127.0.0.1:7890");
    }

    #[test]
    fn test_parse_windows_proxy_server_complex() {
        let server = "http=127.0.0.1:7890;https=127.0.0.1:7890;socks=127.0.0.1:7891";
        let parsed = parse_windows_proxy_server(server);
        assert!(parsed.is_some());
        let p = parsed.unwrap();
        assert_eq!(p.url, "http://127.0.0.1:7890");
    }

    #[test]
    fn test_parse_windows_proxy_server_socks_only() {
        let server = "socks=127.0.0.1:10808";
        let parsed = parse_windows_proxy_server(server);
        assert!(parsed.is_some());
        let p = parsed.unwrap();
        assert_eq!(p.url, "socks5://127.0.0.1:10808");
    }

    #[test]
    fn test_normalize_proxy_url() {
        assert_eq!(normalize_proxy_url(""), None);
        assert_eq!(normalize_proxy_url("   "), None);
        assert_eq!(
            normalize_proxy_url("127.0.0.1:7890"),
            Some("http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            normalize_proxy_url("http://127.0.0.1:7890"),
            Some("http://127.0.0.1:7890".to_string())
        );
        assert_eq!(
            normalize_proxy_url("socks5://127.0.0.1:10808"),
            Some("socks5://127.0.0.1:10808".to_string())
        );
        assert_eq!(
            normalize_proxy_url("\"http://127.0.0.1:7890\""),
            Some("http://127.0.0.1:7890".to_string())
        );
    }

    #[test]
    fn test_parse_scutil_nc_vpn_names_anywhere() {
        let scutil_output = r#"
Available network connection services in the current set (*=enabled):
* (Connected)      15E0AEA4-B987-4B16-8252-B267593272E5 VPN (com.argsment.Anywhere) "Anywhere"                       [VPN:com.argsment.Anywhere]
  (Disconnected)   F5F31346-608E-4547-814E-2A478EEAE49D VPN (com.wireguard.macos) "WireGuard"                        [VPN:com.wireguard.macos]
"#;
        let names = parse_scutil_nc_vpn_names(scutil_output);
        assert_eq!(names, vec!["Anywhere".to_string()]);
    }

    #[test]
    fn test_parse_scutil_nc_vpn_names_multiple_and_disconnected() {
        let scutil_output = r#"
Available network connection services in the current set (*=enabled):
* (Connected)      15E0AEA4-B987-4B16-8252-B267593272E5 VPN (com.argsment.Anywhere) "Anywhere"                       [VPN:com.argsment.Anywhere]
* (Connected)      4C06DFDF-5C28-4FF3-BD95-E5BF144F23D6 IPSec "Office Network"                                       [IPSec]
  (Disconnected)   F5F31346-608E-4547-814E-2A478EEAE49D VPN (com.wireguard.macos) "WireGuard"                        [VPN:com.wireguard.macos]
"#;
        let names = parse_scutil_nc_vpn_names(scutil_output);
        assert_eq!(names, vec!["Anywhere".to_string(), "Office Network".to_string()]);
    }

    #[test]
    fn test_parse_scutil_nc_vpn_names_fallback_unquoted() {
        let scutil_output = r#"
Available network connection services in the current set (*=enabled):
* (Connected)      15E0AEA4-B987-4B16-8252-B267593272E5 VPN Tailscale [VPN:com.tailscale]
"#;
        let names = parse_scutil_nc_vpn_names(scutil_output);
        assert_eq!(names, vec!["Tailscale".to_string()]);
    }

    #[test]
    fn test_parse_scutil_nc_vpn_names_none_connected() {
        let scutil_output = r#"
Available network connection services in the current set (*=enabled):
  (Disconnected)   15E0AEA4-B987-4B16-8252-B267593272E5 VPN (com.argsment.Anywhere) "Anywhere"                       [VPN:com.argsment.Anywhere]
"#;
        let names = parse_scutil_nc_vpn_names(scutil_output);
        assert!(names.is_empty());
    }

    #[test]
    fn test_parse_ifconfig_tunnel_interfaces() {
        let ifconfig_out = "lo0 gif0 stf0 en0 utun0 utun1 wg0 tailscale0 tun1 ap1";
        let tunnels = parse_ifconfig_tunnel_interfaces(ifconfig_out);
        assert_eq!(tunnels, vec!["tailscale0".to_string(), "tun1".to_string(), "wg0".to_string()]);
    }

    #[test]
    fn test_parse_windows_vpn_adapters_single() {
        let json = r#"
{
    "Name": "WireGuard",
    "InterfaceDescription": "WireGuard Tunnel",
    "Status": "Up"
}
"#;
        let adapters = parse_windows_vpn_adapters(json);
        assert_eq!(adapters, vec!["WireGuard".to_string()]);
    }

    #[test]
    fn test_parse_windows_vpn_adapters_array_and_down_status() {
        let json = r#"
[
    {
        "Name": "Ethernet",
        "InterfaceDescription": "Realtek Gaming 2.5GbE Family Controller",
        "Status": "Up"
    },
    {
        "Name": "Tailscale",
        "InterfaceDescription": "Tailscale Tunnel",
        "Status": "Up"
    },
    {
        "Name": "WireGuard",
        "InterfaceDescription": "WireGuard Tunnel",
        "Status": "Down"
    },
    {
        "Name": "Ethernet 2",
        "InterfaceDescription": "TAP-Windows Adapter V9",
        "Status": "Up"
    }
]
"#;
        let adapters = parse_windows_vpn_adapters(json);
        assert_eq!(adapters, vec![
            "Ethernet 2 (TAP-Windows Adapter V9)".to_string(),
            "Tailscale".to_string(),
        ]);
    }

    #[test]
    fn test_proxy_detection_result_serialization() {
        let res = ProxyDetectionResult {
            proxy: Some(DetectedProxy {
                url: "http://127.0.0.1:7890".to_string(),
                source: "Clash".to_string(),
            }),
            vpn_name: Some("Anywhere".to_string()),
        };

        let json = serde_json::to_string(&res).expect("serialization failed");
        assert!(json.contains("\"vpnName\":\"Anywhere\""));
        assert!(json.contains("\"url\":\"http://127.0.0.1:7890\""));

        // Test deserialization with camelCase
        let deserialized: ProxyDetectionResult = serde_json::from_str(&json).expect("deserialization failed");
        assert_eq!(deserialized.vpn_name, Some("Anywhere".to_string()));

        // Test deserialization with snake_case
        let snake_json = r#"{"proxy":null,"vpn_name":"Anywhere"}"#;
        let deserialized_snake: ProxyDetectionResult = serde_json::from_str(snake_json).expect("snake deserialization failed");
        assert_eq!(deserialized_snake.vpn_name, Some("Anywhere".to_string()));
    }

    #[test]
    fn test_parse_scutil_nc_vpn_names_disconnected_with_connected_in_name() {
        let scutil_output = r#"
Available network connection services in the current set (*=enabled):
  (Disconnected)   F5F31346-608E-4547-814E-2A478EEAE49D VPN (com.wireguard.macos) "Office Connected"                        [VPN:com.wireguard.macos]
  (Disconnected)   15E0AEA4-B987-4B16-8252-B267593272E5 VPN (com.stayconnected) "Stay Connected"                           [VPN:com.stayconnected]
"#;
        let names = parse_scutil_nc_vpn_names(scutil_output);
        assert!(names.is_empty(), "Disconnected VPNs must not be parsed as connected even if 'Connected' is in name");
    }

    #[test]
    fn test_parse_scutil_nc_vpn_names_connecting_state_ignored() {
        let scutil_output = r#"
Available network connection services in the current set (*=enabled):
* (Connecting)     15E0AEA4-B987-4B16-8252-B267593272E5 VPN (com.argsment.Anywhere) "Anywhere"                       [VPN:com.argsment.Anywhere]
"#;
        let names = parse_scutil_nc_vpn_names(scutil_output);
        assert!(names.is_empty(), "(Connecting) state is not yet connected");
    }

    #[test]
    fn test_parse_scutil_nc_vpn_names_unquoted_multi_word() {
        let scutil_output = r#"
Available network connection services in the current set (*=enabled):
* (Connected)      15E0AEA4-B987-4B16-8252-B267593272E5 VPN (com.corp.vpn) Corporate Secure Network [VPN:com.corp.vpn]
"#;
        let names = parse_scutil_nc_vpn_names(scutil_output);
        assert_eq!(names, vec!["Corporate Secure Network".to_string()]);
    }

    #[test]
    fn test_parse_windows_vpn_adapters_anywhere_and_amnezia() {
        let json = r#"
[
    {
        "Name": "Anywhere",
        "InterfaceDescription": "Anywhere VPN Adapter",
        "Status": "Up"
    },
    {
        "Name": "AmneziaVPN",
        "InterfaceDescription": "Amnezia WireGuard Tunnel",
        "Status": "Up"
    }
]
"#;
        let adapters = parse_windows_vpn_adapters(json);
        assert_eq!(adapters, vec!["AmneziaVPN".to_string(), "Anywhere".to_string()]);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn test_macos_live_vpn_detection() {
        let res = detect_proxy_and_vpn();
        println!("Live detect_proxy_and_vpn result: {:?}", res);
        let vpn_opt = detect_active_vpn_name_macos();
        assert_eq!(res.vpn_name, vpn_opt);
    }
}
