# Ký số bộ cài eGovAI (Smart App Control / SmartScreen)

> Các mục đánh dấu **(cần xác nhận)** là thông tin về chính sách, giá hoặc điều kiện của bên thứ ba có thể đã thay đổi. Hãy kiểm tra lại trên trang chính thức trước khi quyết định.

## 1. Vì sao Windows 11 chặn eGovAI

Smart App Control (SAC) trên Windows 11 chỉ cho chạy một tệp thực thi (`.exe`, `.dll`, `.node`…) khi thỏa **một** trong hai điều kiện:

1. Tệp được dịch vụ đám mây của Microsoft đánh giá là an toàn (đã có "danh tiếng" — rất nhiều người dùng chạy mà không có vấn đề); hoặc
2. Tệp được **ký số Authenticode** bằng chứng thư hợp lệ, xâu chuỗi tới một CA gốc nằm trong Microsoft Trusted Root Program.

Một ứng dụng mới, ít người dùng như eGovAI không có (1), và các bản build trước đây không có chữ ký nên cũng không có (2). Thêm nữa, `eGovAI.exe` là `electron.exe` đổi tên và đổi biểu tượng — việc sửa tài nguyên làm mất chữ ký gốc (nếu có), và các DLL như `ffmpeg.dll`, `libEGL.dll`, `vk_swiftshader.dll` cùng các mô-đun `.node`, `agent-desktop-win32-x64.exe` trong `node_modules` đều chưa ký. SAC kiểm tra **từng** tệp khi nạp, nên chỉ ký bộ cài là chưa đủ: mọi tệp PE chạy trên máy người dùng đều phải được ký.

Không có cách nào "lách" SAC bằng mã nguồn. Cách khắc phục đúng là ký số.

## 2. Script đã hỗ trợ ký số

`installer\build-installer.ps1` (qua `installer\codesign.ps1`) sẽ, khi đã cấu hình chứng thư:

1. Ký mọi tệp `*.exe`, `*.dll`, `*.node`, `*.sys`, `*.ocx` trong `build\stage\eGovAI` (kể cả trong `resources\app\node_modules`) **sau** bước đổi biểu tượng và **trước** khi nén `payload.zip`. Tệp đã có chữ ký hợp lệ (ví dụ `d3dcompiler_47.dll` do Microsoft ký) được giữ nguyên.
2. Ký `uninstall.exe` trước khi nhúng vào bộ cài.
3. Ký `dist\eGovAI-Setup-<version>.exe`.

Tất cả dùng SHA-256 và tem thời gian RFC 3161 (`/fd SHA256 /tr <url> /td SHA256`), nhờ đó chữ ký vẫn có hiệu lực sau khi chứng thư hết hạn.

- Chưa cấu hình: script in **cảnh báo màu vàng** rằng bản build chưa ký và vẫn tiếp tục.
- `-RequireSign`: dừng với lỗi nếu chưa cấu hình.
- `scripts\release.ps1` mặc định gọi build với `-RequireSign`, sau đó kiểm tra `Get-AuthenticodeSignature` của bộ cài phải là `Valid` và có tem thời gian, rồi mới tạo GitHub Release. Dùng `-AllowUnsigned` để bỏ qua (không khuyến nghị).

Bộ cài và trình gỡ cài cũng được gắn thông tin phiên bản (CompanyName, ProductName, FileVersion lấy từ `package.json`) qua tệp sinh tự động `build\AssemblyInfo.*.cs`.

### signtool.exe

Script tự tìm `signtool.exe` (bản x64 mới nhất) trong `C:\Program Files (x86)\Windows Kits\10\bin\<phiên bản>\x64\` hoặc trong gói NuGet `Microsoft.Windows.SDK.BuildTools` (`%USERPROFILE%\.nuget\packages\...`). Cài một trong hai:

- Windows SDK, chọn thành phần **Windows SDK Signing Tools for Desktop Apps**; hoặc
- `nuget install Microsoft.Windows.SDK.BuildTools` (không cần quyền quản trị).

Hoặc đặt trực tiếp `EGOVAI_SIGNTOOL=C:\đường\dẫn\signtool.exe`.

## 3. Biến môi trường

Chọn **một** cấu hình. `EGOVAI_SIGN_MODE` (`pfx` | `store` | `trusted`) là tùy chọn; nếu bỏ trống, script tự nhận theo biến có mặt.

| Cấu hình | Biến | Ý nghĩa |
|---|---|---|
| Azure Trusted Signing (Artifact Signing) | `EGOVAI_SIGN_DLIB` | Đường dẫn `Azure.CodeSigning.Dlib.dll` (gói NuGet `Microsoft.Trusted.Signing.Client`, thư mục `bin\x64`) |
| | `EGOVAI_SIGN_METADATA` | Đường dẫn tệp `metadata.json` |
| | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` | Thông tin đăng nhập service principal (hoặc đăng nhập sẵn bằng `az login`) |
| Tệp PFX | `EGOVAI_SIGN_PFX` | Đường dẫn tệp `.pfx` |
| | `EGOVAI_SIGN_PFX_PASSWORD` | Mật khẩu `.pfx` |
| Chứng thư trong kho / token USB | `EGOVAI_SIGN_THUMBPRINT` | SHA-1 thumbprint của chứng thư trong `Cert:\CurrentUser\My` |
| Tùy chọn | `EGOVAI_SIGN_TIMESTAMP_URL` | Máy chủ tem thời gian (mặc định `http://timestamp.digicert.com`; với Trusted Signing là `http://timestamp.acs.microsoft.com`) |
| | `EGOVAI_SIGNTOOL` | Đường dẫn `signtool.exe` |

Ví dụ `metadata.json` cho Trusted Signing:

```json
{
  "Endpoint": "https://<vùng>.codesigning.azure.net",
  "CodeSigningAccountName": "<tên tài khoản>",
  "CertificateProfileName": "<tên certificate profile>"
}
```

Ví dụ phiên PowerShell:

```powershell
$env:EGOVAI_SIGN_DLIB     = 'C:\tools\trusted-signing\bin\x64\Azure.CodeSigning.Dlib.dll'
$env:EGOVAI_SIGN_METADATA = 'C:\tools\trusted-signing\metadata.json'
pnpm package          # build có ký
pnpm release          # phát hành (bắt buộc ký)
```

**Không bao giờ** commit tệp `.pfx`, mật khẩu hay `AZURE_CLIENT_SECRET` vào kho mã. Lưu ý: với cấu hình `pfx`, mật khẩu được truyền cho `signtool /p` nên có thể thấy được trong danh sách tiến trình của chính máy build — chỉ dùng trên máy build tin cậy.

## 4. Các lựa chọn để có chứng thư

| Lựa chọn | Phù hợp khi | Ghi chú |
|---|---|---|
| **Azure Trusted Signing / Artifact Signing** (Microsoft) | Có tổ chức/cá nhân đủ điều kiện xác minh danh tính | Chi phí thấp (gói Basic khoảng 10 USD/tháng — **cần xác nhận**). Chứng thư ngắn hạn do Microsoft quản lý, không phải giữ khóa. **Điều kiện đăng ký giới hạn theo quốc gia** (trước đây: tổ chức ở Mỹ, Canada, EU, Anh; cá nhân ở Mỹ, Canada) — **cần xác nhận** xem tổ chức/cá nhân tại Việt Nam có đăng ký được không. Xác minh danh tính mất vài ngày (**cần xác nhận**). |
| **SignPath Foundation** (miễn phí cho mã nguồn mở) | eGovAI công khai trên GitHub, giấy phép MIT (giấy phép OSI) | Nộp đơn tại signpath.org; được duyệt mới dùng (thời gian duyệt **cần xác nhận**). Chứng thư đứng tên **SignPath Foundation** (không phải tên nhóm). SignPath yêu cầu bản build phải được tạo trên CI có thể kiểm chứng (ví dụ GitHub Actions) và gửi lên dịch vụ của họ để ký — tức là **không** ký bằng script cục bộ ở trên được; cần thêm workflow GitHub Actions khi được duyệt. Điều kiện chi tiết (số người dùng, chính sách phát hành…) **cần xác nhận**. |
| **Chứng thư OV thương mại** (DigiCert, Sectigo, SSL.com, GlobalSign…) | Có pháp nhân hoặc cá nhân xác minh được | Khoảng vài trăm USD/năm (**cần xác nhận**). Từ 06/2023, khóa riêng của chứng thư ký mã phải nằm trên phần cứng (token USB/HSM) hoặc HSM đám mây, nên thường **không còn nhận được tệp .pfx** — dùng cấu hình `store` (token) hoặc công cụ ký đám mây của CA. |
| **Chứng thư EV** | Cần danh tiếng SmartScreen tốt hơn | Đắt hơn OV. Microsoft được cho là đã bỏ ưu đãi "danh tiếng tức thì" cho EV từ 2024 (**cần xác nhận**). Với SAC, OV hay EV đều được chấp nhận miễn là CA nằm trong Trusted Root Program. |
| **CA trong nước** (VNPT-CA, Viettel-CA, …) | Đã có chứng thư số doanh nghiệp | Chứng thư dùng cho chữ ký số văn bản/thuế **thường không** dùng để ký mã được; cần chứng thư loại *Code Signing* và CA gốc phải nằm trong Microsoft Trusted Root Program cho mục đích ký mã — **cần xác nhận** với CA. |

Không dùng chứng thư tự ký (self-signed): SAC vẫn chặn.

## 4b. Ký qua SignPath Foundation (đã chọn)

Kho đã có sẵn mọi thứ phía mã nguồn:

- `.github/workflows/release.yml` — workflow chạy tay: build trên `windows-latest`, cài `agy.exe`, chạy `build-installer.ps1 -Phase Stage` để gom các tệp PE chưa ký, gửi SignPath ký (cấu hình `app-files`), chạy `-Phase Bundle` để ghép bộ cài từ tệp đã ký, gửi SignPath ký bộ cài (cấu hình `installer`), kiểm tra chữ ký + tem thời gian, tính SHA-256 và (tùy chọn) tải lên GitHub Release.
- `.signpath/artifact-configurations/app-files.xml` và `installer.xml` — nội dung artifact configuration để dán vào SignPath.
- README có mục **Code signing policy** và **Privacy policy** mà SignPath Foundation yêu cầu.

Việc bạn (chủ dự án) cần tự làm:

1. Nộp đơn tại https://signpath.org (mục *Apply*), khai kho `github.com/toilatrung/eGovAI`, giấy phép MIT. Chờ duyệt (thời gian **cần xác nhận**).
2. Khi được duyệt, trên SignPath:
   - Tạo (hoặc kiểm tra) project slug **`eGovAI`**, signing policy slug **`release-signing`**, liên kết với GitHub trusted build system.
   - Thêm 2 artifact configuration slug **`app-files`** và **`installer`** từ hai tệp XML trên.
   - Tạo CI user, lấy API token; ghi lại Organization ID.
3. Trên GitHub (Settings → Secrets and variables → Actions):
   - Secret `SIGNPATH_API_TOKEN`
   - Variable `SIGNPATH_ORGANIZATION_ID`
4. Vào Actions → **Build & ký bộ cài** → Run workflow (tích *upload_to_release* để thay bộ cài trên Release). Khi workflow chờ, vào SignPath phê duyệt 2 yêu cầu ký.

Điểm **cần xác nhận** với SignPath Foundation khi nộp đơn:

- `eGovAI.exe` là `electron.exe` (mã nguồn mở, giấy phép MIT) đã đổi biểu tượng; các DLL `ffmpeg.dll`, `libEGL.dll`, `libGLESv2.dll`, `vk_swiftshader.dll`, `vulkan-1.dll` đi kèm Electron và `agent-desktop-win32-*.exe` (gói npm `agent-desktop`) đều chưa ký. Hỏi rõ SignPath có đồng ý ký các thành phần mã nguồn mở bên thứ ba này không — nếu không, Smart App Control vẫn chặn khi nạp chúng.
- `agy.exe` là phần mềm đóng của Google (đã có chữ ký Google LLC, không gửi đi ký). Hỏi SignPath có chấp nhận bộ cài kèm thành phần đóng đã ký sẵn không; nếu không, cần chuyển sang cho ứng dụng tải `agy.exe` khi cài/chạy lần đầu (ứng dụng đã có sẵn luồng cài `agy` qua `irm https://antigravity.google/cli/install.ps1 | iex`).
- Tên các tham số của action `signpath/github-action-submit-signing-request@v1` và cú pháp XML artifact configuration đối chiếu lại với tài liệu SignPath hiện hành.

## 5. Kiểm tra chữ ký

```powershell
Get-AuthenticodeSignature .\dist\eGovAI-Setup-0.1.0.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
# Kiểm tra mọi tệp trong ứng dụng đã ghép — dòng nào không phải Valid là chưa đạt:
Get-ChildItem .\build\stage\eGovAI -Recurse -Include *.exe,*.dll,*.node |
  ForEach-Object { [pscustomobject]@{ Status = (Get-AuthenticodeSignature $_.FullName).Status; File = $_.FullName } } |
  Where-Object Status -ne 'Valid'
# Hoặc bằng signtool:
signtool verify /pa /v .\dist\eGovAI-Setup-0.1.0.exe
```

Sau khi cài trên máy thật, có thể kiểm tra lại thư mục `%LOCALAPPDATA%\Programs\eGovAI` theo cách trên. Nên thử trên một máy Windows 11 có SAC ở chế độ **On** trước khi phát hành.

Những điểm chưa được ký và cần lưu ý:

- Các script `.ps1`/`.cmd` trong `node_modules` không được ký (ứng dụng không chạy chúng trong hoạt động bình thường).
- Tệp do ứng dụng **tải về lúc chạy** (ví dụ trình duyệt của Playwright, nếu có) không nằm trong bộ cài nên không được ký bởi quy trình này; SAC có thể chặn chúng (**cần xác nhận** tùy tính năng).
- `eGovAI.exe` vẫn mang thông tin phiên bản gốc của Electron (ProductName "Electron"). Chữ ký vẫn hợp lệ; muốn đổi thông tin hiển thị cần thêm bước sửa tài nguyên VERSIONINFO (trước bước ký).

## 6. Lưu ý cho người dùng cuối

- Smart App Control **không cho phép** thêm ngoại lệ cho từng ứng dụng. Không có nút "Vẫn chạy" như SmartScreen.
- Cách duy nhất phía người dùng là **tắt hẳn Smart App Control** (Windows Security → App & browser control → Smart App Control settings → Off). Trên nhiều bản Windows 11, sau khi tắt thì **không bật lại được** nếu không cài lại/đặt lại Windows (một số bản cập nhật mới hơn có thể đã cho phép bật lại — **cần xác nhận** theo bản build). Tắt SAC cũng làm giảm lớp bảo vệ trước phần mềm độc hại cho toàn máy.
- Khuyến nghị: **không tắt SAC** chỉ để chạy eGovAI. Hãy chờ bản phát hành đã ký số (kiểm tra bằng chuột phải vào bộ cài → Properties → tab *Digital Signatures*), hoặc dùng trên máy mà SAC đang ở chế độ Off/Evaluation theo chính sách của đơn vị.

Tham khảo: [Câu hỏi thường gặp về Smart App Control (Microsoft)](https://support.microsoft.com/vi-vn/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions#bkmk_unknown).
