// Empirical Challenger Test Harness for Milestone 1 (macOS Hardware Detection)
// Evaluates all edge cases, corner cases, and stress vectors on CPU & VideoToolbox detection.

use std::process::Command;

// Exact mirror of parse_cpu_brand_string from src-tauri/src/main.rs
fn parse_cpu_brand_string(brand: &str) -> (&'static str, &str) {
    let trimmed = brand.trim();
    if trimmed.is_empty() {
        return ("unknown", trimmed);
    }
    let lower = trimmed.to_lowercase();
    if lower.contains("apple") || lower.contains("virtualapple") {
        ("apple", trimmed)
    } else if lower.contains("intel") {
        ("intel", trimmed)
    } else if lower.contains("amd") {
        ("amd", trimmed)
    } else {
        ("unknown", trimmed)
    }
}

// Exact mirror of summarize_for_log from src-tauri/src/main.rs
fn summarize_for_log(input: &str, max_len: usize) -> String {
    let compact = input.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.len() <= max_len {
        compact
    } else {
        format!("{}...", &compact[..max_len])
    }
}

// Simulated macOS detect_cpu_vendor logic on a mock sysctl output
fn simulate_detect_cpu_vendor(sysctl_success: bool, raw_stdout: &str) -> (String, String) {
    if sysctl_success {
        let (vendor, brand) = parse_cpu_brand_string(raw_stdout);
        if vendor != "unknown" {
            return (vendor.to_string(), brand.to_string());
        } else if !brand.is_empty() {
            return (
                "unknown".to_string(),
                format!(
                    "sysctl machdep.cpu.brand_string unmatched: '{}'",
                    summarize_for_log(brand, 180)
                ),
            );
        }
    }

    (
        "unknown".to_string(),
        "sysctl machdep.cpu.brand_string failed".to_string(),
    )
}

// Simulated GPU compatibility detection logic for macOS and non-macOS
fn simulate_check_gpu_compatibility(stdout_raw: &str, is_macos: bool) -> bool {
    let stdout = stdout_raw.to_lowercase();
    if is_macos {
        stdout.contains("h264_videotoolbox")
            || stdout.contains("hevc_videotoolbox")
            || stdout.contains("videotoolbox")
    } else {
        stdout.contains("nvenc")
    }
}

fn main() {
    println!("============================================================");
    println!("Milestone 1 Empirical Stress Test & Adversarial Verification");
    println!("============================================================");
    let mut total_tests = 0;
    let mut passed_tests = 0;

    macro_rules! check {
        ($desc:expr, $cond:expr) => {
            total_tests += 1;
            if $cond {
                passed_tests += 1;
                println!("  [PASS] {}", $desc);
            } else {
                println!("  [FAIL] {}", $desc);
                panic!("Assertion failed: {}", $desc);
            }
        };
    }

    // ------------------------------------------------------------------------
    // Group 1: Malformed & Empty CPU Inputs
    // ------------------------------------------------------------------------
    println!("\n--- Group 1: Malformed & Empty CPU Inputs ---");
    {
        let (vendor, brand) = parse_cpu_brand_string("");
        check!("Empty string returns unknown", vendor == "unknown" && brand == "");

        let (vendor, brand) = parse_cpu_brand_string("   ");
        check!("Spaces only returns unknown", vendor == "unknown" && brand == "");

        let (vendor, brand) = parse_cpu_brand_string("\t\n\r  \n");
        check!("Whitespace/newlines only returns unknown", vendor == "unknown" && brand == "");

        let (vendor, _brand) = parse_cpu_brand_string("\0\0\0");
        check!("Nul bytes handled safely", vendor == "unknown");

        let res = simulate_detect_cpu_vendor(false, "");
        check!("Sysctl failure returns fallback reason", res.0 == "unknown" && res.1 == "sysctl machdep.cpu.brand_string failed");

        let res = simulate_detect_cpu_vendor(true, "");
        check!("Empty sysctl stdout returns fallback reason", res.0 == "unknown" && res.1 == "sysctl machdep.cpu.brand_string failed");

        let res = simulate_detect_cpu_vendor(true, "   \n\t  ");
        check!("Whitespace sysctl stdout returns fallback reason", res.0 == "unknown" && res.1 == "sysctl machdep.cpu.brand_string failed");
    }

    // ------------------------------------------------------------------------
    // Group 2: Whitespace & Newline Variations
    // ------------------------------------------------------------------------
    println!("\n--- Group 2: Whitespace & Newline Variations ---");
    {
        let (vendor, brand) = parse_cpu_brand_string("  Apple M1  ");
        check!("Leading/trailing spaces trimmed", vendor == "apple" && brand == "Apple M1");

        let (vendor, brand) = parse_cpu_brand_string("\tApple M2 Pro\n");
        check!("Tab and trailing newline trimmed", vendor == "apple" && brand == "Apple M2 Pro");

        let (vendor, brand) = parse_cpu_brand_string("\r\n  Apple M3 Max  \r\n");
        check!("CRLF and spaces trimmed", vendor == "apple" && brand == "Apple M3 Max");

        let (vendor, brand) = parse_cpu_brand_string("   Apple M4 Ultra \n\n");
        check!("Multiple trailing newlines trimmed", vendor == "apple" && brand == "Apple M4 Ultra");
    }

    // ------------------------------------------------------------------------
    // Group 3: Case Sensitivity Tests
    // ------------------------------------------------------------------------
    println!("\n--- Group 3: Case Sensitivity Tests ---");
    {
        let (vendor, brand) = parse_cpu_brand_string("apple m1");
        check!("All lowercase 'apple m1'", vendor == "apple" && brand == "apple m1");

        let (vendor, brand) = parse_cpu_brand_string("APPLE M2 MAX");
        check!("All uppercase 'APPLE M2 MAX'", vendor == "apple" && brand == "APPLE M2 MAX");

        let (vendor, brand) = parse_cpu_brand_string("aPplE m3 uLtRa");
        check!("Mixed case 'aPplE m3 uLtRa'", vendor == "apple" && brand == "aPplE m3 uLtRa");

        let (vendor, brand) = parse_cpu_brand_string("Apple M4");
        check!("Standard title case 'Apple M4'", vendor == "apple" && brand == "Apple M4");
    }

    // ------------------------------------------------------------------------
    // Group 4: Rosetta 2 CPU Strings
    // ------------------------------------------------------------------------
    println!("\n--- Group 4: Rosetta 2 CPU Strings ---");
    {
        let (vendor, brand) = parse_cpu_brand_string("VirtualApple @ 2.50GHz");
        check!("Standard Rosetta 2 string", vendor == "apple" && brand == "VirtualApple @ 2.50GHz");

        let (vendor, brand) = parse_cpu_brand_string("virtualapple @ 3.20GHz\n");
        check!("Lowercase Rosetta 2 with newline", vendor == "apple" && brand == "virtualapple @ 3.20GHz");

        let (vendor, brand) = parse_cpu_brand_string("  VIRTUALAPPLE @ 2.00GHz  ");
        check!("Uppercase Rosetta 2 with padding", vendor == "apple" && brand == "VIRTUALAPPLE @ 2.00GHz");
    }

    // ------------------------------------------------------------------------
    // Group 5: Intel Mac & AMD Hackintosh Brands
    // ------------------------------------------------------------------------
    println!("\n--- Group 5: Intel Mac & AMD Hackintosh Brands ---");
    {
        let (vendor, brand) = parse_cpu_brand_string("Intel(R) Core(TM) i9-9980HK CPU @ 2.40GHz");
        check!("Intel Core i9 Mac", vendor == "intel" && brand == "Intel(R) Core(TM) i9-9980HK CPU @ 2.40GHz");

        let (vendor, brand) = parse_cpu_brand_string("Intel(R) Xeon(R) W-3275M CPU @ 2.50GHz");
        check!("Intel Mac Pro Xeon", vendor == "intel" && brand == "Intel(R) Xeon(R) W-3275M CPU @ 2.50GHz");

        let (vendor, _brand) = parse_cpu_brand_string("INTEL(R) CORE(TM) I7-8700B CPU @ 3.20GHZ");
        check!("Intel uppercase", vendor == "intel");

        let (vendor, brand) = parse_cpu_brand_string("AMD Ryzen 9 5950X");
        check!("AMD Ryzen Hackintosh", vendor == "amd" && brand == "AMD Ryzen 9 5950X");

        let (vendor, _brand) = parse_cpu_brand_string("amd ryzen 7 3700x 8-core processor");
        check!("AMD lowercase Hackintosh", vendor == "amd");
    }

    // ------------------------------------------------------------------------
    // Group 6: Unrecognized & Bizarre CPU Strings
    // ------------------------------------------------------------------------
    println!("\n--- Group 6: Unrecognized & Bizarre CPU Strings ---");
    {
        let (vendor, brand) = parse_cpu_brand_string("QuantumSuperChip 9000");
        check!("Unrecognized brand vendor unknown", vendor == "unknown" && brand == "QuantumSuperChip 9000");

        let res = simulate_detect_cpu_vendor(true, "QuantumSuperChip 9000");
        check!("Unrecognized brand formatted in reason", res.0 == "unknown" && res.1.contains("QuantumSuperChip 9000"));

        let (vendor, brand) = parse_cpu_brand_string("RISC-V StarFive JH7110");
        check!("RISC-V brand unknown", vendor == "unknown" && brand == "RISC-V StarFive JH7110");

        let (vendor, _) = parse_cpu_brand_string("Loongson 3A5000");
        check!("Loongson brand unknown", vendor == "unknown");

        let (vendor, brand) = parse_cpu_brand_string("🍎 Apple M1 Max 🚀");
        check!("Unicode emoji brand recognized", vendor == "apple" && brand == "🍎 Apple M1 Max 🚀");

        let injection_str = "Apple M1\"; rm -rf /; <script>alert(1)</script>";
        let (vendor, brand) = parse_cpu_brand_string(injection_str);
        check!("Injection payload does not panic and extracts brand", vendor == "apple" && brand == injection_str);

        // Very long string truncation in reason
        let long_str = "UnrecognizedBrand ".repeat(100);
        let res = simulate_detect_cpu_vendor(true, &long_str);
        check!("Long unrecognized brand truncated in reason", res.0 == "unknown" && res.1.len() <= 250 && res.1.ends_with("...'"));
    }

    // ------------------------------------------------------------------------
    // Group 7: VideoToolbox Matching on macOS
    // ------------------------------------------------------------------------
    println!("\n--- Group 7: VideoToolbox Matching on macOS ---");
    {
        let normal_ffmpeg = "
Encoders:
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)
 V..... hevc_videotoolbox    VideoToolbox H.265 Encoder (codec hevc)
        ";
        check!("Normal FFmpeg output detected", simulate_check_gpu_compatibility(normal_ffmpeg, true));

        let only_h264 = "Encoders:\n V..... h264_videotoolbox VideoToolbox H.264 Encoder\n";
        check!("Only h264_videotoolbox detected", simulate_check_gpu_compatibility(only_h264, true));

        let only_hevc = "Encoders:\n V..... hevc_videotoolbox VideoToolbox H.265 Encoder\n";
        check!("Only hevc_videotoolbox detected", simulate_check_gpu_compatibility(only_hevc, true));

        let uppercase_enc = "Encoders:\n V..... H264_VIDEOTOOLBOX Apple HW Encoder\n";
        check!("Uppercase encoder name detected", simulate_check_gpu_compatibility(uppercase_enc, true));

        let prores_only = "Encoders:\n V..... prores_videotoolbox VideoToolbox ProRes Encoder\n";
        check!("ProRes videotoolbox detected via 'videotoolbox' substring", simulate_check_gpu_compatibility(prores_only, true));

        let no_videotoolbox = "Encoders:\n V..... libx264 H.264 / AVC\n V..... libx265 H.265 / HEVC\n";
        check!("Software-only encoders detected as false", !simulate_check_gpu_compatibility(no_videotoolbox, true));

        let empty_output = "";
        check!("Empty encoder output detected as false", !simulate_check_gpu_compatibility(empty_output, true));
    }

    // ------------------------------------------------------------------------
    // Group 8: Non-macOS NVENC Preservation
    // ------------------------------------------------------------------------
    println!("\n--- Group 8: Non-macOS NVENC Preservation ---");
    {
        let nvenc_output = "
Encoders:
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... hevc_nvenc           NVIDIA NVENC hevc encoder (codec hevc)
        ";
        check!("NVENC output on Windows detected as true", simulate_check_gpu_compatibility(nvenc_output, false));

        let macos_output_on_windows = "Encoders:\n V..... h264_videotoolbox VideoToolbox H.264\n";
        check!("VideoToolbox output on Windows detected as false (NVENC required)", !simulate_check_gpu_compatibility(macos_output_on_windows, false));

        let nvenc_output_on_macos = "Encoders:\n V..... h264_nvenc NVIDIA NVENC H.264\n";
        check!("NVENC output on macOS detected as false (VideoToolbox required)", !simulate_check_gpu_compatibility(nvenc_output_on_macos, true));

        let dual_output = "
Encoders:
 V..... h264_nvenc           NVIDIA NVENC H.264 encoder
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder
        ";
        check!("Dual encoders on macOS matches VideoToolbox", simulate_check_gpu_compatibility(dual_output, true));
        check!("Dual encoders on Windows matches NVENC", simulate_check_gpu_compatibility(dual_output, false));
    }

    // ------------------------------------------------------------------------
    // Group 9: Live Host System Execution
    // ------------------------------------------------------------------------
    println!("\n--- Group 9: Live Host System Execution ---");
    {
        let sysctl_out = Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .expect("sysctl command should execute");
        check!("Live sysctl status is success", sysctl_out.status.success());
        let live_brand = String::from_utf8_lossy(&sysctl_out.stdout);
        let (live_vendor, live_parsed_brand) = parse_cpu_brand_string(&live_brand);
        println!("  -> Live CPU Vendor: '{}', Brand: '{}'", live_vendor, live_parsed_brand);
        check!("Live vendor is apple", live_vendor == "apple");
        check!("Live brand contains Apple M", live_parsed_brand.contains("Apple M"));

        let ffmpeg_out = Command::new("ffmpeg")
            .args(["-hide_banner", "-encoders"])
            .output()
            .expect("ffmpeg command should execute");
        check!("Live ffmpeg status is success", ffmpeg_out.status.success());
        let ffmpeg_stdout = String::from_utf8_lossy(&ffmpeg_out.stdout);
        let macos_compat = simulate_check_gpu_compatibility(&ffmpeg_stdout, true);
        check!("Live macOS ffmpeg reports VideoToolbox available", macos_compat);
    }

    println!("\n============================================================");
    println!("ALL EMPIRICAL TESTS PASSED: {}/{}", passed_tests, total_tests);
    println!("============================================================");
}
