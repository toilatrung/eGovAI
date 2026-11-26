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

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Bộ cài được build và ký trên GitHub Actions ([.github/workflows/release.yml](.github/workflows/release.yml)) từ mã nguồn trong kho này.

- Committers and reviewers: [thành viên của kho](https://github.com/toilatrung/eGovAI/graphs/contributors)
- Approvers: [toilatrung](https://github.com/toilatrung)

Mỗi yêu cầu ký đều phải được Approver phê duyệt thủ công trên SignPath.

Các tệp do bên thứ ba phát hành đã có chữ ký riêng (ví dụ `agy.exe` của Google, `d3dcompiler_47.dll` của Microsoft) được giữ nguyên chữ ký gốc, không ký lại.

## Privacy policy

eGovAI không tự gửi dữ liệu người dùng đi đâu, trừ các trường hợp sau:

- Nội dung trò chuyện, tệp đính kèm và yêu cầu người dùng gửi cho AI được chuyển tới dịch vụ Google Antigravity thông qua lõi `agy.exe`, theo điều khoản của Google.
- Khi khởi động, ứng dụng gọi GitHub API (`api.github.com/repos/toilatrung/eGovAI/releases/latest`, không kèm thông tin cá nhân) để kiểm tra phiên bản mới.
- Trình duyệt tích hợp chỉ truy cập các trang mà người dùng (hoặc AI theo yêu cầu của người dùng) mở.

Nhật ký kiểm toán và cài đặt được lưu cục bộ trên máy.

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
