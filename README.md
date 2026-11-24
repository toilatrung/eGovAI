# eGovAI

Ứng dụng desktop (Electron + React) giao diện Tiếng Việt cho Google Antigravity, hướng tới cán bộ cơ quan nhà nước: trò chuyện với AI, xử lý tài liệu (Word/Excel), điều khiển máy tính có kiểm soát, ghi nhật ký kiểm toán và bảo vệ dữ liệu mật.

## Tải về

Trang giới thiệu: **https://egovai.vercel.app**

Hoặc xem trang [Releases](../../releases) — tải `eGovAI-Setup-<phiên bản>.exe` (Windows 10/11, 64-bit).

> Windows 11 Smart App Control chặn bản chưa ký số. Xem [docs/code-signing.md](docs/code-signing.md) để biết lý do, cách ký số khi đóng gói và lưu ý cho người dùng.

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

## Phát hành phiên bản mới

1. Tăng `version` trong `package.json` (ví dụ `0.2.0`).
2. Viết ghi chú vào `docs/releases/v0.2.0.md`.
3. Commit, rồi chạy:

   ```powershell
   pnpm release
   ```

Script [`scripts/release.ps1`](scripts/release.ps1) chạy kiểm thử, đóng gói bộ cài, tính SHA-256, tạo tag, đẩy lên GitHub và tạo Release kèm bộ cài. Mặc định script bắt buộc bộ cài phải được ký số hợp lệ — cấu hình chứng thư theo [docs/code-signing.md](docs/code-signing.md) (hoặc thêm `-AllowUnsigned`).

## Trang giới thiệu

Mã nguồn ở `site/` (HTML tĩnh), deploy lên Vercel (project `egovai`):

```powershell
cd site
npx.cmd vercel deploy --prod
```

Nút tải tự lấy bộ cài từ bản phát hành mới nhất trên GitHub, nên không cần deploy lại khi ra phiên bản mới.

## Cấu trúc

- `src/main` — tiến trình chính Electron (agent, dịch vụ: kiểm toán, phân loại mật, computer use, tài liệu, lập lịch…)
- `src/preload` — cầu nối IPC
- `src/renderer` — giao diện React
- `src/shared` — kiểu dùng chung
- `installer` — mã nguồn bộ cài/gỡ cài (C#/WPF) và script đóng gói
- `site` — trang giới thiệu (Vercel)
- `design` — logo, thiết kế
- `tests` — kiểm thử vitest

## Giấy phép

MIT
