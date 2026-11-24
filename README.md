# eGovAI

Ứng dụng desktop (Electron + React) giao diện Tiếng Việt cho Google Antigravity, hướng tới cán bộ cơ quan nhà nước: trò chuyện với AI, xử lý tài liệu (Word/Excel), điều khiển máy tính có kiểm soát, ghi nhật ký kiểm toán và bảo vệ dữ liệu mật.

## Tải về

Xem trang [Releases](../../releases) — tải `eGovAI-Setup-<phiên bản>.exe` (Windows 10/11, 64-bit).

## Phát triển

Yêu cầu: Node.js 20+, pnpm.

```powershell
pnpm install
pnpm dev          # chạy chế độ phát triển
pnpm test         # chạy kiểm thử (vitest)
pnpm typecheck    # kiểm tra kiểu TypeScript
pnpm build        # build vào out/
pnpm package      # đóng gói bộ cài vào dist/ (cần .NET Framework 4.x csc.exe)
```

## Cấu trúc

- `src/main` — tiến trình chính Electron (agent, dịch vụ: kiểm toán, phân loại mật, computer use, tài liệu, lập lịch…)
- `src/preload` — cầu nối IPC
- `src/renderer` — giao diện React
- `src/shared` — kiểu dùng chung
- `installer` — mã nguồn bộ cài/gỡ cài (C#/WPF) và script đóng gói
- `design` — logo, thiết kế
- `tests` — kiểm thử vitest

## Giấy phép

MIT
