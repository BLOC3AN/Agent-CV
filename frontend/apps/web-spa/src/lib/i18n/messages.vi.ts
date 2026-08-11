/**
 * Chữ tiếng Việt trên giao diện.
 *
 * Bảng này là bản gốc: `messages.en.ts` khai kiểu theo nó, nên thêm khoá ở đây
 * mà quên dịch sẽ thành lỗi biên dịch chứ không phải một ô trống lặng lẽ trên
 * màn hình.
 *
 * Chỉ chứa chữ của GIAO DIỆN. Tiêu đề mục in trong CV nằm ở
 * `lib/cv-section-titles.ts` vì chúng bám vào `cv.language` chứ không bám vào
 * tuỳ chọn của người dùng, và còn phải chạy được ở SSR nơi không có context.
 */
export const vi = {
  // Điều hướng chung
  home: 'Trang chủ',
  cvs: 'CV của tôi',
  analyze: 'Đối chiếu việc làm',
  settings: 'Cài đặt',
  templates: 'Mẫu CV',
  preview: 'Xem trước',
  share: 'Chia sẻ',
  download: 'Tải PDF',
  logout: 'Đăng xuất',
  locale: 'Ngôn ngữ giao diện',

  // Bộ chọn ngôn ngữ của CV
  cvLanguage: 'Ngôn ngữ CV',
  cvLanguageVi: 'Tiếng Việt',
  cvLanguageEn: 'English',

  // Trạng thái bản nháp
  statusDirty: 'Chưa lưu',
  statusSaving: 'Đang lưu…',
  statusSaved: 'Đã lưu',
  statusSaveFailed: 'Lưu thất bại',
  loadingCV: 'Đang tải CV…',
  cvNotFound: 'Không tìm thấy CV',
  invalidCVId: 'Mã CV không hợp lệ',
  retry: 'Thử lại',

  // Hành động chung
  save: 'Lưu thay đổi',
  discard: 'Bỏ thay đổi',
  cancel: 'Hủy',
  close: 'Đóng',

  // Hộp thoại rời trang
  unsavedTitle: 'Thay đổi chưa lưu',
  unsavedBody: 'Bạn muốn lưu bản nháp trước khi rời trình soạn thảo?',
  saveAndLeave: 'Lưu và rời đi',

  // Hộp thoại tải PDF
  downloadDialogTitle: 'CV có thay đổi chưa lưu',
  downloadDialogBody: 'Chọn rõ phiên bản dùng để xuất PDF. Chỉ “Lưu và tải” mới tạo revision.',
  downloadDialogLabel: 'Xuất PDF với thay đổi chưa lưu',
  discardAndDownload: 'Bỏ thay đổi và tải',
  saveAndDownload: 'Lưu và tải',
  downloadFailed: 'Không tải được PDF',

  // Trợ lý AI
  openAssistant: 'Mở Trợ lý AI',

  // Popup xem trước
  previewTitle: 'Xem trước CV A4',
  previewClose: 'Đóng xem trước',
  print: 'In / Print',
  preparingPDF: 'Đang chuẩn bị PDF…',
  previewExportFailed: 'Không thể chuẩn bị PDF. Bản nháp chưa được xuất.',

  // Panel thiết kế
  cvLayout: 'Bố cục CV',
  draftUnsaved: 'Bản nháp chưa lưu',
  textAlign: 'Căn lề nội dung',
  alignLeft: 'Căn trái',
  alignRight: 'Căn phải',
  alignJustify: 'Căn đều hai bên',
  bodyFontSize: 'Cỡ chữ nội dung',
  sectionTitleFontSize: 'Cỡ tiêu đề section',
  headerFontSize: 'Cỡ header',
  lineHeight: 'Khoảng cách dòng',
  pageMargin: 'Khoảng cách trang',
  paddingTop: 'Padding trên',
  paddingBottom: 'Padding dưới',
  paddingLeft: 'Padding trái',
  paddingRight: 'Padding phải',
  nonDefaultOrder: 'Thứ tự này khác bố cục CV tiêu chuẩn. Nội dung vẫn được in theo đúng thứ tự đang chọn.',

  // Cây mục lục
  cvStructure: 'Cấu trúc CV',
  collapse: 'Thu gọn',
  expand: 'Mở rộng',
  hide: 'Ẩn',
  show: 'Hiện',
  drag: 'Kéo',
  endOfList: 'cuối danh sách',
  dropToEnd: 'Thả để chuyển node xuống cuối',

  // Trình sửa nội tuyến
  edit: 'Chỉnh sửa',
  updateDraft: 'Cập nhật bản nháp',
  closeInlineEditor: 'Đóng trình sửa nội tuyến',
  commaSeparatedHint: 'Ngăn cách thẻ bằng dấu phẩy.',

  // Lịch sử phiên bản
  versionHistory: 'Lịch sử phiên bản',
  versionHistoryHint: 'Xem lại thay đổi hoặc khôi phục một phiên bản đã lưu.',
  versionPickHint: 'Chọn một phiên bản để xem trước thay đổi.',
  noSavedVersions: 'Chưa có phiên bản đã lưu.',
  loadingHistory: 'Đang tải lịch sử phiên bản…',
  loadingPreview: 'Đang tải bản xem trước…',
  loadingShort: 'Đang tải…',
  restoring: 'Đang khôi phục…',
  restore: 'Khôi phục',
  restoreConfirmLabel: 'Xác nhận khôi phục phiên bản',
  restoreConfirmBody: 'Thao tác này tạo một phiên bản mới và giữ lại lịch sử hiện có.',
  createRestoreRevision: 'Tạo phiên bản khôi phục',
  restoreBlockedByDraft: 'Hãy lưu hoặc bỏ thay đổi trong bản nháp trước khi khôi phục phiên bản.',
  beforeChange: 'Trước khi thay đổi',
  afterChange: 'Sau thay đổi',
  noPreviousRevision: 'Không có bản trước đó cho phiên bản này.',
  noContentChange: 'Không có thay đổi nội dung so với bản trước đó.',
  historyLoadFailed: 'Không tải được lịch sử phiên bản',
  previewLoadFailed: 'Không tải được bản xem trước',
  restoreFailed: 'Không thể khôi phục phiên bản',
  changeAdded: 'Thêm mới',
  changeEdited: 'Đã sửa',
  changeRemoved: 'Đã xóa',
  sourceUser: 'Người dùng',

  // Tab và panel thiết kế
  tabSections: 'Nội dung (Sections)',
  tabDesign: 'Thiết kế (Design)',
  resetDefault: 'Đặt lại mặc định',
  template: 'Mẫu CV (Template)',
  accentColor: 'Màu chủ đạo',
  font: 'Font chữ',

  // Chuỗi có tham số
  versionNumber: 'Phiên bản {n}',
  previewVersion: 'Xem trước phiên bản {n}',
  restoreVersion: 'Khôi phục phiên bản {n}',
  restoreVersionQuestion: 'Khôi phục phiên bản {n}?',
  changeCount: '{n} thay đổi so với bản trước đó',
  dropPosition: 'Vị trí thả {label}',
} as const

export type MessageKey = keyof typeof vi
