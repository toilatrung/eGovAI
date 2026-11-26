<div align="center">

<img src="design/egovai-mark.svg" alt="eGovAI" width="112" height="112" />

# eGovAI

**Trợ lý AI trên máy tính, giao diện Tiếng Việt, dành cho cán bộ cơ quan nhà nước**

Soạn văn bản hành chính đúng thể thức, xử lý tài liệu Word/Excel/PDF, tra cứu và thao tác trên máy có kiểm soát —
chạy trên lõi Google Antigravity chính thức.

[![Phiên bản](https://img.shields.io/github/v/release/toilatrung/eGovAI?label=phi%C3%AAn%20b%E1%BA%A3n&color=B3121B)](https://github.com/toilatrung/eGovAI/releases/latest)
[![Nền tảng](https://img.shields.io/badge/Windows-10%20%7C%2011%20(64--bit)-0078D4)](https://github.com/toilatrung/eGovAI/releases/latest)
[![Giấy phép](https://img.shields.io/badge/gi%E1%BA%A5y%20ph%C3%A9p-MIT-F2C230)](LICENSE)
[![Ký số](https://img.shields.io/badge/k%C3%BD%20s%E1%BB%91-SignPath-2E7D32)](#code-signing-policy)

[**Tải về**](https://egovai.vercel.app) · [Bản phát hành](https://github.com/toilatrung/eGovAI/releases) · [Ghi chú phiên bản](docs/releases) · [Ký số bộ cài](docs/code-signing.md)

</div>

---

## Mục lục

- [Tính năng chính](#tính-năng-chính)
- [Cài đặt](#cài-đặt)
- [Phát triển](#phát-triển)
- [Cấu trúc mã nguồn](#cấu-trúc-mã-nguồn)
- [Phát hành phiên bản mới](#phát-hành-phiên-bản-mới)
- [Code signing policy](#code-signing-policy)
- [Privacy policy](#privacy-policy)
- [Giấy phép](#giấy-phép)

## Tính năng chính

| | Tính năng | Mô tả |
|:-:|---|---|
| 📝 | **Soạn văn bản hành chính** | Công văn, tờ trình, báo cáo, kế hoạch, quyết định… theo thể thức Nghị định 30/2020/NĐ-CP; xem trực tiếp ở tab Tài liệu và xuất Word (.docx). |
| 🗂️ | **Kế hoạch soạn nhiều văn bản** | Lập danh sách văn bản cần soạn cho một đầu việc, kiểm tra rồi soạn lần lượt hoặc soạn tất cả. |
| 📊 | **Xử lý tài liệu** | Đọc, tóm tắt, đối chiếu tệp Word, Excel, PDF trong thư mục dự án. |
| 🌐 | **Tra cứu trên web** | Trình duyệt tích hợp ngay trong ứng dụng; câu trả lời ghi rõ nguồn để kiểm chứng. |
| 🖱️ | **Điều khiển máy tính có kiểm soát** | AI thao tác ứng dụng và trình duyệt trên máy; thao tác xóa hoặc nhập dữ liệu luôn hỏi cán bộ phê duyệt. |
| 🧩 | **Kho kỹ năng (SOP)** | Chọn quy trình nghiệp vụ chuẩn để AI làm theo từng bước. |
| ⏰ | **Tác vụ định kỳ** | Lên lịch các việc lặp lại (tổng hợp, báo cáo) chạy tự động. |
| 🛡️ | **Bảo vệ dữ liệu** | Nhật ký kiểm toán lưu trên máy, chặn gửi tài liệu mật, kiểm soát việc mở tệp và đường dẫn. |
| ⚡ | **Chế độ AI Nhanh / Cân bằng / Chuyên sâu** | Chọn theo độ khó công việc; khi máy chủ mô hình quá tải, ứng dụng tự chuyển sang mô hình dự phòng thay vì chờ thử lại. |
| 🔄 | **Tự cập nhật** | Kiểm tra và cài bản mới từ GitHub Releases. |

## Cài đặt

1. Tải bộ cài `eGovAI-Setup-<phiên bản>.exe` tại **[egovai.vercel.app](https://egovai.vercel.app)** hoặc trang [Releases](https://github.com/toilatrung/eGovAI/releases/latest).
2. Chạy bộ cài (Windows 10/11, 64-bit). Lõi AI `agy.exe` đã được đóng gói sẵn.
3. Mở eGovAI, đăng nhập tài khoản Google và chọn thư mục dự án để bắt đầu.

> [!NOTE]
> Windows 11 Smart App Control có thể chặn bản chưa ký số. Xem [docs/code-signing.md](docs/code-signing.md) để biết lý do và cách xử lý.

## Phát triển

**Yêu cầu:** Node.js 20+, pnpm, Windows 10/11. Đóng gói bộ cài cần thêm .NET Framework 4.x (`csc.exe`).

```powershell
pnpm install
pnpm dev          # chạy chế độ phát triển
pnpm test         # kiểm thử (vitest)
pnpm typecheck    # kiểm tra kiểu TypeScript
pnpm build        # build vào out/
pnpm package      # đóng gói bộ cài vào dist/
```

Chạy nhanh bản đã build: `scripts\start-egovai.cmd`.

**Công nghệ:** Electron 35 · React 19 · TypeScript · Zustand · Tailwind CSS 4 · electron-vite · Vitest.

## Cấu trúc mã nguồn

Tiến trình chính được chia thành các **service** độc lập theo miền nghiệp vụ. Mỗi service sở hữu dữ liệu và logic của mình; `src/main/index.ts` chỉ làm nhiệm vụ điều phối (đăng ký IPC, vòng đời cửa sổ).

```text
eGovAI/
├── src/
│   ├── main/                     # Tiến trình chính Electron
│   │   ├── index.ts              # Điều phối: IPC, cửa sổ, khởi tạo service
│   │   └── services/
│   │       ├── agent/            # Lõi agy.exe: phiên chạy, đọc luồng sự kiện, chuyển mô hình khi quá tải
│   │       ├── document/         # Đọc Word/Excel/PDF, xuất .docx, bản nháp, thư mục làm việc AI
│   │       ├── desktop/          # MCP egovai-desktop, điều khiển máy, chụp màn hình, phê duyệt
│   │       ├── browser/          # Trình duyệt tích hợp, Playwright dự phòng
│   │       ├── security/         # Nhật ký kiểm toán, chặn tài liệu mật, kiểm soát đường dẫn
│   │       ├── workspace/        # Dự án, lưu trữ, cấu hình, kỹ năng, Git, terminal
│   │       ├── scheduler/        # Tác vụ định kỳ
│   │       └── update/           # Kiểm tra & cài bản mới
│   ├── preload/                  # Cầu nối IPC an toàn (window.googleAI)
│   ├── renderer/                 # Giao diện React (components, stores, utils, i18n)
│   └── shared/                   # Kiểu dữ liệu & logic dùng chung main/renderer
├── tests/                        # Kiểm thử Vitest
├── installer/                    # Bộ cài/gỡ cài (C#/WPF) và script đóng gói
├── scripts/                      # Phát hành, khởi chạy nhanh
├── docs/                         # Tài liệu, ghi chú phát hành
├── design/                       # Logo, tài nguyên thiết kế
├── site/                         # Trang giới thiệu (HTML tĩnh, Vercel)
└── .github/workflows/            # CI: build & ký số bộ cài
```

**Quy ước:**

- Service chỉ gọi nhau qua hàm/kiểu được export; không truy cập trạng thái nội bộ của service khác.
- Kiểu dữ liệu đi qua IPC đặt ở `src/shared/types.ts`, dùng chung cho cả main và renderer.
- Mỗi thay đổi logic cần có kiểm thử tương ứng trong `tests/`.

## Phát hành phiên bản mới

1. Tăng `version` trong `package.json`.
2. Viết ghi chú vào `docs/releases/v<phiên bản>.md`.
3. Commit, rồi chạy:

   ```powershell
   pnpm release
   ```

Script [`scripts/release.ps1`](scripts/release.ps1) chạy kiểm thử, đóng gói bộ cài, tính SHA-256, tạo tag, đẩy lên GitHub và tạo Release kèm bộ cài. Mặc định script yêu cầu bộ cài được ký số hợp lệ — cấu hình theo [docs/code-signing.md](docs/code-signing.md) (hoặc thêm `-AllowUnsigned`).

Trang giới thiệu ở `site/` deploy lên Vercel bằng `npx vercel deploy --prod` trong thư mục `site`. Nút tải tự lấy bộ cài từ bản phát hành mới nhất nên không cần deploy lại khi ra phiên bản mới.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

Bộ cài được build và ký trên GitHub Actions ([.github/workflows/release.yml](.github/workflows/release.yml)) từ mã nguồn trong kho này.

- Committers and reviewers: [thành viên của kho](https://github.com/toilatrung/eGovAI/graphs/contributors)
- Approvers: [toilatrung](https://github.com/toilatrung)

Mỗi yêu cầu ký đều phải được Approver phê duyệt thủ công trên SignPath. Các tệp do bên thứ ba phát hành đã có chữ ký riêng (ví dụ `agy.exe` của Google, `d3dcompiler_47.dll` của Microsoft) được giữ nguyên chữ ký gốc, không ký lại.

## Privacy policy

eGovAI không tự gửi dữ liệu người dùng đi đâu, trừ các trường hợp sau:

- Nội dung trò chuyện, tệp đính kèm và yêu cầu người dùng gửi cho AI được chuyển tới dịch vụ Google Antigravity thông qua lõi `agy.exe`, theo điều khoản của Google.
- Khi khởi động, ứng dụng gọi GitHub API (`api.github.com/repos/toilatrung/eGovAI/releases/latest`, không kèm thông tin cá nhân) để kiểm tra phiên bản mới.
- Trình duyệt tích hợp chỉ truy cập các trang mà người dùng (hoặc AI theo yêu cầu của người dùng) mở.

Nhật ký kiểm toán và cài đặt được lưu cục bộ trên máy.

## Giấy phép

Phát hành theo [Giấy phép MIT](LICENSE).
